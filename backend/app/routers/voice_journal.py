"""
Voice Journal Ã¢â‚¬â€ one-tap audio Ã¢â€ â€™ transcript Ã¢â€ â€™ auto ticket note + time entry.
Uses OpenAI Whisper via OpenAI API key (OpenAI-compatible provider).
"""
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from datetime import datetime, timezone
import hashlib
import math
import os
import io
import uuid

from app.database import db
from app.auth import get_current_user
from app.services.scope_permissions import assert_record_scope, scoped_query
from app.services.ticket_time import create_canonical_ticket_time_entry

router = APIRouter()

MAX_BYTES = 25 * 1024 * 1024  # Whisper hard limit


def _voice_journal_idempotency_key(
    *,
    ticket_id: str,
    actor_id: str,
    duration_minutes: float,
    billable: bool,
    category: str,
    audio_bytes: bytes,
) -> str:
    """Build a retry-safe key from the server-received journal payload.

    A client never chooses the persisted key or source reference.  Reposting
    the same recorded journal with the same ticket and billing intent therefore
    reuses its canonical time entry instead of creating another billable row.
    """
    digest = hashlib.sha256()
    for value in (
        ticket_id,
        actor_id,
        repr(duration_minutes),
        "billable" if billable else "non-billable",
        category,
    ):
        encoded = value.encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
    digest.update(len(audio_bytes).to_bytes(8, "big"))
    digest.update(audio_bytes)
    return f"voice_journal:{digest.hexdigest()}"


async def _whisper_transcribe(raw_bytes: bytes, filename: str) -> str:
    """Call Whisper via OpenAI API key. Returns transcript string or raises."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(503, "Voice transcription not configured (OPENAI_API_KEY missing)")
    try:
        from app.services.ai_provider import OpenAISpeechToText
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
    One-shot flow: upload audio Ã¢â€ â€™ transcribe Ã¢â€ â€™ create ticket comment + time entry.
    Perfect for field techs who finish work and speak into the phone.
    """
    # Resolve the ticket through the shared server-side scope boundary before
    # accepting a customer-scoped write or sending its audio to transcription.
    ticket = await assert_record_scope(
        current_user,
        db.tickets,
        ticket_id,
        operation="voice_journal.log_entry",
        resource_name="Ticket",
    )

    if not isinstance(billable, bool):
        raise HTTPException(status_code=422, detail="Billable must be a boolean")
    try:
        duration = float(duration_minutes)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Duration must be a number of minutes")
    if not math.isfinite(duration) or duration < 1:
        raise HTTPException(status_code=422, detail="Duration must be at least one minute")

    category_value = str(category or "Support").strip() or "Support"
    if len(category_value) > 100:
        raise HTTPException(status_code=422, detail="Category must be 100 characters or fewer")

    raw = await audio.read()
    if not raw:
        raise HTTPException(400, "Empty audio upload")
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "Audio too large (max 25MB)")

    transcript = await _whisper_transcribe(raw, audio.filename or "audio.webm")
    if not transcript:
        raise HTTPException(422, "Transcript was empty; try again with a clearer recording")

    now_iso = datetime.now(timezone.utc).isoformat()

    # The server owns the rate, source evidence and idempotency material.  Do
    # not accept a caller-selected time entry ID, rate, amount or client ID.
    technician = await db.users.find_one(
        {"id": current_user.get("id")}, {"_id": 0, "hourly_rate": 1}
    )
    try:
        hourly_rate = float((technician or {}).get("hourly_rate") or 75.0)
    except (TypeError, ValueError):
        hourly_rate = 75.0
    if not math.isfinite(hourly_rate) or hourly_rate < 0:
        hourly_rate = 75.0

    voice_journal_id = f"voice-journal-{uuid.uuid4()}"
    idempotency_key = _voice_journal_idempotency_key(
        ticket_id=str(ticket.get("id") or ticket_id),
        actor_id=str(current_user.get("id") or ""),
        duration_minutes=duration,
        billable=billable,
        category=category_value,
        audio_bytes=raw,
    )
    time_entry, created = await create_canonical_ticket_time_entry(
        ticket=ticket,
        actor=current_user,
        minutes=duration,
        description=transcript[:200],
        billable=billable,
        source="voice_journal",
        source_reference=voice_journal_id,
        idempotency_key=idempotency_key,
        hourly_rate=hourly_rate,
        created_at=now_iso,
        extra={"category": category_value, "voice_journal_id": voice_journal_id},
        database=db,
    )

    # Write the human-readable journal note after the canonical financial row.
    # If a network failure occurs between these writes, retrying the same audio
    # reuses the time row and completes this missing note without double billing.
    comment = await db.ticket_comments.find_one(
        {"source": "voice_journal", "time_entry_id": time_entry["id"]},
        {"_id": 0},
    )
    if not comment:
        comment = {
            "id": str(uuid.uuid4()),
            "ticket_id": ticket["id"],
            "time_entry_id": time_entry["id"],
            "voice_journal_id": time_entry.get("source_reference") or voice_journal_id,
            "idempotency_key": time_entry.get("idempotency_key"),
            "user_id": current_user.get("id", ""),
            "user_name": current_user.get("name", ""),
            "content": f"[Voice Journal Ã‚Â· {duration:g}m]\n{transcript}",
            "is_internal": True,
            "source": "voice_journal",
            "created_at": time_entry.get("created_at") or now_iso,
        }
        await db.ticket_comments.insert_one(comment)

    return {
        "status": "logged",
        "ticket_id": ticket["id"],
        "comment_id": comment["id"],
        "time_entry_id": time_entry["id"],
        "transcript": transcript,
        "duration_minutes": time_entry["minutes"],
        "billable": time_entry["billable"],
        "idempotent_replay": not created,
    }


@router.get("/voice-journal/history")
async def voice_journal_history(limit: int = 20, current_user: dict = Depends(get_current_user)):
    """Recent voice-journal entries by the current tech."""
    entries = await db.time_entries.find(
        scoped_query(
            current_user,
            {"source": "voice_journal", "user_id": current_user.get("id", "")},
        ),
        {"_id": 0},
    ).sort("created_at", -1).to_list(max(1, min(50, limit)))
    return entries
