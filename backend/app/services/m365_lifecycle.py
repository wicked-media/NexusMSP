"""Read-only Microsoft 365 employee-lifecycle readiness evidence.

This module deliberately prepares *evidence and handoffs*, not provider
commands.  It is the boundary between a Nexus client-to-tenant relationship
and the existing Microsoft/CIPP observations.  A caller must already have
been scoped to the client before invoking this composition layer.

It does not persist a lifecycle record, create a ticket, reconcile billing, or
call a provider.  That makes incomplete evidence visible without accidentally
turning a readiness screen into a second offboarding implementation.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any, Iterable


VERIFIED_PROVIDER_SOURCES = frozenset({"m365_graph", "m365_partner_center"})
LIFECYCLE_ACTIONS = frozenset({"create_user", "assign_license", "offboard_user"})


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def stable_tenant_id(value: Any) -> str:
    """Return the stable provider tenant identifier, never a display fallback."""
    return str(value or "").strip()


def _license_assignments(row: dict[str, Any]) -> list[Any]:
    assignments = (
        row.get("assigned_licenses")
        or row.get("assignedLicenses")
        or row.get("licenses")
        or row.get("AssignedLicenses")
        or []
    )
    return assignments if isinstance(assignments, list) else []


def _account_enabled(row: dict[str, Any]) -> bool:
    """Match the existing M365 posture convention: absent means unknown-active.

    Provider records historically use both snake_case and Graph's camelCase.
    A missing field must not be treated as proof that an account was disabled.
    It remains in the active operational count until an authoritative sync says
    otherwise, matching the existing licensing posture endpoint.
    """
    value = row.get("account_enabled", row.get("accountEnabled", row.get("enabled", True)))
    return value is not False


def _numeric(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _latest_timestamp(rows: Iterable[dict[str, Any]]) -> str | None:
    values = [
        str(row.get("observed_at") or row.get("updated_at") or row.get("synced_at") or row.get("timestamp") or "").strip()
        for row in rows
    ]
    values = [value for value in values if value]
    return max(values) if values else None


def _tenant_matches(row: dict[str, Any], tenant_id: str) -> bool:
    return tenant_id in {
        stable_tenant_id(row.get("tenant_id")),
        stable_tenant_id(row.get("id")),
    }


def _handoffs() -> list[dict[str, Any]]:
    """Safe navigation metadata, not executable commands or workflow state."""
    return [
        {
            "key": "plan_joiner",
            "label": "Plan a joiner",
            "route": "/control-plane?module=microsoft365&view=actions&action=create-user",
            "kind": "governed_preview",
            "execution_state": "not_started",
            "requires": ["client scope", "tenant mapping", "policy validation"],
            "detail": "Opens a governed plan preview only. This lifecycle response cannot create a provider user.",
        },
        {
            "key": "plan_leaver",
            "label": "Plan a leaver",
            "route": "/control-plane?module=microsoft365&view=actions&action=offboard-user",
            "kind": "governed_preview",
            "execution_state": "not_started",
            "requires": ["client scope", "Nexus Verify", "approval policy", "policy validation"],
            "detail": "Starts a governed plan, not an offboarding action. The existing verified CIPP path remains the execution boundary.",
        },
        {
            "key": "review_license_evidence",
            "label": "Review licence evidence",
            "route": "/control-plane?module=microsoft365&view=security",
            "kind": "read_only_review",
            "execution_state": "not_started",
            "requires": ["provider evidence"],
            "detail": "Review provider-recorded licence posture before any assignment plan. This endpoint does not alter subscriptions or invoices.",
        },
        {
            "key": "review_service_billing",
            "label": "Review service and billing coverage",
            "route": "/services-subscriptions?view=attention",
            "kind": "read_only_review",
            "execution_state": "not_started",
            "requires": ["commercial owner review"],
            "detail": "Hands off to the existing service and billing workspace. Lifecycle readiness does not reconcile commercial records.",
        },
        {
            "key": "start_work_session",
            "label": "Start a work session",
            "route": "/work-session",
            "kind": "ticket_required",
            "execution_state": "not_started",
            "requires": ["selected service ticket"],
            "detail": "Choose a scoped ticket first; Nexus Work Session records technician-reviewed completion evidence there.",
        },
    ]


def build_client_lifecycle_readiness(
    client: dict[str, Any],
    *,
    tenant_connections: Iterable[dict[str, Any]] = (),
    provider_tenants: Iterable[dict[str, Any]] = (),
    provider_users: Iterable[dict[str, Any]] = (),
    provider_licenses: Iterable[dict[str, Any]] = (),
    cipp_actions: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    """Compose truthful lifecycle readiness for one already-authorised client.

    The result intentionally contains counts and evidence states rather than
    user principal names, raw provider payloads, provider results, secrets, or
    a claim that a prior CIPP action completed a lifecycle outcome.
    """
    tenant_id = stable_tenant_id(client.get("cipp_tenant_id"))
    client_id = str(client.get("id") or "").strip() or None
    client_name = str(client.get("name") or "Unnamed client").strip() or "Unnamed client"
    all_connections = [row for row in tenant_connections if tenant_id and stable_tenant_id(row.get("tenant_id")) == tenant_id]
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
    tenant_rows = [row for row in provider_tenants if tenant_id and _tenant_matches(row, tenant_id)]
    users = [row for row in provider_users if tenant_id and stable_tenant_id(row.get("tenant_id")) == tenant_id]
    licenses = [row for row in provider_licenses if tenant_id and stable_tenant_id(row.get("tenant_id")) == tenant_id]
    actions = [
        row
        for row in cipp_actions
        if tenant_id
        and stable_tenant_id(row.get("tenant_id")) == tenant_id
        and str(row.get("action") or "") in LIFECYCLE_ACTIONS
    ]

    active_users = [row for row in users if _account_enabled(row)]
    unlicensed_active = [row for row in active_users if not _license_assignments(row)]
    disabled_licensed = [row for row in users if not _account_enabled(row) and _license_assignments(row)]
    low_stock = []
    for row in licenses:
        total = _numeric(row.get("total_units", row.get("enabled_units", row.get("prepaid_units"))))
        consumed = _numeric(row.get("consumed_units", row.get("consumedUnits")))
        if total is not None and consumed is not None and total - consumed <= 2:
            low_stock.append(row)

    findings: list[dict[str, Any]] = []
    evidence_gaps: list[dict[str, Any]] = []
    if not tenant_id:
        findings.append(
            {
                "key": "tenant_unmapped",
                "severity": "high",
                "title": "Microsoft tenant is not mapped",
                "detail": "Map a stable Microsoft tenant ID to this Nexus client before planning employee lifecycle work.",
                "handoff": "map_tenant",
            }
        )
    elif conflicting_connections:
        findings.append(
            {
                "key": "tenant_mapping_conflict",
                "severity": "high",
                "title": "Tenant mapping requires review",
                "detail": "A Microsoft tenant connection is linked to another Nexus client. Nexus will not use that connection as lifecycle evidence.",
                "handoff": "map_tenant",
            }
        )
    elif not connection:
        evidence_gaps.append(
            {
                "key": "tenant_connection_missing",
                "title": "Tenant connection evidence is not registered",
                "detail": "The client-to-tenant mapping exists, but Nexus has no matching Microsoft connection record to prove delegated access.",
            }
        )
    elif not bool(connection.get("graph_verified")):
        evidence_gaps.append(
            {
                "key": "tenant_access_unverified",
                "title": "Delegated access is not verified",
                "detail": "A tenant connection exists, but current Microsoft Graph access has not been verified by a provider synchronisation.",
            }
        )

    if not (tenant_rows or users or licenses):
        evidence_gaps.append(
            {
                "key": "provider_snapshot_missing",
                "title": "Provider lifecycle evidence is unavailable",
                "detail": "No verified Microsoft tenant, user, or licence snapshot is available. Nexus cannot claim the current employee state.",
            }
        )
    if unlicensed_active:
        findings.append(
            {
                "key": "active_users_without_licence",
                "severity": "medium",
                "title": "Active users lack a recorded licence",
                "detail": f"{len(unlicensed_active)} active user(s) have no provider-recorded licence assignment.",
                "handoff": "review_license_evidence",
            }
        )
    if disabled_licensed:
        findings.append(
            {
                "key": "disabled_users_with_licence",
                "severity": "medium",
                "title": "Disabled users retain recorded licences",
                "detail": f"{len(disabled_licensed)} disabled user(s) retain provider-recorded licence assignments.",
                "handoff": "review_license_evidence",
            }
        )
    if low_stock:
        findings.append(
            {
                "key": "low_licence_stock",
                "severity": "low",
                "title": "Licence availability is low",
                "detail": f"{len(low_stock)} provider-recorded SKU(s) have two or fewer seats remaining.",
                "handoff": "review_license_evidence",
            }
        )

    attention_required = any(finding["severity"] in {"high", "medium"} for finding in findings)
    state = "attention_required" if attention_required else "evidence_incomplete" if evidence_gaps else "ready_for_planning"
    action_counts = Counter(str(row.get("action") or "unknown") for row in actions)
    observed_at = _latest_timestamp([*tenant_rows, *users, *licenses])

    return {
        "client_id": client_id,
        "client_name": client_name,
        "state": state,
        "tenant": {
            "state": "mapped" if tenant_id else "not_mapped",
            "tenant_id": tenant_id or None,
            "display_name": client.get("cipp_tenant_display") or None,
            "domain": client.get("cipp_tenant_domain") or None,
            "linked_at": client.get("cipp_linked_at") or None,
        },
        "evidence": {
            "tenant_connection": {
                "state": "verified" if connection and connection.get("graph_verified") else "observed" if connection else "not_observed",
                "consent_method": (connection or {}).get("consent_method") or None,
                "discovery_status": (connection or {}).get("discovery_status") or None,
                "observed_at": (connection or {}).get("updated_at") or (connection or {}).get("discovered_at") or None,
            },
            "provider_snapshot": {
                "state": "available" if (tenant_rows or users or licenses) else "not_available",
                "tenant_records": len(tenant_rows),
                "user_records": len(users),
                "licence_sku_records": len(licenses),
                "latest_observed_at": observed_at,
                "source": "verified_m365_provider_cache",
            },
            "provider_action_audit": {
                "state": "observed" if actions else "not_observed",
                "observed_actions": sum(action_counts.values()),
                "action_types": dict(sorted(action_counts.items())),
                "latest_observed_at": _latest_timestamp(actions),
                "detail": "Audit observations prove a provider action was recorded, not that a lifecycle outcome remains verified.",
            },
        },
        "lifecycle_counts": {
            "provider_users": len(users),
            "active_users": len(active_users),
            "unlicensed_active_users": len(unlicensed_active),
            "disabled_licensed_users": len(disabled_licensed),
            "low_stock_skus": len(low_stock),
        },
        "findings": findings,
        "evidence_gaps": evidence_gaps,
        "safe_handoffs": _handoffs(),
        "boundary": "Read-only lifecycle readiness and evidence. No Microsoft, CIPP, ticket, contract, subscription, invoice, or approval state was changed.",
    }


def build_lifecycle_readiness(
    clients: Iterable[dict[str, Any]],
    *,
    tenant_connections: Iterable[dict[str, Any]] = (),
    provider_tenants: Iterable[dict[str, Any]] = (),
    provider_users: Iterable[dict[str, Any]] = (),
    provider_licenses: Iterable[dict[str, Any]] = (),
    cipp_actions: Iterable[dict[str, Any]] = (),
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Build a scoped lifecycle readiness portfolio without persisting it."""
    client_rows = sorted(
        list(clients),
        key=lambda row: (str(row.get("name") or "").lower(), str(row.get("id") or "")),
    )
    rows = [
        build_client_lifecycle_readiness(
            client,
            tenant_connections=tenant_connections,
            provider_tenants=provider_tenants,
            provider_users=provider_users,
            provider_licenses=provider_licenses,
            cipp_actions=cipp_actions,
        )
        for client in client_rows
    ]
    return {
        "generated_at": generated_at or now_iso(),
        "summary": {
            "clients": len(rows),
            "ready_for_planning": sum(row["state"] == "ready_for_planning" for row in rows),
            "attention_required": sum(row["state"] == "attention_required" for row in rows),
            "evidence_incomplete": sum(row["state"] == "evidence_incomplete" for row in rows),
            "active_users": sum(row["lifecycle_counts"]["active_users"] for row in rows),
            "unlicensed_active_users": sum(row["lifecycle_counts"]["unlicensed_active_users"] for row in rows),
            "disabled_licensed_users": sum(row["lifecycle_counts"]["disabled_licensed_users"] for row in rows),
        },
        "clients": rows,
        "boundary": "Client-scoped, read-only lifecycle evidence. Use a governed action workflow for any future joiner or leaver operation.",
    }
