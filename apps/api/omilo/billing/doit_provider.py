"""omilo.billing.doit_provider — DoitProvider implementing the PaymentProvider port.

Public API:
    WebhookVerificationError   raised by parse_webhook on bad / missing signature
    verify_doit_signature      module-level HMAC-SHA256 verifier
    DoitProvider               PaymentProvider implementation backed by DoitClient
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import TYPE_CHECKING, Any

from omilo.billing.provider import BillingEvent

if TYPE_CHECKING:
    from omilo.billing.doit_client import DoitClient, FakeDoitClient
    from omilo.models.billing import Plan
    from omilo.models.tenancy import Company


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class WebhookVerificationError(Exception):
    """Raised by DoitProvider.parse_webhook when signature is missing or invalid.

    T3 (the webhook router) catches this and returns HTTP 401 to Doit.
    """


# ---------------------------------------------------------------------------
# Signature verification
# ---------------------------------------------------------------------------


def verify_doit_signature(
    signing_secret: str,
    header_value: str,
    raw_body: bytes | str,
    *,
    tolerance_s: int = 300,
    now: int | None = None,
) -> bool:
    """Verify a PayBridge-Signature header from Doit.

    Header format: ``t=<unix_ts>,v1=<hex_digest>``
    (spaces around ``=`` and ``,`` are tolerated).

    The HMAC is computed as:
        HMAC_SHA256(signing_secret, f"{t}.{raw_body_as_str}")

    Args:
        signing_secret: The DOIT_SIGNING_SECRET value.
        header_value:   The full ``PayBridge-Signature`` header string.
        raw_body:       The exact request body (bytes or str).
        tolerance_s:    Max allowed age of the timestamp in seconds (default 300).
        now:            Override the current epoch (used in tests).

    Returns:
        True if the signature is valid and timestamp is within tolerance.
        Returns False (never raises) for any malformed / invalid input.
    """
    try:
        if not header_value:
            return False

        # Parse "t=…,v1=…" — tolerate spaces around = and ,
        parts: dict[str, str] = {}
        for segment in header_value.split(","):
            segment = segment.strip()
            if "=" not in segment:
                return False
            k, _, v = segment.partition("=")
            parts[k.strip()] = v.strip()

        if "t" not in parts or "v1" not in parts:
            return False

        try:
            ts = int(parts["t"])
        except ValueError:
            return False

        # Timestamp tolerance check
        current = now if now is not None else int(time.time())
        if abs(current - ts) > tolerance_s:
            return False

        # Normalise body to str for the HMAC payload
        if isinstance(raw_body, bytes):
            body_str = raw_body.decode("utf-8", errors="replace")
        else:
            body_str = raw_body

        # Recompute HMAC
        payload = f"{ts}.{body_str}".encode()
        expected = hmac.new(
            signing_secret.encode(),
            payload,
            hashlib.sha256,
        ).hexdigest()

        return hmac.compare_digest(expected, parts["v1"])

    except Exception:
        # Be robust: any unexpected error → False, never raise
        return False


# ---------------------------------------------------------------------------
# DoitProvider
# ---------------------------------------------------------------------------


class DoitProvider:
    """PaymentProvider backed by the Doit payment gateway.

    Takes a client (DoitClient in production, FakeDoitClient in tests) and the
    webhook signing secret.  All seven PaymentProvider protocol methods are
    implemented.
    """

    def __init__(
        self,
        client: "DoitClient | FakeDoitClient",
        signing_secret: str,
    ) -> None:
        self._client = client
        self._signing_secret = signing_secret

    # ------------------------------------------------------------------
    # 1. ensure_customer
    # ------------------------------------------------------------------

    def ensure_customer(self, company: "Company") -> dict | None:
        """Doit is rail-based; no persistent customer object needed."""
        return {"status": "ok"}

    # ------------------------------------------------------------------
    # 2. charge_one_off
    # ------------------------------------------------------------------

    def charge_one_off(
        self,
        company: "Company",
        amount_idr: int,
        reference: str,
        rail: str = "any",
        metadata: dict | None = None,
    ) -> dict | None:
        """Create a one-off Doit payment.

        Returns:
            {
                provider_payment_id: "pay_…",
                hosted_url: "https://…",
                status: "pending",
                amount_idr: int,
                raw: <full Doit response>,
            }
        """
        resp = self._client.create_payment(
            amount_idr=amount_idr,
            reference=reference,
            rail=rail,
            metadata=metadata,
            idempotency_key=reference,
        )
        return {
            "provider_payment_id": resp["id"],
            "hosted_url": resp.get("hosted_url"),
            "status": resp["status"],
            "amount_idr": amount_idr,
            "raw": resp,
        }

    # ------------------------------------------------------------------
    # 3. start_subscription
    # ------------------------------------------------------------------

    def start_subscription(
        self, company: "Company", plan: "Plan"
    ) -> dict | None:
        """Create a Doit billing plan + subscription for the company."""
        return self._create_doit_subscription(company, plan)

    # ------------------------------------------------------------------
    # 4. change_subscription
    # ------------------------------------------------------------------

    def change_subscription(
        self, company: "Company", plan: "Plan"
    ) -> dict | None:
        """Change an existing subscription — create a new plan+subscription."""
        return self._create_doit_subscription(company, plan)

    # ------------------------------------------------------------------
    # 5. cancel_subscription
    # ------------------------------------------------------------------

    def cancel_subscription(self, company: "Company") -> dict | None:
        """Best-effort subscription cancellation.

        Doit's API may not expose a direct cancel endpoint; the router
        handles DB-side deactivation.  Returns None (no-op) here.
        """
        return None

    # ------------------------------------------------------------------
    # 6. report_usage
    # ------------------------------------------------------------------

    def report_usage(self, company: "Company", credits: int) -> dict | None:
        """Doit does not support metered usage reporting; no-op."""
        return None

    # ------------------------------------------------------------------
    # 7. parse_webhook
    # ------------------------------------------------------------------

    def parse_webhook(
        self,
        headers: dict,
        body: bytes,
        *,
        _now: int | None = None,
    ) -> list[BillingEvent]:
        """Verify the Doit webhook signature and parse the event.

        Signature is in the ``PayBridge-Signature`` header (case-insensitive).

        Raises:
            WebhookVerificationError — if the signature header is missing,
                malformed, or the HMAC verification fails.  T3 catches this
                and returns HTTP 401 to Doit.

        Returns:
            A list with exactly one BillingEvent on success.
            ``company_id`` is left None — T3 resolves it from the stored
            DoitPayment row by matching ``provider_payment_id``.
        """
        # Case-insensitive header lookup
        sig_header = self._get_header(headers, "PayBridge-Signature")
        if not sig_header:
            raise WebhookVerificationError(
                "Missing PayBridge-Signature header"
            )

        # Verify
        kwargs: dict[str, Any] = {}
        if _now is not None:
            kwargs["now"] = _now

        valid = verify_doit_signature(
            self._signing_secret,
            sig_header,
            body,
            **kwargs,
        )
        if not valid:
            raise WebhookVerificationError(
                "PayBridge-Signature verification failed"
            )

        # Parse event
        if isinstance(body, bytes):
            payload = json.loads(body.decode("utf-8"))
        else:
            payload = json.loads(body)

        event_type: str = payload.get("type", "unknown")
        # Doit places the payment object under "payment" key
        payment_obj: dict = payload.get("payment", payload)

        event = BillingEvent(
            type=event_type,
            company_id=None,
            data=payment_obj,
        )
        return [event]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _create_doit_subscription(
        self, company: "Company", plan: "Plan"
    ) -> dict:
        """Shared logic for start_subscription / change_subscription."""
        plan_name = getattr(plan, "name", str(plan))
        amount_idr = getattr(plan, "price_idr", 0)

        plan_resp = self._client.create_plan(
            name=plan_name,
            amount_idr=amount_idr,
            interval={"unit": "month", "count": 1},
        )
        customer: dict[str, Any] = {}
        if hasattr(company, "name"):
            customer["name"] = company.name

        sub_resp = self._client.create_subscription(
            plan_ref=plan_resp["id"],
            customer=customer,
        )
        return {
            "provider_ref": sub_resp["id"],
            "plan_ref": plan_resp["id"],
            "status": sub_resp.get("status", "active"),
        }

    @staticmethod
    def _get_header(headers: dict, name: str) -> str | None:
        """Case-insensitive header lookup."""
        name_lower = name.lower()
        for k, v in headers.items():
            if k.lower() == name_lower:
                return v
        return None
