from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import os
import uuid
from dotenv import load_dotenv
from app.database import db
from app.auth import get_current_user

load_dotenv()

router = APIRouter()

# AI Model config
DEFAULT_PROVIDER = "anthropic"
DEFAULT_MODEL = "claude-sonnet-4-5-20250929"

async def get_ai_config():
    doc = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    return doc or {"provider": DEFAULT_PROVIDER, "model": DEFAULT_MODEL}

async def get_chat(session_id: str, system_message: str):
    from emergentintegrations.llm.chat import LlmChat
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI key not configured")
    config = await get_ai_config()
    provider = config.get("provider", DEFAULT_PROVIDER)
    model = config.get("model", DEFAULT_MODEL)
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system_message)
    chat.with_model(provider, model)
    return chat

# ============== AI CONFIG ==============

@router.get("/ai/config")
async def get_ai_settings(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    if not doc:
        return {"type": "ai_config", "provider": DEFAULT_PROVIDER, "model": DEFAULT_MODEL}
    return doc

@router.put("/ai/config")
async def update_ai_settings(data: dict, current_user: dict = Depends(get_current_user)):
    provider = data.get("provider", DEFAULT_PROVIDER)
    model = data.get("model", DEFAULT_MODEL)
    await db.settings.update_one({"type": "ai_config"}, {"$set": {
        "type": "ai_config", "provider": provider, "model": model,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    return {"message": "AI config saved", "provider": provider, "model": model}

# ============== SPELL CHECK / GRAMMAR ==============

@router.post("/ai/proofread")
async def proofread_text(data: dict, current_user: dict = Depends(get_current_user)):
    text = data.get("text", "")
    if not text or len(text) < 3:
        return {"corrected": text, "changes": []}
    
    from emergentintegrations.llm.chat import UserMessage
    session_id = f"proofread-{uuid.uuid4().hex[:8]}"
    system_msg = (
        "You are a professional proofreader for an IT support company. "
        "Fix spelling, grammar, punctuation, and improve clarity while keeping the technical meaning. "
        "Keep the tone professional but friendly. "
        "Return ONLY JSON: {\"corrected\": \"the corrected text\", \"changes\": [\"list of changes made\"]}. "
        "If no changes needed, return the original text with empty changes array."
    )
    try:
        chat = await get_chat(session_id, system_msg)
        response = await chat.send_message(UserMessage(text=f"Proofread this text:\n\n{text}"))
        import json
        # Try to parse JSON from response
        resp_text = response.strip()
        if resp_text.startswith("```"):
            resp_text = resp_text.split("```")[1]
            if resp_text.startswith("json"):
                resp_text = resp_text[4:]
        result = json.loads(resp_text)
        return {"corrected": result.get("corrected", text), "changes": result.get("changes", [])}
    except Exception as e:
        return {"corrected": text, "changes": [], "error": str(e)[:100]}

# ============== AUTO-CATEGORIZE ==============

@router.post("/ai/categorize-ticket")
async def categorize_ticket(data: dict, current_user: dict = Depends(get_current_user)):
    title = data.get("title", "")
    description = data.get("description", "")
    if not title:
        return {"ticket_type": "incident", "category": "support", "priority": "medium", "confidence": 0}
    
    # Get available categories
    categories = await db.ticket_categories.find({"is_active": True}, {"_id": 0, "name": 1}).to_list(50)
    cat_names = [c["name"] for c in categories] if categories else ["Hardware", "Software", "Network", "Security", "Email", "Access", "Other"]
    
    from emergentintegrations.llm.chat import UserMessage
    session_id = f"categorize-{uuid.uuid4().hex[:8]}"
    system_msg = (
        "You are an expert IT ticket classifier for an MSP. Analyze the ticket and classify it. "
        f"Available categories: {', '.join(cat_names)}. "
        "Ticket types: incident, service_request, problem, change_request, alert, task. "
        "Priority levels: critical, high, medium, low. "
        "Return ONLY JSON: {\"ticket_type\": \"...\", \"category\": \"...\", \"priority\": \"...\", \"confidence\": 0.0-1.0, \"reasoning\": \"brief reason\"}"
    )
    try:
        chat = await get_chat(session_id, system_msg)
        response = await chat.send_message(UserMessage(text=f"Title: {title}\nDescription: {description}"))
        import json
        resp_text = response.strip()
        if resp_text.startswith("```"):
            resp_text = resp_text.split("```")[1]
            if resp_text.startswith("json"):
                resp_text = resp_text[4:]
        result = json.loads(resp_text)
        return {
            "ticket_type": result.get("ticket_type", "incident"),
            "category": result.get("category", "support"),
            "priority": result.get("priority", "medium"),
            "confidence": result.get("confidence", 0.5),
            "reasoning": result.get("reasoning", ""),
        }
    except Exception as e:
        return {"ticket_type": "incident", "category": "support", "priority": "medium", "confidence": 0, "error": str(e)[:100]}

# ============== AI DEVICE ANALYSIS ==============

@router.post("/ai/analyze-device")
async def analyze_device(data: dict, current_user: dict = Depends(get_current_user)):
    device_id = data.get("device_id", "")
    ticket_title = data.get("ticket_title", "")
    ticket_description = data.get("ticket_description", "")
    
    # Get device info
    device = None
    if device_id:
        device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    
    # Get KB articles for context
    kb_articles = await db.kb_articles.find({}, {"_id": 0, "title": 1, "content": 1}).to_list(20)
    kb_context = "\n".join([f"- {a['title']}: {(a.get('content','') or '')[:200]}" for a in kb_articles[:10]])
    
    # Get similar resolved tickets
    from app.routers.ticket_suggestions import extract_keywords, score_match
    keywords = extract_keywords(f"{ticket_title} {ticket_description}")
    resolved = await db.tickets.find({"status": {"$in": ["resolved", "closed"]}}, {"_id": 0, "title": 1, "description": 1, "resolution_notes": 1}).to_list(200)
    similar = []
    for rt in resolved:
        score = score_match(keywords, f"{rt.get('title','')} {rt.get('description','')}")
        if score >= 2 and rt.get("resolution_notes"):
            similar.append(f"- {rt['title']}: {rt['resolution_notes'][:200]}")
    similar_context = "\n".join(similar[:5])
    
    device_info = ""
    if device:
        device_info = (
            f"Device: {device.get('name','Unknown')}\n"
            f"Type: {device.get('device_type','unknown')}\n"
            f"OS: {device.get('os_name','')} {device.get('os_version','')}\n"
            f"Status: {device.get('status','unknown')}\n"
            f"Last Seen: {device.get('last_seen','unknown')}\n"
            f"CPU: {device.get('cpu_model','')}\n"
            f"RAM: {device.get('ram_total_gb','')}GB\n"
            f"Disk: {device.get('disk_total_gb','')}GB (Free: {device.get('disk_free_gb','')}GB)\n"
            f"IP: {device.get('ip_address','')}\n"
            f"Antivirus: {device.get('antivirus_status','unknown')}\n"
        )
    
    from emergentintegrations.llm.chat import UserMessage
    session_id = f"analyze-{uuid.uuid4().hex[:8]}"
    system_msg = (
        "You are an expert IT technician and diagnostics specialist for an MSP. "
        "Analyze the reported issue and device information to provide a detailed diagnosis and actionable fix steps. "
        "Use the knowledge base articles and past resolutions if relevant. "
        "Return ONLY JSON with this format:\n"
        "{\n"
        "  \"diagnosis\": \"Clear explanation of the likely issue\",\n"
        "  \"severity\": \"critical/high/medium/low\",\n"
        "  \"steps\": [\"Step 1...\", \"Step 2...\"],\n"
        "  \"potential_causes\": [\"Cause 1\", \"Cause 2\"],\n"
        "  \"recommended_scripts\": [\"Script or command to run\"],\n"
        "  \"kb_references\": [\"Relevant KB article titles\"],\n"
        "  \"estimated_time_minutes\": 30\n"
        "}"
    )
    
    prompt = f"Issue: {ticket_title}\nDescription: {ticket_description}\n"
    if device_info:
        prompt += f"\nDevice Information:\n{device_info}\n"
    if similar_context:
        prompt += f"\nPast Similar Resolutions:\n{similar_context}\n"
    if kb_context:
        prompt += f"\nKnowledge Base:\n{kb_context}\n"
    
    try:
        chat = await get_chat(session_id, system_msg)
        response = await chat.send_message(UserMessage(text=prompt))
        import json
        resp_text = response.strip()
        if resp_text.startswith("```"):
            resp_text = resp_text.split("```")[1]
            if resp_text.startswith("json"):
                resp_text = resp_text[4:]
        result = json.loads(resp_text)
        return {
            "diagnosis": result.get("diagnosis", ""),
            "severity": result.get("severity", "medium"),
            "steps": result.get("steps", []),
            "potential_causes": result.get("potential_causes", []),
            "recommended_scripts": result.get("recommended_scripts", []),
            "kb_references": result.get("kb_references", []),
            "estimated_time_minutes": result.get("estimated_time_minutes", 30),
            "device_name": device.get("name", "") if device else "",
        }
    except Exception as e:
        return {"diagnosis": f"Analysis failed: {str(e)[:100]}", "severity": "medium", "steps": [], "potential_causes": [], "recommended_scripts": [], "kb_references": [], "estimated_time_minutes": 0}
