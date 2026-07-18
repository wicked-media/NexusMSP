"""Recurring Smart Engine â€” CPI/YoY uplift, renewal risk (AI), smart consolidation,
pre-bill preview, pause with date range, and multi-source roll-up.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from typing import Optional
import os
import uuid
import json
import logging

from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity

logger = logging.getLogger(__name__)
router = APIRouter()


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _parse_date(s):
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
    from app.services.ai_provider import LlmChat
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(500, "AI key not configured")
    cfg = await db.settings.find_one({"type": "ai_config"}, {"_id": 0}) or {}
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system_msg)
    chat.with_model(cfg.get("provider", "anthropic"), cfg.get("model", "claude-sonnet-4-5-20250929"))
    return chat


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   1) CPI / YoY UPLIFT                                             â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/recurring-invoices/{ri_id}/uplift-rule")
async def set_uplift_rule(ri_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Configure auto-uplift on a recurring invoice.
    Body: { enabled, pct: float, frequency: 'annually'|'biannually'|'quarterly', next_uplift_date, cap_pct? }
    """
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(404, "Recurring invoice not found")
    rule = {
        "enabled": bool(data.get("enabled", True)),
        "pct": float(data.get("pct", 5)),
        "frequency": data.get("frequency", "annually"),
        "next_uplift_date": data.get("next_uplift_date") or (datetime.now(timezone.utc) + timedelta(days=365)).strftime("%Y-%m-%d"),
        "cap_pct": float(data.get("cap_pct", 0)) if data.get("cap_pct") else None,
        "applied_count": int(ri.get("uplift_rule", {}).get("applied_count", 0)),
        "last_applied_at": ri.get("uplift_rule", {}).get("last_applied_at"),
        "updated_at": _now_iso(),
    }
    await db.recurring_invoices.update_one({"id": ri_id}, {"$set": {"uplift_rule": rule}})
    await log_activity(current_user, "uplift_rule_set", "recurring_invoice", ri_id, ri.get("description", ""), f"{rule['pct']}% {rule['frequency']}")
    return rule


