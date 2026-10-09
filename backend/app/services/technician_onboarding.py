"""Server-owned technician onboarding and evidence helpers.

The checklist is intentionally stored inside the authoritative ``users``
document rather than in a second onboarding collection.  A technician's
account is the subject of this evidence, so keeping the state there prevents
two records from independently claiming to be the source of truth.

Completion is an attestation that the technician has reviewed the prescribed
Nexus workflow.  It is not proof that a real customer action was performed;
the linked operational records remain the evidence for actual ticket, billing
and change work.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


TECHNICIAN_ONBOARDING_VERSION = "2026.08"

# These are deliberately small, role-safe first-use guides.  They point a new
# technician to the governed workflows without pretending that a training
# acknowledgement is the same thing as a completed customer action.
TECHNICIAN_ONBOARDING_STEPS: tuple[dict[str, str], ...] = (
    {
        "id": "workspace-basics",
        "title": "Learn the Nexus workspace basics",
        "description": "Review the shared navigation, search, back actions and the workspace workflow pattern before working live records.",
        "workspace": "/workspace",
        "evidence_expectation": "Nexus records the authenticated technician and context for each operational action.",
    },
    {
        "id": "client-context",
        "title": "Work in the correct client context",
        "description": "Learn how client scope, contacts, sites and assets keep work connected to the right customer record.",
        "workspace": "/clients",
        "evidence_expectation": "Client and site boundaries are checked server-side before customer-scoped work is read or changed.",
    },
    {
        "id": "ticket-lifecycle",
        "title": "Create an accountable ticket",
        "description": "Practise choosing the correct client, contact, priority, owner and customer-safe update before creating work.",
        "workspace": "/tickets",
        "evidence_expectation": "Tickets retain their creator, client context, workflow and communication history.",
    },
    {
        "id": "documentation-and-audit",
        "title": "Record documentation and evidence",
        "description": "Use Work Session and the ticket timeline to record what was checked, changed and verified.",
        "workspace": "/work-session",
        "evidence_expectation": "Time, notes, remote activity and verification are retained with the related work record.",
    },
    {
        "id": "billing-basics",
        "title": "Understand invoice workflow",
        "description": "Review how to draft an invoice, select client-safe line items and submit it through the approved financial workflow.",
        "workspace": "/invoices",
        "evidence_expectation": "Invoice changes, approvals and generated documents retain their financial audit history.",
    },
    {
        "id": "secure-remote-and-verify",
        "title": "Use secure remote work and verification",
        "description": "Learn when to use remote-access controls, Nexus Verify and escalation instead of making a sensitive change directly.",
        "workspace": "/nexus-verify",
        "evidence_expectation": "Sensitive actions require server-side permissions, scope checks and auditable approval evidence.",
    },
    {
        "id": "final-attestation",
        "title": "Confirm your operational responsibility",
        "description": "Confirm that you understand Nexus records work evidence and that sensitive actions stay within approved workflows.",
        "workspace": "/my-settings?tab=profile",
        "evidence_expectation": "The final acknowledgement is retained as a technician attestation, not substituted for real operational evidence.",
    },
)

_STEP_IDS = frozenset(step["id"] for step in TECHNICIAN_ONBOARDING_STEPS)
_ACKNOWLEDGEMENT = "I have reviewed this Nexus workflow and understand that customer-impacting work must remain in its auditable operational record."


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _step_state(step: dict[str, str]) -> dict[str, Any]:
    return {
        **step,
        "required": True,
        "status": "pending",
        "completed_at": None,
        "completed_by_id": None,
        "completed_by_name": None,
        "evidence": None,
    }


def build_technician_onboarding(*, technician: dict[str, Any], now: str | None = None) -> dict[str, Any]:
    """Return a safe default onboarding record for a technician account."""
    timestamp = now or _now()
    return {
        "version": TECHNICIAN_ONBOARDING_VERSION,
        "status": "not_started",
        "is_compliant": False,
        "must_complete_before_operational_work": True,
        "created_at": timestamp,
        "updated_at": timestamp,
        "completed_at": None,
        "completed_by_id": None,
        "technician_id": str(technician.get("id") or ""),
        "steps": {step["id"]: _step_state(step) for step in TECHNICIAN_ONBOARDING_STEPS},
        "audit_log": [
            {
                "id": str(uuid4()),
                "action": "technician_onboarding_started",
                "occurred_at": timestamp,
                "actor_id": str(technician.get("id") or ""),
                "actor_name": str(technician.get("name") or "Technician"),
                "evidence_type": "system_initialized",
                "detail": "Nexus created the required first-use technician onboarding checklist.",
            }
        ],
    }


def _normalise_progress(technician: dict[str, Any]) -> dict[str, Any]:
    """Fill harmless legacy omissions without trusting client-supplied state."""
    existing = technician.get("technician_onboarding")
    if not isinstance(existing, dict) or not existing.get("steps"):
        return build_technician_onboarding(technician=technician)

    # Keep historic evidence verbatim but repair fields a UI needs to make a
    # deterministic compliance decision.  Version upgrades do not erase prior
    # evidence; a future deliberate retraining migration can add a new version.
    steps = existing.get("steps") if isinstance(existing.get("steps"), dict) else {}
    normalised_steps: dict[str, dict[str, Any]] = {}
    for definition in TECHNICIAN_ONBOARDING_STEPS:
        source = steps.get(definition["id"]) if isinstance(steps.get(definition["id"]), dict) else {}
        normalised_steps[definition["id"]] = {
            **_step_state(definition),
            **{key: value for key, value in source.items() if key not in {"id", "title", "description", "workspace", "evidence_expectation"}},
            **definition,
            "required": True,
        }

    completed = all(step.get("status") == "completed" for step in normalised_steps.values())
    step_completion_times = [
        str(step.get("completed_at"))
        for step in normalised_steps.values()
        if step.get("completed_at")
    ]
    completion_at = existing.get("completed_at") or (max(step_completion_times) if completed and step_completion_times else None)
    return {
        **existing,
        "version": existing.get("version") or TECHNICIAN_ONBOARDING_VERSION,
        "status": "compliant" if completed else (existing.get("status") if existing.get("status") in {"not_started", "in_progress"} else "in_progress"),
        "is_compliant": completed,
        "must_complete_before_operational_work": not completed,
        "technician_id": str(technician.get("id") or existing.get("technician_id") or ""),
        "completed_at": completion_at if completed else None,
        "completed_by_id": existing.get("completed_by_id") or (str(technician.get("id") or "") if completed else None),
        "steps": normalised_steps,
        "audit_log": existing.get("audit_log") if isinstance(existing.get("audit_log"), list) else [],
    }


def progress_summary(progress: dict[str, Any]) -> dict[str, Any]:
    """Expose a UI-safe, explicit compliance contract for a technician."""
    steps = progress.get("steps", {})
    ordered_steps = [steps[definition["id"]] for definition in TECHNICIAN_ONBOARDING_STEPS]
    completed_steps = sum(step.get("status") == "completed" for step in ordered_steps)
    next_step = next((step for step in ordered_steps if step.get("status") != "completed"), None)
    total_steps = len(ordered_steps)
    return {
        **progress,
        "steps": ordered_steps,
        "completed_steps": completed_steps,
        "total_required_steps": total_steps,
        "completion_percent": round((completed_steps / total_steps) * 100) if total_steps else 100,
        "next_step": next_step,
        "attestation": {
            "required": True,
            "text": _ACKNOWLEDGEMENT,
            "evidence_scope": "Technician onboarding acknowledgement only; operational records remain the evidence for real work.",
        },
    }


async def get_or_create_technician_onboarding(database: Any, technician: dict[str, Any]) -> dict[str, Any]:
    """Load the account-owned progress record, creating it once for legacy users."""
    progress = _normalise_progress(technician)
    existing = technician.get("technician_onboarding")
    if progress != existing:
        await database.users.update_one(
            {"id": str(technician.get("id") or "")},
            {"$set": {"technician_onboarding": progress}},
        )
    return progress_summary(progress)


async def complete_technician_onboarding_step(
    database: Any,
    *,
    technician: dict[str, Any],
    step_id: str,
    acknowledged: bool,
) -> tuple[dict[str, Any], bool]:
    """Complete one self-attested step once and return ``(progress, changed)``.

    The conditional update is deliberately idempotent: a double-click, retry,
    or concurrent request returns the existing evidence instead of appending a
    second completion event or changing its original timestamp.
    """
    if step_id not in _STEP_IDS:
        raise ValueError("Unknown technician onboarding step")
    if acknowledged is not True:
        raise ValueError("Acknowledge the auditable-work statement before completing this step")

    progress = await get_or_create_technician_onboarding(database, technician)
    by_id = str(technician.get("id") or "")
    existing_step = next((step for step in progress["steps"] if step.get("id") == step_id), None)
    if existing_step and existing_step.get("status") == "completed":
        return progress, False

    now = _now()
    audit_event = {
        "id": str(uuid4()),
        "action": "technician_onboarding_step_completed",
        "step_id": step_id,
        "occurred_at": now,
        "actor_id": by_id,
        "actor_name": str(technician.get("name") or "Technician"),
        "evidence_type": "technician_attestation",
        "detail": _ACKNOWLEDGEMENT,
    }

    current_steps = {item["id"]: item for item in progress["steps"]}
    current_steps[step_id] = {
        **current_steps[step_id],
        "status": "completed",
        "completed_at": now,
        "completed_by_id": by_id,
        "completed_by_name": str(technician.get("name") or "Technician"),
        "evidence": {
            "id": audit_event["id"],
            "type": "technician_attestation",
            "acknowledged_at": now,
            "acknowledged_by_id": by_id,
        },
    }
    all_completed = all(item.get("status") == "completed" for item in current_steps.values())
    next_status = "compliant" if all_completed else "in_progress"
    update = {
        "technician_onboarding.steps." + step_id + ".status": "completed",
        "technician_onboarding.steps." + step_id + ".completed_at": now,
        "technician_onboarding.steps." + step_id + ".completed_by_id": by_id,
        "technician_onboarding.steps." + step_id + ".completed_by_name": str(technician.get("name") or "Technician"),
        "technician_onboarding.steps." + step_id + ".evidence": current_steps[step_id]["evidence"],
        "technician_onboarding.status": next_status,
        "technician_onboarding.is_compliant": all_completed,
        "technician_onboarding.must_complete_before_operational_work": not all_completed,
        "technician_onboarding.updated_at": now,
    }
    if all_completed:
        update.update({
            "technician_onboarding.completed_at": now,
            "technician_onboarding.completed_by_id": by_id,
        })

    result = await database.users.update_one(
        {
            "id": by_id,
            f"technician_onboarding.steps.{step_id}.status": {"$ne": "completed"},
        },
        {"$set": update, "$push": {"technician_onboarding.audit_log": audit_event}},
    )
    changed = bool(getattr(result, "matched_count", 0))
    refreshed = await database.users.find_one({"id": by_id}, {"_id": 0})
    if not refreshed:
        raise LookupError("Technician not found")
    return await get_or_create_technician_onboarding(database, refreshed), changed


def technician_onboarding_summary(technician: dict[str, Any]) -> dict[str, Any]:
    """Return a compact, non-sensitive Team Hub projection."""
    progress = progress_summary(_normalise_progress(technician))
    return {
        "technician_id": str(technician.get("id") or ""),
        "technician_name": str(technician.get("name") or "Technician"),
        "role": technician.get("role") or "technician",
        "status": progress["status"],
        "is_compliant": progress["is_compliant"],
        "must_complete_before_operational_work": progress["must_complete_before_operational_work"],
        "completed_steps": progress["completed_steps"],
        "total_required_steps": progress["total_required_steps"],
        "completion_percent": progress["completion_percent"],
        "completed_at": progress.get("completed_at"),
        "updated_at": progress.get("updated_at"),
        "next_step_id": (progress.get("next_step") or {}).get("id"),
    }
