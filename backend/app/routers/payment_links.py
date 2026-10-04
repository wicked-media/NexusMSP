"""One-time public payment links with bounded, auditable payment handling.

The token is deliberately a public capability, but it never grants authority
to change an invoice directly. Stripe-signed webhooks are the only path that
settles a card/direct-debit payment; public confirmation is read-only.
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import os
import secrets
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.scope_permissions import assert_client_scope, scoped_query
from app.services.public_url import configured_public_base_url


router = APIRouter()

_ALLOWED_PAYMENT_METHODS = frozenset({"card", "becs", "bank_transfer"})
_CANCELLED_INVOICE_STATUSES = frozenset({"cancelled", "voided", "void"})
_MONEY_QUANTUM = Decimal("0.01")


def _now() -> datetime:
    return datetime.now(timezone.utc)


from app.services.time_utils import now_iso as _now_iso


def _as_utc(value: Any) -> datetime | None:
    """Parse persisted ISO timestamps safely and fail closed for bad values."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _money(value: Any, *, field_name: str, allow_zero: bool = True) -> float:
    """Return a finite, cent-rounded money amount from untrusted input."""
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


def _normalise_allowed_methods(value: Any) -> list[str]:
    if not isinstance(value, (list, tuple, set, frozenset)):
        raise HTTPException(status_code=422, detail="allowed_methods must be a list")
    methods = sorted({str(item or "").strip().lower() for item in value if str(item or "").strip()})
    if not methods:
        raise HTTPException(status_code=422, detail="At least one payment method is required")
    unsupported = sorted(set(methods) - _ALLOWED_PAYMENT_METHODS)
    if unsupported:
        raise HTTPException(status_code=422, detail=f"Unsupported payment method: {unsupported[0]}")
    return methods


async def _stripe_api_key() -> str:
    """Resolve the server-only Stripe secret without returning it to callers."""
    setting = await db.settings.find_one({"type": "stripe"}, {"_id": 0}) or {}
    return str(setting.get("api_key") or os.environ.get("STRIPE_API_KEY") or "")


async def _find_invoice(
    invoice_id: str,
    expected_collection: str | None = None,
) -> tuple[dict[str, Any] | None, str | None]:
    """Resolve an invoice without allowing cross-collection ID collisions.

    Newly created payment links persist their authoritative collection.  That
    collection is part of the payment binding and must be honoured on every
    later public or operator action.  Legacy links without it remain readable
    only where an ID resolves unambiguously in one collection.
    """
    if expected_collection:
        if expected_collection not in {"invoices", "xero_invoices"}:
            return None, None
        target = db.xero_invoices if expected_collection == "xero_invoices" else db.invoices
        invoice = await target.find_one({"id": invoice_id}, {"_id": 0})
        return invoice, expected_collection if invoice else None

    xero_invoice = await db.xero_invoices.find_one({"id": invoice_id}, {"_id": 0})
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if xero_invoice and invoice:
        # An old link cannot safely choose between independently authoritative
        # collections.  It must be recreated rather than guessed at.
        return None, None
    if xero_invoice:
        return xero_invoice, "xero_invoices"
    return invoice, "invoices" if invoice else None


def _invoice_balance(invoice: dict[str, Any]) -> float:
    return round(
        _money(invoice.get("total", 0), field_name="Invoice total")
        - _money(invoice.get("amount_paid", 0), field_name="Invoice amount_paid"),
        2,
    )


