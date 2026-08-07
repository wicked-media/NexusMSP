from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import httpx
import os
import uuid
from dotenv import load_dotenv
from app.database import db
from app.auth import get_current_user
from app.services.ai_provider import DEFAULT_MODEL, normalise_model
from app.services.secret_store import decrypt_secret, encrypt_secret, mask_secret

load_dotenv()

router = APIRouter()

# AI Model config
DEFAULT_PROVIDER = "openai"
_ORIGINAL_ENV_KEY = os.environ.get("OPENAI_API_KEY", "")
_ALLOWED_ADMIN_ROLES = {"admin", "owner", "super_admin"}


def _require_admin(current_user: dict):
    if not current_user or (
        str(current_user.get("role") or "").lower() not in _ALLOWED_ADMIN_ROLES
        and not current_user.get("is_admin")
    ):
        raise HTTPException(status_code=403, detail="Administrator access is required to manage AI credentials")


def _validate_openai_key(value: str) -> str:
    key = str(value or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="Enter an OpenAI API key")
    if not key.startswith("sk-") or len(key) < 20 or len(key) > 512:
        raise HTTPException(status_code=400, detail="Enter a valid OpenAI project API key beginning with sk-")
    return key


def _connection_from_config(config: dict | None) -> dict:
    config = config or {}
    encrypted = str(config.get("openai_api_key_encrypted") or "")
    stored_key = decrypt_secret(encrypted)
    environment_key = os.environ.get("OPENAI_API_KEY", "")
    configured = bool(stored_key or environment_key)
    method = "encrypted_settings" if stored_key else ("environment" if environment_key else "none")
    return {
        "configured": configured,
        "method": method,
        "key_source": "Nexus encrypted settings" if stored_key else ("OPENAI_API_KEY" if environment_key else ""),
        "key_preview": mask_secret(stored_key or environment_key),
        "key_label": config.get("openai_key_label") or "",
        "organization_id": config.get("openai_organization_id") or "",
        "project_id": config.get("openai_project_id") or "",
        "last_test_status": config.get("openai_last_test_status") or "",
        "last_tested_at": config.get("openai_last_tested_at") or "",
        "last_test_message": config.get("openai_last_test_message") or "",
        "updated_at": config.get("openai_connection_updated_at") or "",
        "updated_by_name": config.get("openai_connection_updated_by_name") or "",
    }


async def _stored_openai_key(config: dict | None = None) -> str:
    if config is None:
        config = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    return decrypt_secret((config or {}).get("openai_api_key_encrypted") or "")


async def hydrate_openai_connection() -> bool:
    """Make an encrypted key available to existing AI workflows after restart."""
    config = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    stored_key = await _stored_openai_key(config)
    if stored_key:
        os.environ["OPENAI_API_KEY"] = stored_key
        return True
    return bool(os.environ.get("OPENAI_API_KEY"))


async def _test_openai_connection(
    api_key: str,
    organization_id: str = "",
    project_id: str = "",
) -> dict:
    headers = {"Authorization": f"Bearer {api_key}"}
    if organization_id:
        headers["OpenAI-Organization"] = organization_id
    if project_id:
        headers["OpenAI-Project"] = project_id
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get("https://api.openai.com/v1/models", headers=headers)
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="OpenAI did not respond before the connection test timed out") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="NexusMSP could not reach the OpenAI API") from exc

    if response.status_code == 401:
        raise HTTPException(status_code=400, detail="OpenAI rejected this API key")
    if response.status_code == 403:
        raise HTTPException(status_code=400, detail="OpenAI accepted the key but denied access to this organisation or project")
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"OpenAI returned HTTP {response.status_code} during validation")

    payload = response.json()
    model_ids = sorted(
        {
            str(item.get("id"))
            for item in payload.get("data", [])
            if isinstance(item, dict) and str(item.get("id") or "").startswith(("gpt-", "o"))
        }
    )
    return {
        "status": "connected",
        "message": "OpenAI authentication succeeded",
        "model_count": len(model_ids),
        "models": model_ids[:100],
    }


def _normalise_config(config: dict | None) -> dict:
    """Migrate legacy provider values in-memory without retaining external dependencies."""
    configured_model = normalise_model((config or {}).get("model"))
    return {
        "type": "ai_config",
        "provider": DEFAULT_PROVIDER,
        "model": configured_model,
        "reasoning_effort": (config or {}).get("reasoning_effort") if (config or {}).get("reasoning_effort") in {"none", "low", "medium", "high", "xhigh", "max"} else "medium",
        "connection": _connection_from_config(config),
    }

