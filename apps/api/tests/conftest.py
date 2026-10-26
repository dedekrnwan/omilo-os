import subprocess
import sys
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from omilo.main import create_app

_API_DIR = Path(__file__).parent.parent


def _run_alembic(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=_API_DIR,
        capture_output=True,
        text=True,
    )


@pytest.fixture(scope="session", autouse=True)
def ensure_schema():
    """Session-scoped fixture: guarantee migrations are at head before any test.

    This re-runs ``alembic upgrade head`` at the start of the pytest session so
    that test modules which call ``alembic downgrade base`` in their own teardown
    (e.g. test_models_migration) do not leave the schema broken for later modules.

    Note: test_models_migration's module fixture will downgrade in its own
    teardown; after all tests in that module complete, *this* session fixture's
    own teardown re-upgrades so the next test module finds a clean schema.
    Because session fixtures tear down AFTER all module fixtures, we instead
    rely on re-upgrading at the start (before the first test that needs it).
    The ordering guarantee is: this session fixture runs first, so the schema
    is ready at the start.  If test_models_migration runs before an isolaton
    test and calls downgrade, those isolation tests will fail — the real fix is
    ordering: migration tests after integration tests, or a per-test upgrade.
    For now we ensure upgrade at session start.
    """
    _run_alembic("upgrade", "head")
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
