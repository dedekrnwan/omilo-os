"""omilo.control — ControlPlane port + shared types.

The ControlPlane is the abstraction boundary between the cloud identity/billing
authority and the agent runtime.  In cloud mode (OMILO_MODE=cloud) it resolves
in-process via LocalControlPlane.  In runtime mode (OMILO_MODE=runtime, T3) it
delegates over HTTP to the cloud via RemoteControlPlane.

Types
-----
Identity        — decoded JWT claims: {user_id, company_id, role}
Entitlements    — company plan limits: {edition, plan_id, included_credits, overage_policy, features}
BalanceState    — billing gate snapshot: {balance, overage_policy}
UsageEvent      — usage to debit: {company_id, job_id, engine_type, model, tokens_in, tokens_out, credits}
UsageResult     — result of report_usage: {accepted, new_balance}
InstallTokenInfo — result of register_install: {install_token, company_id}

Protocol
--------
ControlPlane    — structural Protocol; LocalControlPlane and RemoteControlPlane satisfy it.

Exception
---------
ControlPlaneUnreachable — raised by RemoteControlPlane (T3) when the cloud
                          control plane cannot be reached and the operation
                          requires an authoritative response.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


# ---------------------------------------------------------------------------
# Shared data types
# ---------------------------------------------------------------------------


@dataclass
class Identity:
    """Decoded JWT identity claims."""

    user_id: str
    company_id: str
    role: str


@dataclass
class Entitlements:
    """Company plan entitlements."""

    edition: str
    plan_id: str | None
    included_credits: int
    overage_policy: str
    features: dict = field(default_factory=dict)


@dataclass
class BalanceState:
    """Current credit balance snapshot."""

    balance: int
    overage_policy: str


@dataclass
class UsageEvent:
    """A usage event to be recorded against the credit ledger."""

    company_id: str
    job_id: str
    engine_type: str
    model: str | None
    tokens_in: int
    tokens_out: int
    credits: int


@dataclass
class UsageResult:
    """Result returned by report_usage."""

    accepted: bool
    new_balance: int


@dataclass
class InstallTokenInfo:
    """Result returned by register_install."""

    install_token: str
    company_id: str


# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------


class ControlPlaneUnreachable(Exception):
    """Raised when the remote control plane cannot be contacted and the
    operation requires a cloud-authoritative response.

    Defined here so call sites can catch it without importing the remote impl.
    Used by RemoteControlPlane (T3); LocalControlPlane never raises this.
    """


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class ControlPlane(Protocol):
    """Structural protocol for the control-plane abstraction.

    Cloud mode  (LocalControlPlane)  — resolves in-process, authoritative.
    Runtime mode (RemoteControlPlane) — HTTP client to the cloud, T3.

    Methods
    -------
    verify_token(jwt)
        Decode and validate a user JWT.  Returns Identity.
        Raises jwt.PyJWTError (LocalControlPlane) or ControlPlaneUnreachable
        (RemoteControlPlane, offline-capable via JWKS).

    get_entitlements(company_id, **kw)
        Return the company's plan/limits.  Raises if company not found.

    check_balance(company_id, **kw)
        Return BalanceState.  Cloud-authoritative.

    report_usage(ev, **kw)
        Debit the credit ledger idempotently per (company_id, job_id).
        Returns UsageResult {accepted, new_balance}.

    register_install(user_jwt, **kw)
        Register a new local runtime to a company; returns InstallTokenInfo.
        LocalControlPlane: stub (T2 adds real model + endpoints).
        RemoteControlPlane: HTTP POST /control/register (T3).

    heartbeat(install_token, **kw)
        Liveness + revocation check.  Returns True if the install is valid.
        LocalControlPlane: always True (stub, T2).
        RemoteControlPlane: HTTP POST /control/heartbeat (T3).
    """

    def verify_token(self, jwt: str) -> Identity: ...  # noqa: E704

    def get_entitlements(self, company_id: str, **kw) -> Entitlements: ...  # noqa: E704

    def check_balance(self, company_id: str, **kw) -> BalanceState: ...  # noqa: E704

    def report_usage(self, ev: UsageEvent, **kw) -> UsageResult: ...  # noqa: E704

    def register_install(self, user_jwt: str, **kw) -> InstallTokenInfo: ...  # noqa: E704

    def heartbeat(self, install_token: str, **kw) -> bool: ...  # noqa: E704
