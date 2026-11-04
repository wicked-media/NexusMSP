"""Pure policy for the automated invoice-reminder programme.

This module holds the schedule-matching, template-rendering and
settings-normalisation rules only.  Delivery, persistence and authorisation
live in ``app.routers.invoice_reminders`` so the policy can be unit-tested
without a database or mail provider.
"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timedelta
from typing import Any

TEMPLATE_VARIABLES = (
    "client_name",
    "invoice_number",
    "amount_due",
    "due_date",
    "days_overdue",
    "msp_name",
)

TONE_LABELS = {
    "friendly": "Friendly",
    "professional": "Professional",
    "firm": "Firm",
}

DEFAULT_STAGES: tuple[dict[str, Any], ...] = (
    {
        "id": "before-7",
        "kind": "before_due",
        "days": 7,
        "enabled": True,
        "tone": "friendly",
        "subject": "Upcoming invoice {invoice_number} from {msp_name}",
        "message": (
            "Hi {client_name},\n\n"
            "a quick reminder that invoice {invoice_number} for {amount_due} is "
            "due on {due_date}. If it is already scheduled, no action is needed."
        ),
    },
    {
        "id": "due-0",
        "kind": "due_date",
        "days": 0,
        "enabled": True,
        "tone": "professional",
        "subject": "Invoice {invoice_number} is due today",
        "message": (
            "Hi {client_name},\n\n"
            "invoice {invoice_number} for {amount_due} is due today ({due_date}). "
            "Payment can be made at any time from your client portal."
        ),
    },
    {
        "id": "after-1",
        "kind": "after_due",
        "days": 1,
        "enabled": True,
        "tone": "professional",
        "subject": "Invoice {invoice_number} is now overdue",
        "message": (
            "Hi {client_name},\n\n"
            "invoice {invoice_number} for {amount_due} was due on {due_date} and "
            "is now {days_overdue} day(s) overdue. Please arrange payment or let "
            "us know if anything is holding it up."
        ),
    },
    {
        "id": "after-7",
        "kind": "after_due",
        "days": 7,
        "enabled": True,
        "tone": "firm",
        "subject": "Second reminder: invoice {invoice_number} overdue",
        "message": (
            "Hi {client_name},\n\n"
            "invoice {invoice_number} for {amount_due} is now {days_overdue} "
            "day(s) overdue. Please arrange payment promptly or contact us to "
            "discuss the account."
        ),
    },
    {
        "id": "after-14",
        "kind": "after_due",
        "days": 14,
        "enabled": True,
        "tone": "firm",
        "subject": "Final reminder: invoice {invoice_number} overdue",
        "message": (
            "Hi {client_name},\n\n"
            "invoice {invoice_number} for {amount_due} remains unpaid "
            "{days_overdue} days after the due date. This is a final reminder; "
            "please settle the balance or contact us immediately."
        ),
    },
)

_KINDS = {"before_due", "due_date", "after_due"}
_TONES = set(TONE_LABELS)


def parse_date(value: Any) -> date | None:
    """Parse ``YYYY-MM-DD`` into a date, returning None for anything else."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def normalise_reminder_settings(data: dict[str, Any] | None) -> tuple[dict[str, Any], list[str]]:
    """Return ``(settings, errors)`` for a submitted reminder configuration."""
    errors: list[str] = []
    source = data or {}

    stages_in = source.get("stages")
    if stages_in is None:
        stages_in = [dict(stage) for stage in DEFAULT_STAGES]
    if not isinstance(stages_in, list):
        return {}, ["stages must be a list"]
    if len(stages_in) > 24:
        errors.append("A reminder programme supports at most 24 stages")

    stages: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, raw in enumerate(stages_in[:24]):
        if not isinstance(raw, dict):
            errors.append(f"Stage {index + 1} must be an object")
            continue
        kind = str(raw.get("kind") or "").strip()
        if kind not in _KINDS:
            errors.append(f"Stage {index + 1} must be before_due, due_date or after_due")
            continue
        try:
            days = int(raw.get("days"))
        except (TypeError, ValueError):
            errors.append(f"Stage {index + 1} needs a whole number of days")
            continue
        if days < 0 or days > 365:
            errors.append(f"Stage {index + 1} must be between 0 and 365 days")
            continue
        if kind == "before_due" and days == 0:
            kind = "due_date"
        if kind == "due_date" and days != 0:
            errors.append(f"Stage {index + 1}: due_date stages use 0 days")
            continue
        tone = str(raw.get("tone") or "professional").strip().lower()
        if tone not in _TONES:
            tone = "professional"
        subject = str(raw.get("subject") or "").strip()
        message = str(raw.get("message") or "").strip()
        if not subject or not message:
            errors.append(f"Stage {index + 1} needs a subject and a message")
            continue
        if len(subject) > 300:
            errors.append(f"Stage {index + 1} subject is too long")
            continue
        if len(message) > 10000:
            errors.append(f"Stage {index + 1} message is too long")
            continue
        stage_id = str(raw.get("id") or "").strip() or f"stage-{uuid.uuid4().hex[:8]}"
        if stage_id in seen_ids:
            stage_id = f"{stage_id}-{uuid.uuid4().hex[:4]}"
        seen_ids.add(stage_id)
        stages.append({
            "id": stage_id,
            "kind": kind,
            "days": days,
            "enabled": bool(raw.get("enabled", True)),
            "tone": tone,
            "subject": subject,
            "message": message,
        })

    min_balance_raw = source.get("min_balance", 0)
    try:
        min_balance = max(0.0, float(min_balance_raw or 0))
    except (TypeError, ValueError):
        errors.append("min_balance must be a number")
        min_balance = 0.0

    weekday_only = bool(source.get("weekday_only", True))
    if not stages:
        errors.append("Configure at least one reminder stage")

    settings = {
        "type": "invoice_reminders",
        "enabled": bool(source.get("enabled", False)),
        "stages": stages,
        "min_balance": min_balance,
        "weekday_only": weekday_only,
    }
    return settings, errors


