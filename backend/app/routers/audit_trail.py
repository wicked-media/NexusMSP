"""Read-only, administrator-only audit trail assembled from persisted NexusMSP activity."""
import csv
import io
import json
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.auth import get_current_user
from app.database import db

router = APIRouter(prefix="/audit-trail", tags=["audit-trail"])

CATEGORIES = ["auth", "tickets", "billing", "security", "clients", "automation", "monitoring", "devices", "admin", "integrations"]


def _require_audit_access(current_user: dict) -> None:
    """Audit history is sensitive operational evidence and is not a staff feed."""
    roles = {"admin", "owner", "super_admin"}
    if current_user.get("role") not in roles and not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Administrator access is required to view the audit trail")


def _category(entity_type: str, action: str) -> str:
    value = f"{entity_type} {action}".lower()
    if any(token in value for token in ("login", "logout", "sign_in", "password", "token", "session", "auth")):
        return "auth"
    if "ticket" in value:
        return "tickets"
    if any(token in value for token in ("invoice", "payment", "billing", "purchase_order", "quote")):
        return "billing"
    if any(token in value for token in ("security", "defender", "firewall", "encryption", "elevate", "privilege")):
        return "security"
    if any(token in value for token in ("integration", "webhook", "microsoft", "xero", "pax8", "yeastar", "unifi")):
        return "integrations"
    if any(token in value for token in ("monitor", "alert", "huntress", "dns", "backup", "uptime")):
        return "monitoring"
    if any(token in value for token in ("device", "agent", "software", "network")):
        return "devices"
    if any(token in value for token in ("maintenance", "workflow", "automation", "patch")):
        return "automation"
    if "client" in value:
        return "clients"
    return "admin"


def _severity(action: str, supplied: str | None = None) -> str:
    if supplied in {"critical", "warning", "info"}:
        return supplied
    value = action.lower()
    if any(token in value for token in ("failed", "error", "critical", "breach")):
        return "critical"
    if any(token in value for token in ("warning", "offline", "retry")):
        return "warning"
    return "info"


async def _events() -> list[dict]:
    logs = await db.activity_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    device_events = await db.device_events.find({}, {"_id": 0}).sort("timestamp", -1).to_list(1000)
    events = []
    for log in logs:
        action = log.get("action") or "activity_recorded"
        entity_type = log.get("entity_type") or "system"
        events.append({
            "id": f"activity-{log.get('id')}", "timestamp": log.get("created_at"),
            "user": log.get("user_name") or "System", "category": _category(entity_type, action),
            "action": action, "severity": _severity(action),
            "description": log.get("details") or f"{entity_type.replace('_', ' ')} activity recorded",
            "target": log.get("entity_name") or log.get("entity_id") or "",
            "ip_address": (log.get("metadata") or {}).get("ip_address"),
            "source": "activity_log", "entity_type": entity_type, "entity_id": log.get("entity_id") or "",
            "changes": log.get("changes") or {}, "metadata": log.get("metadata") or {},
        })
    for event in device_events:
        action = event.get("event_type") or "device_event"
        events.append({
            "id": f"device-event-{event.get('id')}", "timestamp": event.get("timestamp"),
            "user": event.get("user") or "System", "category": "devices", "action": action,
            "severity": _severity(action, event.get("severity")), "description": event.get("message") or "Device event recorded",
            "target": event.get("device_name") or event.get("device_id") or "", "ip_address": None,
            "source": "device_event", "entity_type": "device", "entity_id": event.get("device_id") or "",
            "changes": event.get("changes") or {}, "metadata": event.get("metadata") or {},
        })
    return sorted((event for event in events if event.get("timestamp")), key=lambda event: event["timestamp"], reverse=True)


def _filter_events(events: list[dict], *, days: int, category: str | None = None, severity: str | None = None,
                   user: str | None = None, search: str | None = None) -> list[dict]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    filtered = [event for event in events if event["timestamp"] >= cutoff]
    if category:
        filtered = [event for event in filtered if event["category"] == category]
    if severity:
        filtered = [event for event in filtered if event["severity"] == severity]
    if user:
        needle = user.lower()
        filtered = [event for event in filtered if needle in str(event.get("user") or "").lower()]
    if search:
        needle = search.lower()
        filtered = [
            event for event in filtered
            if needle in " ".join(str(event.get(field) or "") for field in ("user", "category", "action", "description", "target", "entity_type")).lower()
        ]
    return filtered


@router.get("/events")
async def get_events(
    category: str = Query(None), severity: str = Query(None), user: str = Query(None), search: str = Query(None),
    days: int = Query(30, ge=1, le=3650), limit: int = Query(500, ge=1, le=2000), current_user: dict = Depends(get_current_user),
):
    _require_audit_access(current_user)
    return _filter_events(await _events(), days=days, category=category, severity=severity, user=user, search=search)[:limit]


@router.get("/summary")
async def get_summary(
    category: str = Query(None), severity: str = Query(None), user: str = Query(None), search: str = Query(None),
    days: int = Query(30, ge=1, le=3650), current_user: dict = Depends(get_current_user),
):
    _require_audit_access(current_user)
    events = _filter_events(await _events(), days=days, category=category, severity=severity, user=user, search=search)
    category_counts, user_counts = {}, {}
    severity_counts = {"info": 0, "warning": 0, "critical": 0}
    for event in events:
        category_counts[event["category"]] = category_counts.get(event["category"], 0) + 1
        severity_counts[event["severity"]] = severity_counts.get(event["severity"], 0) + 1
        user_counts[event["user"]] = user_counts.get(event["user"], 0) + 1
    now = datetime.now(timezone.utc)
    last_24h = sum(1 for event in events if event["timestamp"] >= (now - timedelta(hours=24)).isoformat())
    prev_24h = sum(1 for event in events if (now - timedelta(hours=48)).isoformat() <= event["timestamp"] < (now - timedelta(hours=24)).isoformat())
    return {
        "total_events": len(events), "last_24h": last_24h, "prev_24h": prev_24h,
        "trend": "up" if last_24h > prev_24h else "down" if last_24h < prev_24h else "flat",
        "by_category": sorted(({"category": key, "count": count} for key, count in category_counts.items()), key=lambda item: item["count"], reverse=True),
        "by_severity": severity_counts,
        "by_user": sorted(({"user": key, "count": count} for key, count in user_counts.items()), key=lambda item: item["count"], reverse=True)[:10],
        "categories": [category for category in CATEGORIES if category in category_counts],
        "source": "persisted-activity",
        "window_days": days,
    }


@router.get("/export")
async def export_events(
    category: str = Query(None), severity: str = Query(None), user: str = Query(None), search: str = Query(None),
    days: int = Query(30, ge=1, le=3650), current_user: dict = Depends(get_current_user),
):
    """Export the exact filtered audit evidence shown in the workspace."""
    _require_audit_access(current_user)
    events = _filter_events(await _events(), days=days, category=category, severity=severity, user=user, search=search)
    output = io.StringIO()
    fields = ["timestamp", "user", "category", "action", "severity", "description", "target", "source", "entity_type", "entity_id", "ip_address", "changes", "metadata"]
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for event in events:
        row = dict(event)
        row["changes"] = json.dumps(row.get("changes") or {}, sort_keys=True, default=str)
        row["metadata"] = json.dumps(row.get("metadata") or {}, sort_keys=True, default=str)
        writer.writerow(row)
    filename = f"nexus-audit-trail-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.csv"
    return Response(
        content=output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
