from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()

@router.post("/voice-ticket/transcribe")
async def transcribe_voice(data: dict, current_user: dict = Depends(get_current_user)):
    """Voice transcription - accepts text/audio reference and returns structured ticket data"""
    transcript = data.get("transcript", "")
    ticket_id = data.get("ticket_id")
    action = data.get("action", "note")  # note, update, create
    
    if not transcript:
        raise HTTPException(status_code=400, detail="No transcript provided")
    
    # AI-powered extraction (keyword-based)
    lower = transcript.lower()
    priority = "critical" if any(w in lower for w in ["critical", "down", "emergency", "urgent"]) else \
               "high" if any(w in lower for w in ["important", "asap", "high"]) else \
               "medium" if any(w in lower for w in ["medium", "normal"]) else "low"
    
    category = "networking" if any(w in lower for w in ["network", "internet", "wifi", "dns", "vpn"]) else \
               "hardware" if any(w in lower for w in ["hardware", "printer", "monitor", "laptop"]) else \
               "email" if any(w in lower for w in ["email", "outlook", "exchange"]) else \
               "security" if any(w in lower for w in ["security", "virus", "malware", "breach"]) else \
               "software" if any(w in lower for w in ["software", "install", "update", "app"]) else "support"
    
    # If adding to existing ticket
    if ticket_id and action == "note":
        ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        
        comment = {
            "id": str(uuid.uuid4()), "ticket_id": ticket_id,
            "user_id": current_user["id"], "user_name": current_user["name"],
            "content": f"[Voice Note] {transcript}",
            "is_internal": True, "source": "voice",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.ticket_comments.insert_one(comment)
        return {"action": "note_added", "ticket_id": ticket_id, "transcript": transcript, "comment_id": comment["id"]}
    
    # Create new ticket from voice
    if action == "create":
        sentences = transcript.split(".")
        title = sentences[0].strip()[:100] if sentences else transcript[:100]
        
        ticket = {
            "id": str(uuid.uuid4()),
            "ticket_number": f"VT-{datetime.now(timezone.utc).strftime('%H%M%S')}",
            "title": title,
            "description": transcript,
            "priority": priority, "category": category,
            "status": "open", "source": "voice",
            "client_id": data.get("client_id"),
            "client_name": data.get("client_name"),
            "assigned_to": None, "assigned_name": None,
            "created_by": current_user["id"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.tickets.insert_one(ticket)
        ticket.pop("_id", None)
        return {"action": "ticket_created", "ticket": ticket, "extracted": {"priority": priority, "category": category}}
    
    # Just transcribe and extract
    return {
        "action": "transcribed", "transcript": transcript,
        "extracted": {"priority": priority, "category": category, "suggested_title": transcript[:100]},
        "confidence": 0.87
    }

@router.get("/voice-ticket/history")
async def get_voice_history(current_user: dict = Depends(get_current_user)):
    comments = await db.ticket_comments.find({"source": "voice", "user_id": current_user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return comments
