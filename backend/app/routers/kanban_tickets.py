from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user

router = APIRouter()

@router.get("/kanban-tickets/board")
async def get_kanban_board(current_user: dict = Depends(get_current_user)):
    tickets = await db.tickets.find({}, {"_id": 0}).to_list(500)
    columns = {"open": [], "in_progress": [], "waiting": [], "resolved": [], "closed": []}
    for t in tickets:
        status = t.get("status", "open").lower().replace(" ", "_")
        if status in columns:
            columns[status].append({"id": t["id"], "title": t.get("subject", t.get("title", "")), "client_name": t.get("client_name", ""), "priority": t.get("priority", "medium"), "assigned_to": t.get("assigned_to", ""), "ticket_number": t.get("ticket_number", ""), "created_at": t.get("created_at", "")})
        elif status == "pending":
            columns["waiting"].append({"id": t["id"], "title": t.get("subject", t.get("title", "")), "client_name": t.get("client_name", ""), "priority": t.get("priority", "medium"), "assigned_to": t.get("assigned_to", ""), "ticket_number": t.get("ticket_number", ""), "created_at": t.get("created_at", "")})
        else:
            columns["open"].append({"id": t["id"], "title": t.get("subject", t.get("title", "")), "client_name": t.get("client_name", ""), "priority": t.get("priority", "medium"), "assigned_to": t.get("assigned_to", ""), "ticket_number": t.get("ticket_number", ""), "created_at": t.get("created_at", "")})
    return {"columns": [{"id": k, "title": k.replace("_", " ").title(), "tickets": v} for k, v in columns.items()], "total_tickets": len(tickets)}

@router.put("/kanban-tickets/move")
async def move_ticket(data: dict, current_user: dict = Depends(get_current_user)):
    ticket_id = data.get("ticket_id")
    new_status = data.get("new_status")
    await db.tickets.update_one({"id": ticket_id}, {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "moved", "ticket_id": ticket_id, "new_status": new_status}
