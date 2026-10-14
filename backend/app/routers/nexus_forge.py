"""Nexus Forge routes — design requests grounded in the API this Nexus actually serves.

A Forge request is a **specification**, never generated code and never a
deployment. Forge resolves every capability the request declares against the
routes served by the running application, runs the checks in
`app.services.nexus_forge`, and holds the result behind a human review. Only an
approved and verified design can record a version, and a recorded version is a
governance record.

Everything is tenant-scoped, nothing here executes on an endpoint, and no request
can ask Nexus for privilege a person does not already hold.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.nexus_flow import contains_credential_material
from app.services.nexus_forge import (
    FORGE_TOOL_KINDS,
    MAX_CAPABILITY_REF,
    TOOL_KIND_MEANING,
    build_catalogue,
    filter_catalogue,
    forge_spec_checks,
    tool_publish_gate,
    verdict_reason,
)
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

router = APIRouter(tags=["Nexus Forge"])

_MAX_TEXT = 600
_MAX_NOTE = 500
_MAX_ROWS = 200
_MAX_REFS = 60
_MAX_LIST_ITEMS = 12

BOUNDARY = (
    "Forge requests a technical design. It does not generate or deploy executable code, hold production "
    "credentials, or execute privileged actions: a design composes capabilities the Nexus API already serves, "
    "and only a person can approve it."
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _actor(current_user: dict[str, Any]) -> str:
    return str(current_user.get("id") or current_user.get("email") or "Nexus operator")


def _actor_name(current_user: dict[str, Any]) -> str:
    return str(current_user.get("name") or current_user.get("email") or "Nexus operator")


def _clean_text(
    value: Any,
    *,
    field: str,
    minimum: int = 1,
    maximum: int = _MAX_TEXT,
) -> str:
    text = str(value or "").strip()
    if len(text) < minimum:
        raise HTTPException(status_code=422, detail=f"{field} needs at least {minimum} characters")
    if len(text) > maximum:
        raise HTTPException(status_code=422, detail=f"{field} is limited to {maximum} characters")
    if contains_credential_material(text):
        raise HTTPException(
            status_code=422,
            detail=f"{field} stores references only; credential material is never accepted",
        )
    return text


def _clean_text_list(value: Any, *, field: str, maximum: int = 200) -> list[str]:
    items = [str(item or "").strip() for item in (value or []) if str(item or "").strip()]
    if len(items) > _MAX_LIST_ITEMS:
        raise HTTPException(status_code=422, detail=f"{field} accepts at most {_MAX_LIST_ITEMS} entries")
    cleaned: list[str] = []
    for item in items:
        text = item[:maximum]
        if contains_credential_material(text):
            raise HTTPException(
                status_code=422,
                detail=f"{field} stores references only; credential material is never accepted",
            )
        cleaned.append(text)
    return cleaned


def _served_catalogue(request: Request) -> list[dict[str, Any]]:
    """The routes the running application actually serves, as composable capabilities."""
    routes: list[tuple[str, Any]] = []
    for route in getattr(request.app, "routes", []) or []:
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        if not path or not methods:
            continue
        routes.append((path, methods))
    return build_catalogue(routes)


def _public_request(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "title": row.get("title"),
        "intent": row.get("intent"),
        "kind": row.get("kind"),
        "expected_outcome": row.get("expected_outcome"),
        "capability_refs": row.get("capability_refs") or [],
        "capabilities": row.get("capabilities") or [],
        "unresolved_capabilities": row.get("unresolved_capabilities") or [],
        "scope": row.get("scope") or {},
        "sandbox_plan": row.get("sandbox_plan"),
        "tests": row.get("tests") or [],
        "verification": row.get("verification"),
        "rollback": row.get("rollback"),
        "review_interval_days": row.get("review_interval_days"),
        "checks": row.get("checks") or [],
        "verdict": row.get("verdict"),
        "verdict_reason": row.get("verdict_reason"),
        "stage": row.get("stage"),
        "review_history": row.get("review_history") or [],
        "versions": row.get("versions") or [],
        "created_at": row.get("created_at"),
        "created_by": row.get("created_by"),
    }


async def _load_request(current_user: dict[str, Any], request_id: str) -> dict[str, Any]:
    clean_id = str(request_id or "").strip()
    if not clean_id:
        raise HTTPException(status_code=422, detail="A design request ID is required")
    row = await db.nexus_forge_requests.find_one(
        tenant_scoped_query(current_user, {"id": clean_id}), {"_id": 0}
    )
    if not row:
        raise HTTPException(status_code=404, detail="Design request not found")
    return row


async def _published_tools(current_user: dict[str, Any]) -> list[dict[str, Any]]:
    rows = await db.nexus_forge_requests.find(
        tenant_scoped_query(current_user, {"stage": "published"}),
        {"_id": 0, "id": 1, "title": 1, "capabilities": 1, "versions": 1},
    ).to_list(_MAX_ROWS)
    tools: list[dict[str, Any]] = []
    for row in rows:
        versions = row.get("versions") or []
        latest = versions[-1] if versions else {}
        interval = int(latest.get("review_interval_days") or 0)
        next_review = None
        if interval and latest.get("published_at"):
            try:
                published = datetime.fromisoformat(str(latest["published_at"]))
                if published.tzinfo is None:
                    published = published.replace(tzinfo=timezone.utc)
                next_review = (published + timedelta(days=interval)).isoformat()
            except ValueError:
                next_review = None
        tools.append(
            {
                "request_id": row.get("id"),
                "name": row.get("title"),
                "capabilities": [
                    str(item.get("id") or "") for item in (row.get("capabilities") or []) if isinstance(item, dict)
                ],
                "version_count": len(versions),
                "latest_version": latest.get("version"),
                "review_interval_days": interval,
                "next_review_at": next_review,
                "review_due": bool(next_review and next_review < _now_iso()),
            }
        )
    return tools


class ScopeDeclaration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_enforced: bool = False
    permissions: list[str] = Field(default_factory=list)
    data_classes: list[str] = Field(default_factory=list)


class ForgeRequestPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=3, max_length=120)
    intent: str = Field(min_length=12, max_length=_MAX_TEXT)
    kind: Literal["panel", "dashboard", "diagnostic_command", "workflow"]
    expected_outcome: str = Field(min_length=10, max_length=400)
    capability_refs: list[str] = Field(default_factory=list)
    scope: ScopeDeclaration = Field(default_factory=ScopeDeclaration)
    sandbox_plan: str = Field(default="", max_length=_MAX_TEXT)
    tests: list[str] = Field(default_factory=list)
    verification: str = Field(default="", max_length=400)
    rollback: str = Field(default="", max_length=400)
    review_interval_days: int = Field(default=90, ge=0, le=3650)


class ForgeReviewPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["approved", "changes_requested", "rejected"]
    evidence_note: str = Field(min_length=5, max_length=_MAX_NOTE)


class ForgePublishPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str = Field(min_length=3, max_length=20)
    evidence_note: str = Field(min_length=5, max_length=_MAX_NOTE)


@router.get("/nexus-forge/capabilities")
async def forge_capabilities(
    request: Request,
    q: str | None = None,
    category: str | None = None,
    limit: int = 60,
    current_user: dict = Depends(get_current_user),
):
    """Search the capabilities this Nexus actually serves.

    Grounded on purpose: Forge composes what the running API exposes, so this
    catalogue is the served route table, not a wish list of APIs.
    """
    catalogue = _served_catalogue(request)
    result = filter_catalogue(catalogue, query=q, category=category, limit=limit)
    return {**result, "kinds": list(FORGE_TOOL_KINDS), "boundary": BOUNDARY}


@router.get("/nexus-forge/requests")
async def list_forge_requests(current_user: dict = Depends(get_current_user)):
    """Return this tenant's design requests, their verdicts and their version history."""
    rows = await db.nexus_forge_requests.find(
        tenant_scoped_query(current_user, {}), {"_id": 0}
    ).sort("created_at", -1).to_list(_MAX_ROWS)
    requests = [_public_request(row) for row in rows]
    return {
        "requests": requests,
        "tools": await _published_tools(current_user),
        "kinds": [{"id": item, "meaning": TOOL_KIND_MEANING[item]} for item in FORGE_TOOL_KINDS],
        "summary": {
            "total": len(requests),
            "awaiting_review": sum(1 for row in requests if row.get("stage") in {"specified", "changes_requested"}),
            "approved": sum(1 for row in requests if row.get("stage") == "approved"),
            "published": sum(1 for row in requests if row.get("stage") == "published"),
            "failed": sum(1 for row in requests if row.get("verdict") == "fail"),
        },
        "boundary": BOUNDARY,
    }


