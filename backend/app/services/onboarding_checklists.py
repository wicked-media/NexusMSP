"""Domain policy for technician onboarding checklist templates and runs.

Checklist templates are tenant-owned, fully customisable definitions whose
items are validated and normalised here rather than in route handlers.  A
template can be hooked to Nexus services so that a service engagement always
carries the right checklist.  A run is the technician-facing instance that
tracks each item's completion state and evidence.

All policy functions are pure so they can be contract-tested without a
database.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

ITEM_TYPES = frozenset({
    "checkbox",
    "text",
    "note",
    "link",
    "upload",
    "equipment",
    "training",
    "document",
    "signoff",
    "account",
})

ITEM_STATUSES = frozenset({"pending", "in_progress", "completed", "skipped"})
RUN_STATUSES = frozenset({"not_started", "in_progress", "completed", "blocked", "archived"})
VERIFICATION_MODES = frozenset({"self", "peer", "manager", "none"})
TEMPLATE_STATUSES = frozenset({"active", "archived"})

MAX_ITEMS_PER_TEMPLATE = 200
MAX_SECTIONS_PER_TEMPLATE = 40


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalise_sections(raw: Any) -> list[dict[str, Any]]:
    """Normalise optional template sections; unknown shapes are rejected."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="sections must be a list")
    if len(raw) > MAX_SECTIONS_PER_TEMPLATE:
        raise HTTPException(status_code=400, detail=f"sections limit is {MAX_SECTIONS_PER_TEMPLATE}")
    sections: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise HTTPException(status_code=400, detail="each section must be an object")
        title = str(entry.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="each section needs a title")
        section_id = str(entry.get("id") or "").strip() or f"sec-{uuid.uuid4().hex[:8]}"
        if section_id in seen:
            raise HTTPException(status_code=400, detail=f"duplicate section id {section_id}")
        seen.add(section_id)
        sections.append({
            "id": section_id,
            "title": title[:160],
            "description": str(entry.get("description") or "")[:1000],
            "position": index,
        })
    return sections


def normalise_item(raw: Any, position: int) -> dict[str, Any]:
    """Validate and normalise a single checklist item definition."""
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="each checklist item must be an object")
    title = str(raw.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="each checklist item needs a title")

    item_type = str(raw.get("type") or "checkbox").strip().lower() or "checkbox"
    if item_type not in ITEM_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"item type must be one of: {', '.join(sorted(ITEM_TYPES))}",
        )

    verification = str(raw.get("verification") or "self").strip().lower() or "self"
    if verification not in VERIFICATION_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"verification must be one of: {', '.join(sorted(VERIFICATION_MODES))}",
        )

    section_id = raw.get("section_id")
    options = raw.get("options")
    if options is not None and not isinstance(options, list):
        raise HTTPException(status_code=400, detail="item options must be a list")

    try:
        points = int(raw.get("points") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="item points must be an integer")
    points = max(0, min(points, 10_000))

    try:
        due_offset_days = raw.get("due_offset_days")
        due_offset_days = int(due_offset_days) if due_offset_days not in (None, "") else None
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="due_offset_days must be an integer")

    return {
        "id": str(raw.get("id") or "").strip() or f"item-{uuid.uuid4().hex[:10]}",
        "title": title[:300],
        "description": str(raw.get("description") or "")[:2000],
        "type": item_type,
        "required": bool(raw.get("required", True)),
        "section_id": str(section_id) if section_id else None,
        "position": position,
        "verification": verification,
        "evidence_required": bool(raw.get("evidence_required", False)),
        "due_offset_days": due_offset_days,
        "assignee_role": str(raw.get("assignee_role") or "technician").strip()[:60] or "technician",
        "points": points,
        "options": [str(option)[:200] for option in (options or [])][:50],
    }


