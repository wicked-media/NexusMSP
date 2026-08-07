"""Technician-led security response runbooks.

These records deliberately document human response work.  They do not claim to
isolate a device, reset an account, or collect evidence unless the technician
has completed that action through its provider-backed workspace.
"""
from datetime import datetime, timezone
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity

router = APIRouter()

LEGACY_SEEDED_PLAYBOOK_IDS = {"pb-001", "pb-002", "pb-003", "pb-004"}
STEP_OUTCOMES = {"completed", "blocked", "not_applicable"}


RESPONSE_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "template-ransomware-containment",
        "name": "Ransomware containment response",
        "description": "A guided evidence checklist for an active ransomware or canary event.",
        "trigger": "ransomware_or_canary_event",
        "severity": "critical",
        "source": "nexus_template",
        "enabled": True,
        "execution_mode": "guided",
        "steps": [
            {"order": 1, "action": "validate_signal", "description": "Validate the alert or canary evidence and record the affected endpoint."},
            {"order": 2, "action": "contain", "description": "Use the applicable provider-backed control to contain affected endpoints."},
            {"order": 3, "action": "preserve_evidence", "description": "Preserve the required logs and record their location in the incident ticket."},
            {"order": 4, "action": "credential_response", "description": "Assess compromised credentials and complete the identity response where required."},
            {"order": 5, "action": "recovery_review", "description": "Verify recovery scope and update the linked incident record with the next owner."},
        ],
    },
    {
        "id": "template-compromised-account",
        "name": "Compromised account response",
        "description": "A guided response for suspected credential theft, BEC, or suspicious sign-in activity.",
        "trigger": "identity_or_mail_alert",
        "severity": "high",
        "source": "nexus_template",
        "enabled": True,
        "execution_mode": "guided",
        "steps": [
            {"order": 1, "action": "validate_identity_alert", "description": "Validate the provider-backed identity or mail alert and establish impact."},
            {"order": 2, "action": "contain_identity", "description": "Complete the applicable identity containment action in the provider console."},
            {"order": 3, "action": "review_persistence", "description": "Review mailbox rules, delegated access, sessions, and linked application consent."},
            {"order": 4, "action": "notify_and_document", "description": "Record customer communication, scope, and next actions in the incident ticket."},
        ],
    },
    {
        "id": "template-malware-triage",
        "name": "Malware triage response",
        "description": "A guided response for verified malware detections requiring technician review.",
        "trigger": "provider_backed_malware_alert",
        "severity": "high",
        "source": "nexus_template",
        "enabled": True,
        "execution_mode": "guided",
        "steps": [
            {"order": 1, "action": "validate_detection", "description": "Validate the detection in the security provider and confirm the endpoint identity."},
            {"order": 2, "action": "contain_or_quarantine", "description": "Carry out containment or quarantine in the authoritative security tool."},
            {"order": 3, "action": "review_scope", "description": "Check related endpoints, user activity, and persistence indicators."},
            {"order": 4, "action": "close_with_evidence", "description": "Attach findings or references to the incident before closing the response session."},
        ],
    },
]


def _public(document: dict | None) -> dict | None:
    if not document:
        return None
    return {key: value for key, value in document.items() if key != "_id"}


async def _retire_legacy_generated_records() -> None:
    """Remove only the old fake seeded records, never team-authored runbooks."""
    await db.remediation_playbooks.delete_many({"id": {"$in": list(LEGACY_SEEDED_PLAYBOOK_IDS)}})
    await db.playbook_executions.delete_many({"playbook_id": {"$in": list(LEGACY_SEEDED_PLAYBOOK_IDS)}})


async def _resolve_playbook(playbook_id: str) -> dict:
    for template in RESPONSE_TEMPLATES:
        if template["id"] == playbook_id:
            return dict(template)
    playbook = await db.remediation_playbooks.find_one({"id": playbook_id, "source": "team"}, {"_id": 0})
    if not playbook:
        raise HTTPException(status_code=404, detail="Response runbook not found")
    return playbook


