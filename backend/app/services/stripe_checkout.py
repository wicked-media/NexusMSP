"""Direct Stripe Checkout adapter used by NexusMSP."""
from dataclasses import dataclass
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


class StripeCheckout:
    def __init__(self, api_key: str, webhook_url: str = ""):
        stripe.api_key = api_key
        self.webhook_url = webhook_url

    async def create_checkout_session(self, request: CheckoutSessionRequest):
        session = stripe.checkout.Session.create(
            mode="payment",
            success_url=request.success_url,
            cancel_url=request.cancel_url,
            metadata=request.metadata,
            line_items=[{"price_data": {"currency": request.currency, "product_data": {"name": "NexusMSP invoice payment"}, "unit_amount": int(round(request.amount * 100))}, "quantity": 1}],
        )
        return type("CheckoutSession", (), {"session_id": session.id, "url": session.url})()

    async def get_checkout_status(self, session_id: str) -> CheckoutStatus:
        session = stripe.checkout.Session.retrieve(session_id)
        return CheckoutStatus(session.id, session.payment_status, session.amount_total or 0, session.currency or "", dict(session.metadata or {}))

    async def handle_webhook(self, body: bytes, signature: str) -> CheckoutStatus:
        secret = os.environ.get("STRIPE_WEBHOOK_SECRET")
        if not secret:
            raise RuntimeError("STRIPE_WEBHOOK_SECRET is not configured")
        event = stripe.Webhook.construct_event(body, signature, secret)
        session = event.data.object
        return CheckoutStatus(session.id, getattr(session, "payment_status", ""), getattr(session, "amount_total", 0) or 0, getattr(session, "currency", "") or "", dict(getattr(session, "metadata", {}) or {}))
