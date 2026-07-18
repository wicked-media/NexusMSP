"""Read-only audit trail assembled from persisted NexusMSP activity."""
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, Query

from app.auth import get_current_user
from app.database import db

router = APIRouter(prefix="/audit-trail", tags=["audit-trail"])

CATEGORIES = ["auth", "tickets", "billing", "security", "clients", "automation", "monitoring", "devices", "admin", "integrations"]


def _category(entity_type: str, action: str) -> str:
    value = f"{entity_type} {action}".lower()
    if "ticket" in value:
        return "tickets"
    if any(token in value for token in ("device", "agent", "software", "network")):
        return "devices"
    if any(token in value for token in ("maintenance", "workflow", "automation", "patch")):
        return "automation"
    if any(token in value for token in ("security", "defender", "firewall", "encryption")):
        return "security"
    if "client" in value:
        return "clients"
    if any(token in value for token in ("invoice", "payment", "billing")):
        return "billing"
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
            "target": log.get("entity_name") or log.get("entity_id") or "", "ip_address": None,
            "source": "activity_log",
        })
    for event in device_events:
        action = event.get("event_type") or "device_event"
        events.append({
            "id": f"device-event-{event.get('id')}", "timestamp": event.get("timestamp"),
            "user": event.get("user") or "System", "category": "devices", "action": action,
            "severity": _severity(action, event.get("severity")), "description": event.get("message") or "Device event recorded",
            "target": event.get("device_name") or event.get("device_id") or "", "ip_address": None,
            "source": "device_event",
        })
    return sorted((event for event in events if event.get("timestamp")), key=lambda event: event["timestamp"], reverse=True)


@router.get("/events")
async def get_events(
    category: str = Query(None), severity: str = Query(None), user: str = Query(None),
    days: int = Query(30, ge=1, le=3650), current_user: dict = Depends(get_current_user),
):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    events = [event for event in await _events() if event["timestamp"] >= cutoff]
    if category:
        events = [event for event in events if event["category"] == category]
    if severity:
        events = [event for event in events if event["severity"] == severity]
    if user:
        events = [event for event in events if user.lower() in event["user"].lower()]
    return events[:500]


@router.get("/summary")
async def get_summary(current_user: dict = Depends(get_current_user)):
    events = await _events()
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
    }
