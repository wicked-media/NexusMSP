"""Compatibility API for the retired standalone communications workspace.

The UI now lives in Client Insights. These routes intentionally remain for
existing integrations, but read only correspondence captured by NexusMSP's
Microsoft 365 delivery audit layer.
"""

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db

router = APIRouter()


def _display_name(client: dict) -> str:
    return client.get("company_name") or client.get("name") or "Unnamed client"


def _normalise_event(event: dict) -> dict:
    """Expose a delivery-audit record in the legacy timeline contract."""
    direction = event.get("direction", "outbound")
    status = event.get("delivery_status", "recorded")
    subject = event.get("subject") or "(no subject)"
    if direction == "inbound":
        author = event.get("sender_name") or event.get("sender_email") or "Unknown sender"
    else:
        author = event.get("initiated_by_name") or event.get("sender_mailbox") or "NexusMSP"
    return {
        "id": event.get("id"),
        "type": event.get("channel") or "email",
        "description": f"{'Received' if direction == 'inbound' else 'Sent'} email: {subject}",
        "author": author,
        "timestamp": event.get("created_at"),
        "direction": direction,
        "status": status,
        "related_type": event.get("related_type"),
        "related_id": event.get("related_id"),
    }


@router.get("/comms-timeline/client/{client_name}")
async def client_timeline(client_name: str, current_user: dict = Depends(get_current_user)):
    """Compatibility endpoint for integrations using the retired workspace."""
    client = await db.clients.find_one(
        {"$or": [{"name": client_name}, {"company_name": client_name}]},
        {"_id": 0, "id": 1, "name": 1, "company_name": 1},
    )
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    source_events = await db.client_communication_events.find(
        {"client_id": client["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    events = [_normalise_event(event) for event in source_events]
    return {
        "client_name": _display_name(client),
        "events": events,
        "summary": {
            "total": len(events),
            "emails": sum(event["type"] == "email" for event in events),
            "inbound": sum(event["direction"] == "inbound" for event in events),
            "outbound": sum(event["direction"] == "outbound" for event in events),
            "failed": sum(event["status"] == "failed" for event in events),
        },
    }


@router.get("/comms-timeline/overview")
async def comms_overview(current_user: dict = Depends(get_current_user)):
    """Return genuine client correspondence, retaining the legacy API contract."""
    clients = await db.clients.find(
        {}, {"_id": 0, "id": 1, "name": 1, "company_name": 1}
    ).to_list(500)
    client_ids = [client["id"] for client in clients if client.get("id")]
    source_events = await db.client_communication_events.find(
        {"client_id": {"$in": client_ids}}, {"_id": 0}
    ).sort("created_at", -1).to_list(5000)
    events_by_client: dict[str, list[dict]] = defaultdict(list)
    for event in source_events:
        events_by_client[event.get("client_id")].append(_normalise_event(event))

    result = []
    for client in clients:
        events = events_by_client.get(client.get("id"), [])
        result.append({
            "client_name": _display_name(client),
            "last_contact": events[0].get("timestamp") if events else None,
            "total_interactions": len(events),
            "recent": events[:3],
        })
    return sorted(result, key=lambda item: item["last_contact"] or "", reverse=True)
