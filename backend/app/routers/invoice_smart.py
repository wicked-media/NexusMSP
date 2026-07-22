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

from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity

logger = logging.getLogger(__name__)
router = APIRouter()


# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _parse_date(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        if "T" in s:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        else:
            dt = datetime.strptime(s[:10], "%Y-%m-%d")
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


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

@router.post("/invoices/{invoice_id}/payment-plan")
async def create_payment_plan(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Split an invoice into N installments with auto-due-date schedule."""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    n = int(data.get("installments", 3))
    if n < 2 or n > 12:
        raise HTTPException(400, "installments must be 2-12")
    interval_days = int(data.get("interval_days", 30))
    total = float(invoice.get("total") or 0)
    if total <= 0:
        raise HTTPException(400, "Invoice has no balance")
    paid = float(invoice.get("amount_paid") or 0)
    balance = total - paid
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
        "installments": n,
        "interval_days": interval_days,
        "schedule": schedule,
        "created_at": _now_iso(),
        "created_by": current_user.get("name"),
        "status": "active",
    }
    await db.invoice_payment_plans.insert_one(plan)
    plan.pop("_id", None)
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"payment_plan_id": plan["id"], "has_payment_plan": True}})
    await log_activity(current_user, "payment_plan_created", "invoice", invoice_id, invoice.get("invoice_number", ""), f"Plan: {n} x ${per:.2f}")
    return plan


@router.get("/invoices/{invoice_id}/payment-plan")
async def get_payment_plan(invoice_id: str, current_user: dict = Depends(get_current_user)):
    plan = await db.invoice_payment_plans.find_one({"invoice_id": invoice_id, "status": "active"}, {"_id": 0})
    if not plan:
        return None
    return plan


@router.post("/invoices/payment-plan/{plan_id}/mark-paid/{installment_id}")
async def mark_installment_paid(plan_id: str, installment_id: str, current_user: dict = Depends(get_current_user)):
    plan = await db.invoice_payment_plans.find_one({"id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(404, "Plan not found")
    updated = False
    for ins in plan["schedule"]:
        if ins["id"] == installment_id and ins["status"] != "paid":
            ins["status"] = "paid"
            ins["paid_at"] = _now_iso()
            updated = True
            break
    if not updated:
        raise HTTPException(400, "Installment already paid or not found")
    await db.invoice_payment_plans.update_one({"id": plan_id}, {"$set": {"schedule": plan["schedule"]}})
    return {"success": True}


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜   3) LATE FEES                                                    Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

@router.post("/invoices/{invoice_id}/apply-late-fee")
async def apply_late_fee(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    fee_type = data.get("type", "percent")  # 'percent' or 'flat'
    value = float(data.get("value", 5))
    cur_total = float(invoice.get("total") or 0)
    fee = round(cur_total * value / 100, 2) if fee_type == "percent" else value
    new_items = list(invoice.get("line_items") or invoice.get("items") or [])
    new_items.append({
        "description": f"Late payment fee ({value}{'%' if fee_type == 'percent' else ' flat'})",
        "quantity": 1, "unit_price": fee, "total": fee, "kind": "late_fee",
    })
    new_total = round(cur_total + fee, 2)
    await db.invoices.update_one({"id": invoice_id}, {"$set": {
        "line_items": new_items, "items": new_items,
        "total": new_total, "subtotal": round(float(invoice.get("subtotal") or 0) + fee, 2),
        "late_fee_applied": True, "late_fee_amount": fee, "late_fee_at": _now_iso(),
    }})
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


@router.post("/invoices/{invoice_id}/smart-reminder")
async def smart_reminder(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Generate AI-drafted reminder copy based on age & history; optionally send."""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    due = _parse_date(invoice.get("due_date", ""))
    age = (datetime.now(timezone.utc) - (due or datetime.now(timezone.utc))).days if due else 0
    history = await db.invoice_emails.find({"invoice_id": invoice_id, "kind": "reminder"}, {"_id": 0}).to_list(20)
    stage = data.get("stage")
    if not stage:
        if age <= 3:
            stage = "first"
        elif age <= 10:
            stage = "second"
        elif age <= 21:
            stage = "third"
        else:
            stage = "final"
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
    return {"stage": stage, "subject": subject, "body": body, "days_overdue": max(0, age)}
    return {"stage": stage, "subject": f"Reminder: Invoice {invoice.get('invoice_number')} Ã¢â‚¬â€ {invoice.get('currency', 'AUD')} {invoice.get('total')}", "body": body, "days_overdue": max(0, age)}


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜   5) REISSUE FROM PRIOR PERIOD                                    Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

