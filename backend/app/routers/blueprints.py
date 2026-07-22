"""Ticket Blueprints â€” reusable worksheet + workflow templates.

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
      child_templates: [{id, title, description, priority, category, blueprint_id?, per_device, required}],
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

STARTER_BLUEPRINTS = [
    {"name": "New Starter Onboarding", "description": "Collect access, equipment, and handover details for a new employee.", "default_priority": "medium", "default_category": "onboarding", "sla_minutes": 480, "require_completion": True, "fields": [{"key": "employee_name", "label": "Employee name", "type": "text", "required": True}, {"key": "start_date", "label": "Start date", "type": "date", "required": True}, {"key": "manager", "label": "Manager", "type": "text", "required": True}, {"key": "access_required", "label": "Access required", "type": "textarea", "required": True}], "checklist": [{"label": "Confirm manager approval", "required": True}, {"label": "Create accounts and assign licences", "required": True}, {"label": "Prepare and record assigned equipment", "required": True}, {"label": "Send welcome and handover instructions", "required": True}]},
    {"name": "Leaver Offboarding", "description": "Securely remove access and recover assets when an employee leaves.", "default_priority": "high", "default_category": "offboarding", "sla_minutes": 240, "require_completion": True, "fields": [{"key": "employee_name", "label": "Employee name", "type": "text", "required": True}, {"key": "departure_time", "label": "Access removal time", "type": "date", "required": True}, {"key": "manager", "label": "Manager", "type": "text", "required": True}, {"key": "asset_return", "label": "Assets to recover", "type": "textarea", "required": False}], "checklist": [{"label": "Confirm departure approval", "required": True}, {"label": "Disable identity and revoke sessions", "required": True}, {"label": "Remove groups, licences and delegated access", "required": True}, {"label": "Arrange asset recovery", "required": True}, {"label": "Record completion for audit", "required": True}]},
    {"name": "Microsoft 365 Access Issue", "description": "Triage sign-in, MFA, licence, and mailbox access problems consistently.", "default_priority": "high", "default_category": "microsoft365", "sla_minutes": 240, "require_completion": False, "fields": [{"key": "affected_user", "label": "Affected user", "type": "text", "required": True}, {"key": "service", "label": "Affected service", "type": "select", "required": True, "options": ["Outlook", "Teams", "SharePoint", "OneDrive", "Sign-in", "Other"]}, {"key": "error_message", "label": "Error message", "type": "textarea", "required": False}], "checklist": [{"label": "Confirm user identity and impact", "required": True}, {"label": "Check service health and sign-in logs", "required": True}, {"label": "Validate licence and group membership", "required": True}, {"label": "Document resolution and user confirmation", "required": True}]},
    {"name": "Printer & Scan Fault", "description": "Capture diagnostics for printing, scanning, driver, and connectivity incidents.", "default_priority": "medium", "default_category": "hardware", "sla_minutes": 480, "require_completion": False, "fields": [{"key": "printer_model", "label": "Printer / model", "type": "text", "required": True}, {"key": "location", "label": "Location", "type": "text", "required": True}, {"key": "symptom", "label": "Symptom", "type": "textarea", "required": True}], "checklist": [{"label": "Confirm scope and affected users", "required": True}, {"label": "Check power, paper, network and consumables", "required": True}, {"label": "Verify queue, driver and test page", "required": True}, {"label": "Record fix and test result", "required": True}]},
    {"name": "VPN / Remote Access Issue", "description": "Standardise investigation of remote connectivity, MFA, and access requests.", "default_priority": "high", "default_category": "network", "sla_minutes": 240, "require_completion": False, "fields": [{"key": "affected_user", "label": "Affected user", "type": "text", "required": True}, {"key": "connection_type", "label": "Connection type", "type": "select", "required": True, "options": ["VPN", "Remote desktop", "Remote app", "Other"]}, {"key": "error_message", "label": "Error message", "type": "textarea", "required": False}], "checklist": [{"label": "Confirm internet connectivity", "required": True}, {"label": "Validate MFA and account status", "required": True}, {"label": "Check VPN gateway and assigned policy", "required": True}, {"label": "Test access and document outcome", "required": True}]},
    {"name": "Security Incident Triage", "description": "Contain, investigate, and escalate a suspected security event.", "default_priority": "critical", "default_category": "security", "sla_minutes": 60, "require_completion": True, "fields": [{"key": "affected_device", "label": "Affected device / account", "type": "text", "required": True}, {"key": "detection_source", "label": "Detection source", "type": "select", "required": True, "options": ["Defender", "Huntress", "User report", "NexusMSP alert", "Other"]}, {"key": "observed_activity", "label": "Observed activity", "type": "textarea", "required": True}], "checklist": [{"label": "Capture evidence and timestamp", "required": True}, {"label": "Contain affected endpoint or identity", "required": True}, {"label": "Assess scope and escalate per runbook", "required": True}, {"label": "Document customer communications", "required": True}, {"label": "Record remediation and follow-up", "required": True}]},
    {"name": "Client Onboarding Delivery Plan", "description": "A parent service record that creates accountable child work for access, managed devices, monitoring, and handover.", "default_priority": "high", "default_category": "onboarding", "sla_minutes": 480, "require_completion": True, "fields": [{"key": "service_owner", "label": "Service owner", "type": "text", "required": True, "placeholder": "Technician accountable for delivery"}, {"key": "go_live_target", "label": "Target go-live date", "type": "date", "required": True}], "checklist": [{"label": "Confirm client scope and primary contact", "required": True}, {"label": "Review every linked child ticket before handover", "required": True}, {"label": "Confirm client go-live approval", "required": True}], "child_templates": [{"title": "Identity and access baseline", "description": "Confirm administrators, MFA, licensing, and support contacts are ready for managed service.", "priority": "high", "category": "onboarding", "required": True}, {"title": "Managed device enrolment", "description": "Install the Nexus agent, apply policy, and verify monitoring for this managed device.", "priority": "medium", "category": "onboarding", "per_device": True, "required": True}, {"title": "Monitoring and alert validation", "description": "Validate alert routing, maintenance policy, backup monitoring, and critical notifications.", "priority": "high", "category": "monitoring", "required": True}, {"title": "Documentation and client handover", "description": "Complete operational documentation, key contacts, escalation paths, and client welcome handover.", "priority": "medium", "category": "documentation", "required": True}]},
]


def _fallback_pattern_draft(tokens, name_hint=""):
    title = name_hint or " ".join(str(token).title() for token in tokens[:2]) or "Recurring Issue"
    return {
        "name": f"{title} Triage", "description": f"A repeatable intake and resolution workflow for {title.lower()} issues.",
        "default_priority": "medium", "default_category": "support", "default_status": None, "sla_minutes": 480,
        "require_completion": False,
        "fields": _validate_fields([
            {"key": "affected_user", "label": "Affected user / device", "type": "text", "required": True, "placeholder": "User, device, or site"},
            {"key": "symptom", "label": "Observed symptom", "type": "textarea", "required": True, "placeholder": "What is happening and when?"},
            {"key": "error_message", "label": "Error message", "type": "textarea", "required": False, "placeholder": "Exact error or screenshot context"},
        ]),
        "checklist": _validate_checklist([
            {"label": "Confirm impact and affected scope", "required": True},
            {"label": "Review recent changes and relevant alerts", "required": True},
            {"label": "Apply or escalate the documented resolution", "required": True},
            {"label": "Record outcome and customer confirmation", "required": True},
        ]),
    }


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


def _validate_child_templates(items):
    """Validate the child-ticket plan stored on a blueprint.

    A child template may optionally reference another ticket blueprint.  When
    an onboarding plan is launched, that referenced worksheet/checklist is
    copied onto the child ticket, while the parent relationship remains part
    of the immutable ticket and onboarding audit trail.
    """
    out = []
    for item in (items or []):
        title = (item.get("title") or "").strip()
        if not title:
            continue
        priority = (item.get("priority") or "medium").strip().lower()
        if priority not in {"low", "medium", "high", "critical"}:
            priority = "medium"
        out.append({
            "id": item.get("id") or f"child-{uuid.uuid4().hex[:8]}",
            "title": title[:160],
            "description": (item.get("description") or "")[:1200],
            "priority": priority,
            "category": (item.get("category") or "onboarding")[:80],
            "blueprint_id": (item.get("blueprint_id") or "")[:80] or None,
            "per_device": bool(item.get("per_device", False)),
            "required": bool(item.get("required", True)),
        })
    return out


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ CRUD: Blueprints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        "child_templates": _validate_child_templates(data.get("child_templates")),
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
    if "child_templates" in data:
        patch["child_templates"] = _validate_child_templates(data["child_templates"])
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


@router.post("/blueprints/install-starter-library")
async def install_starter_library(current_user: dict = Depends(get_current_user)):
    """Install the curated MSP starter blueprints once; never overwrite local edits."""
    installed = []
    skipped = []
    for template in STARTER_BLUEPRINTS:
        existing = await db.blueprints.find_one({"name": template["name"]}, {"_id": 0, "id": 1})
        if existing:
            skipped.append(template["name"])
            continue
        doc = {
            "id": f"bp-{uuid.uuid4().hex[:10]}", "name": template["name"], "description": template["description"],
            "icon": "Clipboard", "color": "sky", "default_priority": template.get("default_priority"),
            "default_category": template.get("default_category"), "default_status": "open", "default_assignee_id": None,
            "sla_minutes": template.get("sla_minutes"), "require_completion": bool(template.get("require_completion")),
            "fields": _validate_fields(template.get("fields")), "checklist": _validate_checklist(template.get("checklist")),
            "child_templates": _validate_child_templates(template.get("child_templates")),
            "active": True, "created_at": datetime.now(timezone.utc).isoformat(), "created_by": current_user.get("name"), "starter_template": True,
        }
        await db.blueprints.insert_one(doc)
        installed.append(doc["name"])
    return {"success": True, "installed": installed, "skipped": skipped}


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Client linking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Ticket application â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    """Body: { fields: {key: value, ...} } â€” patch worksheet field values."""
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


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ AI: Suggest blueprint from history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/blueprints/suggest-from-history")
async def suggest_blueprint_from_history(data: dict, current_user: dict = Depends(get_current_user)):
    """Use Nexus AI to draft a blueprint from this client's resolved tickets.

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

    # Pull resolved/closed tickets for this client â€” match on title tokens to narrow scope
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
            f"#{t.get('ticket_number','')} [{t.get('priority','medium')}Â·{t.get('category','support')}] "
            f"{t.get('title','')}\n  Fix: {(t.get('resolution') or t.get('description') or '')[:400]}"
        )
    corpus = "\n\n".join(corpus_lines)

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {
            "draft": _fallback_pattern_draft(tokens, title_hint),
            "source_tickets": [{"id": t.get("id"), "ticket_number": t.get("ticket_number"), "title": t.get("title")} for t in matched[:12]],
            "ai_model": "NexusMSP fallback draft (AI not configured)",
        }

    system_msg = (
        "You are an MSP automation designer. Given a bundle of resolved support tickets of the "
        "same recurring type, produce a REUSABLE Ticket Blueprint that standardises handling. "
        "Return STRICT JSON only (no prose) with keys: "
        "name (short, title-case), description (1 sentence), default_priority "
        "(low|medium|high|critical), default_category (single word), sla_minutes (integer), "
        "require_completion (bool â€” true if tickets tend to have data-gathering up-front), "
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
        from app.services.ai_provider import LlmChat, UserMessage
        import uuid as _uuid
        chat = LlmChat(
            api_key=api_key,
            session_id=f"bp-suggest-{_uuid.uuid4().hex[:8]}",
            system_message=system_msg,
        ).with_model("openai", os.environ.get("NEXUS_AI_MODEL", "gpt-4o-mini"))
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
        "ai_model": os.environ.get("NEXUS_AI_MODEL", "gpt-4o-mini"),
    }


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Cross-client Pattern Library â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import re as _re
from collections import Counter as _Counter

