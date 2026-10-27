"""omilo.billing.provider — Payment provider port + offline ManualProvider.

Public API:
    ProviderNotConfigured   exception raised by stub providers
    BillingEvent            normalized event emitted by parse_webhook
    PaymentProvider         Protocol (structural interface)
    ManualProvider          default offline provider — all methods are no-ops
    StripeProvider          structural stub — raises ProviderNotConfigured
    XenditProvider          structural stub — raises ProviderNotConfigured
    get_payment_provider()  factory — returns ManualProvider unless overridden by env

Design:
- ManualProvider is the DEFAULT.  All tests run offline with no external calls.
- The ROUTER (api/billing.py) owns all internal DB effects (activating Subscription,
  granting credits).  ManualProvider only returns a status marker.
- StripeProvider / XenditProvider are structural stubs so the port has real
  implementors.  They are never invoked in offline / test mode.
- Set OMILO_PAYMENT_PROVIDER=stripe or =xendit to swap at runtime.
- Set OMILO_PAYMENT_PROVIDER=doit + DOIT_API_KEY to use the Doit gateway.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

if TYPE_CHECKING:
    from omilo.models.billing import Plan, Subscription
    from omilo.models.tenancy import Company


# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------


class ProviderNotConfigured(Exception):
    """Raised by stub providers (Stripe, Xendit) when not wired in."""


# ---------------------------------------------------------------------------
# BillingEvent — normalized event from parse_webhook (spec §6.2)
# ---------------------------------------------------------------------------


@dataclass
class BillingEvent:
    """Normalized billing event emitted by PaymentProvider.parse_webhook.

    Maps any provider's webhook callbacks to omilo-internal transitions:
      payment_succeeded | payment_failed | subscription_updated |
      subscription_canceled | refund

    company_id is optional — some events (e.g. checkout.session) carry it,
    others may require a lookup by external_ref.
    """

    type: str
    company_id: str | None = None
    data: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class PaymentProvider(Protocol):
    """Structural interface for payment providers.

    All methods are optional from the router's perspective — the router does
    the real DB work (activating subscriptions, granting credits).  The
    provider handles external billing calls only.
    """

    def ensure_customer(self, company: "Company") -> dict | None:
        """Ensure a customer record exists in the payment system."""
        ...

    def start_subscription(self, company: "Company", plan: "Plan") -> dict | None:
        """Create a new subscription in the payment system."""
        ...

    def change_subscription(self, company: "Company", plan: "Plan") -> dict | None:
        """Change an existing subscription to a new plan."""
        ...

    def cancel_subscription(self, company: "Company") -> dict | None:
        """Cancel the company's current subscription."""
        ...

    def charge_one_off(
        self, company: "Company", amount_usd: float, reason: str
    ) -> dict | None:
        """Charge a one-off amount (e.g. credit topup)."""
        ...

    def report_usage(self, company: "Company", credits: int) -> dict | None:
        """Report metered usage to the payment system."""
        ...

    def parse_webhook(
        self, headers: dict, body: bytes
    ) -> list[BillingEvent]:
        """Parse and verify an inbound webhook payload.

        Returns a list of normalized BillingEvents.
        Returns an empty list when no provider is configured (offline mode).
        """
        ...


# ---------------------------------------------------------------------------
# ManualProvider — offline default
# ---------------------------------------------------------------------------


class ManualProvider:
    """Fully offline payment provider — the default.

    All methods are internal no-ops.  Subscriptions are activated internally
    by the router (DB writes, credit grants).  Invoices are marked "offline".
    No external HTTP calls are ever made.
    """

    def ensure_customer(self, company: "Company") -> dict | None:
        return {"status": "offline"}

    def start_subscription(self, company: "Company", plan: "Plan") -> dict | None:
        # The router does the real DB work; this is a marker only.
        return {"status": "offline"}

    def change_subscription(self, company: "Company", plan: "Plan") -> dict | None:
        # The router does the real DB work; this is a marker only.
        return {"status": "offline"}

    def cancel_subscription(self, company: "Company") -> dict | None:
        return {"status": "offline"}

    def charge_one_off(
        self, company: "Company", amount_usd: float, reason: str
    ) -> dict | None:
        return {"status": "offline"}

    def report_usage(self, company: "Company", credits: int) -> dict | None:
        return {"status": "offline"}

    def parse_webhook(
        self, headers: dict, body: bytes
    ) -> list[BillingEvent]:
        # Offline: no webhooks to parse.
        return []


