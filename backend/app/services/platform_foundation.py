"""Shared platform contracts for NexusMSP.

This module is deliberately infrastructure-neutral.  The current application
persists events in MongoDB and fans them out over SSE, while the envelope is
ready to be forwarded to NATS JetStream (or another durable broker) without
changing the contracts used by Nexus modules.
"""

from __future__ import annotations

from datetime import datetime, timezone
import re
import uuid
from typing import Any

from app.database import db
from app.services.event_backbone import persist_platform_event


EVENT_SUBJECTS = [
    {"subject": "core.relationships.rebuilt", "owner": "Nexus Core", "risk": "medium", "description": "The canonical entity and relationship index was rebuilt from operational sources."},
    {"subject": "device.identity.issued", "owner": "Nexus Agent", "risk": "medium", "description": "A device-generated CSR was issued a short-lived Nexus Agent client certificate."},
    {"subject": "device.trust.changed", "owner": "Nexus Agent", "risk": "high", "description": "An endpoint trust, certificate, policy or self-repair state changed."},
    {"subject": "device.connected", "owner": "Managed Assets", "risk": "low", "description": "A trusted Nexus Agent established a current session."},
    {"subject": "device.health.changed", "owner": "Managed Assets", "risk": "medium", "description": "Endpoint health or protection posture changed."},
    {"subject": "dns.query.blocked", "owner": "Nexus DNS", "risk": "high", "description": "A resolver-attested DNS policy decision blocked a query."},
    {"subject": "backup.job.failed", "owner": "Backups", "risk": "high", "description": "A protected workload reported a failed backup run."},
    {"subject": "ticket.created", "owner": "Service Desk", "risk": "low", "description": "A new auditable service record was created."},
    {"subject": "user.offboard.requested", "owner": "Nexus Control Plane", "risk": "high", "description": "A governed identity offboarding workflow was requested."},
    {"subject": "invoice.reconciliation.failed", "owner": "Nexus Finance", "risk": "medium", "description": "An invoice could not be reconciled to its accounting source."},
    {"subject": "remote.session.started", "owner": "Nexus Remote", "risk": "high", "description": "A technician began an authenticated remote session."},
    {"subject": "remote.session.ended", "owner": "Nexus Remote", "risk": "medium", "description": "A governed remote session ended with duration and linked service evidence."},
    {"subject": "remote.repair.queued", "owner": "Nexus Remote", "risk": "high", "description": "A bounded remote-access repair was queued through a trusted Nexus Agent."},
    {"subject": "automation.run.queued", "owner": "Automation", "risk": "low", "description": "An approved workflow was durably queued from a matching platform event."},
    {"subject": "automation.run.waiting", "owner": "Automation", "risk": "low", "description": "A durable workflow checkpointed a timed continuation."},
    {"subject": "automation.approval.required", "owner": "Automation", "risk": "high", "description": "A durable workflow reached a protected approval boundary."},
    {"subject": "automation.run.completed", "owner": "Automation", "risk": "low", "description": "A durable workflow completed every executable step."},
    {"subject": "automation.run.failed", "owner": "Automation", "risk": "high", "description": "A durable workflow stopped safely because a step could not be completed."},
    {"subject": "automation.compensation.completed", "owner": "Automation", "risk": "high", "description": "A governed compensation attempt completed with its conflict evidence preserved."},
    {"subject": "connector.health.changed", "owner": "Integrations", "risk": "medium", "description": "A connector changed connection, sync or rate-limit state."},
]

_SUBJECT_RE = re.compile(r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$")
_CORRELATION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalise_correlation_id(value: str | None = None) -> str:
    candidate = str(value or "").strip()
    return candidate if _CORRELATION_RE.fullmatch(candidate) else str(uuid.uuid4())


def request_correlation_id(request: Any) -> str:
    state_value = getattr(getattr(request, "state", None), "correlation_id", None)
    header_value = request.headers.get("X-Correlation-ID") if getattr(request, "headers", None) else None
    return normalise_correlation_id(state_value or header_value)


def validate_event_subject(subject: str) -> str:
    value = str(subject or "").strip().lower().replace(" ", ".")
    if not _SUBJECT_RE.fullmatch(value):
        raise ValueError("Event type must use a dotted subject such as device.health.changed")
    return value


async def emit_platform_event(
    *,
    subject: str,
    source: str,
    payload: dict | None,
    actor: dict | None = None,
    tenant_id: str | None = None,
    client_id: str | None = None,
    correlation_id: str | None = None,
    causation_id: str | None = None,
    schema_version: int = 1,
    idempotency_key: str | None = None,
    partition_key: str | None = None,
    retention_days: int | None = None,
) -> dict:
    """Persist one replayable platform event using the shared Nexus envelope."""

    actor = actor or {}
    event = {
        "id": str(uuid.uuid4()),
        "subject": validate_event_subject(subject),
        "schema_version": max(1, int(schema_version or 1)),
        "source": str(source or "nexus.platform"),
        "tenant_id": str(tenant_id or actor.get("tenant_id") or "nexus-local"),
        "client_id": str(client_id or (payload or {}).get("client_id") or "") or None,
        "correlation_id": normalise_correlation_id(correlation_id),
        "causation_id": str(causation_id or "") or None,
        "actor": {
            "id": actor.get("id") or "system",
            "name": actor.get("name") or actor.get("email") or "Nexus System",
            "role": actor.get("role") or "system",
        },
        "payload": payload or {},
        "occurred_at": utc_now(),
        "persistence": {
            "durable": True,
            "replayable": True,
            "transport": "mongodb-durable+sse",
            "broker_ready": True,
        },
    }
    return await persist_platform_event(
        event,
        idempotency_key=idempotency_key,
        partition_key=partition_key,
        retention_days=retention_days,
    )