@router.post("/invoices/{invoice_id}/reissue")
async def reissue_invoice(invoice_id: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    original = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not original:
        raise HTTPException(404, "Invoice not found")
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
    new["created_at"] = _now_iso()
    new["updated_at"] = _now_iso()
    new["reissued_from"] = invoice_id
    due_offset = int((data or {}).get("due_days", 14))
    new["due_date"] = (datetime.now(timezone.utc) + timedelta(days=due_offset)).strftime("%Y-%m-%d")
    new["issue_date"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.invoices.insert_one(new)
    new.pop("_id", None)
    await log_activity(current_user, "reissued", "invoice", new["id"], new_no, f"Reissued from {original.get('invoice_number')}")
    return new


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜   6) BULK OPERATIONS                                              Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

@router.post("/invoices/bulk/{action}")
async def bulk_invoice_action(action: str, data: dict, current_user: dict = Depends(get_current_user)):
    ids = data.get("invoice_ids") or []
    if not ids:
        raise HTTPException(400, "invoice_ids required")
    valid_actions = {"send", "void", "discount", "apply-late-fee", "mark-sent", "reissue"}
    if action not in valid_actions:
        raise HTTPException(400, f"action must be one of {sorted(valid_actions)}")
    results = {"processed": 0, "failed": 0, "details": []}
    for inv_id in ids:
        inv = await db.invoices.find_one({"id": inv_id}, {"_id": 0})
        if not inv:
            results["failed"] += 1
            continue
        try:
            if action == "void":
                if inv.get("payment_status") in {"paid", "partial"} or inv.get("status") in {"cancelled", "voided"}:
                    raise ValueError("Paid, partially paid, or already voided invoices cannot be bulk voided")
                await db.invoices.update_one({"id": inv_id}, {"$set": {
                    "status": "cancelled",
                    "voided_at": _now_iso(),
                    "voided_by": current_user.get("name"),
                    "void_reason": data.get("reason", "Bulk void"),
                }})
            elif action == "discount":
                pct = float(data.get("discount_pct", 0))
                total = float(inv.get("total") or 0)
                new_total = round(total * (1 - pct / 100), 2)
                await db.invoices.update_one({"id": inv_id}, {"$set": {
                    "total": new_total, "discount_pct": pct,
                    "discount_applied_at": _now_iso(),
                }})
            elif action == "apply-late-fee":
                pct = float(data.get("fee_pct", 5))
                total = float(inv.get("total") or 0)
                fee = round(total * pct / 100, 2)
                items = list(inv.get("line_items") or inv.get("items") or [])
                items.append({"description": f"Late fee ({pct}%)", "quantity": 1, "unit_price": fee, "total": fee, "kind": "late_fee"})
                await db.invoices.update_one({"id": inv_id}, {"$set": {
                    "line_items": items, "items": items,
                    "total": round(total + fee, 2),
                    "late_fee_applied": True, "late_fee_amount": fee, "late_fee_at": _now_iso(),
                }})
            elif action in ("send", "mark-sent"):
                await db.invoices.update_one({"id": inv_id}, {"$set": {
                    "status": "sent",
                    "sent_at": _now_iso(),
                }})
            elif action == "reissue":
                last = await db.invoices.find({}, {"_id": 0, "invoice_number": 1}).sort("created_at", -1).limit(1).to_list(1)
                last_num = 0
                if last:
                    m = re.search(r"(\d+)$", str(last[0].get("invoice_number", "INV-0000")))
                    last_num = int(m.group(1)) if m else 0
                new_no = f"INV-{last_num + 1:05d}"
                clone = {**inv}
                clone.pop("_id", None)
                clone["id"] = str(uuid.uuid4())
                clone["invoice_number"] = new_no
                clone["status"] = "draft"
                clone["payment_status"] = "unpaid"
                clone["amount_paid"] = 0
                source_name = str(inv.get("invoice_name") or "").strip()
                if source_name:
                    clone["invoice_name"] = f"Reissued: {source_name}"[:160]
                clone["created_at"] = _now_iso()
                clone["due_date"] = (datetime.now(timezone.utc) + timedelta(days=14)).strftime("%Y-%m-%d")
                clone["reissued_from"] = inv_id
                await db.invoices.insert_one(clone)
            results["processed"] += 1
            results["details"].append({"id": inv_id, "ok": True})
        except Exception as e:
            results["failed"] += 1
            results["details"].append({"id": inv_id, "ok": False, "error": str(e)})
    await log_activity(current_user, f"bulk_{action}", "invoice", "multiple", f"{results['processed']} invoices", f"{results['processed']}/{len(ids)} processed")
    return results


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜   7) CUSTOMER STATEMENT PDF                                       Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