def normalise_items(raw: Any) -> list[dict[str, Any]]:
    """Validate the full ordered item list of a template."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="items must be a list")
    if len(raw) > MAX_ITEMS_PER_TEMPLATE:
        raise HTTPException(status_code=400, detail=f"items limit is {MAX_ITEMS_PER_TEMPLATE}")
    items = [normalise_item(entry, position) for position, entry in enumerate(raw)]
    seen: set[str] = set()
    for item in items:
        if item["id"] in seen:
            raise HTTPException(status_code=400, detail=f"duplicate item id {item['id']}")
        seen.add(item["id"])
    return items


def normalise_service_hooks(raw: Any) -> tuple[list[str], list[str]]:
    """Normalise the service hooks that bind a template to delivered services.

    ``service_ids`` reference stable Nexus service identifiers (service tier
    ids, subscription ids); ``service_tags`` are free-form labels for services
    without a dedicated record.  Names are never used as relationship keys.
    """
    def _ids(value: Any) -> list[str]:
        if not isinstance(value, (list, tuple, set, frozenset)):
            return []
        return sorted({str(item).strip() for item in value if str(item or "").strip()})[:100]

    return _ids(raw.get("service_ids")), _ids(raw.get("service_tags"))


def build_template_document(payload: dict[str, Any], *, tenant_id: str, actor: dict[str, Any]) -> dict[str, Any]:
    """Build a validated template document ready for persistence."""
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="checklist template name is required")
    service_ids, service_tags = normalise_service_hooks(payload)
    sections = normalise_sections(payload.get("sections"))
    items = normalise_items(payload.get("items"))
    section_ids = {section["id"] for section in sections}
    for item in items:
        if item["section_id"] and item["section_id"] not in section_ids:
            raise HTTPException(status_code=400, detail=f"item {item['id']} references unknown section")
    now = _now()
    return {
        "id": f"chk-{uuid.uuid4().hex[:10]}",
        "tenant_id": tenant_id,
        "name": name[:200],
        "description": str(payload.get("description") or "")[:4000],
        "category": str(payload.get("category") or "custom").strip()[:60] or "custom",
        "status": "active",
        "version": 1,
        "service_ids": service_ids,
        "service_tags": service_tags,
        "sections": sections,
        "items": items,
        "usage_count": 0,
        "created_by": actor.get("id"),
        "created_by_name": actor.get("name") or actor.get("email") or "",
        "created_at": now,
        "updated_at": now,
    }


def template_view(doc: dict[str, Any]) -> dict[str, Any]:
    """Public projection of a template document."""
    return {key: value for key, value in doc.items() if key != "_id"}


def build_run_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Snapshot template items into per-run completion state."""
    return [{
        "item_id": item["id"],
        "title": item["title"],
        "description": item.get("description", ""),
        "type": item.get("type", "checkbox"),
        "required": bool(item.get("required", True)),
        "section_id": item.get("section_id"),
        "verification": item.get("verification", "self"),
        "evidence_required": bool(item.get("evidence_required", False)),
        "points": int(item.get("points") or 0),
        "status": "pending",
        "notes": "",
        "evidence": None,
        "completed_by": None,
        "completed_by_name": None,
        "completed_at": None,
    } for item in items]


