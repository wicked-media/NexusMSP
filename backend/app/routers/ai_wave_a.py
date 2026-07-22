"""
Wave A AI differentiators:
  1. Ticket Auto-Co-pilot  Ã¢â‚¬â€ summarize thread / suggest next step / draft reply
  2. Explain This Error    Ã¢â‚¬â€ plain-English diagnosis + remediation
  3. Morning Standup Digest Ã¢â‚¬â€ AI brief of overnight events
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
import os
import uuid
import json
import re

from app.database import db
from app.auth import get_current_user

router = APIRouter()

MODEL_PROVIDER = "openai"
MODEL_NAME = os.environ.get("NEXUS_AI_MODEL", "gpt-4o-mini")


async def _llm_complete(system_msg: str, user_msg: str, session_prefix: str = "wave-a") -> str:
    """Single-shot completion using OpenAI API key. Returns text or a friendly fallback."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return "__AI_NOT_CONFIGURED__"
    try:
        from app.services.ai_provider import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key,
            session_id=f"{session_prefix}-{uuid.uuid4().hex[:8]}",
            system_message=system_msg,
        ).with_model(MODEL_PROVIDER, MODEL_NAME)
        resp = await chat.send_message(UserMessage(text=user_msg))
        return resp.strip() if isinstance(resp, str) else str(resp)
    except Exception as e:
        return f"__AI_ERROR__:{str(e)[:160]}"


