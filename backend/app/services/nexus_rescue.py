"""Nexus Rescue: the recovery console for when the agent cannot run.

An agent-based RMM has one structural weakness: what happens when the machine is
broken badly enough that the agent does not work? Nexus Rescue answers that
question with a *recovery plan* rather than a promise.

The honesty boundary matters more here than anywhere else, because the features
are named after things a technician does with a USB stick in a recovery
environment:

* Nexus reports reachability from real evidence only — the recorded agent
  ``last_seen`` inside :data:`AGENT_ALIVE_SECONDS`. A missing or unparsable
  check-in is not alive.
* Capabilities that need an out-of-band recovery path are annotated as such.
  This installation does not execute out-of-band recovery, so those
  capabilities are presented as plans with a named technician as the actor.
* A new session is always ``planned``. Nothing in this module produces an
  ``executed`` state; :func:`record_step` records what a *technician* did, and
  the stored wording says so.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

# A device is only reachable over the agent when it checked in inside this window.
AGENT_ALIVE_SECONDS = 300

SYMPTOMS = ("agent_dead", "no_boot", "network_stack", "update_broke_startup", "unknown")

STEP_KINDS = ("note", "technician_action", "verification", "blocked")

# Statuses a rescue session may ever hold. "executed" is deliberately absent: the
# service plans and evidences recovery, it never claims to have performed it.
SESSION_STATUSES = ("planned", "in_progress", "resolved", "abandoned")

TERMINAL_STATUSES = ("resolved", "abandoned")

CAPABILITY_ORDER: tuple[str, ...] = (
    "repair_agent",
    "inspect_disk",
    "collect_logs",
    "repair_boot",
    "remove_problematic_update",
    "restore_configuration",
    "initiate_backup_recovery",
)

CAPABILITIES: dict[str, dict] = {
    "repair_agent": {
        "label": "Repair the Nexus agent",
        "purpose": "Restart or reinstall the endpoint agent so the managed channel works again.",
        "requires": ["agent_alive"],
        "reversible": True,
        "risk": "low",
        "boundary": (
            "Runs through the live agent channel. A dead agent cannot run it: a technician with local "
            "access must perform the repair by hand until the agent reports in again."
        ),
        "rollback": "Reinstall the previous agent build and re-run the enrolment check.",
    },
    "inspect_disk": {
        "label": "Inspect the disk",
        "purpose": "Read volume health, SMART data and filesystem state outside the running operating system.",
        "requires": ["out_of_band_recovery_path"],
        "reversible": True,
        "risk": "medium",
        "boundary": (
            "Inspection of a machine that will not start needs the volume mounted from a recovery "
            "environment. This installation does not execute out-of-band recovery, so Nexus presents the "
            "inspection plan and a technician or an approved recovery path performs it."
        ),
        "rollback": "No change is made by inspection; unmount the volume when finished.",
    },
    "collect_logs": {
        "label": "Collect the boot and setup logs",
        "purpose": "Recover the logs that explain a failed start, failed update or damaged network stack.",
        "requires": ["out_of_band_recovery_path"],
        "reversible": True,
        "risk": "low",
        "boundary": (
            "Logs of a machine that will not start live on its disk, so collecting them needs the recovery "
            "environment. With a live agent, use the normal agent log collection instead of this path."
        ),
        "rollback": "Nothing is modified; the collected bundle is evidence and stays read-only.",
    },
    "repair_boot": {
        "label": "Repair the boot configuration",
        "purpose": "Rebuild the boot records and boot configuration data so Windows starts again.",
        "requires": ["out_of_band_recovery_path"],
        "reversible": False,
        "risk": "high",
        "boundary": (
            "Requires an out-of-band recovery path and a named technician: boot repair rewrites machine "
            "state and cannot always be undone. Nexus plans and evidences it; it does not execute it here."
        ),
        "rollback": (
            "Not reliably reversible. Capture the disk image or the boot configuration before the repair "
            "and keep a working recovery boot for the machine."
        ),
    },
    "remove_problematic_update": {
        "label": "Remove the problematic update",
        "purpose": "Uninstall a specific update that a failed start is attributed to.",
        "requires": ["out_of_band_recovery_path"],
        "reversible": False,
        "risk": "high",
        "boundary": (
            "An update can only be removed from the offline servicing environment and this installation "
            "does not execute that. Nexus identifies the candidate update and writes the plan; a technician "
            "runs it through the approved recovery path."
        ),
        "rollback": "Reinstall the update after the machine starts if the failure was not caused by it.",
    },
    "restore_configuration": {
        "label": "Restore a known-good configuration",
        "purpose": "Return network, service or policy configuration to the last known-good state.",
        "requires": ["agent_alive"],
        "reversible": True,
        "risk": "medium",
        "boundary": (
            "Needs the agent, a remote session or a technician on site. Nexus can only restore what it "
            "actually recorded as known-good; where no baseline exists it says so instead of guessing."
        ),
        "rollback": "The pre-change configuration is captured as evidence before the restore.",
    },
    "initiate_backup_recovery": {
        "label": "Initiate backup recovery",
        "purpose": "Prepare a restore of the workload from the last verified backup point.",
        "requires": ["out_of_band_recovery_path"],
        "reversible": False,
        "risk": "high",
        "boundary": (
            "The backup provider performs the restore, not Nexus, and a restore overwrites current data. "
            "Nexus prepares the request, confirms the restore point with evidence and requires approval; an "
            "unverified backup is never presented as a safe restore source."
        ),
        "rollback": (
            "Destructive: the current workload state is replaced. Confirm the restore point and keep the "
            "existing workload until the restored system is verified."
        ),
    },
}

RECOMMENDED_PATHS: dict[str, tuple[str, ...]] = {
    "agent_dead": ("repair_agent", "collect_logs", "inspect_disk", "restore_configuration",
                   "initiate_backup_recovery"),
    "no_boot": ("collect_logs", "inspect_disk", "repair_boot", "remove_problematic_update",
                "restore_configuration", "initiate_backup_recovery"),
    "network_stack": ("repair_agent", "restore_configuration", "collect_logs", "inspect_disk",
                      "initiate_backup_recovery"),
    "update_broke_startup": ("collect_logs", "remove_problematic_update", "repair_boot", "inspect_disk",
                             "restore_configuration", "initiate_backup_recovery"),
    "unknown": CAPABILITY_ORDER,
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _parse_dt(value: Any) -> datetime | None:
    """Parse an ISO string or datetime; anything unparsable is not evidence."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# ============== THE CAPABILITY LADDER ==============


