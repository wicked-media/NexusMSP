from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import uuid

from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _actor(user: dict) -> str:
    return user.get("name") or user.get("email") or "Authenticated technician"


def _run_date(user: dict) -> str:
    timezone_name = user.get("timezone") or "Australia/Sydney"
    try:
        local_timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        local_timezone = timezone.utc
    return datetime.now(timezone.utc).astimezone(local_timezone).date().isoformat()


def _review_steps(checks: dict) -> list[dict]:
    devices = checks.get("devices") or {}
    tickets = checks.get("tickets") or {}
    backups = checks.get("backups") or {}
    security = checks.get("security") or {}
    phones = checks.get("phones") or {}
    overdue = checks.get("overdue_invoices") or {}
    scheduled = checks.get("scheduled_tasks") or []
    recurring = checks.get("recurring_due") or []
    patches = int(checks.get("patches_pending") or 0)

    definitions = [
        {
            "key": "fleet",
            "title": "Fleet and connectivity",
            "description": "Review offline and degraded managed endpoints.",
            "source": "Nexus Agent device evidence",
            "attention": int(devices.get("offline") or 0) + int(devices.get("warning") or 0) > 0,
            "evidence": f"{int(devices.get('online') or 0)} online · {int(devices.get('offline') or 0)} offline · {int(devices.get('warning') or 0)} degraded",
        },
        {
            "key": "service_desk",
            "title": "Service desk triage",
            "description": "Confirm urgent, breached and unassigned work has an owner.",
            "source": "Ticket and SLA records",
            "attention": any(int(tickets.get(key) or 0) > 0 for key in ("critical_high", "sla_breaches", "unassigned")),
            "evidence": f"{int(tickets.get('critical_high') or 0)} critical/high · {int(tickets.get('sla_breaches') or 0)} breached · {int(tickets.get('unassigned') or 0)} unassigned",
        },
        {
            "key": "backups",
            "title": "Backup assurance",
            "description": "Validate failed and warning backup jobs before customer impact.",
            "source": "Connected backup job evidence",
            "attention": int(backups.get("failed") or 0) + int(backups.get("warning") or 0) > 0,
            "evidence": f"{int(backups.get('success') or 0)} successful · {int(backups.get('failed') or 0)} failed · {int(backups.get('warning') or 0)} warning",
        },
        {
            "key": "security",
            "title": "Security response",
            "description": "Review high-priority security signals recorded in the last 24 hours.",
            "source": "Security alert evidence",
            "attention": int(security.get("critical_alerts") or 0) > 0,
            "evidence": f"{int(security.get('alerts_24h') or 0)} signals in 24h · {int(security.get('critical_alerts') or 0)} critical/high",
        },
        {
            "key": "patching",
            "title": "Patch and maintenance exposure",
            "description": "Confirm critical pending updates have a reviewed remediation path.",
            "source": "Patch inventory evidence",
            "attention": patches > 0,
            "evidence": f"{patches} critical or important updates pending",
        },
        {
            "key": "voice_and_tasks",
            "title": "Voice and scheduled operations",
            "description": "Check client PBX connectivity and today's scheduled automation.",
            "source": "Yeastar and scheduler records",
            "attention": int(phones.get("attention") or 0) > 0,
            "evidence": f"{int(phones.get('online') or 0)}/{int(phones.get('pbx_count') or 0)} PBXs online · {len(scheduled)} scheduled tasks",
        },
        {
            "key": "billing",
            "title": "Billing exceptions",
            "description": "Review overdue receivables and recurring runs that need operational follow-up.",
            "source": "Billing and recurring invoice records",
            "attention": int(overdue.get("count") or 0) + len(recurring) > 0,
            "evidence": f"{int(overdue.get('count') or 0)} overdue invoices · {len(recurring)} recurring runs due",
        },
    ]
    steps = []
    for definition in definitions:
        attention = definition.pop("attention")
        steps.append({
            **definition,
            "signal": "attention" if attention else "clear",
            "outcome": "pending",
            "note": "",
            "reviewed_at": None,
            "reviewed_by": None,
        })
    return steps

