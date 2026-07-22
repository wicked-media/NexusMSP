from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
import asyncio
import uuid, os, re
from app.database import db
from app.auth import get_current_user

router = APIRouter()

async def _get_ai_chat(session_id: str, system_msg: str):
    from app.services.ai_provider import LlmChat
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None
    # LlmChat resolves the active Settings > AI configuration at send time.
    # Do not hard-code a model here or let a workspace choose a different vendor.
    return LlmChat(api_key=api_key, session_id=session_id, system_message=system_msg)


def _safe_workspace(value: object) -> str:
    workspace = str(value or "").strip()
    return workspace[:160] if workspace.startswith("/") else ""


async def _operational_briefing() -> dict:
    """Collect the small, observable context that makes the global copilot useful.

    These values are deliberately read-only. The chat can reason over current
    work but never changes tickets, assets, billing or change records itself.
    """
    open_statuses = {"open", "in_progress"}
    (
        open_tickets,
        critical_tickets,
        unassigned_tickets,
        total_clients,
        total_devices,
        online_devices,
        offline_devices,
        overdue_invoices,
        pending_changes,
    ) = await asyncio.gather(
        db.tickets.count_documents({"status": {"$in": list(open_statuses)}}),
        db.tickets.count_documents({"status": {"$in": list(open_statuses)}, "priority": "critical"}),
        db.tickets.count_documents({"status": {"$in": list(open_statuses)}, "$or": [{"assigned_to": None}, {"assigned_to": ""}, {"assigned_to": {"$exists": False}}]}),
        db.clients.count_documents({}),
        db.devices.count_documents({}),
        db.devices.count_documents({"status": "online"}),
        db.devices.count_documents({"status": "offline"}),
        db.invoices.count_documents({"status": "overdue"}),
        db.change_requests.count_documents({"status": "pending_review"}),
    )
    return {
        "metrics": {
            "open_tickets": open_tickets,
            "critical_tickets": critical_tickets,
            "unassigned_tickets": unassigned_tickets,
            "total_clients": total_clients,
            "total_devices": total_devices,
            "online_devices": online_devices,
            "offline_devices": offline_devices,
            "overdue_invoices": overdue_invoices,
            "pending_changes": pending_changes,
        },
        "sources": ["tickets", "managed assets", "invoices", "change management"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


async def _ai_status() -> dict:
    from app.services.ai_provider import DEFAULT_MODEL, normalise_model

    config = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    reasoning = (config or {}).get("reasoning_effort")
    return {
        "configured": bool(os.environ.get("OPENAI_API_KEY")),
        "provider": "openai",
        "model": normalise_model((config or {}).get("model") or DEFAULT_MODEL),
        "reasoning_effort": reasoning if reasoning in {"none", "low", "medium", "high", "xhigh", "max"} else "medium",
    }


@router.get("/copilot/briefing")
async def copilot_briefing(current_user: dict = Depends(get_current_user)):
    """A live, explicit operational snapshot for the global Nexus AI panel."""
    briefing, ai = await asyncio.gather(_operational_briefing(), _ai_status())
    return {**briefing, "ai": ai}


@router.post("/copilot/chat")
async def copilot_chat(data: dict, current_user: dict = Depends(get_current_user)):
    """AI Copilot chat - queries platform data and responds contextually."""
    message = str(data.get("message") or "").strip()
    session_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(data.get("session_id") or ""))[:80] or str(uuid.uuid4())[:8]
    workspace = _safe_workspace(data.get("workspace"))
    if not message:
        raise HTTPException(status_code=400, detail="Ask Nexus AI a question before sending")
    if len(message) > 4000:
        raise HTTPException(status_code=400, detail="Keep a Nexus AI request under 4,000 characters")

    # Gather platform context
    briefing, ai = await asyncio.gather(_operational_briefing(), _ai_status())
    metrics = briefing["metrics"]

    # Recent tickets
    recent = await db.tickets.find({}, {"_id": 0, "id": 1, "title": 1, "status": 1, "priority": 1, "client_name": 1, "assigned_to_name": 1}).sort("created_at", -1).to_list(10)
    recent_str = "\n".join([f"- [{t.get('priority','med')}] {t.get('title','')} ({t.get('status','')}) - Client: {t.get('client_name','')} Assigned: {t.get('assigned_to_name','Unassigned')}" for t in recent])

    # Client list
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(50)
    clients_str = "\n".join([f"- {c.get('name','')} (ID: {c.get('id','')})" for c in clients[:20]])

    # Overdue invoices
    system = f"""You are NexusOps AI Copilot, an intelligent assistant for MSP technicians and managers.
You have access to the limited, live platform data below. Answer questions helpfully and concisely.
You are operating in the {workspace or "/"} workspace.

LIVE DATA SNAPSHOT:
- Open Tickets: {metrics['open_tickets']} ({metrics['critical_tickets']} critical, {metrics['unassigned_tickets']} unassigned)
- Total Clients: {metrics['total_clients']}
- Devices: {metrics['total_devices']} total, {metrics['online_devices']} online, {metrics['offline_devices']} offline
- Overdue Invoices: {metrics['overdue_invoices']}
- Change requests awaiting review: {metrics['pending_changes']}

Recent Tickets:
{recent_str}

Clients:
{clients_str}

You can help with:
- Ticket status queries, client information, device health
- Drafting client responses, emails, ticket notes
- Summarizing client histories, suggesting actions
- General MSP advice and troubleshooting guidance

Always be concise and actionable. Use the data provided above. State uncertainty when the snapshot does not contain enough evidence. Never claim to have sent an email, changed a record, approved a change, run a script, or taken a remote action: offer a draft or direct the technician to the explicit NexusMSP workflow instead."""

    try:
        from app.services.ai_provider import UserMessage
        chat = await _get_ai_chat(f"copilot-{session_id}", system)
        if not chat:
            raise HTTPException(status_code=503, detail="Nexus AI is not connected. Configure the server-side OpenAI key in Settings before starting a conversation.")
        resp = await chat.send_message(UserMessage(text=message))
        reply = resp.strip() if isinstance(resp, str) else str(resp)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Nexus AI could not complete that request. Check the AI connection and try again.")

    # Store conversation
    await db.copilot_history.insert_one({
        "session_id": session_id,
        "user_id": current_user.get("id", ""),
        "message": message,
        "reply": reply,
        "workspace": workspace,
        "model": ai["model"],
        "reasoning_effort": ai["reasoning_effort"],
        "sources": briefing["sources"],
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
    metrics = (await _operational_briefing())["metrics"]
    suggestions = [
        {"id": "queue", "text": f"Triage the {metrics['open_tickets']} active tickets and identify the next best action for each.", "description": "Queue prioritisation and ownership"},
        {"id": "handover", "text": "Create a concise technician handover from today's operational work.", "description": "Shift handover draft"},
        {"id": "client-risk", "text": "Which clients need attention based on the current operational snapshot?", "description": "Customer risk review"},
        {"id": "maintenance", "text": "Draft a professional maintenance notification with scope, timing and client action required.", "description": "Client-ready communication"},
    ]
    if metrics["critical_tickets"] > 0:
        suggestions.insert(0, {"id": "critical", "text": f"Review the {metrics['critical_tickets']} critical ticket(s) and recommend an escalation order.", "description": "Critical incident triage"})
    if metrics["pending_changes"] > 0:
        suggestions.append({"id": "change-review", "text": f"Summarise the {metrics['pending_changes']} change request(s) awaiting review and their operational risk.", "description": "Change advisory review"})
    return suggestions