@router.get("/remediation-playbooks/list")
async def get_playbooks(current_user: dict = Depends(get_current_user)):
    await _retire_legacy_generated_records()
    team_playbooks = await db.remediation_playbooks.find(
        {"source": "team"}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return [dict(template) for template in RESPONSE_TEMPLATES] + team_playbooks


@router.post("/remediation-playbooks/create", status_code=201)
async def create_playbook(data: dict, current_user: dict = Depends(get_current_user)):
    name = str(data.get("name") or "").strip()
    description = str(data.get("description") or "").strip()
    raw_steps = data.get("steps") or []
    if not name or not description or not isinstance(raw_steps, list) or not raw_steps:
        raise HTTPException(status_code=400, detail="Name, description, and at least one response step are required")

    steps = []
    for index, step in enumerate(raw_steps, start=1):
        step_description = str((step or {}).get("description") or "").strip()
        if not step_description:
            raise HTTPException(status_code=400, detail=f"Response step {index} needs a description")
        steps.append({
            "order": index,
            "action": str((step or {}).get("action") or "review").strip()[:80] or "review",
            "description": step_description[:1000],
        })

    now = datetime.now(timezone.utc).isoformat()
    playbook = {
        "id": f"runbook-{uuid.uuid4().hex[:10]}",
        "name": name[:160],
        "description": description[:1000],
        "trigger": str(data.get("trigger") or "manual").strip()[:120] or "manual",
        "severity": str(data.get("severity") or "medium").lower() if str(data.get("severity") or "medium").lower() in {"critical", "high", "medium", "low"} else "medium",
        "source": "team",
        "enabled": bool(data.get("enabled", True)),
        "execution_mode": "guided",
        "steps": steps,
        "created_by": current_user.get("name") or current_user.get("email") or "Unknown technician",
        "created_at": now,
        "updated_at": now,
    }
    await db.remediation_playbooks.insert_one(playbook)
    await log_activity(current_user, "security_response_runbook_created", "security_response_runbook", playbook["id"], playbook["name"], "Created a technician-led response runbook")
    return _public(playbook)


@router.get("/remediation-playbooks/executions")
async def get_executions(current_user: dict = Depends(get_current_user)):
    await _retire_legacy_generated_records()
    return await db.playbook_executions.find(
        {"schema_version": 2}, {"_id": 0}
    ).sort("started_at", -1).to_list(50)


@router.post("/remediation-playbooks/{playbook_id}/start", status_code=201)
async def start_guided_response(playbook_id: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    playbook = await _resolve_playbook(playbook_id)
    if not playbook.get("enabled", True):
        raise HTTPException(status_code=409, detail="This response runbook is disabled")

    payload = data or {}
    client_id = str(payload.get("client_id") or "").strip()
    scope_note = str(payload.get("scope_note") or "").strip()
    if not client_id:
        raise HTTPException(status_code=400, detail="Choose the client this response protects")
    if len(scope_note) < 12:
        raise HTTPException(status_code=400, detail="Record the observed signal and response scope")

    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    device_id = str(payload.get("device_id") or "").strip() or None
    device = None
    if device_id:
        device = await db.devices.find_one({"id": device_id}, {"_id": 0})
        if not device:
            raise HTTPException(status_code=404, detail="Managed asset not found")
        if str(device.get("client_id") or "") != client_id:
            raise HTTPException(status_code=409, detail="The selected managed asset is not linked to this client")

    ticket_id = str(payload.get("ticket_id") or "").strip() or None
    ticket = None
    if ticket_id:
        ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket or incident not found")
        if str(ticket.get("client_id") or "") != client_id:
            raise HTTPException(status_code=409, detail="The selected ticket is not linked to this client")

    now = datetime.now(timezone.utc).isoformat()
    session = {
        "id": f"response-{uuid.uuid4().hex[:10]}",
        "schema_version": 2,
        "playbook_id": playbook["id"],
        "playbook_name": playbook["name"],
        "playbook_source": playbook.get("source", "team"),
        "status": "in_progress",
        "started_at": now,
        "started_by": current_user.get("name") or current_user.get("email") or "Unknown technician",
        "client_id": client_id,
        "client_name": client.get("name") or client.get("company_name") or client_id,
        "device_id": device_id,
        "device_name": (device or {}).get("name") or (device or {}).get("hostname"),
        "ticket_id": ticket_id,
        "ticket_number": (ticket or {}).get("ticket_number"),
        "ticket_title": (ticket or {}).get("title") or (ticket or {}).get("subject"),
        "trigger_reference": str(payload.get("trigger_reference") or "").strip()[:250] or None,
        "scope_note": scope_note[:2000],
        "steps": [{**step, "outcome": "pending", "recorded_at": None, "recorded_by": None, "note": None} for step in playbook.get("steps", [])],
    }
    await db.playbook_executions.insert_one(session)
    await log_activity(
        current_user, "security_response_started", "security_response", session["id"], session["playbook_name"],
        "Started a guided response session", metadata={
            "client_id": session.get("client_id"),
            "client_name": session.get("client_name"),
            "ticket_id": session.get("ticket_id"),
            "ticket_number": session.get("ticket_number"),
            "device_id": session.get("device_id"),
            "device_name": session.get("device_name"),
            "trigger_reference": session.get("trigger_reference"),
            "scope_note": session.get("scope_note"),
        },
    )
    return _public(session)


@router.post("/remediation-playbooks/executions/{execution_id}/steps/{step_order}")
async def record_response_step(execution_id: str, step_order: int, data: dict, current_user: dict = Depends(get_current_user)):
    execution = await db.playbook_executions.find_one({"id": execution_id, "schema_version": 2}, {"_id": 0})
    if not execution:
        raise HTTPException(status_code=404, detail="Response session not found")
    if execution.get("status") != "in_progress":
        raise HTTPException(status_code=409, detail="Only an active response session can be updated")

    outcome = str(data.get("outcome") or "").lower()
    if outcome not in STEP_OUTCOMES:
        raise HTTPException(status_code=400, detail="Outcome must be completed, blocked, or not_applicable")
    note = str(data.get("note") or "").strip()
    if outcome == "blocked" and not note:
        raise HTTPException(status_code=400, detail="A note is required when a response step is blocked")

    matched = False
    now = datetime.now(timezone.utc).isoformat()
    updated_steps = []
    for step in execution.get("steps", []):
        updated = dict(step)
        if int(step.get("order", -1)) == step_order:
            matched = True
            if step.get("outcome") != "pending":
                raise HTTPException(status_code=409, detail="That response step has already been recorded")
            updated.update({
                "outcome": outcome,
                "note": note[:2000] or None,
                "recorded_at": now,
                "recorded_by": current_user.get("name") or current_user.get("email") or "Unknown technician",
            })
        updated_steps.append(updated)
    if not matched:
        raise HTTPException(status_code=404, detail="Response step not found")

    await db.playbook_executions.update_one({"id": execution_id, "status": "in_progress"}, {"$set": {"steps": updated_steps, "updated_at": now}})
    await log_activity(
        current_user, f"security_response_step_{outcome}", "security_response", execution_id, execution.get("playbook_name", "Response session"),
        f"Recorded response step {step_order} as {outcome}", metadata={"step_order": step_order, "note": note[:2000] or None},
    )
    execution["steps"] = updated_steps
    execution["updated_at"] = now
    return execution


@router.post("/remediation-playbooks/executions/{execution_id}/close")
async def close_guided_response(execution_id: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    execution = await db.playbook_executions.find_one({"id": execution_id, "schema_version": 2}, {"_id": 0})
    if not execution:
        raise HTTPException(status_code=404, detail="Response session not found")
    if execution.get("status") != "in_progress":
        raise HTTPException(status_code=409, detail="This response session is already closed")
    if any(step.get("outcome") == "pending" for step in execution.get("steps", [])):
        raise HTTPException(status_code=409, detail="Record an outcome for every response step before closing the session")

    now = datetime.now(timezone.utc).isoformat()
    close_note = str((data or {}).get("note") or "").strip()
    await db.playbook_executions.update_one({"id": execution_id, "status": "in_progress"}, {"$set": {"status": "closed", "closed_at": now, "closed_by": current_user.get("name") or current_user.get("email") or "Unknown technician", "close_note": close_note[:2000] or None}})
    await log_activity(current_user, "security_response_closed", "security_response", execution_id, execution.get("playbook_name", "Response session"), "Closed a guided response session", metadata={"note": close_note[:2000] or None})
    execution.update({"status": "closed", "closed_at": now, "closed_by": current_user.get("name") or current_user.get("email") or "Unknown technician", "close_note": close_note[:2000] or None})
    return execution


@router.post("/remediation-playbooks/executions/{execution_id}/cancel")
async def cancel_guided_response(execution_id: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    execution = await db.playbook_executions.find_one({"id": execution_id, "schema_version": 2}, {"_id": 0})
    if not execution:
        raise HTTPException(status_code=404, detail="Response session not found")
    if execution.get("status") != "in_progress":
        raise HTTPException(status_code=409, detail="Only an active response session can be cancelled")

    reason = str((data or {}).get("reason") or "").strip()
    if len(reason) < 8:
        raise HTTPException(status_code=400, detail="Record why this guided response is being cancelled")

    now = datetime.now(timezone.utc).isoformat()
    actor = current_user.get("name") or current_user.get("email") or "Unknown technician"
    cancellation = {
        "status": "cancelled",
        "cancelled_at": now,
        "cancelled_by": actor,
        "cancel_reason": reason[:2000],
    }
    result = await db.playbook_executions.update_one(
        {"id": execution_id, "status": "in_progress"},
        {"$set": cancellation},
    )
    if not getattr(result, "modified_count", 0):
        raise HTTPException(status_code=409, detail="The response session changed before cancellation; refresh and try again")
    await log_activity(
        current_user,
        "security_response_cancelled",
        "security_response",
        execution_id,
        execution.get("playbook_name", "Response session"),
        "Cancelled a guided response session while retaining its audit record",
        metadata={
            "client_id": execution.get("client_id"),
            "ticket_id": execution.get("ticket_id"),
            "device_id": execution.get("device_id"),
            "reason": reason[:2000],
        },
    )
    execution.update(cancellation)
    return execution


@router.post("/remediation-playbooks/{playbook_id}/execute")
async def execute_playbook(playbook_id: str, current_user: dict = Depends(get_current_user)):
    """Compatibility endpoint: automatic execution was never implemented safely."""
    raise HTTPException(status_code=410, detail="Automatic response execution is not available. Start a guided response session and complete each action in its provider-backed workspace.")
