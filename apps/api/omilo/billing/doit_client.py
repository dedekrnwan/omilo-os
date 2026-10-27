"""omilo.billing.doit_client — Real DoitClient (httpx) + FakeDoitClient (in-memory).

DoitClient: makes real HTTP calls to https://pay.doit.id/v1.
FakeDoitClient: deterministic in-memory implementation for tests — no network,
    no wall-clock nondeterminism.

Neither class is imported in production test runs; tests use FakeDoitClient only.
"""
from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Real client
# ---------------------------------------------------------------------------

_FIXED_EXPIRES_AT = "2026-12-31T00:00:00.000Z"


class DoitApiError(Exception):
    """Raised when Doit API returns a non-2xx response."""

    def __init__(self, status_code: int, body: str) -> None:
        super().__init__(f"Doit API error {status_code}: {body}")
        self.status_code = status_code
        self.body = body


class DoitClient:
    """HTTP client for the Doit (pay.doit.id) payment gateway.

    Auth: Bearer <api_key> on every request.
    Idempotency: Idempotency-Key header on mutating requests.

    This class is NEVER called during tests; FakeDoitClient is the test double.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://pay.doit.id/v1",
        *,
        http: Any = None,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        if http is not None:
            self._http = http
        else:
            import httpx
            self._http = httpx.Client(
                base_url=self._base_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=30.0,
            )

    def _auth_headers(self, idempotency_key: str | None = None) -> dict[str, str]:
        h: dict[str, str] = {"Authorization": f"Bearer {self._api_key}"}
        if idempotency_key:
            h["Idempotency-Key"] = idempotency_key
        return h

    def _check(self, resp: Any) -> dict:
        if resp.status_code >= 400:
            raise DoitApiError(resp.status_code, resp.text)
        return resp.json()

    # ------------------------------------------------------------------
    # Payments
    # ------------------------------------------------------------------

    def create_payment(
        self,
        amount_idr: int,
        reference: str,
        rail: str = "any",
        va_bank: str | None = None,
        customer: dict | None = None,
        metadata: dict | None = None,
        idempotency_key: str | None = None,
    ) -> dict:
        """POST /v1/payments → payment object (id, status, hosted_url, …)."""
        payload: dict[str, Any] = {
            "amount": amount_idr,
            "reference": reference,
            "rail": rail,
        }
        if va_bank:
            payload["va_bank"] = va_bank
        if customer:
            payload["customer"] = customer
        if metadata:
            payload["metadata"] = metadata

        resp = self._http.post(
            f"{self._base_url}/payments",
            json=payload,
            headers=self._auth_headers(idempotency_key or reference),
        )
        return self._check(resp)

    def get_payment(self, payment_id: str) -> dict:
        """GET /v1/payments/{id} → payment object with current status."""
        resp = self._http.get(
            f"{self._base_url}/payments/{payment_id}",
            headers=self._auth_headers(),
        )
        return self._check(resp)

    # ------------------------------------------------------------------
    # Billing plans / subscriptions
    # ------------------------------------------------------------------

    def create_plan(
        self,
        name: str,
        amount_idr: int,
        interval: dict,
    ) -> dict:
        """POST /v1/billing/plans → {id:"plan_…"}."""
        resp = self._http.post(
            f"{self._base_url}/billing/plans",
            json={"name": name, "amount": amount_idr, "interval": interval},
            headers=self._auth_headers(),
        )
        return self._check(resp)

    def create_subscription(
        self,
        plan_ref: str,
        customer: dict,
    ) -> dict:
        """POST /v1/billing/subscriptions → {id:"sub_…", status}."""
        resp = self._http.post(
            f"{self._base_url}/billing/subscriptions",
            json={"plan": plan_ref, "customer": customer},
            headers=self._auth_headers(),
        )
        return self._check(resp)

    # ------------------------------------------------------------------
    # Refunds
    # ------------------------------------------------------------------

    def refund(self, payment_id: str, amount: int | None = None) -> dict:
        """POST /v1/payments/{id}/refunds → refund object."""
        payload: dict[str, Any] = {}
        if amount is not None:
            payload["amount"] = amount
        resp = self._http.post(
            f"{self._base_url}/payments/{payment_id}/refunds",
            json=payload,
            headers=self._auth_headers(),
        )
        return self._check(resp)


# ---------------------------------------------------------------------------
# Fake client — deterministic, in-memory, used in tests
# ---------------------------------------------------------------------------


class FakeDoitClient:
    """In-memory Doit client for tests.

    Deterministic: payment IDs are derived from idempotency_key or reference.
    No network calls. No wall-clock nondeterminism (uses FIXED expires_at).

    Extra test helper:
        mark_paid(payment_id) — flip a stored payment status to "paid".
    """

    def __init__(self) -> None:
        self._payments: dict[str, dict] = {}
        self._plans: dict[str, dict] = {}
        self._subscriptions: dict[str, dict] = {}

    # ------------------------------------------------------------------
    # Payments
    # ------------------------------------------------------------------

    def create_payment(
        self,
        amount_idr: int,
        reference: str,
        rail: str = "any",
        va_bank: str | None = None,
        customer: dict | None = None,
        metadata: dict | None = None,
        idempotency_key: str | None = None,
    ) -> dict:
        key = idempotency_key or reference
        pay_id = f"pay_fake_{key}"
        record: dict[str, Any] = {
            "id": pay_id,
            "status": "pending",
            "qr_content": "00020101_fake",
            "va_number": None,
            "hosted_url": f"https://pay.doit.id/p/{pay_id}",
            "fee_amount": 0,
            "total_amount": amount_idr,
            "amount": amount_idr,
            "reference": reference,
            "rail": rail,
            "expires_at": _FIXED_EXPIRES_AT,
        }
        self._payments[pay_id] = record
        return dict(record)

    def get_payment(self, payment_id: str) -> dict:
        if payment_id not in self._payments:
            raise KeyError(f"FakeDoitClient: unknown payment {payment_id!r}")
        return dict(self._payments[payment_id])

    # ------------------------------------------------------------------
    # Billing plans / subscriptions
    # ------------------------------------------------------------------

    def create_plan(
        self,
        name: str,
        amount_idr: int,
        interval: dict,
    ) -> dict:
        import hashlib as _hl
        slug = _hl.md5(name.encode()).hexdigest()[:8]
        plan_id = f"plan_fake_{slug}"
        record = {"id": plan_id, "name": name, "amount": amount_idr, "interval": interval}
        self._plans[plan_id] = record
        return dict(record)

    def create_subscription(
        self,
        plan_ref: str,
        customer: dict,
    ) -> dict:
        import hashlib as _hl
        slug = _hl.md5(plan_ref.encode()).hexdigest()[:8]
        sub_id = f"sub_fake_{slug}"
        record = {"id": sub_id, "plan": plan_ref, "customer": customer, "status": "active"}
        self._subscriptions[sub_id] = record
        return dict(record)

    # ------------------------------------------------------------------
    # Refunds
    # ------------------------------------------------------------------

    def refund(self, payment_id: str, amount: int | None = None) -> dict:
        if payment_id not in self._payments:
            raise KeyError(f"FakeDoitClient: unknown payment {payment_id!r}")
        self._payments[payment_id]["status"] = "refunded"
        return dict(self._payments[payment_id])

    # ------------------------------------------------------------------
    # Test helpers
    # ------------------------------------------------------------------

    def mark_paid(self, payment_id: str) -> None:
        """Flip a stored payment's status to 'paid'. Used in webhook/reconcile tests."""
        if payment_id not in self._payments:
            raise KeyError(f"FakeDoitClient: unknown payment {payment_id!r}")
        self._payments[payment_id]["status"] = "paid"
