"""Tests for the email-based auth flows (control-plane features).

Covers: email verification, magic-code sign-in, password reset, two-step
verification, and invite accept.  A CapturingEmailSender is installed so the
emailed codes/tokens are read from the outbox instead of hitting SMTP.
"""
import re
import uuid

import pytest

from omilo import mailer
from omilo.mailer import CapturingEmailSender


@pytest.fixture
def outbox():
    """Install a capturing email sender for the duration of a test."""
    sender = CapturingEmailSender()
    mailer.set_email_sender(sender)
    yield sender
    mailer.set_email_sender(None)


def _code_from(text: str) -> str:
    m = re.search(r"\b(\d{6})\b", text)
    assert m, f"no 6-digit code in email:\n{text}"
    return m.group(1)


def _token_from_link(text: str, param: str) -> str:
    m = re.search(rf"[?&]{param}=([A-Za-z0-9_-]+)", text)
    assert m, f"no {param} token in email:\n{text}"
    return m.group(1)


async def _sign_up(client, email: str, password: str = "hunter2!XY", name: str = "T U"):
    resp = await client.post(
        "/v1/auth/sign-up", json={"email": email, "name": name, "password": password}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── email verification ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_verify_email_request_and_confirm(async_client, outbox):
    email = f"verify_{uuid.uuid4().hex[:8]}@test.example"
    await _sign_up(async_client, email)

    r = await async_client.post("/v1/auth/verify-email/request", json={"email": email})
    assert r.status_code == 200, r.text
    msg = outbox.last_to(email)
    assert msg is not None, "no verification email captured"
    code = _code_from(msg.text)

    ok = await async_client.post(
        "/v1/auth/verify-email/confirm", json={"email": email, "code": code}
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["verified"] is True


@pytest.mark.asyncio
async def test_verify_email_wrong_code_400(async_client, outbox):
    email = f"verifybad_{uuid.uuid4().hex[:8]}@test.example"
    await _sign_up(async_client, email)
    await async_client.post("/v1/auth/verify-email/request", json={"email": email})

    bad = await async_client.post(
        "/v1/auth/verify-email/confirm", json={"email": email, "code": "000000"}
    )
    assert bad.status_code == 400, bad.text


@pytest.mark.asyncio
async def test_verify_email_request_unknown_is_200_no_email(async_client, outbox):
    """Unknown email still returns 200 but sends nothing (no enumeration)."""
    r = await async_client.post(
        "/v1/auth/verify-email/request", json={"email": "nobody@test.example"}
    )
    assert r.status_code == 200
    assert outbox.last_to("nobody@test.example") is None


# ── magic-code sign-in ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_code_sign_in_round_trip(async_client, outbox):
    email = f"code_{uuid.uuid4().hex[:8]}@test.example"
    await _sign_up(async_client, email)

    r = await async_client.post("/v1/auth/code/request", json={"email": email})
    assert r.status_code == 200
    code = _code_from(outbox.last_to(email).text)

    v = await async_client.post(
        "/v1/auth/code/verify", json={"email": email, "code": code}
    )
    assert v.status_code == 200, v.text
    body = v.json()
    assert body["user"]["email"] == email
    assert body["session"]["access"]
    assert len(body["companies"]) >= 1


@pytest.mark.asyncio
async def test_code_verify_wrong_code_400(async_client, outbox):
    email = f"codebad_{uuid.uuid4().hex[:8]}@test.example"
    await _sign_up(async_client, email)
    await async_client.post("/v1/auth/code/request", json={"email": email})
    v = await async_client.post(
        "/v1/auth/code/verify", json={"email": email, "code": "123456"}
    )
    assert v.status_code == 400, v.text


# ── password reset ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_password_reset_round_trip(async_client, outbox):
    email = f"reset_{uuid.uuid4().hex[:8]}@test.example"
    await _sign_up(async_client, email, password="oldPass!99")

    r = await async_client.post("/v1/auth/password/forgot", json={"email": email})
    assert r.status_code == 200
    token = _token_from_link(outbox.last_to(email).text, "token")

    new_pw = "brandNewP4ss!"
    done = await async_client.post(
        "/v1/auth/password/reset", json={"token": token, "password": new_pw}
    )
    assert done.status_code == 200, done.text
    assert done.json()["session"]["access"]

    # old password no longer works; new one does
    old = await async_client.post(
        "/v1/auth/sign-in", json={"email": email, "password": "oldPass!99"}
    )
    assert old.status_code == 401
    good = await async_client.post(
        "/v1/auth/sign-in", json={"email": email, "password": new_pw}
    )
    assert good.status_code == 200, good.text


@pytest.mark.asyncio
async def test_password_reset_token_single_use(async_client, outbox):
    email = f"reset1_{uuid.uuid4().hex[:8]}@test.example"
    await _sign_up(async_client, email)
    await async_client.post("/v1/auth/password/forgot", json={"email": email})
    token = _token_from_link(outbox.last_to(email).text, "token")

    first = await async_client.post(
        "/v1/auth/password/reset", json={"token": token, "password": "firstNewP4ss!"}
    )
    assert first.status_code == 200
    second = await async_client.post(
        "/v1/auth/password/reset", json={"token": token, "password": "secondNewP4ss!"}
    )
    assert second.status_code == 400, "reset token must be single-use"


# ── two-step verification ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_two_factor_challenge_then_verify(async_client, outbox):
    email = f"2fa_{uuid.uuid4().hex[:8]}@test.example"
    pw = "twofaP4ss!"
    signup = await _sign_up(async_client, email, password=pw)
    token = signup["session"]["access"]

    # enable 2FA
    en = await async_client.post(
        "/v1/auth/two-factor/enable", headers={"Authorization": f"Bearer {token}"}
    )
    assert en.status_code == 200, en.text

    # sign-in now returns a challenge, not a session
    chal = await async_client.post(
        "/v1/auth/sign-in", json={"email": email, "password": pw}
    )
    assert chal.status_code == 200, chal.text
    body = chal.json()
    assert body.get("two_factor_required") is True
    assert "session" not in body

    code = _code_from(outbox.last_to(email).text)
    done = await async_client.post(
        "/v1/auth/two-factor/verify", json={"email": email, "code": code}
    )
    assert done.status_code == 200, done.text
    assert done.json()["session"]["access"]


# ── invites ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_invite_create_preview_accept_new_user(async_client, outbox):
    owner_email = f"owner_{uuid.uuid4().hex[:8]}@test.example"
    signup = await _sign_up(async_client, owner_email, name="Owner")
    token = signup["session"]["access"]

    invitee = f"invitee_{uuid.uuid4().hex[:8]}@test.example"
    created = await async_client.post(
        "/v1/auth/invites",
        headers={"Authorization": f"Bearer {token}"},
        json={"email": invitee, "role": "admin", "channels": "General"},
    )
    assert created.status_code == 201, created.text

    invite_token = _token_from_link(outbox.last_to(invitee).text, "token")

    preview = await async_client.get(f"/v1/auth/invite?token={invite_token}")
    assert preview.status_code == 200, preview.text
    pv = preview.json()
    assert pv["email"] == invitee
    assert pv["role"] == "admin"
    assert pv["has_account"] is False
    assert pv["inviter_name"] == "Owner"

    accepted = await async_client.post(
        "/v1/auth/invite/accept",
        json={"token": invite_token, "name": "New Member", "password": "memberP4ss!"},
    )
    assert accepted.status_code == 200, accepted.text
    body = accepted.json()
    assert body["user"]["email"] == invitee
    assert body["session"]["access"]
    assert len(body["companies"]) >= 1


@pytest.mark.asyncio
async def test_invite_accept_is_single_use(async_client, outbox):
    owner_email = f"owner2_{uuid.uuid4().hex[:8]}@test.example"
    token = (await _sign_up(async_client, owner_email, name="Owner2"))["session"]["access"]
    invitee = f"invitee2_{uuid.uuid4().hex[:8]}@test.example"
    await async_client.post(
        "/v1/auth/invites",
        headers={"Authorization": f"Bearer {token}"},
        json={"email": invitee, "role": "member"},
    )
    invite_token = _token_from_link(outbox.last_to(invitee).text, "token")
    first = await async_client.post(
        "/v1/auth/invite/accept",
        json={"token": invite_token, "name": "M", "password": "memberP4ss!"},
    )
    assert first.status_code == 200
    second = await async_client.post(
        "/v1/auth/invite/accept",
        json={"token": invite_token, "name": "M", "password": "memberP4ss!"},
    )
    assert second.status_code == 400, "invite must be single-use"
