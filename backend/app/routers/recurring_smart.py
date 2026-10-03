"""Recurring Smart Engine â€” CPI/YoY uplift, renewal risk (AI), smart consolidation,
pre-bill preview, pause with date range, and multi-source roll-up.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from typing import Optional
from email.utils import parseaddr
from html import escape
from math import isfinite
import os
import uuid
import json
import logging

from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity
from app.services.action_permissions import require_action
from app.services.scope_permissions import assert_client_scope, assert_record_scope

logger = logging.getLogger(__name__)
router = APIRouter()


from app.services.time_utils import now_iso as _now_iso


def _version_filter(document: dict) -> dict:
    """Match the version observed before a recurring billing change."""
    version = document.get("version")
    return {"version": version} if version is not None else {"version": {"$exists": False}}


def _next_version(document: dict) -> int:
    """Normalise legacy unversioned recurring records onto optimistic writes."""
    try:
        version = int(document.get("version") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=409, detail="Recurring invoice has an invalid version; repair it before changing billing") from None
    if version < 0:
        raise HTTPException(status_code=409, detail="Recurring invoice has an invalid version; repair it before changing billing")
    return version + 1


def _normalise_nexus_id(value: object, field: str) -> str:
    """Accept a bounded stable Nexus identifier, not an arbitrary selector."""
    identifier = str(value or "").strip()
    if not identifier or len(identifier) > 128 or any(char in identifier for char in ("\x00", "\r", "\n")):
        raise HTTPException(status_code=422, detail=f"{field} is invalid")
    return identifier


async def _scoped_recurring_invoice(ri_id: str, current_user: dict, operation: str) -> dict:
    """Load a client-owned recurring record without exposing foreign billing data."""
    ri_id = _normalise_nexus_id(ri_id, "Recurring invoice id")
    recurring = await assert_record_scope(
        current_user,
        db.recurring_invoices,
        ri_id,
        operation=operation,
        resource_name="Recurring invoice",
    )
    if not str(recurring.get("client_id") or "").strip():
        raise HTTPException(status_code=409, detail="Recurring invoice is missing its required client relationship")
    return recurring


async def _scoped_client(client_id: object, current_user: dict, operation: str) -> dict:
    """Verify a stable client ID before using it for billing or delivery."""
    normalized = _normalise_nexus_id(client_id, "client_id")
    await assert_client_scope(current_user, normalized, operation=operation, mask_not_found=True)
    client = await db.clients.find_one({"id": normalized}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


async def _update_scoped_recurring(
    recurring: dict,
    updates: dict,
    *,
    conflict_detail: str = "Recurring invoice changed while it was being updated; refresh and retry",
) -> int:
    """Bind recurring mutations to the same client, state and observed version."""
    result = await db.recurring_invoices.update_one(
        {
            "id": recurring["id"],
            "client_id": recurring.get("client_id"),
            "status": recurring.get("status"),
            **_version_filter(recurring),
        },
        {"$set": {**updates, "updated_at": _now_iso()}, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail=conflict_detail)
    return _next_version(recurring)


def _finite_number(value: object, field: str, *, minimum: float | None = None, maximum: float | None = None) -> float:
    if isinstance(value, bool):
        raise HTTPException(status_code=422, detail=f"{field} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{field} must be a finite number") from None
    if not isfinite(number) or (minimum is not None and number < minimum) or (maximum is not None and number > maximum):
        raise HTTPException(status_code=422, detail=f"{field} is outside the allowed range")
    return number


def _trusted_prebill_recipient(recurring: dict, client: dict) -> str:
    """Resolve delivery solely from retained customer/billing configuration.

    Browser payload is intentionally not consulted: an operator may choose to
    configure the recurring delivery address through its governed edit flow,
    but cannot direct a pre-bill preview to an arbitrary address at send time.
    """
    candidates = (
        recurring.get("auto_send_email"),
        client.get("billing_email"),
        client.get("email"),
    )
    for candidate in candidates:
        recipient = str(candidate or "").strip()
        if not recipient or "\r" in recipient or "\n" in recipient:
            continue
        _, parsed = parseaddr(recipient)
        if parsed == recipient and "@" in parsed and parsed.rsplit("@", 1)[-1]:
            return recipient
    raise HTTPException(status_code=409, detail="Client has no valid trusted billing email on file")


from app.services.time_utils import parse_date_compact as _parse_date


async def _ai_chat(session_id: str, system_msg: str):
    from app.services.ai_provider import LlmChat
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(500, "AI key not configured")
    cfg = await db.settings.find_one({"type": "ai_config"}, {"_id": 0}) or {}
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system_msg)
    chat.with_model("openai", cfg.get("model", "gpt-5.6-terra"))
    return chat


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   1) CPI / YoY UPLIFT                                             â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/recurring-invoices/{ri_id}/uplift-rule", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def set_uplift_rule(ri_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Configure auto-uplift on a recurring invoice.
    Body: { enabled, pct: float, frequency: 'annually'|'biannually'|'quarterly', next_uplift_date, cap_pct? }
    """
    ri = await _scoped_recurring_invoice(ri_id, current_user, "billing.recurring.uplift_rule.set")
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Uplift rule payload must be an object")
    pct = _finite_number(data.get("pct", 5), "pct", minimum=0, maximum=100)
    frequency = str(data.get("frequency") or "annually").strip().lower()
    if frequency not in {"annually", "biannually", "quarterly"}:
        raise HTTPException(status_code=422, detail="frequency must be annually, biannually or quarterly")
    next_uplift = _parse_date(data.get("next_uplift_date")) if data.get("next_uplift_date") else datetime.now(timezone.utc) + timedelta(days=365)
    if not next_uplift:
        raise HTTPException(status_code=422, detail="next_uplift_date must be a valid ISO date")
    cap_value = data.get("cap_pct")
    cap_pct = None if cap_value in (None, "") else _finite_number(cap_value, "cap_pct", minimum=0, maximum=100)
    if cap_pct is not None and pct > cap_pct:
        raise HTTPException(status_code=422, detail="pct cannot exceed cap_pct")
    rule = {
        "enabled": bool(data.get("enabled", True)),
        "pct": pct,
        "frequency": frequency,
        "next_uplift_date": next_uplift.strftime("%Y-%m-%d"),
        "cap_pct": cap_pct,
        "applied_count": int(ri.get("uplift_rule", {}).get("applied_count", 0)),
        "last_applied_at": ri.get("uplift_rule", {}).get("last_applied_at"),
        "updated_at": _now_iso(),
    }
    await _update_scoped_recurring(ri, {"uplift_rule": rule})
    await log_activity(
        current_user,
        "uplift_rule_set",
        "recurring_invoice",
        ri_id,
        ri.get("description", ""),
        f"{rule['pct']}% {rule['frequency']}",
        metadata={"client_id": ri.get("client_id")},
    )
    return rule


