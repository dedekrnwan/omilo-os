import pytest


@pytest.mark.asyncio
async def test_health_ok(async_client):
    response = await async_client.get("/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
