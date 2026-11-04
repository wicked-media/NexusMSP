"""Honest platform-health projection.

This is a read-only platform-operator view. It does not make an availability
claim from a process heartbeat alone: every component records the evidence it
has, and an absent SLO or signal remains ``not_measured``.
"""

from __future__ import annotations

from typing import Any, Mapping

HEALTH_STATES = frozenset({"healthy", "attention", "degraded", "not_measured"})

BOUNDARY = (
    "Platform-operator read-only evidence. API execution proves this request reached Nexus; "
    "it does not prove a configured availability SLO. Unavailable telemetry is not measured."
)


def _component(component_id: str, label: str, state: str, detail: str, evidence: Mapping[str, Any]) -> dict[str, Any]:
    if state not in HEALTH_STATES:
        raise ValueError(f"unknown platform health state '{state}'")
    return {
        "id": component_id,
        "label": label,
        "state": state,
        "detail": detail,
        "evidence": dict(evidence),
    }


def build_snapshot(*, database_reachable: bool, event_backbone: Mapping[str, Any], active_agents: int,
                   reporting_agents: int, tenant_isolation_evidence: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Build a disclosed health snapshot from already-collected platform evidence."""
    event_state = str(event_backbone.get("status") or "not_measured")
    if event_state not in HEALTH_STATES:
        event_state = "attention"
    agent_state = "not_measured" if active_agents <= 0 else (
        "healthy" if reporting_agents >= active_agents else "attention"
    )
    isolation = dict(tenant_isolation_evidence or {})
    isolation_state = str(isolation.get("state") or "not_measured")
    if isolation_state not in HEALTH_STATES:
        isolation_state = "not_measured"
    components = [
        _component("api", "Nexus API", "healthy", "This authenticated Platform Health request completed.", {"request_completed": True}),
        _component(
            "database", "MongoDB", "healthy" if database_reachable else "degraded",
            "Database ping succeeded." if database_reachable else "Database ping failed; platform records may be unavailable.",
            {"ping": "ok" if database_reachable else "failed"},
        ),
        _component(
            "event-backbone", "Event backbone", event_state,
            f"{event_backbone.get('queue_depth', 0)} queued, {event_backbone.get('dead_letter', 0)} dead-letter deliveries.",
            {key: event_backbone.get(key) for key in ("queue_depth", "dead_letter", "delivery_success_rate", "checked_at")},
        ),
        _component(
            "agents", "Agent connectivity", agent_state,
            ("No active agents are recorded, so agent connectivity is not measured." if active_agents <= 0
             else f"{reporting_agents} of {active_agents} active agent(s) reported inside the platform window."),
            {"active_agents": active_agents, "reporting_agents": reporting_agents, "window_hours": 24},
        ),
        _component(
            "tenant-isolation", "Tenant isolation evidence", isolation_state,
            str(isolation.get("detail") or "No independent tenant-isolation runtime evidence is configured."),
            {key: value for key, value in isolation.items() if key not in {"state", "detail"}},
        ),
    ]
    summary = {state: sum(component["state"] == state for component in components) for state in sorted(HEALTH_STATES)}
    return {"components": components, "summary": summary, "boundary": BOUNDARY}