_STOPWORDS = {
    "the", "and", "for", "with", "from", "that", "this", "have", "has", "not",
    "are", "was", "were", "but", "you", "your", "our", "their", "its", "his",
    "her", "been", "being", "will", "would", "could", "should", "into", "onto",
    "about", "over", "under", "test", "issue", "problem", "new", "need", "needs",
    "please", "help", "support", "ticket", "error", "failed", "failure", "unable",
}


def _tokens(text: str):
    return [t for t in _re.split(r"[^a-z0-9]+", (text or "").lower()) if len(t) >= 4 and t not in _STOPWORDS]


def _bigrams(tokens):
    return [(tokens[i], tokens[i + 1]) for i in range(len(tokens) - 1)]


@router.get("/blueprint-patterns")
async def detect_patterns(limit: int = 10, min_tickets: int = 3, current_user: dict = Depends(get_current_user)):
    """Mine resolved tickets ACROSS all clients for recurring issue patterns.

    Groups by top-scoring title bigrams so related tickets like "vpn connection",
    "vpn connectivity", "vpn drop" all bubble up as one pattern.
    """
    tix = await db.tickets.find(
        {"status": {"$in": ["resolved", "closed"]}},
        {"_id": 0, "id": 1, "title": 1, "category": 1, "client_id": 1, "client_name": 1, "ticket_number": 1, "resolved_at": 1}
    ).sort("resolved_at", -1).limit(3000).to_list(3000)

    # Score every bigram by the count of tickets it appears in
    bigram_tickets = {}  # bigram -> [ticket_ids]
    for t in tix:
        seen = set()
        for bg in _bigrams(_tokens(t.get("title", ""))):
            if bg in seen:
                continue
            seen.add(bg)
            bigram_tickets.setdefault(bg, []).append(t)

    # Rank patterns; collapse bigrams that share a ticket pool >70% into the top bigram
    ranked = sorted(bigram_tickets.items(), key=lambda kv: -len(kv[1]))
    patterns = []
    used_ticket_ids = set()
    existing_bps = await db.blueprints.find({"active": True}, {"_id": 0, "id": 1, "name": 1}).to_list(200)

    for bg, tickets in ranked:
        if len(tickets) < min_tickets:
            continue
        ids = {t["id"] for t in tickets}
        # Skip if >60% of these tickets already got assigned to a stronger pattern
        overlap = len(ids & used_ticket_ids) / max(1, len(ids))
        if overlap > 0.6:
            continue
        used_ticket_ids |= ids
        clients = {t.get("client_id") for t in tickets if t.get("client_id")}
        categories = _Counter(t.get("category") for t in tickets if t.get("category"))
        pattern_key = f"{bg[0]}_{bg[1]}"
        name_guess = f"{bg[0].title()} {bg[1].title()}"
        # Find any existing blueprint that looks related
        related = [
            bp for bp in existing_bps
            if bg[0] in bp["name"].lower() or bg[1] in bp["name"].lower()
        ][:3]
        patterns.append({
            "key": pattern_key,
            "name_guess": name_guess,
            "tokens": list(bg),
            "ticket_count": len(tickets),
            "client_count": len(clients),
            "top_category": categories.most_common(1)[0][0] if categories else None,
            "sample_titles": [t["title"] for t in tickets[:5]],
            "sample_ticket_ids": [t["id"] for t in tickets[:20]],
            "related_blueprints": related,
            "affected_client_ids": list(clients),
        })
        if len(patterns) >= limit:
            break

    return {
        "patterns": patterns,
        "total_scanned": len(tix),
        "window": "all resolved/closed tickets",
    }


