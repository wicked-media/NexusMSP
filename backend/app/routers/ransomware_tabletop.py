"""Auditable technician tabletop exercises with real, recorded decisions."""
from datetime import datetime, timezone
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity

router = APIRouter()


TABLETOP_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "tabletop-ransomware-containment",
        "name": "Ransomware containment exercise",
        "description": "Practice the first decisions after a verified ransomware signal or canary trigger.",
        "difficulty": "high",
        "est_duration_min": 45,
        "phases": [
            {"phase": 1, "title": "Signal validation", "description": "A high-confidence alert reports suspected encryption on a managed endpoint.", "decisions": ["Validate the signal and identify the endpoint", "Wait for a second alert before investigating", "Close the alert as a false positive"]},
            {"phase": 2, "title": "Containment", "description": "The endpoint shows active suspicious file activity and has network access.", "decisions": ["Contain the affected endpoint using the security control", "Ask the user to continue working while monitoring", "Restart the endpoint without preserving evidence"]},
            {"phase": 3, "title": "Scope and evidence", "description": "Related activity appears on a file share and an administrator account.", "decisions": ["Preserve evidence and assess related endpoints and identities", "Delete logs to save storage", "Restore systems before assessing scope"]},
            {"phase": 4, "title": "Recovery coordination", "description": "Containment is in progress and the client needs a recovery update.", "decisions": ["Document recovery scope and owner in the incident record", "Provide an unverified recovery time", "Close the incident before recovery is validated"]},
        ],
    },
    {
        "id": "tabletop-business-email-compromise",
        "name": "Business email compromise exercise",
        "description": "Practice response ownership for a suspected executive impersonation and payment fraud attempt.",
        "difficulty": "medium",
        "est_duration_min": 30,
        "phases": [
            {"phase": 1, "title": "Suspicious request", "description": "A finance user receives an urgent external payment request that appears to be from an executive.", "decisions": ["Verify the request using a separate trusted channel", "Process the request immediately", "Forward it to another mailbox without verification"]},
            {"phase": 2, "title": "Account review", "description": "Header review and sign-in telemetry indicate a possible mailbox compromise.", "decisions": ["Contain the identity and review session and mailbox persistence", "Only block the sender address", "Wait until the end of the day to investigate"]},
            {"phase": 3, "title": "Communication and closure", "description": "The client needs a documented summary and preventive actions.", "decisions": ["Record evidence, client communication, and the assigned recovery owner", "Close without recording evidence", "Announce a root cause before it is confirmed"]},
        ],
    },
    {
        "id": "tabletop-supply-chain",
        "name": "Supplier compromise exercise",
        "description": "Practice containment and communication for a suspected compromised vendor update.",
        "difficulty": "high",
        "est_duration_min": 40,
        "phases": [
            {"phase": 1, "title": "Update anomaly", "description": "A vendor update has been deployed and new suspicious outbound connections are reported.", "decisions": ["Validate vendor guidance and contain affected endpoints", "Assume the update is safe because it was signed", "Disable all monitoring permanently"]},
            {"phase": 2, "title": "Impact analysis", "description": "Several clients may have received the update.", "decisions": ["Identify affected clients and record the verified scope", "Notify every client with unverified details", "Wait for public reporting before acting"]},
            {"phase": 3, "title": "Recovery planning", "description": "The vendor has issued preliminary remediation guidance.", "decisions": ["Track remediation by client and preserve evidence", "Mark every endpoint fixed without verification", "Remove the vendor record from documentation"]},
        ],
    },
]


def _public(document: dict | None) -> dict | None:
    if not document:
        return None
    return {key: value for key, value in document.items() if key != "_id"}


def _template_for(scenario_id: str) -> dict:
    for scenario in TABLETOP_TEMPLATES:
        if scenario["id"] == scenario_id:
            return scenario
    raise HTTPException(status_code=404, detail="Tabletop template not found")


async def _retire_unverified_legacy_drills() -> None:
    """Old drills could not record decisions, so they are not valid exercise evidence."""
    await db.tabletop_drills.update_many(
        {"schema_version": {"$exists": False}, "status": {"$ne": "retired_unverified"}},
        {"$set": {"status": "retired_unverified", "retired_reason": "The legacy tabletop workflow did not record decisions or completion evidence."}},
    )
    await db.ransomware_scenarios.delete_many({"times_run": {"$exists": True}})


@router.get("/ransomware-tabletop/scenarios")
async def list_scenarios(current_user: dict = Depends(get_current_user)):
    await _retire_unverified_legacy_drills()
    drills = await db.tabletop_drills.find({"schema_version": 2}, {"_id": 0}).to_list(500)
    summary: dict[str, dict[str, int]] = {}
    for drill in drills:
        item = summary.setdefault(drill.get("scenario_id", ""), {"recorded_drills": 0, "completed_drills": 0})
        item["recorded_drills"] += 1
        if drill.get("status") in {"completed", "closed"}:
            item["completed_drills"] += 1
    return [{**scenario, **summary.get(scenario["id"], {"recorded_drills": 0, "completed_drills": 0})} for scenario in TABLETOP_TEMPLATES]


