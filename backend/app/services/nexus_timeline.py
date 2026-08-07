"""Canonical, evidence-backed operational timeline for a Nexus client.

The timeline is a read model over persisted source records. It does not create
synthetic activity or imply that two neighbouring events share a cause.
"""

from __future__ import annotations

import asyncio
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Iterable

from app.database import db


TIMELINE_CATEGORIES = (
    "service",
    "communication",
    "asset",
    "remote",
    "automation",
    "backup",
    "finance",
    "documentation",
    "governance",
    "platform",
)


def _as_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif value:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
    else:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _timestamp(*values: Any) -> str | None:
    for value in values:
        parsed = _as_datetime(value)
        if parsed:
            return parsed.isoformat()
    return None


def _actor(value: Any) -> str | None:
    if isinstance(value, dict):
        return value.get("name") or value.get("email") or value.get("id")
    return str(value).strip() if value else None


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _event(
    event_id: str,
    *,
    category: str,
    source: str,
    title: str,
    timestamp: Any,
    detail: str | None = None,
    status: str | None = None,
    actor: Any = None,
    route: str | None = None,
    severity: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    client_id: str,
    evidence: dict | None = None,
) -> dict:
    return {
        "id": str(event_id),
        "category": category if category in TIMELINE_CATEGORIES else "platform",
        "type": category if category != "service" else "ticket",
        "source": source,
        "title": str(title or "Recorded activity"),
        "detail": str(detail).strip() if detail else None,
        "status": str(status).strip() if status else None,
        "timestamp": _timestamp(timestamp),
        "actor": _actor(actor),
        "route": route,
        "severity": str(severity).lower() if severity else None,
        "entity_type": entity_type,
        "entity_id": str(entity_id) if entity_id else None,
        "client_id": client_id,
        "evidence": evidence or {},
    }