@router.get("/dashboard/daily-review")
@router.get("/morning-checks")
async def get_morning_checks(current_user: dict = Depends(get_current_user)):
    """Aggregate all critical morning check data for MSP NOC team"""
    now = datetime.now(timezone.utc)
    today_str = _run_date(current_user)
    yesterday = (now - timedelta(days=1)).isoformat()

    # 1. Device Health
    all_devices = await db.devices.find({}, {"_id": 0, "id": 1, "name": 1, "hostname": 1, "status": 1, "client_name": 1, "device_type": 1, "last_seen": 1, "os": 1}).to_list(1000)
    online = [d for d in all_devices if d.get("status") == "online"]
    offline = [d for d in all_devices if d.get("status") == "offline"]
    warning = [d for d in all_devices if d.get("status") in ("warning", "degraded")]

    # 2. Open Tickets (critical/high, unassigned, SLA breaches)
    open_tickets = await db.tickets.find({"status": {"$in": ["open", "in_progress", "on_hold"]}}, {"_id": 0, "id": 1, "title": 1, "priority": 1, "status": 1, "client_name": 1, "assigned_to": 1, "assigned_name": 1, "sla_due": 1, "created_at": 1}).to_list(500)
    critical_tickets = [t for t in open_tickets if t.get("priority") in ("critical", "high")]
    unassigned = [t for t in open_tickets if not t.get("assigned_to")]
    sla_breaches = [t for t in open_tickets if t.get("sla_due") and t["sla_due"] < now.isoformat() and t.get("status") not in ("closed", "resolved")]
    overnight_tickets = await db.tickets.find({"created_at": {"$gte": yesterday}, "status": {"$in": ["open", "in_progress"]}}, {"_id": 0, "id": 1, "title": 1, "priority": 1, "client_name": 1, "created_at": 1}).to_list(100)

    # 3. Backup Status
    backups = await db.backup_jobs.find({}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "status": 1, "last_run": 1, "next_run": 1, "type": 1}).to_list(500)
    backup_failed = [b for b in backups if b.get("status") in ("failed", "error")]
    backup_warning = [b for b in backups if b.get("status") == "warning"]
    backup_success = [b for b in backups if b.get("status") in ("success", "completed")]

    # 4. Security Alerts
    alerts = await db.security_alerts.find({"created_at": {"$gte": yesterday}}, {"_id": 0}).sort("created_at", -1).to_list(50)
    critical_alerts = [a for a in alerts if a.get("severity") in ("critical", "high")]

    # 5. Yeastar Phone Status (client-linked PBXs only)
    yeastar_pbxs = await db.yeastar_pbxs.find(
        {"enabled": {"$ne": False}},
        {"_id": 0, "status": 1, "pbx_url": 1, "client_api_id": 1, "client_secret": 1},
    ).to_list(500)
    yeastar_configured = any(
        pbx.get("pbx_url") and pbx.get("client_api_id") and pbx.get("client_secret")
        for pbx in yeastar_pbxs
    )

    # 6. Client Health Summary
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(200)
    client_health = []
    for client in clients[:30]:
        c_devices = [d for d in all_devices if d.get("client_name") == client["name"]]
        c_offline = [d for d in c_devices if d.get("status") == "offline"]
        c_tickets = [t for t in open_tickets if t.get("client_name") == client["name"]]
        c_critical = [t for t in c_tickets if t.get("priority") in ("critical", "high")]
        c_backups_failed = [b for b in backup_failed if b.get("client_name") == client["name"]]
        issues = len(c_offline) + len(c_critical) + len(c_backups_failed)
        status = "red" if issues >= 3 or len(c_critical) > 0 or len(c_backups_failed) > 0 else "amber" if issues >= 1 or len(c_offline) > 0 else "green"
        if c_devices or c_tickets:
            client_health.append({
                "client_name": client["name"],
                "status": status,
                "devices_total": len(c_devices),
                "devices_offline": len(c_offline),
                "open_tickets": len(c_tickets),
                "critical_tickets": len(c_critical),
                "backups_failed": len(c_backups_failed),
            })
    client_health.sort(key=lambda c: {"red": 0, "amber": 1, "green": 2}.get(c["status"], 3))

    # 7. Scheduled Tasks for Today
    tasks_today = await db.scheduled_tasks.find({"enabled": True}, {"_id": 0, "id": 1, "name": 1, "script_name": 1, "schedule_type": 1, "schedule_time": 1, "last_run": 1}).to_list(100)

    # 8. Recurring Invoices Due
    rec_due = await db.xero_recurring.find({"status": "active", "next_generation": {"$lte": today_str}}, {"_id": 0, "id": 1, "client_name": 1, "description": 1, "amount": 1, "next_generation": 1}).to_list(50)

    # 9. Patch Status
    patch_stats = await db.patches.find({"status": "pending"}, {"_id": 0}).to_list(100)
    critical_patches = [p for p in patch_stats if p.get("severity") in ("critical", "important")]

    # 10. Overdue Invoices
    overdue_invoices = await db.xero_invoices.find({"status": "AUTHORISED", "due_date": {"$lt": today_str}}, {"_id": 0, "id": 1, "invoice_number": 1, "client_name": 1, "amount_due": 1, "due_date": 1}).to_list(100)

    # Calculate overall health score
    total_issues = len(offline) + len(critical_tickets) + len(sla_breaches) + len(backup_failed) + len(critical_alerts)
    max_issues = max(len(all_devices), 1) + max(len(open_tickets), 1)
    health_score = max(0, min(100, int(100 - (total_issues / max(max_issues * 0.1, 1)) * 100)))

    return {
        "timestamp": now.isoformat(),
        "run_date": today_str,
        "health_score": health_score,
        "devices": {
            "total": len(all_devices),
            "online": len(online),
            "offline": len(offline),
            "warning": len(warning),
            "offline_list": [{"id": d.get("id", ""), "name": d.get("name") or d.get("hostname", "Unknown"), "client_name": d.get("client_name", ""), "device_type": d.get("device_type", ""), "last_seen": d.get("last_seen", "")} for d in offline[:20]],
        },
        "tickets": {
            "total_open": len(open_tickets),
            "critical_high": len(critical_tickets),
            "unassigned": len(unassigned),
            "sla_breaches": len(sla_breaches),
            "overnight_new": len(overnight_tickets),
            "critical_list": [{"id": t["id"], "title": t["title"], "priority": t.get("priority"), "client_name": t.get("client_name", ""), "status": t.get("status"), "assigned_name": t.get("assigned_name", "")} for t in critical_tickets[:15]],
            "sla_breach_list": [{"id": t["id"], "title": t["title"], "client_name": t.get("client_name", ""), "sla_due": t.get("sla_due", "")} for t in sla_breaches[:10]],
            "overnight_list": [{"id": t["id"], "title": t["title"], "priority": t.get("priority"), "client_name": t.get("client_name", ""), "created_at": t.get("created_at", "")} for t in overnight_tickets[:10]],
        },
        "backups": {
            "total": len(backups),
            "success": len(backup_success),
            "failed": len(backup_failed),
            "warning": len(backup_warning),
            "failed_list": [{"name": b.get("name", ""), "client_name": b.get("client_name", ""), "last_run": b.get("last_run", ""), "type": b.get("type", "")} for b in backup_failed[:10]],
        },
        "security": {
            "alerts_24h": len(alerts),
            "critical_alerts": len(critical_alerts),
            "alert_list": [{"id": a.get("id", ""), "title": a.get("title", a.get("message", "")), "severity": a.get("severity", ""), "created_at": a.get("created_at", "")} for a in critical_alerts[:10]],
        },
        "phones": {
            "configured": yeastar_configured,
            "pbx_count": len(yeastar_pbxs),
            "online": len([pbx for pbx in yeastar_pbxs if pbx.get("status") == "online"]),
            "attention": len([pbx for pbx in yeastar_pbxs if pbx.get("status") != "online"]),
        },
        "client_health": client_health,
        "scheduled_tasks": [{"name": t.get("name", ""), "script_name": t.get("script_name", ""), "schedule_time": t.get("schedule_time", ""), "last_run": t.get("last_run", "")} for t in tasks_today[:10]],
        "recurring_due": [{"client_name": r.get("client_name", ""), "description": r.get("description", ""), "amount": r.get("amount", 0)} for r in rec_due],
        "patches_pending": len(critical_patches),
        "overdue_invoices": {
            "count": len(overdue_invoices),
            "total_amount": sum(i.get("amount_due", 0) for i in overdue_invoices),
            "list": [{"invoice_number": i.get("invoice_number", ""), "client_name": i.get("client_name", ""), "amount_due": i.get("amount_due", 0), "due_date": i.get("due_date", "")} for i in overdue_invoices[:10]],
        },
    }


