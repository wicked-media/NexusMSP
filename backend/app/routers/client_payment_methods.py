"""Saved customer cards, and charging them against a client invoice.

Nexus never sees or stores a card number.  A Stripe-hosted Checkout session in
``setup`` mode collects the card, and this router stores only the provider's
payment-method reference plus the non-sensitive display fields Stripe returns
(brand, last four digits, expiry).  Card data stays with Stripe; the Nexus
record is an explicitly labelled replica used for display and selection.

Charging reuses the existing signed-webhook settlement pipeline.  A saved-card
charge creates a Nexus payment transaction *before* the card is charged, and the
invoice is only settled when Stripe's signature-verified
``payment_intent.succeeded`` event matches that transaction's client, invoice,
amount and currency.  A successful API response therefore never credits an
invoice by itself.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.public_url import configured_public_base_url
from app.services.scope_permissions import assert_client_scope

logger = logging.getLogger(__name__)

router = APIRouter()

_MONEY_QUANTUM = Decimal("0.01")
_CANCELLED_INVOICE_STATUSES = frozenset({"cancelled", "voided", "void"})
# Only these collections may ever back a card charge.  An ID that resolves in
# two collections is ambiguous and is refused rather than guessed at.
_INVOICE_COLLECTIONS = ("invoices", "xero_invoices")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _money(value: Any, *, field_name: str, allow_zero: bool = True) -> float:
    try:
        amount = Decimal(str(value)).quantize(_MONEY_QUANTUM, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"{field_name} must be a valid monetary amount") from None
    if not amount.is_finite() or (amount < 0 if allow_zero else amount <= 0):
        qualifier = "non-negative" if allow_zero else "greater than zero"
        raise HTTPException(status_code=422, detail=f"{field_name} must be {qualifier}")
    return float(amount)


def _currency(value: Any) -> str:
    currency = str(value or "AUD").strip().lower()
    if len(currency) != 3 or not currency.isalpha():
        raise HTTPException(status_code=422, detail="Invoice currency must be a three-letter ISO code")
    return currency


def _stripe_client(api_key: str):
    """Return a configured Stripe SDK module.

    Kept as a single seam so the contract tests can substitute a fake provider
    without an outbound network call, exactly as the router uses it in
    production.
    """
    import stripe

    stripe.api_key = api_key
    return stripe


async def _stripe_api_key() -> str:
    """Resolve the server-only Stripe secret without returning it to callers."""
    setting = await db.settings.find_one({"type": "stripe"}, {"_id": 0}) or {}
    return str(setting.get("api_key") or os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY") or "")


def _value(source: Any, name: str, default: Any = None) -> Any:
    """Read a field from a Stripe object or a plain mapping."""
    if source is None:
        return default
    if isinstance(source, dict):
        return source.get(name, default)
    return getattr(source, name, default)


def _safe_method(record: dict[str, Any]) -> dict[str, Any]:
    """Return the only card fields a browser is ever allowed to see.

    Provider identifiers are deliberately excluded: nothing in the Nexus UI
    needs them, and keeping them server-side means a compromised browser session
    cannot reference another customer's card at Stripe.
    """
    return {
        "id": record.get("id"),
        "brand": record.get("brand") or "card",
        "last4": record.get("last4") or "••••",
        "exp_month": record.get("exp_month"),
        "exp_year": record.get("exp_year"),
        "funding": record.get("funding") or "",
        "wallet": record.get("wallet") or "",
        "country": record.get("country") or "",
        "is_default": bool(record.get("is_default")),
        "status": record.get("status") or "active",
        "created_at": record.get("created_at"),
        "created_by": record.get("created_by") or "",
    }


async def _load_client(client_id: str, current_user: dict, request: Request, *, operation: str) -> dict:
    await assert_client_scope(current_user, client_id, operation=operation, request=request, mask_not_found=True)
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


async def _active_methods(client_id: str) -> list[dict]:
    return await db.client_payment_methods.find(
        {"client_id": client_id, "status": "active"},
        {"_id": 0},
    ).sort("created_at", 1).to_list(50)


async def _list_payload(client_id: str) -> dict:
    methods = [_safe_method(record) for record in await _active_methods(client_id)]
    return {
        "stripe_configured": bool(await _stripe_api_key()),
        "methods": methods,
        "default_method_id": next((method["id"] for method in methods if method["is_default"]), None),
    }


async def _ensure_customer(stripe, client: dict, client_id: str) -> tuple[str, bool]:
    """Return the client's Stripe customer, creating one only when absent."""
    customer_id = str(client.get("stripe_customer_id") or "").strip()
    if customer_id:
        return customer_id, False
    customer = stripe.Customer.create(
        name=client.get("name") or None,
        email=client.get("email") or None,
        metadata={"nexus_client_id": client_id},
    )
    customer_id = str(_value(customer, "id") or "")
    if not customer_id:
        raise HTTPException(status_code=502, detail="Stripe did not return a customer identifier")
    await db.clients.update_one({"id": client_id}, {"$set": {"stripe_customer_id": customer_id}})
    return customer_id, True