def stage_trigger_date(stage: dict[str, Any], due: date) -> date | None:
    """Calendar date on which ``stage`` fires for an invoice due on ``due``."""
    kind = stage.get("kind")
    try:
        days = int(stage.get("days", 0))
    except (TypeError, ValueError):
        return None
    if kind == "before_due":
        return due - timedelta(days=days)
    if kind == "due_date":
        return due
    if kind == "after_due":
        return due + timedelta(days=days)
    return None


def describe_stage(stage: dict[str, Any]) -> str:
    """Human label for one stage, e.g. ``7 days before due``."""
    kind = stage.get("kind")
    try:
        days = int(stage.get("days", 0))
    except (TypeError, ValueError):
        days = 0
    if kind == "due_date" or days == 0:
        return "On the due date"
    if kind == "before_due":
        return f"{days} day{'s' if days != 1 else ''} before due"
    return f"{days} day{'s' if days != 1 else ''} overdue"


def plan_invoice_reminders(
    invoice: dict[str, Any],
    settings: dict[str, Any],
    today: date,
) -> list[dict[str, Any]]:
    """Planned future reminder events for one invoice.

    Paid, cancelled and zero-balance invoices plan nothing.  Stages that fire
    in the past are omitted from the plan (they are the run endpoint's job).
    """
    if not settings.get("enabled"):
        return []
    if str(invoice.get("status") or "") == "cancelled":
        return []
    if str(invoice.get("payment_status") or "") == "paid":
        return []
    balance = _balance(invoice)
    if balance <= 0 or balance < float(settings.get("min_balance", 0) or 0):
        return []
    due = parse_date(invoice.get("due_date"))
    if due is None:
        return []

    plan: list[dict[str, Any]] = []
    for stage in settings.get("stages", []):
        if not stage.get("enabled", True):
            continue
        trigger = stage_trigger_date(stage, due)
        if trigger is None or trigger < today:
            continue
        plan.append({
            "stage_id": stage["id"],
            "label": describe_stage(stage),
            "kind": stage.get("kind"),
            "date": trigger.isoformat(),
        })
    plan.sort(key=lambda item: item["date"])
    return plan


def due_stages(
    invoice: dict[str, Any],
    settings: dict[str, Any],
    today: date,
) -> list[dict[str, Any]]:
    """Stages that must fire today for one invoice."""
    if not settings.get("enabled"):
        return []
    if str(invoice.get("status") or "") == "cancelled":
        return []
    if str(invoice.get("payment_status") or "") == "paid":
        return []
    balance = _balance(invoice)
    if balance <= 0 or balance < float(settings.get("min_balance", 0) or 0):
        return []
    due = parse_date(invoice.get("due_date"))
    if due is None:
        return []
    if settings.get("weekday_only", True) and today.weekday() >= 5:
        return []

    firing: list[dict[str, Any]] = []
    for stage in settings.get("stages", []):
        if not stage.get("enabled", True):
            continue
        if stage_trigger_date(stage, due) == today:
            firing.append(stage)
    return firing


def build_context(invoice: dict[str, Any], client: dict[str, Any] | None, today: date, msp_name: str) -> dict[str, str]:
    """Template variables for one invoice/client pair."""
    due = parse_date(invoice.get("due_date"))
    balance = _balance(invoice)
    days_overdue = (today - due).days if due and today > due else 0
    return {
        "client_name": str((client or {}).get("name") or invoice.get("client_name") or "there"),
        "invoice_number": str(invoice.get("invoice_number") or "invoice"),
        "amount_due": f"${balance:,.2f}",
        "due_date": due.strftime("%d %b %Y") if due else "the due date",
        "days_overdue": str(max(days_overdue, 0)),
        "msp_name": msp_name,
    }


def render_reminder_copy(template: str, context: dict[str, str]) -> str:
    """Substitute ``{variable}`` placeholders; unknown names render empty."""
    def replace(match: re.Match) -> str:
        return str(context.get(match.group(1).strip(), ""))

    return re.sub(r"\{([a-z_]+)\}", replace, str(template or ""))


def _balance(invoice: dict[str, Any]) -> float:
    try:
        total = float(invoice.get("total", 0) or 0)
        paid = float(invoice.get("amount_paid", 0) or 0)
    except (TypeError, ValueError):
        return 0.0
    return round(total - paid, 2)
