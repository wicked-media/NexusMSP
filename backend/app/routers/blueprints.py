"""Ticket Blueprints — reusable worksheet + workflow templates.

Purpose: a Syncro-Blueprints-style system that lets an MSP define a named
"blueprint" (e.g. "New Employee Onboarding", "VPN Outage", "Printer Install")
with custom fields + checklist + defaults, then assign that blueprint to a
client so every new ticket for that client automatically applies the worksheet.

Data model:
  db.blueprints:
    { id, name, description, icon, color,
      default_priority, default_category, default_status,
      default_assignee_id, sla_minutes,
      require_completion: bool,  # block resolve unless checklist 100%
      fields: [{key, label, type: 'text'|'textarea'|'number'|'date'|'select'|'checkbox', options?, required, placeholder}],
      checklist: [{id, label, required}],
      created_at, created_by, active
    }

  db.clients.blueprint_ids: [str]    # which blueprints are eligible
  db.clients.default_blueprint_id: str | None  # auto-apply on new ticket

  Ticket gets new fields when blueprint is applied:
    ticket.blueprint_id, ticket.blueprint_name,
    ticket.blueprint_fields: {<key>: <value>},
    ticket.blueprint_checklist: [{id, label, required, done, done_by, done_at}]
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
import uuid

from app.database import db
from app.auth import get_current_user

router = APIRouter()

VALID_FIELD_TYPES = {"text", "textarea", "number", "date", "select", "checkbox"}


def _validate_fields(fields):
    out = []
    for f in (fields or []):
        key = (f.get("key") or "").strip()
        label = (f.get("label") or "").strip()
        ftype = f.get("type") or "text"
        if not key or not label or ftype not in VALID_FIELD_TYPES:
            continue
        item = {
            "key": key[:60],
            "label": label[:120],
            "type": ftype,
            "required": bool(f.get("required", False)),
            "placeholder": (f.get("placeholder") or "")[:200],
        }
        if ftype == "select":
            item["options"] = [str(o)[:80] for o in (f.get("options") or []) if str(o).strip()][:30]
        out.append(item)
    return out


def _validate_checklist(items):
    out = []
    for it in (items or []):
        label = (it.get("label") or "").strip()
        if not label:
            continue
        out.append({
            "id": it.get("id") or f"cl-{uuid.uuid4().hex[:8]}",
            "label": label[:200],
            "required": bool(it.get("required", False)),
        })
    return out


# ─────────────────────── CRUD: Blueprints ───────────────────────

@router.get("/blueprints")
async def list_blueprints(active_only: bool = True, current_user: dict = Depends(get_current_user)):
    q = {"active": True} if active_only else {}
    items = await db.blueprints.find(q, {"_id": 0}).sort("name", 1).to_list(500)
    return items


@router.get("/blueprints/{bp_id}")
async def get_blueprint(bp_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.blueprints.find_one({"id": bp_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Blueprint not found")
    return doc


@router.post("/blueprints")
async def create_blueprint(data: dict, current_user: dict = Depends(get_current_user)):
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    doc = {
        "id": f"bp-{uuid.uuid4().hex[:10]}",
        "name": name[:120],
        "description": (data.get("description") or "")[:600],
        "icon": (data.get("icon") or "Clipboard")[:40],
        "color": (data.get("color") or "sky")[:20],
        "default_priority": data.get("default_priority"),
        "default_category": data.get("default_category"),
        "default_status": data.get("default_status"),
        "default_assignee_id": data.get("default_assignee_id"),
        "sla_minutes": int(data["sla_minutes"]) if data.get("sla_minutes") else None,
        "require_completion": bool(data.get("require_completion", False)),
        "fields": _validate_fields(data.get("fields")),
        "checklist": _validate_checklist(data.get("checklist")),
        "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name"),
    }
    await db.blueprints.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/blueprints/{bp_id}")
async def update_blueprint(bp_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    patch = {}
    for k in ("name", "description", "icon", "color", "default_priority", "default_category",
              "default_status", "default_assignee_id"):
        if k in data:
            patch[k] = data[k]
    if "sla_minutes" in data:
        try:
            patch["sla_minutes"] = int(data["sla_minutes"]) if data["sla_minutes"] not in (None, "") else None
        except Exception:
            pass
    if "require_completion" in data:
        patch["require_completion"] = bool(data["require_completion"])
    if "active" in data:
        patch["active"] = bool(data["active"])
    if "fields" in data:
        patch["fields"] = _validate_fields(data["fields"])
    if "checklist" in data:
        patch["checklist"] = _validate_checklist(data["checklist"])
    if not patch:
        return {"success": True, "no_change": True}
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.blueprints.update_one({"id": bp_id}, {"$set": patch})
    if res.matched_count == 0:
        raise HTTPException(404, "Blueprint not found")
    return await db.blueprints.find_one({"id": bp_id}, {"_id": 0})


@router.delete("/blueprints/{bp_id}")
async def delete_blueprint(bp_id: str, current_user: dict = Depends(get_current_user)):
    await db.blueprints.update_one({"id": bp_id}, {"$set": {"active": False}})
    return {"success": True}


# ─────────────────────── Client linking ───────────────────────

@router.get("/clients/{client_id}/blueprints")
async def get_client_blueprints(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "blueprint_ids": 1, "default_blueprint_id": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    bp_ids = client.get("blueprint_ids") or []
    default_id = client.get("default_blueprint_id")
    blueprints = await db.blueprints.find({"id": {"$in": bp_ids}, "active": True}, {"_id": 0}).to_list(100) if bp_ids else []
    return {"blueprint_ids": bp_ids, "default_blueprint_id": default_id, "blueprints": blueprints}


@router.put("/clients/{client_id}/blueprints")
async def set_client_blueprints(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    bp_ids = [str(b) for b in (data.get("blueprint_ids") or [])]
    default_id = data.get("default_blueprint_id")
    if default_id and default_id not in bp_ids:
        raise HTTPException(400, "default_blueprint_id must be in blueprint_ids")
    res = await db.clients.update_one(
        {"id": client_id},
        {"$set": {"blueprint_ids": bp_ids, "default_blueprint_id": default_id}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Client not found")
    return {"success": True, "blueprint_ids": bp_ids, "default_blueprint_id": default_id}


# ─────────────────────── Ticket application ───────────────────────

def _hydrate_ticket_with_blueprint(ticket: dict, bp: dict) -> dict:
    """Merge a blueprint's defaults + worksheet shell into a ticket dict.
    Ticket existing values win for already-set scalar defaults (priority/category/etc).
    """
    def set_if_empty(key, val):
        if val is not None and val != "" and not ticket.get(key):
            ticket[key] = val
    set_if_empty("priority", bp.get("default_priority"))
    set_if_empty("category", bp.get("default_category"))
    set_if_empty("status", bp.get("default_status"))
    set_if_empty("assignee_id", bp.get("default_assignee_id"))
    if bp.get("sla_minutes") and not ticket.get("sla_minutes"):
        ticket["sla_minutes"] = bp["sla_minutes"]
    ticket["blueprint_id"] = bp["id"]
    ticket["blueprint_name"] = bp["name"]
    ticket["blueprint_require_completion"] = bool(bp.get("require_completion"))
    # Preserve existing worksheet values when re-applying
    existing_fields = ticket.get("blueprint_fields") or {}
    ticket["blueprint_fields"] = {f["key"]: existing_fields.get(f["key"], "") for f in (bp.get("fields") or [])}
    existing_cl = {c.get("id"): c for c in (ticket.get("blueprint_checklist") or [])}
    ticket["blueprint_checklist"] = [
        {
            **c,
            "done": bool(existing_cl.get(c["id"], {}).get("done", False)),
            "done_by": existing_cl.get(c["id"], {}).get("done_by"),
            "done_at": existing_cl.get(c["id"], {}).get("done_at"),
        }
        for c in (bp.get("checklist") or [])
    ]
    return ticket


@router.post("/tickets/{ticket_id}/apply-blueprint")
async def apply_blueprint(ticket_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Body: { blueprint_id }"""
    bp_id = data.get("blueprint_id")
    if not bp_id:
        raise HTTPException(400, "blueprint_id required")
    bp = await db.blueprints.find_one({"id": bp_id, "active": True}, {"_id": 0})
    if not bp:
        raise HTTPException(404, "Blueprint not found or inactive")
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    _hydrate_ticket_with_blueprint(ticket, bp)
    ticket["blueprint_applied_at"] = datetime.now(timezone.utc).isoformat()
    ticket["blueprint_applied_by"] = current_user.get("name")
    await db.tickets.update_one({"id": ticket_id}, {"$set": {k: ticket[k] for k in (
        "priority", "category", "status", "assignee_id", "sla_minutes",
        "blueprint_id", "blueprint_name", "blueprint_require_completion",
        "blueprint_fields", "blueprint_checklist",
        "blueprint_applied_at", "blueprint_applied_by"
    ) if k in ticket}})
    return await db.tickets.find_one({"id": ticket_id}, {"_id": 0})


