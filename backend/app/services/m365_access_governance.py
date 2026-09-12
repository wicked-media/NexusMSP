"""Read-only, client-scoped Microsoft access-governance evidence.

Nexus Access Governance is deliberately an evidence and handoff layer.  It
does not use an inventory snapshot as permission to alter a group, role,
guest, mailbox or GDAP relationship.  Those changes remain in their governed
Control Plane workflows, with their own approval and audit boundaries.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from app.services.m365_lifecycle import VERIFIED_PROVIDER_SOURCES, stable_tenant_id


ACCESS_REVIEW_WINDOW_DAYS = 90


def _timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _latest_observed(rows: Iterable[dict[str, Any]]) -> str | None:
    values = [
        str(row.get("observed_at") or row.get("updated_at") or row.get("synced_at") or row.get("created_at") or "").strip()
        for row in rows
    ]
    values = [value for value in values if value]
    return max(values) if values else None


def _account_enabled(row: dict[str, Any]) -> bool:
    return row.get("account_enabled", row.get("accountEnabled", row.get("enabled", True))) is not False


def _identity_key(row: dict[str, Any], index: int) -> str:
    for key in ("id", "user_id", "userId", "upn", "user_principal_name", "userPrincipalName"):
        value = str(row.get(key) or "").strip()
        if value:
            return value.lower()
    return f"unidentified:{index}"


def _roles(row: dict[str, Any]) -> list[str]:
    """Normalise provider role labels without using them as relationship keys."""
    raw = (
        row.get("assigned_roles")
        or row.get("assignedRoles")
        or row.get("directory_roles")
        or row.get("directoryRoles")
        or row.get("roles")
        or row.get("memberOf")
        or []
    )
    if not isinstance(raw, list):
        return []
    labels: list[str] = []
    for role in raw:
        if isinstance(role, dict):
            label = (
                role.get("display_name")
                or role.get("displayName")
                or role.get("role_name")
                or role.get("roleDefinitionDisplayName")
                or role.get("name")
                or role.get("id")
            )
        else:
            label = role
        value = str(label or "").strip()
        if value:
            labels.append(value)
    return labels


def _role_evidence_present(row: dict[str, Any]) -> bool:
    return any(
        key in row
        for key in (
            "is_admin", "isAdmin", "assigned_roles", "assignedRoles", "directory_roles",
            "directoryRoles", "roles", "memberOf",
        )
    )


def _is_privileged(row: dict[str, Any]) -> bool:
    return bool(row.get("is_admin") or row.get("isAdmin") or _roles(row))


def _group_membership_evidence_present(row: dict[str, Any]) -> bool:
    return any(key in row for key in ("members", "member_ids", "memberIds", "member_count", "memberCount"))


def _role_assignable_group(row: dict[str, Any]) -> bool:
    return bool(row.get("is_assignable_to_role") or row.get("isAssignableToRole") or row.get("role_assignable"))


def _guest_last_observed(row: dict[str, Any]) -> datetime | None:
    for key in (
        "last_sign_in", "lastSignInDateTime", "last_sign_in_at", "lastSignIn",
        "observed_at", "updated_at", "created_at", "createdDateTime",
    ):
        parsed = _timestamp(row.get(key))
        if parsed:
            return parsed
    return None


def _gdap_expiring(row: dict[str, Any]) -> bool:
    days = row.get("expires_in_days", row.get("expiresInDays"))
    try:
        if days is not None:
            return float(days) <= 30
    except (TypeError, ValueError):
        pass
    for key in ("expires_at", "expiresAt", "end_date", "endDateTime"):
        value = _timestamp(row.get(key))
        if value:
            return value <= datetime.now(timezone.utc) + timedelta(days=30)
    return False


def _check(key: str, label: str, state: str, detail: str, source: str) -> dict[str, str]:
    return {"key": key, "label": label, "state": state, "detail": detail, "source": source}


def access_handoffs() -> list[dict[str, Any]]:
    """Return navigation only.  These are never provider commands."""
    return [
        {
            "key": "plan_group_membership",
            "label": "Plan group access",
            "route": "/control-plane?module=microsoft365&view=actions&action=manage-group-membership",
            "kind": "governed_preview",
            "requires": ["client scope", "access-owner evidence", "approval policy"],
            "detail": "Opens a group-membership plan. No access is changed from this evidence view.",
        },
        {
            "key": "plan_privileged_role",
            "label": "Plan privileged role",
            "route": "/control-plane?module=microsoft365&view=actions&action=manage-privileged-role",
            "kind": "governed_preview",
            "requires": ["client scope", "least privilege", "independent approval"],
            "detail": "Opens a time-bound role plan. Nexus does not infer a role assignment from inventory evidence.",
        },
        {
            "key": "review_microsoft_security",
            "label": "Review Microsoft security",
            "route": "/control-plane?module=microsoft365&view=security",
            "kind": "read_only_review",
            "requires": ["verified provider evidence"],
            "detail": "Review broader identity, Conditional Access and security evidence before approving a change.",
        },
        {
            "key": "start_work_session",
            "label": "Start a work session",
            "route": "/work-session",
            "kind": "ticket_required",
            "requires": ["selected service ticket"],
            "detail": "Start from a scoped ticket to capture technician-reviewed work and completion evidence.",
        },
    ]


def build_client_access_governance(
    client: dict[str, Any],
    *,
    tenant_connections: Iterable[dict[str, Any]] = (),
    provider_tenants: Iterable[dict[str, Any]] = (),
    provider_users: Iterable[dict[str, Any]] = (),
    provider_groups: Iterable[dict[str, Any]] = (),
    provider_guests: Iterable[dict[str, Any]] = (),
    provider_gdap: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    """Compose a truthful access-governance readiness pack for one client."""
    tenant_id = stable_tenant_id(client.get("cipp_tenant_id"))
    client_id = str(client.get("id") or "").strip() or None
    client_name = str(client.get("name") or "Unnamed client").strip() or "Unnamed client"

    all_connections = [row for row in tenant_connections if tenant_id and stable_tenant_id(row.get("tenant_id")) == tenant_id]
    matching_connections = [
        row for row in all_connections
        if not row.get("client_id") or str(row.get("client_id")) == str(client_id or "")
    ]
    conflicting_connections = [
        row for row in all_connections
        if row.get("client_id") and str(row.get("client_id")) != str(client_id or "")
    ]
    connection = matching_connections[0] if matching_connections else None

    tenants = [
        row for row in provider_tenants
        if tenant_id and tenant_id in {stable_tenant_id(row.get("tenant_id")), stable_tenant_id(row.get("id"))}
    ]
    users = [row for row in provider_users if tenant_id and stable_tenant_id(row.get("tenant_id")) == tenant_id]
    groups = [row for row in provider_groups if tenant_id and stable_tenant_id(row.get("tenant_id")) == tenant_id]
    guests = [row for row in provider_guests if tenant_id and stable_tenant_id(row.get("tenant_id")) == tenant_id]
    gdap = [row for row in provider_gdap if tenant_id and stable_tenant_id(row.get("tenant_id")) == tenant_id]

    role_evidence = any(_role_evidence_present(row) for row in users)
    privileged: dict[str, dict[str, Any]] = {}
    role_counts: Counter[str] = Counter()
    for index, user in enumerate(users):
        roles = _roles(user)
        if _is_privileged(user):
            privileged[_identity_key(user, index)] = user
        role_counts.update(roles)
    disabled_privileged = [row for row in privileged.values() if not _account_enabled(row)]
    membership_evidence = any(_group_membership_evidence_present(row) for row in groups)
    stale_cutoff = datetime.now(timezone.utc) - timedelta(days=ACCESS_REVIEW_WINDOW_DAYS)
    stale_guests = [row for row in guests if (observed := _guest_last_observed(row)) and observed < stale_cutoff]
    expiring_gdap = [row for row in gdap if _gdap_expiring(row)]

    checks: list[dict[str, str]] = []
    findings: list[dict[str, str]] = []
    evidence_gaps: list[dict[str, str]] = []
    if not tenant_id:
        checks.append(_check(
            "tenant_binding", "Nexus client binding", "needs_attention",
            "Map a stable Microsoft tenant ID before reviewing customer access evidence.",
            "Nexus client relationship",
        ))
        findings.append({
            "key": "tenant_unmapped", "severity": "high", "title": "Microsoft tenant is not mapped",
            "detail": "Nexus cannot safely associate access evidence or a future change plan with this client.",
            "handoff": "plan_group_membership",
        })
    elif conflicting_connections:
        checks.append(_check(
            "tenant_binding", "Nexus client binding", "needs_attention",
            "A Microsoft connection names another Nexus client, so it is excluded from access-governance evidence.",
            "Nexus tenant connection",
        ))
        findings.append({
            "key": "tenant_mapping_conflict", "severity": "high", "title": "Tenant mapping requires review",
            "detail": "A stable Microsoft tenant connection conflicts with the current client relationship.",
            "handoff": "plan_group_membership",
        })
    else:
        checks.append(_check(
            "tenant_binding", "Nexus client binding", "verified",
            "A stable Microsoft tenant relationship is recorded for this client.",
            "Nexus client relationship",
        ))

    connection_state = "verified" if connection and connection.get("graph_verified") else "not_assessed"
    checks.append(_check(
        "tenant_connection", "Delegated Microsoft access", connection_state,
        "Tenant Graph access was verified by a recorded connection." if connection_state == "verified" else "Nexus has not verified delegated Microsoft access for this client yet.",
        "Nexus tenant connection",
    ))
    if tenant_id and not connection:
        evidence_gaps.append({
            "key": "tenant_connection_missing", "title": "Tenant connection evidence is unavailable",
            "detail": "Map and verify delegated access before relying on current access evidence.",
        })
    elif connection and not connection.get("graph_verified"):
        evidence_gaps.append({
            "key": "tenant_access_unverified", "title": "Delegated Microsoft access is not verified",
            "detail": "A connection record exists, but a provider synchronisation has not confirmed Graph access.",
        })

    if role_evidence:
        checks.append(_check(
            "privileged_roles", "Privileged role evidence", "verified",
            f"{len(privileged)} provider-recorded privileged identity record(s) are available for review.",
            "Verified Microsoft identity cache",
        ))
    else:
        checks.append(_check(
            "privileged_roles", "Privileged role evidence", "not_assessed",
            "The current user snapshot does not include directory-role evidence.",
            "Verified Microsoft identity cache",
        ))
        evidence_gaps.append({
            "key": "privileged_role_evidence_missing", "title": "Privileged role evidence is unavailable",
            "detail": "Nexus cannot verify privileged identities until the Microsoft synchroniser records directory-role assignments.",
        })

    if groups:
        checks.append(_check(
            "group_inventory", "Group inventory", "verified",
            f"{len(groups)} provider-recorded group record(s) are available for review.",
            "Verified Microsoft group cache",
        ))
    else:
        checks.append(_check(
            "group_inventory", "Group inventory", "not_assessed",
            "No verified Microsoft group inventory is currently retained for this tenant.",
            "Verified Microsoft group cache",
        ))
        evidence_gaps.append({
            "key": "group_inventory_missing", "title": "Group inventory evidence is unavailable",
            "detail": "Nexus cannot make group-access conclusions until the Microsoft synchroniser records tenant groups.",
        })
    if not membership_evidence:
        evidence_gaps.append({
            "key": "group_membership_evidence_missing", "title": "Group membership evidence is unavailable",
            "detail": "A group inventory is not the same as current membership. Nexus will not infer entitlement ownership until membership evidence is synchronised.",
        })

    if guests:
        checks.append(_check(
            "guest_access", "Guest access evidence", "verified",
            f"{len(guests)} provider-recorded guest identity record(s) are available for review.",
            "Verified Microsoft guest cache",
        ))
    else:
        checks.append(_check(
            "guest_access", "Guest access evidence", "not_assessed",
            "No verified guest identity snapshot is available for this tenant.",
            "Verified Microsoft guest cache",
        ))
        evidence_gaps.append({
            "key": "guest_evidence_missing", "title": "Guest-access evidence is unavailable",
            "detail": "Nexus cannot prove guest exposure or inactivity until a Microsoft guest identity synchronisation is available.",
        })

    if gdap:
        checks.append(_check(
            "gdap", "GDAP relationship evidence", "verified",
            f"{len(gdap)} provider-recorded GDAP relationship(s) are available for review.",
            "Verified Microsoft GDAP cache",
        ))
    else:
        checks.append(_check(
            "gdap", "GDAP relationship evidence", "not_assessed",
            "No verified GDAP relationship snapshot is available for this tenant.",
            "Verified Microsoft GDAP cache",
        ))
        evidence_gaps.append({
            "key": "gdap_evidence_missing", "title": "GDAP evidence is unavailable",
            "detail": "Nexus cannot confirm delegated privilege expiry until Microsoft relationship evidence is synchronised.",
        })

    if disabled_privileged:
        findings.append({
            "key": "disabled_privileged_identities", "severity": "high", "title": "Disabled privileged identities require review",
            "detail": f"{len(disabled_privileged)} disabled identity record(s) retain provider-recorded privileged role evidence.",
            "handoff": "plan_privileged_role",
        })
    if stale_guests:
        findings.append({
            "key": "stale_guest_access", "severity": "medium", "title": "Guest access has not been recently observed",
            "detail": f"{len(stale_guests)} guest identity record(s) have no observed activity within {ACCESS_REVIEW_WINDOW_DAYS} days.",
            "handoff": "review_microsoft_security",
        })
    if expiring_gdap:
        findings.append({
            "key": "gdap_expiring", "severity": "medium", "title": "GDAP relationship expires soon",
            "detail": f"{len(expiring_gdap)} provider-recorded GDAP relationship(s) expire within 30 days.",
            "handoff": "review_microsoft_security",
        })
    if role_evidence and len(privileged) > 4:
        findings.append({
            "key": "privileged_access_review", "severity": "medium", "title": "Privileged access warrants an owner review",
            "detail": f"{len(privileged)} provider-recorded privileged identity record(s) are visible. Nexus does not assume the intended baseline or ownership without an approved client policy.",
            "handoff": "plan_privileged_role",
        })

    state = "attention_required" if any(finding["severity"] in {"high", "medium"} for finding in findings) else "evidence_incomplete" if evidence_gaps else "ready_for_review"
    observed_rows = [*tenants, *users, *groups, *guests, *gdap]
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
        "checks": checks,
        "findings": findings,
        "evidence_gaps": evidence_gaps,
        "access_counts": {
            "provider_users": len(users),
            "privileged_identities": len(privileged),
            "disabled_privileged_identities": len(disabled_privileged),
            "groups": len(groups),
            "role_assignable_groups": sum(_role_assignable_group(row) for row in groups),
            "guest_identities": len(guests),
            "stale_guest_identities": len(stale_guests),
            "gdap_relationships": len(gdap),
            "gdap_expiring_30d": len(expiring_gdap),
        },
        "role_breakdown": [
            {"role": role, "assignments": count}
            for role, count in sorted(role_counts.items(), key=lambda pair: (-pair[1], pair[0].lower()))[:12]
        ],
        "evidence": {
            "provider_snapshot": {
                "state": "available" if observed_rows else "not_available",
                "latest_observed_at": _latest_observed(observed_rows),
                "source": "verified_m365_provider_cache",
            },
            "group_membership": {
                "state": "available" if membership_evidence else "not_available",
                "detail": "Provider membership metadata was observed." if membership_evidence else "No membership evidence was supplied; group inventory alone is not access proof.",
            },
        },
        "safe_handoffs": access_handoffs(),
        "boundary": "Read-only, client-scoped access-governance evidence. No group, role, guest, GDAP, Microsoft, CIPP, ticket, contract, subscription, invoice or approval state was changed.",
    }


def build_access_governance(
    clients: Iterable[dict[str, Any]],
    *,
    tenant_connections: Iterable[dict[str, Any]] = (),
    provider_tenants: Iterable[dict[str, Any]] = (),
    provider_users: Iterable[dict[str, Any]] = (),
    provider_groups: Iterable[dict[str, Any]] = (),
    provider_guests: Iterable[dict[str, Any]] = (),
    provider_gdap: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    """Build a scoped portfolio view without persisting a second source of truth."""
    rows = [
        build_client_access_governance(
            client,
            tenant_connections=tenant_connections,
            provider_tenants=provider_tenants,
            provider_users=provider_users,
            provider_groups=provider_groups,
            provider_guests=provider_guests,
            provider_gdap=provider_gdap,
        )
        for client in sorted(clients, key=lambda row: (str(row.get("name") or "").lower(), str(row.get("id") or "")))
    ]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "clients": len(rows),
            "ready_for_review": sum(row["state"] == "ready_for_review" for row in rows),
            "attention_required": sum(row["state"] == "attention_required" for row in rows),
            "evidence_incomplete": sum(row["state"] == "evidence_incomplete" for row in rows),
            "privileged_identities": sum(row["access_counts"]["privileged_identities"] for row in rows),
            "stale_guest_identities": sum(row["access_counts"]["stale_guest_identities"] for row in rows),
            "gdap_expiring_30d": sum(row["access_counts"]["gdap_expiring_30d"] for row in rows),
        },
        "clients": rows,
        "boundary": "Client-scoped, read-only Microsoft access-governance evidence. Any privileged or entitlement change must use a governed Control Plane workflow.",
    }