@router.get("/dashboard/daily-review/runs")
@router.get("/morning-checks/runs")
async def list_morning_check_runs(limit: int = 30, current_user: dict = Depends(get_current_user)):
    safe_limit = max(1, min(limit, 100))
    return await db.morning_check_runs.find({}, {"_id": 0}).sort("started_at", -1).to_list(safe_limit)


@router.post("/dashboard/daily-review/runs/start")
@router.post("/morning-checks/runs/start")
async def start_morning_check_run(data: dict | None = None, current_user: dict = Depends(get_current_user)):
    data = data or {}
    run_date = _run_date(current_user)
    existing = await db.morning_check_runs.find_one(
        {"run_date": run_date, "status": "in_progress"}, {"_id": 0}
    )
    if existing:
        return existing

    checks = await get_morning_checks(current_user)
    now = _now()
    run = {
        "id": str(uuid.uuid4()),
        "run_date": run_date,
        "status": "in_progress",
        "title": data.get("title") or f"Daily NOC review · {run_date}",
        "started_at": now,
        "started_by": _actor(current_user),
        "started_by_id": current_user.get("id"),
        "snapshot_generated_at": checks.get("timestamp"),
        "snapshot_health_score": checks.get("health_score"),
        "steps": _review_steps(checks),
        "handoff_note": "",
        "completed_at": None,
        "completed_by": None,
    }
    # Motor adds MongoDB's private ObjectId to the inserted mapping. Insert a
    # copy so the API response remains an ID-safe Nexus record.
    await db.morning_check_runs.insert_one(dict(run))
    await log_activity(
        current_user,
        "morning_review_started",
        "morning_check_run",
        run["id"],
        run["title"],
        "Started an auditable daily NOC review from the current operational snapshot",
        metadata={"run_date": run_date, "health_score": run.get("snapshot_health_score")},
    )
    return run


