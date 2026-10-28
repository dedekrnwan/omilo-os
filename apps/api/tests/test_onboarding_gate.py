"""TDD tests for P13 onboarding gate — onboarded_at column + /company/onboard endpoint.

Tests:
1. Fresh company /me → company.onboarded = False
2. POST /v1/company/onboard → sets onboarded=True, returns CompanyOut
3. POST /v1/company/onboard is idempotent (second call also 200, same result)
"""
import uuid
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from omilo.main import create_app
from tests.utils import run_alembic


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


async def _sign_up_and_token(client, *, suffix: str = "") -> str:
    """Sign up a fresh user; return the access token."""
    email = f"onb_{suffix}_{uuid.uuid4().hex[:6]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Onboard Tester", "password": "testP4ss!"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["session"]["access"]


@pytest.mark.asyncio
async def test_me_company_shows_onboarded_false_for_fresh_company():
    """Fresh company /me → company.onboarded = False."""
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _sign_up_and_token(client, suffix="me")

        me_resp = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
        assert me_resp.status_code == 200, me_resp.text
        body = me_resp.json()
        assert "onboarded" in body["company"], f"'onboarded' not in company: {body['company']}"
        assert body["company"]["onboarded"] is False


@pytest.mark.asyncio
async def test_post_onboard_sets_onboarded_true():
    """POST /v1/company/onboard → 200, company.onboarded=True in response and /me."""
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _sign_up_and_token(client, suffix="post")

        resp = await client.post(
            "/v1/company/onboard",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "onboarded" in body, f"'onboarded' not in response: {body}"
        assert body["onboarded"] is True

        # /me now also shows onboarded=True
        me = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
        assert me.json()["company"]["onboarded"] is True


@pytest.mark.asyncio
async def test_post_onboard_is_idempotent():
    """Calling POST /v1/company/onboard twice → both return 200 with onboarded=True."""
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _sign_up_and_token(client, suffix="idem")
        headers = {"Authorization": f"Bearer {token}"}

        r1 = await client.post("/v1/company/onboard", headers=headers)
        assert r1.status_code == 200, r1.text
        assert r1.json()["onboarded"] is True

        r2 = await client.post("/v1/company/onboard", headers=headers)
        assert r2.status_code == 200, r2.text
        assert r2.json()["onboarded"] is True