@router.post("/recurring-invoices/{ri_id}/apply-uplift")
async def apply_uplift_now(ri_id: str, current_user: dict = Depends(get_current_user)):
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(404, "Recurring invoice not found")
    rule = ri.get("uplift_rule") or {}
    if not rule.get("enabled"):
        raise HTTPException(400, "Uplift rule not enabled")
    pct = float(rule.get("pct", 5))
    items = list(ri.get("line_items") or [])
    new_items = []
    for li in items:
        rate = float(li.get("rate") or 0)
        new_rate = round(rate * (1 + pct / 100), 2)
        qty = float(li.get("quantity") or 1)
        new_items.append({**li, "rate": new_rate, "amount": round(qty * new_rate, 2)})
    new_amount = sum(li.get("amount", 0) for li in new_items)
    next_freq_days = {"annually": 365, "biannually": 182, "quarterly": 91}.get(rule.get("frequency", "annually"), 365)
    rule["applied_count"] = int(rule.get("applied_count", 0)) + 1
    rule["last_applied_at"] = _now_iso()
    rule["next_uplift_date"] = (datetime.now(timezone.utc) + timedelta(days=next_freq_days)).strftime("%Y-%m-%d")
    await db.recurring_invoices.update_one({"id": ri_id}, {"$set": {
        "line_items": new_items, "amount": new_amount, "uplift_rule": rule,
        "last_uplift_pct": pct, "last_uplift_at": _now_iso(),
    }})
    await log_activity(current_user, "uplift_applied", "recurring_invoice", ri_id, ri.get("description", ""), f"+{pct}% â†’ ${new_amount:.2f}")
    return {"success": True, "new_amount": new_amount, "applied_pct": pct, "new_line_items": new_items}


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   2) RENEWAL RISK SCORE (AI)                                      â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/recurring-invoices/{ri_id}/renewal-risk")
async def renewal_risk(ri_id: str, current_user: dict = Depends(get_current_user)):
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(404, "Recurring invoice not found")
    client_id = ri.get("client_id")
    # Gather signals
    client_invoices = await db.invoices.find({"client_id": client_id}, {"_id": 0}).to_list(500)
    paid_count = sum(1 for i in client_invoices if i.get("payment_status") == "paid")
    overdue_count = sum(1 for i in client_invoices if i.get("payment_status") != "paid" and _parse_date(i.get("due_date", "")) and _parse_date(i["due_date"]) < datetime.now(timezone.utc))
    avg_dso = 0
    cnt = 0
    for i in client_invoices:
        if i.get("payment_status") == "paid" and i.get("paid_at") and i.get("issue_date"):
            p = _parse_date(i["paid_at"])
            issued = _parse_date(i["issue_date"])
            if p and issued:
                avg_dso += (p - issued).days
                cnt += 1
    if cnt:
        avg_dso = round(avg_dso / cnt, 1)
    # ticket signals
    tickets = await db.tickets.find({"client_id": client_id}, {"_id": 0}).to_list(500)
    crit_open = sum(1 for t in tickets if t.get("priority") == "critical" and not t.get("resolved_at"))
    ticket_count_90d = sum(1 for t in tickets if _parse_date(t.get("created_at", "")) and (datetime.now(timezone.utc) - _parse_date(t["created_at"])).days <= 90)

    # Base scoring (0-100 risk where 100=high risk)
    risk = 10
    risk += overdue_count * 8
    risk += crit_open * 10
    if avg_dso > 30:
        risk += 20
    elif avg_dso > 14:
        risk += 8
    if paid_count == 0:
        risk += 15  # new client unknown
    risk = max(0, min(100, risk))
    band = "low" if risk < 30 else "medium" if risk < 60 else "high"

    ai_analysis = ""
    recommended_actions = []
    try:
        from app.services.ai_provider import UserMessage
        sys = "You are an MSP renewal risk analyst. Given signals, write a 2-3 sentence analysis and 3 short action bullets. Output JSON: {analysis, actions:[..]}"
        prompt = json.dumps({
            "ri_amount": ri.get("amount"),
            "ri_frequency": ri.get("frequency"),
            "client_name": ri.get("client_name"),
            "paid_invoices": paid_count, "overdue_invoices": overdue_count,
            "avg_dso_days": avg_dso, "open_critical_tickets": crit_open,
            "tickets_90d": ticket_count_90d,
            "risk_score": risk, "band": band,
        })
        chat = await _ai_chat(f"churn-{ri_id}", sys)
        resp = await chat.send_message(UserMessage(text=prompt))
        text = resp.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        parsed = json.loads(text)
        ai_analysis = parsed.get("analysis", "")
        recommended_actions = parsed.get("actions", [])[:5]
    except Exception as e:
        logger.warning(f"churn AI failed: {e}")
        ai_analysis = f"{band.title()} renewal risk. Avg DSO {avg_dso}d, {overdue_count} overdue, {crit_open} open critical tickets."
        recommended_actions = [
            "Schedule a QBR within 14 days",
            "Confirm primary contact still active",
            "Review SLA adherence over last 90 days",
        ]
    return {
        "risk_score": risk, "band": band,
        "signals": {
            "paid_invoices": paid_count, "overdue_invoices": overdue_count,
            "avg_dso_days": avg_dso, "open_critical_tickets": crit_open,
            "tickets_90d": ticket_count_90d,
        },
        "ai_analysis": ai_analysis,
        "recommended_actions": recommended_actions,
    }


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   3) SMART CONSOLIDATION                                          â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/recurring-invoices/consolidate/{client_id}")
async def consolidate_client(client_id: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    """Combine all active recurring streams for a client into a single monthly stream.
    Old streams are paused (not deleted) and linked to the new consolidated one.
    """
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    streams = await db.recurring_invoices.find({"client_id": client_id, "status": "active", "consolidated_into": {"$exists": False}}, {"_id": 0}).to_list(50)
    if len(streams) < 2:
        raise HTTPException(400, "Need at least 2 active streams to consolidate")
    combined_lines = []
    total = 0
    for s in streams:
        for li in (s.get("line_items") or []):
            combined_lines.append({**li, "source_stream": s.get("id"), "source_desc": s.get("description")})
            total += float(li.get("amount", 0))
    new_ri = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "client_name": client.get("name"),
        "description": f"Consolidated services â€” {client.get('name')}",
        "frequency": "monthly",
        "payment_terms": "net_30",
        "tax_rate": float(client.get("tax_rate") or 10),
        "currency": client.get("currency", "AUD"),
        "auto_send": False,
        "line_items": combined_lines,
        "amount": total,
        "status": "active",
        "start_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "next_due_date": (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d"),
        "consolidates_streams": [s["id"] for s in streams],
        "created_at": _now_iso(),
        "created_by": current_user.get("name"),
        "invoices_generated": 0,
        "total_billed": 0,
    }
    await db.recurring_invoices.insert_one(new_ri)
    for s in streams:
        await db.recurring_invoices.update_one({"id": s["id"]}, {"$set": {
            "status": "paused",
            "paused_at": _now_iso(),
            "pause_reason": "Consolidated",
            "consolidated_into": new_ri["id"],
        }})
    await log_activity(current_user, "consolidated", "recurring_invoice", new_ri["id"], new_ri["description"], f"{len(streams)} streams â†’ ${total:.2f}/mo")
    new_ri.pop("_id", None)
    return new_ri


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   4) PRE-BILL PREVIEW (send draft to client before cutting bill)  â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/recurring-invoices/{ri_id}/pre-bill-preview")
async def send_pre_bill_preview(ri_id: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(404, "Recurring invoice not found")
    client = await db.clients.find_one({"id": ri.get("client_id")}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Client not found")
    email = (data or {}).get("email") or client.get("email") or client.get("billing_email")
    if not email:
        raise HTTPException(400, "Client has no email on file")
    # Compose draft summary
    amt = float(ri.get("amount") or 0)
    lines = ri.get("line_items") or []
    rows = "".join([f"<tr><td style='padding:6px;border:1px solid #eee;'>{li.get('description', '')}</td><td style='padding:6px;border:1px solid #eee;text-align:right;'>{float(li.get('quantity') or 1)} Ã— ${float(li.get('rate') or 0):,.2f}</td><td style='padding:6px;border:1px solid #eee;text-align:right;'>${float(li.get('amount') or 0):,.2f}</td></tr>" for li in lines])
    next_due = ri.get("next_due_date", "â€”")
    branding = (await db.settings.find_one({"key": "branding"}, {"_id": 0}) or {}).get("value", {}) or {}
    company = branding.get("company_name", "NexusOps")
    html = f"""<div style='font-family:sans-serif;max-width:640px;margin:auto;'>
<h2 style='color:#10B981;'>{company} â€” Pre-Bill Preview</h2>
<p>Hi {client.get('name', 'team')},</p>
<p>This is a friendly preview of your upcoming invoice, scheduled for <b>{next_due}</b>:</p>
<table style='border-collapse:collapse;width:100%;'><thead><tr style='background:#10B981;color:white;'><th style='padding:6px;'>Item</th><th style='padding:6px;'>Qty Ã— Rate</th><th style='padding:6px;'>Amount</th></tr></thead><tbody>{rows}</tbody></table>
<p style='text-align:right;font-size:18px;'><b>Total: ${amt:,.2f}</b></p>
<p>If anything looks off, just reply â€” we'll fix it before invoicing.</p>
<p>â€” {company}</p></div>"""
    from app.routers.email_utils import send_email
    delivery = await send_email(
        email,
        f"Upcoming invoice preview â€” ${amt:,.2f} due {next_due}",
        html,
        category="billing",
    )
    sent = delivery.get("status") == "sent"
    await db.recurring_prebill_log.insert_one({
        "id": str(uuid.uuid4()), "ri_id": ri_id, "client_id": client.get("id"),
        "email": email, "amount": amt, "next_due": next_due,
        "sent": sent, "delivery_status": delivery.get("status"), "delivery_message": delivery.get("message"),
        "sender_mailbox": delivery.get("sender"), "sent_at": _now_iso(), "sent_by": current_user.get("name"),
    })
    await log_activity(current_user, "pre_bill_preview", "recurring_invoice", ri_id, ri.get("description", ""), f"Preview â†’ {email}")
    return {"sent": sent, "email": email, "preview_html": html, "delivery_status": delivery.get("status"), "delivery_message": delivery.get("message")}


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   5) PAUSE WITH DATE RANGE                                        â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/recurring-invoices/{ri_id}/pause-range")
async def pause_with_range(ri_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(404, "Recurring invoice not found")
    from_date = _parse_date(data.get("from_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    to_date = _parse_date(data.get("to_date") or "")
    if not from_date or not to_date:
        raise HTTPException(400, "from_date and to_date required (YYYY-MM-DD)")
    if to_date <= from_date:
        raise HTTPException(400, "to_date must be after from_date")
    pause = {
        "from": from_date.strftime("%Y-%m-%d"),
        "to": to_date.strftime("%Y-%m-%d"),
        "reason": data.get("reason", ""),
        "set_by": current_user.get("name"),
        "set_at": _now_iso(),
        "active": True,
    }
    await db.recurring_invoices.update_one({"id": ri_id}, {"$set": {
        "scheduled_pause": pause,
        "status": "paused" if datetime.now(timezone.utc) >= from_date else ri.get("status", "active"),
    }})
    await log_activity(current_user, "pause_range_set", "recurring_invoice", ri_id, ri.get("description", ""), f"{pause['from']} â†’ {pause['to']}")
    return pause


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   6) MULTI-SOURCE ROLLUP                                          â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/recurring-invoices/{ri_id}/rollup-usage")
async def rollup_usage(ri_id: str, current_user: dict = Depends(get_current_user)):
    """Pull current seat/usage counts from Acronis + Pax8 + M365 and add as line items."""
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(404, "Recurring invoice not found")
    client_id = ri.get("client_id")
    new_lines = list(ri.get("line_items") or [])
    rolled_up = {"acronis": 0, "pax8": 0, "m365": 0}
    if ri.get("include_acronis_usage"):
        # Count Acronis applications for this client
        acronis_app_count = await db.acronis_applications.count_documents({"client_id": client_id, "status": {"$ne": "deleted"}})
        if acronis_app_count > 0:
            unit = float(ri.get("acronis_unit_price", 8))
            new_lines.append({
                "description": f"Acronis Cyber Protect â€” {acronis_app_count} endpoints",
                "quantity": acronis_app_count, "rate": unit,
                "amount": round(acronis_app_count * unit, 2),
                "source": "acronis_rollup",
            })
            rolled_up["acronis"] = acronis_app_count
    if ri.get("include_pax8_usage"):
        seats = await db.pax8_subscriptions.aggregate([
            {"$match": {"client_id": client_id, "status": "active"}},
            {"$group": {"_id": None, "total_seats": {"$sum": "$quantity"}}},
        ]).to_list(1)
        seat_count = seats[0]["total_seats"] if seats else 0
        if seat_count > 0:
            unit = float(ri.get("pax8_markup_per_seat", 5))
            new_lines.append({
                "description": f"Pax8 Subscriptions â€” {seat_count} seats (markup)",
                "quantity": seat_count, "rate": unit,
                "amount": round(seat_count * unit, 2),
                "source": "pax8_rollup",
            })
            rolled_up["pax8"] = seat_count
    # M365 (count users in client_m365_users)
    m365_count = await db.client_m365_users.count_documents({"client_id": client_id, "active": True})
    if m365_count and ri.get("include_m365_usage"):
        unit = float(ri.get("m365_unit_price", 28))
        new_lines.append({
            "description": f"Microsoft 365 â€” {m365_count} users",
            "quantity": m365_count, "rate": unit,
            "amount": round(m365_count * unit, 2),
            "source": "m365_rollup",
        })
        rolled_up["m365"] = m365_count
    new_amount = sum(float(li.get("amount") or 0) for li in new_lines)
    await db.recurring_invoices.update_one({"id": ri_id}, {"$set": {
        "line_items": new_lines, "amount": new_amount,
        "last_rollup_at": _now_iso(), "last_rollup_summary": rolled_up,
    }})
    return {"success": True, "new_amount": new_amount, "rolled_up": rolled_up, "line_items": new_lines}
