from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user

router = APIRouter()

BOARD_COLUMNS = ("open", "in_progress", "waiting", "resolved", "closed")
WAITING_STATUSES = {"waiting", "pending", "on_hold", "waiting_on_client"}


def _board_status(ticket_status: str) -> str:
    normalized = (ticket_status or "open").lower().replace(" ", "_")
    if normalized in WAITING_STATUSES:
        return "waiting"
    return normalized if normalized in BOARD_COLUMNS else "open"


def _board_ticket(ticket: dict, column_status: str) -> dict:
    return {
        "id": ticket["id"],
        "title": ticket.get("subject", ticket.get("title", "")),
        "client_name": ticket.get("client_name", ""),
        "priority": ticket.get("priority", "medium"),
        "assigned_to": ticket.get("assigned_to", ""),
        "assigned_to_name": ticket.get("assigned_to_name", ticket.get("assigned_name", "")),
        "ticket_number": ticket.get("ticket_number", ""),
        "created_at": ticket.get("created_at", ""),
        "sla_due": ticket.get("sla_due", ticket.get("sla_due_at")),
        "due_date": ticket.get("due_date"),
        "tags": ticket.get("tags", []),
        # The UI needs the board column, not only the persisted status, for optimistic moves.
        "status": column_status,
    }

@router.get("/kanban-tickets/board")
async def get_kanban_board(current_user: dict = Depends(get_current_user)):
    tickets = await db.tickets.find({}, {"_id": 0}).to_list(500)
    columns = {column: [] for column in BOARD_COLUMNS}
    for t in tickets:
        status = _board_status(t.get("status", "open"))
        columns[status].append(_board_ticket(t, status))
    return {"columns": [{"id": k, "title": k.replace("_", " ").title(), "tickets": v} for k, v in columns.items()], "total_tickets": len(tickets)}

@router.put("/kanban-tickets/move")
async def move_ticket(data: dict, current_user: dict = Depends(get_current_user)):
    ticket_id = data.get("ticket_id")
    new_status = data.get("new_status")
    if not ticket_id:
        raise HTTPException(status_code=400, detail="ticket_id is required")
    if new_status not in BOARD_COLUMNS:
        raise HTTPException(status_code=400, detail="Invalid ticket status")
    persisted_status = "on_hold" if new_status == "waiting" else new_status
    result = await db.tickets.update_one({"id": ticket_id}, {"$set": {"status": persisted_status, "updated_at": datetime.now(timezone.utc).isoformat()}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return {"status": "moved", "ticket_id": ticket_id, "new_status": new_status}