@router.post("/nexus-forge/requests")
async def create_forge_request(
    request: Request,
    payload: ForgeRequestPayload,
    current_user: dict = Depends(get_current_user),
):
    """Specify a tool Nexus does not have, composed from capabilities it does.

    The response carries every check and the verdict, so a technician can see what
    stands between the idea and a review instead of guessing.
    """
    title = _clean_text(payload.title, field="Title", minimum=3, maximum=120)
    intent = _clean_text(payload.intent, field="Intent", minimum=12)
    expected_outcome = _clean_text(payload.expected_outcome, field="Expected outcome", minimum=10, maximum=400)
    sandbox_plan = _clean_text(payload.sandbox_plan, field="Sandbox plan", minimum=0) if payload.sandbox_plan else ""
    rollback = _clean_text(payload.rollback, field="Rollback", minimum=0) if payload.rollback else ""
    verification = (
        _clean_text(payload.verification, field="Verification", minimum=0, maximum=400)
        if payload.verification
        else ""
    )
    refs = _clean_text_list(payload.capability_refs, field="Capability references", maximum=MAX_CAPABILITY_REF)
    if len(refs) > _MAX_REFS:
        raise HTTPException(status_code=422, detail=f"Declare at most {_MAX_REFS} capabilities")
    tests = _clean_text_list(payload.tests, field="Tests", maximum=200)
    permissions = _clean_text_list(payload.scope.permissions, field="Permissions", maximum=80)
    data_classes = _clean_text_list(payload.scope.data_classes, field="Data classes", maximum=80)

    catalogue = _served_catalogue(request)
    tools = await _published_tools(current_user)
    spec = {
        "title": title,
        "intent": intent,
        "expected_outcome": expected_outcome,
        "capability_refs": refs,
        "scope": {
            "tenant_enforced": bool(payload.scope.tenant_enforced),
            "permissions": permissions,
            "data_classes": data_classes,
        },
        "sandbox_plan": sandbox_plan,
        "tests": tests,
        "verification": verification,
        "rollback": rollback,
        "review_interval_days": int(payload.review_interval_days),
    }
    evaluated = forge_spec_checks(spec, catalogue=catalogue, published_tools=tools)
    now = _now_iso()
    row = {
        "id": f"frg-{uuid.uuid4().hex[:12]}",
        "tenant_id": platform_tenant_id(current_user),
        **spec,
        "kind": payload.kind,
        "capabilities": evaluated["capabilities"],
        "unresolved_capabilities": evaluated["unresolved_capabilities"],
        "checks": evaluated["checks"],
        "verdict": evaluated["verdict"],
        "verdict_reason": verdict_reason(evaluated["verdict"], evaluated["checks"]),
        "stage": "specified",
        "review_history": [],
        "versions": [],
        "created_at": now,
        "created_by": _actor_name(current_user),
        "created_by_id": _actor(current_user),
        "updated_at": now,
    }
    await db.nexus_forge_requests.insert_one(dict(row))
    await log_activity(
        current_user,
        "nexus_forge.request_specified",
        "nexus_forge_request",
        row["id"],
        title,
        details=f"Forge design requested ({payload.kind}): {title}",
        metadata={
            "kind": payload.kind,
            "verdict": evaluated["verdict"],
            "capabilities": [item["id"] for item in evaluated["capabilities"]],
        },
    )
    return {"request": _public_request(row), "boundary": BOUNDARY}


