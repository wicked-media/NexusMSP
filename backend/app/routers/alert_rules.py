from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
import logging
from typing import Any
from app.database import db
from app.auth import get_current_user
from app.services.chat_access import ensure_default_channels

router = APIRouter()
logger = logging.getLogger(__name__)

METRIC_OPTIONS = [
    {"id": "cpu_usage", "label": "CPU Usage (%)", "unit": "%"},
    {"id": "memory_usage", "label": "Memory Usage (%)", "unit": "%"},
    {"id": "disk_usage", "label": "Disk Usage (%)", "unit": "%"},
    {"id": "disk_free_gb", "label": "Free Disk Space (GB)", "unit": "GB"},
    {"id": "cpu_temp", "label": "CPU Temperature (°C)", "unit": "°C"},
    {"id": "uptime_hours", "label": "Uptime (hours)", "unit": "h"},
    {"id": "offline_minutes", "label": "Offline Duration (min)", "unit": "min"},
    {"id": "backup_failed", "label": "Backup Failure", "unit": "bool"},
    {"id": "smart_status", "label": "SMART Disk Health", "unit": "status"},
    {"id": "pending_patches", "label": "Pending Patches (count)", "unit": "count"},
    {"id": "antivirus_outdated", "label": "Antivirus Outdated", "unit": "bool"},
]

OPERATORS = ["greater_than", "less_than", "equals", "not_equals", "greater_or_equal", "less_or_equal"]

ACTION_OPTIONS = [
    {"id": "create_ticket", "label": "Create Ticket", "fields": ["priority", "category", "assign_to"]},
    {"id": "send_email", "label": "Send Email Alert", "fields": ["recipients"]},
    {"id": "send_slack", "label": "Send Slack Notification", "fields": ["channel"]},
    {"id": "run_script", "label": "Run Remediation Script", "fields": ["script_id"]},
    {"id": "reboot_device", "label": "Reboot Device", "fields": ["delay_minutes"]},
    {"id": "suppress_30m", "label": "Suppress for 30 min", "fields": []},
]


@router.get("/alert-rules")
async def get_alert_rules(current_user: dict = Depends(get_current_user)):
    rules = await db.alert_rules.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    if not rules:
        rules = await _seed_rules()
    return rules


@router.get("/alert-rules/options")
async def get_alert_rule_options(current_user: dict = Depends(get_current_user)):
    return {"metrics": METRIC_OPTIONS, "operators": OPERATORS, "actions": ACTION_OPTIONS}


@router.get("/alert-rules/stats")
async def get_alert_rules_stats(current_user: dict = Depends(get_current_user)):
    rules = await db.alert_rules.find({}, {"_id": 0}).to_list(200)
    if not rules:
        rules = await _seed_rules()
    total = len(rules)
    active = len([r for r in rules if r.get("enabled")])
    total_triggered = sum(r.get("trigger_count", 0) for r in rules)
    return {"total": total, "active": active, "total_triggered": total_triggered}


def _metric_value(device: dict, metric: str) -> float | None:
    aliases = {
        "cpu_usage": ("cpu_usage", "cpu_load", "cpu_percent"),
        "memory_usage": ("memory_usage", "ram_usage", "memory_pct", "mem_percent"),
        "disk_usage": ("disk_usage", "disk_pct"),
        "disk_free_gb": ("disk_free_gb",),
        "cpu_temp": ("cpu_temp",),
        "pending_patches": ("pending_patches", "patches_pending"),
    }
    if metric == "offline_minutes":
        if str(device.get("status", "")).lower() != "offline":
            return 0
        try:
            last_seen = datetime.fromisoformat(str(device.get("last_seen")).replace("Z", "+00:00"))
            return max(0, (datetime.now(timezone.utc) - last_seen).total_seconds() / 60)
        except (TypeError, ValueError):
            return None
    if metric == "backup_failed":
        return 1 if str(device.get("backup_status", "")).lower() in {"failed", "error"} else 0
    if metric == "antivirus_outdated":
        signature_age = device.get("defender_signature_age_days")
        try:
            stale = float(signature_age) > 3
        except (TypeError, ValueError):
            stale = False
        inactive = str(device.get("antivirus_status", "")).lower() in {"outdated", "error", "inactive"}
        return 1 if inactive or stale else 0
    if metric == "smart_status":
        return 1 if str(device.get("smart_status", "")).lower() in {"failed", "warning", "critical"} else 0
    for field in aliases.get(metric, (metric,)):
        value = device.get(field)
        if value is not None:
            try:
                return float(value)
            except (TypeError, ValueError):
                return None
    return None