def filter_timeline_events(
    events: Iterable[dict],
    *,
    categories: Iterable[str] | None = None,
    before: str | datetime | None = None,
    search: str | None = None,
    limit: int = 200,
) -> list[dict]:
    """Filter and order normalized timeline rows without inventing evidence."""
    selected = {str(item).strip().lower() for item in (categories or []) if str(item).strip()}
    before_dt = _as_datetime(before)
    needle = str(search or "").strip().lower()
    rows = []

    for event in events:
        occurred_at = _as_datetime(event.get("timestamp"))
        if not occurred_at:
            continue
        if selected and event.get("category") not in selected:
            continue
        if before_dt and occurred_at >= before_dt:
            continue
        if needle:
            haystack = " ".join(
                str(event.get(field) or "")
                for field in ("title", "detail", "source", "actor", "status", "entity_type", "entity_id")
            ).lower()
            if needle not in haystack:
                continue
        rows.append(event)

    rows.sort(key=lambda event: _as_datetime(event.get("timestamp")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return rows[: max(1, min(500, int(limit or 200)))]


def _platform_route(subject: str, payload: dict) -> str | None:
    subject = str(subject or "").lower()
    if subject.startswith("ticket."):
        ticket_id = payload.get("ticket_id")
        return f"/tickets?ticket={ticket_id}" if ticket_id else "/tickets"
    if subject.startswith("remote."):
        return "/remote-access"
    if subject.startswith("backup."):
        return "/backup-center"
    if subject.startswith("automation."):
        return "/workflow-automation?tab=runs"
    if subject.startswith("invoice.") or subject.startswith("service.quantity"):
        return "/billing-recon"
    if subject.startswith("device."):
        device_id = payload.get("device_id")
        return f"/devices/{device_id}" if device_id else "/devices"
    return None


async def build_client_timeline(
    client_id: str,
    *,
    categories: Iterable[str] | None = None,
    before: str | datetime | None = None,
    search: str | None = None,
    limit: int = 200,
) -> dict:
    """Join persisted client evidence into one canonical chronology."""
    (
        client,
        tickets,
        invoices,
        communications,
        client_activity,
        audit_rows,
        changes,
        devices,
        remote_sessions,
        workflows,
        backups,
        documents,
        platform_events,
    ) = await asyncio.gather(
        db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1}),
        db.tickets.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(500),
        db.invoices.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(300),
        db.client_communication_events.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(500),
        db.activity_logs.find({"entity_type": "client", "entity_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(300),
        db.audit_logs.find(
            {"$or": [{"entity_type": "client", "entity_id": client_id}, {"metadata.client_id": client_id}]},
            {"_id": 0},
        ).sort("created_at", -1).to_list(500),
        db.change_requests.find({"client_id": client_id}, {"_id": 0}).sort("updated_at", -1).to_list(300),
        db.devices.find({"client_id": client_id}, {"_id": 0}).to_list(1000),
        db.remote_sessions.find({"client_id": client_id}, {"_id": 0}).sort("started_at", -1).to_list(300),
        db.workflow_runs.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(300),
        db.backup_jobs.find({"client_id": client_id}, {"_id": 0}).sort("last_run", -1).to_list(300),
        db.documentation.find({"client_id": client_id, "is_template": {"$ne": True}}, {"_id": 0}).sort("updated_at", -1).to_list(300),
        db.platform_events.find({"client_id": client_id}, {"_id": 0}).sort("occurred_at", -1).to_list(500),
    )

    device_names = {
        str(row.get("id")): row.get("name") or row.get("hostname") or row.get("id")
        for row in devices
        if row.get("id")
    }
    device_ids = list(device_names)
    ticket_ids = [str(row.get("id")) for row in tickets if row.get("id")]

    device_events, device_activity, scripts, time_entries = await asyncio.gather(
        db.device_events.find({"device_id": {"$in": device_ids}}, {"_id": 0}).sort("timestamp", -1).to_list(500)
        if device_ids else asyncio.sleep(0, result=[]),
        db.activity_logs.find(
            {"entity_type": "device", "entity_id": {"$in": device_ids}}, {"_id": 0}
        ).sort("created_at", -1).to_list(500)
        if device_ids else asyncio.sleep(0, result=[]),
        db.script_executions.find(
            {"$or": [{"client_id": client_id}, {"device_id": {"$in": device_ids}}]}, {"_id": 0}
        ).sort("created_at", -1).to_list(500)
        if device_ids else db.script_executions.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(500),
        db.time_entries.find(
            {"$or": [{"client_id": client_id}, {"ticket_id": {"$in": ticket_ids}}]}, {"_id": 0}
        ).sort("date", -1).to_list(500)
        if ticket_ids else db.time_entries.find({"client_id": client_id}, {"_id": 0}).sort("date", -1).to_list(500),
    )

    events: list[dict] = []

    for row in tickets:
        ticket_id = row.get("id")
        route = f"/tickets?ticket={ticket_id}"
        events.append(_event(
            f"ticket-created-{ticket_id}", category="service", source="Service Desk",
            title=row.get("title") or "Ticket created", detail=f"Ticket {row.get('ticket_number') or ticket_id}",
            timestamp=row.get("created_at"), status=row.get("status"), actor=row.get("created_by_name"),
            route=route, severity=row.get("priority"), entity_type="ticket", entity_id=ticket_id, client_id=client_id,
        ))
        if row.get("resolved_at") or row.get("closed_at"):
            events.append(_event(
                f"ticket-resolved-{ticket_id}", category="service", source="Service Desk",
                title=f"Resolved: {row.get('title') or 'Ticket'}", detail=f"Ticket {row.get('ticket_number') or ticket_id}",
                timestamp=row.get("closed_at") or row.get("resolved_at"), status="closed" if row.get("closed_at") else "resolved",
                actor=row.get("resolved_by_name") or row.get("assigned_to_name"), route=route,
                entity_type="ticket", entity_id=ticket_id, client_id=client_id,
            ))

    for row in invoices:
        invoice_id = row.get("id")
        amount = row.get("total", row.get("amount", 0))
        events.append(_event(
            f"invoice-{invoice_id}", category="finance", source="Billing",
            title=f"Invoice {row.get('invoice_number') or invoice_id}",
            detail=f"${_number(amount):,.2f}", timestamp=row.get("created_at"),
            status=row.get("status"), actor=row.get("created_by_name"),
            route=f"/invoices?invoice={invoice_id}", entity_type="invoice", entity_id=invoice_id,
            client_id=client_id, evidence={"amount": amount},
        ))

    for row in communications:
        event_id = row.get("id")
        direction = row.get("direction", "outbound")
        recipients = row.get("recipients") or []
        counterparty = row.get("sender_email") if direction == "inbound" else ", ".join(recipients[:2])
        events.append(_event(
            f"communication-{event_id}", category="communication", source="Microsoft Mail",
            title=f"{'Received' if direction == 'inbound' else 'Sent'}: {row.get('subject') or '(no subject)'}",
            detail=counterparty, timestamp=row.get("created_at"), status=row.get("delivery_status") or "recorded",
            actor=row.get("sender_name") or row.get("sender_mailbox"),
            route=f"/clients?client={client_id}&tab=activity", entity_type="communication",
            entity_id=event_id, client_id=client_id,
        ))

    for row in client_activity:
        events.append(_event(
            f"client-activity-{row.get('id')}", category="governance", source="Client record",
            title=row.get("details") or str(row.get("action") or "Client activity").replace("_", " "),
            timestamp=row.get("created_at"), status=row.get("action"), actor=row.get("user_name"),
            entity_type="client", entity_id=client_id, client_id=client_id,
        ))

    for row in audit_rows:
        entity_type = row.get("entity_type") or "client"
        entity_id = row.get("entity_id")
        route = (
            f"/tickets?ticket={entity_id}" if entity_type == "ticket" and entity_id else
            f"/invoices?invoice={entity_id}" if entity_type == "invoice" and entity_id else
            f"/devices/{entity_id}" if entity_type == "device" and entity_id else
            "/change-management" if entity_type == "change_request" else None
        )
        events.append(_event(
            f"audit-{row.get('id')}", category="governance", source="Audit ledger",
            title=row.get("entity_name") or str(row.get("action") or "Audited client action").replace("_", " "),
            detail=row.get("details"), timestamp=row.get("created_at"), status=row.get("action"),
            actor=row.get("user_name"), route=route, entity_type=entity_type,
            entity_id=entity_id, client_id=client_id, evidence=row.get("metadata") or {},
        ))

    for row in changes:
        change_id = row.get("id")
        events.append(_event(
            f"change-{change_id}", category="governance", source="Change control",
            title=row.get("title") or "Change request", detail=row.get("description"),
            timestamp=row.get("updated_at") or row.get("created_at"), status=row.get("status") or "recorded",
            actor=row.get("requested_by_name") or row.get("requested_by"), route="/change-management",
            severity=row.get("risk_level"), entity_type="change_request", entity_id=change_id, client_id=client_id,
        ))

    for row in devices:
        device_id = row.get("id")
        events.append(_event(
            f"device-added-{device_id}", category="asset", source="Managed Assets",
            title=f"Asset added: {device_names.get(str(device_id)) or 'Managed device'}",
            detail=row.get("device_type") or row.get("os_name"), timestamp=row.get("created_at") or row.get("enrolled_at"),
            status=row.get("status"), route=f"/devices/{device_id}", entity_type="device",
            entity_id=device_id, client_id=client_id,
        ))

    for row in device_events:
        device_id = row.get("device_id")
        events.append(_event(
            f"device-event-{row.get('id')}", category="asset", source="Nexus Agent",
            title=row.get("message") or str(row.get("event_type") or "Asset signal").replace("_", " "),
            detail=device_names.get(str(device_id)), timestamp=row.get("timestamp") or row.get("created_at"),
            status=row.get("event_type"), severity=row.get("severity"), route=f"/devices/{device_id}",
            entity_type="device", entity_id=device_id, client_id=client_id,
        ))

    for row in device_activity:
        device_id = row.get("entity_id")
        events.append(_event(
            f"device-activity-{row.get('id')}", category="asset", source="Managed Assets",
            title=row.get("details") or str(row.get("action") or "Asset activity").replace("_", " "),
            detail=row.get("entity_name") or device_names.get(str(device_id)), timestamp=row.get("created_at"),
            status=row.get("action"), actor=row.get("user_name"), route=f"/devices/{device_id}",
            entity_type="device", entity_id=device_id, client_id=client_id,
        ))

    for row in remote_sessions:
        session_id = row.get("id")
        device_id = row.get("device_id")
        ended = row.get("ended_at")
        events.append(_event(
            f"remote-{'ended' if ended else 'started'}-{session_id}", category="remote", source="Nexus Remote",
            title=f"Remote session {'completed' if ended else 'started'}",
            detail=row.get("device_name") or device_names.get(str(device_id)),
            timestamp=ended or row.get("started_at"), status=row.get("status"), actor=row.get("user_name"),
            route=f"/remote-access?session={session_id}", entity_type="remote_session",
            entity_id=session_id, client_id=client_id,
            evidence={"duration_minutes": row.get("duration_minutes"), "ticket_id": row.get("ticket_id")},
        ))

    for row in scripts:
        execution_id = row.get("id")
        events.append(_event(
            f"script-{execution_id}", category="automation", source="Script Library",
            title=f"Script {row.get('script_name') or 'execution'} {row.get('status') or 'recorded'}",
            detail=row.get("device_name") or device_names.get(str(row.get("device_id"))),
            timestamp=row.get("completed_at") or row.get("created_at"), status=row.get("status"),
            actor=row.get("user_name"), route=f"/scripting?tab=history&execution={execution_id}",
            severity="high" if row.get("status") == "failed" else None,
            entity_type="script_execution", entity_id=execution_id, client_id=client_id,
        ))

    for row in workflows:
        run_id = row.get("id")
        events.append(_event(
            f"workflow-{run_id}", category="automation", source="Automation",
            title=f"{row.get('workflow_name') or 'Workflow'} {str(row.get('status') or 'recorded').replace('_', ' ')}",
            detail=str(row.get("trigger_subject") or "Manual workflow").replace(".", " "),
            timestamp=row.get("completed_at") or row.get("updated_at") or row.get("created_at"),
            status=row.get("status"), actor=row.get("queued_by"),
            route=f"/workflow-automation?tab=runs&run={run_id}",
            severity="high" if row.get("status") == "failed" else None,
            entity_type="workflow_run", entity_id=run_id, client_id=client_id,
        ))

    for row in backups:
        job_id = row.get("id")
        events.append(_event(
            f"backup-{job_id}-{row.get('last_run') or row.get('updated_at')}", category="backup",
            source=row.get("provider") or row.get("source") or "Backups",
            title=f"Backup {row.get('name') or row.get('job_name') or 'job'} {row.get('status') or 'recorded'}",
            detail=row.get("error") or row.get("message"), timestamp=row.get("last_run") or row.get("completed_at") or row.get("updated_at") or row.get("created_at"),
            status=row.get("status"), severity="high" if row.get("status") in {"failed", "error"} else None,
            route="/backup-center", entity_type="backup_job", entity_id=job_id, client_id=client_id,
        ))

    for row in documents:
        document_id = row.get("id")
        events.append(_event(
            f"document-{document_id}", category="documentation", source="Knowledge & Docs",
            title=f"Documentation updated: {row.get('title') or 'Untitled document'}",
            detail=row.get("category"), timestamp=row.get("updated_at") or row.get("created_at"),
            status="updated", actor=row.get("last_edited_by_name"),
            route=f"/documentation-hub?tab=library&document={document_id}",
            entity_type="documentation", entity_id=document_id, client_id=client_id,
        ))

    for row in time_entries:
        entry_id = row.get("id")
        minutes = row.get("minutes")
        if minutes is None and row.get("hours") is not None:
            minutes = round(_number(row.get("hours")) * 60)
        events.append(_event(
            f"time-{entry_id}", category="finance", source="Time & Billing",
            title=row.get("description") or "Technician time recorded",
            detail=f"{minutes or 0} minutes", timestamp=row.get("date") or row.get("created_at"),
            status="billable" if row.get("billable", True) else "non_billable",
            actor=row.get("technician_name") or row.get("user_name"),
            route=f"/tickets?ticket={row.get('ticket_id')}" if row.get("ticket_id") else "/billing-recon",
            entity_type="time_entry", entity_id=entry_id, client_id=client_id,
            evidence={"minutes": minutes, "billable": row.get("billable")},
        ))

    for row in platform_events:
        subject = row.get("subject") or "platform.event"
        payload = row.get("payload") or {}
        events.append(_event(
            f"platform-{row.get('id')}", category="platform", source=row.get("source") or "Nexus Platform",
            title=subject.replace(".", " ").replace("_", " ").title(),
            detail=payload.get("message") or payload.get("summary"),
            timestamp=row.get("occurred_at"), status=payload.get("status"),
            actor=row.get("actor"), route=_platform_route(subject, payload),
            severity=payload.get("severity"), entity_type="platform_event",
            entity_id=row.get("id"), client_id=client_id,
            evidence={"subject": subject, "correlation_id": row.get("correlation_id")},
        ))

    filtered = filter_timeline_events(
        events,
        categories=categories,
        before=before,
        search=search,
        limit=limit,
    )
    category_counts = Counter(event["category"] for event in filtered)
    source_counts = Counter(event["source"] for event in filtered)
    return {
        "client": client or {"id": client_id, "name": "Client"},
        "events": filtered,
        "total_events": len(filtered),
        "available_categories": [
            {"id": category, "count": category_counts.get(category, 0)}
            for category in TIMELINE_CATEGORIES
            if category_counts.get(category)
        ],
        "sources": [{"name": name, "count": count} for name, count in source_counts.most_common()],
        "context": {
            "before": _timestamp(before),
            "search": search or "",
            "categories": list(categories or []),
            "newest_at": filtered[0]["timestamp"] if filtered else None,
            "oldest_at": filtered[-1]["timestamp"] if filtered else None,
            "evidence_note": "Every row is derived from a persisted Nexus source record. Timeline proximity does not imply causation.",
        },
    }
