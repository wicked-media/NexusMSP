from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
import uuid, os
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/settings/auto-merge")
async def get_auto_merge_settings(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "auto_merge"}, {"_id": 0})
    if not settings:
        settings = {
            "enabled": False,
            "time_window_minutes": 60,
            "match_criteria": ["client_id", "category"],
            "similarity_threshold": 70,
            "auto_merge": False,
            "suggest_only": True,
            "exclude_priorities": ["critical"],
        }
    return settings


@router.put("/settings/auto-merge")
async def update_auto_merge_settings(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "auto_merge"},
        {"$set": {**data, "type": "auto_merge", "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"message": "Auto-merge settings updated"}


@router.get("/tickets/merge-suggestions")
async def get_merge_suggestions(current_user: dict = Depends(get_current_user)):
    """Find potential duplicate tickets that could be merged."""
    settings = await db.settings.find_one({"type": "auto_merge"}, {"_id": 0})
    if not settings or not settings.get("enabled", False):
        return {"enabled": False, "suggestions": []}

    window_min = settings.get("time_window_minutes", 60)
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=window_min)).isoformat()
    exclude_priorities = settings.get("exclude_priorities", ["critical"])

    open_tickets = await db.tickets.find({
        "status": {"$nin": ["closed", "resolved"]},
        "priority": {"$nin": exclude_priorities},
    }, {"_id": 0}).sort("created_at", -1).to_list(500)

    suggestions = []
    seen_pairs = set()

    for i, t1 in enumerate(open_tickets):
        for t2 in open_tickets[i+1:]:
            pair_key = tuple(sorted([t1["id"], t2["id"]]))
            if pair_key in seen_pairs:
                continue

            score = 0
            reasons = []

            # Same client
            if t1.get("client_id") and t1.get("client_id") == t2.get("client_id"):
                score += 30
                reasons.append("Same client")

            # Same category
            if t1.get("category") and t1.get("category") == t2.get("category"):
                score += 20
                reasons.append("Same category")

            # Same device
            if t1.get("device_id") and t1.get("device_id") == t2.get("device_id"):
                score += 25
                reasons.append("Same device")

            # Title similarity (simple word overlap)
            t1_words = set((t1.get("title", "") or "").lower().split())
            t2_words = set((t2.get("title", "") or "").lower().split())
            common = t1_words & t2_words
            stop_words = {"the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "to", "for", "of", "and", "or", "not", "-", "with"}
            common = common - stop_words
            if len(t1_words | t2_words) > 0:
                word_overlap = len(common) / len(t1_words | t2_words) * 100
                if word_overlap > 30:
                    score += int(word_overlap * 0.25)
                    reasons.append(f"{int(word_overlap)}% title overlap")

            threshold = settings.get("similarity_threshold", 70)
            if score >= threshold:
                seen_pairs.add(pair_key)
                suggestions.append({
                    "id": f"merge-{uuid.uuid4().hex[:8]}",
                    "ticket_a": {"id": t1["id"], "title": t1.get("title", ""), "client_name": t1.get("client_name", ""), "priority": t1.get("priority", ""), "created_at": t1.get("created_at", "")},
                    "ticket_b": {"id": t2["id"], "title": t2.get("title", ""), "client_name": t2.get("client_name", ""), "priority": t2.get("priority", ""), "created_at": t2.get("created_at", "")},
                    "score": score,
                    "reasons": reasons,
                })

    suggestions.sort(key=lambda x: x["score"], reverse=True)
    return {"enabled": True, "suggestions": suggestions[:20]}


@router.post("/tickets/merge")
async def merge_tickets(data: dict, current_user: dict = Depends(get_current_user)):
    """Merge ticket_b into ticket_a. ticket_a becomes the primary, ticket_b is closed."""
    primary_id = data.get("primary_ticket_id")
    secondary_id = data.get("secondary_ticket_id")
    if not primary_id or not secondary_id:
        raise HTTPException(status_code=400, detail="Both ticket IDs required")

    primary = await db.tickets.find_one({"id": primary_id}, {"_id": 0})
    secondary = await db.tickets.find_one({"id": secondary_id}, {"_id": 0})
    if not primary or not secondary:
        raise HTTPException(status_code=404, detail="Ticket not found")

    now = datetime.now(timezone.utc).isoformat()

    # Add merge note to primary
    merge_note = f"[AUTO-MERGE] Merged ticket '{secondary.get('title', '')}' (#{secondary_id}) into this ticket.\n"
    if secondary.get("description"):
        merge_note += f"Original description: {secondary['description']}\n"

    await db.ticket_notes.insert_one({
        "id": str(uuid.uuid4()),
        "ticket_id": primary_id,
        "content": merge_note,
        "author_name": "System - Auto Merge",
        "author_id": "system",
        "is_internal": True,
        "created_at": now,
    })

    # Move secondary's notes to primary
    sec_notes = await db.ticket_notes.find({"ticket_id": secondary_id}, {"_id": 0}).to_list(100)
    for note in sec_notes:
        await db.ticket_notes.update_one({"id": note["id"]}, {"$set": {
            "ticket_id": primary_id,
            "content": f"[From merged ticket #{secondary_id}] {note.get('content', '')}",
        }})

    # Close secondary
    await db.tickets.update_one({"id": secondary_id}, {"$set": {
        "status": "closed",
        "resolution": f"Merged into ticket #{primary_id}",
        "merged_into": primary_id,
        "closed_at": now,
        "updated_at": now,
    }})

    # Log the merge
    await db.merge_logs.insert_one({
        "id": f"mlog-{uuid.uuid4().hex[:8]}",
        "primary_ticket_id": primary_id,
        "secondary_ticket_id": secondary_id,
        "primary_title": primary.get("title", ""),
        "secondary_title": secondary.get("title", ""),
        "client_name": primary.get("client_name", ""),
        "merged_by": current_user.get("name", ""),
        "merged_at": now,
    })

    return {"message": f"Ticket #{secondary_id} merged into #{primary_id}", "primary_ticket_id": primary_id}


@router.post("/tickets/merge/dismiss")
async def dismiss_merge_suggestion(data: dict, current_user: dict = Depends(get_current_user)):
    """Dismiss a merge suggestion so it doesn't show again."""
    suggestion_id = data.get("suggestion_id")
    await db.dismissed_merges.insert_one({
        "id": suggestion_id,
        "dismissed_by": current_user.get("name", ""),
        "dismissed_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"message": "Suggestion dismissed"}


@router.get("/tickets/merge/history")
async def get_merge_history(current_user: dict = Depends(get_current_user)):
    logs = await db.merge_logs.find({}, {"_id": 0}).sort("merged_at", -1).to_list(50)
    return logs
