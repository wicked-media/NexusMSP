"""Read-only composition helpers for Nexus Proving Ground.

Proving Ground is deliberately an evidence workbench over the existing
Automation Studio simulation and change-approval ledgers.  It never receives a
live-execution request and it never becomes a second workflow authority.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any


SIMULATION_STATUS_ORDER = {"blocked": 0, "ready_for_approval": 1, "safe_to_run": 2}
RUNNING_STATUSES = frozenset({"queued", "running", "waiting", "awaiting_approval"})


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(value: Any, fallback: str = "Not recorded") -> str:
    value = str(value or "").strip()
    return value or fallback


def _int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _safe_simulation(item: dict[str, Any]) -> dict[str, Any]:
    """Return presentation-safe simulation evidence without action payloads."""
    summary = item.get("summary") if isinstance(item.get("summary"), dict) else {}
    context = item.get("context") if isinstance(item.get("context"), dict) else {}
    return {
        "id": _text(item.get("id"), "Unknown simulation"),
        "workflow_id": _text(item.get("workflow_id"), ""),
        "workflow_name": _text(item.get("workflow_name"), "Untitled workflow"),
        "client_id": _text(item.get("client_id") or context.get("client_id"), ""),
        "client_name": _text(context.get("client_name") or item.get("client_name"), "Scoped client"),
        "status": _text(item.get("status"), "not_proven"),
        "risk_level": _text(item.get("risk_level"), "unknown"),
        "requires_approval": bool(item.get("requires_approval")),
        "will_execute": False,
        "steps": _int(summary.get("steps")),
        "systems": _int(summary.get("systems")),
        "configuration_gaps": _int(summary.get("configuration_gaps")),
        "simulated_at": item.get("simulated_at"),
        "simulated_by": _text(item.get("simulated_by"), "Nexus user"),
    }


def _safe_workflow(item: dict[str, Any]) -> dict[str, Any]:
    scope = item.get("scope") if isinstance(item.get("scope"), dict) else {}
    return {
        "id": _text(item.get("id"), "Unknown workflow"),
        "name": _text(item.get("name"), "Untitled workflow"),
        "description": _text(item.get("description"), "No workflow description has been recorded."),
        "enabled": bool(item.get("enabled")),
        "approval_status": _text(item.get("approval_status"), "not_submitted"),
        "simulation_count": _int(item.get("simulation_count")),
        "last_simulated_at": item.get("last_simulated_at"),
        "scope_type": _text(scope.get("type"), "not_recorded"),
        "scope_client_id": _text(scope.get("client_id") or item.get("client_id"), ""),
    }


def _safe_run(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _text(item.get("id"), "Unknown run"),
        "workflow_id": _text(item.get("workflow_id"), ""),
        "workflow_name": _text(item.get("workflow_name"), "Untitled workflow"),
        "client_id": _text(item.get("client_id"), ""),
        "client_name": _text(item.get("client_name"), "Scoped client"),
        "status": _text(item.get("status"), "unknown"),
        "created_at": item.get("created_at"),
        "updated_at": item.get("updated_at"),
        "correlation_id": _text(item.get("correlation_id"), ""),
    }


def _safe_approval(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _text(item.get("id"), "Unknown change"),
        "workflow_id": _text(item.get("workflow_id"), ""),
        "simulation_id": _text(item.get("simulation_id"), ""),
        "title": _text(item.get("title"), "Workflow approval"),
        "client_id": _text(item.get("client_id"), ""),
        "client_name": _text(item.get("client_name"), "Scoped client"),
        "status": _text(item.get("status"), "unknown"),
        "risk_level": _text(item.get("risk_level"), "unknown"),
        "created_at": item.get("created_at"),
    }


def compose_proving_ground(
    *,
    workflows: list[dict[str, Any]],
    simulations: list[dict[str, Any]],
    runs: list[dict[str, Any]],
    approvals: list[dict[str, Any]],
    readiness: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compose an honest, bounded overview from durable source records."""
    safe_simulations = sorted(
        (_safe_simulation(item) for item in simulations),
        key=lambda item: (item.get("simulated_at") or "", item["id"]),
        reverse=True,
    )
    safe_workflows = sorted(
        (_safe_workflow(item) for item in workflows),
        key=lambda item: (not item["enabled"], -item["simulation_count"], item["name"].casefold()),
    )
    safe_runs = sorted(
        (_safe_run(item) for item in runs),
        key=lambda item: (item.get("updated_at") or item.get("created_at") or "", item["id"]),
        reverse=True,
    )
    safe_approvals = sorted(
        (_safe_approval(item) for item in approvals),
        key=lambda item: (item.get("created_at") or "", item["id"]),
        reverse=True,
    )

    simulation_counts = Counter(item["status"] for item in safe_simulations)
    active_runs = [item for item in safe_runs if item["status"] in RUNNING_STATUSES]
    configuration_gaps = sum(item["configuration_gaps"] for item in safe_simulations)
    approval_required = sum(1 for item in safe_simulations if item["requires_approval"])
    workflow_ready = sum(
        1
        for item in safe_workflows
        if item["enabled"] and item["approval_status"] in {"approved", "not_required"}
    )

    return {
        "generated_at": utc_now(),
        "boundary": (
            "Proving Ground reads retained workflow, simulation, run and approval evidence. "
            "It cannot execute a workflow, approve a change or contact a provider. "
            "Use Automation Studio for a governed simulation and Change Control for approval."
        ),
        "summary": {
            "workflows": len(safe_workflows),
            "workflows_ready": workflow_ready,
            "simulations": len(safe_simulations),
            "safe_to_run": simulation_counts["safe_to_run"],
            "ready_for_approval": simulation_counts["ready_for_approval"],
            "blocked": simulation_counts["blocked"],
            "configuration_gaps": configuration_gaps,
            "approval_boundaries": approval_required + len(safe_approvals),
            "active_runs": len(active_runs),
        },
        "workflows": safe_workflows[:60],
        "simulations": safe_simulations[:60],
        "runs": safe_runs[:60],
        "approval_queue": safe_approvals[:60],
        "readiness": readiness or {
            "state": "not_authorised",
            "label": "Launch-gate evidence is restricted",
            "detail": "Your role can review the scoped proving evidence but cannot view the MSP-wide production-readiness register.",
            "items": [],
        },
    }
