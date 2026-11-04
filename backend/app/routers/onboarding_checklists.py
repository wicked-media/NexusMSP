"""Technician onboarding checklists: customisable templates and runs.

Templates are hugely customisable, tenant-owned checklist definitions that can
be hooked to Nexus services (stable service ids plus free-form service tags)
so onboarding work tied to a service never gets missed.  Runs are the
technician-facing instances that track per-item completion and evidence.

Routes stay thin: validation and transition policy live in
``app.services.onboarding_checklists``.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.onboarding_checklists import (
    apply_item_update,
    build_run_document,
    build_template_document,
)
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

router = APIRouter()


def _public(doc: dict) -> dict:
    return {key: value for key, value in doc.items() if key != "_id"}


async def _template_or_404(template_id: str, current_user: dict) -> dict:
    template = await db.onboarding_checklist_templates.find_one(
        tenant_scoped_query(current_user, {"id": template_id}), {"_id": 0}
    )
    if not template:
        raise HTTPException(status_code=404, detail="Checklist template not found")
    return template


# ============== TEMPLATES ==============


@router.get("/onboarding-checklists/templates")
async def list_checklist_templates(
    service_id: str | None = None,
    category: str | None = None,
    include_archived: bool = False,
    current_user: dict = Depends(get_current_user),
):
    """List this tenant's checklist templates, optionally filtered by service hook."""
    query: dict = {}
    if service_id:
        query["service_ids"] = service_id
    if category:
        query["category"] = category
    if not include_archived:
        query["status"] = "active"
    templates = await db.onboarding_checklist_templates.find(
        tenant_scoped_query(current_user, query), {"_id": 0}
    ).sort("name", 1).to_list(200)
    return templates


@router.post("/onboarding-checklists/templates")
async def create_checklist_template(data: dict, current_user: dict = Depends(get_current_user)):
    """Create a fully custom checklist template."""
    document = build_template_document(
        data, tenant_id=platform_tenant_id(current_user), actor=current_user
    )
    await db.onboarding_checklist_templates.insert_one(document)
    document.pop("_id", None)
    await log_activity(
        current_user, "created", "onboarding_checklist_template", document["id"],
        document["name"], "Created an onboarding checklist template",
        metadata={"items": len(document["items"]), "service_ids": document["service_ids"]},
    )
    return document


@router.get("/onboarding-checklists/templates/{template_id}")
async def get_checklist_template(template_id: str, current_user: dict = Depends(get_current_user)):
    return await _template_or_404(template_id, current_user)


