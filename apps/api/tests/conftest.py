import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from omilo.main import create_app
from tests.utils import run_alembic


@pytest.fixture(scope="session", autouse=True)
def ensure_schema():
    """Session-scoped fixture: guarantee migrations are at head before any test.

    Runs ``alembic upgrade head`` at session start.  The real test-ordering
    root cause is fixed in test_models_migration.py: its ``migrated_db``
    teardown now re-upgrades after downgrading, so subsequent modules always
    find a usable schema regardless of module order.
    """
    run_alembic("upgrade", "head")
    yield
    # No teardown — leave schema in place for manual inspection.


@pytest_asyncio.fixture
async def async_client():
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client


@pytest.fixture(autouse=True)
def _no_real_ai_keys(monkeypatch):
    """Never reach a real AI from the test suite, whatever the developer's shell exports."""
    for var in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OMILO_POOL_ANTHROPIC_API_KEY", "OMILO_ANTHROPIC_BASE_URL",
                "OMILO_OPENAI_BASE_URL"):
        monkeypatch.delenv(var, raising=False)