@router.get("/invoices/customer-statement/{client_id}")
async def customer_statement(client_id: str, current_user: dict = Depends(get_current_user)):
    """Return a rollup of unpaid invoices + aged bucket data (JSON)."""
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
    invoices = await db.invoices.find({"payment_status": {"$ne": "paid"}, "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(5000)
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

@router.post("/invoices/{invoice_id}/pay-now-link")
async def generate_pay_now_link(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Generate a Stripe checkout URL for this invoice's balance and persist on invoice."""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    stripe_key = os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY")
    if not stripe_key:
        raise HTTPException(500, "Stripe not configured")
    balance = float(invoice.get("total") or 0) - float(invoice.get("amount_paid") or 0)
    if balance <= 0:
        raise HTTPException(400, "Invoice has no outstanding balance")
    try:
        import stripe
        stripe.api_key = stripe_key
        session = stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": (invoice.get("currency") or "aud").lower(),
                    "product_data": {"name": f"Invoice {invoice.get('invoice_number', invoice_id)}"},
                    "unit_amount": int(round(balance * 100)),
                },
                "quantity": 1,
            }],
            success_url=f"{os.environ.get('PUBLIC_URL', 'https://nexusops.io')}/portal?paid=1",
            cancel_url=f"{os.environ.get('PUBLIC_URL', 'https://nexusops.io')}/portal?cancelled=1",
            metadata={"invoice_id": invoice_id, "invoice_number": invoice.get("invoice_number", "")},
        )
        url = session.url
        await db.invoices.update_one({"id": invoice_id}, {"$set": {
            "payment_link": url,
            "payment_link_session_id": session.id,
            "payment_link_created_at": _now_iso(),
        }})
        return {"url": url, "session_id": session.id, "amount": balance}
    except Exception as e:
        logger.error(f"Stripe checkout failed: {e}")
        raise HTTPException(500, f"Stripe error: {str(e)[:160]}")


# Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”
# Ã¢â€¢â€˜  10) WEBHOOK CONFIG                                               Ã¢â€¢â€˜
# Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

@router.get("/invoices/webhooks")
async def list_webhooks(current_user: dict = Depends(get_current_user)):
    return await db.invoice_webhooks.find({}, {"_id": 0}).to_list(50)


@router.post("/invoices/webhooks")
async def create_webhook(data: dict, current_user: dict = Depends(get_current_user)):
    url = (data.get("url") or "").strip()
    if not url.startswith("http"):
        raise HTTPException(400, "url must start with http")
    events = data.get("events") or ["paid"]
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
    hook.pop("_id", None)
    return hook


@router.delete("/invoices/webhooks/{wid}")
async def delete_webhook(wid: str, current_user: dict = Depends(get_current_user)):
    await db.invoice_webhooks.delete_one({"id": wid})
    return {"success": True}


async def fire_invoice_webhook(event: str, invoice: dict):
    """Helper called from other modules when invoice events happen."""
    try:
        import httpx
        hooks = await db.invoice_webhooks.find({"active": True, "events": event}, {"_id": 0}).to_list(50)
        if not hooks:
            return
        payload = {"event": event, "invoice": {k: invoice.get(k) for k in ("id", "invoice_number", "invoice_name", "client_id", "client_name", "total", "status", "payment_status")}, "at": _now_iso()}
        async with httpx.AsyncClient(timeout=8) as cli:
            for h in hooks:
                try:
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
    if client_id:
        p = await db.late_fee_policies.find_one({"client_id": client_id}, {"_id": 0})
        if p:
            return p
    return await db.late_fee_policies.find_one({"scope": "global"}, {"_id": 0}) or {"scope": "global", "enabled": False, "type": "percent", "value": 5, "grace_days": 7}


@router.post("/invoices/late-fee-policy")
async def set_late_fee_policy(data: dict, current_user: dict = Depends(get_current_user)):
    scope = "client" if data.get("client_id") else "global"
    policy = {
        "scope": scope,
        "client_id": data.get("client_id"),
        "enabled": bool(data.get("enabled", True)),
        "type": data.get("type", "percent"),
        "value": float(data.get("value", 5)),
        "grace_days": int(data.get("grace_days", 7)),
        "updated_at": _now_iso(),
        "updated_by": current_user.get("name"),
    }
    q = {"scope": "global"} if scope == "global" else {"client_id": data.get("client_id")}
    await db.late_fee_policies.update_one(q, {"$set": policy}, upsert=True)
    return policy
