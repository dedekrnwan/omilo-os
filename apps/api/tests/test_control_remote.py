"""TDD — P6 Task 3: RemoteControlPlane — JWKS verify + cached entitlements/balance + usage outbox.

Tests cover:
1. JWKS / verify_token:
   - token signed by test private key → verified via JwksVerifier (fetches /control/jwks)
   - OFFLINE: after initial fetch, transport errors do NOT break verify (JWKS is cached)
   - token signed by a DIFFERENT key → PyJWTError
2. check_balance:
   - fake transport returns {balance, overage_policy} → BalanceState
   - second call within TTL uses cache (transport NOT called again — assert call count)
   - transport errors AND no cache → ControlPlaneUnreachable
   - transport errors WITH a cached value → returns cached value (no Unreachable)
3. get_entitlements:
   - fake transport returns plan fields → Entitlements
   - cached within TTL
4. report_usage:
   - success → UsageResult
   - transport error → UsageEvent enqueued to outbox + ControlPlaneUnreachable raised
   - flush_outbox() re-posts the queued event; dedup by (company_id, job_id)
5. register_install:
   - fake transport → InstallTokenInfo
6. heartbeat:
   - fake transport → True
   - fake transport returns revoked signal → False (or ControlPlaneUnreachable)
"""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import MagicMock

import httpx
import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from omilo.control import (
    BalanceState,
    ControlPlaneUnreachable,
    Entitlements,
    InstallTokenInfo,
    UsageEvent,
    UsageResult,
)
from omilo.control.jwks import JwksVerifier
from omilo.control.outbox import UsageOutbox
from omilo.control.remote import RemoteControlPlane


# ---------------------------------------------------------------------------
# Helpers — keypair generation + fake JWKS building
# ---------------------------------------------------------------------------


