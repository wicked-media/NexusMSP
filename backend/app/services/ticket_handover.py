"""Read-only, evidence-based ticket briefing. No generated claims or new storage."""
from datetime import datetime, timezone
from html import unescape
import re


def plain_text(value, limit=1200):
    return unescape(re.sub(r"<[^>]+>", " ", str(value or ""))).strip()[:limit]


def build_handover(ticket, comments, children, *, since=None):
    evidence = []
    undated = 0
    for note in comments:
        try:
            at = datetime.fromisoformat(str(note.get("created_at") or "").replace("Z", "+00:00"))
            if at.tzinfo is None:
                at = at.replace(tzinfo=timezone.utc)
        except ValueError:
            undated += 1
            continue
        if since and at < since:
            continue
        if not note.get("id"):
            continue
        evidence.append({
            "id": note["id"], "created_at": at.isoformat(),
            "author": plain_text(note.get("user_name"), 100),
            "internal": bool(note.get("is_internal") or note.get("visibility") == "internal"),
            "text": plain_text(note.get("content")), "source": "ticket_comments",
        })
    evidence.sort(key=lambda row: row["created_at"], reverse=True)
    open_children = [{"id": row["id"], "number": row.get("ticket_number"),
                      "title": plain_text(row.get("title"), 200), "status": row.get("status")}
                     for row in children if row.get("id") and row.get("status") not in {"closed", "resolved", "completed"}]
    return {
        "ticket_id": ticket["id"], "number": ticket.get("ticket_number"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "since": since.isoformat() if since else None,
        "request": plain_text(ticket.get("description")), "status": ticket.get("status"),
        "resolution": plain_text(ticket.get("resolution_notes")),
        "blocker": plain_text(ticket.get("blocked_by_ticket_number"), 100),
        "evidence": evidence[:30], "matching_note_count": len(evidence),
        "undated_notes": undated, "open_children": open_children,
        "limited": len(comments) >= 200 or len(children) >= 100 or len(evidence) > 30,
        "scope": "Recorded ticket notes and child work only. Emails, calls, remote sessions and attachments are not included. Notes are evidence of what was recorded, not verification that an action succeeded.",
    }
