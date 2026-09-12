"""Read-only, client-scoped Microsoft change evidence.

Nexus 365 Change Intelligence is deliberately conservative about the phrase
"what changed".  It reports only a retained Nexus audit action or an
explicitly dated provider observation.  A current inventory snapshot is
useful for freshness, but it is never presented as a historical difference.

This is an evidence and hand-off layer.  It does not call a Microsoft
provider, create a ticket, update a baseline, or mutate a commercial record.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Iterable

from app.services.m365_lifecycle import VERIFIED_PROVIDER_SOURCES, stable_tenant_id


ACTION_LABELS = {
    "create_user": "Microsoft user created",
    "assign_license": "Microsoft licence assignment recorded",
    "reset_password": "Microsoft password reset recorded",
    "block_signin": "Microsoft sign-in blocked",
    "unblock_signin": "Microsoft sign-in restored",
    "offboard_user": "Microsoft offboarding action recorded",
    "link_tenant": "Microsoft tenant linked to Nexus client",
    "unlink_tenant": "Microsoft tenant link removed",
}

OBSERVATION_CATEGORIES = (
    ("tenant", "Tenant inventory", "provider_tenants"),
    ("identity", "Identity inventory", "provider_users"),
    ("group", "Group inventory", "provider_groups"),
    ("licence", "Licence inventory", "provider_licenses"),
    ("conditional_access", "Conditional Access inventory", "provider_conditional_access"),
    ("security", "Security signal inventory", "provider_security_alerts"),
    ("device", "Intune device inventory", "provider_intune_devices"),
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _timestamp(value: Any) -> str | None:
    """Return a normalised timestamp or omit an untrusted/invalid value."""
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if not parsed.tzinfo:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat()


def _latest_observed(rows: Iterable[dict[str, Any]]) -> str | None:
    values = [
        _timestamp(
            row.get("observed_at")
            or row.get("updated_at")
            or row.get("synced_at")
            or row.get("verified_at")
            or row.get("created_at")
        )
        for row in rows
    ]
    return max((value for value in values if value), default=None)


def _tenant_matches(row: dict[str, Any], tenant_id: str, *, tenant_record: bool = False) -> bool:
    candidates = [stable_tenant_id(row.get("tenant_id"))]
    if tenant_record:
        candidates.append(stable_tenant_id(row.get("id")))
    return tenant_id in candidates


def _safe_action_events(
    actions: Iterable[dict[str, Any]], *, client_id: str | None, tenant_id: str
) -> list[dict[str, Any]]:
    """Return only action metadata that is safe and unambiguous to display.

    Legacy tenant-only audits are intentionally excluded.  A current tenant
    mapping cannot prove that a historic action belonged to the same Nexus
    client, especially after a mapping correction.  Provider response previews,
    user targets and verification data never leave this boundary.
    """
    if not client_id or not tenant_id:
        return []

    events: list[dict[str, Any]] = []
    for row in actions:
        if str(row.get("client_id") or "") != str(client_id):
            continue
        if stable_tenant_id(row.get("tenant_id")) != tenant_id:
            continue
        occurred_at = _timestamp(row.get("timestamp") or row.get("occurred_at"))
        if not occurred_at:
            continue
        action = str(row.get("action") or "").strip()
        action_key = action if action in ACTION_LABELS else "provider_action_recorded"
        digest = sha256(
            "|".join(
                [
                    str(client_id),
                    tenant_id,
                    action_key,
                    occurred_at,
                    str(row.get("correlation_id") or ""),
                ]
            ).encode("utf-8")
        ).hexdigest()[:16]
        events.append(
            {
                "event_id": f"m365-action-{digest}",
                "kind": "governed_action",
                "action": action_key,
                "label": ACTION_LABELS.get(action_key, "Microsoft provider action recorded"),
                "occurred_at": occurred_at,
                "actor_recorded": bool(row.get("actor_id") or row.get("by")),
                "correlation_recorded": bool(row.get("correlation_id")),
                "detail": "Nexus retained a governed action audit. Refresh provider evidence before treating the current tenant state as verified.",
            }
        )
    return sorted(events, key=lambda item: item["occurred_at"], reverse=True)[:12]


def _handoffs() -> list[dict[str, Any]]:
    """Return navigation metadata only; these are never executable actions."""
    return [
        {
            "key": "map_tenant",
            "label": "Review tenant mapping",
            "route": "/control-plane?module=microsoft365&view=connections",
            "kind": "configuration_review",
            "detail": "Confirm the stable Nexus client-to-tenant relationship before relying on tenant evidence.",
        },
        {
            "key": "review_microsoft_guardrails",
            "label": "Review Microsoft guardrails",
            "route": "/control-plane?module=microsoft365&view=security",
            "kind": "read_only_review",
            "detail": "Review identity, guest, role, GDAP and standard evidence before proposing any Microsoft change.",
        },
        {
            "key": "start_work_session",
            "label": "Start a work session",
            "route": "/work-session",
            "kind": "ticket_required",
            "detail": "Start from a selected scoped ticket to record technician-reviewed work and completion evidence.",
        },
    ]


def build_client_change_intelligence(
    client: dict[str, Any],
    *,
    tenant_connections: Iterable[dict[str, Any]] = (),
    provider_tenants: Iterable[dict[str, Any]] = (),
    provider_users: Iterable[dict[str, Any]] = (),
    provider_groups: Iterable[dict[str, Any]] = (),
    provider_licenses: Iterable[dict[str, Any]] = (),
    provider_conditional_access: Iterable[dict[str, Any]] = (),
    provider_security_alerts: Iterable[dict[str, Any]] = (),
    provider_intune_devices: Iterable[dict[str, Any]] = (),
    cipp_actions: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    """Compose retained M365 change evidence for exactly one Nexus client."""
    client_id = str(client.get("id") or "").strip() or None
    client_name = str(client.get("name") or "Unnamed client").strip() or "Unnamed client"
    tenant_id = stable_tenant_id(client.get("cipp_tenant_id"))

    all_connections = [
        row for row in tenant_connections if tenant_id and _tenant_matches(row, tenant_id)
    ]
    matching_connections = [
        row
        for row in all_connections
        if not row.get("client_id") or str(row.get("client_id")) == str(client_id or "")
    ]
    conflicting_connections = [
        row
        for row in all_connections
        if row.get("client_id") and str(row.get("client_id")) != str(client_id or "")
    ]
    connection = matching_connections[0] if matching_connections else None

    evidence_sets = {
        "provider_tenants": [row for row in provider_tenants if tenant_id and _tenant_matches(row, tenant_id, tenant_record=True)],
        "provider_users": [row for row in provider_users if tenant_id and _tenant_matches(row, tenant_id)],
        "provider_groups": [row for row in provider_groups if tenant_id and _tenant_matches(row, tenant_id)],
        "provider_licenses": [row for row in provider_licenses if tenant_id and _tenant_matches(row, tenant_id)],
        "provider_conditional_access": [row for row in provider_conditional_access if tenant_id and _tenant_matches(row, tenant_id)],
        "provider_security_alerts": [row for row in provider_security_alerts if tenant_id and _tenant_matches(row, tenant_id)],
        "provider_intune_devices": [row for row in provider_intune_devices if tenant_id and _tenant_matches(row, tenant_id)],
    }
    observations = [
        {
            "key": key,
            "label": label,
            "state": "available" if evidence_sets[source] else "not_observed",
            "records": len(evidence_sets[source]),
            "latest_observed_at": _latest_observed(evidence_sets[source]),
            "source": "verified_m365_provider_cache",
        }
        for key, label, source in OBSERVATION_CATEGORIES
    ]
    observed_categories = [item for item in observations if item["state"] == "available"]
    action_events = _safe_action_events(cipp_actions, client_id=client_id, tenant_id=tenant_id)
    action_counts = Counter(event["action"] for event in action_events)

    evidence_gaps: list[dict[str, str]] = []
    if not tenant_id:
        evidence_gaps.append(
            {
                "key": "tenant_mapping_missing",
                "title": "Microsoft tenant is not mapped",
                "detail": "Nexus cannot safely connect a retained audit or provider observation to this client until a stable tenant ID is mapped.",
                "handoff": "map_tenant",
            }
        )
    elif conflicting_connections:
        evidence_gaps.append(
            {
                "key": "tenant_connection_conflict",
                "title": "Tenant connection requires review",
                "detail": "A retained tenant connection names another Nexus client, so it is excluded from this client ledger.",
                "handoff": "map_tenant",
            }
        )
    elif not connection or not connection.get("graph_verified"):
        evidence_gaps.append(
            {
                "key": "tenant_connection_unverified",
                "title": "Delegated Microsoft access is not verified",
                "detail": "Nexus can show only retained evidence; verify the tenant connection before relying on a current Microsoft state.",
                "handoff": "map_tenant",
            }
        )
    if tenant_id and not observed_categories:
        evidence_gaps.append(
            {
                "key": "provider_observations_missing",
                "title": "No verified provider observations are retained",
                "detail": "Nexus cannot infer historical changes from an empty or unverified provider cache. Refresh the provider evidence first.",
                "handoff": "review_microsoft_guardrails",
            }
        )

    if not tenant_id or conflicting_connections or not connection or not connection.get("graph_verified"):
        state = "attention_required"
    elif not observed_categories:
        state = "evidence_incomplete"
    else:
        state = "ready_for_review"

    return {
        "client_id": client_id,
        "client_name": client_name,
        "state": state,
        "tenant": {
            "state": "mapped" if tenant_id else "not_mapped",
            "tenant_id": tenant_id or None,
            "display_name": client.get("cipp_tenant_display") or None,
            "domain": client.get("cipp_tenant_domain") or None,
        },
        "connection": {
            "state": "verified" if connection and connection.get("graph_verified") else "not_verified" if connection else "not_observed",
            "observed_at": _latest_observed(matching_connections),
            "detail": "A client-compatible tenant connection has verified Graph access." if connection and connection.get("graph_verified") else "Provider observations are not an execution permission without a verified tenant connection.",
        },
        "change_evidence": {
            "state": "available" if action_events else "not_observed",
            "recorded_actions": len(action_events),
            "latest_recorded_at": action_events[0]["occurred_at"] if action_events else None,
            "action_types": dict(sorted(action_counts.items())),
            "detail": "Only client-bound Nexus action audits are shown. Historical tenant-only entries are withheld rather than guessed to belong to this client.",
        },
        "observation_freshness": observations,
        "events": action_events,
        "evidence_gaps": evidence_gaps,
        "safe_handoffs": _handoffs(),
        "boundary": "Client-scoped, read-only change evidence. A current provider snapshot is shown as freshness only, never as a fabricated historical diff. No Microsoft, CIPP, ticket, approval, subscription, invoice or policy state was changed.",
    }


def build_change_intelligence(
    clients: Iterable[dict[str, Any]],
    *,
    tenant_connections: Iterable[dict[str, Any]] = (),
    provider_tenants: Iterable[dict[str, Any]] = (),
    provider_users: Iterable[dict[str, Any]] = (),
    provider_groups: Iterable[dict[str, Any]] = (),
    provider_licenses: Iterable[dict[str, Any]] = (),
    provider_conditional_access: Iterable[dict[str, Any]] = (),
    provider_security_alerts: Iterable[dict[str, Any]] = (),
    provider_intune_devices: Iterable[dict[str, Any]] = (),
    cipp_actions: Iterable[dict[str, Any]] = (),
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Build a scoped portfolio view without persisting a second data store."""
    rows = [
        build_client_change_intelligence(
            client,
            tenant_connections=tenant_connections,
            provider_tenants=provider_tenants,
            provider_users=provider_users,
            provider_groups=provider_groups,
            provider_licenses=provider_licenses,
            provider_conditional_access=provider_conditional_access,
            provider_security_alerts=provider_security_alerts,
            provider_intune_devices=provider_intune_devices,
            cipp_actions=cipp_actions,
        )
        for client in sorted(clients, key=lambda row: (str(row.get("name") or "").lower(), str(row.get("id") or "")))
    ]
    return {
        "generated_at": generated_at or now_iso(),
        "summary": {
            "clients": len(rows),
            "mapped_clients": sum(row["tenant"]["state"] == "mapped" for row in rows),
            "ready_for_review": sum(row["state"] == "ready_for_review" for row in rows),
            "attention_required": sum(row["state"] == "attention_required" for row in rows),
            "evidence_incomplete": sum(row["state"] == "evidence_incomplete" for row in rows),
            "recorded_actions": sum(row["change_evidence"]["recorded_actions"] for row in rows),
            "observed_categories": sum(
                item["state"] == "available"
                for row in rows
                for item in row["observation_freshness"]
            ),
        },
        "clients": rows,
        "boundary": "Client-scoped, read-only Microsoft change evidence. Nexus reports retained actions and evidence freshness, not inferred provider history.",
    }