@router.post("/blueprint-patterns/suggest")
async def suggest_from_pattern(data: dict, current_user: dict = Depends(get_current_user)):
    """Draft a blueprint from a detected cross-client pattern.
    Body: { tokens: [str,str], sample_ticket_ids?: [ids] }
    """
    import os as _os
    import json as _json

    tokens = data.get("tokens") or []
    ids = data.get("sample_ticket_ids") or []
    if len(tokens) < 2 and not ids:
        raise HTTPException(400, "tokens (2) or sample_ticket_ids required")

    if ids:
        tix = await db.tickets.find(
            {"id": {"$in": ids}},
            {"_id": 0, "id": 1, "title": 1, "description": 1, "resolution": 1, "category": 1, "priority": 1, "ticket_number": 1, "client_name": 1}
        ).to_list(50)
    else:
        # Re-query by tokens on title
        regexes = [{"title": {"$regex": tok, "$options": "i"}} for tok in tokens]
        tix = await db.tickets.find(
            {"status": {"$in": ["resolved", "closed"]}, "$and": regexes},
            {"_id": 0, "id": 1, "title": 1, "description": 1, "resolution": 1, "category": 1, "priority": 1, "ticket_number": 1, "client_name": 1}
        ).sort("resolved_at", -1).limit(25).to_list(25)

    if len(tix) < 2:
        raise HTTPException(400, "Not enough matching tickets to learn from")

    corpus = "\n\n".join([
        f"#{t.get('ticket_number','')} ({t.get('client_name','')}) [{t.get('priority','medium')}Â·{t.get('category','support')}] "
        f"{t.get('title','')}\n  Fix: {(t.get('resolution') or t.get('description') or '')[:400]}"
        for t in tix[:15]
    ])

    api_key = _os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {
            "draft": _fallback_pattern_draft(tokens),
            "source_tickets": [{"id": t["id"], "ticket_number": t.get("ticket_number"), "title": t.get("title"), "client_name": t.get("client_name")} for t in tix[:15]],
            "ai_model": "NexusMSP fallback draft (AI not configured)",
        }

    system_msg = (
        "You design shared ticket blueprints for an MSP serving many clients. Given a corpus of "
        "resolved tickets from MULTIPLE CLIENTS that all share a common theme, produce a REUSABLE "
        "Ticket Blueprint that will work across all of them. Return STRICT JSON only with: "
        "name (title-case, short), description (1 sentence explaining why this blueprint exists), "
        "default_priority (low|medium|high|critical), default_category, sla_minutes (int), "
        "require_completion (bool), "
        "fields (array of {key (snake_case), label, type "
        "(text|textarea|number|date|select|checkbox), required, placeholder, options?}), "
        "checklist (array of {label, required}). "
        "Prefer fields/checklist items that are TENANT-AGNOSTIC (usable for any client). "
        "3-6 fields, 4-8 checklist items."
    )
    user_msg = (
        f"Cross-client resolved tickets (theme: {' '.join(tokens)}):\n\n{corpus}\n\n"
        "Return only the JSON."
    )

    try:
        from app.services.ai_provider import LlmChat, UserMessage
        import uuid as _uuid
        chat = LlmChat(
            api_key=api_key,
            session_id=f"bp-pattern-{_uuid.uuid4().hex[:8]}",
            system_message=system_msg,
        ).with_model("openai", os.environ.get("NEXUS_AI_MODEL", "gpt-4o-mini"))
        raw = await chat.send_message(UserMessage(text=user_msg))
        text = raw.strip() if isinstance(raw, str) else str(raw)
    except Exception as e:
        raise HTTPException(502, f"AI call failed: {str(e)[:160]}")

    m = _re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise HTTPException(502, "AI did not return JSON")
    try:
        draft = _json.loads(m.group(0))
    except Exception:
        raise HTTPException(502, "AI returned invalid JSON")

    safe = {
        "name": str(draft.get("name") or f"{' '.join(tokens).title()} Blueprint")[:120],
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
        "source_tickets": [{"id": t["id"], "ticket_number": t.get("ticket_number"), "title": t.get("title"), "client_name": t.get("client_name")} for t in tix[:15]],
        "ai_model": os.environ.get("NEXUS_AI_MODEL", "gpt-4o-mini"),
    }