def capability_ladder() -> dict:
    """What rescue can reach, in order, with each capability's honest boundary."""
    return {
        "capabilities": [{"capability": key, **CAPABILITIES[key]} for key in CAPABILITY_ORDER],
        "order": list(CAPABILITY_ORDER),
        "count": len(CAPABILITY_ORDER),
        "note": (
            "This ladder is a plan and its honest boundaries, never an executed action. Each capability "
            "states what it requires and what Nexus cannot do from this installation."
        ),
    }


def _agent_liveness(device: dict) -> tuple[bool, str, str]:
    """Is the agent alive, and what evidence supports that verdict?"""
    last_seen = device.get("last_seen")
    parsed = _parse_dt(last_seen)
    if parsed is None:
        return False, str(last_seen or ""), (
            "no parsable agent check-in was recorded for this device, so the agent is not treated as alive"
        )
    age = (_utcnow() - parsed).total_seconds()
    if age <= AGENT_ALIVE_SECONDS:
        return True, str(last_seen), f"the agent checked in {int(max(age, 0))}s ago"
    return False, str(last_seen), (
        f"the agent last checked in {int(age)}s ago, beyond the {AGENT_ALIVE_SECONDS}s liveness window"
    )


def _out_of_band_available(device: dict, payload: dict) -> bool:
    """Is an out-of-band recovery path registered for this device?"""
    evidence = payload.get("evidence")
    if isinstance(evidence, dict) and "out_of_band_recovery_path" in evidence:
        return bool(evidence.get("out_of_band_recovery_path"))
    return bool(device.get("out_of_band_recovery_path") or device.get("rescue_out_of_band"))