@router.post("/recurring-invoices/{ri_id}/apply-uplift", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def apply_uplift_now(ri_id: str, current_user: dict = Depends(get_current_user)):
    ri = await _scoped_recurring_invoice(ri_id, current_user, "billing.recurring.uplift.apply")
    rule = ri.get("uplift_rule") or {}
    if not rule.get("enabled"):
        raise HTTPException(status_code=409, detail="Uplift rule is not enabled")
    pct = _finite_number(rule.get("pct", 5), "uplift rule pct", minimum=0, maximum=100)
    cap_pct = rule.get("cap_pct")
    if cap_pct not in (None, "") and pct > _finite_number(cap_pct, "uplift rule cap_pct", minimum=0, maximum=100):
        raise HTTPException(status_code=409, detail="Uplift rule exceeds its configured cap")
    items = list(ri.get("line_items") or [])
    new_items = []
    for li in items:
        if not isinstance(li, dict):
            raise HTTPException(status_code=409, detail="Recurring invoice has an invalid line item")
        rate = _finite_number(li.get("rate") or 0, "line item rate", minimum=0)
        new_rate = round(rate * (1 + pct / 100), 2)
        qty = _finite_number(li.get("quantity") or 1, "line item quantity", minimum=0)
        new_items.append({**li, "rate": new_rate, "amount": round(qty * new_rate, 2)})
    new_amount = round(sum(_finite_number(li.get("amount", 0), "line item amount", minimum=0) for li in new_items), 2)
    frequency = str(rule.get("frequency") or "annually").strip().lower()
    frequency_days = {"annually": 365, "biannually": 182, "quarterly": 91}
    if frequency not in frequency_days:
        raise HTTPException(status_code=409, detail="Uplift rule has an invalid frequency; repair it before applying")
    next_freq_days = frequency_days[frequency]
    rule["applied_count"] = int(rule.get("applied_count", 0)) + 1
    rule["last_applied_at"] = _now_iso()
    rule["next_uplift_date"] = (datetime.now(timezone.utc) + timedelta(days=next_freq_days)).strftime("%Y-%m-%d")
    await _update_scoped_recurring(ri, {
        "line_items": new_items, "amount": new_amount, "uplift_rule": rule,
        "last_uplift_pct": pct, "last_uplift_at": _now_iso(),
    })
    await log_activity(
        current_user,
        "uplift_applied",
        "recurring_invoice",
        ri_id,
        ri.get("description", ""),
        f"+{pct}% â†’ ${new_amount:.2f}",
        metadata={"client_id": ri.get("client_id"), "pct": pct, "new_amount": new_amount},
    )
    return {"success": True, "new_amount": new_amount, "applied_pct": pct, "new_line_items": new_items}


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   2) RENEWAL RISK SCORE (AI)                                      â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/recurring-invoices/{ri_id}/renewal-risk", dependencies=[Depends(require_action("billing.portal.view"))])
async def renewal_risk(ri_id: str, current_user: dict = Depends(get_current_user)):
    ri = await _scoped_recurring_invoice(ri_id, current_user, "billing.recurring.renewal_risk.read")
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

