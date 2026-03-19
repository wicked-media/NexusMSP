from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/client-timeline/{client_id}")
async def get_client_timeline(client_id: str, current_user: dict = Depends(get_current_user)):
    """Get unified communication timeline for a client."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1, "email": 1})
    if not client:
        return {"error": "Client not found"}

    events = []

    # Tickets
    tickets = await db.tickets.find({"client_id": client_id}, {"_id": 0, "id": 1, "title": 1, "status": 1, "priority": 1, "created_at": 1, "resolved_at": 1, "assigned_to_name": 1}).to_list(100)
    for t in tickets:
        events.append({"type": "ticket_created", "icon": "ticket", "title": f"Ticket: {t.get('title','')}", "subtitle": f"{t.get('priority','')} - {t.get('status','')}", "timestamp": t.get("created_at",""), "ref_id": t["id"], "color": "blue"})
        if t.get("resolved_at"):
            events.append({"type": "ticket_resolved", "icon": "check", "title": f"Resolved: {t.get('title','')}", "subtitle": f"By {t.get('assigned_to_name','Unknown')}", "timestamp": t["resolved_at"], "ref_id": t["id"], "color": "green"})

    # Invoices
    invoices = await db.invoices.find({"client_id": client_id}, {"_id": 0, "id": 1, "invoice_number": 1, "total": 1, "status": 1, "created_at": 1}).to_list(50)
    for inv in invoices:
        events.append({"type": "invoice", "icon": "receipt", "title": f"Invoice {inv.get('invoice_number','')}", "subtitle": f"${inv.get('total',0):,.2f} - {inv.get('status','')}", "timestamp": inv.get("created_at",""), "ref_id": inv["id"], "color": "amber"})

    # Estimates
    estimates = await db.estimates.find({"client_id": client_id}, {"_id": 0, "id": 1, "estimate_number": 1, "title": 1, "total": 1, "status": 1, "created_at": 1}).to_list(50)
    for e in estimates:
        events.append({"type": "estimate", "icon": "file", "title": f"Estimate {e.get('estimate_number','')}: {e.get('title','')}", "subtitle": f"${e.get('total',0):,.2f} - {e.get('status','')}", "timestamp": e.get("created_at",""), "ref_id": e["id"], "color": "violet"})

    # Contracts
    contracts = await db.contracts.find({"client_id": client_id}, {"_id": 0, "name": 1, "status": 1, "created_at": 1, "value": 1}).to_list(20)
    for c in contracts:
        events.append({"type": "contract", "icon": "filetext", "title": f"Contract: {c.get('name','')}", "subtitle": f"${c.get('value',0):,.2f}/mo - {c.get('status','')}", "timestamp": c.get("created_at",""), "color": "emerald"})

    # Devices added
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0, "id": 1, "hostname": 1, "device_type": 1, "created_at": 1}).to_list(100)
    for d in devices:
        if d.get("created_at"):
            events.append({"type": "device_added", "icon": "monitor", "title": f"Device Added: {d.get('hostname','')}", "subtitle": d.get("device_type",""), "timestamp": d.get("created_at",""), "color": "cyan"})

    # Sentiment
    sentiments = await db.client_sentiments.find({"client_id": client_id}, {"_id": 0, "score": 1, "status": 1, "analyzed_at": 1}).to_list(20)
    for s in sentiments:
        events.append({"type": "sentiment", "icon": "heart", "title": f"Sentiment Score: {s.get('score',0)}/100", "subtitle": s.get("status",""), "timestamp": s.get("analyzed_at",""), "color": "pink"})

    # Sort by timestamp descending
    events.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

    return {"client": client, "events": events, "total_events": len(events)}
