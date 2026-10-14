"""Automated invoice-reminder programme.

Thin HTTP surface over ``app.services.invoice_reminders``: configure the
programme, preview which reminders are planned, inspect delivery history and
run due reminders.  The durable ``invoice_reminder_scheduler`` loop lets the
API/worker runtime send due reminders automatically so billing administrators
do not have to follow up manually.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.routers.email_utils import send_email
from app.services import invoice_reminders as policy
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.scope_permissions import assert_global_scope

logger = logging.getLogger("nexus.invoice_reminders")

router = APIRouter(prefix="/billing/invoice-reminders", tags=["invoice-reminders"])

SYSTEM_ACTOR = {"id": "system", "name": "Reminder automation"}


# ============== helpers ==============

async def _load_settings() -> dict:
    stored = await db.settings.find_one({"type": "invoice_reminders"}, {"_id": 0})
    if not stored:
        normalised, _ = policy.normalise_reminder_settings({})
        return normalised
    normalised, errors = policy.normalise_reminder_settings(stored)
    if errors:
        # Never let a hand-edited stored document block the programme; fall
        # back to the built-in defaults and let the UI re-save cleanly.
        logger.warning("invoice_reminder_settings_invalid errors=%s", errors)
        normalised, _ = policy.normalise_reminder_settings({})
    return normalised


def _reminder_html(context: dict, message: str, tone: str) -> str:
    body = "".join(f"<p style=\"margin:0 0 14px;line-height:1.65;color:#334155;font-size:14px\">{line or '&nbsp;'}</p>"
                   for line in message.split("\n"))
    tone_label = policy.TONE_LABELS.get(tone, "Professional")
    return f"""
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px">
      <div style="border-bottom:1px solid #e2e8f0;padding-bottom:14px;margin-bottom:20px">
        <p style="margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#10b981;font-weight:700">
          {tone_label} reminder &middot; {context.get('msp_name', 'Your service provider')}
        </p>
      </div>
      {body}
      <div style="border-top:1px solid #e2e8f0;padding-top:14px;margin-top:22px;font-size:11px;color:#94a3b8">
        Invoice {context.get('invoice_number', '')} &middot; amount due {context.get('amount_due', '')}
        &middot; due {context.get('due_date', '')}
      </div>
    </div>
    """


async def _billing_contact(client_id: str, invoice: dict) -> str | None:
    client = await db.clients.find_one({"id": client_id}, {"_id": 0}) if client_id else None
    for candidate in (
        (client or {}).get("billing_email"),
        (client or {}).get("email"),
        invoice.get("billing_email"),
    ):
        address = str(candidate or "").strip()
        if "@" in address:
            return address
    return None


async def run_due_reminders(actor: dict, *, force: bool = False, today=None) -> dict:
    """Send every reminder that is due today.

    Idempotent per (invoice, stage, date): an invoice already reminded for a
    stage today is skipped.  ``force=True`` (manual "Run now") bypasses the
    programme enable switch and the weekend hold.
    """
    now = datetime.now(timezone.utc)
    today = today or now.date()
    settings = await _load_settings()
    if force:
        settings = {**settings, "enabled": True, "weekday_only": False}

    summary = {"sent": 0, "skipped": 0, "failed": 0, "items": []}
    if not settings.get("enabled"):
        return {**summary, "message": "Reminder programme is disabled"}
    if settings.get("weekday_only", True) and today.weekday() >= 5 and not force:
        return {**summary, "message": "Weekend hold active — reminders resume on the next business day"}

    invoices = await db.invoices.find(
        {"payment_status": {"$in": ["unpaid", "partial"]}, "status": {"$ne": "cancelled"}},
        {"_id": 0},
    ).to_list(10000)
    msp_name = await _msp_name()

    for invoice in invoices:
        firing = policy.due_stages(invoice, settings, today) if not force else [
            stage for stage in settings.get("stages", [])
            if stage.get("enabled", True) and policy.stage_trigger_date(stage, policy.parse_date(invoice.get("due_date")) or today) == today
        ]
        if not firing:
            continue
        recipient = await _billing_contact(str(invoice.get("client_id") or ""), invoice)
        for stage in firing:
            already = await db.invoice_reminder_log.find_one({
                "invoice_id": invoice.get("id"),
                "stage_id": stage["id"],
                "sent_on": today.isoformat(),
            }, {"_id": 0})
            if already:
                summary["skipped"] += 1
                continue
            if not recipient:
                summary["skipped"] += 1
                summary["items"].append({
                    "invoice_number": invoice.get("invoice_number"),
                    "stage": policy.describe_stage(stage),
                    "outcome": "skipped_no_billing_contact",
                })
                continue
            client = await db.clients.find_one({"id": invoice.get("client_id", "")}, {"_id": 0})
            context = policy.build_context(invoice, client, today, msp_name)
            subject = policy.render_reminder_copy(stage.get("subject", ""), context)
            message = policy.render_reminder_copy(stage.get("message", ""), context)
            entry = {
                "id": str(uuid.uuid4()),
                "invoice_id": invoice.get("id"),
                "invoice_number": invoice.get("invoice_number", ""),
                "client_id": invoice.get("client_id", ""),
                "client_name": context["client_name"],
                "stage_id": stage["id"],
                "stage_label": policy.describe_stage(stage),
                "tone": stage.get("tone", "professional"),
                "to_email": recipient,
                "subject": subject,
                "sent_on": today.isoformat(),
                "sent_at": now.isoformat(),
                "triggered_by": actor.get("id", "system"),
                "triggered_by_name": actor.get("name", "System"),
            }
            try:
                result = await send_email(
                    recipient,
                    subject,
                    _reminder_html(context, message, stage.get("tone", "professional")),
                    category="billing",
                    client_id=invoice.get("client_id"),
                    related_type="invoice",
                    related_id=invoice.get("id"),
                    initiated_by=actor.get("id"),
                    initiated_by_name=actor.get("name"),
                )
                entry["delivery"] = result.get("status", "sent")
                entry["delivery_id"] = result.get("delivery_id")
                summary["sent"] += 1
                outcome = entry["delivery"]
            except Exception as exc:  # delivery must never crash the run
                logger.warning("invoice_reminder_send_failed invoice=%s stage=%s error=%s",
                               invoice.get("id"), stage["id"], exc)
                entry["delivery"] = "failed"
                entry["error"] = str(exc)[:500]
                summary["failed"] += 1
                outcome = "failed"

            await db.invoice_reminder_log.insert_one(entry)
            await db.invoices.update_one({"id": invoice.get("id")}, {"$set": {
                "last_reminder_date": today.isoformat(),
                "reminder_count": (invoice.get("reminder_count", 0) or 0) + 1,
            }})
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": invoice.get("created_by", actor.get("id", "system")),
                "title": f"Invoice reminder sent: {invoice.get('invoice_number', '')}",
                "message": f"{policy.describe_stage(stage)} reminder to {recipient} ({outcome})",
                "severity": "info",
                "type": "payment_reminder",
                "ref_type": "invoice",
                "ref_id": invoice.get("id"),
                "read": False,
                "created_at": now.isoformat(),
            })
            summary["items"].append({
                "invoice_number": invoice.get("invoice_number"),
                "stage": policy.describe_stage(stage),
                "outcome": outcome,
                "to_email": recipient,
            })

    if actor.get("id") != "system":
        await log_activity(
            actor,
            "invoice_reminders_run",
            "billing",
            "invoice_reminders",
            f"{summary['sent']} sent",
            details="Manual invoice reminder run",
            metadata={"sent": summary["sent"], "skipped": summary["skipped"], "failed": summary["failed"]},
        )
    summary["message"] = f"{summary['sent']} reminder(s) sent, {summary['skipped']} skipped, {summary['failed']} failed"
    return summary


async def _msp_name() -> str:
    settings = await db.settings.find_one({"type": "organization"}, {"_id": 0})
    return str((settings or {}).get("company_name") or "NexusMSP")


async def invoice_reminder_scheduler():
    """Durable loop: send due reminders automatically once per hour."""
    while True:
        try:
            await asyncio.sleep(3600)
            await run_due_reminders(SYSTEM_ACTOR)
        except Exception as exc:
            logger.error("invoice_reminder_scheduler_error error=%s", exc)


# ============== configuration ==============

@router.get("")
async def get_reminder_programme(current_user: dict = Depends(get_current_user)):
    settings = await _load_settings()
    sent_30d = await db.invoice_reminder_log.count_documents({
        "sent_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()},
    })
    last = await db.invoice_reminder_log.find({}, {"_id": 0}).sort("sent_at", -1).to_list(1)
    return {
        "settings": settings,
        "summary": {
            "automation": "active" if settings.get("enabled") else "paused",
            "active_stages": sum(1 for s in settings.get("stages", []) if s.get("enabled", True)),
            "sent_last_30d": sent_30d,
            "last_run_at": (last[0].get("sent_at") if last else None),
        },
    }


@router.put("", dependencies=[Depends(require_action("billing.reminder.schedule.manage"))])
async def update_reminder_programme(
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    await assert_global_scope(current_user, operation="billing.invoice_reminders.configure", request=request)
    settings, errors = policy.normalise_reminder_settings(data)
    if errors:
        raise HTTPException(status_code=422, detail="; ".join(errors))
    settings["updated_at"] = datetime.now(timezone.utc).isoformat()
    settings["updated_by"] = current_user.get("name", "")
    await db.settings.update_one({"type": "invoice_reminders"}, {"$set": settings}, upsert=True)
    await log_activity(current_user, "invoice_reminders_configured", "billing", "invoice_reminders",
                       f"{len(settings['stages'])} stages",
                       details="Updated the automated invoice reminder programme",
                       metadata={"enabled": settings["enabled"], "stages": len(settings["stages"])})
    return {"message": "Reminder programme saved", "settings": settings}


@router.get("/schedule")
async def reminder_schedule(current_user: dict = Depends(get_current_user)):
    """What is set up to fire: upcoming reminders across unpaid invoices."""
    settings = await _load_settings()
    today = datetime.now(timezone.utc).date()
    invoices = await db.invoices.find(
        {"payment_status": {"$in": ["unpaid", "partial"]}, "status": {"$ne": "cancelled"}},
        {"_id": 0},
    ).to_list(2000)
    rows = []
    for invoice in invoices:
        plan = policy.plan_invoice_reminders(invoice, settings, today)
        if not plan:
            continue
        rows.append({
            "invoice_id": invoice.get("id"),
            "invoice_number": invoice.get("invoice_number", ""),
            "client_name": invoice.get("client_name", ""),
            "due_date": invoice.get("due_date", ""),
            "balance": policy.build_context(invoice, None, today, "")["amount_due"],
            "next_reminder_date": plan[0]["date"],
            "next_reminder_label": plan[0]["label"],
            "plan": plan,
        })
    rows.sort(key=lambda row: row["next_reminder_date"])
    upcoming_7d = sum(1 for row in rows if row["next_reminder_date"] <= (today + timedelta(days=7)).isoformat())
    return {
        "generated_at": today.isoformat(),
        "automation": "active" if settings.get("enabled") else "paused",
        "upcoming_7d": upcoming_7d,
        "total_planned": len(rows),
        "items": rows[:100],
    }


@router.get("/history")
async def reminder_history(current_user: dict = Depends(get_current_user)):
    entries = await db.invoice_reminder_log.find({}, {"_id": 0}).sort("sent_at", -1).to_list(100)
    return {"items": entries}


@router.post("/run", dependencies=[Depends(require_action("billing.portal.reminder.send"))])
async def run_reminders_now(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    await assert_global_scope(current_user, operation="billing.invoice_reminders.run", request=request)
    return await run_due_reminders(current_user, force=True)


@router.post("/preview")
async def preview_reminder_copy(
    data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Render one stage's templates against a sample or real invoice."""
    stage = data.get("stage") or {}
    invoice_id = str(data.get("invoice_id") or "")
    today = datetime.now(timezone.utc).date()
    if invoice_id:
        invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")
        client = await db.clients.find_one({"id": invoice.get("client_id", "")}, {"_id": 0})
    else:
        invoice = {"invoice_number": "INV-PREVIEW-001", "total": 1250.0, "amount_paid": 0,
                   "due_date": (today + timedelta(days=7)).isoformat(), "client_name": "Sample client"}
        client = None
    context = policy.build_context(invoice, client, today, await _msp_name())
    return {
        "subject": policy.render_reminder_copy(str(stage.get("subject") or ""), context),
        "message": policy.render_reminder_copy(str(stage.get("message") or ""), context),
        "context": context,
        "variables": policy.TEMPLATE_VARIABLES,
    }