def _gen_rsa_keypair():
    """Return (private_key, public_key) RSA objects."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


def _private_pem(private_key) -> str:
    return private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()


def _public_pem(public_key) -> str:
    return public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()


def _make_jwks(public_key, kid: str = "test-kid") -> dict:
    """Build a JWKS dict from an RSA public key (n/e encoding via PyJWT)."""
    import base64

    numbers = public_key.public_numbers()

    def _b64url_uint(n: int) -> str:
        byte_len = (n.bit_length() + 7) // 8
        raw = n.to_bytes(byte_len, "big")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    return {
        "keys": [
            {
                "kty": "RSA",
                "alg": "RS256",
                "use": "sig",
                "kid": kid,
                "n": _b64url_uint(numbers.n),
                "e": _b64url_uint(numbers.e),
            }
        ]
    }


def _make_token(private_key, user_id: str = "usr_test", company_id: str = "cmp_test",
                role: str = "owner", kid: str = "test-kid", ttl_s: int = 3600) -> str:
    """Sign an RS256 JWT with the given private key."""
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": user_id,
        "cmp": company_id,
        "role": role,
        "exp": now + timedelta(seconds=ttl_s),
        "iat": now,
    }
    private_pem = _private_pem(private_key)
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    key = load_pem_private_key(private_pem.encode(), password=None)
    return pyjwt.encode(payload, key, algorithm="RS256", headers={"kid": kid})


# ---------------------------------------------------------------------------
# Fake httpx transport
# ---------------------------------------------------------------------------


class _FakeTransport(httpx.BaseTransport):
    """A fake httpx transport that maps (method, path) to a response dict.

    ``responses``: dict mapping "METHOD /path" → {"status": 200, "json": {...}}
    ``call_counts``: dict tracking how many times each "METHOD /path" was called.

    Raises httpx.ConnectError if the key is not in responses or if the
    transport is ``disabled``.
    """

    def __init__(self, responses: dict[str, dict]):
        self.responses = responses
        self.call_counts: dict[str, int] = {}
        self.disabled = False

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        if self.disabled:
            raise httpx.ConnectError("Transport disabled (offline test)")

        path = request.url.path
        key = f"{request.method} {path}"
        count = self.call_counts.get(key, 0)
        self.call_counts[key] = count + 1

        if key not in self.responses:
            raise httpx.ConnectError(f"No fake response for {key!r}")

        spec = self.responses[key]
        status = spec.get("status", 200)
        body = spec.get("json", {})
        return httpx.Response(status, json=body)


def _make_remote(responses: dict, install_token: str = "tok_test") -> tuple[RemoteControlPlane, _FakeTransport]:
    """Build a RemoteControlPlane with a fake transport. Returns (remote, transport)."""
    transport = _FakeTransport(responses)
    client = httpx.Client(transport=transport, base_url="http://fake-cloud")
    remote = RemoteControlPlane(
        control_plane_url="http://fake-cloud",
        install_token=install_token,
        http=client,
    )
    return remote, transport


# ---------------------------------------------------------------------------
# Section 1: JwksVerifier — fetch, cache, local verify (offline)
# ---------------------------------------------------------------------------


class TestJwksVerifier:
    """JwksVerifier: fetch+cache+offline RS256 verification."""

    def test_verify_valid_token(self):
        """JwksVerifier.verify returns claims for a properly signed token."""
        priv, pub = _gen_rsa_keypair()
        jwks_data = _make_jwks(pub)
        token = _make_token(priv)

        transport = _FakeTransport({"GET /control/jwks": {"json": jwks_data}})
        client = httpx.Client(transport=transport, base_url="http://fake-cloud")
        verifier = JwksVerifier(control_plane_url="http://fake-cloud", http=client)

        claims = verifier.verify(token)
        assert claims["sub"] == "usr_test"
        assert claims["cmp"] == "cmp_test"

    def test_verify_offline_after_cache(self):
        """After a successful JWKS fetch, verify works with transport disabled."""
        priv, pub = _gen_rsa_keypair()
        jwks_data = _make_jwks(pub)
        token = _make_token(priv)

        transport = _FakeTransport({"GET /control/jwks": {"json": jwks_data}})
        client = httpx.Client(transport=transport, base_url="http://fake-cloud")
        verifier = JwksVerifier(control_plane_url="http://fake-cloud", http=client)

        # First verify fetches JWKS
        verifier.verify(token)

        # Now disable transport — subsequent verifies must work offline (JWKS cached)
        transport.disabled = True

        # Create a NEW token (same private key → same KID)
        token2 = _make_token(priv, user_id="usr_offline")
        claims = verifier.verify(token2)
        assert claims["sub"] == "usr_offline"

    def test_wrong_key_raises(self):
        """Token signed with a different private key → PyJWTError."""
        priv_a, pub_a = _gen_rsa_keypair()
        priv_b, _pub_b = _gen_rsa_keypair()

        jwks_data = _make_jwks(pub_a)  # only key A is in JWKS
        # token signed with key B (unknown / wrong key)
        token_b = _make_token(priv_b, kid="test-kid")  # same KID but different key

        transport = _FakeTransport({"GET /control/jwks": {"json": jwks_data}})
        client = httpx.Client(transport=transport, base_url="http://fake-cloud")
        verifier = JwksVerifier(control_plane_url="http://fake-cloud", http=client)

        with pytest.raises(pyjwt.PyJWTError):
            verifier.verify(token_b)

    def test_expired_token_raises(self):
        """Expired token → PyJWTError (ExpiredSignatureError)."""
        priv, pub = _gen_rsa_keypair()
        jwks_data = _make_jwks(pub)
        token = _make_token(priv, ttl_s=-1)  # already expired

        transport = _FakeTransport({"GET /control/jwks": {"json": jwks_data}})
        client = httpx.Client(transport=transport, base_url="http://fake-cloud")
        verifier = JwksVerifier(control_plane_url="http://fake-cloud", http=client)

        with pytest.raises(pyjwt.PyJWTError):
            verifier.verify(token)

    def test_unknown_kid_refetches_once(self):
        """Unknown KID triggers one JWKS refetch; if still unknown → PyJWTError."""
        priv_a, pub_a = _gen_rsa_keypair()
        priv_b, pub_b = _gen_rsa_keypair()

        # Initial JWKS has key A with KID "kid-a"
        jwks_a = _make_jwks(pub_a, kid="kid-a")
        # After refetch, JWKS has key B with KID "kid-b"
        jwks_b = _make_jwks(pub_b, kid="kid-b")
        token_b = _make_token(priv_b, kid="kid-b")  # needs kid-b

        responses = {"GET /control/jwks": {"json": jwks_a}}
        transport = _FakeTransport(responses)
        client = httpx.Client(transport=transport, base_url="http://fake-cloud")
        verifier = JwksVerifier(control_plane_url="http://fake-cloud", http=client)

        # Prime the cache with jwks_a
        verifier.verify(_make_token(priv_a, kid="kid-a"))

        # Now switch the remote to serve jwks_b (rotation)
        transport.responses["GET /control/jwks"] = {"json": jwks_b}
        transport.call_counts.clear()

        # token_b uses kid-b — verifier should refetch and succeed
        claims = verifier.verify(token_b)
        assert claims["sub"] == "usr_test"
        assert transport.call_counts.get("GET /control/jwks", 0) == 1  # exactly one refetch


# ---------------------------------------------------------------------------
# Section 2: RemoteControlPlane.verify_token
# ---------------------------------------------------------------------------


class TestRemoteVerifyToken:
    """RemoteControlPlane.verify_token maps JWKS claims to Identity."""

    def _setup(self, priv, pub):
        jwks_data = _make_jwks(pub)
        responses = {"GET /control/jwks": {"json": jwks_data}}
        remote, transport = _make_remote(responses)
        return remote, transport

    def test_verify_token_returns_identity(self):
        priv, pub = _gen_rsa_keypair()
        remote, _ = self._setup(priv, pub)
        token = _make_token(priv, user_id="usr_abc", company_id="cmp_xyz", role="admin")

        identity = remote.verify_token(token)
        assert identity.user_id == "usr_abc"
        assert identity.company_id == "cmp_xyz"
        assert identity.role == "admin"

    def test_verify_token_offline_after_cache(self):
        priv, pub = _gen_rsa_keypair()
        remote, transport = self._setup(priv, pub)

        # Prime the cache
        token = _make_token(priv)
        remote.verify_token(token)

        # Disable transport
        transport.disabled = True

        # Should still work offline
        token2 = _make_token(priv, user_id="usr_offline2")
        identity = remote.verify_token(token2)
        assert identity.user_id == "usr_offline2"

    def test_verify_token_wrong_key_raises(self):
        priv_a, pub_a = _gen_rsa_keypair()
        priv_b, _pub_b = _gen_rsa_keypair()

        jwks_data = _make_jwks(pub_a)
        responses = {"GET /control/jwks": {"json": jwks_data}}
        remote, _ = _make_remote(responses)

        bad_token = _make_token(priv_b, kid="test-kid")
        with pytest.raises(pyjwt.PyJWTError):
            remote.verify_token(bad_token)


# ---------------------------------------------------------------------------
# Section 3: check_balance — HTTP, TTL cache, ControlPlaneUnreachable
# ---------------------------------------------------------------------------


class TestCheckBalance:
    """check_balance: HTTP GET /control/balance, TTL cache, ControlPlaneUnreachable."""

    def _balance_responses(self, balance: int = 1000, overage: str = "soft") -> dict:
        return {
            "GET /control/balance": {
                "json": {"balance": balance, "overage_policy": overage}
            }
        }

    def test_check_balance_returns_state(self):
        """check_balance returns BalanceState from the fake transport."""
        remote, _ = _make_remote(self._balance_responses(balance=500))
        state = remote.check_balance("cmp_test")
        assert isinstance(state, BalanceState)
        assert state.balance == 500
        assert state.overage_policy == "soft"

    def test_check_balance_cached_within_ttl(self):
        """Second call within TTL uses cache — transport NOT called again."""
        remote, transport = _make_remote(self._balance_responses(balance=750))

        # First call
        remote.check_balance("cmp_test")
        count_after_first = transport.call_counts.get("GET /control/balance", 0)
        assert count_after_first == 1

        # Second call — should use cache
        state2 = remote.check_balance("cmp_test")
        count_after_second = transport.call_counts.get("GET /control/balance", 0)
        assert count_after_second == 1  # still 1; no extra HTTP call
        assert state2.balance == 750

    def test_check_balance_unreachable_without_cache(self):
        """Transport error + no cache → ControlPlaneUnreachable."""
        transport = _FakeTransport({})  # no /balance route
        transport.disabled = True
        client = httpx.Client(transport=transport, base_url="http://fake-cloud")
        remote = RemoteControlPlane(
            control_plane_url="http://fake-cloud",
            install_token="tok_test",
            http=client,
        )
        with pytest.raises(ControlPlaneUnreachable):
            remote.check_balance("cmp_no_cache")

    def test_check_balance_returns_cache_on_error(self):
        """Transport errors during a cached TTL window → return cached value."""
        remote, transport = _make_remote(self._balance_responses(balance=300))

        # Prime the cache
        state = remote.check_balance("cmp_cached")
        assert state.balance == 300

        # Now break the transport
        transport.disabled = True

        # Should still return cached value (no ControlPlaneUnreachable)
        state2 = remote.check_balance("cmp_cached")
        assert state2.balance == 300


# ---------------------------------------------------------------------------
# Section 4: get_entitlements — HTTP GET, TTL cache
# ---------------------------------------------------------------------------


class TestGetEntitlements:
    """get_entitlements: HTTP GET /control/entitlements, TTL cache."""

    def _ent_responses(self) -> dict:
        return {
            "GET /control/entitlements": {
                "json": {
                    "edition": "pro",
                    "plan_id": "pln_abc",
                    "included_credits": 1000,
                    "overage_policy": "soft",
                    "features": {"flows": True},
                }
            }
        }

    def test_get_entitlements_returns_entitlements(self):
        remote, _ = _make_remote(self._ent_responses())
        ents = remote.get_entitlements("cmp_test")
        assert isinstance(ents, Entitlements)
        assert ents.edition == "pro"
        assert ents.plan_id == "pln_abc"
        assert ents.included_credits == 1000
        assert ents.features == {"flows": True}

    def test_get_entitlements_cached_within_ttl(self):
        remote, transport = _make_remote(self._ent_responses())

        remote.get_entitlements("cmp_test")
        count_after_first = transport.call_counts.get("GET /control/entitlements", 0)

        remote.get_entitlements("cmp_test")
        count_after_second = transport.call_counts.get("GET /control/entitlements", 0)

        assert count_after_first == 1
        assert count_after_second == 1  # still 1 — from cache

    def test_get_entitlements_unreachable_without_cache(self):
        """Transport error + no cache → ControlPlaneUnreachable."""
        transport = _FakeTransport({})
        transport.disabled = True
        client = httpx.Client(transport=transport, base_url="http://fake-cloud")
        remote = RemoteControlPlane(
            control_plane_url="http://fake-cloud",
            install_token="tok_test",
            http=client,
        )
        with pytest.raises(ControlPlaneUnreachable):
            remote.get_entitlements("cmp_none")


# ---------------------------------------------------------------------------
# Section 5: report_usage — success, outbox on error, flush_outbox idempotent
# ---------------------------------------------------------------------------


class TestReportUsage:
    """report_usage: success → UsageResult; transport error → outbox + Unreachable."""

    def _usage_event(self, company_id: str = "cmp_test", job_id: str = "job_001") -> UsageEvent:
        return UsageEvent(
            company_id=company_id,
            job_id=job_id,
            engine_type="litellm",
            model="anthropic/claude-sonnet-4-6",
            tokens_in=1000,
            tokens_out=500,
            credits=10,
        )

    def _usage_responses(self, balance: int = 990) -> dict:
        return {
            "POST /control/usage": {
                "json": {"accepted": True, "new_balance": balance}
            }
        }

    def test_report_usage_success(self):
        """Successful POST → UsageResult."""
        remote, _ = _make_remote(self._usage_responses(balance=990))
        ev = self._usage_event()
        result = remote.report_usage(ev)
        assert isinstance(result, UsageResult)
        assert result.accepted is True
        assert result.new_balance == 990

    def test_report_usage_transport_error_enqueues_outbox(self):
        """Transport error → UsageEvent in outbox + ControlPlaneUnreachable raised."""
        transport = _FakeTransport({})
        transport.disabled = True
        client = httpx.Client(transport=transport, base_url="http://fake-cloud")
        outbox = UsageOutbox()
        remote = RemoteControlPlane(
            control_plane_url="http://fake-cloud",
            install_token="tok_test",
            http=client,
            outbox=outbox,
        )
        ev = self._usage_event()

        with pytest.raises(ControlPlaneUnreachable):
            remote.report_usage(ev)

        # The event must be in the outbox
        assert outbox.size() == 1

    def test_flush_outbox_reposts_and_clears(self):
        """flush_outbox re-posts queued events; on success the outbox empties."""
        # Phase 1: simulate transport error → enqueue
        transport = _FakeTransport({})
        transport.disabled = True
        client = httpx.Client(transport=transport, base_url="http://fake-cloud")
        outbox = UsageOutbox()
        remote = RemoteControlPlane(
            control_plane_url="http://fake-cloud",
            install_token="tok_test",
            http=client,
            outbox=outbox,
        )
        ev = self._usage_event()
        with pytest.raises(ControlPlaneUnreachable):
            remote.report_usage(ev)

        assert outbox.size() == 1

        # Phase 2: restore transport → flush_outbox should re-post + clear
        transport.disabled = False
        transport.responses["POST /control/usage"] = {
            "json": {"accepted": True, "new_balance": 980}
        }

        remote.flush_outbox()
        assert outbox.size() == 0

    def test_flush_outbox_idempotent_dedup(self):
        """Enqueuing the same (company_id, job_id) twice → only one outbox entry."""
        outbox = UsageOutbox()
        ev = self._usage_event(job_id="job_dup")
        outbox.enqueue(ev)
        outbox.enqueue(ev)  # duplicate — should not add again
        assert outbox.size() == 1

    def test_flush_outbox_partial_failure_keeps_remaining(self):
        """If the transport fails during flush, the failed event stays in the outbox."""
        outbox = UsageOutbox()
        ev = self._usage_event()
        outbox.enqueue(ev)

        calls = []

        def failing_report(e: UsageEvent) -> UsageResult:
            calls.append(e)
            raise httpx.ConnectError("still down")

        outbox.flush(failing_report)
        assert outbox.size() == 1  # still in outbox


# ---------------------------------------------------------------------------
# Section 6: register_install
# ---------------------------------------------------------------------------


class TestRegisterInstall:
    """register_install → InstallTokenInfo from /control/register."""

    def test_register_install(self):
        responses = {
            "POST /control/register": {
                "json": {"install_token": "raw_tok_xyz", "company_id": "cmp_abc"}
            }
        }
        remote, _ = _make_remote(responses)
        info = remote.register_install("some_user_jwt")
        assert isinstance(info, InstallTokenInfo)
        assert info.install_token == "raw_tok_xyz"
        assert info.company_id == "cmp_abc"

    def test_register_install_transport_error_raises(self):
        transport = _FakeTransport({})
        transport.disabled = True
        client = httpx.Client(transport=transport, base_url="http://fake-cloud")
        remote = RemoteControlPlane(
            control_plane_url="http://fake-cloud",
            install_token="tok_test",
            http=client,
        )
        with pytest.raises(ControlPlaneUnreachable):
            remote.register_install("user_jwt")


# ---------------------------------------------------------------------------
# Section 7: heartbeat
# ---------------------------------------------------------------------------


class TestHeartbeat:
    """heartbeat → bool (True for active, False/raise for revoked)."""

    def test_heartbeat_active(self):
        responses = {
            "POST /control/heartbeat": {"json": {"ok": True, "revoked": False}}
        }
        remote, _ = _make_remote(responses)
        assert remote.heartbeat("install_tok") is True

    def test_heartbeat_revoked(self):
        """Heartbeat that signals revoked should return False."""
        responses = {
            "POST /control/heartbeat": {"status": 403, "json": {"detail": "revoked"}}
        }
        remote, _ = _make_remote(responses)
        result = remote.heartbeat("install_tok")
        assert result is False

    def test_heartbeat_transport_error_raises(self):
        transport = _FakeTransport({})
        transport.disabled = True
        client = httpx.Client(transport=transport, base_url="http://fake-cloud")
        remote = RemoteControlPlane(
            control_plane_url="http://fake-cloud",
            install_token="tok_test",
            http=client,
        )
        with pytest.raises(ControlPlaneUnreachable):
            remote.heartbeat("install_tok")


# ---------------------------------------------------------------------------
# Section 8: UsageOutbox unit tests
# ---------------------------------------------------------------------------


class TestUsageOutbox:
    """UsageOutbox: enqueue, flush, dedup, partial failure."""

    def _ev(self, company: str = "cmp_1", job: str = "job_1") -> UsageEvent:
        return UsageEvent(
            company_id=company, job_id=job,
            engine_type="litellm", model=None,
            tokens_in=0, tokens_out=0, credits=0,
        )

    def test_enqueue_and_size(self):
        ob = UsageOutbox()
        assert ob.size() == 0
        ob.enqueue(self._ev())
        assert ob.size() == 1

    def test_dedup_by_company_and_job(self):
        ob = UsageOutbox()
        ob.enqueue(self._ev(job="job_a"))
        ob.enqueue(self._ev(job="job_a"))  # same (company, job) → dedup
        ob.enqueue(self._ev(job="job_b"))  # different job → added
        assert ob.size() == 2

    def test_flush_success_clears_queue(self):
        ob = UsageOutbox()
        ob.enqueue(self._ev(job="j1"))
        ob.enqueue(self._ev(job="j2"))

        results = []

        def report(ev: UsageEvent) -> UsageResult:
            results.append(ev.job_id)
            return UsageResult(accepted=True, new_balance=100)

        ob.flush(report)
        assert ob.size() == 0
        assert set(results) == {"j1", "j2"}

    def test_flush_stops_on_first_failure(self):
        """flush() stops processing on the first error; remaining events stay queued."""
        ob = UsageOutbox()
        ob.enqueue(self._ev(job="j1"))
        ob.enqueue(self._ev(job="j2"))

        call_count = [0]

        def failing_report(ev: UsageEvent) -> UsageResult:
            call_count[0] += 1
            raise Exception("network error")

        ob.flush(failing_report)
        # At least one remained, exactly one call was made before stop
        assert ob.size() >= 1
        assert call_count[0] == 1

    def test_flush_idempotent_dedup(self):
        """flush with a report that enqueues the same event again → still deduped."""
        ob = UsageOutbox()
        ev = self._ev(job="j_idem")
        ob.enqueue(ev)

        def success_report(e: UsageEvent) -> UsageResult:
            return UsageResult(accepted=True, new_balance=0)

        ob.flush(success_report)
        # Re-enqueue after flush is OK (new job would be added)
        ob.enqueue(ev)
        assert ob.size() == 1  # re-enqueued once

    def test_enqueue_same_event_twice_is_noop(self):
        """Enqueue the same (company_id, job_id) twice → size stays 1."""
        ob = UsageOutbox()
        ev1 = self._ev(company="cmp_x", job="j_x")
        ev2 = self._ev(company="cmp_x", job="j_x")
        ob.enqueue(ev1)
        ob.enqueue(ev2)
        assert ob.size() == 1
