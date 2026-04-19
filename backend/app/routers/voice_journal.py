"""
Voice Journal — one-tap audio → transcript → auto ticket note + time entry.
Uses OpenAI Whisper via Emergent LLM key (emergentintegrations).
"""
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from datetime import datetime, timezone
import os
import io
import uuid

from app.database import db
from app.auth import get_current_user

router = APIRouter()

MAX_BYTES = 25 * 1024 * 1024  # Whisper hard limit


async def _whisper_transcribe(raw_bytes: bytes, filename: str) -> str:
    """Call Whisper via Emergent LLM key. Returns transcript string or raises."""
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(503, "Voice transcription not configured (EMERGENT_LLM_KEY missing)")
    try:
        from emergentintegrations.llm.openai import OpenAISpeechToText
        stt = OpenAISpeechToText(api_key=api_key)
        # BytesIO needs a .name for OpenAI SDK format detection.
        bio = io.BytesIO(raw_bytes)
        bio.name = filename or "audio.webm"
        resp = await stt.transcribe(file=bio, model="whisper-1", response_format="json")
        text = getattr(resp, "text", None) or str(resp)
        return (text or "").strip()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Whisper error: {str(e)[:200]}")


@router.post("/voice-journal/transcribe")
async def voice_journal_transcribe(
    audio: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Accept an audio blob, return transcript + duration hint. Stateless (no persistence)."""
    raw = await audio.read()
    if not raw:
        raise HTTPException(400, "Empty audio upload")
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, f"Audio file too large (max 25MB, got {len(raw) // 1024}KB)")

    transcript = await _whisper_transcribe(raw, audio.filename or "audio.webm")

    return {
        "transcript": transcript,
        "bytes": len(raw),
        "content_type": audio.content_type or "audio/webm",
    }


@router.post("/voice-journal/log-entry")
async def voice_journal_log_entry(
    ticket_id: str = Form(...),
    duration_minutes: float = Form(...),
    billable: bool = Form(True),
    category: str = Form("Support"),
    audio: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """
    One-shot flow: upload audio → transcribe → create ticket comment + time entry.
    Perfect for field techs who finish work and speak into the phone.
    """
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")

    raw = await audio.read()
    if not raw:
        raise HTTPException(400, "Empty audio upload")
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "Audio too large (max 25MB)")

    transcript = await _whisper_transcribe(raw, audio.filename or "audio.webm")
    if not transcript:
        raise HTTPException(422, "Transcript was empty; try again with a clearer recording")

    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Add ticket comment
    comment = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "user_id": current_user.get("id", ""),
        "user_name": current_user.get("name", ""),
        "content": f"[Voice Journal · {duration_minutes:g}m]\n{transcript}",
        "is_internal": True,
        "source": "voice_journal",
        "created_at": now_iso,
    }
    await db.ticket_comments.insert_one(comment)

    # 2. Add time entry
    rate = 150.0  # sensible default; could be sourced from client billing config
    time_entry = {
        "id": f"te-{uuid.uuid4().hex[:8]}",
        "ticket_id": ticket_id,
        "client_id": ticket.get("client_id"),
        "client_name": ticket.get("client_name"),
        "user_id": current_user.get("id", ""),
        "user_name": current_user.get("name", ""),
        "description": transcript[:200],
        "duration_minutes": float(duration_minutes),
        "hours": round(float(duration_minutes) / 60.0, 3),
        "billable": bool(billable),
        "category": category,
        "rate": rate,
        "amount": round((float(duration_minutes) / 60.0) * rate, 2) if billable else 0.0,
        "source": "voice_journal",
        "created_at": now_iso,
    }
    await db.time_entries.insert_one(time_entry)

    return {
        "status": "logged",
        "ticket_id": ticket_id,
        "comment_id": comment["id"],
        "time_entry_id": time_entry["id"],
        "transcript": transcript,
        "duration_minutes": float(duration_minutes),
        "billable": bool(billable),
    }


@router.get("/voice-journal/history")
async def voice_journal_history(limit: int = 20, current_user: dict = Depends(get_current_user)):
    """Recent voice-journal entries by the current tech."""
    entries = await db.time_entries.find(
        {"source": "voice_journal", "user_id": current_user.get("id", "")},
        {"_id": 0},
    ).sort("created_at", -1).to_list(max(1, min(50, limit)))
    return entries