async def _promote_default(client_id: str, *, exclude_id: str | None = None) -> None:
    """Keep at most one active default, promoting the oldest remaining card."""
    if exclude_id:
        await db.client_payment_methods.update_many(
            {"client_id": client_id, "status": "active", "id": {"$ne": exclude_id}},
            {"$set": {"is_default": False}},
        )
        await db.client_payment_methods.update_one(
            {"client_id": client_id, "id": exclude_id, "status": "active"},
            {"$set": {"is_default": True}},
        )
        return
    remaining = await _active_methods(client_id)
    if not remaining:
        return
    await db.client_payment_methods.update_many(
        {"client_id": client_id, "status": "active"},
        {"$set": {"is_default": False}},
    )
    await db.client_payment_methods.update_one({"id": remaining[0]["id"]}, {"$set": {"is_default": True}})


@router.get(
    "/clients/{client_id}/payment-methods",
    dependencies=[Depends(require_action("billing.payment_method.view"))],
)
async def list_client_payment_methods(
    client_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """List a client's saved cards as masked display records only."""
    await _load_client(client_id, current_user, request, operation="billing.payment_method.read")
    return await _list_payload(client_id)


@router.post(
    "/clients/{client_id}/payment-methods/setup",
    dependencies=[Depends(require_action("billing.payment_method.manage"))],
)
async def start_client_payment_method_setup(
    client_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Open a Stripe-hosted card capture session bound to this client only."""
    client = await _load_client(client_id, current_user, request, operation="billing.payment_method.setup")
    stripe_key = await _stripe_api_key()
    if not stripe_key:
        raise HTTPException(
            status_code=503,
            detail="Stripe is not configured. Add the Stripe secret key before saving a card.",
        )

    stripe = _stripe_client(stripe_key)
    try:
        customer_id, customer_created = await _ensure_customer(stripe, client, client_id)
        base_url = configured_public_base_url()
        session = stripe.checkout.Session.create(
            mode="setup",
            customer=customer_id,
            payment_method_types=["card"],
            metadata={"nexus_client_id": client_id},
            setup_intent_data={"metadata": {"nexus_client_id": client_id}},
            success_url=(
                f"{base_url}/clients?client={client_id}&view=billing"
                "&pm_setup=complete&session_id={CHECKOUT_SESSION_ID}"
            ),
            cancel_url=f"{base_url}/clients?client={client_id}&view=billing&pm_setup=cancelled",
        )
    except HTTPException:
        raise
    except Exception:
        logger.error("client_payment_method_setup_failed client_id=%s", client_id)
        raise HTTPException(status_code=502, detail="Stripe could not start the secure card capture") from None

    session_id = str(_value(session, "id") or "")
    url = str(_value(session, "url") or "")
    if not session_id or not url:
        raise HTTPException(status_code=502, detail="Stripe did not return a usable card capture session")
    await log_activity(
        current_user,
        "client_payment_method_setup_started",
        "client",
        client_id,
        client.get("name", ""),
        "Started a Stripe-hosted card capture for this client",
        metadata={"customer_created": customer_created},
    )
    # The session id is a short-lived capability for this client's own capture
    # only; it is safe to return to the browser that just requested it.
    return {"url": url, "session_id": session_id}


@router.post(
    "/clients/{client_id}/payment-methods/complete",
    dependencies=[Depends(require_action("billing.payment_method.manage"))],
)
async def complete_client_payment_method_setup(
    client_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Verify a completed card capture and store the masked reference.

    The browser only returns the Stripe session id.  Nexus re-reads the session
    from Stripe, proves it belongs to this client and this Nexus workflow, and
    only then records the card.  A forged or replayed identifier from another
    client cannot become a saved card here.
    """
    client = await _load_client(client_id, current_user, request, operation="billing.payment_method.complete")
    session_id = str((data or {}).get("session_id") or "").strip()
    if not session_id:
        raise HTTPException(status_code=422, detail="session_id is required")
    stripe_key = await _stripe_api_key()
    if not stripe_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured. The card was not saved.")

    stripe = _stripe_client(stripe_key)
    try:
        session = stripe.checkout.Session.retrieve(session_id)
        if str(_value(session, "mode") or "") != "setup":
            raise HTTPException(status_code=409, detail="This card capture session is not a setup session")
        if str(_value(_value(session, "metadata", {}) or {}, "nexus_client_id") or "") != client_id:
            raise HTTPException(status_code=404, detail="Card capture session not found for this client")
        if str(_value(session, "status") or "") != "complete":
            raise HTTPException(status_code=409, detail="The card capture was not completed")
        setup_intent_id = str(_value(session, "setup_intent") or "")
        if not setup_intent_id:
            raise HTTPException(status_code=409, detail="The card capture produced no payment method")
        setup_intent = stripe.SetupIntent.retrieve(setup_intent_id)
        payment_method_id = str(_value(setup_intent, "payment_method") or "")
        if not payment_method_id:
            raise HTTPException(status_code=409, detail="The card capture produced no payment method")
        payment_method = stripe.PaymentMethod.retrieve(payment_method_id)
    except HTTPException:
        raise
    except Exception:
        logger.error("client_payment_method_complete_failed client_id=%s", client_id)
        raise HTTPException(status_code=502, detail="Stripe could not confirm the saved card") from None

    customer_id = str(_value(session, "customer") or client.get("stripe_customer_id") or "").strip()
    card = _value(payment_method, "card", {}) or {}
    last4 = str(_value(card, "last4") or "")
    if not last4:
        # Never persist a record we cannot display as a card: a non-card
        # instrument would otherwise look like an unnamed saved payment method.
        raise HTTPException(status_code=409, detail="Stripe did not return card details for the saved payment method")

    now = _now_iso()
    existing = await db.client_payment_methods.find_one(
        {"client_id": client_id, "stripe_payment_method_id": payment_method_id},
        {"_id": 0},
    )
    has_default = any(method.get("is_default") for method in await _active_methods(client_id))
    record = {
        "client_id": client_id,
        "stripe_customer_id": customer_id,
        "stripe_payment_method_id": payment_method_id,
        "brand": str(_value(card, "brand") or "card"),
        "last4": last4,
        "exp_month": _value(card, "exp_month"),
        "exp_year": _value(card, "exp_year"),
        "funding": str(_value(card, "funding") or ""),
        "wallet": str(_value(_value(payment_method, "card", {}) or {}, "wallet", "") or ""),
        "country": str(_value(card, "country") or ""),
        "status": "active",
        "updated_at": now,
    }
    if existing:
        await db.client_payment_methods.update_one({"id": existing["id"]}, {"$set": record})
        record["id"] = existing["id"]
        record["is_default"] = bool(existing.get("is_default"))
        record["created_at"] = existing.get("created_at")
        record["created_by"] = existing.get("created_by")
    else:
        record.update({
            "id": str(uuid.uuid4()),
            "is_default": not has_default,
            "created_at": now,
            "created_by": current_user.get("name") or current_user.get("email") or current_user.get("id"),
            "source": "stripe_checkout_setup",
        })
        await db.client_payment_methods.insert_one(dict(record))

    await log_activity(
        current_user,
        "client_payment_method_saved",
        "client",
        client_id,
        client.get("name", ""),
        "Saved a card for this client's customer payments",
        metadata={"method_id": record["id"], "brand": record["brand"], "last4": record["last4"]},
    )
    return {"message": "Card saved for this client", "method": _safe_method(record), **(await _list_payload(client_id))}


@router.post(
    "/clients/{client_id}/payment-methods/{method_id}/default",
    dependencies=[Depends(require_action("billing.payment_method.manage"))],
)
async def set_default_client_payment_method(
    client_id: str,
    method_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Make exactly one saved card the client's default."""
    client = await _load_client(client_id, current_user, request, operation="billing.payment_method.default")
    method = await db.client_payment_methods.find_one(
        {"client_id": client_id, "id": method_id, "status": "active"},
        {"_id": 0},
    )
    if not method:
        raise HTTPException(status_code=404, detail="Saved card not found")
    await _promote_default(client_id, exclude_id=method_id)
    await log_activity(
        current_user,
        "client_payment_method_default_changed",
        "client",
        client_id,
        client.get("name", ""),
        "Changed the default card for this client",
        metadata={"method_id": method_id, "brand": method.get("brand"), "last4": method.get("last4")},
    )
    return {"message": "Default card updated", **(await _list_payload(client_id))}


@router.delete(
    "/clients/{client_id}/payment-methods/{method_id}",
    dependencies=[Depends(require_action("billing.payment_method.manage"))],
)
async def remove_client_payment_method(
    client_id: str,
    method_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Detach a saved card at Stripe, then close the Nexus reference."""
    client = await _load_client(client_id, current_user, request, operation="billing.payment_method.remove")
    method = await db.client_payment_methods.find_one(
        {"client_id": client_id, "id": method_id, "status": "active"},
        {"_id": 0},
    )
    if not method:
        raise HTTPException(status_code=404, detail="Saved card not found")

    stripe_key = await _stripe_api_key()
    if not stripe_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured. The card was not removed.")
    stripe = _stripe_client(stripe_key)
    try:
        stripe.PaymentMethod.detach(method.get("stripe_payment_method_id"))
    except Exception:
        # A card Stripe no longer knows about is already gone from the
        # customer's wallet; closing the local reference is the honest outcome.
        logger.warning("client_payment_method_detach_unavailable client_id=%s", client_id)

    now = _now_iso()
    await db.client_payment_methods.update_one(
        {"client_id": client_id, "id": method_id},
        {"$set": {"status": "detached", "is_default": False, "detached_at": now, "detached_by": current_user.get("id")}},
    )
    if method.get("is_default"):
        await _promote_default(client_id)
    await log_activity(
        current_user,
        "client_payment_method_removed",
        "client",
        client_id,
        client.get("name", ""),
        "Removed a saved card from this client",
        metadata={"method_id": method_id, "brand": method.get("brand"), "last4": method.get("last4")},
    )
    return {"message": "Card removed", **(await _list_payload(client_id))}


async def _find_invoice(invoice_id: str) -> tuple[dict | None, str | None]:
    """Resolve an invoice without allowing cross-collection ID collisions."""
    if not invoice_id:
        return None, None
    found: list[tuple[dict, str]] = []
    for collection in _INVOICE_COLLECTIONS:
        target = db.xero_invoices if collection == "xero_invoices" else db.invoices
        invoice = await target.find_one({"id": invoice_id}, {"_id": 0})
        if invoice:
            found.append((invoice, collection))
    if len(found) != 1:
        return None, None
    return found[0]


@router.post(
    "/clients/{client_id}/payment-methods/{method_id}/charge",
    dependencies=[Depends(require_action("billing.payment_method.charge"))],
)
async def charge_invoice_with_client_payment_method(
    client_id: str,
    method_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Charge a saved card off-session against one client-owned invoice.

    The invoice is not settled here.  This endpoint creates the Nexus payment
    transaction that binds the client, invoice, amount and currency, then asks
    Stripe to charge the saved card.  Only the signature-verified
    ``payment_intent.succeeded`` webhook can credit the invoice.
    """
    client = await _load_client(client_id, current_user, request, operation="billing.payment_method.charge")
    method = await db.client_payment_methods.find_one(
        {"client_id": client_id, "id": method_id, "status": "active"},
        {"_id": 0},
    )
    if not method:
        raise HTTPException(status_code=404, detail="Saved card not found")

    invoice_id = str((data or {}).get("invoice_id") or "").strip()
    if not invoice_id:
        raise HTTPException(status_code=422, detail="invoice_id is required")
    invoice, collection = await _find_invoice(invoice_id)
    if not invoice or not collection:
        raise HTTPException(status_code=404, detail="Invoice not found")
    # The invoice must belong to the client in the path: a card from one
    # customer can never be charged for another customer's balance.
    if str(invoice.get("client_id") or "") != client_id:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if str(invoice.get("status") or "").strip().lower() in _CANCELLED_INVOICE_STATUSES:
        raise HTTPException(status_code=409, detail="Cannot charge a voided invoice")

    total = _money(invoice.get("total", 0), field_name="Invoice total")
    paid = _money(invoice.get("amount_paid", 0), field_name="Invoice amount_paid")
    balance = round(total - paid, 2)
    if balance <= 0:
        raise HTTPException(status_code=400, detail="Invoice is already fully paid")
    requested = (data or {}).get("amount")
    amount = balance if requested in (None, "") else _money(requested, field_name="amount", allow_zero=False)
    if amount > balance + 0.01:
        raise HTTPException(status_code=409, detail="Amount exceeds the outstanding invoice balance")

    customer_id = str(client.get("stripe_customer_id") or method.get("stripe_customer_id") or "").strip()
    if not customer_id:
        raise HTTPException(status_code=409, detail="This client has no saved Stripe customer to charge")
    stripe_key = await _stripe_api_key()
    if not stripe_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured. The card was not charged.")

    currency = _currency(invoice.get("currency") or "AUD")
    amount_cents = int(round(amount * 100))
    supplied_key = str((data or {}).get("idempotency_key") or "").strip()
    idempotency_key = supplied_key or f"nexus-saved-card:{method_id}:{invoice_id}:{amount_cents}"
    if not 8 <= len(idempotency_key) <= 255:
        raise HTTPException(status_code=422, detail="idempotency_key must be between 8 and 255 characters")

    stripe = _stripe_client(stripe_key)
    try:
        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=currency,
            customer=customer_id,
            payment_method=method.get("stripe_payment_method_id"),
            payment_method_types=["card"],
            confirm=True,
            off_session=True,
            metadata={"invoice_id": invoice_id, "nexus_client_id": client_id},
            idempotency_key=idempotency_key,
        )
    except Exception:
        # Provider errors can carry request context and identifiers.  Record a
        # non-sensitive failure against the card and keep the detail server-side.
        logger.error("client_payment_method_charge_failed client_id=%s method_id=%s", client_id, method_id)
        raise HTTPException(
            status_code=502,
            detail="The saved card could not be charged. No payment was recorded; you can retry or send a payment link.",
        ) from None

    provider_id = str(_value(intent, "id") or "")
    intent_status = str(_value(intent, "status") or "")
    if not provider_id:
        raise HTTPException(status_code=502, detail="Stripe did not return a payment identifier")

    now = _now_iso()
    transaction_id = str(uuid.uuid4())
    await db.payment_transactions.insert_one({
        "id": transaction_id,
        "invoice_id": invoice_id,
        "invoice_collection": collection,
        "client_id": client_id,
        "payment_method_id": method_id,
        "stripe_payment_intent_id": provider_id,
        "provider_id_field": "stripe_payment_intent_id",
        "amount": amount,
        "amount_cents": amount_cents,
        "currency": currency,
        # The signed webhook flips this to "paid"; it is deliberately not set
        # from this API response.
        "payment_status": "initiated" if intent_status != "succeeded" else "awaiting_confirmation",
        "source": "saved_card",
        "initiated_by": current_user.get("id"),
        "created_at": now,
    })
    await log_activity(
        current_user,
        "client_payment_method_charge_requested",
        "invoice",
        invoice_id,
        str(invoice.get("invoice_number") or invoice_id),
        "Charged the client's saved card against an invoice",
        metadata={
            "client_id": client_id,
            "method_id": method_id,
            "amount": amount,
            "currency": currency,
            "payment_transaction_id": transaction_id,
            "provider_status": intent_status,
        },
    )
    if intent_status == "succeeded":
        return {
            "message": "Card charged. The invoice settles when Stripe confirms the payment.",
            "status": "processing",
            "amount": amount,
            "transaction_id": transaction_id,
        }
    if intent_status == "requires_action":
        return {
            "message": "The customer's bank requires authentication. Send a payment link so they can approve the charge.",
            "status": "requires_action",
            "amount": amount,
            "transaction_id": transaction_id,
        }
    return {
        "message": "The charge was submitted and is awaiting Stripe confirmation.",
        "status": intent_status or "processing",
        "amount": amount,
        "transaction_id": transaction_id,
    }