async def _load_public_link(token: str) -> tuple[dict[str, Any], dict[str, Any], str, float]:
    """Load only a currently usable public link and its bound invoice.

    All public mutations use this one gate so expiry/revocation cannot be
    bypassed by calling a method endpoint directly instead of the landing page.
    """
    link = await db.payment_links.find_one({"token": token}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=404, detail="Payment link not found or expired")

    if link.get("status") != "active":
        raise HTTPException(status_code=410, detail="This payment link is no longer active")

    expires_at = _as_utc(link.get("expires_at"))
    if expires_at is None or expires_at <= _now():
        await db.payment_links.update_one(
            {"id": link.get("id"), "status": "active"},
            {"$set": {"status": "expired", "expired_at": _now_iso()}},
        )
        raise HTTPException(status_code=410, detail="This payment link has expired")

    expected_collection = str(link.get("invoice_collection") or "").strip() or None
    invoice, collection = await _find_invoice(str(link.get("invoice_id") or ""), expected_collection)
    if not invoice or not collection:
        if expected_collection:
            raise HTTPException(status_code=410, detail="Payment link is no longer valid")
        raise HTTPException(status_code=404, detail="Invoice not found")

    # New links store both relationships. Historical links can be read through
    # their immutable invoice ID, but a contradictory stored relationship fails
    # closed rather than settling an unexpected invoice.
    if link.get("client_id") and link.get("client_id") != invoice.get("client_id"):
        raise HTTPException(status_code=410, detail="Payment link is no longer valid")
    if link.get("invoice_collection") and link.get("invoice_collection") != collection:
        raise HTTPException(status_code=410, detail="Payment link is no longer valid")

    balance = _invoice_balance(invoice)
    if str(invoice.get("status") or "").strip().lower() in _CANCELLED_INVOICE_STATUSES or balance <= 0:
        await db.payment_links.update_one(
            {"id": link.get("id"), "status": "active"},
            {"$set": {"status": "completed", "completed_at": _now_iso()}},
        )
        raise HTTPException(status_code=410, detail="This payment link is no longer active")
    return link, invoice, collection, balance


