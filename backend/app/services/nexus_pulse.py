"""Derived, scope-safe operational evidence for Nexus Pulse."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


FRESH_DEVICE_SECONDS = 15 * 60
ONLINE_AGENT_SECONDS = 3 * 60
OPEN_TICKET_STATUSES = frozenset({"open", "new", "in_progress", "pending", "waiting", "on_hold", "escalated"})
ACTIVE_AUTOMATION_STATUSES = frozenset({"queued", "running", "waiting", "awaiting_approval"})
FAILURE_STATUSES = frozenset({"failed", "error", "attention", "warning"})


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def latest_observation(record: dict[str, Any], fields: tuple[str, ...]) -> datetime | None:
    return max((parsed for field in fields if (parsed := parse_time(record.get(field))) is not None), default=None)


def device_observation_state(record: dict[str, Any], *, now: datetime) -> tuple[str, datetime | None]:
    observed = latest_observation(record, ("last_heartbeat", "last_seen", "telemetry_at", "observed_at"))
    if observed is None:
        return "not_proven", None
    age = max(0, int((now - observed).total_seconds()))
    return ("observed" if age <= FRESH_DEVICE_SECONDS else "stale"), observed


def agent_observation_state(record: dict[str, Any], *, now: datetime) -> tuple[str, datetime | None]:
    observed = latest_observation(record, ("last_seen", "last_heartbeat", "observed_at"))
    if observed is None:
        return "not_proven", None
    age = max(0, int((now - observed).total_seconds()))
    return ("online" if age <= ONLINE_AGENT_SECONDS else "offline"), observed


def _safe_name(record: dict[str, Any], fallback: str) -> str:
    value = str(record.get("name") or record.get("title") or record.get("hostname") or "").strip()
    return value or fallback


def _signal(signal_id: str, label: str, state: str, value: str | int, detail: str, route: str | None, source: str) -> dict[str, Any]:
    return {
        "id": signal_id,
        "label": label,
        "state": state,
        "value": value,
        "detail": detail,
        "route": route,
        "source": source,
    }


def compose_nexus_pulse(
    *,
    devices: list[dict[str, Any]],
    agents: list[dict[str, Any]],
    tickets: list[dict[str, Any]],
    automation_runs: list[dict[str, Any]],
    backup_jobs: list[dict[str, Any]],
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    """Compose observations without promoting absence of data to a healthy state."""
    now = generated_at or datetime.now(timezone.utc)
    fresh_devices = 0
    stale_devices: list[dict[str, Any]] = []
    freshness: list[dict[str, Any]] = []
    for device in devices:
        state, observed_at = device_observation_state(device, now=now)
        fresh_devices += int(state == "observed")
        if state != "observed":
            stale_devices.append({
                "id": str(device.get("id") or ""),
                "label": _safe_name(device, "Unnamed device"),
                "state": state,
                "observed_at": observed_at.isoformat() if observed_at else None,
                "route": f"/devices/{device.get('id')}" if device.get("id") else "/devices",
            })
        if observed_at:
            freshness.append({"source": "Device observation", "observed_at": observed_at.isoformat(), "state": state})

    online_agents = 0
    offline_agents: list[dict[str, Any]] = []
    for agent in agents:
        state, observed_at = agent_observation_state(agent, now=now)
        online_agents += int(state == "online")
        if state != "online":
            offline_agents.append({
                "id": str(agent.get("id") or ""),
                "label": _safe_name(agent, "Unnamed Nexus Agent"),
                "state": state,
                "observed_at": observed_at.isoformat() if observed_at else None,
                "route": "/nexus-agent",
            })
        if observed_at:
            freshness.append({"source": "Nexus Agent", "observed_at": observed_at.isoformat(), "state": state})

    open_tickets = [
        ticket for ticket in tickets
        if str(ticket.get("status") or "open").strip().lower() in OPEN_TICKET_STATUSES
    ]
    active_runs = [
        run for run in automation_runs
        if str(run.get("status") or "").strip().lower() in ACTIVE_AUTOMATION_STATUSES
    ]
    failed_backups = [
        job for job in backup_jobs
        if str(job.get("status") or job.get("state") or "").strip().lower() in FAILURE_STATUSES
    ]

    fleet_state = (
        "not_proven" if not devices and not agents
        else "attention" if stale_devices or offline_agents
        else "healthy"
    )
    work_state = "attention" if any(str(ticket.get("priority") or "").lower() in {"critical", "urgent"} for ticket in open_tickets) else ("healthy" if open_tickets or active_runs else "not_proven")
    recovery_state = "attention" if failed_backups else ("observed" if backup_jobs else "not_proven")
    signals = [
        _signal(
            "platform-request",
            "Nexus API evidence",
            "observed",
            "Available now",
            "This Pulse request reached the Nexus API and its scoped evidence sources. It is not a historical uptime claim.",
            None,
            "Current authenticated request",
        ),
        _signal(
            "managed-fleet",
            "Managed fleet",
            fleet_state,
            f"{fresh_devices}/{len(devices)} fresh",
            f"{len(stale_devices)} device observation gap(s) · {online_agents}/{len(agents)} active agent(s) online.",
            "/devices",
            "Devices and Nexus Agent observations",
        ),
        _signal(
            "service-work",
            "Service work",
            work_state,
            f"{len(open_tickets)} open",
            f"{len(active_runs)} active automation run(s) are retained within your permitted scope.",
            "/tickets",
            "Tickets and workflow-run ledger",
        ),
        _signal(
            "recovery-evidence",
            "Recovery evidence",
            recovery_state,
            f"{len(failed_backups)} attention",
            "Backup job status is operational evidence only; a successful job is not a completed restore test.",
            "/backup-center?tab=verify",
            "Backup Centre job observations",
        ),
    ]
    attention = [
        {
            "id": f"device-{item['id'] or index}",
            "kind": "device_observation",
            "label": item["label"],
            "detail": "No fresh device observation is retained." if item["state"] == "not_proven" else "The latest device observation is stale.",
            "route": item["route"],
            "state": item["state"],
        }
        for index, item in enumerate(stale_devices[:8])
    ] + [
        {
            "id": f"agent-{item['id'] or index}",
            "kind": "agent_observation",
            "label": item["label"],
            "detail": "No current Nexus Agent check-in is retained." if item["state"] == "not_proven" else "The Nexus Agent is outside its online observation window.",
            "route": item["route"],
            "state": item["state"],
        }
        for index, item in enumerate(offline_agents[:8])
    ] + [
        {
            "id": f"backup-{str(job.get('id') or index)}",
            "kind": "backup_job",
            "label": _safe_name(job, "Backup job needs attention"),
            "detail": "The retained backup job status needs review. Verify recovery independently before treating coverage as proven.",
            "route": "/backup-center?tab=live",
            "state": "attention",
        }
        for index, job in enumerate(failed_backups[:8])
    ]
    state_order = {"attention": 0, "not_proven": 1, "observed": 2, "healthy": 3}
    overall_state = min((signal["state"] for signal in signals), key=lambda state: state_order.get(state, 1))
    freshness.sort(key=lambda item: item["observed_at"], reverse=True)

    return {
        "generated_at": now.isoformat(),
        "boundary": (
            "Nexus Pulse shows the latest retained, scoped operational evidence. "
            "Missing, stale or unconfigured sources remain visible as not proven; Pulse never converts them into an all-clear."
        ),
        "overall_state": overall_state,
        "signals": signals,
        "summary": {
            "devices": len(devices),
            "fresh_devices": fresh_devices,
            "agents": len(agents),
            "online_agents": online_agents,
            "open_tickets": len(open_tickets),
            "active_runs": len(active_runs),
            "backup_attention": len(failed_backups),
            "attention": len(attention),
        },
        "attention": attention[:18],
        "freshness": freshness[:24],
    }
