from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from datetime import datetime, timezone
import uuid
import os
import json
import tempfile
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


@router.post("/voice-ticket/transcribe")
async def transcribe_voice(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """Transcribe audio and extract ticket structure using AI."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")

    # Save temp file
    suffix = os.path.splitext(file.filename)[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Transcribe using Whisper via emergent integrations
        from emergentintegrations.llm.chat import LlmChat
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="AI key not configured")

        # Use OpenAI Whisper for transcription
        import openai
        client = openai.OpenAI(api_key=api_key, base_url="https://api.emergentmethods.ai/v1")
        with open(tmp_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
            )
        transcript = transcription.text
    except Exception as e:
        # Fallback: return error with guidance
        os.unlink(tmp_path)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    # Now use AI to structure the transcript into a ticket
    system = """You are a ticket creation assistant. Given a voice transcription from a technician, extract structured ticket data.
Return ONLY valid JSON:
{
  "title": "Brief ticket title",
  "description": "Detailed description from the transcript",
  "priority": "critical|high|medium|low",
  "category": "network|hardware|software|security|email|backup|wisp|cabling|general",
  "ticket_type": "sla|workshop|cabling_wisp",
  "tags": ["tag1", "tag2"],
  "key_phrases": ["important phrase 1", "important phrase 2"]
}"""

    try:
        from emergentintegrations.llm.chat import UserMessage
        chat = await _get_ai_chat(f"voice-{uuid.uuid4().hex[:8]}", system)
        resp = await chat.send_message(UserMessage(text=f"Transcription:\n{transcript}"))
        text = resp.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        structured = json.loads(text)
    except Exception:
        structured = {
            "title": transcript[:80] if transcript else "Voice Ticket",
            "description": transcript or "",
            "priority": "medium",
            "category": "general",
            "ticket_type": "sla",
            "tags": [],
            "key_phrases": [],
        }

    return {
        "transcript": transcript,
        "structured": structured,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", ""),
    }


@router.post("/voice-ticket/create-from-transcript")
async def create_ticket_from_transcript(data: dict, current_user: dict = Depends(get_current_user)):
    """Create a ticket from a processed voice transcription."""
    structured = data.get("structured", {})
    client_id = data.get("client_id", "")
    transcript = data.get("transcript", "")

    ticket_id = str(uuid.uuid4())[:8]
    count = await db.tickets.count_documents({})
    ticket_number = f"TKT-{str(count + 1).zfill(3)}"

    ticket = {
        "id": ticket_id,
        "ticket_number": ticket_number,
        "title": structured.get("title", "Voice Ticket"),
        "description": structured.get("description", transcript),
        "priority": structured.get("priority", "medium"),
        "status": "open",
        "client_id": client_id,
        "category": structured.get("category", "general"),
        "ticket_type": structured.get("ticket_type", "sla"),
        "tags": structured.get("tags", []),
        "source": "voice",
        "voice_transcript": transcript,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("id", ""),
        "created_by_name": current_user.get("name", ""),
    }
    await db.tickets.insert_one(ticket)
    # Return without _id (MongoDB adds it in-place)
    ticket.pop("_id", None)
    return ticket