def _matches(value: float, operator: str, threshold: Any) -> bool:
    try:
        expected = float(threshold)
    except (TypeError, ValueError):
        return False
    return {
        "greater_than": value > expected,
        "less_than": value < expected,
        "equals": value == expected,
        "not_equals": value != expected,
        "greater_or_equal": value >= expected,
        "less_or_equal": value <= expected,
    }.get(operator, False)


def _in_scope(rule: dict, device: dict) -> bool:
    scope = rule.get("scope", "all")
    filters = rule.get("scope_filter") or {}
    if scope == "all":
        return True
    if scope == "device_type":
        return device.get("device_type") == filters.get("device_type")
    if scope == "client":
        return device.get("client_id") == filters.get("client_id")
    if scope == "device":
        return device.get("id") == filters.get("device_id")
    return True


async def _post_alert_to_chat(alert: dict, *, ticket_number: str | None = None) -> None:
    """Mirror newly-raised high-priority monitoring signals into #alerts once."""
    if str(alert.get("severity") or "").lower() not in {"critical", "high"}:
        return
    await ensure_default_channels()
    channel = await db.chat_channels.find_one({"name": "alerts", "kind": "team"}, {"_id": 0, "id": 1})
    if not channel:
        return
    severity = str(alert.get("severity") or "high").upper()
    target = alert.get("device_name") or "endpoint"
    client = alert.get("client_name") or "Unassigned client"
    body = f"[ALERT · {severity}] {alert.get('message') or 'Monitoring alert'} · {client} / {target}"
    if ticket_number:
        body += f" · /ticket {ticket_number}"
    now = datetime.now(timezone.utc).isoformat()
    await db.chat_messages.insert_one({
        "id": uuid.uuid4().hex,
        "channel_id": channel["id"],
        "user_id": "system",
        "user_name": "Nexus Monitoring",
        "body": body[:5000],
        "ts": now,
        "edited": False,
        "reactions": {},
        "alert_id": alert.get("id"),
        "ticket_refs": [ticket_number] if ticket_number else [],
    })
    await db.chat_channels.update_one({"id": channel["id"]}, {"$set": {"updated_at": now, "last_message_at": now}})


