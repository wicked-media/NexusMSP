"""Smart Invoice Engine Ã¢â‚¬â€ AI Draft, Payment Plans, Smart Reminders, Late Fees,
Bulk Operations, Customer Statements, Aged-AR Insights, Reissue, Pay-Now Links,
Webhook events.

All endpoints prefixed with /api by server.py auto-discovery.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import os
import re
import uuid
import json
import logging
import asyncio
import math
import hashlib

from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity
from app.services.scope_permissions import assert_client_scope, assert_global_scope, scoped_query
from app.services.action_permissions import evaluate_action_permission, require_action
from app.services.commercial_documents import (
    freeze_commercial_document_snapshot,
    get_commercial_document_branding,
)
from app.services.public_url import configured_public_base_url
from app.services.webhook_security import redact_webhook_for_response, validate_legacy_webhook_url

logger = logging.getLogger(__name__)
router = APIRouter()


# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

from app.services.time_utils import now_iso as _now_iso


from app.services.time_utils import parse_date_compact as _parse_date


async def _ai_chat(session_id: str, system_msg: str):
    """Use the centrally configured OpenAI model for invoice AI features."""
    from app.services.ai_provider import LlmChat
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(500, "AI key not configured")
    cfg = await db.settings.find_one({"type": "ai_config"}, {"_id": 0}) or {}
    provider = "openai"
    model = cfg.get("model", "gpt-5.6-terra")
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system_msg)
    chat.with_model(provider, model)
    return chat


async def _scoped_invoice(invoice_id: str, current_user: dict, operation: str) -> dict:
    """Load an invoice and prove the actor may operate on its client first."""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    await assert_client_scope(current_user, invoice.get("client_id"), operation=operation, mask_not_found=True)
    return invoice


def _bounded_int(value: object, field: str, *, minimum: int, maximum: int) -> int:
    """Parse a bounded integer without silently accepting booleans or floats."""
    if isinstance(value, bool):
        raise HTTPException(422, f"{field} must be an integer")
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        raise HTTPException(422, f"{field} must be an integer") from None
    if str(value).strip() != str(parsed):
        raise HTTPException(422, f"{field} must be an integer")
    if not minimum <= parsed <= maximum:
        raise HTTPException(422, f"{field} must be between {minimum} and {maximum}")
    return parsed


def _bounded_amount(value: object, field: str, *, minimum: float, maximum: float) -> float:
    """Parse a finite financial amount and keep it within the allowed range."""
    if isinstance(value, bool):
        raise HTTPException(422, f"{field} must be a number")
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise HTTPException(422, f"{field} must be a number") from None
    if not math.isfinite(parsed) or not minimum <= parsed <= maximum:
        raise HTTPException(422, f"{field} must be between {minimum:g} and {maximum:g}")
    return parsed


def _outstanding_balance(invoice: dict, operation: str) -> float:
    """Refuse financial mutations on terminal or already-settled invoices."""
    status = str(invoice.get("status") or "").strip().lower()
    payment_status = str(invoice.get("payment_status") or "").strip().lower()
    if status in {"cancelled", "voided", "paid"} or payment_status == "paid":
        raise HTTPException(409, f"Cannot {operation} on a terminal invoice")

    total = _bounded_amount(invoice.get("total") or 0, "invoice total", minimum=0, maximum=1_000_000_000)
    paid = _bounded_amount(invoice.get("amount_paid") or 0, "invoice amount paid", minimum=0, maximum=1_000_000_000)
    balance = round(total - paid, 2)
    if balance <= 0:
        raise HTTPException(409, f"Cannot {operation} on an invoice without an outstanding balance")
    return balance


async def _require_runtime_action(current_user: dict, permission_id: str) -> None:
    """Apply a dynamic action policy where a path parameter selects the mutation.

    FastAPI route dependencies cover the common invoice-modification boundary.
    Bulk actions additionally need a policy selected from the requested action;
    checking it here avoids treating a bulk void as an ordinary modification.
    """
    result = await evaluate_action_permission(current_user, permission_id)
    if result["allowed"]:
        return
    await db.permission_denials.insert_one(
        {
            "permission": permission_id,
            "user_id": current_user.get("id"),
            "user_name": current_user.get("name"),
            "role": current_user.get("role"),
            "source": result.get("source"),
            "operation": "billing.invoice.smart",
            "occurred_at": _now_iso(),
        }
    )
    raise HTTPException(
        status_code=403,
        detail=f"Action permission required: {permission_id}",
        headers={"X-Required-Permission": permission_id},
    )


def _normalise_invoice_ids(value: object) -> list[str]:
    if not isinstance(value, list):
        raise HTTPException(422, "invoice_ids must be an array")
    ids = [item.strip() for item in value if isinstance(item, str) and item.strip()]
    if not ids:
        raise HTTPException(422, "invoice_ids required")
    if len(ids) > 100:
        raise HTTPException(422, "bulk actions support at most 100 invoices")
    if len(ids) != len(value) or len(set(ids)) != len(ids):
        raise HTTPException(422, "invoice_ids must contain unique non-empty identifiers")
    return ids


def _invoice_write_filter(invoice: dict) -> dict:
    """Bind an invoice mutation to its scoped identity and observed version.

    Older documents may not yet carry a ``version`` field.  Treating that as an
    explicit expected state lets the first protected mutation initialise the
    counter without weakening the optimistic-concurrency boundary.
    """
    invoice_id = str(invoice.get("id") or "").strip()
    client_id = str(invoice.get("client_id") or "").strip()
    if not invoice_id or not client_id:
        raise HTTPException(409, "Invoice is missing stable ownership metadata")
    query: dict = {"id": invoice_id, "client_id": client_id}
    version = invoice.get("version")
    query["version"] = version if version is not None else {"$exists": False}
    return query


async def _update_invoice_or_conflict(invoice: dict, update: dict, *, operation: str) -> None:
    """Apply a scoped optimistic invoice mutation or expose a safe retry signal."""
    update = dict(update)
    update.setdefault("$set", {})["updated_at"] = _now_iso()
    update.setdefault("$inc", {})["version"] = 1
    result = await db.invoices.update_one(_invoice_write_filter(invoice), update)
    if not result.matched_count:
        raise HTTPException(409, f"Invoice changed while attempting to {operation}; refresh and retry")


def _normalise_bool(value: object, field: str, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes"}:
            return True
        if lowered in {"false", "0", "no"}:
            return False
    raise HTTPException(422, f"{field} must be a boolean")


def _late_fee_details(invoice: dict, data: dict) -> tuple[float, float, list[dict], float, str, float]:
    """Validate a late fee and return the exact invoice update values.

    Fees are calculated against the current unpaid balance, not the historical
    invoice total, so a partial payment cannot be charged again.
    """
    balance = _outstanding_balance(invoice, "apply a late fee")
    fee_type = str(data.get("type", "percent")).strip().lower()
    if fee_type not in {"percent", "flat"}:
        raise HTTPException(422, "type must be 'percent' or 'flat'")
    maximum = 100 if fee_type == "percent" else balance
    value = _bounded_amount(data.get("value", 5), "value", minimum=0.01, maximum=maximum)
    fee = round(balance * value / 100, 2) if fee_type == "percent" else round(value, 2)
    if fee <= 0:
        raise HTTPException(422, "late fee must be greater than zero")
    current_total = _bounded_amount(invoice.get("total") or 0, "invoice total", minimum=0, maximum=1_000_000_000)
    subtotal = _bounded_amount(invoice.get("subtotal") or current_total, "invoice subtotal", minimum=0, maximum=1_000_000_000)
    items = list(invoice.get("line_items") or invoice.get("items") or [])
    items.append(
        {
            "description": f"Late payment fee ({value:g}{'%' if fee_type == 'percent' else ' flat'})",
            "quantity": 1,
            "unit_price": fee,
            "total": fee,
            "kind": "late_fee",
        }
    )
    return fee, round(current_total + fee, 2), items, round(subtotal + fee, 2), fee_type, value


def _checkout_idempotency_key(invoice: dict, balance: float, currency: str) -> str:
    version = invoice.get("version")
    material = ":".join(
        (
            "nexus-invoice-smart-checkout-v1",
            str(invoice.get("id") or ""),
            str(invoice.get("client_id") or ""),
            str(version if version is not None else "legacy"),
            f"{balance:.2f}",
            currency.lower(),
        )
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜   1) AI DRAFT INVOICE Ã¢â‚¬â€ from tickets / time entries / contracts  Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

@router.post("/invoices/ai-draft")
async def ai_draft_invoice(data: dict, current_user: dict = Depends(get_current_user)):
    """Generate an invoice draft from selected ticket_ids / time_entry_ids / a period.

    Body:
      client_id (required)
      ticket_ids: [str]           (optional)
      time_entry_ids: [str]       (optional)
      period_start, period_end: 'YYYY-MM-DD' (optional)
      include_recurring: bool     (also pull active recurring streams for client)
    """
    client_id = data.get("client_id")
    if not client_id:
        raise HTTPException(400, "client_id required")
    await assert_client_scope(current_user, client_id, operation="billing.invoice.ai_draft", mask_not_found=True)
    client_doc = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client_doc:
        raise HTTPException(404, "Client not found")

    ticket_ids = data.get("ticket_ids") or []
    time_entry_ids = data.get("time_entry_ids") or []
    period_start = _parse_date(data.get("period_start", ""))
    period_end = _parse_date(data.get("period_end", ""))
    include_recurring = bool(data.get("include_recurring"))

    # Gather time entries
    te_query = {"client_id": client_id}
    if time_entry_ids:
        te_query["id"] = {"$in": time_entry_ids}
    elif ticket_ids:
        te_query["ticket_id"] = {"$in": ticket_ids}
    elif period_start and period_end:
        te_query["started_at"] = {"$gte": period_start.isoformat(), "$lte": period_end.isoformat()}
    time_entries = await db.time_entries.find(te_query, {"_id": 0}).to_list(2000)

    # Gather tickets
    t_query = {"client_id": client_id, "billable": True, "invoiced": {"$ne": True}}
    if ticket_ids:
        t_query["id"] = {"$in": ticket_ids}
    elif period_start and period_end:
        t_query["created_at"] = {"$gte": period_start.isoformat(), "$lte": period_end.isoformat()}
    tickets = await db.tickets.find(t_query, {"_id": 0}).to_list(500)

    # Build line items
    line_items = []
    # 1. Time entries Ã¢â€ â€™ grouped per ticket
    by_ticket = {}
    for te in time_entries:
        tk = te.get("ticket_id") or "general"
        by_ticket.setdefault(tk, {"hours": 0, "rate": float(te.get("rate") or 150), "desc": te.get("description") or te.get("ticket_title") or "Billable work"})
        by_ticket[tk]["hours"] += float(te.get("hours") or te.get("duration_hours") or 0)
    for tk, agg in by_ticket.items():
        hrs = round(agg["hours"], 2)
        if hrs <= 0:
            continue
        amt = round(hrs * agg["rate"], 2)
        line_items.append({
            "description": f"{agg['desc']} (Ticket {tk})" if tk != "general" else agg["desc"],
            "quantity": hrs, "unit_price": agg["rate"], "total": amt,
            "source": "time_entry",
        })

    # 2. Recurring streams (if requested)
    if include_recurring:
        ris = await db.recurring_invoices.find({"client_id": client_id, "status": "active"}, {"_id": 0}).to_list(50)
        for ri in ris:
            for li in (ri.get("line_items") or []):
                qty = float(li.get("quantity") or 1)
                rate = float(li.get("rate") or 0)
                amt = float(li.get("amount") or (qty * rate))
                line_items.append({
                    "description": f"{li.get('description', '')} Ã¢â‚¬â€ {ri.get('description', 'Recurring')}",
                    "quantity": qty, "unit_price": rate, "total": amt,
                    "source": "recurring",
                })
                # Normalise the user-facing source label independently of older
                # seeded text so invoice drafts cannot expose mojibake.
                line_items[-1]["description"] = f"{li.get('description', '')} - {ri.get('description', 'Recurring')}"

    if not line_items:
        # Fallback: ticket-only flat fee
        for t in tickets:
            line_items.append({
                "description": f"Ticket #{t.get('ticket_number', t.get('id'))}: {t.get('title', '')}",
                "quantity": 1, "unit_price": 0, "total": 0, "source": "ticket",
            })

    subtotal = sum(li["total"] for li in line_items)
    tax_rate = float(client_doc.get("tax_rate") or 10.0)
    tax = round(subtotal * tax_rate / 100, 2)
    total = round(subtotal + tax, 2)

    # AI summary line (optional notes)
    ai_notes = ""
    try:
        from app.services.ai_provider import UserMessage
        if line_items and (tickets or time_entries):
            sys = "You are a professional MSP billing assistant. Write a 2-sentence value summary for a customer invoice covering the work done. Be specific, friendly, professional."
            prompt = json.dumps({
                "client_name": client_doc.get("name"),
                "line_items": line_items[:10],
                "tickets": [{"title": t.get("title"), "priority": t.get("priority")} for t in tickets[:10]],
                "hours": sum(li["quantity"] for li in line_items if li.get("source") == "time_entry"),
            })
            chat = await _ai_chat(f"invdraft-{uuid.uuid4().hex[:8]}", sys)
            resp = await chat.send_message(UserMessage(text=prompt))
            ai_notes = resp.strip()[:600]
    except Exception as e:
        logger.warning(f"AI draft summary failed: {e}")

    draft = {
        "client_id": client_id,
        "client_name": client_doc.get("name"),
        "line_items": line_items,
        "subtotal": round(subtotal, 2),
        "tax": tax,
        "tax_rate": tax_rate,
        "total": total,
        "currency": client_doc.get("currency", "AUD"),
        "ai_notes": ai_notes,
        "source_tickets": [t.get("id") for t in tickets],
        "source_time_entries": [te.get("id") for te in time_entries],
    }
    return draft


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜   2) PAYMENT PLANS / INSTALLMENTS                                 Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

@router.post("/invoices/{invoice_id}/payment-plan", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def create_payment_plan(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Split an invoice into N installments with auto-due-date schedule."""
    invoice = await _scoped_invoice(invoice_id, current_user, "billing.invoice.payment_plan.create")
    balance = _outstanding_balance(invoice, "create a payment plan")
    n = _bounded_int(data.get("installments", 3), "installments", minimum=2, maximum=12)
    interval_days = _bounded_int(data.get("interval_days", 30), "interval_days", minimum=1, maximum=365)

    # Creating a second active schedule can lead staff to collect the same
    # balance twice.  The original creation endpoint did not have an explicit
    # replacement flow, so repeated submissions are idempotent.
    existing = await db.invoice_payment_plans.find_one(
        {"invoice_id": invoice_id, "status": "active"}, {"_id": 0}
    )
    if existing:
        if existing.get("client_id") and existing.get("client_id") != invoice.get("client_id"):
            raise HTTPException(409, "Payment-plan ownership does not match its invoice")
        return existing

    per = round(balance / n, 2)
    schedule = []
    base = _parse_date(invoice.get("due_date", "")) or datetime.now(timezone.utc)
    for i in range(n):
        due = base + timedelta(days=interval_days * i)
        amt = per if i < n - 1 else round(balance - per * (n - 1), 2)
        schedule.append({
            "id": str(uuid.uuid4()),
            "installment_no": i + 1,
            "due_date": due.strftime("%Y-%m-%d"),
            "amount": amt,
            "status": "pending",
        })
    plan = {
        "id": str(uuid.uuid4()),
        "invoice_id": invoice_id,
        "client_id": invoice.get("client_id"),
        "installments": n,
        "interval_days": interval_days,
        "schedule": schedule,
        "created_at": _now_iso(),
        "created_by": current_user.get("name"),
        "status": "active",
        "version": 1,
    }
    await db.invoice_payment_plans.insert_one(plan)
    plan.pop("_id", None)
    invoice_filter = _invoice_write_filter(invoice)
    invoice_filter["has_payment_plan"] = {"$ne": True}
    result = await db.invoices.update_one(
        invoice_filter,
        {
            "$set": {
                "payment_plan_id": plan["id"],
                "has_payment_plan": True,
                "updated_at": _now_iso(),
            },
            "$inc": {"version": 1},
        },
    )
    if not result.matched_count:
        await db.invoice_payment_plans.delete_one({"id": plan["id"]})
        raise HTTPException(409, "Invoice changed or already has a payment plan; refresh and retry")
    await log_activity(current_user, "payment_plan_created", "invoice", invoice_id, invoice.get("invoice_number", ""), f"Plan: {n} x ${per:.2f}")
    return plan