@router.get("/ransomware-tabletop/drills")
async def list_drills(current_user: dict = Depends(get_current_user)):
    await _retire_unverified_legacy_drills()
    return await db.tabletop_drills.find({"schema_version": 2}, {"_id": 0}).sort("started_at", -1).to_list(50)


@router.post("/ransomware-tabletop/start/{scenario_id}", status_code=201)
async def start_drill(scenario_id: str, current_user: dict = Depends(get_current_user)):
    scenario = _template_for(scenario_id)
    now = datetime.now(timezone.utc).isoformat()
    drill = {
        "id": f"drill-{uuid.uuid4().hex[:10]}",
        "schema_version": 2,
        "scenario_id": scenario_id,
        "scenario_name": scenario["name"],
        "started_at": now,
        "started_by": current_user.get("name") or current_user.get("email") or "Unknown technician",
        "status": "in_progress",
        "current_phase": 1,
        "phases": scenario["phases"],
        "responses": [],
    }
    await db.tabletop_drills.insert_one(drill)
    await log_activity(current_user, "security_tabletop_started", "security_tabletop", drill["id"], drill["scenario_name"], "Started a tabletop exercise")
    return _public(drill)


@router.post("/ransomware-tabletop/drills/{drill_id}/respond")
async def record_decision(drill_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    drill = await db.tabletop_drills.find_one({"id": drill_id, "schema_version": 2}, {"_id": 0})
    if not drill:
        raise HTTPException(status_code=404, detail="Tabletop drill not found")
    if drill.get("status") != "in_progress":
        raise HTTPException(status_code=409, detail="This tabletop drill is no longer active")

    phase_number = int(drill.get("current_phase") or 1)
    phase = next((item for item in drill.get("phases", []) if item.get("phase") == phase_number), None)
    if not phase:
        raise HTTPException(status_code=409, detail="This drill has no active phase")
    decision = str(data.get("decision") or "").strip()
    if decision not in phase.get("decisions", []):
        raise HTTPException(status_code=400, detail="Choose one of the available decisions for the current phase")

    now = datetime.now(timezone.utc).isoformat()
    response = {
        "phase": phase_number,
        "decision": decision,
        "note": str(data.get("note") or "").strip()[:2000] or None,
        "recorded_at": now,
        "recorded_by": current_user.get("name") or current_user.get("email") or "Unknown technician",
    }
    responses = [*drill.get("responses", []), response]
    next_phase = phase_number + 1
    complete = next_phase > len(drill.get("phases", []))
    update = {
        "responses": responses,
        "current_phase": next_phase if not complete else phase_number,
        "updated_at": now,
        "status": "completed" if complete else "in_progress",
    }
    if complete:
        update["completed_at"] = now
        update["completed_by"] = current_user.get("name") or current_user.get("email") or "Unknown technician"
    result = await db.tabletop_drills.update_one(
        {"id": drill_id, "schema_version": 2, "status": "in_progress", "current_phase": phase_number}, {"$set": update}
    )
    if not result.modified_count:
        raise HTTPException(status_code=409, detail="This phase was already recorded by another technician")
    action = "security_tabletop_completed" if complete else "security_tabletop_decision_recorded"
    await log_activity(current_user, action, "security_tabletop", drill_id, drill.get("scenario_name", "Tabletop exercise"), f"Recorded decision for tabletop phase {phase_number}", metadata={"phase": phase_number, "decision": decision, "note": response["note"]})
    drill.update(update)
    return drill


@router.post("/ransomware-tabletop/drills/{drill_id}/close")
async def close_drill(drill_id: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    drill = await db.tabletop_drills.find_one({"id": drill_id, "schema_version": 2}, {"_id": 0})
    if not drill:
        raise HTTPException(status_code=404, detail="Tabletop drill not found")
    if drill.get("status") not in {"in_progress", "completed"}:
        raise HTTPException(status_code=409, detail="This tabletop drill is already closed")
    now = datetime.now(timezone.utc).isoformat()
    note = str((data or {}).get("note") or "").strip()
    await db.tabletop_drills.update_one({"id": drill_id, "schema_version": 2, "status": {"$in": ["in_progress", "completed"]}}, {"$set": {"status": "closed", "closed_at": now, "closed_by": current_user.get("name") or current_user.get("email") or "Unknown technician", "close_note": note[:2000] or None}})
    await log_activity(current_user, "security_tabletop_closed", "security_tabletop", drill_id, drill.get("scenario_name", "Tabletop exercise"), "Closed a tabletop exercise", metadata={"note": note[:2000] or None})
    drill.update({"status": "closed", "closed_at": now, "closed_by": current_user.get("name") or current_user.get("email") or "Unknown technician", "close_note": note[:2000] or None})
    return drill
