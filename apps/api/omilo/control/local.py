"""omilo.control.local — LocalControlPlane (cloud mode, authoritative).

Wraps the existing in-process auth/billing functions so that cloud mode runs
exactly as before — zero behavior change — while satisfying the ControlPlane
Protocol.  Every method that touches the database accepts an optional ``db``
keyword argument (a SQLAlchemy Session).  When ``db`` is supplied (e.g. from
tests or runner call-sites that already hold a session) it is used directly;
when omitted a fresh superuser session is opened for the duration of the call.

Design
------
- verify_token       → auth.tokens.decode_token  (stateless, no DB)
- get_entitlements   → load Company + its Plan from the DB → Entitlements
- check_balance      → billing.balance.balance(db, company) + overage_policy
- report_usage       → billing.meter.meter_job idempotent per (company_id, job_id)
- register_install   → stub returning a deterministic local token (T2 adds the
                       real InstallToken model + /control/register endpoint)
- heartbeat          → always True (stub, T2)
"""
from __future__ import annotations

import hashlib
import logging
from contextlib import contextmanager

from sqlalchemy.orm import Session

from omilo.control import (
    BalanceState,
    Entitlements,
    Identity,
    InstallTokenInfo,
    UsageEvent,
    UsageResult,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal: session context manager
# ---------------------------------------------------------------------------

@contextmanager
def _session_or_open(db: Session | None):
    """Yield *db* if provided; otherwise open a fresh superuser session.

    The caller does NOT commit/rollback when a session is injected — the
    injecting context manager owns the transaction.  When we open our own
    session we commit on success and rollback on failure.
    """
    if db is not None:
        yield db
    else:
        from omilo.db import SessionLocal

        with SessionLocal() as session:
            with session.begin():
                yield session


# ---------------------------------------------------------------------------
# LocalControlPlane
# ---------------------------------------------------------------------------


class LocalControlPlane:
    """Cloud-mode implementation of ControlPlane — authoritative, in-process.

    All methods are synchronous.  Methods that need DB access accept an
    optional ``db: Session`` keyword argument.  When omitted they open a
    fresh superuser (omilo) session.

    This is the *only* class that may call the underlying billing/auth
    primitives in cloud mode after the port is wired; in runtime mode (T3)
    the RemoteControlPlane replaces it for metering/balance calls while still
    delegating verify_token to local JWKS verification.
    """

    # ------------------------------------------------------------------
    # verify_token — stateless, no DB
    # ------------------------------------------------------------------

    def verify_token(self, jwt: str) -> Identity:
        """Decode and validate a user JWT.

        Delegates to auth.tokens.decode_token which verifies the HS256
        signature + expiry using the server's jwt_secret.

        Returns:
            Identity with user_id, company_id, role from the JWT claims.

        Raises:
            jwt.PyJWTError (including ExpiredSignatureError) on any failure.
        """
        from omilo.auth.tokens import decode_token

        claims = decode_token(jwt)
        return Identity(
            user_id=claims["sub"],
            company_id=claims["cmp"],
            role=claims["role"],
        )

    # ------------------------------------------------------------------
    # get_entitlements
    # ------------------------------------------------------------------

    def get_entitlements(self, company_id: str, *, db: Session | None = None) -> Entitlements:
        """Load the company's plan and return Entitlements.

        If the company has no plan_id (free / unassigned) included_credits
        defaults to 0.

        Args:
            company_id: The company to look up.
            db:         Optional Session.  If not provided a superuser session
                        is opened automatically.

        Returns:
            Entitlements with plan_id, included_credits, overage_policy,
            edition, and features.

        Raises:
            ValueError: if the company is not found.
        """
        from omilo.models.billing import Plan
        from omilo.models.tenancy import Company

        with _session_or_open(db) as session:
            company = session.get(Company, company_id)
            if company is None:
                raise ValueError(f"Company not found: {company_id!r}")

            plan: Plan | None = None
            if company.plan_id:
                plan = session.get(Plan, company.plan_id)

            included_credits = int(plan.included_credits) if plan is not None else 0
            features: dict = dict(plan.features) if plan is not None and plan.features else {}

            return Entitlements(
                edition=company.edition or "cloud",
                plan_id=company.plan_id,
                included_credits=included_credits,
                overage_policy=company.overage_policy or "soft",
                features=features,
            )

    # ------------------------------------------------------------------
    # check_balance
    # ------------------------------------------------------------------

    def check_balance(self, company_id: str, *, db: Session | None = None) -> BalanceState:
        """Return the current credit balance for the company.

        Delegates to billing.balance.balance(db, company) — reads
        Company.credit_balance (maintained by meter.py on every job and
        grant_credits on every top-up).

        Args:
            company_id: The company to look up.
            db:         Optional Session.

        Returns:
            BalanceState{balance, overage_policy}.

        Raises:
            ValueError: if the company is not found.
        """
        from omilo.billing.balance import balance as _balance
        from omilo.models.tenancy import Company

        with _session_or_open(db) as session:
            company = session.get(Company, company_id)
            if company is None:
                raise ValueError(f"Company not found: {company_id!r}")

            bal = _balance(session, company)
            return BalanceState(
                balance=bal,
                overage_policy=company.overage_policy or "soft",
            )

    # ------------------------------------------------------------------
    # report_usage
    # ------------------------------------------------------------------

    def report_usage(self, ev: UsageEvent, *, db: Session | None = None) -> UsageResult:
        """Debit the credit ledger for a completed job — idempotent per job_id.

        In cloud mode this calls billing.meter.meter_job which already
        implements the idempotency guard (CreditLedger row per
        (company_id, job_id, reason="job")).  The method adapts the
        UsageEvent into a lightweight job-like object so meter_job can be
        reused without copying its logic.

        Pool / BYO engine types (fake, anthropic, claude_code, graph) are
        0-credit and always accepted — meter_job handles this correctly.

        Args:
            ev: UsageEvent with company_id, job_id, engine_type, model,
                tokens_in, tokens_out, credits.
            db: Optional Session.

        Returns:
            UsageResult{accepted=True, new_balance=<current balance after debit>}.
        """
        from omilo.billing.meter import meter_job
        from omilo.models.tenancy import Company

        with _session_or_open(db) as session:
            # Build a minimal job-like object that meter_job reads via getattr.
            # We do NOT create a real Job ORM row; meter_job only reads fields
            # it needs: company_id, id, helper_id, engine_type, model,
            # tokens_in, tokens_out.
            job_proxy = _JobProxy(
                company_id=ev.company_id,
                job_id=ev.job_id,
                engine_type=ev.engine_type,
                model=ev.model,
                tokens_in=ev.tokens_in,
                tokens_out=ev.tokens_out,
            )

            meter_job(session, job_proxy)  # type: ignore[arg-type]

            # Read the current balance after the (idempotent) debit.
            company = session.get(Company, ev.company_id)
            new_bal = int(company.credit_balance) if company is not None else 0

            return UsageResult(accepted=True, new_balance=new_bal)

    # ------------------------------------------------------------------
    # register_install — stub (T2 adds real InstallToken model + endpoint)
    # ------------------------------------------------------------------

    def register_install(self, user_jwt: str, **kw) -> InstallTokenInfo:
        """Issue a local install token for the company in the JWT.

        STUB — T2 adds the real ``InstallToken`` model (revocable, stored
        in the DB) and the ``/control/register`` endpoint.  Here we issue
        a deterministic token derived from the JWT so the port is whole
        and callers can test the factory/routing without T2 being complete.

        The stub token is NOT stored in the DB and NOT revocable.
        Do NOT use in production without T2.

        Returns:
            InstallTokenInfo{install_token, company_id}.

        Raises:
            jwt.PyJWTError: if the JWT is invalid.
        """
        identity = self.verify_token(user_jwt)
        # Derive a deterministic stub token so the value is stable for tests.
        # In T2 this will be replaced by a DB-stored, revocable token.
        raw = f"local-install:{identity.company_id}:{identity.user_id}"
        stub_token = "local_" + hashlib.sha256(raw.encode()).hexdigest()[:32]
        logger.warning(
            "register_install: using stub local token for company_id=%s — T2 adds the real model",
            identity.company_id,
        )
        return InstallTokenInfo(
            install_token=stub_token,
            company_id=identity.company_id,
        )

    # ------------------------------------------------------------------
    # heartbeat — stub (T2)
    # ------------------------------------------------------------------

    def heartbeat(self, install_token: str, **kw) -> bool:
        """Liveness check — always True for LocalControlPlane.

        STUB — T2 adds revocation logic.  In cloud mode the install is by
        definition valid (we are the cloud).
        """
        return True


# ---------------------------------------------------------------------------
# _JobProxy — lightweight stand-in so meter_job can be called without a real Job row
# ---------------------------------------------------------------------------


class _JobProxy:
    """Minimal job-like object satisfying the field contract of meter_job.

    meter_job reads:
        job.company_id, job.id, job.helper_id,
        job.engine_type, job.model (via getattr),
        job.tokens_in, job.tokens_out

    We set helper_id to None because meter_job stores it on the ledger row
    for analytics but does not require it.
    """

    __slots__ = ("company_id", "id", "helper_id", "engine_type", "model", "tokens_in", "tokens_out")

    def __init__(
        self,
        *,
        company_id: str,
        job_id: str,
        engine_type: str,
        model: str | None,
        tokens_in: int,
        tokens_out: int,
    ) -> None:
        self.company_id = company_id
        self.id = job_id
        self.helper_id = None
        self.engine_type = engine_type
        self.model = model
        self.tokens_in = tokens_in
        self.tokens_out = tokens_out
