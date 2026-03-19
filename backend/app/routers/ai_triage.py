from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
import os
import json
from app.database import db
from app.auth import get_current_user

router = APIRouter()

async def _get_ai_chat(session_id: str, system_msg: str):
    from emergentintegrations.llm.chat import LlmChat
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI key not configured")
    cfg = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    provider = (cfg or {}).get("provider", "anthropic")
    model = (cfg or {}).get("model", "claude-sonnet-4-5-20250929")
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system_msg)
    chat.with_model(provider, model)
    return chat


@router.post("/ai/triage")
async def triage_ticket(data: dict, current_user: dict = Depends(get_current_user)):
    """AI analyses a ticket and suggests category, priority, technician, and resolution plan."""
    title = data.get("title", "")
    description = data.get("description", "")
    client_name = data.get("client_name", "")
    if not title and not description:
        raise HTTPException(status_code=400, detail="Title or description required")

    # Get technicians for routing
    techs = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(100)
    # Get open ticket counts per tech for workload
    pipeline = [{"$match": {"status": {"$in": ["open", "in_progress"]}}}, {"$group": {"_id": "$assigned_to", "count": {"$sum": 1}}}]
    workloads = {r["_id"]: r["count"] async for r in db.tickets.aggregate(pipeline)}
    tech_info = []
    for t in techs:
        load = workloads.get(t["id"], 0)
        tech_info.append(f"- {t['name']} (ID: {t['id']}, open tickets: {load})")

    system = """You are an AI triage engine for an MSP helpdesk. Analyze the ticket and return ONLY valid JSON:
{
  "suggested_priority": "critical|high|medium|low",
  "suggested_category": "network|hardware|software|security|email|backup|wisp|cabling|general",
  "suggested_ticket_type": "sla|workshop|cabling_wisp",
  "suggested_technician_id": "tech_id_here",
  "suggested_technician_name": "Name",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation",
  "resolution_plan": ["Step 1", "Step 2", "Step 3"],
  "estimated_time_minutes": 30,
  "tags": ["tag1", "tag2"]
}"""

    prompt = f"""Ticket Title: {title}
Description: {description}
Client: {client_name}

Available Technicians (prefer lower workload):
{chr(10).join(tech_info)}

Analyze and triage this ticket."""

    try:
        from emergentintegrations.llm.chat import UserMessage
        chat = await _get_ai_chat(f"triage-{uuid.uuid4().hex[:8]}", system)
        resp = await chat.send_message(UserMessage(text=prompt))
        text = resp.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
        # Store triage result
        result["ticket_title"] = title
        result["triaged_at"] = datetime.now(timezone.utc).isoformat()
        result["triaged_by"] = current_user.get("name", "")
        return result
    except json.JSONDecodeError:
        return {
            "suggested_priority": "medium", "suggested_category": "general",
            "suggested_ticket_type": "sla", "suggested_technician_id": techs[0]["id"] if techs else None,
            "suggested_technician_name": techs[0]["name"] if techs else "Unassigned",
            "confidence": 0.3, "reasoning": "AI could not parse response, using defaults",
            "resolution_plan": ["Investigate issue", "Diagnose root cause", "Apply fix"],
            "estimated_time_minutes": 60, "tags": []
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ai/auto-route")
async def auto_route_ticket(data: dict, current_user: dict = Depends(get_current_user)):
    """Auto-routes a ticket based on triage result."""
    ticket_id = data.get("ticket_id")
    triage = data.get("triage", {})
    if not ticket_id:
        raise HTTPException(status_code=400, detail="ticket_id required")

    update = {}
    if triage.get("suggested_priority"):
        update["priority"] = triage["suggested_priority"]
    if triage.get("suggested_technician_id"):
        update["assigned_to"] = triage["suggested_technician_id"]
        update["assigned_to_name"] = triage.get("suggested_technician_name", "")
    if triage.get("suggested_category"):
        update["category"] = triage["suggested_category"]
    if triage.get("tags"):
        update["tags"] = triage["tags"]
    if triage.get("resolution_plan"):
        update["ai_resolution_plan"] = triage["resolution_plan"]
    update["ai_triaged"] = True
    update["ai_triage_confidence"] = triage.get("confidence", 0)
    update["updated_at"] = datetime.now(timezone.utc).isoformat()

    await db.tickets.update_one({"id": ticket_id}, {"$set": update})
    return {"message": "Ticket auto-routed", "updates": update}