@router.put("/onboarding-checklists/templates/{template_id}")
async def update_checklist_template(
    template_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    """Update a template. Item/section changes bump the template version."""
    existing = await _template_or_404(template_id, current_user)
    candidate = dict(existing)
    candidate.update({key: value for key, value in data.items() if key in {
        "name", "description", "category", "service_ids", "service_tags", "sections", "items",
    }})
    validated = build_template_document(
        {
            "name": candidate.get("name"),
            "description": candidate.get("description"),
            "category": candidate.get("category"),
            "service_ids": candidate.get("service_ids"),
            "service_tags": candidate.get("service_tags"),
            "sections": candidate.get("sections"),
            "items": candidate.get("items"),
        },
        tenant_id=platform_tenant_id(current_user),
        actor=current_user,
    )
    items_changed = validated["items"] != existing.get("items")
    patch = {
        "name": validated["name"],
        "description": validated["description"],
        "category": validated["category"],
        "service_ids": validated["service_ids"],
        "service_tags": validated["service_tags"],
        "sections": validated["sections"],
        "items": validated["items"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if items_changed:
        patch["version"] = int(existing.get("version", 1)) + 1
    await db.onboarding_checklist_templates.update_one(
        tenant_scoped_query(current_user, {"id": template_id}), {"$set": patch}
    )
    updated = await _template_or_404(template_id, current_user)
    await log_activity(
        current_user, "updated", "onboarding_checklist_template", template_id,
        updated["name"], "Updated an onboarding checklist template",
        metadata={"version": updated["version"]},
    )
    return updated


@router.delete("/onboarding-checklists/templates/{template_id}")
async def archive_checklist_template(
    template_id: str, current_user: dict = Depends(get_current_user)
):
    """Archive (never hard-delete) a template so existing runs keep their snapshot."""
    existing = await _template_or_404(template_id, current_user)
    await db.onboarding_checklist_templates.update_one(
        tenant_scoped_query(current_user, {"id": template_id}),
        {"$set": {"status": "archived", "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    await log_activity(
        current_user, "archived", "onboarding_checklist_template", template_id,
        existing["name"], "Archived an onboarding checklist template",
    )
    return {"message": "Checklist template archived"}


@router.post("/onboarding-checklists/templates/{template_id}/duplicate")
async def duplicate_checklist_template(
    template_id: str, current_user: dict = Depends(get_current_user)
):
    existing = await _template_or_404(template_id, current_user)
    payload = {
        "name": f"{existing['name']} (copy)",
        "description": existing.get("description", ""),
        "category": existing.get("category", "custom"),
        "service_ids": existing.get("service_ids", []),
        "service_tags": existing.get("service_tags", []),
        "sections": existing.get("sections", []),
        "items": existing.get("items", []),
    }
    document = build_template_document(
        payload, tenant_id=platform_tenant_id(current_user), actor=current_user
    )
    await db.onboarding_checklist_templates.insert_one(document)
    document.pop("_id", None)
    await log_activity(
        current_user, "created", "onboarding_checklist_template", document["id"],
        document["name"], "Duplicated an onboarding checklist template",
        metadata={"source_template_id": template_id},
    )
    return document


# ============== SERVICE HOOKS ==============


@router.get("/onboarding-checklists/service-coverage")
async def checklist_service_coverage(current_user: dict = Depends(get_current_user)):
    """Summarise which service hooks have checklists attached.

    This is the "nothing gets missed" view: services with zero active
    templates stand out so admins can close the gap.
    """
    templates = await db.onboarding_checklist_templates.find(
        tenant_scoped_query(current_user, {"status": "active"}), {"_id": 0}
    ).to_list(200)
    tiers = await db.service_tiers.find({}, {"_id": 0, "id": 1, "name": 1}).sort("sort_order", 1).to_list(100)
    hooked: dict[str, int] = {}
    for template in templates:
        for service_id in template.get("service_ids", []):
            hooked[service_id] = hooked.get(service_id, 0) + 1
    return {
        "services": [
            {
                "service_id": tier.get("id"),
                "service_name": tier.get("name", ""),
                "template_count": hooked.get(tier.get("id"), 0),
                "covered": hooked.get(tier.get("id"), 0) > 0,
            }
            for tier in tiers
        ],
        "uncovered_service_ids": [
            tier.get("id") for tier in tiers if hooked.get(tier.get("id"), 0) == 0
        ],
        "tag_only_templates": [
            {"id": t["id"], "name": t["name"], "service_tags": t.get("service_tags", [])}
            for t in templates
            if t.get("service_tags") and not t.get("service_ids")
        ],
    }


# ============== RUNS ==============


@router.get("/onboarding-checklists/runs")
async def list_checklist_runs(
    technician_id: str | None = None,
    status: str | None = None,
    template_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    query: dict = {}
    if technician_id:
        query["technician_id"] = technician_id
    if status:
        query["status"] = status
    if template_id:
        query["template_id"] = template_id
    runs = await db.onboarding_checklist_runs.find(
        tenant_scoped_query(current_user, query), {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return runs


@router.post("/onboarding-checklists/runs")
async def launch_checklist_run(data: dict, current_user: dict = Depends(get_current_user)):
    """Launch a run from a template for a technician (optionally tied to a client/service)."""
    template_id = str(data.get("template_id") or "").strip()
    if not template_id:
        raise HTTPException(status_code=400, detail="template_id is required")
    template = await _template_or_404(template_id, current_user)
    if template.get("status") != "active":
        raise HTTPException(status_code=400, detail="Cannot launch a run from an archived template")
    document = build_run_document(
        template, tenant_id=platform_tenant_id(current_user), actor=current_user, payload=data
    )
    await db.onboarding_checklist_runs.insert_one(document)
    document.pop("_id", None)
    await db.onboarding_checklist_templates.update_one(
        tenant_scoped_query(current_user, {"id": template_id}), {"$inc": {"usage_count": 1}}
    )
    await log_activity(
        current_user, "created", "onboarding_checklist_run", document["id"],
        document["template_name"], "Launched an onboarding checklist run",
        metadata={
            "template_id": template_id,
            "technician_id": document.get("technician_id"),
            "client_id": document.get("client_id"),
        },
    )
    return document


async def _run_or_404(run_id: str, current_user: dict) -> dict:
    run = await db.onboarding_checklist_runs.find_one(
        tenant_scoped_query(current_user, {"id": run_id}), {"_id": 0}
    )
    if not run:
        raise HTTPException(status_code=404, detail="Checklist run not found")
    return run


@router.get("/onboarding-checklists/runs/{run_id}")
async def get_checklist_run(run_id: str, current_user: dict = Depends(get_current_user)):
    return await _run_or_404(run_id, current_user)


@router.post("/onboarding-checklists/runs/{run_id}/items/{item_id}")
async def update_checklist_run_item(
    run_id: str,
    item_id: str,
    data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Update one item's completion state, notes and evidence."""
    run = await _run_or_404(run_id, current_user)
    if run.get("status") == "archived":
        raise HTTPException(status_code=400, detail="This run is archived")
    updated = apply_item_update(run, item_id, data, actor=current_user)
    await db.onboarding_checklist_runs.update_one(
        tenant_scoped_query(current_user, {"id": run_id}),
        {"$set": {"items": updated["items"], "progress": updated["progress"],
                  "status": updated["status"], "audit": updated["audit"],
                  "started_at": updated.get("started_at"),
                  "completed_at": updated.get("completed_at"),
                  "updated_at": updated["updated_at"]}},
    )
    updated.pop("_id", None)
    return updated


@router.post("/onboarding-checklists/runs/{run_id}/reassign")
async def reassign_checklist_run(
    run_id: str, data: dict, current_user: dict = Depends(get_current_user)
):
    run = await _run_or_404(run_id, current_user)
    technician_id = str(data.get("technician_id") or "").strip()
    if not technician_id:
        raise HTTPException(status_code=400, detail="technician_id is required")
    now = datetime.now(timezone.utc).isoformat()
    run["audit"] = run.get("audit", []) + [{
        "action": "run_reassigned",
        "from_technician_id": run.get("technician_id"),
        "to_technician_id": technician_id,
        "by": current_user.get("id"),
        "by_name": current_user.get("name") or current_user.get("email") or "",
        "at": now,
    }]
    await db.onboarding_checklist_runs.update_one(
        tenant_scoped_query(current_user, {"id": run_id}),
        {"$set": {"technician_id": technician_id,
                  "technician_name": str(data.get("technician_name") or "")[:200],
                  "audit": run["audit"], "updated_at": now}},
    )
    return await _run_or_404(run_id, current_user)