async def evaluate_alert_rules(*, device_ids: list[str] | None = None, create_actions: bool = False, actor: str = "system") -> dict:
    """Evaluate enabled rules against current device telemetry.

    The state collection preserves duration windows and cooldowns.  Calling this
    with create_actions=False is safe for the UI's on-demand health check.
    """
    query = {"id": {"$in": device_ids}} if device_ids else {}
    devices = await db.devices.find(query, {"_id": 0}).to_list(2000)
    rules = await db.alert_rules.find({"enabled": True}, {"_id": 0}).to_list(200)
    now = datetime.now(timezone.utc)
    results: list[dict] = []
    created_alerts = created_tickets = 0

    for rule in rules:
        for device in devices:
            if not _in_scope(rule, device):
                continue
            active_window = await db.maintenance_windows.find_one(
                {"status": "running", "device_ids": device.get("id")}, {"_id": 0, "id": 1, "name": 1}
            )
            if active_window:
                results.append({"rule_id": rule["id"], "device_id": device.get("id"), "status": "suppressed_by_maintenance", "window_id": active_window["id"], "window_name": active_window.get("name")})
                continue
            value = _metric_value(device, rule.get("metric", ""))
            if value is None or not _matches(value, rule.get("operator", ""), rule.get("threshold")):
                await db.alert_rule_state.delete_one({"rule_id": rule["id"], "device_id": device.get("id")})
                continue

            state_key = {"rule_id": rule["id"], "device_id": device.get("id")}
            state = await db.alert_rule_state.find_one(state_key, {"_id": 0}) or {}
            first_seen = state.get("first_seen") or now.isoformat()
            try:
                held_seconds = (now - datetime.fromisoformat(first_seen.replace("Z", "+00:00"))).total_seconds()
            except (TypeError, ValueError):
                held_seconds = 0
            required_seconds = max(0, int(rule.get("duration_minutes") or 0)) * 60
            result = {"rule_id": rule["id"], "device_id": device.get("id"), "value": value, "status": "matched"}
            if held_seconds < required_seconds:
                await db.alert_rule_state.update_one(state_key, {"$set": {"first_seen": first_seen, "last_value": value}}, upsert=True)
                result["status"] = "waiting_for_duration"
                results.append(result)
                continue

            last_triggered = state.get("last_triggered")
            cooldown_seconds = max(0, int(rule.get("cooldown_minutes") or 0)) * 60
            if last_triggered:
                try:
                    elapsed = (now - datetime.fromisoformat(last_triggered.replace("Z", "+00:00"))).total_seconds()
                    if elapsed < cooldown_seconds:
                        result["status"] = "cooldown"
                        results.append(result)
                        continue
                except (TypeError, ValueError):
                    pass

            if not create_actions:
                result["status"] = "would_trigger"
                results.append(result)
                continue

            message = f"{rule.get('name', 'Alert rule')} triggered on {device.get('name', 'device')}: {rule.get('metric')} is {value:g} (threshold {rule.get('threshold')})."
            alert = await db.alerts.find_one({"rule_id": rule["id"], "device_id": device.get("id"), "status": "active"}, {"_id": 0})
            alert_was_created = False
            if not alert:
                alert = {
                    "id": str(uuid.uuid4()), "rule_id": rule["id"], "device_id": device.get("id"),
                    "device_name": device.get("name"), "client_id": device.get("client_id"),
                    "client_name": device.get("client_name"), "alert_type": rule.get("metric"),
                    "severity": rule.get("severity", "high"), "message": message, "status": "active",
                    "created_at": now.isoformat(), "created_by": actor,
                }
                await db.alerts.insert_one(alert)
                await db.devices.update_one({"id": device.get("id")}, {"$inc": {"alerts_count": 1}})
                created_alerts += 1
                alert_was_created = True

            ticket_id = None
            ticket_action = next((a for a in rule.get("actions", []) if a.get("type") == "create_ticket"), None)
            if ticket_action and not alert.get("ticket_id"):
                from app.routers.ticket_suggestions import generate_ticket_number
                ticket_id = uuid.uuid4().hex
                ticket = {
                    "id": ticket_id, "ticket_number": await generate_ticket_number("incident"),
                    "title": f"[Alert] {rule.get('name')} — {device.get('name')}", "description": message,
                    "client_id": device.get("client_id"), "client_name": device.get("client_name"),
                    "device_id": device.get("id"), "device_name": device.get("name"), "device_ids": [device.get("id")],
                    "device_names": [device.get("name")], "priority": (ticket_action.get("config") or {}).get("priority", rule.get("severity", "high")),
                    "status": "open", "category": (ticket_action.get("config") or {}).get("category", "monitoring"),
                    "ticket_type": "alert", "impact": "medium", "source": "monitoring",
                    "tags": ["auto-generated", "monitoring", rule.get("metric", "alert")],
                    "created_at": now.isoformat(), "updated_at": now.isoformat(),
                }
                await db.tickets.insert_one(ticket)
                await db.alerts.update_one({"id": alert["id"]}, {"$set": {"ticket_id": ticket_id, "ticket_number": ticket["ticket_number"]}})
                created_tickets += 1

            if alert_was_created:
                try:
                    await _post_alert_to_chat(alert, ticket_number=ticket_id and ticket["ticket_number"] or alert.get("ticket_number"))
                except Exception as exc:
                    logger.warning("Chat alert broadcast failed for alert %s: %s", alert["id"], exc)

            try:
                from app.routers.workflow_automation import dispatch_workflow_event
                workflow_results = await dispatch_workflow_event("alert_triggered", {
                    "alert_id": alert["id"], "rule_id": rule["id"], "severity": rule.get("severity", "high"),
                    "alert_type": rule.get("metric"), "device_id": device.get("id"), "device_name": device.get("name"),
                    "client_id": device.get("client_id"), "ticket_id": ticket_id or alert.get("ticket_id"),
                })
            except Exception as exc:
                logger.warning("Workflow dispatch failed for alert %s: %s", alert["id"], exc)
                workflow_results = []

            await db.alert_rule_state.update_one(state_key, {"$set": {"first_seen": first_seen, "last_value": value, "last_triggered": now.isoformat(), "alert_id": alert["id"]}}, upsert=True)
            await db.alert_rules.update_one({"id": rule["id"]}, {"$inc": {"trigger_count": 1}, "$set": {"last_triggered": now.isoformat()}})
            result.update({"status": "triggered", "alert_id": alert["id"], "ticket_id": ticket_id, "workflows": len(workflow_results)})
            results.append(result)

    device_names = {device.get("id"): device.get("name") or device.get("hostname") or device.get("id") for device in devices}
    rule_names = {rule.get("id"): rule.get("name") or "Alert rule" for rule in rules}
    for result in results:
        result["device_name"] = device_names.get(result.get("device_id"), result.get("device_id"))
        result["rule_name"] = rule_names.get(result.get("rule_id"), result.get("rule_id"))
    return {"checked_devices": len(devices), "checked_rules": len(rules), "matches": results, "created_alerts": created_alerts, "created_tickets": created_tickets}