def _annotate(facts: dict) -> list[dict]:
    """Annotate every capability with whether its requirements are satisfied."""
    rows = []
    for key in CAPABILITY_ORDER:
        entry = CAPABILITIES[key]
        unmet = [requirement for requirement in entry["requires"] if not facts.get(requirement)]
        rows.append({"capability": key, **entry, "reachable": not unmet, "blocked_by": unmet})
    return rows


# ============== ASSESSMENT ==============


async def assess(db: Any, user: dict, name: str, payload: dict) -> dict:
    """Assess one broken device: what is reachable, from real evidence, and what
    is a plan only. Never implies Nexus can act over a dead agent."""
    payload = payload or {}
    device_id = str(payload.get("device_id") or "").strip()
    if not device_id:
        return {"found": False, "error": "device_id is required"}
    symptom = str(payload.get("symptom") or "unknown").strip().lower()
    if symptom not in SYMPTOMS:
        return {"found": False, "error": f"symptom must be one of {', '.join(SYMPTOMS)}"}

    device = await db.devices.find_one(tenant_scoped_query(user, {"id": device_id}), {"_id": 0})
    if not device:
        return {"found": False}

    agent_reachable, last_seen, why = _agent_liveness(device)
    out_of_band = _out_of_band_available(device, payload)
    facts = {"agent_alive": agent_reachable, "out_of_band_recovery_path": out_of_band}
    capabilities = _annotate(facts)

    path = list(RECOMMENDED_PATHS.get(symptom, RECOMMENDED_PATHS["unknown"]))
    out_of_band_required = [key for key in path if "out_of_band_recovery_path" in CAPABILITIES[key]["requires"]]

    if agent_reachable:
        reachability_note = f"Live agent channel available: {why}."
    else:
        reachability_note = (
            f"Not reachable over the agent: {why}. Nexus cannot act over a dead agent — an approved "
            "out-of-band recovery path and a technician are required."
        )
    if not out_of_band and out_of_band_required:
        reachability_note += (
            " No out-of-band recovery path is registered for this device, so the capabilities above that "
            "need one are plans only."
        )

    return {
        "found": True,
        "device": {"id": device.get("id"), "hostname": device.get("hostname"),
                   "client_id": device.get("client_id"), "os": device.get("os")},
        "symptom": symptom,
        "agent_reachable": agent_reachable,
        "reachability_note": reachability_note,
        "evidence_used": {
            "last_seen": last_seen,
            "agent_alive_window_seconds": AGENT_ALIVE_SECONDS,
            "out_of_band_recovery_path": out_of_band,
        },
        "capabilities": capabilities,
        "out_of_band_required": out_of_band_required,
        "recommended_path": path,
        "note": (
            "Reachability is derived from the recorded check-in and the registered recovery path only. "
            "Anything marked unreachable is a plan for a technician, not an action Nexus can perform."
        ),
    }


async def rescue_console(db: Any, user: dict, device_id: str) -> dict:
    """One call for a device page: the facts, what is reachable, and the first step."""
    device_id = str(device_id or "").strip()
    if not device_id:
        return {"found": False, "error": "device_id is required"}
    device = await db.devices.find_one(tenant_scoped_query(user, {"id": device_id}), {"_id": 0})
    if not device:
        return {"found": False}

    assessment = await assess(db, user, "", {"device_id": device_id, "symptom": "unknown"})
    first_key = assessment["recommended_path"][0]
    first_entry = next(row for row in assessment["capabilities"] if row["capability"] == first_key)
    open_sessions = [
        _session_summary(row) for row in await _device_sessions(db, user, device_id)
        if str(row.get("status")) in ("planned", "in_progress")
    ]

    return {
        "found": True,
        "device": {"id": device.get("id"), "hostname": device.get("hostname"),
                   "client_id": device.get("client_id"), "os": device.get("os"),
                   "status": device.get("status") or "", "last_seen": device.get("last_seen")},
        "agent": {
            "reachable": assessment["agent_reachable"],
            "note": assessment["reachability_note"],
            "evidence": assessment["evidence_used"],
        },
        "capabilities_reachable": [row["capability"] for row in assessment["capabilities"] if row["reachable"]],
        "capabilities_unreachable": [row["capability"] for row in assessment["capabilities"] if not row["reachable"]],
        "recommended_first_step": {
            "capability": first_key,
            "label": first_entry["label"],
            "reachable": first_entry["reachable"],
            "why": first_entry["purpose"],
            "boundary": first_entry["boundary"],
        },
        "open_sessions": open_sessions,
        "note": "Rescue shows a plan and its evidence, not an executed action.",
    }


