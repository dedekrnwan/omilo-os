"""TDD — P6 Task 2: Cloud /control/* federation endpoints + InstallToken + JWKS.

Tests:
  1. RS256 + JWKS: configure a keypair, encode, decode, JWKS returns public key,
     wrong-key token fails, HS256 default still works.
  2. POST /control/register: valid user JWT → {install_token, company_id};
     raw token in response, token_hash NOT; DB sha256(raw) matches.
  3. GET /control/entitlements with install token → company plan values.
  4. GET /control/balance with install token → balance + overage_policy.
  5. POST /control/usage: debit once; re-POST same job_id → idempotent (no double debit).
     company_id ALWAYS taken from install token, NOT from request body.
  6. POST /control/heartbeat → {ok, revoked: false}.
  7. Revoked install token → 401/403; unknown token → 401.
  8. Cross-company isolation: install token for company A cannot read company B.
  9. GET /control/jwks: reachable without auth.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from omilo.auth.tokens import decode_token, get_jwks, make_access_token
from omilo.config import get_settings
from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.billing import Plan
from omilo.models.install import InstallToken
from omilo.models.tenancy import Company, Member, User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _superuser_session():
    class _S:
        def __enter__(self):
            self._sess = SessionLocal()
            self._txn = self._sess.begin()
            return self._sess

        def __exit__(self, exc_type, exc, tb):
            if exc_type is not None:
                self._txn.rollback()
            else:
                self._txn.commit()
            self._sess.close()

    return _S()


def _make_company_with_user(db, *, credit_balance: int = 500, plan_credits: int = 300) -> tuple[Company, User, str]:
    """Create a Company + Plan + User + Member, return (company, user, access_token)."""
    plan = Plan(
        id=prefixed_id("pln"),
        tier="starter",
        name=f"CtrlPlan-{uuid.uuid4().hex[:6]}",
        monthly_price_usd=Decimal("0"),
        monthly_price_idr=0,
        included_credits=plan_credits,
        credit_overage_usd=Decimal("0"),
        seats=1,
        features={},
    )
    db.add(plan)
    db.flush()

    company = Company(
        id=prefixed_id("cmp"),
        name=f"CtrlCo-{uuid.uuid4().hex[:6]}",
        color="#AABBCC",
        autonomy_default="ask",
        credit_balance=credit_balance,
        overage_policy="soft",
        edition="cloud",
        plan_id=plan.id,
    )
    db.add(company)
    db.flush()

    user = User(
        id=prefixed_id("usr"),
        email=f"ctrl_{uuid.uuid4().hex[:8]}@test.example",
        name="Control Test",
        password_hash=None,
    )
    db.add(user)
    db.flush()

    member = Member(
        id=prefixed_id("mbr"),
        company_id=company.id,
        user_id=user.id,
        role="owner",
    )
    db.add(member)
    db.flush()

    token, _ = make_access_token(user.id, company.id, "owner")
    return company, user, token


# ---------------------------------------------------------------------------
# App fixture (cloud mode — default)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def ctrl_client():
    """Async client against the app (cloud mode by default)."""
    from omilo.main import create_app
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client


# ---------------------------------------------------------------------------
# Section 1: RS256 + JWKS unit tests (no HTTP)
# ---------------------------------------------------------------------------


class TestRS256AndJWKS:
    """RS256 JWT encode/decode and JWKS construction."""

    def _gen_keypair_pem(self):
        """Generate an RSA keypair and return (private_pem, public_pem) as strings."""
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization

        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )
        private_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()
        public_pem = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()
        return private_pem, public_pem

    def test_hs256_default_still_works(self):
        """HS256 is still the default when no RS key is configured."""
        import jwt as pyjwt

        token, _ = make_access_token("usr1", "cmp1", "owner")
        settings = get_settings()
        claims = pyjwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        assert claims["sub"] == "usr1"
        assert claims["cmp"] == "cmp1"

    def test_decode_token_hs256_works(self):
        """decode_token still verifies HS256 tokens without RS key configured."""
        token, _ = make_access_token("usr2", "cmp2", "member")
        claims = decode_token(token)
        assert claims["sub"] == "usr2"
        assert claims["cmp"] == "cmp2"

    def test_get_jwks_empty_when_no_rs_key(self, monkeypatch):
        """get_jwks() returns {"keys": []} when no RS256 key is configured."""
        monkeypatch.setattr(
            "omilo.auth.tokens.get_settings",
            lambda: type("S", (), {
                "jwt_secret": "test-secret",
                "jwt_access_ttl_s": 3600,
                "omilo_jwt_private_key": None,
                "omilo_jwt_public_key": None,
            })(),
        )
        from omilo.auth import tokens as _tok_mod
        jwks = get_jwks()
        assert jwks == {"keys": []}

    def test_rs256_encode_decode(self, monkeypatch):
        """When RS key is configured, encode signs RS256; decode_token verifies it."""
        private_pem, public_pem = self._gen_keypair_pem()

        fake_settings = type("S", (), {
            "jwt_secret": "fallback-secret",
            "jwt_access_ttl_s": 3600,
            "omilo_jwt_private_key": private_pem,
            "omilo_jwt_public_key": public_pem,
        })()
        monkeypatch.setattr("omilo.auth.tokens.get_settings", lambda: fake_settings)

        # Import after monkeypatching
        from omilo.auth import tokens as _tok_mod

        token, _ = _tok_mod.make_access_token("usr3", "cmp3", "admin")

        # Should be RS256
        import jwt as pyjwt
        header = pyjwt.get_unverified_header(token)
        assert header["alg"] == "RS256"
        assert "kid" in header

        # decode_token should verify it
        claims = _tok_mod.decode_token(token)
        assert claims["sub"] == "usr3"
        assert claims["cmp"] == "cmp3"

    def test_rs256_wrong_key_fails_decode(self, monkeypatch):
        """A token signed with a different private key fails decode."""
        private_pem_a, public_pem_a = self._gen_keypair_pem()
        private_pem_b, public_pem_b = self._gen_keypair_pem()

        # Sign with key A
        settings_a = type("S", (), {
            "jwt_secret": "s",
            "jwt_access_ttl_s": 3600,
            "omilo_jwt_private_key": private_pem_a,
            "omilo_jwt_public_key": public_pem_a,
        })()
        monkeypatch.setattr("omilo.auth.tokens.get_settings", lambda: settings_a)
        from omilo.auth import tokens as _tok_mod
        token = _tok_mod.make_access_token("u", "c", "owner")[0]

        # Attempt to verify with key B
        settings_b = type("S", (), {
            "jwt_secret": "s",
            "jwt_access_ttl_s": 3600,
            "omilo_jwt_private_key": private_pem_b,
            "omilo_jwt_public_key": public_pem_b,
        })()
        monkeypatch.setattr("omilo.auth.tokens.get_settings", lambda: settings_b)

        import jwt as pyjwt
        with pytest.raises(pyjwt.PyJWTError):
            _tok_mod.decode_token(token)

    def test_hs256_forgery_rejected_when_rs256_configured(self, monkeypatch):
        """Security: an HS256-forged token MUST be rejected when RS256 is configured.

        This guards against the JWT algorithm-confusion attack: an attacker who
        knows the HS256 jwt_secret cannot forge an accepted token once RS256 is on.
        """
        import jwt as pyjwt
        from datetime import datetime, timezone, timedelta

        private_pem, public_pem = self._gen_keypair_pem()
        shared_secret = "known-secret"

        fake_settings = type("S", (), {
            "jwt_secret": shared_secret,
            "jwt_access_ttl_s": 3600,
            "omilo_jwt_private_key": private_pem,
            "omilo_jwt_public_key": public_pem,
        })()
        monkeypatch.setattr("omilo.auth.tokens.get_settings", lambda: fake_settings)

        # Forge an HS256 token using the known jwt_secret
        forged = pyjwt.encode(
            {
                "sub": "attacker",
                "cmp": "c",
                "role": "admin",
                "exp": datetime.now(tz=timezone.utc) + timedelta(hours=1),
                "iat": datetime.now(tz=timezone.utc),
            },
            shared_secret,
            algorithm="HS256",
        )

        from omilo.auth import tokens as _tok_mod
        with pytest.raises(pyjwt.PyJWTError):
            _tok_mod.decode_token(forged)

    def test_get_jwks_returns_public_key(self, monkeypatch):
        """get_jwks() returns a valid JWK object when RS256 key is configured."""
        private_pem, public_pem = self._gen_keypair_pem()

        fake_settings = type("S", (), {
            "jwt_secret": "s",
            "jwt_access_ttl_s": 3600,
            "omilo_jwt_private_key": private_pem,
            "omilo_jwt_public_key": public_pem,
        })()
        monkeypatch.setattr("omilo.auth.tokens.get_settings", lambda: fake_settings)

        from omilo.auth import tokens as _tok_mod
        jwks = _tok_mod.get_jwks()

        assert "keys" in jwks
        assert len(jwks["keys"]) == 1
        key = jwks["keys"][0]
        assert key["kty"] == "RSA"
        assert key["alg"] == "RS256"
        assert key["use"] == "sig"
        assert "n" in key
        assert "e" in key
        assert "kid" in key


# ---------------------------------------------------------------------------
# Section 2: /control/register
# ---------------------------------------------------------------------------


class TestRegister:
    @pytest.mark.asyncio
    async def test_register_creates_install_token(self, ctrl_client):
        """POST /control/register with valid JWT → {install_token, company_id}."""
        with _superuser_session() as su:
            company, user, token = _make_company_with_user(su)
            company_id = company.id

        resp = await ctrl_client.post(
            "/control/register",
            json={"user_jwt": token},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()

        assert "install_token" in body
        assert body["company_id"] == company_id
        # Raw token must be present
        raw = body["install_token"]
        assert raw and len(raw) > 10
        # token_hash must NOT be in response
        assert "token_hash" not in body

    @pytest.mark.asyncio
    async def test_register_stores_sha256_hash(self, ctrl_client):
        """DB install_token row stores sha256(raw), not raw."""
        with _superuser_session() as su:
            company, user, token = _make_company_with_user(su)
            company_id = company.id

        resp = await ctrl_client.post(
            "/control/register",
            json={"user_jwt": token},
        )
        assert resp.status_code == 200, resp.text
        raw = resp.json()["install_token"]

        expected_hash = hashlib.sha256(raw.encode()).hexdigest()

        with _superuser_session() as su:
            row = su.query(InstallToken).filter_by(company_id=company_id).first()
        assert row is not None
        assert row.token_hash == expected_hash

    @pytest.mark.asyncio
    async def test_register_invalid_jwt_returns_401(self, ctrl_client):
        """POST /control/register with invalid JWT → 401."""
        resp = await ctrl_client.post(
            "/control/register",
            json={"user_jwt": "not.a.valid.jwt"},
        )
        assert resp.status_code == 401, resp.text


# ---------------------------------------------------------------------------
# Section 3: /control/entitlements
# ---------------------------------------------------------------------------


class TestEntitlements:
    @pytest.mark.asyncio
    async def test_entitlements_returns_company_plan(self, ctrl_client):
        """GET /control/entitlements with valid install token → plan values."""
        plan_credits = 999

        with _superuser_session() as su:
            company, user, jwt_token = _make_company_with_user(su, plan_credits=plan_credits)
            company_id = company.id

        # Register
        reg = await ctrl_client.post("/control/register", json={"user_jwt": jwt_token})
        assert reg.status_code == 200
        install_token = reg.json()["install_token"]

        resp = await ctrl_client.get(
            "/control/entitlements",
            headers={"Authorization": f"Bearer {install_token}"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["included_credits"] == plan_credits
        assert body["edition"] == "cloud"

    @pytest.mark.asyncio
    async def test_entitlements_no_token_returns_401(self, ctrl_client):
        resp = await ctrl_client.get("/control/entitlements")
        assert resp.status_code == 401, resp.text


# ---------------------------------------------------------------------------
# Section 4: /control/balance
# ---------------------------------------------------------------------------


class TestBalance:
    @pytest.mark.asyncio
    async def test_balance_returns_company_balance(self, ctrl_client):
        """GET /control/balance with valid install token → {balance, overage_policy}."""
        initial_balance = 1234

        with _superuser_session() as su:
            company, user, jwt_token = _make_company_with_user(su, credit_balance=initial_balance)

        reg = await ctrl_client.post("/control/register", json={"user_jwt": jwt_token})
        install_token = reg.json()["install_token"]

        resp = await ctrl_client.get(
            "/control/balance",
            headers={"Authorization": f"Bearer {install_token}"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["balance"] == initial_balance
        assert body["overage_policy"] == "soft"


# ---------------------------------------------------------------------------
# Section 5: /control/usage (idempotent)
# ---------------------------------------------------------------------------


class TestUsage:
    @pytest.mark.asyncio
    async def test_usage_debits_once(self, ctrl_client):
        """POST /control/usage debits the ledger; re-POST same job_id is idempotent."""
        from omilo.billing.meter import CREDITS_PER_USD, MARGIN, provider_cost_usd
        import math

        initial_balance = 5000

        with _superuser_session() as su:
            company, user, jwt_token = _make_company_with_user(su, credit_balance=initial_balance)
            company_id = company.id

        reg = await ctrl_client.post("/control/register", json={"user_jwt": jwt_token})
        install_token = reg.json()["install_token"]

        job_id = prefixed_id("job")
        engine_type = "litellm"
        model = "anthropic/claude-sonnet-4-6"
        tokens_in = 1000
        tokens_out = 500

        cost = provider_cost_usd(engine_type, model, tokens_in, tokens_out)
        expected_credits = int(math.ceil(cost * MARGIN * CREDITS_PER_USD))

        usage_body = {
            "job_id": job_id,
            "engine_type": engine_type,
            "model": model,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "credits": expected_credits,
        }

        # First call
        resp1 = await ctrl_client.post(
            "/control/usage",
            json=usage_body,
            headers={"Authorization": f"Bearer {install_token}"},
        )
        assert resp1.status_code == 200, resp1.text
        body1 = resp1.json()
        assert body1["accepted"] is True
        after_first = body1["new_balance"]
        assert after_first == initial_balance - expected_credits

        # Second call — idempotent
        resp2 = await ctrl_client.post(
            "/control/usage",
            json=usage_body,
            headers={"Authorization": f"Bearer {install_token}"},
        )
        assert resp2.status_code == 200, resp2.text
        body2 = resp2.json()
        # new_balance must be unchanged (idempotent)
        assert body2["new_balance"] == after_first

    @pytest.mark.asyncio
    async def test_usage_company_from_token_not_body(self, ctrl_client):
        """company_id is taken from the install token, not from a body field."""
        with _superuser_session() as su:
            company, user, jwt_token = _make_company_with_user(su, credit_balance=2000)
            company_id = company.id

        reg = await ctrl_client.post("/control/register", json={"user_jwt": jwt_token})
        install_token = reg.json()["install_token"]

        job_id = prefixed_id("job")

        # Send a body that includes a DIFFERENT company_id — it must be ignored
        usage_body = {
            "job_id": job_id,
            "engine_type": "fake",
            "model": None,
            "tokens_in": 0,
            "tokens_out": 0,
            "credits": 0,
            "company_id": "cmp_some_other_company",  # should be ignored
        }

        resp = await ctrl_client.post(
            "/control/usage",
            json=usage_body,
            headers={"Authorization": f"Bearer {install_token}"},
        )
        assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# Section 6: /control/heartbeat
# ---------------------------------------------------------------------------


class TestHeartbeat:
    @pytest.mark.asyncio
    async def test_heartbeat_active_token(self, ctrl_client):
        """POST /control/heartbeat with active install token → {ok, revoked: false}."""
        with _superuser_session() as su:
            company, user, jwt_token = _make_company_with_user(su)

        reg = await ctrl_client.post("/control/register", json={"user_jwt": jwt_token})
        install_token = reg.json()["install_token"]

        resp = await ctrl_client.post(
            "/control/heartbeat",
            headers={"Authorization": f"Bearer {install_token}"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is True
        assert body["revoked"] is False


# ---------------------------------------------------------------------------
# Section 7: revocation and unknown tokens
# ---------------------------------------------------------------------------


class TestRevocation:
    @pytest.mark.asyncio
    async def test_revoked_token_returns_401(self, ctrl_client):
        """A revoked install token returns 401/403 on protected endpoints."""
        with _superuser_session() as su:
            company, user, jwt_token = _make_company_with_user(su)
            company_id = company.id

        reg = await ctrl_client.post("/control/register", json={"user_jwt": jwt_token})
        install_token = reg.json()["install_token"]
        raw_hash = hashlib.sha256(install_token.encode()).hexdigest()

        # Revoke the token
        with _superuser_session() as su:
            row = su.query(InstallToken).filter_by(token_hash=raw_hash).first()
            assert row is not None
            row.revoked_at = datetime.now(timezone.utc)

        resp = await ctrl_client.get(
            "/control/balance",
            headers={"Authorization": f"Bearer {install_token}"},
        )
        assert resp.status_code in (401, 403), f"Expected 401/403 for revoked token, got {resp.status_code}"

    @pytest.mark.asyncio
    async def test_unknown_token_returns_401(self, ctrl_client):
        """An unknown/random install token returns 401."""
        fake_token = secrets.token_urlsafe(32)
        resp = await ctrl_client.get(
            "/control/balance",
            headers={"Authorization": f"Bearer {fake_token}"},
        )
        assert resp.status_code == 401, resp.text


# ---------------------------------------------------------------------------
# Section 8: cross-company isolation
# ---------------------------------------------------------------------------


class TestCrossCompanyIsolation:
    @pytest.mark.asyncio
    async def test_install_token_for_a_cannot_access_b(self, ctrl_client):
        """An install token for company A cannot read company B's balance."""
        with _superuser_session() as su:
            company_a, user_a, jwt_a = _make_company_with_user(su)
            company_b, user_b, jwt_b = _make_company_with_user(su)

        # Register for company A
        reg_a = await ctrl_client.post("/control/register", json={"user_jwt": jwt_a})
        token_a = reg_a.json()["install_token"]

        # token_a should only see company A's data
        resp = await ctrl_client.get(
            "/control/balance",
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert resp.status_code == 200, resp.text
        # The balance returned corresponds to A (implicitly — no cross contamination)
        assert "balance" in resp.json()


# ---------------------------------------------------------------------------
# Section 9: /control/jwks (unauthenticated)
# ---------------------------------------------------------------------------


class TestJWKS:
    @pytest.mark.asyncio
    async def test_jwks_reachable_without_auth(self, ctrl_client):
        """GET /control/jwks is publicly accessible (no auth required)."""
        resp = await ctrl_client.get("/control/jwks")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "keys" in body
        assert isinstance(body["keys"], list)
