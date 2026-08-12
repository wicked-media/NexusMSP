"""Evidence correlation and daily briefing for Nexus Mission Control.

Nexus Brain is deliberately deterministic at this stage. It joins live,
access-scoped records and explains each correlation instead of asking an LLM
to invent a narrative from incomplete operational data.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from app.database import db
from app.services.scope_permissions import scoped_query


ACTIVE_TICKET_STATUSES = ["open", "in_progress", "waiting", "pending"]


def _query(user: dict[str, Any], query: dict | None = None, *, field: str = "client_id") -> dict:
    return scoped_query(user, query or {}, field=field, site_field=None)


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _client_key(row: dict) -> str:
    return str(row.get("client_id") or row.get("client_name") or "").strip()


def _subject_label(subject: str) -> str:
    labels = {
        "automation.run.completed": "Automation completed",
        "automation.run.failed": "Automation stopped safely",
        "automation.approval.required": "Approval requested",
        "backup.job.failed": "Backup failure recorded",
        "device.connected": "Agent connected",
        "device.health.changed": "Device health changed",
        "invoice.reconciliation.failed": "Invoice reconciliation failed",
        "remote.session.ended": "Remote session completed",
        "remote.session.started": "Remote session started",
        "ticket.created": "Ticket created",
    }
    return labels.get(subject, subject.replace(".", " ").replace("_", " ").title())


def correlate_client_signals(
    *,
    clients: list[dict],
    devices: list[dict],
    failed_backups: list[dict],
    critical_tickets: list[dict],
    unbilled_time: list[dict],
) -> list[dict]:
    """Collapse multiple records for one client into one explainable insight."""
    client_names = {
        str(client.get("id") or client.get("name")): client.get("name") or "Client"
        for client in clients
        if client.get("id") or client.get("name")
    }
    client_ids_by_name = {
        str(client.get("name")): str(client.get("id"))
        for client in clients
        if client.get("name") and client.get("id")
    }
    signals: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))

    for device in devices:
        key = _client_key(device)
        if not key:
            continue
        if device.get("status") == "offline":
            signals[key]["offline_devices"].append(device)
        disk = max(
            _number(device.get("disk_percent")),
            _number(device.get("disk_usage")),
            _number(device.get("disk_usage_percent")),
            _number(device.get("storage_percent")),
        )
        if disk >= 90:
            signals[key]["storage_pressure"].append({**device, "observed_percent": round(disk, 1)})

    for row in failed_backups:
        key = _client_key(row)
        if key:
            signals[key]["failed_backups"].append(row)
    for row in critical_tickets:
        key = _client_key(row)
        if key:
            signals[key]["critical_tickets"].append(row)
    for row in unbilled_time:
        key = _client_key(row)
        if key:
            signals[key]["unbilled_time"].append(row)

    insights = []
    for key, grouped in signals.items():
        present = {name for name, rows in grouped.items() if rows}
        if len(present) < 2:
            continue

        client_id = key if key in client_names else client_ids_by_name.get(key)
        client_name = client_names.get(key) or key
        evidence = []
        if grouped["storage_pressure"]:
            peak = max(item["observed_percent"] for item in grouped["storage_pressure"])
            evidence.append({"label": "Storage pressure", "value": f"{peak:g}% peak"})
        if grouped["failed_backups"]:
            evidence.append({"label": "Failed backups", "value": len(grouped["failed_backups"])})
        if grouped["offline_devices"]:
            evidence.append({"label": "Offline assets", "value": len(grouped["offline_devices"])})
        if grouped["critical_tickets"]:
            evidence.append({"label": "Critical tickets", "value": len(grouped["critical_tickets"])})
        if grouped["unbilled_time"]:
            amount = sum(
                _number(row.get("total_amount"))
                or _number(row.get("hours")) * _number(row.get("hourly_rate"))
                for row in grouped["unbilled_time"]
            )
            evidence.append({"label": "Unbilled work", "value": f"${amount:,.2f}"})

        if {"storage_pressure", "failed_backups"} <= present:
            title = "Storage pressure may be contributing to backup failures"
            summary = (
                "Nexus found high storage utilisation and failed backup records for the same client. "
                "The relationship is plausible but should be verified in the backup and endpoint evidence."
            )
            recommendation = "Check backup error details and storage growth together before retrying or quoting capacity."
            outcomes = ["reduce_risk", "reduce_effort"]
            route = "/backup-center"
        elif {"offline_devices", "critical_tickets"} <= present:
            title = "Offline endpoints and critical service work should be handled together"
            summary = (
                "The same client has offline managed assets and active critical tickets. "
                "Opening one coordinated response avoids duplicate investigation."
            )
            recommendation = "Confirm whether the offline asset is linked to the critical ticket, then assign one owner and timeline."
            outcomes = ["reduce_risk", "reduce_effort"]
            route = f"/clients?client={client_id}" if client_id else "/clients"
        elif {"critical_tickets", "unbilled_time"} <= present:
            title = "High-impact client work contains unbilled effort"
            summary = (
                "Critical service work and billable time are both present for this client. "
                "Nexus cannot assume they are related, but the billing link should be reviewed before closure."
            )
            recommendation = "Review the ticket-to-time relationship and add approved billable work to the invoice workflow."
            outcomes = ["increase_revenue", "reduce_effort"]
            route = "/billing-recon"
        else:
            title = "Multiple client signals need one coordinated review"
            summary = (
                f"Nexus connected {len(present)} independent operational signals to {client_name}. "
                "Treat this as a correlation lead, not proof of a shared cause."
            )
            recommendation = "Open the client profile, validate the timeline and assign one owner for the combined review."
            outcomes = ["reduce_risk", "reduce_effort"]
            route = f"/clients?client={client_id}" if client_id else "/clients"

        confidence = min(97, 64 + len(present) * 8 + min(9, sum(len(rows) for rows in grouped.values())))
        insights.append({
            "id": f"brain-{client_id or key.lower().replace(' ', '-')}",
            "client_id": client_id,
            "client_name": client_name,
            "title": title,
            "summary": summary,
            "recommendation": recommendation,
            "confidence": confidence,
            "confidence_basis": f"{len(present)} signal types and {sum(len(rows) for rows in grouped.values())} matching records",
            "evidence": evidence,
            "outcomes": outcomes,
            "route": route,
        })

    insights.sort(key=lambda item: (item["confidence"], len(item["evidence"])), reverse=True)
    return insights[:6]


def build_value_proof(
    *,
    automated_actions: int,
    documented_minutes_saved: float,
    revenue_identified: float,
    healed_actions: int,
    script_actions: int,
    workflow_actions: int,
) -> dict:
    """Describe business value without promoting estimates into facts."""
    source_counts = {
        "self_healing_events": max(0, int(healed_actions)),
        "script_executions": max(0, int(script_actions)),
        "workflow_runs": max(0, int(workflow_actions)),
    }
    return {
        "headline": "Value proven from retained Nexus records",
        "metrics": [
            {
                "id": "actions_completed",
                "label": "Evidenced actions",
                "value": max(0, int(automated_actions)),
                "unit": "actions",
                "state": "evidenced",
                "detail": "Completed self-healing, script and workflow records",
                "sources": source_counts,
            },
            {
                "id": "time_returned",
                "label": "Documented time returned",
                "value": round(max(0.0, _number(documented_minutes_saved)), 1),
                "unit": "minutes",
                "state": "evidenced",
                "detail": "Only execution records carrying an explicit time-saved value",
                "sources": {"self_healing_events": source_counts["self_healing_events"]},
            },
            {
                "id": "revenue_identified",
                "label": "Revenue identified",
                "value": round(max(0.0, _number(revenue_identified)), 2),
                "unit": "AUD",
                "state": "review_required",
                "detail": "Unbilled time and ticket products requiring finance review; not claimed as recovered",
                "sources": {"billing_reconciliation": 1 if revenue_identified else 0},
            },
            {
                "id": "tickets_prevented",
                "label": "Tickets prevented",
                "value": None,
                "unit": "tickets",
                "state": "not_measured",
                "detail": "Requires an approved causal baseline before Nexus can make this claim",
                "sources": {},
            },
        ],
        "truth_standard": (
            "Nexus reports observed outcomes separately from opportunities. "
            "Estimated or causal claims remain unavailable until their evidence contract is satisfied."
        ),
    }


def build_continuous_improvements(
    *,
    revenue_found: float,
    insights: list[dict],
    recent_resolved_tickets: list[dict],
    recent_script_runs: list[dict],
    healed_month: int,
    detected_month: int,
) -> list[dict]:
    """Return a small, explainable improvement queue from retained records.

    These are deliberately review leads, not AI-created projects, causal claims,
    or automated remediations.  A technician must validate the evidence and
    choose the next controlled workflow.
    """
    candidates: list[dict] = []
    if revenue_found:
        candidates.append({
            "id": "improvement-billing-review",
            "title": "Resolve identified billing exceptions",
            "detail": f"${revenue_found:,.2f} of unbilled time or ticket product value needs finance review before it can be recognised.",
            "evidence": "Retained time-entry and ticket-product records",
            "route": "/billing-recon",
            "outcome": "increase_revenue",
            "state": "review_required",
            "priority": 100,
        })

    ticket_groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for ticket in recent_resolved_tickets:
        title = " ".join(str(ticket.get("title") or "").lower().split())
        client_id = str(ticket.get("client_id") or "")
        if title:
            ticket_groups[(client_id, title)].append(ticket)
    recurring = sorted(ticket_groups.items(), key=lambda item: len(item[1]), reverse=True)
    for (client_id, title), rows in recurring:
        if len(rows) < 3:
            continue
        candidates.append({
            "id": f"improvement-recurring-{client_id or 'unassigned'}-{abs(hash(title)) % 100000}",
            "title": "Investigate a recurring resolved issue",
            "detail": f"{len(rows)} resolved tickets share the same title in the last 30 days: {rows[0].get('title') or title}.",
            "evidence": "Repeated resolved ticket records; common cause is not yet confirmed",
            "route": f"/clients?client={client_id}" if client_id else "/tickets",
            "outcome": "reduce_effort",
            "state": "review_required",
            "priority": 90,
        })
        break

    script_groups: dict[str, int] = defaultdict(int)
    for run in recent_script_runs:
        name = str(run.get("script_name") or "").strip()
        if name:
            script_groups[name] += 1
    repeated_script = next(((name, count) for name, count in sorted(script_groups.items(), key=lambda item: item[1], reverse=True) if count >= 3), None)
    if repeated_script:
        name, count = repeated_script
        candidates.append({
            "id": "improvement-repeat-script",
            "title": "Review a repeated technician script for standardisation",
            "detail": f"{name} completed {count} times in the last 30 days. Review its evidence, permissions and rollback before creating an automation.",
            "evidence": "Completed script-execution records",
            "route": "/scripting",
            "outcome": "reduce_effort",
            "state": "review_required",
            "priority": 80,
        })

    if insights:
        lead = insights[0]
        candidates.append({
            "id": "improvement-correlation-lead",
            "title": "Turn a multi-signal client lead into one prevention plan",
            "detail": lead["title"],
            "evidence": lead["confidence_basis"],
            "route": lead["route"],
            "outcome": "reduce_risk",
            "state": "review_required",
            "priority": 70,
        })

    if detected_month >= 5 and healed_month < detected_month:
        candidates.append({
            "id": "improvement-self-healing",
            "title": "Review unresolved self-healing detections",
            "detail": f"{detected_month - healed_month} of {detected_month} retained self-healing detections were not recorded as healed in the last 30 days.",
            "evidence": "Retained self-healing event outcomes",
            "route": "/auto-ops?tab=self-healing",
            "outcome": "reduce_risk",
            "state": "review_required",
            "priority": 60,
        })

    return sorted(candidates, key=lambda item: item["priority"], reverse=True)[:5]


def build_diagnostic_queue(insights: list[dict]) -> list[dict]:
    """Turn retained correlations into safe diagnostic starting points.

    This is intentionally a *plan*, never an assertion that a check was run,
    a cause was found, or an endpoint was changed.  Each card links back to
    the evidence workspace where a technician can perform the authorised
    diagnostic.
    """
    queue: list[dict] = []
    for insight in insights:
        labels = {str(row.get("label") or "") for row in insight.get("evidence") or []}
        client_name = insight.get("client_name") or "this client"
        if {"Storage pressure", "Failed backups"} <= labels:
            queue.append({
                "id": f"diagnostic-storage-backup-{insight['id']}",
                "client_id": insight.get("client_id"),
                "title": "Validate backup capacity and failure evidence together",
                "detail": f"Start with the recorded backup error and current storage evidence for {client_name}; neither signal proves the other caused it.",
                "steps": [
                    "Open the failed backup job and read the retained error detail.",
                    "Confirm current free capacity and recent growth on the affected managed asset.",
                    "Record whether the backup target, source capacity, or another dependency is implicated.",
                ],
                "evidence": "Storage pressure and failed-backup records for the same client",
                "route": "/backup-center",
                "state": "read_only_plan",
            })
        elif {"Offline assets", "Critical tickets"} <= labels:
            queue.append({
                "id": f"diagnostic-offline-critical-{insight['id']}",
                "client_id": insight.get("client_id"),
                "title": "Validate whether the offline asset is part of the critical incident",
                "detail": f"Coordinate the existing critical work and endpoint evidence for {client_name} before opening duplicate investigations.",
                "steps": [
                    "Review the critical ticket timeline and affected service.",
                    "Confirm the offline asset identity, last check-in and ownership.",
                    "Link or separate the records only after the relationship is verified.",
                ],
                "evidence": "Offline-asset and critical-ticket records for the same client",
                "route": insight.get("route") or "/clients",
                "state": "read_only_plan",
            })
        else:
            queue.append({
                "id": f"diagnostic-timeline-{insight['id']}",
                "client_id": insight.get("client_id"),
                "title": "Review the client timeline before selecting a remediation",
                "detail": insight.get("summary") or "Multiple retained signals need technician validation.",
                "steps": [
                    "Open the source records and confirm their timestamps and ownership.",
                    "Determine whether the signals describe one issue or separate work.",
                    "Choose an approved playbook only after recording the diagnostic conclusion.",
                ],
                "evidence": insight.get("confidence_basis") or "Multiple retained operational signals",
                "route": insight.get("route") or "/clients",
                "state": "read_only_plan",
            })
    return queue[:3]


async def build_nexus_brain(current_user: dict, *, window_hours: int = 12) -> dict:
    """Build the daily briefing and cross-module correlations."""
    now = datetime.now(timezone.utc)
    safe_window = max(1, min(48, int(window_hours or 12)))
    since = (now - timedelta(hours=safe_window)).isoformat()
    month_since = (now - timedelta(days=30)).isoformat()

    (
        clients,
        healed_rows,
        script_rows,
        completed_workflows,
        pending_workflows,
        pending_approvals,
        devices,
        failed_backups,
        critical_tickets,
        unbilled_time,
        product_tickets,
        platform_events,
        healing_month,
        script_month,
        resolved_tickets_month,
    ) = await asyncio.gather(
        db.clients.find(
            _query(current_user, {"status": {"$nin": ["archived", "inactive"]}}, field="id"),
            {"_id": 0, "id": 1, "name": 1},
        ).to_list(5000),
        db.self_healing_events.find(
            _query(current_user, {
                "status": "healed",
                "simulated": {"$ne": True},
                "healed_at": {"$gte": since},
            }),
            {
                "_id": 0, "id": 1, "client_id": 1, "client_name": 1, "device_name": 1,
                "issue_description": 1, "healed_at": 1, "time_saved_minutes": 1,
            },
        ).to_list(1000),
        db.script_executions.find(
            _query(current_user, {
                "status": {"$in": ["completed", "success", "succeeded"]},
                "$or": [{"completed_at": {"$gte": since}}, {"created_at": {"$gte": since}}],
            }),
            {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "script_name": 1, "completed_at": 1},
        ).to_list(1000),
        db.workflow_runs.find(
            _query(current_user, {"status": "completed", "completed_at": {"$gte": since}}),
            {"_id": 0, "id": 1, "client_id": 1, "workflow_name": 1, "completed_at": 1},
        ).to_list(1000),
        db.workflow_runs.find(
            _query(current_user, {"status": "awaiting_approval"}),
            {
                "_id": 0, "id": 1, "client_id": 1, "workflow_name": 1,
                "approval_id": 1, "updated_at": 1, "context": 1,
            },
        ).sort("updated_at", -1).to_list(100),
        db.approvals.find(
            _query(current_user, {"status": "pending"}),
            {
                "_id": 0, "id": 1, "client_id": 1, "title": 1, "description": 1,
                "type": 1, "created_at": 1, "ref_id": 1, "ref_type": 1,
            },
        ).sort("created_at", -1).to_list(100),
        db.devices.find(
            _query(current_user, {
                "$or": [
                    {"status": "offline"},
                    {"disk_percent": {"$gte": 90}},
                    {"disk_usage": {"$gte": 90}},
                    {"disk_usage_percent": {"$gte": 90}},
                    {"storage_percent": {"$gte": 90}},
                ],
            }),
            {
                "_id": 0, "id": 1, "client_id": 1, "client_name": 1, "name": 1,
                "hostname": 1, "status": 1, "disk_percent": 1, "disk_usage": 1,
                "disk_usage_percent": 1, "storage_percent": 1,
            },
        ).to_list(1000),
        db.backup_jobs.find(
            _query(current_user, {"status": {"$in": ["failed", "error"]}}),
            {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "name": 1, "error": 1},
        ).to_list(1000),
        db.tickets.find(
            _query(current_user, {
                "status": {"$in": ACTIVE_TICKET_STATUSES},
                "priority": "critical",
            }),
            {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "ticket_number": 1, "title": 1},
        ).to_list(1000),
        db.time_entries.find(
            _query(current_user, {"invoiced": {"$ne": True}, "billable": {"$ne": False}}),
            {
                "_id": 0, "id": 1, "client_id": 1, "client_name": 1, "ticket_id": 1,
                "ticket_number": 1, "total_amount": 1, "hours": 1, "hourly_rate": 1,
            },
        ).to_list(2000),
        db.tickets.find(
            _query(current_user, {
                "products": {"$exists": True, "$ne": []},
                "products_invoiced": {"$ne": True},
            }),
            {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "products": 1},
        ).to_list(1000),
        db.platform_events.find(
            _query(current_user, {"occurred_at": {"$gte": since}}),
            {
                "_id": 0, "id": 1, "subject": 1, "source": 1, "client_id": 1,
                "occurred_at": 1, "payload": 1, "actor": 1,
            },
        ).sort("occurred_at", -1).to_list(100),
        db.self_healing_events.find(
            _query(current_user, {
                "simulated": {"$ne": True},
                "detected_at": {"$gte": month_since},
            }),
            {"_id": 0, "id": 1, "status": 1, "time_saved_minutes": 1},
        ).to_list(5000),
        db.script_executions.find(
            _query(current_user, {
                "status": {"$in": ["completed", "success", "succeeded"]},
                "$or": [{"completed_at": {"$gte": month_since}}, {"created_at": {"$gte": month_since}}],
            }),
            {"_id": 0, "script_name": 1},
        ).to_list(5000),
        db.tickets.find(
            _query(current_user, {
                "status": {"$in": ["resolved", "closed"]},
                "updated_at": {"$gte": month_since},
            }),
            {"_id": 0, "client_id": 1, "title": 1},
        ).to_list(5000),
    )

    insights = correlate_client_signals(
        clients=clients,
        devices=devices,
        failed_backups=failed_backups,
        critical_tickets=critical_tickets,
        unbilled_time=unbilled_time,
    )

    documented_minutes_saved = sum(_number(row.get("time_saved_minutes")) for row in healed_rows)
    unbilled_amount = sum(
        _number(row.get("total_amount"))
        or _number(row.get("hours")) * _number(row.get("hourly_rate"))
        for row in unbilled_time
    )
    product_amount = sum(
        _number(product.get("price")) * max(1, int(product.get("quantity") or 1))
        for row in product_tickets
        for product in (row.get("products") or [])
    )
    revenue_found = round(unbilled_amount + product_amount, 2)
    automated_actions = len(healed_rows) + len(script_rows) + len(completed_workflows)

    completed = []
    if healed_rows:
        completed.append({
            "id": "healed",
            "label": "Self-healing actions completed",
            "value": len(healed_rows),
            "detail": (
                f"{documented_minutes_saved / 60:.1f} documented hours saved"
                if documented_minutes_saved else
                "Completed from retained execution evidence"
            ),
            "route": "/auto-ops?tab=self-healing",
        })
    if script_rows:
        completed.append({
            "id": "scripts",
            "label": "Technician scripts completed",
            "value": len(script_rows),
            "detail": "Signed agent execution records",
            "route": "/scripting",
        })
    if completed_workflows:
        completed.append({
            "id": "workflows",
            "label": "Automation workflows completed",
            "value": len(completed_workflows),
            "detail": "Durable workflow checkpoints retained",
            "route": "/workflow-automation?tab=runs",
        })

    approvals = [
        {
            "id": row.get("approval_id") or row.get("id"),
            "title": row.get("workflow_name") or "Automation approval",
            "detail": (row.get("context") or {}).get("client_name") or "Protected workflow boundary",
            "route": f"/workflow-automation?tab=runs&run={row.get('id')}",
            "source": "Automation",
        }
        for row in pending_workflows[:4]
    ]
    approvals.extend([
        {
            "id": row.get("id"),
            "title": row.get("title") or "Approval required",
            "detail": row.get("description") or row.get("type") or "Protected action",
            "route": "/change-management",
            "source": "Change control",
        }
        for row in pending_approvals[: max(0, 4 - len(approvals))]
    ])

    activity = [
        {
            "id": row.get("id"),
            "subject": row.get("subject"),
            "label": _subject_label(row.get("subject") or "platform.event"),
            "source": row.get("source") or "Nexus Platform",
            "client_id": row.get("client_id"),
            "occurred_at": row.get("occurred_at"),
            "actor": (row.get("actor") or {}).get("name") or "Nexus System",
        }
        for row in platform_events[:8]
    ]

    detected_month = len(healing_month)
    healed_month = sum(row.get("status") == "healed" for row in healing_month)
    self_healing_score = round(healed_month / max(1, detected_month) * 100, 1)
    improvements = build_continuous_improvements(
        revenue_found=revenue_found,
        insights=insights,
        recent_resolved_tickets=resolved_tickets_month,
        recent_script_runs=script_month,
        healed_month=healed_month,
        detected_month=detected_month,
    )
    diagnostic_queue = build_diagnostic_queue(insights)
    outcome_counts = {"reduce_effort": 0, "reduce_risk": 0, "increase_revenue": 0}
    for insight in insights:
        for outcome in insight.get("outcomes") or []:
            outcome_counts[outcome] += 1
    if automated_actions:
        outcome_counts["reduce_effort"] += 1
    if revenue_found:
        outcome_counts["increase_revenue"] += 1

    outcome_paths = [
        {
            "id": "operational-effort",
            "label": "Operational effort returned",
            "technical_event": "Self-healing, scripts and approved workflows completed",
            "outcome": "reduce_effort",
            "value": automated_actions,
            "value_label": f"{automated_actions} evidenced action{'s' if automated_actions != 1 else ''}",
            "detail": (
                f"{documented_minutes_saved:.0f} documented minutes returned"
                if documented_minutes_saved else
                "Execution records are retained; time savings are recorded only when supplied by the run."
            ),
            "route": "/workflow-automation?tab=runs",
            "state": "evidenced" if automated_actions else "not_measured",
        },
        {
            "id": "revenue-protection",
            "label": "Revenue protection opportunity",
            "technical_event": "Unbilled time and ticket products reconciled",
            "outcome": "increase_revenue",
            "value": revenue_found,
            "value_label": f"${revenue_found:,.2f} for review",
            "detail": "This is an identified opportunity, not revenue recovered, until finance approves the correction.",
            "route": "/billing-recon",
            "state": "review_required" if revenue_found else "not_measured",
        },
        {
            "id": "client-risk",
            "label": "Client risk brought into view",
            "technical_event": "Device, backup, ticket and billing records correlated by client",
            "outcome": "reduce_risk",
            "value": len(insights),
            "value_label": f"{len(insights)} correlation lead{'s' if len(insights) != 1 else ''}",
            "detail": "Correlation leads require technician validation; Nexus does not present them as causal findings.",
            "route": "/clients",
            "state": "review_required" if insights else "not_measured",
        },
    ]

    return {
        "generated_at": now.isoformat(),
        "window_hours": safe_window,
        "briefing": {
            "headline": (
                f"Nexus completed {automated_actions} evidenced action{'s' if automated_actions != 1 else ''} "
                f"and found ${revenue_found:,.2f} requiring billing review."
            ),
            "completed": completed,
            "approvals": approvals,
            "metrics": {
                "automated_actions": automated_actions,
                "documented_minutes_saved": round(documented_minutes_saved, 1),
                "pending_approvals": len(pending_workflows) + len(pending_approvals),
                "revenue_found": revenue_found,
                "self_healing_score": self_healing_score,
                "self_healing_detected_30d": detected_month,
                "self_healing_healed_30d": healed_month,
            },
        },
        "insights": insights,
        "activity": activity,
        "outcome_counts": outcome_counts,
        "outcome_paths": outcome_paths,
        "continuous_improvements": {
            "headline": "Five evidence-backed opportunities to improve the MSP",
            "detail": "Nexus identifies review leads from retained work records. It does not claim causality, savings or apply a change until a technician validates the evidence.",
            "items": improvements,
        },
        "diagnostic_workspace": {
            "headline": "Start with evidence, not a guessed fix",
            "detail": "These read-only diagnostic plans are generated from retained client signals. They do not execute a check, change an endpoint or establish causality.",
            "items": diagnostic_queue,
        },
        "value_proof": build_value_proof(
            automated_actions=automated_actions,
            documented_minutes_saved=documented_minutes_saved,
            revenue_identified=revenue_found,
            healed_actions=len(healed_rows),
            script_actions=len(script_rows),
            workflow_actions=len(completed_workflows),
        ),
        "evidence_note": (
            "Nexus Brain joins current records by client and labels correlations as leads. "
            "It does not claim causation without matching execution or provider evidence."
        ),
    }