# ============== RECOVERY SESSIONS (PLANNED, NEVER EXECUTED) ==============


def _capability_steps(key: str) -> list[dict]:
    """The four steps of one recovery capability; the actor is always a human."""
    entry = CAPABILITIES[key]
    instructions = [
        f"Confirm the situation still calls for '{entry['label']}' ({entry['risk']} risk).",
        "Capture the pre-change state as evidence before anything is touched.",
        f"Perform '{entry['label']}' as a technician through the approved path.",
        "Verify the outcome and append the evidence; a failed attempt is recorded, never hidden.",
    ]
    return [
        {"index": index, "instruction": text, "actor": "technician",
         "rollback": entry["rollback"] if index == 2 else ""}
        for index, text in enumerate(instructions, start=1)
    ]


def _session_summary(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "device_id": row.get("device_id"),
        "client_id": row.get("client_id") or "",
        "symptom": row.get("symptom"),
        "status": row.get("status"),
        "approval_required": bool(row.get("approval_required")),
        "capabilities": [entry.get("capability") for entry in (row.get("capabilities") or [])],
        "steps_recorded": len(row.get("steps") or []),
        "technician": row.get("technician") or "",
        "ticket_id": row.get("ticket_id") or "",
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


async def _device_sessions(db: Any, user: dict, device_id: str) -> list[dict]:
    rows = await db.rescue_sessions.find(
        tenant_scoped_query(user, {"device_id": device_id}), {"_id": 0}
    ).sort("created_at", -1).limit(100).to_list(100)
    return rows


async def start_recovery(db: Any, user: dict, name: str, payload: dict) -> dict:
    """Plan a recovery. A new session is always ``planned`` and always requires
    approval — this installation has no path that executes recovery."""
    payload = payload or {}
    device_id = str(payload.get("device_id") or "").strip()
    if not device_id:
        return {"found": False, "error": "device_id is required"}
    symptom = str(payload.get("symptom") or "unknown").strip().lower()
    if symptom not in SYMPTOMS:
        return {"found": False, "error": f"symptom must be one of {', '.join(SYMPTOMS)}"}

    requested = payload.get("capabilities")
    if not isinstance(requested, (list, tuple)) or not requested:
        return {"found": False, "error": "select at least one recovery capability"}
    keys = [str(key or "").strip() for key in requested]
    for key in keys:
        if key not in CAPABILITIES:
            return {"found": False, "error": f"unknown rescue capability '{key}'"}

    device = await db.devices.find_one(tenant_scoped_query(user, {"id": device_id}), {"_id": 0})
    if not device:
        return {"found": False}

    assessment = await assess(db, user, name, {"device_id": device_id, "symptom": symptom})
    reachable = {row["capability"]: row["reachable"] for row in assessment["capabilities"]}

    planned = []
    for key in keys:
        entry = CAPABILITIES[key]
        planned.append({
            "capability": key,
            "label": entry["label"],
            "purpose": entry["purpose"],
            "requires": entry["requires"],
            "reversible": entry["reversible"],
            "risk": entry["risk"],
            "boundary": entry["boundary"],
            "rollback": entry["rollback"],
            "reachable": reachable.get(key, False),
            "steps": _capability_steps(key),
        })

    now = _utcnow()
    session = {
        "id": f"RSC-{uuid.uuid4().hex[:12].upper()}",
        "tenant_id": platform_tenant_id(user),
        "client_id": str(device.get("client_id") or ""),
        "device_id": device_id,
        "symptom": symptom,
        "status": "planned",
        "approval_required": True,
        "capabilities": planned,
        "steps": [],
        "technician": name,
        "ticket_id": str(payload.get("ticket_id") or "")[:64],
        "approval_note": str(payload.get("approval_note") or "")[:500],
        "agent_reachable": assessment["agent_reachable"],
        "out_of_band_required": [key for key in keys
                                 if "out_of_band_recovery_path" in CAPABILITIES[key]["requires"]],
        "created_by": user.get("id"),
        "created_by_name": name,
        "created_at": _iso(now),
        "updated_at": _iso(now),
    }
    await db.rescue_sessions.insert_one(session)
    session.pop("_id", None)
    return {
        "found": True,
        "session": session,
        "note": (
            "Planned only. Nothing has been executed: approval is required and every step names a "
            "technician as the actor, because Nexus has no recovery execution path from this installation."
        ),
    }


async def record_step(db: Any, user: dict, name: str, session_id: str, payload: dict) -> dict:
    """Record what a technician did, saw or was blocked by. Append-only."""
    payload = payload or {}
    kind = str(payload.get("kind") or "").strip().lower()
    if kind not in STEP_KINDS:
        return {"found": False, "error": f"kind must be one of {', '.join(STEP_KINDS)}"}
    close_as = str(payload.get("close_as") or "").strip().lower()
    if close_as and close_as not in TERMINAL_STATUSES:
        return {"found": False, "error": f"close_as must be one of {', '.join(TERMINAL_STATUSES)}"}

    row = await db.rescue_sessions.find_one(
        tenant_scoped_query(user, {"id": str(session_id or "")}), {"_id": 0})
    if not row:
        return {"found": False}

    status = str(row.get("status") or "planned")
    if status in TERMINAL_STATUSES:
        return {"found": False,
                "error": f"this rescue session is {status}; steps are append-only and cannot continue"}

    now = _utcnow()
    steps = list(row.get("steps") or [])
    steps.append({
        "index": len(steps) + 1,
        "kind": kind,
        "detail": str(payload.get("detail") or "")[:2000],
        "outcome": str(payload.get("outcome") or "")[:200],
        "performed_by": "technician",
        "recorded_by": name,
        "at": _iso(now),
    })

    updates: dict = {"steps": steps, "updated_at": _iso(now)}
    if close_as:
        updates["status"] = close_as
        updates["closed_by"] = name
        updates["closed_at"] = _iso(now)
    elif status == "planned":
        updates["status"] = "in_progress"

    await db.rescue_sessions.update_one(
        {"id": row.get("id"), "tenant_id": row.get("tenant_id")}, {"$set": updates})
    row.update(updates)

    note = "Recorded against the session log. The actor is a technician, never Nexus."
    if close_as:
        note = f"Session closed as {close_as} by {name}; the log stays append-only."
    return {"found": True, "session": row, "step": steps[-1], "note": note}


async def get_session(db: Any, user: dict, session_id: str) -> dict:
    """One rescue session with its plan, log and honest boundaries."""
    row = await db.rescue_sessions.find_one(
        tenant_scoped_query(user, {"id": str(session_id or "")}), {"_id": 0})
    if not row:
        return {"found": False}
    return {"found": True, "session": row,
            "note": "Plan and evidence only; the log records what a technician did."}


async def list_sessions(db: Any, user: dict, device_id: str | None = None) -> dict:
    """Rescue sessions in tenant scope, newest first."""
    query = {"device_id": str(device_id)} if device_id else {}
    rows = await db.rescue_sessions.find(
        tenant_scoped_query(user, query), {"_id": 0}
    ).sort("created_at", -1).limit(100).to_list(100)
    sessions = [_session_summary(row) for row in rows]
    return {
        "count": len(sessions),
        "sessions": sessions,
        "note": "Every session is a plan with an approval requirement and a technician-owned log.",
    }
