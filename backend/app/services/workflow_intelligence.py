"""Evidence-led technician workflow guidance.

This module deliberately turns only retained Nexus records into a *reviewable*
next step.  It does not infer a root cause, call a provider, alter a ticket or
start a remote session.  The same projection can be used by tickets, devices,
remote access and Nexus Work Session without giving each workspace its own
unaccountable heuristic.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


RESOLVED_TICKET_STATES = {"resolved", "closed", "completed"}
OFFLINE_DEVICE_STATES = {"offline", "unreachable", "disconnected"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(value: Any) -> str:
    return str(value or "").strip()


def _state(value: Any) -> str:
    return _text(value).lower().replace(" ", "_")


def _number(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _ticket_label(ticket: dict[str, Any]) -> str:
    return _text(ticket.get("ticket_number")) or _text(ticket.get("id")) or "Ticket"


def _device_label(device: dict[str, Any] | None) -> str:
    if not device:
        return "the linked endpoint"
    return _text(device.get("name")) or _text(device.get("hostname")) or "the linked endpoint"


def _evidence(
    source: str,
    title: str,
    detail: str,
    route: str,
    *,
    recorded_at: str | None = None,
) -> dict[str, Any]:
    return {
        "source": source,
        "title": title,
        "detail": detail,
        "route": route,
        "recorded_at": recorded_at or None,
    }


def _recommendation(
    *,
    key: str,
    title: str,
    detail: str,
    why: str,
    priority: str,
    route: str,
    action_label: str,
    evidence_count: int,
) -> dict[str, Any]:
    """Return a non-executing hand-off with explainable recorded evidence."""
    return {
        "key": key,
        "title": title,
        "detail": detail,
        "why": why,
        "priority": priority,
        "handoff": {"route": route, "label": action_label, "executes_action": False},
        "confidence": {
            "label": "Recorded evidence",
            "evidence_count": evidence_count,
            "statement": "This is a prioritised hand-off from retained Nexus records, not a diagnosis or an automatic action.",
        },
    }


def build_ticket_next_best_action(
    ticket: dict[str, Any],
    *,
    device: dict[str, Any] | None = None,
    active_work_session: dict[str, Any] | None = None,
    latest_snapshot: dict[str, Any] | None = None,
    latest_remote_session: dict[str, Any] | None = None,
    related_open_ticket_count: int = 0,
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Project one technician-safe next action from bounded ticket context.

    The caller must already have authorised the ticket and any associated
    records.  This pure function makes the decision order independently
    testable and preserves every signal that led to the recommendation.
    """
    ticket_id = _text(ticket.get("id"))
    ticket_route = f"/tickets?ticket={ticket_id}"
    work_session_route = f"/work-session?ticket={ticket_id}"
    linked_device_ids = ticket.get("device_ids")
    fallback_device_id = linked_device_ids[0] if isinstance(linked_device_ids, list) and linked_device_ids else None
    device_id = _text((device or {}).get("id") or ticket.get("device_id") or fallback_device_id)
    device_route = f"/devices/{device_id}" if device_id else ticket_route
    evidence = [
        _evidence(
            "ticket",
            f"{_ticket_label(ticket)} · {_text(ticket.get('status')) or 'status not recorded'}",
            _text(ticket.get("title")) or "Ticket context is available for review.",
            ticket_route,
            recorded_at=_text(ticket.get("updated_at") or ticket.get("created_at")) or None,
        )
    ]
    data_gaps: list[dict[str, str]] = []

    if device:
        device_state = _state(device.get("status")) or "status_not_recorded"
        last_seen = _text(device.get("last_seen") or device.get("last_heartbeat"))
        device_detail = f"Recorded endpoint state: {device_state.replace('_', ' ')}"
        if last_seen:
            device_detail += f" · last observation {last_seen}"
        evidence.append(_evidence("device", _device_label(device), device_detail, device_route, recorded_at=last_seen or None))
        if not last_seen:
            data_gaps.append({
                "key": "device_observation_missing",
                "title": "No current endpoint observation is retained",
                "detail": "Nexus cannot treat the device as healthy or unreachable until an agent or other authorised source records a fresh observation.",
                "route": device_route,
            })
    elif device_id:
        # The ticket referenced an endpoint that could not be proved to belong
        # to the same client.  Withhold it instead of exposing cross-client
        # device metadata.
        data_gaps.append({
            "key": "linked_device_unavailable",
            "title": "Linked endpoint context is unavailable",
            "detail": "The ticket references a device, but Nexus could not safely use it as this client's endpoint evidence.",
            "route": ticket_route,
        })
    else:
        data_gaps.append({
            "key": "device_not_linked",
            "title": "No endpoint is linked to this ticket",
            "detail": "Attach the affected device if the request involves an endpoint so diagnostics and remote evidence can be correlated safely.",
            "route": ticket_route,
        })

    if active_work_session:
        evidence.append(_evidence(
            "work_session",
            "Active Nexus Work Session",
            f"Started by {_text(active_work_session.get('technician')) or 'a technician'}; completion has not yet been recorded.",
            work_session_route,
            recorded_at=_text(active_work_session.get("started_at")) or None,
        ))

    if latest_snapshot:
        change_count = _number(latest_snapshot.get("change_count"))
        categories = [str(item) for item in (latest_snapshot.get("changed_categories") or []) if str(item).strip()]
        snapshot_detail = "Latest retained endpoint snapshot"
        if change_count:
            snapshot_detail += f" records {change_count} changed item{'s' if change_count != 1 else ''}"
        else:
            snapshot_detail += " records no compared state changes"
        if categories:
            snapshot_detail += f" across {', '.join(categories[:4])}"
        evidence.append(_evidence(
            "time_machine",
            "Endpoint Time Machine snapshot",
            snapshot_detail + ".",
            device_route,
            recorded_at=_text(latest_snapshot.get("captured_at") or latest_snapshot.get("last_observed_at")) or None,
        ))
    elif device:
        data_gaps.append({
            "key": "time_machine_evidence_missing",
            "title": "No retained endpoint comparison is available",
            "detail": "Nexus cannot explain what changed on this endpoint until at least two agent-observed snapshots have been retained.",
            "route": device_route,
        })

    if latest_remote_session:
        remote_status = _state(latest_remote_session.get("status")) or "status_not_recorded"
        evidence.append(_evidence(
            "remote",
            "Most recent remote session",
            f"Recorded as {remote_status.replace('_', ' ')}. A launch is not treated as connected or billable without the recorded session lifecycle.",
            device_route,
            recorded_at=_text(latest_remote_session.get("started_at") or latest_remote_session.get("ended_at")) or None,
        ))

    related_open_ticket_count = _number(related_open_ticket_count)
    if related_open_ticket_count > 1:
        evidence.append(_evidence(
            "ticket_history",
            "Related active ticket history",
            f"{related_open_ticket_count} active tickets are recorded for this endpoint at this client, including the current ticket.",
            ticket_route,
        ))

    ticket_status = _state(ticket.get("status"))
    sla_state = _state(ticket.get("sla_status") or ticket.get("sla_state"))
    sla_breached = bool(ticket.get("sla_breached")) or sla_state in {"breached", "overdue"}
    blocked_reference = _text(ticket.get("blocked_by_ticket_number") or ticket.get("blocked_by_ticket_id"))
    assigned = _text(ticket.get("assignee_id") or ticket.get("assigned_to") or ticket.get("assigned_to_id"))
    device_state = _state((device or {}).get("status"))
    failing_checks = _number((device or {}).get("checks_failing"))
    changed_items = _number((latest_snapshot or {}).get("change_count"))

    if ticket_status in RESOLVED_TICKET_STATES:
        recommendation = _recommendation(
            key="review_outcome_evidence",
            title="Review the recorded outcome before reopening work",
            detail="This ticket is already resolved or closed. Confirm the retained resolution evidence and customer follow-up before starting new work.",
            why="The ticket status is retained as resolved or closed.",
            priority="low",
            route=ticket_route,
            action_label="Review ticket outcome",
            evidence_count=len(evidence),
        )
    elif sla_breached:
        recommendation = _recommendation(
            key="escalate_sla_risk",
            title="Escalate the recorded SLA risk",
            detail="The ticket retains a breached or overdue SLA state. Confirm ownership, customer impact and the escalation path before further routine work.",
            why="Nexus found an explicit retained SLA breach state; it did not calculate one from an unverified timestamp.",
            priority="critical",
            route=ticket_route,
            action_label="Review escalation in ticket",
            evidence_count=len(evidence),
        )
    elif blocked_reference:
        recommendation = _recommendation(
            key="review_recorded_blocker",
            title="Review the recorded blocker first",
            detail=f"This ticket is marked as blocked by {blocked_reference}. Validate the dependency rather than continuing work that cannot yet complete.",
            why="The ticket retains an explicit blocker reference.",
            priority="high",
            route=ticket_route,
            action_label="Open ticket dependency",
            evidence_count=len(evidence),
        )
    elif not assigned:
        recommendation = _recommendation(
            key="establish_ticket_ownership",
            title="Establish accountable ticket ownership",
            detail="No assignee is retained for this active ticket. Assign or route it before requesting remote access or starting chargeable work.",
            why="The ticket does not retain an assigned technician or owner.",
            priority="high",
            route=ticket_route,
            action_label="Assign or route ticket",
            evidence_count=len(evidence),
        )
    elif active_work_session:
        recommendation = _recommendation(
            key="resume_work_session",
            title="Resume the accountable work session",
            detail="A Nexus Work Session is already active. Continue from its collected context and review the completion pack once the work is verified.",
            why="An active work-session record is linked to this ticket.",
            priority="medium",
            route=work_session_route,
            action_label="Resume Work Session",
            evidence_count=len(evidence),
        )
    elif device_state in OFFLINE_DEVICE_STATES:
        recommendation = _recommendation(
            key="validate_endpoint_reachability",
            title="Validate endpoint reachability before remote work",
            detail=f"{_device_label(device)} is recorded as {device_state.replace('_', ' ')}. Review the latest observation and consent-safe remote options before attempting remediation.",
            why="The linked endpoint's retained state is not online.",
            priority="high",
            route=device_route,
            action_label="Review endpoint evidence",
            evidence_count=len(evidence),
        )
    elif failing_checks:
        recommendation = _recommendation(
            key="investigate_recorded_checks",
            title="Investigate the recorded endpoint checks",
            detail=f"{_device_label(device)} retains {failing_checks} failing check{'s' if failing_checks != 1 else ''}. Review the device evidence before choosing a safe diagnostic or remediation path.",
            why="The linked endpoint retains a non-zero failing-check count.",
            priority="high" if failing_checks >= 3 else "medium",
            route=device_route,
            action_label="Open device diagnostics",
            evidence_count=len(evidence),
        )
    elif changed_items:
        recommendation = _recommendation(
            key="review_observed_endpoint_change",
            title="Review the observed endpoint changes",
            detail="A retained endpoint snapshot differs from its predecessor. Compare the source evidence before treating the change as the cause of this ticket.",
            why="The Time Machine snapshot records compared changes; Nexus does not infer causation.",
            priority="medium",
            route=device_route,
            action_label="Open Time Machine evidence",
            evidence_count=len(evidence),
        )
    else:
        recommendation = _recommendation(
            key="start_accountable_work_session",
            title="Start an accountable Work Session",
            detail="Nexus has ticket context but no active work-session record. Start one to collect the diagnosis, time, notes, customer update and verification review in one governed flow.",
            why="No higher-priority retained blocker, ownership gap, SLA risk or endpoint signal was found in the available context.",
            priority="medium",
            route=work_session_route,
            action_label="Start Work Session",
            evidence_count=len(evidence),
        )

    return {
        "generated_at": generated_at or now_iso(),
        "ticket": {
            "id": ticket_id,
            "ticket_number": _text(ticket.get("ticket_number")) or None,
            "title": _text(ticket.get("title")) or "Untitled ticket",
            "client_id": _text(ticket.get("client_id")) or None,
            "device_id": device_id or None,
        },
        "recommendation": recommendation,
        "evidence": evidence,
        "data_gaps": data_gaps,
        "boundary": "Nexus presents retained, authorised evidence and a reviewable hand-off. It does not diagnose a root cause, claim an outcome, start remote access, change a ticket, or perform remediation from this surface.",
    }