@router.put("/tickets/{ticket_id}/blueprint-fields")
async def update_worksheet_fields(ticket_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Body: { fields: {key: value, ...} } — patch worksheet field values."""
    patch = data.get("fields") or {}
    if not isinstance(patch, dict):
        raise HTTPException(400, "fields must be an object")
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "blueprint_fields": 1})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    merged = {**(ticket.get("blueprint_fields") or {}), **{k: v for k, v in patch.items() if isinstance(k, str)}}
    await db.tickets.update_one({"id": ticket_id}, {"$set": {"blueprint_fields": merged, "blueprint_fields_updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"success": True, "blueprint_fields": merged}


@router.post("/tickets/{ticket_id}/blueprint-checklist/{item_id}/toggle")
async def toggle_checklist_item(ticket_id: str, item_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "blueprint_checklist": 1})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    cl = ticket.get("blueprint_checklist") or []
    found = False
    now = datetime.now(timezone.utc).isoformat()
    for c in cl:
        if c.get("id") == item_id:
            done = not c.get("done", False)
            c["done"] = done
            c["done_by"] = current_user.get("name") if done else None
            c["done_at"] = now if done else None
            found = True
            break
    if not found:
        raise HTTPException(404, "Checklist item not found")
    await db.tickets.update_one({"id": ticket_id}, {"$set": {"blueprint_checklist": cl}})
    return {"success": True, "checklist": cl}


# ─────────────────────── AI: Suggest blueprint from history ───────────────────────

@router.post("/blueprints/suggest-from-history")
async def suggest_blueprint_from_history(data: dict, current_user: dict = Depends(get_current_user)):
    """Use Claude Sonnet 4.5 to draft a blueprint from this client's resolved tickets.

    body: { ticket_id?: "...", client_id?: "...", title_hint?: "..." }
    Returns a draft blueprint JSON (NOT saved) for the user to review + save.
    """
    import os
    import re
    import json

    ticket_id = data.get("ticket_id")
    client_id = data.get("client_id")
    title_hint = (data.get("title_hint") or "").strip()

    if ticket_id and not client_id:
        t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "client_id": 1, "title": 1})
        if t:
            client_id = t.get("client_id")
            if not title_hint:
                title_hint = t.get("title", "")

    if not client_id:
        raise HTTPException(400, "client_id (or ticket_id) required")

    # Pull resolved/closed tickets for this client — match on title tokens to narrow scope
    tokens = [tok.lower() for tok in re.split(r"[\s\-_]+", title_hint) if len(tok) > 3][:6]
    q = {"client_id": client_id, "status": {"$in": ["resolved", "closed"]}}
    tix = await db.tickets.find(
        q,
        {"_id": 0, "id": 1, "title": 1, "description": 1, "category": 1, "priority": 1,
         "resolution": 1, "resolved_at": 1, "ticket_number": 1}
    ).sort("resolved_at", -1).limit(200).to_list(200)

    if tokens:
        scored = []
        for t in tix:
            title_lower = (t.get("title") or "").lower()
            score = sum(1 for tok in tokens if tok in title_lower)
            if score > 0:
                scored.append((score, t))
        scored.sort(key=lambda x: -x[0])
        matched = [t for _, t in scored[:15]]
    else:
        matched = tix[:15]

    if len(matched) < 2:
        raise HTTPException(400, "Not enough similar resolved tickets to learn from (need at least 2). Create a blueprint manually.")

    # Build corpus for the LLM
    corpus_lines = []
    for t in matched[:12]:
        corpus_lines.append(
            f"#{t.get('ticket_number','')} [{t.get('priority','medium')}·{t.get('category','support')}] "
            f"{t.get('title','')}\n  Fix: {(t.get('resolution') or t.get('description') or '')[:400]}"
        )
    corpus = "\n\n".join(corpus_lines)

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(503, "AI not configured (EMERGENT_LLM_KEY missing)")

    system_msg = (
        "You are an MSP automation designer. Given a bundle of resolved support tickets of the "
        "same recurring type, produce a REUSABLE Ticket Blueprint that standardises handling. "
        "Return STRICT JSON only (no prose) with keys: "
        "name (short, title-case), description (1 sentence), default_priority "
        "(low|medium|high|critical), default_category (single word), sla_minutes (integer), "
        "require_completion (bool — true if tickets tend to have data-gathering up-front), "
        "fields (array of {key (snake_case), label, type (text|textarea|number|date|select|checkbox), "
        "required, placeholder, options? (array of strings for 'select' only)}), "
        "checklist (array of {label, required}). "
        "Aim for 3-6 fields and 4-8 checklist items based on real patterns in the corpus. "
        "Do NOT invent fields not hinted by the corpus. Keep keys machine-friendly."
    )
    user_msg = (
        f"CLIENT resolved tickets (most-similar first):\n\n{corpus}\n\n"
        f"Target title hint: {title_hint or '(none)'}\n\n"
        "Return only the JSON."
    )

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        import uuid as _uuid
        chat = LlmChat(
            api_key=api_key,
            session_id=f"bp-suggest-{_uuid.uuid4().hex[:8]}",
            system_message=system_msg,
        ).with_model("anthropic", "claude-sonnet-4-5-20250929")
        raw = await chat.send_message(UserMessage(text=user_msg))
        text = raw.strip() if isinstance(raw, str) else str(raw)
    except Exception as e:
        raise HTTPException(502, f"AI call failed: {str(e)[:160]}")

    # Extract the first JSON block
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise HTTPException(502, "AI did not return JSON")
    try:
        draft = json.loads(m.group(0))
    except Exception:
        raise HTTPException(502, "AI returned invalid JSON")

    # Validate + coerce through the existing sanitizers so the shape matches CRUD
    safe = {
        "name": str(draft.get("name") or title_hint or "Suggested Blueprint")[:120],
        "description": str(draft.get("description") or "")[:600],
        "default_priority": draft.get("default_priority"),
        "default_category": draft.get("default_category"),
        "default_status": None,
        "sla_minutes": draft.get("sla_minutes"),
        "require_completion": bool(draft.get("require_completion", False)),
        "fields": _validate_fields(draft.get("fields")),
        "checklist": _validate_checklist([{**c, "id": f"cl-{uuid.uuid4().hex[:8]}"} for c in (draft.get("checklist") or [])]),
    }
    try:
        safe["sla_minutes"] = int(safe["sla_minutes"]) if safe["sla_minutes"] else None
    except Exception:
        safe["sla_minutes"] = None

    return {
        "draft": safe,
        "source_tickets": [{"id": t.get("id"), "ticket_number": t.get("ticket_number"), "title": t.get("title")} for t in matched[:12]],
        "ai_model": "claude-sonnet-4-5-20250929",
    }
