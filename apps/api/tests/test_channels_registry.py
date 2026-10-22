"""Task 2: ChannelAdapter seam + registry — pure unit test, no DB/server."""
import pytest
from omilo_api.channels import registry


@pytest.fixture(autouse=True)
def _clear_registry():
    registry.reset()
    yield
    registry.reset()


def test_registry_register_and_lookup():
    from omilo_api.channels import registry, base

    class Stub:
        kind = "stub"

        def send(self, conn, target, message):
            return base.SendResult(ok=True, error=None)

    registry.register(Stub())
    assert registry.adapter_for("stub").kind == "stub"
    assert registry.adapter_for("nope") is None
