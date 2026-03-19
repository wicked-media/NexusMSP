from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid, os, json
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.post("/postmortem/generate/{ticket_id}")
async def generate_postmortem(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """AI-generate a post-mortem report from a resolved incident."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        return {"error": "Ticket not found"}

    notes = ticket.get("notes", [])
    notes_text = "\n".join([f"[{n.get('created_at','')}] {n.get('author','')}: {n.get('text','')}" for n in notes])

    system = """You are an incident post-mortem report writer for an MSP. Given incident details, produce a structured post-mortem.
Return ONLY valid JSON:
{"title":"Incident Post-Mortem: ...", "summary":"1-2 sentence summary", "timeline":["HH:MM - Event 1","HH:MM - Event 2"], "root_cause":"Root cause analysis", "impact":"Impact assessment", "resolution":"How it was resolved", "prevention":["Action 1","Action 2"], "severity":"critical|high|medium|low", "duration_estimate":"Xh Ym"}"""

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        chat = LlmChat(api_key=api_key, session_id=f"pm-{uuid.uuid4().hex[:6]}", system_message=system)
        chat.with_model("anthropic", "claude-sonnet-4-5-20250929")
        prompt = f"Incident: {ticket.get('title','')}\nPriority: {ticket.get('priority','')}\nClient: {ticket.get('client_name','')}\nCreated: {ticket.get('created_at','')}\nResolved: {ticket.get('resolved_at','')}\nDescription: {ticket.get('description','')}\nNotes:\n{notes_text}"
        resp = await chat.send_message(UserMessage(text=prompt))
        text = resp.strip() if isinstance(resp, str) else str(resp)
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
    except Exception:
        result = {"title": f"Post-Mortem: {ticket.get('title','')}", "summary": ticket.get("description",""), "timeline": [], "root_cause": "Requires manual analysis", "impact": "TBD", "resolution": "See ticket notes", "prevention": ["Review and document"], "severity": ticket.get("priority","medium"), "duration_estimate": "Unknown"}

    pm_id = str(uuid.uuid4())[:8]
    doc = {
        "id": pm_id, **result,
        "ticket_id": ticket_id, "ticket_title": ticket.get("title",""),
        "client_name": ticket.get("client_name",""),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": current_user.get("name",""),
    }
    await db.postmortems.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/postmortem")
async def get_postmortems(current_user: dict = Depends(get_current_user)):
    return await db.postmortems.find({}, {"_id": 0}).sort("generated_at", -1).to_list(100)


@router.get("/postmortem/{pm_id}")
async def get_postmortem(pm_id: str, current_user: dict = Depends(get_current_user)):
    pm = await db.postmortems.find_one({"id": pm_id}, {"_id": 0})
    return pm or {"error": "Not found"}


@router.delete("/postmortem/{pm_id}")
async def delete_postmortem(pm_id: str, current_user: dict = Depends(get_current_user)):
    await db.postmortems.delete_one({"id": pm_id})
    return {"message": "Deleted"}