@router.post("/dashboard/daily-review/runs/{run_id}/steps/{step_key}")
@router.post("/morning-checks/runs/{run_id}/steps/{step_key}")
async def review_morning_check_step(
    run_id: str,
    step_key: str,
    data: dict | None = None,
    current_user: dict = Depends(get_current_user),
):
    data = data or {}
    outcome = str(data.get("outcome") or "").strip().lower()
    note = str(data.get("note") or "").strip()
    if outcome not in {"reviewed", "exception"}:
        raise HTTPException(status_code=422, detail="Outcome must be reviewed or exception")
    if outcome == "exception" and len(note) < 8:
        raise HTTPException(status_code=422, detail="Record the exception, owner, or next action")

    run = await db.morning_check_runs.find_one({"id": run_id, "status": "in_progress"}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Active morning review not found")
    if step_key not in {step.get("key") for step in run.get("steps") or []}:
        raise HTTPException(status_code=404, detail="Morning review step not found")

    reviewed_at = _now()
    steps = [
        {
            **step,
            "outcome": outcome,
            "note": note,
            "reviewed_at": reviewed_at,
            "reviewed_by": _actor(current_user),
        } if step.get("key") == step_key else step
        for step in run.get("steps") or []
    ]
    result = await db.morning_check_runs.update_one(
        {"id": run_id, "status": "in_progress"},
        {"$set": {"steps": steps, "updated_at": reviewed_at, "updated_by": _actor(current_user)}},
    )
    if not result.modified_count:
        raise HTTPException(status_code=409, detail="Morning review changed before this step was recorded")
    updated = await db.morning_check_runs.find_one({"id": run_id}, {"_id": 0})
    await log_activity(
        current_user,
        "morning_review_step_recorded",
        "morning_check_run",
        run_id,
        run.get("title") or "Daily NOC review",
        f"{step_key.replace('_', ' ').title()} marked {outcome}",
        metadata={"step_key": step_key, "outcome": outcome, "note": note},
    )
    return updated


@router.post("/dashboard/daily-review/runs/{run_id}/complete")
@router.post("/morning-checks/runs/{run_id}/complete")
async def complete_morning_check_run(
    run_id: str,
    data: dict | None = None,
    current_user: dict = Depends(get_current_user),
):
    data = data or {}
    handoff_note = str(data.get("handoff_note") or "").strip()
    if len(handoff_note) < 12:
        raise HTTPException(status_code=422, detail="Record a meaningful handoff or all-clear summary")

    run = await db.morning_check_runs.find_one({"id": run_id, "status": "in_progress"}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Active morning review not found")
    pending = [step.get("title") for step in run.get("steps") or [] if step.get("outcome") == "pending"]
    if pending:
        raise HTTPException(status_code=409, detail=f"Review every section before sign-off: {', '.join(pending)}")

    completed_at = _now()
    completed_by = _actor(current_user)
    result = await db.morning_check_runs.update_one(
        {"id": run_id, "status": "in_progress"},
        {"$set": {
            "status": "completed",
            "handoff_note": handoff_note,
            "completed_at": completed_at,
            "completed_by": completed_by,
            "completed_by_id": current_user.get("id"),
        }},
    )
    if not result.modified_count:
        raise HTTPException(status_code=409, detail="Morning review changed before sign-off")
    completed = await db.morning_check_runs.find_one({"id": run_id}, {"_id": 0})
    await log_activity(
        current_user,
        "morning_review_completed",
        "morning_check_run",
        run_id,
        run.get("title") or "Daily NOC review",
        f"Signed off the daily NOC review with {sum(1 for step in run.get('steps') or [] if step.get('outcome') == 'exception')} recorded exception(s)",
        metadata={"run_date": run.get("run_date"), "handoff_note": handoff_note},
    )
    return completed


@router.post("/dashboard/daily-review/runs/{run_id}/cancel")
@router.post("/morning-checks/runs/{run_id}/cancel")
async def cancel_morning_check_run(
    run_id: str,
    data: dict | None = None,
    current_user: dict = Depends(get_current_user),
):
    reason = str((data or {}).get("reason") or "").strip()
    if len(reason) < 8:
        raise HTTPException(status_code=422, detail="Record why this review was cancelled")
    run = await db.morning_check_runs.find_one({"id": run_id, "status": "in_progress"}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Active morning review not found")
    cancelled_at = _now()
    cancelled_by = _actor(current_user)
    result = await db.morning_check_runs.update_one(
        {"id": run_id, "status": "in_progress"},
        {"$set": {
            "status": "cancelled",
            "cancelled_at": cancelled_at,
            "cancelled_by": cancelled_by,
            "cancel_reason": reason,
        }},
    )
    if not result.modified_count:
        raise HTTPException(status_code=409, detail="Morning review changed before cancellation")
    cancelled = await db.morning_check_runs.find_one({"id": run_id}, {"_id": 0})
    await log_activity(
        current_user,
        "morning_review_cancelled",
        "morning_check_run",
        run_id,
        run.get("title") or "Daily NOC review",
        f"Cancelled the daily NOC review: {reason}",
        metadata={"run_date": run.get("run_date"), "reason": reason},
    )
    return cancelled
