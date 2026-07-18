from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid, os, json
from app.database import db
from app.auth import get_current_user

router = APIRouter()

async def _get_ai_chat(session_id: str, system_msg: str):
    from app.services.ai_provider import LlmChat
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system_msg)
    chat.with_model("openai", os.environ.get("NEXUS_AI_MODEL", "gpt-4o-mini"))
    return chat


@router.post("/copilot/chat")
async def copilot_chat(data: dict, current_user: dict = Depends(get_current_user)):
    """AI Copilot chat - queries platform data and responds contextually."""
    message = data.get("message", "")
    session_id = data.get("session_id", str(uuid.uuid4())[:8])
    if not message:
        return {"reply": "Please ask me something about your MSP data."}

    # Gather platform context
    open_tickets = await db.tickets.count_documents({"status": {"$in": ["open", "in_progress"]}})
    critical_tickets = await db.tickets.count_documents({"status": {"$in": ["open", "in_progress"]}, "priority": "critical"})
    total_clients = await db.clients.count_documents({})
    total_devices = await db.devices.count_documents({})
    online_devices = await db.devices.count_documents({"status": "online"})

    # Recent tickets
    recent = await db.tickets.find({}, {"_id": 0, "id": 1, "title": 1, "status": 1, "priority": 1, "client_name": 1, "assigned_to_name": 1}).sort("created_at", -1).to_list(10)
    recent_str = "\n".join([f"- [{t.get('priority','med')}] {t.get('title','')} ({t.get('status','')}) - Client: {t.get('client_name','')} Assigned: {t.get('assigned_to_name','Unassigned')}" for t in recent])

    # Client list
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(50)
    clients_str = "\n".join([f"- {c.get('name','')} (ID: {c.get('id','')})" for c in clients[:20]])

    # Overdue invoices
    overdue = await db.invoices.count_documents({"status": "overdue"})

    system = f"""You are NexusOps AI Copilot, an intelligent assistant for MSP technicians and managers.
You have access to live platform data. Answer questions helpfully and concisely.

LIVE DATA SNAPSHOT:
- Open Tickets: {open_tickets} ({critical_tickets} critical)
- Total Clients: {total_clients}
- Devices: {total_devices} total, {online_devices} online
- Overdue Invoices: {overdue}

Recent Tickets:
{recent_str}

Clients:
{clients_str}

You can help with:
- Ticket status queries, client information, device health
- Drafting client responses, emails, ticket notes
- Summarizing client histories, suggesting actions
- General MSP advice and troubleshooting guidance

Always be concise and actionable. Use the data provided above."""

    try:
        from app.services.ai_provider import UserMessage
        chat = await _get_ai_chat(f"copilot-{session_id}", system)
        if not chat:
            return {"reply": "AI not configured. Please set OPENAI_API_KEY.", "session_id": session_id}
        resp = await chat.send_message(UserMessage(text=message))
        reply = resp.strip() if isinstance(resp, str) else str(resp)
    except Exception as e:
        reply = f"I encountered an error: {str(e)[:100]}. Please try again."

    # Store conversation
    await db.copilot_history.insert_one({
        "session_id": session_id,
        "user_id": current_user.get("id", ""),
        "message": message,
        "reply": reply,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    return {"reply": reply, "session_id": session_id}


@router.get("/copilot/history")
async def get_copilot_history(current_user: dict = Depends(get_current_user)):
    """Get recent copilot chat history."""
    history = await db.copilot_history.find(
        {"user_id": current_user.get("id", "")}, {"_id": 0}
    ).sort("timestamp", -1).to_list(50)
    return history


@router.get("/copilot/suggestions")
async def get_quick_suggestions(current_user: dict = Depends(get_current_user)):
    """Get contextual quick action suggestions."""
    open_count = await db.tickets.count_documents({"status": "open"})
    critical = await db.tickets.count_documents({"priority": "critical", "status": {"$in": ["open", "in_progress"]}})
    suggestions = [
        {"text": f"What are the {open_count} open tickets?", "icon": "ticket"},
        {"text": "Summarize today's activity", "icon": "activity"},
        {"text": "Which clients need attention?", "icon": "users"},
        {"text": "Draft a maintenance notification email", "icon": "mail"},
    ]
    if critical > 0:
        suggestions.insert(0, {"text": f"Tell me about the {critical} critical tickets", "icon": "alert"})
    return suggestions