@router.post("/blueprints/{bp_id}/push-to-clients")
async def push_blueprint_to_clients(bp_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Add blueprint to the assigned-list of multiple clients at once.
    Body: { client_ids: [str], make_default?: bool }
    """
    bp = await db.blueprints.find_one({"id": bp_id, "active": True}, {"_id": 0, "id": 1, "name": 1})
    if not bp:
        raise HTTPException(404, "Blueprint not found")
    client_ids = data.get("client_ids") or []
    if not client_ids:
        raise HTTPException(400, "client_ids required")
    make_default = bool(data.get("make_default", False))

    updated = 0
    for cid in client_ids:
        client = await db.clients.find_one({"id": cid}, {"_id": 0, "id": 1, "blueprint_ids": 1, "default_blueprint_id": 1})
        if client is None:
            continue
        bp_ids = list({*(client.get("blueprint_ids") or []), bp_id})
        patch = {"blueprint_ids": bp_ids}
        if make_default:
            patch["default_blueprint_id"] = bp_id
        res = await db.clients.update_one({"id": cid}, {"$set": patch})
        if res.matched_count:
            updated += 1

    return {"success": True, "updated": updated, "blueprint": bp["name"]}


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Trending patterns (dashboard tile) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

from datetime import timedelta as _td


@router.get("/blueprint-patterns/trends")
async def pattern_trends(days: int = 7, current_user: dict = Depends(get_current_user)):
    """Compare resolved-ticket patterns between THIS window and the PREVIOUS window.
    Returns top 3 'rising' patterns â€” surges or brand-new patterns.

    Output per pattern:
      { key, name_guess, tokens, ticket_count_this, ticket_count_prev,
        client_count_this, delta, is_new, sample_titles, sample_ticket_ids, affected_client_ids }
    """
    now = datetime.now(timezone.utc)
    days = max(1, min(60, days))
    this_start = (now - _td(days=days)).isoformat()
    prev_start = (now - _td(days=days * 2)).isoformat()

    def _score_tix(tickets):
        pool = {}
        for t in tickets:
            seen = set()
            for bg in _bigrams(_tokens(t.get("title", ""))):
                if bg in seen:
                    continue
                seen.add(bg)
                pool.setdefault(bg, []).append(t)
        return pool

    this_tix = await db.tickets.find(
        {
            "status": {"$in": ["resolved", "closed"]},
            "$or": [
                {"resolved_at": {"$gte": this_start}},
                {"resolved_at": None, "updated_at": {"$gte": this_start}},
            ],
        },
        {"_id": 0, "id": 1, "title": 1, "client_id": 1, "client_name": 1, "ticket_number": 1}
    ).limit(2000).to_list(2000)

    prev_tix = await db.tickets.find(
        {
            "status": {"$in": ["resolved", "closed"]},
            "$or": [
                {"resolved_at": {"$gte": prev_start, "$lt": this_start}},
                {"resolved_at": None, "updated_at": {"$gte": prev_start, "$lt": this_start}},
            ],
        },
        {"_id": 0, "id": 1, "title": 1}
    ).limit(2000).to_list(2000)

    this_pool = _score_tix(this_tix)
    prev_pool = _score_tix(prev_tix)

    rising = []
    for bg, tickets in this_pool.items():
        if len(tickets) < 2:
            continue
        prev_count = len(prev_pool.get(bg, []))
        this_count = len(tickets)
        delta = this_count - prev_count
        is_new = prev_count == 0
        # Score: surge % with bonus for new patterns
        score = (this_count * 1.5 if is_new else delta) + this_count * 0.5
        if score <= 0:
            continue
        clients = {t.get("client_id") for t in tickets if t.get("client_id")}
        rising.append({
            "key": f"{bg[0]}_{bg[1]}",
            "tokens": list(bg),
            "name_guess": f"{bg[0].title()} {bg[1].title()}",
            "ticket_count_this": this_count,
            "ticket_count_prev": prev_count,
            "client_count_this": len(clients),
            "delta": delta,
            "is_new": is_new,
            "score": score,
            "sample_titles": [t["title"] for t in tickets[:3]],
            "sample_ticket_ids": [t["id"] for t in tickets[:20]],
            "affected_client_ids": list(clients),
        })

    rising.sort(key=lambda r: -r["score"])
    return {
        "rising": rising[:3],
        "window_days": days,
        "this_total": len(this_tix),
        "prev_total": len(prev_tix),
    }