@router.get("/invoices/{invoice_id}/payment-plan", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_payment_plan(invoice_id: str, current_user: dict = Depends(get_current_user)):
    await _scoped_invoice(invoice_id, current_user, "billing.invoice.payment_plan.read")
    plan = await db.invoice_payment_plans.find_one({"invoice_id": invoice_id, "status": "active"}, {"_id": 0})
    if not plan:
        return None
    return plan


@router.post(
    "/invoices/payment-plan/{plan_id}/mark-paid/{installment_id}",
    dependencies=[Depends(require_action("billing.payment.record"))],
)
async def mark_installment_paid(plan_id: str, installment_id: str, current_user: dict = Depends(get_current_user)):
    plan = await db.invoice_payment_plans.find_one({"id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(404, "Plan not found")
    invoice = await _scoped_invoice(str(plan.get("invoice_id") or ""), current_user, "billing.invoice.payment_plan.mark_paid")
    _outstanding_balance(invoice, "mark a payment-plan installment as paid")
    if plan.get("client_id") and plan.get("client_id") != invoice.get("client_id"):
        raise HTTPException(409, "Payment-plan ownership does not match its invoice")

    schedule = plan.get("schedule")
    if not isinstance(schedule, list):
        raise HTTPException(409, "Payment plan has an invalid installment schedule")
    updated = False
    installment_amount = None
    for ins in schedule:
        if not isinstance(ins, dict):
            continue
        if ins.get("id") == installment_id and ins.get("status") != "paid":
            ins["status"] = "paid"
            ins["paid_at"] = _now_iso()
            ins["paid_by"] = current_user.get("name")
            installment_amount = ins.get("amount")
            updated = True
            break
    if not updated:
        raise HTTPException(400, "Installment already paid or not found")
    plan_filter = {"id": plan_id, "status": "active"}
    plan_filter["version"] = plan.get("version") if plan.get("version") is not None else {"$exists": False}
    result = await db.invoice_payment_plans.update_one(
        plan_filter,
        {"$set": {"schedule": schedule, "updated_at": _now_iso()}, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(409, "Payment plan changed while recording the installment; refresh and retry")
    await log_activity(
        current_user,
        "payment_plan_installment_marked_paid",
        "invoice",
        invoice["id"],
        invoice.get("invoice_number", ""),
        f"Installment {installment_id} marked paid ({installment_amount})",
        metadata={"payment_plan_id": plan_id, "installment_id": installment_id},
    )
    return {"success": True}


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜   3) LATE FEES                                                    Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

@router.post("/invoices/{invoice_id}/apply-late-fee", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def apply_late_fee(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    invoice = await _scoped_invoice(invoice_id, current_user, "billing.invoice.late_fee.apply")
    if invoice.get("late_fee_applied"):
        raise HTTPException(409, "A late fee has already been applied to this invoice")
    fee, new_total, new_items, new_subtotal, fee_type, value = _late_fee_details(invoice, data)
    update_filter = _invoice_write_filter(invoice)
    update_filter["late_fee_applied"] = {"$ne": True}
    result = await db.invoices.update_one(
        update_filter,
        {
            "$set": {
                "line_items": new_items,
                "items": new_items,
                "total": new_total,
                "subtotal": new_subtotal,
                "late_fee_applied": True,
                "late_fee_amount": fee,
                "late_fee_type": fee_type,
                "late_fee_value": value,
                "late_fee_at": _now_iso(),
                "updated_at": _now_iso(),
            },
            "$inc": {"version": 1},
        },
    )
    if not result.matched_count:
        raise HTTPException(409, "Invoice changed or already has a late fee; refresh and retry")
    await log_activity(current_user, "late_fee_applied", "invoice", invoice_id, invoice.get("invoice_number", ""), f"+${fee:.2f}")
    return {"success": True, "fee": fee, "new_total": new_total}


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜   4) SMART REMINDERS Ã¢â‚¬â€ escalating 3/7/14/30 day tone              Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

REMINDER_TONES = {
    "first": "Friendly nudge. Mention the invoice number, amount, due date, link to pay.",
    "second": "Polite reminder, slightly more direct, ask if there's a problem we can help with.",
    "third": "Firm but professional. Mention late fees policy. Offer payment plan.",
    "final": "Final notice. State next steps (service suspension / collections) if not paid in 7 days.",
}


@router.post("/invoices/{invoice_id}/smart-reminder", dependencies=[Depends(require_action("billing.portal.reminder.send"))])
async def smart_reminder(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Generate AI-drafted reminder copy based on age & history; optionally send."""
    invoice = await _scoped_invoice(invoice_id, current_user, "billing.invoice.reminder.send")
    _outstanding_balance(invoice, "draft a payment reminder")
    due = _parse_date(invoice.get("due_date", ""))
    age = (datetime.now(timezone.utc) - (due or datetime.now(timezone.utc))).days if due else 0
    history = await db.invoice_emails.find(
        {"invoice_id": invoice_id, "client_id": invoice.get("client_id"), "kind": "reminder"},
        {"_id": 0},
    ).to_list(20)
    stage = str(data.get("stage") or "").strip().lower() or None
    if not stage:
        if age <= 3:
            stage = "first"
        elif age <= 10:
            stage = "second"
        elif age <= 21:
            stage = "third"
        else:
            stage = "final"
    elif stage not in REMINDER_TONES:
        raise HTTPException(422, f"stage must be one of {sorted(REMINDER_TONES)}")
    tone = REMINDER_TONES.get(stage, REMINDER_TONES["first"])
    sys = "You draft polite, professional MSP payment reminders. Keep under 120 words. Tone instruction: " + tone
    prompt = json.dumps({
        "invoice_number": invoice.get("invoice_number"),
        "client_name": invoice.get("client_name"),
        "amount": invoice.get("total"),
        "currency": invoice.get("currency", "AUD"),
        "due_date": invoice.get("due_date"),
        "days_overdue": max(0, age),
        "prior_reminders_sent": len(history),
        "stage": stage,
    })
    try:
        from app.services.ai_provider import UserMessage
        chat = await _ai_chat(f"reminder-{invoice_id}-{stage}", sys)
        resp = await chat.send_message(UserMessage(text=prompt))
        body = resp.strip()
    except Exception as e:
        logger.warning(f"reminder AI failed: {e}")
        body = f"Hi {invoice.get('client_name', 'team')},\n\nFriendly reminder that Invoice {invoice.get('invoice_number')} (${invoice.get('total')}) was due on {invoice.get('due_date')}.\nLet us know if you have any questions.\n\nThanks!"
    subject = f"Reminder: Invoice {invoice.get('invoice_number')} - {invoice.get('currency', 'AUD')} {invoice.get('total')}"
    await log_activity(
        current_user,
        "invoice_reminder_drafted",
        "invoice",
        invoice_id,
        invoice.get("invoice_number", ""),
        f"{stage} payment reminder drafted",
        metadata={"stage": stage, "days_overdue": max(0, age)},
    )
    return {"stage": stage, "subject": subject, "body": body, "days_overdue": max(0, age)}


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜   5) REISSUE FROM PRIOR PERIOD                                    Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

@router.post("/invoices/{invoice_id}/reissue", dependencies=[Depends(require_action("billing.invoice.create"))])
async def reissue_invoice(invoice_id: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    original = await _scoped_invoice(invoice_id, current_user, "billing.invoice.reissue")
    _outstanding_balance(original, "reissue an invoice")
    if _bounded_amount(original.get("amount_paid") or 0, "invoice amount paid", minimum=0, maximum=1_000_000_000) > 0:
        raise HTTPException(409, "A partially paid invoice cannot be reissued; reconcile or credit it first")
    # Generate next invoice number
    last = await db.invoices.find({}, {"_id": 0, "invoice_number": 1}).sort("created_at", -1).limit(1).to_list(1)
    last_num = 0
    if last:
        m = re.search(r"(\d+)$", str(last[0].get("invoice_number", "INV-0000")))
        last_num = int(m.group(1)) if m else 0
    new_no = f"INV-{last_num + 1:05d}"
    new = {**original}
    new.pop("_id", None)
    new["id"] = str(uuid.uuid4())
    new["invoice_number"] = new_no
    new["status"] = "draft"
    new["payment_status"] = "unpaid"
    new["amount_paid"] = 0
    new["version"] = 1
    new["created_at"] = _now_iso()
    new["updated_at"] = _now_iso()
    new["reissued_from"] = invoice_id
    # A reissued invoice must never inherit an old payment capability, plan,
    # provider reference or audit result from its source invoice.
    for field in (
        "payment_link",
        "payment_link_session_id",
        "payment_link_created_at",
        "payment_plan_id",
        "has_payment_plan",
        "stripe_session_id",
        "stripe_payment_intent_id",
        "payment_attempts",
        "payments",
    ):
        new.pop(field, None)
    due_offset = _bounded_int((data or {}).get("due_days", 14), "due_days", minimum=1, maximum=365)
    new["due_date"] = (datetime.now(timezone.utc) + timedelta(days=due_offset)).strftime("%Y-%m-%d")
    new["issue_date"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.invoices.insert_one(new)
    new.pop("_id", None)
    await log_activity(current_user, "reissued", "invoice", new["id"], new_no, f"Reissued from {original.get('invoice_number')}")
    return new


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜   6) BULK OPERATIONS                                              Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

@router.post("/invoices/bulk/{action}", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def bulk_invoice_action(action: str, data: dict, current_user: dict = Depends(get_current_user)):
    if not isinstance(data, dict):
        raise HTTPException(422, "request body must be an object")
    if not data.get("invoice_ids"):
        raise HTTPException(400, "invoice_ids required")
    ids = _normalise_invoice_ids(data.get("invoice_ids"))
    valid_actions = {"send", "void", "discount", "apply-late-fee", "mark-sent", "reissue"}
    if action not in valid_actions:
        raise HTTPException(400, f"action must be one of {sorted(valid_actions)}")

    action_permission = {
        "void": "billing.invoice.void",
        "reissue": "billing.invoice.create",
    }.get(action)
    if action_permission:
        await _require_runtime_action(current_user, action_permission)

    # Scope every target before mutating any target.  This avoids partially
    # completing a multi-invoice action when a tampered ID is mixed in.
    invoices = await db.invoices.find({"id": {"$in": ids}}, {"_id": 0}).to_list(len(ids))
    invoices_by_id = {str(invoice.get("id")): invoice for invoice in invoices}
    missing = [invoice_id for invoice_id in ids if invoice_id not in invoices_by_id]
    if missing:
        raise HTTPException(404, "One or more invoices were not found")
    ordered_invoices = [invoices_by_id[invoice_id] for invoice_id in ids]
    for invoice in ordered_invoices:
        await assert_client_scope(
            current_user,
            invoice.get("client_id"),
            operation=f"billing.invoice.bulk.{action}",
            mask_not_found=True,
        )

    commercial_branding = None
    if action in {"send", "mark-sent"}:
        commercial_branding = await get_commercial_document_branding(database=db)

    discount_pct = None
    late_fee_pct = None
    if action == "discount":
        discount_pct = _bounded_amount(data.get("discount_pct", 0), "discount_pct", minimum=0, maximum=100)
    elif action == "apply-late-fee":
        late_fee_pct = _bounded_amount(data.get("fee_pct", 5), "fee_pct", minimum=0.01, maximum=100)

    results = {"processed": 0, "failed": 0, "details": []}
    for inv in ordered_invoices:
        inv_id = str(inv["id"])
        try:
            if action == "void":
                if str(inv.get("payment_status") or "").lower() in {"paid", "partial"} or str(inv.get("status") or "").lower() in {"cancelled", "voided"}:
                    raise ValueError("Paid, partially paid, or already voided invoices cannot be bulk voided")
                reason = str(data.get("reason") or "Bulk void").strip()[:500] or "Bulk void"
                await _update_invoice_or_conflict(
                    inv,
                    {
                        "$set": {
                            "status": "cancelled",
                            "voided_at": _now_iso(),
                            "voided_by": current_user.get("name"),
                            "void_reason": reason,
                        }
                    },
                    operation="bulk void the invoice",
                )
            elif action == "discount":
                _outstanding_balance(inv, "apply a discount")
                total = _bounded_amount(inv.get("total") or 0, "invoice total", minimum=0, maximum=1_000_000_000)
                paid = _bounded_amount(inv.get("amount_paid") or 0, "invoice amount paid", minimum=0, maximum=1_000_000_000)
                new_total = round(total * (1 - discount_pct / 100), 2)
                if new_total < paid:
                    raise ValueError("Discount cannot reduce the invoice below its recorded payments")
                await _update_invoice_or_conflict(
                    inv,
                    {
                        "$set": {
                            "total": new_total,
                            "discount_pct": discount_pct,
                            "discount_applied_at": _now_iso(),
                            "discount_applied_by": current_user.get("name"),
                        }
                    },
                    operation="apply a bulk discount",
                )
            elif action == "apply-late-fee":
                await apply_late_fee(inv_id, {"type": "percent", "value": late_fee_pct}, current_user)
            elif action in ("send", "mark-sent"):
                if str(inv.get("payment_status") or "").lower() == "paid" or str(inv.get("status") or "").lower() in {"cancelled", "voided"}:
                    raise ValueError("Paid, cancelled, or voided invoices cannot be sent")
                snapshot = inv.get("document_snapshot")
                if not isinstance(snapshot, dict):
                    snapshot = await freeze_commercial_document_snapshot(
                        "invoice",
                        inv,
                        commercial_branding,
                        database=db,
                    )
                await _update_invoice_or_conflict(
                    inv,
                    {"$set": {
                        "status": "sent",
                        "sent_at": _now_iso(),
                        "sent_by": current_user.get("name"),
                        "document_snapshot": snapshot,
                    }},
                    operation="mark the invoice sent",
                )
            elif action == "reissue":
                await reissue_invoice(inv_id, {"due_days": data.get("due_days", 14)}, current_user)
            if action not in {"apply-late-fee", "reissue"}:
                await log_activity(
                    current_user,
                    f"bulk_{action}_applied",
                    "invoice",
                    inv_id,
                    inv.get("invoice_number", ""),
                    f"Bulk {action} applied",
                )
            results["processed"] += 1
            results["details"].append({"id": inv_id, "ok": True})
        except (HTTPException, ValueError) as exc:
            results["failed"] += 1
            results["details"].append({"id": inv_id, "ok": False, "error": str(exc)})
        except Exception:
            logger.exception("invoice_smart_bulk_action_failed action=%s invoice_id=%s", action, inv_id)
            results["failed"] += 1
            results["details"].append({"id": inv_id, "ok": False, "error": "Unable to process invoice"})
    await log_activity(current_user, f"bulk_{action}", "invoice", "multiple", f"{results['processed']} invoices", f"{results['processed']}/{len(ids)} processed")
    return results


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜   7) CUSTOMER STATEMENT PDF                                       Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

@router.get("/invoices/customer-statement/{client_id}")
async def customer_statement(client_id: str, current_user: dict = Depends(get_current_user)):
    """Return a rollup of unpaid invoices + aged bucket data (JSON)."""
    await assert_client_scope(current_user, client_id, operation="billing.customer_statement.read", mask_not_found=True)
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    invoices = await db.invoices.find({"client_id": client_id, "payment_status": {"$ne": "paid"}, "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(2000)
    now = datetime.now(timezone.utc)
    buckets = {"current": 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0}
    rows = []
    for inv in invoices:
        bal = float(inv.get("total") or 0) - float(inv.get("amount_paid") or 0)
        if bal <= 0:
            continue
        due = _parse_date(inv.get("due_date", ""))
        days_overdue = (now - due).days if due else 0
        if days_overdue <= 0:
            buckets["current"] += bal
        elif days_overdue <= 30:
            buckets["1_30"] += bal
        elif days_overdue <= 60:
            buckets["31_60"] += bal
        elif days_overdue <= 90:
            buckets["61_90"] += bal
        else:
            buckets["90_plus"] += bal
        rows.append({
            "invoice_number": inv.get("invoice_number"),
            "issue_date": inv.get("issue_date") or inv.get("created_at"),
            "due_date": inv.get("due_date"),
            "total": float(inv.get("total") or 0),
            "balance": bal,
            "days_overdue": max(0, days_overdue),
        })
    return {
        "client_id": client_id,
        "client_name": client.get("name"),
        "as_of": now.isoformat(),
        "total_due": round(sum(buckets.values()), 2),
        "buckets": {k: round(v, 2) for k, v in buckets.items()},
        "rows": rows,
    }


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜   8) AGED-AR AI INSIGHTS                                          Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

@router.get("/invoices/aged-ar-insights")
async def aged_ar_insights(current_user: dict = Depends(get_current_user)):
    """Aged AR rollup + AI-written insights."""
    invoices = await db.invoices.find(
        scoped_query(current_user, {"payment_status": {"$ne": "paid"}, "status": {"$ne": "cancelled"}}, site_field=None),
        {"_id": 0},
    ).to_list(5000)
    now = datetime.now(timezone.utc)
    by_client = {}
    total_overdue = 0
    for inv in invoices:
        bal = float(inv.get("total") or 0) - float(inv.get("amount_paid") or 0)
        if bal <= 0:
            continue
        due = _parse_date(inv.get("due_date", ""))
        days_overdue = (now - due).days if due else 0
        if days_overdue <= 0:
            continue
        cid = inv.get("client_id", "unknown")
        by_client.setdefault(cid, {"client_name": inv.get("client_name", "Unknown"), "balance": 0, "count": 0, "max_overdue": 0})
        by_client[cid]["balance"] += bal
        by_client[cid]["count"] += 1
        by_client[cid]["max_overdue"] = max(by_client[cid]["max_overdue"], days_overdue)
        total_overdue += bal
    top_offenders = sorted(by_client.items(), key=lambda kv: kv[1]["balance"], reverse=True)[:5]
    top_data = [{"client_id": cid, **info, "balance": round(info["balance"], 2)} for cid, info in top_offenders]

    # AI narrative
    ai_summary = ""
    try:
        from app.services.ai_provider import UserMessage
        sys = "You're a CFO assistant. Write 3-4 concise bullets about the AR position. Be actionable. Use $ formatted with commas."
        prompt = json.dumps({
            "total_overdue": round(total_overdue, 2),
            "client_count": len(by_client),
            "top_offenders": top_data,
        })
        chat = await _ai_chat(f"agedar-{uuid.uuid4().hex[:6]}", sys)
        resp = await chat.send_message(UserMessage(text=prompt))
        ai_summary = resp.strip()
    except Exception as e:
        logger.warning(f"AR insights AI failed: {e}")
        if top_data:
            ai_summary = f"- {top_data[0]['client_name']} represents the largest overdue exposure (${top_data[0]['balance']:,.2f}).\n- {len(by_client)} clients are overdue, totalling ${total_overdue:,.2f}.\n- Consider escalating dunning for accounts over 60 days."
    return {
        "total_overdue": round(total_overdue, 2),
        "client_count": len(by_client),
        "top_offenders": top_data,
        "ai_summary": ai_summary,
    }


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜   9) STRIPE PAY-NOW LINK                                          Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

@router.post("/invoices/{invoice_id}/pay-now-link", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def generate_pay_now_link(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Generate a Stripe checkout URL for this invoice's balance and persist on invoice."""
    invoice = await _scoped_invoice(invoice_id, current_user, "billing.invoice.payment_link.create")
    stripe_key = os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY")
    if not stripe_key:
        raise HTTPException(500, "Stripe not configured")
    balance = _outstanding_balance(invoice, "create a payment link")
    currency = str(invoice.get("currency") or "aud").lower()
    amount_cents = int(round(balance * 100))
    idempotency_key = _checkout_idempotency_key(invoice, balance, currency)

    existing = await db.payment_transactions.find_one(
        {
            "invoice_id": invoice_id,
            "client_id": invoice.get("client_id"),
            "idempotency_key": idempotency_key,
            "source": "invoice_smart",
        },
        {"_id": 0},
    )
    if existing and existing.get("stripe_session_id") and existing.get("checkout_url"):
        return {
            "url": existing["checkout_url"],
            "session_id": existing["stripe_session_id"],
            "amount": balance,
        }

    try:
        public_base_url = configured_public_base_url()
    except RuntimeError as exc:
        logger.error("invoice_smart_public_url_invalid: %s", exc)
        raise HTTPException(500, "Public URL configuration is invalid") from None

    try:
        import stripe
        stripe.api_key = stripe_key
        session = stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": currency,
                    "product_data": {"name": f"Invoice {invoice.get('invoice_number', invoice_id)}"},
                    "unit_amount": amount_cents,
                },
                "quantity": 1,
            }],
            success_url=f"{public_base_url}/portal?paid=1",
            cancel_url=f"{public_base_url}/portal?cancelled=1",
            metadata={"invoice_id": invoice_id, "invoice_number": invoice.get("invoice_number", ""), "nexus_payment_source": "invoice_smart"},
            idempotency_key=idempotency_key,
        )
        url = session.url
        invoice_result = await db.invoices.update_one(
            _invoice_write_filter(invoice),
            {
                "$set": {
                    "payment_link": url,
                    "payment_link_session_id": session.id,
                    "payment_link_created_at": _now_iso(),
                }
            },
        )
        if not invoice_result.matched_count:
            # Do not hand a caller a session derived from a stale invoice
            # snapshot.  Stripe has an idempotent session, but it is not made a
            # Nexus payment attempt until the scoped invoice write succeeds.
            raise HTTPException(409, "Invoice changed while creating payment link; refresh and retry")

        transaction = {
            "id": str(uuid.uuid4()),
            "invoice_id": invoice_id,
            "invoice_collection": "invoices",
            "client_id": invoice.get("client_id"),
            "stripe_session_id": session.id,
            "checkout_url": url,
            "idempotency_key": idempotency_key,
            "amount": balance,
            "amount_cents": amount_cents,
            "currency": currency,
            "payment_status": "initiated",
            "source": "invoice_smart",
            "created_at": _now_iso(),
        }
        await db.payment_transactions.update_one(
            {
                "invoice_id": invoice_id,
                "client_id": invoice.get("client_id"),
                "idempotency_key": idempotency_key,
                "source": "invoice_smart",
            },
            {"$setOnInsert": transaction, "$set": {"updated_at": _now_iso()}},
            upsert=True,
        )
        stored = await db.payment_transactions.find_one(
            {
                "invoice_id": invoice_id,
                "client_id": invoice.get("client_id"),
                "idempotency_key": idempotency_key,
                "source": "invoice_smart",
            },
            {"_id": 0},
        )
        if not stored or stored.get("stripe_session_id") != session.id:
            raise HTTPException(409, "Payment attempt conflicts with existing settlement evidence")
        await log_activity(
            current_user,
            "invoice_pay_now_link_created",
            "invoice",
            invoice_id,
            invoice.get("invoice_number", ""),
            "Created an idempotent Stripe checkout attempt",
            metadata={"stripe_session_id": session.id, "amount_cents": amount_cents, "currency": currency},
        )
        return {"url": url, "session_id": session.id, "amount": balance}
    except HTTPException:
        raise
    except Exception:
        logger.exception("stripe_checkout_failed invoice_id=%s", invoice_id)
        raise HTTPException(502, "Unable to create Stripe checkout session") from None


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜  10) WEBHOOK CONFIG                                               Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

async def _require_invoice_webhook_administration(
    current_user: dict = Depends(get_current_user),
    _permission: dict = Depends(require_action("platform.webhooks.manage")),
):
    await assert_global_scope(current_user, operation="billing.invoice_webhooks.manage")
    return current_user


@router.get("/invoices/webhooks")
async def list_webhooks(current_user: dict = Depends(_require_invoice_webhook_administration)):
    hooks = await db.invoice_webhooks.find({}, {"_id": 0}).to_list(50)
    return [redact_webhook_for_response(hook) for hook in hooks]


@router.post("/invoices/webhooks")
async def create_webhook(data: dict, current_user: dict = Depends(_require_invoice_webhook_administration)):
    try:
        url = validate_legacy_webhook_url(data.get("url"))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    events = sorted({str(event or "").strip().lower() for event in (data.get("events") or ["paid"]) if str(event or "").strip()})
    allowed_events = {"created", "sent", "paid", "overdue", "voided"}
    if not events or any(event not in allowed_events for event in events):
        raise HTTPException(422, "events must be one or more supported invoice events")
    hook = {
        "id": str(uuid.uuid4()),
        "url": url,
        "events": events,
        "active": bool(data.get("active", True)),
        "created_at": _now_iso(),
        "created_by": current_user.get("name"),
        "fired_count": 0,
    }
    await db.invoice_webhooks.insert_one(hook)
    await log_activity(current_user, "invoice_webhook_created", "invoice_webhook", hook["id"], "Invoice webhook")
    return redact_webhook_for_response(hook)


@router.delete("/invoices/webhooks/{wid}")
async def delete_webhook(wid: str, current_user: dict = Depends(_require_invoice_webhook_administration)):
    deleted = await db.invoice_webhooks.delete_one({"id": wid})
    if not deleted.deleted_count:
        raise HTTPException(404, "Webhook not found")
    await log_activity(current_user, "invoice_webhook_deleted", "invoice_webhook", wid, "Invoice webhook")
    return {"success": True}


async def fire_invoice_webhook(event: str, invoice: dict):
    """Helper called from other modules when invoice events happen."""
    try:
        import httpx
        hooks = await db.invoice_webhooks.find({"active": True, "events": event}, {"_id": 0}).to_list(50)
        if not hooks:
            return
        payload = {"event": event, "invoice": {k: invoice.get(k) for k in ("id", "invoice_number", "invoice_name", "client_id", "client_name", "total", "status", "payment_status")}, "at": _now_iso()}
        async with httpx.AsyncClient(timeout=8, follow_redirects=False) as cli:
            for h in hooks:
                try:
                    # Historical records created before validation are still
                    # checked at delivery time so they cannot become an SSRF
                    # bypass merely by remaining in MongoDB.
                    validate_legacy_webhook_url(h.get("url"))
                    await cli.post(h["url"], json=payload)
                    await db.invoice_webhooks.update_one({"id": h["id"]}, {"$inc": {"fired_count": 1}, "$set": {"last_fired_at": _now_iso()}})
                except Exception:
                    pass
    except Exception as e:
        logger.warning(f"webhook fire failed: {e}")


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜  11) LATE-FEE POLICY (per-client / global)                        Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