@router.post("/nexus-forge/requests/{request_id}/review")
async def review_forge_request(
    request_id: str,
    payload: ForgeReviewPayload,
    current_user: dict = Depends(get_current_user),
):
    """Record a human decision on a design.

    A design whose checks failed cannot be approved. A design that needs review can
    be approved, but only with the acknowledgement written down.
    """
    row = await _load_request(current_user, request_id)
    stage = str(row.get("stage") or "specified")
    if stage == "published":
        raise HTTPException(status_code=422, detail="A published tool is versioned, not re-reviewed as a new design")
    if payload.decision == "approved" and stage == "approved":
        raise HTTPException(status_code=422, detail="This design is already approved and awaiting a version")
    note = _clean_text(payload.evidence_note, field="Review note", minimum=5, maximum=_MAX_NOTE)
    verdict = str(row.get("verdict") or "fail")
    failing = [check for check in (row.get("checks") or []) if check.get("status") == "fail"]
    flagged = [check for check in (row.get("checks") or []) if check.get("status") == "needs_review"]
    if payload.decision == "approved" and failing:
        raise HTTPException(
            status_code=422,
            detail=(
                "This design failed "
                f"{len(failing)} check(s): {', '.join(str(check.get('label')) for check in failing[:3])}. "
                "Fix the specification and submit a new one."
            ),
        )
    if payload.decision == "approved" and flagged and len(note) < 20:
        raise HTTPException(
            status_code=422,
            detail=(
                f"{len(flagged)} check(s) need a human decision "
                f"({', '.join(str(check.get('label')) for check in flagged[:3])}). "
                "Approving anyway requires a note of at least 20 characters that says why."
            ),
        )
    now = _now_iso()
    history = list(row.get("review_history") or [])
    history.append(
        {
            "decision": payload.decision,
            "evidence_note": note,
            "verdict_at_review": verdict,
            "reviewed_at": now,
            "reviewed_by": _actor_name(current_user),
        }
    )
    stage_map = {"approved": "approved", "changes_requested": "changes_requested", "rejected": "rejected"}
    await db.nexus_forge_requests.update_one(
        tenant_scoped_query(current_user, {"id": row["id"]}),
        {"$set": {"stage": stage_map[payload.decision], "review_history": history[-20:], "updated_at": now}},
    )
    await log_activity(
        current_user,
        "nexus_forge.request_reviewed",
        "nexus_forge_request",
        row["id"],
        str(row.get("title") or ""),
        details=f"Forge design {payload.decision}: {note}",
        metadata={"decision": payload.decision, "verdict": verdict},
    )
    return {
        "request": _public_request({**row, "stage": stage_map[payload.decision], "review_history": history[-20:]}),
        "boundary": BOUNDARY,
    }


