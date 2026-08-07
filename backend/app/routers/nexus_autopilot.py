"""Permission-based autonomy for NexusMSP.

Nexus Autopilot is a governance layer over the existing agent, workflow,
approval, maintenance-window, and event-backbone services.  This router never
executes an endpoint or provider action directly.  It calculates the effective
autonomy boundary, presents evidence-backed candidates, and records
non-mutating simulations.  Live work must still enter the approved automation
runtime and its connector-specific controls.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.agent_trust import agent_trust_state
from app.services.platform_foundation import emit_platform_event, request_correlation_id
from app.services.scope_permissions import effective_scope, scoped_query


router = APIRouter(tags=["Nexus Autopilot"])


AUTONOMY_LEVELS = (
    {
        "level": 0,
        "name": "Observe",
        "short_name": "Suggest only",
        "description": "Explain evidence and recommend a next action. No operational action can be dispatched.",
        "capability": "Recommendations, evidence links, simulations, and technician handoff.",
    },
    {
        "level": 1,
        "name": "Assist",
        "short_name": "Safe actions",
        "description": "Allow only explicitly selected low-impact actions on trusted Nexus Agent endpoints.",
        "capability": "One bounded endpoint action with validation, ticket linkage, and rollback guidance.",
    },
    {
        "level": 2,
        "name": "Resolve",
        "short_name": "Policy resolution",
        "description": "Resolve eligible service work through approved, simulated workflows.",
        "capability": "Approved ticket-resolution workflows inside client and confidence policy.",
    },
    {
        "level": 3,
        "name": "Maintain",
        "short_name": "Approved windows",
        "description": "Orchestrate approved maintenance inside recorded change windows.",
        "capability": "Patching, scripts, and restarts only through approved maintenance controls.",
    },
    {
        "level": 4,
        "name": "Operate",
        "short_name": "Overnight operations",
        "description": "Coordinate pre-approved overnight operations inside strict client, action, and volume boundaries.",
        "capability": "Policy-bounded overnight work; protected identity, security, billing, and containment actions remain human-approved.",
    },
)


SAFE_ACTIONS = (
    {"id": "restart-service", "label": "Restart approved service", "minimum_level": 1, "risk": "low", "rollback": "Restore the recorded service start state and validate dependencies."},
    {"id": "clear-temp-files", "label": "Clear approved temporary files", "minimum_level": 1, "risk": "low", "rollback": "Stop cleanup and retain deletion evidence; restore only from the approved recovery source."},
    {"id": "flush-dns-cache", "label": "Refresh endpoint DNS cache", "minimum_level": 1, "risk": "low", "rollback": "Restore the recorded DNS client configuration if resolution regresses."},
    {"id": "restart-spooler", "label": "Recover print spooler", "minimum_level": 1, "risk": "low", "rollback": "Restore the captured queue and service configuration when available."},
    {"id": "create-ticket", "label": "Create and route a linked ticket", "minimum_level": 2, "risk": "low", "rollback": "Close the generated ticket with a cancellation reason; retain its history."},
    {"id": "add-ticket-note", "label": "Add an auditable ticket note", "minimum_level": 2, "risk": "low", "rollback": "Add a correcting note; historical notes are not silently removed."},
    {"id": "retry-backup", "label": "Retry an approved backup job", "minimum_level": 2, "risk": "medium", "rollback": "Stop the retry, preserve the failed run, and return the job to its recorded schedule."},
    {"id": "run-approved-script", "label": "Run an approved script", "minimum_level": 3, "risk": "high", "rollback": "Run the script-specific tested rollback through the governed runtime."},
    {"id": "install-approved-patches", "label": "Install approved software patches", "minimum_level": 3, "risk": "high", "rollback": "Use the recorded uninstall or recovery plan and validate endpoint health."},
    {"id": "reboot-device", "label": "Restart a managed endpoint", "minimum_level": 3, "risk": "medium", "rollback": "A restart cannot be reversed; validate service recovery and escalate failure."},
)
SAFE_ACTION_BY_ID = {item["id"]: item for item in SAFE_ACTIONS}

PROTECTED_CATEGORIES = {"security", "identity", "billing", "containment", "certificate"}

DEFAULT_POLICY = {
    "enabled": False,
    "paused": False,
    "configured_level": 0,
    "confidence_threshold": 0.90,
    "allowed_client_ids": [],
    "allowed_action_ids": [
        "restart-service",
        "clear-temp-files",
        "flush-dns-cache",
        "restart-spooler",
        "create-ticket",
        "add-ticket-note",
    ],
    "ticket_link_required": True,
    "maintenance_window_required": True,
    "protected_actions_human_only": True,
    "overnight_enabled": False,
    "max_actions_per_run": 3,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _actor(user: dict) -> str:
    return user.get("name") or user.get("email") or user.get("id") or "Unknown technician"


def _tenant_id(user: dict) -> str:
    return str(user.get("tenant_id") or "nexus-local")


def normalise_autopilot_policy(payload: dict | None, current: dict | None = None) -> dict:
    """Return one validated policy while preserving server-managed metadata."""
    payload = payload or {}
    merged = {**DEFAULT_POLICY, **(current or {}), **payload}
    try:
        level = int(merged.get("configured_level", 0))
    except (TypeError, ValueError) as error:
        raise ValueError("Autopilot level must be a number from 0 to 4") from error
    if level not in range(5):
        raise ValueError("Autopilot level must be between 0 and 4")

    try:
        confidence = float(merged.get("confidence_threshold", 0.90))
    except (TypeError, ValueError) as error:
        raise ValueError("Confidence threshold must be a decimal between 0.70 and 0.99") from error
    if not 0.70 <= confidence <= 0.99:
        raise ValueError("Confidence threshold must be between 0.70 and 0.99")

    try:
        max_actions = int(merged.get("max_actions_per_run", 3))
    except (TypeError, ValueError) as error:
        raise ValueError("Maximum actions per run must be a number") from error
    if not 1 <= max_actions <= 10:
        raise ValueError("Maximum actions per run must be between 1 and 10")

    client_ids = sorted({
        str(item).strip()
        for item in (merged.get("allowed_client_ids") or [])
        if str(item).strip()
    })
    if len(client_ids) > 200:
        raise ValueError("Autopilot policy supports a maximum of 200 explicitly selected clients")

    action_ids = sorted({
        str(item).strip()
        for item in (merged.get("allowed_action_ids") or [])
        if str(item).strip()
    })
    unknown_actions = [item for item in action_ids if item not in SAFE_ACTION_BY_ID]
    if unknown_actions:
        raise ValueError(f"Unknown Autopilot action: {unknown_actions[0]}")

    policy = {
        key: value
        for key, value in merged.items()
        if key not in {"_id", "effective_level", "highest_ready_level", "readiness"}
    }
    policy.update({
        "enabled": bool(merged.get("enabled")),
        "paused": bool(merged.get("paused")),
        "configured_level": level,
        "confidence_threshold": round(confidence, 2),
        "allowed_client_ids": client_ids,
        "allowed_action_ids": action_ids,
        "ticket_link_required": True,
        "maintenance_window_required": True,
        "protected_actions_human_only": True,
        "overnight_enabled": bool(merged.get("overnight_enabled")),
        "max_actions_per_run": max_actions,
    })
    return policy


def build_autopilot_readiness(policy: dict, facts: dict) -> dict:
    """Build sequential readiness gates and cap the effective autonomy level."""
    requirements = {
        0: [
            ("event_ledger", bool(facts.get("event_ledger_ready")), "Tamper-evident operational history is available."),
            ("simulation", True, "Simulation remains non-mutating at every level."),
        ],
        1: [
            ("trusted_agent", int(facts.get("trusted_agents") or 0) > 0, "At least one enrolled agent has an issued identity and acknowledged policy."),
            ("client_scope", len(policy.get("allowed_client_ids") or []) > 0, "At least one client is explicitly in scope."),
            ("safe_actions", any(SAFE_ACTION_BY_ID.get(action, {}).get("minimum_level") == 1 for action in policy.get("allowed_action_ids") or []), "At least one Level 1 action is allow-listed."),
            ("kill_switch", True, "Technicians can immediately return Autopilot to Observe."),
        ],
        2: [
            ("approved_workflow", int(facts.get("approved_workflows") or 0) > 0, "At least one workflow is approved and enabled."),
            ("simulation_evidence", int(facts.get("workflow_simulations") or 0) > 0, "A retained workflow simulation is available."),
            ("ticket_link", bool(policy.get("ticket_link_required")), "Every resolution must retain ticket context."),
        ],
        3: [
            ("maintenance_control", int(facts.get("maintenance_controls") or 0) > 0, "At least one recorded maintenance-window control exists."),
            ("maintenance_required", bool(policy.get("maintenance_window_required")), "Disruptive actions are restricted to approved windows."),
            ("rollback_evidence", bool(facts.get("rollback_ready")), "The runtime records before-state and compensation checkpoints."),
        ],
        4: [
            ("overnight_scope", bool(policy.get("overnight_enabled")), "Overnight orchestration is explicitly enabled."),
            ("protected_approval", bool(policy.get("protected_actions_human_only")), "Protected actions always require a human decision."),
            ("bounded_volume", int(policy.get("max_actions_per_run") or 99) <= 5, "Overnight runs are limited to five actions or fewer."),
            ("high_confidence", float(policy.get("confidence_threshold") or 0) >= 0.90, "The minimum confidence gate is at least 90%."),
        ],
    }

    levels = []
    previous_ready = True
    highest_ready = 0
    for definition in AUTONOMY_LEVELS:
        level = definition["level"]
        gates = [
            {"id": gate_id, "passed": bool(passed), "detail": detail}
            for gate_id, passed, detail in requirements[level]
        ]
        ready = previous_ready and all(gate["passed"] for gate in gates)
        if ready:
            highest_ready = level
        levels.append({
            **definition,
            "ready": ready,
            "status": "ready" if ready else "attention" if previous_ready else "locked",
            "gates": gates,
            "blocking_count": sum(not gate["passed"] for gate in gates),
        })
        previous_ready = ready

    configured = int(policy.get("configured_level") or 0)
    effective = 0 if policy.get("paused") or not policy.get("enabled") else min(configured, highest_ready)
    return {
        "levels": levels,
        "highest_ready_level": highest_ready,
        "effective_level": effective,
        "configured_level": configured,
        "capped": bool(policy.get("enabled") and configured > highest_ready),
        "mode": "paused" if policy.get("paused") else "observe" if effective == 0 else "active",
    }


def _confidence_tier(confidence: float) -> dict:
    score = max(0.0, min(float(confidence or 0), 1.0))
    if score >= 0.95:
        return {"id": "high", "label": "High confidence", "tone": "emerald"}
    if score >= 0.85:
        return {"id": "strong", "label": "Strong evidence", "tone": "cyan"}
    if score >= 0.70:
        return {"id": "review", "label": "Human review", "tone": "amber"}
    return {"id": "insufficient", "label": "Insufficient evidence", "tone": "red"}


def _candidate_action(category: str, proposed_action: str = "") -> str:
    category = str(category or "").lower()
    action_text = str(proposed_action or "").lower()
    if "spool" in action_text:
        return "restart-spooler"
    if "dns" in category or "dns" in action_text:
        return "flush-dns-cache"
    if category == "disk" or "temp" in action_text or "recycle" in action_text:
        return "clear-temp-files"
    if category == "backup":
        return "retry-backup"
    if category in {"service", "performance"}:
        return "restart-service"
    return "create-ticket"


def _candidate_minimum_level(category: str, action_id: str) -> int:
    base = int(SAFE_ACTION_BY_ID.get(action_id, {}).get("minimum_level") or 2)
    if str(category or "").lower() in PROTECTED_CATEGORIES:
        return max(2, base)
    return base


def build_autopilot_simulation(candidate: dict, policy: dict, readiness: dict, context: dict) -> dict:
    """Create a transparent, non-mutating Autopilot plan."""
    action = SAFE_ACTION_BY_ID.get(candidate.get("action_id")) or SAFE_ACTION_BY_ID["create-ticket"]
    confidence = float(candidate.get("confidence") or 0)
    category = str(candidate.get("category") or "operations").lower()
    protected = category in PROTECTED_CATEGORIES
    required_level = int(candidate.get("minimum_level") or action["minimum_level"])
    blockers = []

    if policy.get("paused"):
        blockers.append("Autopilot is paused by the kill switch.")
    elif not policy.get("enabled"):
        blockers.append("Autopilot is in Observe mode; enable a governed level before operational handoff.")
    if readiness.get("effective_level", 0) < required_level:
        blockers.append(f"This plan requires Level {required_level}; the effective boundary is Level {readiness.get('effective_level', 0)}.")
    if candidate.get("client_id") not in (policy.get("allowed_client_ids") or []):
        blockers.append("The client is not explicitly included in the Autopilot scope.")
    if candidate.get("action_id") not in (policy.get("allowed_action_ids") or []):
        blockers.append("The proposed action is not in the Autopilot allow-list.")
    if confidence < float(policy.get("confidence_threshold") or 0.90):
        blockers.append(f"Evidence confidence is below the {round(float(policy.get('confidence_threshold') or 0.90) * 100)}% policy gate.")
    if policy.get("ticket_link_required") and not candidate.get("ticket_id"):
        blockers.append("A linked service ticket is required before operational handoff.")
    if candidate.get("simulated_source"):
        blockers.append("Simulated source evidence can be reviewed but is never eligible for live handoff.")
    if candidate.get("endpoint_action") and not context.get("trusted_endpoint"):
        blockers.append("The target is not mapped to a currently trusted Nexus Agent endpoint.")

    requires_approval = protected or action["risk"] in {"medium", "high"} or required_level >= 2
    steps = [
        {
            "step": 1,
            "label": "Validate source evidence",
            "system": candidate.get("source_label") or "Nexus evidence",
            "before": "Retained detection, client, endpoint, and confidence evidence.",
            "after": "Evidence is current, attributable, and inside the selected client scope.",
            "rollback": "No change is made; discard the plan if evidence is stale or ambiguous.",
        },
        {
            "step": 2,
            "label": "Check policy boundary",
            "system": "Nexus Autopilot",
            "before": f"Configured Level {readiness.get('configured_level', 0)}; effective Level {readiness.get('effective_level', 0)}.",
            "after": f"{action['label']} is checked against client, action, confidence, ticket, and volume policy.",
            "rollback": "No change is made; lower the scope or return the item to technician review.",
        },
        {
            "step": 3,
            "label": action["label"],
            "system": "Governed automation runtime",
            "before": "The runtime must capture live before-state immediately before any approved execution.",
            "after": candidate.get("proposed_action") or f"{action['label']} completes with connector evidence retained.",
            "rollback": action["rollback"],
        },
        {
            "step": 4,
            "label": "Validate and hand over",
            "system": "Ticket, timeline, and Black Box",
            "before": "The service outcome is unverified.",
            "after": "Outcome, exception, technician ownership, and correlation evidence are linked to the service record.",
            "rollback": "Reopen or escalate the ticket and preserve the failed validation evidence.",
        },
    ]

    return {
        "id": f"AUTOSIM-{uuid.uuid4().hex[:8].upper()}",
        "candidate_id": candidate["id"],
        "candidate": candidate,
        "mode": "simulation",
        "status": "blocked" if blockers else "ready_for_approval" if requires_approval else "eligible_for_governed_handoff",
        "will_execute": False,
        "requires_human_approval": requires_approval,
        "protected_category": protected,
        "required_level": required_level,
        "configured_level": readiness.get("configured_level", 0),
        "effective_level": readiness.get("effective_level", 0),
        "confidence": confidence,
        "confidence_tier": _confidence_tier(confidence),
        "blockers": blockers,
        "steps": steps,
        "systems": sorted({step["system"] for step in steps}),
        "rollback_plan": [step["rollback"] for step in reversed(steps)],
        "approval_path": (
            "Technician review → independent change approval → governed runtime → validation"
            if requires_approval
            else "Governed runtime → validation → retained evidence"
        ),
        "policy_snapshot": {
            "allowed_client_ids": policy.get("allowed_client_ids") or [],
            "allowed_action_ids": policy.get("allowed_action_ids") or [],
            "confidence_threshold": policy.get("confidence_threshold"),
            "max_actions_per_run": policy.get("max_actions_per_run"),
            "protected_actions_human_only": True,
        },
    }


async def _load_policy(user: dict) -> dict:
    await _ensure_indexes()
    tenant_id = _tenant_id(user)
    stored = await db.autopilot_policies.find_one({"tenant_id": tenant_id}, {"_id": 0}) or {}
    return normalise_autopilot_policy(stored)


async def _ensure_indexes() -> None:
    await db.autopilot_policies.create_index("tenant_id", unique=True, name="autopilot_policy_tenant")
    await db.autopilot_decisions.create_index(
        [("tenant_id", 1), ("occurred_at", -1)],
        name="autopilot_decision_tenant_time",
    )
    await db.autopilot_simulations.create_index(
        [("tenant_id", 1), ("simulated_at", -1)],
        name="autopilot_simulation_tenant_time",
    )


async def _collect_facts(user: dict) -> dict:
    agents = await db.nexus_agents.find(
        scoped_query(user, {"is_active": True}, site_field=None),
        {
            "_id": 0,
            "id": 1,
            "device_identity": 1,
            "policy_evidence": 1,
            "self_repair": 1,
            "update_evidence": 1,
        },
    ).to_list(10_000)
    trusted_agents = 0
    for agent in agents:
        trust = agent_trust_state(agent)
        identity_ready = trust.get("status") in {"certificate_issued", "mtls_verified"}
        policy_ready = (agent.get("policy_evidence") or {}).get("status") == "acknowledged"
        if identity_ready and policy_ready:
            trusted_agents += 1

    return {
        "active_agents": len(agents),
        "trusted_agents": trusted_agents,
        "approved_workflows": await db.workflows.count_documents(
            {"enabled": True, "approval_status": {"$in": ["approved", "not_required"]}}
            if effective_scope(user)["mode"] == "all"
            else scoped_query(user, {"enabled": True, "approval_status": {"$in": ["approved", "not_required"]}}, site_field=None)
        ),
        "workflow_simulations": await db.workflow_simulations.count_documents(
            {"will_execute": False}
            if effective_scope(user)["mode"] == "all"
            else scoped_query(user, {"will_execute": False}, site_field=None)
        ),
        "maintenance_controls": await db.maintenance_windows.count_documents(
            {"status": {"$in": ["scheduled", "dispatching", "running", "completed"]}}
            if effective_scope(user)["mode"] == "all"
            else {"id": {"$exists": False}}
        ),
        "pending_approvals": await db.workflow_run_approvals.count_documents({"status": "pending"}),
        "event_ledger_ready": await db.platform_events.count_documents({}) > 0,
        "rollback_ready": True,
    }


async def _collect_candidates(user: dict, limit: int = 30) -> list[dict]:
    visible_clients = await db.clients.find(
        scoped_query(user, {}, site_field=None),
        {"_id": 0, "id": 1, "name": 1},
    ).to_list(10_000)
    client_id_by_name = {
        str(client.get("name") or "").casefold(): client.get("id")
        for client in visible_clients
        if client.get("id") and client.get("name")
    }
    visible_client_ids = {client["id"] for client in visible_clients if client.get("id")}
    full_scope = effective_scope(user)["mode"] == "all"
    resolution_items = await db.ai_resolution_queue.find(
        {"status": {"$in": ["pending_approval", "manual_required"]}},
        {"_id": 0},
    ).sort("detected_at", -1).to_list(limit)
    healing_items = await db.self_healing_events.find(
        {"status": {"$in": ["detected", "matched", "failed", "escalated"]}},
        {"_id": 0},
    ).sort("detected_at", -1).to_list(limit)

    candidates = []
    for item in resolution_items:
        client_id = item.get("client_id") or client_id_by_name.get(str(item.get("client") or "").casefold())
        if not full_scope and client_id not in visible_client_ids:
            continue
        action_id = _candidate_action(item.get("category"), item.get("action"))
        confidence = float(item.get("confidence") or 0) / 100
        category = str(item.get("category") or "operations").lower()
        candidates.append({
            "id": f"resolution:{item['id']}",
            "source_id": item["id"],
            "source": "ai_resolution",
            "source_label": "AI resolution queue",
            "title": item.get("issue") or "Resolution review",
            "client_id": client_id,
            "client_name": item.get("client") or "Unmapped client",
            "device_id": item.get("device_id"),
            "device_name": item.get("device"),
            "detected_at": item.get("detected_at"),
            "category": category,
            "severity": item.get("severity") or ("high" if category in PROTECTED_CATEGORIES else "medium"),
            "confidence": confidence,
            "confidence_tier": _confidence_tier(confidence),
            "runbook": item.get("runbook"),
            "proposed_action": item.get("action"),
            "action_id": action_id,
            "action_label": SAFE_ACTION_BY_ID[action_id]["label"],
            "minimum_level": _candidate_minimum_level(category, action_id),
            "ticket_id": item.get("ticket_id") or item.get("escalation_ticket_id"),
            "endpoint_action": action_id not in {"create-ticket", "add-ticket-note"},
            "simulated_source": bool(item.get("simulated")),
        })

    for item in healing_items:
        client_id = item.get("client_id") or client_id_by_name.get(str(item.get("client_name") or "").casefold())
        if not full_scope and client_id not in visible_client_ids:
            continue
        action_id = _candidate_action(item.get("category"), item.get("issue_description"))
        confidence = float(item.get("confidence_pct") or 0) / 100
        category = str(item.get("category") or "operations").lower()
        candidates.append({
            "id": f"healing:{item['id']}",
            "source_id": item["id"],
            "source": "self_healing",
            "source_label": "Self-healing evidence",
            "title": item.get("issue_description") or "Recovery review",
            "client_id": client_id,
            "client_name": item.get("client_name") or "Unmapped client",
            "device_id": item.get("device_id"),
            "device_name": item.get("device_name"),
            "detected_at": item.get("detected_at"),
            "category": category,
            "severity": item.get("severity") or "medium",
            "confidence": confidence,
            "confidence_tier": _confidence_tier(confidence),
            "runbook": item.get("matched_runbook"),
            "proposed_action": f"Run the approved {item.get('matched_runbook') or 'recovery'} plan and validate the endpoint.",
            "action_id": action_id,
            "action_label": SAFE_ACTION_BY_ID[action_id]["label"],
            "minimum_level": _candidate_minimum_level(category, action_id),
            "ticket_id": item.get("ticket_id") or item.get("escalation_ticket_id"),
            "endpoint_action": action_id not in {"create-ticket", "add-ticket-note"},
            "simulated_source": bool(item.get("simulated")),
        })

    candidates.sort(key=lambda item: item.get("detected_at") or "", reverse=True)
    return candidates[:limit]


async def _endpoint_context(candidate: dict) -> dict:
    device = None
    client_clause = {"client_id": candidate["client_id"]} if candidate.get("client_id") else {}
    if candidate.get("device_id"):
        device = await db.devices.find_one(
            {"id": candidate["device_id"], **client_clause},
            {"_id": 0},
        )
    if not device and candidate.get("device_name"):
        device = await db.devices.find_one({
            "$and": [
                client_clause,
                {"$or": [
                    {"name": candidate["device_name"]},
                    {"hostname": candidate["device_name"]},
                ]},
            ]
        }, {"_id": 0})
    agent = None
    if device and device.get("nexus_agent_id"):
        agent = await db.nexus_agents.find_one(
            {"id": device["nexus_agent_id"], "is_active": True},
            {"_id": 0},
        )
    trusted = False
    trust = None
    if agent:
        trust = agent_trust_state(agent)
        trusted = (
            trust.get("status") in {"certificate_issued", "mtls_verified"}
            and (agent.get("policy_evidence") or {}).get("status") == "acknowledged"
        )
    return {
        "device_id": (device or {}).get("id"),
        "agent_id": (agent or {}).get("id"),
        "trusted_endpoint": trusted,
        "trust": trust,
    }


@router.get("/autopilot/overview")
async def autopilot_overview(current_user: dict = Depends(get_current_user)):
    policy = await _load_policy(current_user)
    facts = await _collect_facts(current_user)
    readiness = build_autopilot_readiness(policy, facts)
    clients = await db.clients.find(
        scoped_query(current_user, {}, site_field=None),
        {"_id": 0, "id": 1, "name": 1},
    ).sort("name", 1).to_list(500)
    candidates = await _collect_candidates(current_user)
    history = await db.autopilot_decisions.find(
        {"tenant_id": _tenant_id(current_user)},
        {"_id": 0},
    ).sort("occurred_at", -1).to_list(12)
    eligible = sum(
        candidate["minimum_level"] <= readiness["effective_level"]
        and candidate.get("client_id") in policy.get("allowed_client_ids", [])
        and candidate.get("action_id") in policy.get("allowed_action_ids", [])
        and candidate.get("confidence", 0) >= policy.get("confidence_threshold", 0.90)
        for candidate in candidates
    )
    return {
        "policy": policy,
        "readiness": readiness,
        "facts": facts,
        "levels": AUTONOMY_LEVELS,
        "actions": SAFE_ACTIONS,
        "clients": clients,
        "candidates": candidates,
        "history": history,
        "summary": {
            "effective_level": readiness["effective_level"],
            "configured_level": readiness["configured_level"],
            "candidate_count": len(candidates),
            "eligible_count": eligible,
            "pending_approvals": facts["pending_approvals"],
            "trusted_agents": facts["trusted_agents"],
        },
        "governance": {
            "direct_execution": False,
            "simulation_first": True,
            "protected_actions_human_only": True,
            "live_handoff": "Approved Nexus Automation runtime",
            "kill_switch": True,
        },
    }


@router.put("/autopilot/policy")
async def update_autopilot_policy(
    payload: dict,
    request: Request,
    current_user: dict = Depends(require_action("automation.autopilot.manage")),
):
    current = await _load_policy(current_user)
    try:
        policy = normalise_autopilot_policy(payload, current)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error

    if policy["allowed_client_ids"]:
        existing = {
            row["id"]
            for row in await db.clients.find(
                scoped_query(
                    current_user,
                    {"id": {"$in": policy["allowed_client_ids"]}},
                    site_field=None,
                ),
                {"_id": 0, "id": 1},
            ).to_list(500)
        }
        unknown = [client_id for client_id in policy["allowed_client_ids"] if client_id not in existing]
        if unknown:
            raise HTTPException(400, f"Unknown client scope: {unknown[0]}")

    now = _now()
    policy.update({
        "tenant_id": _tenant_id(current_user),
        "updated_at": now,
        "updated_by": _actor(current_user),
        "updated_by_id": current_user.get("id"),
    })
    await db.autopilot_policies.replace_one(
        {"tenant_id": policy["tenant_id"]},
        policy,
        upsert=True,
    )
    facts = await _collect_facts(current_user)
    readiness = build_autopilot_readiness(policy, facts)
    decision = {
        "id": f"AUTO-{uuid.uuid4().hex[:8].upper()}",
        "tenant_id": policy["tenant_id"],
        "type": "policy_changed",
        "summary": f"Configured Level {policy['configured_level']}; effective Level {readiness['effective_level']}.",
        "configured_level": policy["configured_level"],
        "effective_level": readiness["effective_level"],
        "actor": _actor(current_user),
        "actor_id": current_user.get("id"),
        "occurred_at": now,
    }
    await db.autopilot_decisions.insert_one(decision)
    await emit_platform_event(
        subject="autopilot.policy.changed",
        source="nexus.autopilot",
        payload={
            "configured_level": policy["configured_level"],
            "effective_level": readiness["effective_level"],
            "client_scope_count": len(policy["allowed_client_ids"]),
            "allowed_action_count": len(policy["allowed_action_ids"]),
            "paused": policy["paused"],
        },
        actor=current_user,
        tenant_id=policy["tenant_id"],
        correlation_id=request_correlation_id(request),
    )
    return {"policy": policy, "readiness": readiness}


@router.post("/autopilot/simulate")
async def simulate_autopilot_candidate(
    payload: dict,
    request: Request,
    current_user: dict = Depends(require_action("automation.autopilot.simulate")),
):
    candidate_id = str(payload.get("candidate_id") or "").strip()
    candidates = await _collect_candidates(current_user, limit=100)
    candidate = next((item for item in candidates if item["id"] == candidate_id), None)
    if not candidate:
        raise HTTPException(404, "Autopilot candidate not found or no longer requires review")

    policy = await _load_policy(current_user)
    facts = await _collect_facts(current_user)
    readiness = build_autopilot_readiness(policy, facts)
    context = await _endpoint_context(candidate)
    simulation = build_autopilot_simulation(candidate, policy, readiness, context)
    simulation.update({
        "tenant_id": _tenant_id(current_user),
        "simulated_by": _actor(current_user),
        "simulated_by_id": current_user.get("id"),
        "simulated_at": _now(),
        "correlation_id": request_correlation_id(request),
    })
    await db.autopilot_simulations.insert_one(simulation)
    await db.autopilot_decisions.insert_one({
        "id": f"AUTO-{uuid.uuid4().hex[:8].upper()}",
        "tenant_id": simulation["tenant_id"],
        "type": "simulation_completed",
        "summary": f"{candidate['title']} → {simulation['status']}",
        "candidate_id": candidate_id,
        "simulation_id": simulation["id"],
        "actor": _actor(current_user),
        "actor_id": current_user.get("id"),
        "occurred_at": simulation["simulated_at"],
    })
    await emit_platform_event(
        subject="autopilot.simulation.completed",
        source="nexus.autopilot",
        payload={
            "simulation_id": simulation["id"],
            "candidate_id": candidate_id,
            "status": simulation["status"],
            "blocker_count": len(simulation["blockers"]),
            "requires_human_approval": simulation["requires_human_approval"],
            "will_execute": False,
        },
        actor=current_user,
        tenant_id=simulation["tenant_id"],
        client_id=candidate.get("client_id"),
        correlation_id=simulation["correlation_id"],
    )
    simulation.pop("_id", None)
    return simulation


@router.post("/autopilot/pause")
async def pause_autopilot(
    payload: dict,
    request: Request,
    current_user: dict = Depends(require_action("automation.autopilot.pause")),
):
    reason = str(payload.get("reason") or "").strip()
    if len(reason) < 8:
        raise HTTPException(400, "Record a pause reason of at least 8 characters")
    policy = await _load_policy(current_user)
    now = _now()
    policy.update({
        "paused": True,
        "tenant_id": _tenant_id(current_user),
        "paused_at": now,
        "paused_by": _actor(current_user),
        "pause_reason": reason,
        "updated_at": now,
    })
    await db.autopilot_policies.replace_one({"tenant_id": policy["tenant_id"]}, policy, upsert=True)
    decision = {
        "id": f"AUTO-{uuid.uuid4().hex[:8].upper()}",
        "tenant_id": policy["tenant_id"],
        "type": "paused",
        "summary": reason,
        "actor": _actor(current_user),
        "actor_id": current_user.get("id"),
        "occurred_at": now,
    }
    await db.autopilot_decisions.insert_one(decision)
    await emit_platform_event(
        subject="autopilot.paused",
        source="nexus.autopilot",
        payload={"reason": reason, "configured_level": policy["configured_level"], "effective_level": 0},
        actor=current_user,
        tenant_id=policy["tenant_id"],
        correlation_id=request_correlation_id(request),
    )
    return {"status": "paused", "effective_level": 0, "policy": policy}


@router.post("/autopilot/resume")
async def resume_autopilot(
    payload: dict,
    request: Request,
    current_user: dict = Depends(require_action("automation.autopilot.manage")),
):
    reason = str(payload.get("reason") or "").strip()
    if len(reason) < 12:
        raise HTTPException(400, "Record a resume reason of at least 12 characters")
    policy = await _load_policy(current_user)
    if not policy.get("enabled") or int(policy.get("configured_level") or 0) < 1:
        raise HTTPException(409, "Configure and enable an Autopilot level before resuming")
    candidate_policy = {**policy, "paused": False}
    readiness = build_autopilot_readiness(candidate_policy, await _collect_facts(current_user))
    if readiness["effective_level"] < 1:
        raise HTTPException(409, "Level 1 readiness gates are not satisfied; review the Autopilot ladder")

    now = _now()
    candidate_policy.update({
        "tenant_id": _tenant_id(current_user),
        "resumed_at": now,
        "resumed_by": _actor(current_user),
        "resume_reason": reason,
        "updated_at": now,
    })
    await db.autopilot_policies.replace_one(
        {"tenant_id": candidate_policy["tenant_id"]},
        candidate_policy,
        upsert=True,
    )
    await db.autopilot_decisions.insert_one({
        "id": f"AUTO-{uuid.uuid4().hex[:8].upper()}",
        "tenant_id": candidate_policy["tenant_id"],
        "type": "resumed",
        "summary": reason,
        "configured_level": candidate_policy["configured_level"],
        "effective_level": readiness["effective_level"],
        "actor": _actor(current_user),
        "actor_id": current_user.get("id"),
        "occurred_at": now,
    })
    await emit_platform_event(
        subject="autopilot.resumed",
        source="nexus.autopilot",
        payload={
            "reason": reason,
            "configured_level": candidate_policy["configured_level"],
            "effective_level": readiness["effective_level"],
        },
        actor=current_user,
        tenant_id=candidate_policy["tenant_id"],
        correlation_id=request_correlation_id(request),
    )
    return {"status": "active", "policy": candidate_policy, "readiness": readiness}