@router.get("/invoices/late-fee-policy")
async def get_late_fee_policy(client_id: str | None = None, current_user: dict = Depends(get_current_user)):
    await _require_runtime_action(current_user, "billing.late_fee.policy.manage")
    if client_id:
        await assert_client_scope(
            current_user,
            client_id,
            operation="billing.invoice.late_fee_policy.read",
            mask_not_found=True,
        )
        p = await db.late_fee_policies.find_one({"client_id": client_id}, {"_id": 0})
        if p:
            return p
    else:
        await assert_global_scope(current_user, operation="billing.invoice.late_fee_policy.read")
    return await db.late_fee_policies.find_one({"scope": "global"}, {"_id": 0}) or {"scope": "global", "enabled": False, "type": "percent", "value": 5, "grace_days": 7}


@router.post("/invoices/late-fee-policy")
async def set_late_fee_policy(data: dict, current_user: dict = Depends(get_current_user)):
    if not isinstance(data, dict):
        raise HTTPException(422, "request body must be an object")
    await _require_runtime_action(current_user, "billing.late_fee.policy.manage")
    client_id = str(data.get("client_id") or "").strip() or None
    scope = "client" if client_id else "global"
    if client_id:
        await assert_client_scope(
            current_user,
            client_id,
            operation="billing.invoice.late_fee_policy.update",
            mask_not_found=True,
        )
    else:
        await assert_global_scope(current_user, operation="billing.invoice.late_fee_policy.update")

    fee_type = str(data.get("type", "percent")).strip().lower()
    if fee_type not in {"percent", "flat"}:
        raise HTTPException(422, "type must be 'percent' or 'flat'")
    value = _bounded_amount(
        data.get("value", 5),
        "value",
        minimum=0,
        maximum=100 if fee_type == "percent" else 1_000_000,
    )
    policy = {
        "scope": scope,
        "client_id": client_id,
        "enabled": _normalise_bool(data.get("enabled"), "enabled", default=True),
        "type": fee_type,
        "value": value,
        "grace_days": _bounded_int(data.get("grace_days", 7), "grace_days", minimum=0, maximum=365),
        "updated_at": _now_iso(),
        "updated_by": current_user.get("name"),
    }
    q = {"scope": "global"} if scope == "global" else {"scope": "client", "client_id": client_id}
    await db.late_fee_policies.update_one(
        q,
        {"$set": policy, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": _now_iso()}},
        upsert=True,
    )
    await log_activity(
        current_user,
        "late_fee_policy_updated",
        "late_fee_policy",
        client_id or "global",
        "Global late-fee policy" if not client_id else f"Late-fee policy for {client_id}",
        f"{fee_type} {value:g} with {policy['grace_days']} grace days",
        changes={key: policy[key] for key in ("enabled", "type", "value", "grace_days", "scope", "client_id")},
    )
    return policy