async def _load_link_for_operator(
    link_id: str,
    current_user: dict[str, Any],
    *,
    operation: str,
    request: Request | None = None,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    link = await db.payment_links.find_one({"id": link_id}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    expected_collection = str(link.get("invoice_collection") or "").strip() or None
    invoice, collection = await _find_invoice(str(link.get("invoice_id") or ""), expected_collection)
    if not invoice or not collection:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if link.get("client_id") and link.get("client_id") != invoice.get("client_id"):
        raise HTTPException(status_code=404, detail="Invoice not found")
    await assert_client_scope(
        current_user,
        invoice.get("client_id"),
        operation=operation,
        request=request,
        mask_not_found=True,
    )
    return link, invoice, collection


def _public_payment_record(payment: dict[str, Any]) -> dict[str, Any]:
    """Remove local/provider-only state before exposing a public payment row."""
    return {
        key: value
        for key, value in payment.items()
        if key not in {"client_secret", "idempotency_key", "stripe_event_id"}
    }


def _operator_payment_link_record(link: dict[str, Any]) -> dict[str, Any]:
    """Return operational link metadata without re-distributing its capability.

    A payment-link token is equivalent to a bearer credential.  Operators only
    need the immutable link ID and lifecycle/payment state in the list view;
    the creation response is the one place the shareable token is returned.
    """
    private_fields = {
        "token",
        "payments",
        "idempotency_key",
        "stripe_event_id",
        "stripe_session_id",
        "stripe_payment_intent_id",
        "stripe_checkout_url",
        "client_secret",
        "stripe_client_secret",
        "checkout_lock",
    }
    result = {key: value for key, value in link.items() if key not in private_fields}
    result["payments"] = [_public_payment_record(payment) for payment in link.get("payments", [])]
    for payment in result["payments"]:
        payment.pop("stripe_session_id", None)
        payment.pop("stripe_payment_intent_id", None)
    return result


def _same_payment_attempt(
    attempt: dict[str, Any],
    *,
    method: str,
    amount: float,
    idempotency_key: str,
) -> bool:
    """Decide whether a retry is for the one reserved online payment."""
    try:
        attempt_amount = _money(attempt.get("amount"), field_name="Stored payment amount", allow_zero=False)
    except HTTPException:
        return False
    return (
        str(attempt.get("method") or "") == method
        and abs(attempt_amount - amount) < 0.001
        and str(attempt.get("idempotency_key") or "") == idempotency_key
    )


def _default_online_idempotency_key(link: dict[str, Any], *, method: str, amount: float) -> str:
    """Create a retry-stable key without making the browser invent one first."""
    existing = link.get("checkout_lock")
    if isinstance(existing, dict) and str(existing.get("status") or "") in {"initiating", "pending"}:
        key = str(existing.get("idempotency_key") or "").strip()
        if key:
            return key
    return f"nexus-payment-link:{link['id']}:{method}:{int(round(amount * 100))}:{len(link.get('payments') or [])}"


async def _reserve_online_payment_attempt(
    *,
    link: dict[str, Any],
    invoice: dict[str, Any],
    method: str,
    amount: float,
    idempotency_key: str,
) -> tuple[dict[str, Any], bool]:
    """Atomically reserve one online payment attempt for an active link.

    A payment-link token is deliberately reusable until its invoice is paid,
    but concurrent clicks must not create multiple chargeable Stripe sessions
    for the same balance.  The link document is the concurrency boundary: one
    active online attempt is reserved before any provider call.  A retry with
    the same key reuses that attempt; a different attempt must wait until the
    first reaches a terminal outcome or the operator issues a new link.
    """
    reservation = {
        "id": str(uuid.uuid4()),
        "method": method,
        "amount": amount,
        "currency": _currency(invoice.get("currency") or link.get("currency")),
        "status": "initiating",
        "idempotency_key": idempotency_key,
        "reserved_at": _now_iso(),
    }
    reserved = await db.payment_links.update_one(
        {
            "id": link["id"],
            "status": "active",
            "$or": [
                {"checkout_lock": {"$exists": False}},
                {"checkout_lock.status": {"$in": ["paid", "cancelled", "failed"]}},
            ],
        },
        {"$set": {"checkout_lock": reservation}},
    )
    if reserved.matched_count:
        return reservation, False

    current = await db.payment_links.find_one({"id": link["id"]}, {"_id": 0})
    if not current or current.get("status") != "active":
        raise HTTPException(status_code=410, detail="This payment link is no longer active")
    existing = current.get("checkout_lock")
    if isinstance(existing, dict) and _same_payment_attempt(
        existing,
        method=method,
        amount=amount,
        idempotency_key=idempotency_key,
    ):
        return existing, True
    raise HTTPException(
        status_code=409,
        detail="An online payment attempt is already in progress for this invoice. Complete it or ask your provider for a new payment link.",
    )


async def _persist_online_payment_attempt(
    *,
    link: dict[str, Any],
    payment_record: dict[str, Any],
) -> None:
    """Bind a provider-created attempt to the still-active payment link."""
    persisted = await db.payment_links.update_one(
        {
            "id": link["id"],
            "status": "active",
            "checkout_lock.id": payment_record["id"],
            "checkout_lock.status": "initiating",
        },
        {
            "$set": {"checkout_lock": payment_record},
            "$push": {"payments": payment_record},
        },
    )
    if not persisted.matched_count:
        # Do not return a provider URL after the link has been revoked or a
        # competing lifecycle action has won.  The provider session was never
        # distributed by Nexus and is kept out of invoice settlement bindings.
        raise HTTPException(status_code=410, detail="This payment link is no longer active")


async def _ensure_payment_transaction(
    *,
    link: dict[str, Any],
    invoice: dict[str, Any],
    collection: str,
    payment_record: dict[str, Any],
    provider_id_field: str,
    provider_id: str,
) -> None:
    """Persist exactly one Nexus binding for a provider payment attempt."""
    existing = await db.payment_transactions.find_one(
        {"payment_link_id": link["id"], "payment_link_payment_id": payment_record["id"]},
        {"_id": 0, "id": 1},
    )
    if not existing:
        await _create_payment_transaction(
            link=link,
            invoice=invoice,
            collection=collection,
            payment_record=payment_record,
            provider_id_field=provider_id_field,
            provider_id=provider_id,
        )


@router.post("/payment-links", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def create_payment_link(
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Create a client-scoped expiring capability for one invoice balance."""
    invoice_id = str(data.get("invoice_id") or "").strip()
    if not invoice_id:
        raise HTTPException(status_code=400, detail="invoice_id required")

    invoice, collection = await _find_invoice(invoice_id)
    if not invoice or not collection:
        raise HTTPException(status_code=404, detail="Invoice not found")
    await assert_client_scope(
        current_user,
        invoice.get("client_id"),
        operation="billing.invoice.payment_link.create",
        request=request,
        mask_not_found=True,
    )

    try:
        expires_days = int(data.get("expires_days", 14))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="expires_days must be a whole number") from None
    if not 1 <= expires_days <= 365:
        raise HTTPException(status_code=422, detail="expires_days must be between 1 and 365")
    allowed_methods = _normalise_allowed_methods(data.get("allowed_methods", ["card", "becs", "bank_transfer"]))

    balance = _invoice_balance(invoice)
    if balance <= 0:
        raise HTTPException(status_code=400, detail="Invoice already fully paid")
    if str(invoice.get("status") or "").strip().lower() in _CANCELLED_INVOICE_STATUSES:
        raise HTTPException(status_code=409, detail="Cannot create a payment link for a voided invoice")

    link = {
        "id": str(uuid.uuid4()),
        "token": secrets.token_urlsafe(32),
        "invoice_id": invoice_id,
        "invoice_collection": collection,
        "invoice_number": invoice.get("invoice_number", ""),
        "client_id": invoice.get("client_id"),
        "client_name": invoice.get("client_name", ""),
        "currency": _currency(invoice.get("currency", "AUD")),
        "total": _money(invoice.get("total", 0), field_name="Invoice total"),
        "balance_at_creation": balance,
        "allowed_methods": allowed_methods,
        "expires_at": (_now() + timedelta(days=expires_days)).isoformat(),
        "expires_days": expires_days,
        "status": "active",
        "created_at": _now_iso(),
        "created_by": current_user.get("name", "Admin"),
        "created_by_id": current_user.get("id"),
        "payments": [],
    }
    await db.payment_links.insert_one(link)
    await log_activity(
        current_user,
        "payment_link_created",
        "invoice",
        invoice_id,
        str(invoice.get("invoice_number") or invoice_id),
        metadata={"payment_link_id": link["id"], "client_id": invoice.get("client_id"), "expires_days": expires_days},
    )
    link.pop("_id", None)
    return link


@router.get("/payment-links", dependencies=[Depends(require_action("billing.portal.view"))])
async def list_payment_links(current_user: dict = Depends(get_current_user)):
    """List only links attached to invoices within the operator's client scope."""
    links = await db.payment_links.find(
        scoped_query(current_user, {}, site_field=None),
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    return [_operator_payment_link_record(link) for link in links]


@router.delete("/payment-links/{link_id}", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def revoke_payment_link(
    link_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Revoke an invoice-scoped link without deleting the audit record."""
    link, invoice, _collection = await _load_link_for_operator(
        link_id,
        current_user,
        operation="billing.invoice.payment_link.revoke",
        request=request,
    )
    if link.get("status") == "revoked":
        return {"message": "Payment link already revoked", "already_revoked": True}
    await db.payment_links.update_one(
        {"id": link_id},
        {"$set": {"status": "revoked", "revoked_at": _now_iso(), "revoked_by": current_user.get("id")}},
    )
    await log_activity(
        current_user,
        "payment_link_revoked",
        "invoice",
        str(invoice.get("id") or link.get("invoice_id")),
        str(invoice.get("invoice_number") or ""),
        metadata={"payment_link_id": link_id, "client_id": invoice.get("client_id")},
    )
    return {"message": "Payment link revoked"}


# ==================== PUBLIC ENDPOINTS (capability token only) ====================

@router.get("/pay/{token}")
async def get_payment_page_data(token: str):
    """Return the minimum payment-page data for an active capability token."""
    link, invoice, _collection, balance = await _load_public_link(token)

    bank_settings = await db.doc_branding_settings.find_one({"doc_type": "invoice"}, {"_id": 0})
    branding = bank_settings or {}
    return {
        "link_id": link["id"],
        "invoice_number": invoice.get("invoice_number", ""),
        "client_name": invoice.get("client_name", ""),
        "due_date": invoice.get("due_date", ""),
        "total": _money(invoice.get("total", 0), field_name="Invoice total"),
        "amount_paid": _money(invoice.get("amount_paid", 0), field_name="Invoice amount_paid"),
        "balance": balance,
        "line_items": invoice.get("line_items", []),
        "allowed_methods": link.get("allowed_methods", []),
        "payments": [_public_payment_record(payment) for payment in link.get("payments", [])],
        "expires_at": link.get("expires_at", ""),
        "bank_details": branding.get("bank_details", ""),
        "company_name": branding.get("company_name", ""),
        "payment_instructions": branding.get("payment_instructions", ""),
        "status": invoice.get("status", ""),
    }


async def _create_payment_transaction(
    *,
    link: dict[str, Any],
    invoice: dict[str, Any],
    collection: str,
    payment_record: dict[str, Any],
    provider_id_field: str,
    provider_id: str,
) -> None:
    """Persist a server-side payment binding before a provider callback arrives."""
    await db.payment_transactions.insert_one(
        {
            "id": str(uuid.uuid4()),
            "invoice_id": link["invoice_id"],
            "invoice_collection": collection,
            "client_id": invoice.get("client_id"),
            "payment_link_id": link["id"],
            "payment_link_payment_id": payment_record["id"],
            "provider_id_field": provider_id_field,
            provider_id_field: provider_id,
            "amount": payment_record["amount"],
            "amount_cents": int(round(float(payment_record["amount"]) * 100)),
            "currency": _currency(invoice.get("currency") or link.get("currency")),
            "payment_status": "initiated",
            "source": "payment_link",
            "created_at": _now_iso(),
        }
    )


@router.post("/pay/{token}/card")
async def pay_with_card(token: str, data: dict):
    """Create a Stripe checkout session bound to this public link only."""
    link, invoice, collection, balance = await _load_public_link(token)
    if "card" not in link.get("allowed_methods", []):
        raise HTTPException(status_code=400, detail="Card payments not allowed on this link")

    amount = _money(data.get("amount"), field_name="amount", allow_zero=False)
    if amount > balance + 0.01:
        raise HTTPException(status_code=400, detail=f"Amount exceeds balance of ${balance:.2f}")
    stripe_key = await _stripe_api_key()
    if not stripe_key:
        raise HTTPException(status_code=503, detail="Online card payments are not configured")

    from app.services.stripe_checkout import CheckoutSessionRequest, StripeCheckout

    # Callers may persist this non-secret key and replay after a network error;
    # Stripe receives the same provider idempotency key for that retry.
    supplied_key = str(data.get("idempotency_key") or "").strip()
    idempotency_key = supplied_key or _default_online_idempotency_key(link, method="card", amount=amount)
    if not 8 <= len(idempotency_key) <= 255:
        raise HTTPException(status_code=422, detail="idempotency_key must be between 8 and 255 characters")
    reservation, reused_attempt = await _reserve_online_payment_attempt(
        link=link,
        invoice=invoice,
        method="card",
        amount=amount,
        idempotency_key=idempotency_key,
    )
    payment_id = reservation["id"]
    # A completed initial request can return the same session for an explicit
    # retry without allocating a new Stripe Checkout session or transaction.
    if reused_attempt and reservation.get("stripe_session_id") and reservation.get("stripe_checkout_url"):
        await _ensure_payment_transaction(
            link=link,
            invoice=invoice,
            collection=collection,
            payment_record=reservation,
            provider_id_field="stripe_session_id",
            provider_id=str(reservation["stripe_session_id"]),
        )
        return {
            "url": reservation["stripe_checkout_url"],
            "session_id": reservation["stripe_session_id"],
            "idempotency_key": idempotency_key,
            "reused": True,
        }
    public_base = configured_public_base_url()
    checkout_req = CheckoutSessionRequest(
        amount=amount,
        currency=_currency(invoice.get("currency") or link.get("currency")),
        success_url=f"{public_base}/pay/{token}?payment_status=success&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{public_base}/pay/{token}?payment_status=cancelled",
        metadata={
            "payment_link_id": link["id"],
            "invoice_id": link["invoice_id"],
            "invoice_number": str(link.get("invoice_number") or ""),
        },
    )
    try:
        session = await StripeCheckout(api_key=stripe_key).create_checkout_session(
            checkout_req,
            idempotency_key=idempotency_key,
        )
    except Exception:
        # Provider error detail may include operational identifiers; retain it
        # only in provider-side logs, not in the public response.
        raise HTTPException(status_code=502, detail="Unable to start card payment") from None

    payment_record = {
        **reservation,
        "status": "pending",
        "stripe_session_id": session.session_id,
        "stripe_checkout_url": session.url,
        "initiated_at": _now_iso(),
    }
    await _persist_online_payment_attempt(link=link, payment_record=payment_record)
    await _ensure_payment_transaction(
        link=link,
        invoice=invoice,
        collection=collection,
        payment_record=payment_record,
        provider_id_field="stripe_session_id",
        provider_id=session.session_id,
    )
    return {"url": session.url, "session_id": session.session_id, "idempotency_key": idempotency_key}


@router.post("/pay/{token}/becs")
async def pay_with_becs(token: str, data: dict):
    """Create a bound BECS PaymentIntent; never persist the client secret."""
    link, invoice, collection, balance = await _load_public_link(token)
    if "becs" not in link.get("allowed_methods", []):
        raise HTTPException(status_code=400, detail="BECS Direct Debit not allowed on this link")

    amount = _money(data.get("amount"), field_name="amount", allow_zero=False)
    if amount > balance + 0.01:
        raise HTTPException(status_code=400, detail=f"Amount exceeds balance of ${balance:.2f}")
    stripe_key = await _stripe_api_key()
    if not stripe_key:
        raise HTTPException(status_code=503, detail="Online direct-debit payments are not configured")

    import stripe

    supplied_key = str(data.get("idempotency_key") or "").strip()
    idempotency_key = supplied_key or _default_online_idempotency_key(link, method="becs", amount=amount)
    if not 8 <= len(idempotency_key) <= 255:
        raise HTTPException(status_code=422, detail="idempotency_key must be between 8 and 255 characters")
    reservation, reused_attempt = await _reserve_online_payment_attempt(
        link=link,
        invoice=invoice,
        method="becs",
        amount=amount,
        idempotency_key=idempotency_key,
    )
    payment_id = reservation["id"]
    if reused_attempt and reservation.get("stripe_payment_intent_id") and reservation.get("stripe_client_secret"):
        await _ensure_payment_transaction(
            link=link,
            invoice=invoice,
            collection=collection,
            payment_record=reservation,
            provider_id_field="stripe_payment_intent_id",
            provider_id=str(reservation["stripe_payment_intent_id"]),
        )
        return {
            "client_secret": reservation["stripe_client_secret"],
            "payment_intent_id": reservation["stripe_payment_intent_id"],
            "idempotency_key": idempotency_key,
            "reused": True,
        }
    stripe.api_key = stripe_key
    try:
        intent = stripe.PaymentIntent.create(
            amount=int(round(amount * 100)),
            currency=_currency(invoice.get("currency") or link.get("currency")),
            payment_method_types=["au_becs_debit"],
            metadata={
                "payment_link_id": link["id"],
                "invoice_id": link["invoice_id"],
                "invoice_number": str(link.get("invoice_number") or ""),
            },
            idempotency_key=idempotency_key,
        )
    except Exception:
        raise HTTPException(status_code=502, detail="Unable to start direct-debit payment") from None

    payment_record = {
        **reservation,
        "status": "pending",
        "stripe_payment_intent_id": intent.id,
        "stripe_client_secret": intent.client_secret,
        "initiated_at": _now_iso(),
    }
    await _persist_online_payment_attempt(link=link, payment_record=payment_record)
    await _ensure_payment_transaction(
        link=link,
        invoice=invoice,
        collection=collection,
        payment_record=payment_record,
        provider_id_field="stripe_payment_intent_id",
        provider_id=intent.id,
    )
    return {
        "client_secret": intent.client_secret,
        "payment_intent_id": intent.id,
        "idempotency_key": idempotency_key,
    }


@router.post("/pay/{token}/bank-transfer")
async def record_bank_transfer(token: str, data: dict):
    """Record a bounded transfer claim for an authorised human to confirm."""
    link, _invoice, _collection, balance = await _load_public_link(token)
    if "bank_transfer" not in link.get("allowed_methods", []):
        raise HTTPException(status_code=400, detail="Bank transfer not allowed on this link")
    amount = _money(data.get("amount"), field_name="amount", allow_zero=False)
    if amount > balance + 0.01:
        raise HTTPException(status_code=400, detail=f"Amount exceeds balance of ${balance:.2f}")

    payment_record = {
        "id": str(uuid.uuid4()),
        "method": "bank_transfer",
        "amount": amount,
        "status": "awaiting_confirmation",
        "reference": str(data.get("reference") or "").strip()[:160],
        "payer_name": str(data.get("payer_name") or "").strip()[:160],
        "bank_name": str(data.get("bank_name") or "").strip()[:160],
        "initiated_at": _now_iso(),
    }
    await db.payment_links.update_one({"id": link["id"], "status": "active"}, {"$push": {"payments": payment_record}})
    return {
        "message": "Bank transfer recorded. The provider will confirm your payment.",
        "payment": _public_payment_record(payment_record),
    }


@router.get("/pay/{token}/confirm")
async def confirm_payment(token: str, session_id: str = ""):
    """Read payment progress; signed Stripe webhooks alone settle invoices."""
    link = await db.payment_links.find_one({"token": token}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=404, detail="Payment link not found")
    # A public confirmation URL remains a capability.  Do not allow an old
    # browser history entry to reveal payment state after an operator revokes
    # the link or it expires.  Completed links remain readable only until their
    # original expiry so the checkout success hand-off still works.
    if link.get("status") not in {"active", "completed"}:
        raise HTTPException(status_code=410, detail="This payment link is no longer active")
    expires_at = _as_utc(link.get("expires_at"))
    if expires_at is None or expires_at <= _now():
        if link.get("status") == "active":
            await db.payment_links.update_one(
                {"id": link.get("id"), "status": "active"},
                {"$set": {"status": "expired", "expired_at": _now_iso()}},
            )
        raise HTTPException(status_code=410, detail="This payment link has expired")
    clean_session_id = str(session_id or "").strip()
    if not clean_session_id:
        return {"status": "no_session"}

    payment = next(
        (item for item in link.get("payments", []) if item.get("stripe_session_id") == clean_session_id),
        None,
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment session not found")
    if payment.get("status") == "paid":
        return {"status": "paid", "amount": payment.get("amount", 0)}
    return {"status": "pending_confirmation"}


@router.post(
    "/payment-links/{link_id}/confirm-transfer",
    dependencies=[Depends(require_action("billing.payment.record"))],
)
async def admin_confirm_bank_transfer(
    link_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Confirm exactly one previously-recorded transfer, once, within scope."""
    payment_id = str(data.get("payment_id") or "").strip()
    if not payment_id:
        raise HTTPException(status_code=422, detail="payment_id required")
    link, invoice, collection = await _load_link_for_operator(
        link_id,
        current_user,
        operation="billing.payment.bank_transfer.confirm",
        request=request,
    )
    if str(invoice.get("status") or "").strip().lower() in _CANCELLED_INVOICE_STATUSES:
        raise HTTPException(status_code=409, detail="Cannot confirm a payment against a voided invoice")

    payments = list(link.get("payments", []))
    payment = next(
        (item for item in payments if item.get("id") == payment_id and item.get("status") == "awaiting_confirmation"),
        None,
    )
    if not payment:
        raise HTTPException(status_code=400, detail="Payment not found or already confirmed")
    paid_amount = _money(payment.get("amount"), field_name="Stored payment amount", allow_zero=False)
    balance = _invoice_balance(invoice)
    if paid_amount > balance + 0.01:
        raise HTTPException(status_code=409, detail="Payment exceeds the outstanding invoice balance")

    total = _money(invoice.get("total", 0), field_name="Invoice total")
    original_paid = _money(invoice.get("amount_paid", 0), field_name="Invoice amount_paid")
    new_paid = round(original_paid + paid_amount, 2)
    is_fully_paid = new_paid >= total - 0.01
    update_fields: dict[str, Any] = {
        "amount_paid": new_paid,
        "amount_due": round(total - new_paid, 2),
        "payment_status": "paid" if is_fully_paid else "partial",
    }
    if is_fully_paid:
        update_fields.update({"status": "PAID", "paid_date": _now().strftime("%Y-%m-%d")})

    now = _now_iso()

    payment_entry = {
        "amount": paid_amount,
        "method": "bank_transfer",
        "date": now,
        "reference": f"Bank Transfer - confirmed by {current_user.get('name', 'Admin')}",
        "payment_link_id": link_id,
        "payment_link_payment_id": payment_id,
    }
    invoice_collection = db.xero_invoices if collection == "xero_invoices" else db.invoices
    # Settle the bound invoice first with an optimistic balance guard.  This
    # avoids recording a paid link if the invoice has changed concurrently or
    # is no longer within the operator's original client boundary.
    invoice_updated = await invoice_collection.update_one(
        {
            "id": link["invoice_id"],
            "client_id": invoice.get("client_id"),
            "amount_paid": invoice.get("amount_paid", 0),
        },
        {"$set": update_fields, "$push": {"payments": payment_entry}},
    )
    if invoice_updated.matched_count == 0:
        raise HTTPException(status_code=409, detail="Invoice changed before payment confirmation; refresh and retry")

    for item in payments:
        if item.get("id") == payment_id:
            item.update({"status": "paid", "confirmed_at": now, "confirmed_by": current_user.get("name", "Admin"), "confirmed_by_id": current_user.get("id")})
            break
    link_update: dict[str, Any] = {"payments": payments}
    # Do not reactivate a link that may have been revoked while the payment was
    # being confirmed, but a settled invoice can close an otherwise active link.
    if is_fully_paid and link.get("status") == "active":
        link_update.update({"status": "completed", "completed_at": now})
    await db.payment_links.update_one({"id": link_id}, {"$set": link_update})
    await log_activity(
        current_user,
        "bank_transfer_confirmed",
        "invoice",
        str(invoice.get("id") or link.get("invoice_id")),
        str(invoice.get("invoice_number") or ""),
        metadata={"payment_link_id": link_id, "payment_id": payment_id, "amount": paid_amount},
    )
    return {"message": "Bank transfer confirmed", "amount": paid_amount}
