"""Direct Stripe Checkout adapter used by NexusMSP."""
from dataclasses import dataclass
from typing import Any
import os
import stripe


@dataclass
class CheckoutSessionRequest:
    amount: float
    currency: str
    success_url: str
    cancel_url: str
    metadata: dict


@dataclass
class CheckoutStatus:
    session_id: str
    payment_status: str
    amount_total: int
    currency: str
    metadata: dict


@dataclass
class StripeWebhookEvent:
    """A verified Stripe event normalised for the Nexus payment boundary."""

    event_id: str
    event_type: str
    object_id: str
    object_type: str
    payment_status: str
    amount_total: int
    currency: str
    metadata: dict


class StripeCheckout:
    def __init__(self, api_key: str, webhook_url: str = ""):
        stripe.api_key = api_key
        self.webhook_url = webhook_url

    async def create_checkout_session(self, request: CheckoutSessionRequest, *, idempotency_key: str | None = None):
        options: dict[str, Any] = {
            "mode": "payment",
            "success_url": request.success_url,
            "cancel_url": request.cancel_url,
            "metadata": request.metadata,
            "line_items": [{"price_data": {"currency": request.currency, "product_data": {"name": "NexusMSP invoice payment"}, "unit_amount": int(round(request.amount * 100))}, "quantity": 1}],
        }
        if idempotency_key:
            options["idempotency_key"] = idempotency_key
        session = stripe.checkout.Session.create(
            **options,
        )
        return type("CheckoutSession", (), {"session_id": session.id, "url": session.url})()

    async def get_checkout_status(self, session_id: str) -> CheckoutStatus:
        session = stripe.checkout.Session.retrieve(session_id)
        return CheckoutStatus(session.id, session.payment_status, session.amount_total or 0, session.currency or "", dict(session.metadata or {}))

    async def handle_webhook(self, body: bytes, signature: str) -> StripeWebhookEvent:
        """Verify Stripe's signature and preserve the event/object distinction.

        Callers must choose the event types they are willing to process.  This
        prevents a valid but unrelated Stripe event from looking like an invoice
        settlement merely because it contains arbitrary metadata.
        """
        secret = os.environ.get("STRIPE_WEBHOOK_SECRET")
        if not secret:
            raise RuntimeError("STRIPE_WEBHOOK_SECRET is not configured")
        event = stripe.Webhook.construct_event(body, signature, secret)
        event_type = str(getattr(event, "type", "") or event.get("type", ""))
        event_id = str(getattr(event, "id", "") or event.get("id", ""))
        payload = getattr(getattr(event, "data", None), "object", None)
        if payload is None and isinstance(event, dict):
            payload = (event.get("data") or {}).get("object") or {}

        def value(name: str, default: Any = None) -> Any:
            if isinstance(payload, dict):
                return payload.get(name, default)
            return getattr(payload, name, default)

        object_type = str(value("object", ""))
        object_id = str(value("id", ""))
        if object_type == "payment_intent":
            payment_status = "paid" if str(value("status", "")) == "succeeded" else str(value("status", ""))
            amount_total = value("amount_received", value("amount", 0)) or 0
        else:
            payment_status = str(value("payment_status", ""))
            amount_total = value("amount_total", 0) or 0
        raw_metadata = value("metadata", {}) or {}
        return StripeWebhookEvent(
            event_id=event_id,
            event_type=event_type,
            object_id=object_id,
            object_type=object_type,
            payment_status=payment_status,
            amount_total=int(amount_total),
            currency=str(value("currency", "") or ""),
            metadata=dict(raw_metadata),
        )