# ---------------------------------------------------------------------------
# StripeProvider — structural stub
# ---------------------------------------------------------------------------


class StripeProvider:
    """Structural stub for the Stripe payment provider.

    Every method raises ProviderNotConfigured until Stripe is wired in (P5+).
    """

    def ensure_customer(self, company: "Company") -> dict | None:
        raise ProviderNotConfigured("stripe not configured")

    def start_subscription(self, company: "Company", plan: "Plan") -> dict | None:
        raise ProviderNotConfigured("stripe not configured")

    def change_subscription(self, company: "Company", plan: "Plan") -> dict | None:
        raise ProviderNotConfigured("stripe not configured")

    def cancel_subscription(self, company: "Company") -> dict | None:
        raise ProviderNotConfigured("stripe not configured")

    def charge_one_off(
        self, company: "Company", amount_usd: float, reason: str
    ) -> dict | None:
        raise ProviderNotConfigured("stripe not configured")

    def report_usage(self, company: "Company", credits: int) -> dict | None:
        raise ProviderNotConfigured("stripe not configured")

    def parse_webhook(
        self, headers: dict, body: bytes
    ) -> list[BillingEvent]:
        raise ProviderNotConfigured("stripe not configured")


# ---------------------------------------------------------------------------
# XenditProvider — structural stub
# ---------------------------------------------------------------------------


class XenditProvider:
    """Structural stub for the Xendit payment provider.

    Every method raises ProviderNotConfigured until Xendit is wired in (P5+).
    """

    def ensure_customer(self, company: "Company") -> dict | None:
        raise ProviderNotConfigured("xendit not configured")

    def start_subscription(self, company: "Company", plan: "Plan") -> dict | None:
        raise ProviderNotConfigured("xendit not configured")

    def change_subscription(self, company: "Company", plan: "Plan") -> dict | None:
        raise ProviderNotConfigured("xendit not configured")

    def cancel_subscription(self, company: "Company") -> dict | None:
        raise ProviderNotConfigured("xendit not configured")

    def charge_one_off(
        self, company: "Company", amount_usd: float, reason: str
    ) -> dict | None:
        raise ProviderNotConfigured("xendit not configured")

    def report_usage(self, company: "Company", credits: int) -> dict | None:
        raise ProviderNotConfigured("xendit not configured")

    def parse_webhook(
        self, headers: dict, body: bytes
    ) -> list[BillingEvent]:
        raise ProviderNotConfigured("xendit not configured")


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def get_payment_provider():
    """Return the configured payment provider.

    Defaults to ManualProvider (offline) unless OMILO_PAYMENT_PROVIDER env
    selects another:
      OMILO_PAYMENT_PROVIDER=doit    → DoitProvider (requires DOIT_API_KEY)
      OMILO_PAYMENT_PROVIDER=stripe  → StripeProvider (raises if unconfigured)
      OMILO_PAYMENT_PROVIDER=xendit  → XenditProvider (raises if unconfigured)
    """
    from omilo.config import get_settings

    settings = get_settings()
    provider_env = settings.omilo_payment_provider.lower()

    if provider_env == "doit" and settings.doit_api_key:
        from omilo.billing.doit_client import DoitClient
        from omilo.billing.doit_provider import DoitProvider

        client = DoitClient(settings.doit_api_key, settings.doit_base_url)
        signing_secret = settings.doit_signing_secret or ""
        return DoitProvider(client, signing_secret)

    if provider_env == "stripe":
        return StripeProvider()
    if provider_env == "xendit":
        return XenditProvider()
    return ManualProvider()