@router.post(
    "/recurring-invoices/consolidate/{client_id}",
    dependencies=[
        Depends(require_action("billing.invoice.create")),
        Depends(require_action("billing.invoice.modify")),
    ],
)
async def consolidate_client(client_id: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    """Combine all active recurring streams for a client into a single monthly stream.
    Old streams are paused (not deleted) and linked to the new consolidated one.
    """
    client = await _scoped_client(client_id, current_user, "billing.recurring.consolidate")
    # Use the persisted stable ID from the scoped customer record rather than
    # the route parameter for every subsequent read and write.
    client_id = _normalise_nexus_id(client.get("id"), "client_id")
    streams = await db.recurring_invoices.find({"client_id": client_id, "status": "active", "consolidated_into": {"$exists": False}}, {"_id": 0}).to_list(50)
    for stream in streams:
        await assert_client_scope(
            current_user,
            stream.get("client_id"),
            site_id=stream.get("site_id"),
            operation="billing.recurring.consolidate",
            mask_not_found=True,
        )
    if len(streams) < 2:
        raise HTTPException(status_code=409, detail="Need at least 2 active streams to consolidate")
    combined_lines = []
    total = 0
    for s in streams:
        for li in (s.get("line_items") or []):
            if not isinstance(li, dict):
                raise HTTPException(status_code=409, detail="Recurring invoice has an invalid line item")
            combined_lines.append({**li, "source_stream": s.get("id"), "source_desc": s.get("description")})
            total += _finite_number(li.get("amount", 0), "line item amount", minimum=0)
    total = round(total, 2)
    raw_tax_rate = client.get("tax_rate")
    tax_rate = _finite_number(10 if raw_tax_rate in (None, "") else raw_tax_rate, "client tax rate", minimum=0, maximum=100)
    operation_id = str(uuid.uuid4())
    new_ri = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "client_name": client.get("name"),
        "description": f"Consolidated services â€” {client.get('name')}",
        "frequency": "monthly",
        "payment_terms": "net_30",
        "tax_rate": tax_rate,
        "currency": client.get("currency", "AUD"),
        "auto_send": False,
        "line_items": combined_lines,
        "amount": total,
        # Keep the new stream non-billable until every source stream has been
        # safely paused.  This avoids a competing consolidation creating two
        # active billing paths for one customer.
        "status": "pending_consolidation",
        "start_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "next_due_date": (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d"),
        "consolidates_streams": [s["id"] for s in streams],
        "consolidation_operation_id": operation_id,
        "created_at": _now_iso(),
        "created_by": current_user.get("name"),
        "invoices_generated": 0,
        "total_billed": 0,
        "version": 1,
    }
    await db.recurring_invoices.insert_one(new_ri)
    paused_streams: list[dict] = []
    try:
        for stream in streams:
            result = await db.recurring_invoices.update_one(
                {
                    "id": stream["id"],
                    "client_id": client_id,
                    "status": "active",
                    **_version_filter(stream),
                },
                {
                    "$set": {
                        "status": "paused",
                        "paused_at": _now_iso(),
                        "pause_reason": "Consolidated",
                        "consolidated_into": new_ri["id"],
                        "consolidation_operation_id": operation_id,
                        "updated_at": _now_iso(),
                    },
                    "$inc": {"version": 1},
                },
            )
            if not result.matched_count:
                raise HTTPException(status_code=409, detail="A source recurring invoice changed; refresh and retry consolidation")
            paused_streams.append({**stream, "_paused_version": _next_version(stream)})

        activated = await db.recurring_invoices.update_one(
            {
                "id": new_ri["id"],
                "client_id": client_id,
                "status": "pending_consolidation",
                "version": 1,
            },
            {"$set": {"status": "active", "activated_at": _now_iso(), "updated_at": _now_iso()}, "$inc": {"version": 1}},
        )
        if not activated.matched_count:
            raise HTTPException(status_code=409, detail="Consolidated recurring invoice changed before activation; refresh and retry")
    except Exception as exc:
        # Compensate only streams claimed by this operation.  A failed
        # consolidation therefore leaves no duplicate active billing stream and
        # does not undo another operator's change.
        for stream in paused_streams:
            try:
                await db.recurring_invoices.update_one(
                    {
                        "id": stream["id"],
                        "client_id": client_id,
                        "status": "paused",
                        "consolidation_operation_id": operation_id,
                        "version": stream["_paused_version"],
                    },
                    {
                        "$set": {"status": "active", "updated_at": _now_iso()},
                        "$unset": {"consolidated_into": "", "consolidation_operation_id": ""},
                        "$inc": {"version": 1},
                    },
                )
            except Exception:
                logger.exception("recurring_consolidation_rollback_failed stream_id=%s", stream.get("id"))
        try:
            await db.recurring_invoices.update_one(
                {
                    "id": new_ri["id"],
                    "client_id": client_id,
                    "status": "pending_consolidation",
                    "version": 1,
                },
                {"$set": {"status": "consolidation_failed", "consolidation_failed_at": _now_iso()}, "$inc": {"version": 1}},
            )
        except Exception:
            logger.exception("recurring_consolidation_failure_mark_failed operation_id=%s", operation_id)
        if isinstance(exc, HTTPException):
            raise
        logger.exception("recurring_consolidation_failed operation_id=%s", operation_id)
        raise HTTPException(status_code=503, detail="Recurring invoice consolidation could not be completed") from exc

    new_ri["status"] = "active"
    new_ri["version"] = 2
    await log_activity(
        current_user,
        "consolidated",
        "recurring_invoice",
        new_ri["id"],
        new_ri["description"],
        f"{len(streams)} streams â†’ ${total:.2f}/mo",
        metadata={"client_id": client_id, "source_recurring_invoice_ids": [stream["id"] for stream in streams], "operation_id": operation_id},
    )
    new_ri.pop("_id", None)
    return new_ri


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   4) PRE-BILL PREVIEW (send draft to client before cutting bill)  â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/recurring-invoices/{ri_id}/pre-bill-preview", dependencies=[Depends(require_action("billing.portal.reminder.send"))])
async def send_pre_bill_preview(ri_id: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    # ``data`` remains accepted for older UI clients, but recipient selection is
    # intentionally derived only from retained recurring/client billing data.
    _ = data
    ri = await _scoped_recurring_invoice(ri_id, current_user, "billing.recurring.prebill.send")
    if str(ri.get("status") or "").lower() != "active":
        raise HTTPException(status_code=409, detail="Only active recurring invoices can send a pre-bill preview")
    client = await _scoped_client(ri.get("client_id"), current_user, "billing.recurring.prebill.send")
    email = _trusted_prebill_recipient(ri, client)
    # Compose draft summary
    amt = _finite_number(ri.get("amount") or 0, "recurring amount", minimum=0)
    lines = ri.get("line_items") or []
    rows_parts = []
    for line in lines:
        if not isinstance(line, dict):
            raise HTTPException(status_code=409, detail="Recurring invoice has an invalid line item")
        quantity = _finite_number(line.get("quantity") or 1, "line item quantity", minimum=0)
        rate = _finite_number(line.get("rate") or 0, "line item rate", minimum=0)
        amount = _finite_number(line.get("amount") or 0, "line item amount", minimum=0)
        rows_parts.append(
            "<tr><td style='padding:6px;border:1px solid #eee;'>"
            f"{escape(str(line.get('description') or ''))}</td>"
            "<td style='padding:6px;border:1px solid #eee;text-align:right;'>"
            f"{quantity:g} Ã— ${rate:,.2f}</td>"
            "<td style='padding:6px;border:1px solid #eee;text-align:right;'>"
            f"${amount:,.2f}</td></tr>"
        )
    rows = "".join(rows_parts)
    next_due_raw = ri.get("next_due_date") or ri.get("next_generation")
    next_due_dt = _parse_date(next_due_raw)
    if not next_due_dt:
        raise HTTPException(status_code=409, detail="Recurring invoice needs a valid next due date before sending a preview")
    next_due = next_due_dt.strftime("%Y-%m-%d")
    branding = (await db.settings.find_one({"key": "branding"}, {"_id": 0}) or {}).get("value", {}) or {}
    company = escape(str(branding.get("company_name") or "NexusOps"))
    client_name = escape(str(client.get("name") or "team"))
    html = f"""<div style='font-family:sans-serif;max-width:640px;margin:auto;'>
<h2 style='color:#10B981;'>{company} â€” Pre-Bill Preview</h2>
<p>Hi {client_name},</p>
<p>This is a friendly preview of your upcoming invoice, scheduled for <b>{next_due}</b>:</p>
<table style='border-collapse:collapse;width:100%;'><thead><tr style='background:#10B981;color:white;'><th style='padding:6px;'>Item</th><th style='padding:6px;'>Qty Ã— Rate</th><th style='padding:6px;'>Amount</th></tr></thead><tbody>{rows}</tbody></table>
<p style='text-align:right;font-size:18px;'><b>Total: ${amt:,.2f}</b></p>
<p>If anything looks off, just reply â€” we'll fix it before invoicing.</p>
<p>â€” {company}</p></div>"""

    operation_id = str(uuid.uuid4())
    lock = {"operation_id": operation_id, "next_due": next_due, "claimed_at": _now_iso()}
    claimed = await db.recurring_invoices.update_one(
        {
            "id": ri_id,
            "client_id": ri.get("client_id"),
            "status": ri.get("status"),
            "prebill_preview_sent_for": {"$ne": next_due},
            "prebill_preview_lock": {"$exists": False},
            **_version_filter(ri),
        },
        {"$set": {"prebill_preview_lock": lock, "updated_at": _now_iso()}, "$inc": {"version": 1}},
    )
    if not claimed.matched_count:
        raise HTTPException(status_code=409, detail="A preview was already sent for this billing period or the recurring invoice changed; refresh and retry")
    claimed_version = _next_version(ri)

    from app.routers.email_utils import send_email
    try:
        delivery = await send_email(
            email,
            f"Upcoming invoice preview â€” ${amt:,.2f} due {next_due}",
            html,
            category="billing",
        )
    except Exception as exc:
        await db.recurring_invoices.update_one(
            {
                "id": ri_id,
                "client_id": ri.get("client_id"),
                "status": ri.get("status"),
                "version": claimed_version,
                "prebill_preview_lock": lock,
            },
            {"$unset": {"prebill_preview_lock": ""}, "$set": {"last_prebill_preview_attempt_at": _now_iso(), "updated_at": _now_iso()}, "$inc": {"version": 1}},
        )
        logger.exception("recurring_prebill_delivery_failed recurring_invoice_id=%s", ri_id)
        raise HTTPException(status_code=503, detail="Pre-bill preview could not be delivered") from exc

    if not isinstance(delivery, dict):
        delivery = {"status": "failed", "message": "Mail delivery returned an invalid response"}
    sent = delivery.get("status") == "sent"
    log_entry = {
        "id": str(uuid.uuid4()), "operation_id": operation_id, "ri_id": ri_id, "client_id": client.get("id"),
        "email": email, "amount": amt, "next_due": next_due,
        "sent": sent, "delivery_status": delivery.get("status"), "delivery_message": delivery.get("message"),
        "sender_mailbox": delivery.get("sender"), "sent_at": _now_iso(), "sent_by": current_user.get("name"),
    }
    await db.recurring_prebill_log.insert_one(log_entry)
    final_updates = {
        "last_prebill_preview_attempt_at": _now_iso(),
        "last_prebill_preview_delivery_status": delivery.get("status"),
    }
    if sent:
        final_updates.update({"prebill_preview_sent_for": next_due, "prebill_preview_sent_at": _now_iso()})
    finalised = await db.recurring_invoices.update_one(
        {
            "id": ri_id,
            "client_id": ri.get("client_id"),
            "status": ri.get("status"),
            "version": claimed_version,
            "prebill_preview_lock": lock,
        },
        {"$set": {**final_updates, "updated_at": _now_iso()}, "$unset": {"prebill_preview_lock": ""}, "$inc": {"version": 1}},
    )
    if not finalised.matched_count:
        raise HTTPException(status_code=409, detail="Pre-bill delivery completed but its recurring invoice state changed; reconciliation is required")
    await log_activity(
        current_user,
        "pre_bill_preview",
        "recurring_invoice",
        ri_id,
        ri.get("description", ""),
        f"Preview â†’ {email}",
        metadata={"client_id": client.get("id"), "operation_id": operation_id, "next_due": next_due, "sent": sent},
    )
    return {"sent": sent, "email": email, "preview_html": html, "delivery_status": delivery.get("status"), "delivery_message": delivery.get("message")}


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   5) PAUSE WITH DATE RANGE                                        â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/recurring-invoices/{ri_id}/pause-range", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def pause_with_range(ri_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    ri = await _scoped_recurring_invoice(ri_id, current_user, "billing.recurring.pause_range")
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Pause range payload must be an object")
    if str(ri.get("status") or "").lower() not in {"active", "paused"}:
        raise HTTPException(status_code=409, detail="Only active or paused recurring invoices can be scheduled for a pause")
    from_date = _parse_date(data.get("from_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    to_date = _parse_date(data.get("to_date") or "")
    if not from_date or not to_date:
        raise HTTPException(status_code=422, detail="from_date and to_date are required (YYYY-MM-DD)")
    if to_date <= from_date:
        raise HTTPException(status_code=422, detail="to_date must be after from_date")
    reason = str(data.get("reason") or "").strip()
    if len(reason) > 500:
        raise HTTPException(status_code=422, detail="Pause reason must be 500 characters or fewer")
    pause = {
        "from": from_date.strftime("%Y-%m-%d"),
        "to": to_date.strftime("%Y-%m-%d"),
        "reason": reason,
        "set_by": current_user.get("name"),
        "set_at": _now_iso(),
        "active": True,
    }
    await _update_scoped_recurring(ri, {
        "scheduled_pause": pause,
        "status": "paused" if datetime.now(timezone.utc) >= from_date else ri.get("status", "active"),
    })
    await log_activity(
        current_user,
        "pause_range_set",
        "recurring_invoice",
        ri_id,
        ri.get("description", ""),
        f"{pause['from']} â†’ {pause['to']}",
        metadata={"client_id": ri.get("client_id"), "pause": {"from": pause["from"], "to": pause["to"]}},
    )
    return pause


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   6) MULTI-SOURCE ROLLUP                                          â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/recurring-invoices/{ri_id}/rollup-usage", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def rollup_usage(ri_id: str, current_user: dict = Depends(get_current_user)):
    """Pull current seat/usage counts from Acronis + Pax8 + M365 and add as line items."""
    ri = await _scoped_recurring_invoice(ri_id, current_user, "billing.recurring.usage_rollup")
    if str(ri.get("status") or "").lower() not in {"active", "paused"}:
        raise HTTPException(status_code=409, detail="Only active or paused recurring invoices can roll up billable usage")
    client_id = ri.get("client_id")
    new_lines = list(ri.get("line_items") or [])
    rolled_up = {"acronis": 0, "pax8": 0, "m365": 0}
    if ri.get("include_acronis_usage"):
        # Count Acronis applications for this client
        acronis_app_count = await db.acronis_applications.count_documents({"client_id": client_id, "status": {"$ne": "deleted"}})
        if acronis_app_count > 0:
            unit = _finite_number(ri.get("acronis_unit_price", 8), "Acronis unit price", minimum=0)
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
            unit = _finite_number(ri.get("pax8_markup_per_seat", 5), "Pax8 unit price", minimum=0)
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
        unit = _finite_number(ri.get("m365_unit_price", 28), "Microsoft 365 unit price", minimum=0)
        new_lines.append({
            "description": f"Microsoft 365 â€” {m365_count} users",
            "quantity": m365_count, "rate": unit,
            "amount": round(m365_count * unit, 2),
            "source": "m365_rollup",
        })
        rolled_up["m365"] = m365_count
    if any(not isinstance(line, dict) for line in new_lines):
        raise HTTPException(status_code=409, detail="Recurring invoice has an invalid line item")
    new_amount = round(sum(_finite_number(li.get("amount") or 0, "line item amount", minimum=0) for li in new_lines), 2)
    await _update_scoped_recurring(ri, {
        "line_items": new_lines, "amount": new_amount,
        "last_rollup_at": _now_iso(), "last_rollup_summary": rolled_up,
    })
    await log_activity(
        current_user,
        "usage_rolled_up",
        "recurring_invoice",
        ri_id,
        ri.get("description", ""),
        f"Usage roll-up â†’ ${new_amount:.2f}",
        metadata={"client_id": client_id, "rolled_up": rolled_up},
    )
    return {"success": True, "new_amount": new_amount, "rolled_up": rolled_up, "line_items": new_lines}