def _extract_json(text: str):
    """Best-effort: find the first {...} JSON block in the response."""
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# 1. TICKET AUTO-CO-PILOT
# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.post("/tickets/{ticket_id}/copilot")
async def ticket_copilot(
    ticket_id: str,
    data: dict,
    current_user: dict = Depends(get_current_user),
):
    """
    Ticket Auto-Co-pilot.
    body: { "action": "summarize" | "next_step" | "draft_reply", "tone"?: "friendly"|"formal"|"terse" }
    """
    action = (data or {}).get("action", "summarize")
    tone = (data or {}).get("tone", "friendly")
    if action not in ("summarize", "next_step", "draft_reply"):
        raise HTTPException(400, "action must be summarize|next_step|draft_reply")

    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")

    comments = await db.ticket_comments.find(
        {"ticket_id": ticket_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(100)

    thread_lines = [
        f"[{(c.get('author') or 'user')} Ã¢â‚¬Â¢ {(c.get('created_at') or '')[:16]}] "
        f"{(c.get('content') or c.get('message') or '').strip()}"
        for c in comments if (c.get("content") or c.get("message"))
    ]
    thread = "\n".join(thread_lines) or "(no comments yet)"

    title = ticket.get("title", "")
    description = (ticket.get("description") or "").strip()
    client_name = ticket.get("client_name", "")
    priority = ticket.get("priority", "medium")
    status = ticket.get("status", "open")

    system = (
        "You are a senior MSP service-desk engineer helping a tech move a ticket forward. "
        "Be concise, actionable, and grounded in the ticket data. Do not invent facts."
    )

    if action == "summarize":
        prompt = (
            f"Summarize this ticket thread in 3-5 short bullet points. "
            f"Focus on: what the client reported, what's been tried, current blocker.\n\n"
            f"TITLE: {title}\nCLIENT: {client_name}\nPRIORITY: {priority} | STATUS: {status}\n"
            f"DESCRIPTION:\n{description}\n\nTHREAD:\n{thread}"
        )
    elif action == "next_step":
        prompt = (
            f"Given this ticket, suggest the SINGLE best next step the technician should take. "
            f"Format exactly as JSON: {{\"next_step\": \"...\", \"rationale\": \"...\", \"eta_minutes\": <int>}}\n\n"
            f"TITLE: {title}\nCLIENT: {client_name}\nPRIORITY: {priority} | STATUS: {status}\n"
            f"DESCRIPTION:\n{description}\n\nTHREAD:\n{thread}"
        )
    else:  # draft_reply
        prompt = (
            f"Draft a client-facing reply ({tone} tone). Short, clear, no jargon. Keep under 120 words. "
            f"Do NOT promise timelines unless already discussed. Sign as '{current_user.get('name', 'the support team')}'.\n\n"
            f"TITLE: {title}\nCLIENT: {client_name}\nDESCRIPTION:\n{description}\n\nTHREAD:\n{thread}"
        )

    out = await _llm_complete(system, prompt, session_prefix=f"t-{ticket_id}")

    if out.startswith("__AI_NOT_CONFIGURED__"):
        raise HTTPException(503, "AI not configured (OPENAI_API_KEY missing)")
    if out.startswith("__AI_ERROR__"):
        raise HTTPException(502, f"AI provider error: {out.split(':', 1)[-1]}")

    result = {"action": action, "output": out}
    if action == "next_step":
        parsed = _extract_json(out)
        if parsed:
            result["structured"] = parsed

    # Audit
    await db.ai_copilot_events.insert_one({
        "id": f"aic-{uuid.uuid4().hex[:8]}",
        "kind": "ticket_copilot",
        "ticket_id": ticket_id,
        "action": action,
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "output_preview": out[:300],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    return result


# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# 2. EXPLAIN THIS ERROR
# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.post("/ai/explain-error")
async def explain_error(data: dict, current_user: dict = Depends(get_current_user)):
    """
    body: { "error_text": "...", "context"?: "windows event log | linux syslog | app trace | network | other" }
    returns: { "diagnosis": "...", "likely_cause": "...", "severity": "low|medium|high|critical",
               "remediation_steps": ["..."], "references": ["..."] }
    """
    error_text = (data or {}).get("error_text", "").strip()
    context = (data or {}).get("context", "").strip() or "unspecified"
    if not error_text:
        raise HTTPException(400, "error_text is required")
    if len(error_text) > 20000:
        error_text = error_text[:20000]

    system = (
        "You are a senior IT engineer. Given a raw error log or stack trace from an MSP client, "
        "produce a concise diagnosis in plain English. Prefer short, numbered remediation steps. "
        "Respond STRICTLY as JSON with keys: diagnosis, likely_cause, severity "
        "(one of: low, medium, high, critical), remediation_steps (array of short strings), "
        "references (array of canonical docs/KB URLs when applicable; empty array if none known)."
    )
    prompt = f"CONTEXT: {context}\n\nERROR LOG:\n{error_text}\n\nRespond as JSON only."

    out = await _llm_complete(system, prompt, session_prefix="explain-err")

    if out.startswith("__AI_NOT_CONFIGURED__"):
        raise HTTPException(503, "AI not configured (OPENAI_API_KEY missing)")
    if out.startswith("__AI_ERROR__"):
        raise HTTPException(502, f"AI provider error: {out.split(':', 1)[-1]}")

    parsed = _extract_json(out) or {}
    result = {
        "diagnosis": parsed.get("diagnosis") or out[:500],
        "likely_cause": parsed.get("likely_cause", ""),
        "severity": parsed.get("severity", "medium"),
        "remediation_steps": parsed.get("remediation_steps", []),
        "references": parsed.get("references", []),
        "raw": out if not parsed else None,
    }

    await db.ai_copilot_events.insert_one({
        "id": f"aie-{uuid.uuid4().hex[:8]}",
        "kind": "explain_error",
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "context": context,
        "error_preview": error_text[:300],
        "severity": result["severity"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    return result


# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# 3. MORNING STANDUP DIGEST
# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

async def _build_overnight_snapshot(hours: int = 12) -> dict:
    """Gather the raw data feeding the digest."""
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    since_iso = since.isoformat()

    # New tickets overnight
    new_tix = await db.tickets.find(
        {"created_at": {"$gte": since_iso}},
        {"_id": 0, "id": 1, "title": 1, "priority": 1, "client_name": 1, "status": 1, "ticket_number": 1},
    ).to_list(50)
    critical_open = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress"]}, "priority": "critical"},
        {"_id": 0, "id": 1, "title": 1, "client_name": 1, "ticket_number": 1},
    ).to_list(20)

    # SLA breaches (if any exist in DB)
    sla_breaches = await db.tickets.find(
        {"sla_breached": True, "status": {"$in": ["open", "in_progress"]}},
        {"_id": 0, "id": 1, "title": 1, "client_name": 1, "ticket_number": 1},
    ).to_list(20)

    # Offline devices
    offline_devices = await db.devices.count_documents({"status": "offline"})
    warning_devices = await db.devices.count_documents({"status": "warning"})

    # Failed backups (last 24h)
    failed_backups = await db.backup_status.count_documents({
        "backup_health": "failed",
    }) if "backup_status" in await db.list_collection_names() else 0

    # Active alerts
    active_alerts = await db.alerts.count_documents({"status": "active"})

    # Overdue AR
    overdue_inv = await db.invoices.find(
        {"status": "overdue"}, {"_id": 0, "invoice_number": 1, "client_name": 1, "amount_due": 1, "total": 1},
    ).to_list(10)
    overdue_total = sum(float(i.get("amount_due") or i.get("total") or 0) for i in overdue_inv)

    return {
        "window_hours": hours,
        "since": since_iso,
        "new_tickets": new_tix,
        "new_ticket_count": len(new_tix),
        "critical_open": critical_open,
        "sla_breaches": sla_breaches,
        "offline_devices": offline_devices,
        "warning_devices": warning_devices,
        "failed_backups": failed_backups,
        "active_alerts": active_alerts,
        "overdue_invoices_count": len(overdue_inv),
        "overdue_total": round(overdue_total, 2),
    }


def _format_digest_prompt(snap: dict) -> str:
    new_ticks = "\n".join([
        f"  - #{t.get('ticket_number','')} [{t.get('priority','med')}] {t.get('title','')} "
        f"({t.get('client_name','')})"
        for t in snap["new_tickets"][:10]
    ]) or "  - none"

    crit = "\n".join([
        f"  - #{t.get('ticket_number','')} {t.get('title','')} ({t.get('client_name','')})"
        for t in snap["critical_open"][:10]
    ]) or "  - none"

    sla = "\n".join([
        f"  - #{t.get('ticket_number','')} {t.get('title','')} ({t.get('client_name','')})"
        for t in snap["sla_breaches"][:10]
    ]) or "  - none"

    overdue_lines = "\n".join([
        f"  - {i.get('invoice_number','')} {i.get('client_name','')} "
        f"${float(i.get('amount_due') or i.get('total') or 0):.2f}"
        for i in snap.get("_overdue_samples", [])
    ]) or ""

    return (
        f"OVERNIGHT SNAPSHOT (last {snap['window_hours']}h)\n"
        f"- New tickets: {snap['new_ticket_count']}\n{new_ticks}\n\n"
        f"- Critical open tickets:\n{crit}\n\n"
        f"- SLA breaches:\n{sla}\n\n"
        f"- Offline devices: {snap['offline_devices']} | Warning: {snap['warning_devices']}\n"
        f"- Failed backups: {snap['failed_backups']}\n"
        f"- Active alerts: {snap['active_alerts']}\n"
        f"- Overdue invoices: {snap['overdue_invoices_count']} (${snap['overdue_total']:.2f})\n"
        f"{overdue_lines}"
    )


def _slot_for_hour(h: int) -> dict:
    """Return slot metadata for a given local hour (0-23)."""
    if 5 <= h < 12:
        return {
            "key": "morning", "label": "Morning Standup", "icon": "sunrise",
            "default_window": 14,  # look back overnight
            "system": (
                "You are the 7am MSP morning-standup briefer. Produce a 4-6 bullet overnight briefing. "
                "Lead with what requires IMMEDIATE action today, then SLA risk, then ops health. "
                "Always reference tickets using the format #TICKET-NUMBER (e.g. #INC-1234) so they link. "
                "Be concrete (numbers + client names). Plain text, no markdown headers, no preamble."
            ),
        }
    if 12 <= h < 17:
        return {
            "key": "afternoon", "label": "Midday Pulse", "icon": "sun",
            "default_window": 6,
            "system": (
                "You are the midday MSP pulse-check. Produce a 4-5 bullet SINCE-MORNING update. "
                "Flag what has slipped SLA since 7am, what new P1/P2 tickets came in, open tickets with "
                "no activity in 4+ hours, and what must close before EOD. Always reference tickets as "
                "#TICKET-NUMBER so they link. Concrete, plain text, no preamble."
            ),
        }
    return {
        "key": "evening", "label": "End-of-Day Wrap", "icon": "moon",
        "default_window": 10,
        "system": (
            "You are the 5pm MSP end-of-day wrap. Produce a 4-6 bullet wrap: what was resolved today, "
            "what's rolling into tomorrow's overnight queue, SLA risk, and a one-line on-call handoff note. "
            "Always reference tickets as #TICKET-NUMBER so they link. Concrete, plain text, no preamble."
        ),
    }


@router.get("/ai/standup-digest")
async def standup_digest(
    hours: int | None = None,
    slot: str | None = None,
    hour_override: int | None = None,
    current_user: dict = Depends(get_current_user),
):
    """
    Returns a natural-language brief PLUS raw structured data.

    Time-aware: slot auto-selected from local hour (morning/afternoon/evening) unless
    the caller passes `slot`. Use `hour_override` to preview a different slot.
    """
    from zoneinfo import ZoneInfo
    tz_name = "Australia/Sydney"
    try:
        doc = await db.settings.find_one({"key": "standup_digest"}, {"_id": 0}) or {}
        tz_name = (doc.get("value") or {}).get("timezone") or tz_name
    except Exception:
        pass
    try:
        local_hour = hour_override if hour_override is not None else datetime.now(ZoneInfo(tz_name)).hour
    except Exception:
        local_hour = hour_override if hour_override is not None else datetime.now().hour

    if slot == "morning":
        meta = _slot_for_hour(8)
    elif slot == "afternoon":
        meta = _slot_for_hour(14)
    elif slot == "evening":
        meta = _slot_for_hour(18)
    else:
        meta = _slot_for_hour(local_hour)

    window_hours = hours if hours is not None else meta["default_window"]
    snap = await _build_overnight_snapshot(hours=max(1, min(48, window_hours)))
    prompt_body = _format_digest_prompt(snap)
    out = await _llm_complete(meta["system"], prompt_body, session_prefix=f"digest-{meta['key']}")

    ai_brief = None
    ai_status = "ready"
    if out.startswith("__AI_NOT_CONFIGURED__"):
        ai_status = "not_configured"
        ai_brief = "AI briefing is not configured yet."
    elif out.startswith("__AI_ERROR__"):
        ai_status = "unavailable"
        ai_brief = "AI briefing is temporarily unavailable. Try again shortly."
    else:
        ai_brief = out

    digest = {
        "id": f"digest-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window_hours": snap["window_hours"],
        "slot": meta["key"],
        "slot_label": meta["label"],
        "slot_icon": meta["icon"],
        "ai_brief": ai_brief,
        "ai_status": ai_status,
        "stats": {
            "new_tickets": snap["new_ticket_count"],
            "critical_open": len(snap["critical_open"]),
            "sla_breaches": len(snap["sla_breaches"]),
            "offline_devices": snap["offline_devices"],
            "warning_devices": snap["warning_devices"],
            "failed_backups": snap["failed_backups"],
            "active_alerts": snap["active_alerts"],
            "overdue_invoices_count": snap["overdue_invoices_count"],
            "overdue_total": snap["overdue_total"],
        },
    }

    # Save every generation as a log (useful for history panel)
    try:
        await db.standup_digests.insert_one({**digest, "user_id": current_user.get("id")})
    except Exception:
        pass

    return digest


@router.get("/ai/standup-digest/history")
async def standup_digest_history(limit: int = 14, current_user: dict = Depends(get_current_user)):
    """Recent digest history (defaults to last 14 briefs)."""
    items = await db.standup_digests.find({}, {"_id": 0}).sort("generated_at", -1).to_list(max(1, min(60, limit)))
    return items


# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Settings for digest delivery (email/SMS/banner) Ã¢â‚¬â€ persisted per-admin
# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.get("/ai/standup-digest/settings")
async def get_digest_settings(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"key": "standup_digest"}, {"_id": 0}) or {}
    val = doc.get("value", {})
    return {
        "enabled": bool(val.get("enabled", False)),
        "send_hour_local": int(val.get("send_hour_local", 7)),
        "timezone": val.get("timezone", "Australia/Sydney"),
        "window_hours": int(val.get("window_hours", 12)),
        "channels": val.get("channels", {"banner": True, "email": False, "sms": False}),
        "email_to": val.get("email_to", []),
        "sms_to": val.get("sms_to", []),
        "last_run_at": val.get("last_run_at"),
    }


@router.put("/ai/standup-digest/settings")
async def update_digest_settings(data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"enabled", "send_hour_local", "timezone", "window_hours", "channels", "email_to", "sms_to"}
    patch = {k: v for k, v in (data or {}).items() if k in allowed}
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    patch["updated_by"] = current_user.get("name")
    await db.settings.update_one(
        {"key": "standup_digest"},
        {"$set": {"key": "standup_digest", **{f"value.{k}": v for k, v in patch.items()}}},
        upsert=True,
    )
    doc = await db.settings.find_one({"key": "standup_digest"}, {"_id": 0})
    return doc.get("value", {}) if doc else {}