@router.post("/nexus-forge/requests/{request_id}/publish")
async def publish_forge_request(
    request_id: str,
    payload: ForgePublishPayload,
    current_user: dict = Depends(get_current_user),
):
    """Record a governed version for an approved design.

    This writes a version record. It installs nothing, deploys nothing and grants
    nothing; the tool still has to be built and reviewed like any other product work.
    """
    row = await _load_request(current_user, request_id)
    versions = [str(item.get("version")) for item in (row.get("versions") or []) if isinstance(item, dict)]
    gate = tool_publish_gate(row, version=payload.version, existing_versions=versions)
    if not gate["allowed"]:
        raise HTTPException(status_code=422, detail=gate["reason"])
    note = _clean_text(payload.evidence_note, field="Publish note", minimum=5, maximum=_MAX_NOTE)
    now = _now_iso()
    record = {
        "version": str(payload.version).strip(),
        "published_at": now,
        "published_by": _actor_name(current_user),
        "note": note,
        "verdict_at_publish": str(row.get("verdict") or ""),
        "capabilities": [item.get("id") for item in (row.get("capabilities") or []) if isinstance(item, dict)],
        "permissions": list((row.get("scope") or {}).get("permissions") or []),
        "data_classes": list((row.get("scope") or {}).get("data_classes") or []),
        "rollback": row.get("rollback"),
        "review_interval_days": int(row.get("review_interval_days") or 0),
        "supersedes": versions[-1] if versions else None,
    }
    history = list(row.get("versions") or [])
    history.append(record)
    await db.nexus_forge_requests.update_one(
        tenant_scoped_query(current_user, {"id": row["id"]}),
        {"$set": {"stage": "published", "versions": history[-20:], "updated_at": now}},
    )
    await log_activity(
        current_user,
        "nexus_forge.version_recorded",
        "nexus_forge_request",
        row["id"],
        str(row.get("title") or ""),
        details=f"Forge tool version {record['version']} recorded with rollback retained",
        metadata={
            "version": record["version"],
            "review_interval_days": record["review_interval_days"],
            "supersedes": record["supersedes"],
        },
    )
    return {
        "request": _public_request({**row, "stage": "published", "versions": history[-20:]}),
        "tools": await _published_tools(current_user),
        "boundary": BOUNDARY,
    }
