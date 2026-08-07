"""Evidence-backed change impact previews for Nexus operational actions.

The guardian is a read model over current Nexus records. It does not claim to
simulate an endpoint, predict an exact outage, or replace an approval. Its job
is to expose attributable dependencies and change gates before execution.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable


GUARDIAN_SCHEMA_VERSION = 1

DEVICE_ACTIONS = {
    "run-checks": {
        "label": "Check agent connection",
        "base_risk": 5,
        "change_type": "read_only",
        "expected_outcome": "Nexus asks each eligible agent to return a bounded connectivity result.",
        "rollback": "No endpoint state is intentionally changed.",
    },
    "tag": {
        "label": "Apply asset tag",
        "base_risk": 10,
        "change_type": "metadata",
        "expected_outcome": "The supplied label is added to each selected managed-asset record.",
        "rollback": "Remove the tag from the affected asset records and retain the correction in audit history.",
    },
    "send-message": {
        "label": "Send endpoint message",
        "base_risk": 20,
        "change_type": "user_visible",
        "expected_outcome": "A time-bound message is displayed to signed-in users on eligible online endpoints.",
        "rollback": "A delivered message cannot be recalled. Send a correction and record the reason if the content was wrong.",
    },
    "install-patches": {
        "label": "Queue Windows updates",
        "base_risk": 35,
        "change_type": "configuration",
        "expected_outcome": "Applicable Windows software updates are queued through the trusted Nexus Agent on enrolled endpoints.",
        "rollback": "Validate each update result. Use the vendor-supported uninstall or recovery path for a failed update and link the outcome to the service record.",
    },
    "reboot": {
        "label": "Reboot endpoints",
        "base_risk": 40,
        "change_type": "service_interruption",
        "expected_outcome": "Eligible online endpoints restart, interrupting local sessions and hosted workloads until they check in again.",
        "rollback": "A reboot cannot be undone. Confirm the next trusted heartbeat and follow the linked incident or recovery plan if a workload does not return.",
    },
    "shutdown": {
        "label": "Shut down endpoints",
        "base_risk": 60,
        "change_type": "service_interruption",
        "expected_outcome": "Eligible online endpoints shut down and remain unavailable until an approved power-on path is used.",
        "rollback": "Use the approved physical, Wake-on-LAN, hypervisor, or out-of-band power-on path and confirm the next trusted heartbeat.",
    },
}

ACTIVE_TICKET_STATES = {"open", "in_progress", "pending", "waiting", "new"}
ACTIVE_SESSION_STATES = {"active", "connected", "connecting", "started", "in_progress"}
ACTIVE_BACKUP_STATES = {"running", "in_progress", "verifying", "restoring"}
ACTIVE_ALERT_STATES = {"active", "open", "triggered", "new"}


def _clean_ids(values: Iterable[Any]) -> list[str]:
    return sorted({str(value).strip() for value in values if str(value or "").strip()})


def _status(value: Any) -> str:
    return str(value or "").strip().lower().replace(" ", "_")


def risk_label(score: int) -> str:
    if score >= 75:
        return "critical"
    if score >= 50:
        return "high"
    if score >= 25:
        return "medium"
    return "low"


def _dependency(
    dependency_type: str,
    label: str,
    rows: list[dict],
    *,
    route: str | None = None,
    detail: str | None = None,
) -> dict:
    return {
        "type": dependency_type,
        "label": label,
        "count": len(rows),
        "route": route,
        "detail": detail,
        "records": rows[:25],
    }


def build_device_change_preview(
    *,
    action: str,
    requested_ids: Iterable[str],
    devices: list[dict],
    clients: list[dict] | None = None,
    tickets: list[dict] | None = None,
    sessions: list[dict] | None = None,
    backups: list[dict] | None = None,
    alerts: list[dict] | None = None,
    maintenance_windows: list[dict] | None = None,
    assessed_at: str | None = None,
) -> dict:
    """Create one explainable fleet-change preview from attributable records."""
    if action not in DEVICE_ACTIONS:
        raise ValueError(f"Unsupported device action: {action}")

    requested = _clean_ids(requested_ids)
    devices = list(devices or [])
    found_ids = _clean_ids(row.get("id") for row in devices)
    unavailable_ids = sorted(set(requested) - set(found_ids))
    clients = list(clients or [])
    tickets = [row for row in (tickets or []) if _status(row.get("status")) in ACTIVE_TICKET_STATES]
    sessions = [row for row in (sessions or []) if _status(row.get("status")) in ACTIVE_SESSION_STATES]
    backups = [row for row in (backups or []) if _status(row.get("status")) in ACTIVE_BACKUP_STATES]
    alerts = [row for row in (alerts or []) if _status(row.get("status")) in ACTIVE_ALERT_STATES]
    maintenance_windows = [
        row for row in (maintenance_windows or [])
        if _status(row.get("status")) in {"scheduled", "running", "in_progress"}
    ]

    client_ids = _clean_ids(row.get("client_id") for row in devices)
    online = [row for row in devices if _status(row.get("status")) == "online"]
    enrolled = [row for row in devices if row.get("nexus_agent_id") or row.get("agent_id")]
    servers = [row for row in devices if _status(row.get("device_type")) == "server"]
    assigned_people = sorted({
        str(row.get("assigned_user") or row.get("last_logged_in_user") or "").strip()
        for row in devices
        if str(row.get("assigned_user") or row.get("last_logged_in_user") or "").strip()
    })
    high_priority_tickets = [
        row for row in tickets
        if _status(row.get("priority")) in {"critical", "urgent", "high"}
    ]

    spec = DEVICE_ACTIONS[action]
    score = int(spec["base_risk"])
    score += min(25, len(servers) * 10)
    score += 25 if sessions and action in {"reboot", "shutdown", "install-patches"} else 0
    score += 15 if high_priority_tickets and action in {"reboot", "shutdown", "install-patches"} else 0
    score += 15 if backups and action in {"reboot", "shutdown"} else 0
    score += 15 if len(client_ids) > 1 else 0
    score += 20 if unavailable_ids else 0
    score += 10 if len(devices) >= 25 else 5 if len(devices) >= 10 else 0
    score = min(100, score)
    level = risk_label(score)

    agent_required = action not in {"tag"}
    eligible = [
        row for row in devices
        if (not agent_required or row in enrolled)
        and (action not in {"reboot", "shutdown", "send-message"} or row in online)
    ]
    ineligible_count = len(devices) - len(eligible) + len(unavailable_ids)

    gates = [
        {
            "id": "target_identity",
            "label": "Target identity",
            "state": "blocked" if unavailable_ids else "ready",
            "detail": (
                f"{len(unavailable_ids)} selected target(s) are missing or outside the current scope."
                if unavailable_ids else f"All {len(devices)} selected targets resolved to current Nexus asset records."
            ),
        },
        {
            "id": "agent_readiness",
            "label": "Agent readiness",
            "state": "review" if agent_required and len(enrolled) < len(devices) else "ready",
            "detail": (
                f"{len(enrolled)} of {len(devices)} targets have an attributable Nexus Agent identity."
                if agent_required else "This action changes Nexus metadata and does not require an endpoint agent."
            ),
        },
        {
            "id": "live_sessions",
            "label": "Active work",
            "state": "review" if sessions and action in {"reboot", "shutdown", "install-patches"} else "ready",
            "detail": f"{len(sessions)} active remote session(s) intersect the selected endpoints." if sessions else "No active remote sessions were found.",
        },
        {
            "id": "service_records",
            "label": "Open service work",
            "state": "review" if tickets and spec["change_type"] != "read_only" else "ready",
            "detail": f"{len(tickets)} open ticket(s), including {len(high_priority_tickets)} high-priority record(s), are linked to the targets." if tickets else "No open linked service records were found.",
        },
        {
            "id": "protection_activity",
            "label": "Protection activity",
            "state": "review" if backups and action in {"reboot", "shutdown"} else "ready",
            "detail": f"{len(backups)} running backup or recovery job(s) intersect the selected endpoints." if backups else "No running backup or recovery job was found.",
        },
        {
            "id": "maintenance_context",
            "label": "Maintenance context",
            "state": "ready" if maintenance_windows else ("review" if spec["change_type"] in {"configuration", "service_interruption"} else "ready"),
            "detail": f"{len(maintenance_windows)} active or scheduled maintenance window(s) cover at least one target." if maintenance_windows else "No matching maintenance window was found in retained Nexus records.",
        },
    ]

    dependencies = [
        _dependency(
            "clients", "Client boundaries",
            [{"id": row.get("id"), "name": row.get("name")} for row in clients],
            route="/clients", detail="Commercial and operational ownership of the selected assets.",
        ),
        _dependency(
            "people", "People using endpoints",
            [{"name": name} for name in assigned_people],
            detail="Assigned or last-observed users; absence is not treated as an unoccupied endpoint.",
        ),
        _dependency(
            "tickets", "Open service records",
            [{"id": row.get("id"), "name": row.get("title") or row.get("ticket_number"), "status": row.get("status"), "priority": row.get("priority")} for row in tickets],
            route="/tickets", detail="Open tickets directly linked to at least one selected endpoint.",
        ),
        _dependency(
            "remote", "Active remote sessions",
            [{"id": row.get("id"), "name": row.get("device_name") or row.get("device_id"), "status": row.get("status")} for row in sessions],
            route="/remote-access", detail="Sessions that may be interrupted by a service-impacting action.",
        ),
        _dependency(
            "backups", "Protection and recovery jobs",
            [{"id": row.get("id"), "name": row.get("name") or row.get("job_name") or row.get("device_id"), "status": row.get("status")} for row in backups],
            route="/backup-center", detail="Running backup, restore, or verification work attributable to a target.",
        ),
        _dependency(
            "alerts", "Active alerts",
            [{"id": row.get("id"), "name": row.get("title") or row.get("alert_type") or row.get("message"), "severity": row.get("severity")} for row in alerts],
            route="/alert-rules", detail="Current monitoring signals on the selected endpoints.",
        ),
    ]

    recommendations = []
    if sessions and action in {"reboot", "shutdown", "install-patches"}:
        recommendations.append("Coordinate or end active remote work before approving the change.")
    if high_priority_tickets:
        recommendations.append("Open the high-priority service record and confirm this action matches the current incident plan.")
    if backups and action in {"reboot", "shutdown"}:
        recommendations.append("Wait for the running backup or recovery work to finish, or record an approved interruption.")
    if servers:
        recommendations.append("Confirm hosted workloads and an approved recovery path for every selected server.")
    if len(client_ids) > 1:
        recommendations.append("Split this change by client unless one approved change record intentionally covers every customer.")
    if ineligible_count:
        recommendations.append("Remove unavailable, offline, or unenrolled targets before execution; Nexus will not infer readiness.")
    if not recommendations:
        recommendations.append("Confirm the target list and linked ticket, then proceed inside the normal approval boundary.")

    return {
        "schema_version": GUARDIAN_SCHEMA_VERSION,
        "entity_type": "device",
        "action": action,
        "action_label": spec["label"],
        "change_type": spec["change_type"],
        "assessed_at": assessed_at or datetime.now(timezone.utc).isoformat(),
        "risk": {
            "score": score,
            "level": level,
            "approval_required": level in {"high", "critical"},
            "method": "Deterministic evidence rules; no simulated endpoint outcome is claimed.",
        },
        "scope": {
            "requested": len(requested),
            "resolved": len(devices),
            "eligible": len(eligible),
            "ineligible": ineligible_count,
            "clients": len(client_ids),
            "servers": len(servers),
            "people": len(assigned_people),
            "unavailable_ids": unavailable_ids,
        },
        "expected_outcome": spec["expected_outcome"],
        "rollback": spec["rollback"],
        "execution_allowed": bool(eligible) and not unavailable_ids,
        "gates": gates,
        "dependencies": dependencies,
        "recommendations": recommendations,
        "evidence": {
            "sources": [
                "devices", "clients", "tickets", "remote_sessions",
                "backup_jobs", "alerts", "maintenance_windows",
            ],
            "record_count": (
                len(devices) + len(clients) + len(tickets) + len(sessions)
                + len(backups) + len(alerts) + len(maintenance_windows)
            ),
            "limitations": [
                "Only relationships attributable to current Nexus records are included.",
                "No matching record means unknown, not safe.",
                "The preview is a decision aid and does not execute or emulate the change.",
            ],
        },
    }

