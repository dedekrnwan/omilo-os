import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from omilo.main import create_app


@pytest_asyncio.fixture
async def async_client():
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client