def compute_run_progress(items: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute completion progress for a run's item states."""
    total = len(items)
    required = sum(1 for item in items if item.get("required"))
    completed = sum(1 for item in items if item.get("status") == "completed")
    completed_required = sum(
        1 for item in items if item.get("required") and item.get("status") == "completed"
    )
    skipped_required = sum(
        1 for item in items if item.get("required") and item.get("status") == "skipped"
    )
    percent = round((completed / total) * 100, 1) if total else 0.0
    return {
        "total": total,
        "required": required,
        "completed": completed,
        "completed_required": completed_required,
        "skipped_required": skipped_required,
        "percent": percent,
    }


def run_status_for_progress(progress: dict[str, Any]) -> str:
    """Derive the run status from item progress.

    A run only becomes ``completed`` when every required item is completed;
    required items that were skipped leave the run ``blocked`` so nothing
    required gets silently missed.
    """
    if progress["total"] == 0:
        return "completed"
    if progress["skipped_required"] > 0 and progress["completed_required"] < progress["required"]:
        return "blocked"
    if progress["completed_required"] >= progress["required"] and progress["required"] > 0:
        return "completed"
    if progress["completed"] > 0:
        return "in_progress"
    return "not_started"


def build_run_document(
    template: dict[str, Any],
    *,
    tenant_id: str,
    actor: dict[str, Any],
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a run document snapshotting the template's items."""
    payload = payload or {}
    now = _now()
    items = build_run_items(template.get("items") or [])
    progress = compute_run_progress(items)
    return {
        "id": f"run-{uuid.uuid4().hex[:10]}",
        "tenant_id": tenant_id,
        "template_id": template["id"],
        "template_name": template.get("name", ""),
        "template_version": template.get("version", 1),
        "technician_id": str(payload.get("technician_id") or "").strip() or None,
        "technician_name": str(payload.get("technician_name") or "").strip()[:200],
        "client_id": str(payload.get("client_id") or "").strip() or None,
        "service_ids": normalise_service_hooks(payload)[0],
        "status": "not_started",
        "items": items,
        "progress": progress,
        "audit": [{
            "action": "run_created",
            "by": actor.get("id"),
            "by_name": actor.get("name") or actor.get("email") or "",
            "at": now,
        }],
        "created_by": actor.get("id"),
        "created_by_name": actor.get("name") or actor.get("email") or "",
        "created_at": now,
        "updated_at": now,
        "started_at": None,
        "completed_at": None,
    }


def apply_item_update(
    run: dict[str, Any],
    item_id: str,
    update: dict[str, Any],
    *,
    actor: dict[str, Any],
) -> dict[str, Any]:
    """Apply a completion/update to one run item and refresh run progress.

    Only the fields a technician may change are accepted.  Evidence is
    required when the item demands it before it can be marked completed.
    """
    target = next((item for item in run["items"] if item["item_id"] == item_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Checklist item not found on this run")

    status = str(update.get("status") or target.get("status") or "pending").strip().lower()
    if status not in ITEM_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"item status must be one of: {', '.join(sorted(ITEM_STATUSES))}",
        )

    evidence = update.get("evidence", target.get("evidence"))
    if evidence is not None and not isinstance(evidence, dict):
        raise HTTPException(status_code=400, detail="evidence must be an object")

    if status == "completed":
        if target.get("evidence_required") and not (evidence or {}).get("value"):
            raise HTTPException(status_code=400, detail="This item requires evidence before completion")
        if target.get("verification") == "manager" and not actor.get("id"):
            raise HTTPException(status_code=400, detail="Manager-verified items need an authenticated actor")

    target["status"] = status
    target["notes"] = str(update.get("notes") or target.get("notes") or "")[:4000]
    target["evidence"] = evidence
    if status == "completed":
        now = _now()
        target["completed_by"] = actor.get("id")
        target["completed_by_name"] = actor.get("name") or actor.get("email") or ""
        target["completed_at"] = now
    else:
        target["completed_by"] = None
        target["completed_by_name"] = None
        target["completed_at"] = None

    progress = compute_run_progress(run["items"])
    run["progress"] = progress
    run["status"] = run_status_for_progress(progress)
    now = _now()
    run["updated_at"] = now
    if run["status"] == "in_progress" and not run.get("started_at"):
        run["started_at"] = now
    if run["status"] == "completed":
        run["completed_at"] = run.get("completed_at") or now
    run.setdefault("audit", []).append({
        "action": f"item_{status}",
        "item_id": item_id,
        "by": actor.get("id"),
        "by_name": actor.get("name") or actor.get("email") or "",
        "at": now,
    })
    return run