async def get_ai_config():
    doc = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    return _normalise_config(doc)

async def get_chat(session_id: str, system_message: str):
    from app.services.ai_provider import LlmChat
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI key not configured")
    config = await get_ai_config()
    provider = config.get("provider", DEFAULT_PROVIDER)
    model = config.get("model", DEFAULT_MODEL)
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system_message)
    chat.with_model(provider, model).with_reasoning_effort(config.get("reasoning_effort"))
    return chat

# ============== AI CONFIG ==============

@router.get("/ai/config")
async def get_ai_settings(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    return _normalise_config(doc)

@router.put("/ai/config")
async def update_ai_settings(data: dict, current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    provider = "openai"
    requested_model = data.get("model", DEFAULT_MODEL)
    model = normalise_model(requested_model)
    requested_reasoning = data.get("reasoning_effort", "medium")
    reasoning_effort = requested_reasoning if requested_reasoning in {"none", "low", "medium", "high", "xhigh", "max"} else "medium"
    await db.settings.update_one({"type": "ai_config"}, {"$set": {
        "type": "ai_config", "provider": provider, "model": model, "reasoning_effort": reasoning_effort,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    saved = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    return {
        "message": "AI config saved",
        "provider": provider,
        "model": model,
        "reasoning_effort": reasoning_effort,
        "connection": _connection_from_config(saved),
    }


@router.put("/ai/connection")
async def save_ai_connection(data: dict, current_user: dict = Depends(get_current_user)):
    """Validate and store an OpenAI project key without returning it to the UI."""
    _require_admin(current_user)
    api_key = _validate_openai_key(data.get("api_key"))
    organization_id = str(data.get("organization_id") or "").strip()
    project_id = str(data.get("project_id") or "").strip()
    tested = await _test_openai_connection(api_key, organization_id, project_id)
    now = datetime.now(timezone.utc).isoformat()
    update = {
        "type": "ai_config",
        "provider": DEFAULT_PROVIDER,
        "openai_api_key_encrypted": encrypt_secret(api_key),
        "openai_key_label": str(data.get("key_label") or "NexusMSP production").strip()[:120],
        "openai_organization_id": organization_id[:160],
        "openai_project_id": project_id[:160],
        "openai_last_test_status": "connected",
        "openai_last_tested_at": now,
        "openai_last_test_message": tested["message"],
        "openai_connection_updated_at": now,
        "openai_connection_updated_by": current_user.get("id") or "",
        "openai_connection_updated_by_name": current_user.get("name") or current_user.get("email") or "",
    }
    await db.settings.update_one({"type": "ai_config"}, {"$set": update}, upsert=True)
    os.environ["OPENAI_API_KEY"] = api_key
    saved = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    try:
        from app.services.activity import log_activity

        await log_activity(
            current_user,
            "updated",
            "integration",
            "openai",
            "OpenAI API",
            "Saved and validated the NexusMSP OpenAI API connection",
            metadata={"source": "encrypted_settings", "project_id": project_id},
        )
    except Exception:
        pass
    return {"message": "OpenAI connection saved", "connection": _connection_from_config(saved), **tested}


@router.post("/ai/connection/test")
async def test_ai_connection(data: dict | None = None, current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    data = data or {}
    config = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    candidate = str(data.get("api_key") or "").strip()
    api_key = _validate_openai_key(candidate) if candidate else (await _stored_openai_key(config) or os.environ.get("OPENAI_API_KEY", ""))
    if not api_key:
        raise HTTPException(status_code=400, detail="Connect an OpenAI API key before testing")
    organization_id = str(data.get("organization_id") or (config or {}).get("openai_organization_id") or "").strip()
    project_id = str(data.get("project_id") or (config or {}).get("openai_project_id") or "").strip()
    tested = await _test_openai_connection(api_key, organization_id, project_id)
    if not candidate:
        now = datetime.now(timezone.utc).isoformat()
        await db.settings.update_one(
            {"type": "ai_config"},
            {"$set": {
                "openai_last_test_status": "connected",
                "openai_last_tested_at": now,
                "openai_last_test_message": tested["message"],
            }},
            upsert=True,
        )
        config = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    return {**tested, "connection": _connection_from_config(config)}


@router.delete("/ai/connection")
async def delete_ai_connection(current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    config = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    stored_key = await _stored_openai_key(config)
    await db.settings.update_one(
        {"type": "ai_config"},
        {"$unset": {
            "openai_api_key_encrypted": "",
            "openai_key_label": "",
            "openai_organization_id": "",
            "openai_project_id": "",
            "openai_last_test_status": "",
            "openai_last_tested_at": "",
            "openai_last_test_message": "",
            "openai_connection_updated_at": "",
            "openai_connection_updated_by": "",
            "openai_connection_updated_by_name": "",
        }},
        upsert=True,
    )
    if stored_key and os.environ.get("OPENAI_API_KEY") == stored_key:
        if _ORIGINAL_ENV_KEY:
            os.environ["OPENAI_API_KEY"] = _ORIGINAL_ENV_KEY
        else:
            os.environ.pop("OPENAI_API_KEY", None)
    saved = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    return {"message": "Stored OpenAI connection removed", "connection": _connection_from_config(saved)}

# ============== TECHNICIAN CO-PILOT ==============

@router.post("/ai/copilot")
async def copilot_chat(data: dict, current_user: dict = Depends(get_current_user)):
    """AI Co-Pilot chat for technicians - context-aware assistant"""
    message = data.get("message", "")
    session_id = data.get("session_id", f"copilot-{uuid.uuid4().hex[:8]}")
    ticket_context = data.get("ticket_context", {})
    
    if not message:
        return {"response": "Please ask me something!", "session_id": session_id}
    
    # Build context from ticket
    context_parts = ["You are the Technician Co-Pilot for NexusOps, an RMM/PSA platform. You help IT technicians diagnose and resolve issues. Be concise, technical, and actionable. Use bullet points for steps."]
    
    if ticket_context:
        context_parts.append(f"\nCurrent Ticket: {ticket_context.get('title', 'N/A')}")
        if ticket_context.get("description"):
            context_parts.append(f"Description: {ticket_context['description']}")
        if ticket_context.get("client_name"):
            context_parts.append(f"Client: {ticket_context['client_name']}")
        if ticket_context.get("device_name"):
            context_parts.append(f"Device: {ticket_context['device_name']} (Status: {ticket_context.get('device_status', 'unknown')})")
        if ticket_context.get("category"):
            context_parts.append(f"Category: {ticket_context['category']}")
        if ticket_context.get("priority"):
            context_parts.append(f"Priority: {ticket_context['priority']}")
    
    # Get KB articles for context
    from app.routers.ticket_suggestions import extract_keywords, score_match
    keywords = extract_keywords(message)
    if keywords:
        kb_articles = await db.kb_articles.find({}, {"_id": 0, "title": 1, "content": 1}).to_list(20)
        relevant = []
        for art in kb_articles:
            score = score_match(keywords, f"{art.get('title','')} {art.get('content','')}")
            if score >= 2:
                relevant.append(f"KB: {art['title']}: {(art.get('content','') or '')[:200]}")
        if relevant:
            context_parts.append(f"\nRelevant Knowledge Base Articles:\n" + "\n".join(relevant[:3]))
    
    system_msg = "\n".join(context_parts)
    
    from app.services.ai_provider import LlmChat, UserMessage
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"response": "AI key not configured. Add the OpenAI API key in your environment.", "session_id": session_id}
    
    config = await get_ai_config()
    try:
        chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system_msg)
        chat.with_model(config.get("provider", DEFAULT_PROVIDER), config.get("model", DEFAULT_MODEL)).with_reasoning_effort(config.get("reasoning_effort"))
        response = await chat.send_message(UserMessage(text=message))
        return {"response": response, "session_id": session_id}
    except Exception as e:
        return {"response": f"Sorry, I encountered an error: {str(e)[:100]}", "session_id": session_id}

@router.post("/ai/proofread")
async def proofread_text(data: dict, current_user: dict = Depends(get_current_user)):
    text = data.get("text", "")
    if not text or len(text) < 3:
        return {"corrected": text, "changes": []}
    
    from app.services.ai_provider import UserMessage
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
    
    from app.services.ai_provider import UserMessage
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
    
    from app.services.ai_provider import UserMessage
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