@router.post("/alert-rules/evaluate")
async def evaluate_rules(dry_run: bool = True, current_user: dict = Depends(get_current_user)):
    return await evaluate_alert_rules(create_actions=not dry_run, actor=current_user.get("email") or current_user.get("id") or "user")


@router.post("/alert-rules")
async def create_alert_rule(data: dict, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    rule = {
        "id": f"ar-{uuid.uuid4().hex[:8]}",
        "name": data.get("name", ""),
        "description": data.get("description", ""),
        "metric": data.get("metric", "cpu_usage"),
        "operator": data.get("operator", "greater_than"),
        "threshold": data.get("threshold", 90),
        "duration_minutes": data.get("duration_minutes", 5),
        "scope": data.get("scope", "all"),
        "scope_filter": data.get("scope_filter", {}),
        "actions": data.get("actions", []),
        "severity": data.get("severity", "high"),
        "enabled": data.get("enabled", True),
        "cooldown_minutes": data.get("cooldown_minutes", 30),
        "trigger_count": 0,
        "last_triggered": None,
        "created_by": current_user.get("name", ""),
        "created_at": now,
        "updated_at": now,
    }
    await db.alert_rules.insert_one(rule)
    return {k: v for k, v in rule.items() if k != "_id"}


@router.put("/alert-rules/{rule_id}")
async def update_alert_rule(rule_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    r = await db.alert_rules.find_one({"id": rule_id})
    if not r:
        raise HTTPException(status_code=404, detail="Rule not found")
    update = {k: v for k, v in data.items() if k not in ("id", "_id", "created_at")}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.alert_rules.update_one({"id": rule_id}, {"$set": update})
    return {"message": "Rule updated"}


@router.delete("/alert-rules/{rule_id}")
async def delete_alert_rule(rule_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.alert_rules.delete_one({"id": rule_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "Deleted"}


@router.post("/alert-rules/{rule_id}/toggle")
async def toggle_alert_rule(rule_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.alert_rules.find_one({"id": rule_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    new_state = not r.get("enabled", False)
    await db.alert_rules.update_one({"id": rule_id}, {"$set": {"enabled": new_state}})
    return {"enabled": new_state}


async def _seed_rules():
    rules = [
        {"id": "ar-001", "name": "CPU Critical - Servers", "description": "Alert when any server CPU exceeds 90% for 5 minutes", "metric": "cpu_usage", "operator": "greater_than", "threshold": 90, "duration_minutes": 5, "scope": "device_type", "scope_filter": {"device_type": "server"}, "actions": [{"type": "create_ticket", "config": {"priority": "critical", "category": "infrastructure"}}, {"type": "send_email", "config": {"recipients": "noc@company.com"}}], "severity": "critical", "enabled": True, "cooldown_minutes": 30, "trigger_count": 12, "last_triggered": "2026-04-15T10:00:00Z", "created_by": "System", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-04-15T10:00:00Z"},
        {"id": "ar-002", "name": "Disk Space Low", "description": "Alert when disk usage exceeds 85%", "metric": "disk_usage", "operator": "greater_than", "threshold": 85, "duration_minutes": 0, "scope": "all", "scope_filter": {}, "actions": [{"type": "create_ticket", "config": {"priority": "high", "category": "infrastructure"}}], "severity": "high", "enabled": True, "cooldown_minutes": 60, "trigger_count": 8, "last_triggered": "2026-04-14T08:00:00Z", "created_by": "System", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-04-14T08:00:00Z"},
        {"id": "ar-003", "name": "Device Offline > 10min", "description": "Create ticket when any device is offline for more than 10 minutes", "metric": "offline_minutes", "operator": "greater_than", "threshold": 10, "duration_minutes": 0, "scope": "all", "scope_filter": {}, "actions": [{"type": "create_ticket", "config": {"priority": "high"}}, {"type": "send_email", "config": {"recipients": "alerts@company.com"}}], "severity": "high", "enabled": True, "cooldown_minutes": 15, "trigger_count": 24, "last_triggered": "2026-04-16T06:00:00Z", "created_by": "System", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-04-16T06:00:00Z"},
        {"id": "ar-004", "name": "Backup Failure Alert", "description": "Immediate alert on any backup failure", "metric": "backup_failed", "operator": "equals", "threshold": 1, "duration_minutes": 0, "scope": "all", "scope_filter": {}, "actions": [{"type": "create_ticket", "config": {"priority": "critical", "category": "backup"}}, {"type": "send_email", "config": {"recipients": "noc@company.com"}}], "severity": "critical", "enabled": True, "cooldown_minutes": 0, "trigger_count": 5, "last_triggered": "2026-04-13T22:00:00Z", "created_by": "System", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-04-13T22:00:00Z"},
        {"id": "ar-005", "name": "Memory Warning", "description": "Alert when RAM usage exceeds 85% for 10 minutes", "metric": "memory_usage", "operator": "greater_than", "threshold": 85, "duration_minutes": 10, "scope": "all", "scope_filter": {}, "actions": [{"type": "create_ticket", "config": {"priority": "medium"}}], "severity": "medium", "enabled": True, "cooldown_minutes": 60, "trigger_count": 3, "last_triggered": "2026-04-12T14:00:00Z", "created_by": "System", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-04-12T14:00:00Z"},
    ]
    await db.alert_rules.delete_many({})
    for r in rules:
        await db.alert_rules.insert_one(r)
    return [{k: v for k, v in r.items() if k != "_id"} for r in rules]
