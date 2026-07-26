"""Nexus Control Plane overview and cross-platform search.

The existing CIPP and Microsoft 365 routers remain the provider adapters and
compatibility surface.  This router owns the provider-agnostic NexusMSP
workspace so additional control-plane providers can be added without another
navigation or API redesign.
"""

from __future__ import annotations

import asyncio
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import (
    ACTION_PERMISSION_BY_ID,
    ACTION_PERMISSION_IDS,
    evaluate_action_permission,
)
from app.services.core_relationships import core_integrity_snapshot, core_schema
from app.services.event_backbone import event_backbone_health
from app.services.platform_foundation import EVENT_SUBJECTS


router = APIRouter()

MICROSOFT_ACTION_TEMPLATES: tuple[dict, ...] = (
    {
        "id": "reset-password",
        "label": "Reset password",
        "description": "Reset an Entra credential, require a password change, and retain the technician reason.",
        "permission": "entra.credential.reset",
        "impact": "high",
        "approval_required": False,
        "target": "user",
        "fields": [
            {
                "key": "session_action",
                "label": "Existing sessions",
                "type": "select",
                "required": True,
                "default": "revoke",
                "options": [
                    {"value": "revoke", "label": "Revoke active sessions"},
                    {"value": "preserve", "label": "Preserve active sessions"},
                ],
            },
            {
                "key": "delivery_method",
                "label": "Temporary credential handoff",
                "type": "select",
                "required": True,
                "default": "secure_handoff",
                "options": [
                    {"value": "secure_handoff", "label": "Secure technician handoff"},
                    {"value": "manager_handoff", "label": "Verified manager handoff"},
                ],
            },
        ],
        "rollback": "If the reset was unintended, block sign-in, revoke sessions, verify the user, and perform a second controlled reset.",
        "steps": [
            "Confirm the tenant and user identity",
            "Reset the cloud credential through the configured provider",
            "Require a password change at next sign-in",
            "Write the result to the Nexus audit ledger",
        ],
    },
    {
        "id": "reset-mfa",
        "label": "Reset MFA registration",
        "description": "Require a user to re-register authentication methods while retaining the service reason.",
        "permission": "entra.credential.reset",
        "impact": "high",
        "approval_required": False,
        "target": "user",
        "fields": [
            {
                "key": "registration_scope",
                "label": "Registration scope",
                "type": "select",
                "required": True,
                "default": "all_methods",
                "options": [
                    {"value": "all_methods", "label": "Require all methods to be registered again"},
                    {"value": "authenticator", "label": "Microsoft Authenticator only"},
                ],
            },
            {
                "key": "session_action",
                "label": "Existing sessions",
                "type": "select",
                "required": True,
                "default": "revoke",
                "options": [
                    {"value": "revoke", "label": "Revoke active sessions"},
                    {"value": "preserve", "label": "Preserve active sessions"},
                ],
            },
        ],
        "rollback": "Restore permitted authentication methods and issue a fresh Temporary Access Pass only after identity verification.",
        "steps": [
            "Confirm the tenant, user, and support authority",
            "Review registered authentication methods",
            "Require multi-factor authentication re-registration",
            "Write provider evidence to the Nexus audit ledger",
        ],
    },
    {
        "id": "block-sign-in",
        "label": "Block sign-in",
        "description": "Contain an identity while preserving an approval and service-record trail.",
        "permission": "entra.user.disable",
        "impact": "critical",
        "approval_required": True,
        "target": "user",
        "fields": [
            {
                "key": "session_action",
                "label": "Existing sessions",
                "type": "select",
                "required": True,
                "default": "revoke",
                "options": [
                    {"value": "revoke", "label": "Revoke active sessions"},
                    {"value": "preserve", "label": "Preserve active sessions"},
                ],
            },
            {
                "key": "containment_window",
                "label": "Containment window",
                "type": "select",
                "required": True,
                "default": "until_manual_review",
                "options": [
                    {"value": "until_manual_review", "label": "Until manually reviewed"},
                    {"value": "one_hour", "label": "One hour"},
                    {"value": "four_hours", "label": "Four hours"},
                    {"value": "twenty_four_hours", "label": "24 hours"},
                ],
            },
        ],
        "rollback": "Re-enable sign-in only after the incident owner confirms containment is complete, then verify session and Conditional Access state.",
        "steps": [
            "Confirm the tenant, user, and linked client",
            "Record the incident or change reference",
            "Request approval for the containment action",
            "Block sign-in and retain provider evidence",
        ],
    },
    {
        "id": "change-licences",
        "label": "Change licences",
        "description": "Add or remove Microsoft licences with a preview of billing and service impact.",
        "permission": "entra.license.modify",
        "impact": "high",
        "approval_required": False,
        "target": "user",
        "fields": [
            {
                "key": "licence_operation",
                "label": "Licence operation",
                "type": "select",
                "required": True,
                "default": "add",
                "options": [
                    {"value": "add", "label": "Add licence"},
                    {"value": "remove", "label": "Remove licence"},
                ],
            },
            {
                "key": "sku_id",
                "label": "Microsoft SKU or product",
                "type": "text",
                "required": True,
                "placeholder": "Business Premium or SKU ID",
            },
            {
                "key": "billing_effective",
                "label": "Billing treatment",
                "type": "select",
                "required": True,
                "default": "reconcile_now",
                "options": [
                    {"value": "reconcile_now", "label": "Reconcile contract quantity now"},
                    {"value": "next_cycle", "label": "Apply at next billing cycle"},
                ],
            },
        ],
        "rollback": "Restore the previous licence assignment and reconcile the service quantity back to the recorded before-state.",
        "steps": [
            "Load assigned and available tenant SKUs",
            "Preview additions, removals, and quantity impact",
            "Apply the approved licence delta",
            "Reconcile the linked service and billing evidence",
        ],
    },
    {
        "id": "create-user",
        "label": "Create user",
        "description": "Provision a Microsoft identity with usage location and optional licence assignment.",
        "permission": "entra.user.create",
        "impact": "high",
        "approval_required": False,
        "target": "tenant",
        "fields": [
            {
                "key": "display_name",
                "label": "Display name",
                "type": "text",
                "required": True,
                "placeholder": "Alex Taylor",
            },
            {
                "key": "user_principal_name",
                "label": "User principal name",
                "type": "email",
                "required": True,
                "placeholder": "alex@client.com",
            },
            {
                "key": "usage_location",
                "label": "Usage location",
                "type": "text",
                "required": True,
                "default": "AU",
                "placeholder": "AU",
            },
            {
                "key": "licence_sku",
                "label": "Initial licence",
                "type": "text",
                "required": False,
                "placeholder": "Optional Microsoft SKU or product",
            },
        ],
        "rollback": "Block the new identity, revoke sessions, preserve required evidence, remove assigned licences, and remove the account only after approval.",
        "steps": [
            "Confirm the tenant and linked client",
            "Validate the user principal name and usage location",
            "Create the identity and assign selected licences",
            "Record the new relationship in the client timeline",
        ],
    },
    {
        "id": "offboard-user",
        "label": "Offboard user",
        "description": "Disable access, revoke sessions, preserve mailbox data, and reclaim licences as one governed plan.",
        "permission": "entra.user.disable",
        "impact": "critical",
        "approval_required": True,
        "target": "user",
        "fields": [
            {
                "key": "effective_at",
                "label": "Effective date and time",
                "type": "datetime-local",
                "required": True,
            },
            {
                "key": "mailbox_action",
                "label": "Mailbox treatment",
                "type": "select",
                "required": True,
                "default": "convert_shared",
                "options": [
                    {"value": "convert_shared", "label": "Convert to shared mailbox"},
                    {"value": "preserve", "label": "Preserve current mailbox"},
                    {"value": "archive", "label": "Archive before licence removal"},
                ],
            },
            {
                "key": "forward_to",
                "label": "Forward mail to",
                "type": "email",
                "required": False,
                "placeholder": "Optional verified manager address",
            },
            {
                "key": "reclaim_licences",
                "label": "Licence handling",
                "type": "select",
                "required": True,
                "default": "reclaim",
                "options": [
                    {"value": "reclaim", "label": "Reclaim assigned licences"},
                    {"value": "preserve", "label": "Preserve licences for review"},
                ],
            },
        ],
        "rollback": "Re-enable sign-in, restore the recorded licence and mailbox state, and reverse forwarding only after an authorised rollback.",
        "steps": [
            "Confirm the departure authority and effective time",
            "Preview identity, mailbox, group, session, and licence changes",
            "Request approval with rollback and handover context",
            "Run the provider workflow and retain step-level evidence",
        ],
    },
)


def _iso(value) -> str | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


def _normalise_action_options(template: dict, raw_options) -> tuple[dict, list[str]]:
    """Validate the option contract without ever treating a preview as execution."""
    incoming = raw_options if isinstance(raw_options, dict) else {}
    output: dict[str, str] = {}
    missing: list[str] = []

    for field in template.get("fields") or []:
        key = str(field.get("key") or "").strip()
        if not key:
            continue
        raw_value = incoming.get(key, field.get("default", ""))
        value = str(raw_value or "").strip()
        if field.get("required") and not value:
            missing.append(str(field.get("label") or key))
            continue
        allowed = {
            str(option.get("value"))
            for option in field.get("options") or []
            if option.get("value") is not None
        }
        if value and allowed and value not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Select a valid value for {field.get('label') or key}",
            )
        if value and field.get("type") == "email" and (
            "@" not in value or value.startswith("@") or value.endswith("@")
        ):
            raise HTTPException(
                status_code=400,
                detail=f"Enter a valid email address for {field.get('label') or key}",
            )
        output[key] = value

    return output, missing


async def _recent_activity() -> list[dict]:
    rows = await db.activity_logs.find(
        {},
        {
            "_id": 0,
            "id": 1,
            "action": 1,
            "entity_type": 1,
            "entity_name": 1,
            "description": 1,
            "user_name": 1,
            "user_email": 1,
            "timestamp": 1,
            "created_at": 1,
        },
    ).sort([("timestamp", -1), ("created_at", -1)]).limit(12).to_list(12)
    return [
        {
            **row,
            "timestamp": _iso(row.get("timestamp") or row.get("created_at")),
        }
        for row in rows
    ]


@router.get("/control-plane/overview")
async def control_plane_overview(current_user: dict = Depends(get_current_user)):
    cipp_settings, m365_settings = await asyncio.gather(
        db.settings.find_one({"type": "cipp"}, {"_id": 0}),
        db.settings.find_one({"key": "m365_connection"}, {"_id": 0}),
    )
    m365_value = (m365_settings or {}).get("value") or {}

    (
        clients,
        devices,
        open_tickets,
        open_invoices,
        m365_tenants,
        m365_users,
        voice_pbxs,
        backup_jobs,
        linked_clients,
        recent_activity,
    ) = await asyncio.gather(
        db.clients.count_documents({}),
        db.devices.count_documents({}),
        db.tickets.count_documents({"status": {"$nin": ["closed", "resolved", "cancelled"]}}),
        db.invoices.count_documents({"status": {"$nin": ["paid", "void", "cancelled"]}}),
        db.m365_tenants.count_documents({"source": {"$in": ["m365_graph", "m365_partner_center"]}}),
        db.m365_users.count_documents({"source": {"$in": ["m365_graph", "m365_partner_center"]}}),
        db.yeastar_pbxs.count_documents({"enabled": {"$ne": False}}),
        db.backup_jobs.count_documents({}),
        db.clients.count_documents({"cipp_tenant_id": {"$exists": True, "$nin": [None, ""]}}),
        _recent_activity(),
    )

    cipp_connected = bool(
        cipp_settings
        and cipp_settings.get("base_url")
        and cipp_settings.get("api_key_full")
    )
    m365_configured = all(
        m365_value.get(field) for field in ("app_id", "tenant_id", "app_secret")
    )
    providers = [
        {
            "id": "microsoft365",
            "name": "Microsoft 365",
            "status": "verified" if m365_tenants else ("configured" if m365_configured or cipp_connected else "setup_required"),
            "detail": f"{m365_tenants or linked_clients} tenant records available",
            "route": "/control-plane?module=microsoft365",
        },
        {
            "id": "voice",
            "name": "Voice",
            "status": "connected" if voice_pbxs else "not_configured",
            "detail": f"{voice_pbxs} active PBX connection{'s' if voice_pbxs != 1 else ''}",
            "route": "/voice",
        },
        {
            "id": "managed-assets",
            "name": "Managed Assets",
            "status": "connected" if devices else "no_evidence",
            "detail": f"{devices} managed endpoint{'s' if devices != 1 else ''}",
            "route": "/devices",
        },
        {
            "id": "backups",
            "name": "Backups",
            "status": "connected" if backup_jobs else "no_evidence",
            "detail": f"{backup_jobs} recorded backup job{'s' if backup_jobs != 1 else ''}",
            "route": "/backup-center",
        },
    ]

    last_sync_candidates = [
        (cipp_settings or {}).get("last_synced_at"),
        m365_value.get("last_synced"),
    ]
    last_sync = max((str(value) for value in last_sync_candidates if value), default=None)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stats": {
            "clients": clients,
            "connected_providers": sum(1 for provider in providers if provider["status"] in {"verified", "connected", "configured"}),
            "m365_tenants": m365_tenants or linked_clients,
            "m365_users": m365_users,
            "managed_assets": devices,
            "open_tickets": open_tickets,
            "open_invoices": open_invoices,
            "last_sync": last_sync,
        },
        "providers": providers,
        "recent_activity": recent_activity,
        "compatibility": {
            "cipp_adapter_configured": cipp_connected,
            "m365_graph_configured": m365_configured,
        },
    }


async def _microsoft_provider_state() -> dict:
    cipp_settings, graph_settings, verified_tenant_count = await asyncio.gather(
        db.settings.find_one({"type": "cipp"}, {"_id": 0}),
        db.settings.find_one({"key": "m365_connection"}, {"_id": 0}),
        db.m365_tenants.count_documents(
            {"source": {"$in": ["m365_graph", "m365_partner_center"]}}
        ),
    )
    graph_value = (graph_settings or {}).get("value") or {}
    cipp_configured = bool(
        cipp_settings
        and cipp_settings.get("base_url")
        and cipp_settings.get("api_key_full")
    )
    partner_configured = all(
        graph_value.get(field)
        for field in ("app_id", "tenant_id", "app_secret")
    )
    cipp_verified = bool(
        cipp_configured
        and (cipp_settings or {}).get("last_test_status") == "success"
    )
    partner_verified = bool(
        partner_configured and graph_value.get("last_test_status") == "success"
    )
    return {
        "configured": cipp_configured or partner_configured,
        "verified": cipp_verified or partner_verified,
        "discovery_provider": (
            "partner_center"
            if partner_verified
            else "cipp"
            if cipp_verified
            else None
        ),
        # Partner Center discovers tenants; it does not by itself authorise
        # customer-tenant mutations. CIPP remains the only live action adapter.
        "execution_provider": "cipp" if cipp_verified else None,
        "cipp_configured": cipp_configured,
        "cipp_verified": cipp_verified,
        "partner_configured": partner_configured,
        "partner_verified": partner_verified,
        "graph_evidence_available": verified_tenant_count > 0,
        "last_tested_at": (
            (cipp_settings or {}).get("last_tested_at")
            or graph_value.get("last_tested_at")
        ),
    }


async def _microsoft_tenant_registry(provider: dict) -> list[dict]:
    """Merge legacy, Partner Center and verified Graph tenant evidence once."""
    clients, connections, verified_tenants = await asyncio.gather(
        db.clients.find(
            {},
            {
                "_id": 0,
                "id": 1,
                "name": 1,
                "cipp_tenant_id": 1,
                "cipp_tenant_display": 1,
                "cipp_tenant_domain": 1,
            },
        ).sort("name", 1).to_list(2000),
        db.m365_tenant_connections.find({}, {"_id": 0})
        .sort("tenant_name", 1)
        .to_list(2000),
        db.m365_tenants.find(
            {"source": {"$in": ["m365_graph", "m365_partner_center"]}},
            {
                "_id": 0,
                "id": 1,
                "tenant_id": 1,
                "name": 1,
                "domain": 1,
                "default_domain": 1,
                "client_id": 1,
                "source": 1,
                "verified_at": 1,
            },
        ).sort("name", 1).to_list(2000),
    )

    client_by_id = {
        str(client.get("id")): client for client in clients if client.get("id")
    }
    client_by_tenant = {
        str(client.get("cipp_tenant_id")): client
        for client in clients
        if client.get("cipp_tenant_id")
    }
    verified_by_tenant = {
        str(tenant.get("tenant_id") or tenant.get("id")): tenant
        for tenant in verified_tenants
        if tenant.get("tenant_id") or tenant.get("id")
    }
    connections_by_tenant = {
        str(connection.get("tenant_id")): connection
        for connection in connections
        if connection.get("tenant_id")
    }

    tenant_ids = set(client_by_tenant) | set(verified_by_tenant) | set(
        connections_by_tenant
    )
    output: list[dict] = []
    for tenant_id in tenant_ids:
        connection = connections_by_tenant.get(tenant_id) or {}
        verified = verified_by_tenant.get(tenant_id) or {}
        linked_client = (
            client_by_id.get(str(connection.get("client_id")))
            if connection.get("client_id")
            else None
        ) or (
            client_by_id.get(str(verified.get("client_id")))
            if verified.get("client_id")
            else None
        ) or client_by_tenant.get(tenant_id)
        mapped = bool(linked_client)
        graph_verified = bool(
            connection.get("graph_verified") or verified
        )
        source = (
            connection.get("source")
            or verified.get("source")
            or "existing_client_link"
        )
        access_status = (
            "connected"
            if graph_verified
            else "consent_required"
            if connection.get("consent_method") == "customer_admin"
            else "gdap_required"
            if connection
            else "provider_unverified"
        )
        provider_reachable = bool(
            graph_verified
            or (
                provider.get("cipp_verified")
                and tenant_id in client_by_tenant
            )
        )
        action_ready = bool(
            mapped
            and provider.get("execution_provider")
            and provider_reachable
        )
        readiness_reasons: list[str] = []
        if not mapped:
            readiness_reasons.append("Map the tenant to a Nexus client")
        if not provider_reachable:
            readiness_reasons.append(
                "Verify GDAP, customer consent, or provider tenant access"
            )
        if not provider.get("execution_provider"):
            readiness_reasons.append("Connect and test a Microsoft action adapter")

        output.append(
            {
                "id": tenant_id,
                "connection_id": connection.get("id"),
                "name": (
                    connection.get("tenant_name")
                    or verified.get("name")
                    or (linked_client or {}).get("cipp_tenant_display")
                    or (linked_client or {}).get("name")
                    or tenant_id
                ),
                "domain": (
                    connection.get("default_domain")
                    or verified.get("default_domain")
                    or verified.get("domain")
                    or (linked_client or {}).get("cipp_tenant_domain")
                ),
                "client_id": (linked_client or {}).get("id"),
                "client_name": (linked_client or {}).get("name"),
                "source": source,
                "consent_method": connection.get("consent_method"),
                "mapped": mapped,
                "graph_verified": graph_verified,
                "access_status": access_status,
                "provider_reachable": provider_reachable,
                "action_ready": action_ready,
                "readiness_reasons": readiness_reasons,
            }
        )

    return sorted(
        output,
        key=lambda tenant: (
            str(tenant.get("name") or "").lower(),
            str(tenant.get("id") or ""),
        ),
    )


def _public_action_template(template: dict, permission: dict) -> dict:
    permission_record = ACTION_PERMISSION_BY_ID.get(template["permission"], {})
    return {
        **template,
        "allowed": bool(permission.get("allowed")),
        "permission_source": permission.get("source"),
        "permission_label": permission_record.get("label", template["permission"]),
    }


@router.get("/control-plane/microsoft/readiness")
async def microsoft_control_readiness(current_user: dict = Depends(get_current_user)):
    """Return evidence required before a technician plans a Microsoft action."""
    provider, recent_plans = await asyncio.gather(
        _microsoft_provider_state(),
        db.control_plane_action_plans.find(
            {"domain": "microsoft365"},
            {"_id": 0},
        ).sort("created_at", -1).limit(12).to_list(12),
    )
    permission_results = await asyncio.gather(
        *[
            evaluate_action_permission(current_user, template["permission"])
            for template in MICROSOFT_ACTION_TEMPLATES
        ]
    )
    tenants = await _microsoft_tenant_registry(provider)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "provider": provider,
        "tenants": tenants,
        "actions": [
            _public_action_template(template, permission)
            for template, permission in zip(MICROSOFT_ACTION_TEMPLATES, permission_results)
        ],
        "recent_plans": recent_plans,
        "summary": {
            "tenants": len(tenants),
            "linked_clients": sum(1 for tenant in tenants if tenant.get("mapped")),
            "execution_ready_tenants": sum(
                1 for tenant in tenants if tenant.get("action_ready")
            ),
            "available_actions": sum(1 for result in permission_results if result.get("allowed")),
            "pending_approvals": sum(
                1 for plan in recent_plans if plan.get("status") == "pending_approval"
            ),
        },
    }


@router.post("/control-plane/microsoft/actions/preview")
async def preview_microsoft_action(
    data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Build and retain a non-mutating, approval-aware Microsoft action plan."""
    action_id = str((data or {}).get("action_id") or "").strip()
    template = next(
        (item for item in MICROSOFT_ACTION_TEMPLATES if item["id"] == action_id),
        None,
    )
    if not template:
        raise HTTPException(status_code=404, detail="Microsoft action template not found")

    tenant_id = str((data or {}).get("tenant_id") or "").strip()
    target_id = str((data or {}).get("target_id") or "").strip()
    reason = str((data or {}).get("reason") or "").strip()
    ticket_id = str((data or {}).get("ticket_id") or "").strip()
    change_reference = str((data or {}).get("change_reference") or "").strip()
    options, missing_options = _normalise_action_options(
        template,
        (data or {}).get("options"),
    )

    if not tenant_id:
        raise HTTPException(status_code=400, detail="Select a Microsoft tenant")
    if template["target"] == "user" and not target_id:
        raise HTTPException(status_code=400, detail="Select or enter the target user")
    if len(reason) < 8:
        raise HTTPException(
            status_code=400,
            detail="Record a technician reason of at least 8 characters",
        )
    if missing_options:
        raise HTTPException(
            status_code=400,
            detail=f"Complete the required planning fields: {', '.join(missing_options)}",
        )

    provider, permission = await asyncio.gather(
        _microsoft_provider_state(),
        evaluate_action_permission(current_user, template["permission"]),
    )
    registry = await _microsoft_tenant_registry(provider)
    tenant = next((item for item in registry if item.get("id") == tenant_id), None)
    if not tenant:
        raise HTTPException(
            status_code=400,
            detail="Select a tenant from the current Microsoft onboarding registry",
        )
    if action_id == "create-user":
        target_id = options.get("user_principal_name") or target_id

    blocks: list[dict] = []
    if not permission.get("allowed"):
        blocks.append(
            {
                "id": "permission",
                "label": "Action permission",
                "detail": f"Your role does not allow {template['permission']}.",
            }
        )
    if not provider.get("configured"):
        blocks.append(
            {
                "id": "provider",
                "label": "Microsoft provider",
                "detail": "Configure Microsoft tenant discovery and a supported action adapter first.",
            }
        )
    elif not provider.get("verified"):
        blocks.append(
            {
                "id": "provider-verification",
                "label": "Provider verification",
                "detail": "Test the configured Microsoft connection before submitting tenant work.",
            }
        )
    elif not provider.get("execution_provider"):
        blocks.append(
            {
                "id": "execution-provider",
                "label": "Execution provider",
                "detail": "Partner Center discovery is available, but a verified customer-tenant action adapter is still required.",
            }
        )
    if not tenant.get("mapped"):
        blocks.append(
            {
                "id": "client-link",
                "label": "Client relationship",
                "detail": "Link this tenant to a Nexus client before running a tenant action.",
            }
        )
    if not tenant.get("provider_reachable"):
        blocks.append(
            {
                "id": "tenant-access",
                "label": "Tenant access",
                "detail": "Verify GDAP, customer consent, or provider-backed access for this specific tenant.",
            }
        )
    if template["approval_required"] and not (ticket_id or change_reference):
        blocks.append(
            {
                "id": "service-reference",
                "label": "Service or change reference",
                "detail": "Critical actions require a related ticket or change reference.",
            }
        )

    now = datetime.now(timezone.utc).isoformat()
    plan_id = f"m365-plan-{uuid.uuid4().hex[:12]}"
    status = (
        "blocked"
        if blocks
        else "approval_required"
        if template["approval_required"]
        else "ready"
    )
    actor = current_user.get("name") or current_user.get("email") or "Technician"
    option_fields = {
        field.get("key"): field for field in template.get("fields") or []
    }
    option_summary = []
    for key, value in options.items():
        field = option_fields.get(key) or {}
        display_value = value
        for option in field.get("options") or []:
            if str(option.get("value")) == value:
                display_value = str(option.get("label") or value)
                break
        option_summary.append(
            {
                "key": key,
                "label": field.get("label") or key.replace("_", " ").title(),
                "value": value,
                "display_value": display_value,
            }
        )
    plan = {
        "id": plan_id,
        "domain": "microsoft365",
        "simulation_mode": True,
        "will_execute": False,
        "action_id": action_id,
        "action_label": template["label"],
        "impact": template["impact"],
        "approval_required": template["approval_required"],
        "permission": template["permission"],
        "permission_source": permission.get("source"),
        "tenant_id": tenant_id,
        "tenant_name": tenant.get("name"),
        "tenant_domain": tenant.get("domain"),
        "tenant_source": tenant.get("source"),
        "connection_id": tenant.get("connection_id"),
        "access_status": tenant.get("access_status"),
        "provider_reachable": tenant.get("provider_reachable"),
        "target_id": target_id or None,
        "client_id": tenant.get("client_id"),
        "client_name": tenant.get("client_name"),
        "reason": reason,
        "ticket_id": ticket_id or None,
        "change_reference": change_reference or None,
        "options": options,
        "option_summary": option_summary,
        "steps": template["steps"],
        "rollback_plan": template.get("rollback"),
        "before_state": "Provider state will be re-read and retained immediately before any approved execution.",
        "after_state": f"Proposed outcome only: {template['label']} completes with provider evidence and reconciliation.",
        "blocks": blocks,
        "status": status,
        "created_at": now,
        "preview_expires_at": (
            datetime.now(timezone.utc) + timedelta(minutes=30)
        ).isoformat(),
        "created_by": current_user.get("id"),
        "created_by_name": actor,
    }
    await db.control_plane_action_plans.insert_one(dict(plan))
    await db.activity_logs.insert_one(
        {
            "id": f"activity-{uuid.uuid4().hex[:12]}",
            "action": "microsoft_action_previewed",
            "entity_type": "microsoft_action_plan",
            "entity_id": plan_id,
            "entity_name": template["label"],
            "description": f"{actor} previewed {template['label']} for {target_id or tenant_id}",
            "user_name": actor,
            "user_email": current_user.get("email"),
            "timestamp": now,
            "metadata": {
                "status": status,
                "tenant_id": tenant_id,
                "target_id": target_id or None,
                "client_id": tenant.get("client_id"),
                "connection_id": tenant.get("connection_id"),
                "simulation_mode": True,
                "will_execute": False,
                "ticket_id": ticket_id or None,
                "change_reference": change_reference or None,
            },
        }
    )
    return plan


@router.post("/control-plane/microsoft/actions/{plan_id}/submit")
async def submit_microsoft_action_plan(
    plan_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Submit a preview for approval or retain it as an execution-ready plan."""
    plan = await db.control_plane_action_plans.find_one(
        {"id": plan_id, "domain": "microsoft365"},
        {"_id": 0},
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Microsoft action plan not found")
    if plan.get("blocks"):
        raise HTTPException(
            status_code=409,
            detail="Resolve every readiness gate before submitting this plan",
        )
    if plan.get("status") not in {"ready", "approval_required"}:
        raise HTTPException(status_code=409, detail="This action plan has already been submitted")

    expires_at = plan.get("preview_expires_at")
    if expires_at:
        try:
            expired = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) <= datetime.now(timezone.utc)
        except ValueError:
            expired = True
        if expired:
            await db.control_plane_action_plans.update_one(
                {"id": plan_id},
                {"$set": {"status": "expired"}},
            )
            raise HTTPException(
                status_code=409,
                detail="This preview has expired. Generate a fresh provider and permission check.",
            )

    template = next(
        (
            item
            for item in MICROSOFT_ACTION_TEMPLATES
            if item["id"] == plan.get("action_id")
        ),
        None,
    )
    if not template:
        raise HTTPException(status_code=409, detail="The action template is no longer available")
    provider, permission = await asyncio.gather(
        _microsoft_provider_state(),
        evaluate_action_permission(current_user, template["permission"]),
    )
    registry = await _microsoft_tenant_registry(provider)
    tenant = next(
        (item for item in registry if item.get("id") == plan.get("tenant_id")),
        None,
    )
    if not permission.get("allowed"):
        raise HTTPException(
            status_code=403,
            detail="Your current role no longer permits this Microsoft action",
        )
    if not tenant or not tenant.get("action_ready"):
        raise HTTPException(
            status_code=409,
            detail="Microsoft tenant readiness changed. Generate a fresh preview after resolving mapping, consent, and provider access.",
        )

    now = datetime.now(timezone.utc).isoformat()
    actor = current_user.get("name") or current_user.get("email") or "Technician"
    if plan.get("approval_required"):
        approval_id = f"approval-{uuid.uuid4().hex[:10]}"
        await db.approvals.insert_one(
            {
                "id": approval_id,
                "type": "microsoft_action",
                "title": plan.get("action_label"),
                "description": plan.get("reason"),
                "status": "pending",
                "requested_by": actor,
                "requested_by_id": current_user.get("id"),
                "created_at": now,
                "entity_type": "microsoft_action_plan",
                "entity_id": plan_id,
                "tenant_id": plan.get("tenant_id"),
                "tenant_name": plan.get("tenant_name"),
                "client_id": plan.get("client_id"),
                "client_name": plan.get("client_name"),
                "target_id": plan.get("target_id"),
                "ticket_id": plan.get("ticket_id"),
                "change_reference": plan.get("change_reference"),
                "option_summary": plan.get("option_summary"),
                "rollback_plan": plan.get("rollback_plan"),
            }
        )
        next_status = "pending_approval"
    else:
        approval_id = None
        next_status = "ready_for_execution"

    await db.control_plane_action_plans.update_one(
        {"id": plan_id},
        {
            "$set": {
                "status": next_status,
                "approval_id": approval_id,
                "submitted_at": now,
                "submitted_by": current_user.get("id"),
                "submitted_by_name": actor,
            }
        },
    )
    return {
        "id": plan_id,
        "status": next_status,
        "approval_id": approval_id,
        "message": (
            "Approval requested; no Microsoft change has been run"
            if approval_id
            else "Execution plan saved; no Microsoft change has been run"
        ),
    }


@router.get("/control-plane/foundation")
async def control_plane_foundation(current_user: dict = Depends(get_current_user)):
    """Expose the shared platform contract and its evidence-backed readiness.

    The response intentionally distinguishes what is operational today from a
    production target.  It is an architecture control surface, not a claim
    that NATS, PostgreSQL, ClickHouse or Vault have already been deployed.
    """

    (
        clients,
        users,
        mfa_users,
        devices,
        activities,
        platform_events,
        workflows,
        simulations,
        workflow_logs,
        pending_approvals,
        permission_denials,
        restricted_users,
        scope_denials,
        service_tiers,
        active_pbxs,
        dns_settings,
        core_integrity,
        event_health,
    ) = await asyncio.gather(
        db.clients.count_documents({}),
        db.users.count_documents({}),
        db.user_2fa.count_documents({"verified": True}),
        db.devices.count_documents({}),
        db.activity_logs.count_documents({}),
        db.platform_events.count_documents({}),
        db.workflows.count_documents({}),
        db.workflow_simulations.count_documents({}),
        db.workflow_logs.count_documents({}),
        db.change_requests.count_documents({"status": "pending_review"}),
        db.permission_denials.count_documents({}),
        db.users.count_documents({"client_scope_mode": "restricted"}),
        db.scope_denials.count_documents({}),
        db.service_tiers.count_documents({"is_active": {"$ne": False}}),
        db.yeastar_pbxs.count_documents({"enabled": {"$ne": False}}),
        db.nexus_dns_settings.find_one({"id": "nexus-dns-settings"}, {"_id": 0}),
        core_integrity_snapshot(),
        event_backbone_health(),
    )

    capabilities = [
        {
            "id": "core-model",
            "name": "Canonical Nexus Core model",
            "status": "operational" if core_integrity.get("status") == "healthy" else "partial",
            "owner": "Nexus Core",
            "evidence": (
                f"{core_integrity.get('entities', 0)} canonical entities and "
                f"{core_integrity.get('relationships', 0)} evidence-backed relationships; "
                f"{core_integrity.get('client_linked_pct', 0)}% of client-owned records are linked."
            ),
            "next": (
                "Resolve the retained integrity anomalies and move bounded domains to canonical Nexus references."
                if core_integrity.get("anomaly_count")
                else "Use the shared references in new modules and migrate existing domains incrementally."
            ),
        },
        {
            "id": "tenant-context",
            "name": "Tenant and client context",
            "status": "partial",
            "owner": "Platform",
            "evidence": f"{clients} client records share a common client identity; {restricted_users} technician account(s) have explicit client/site boundaries and {scope_denials} denied cross-scope attempts are retained.",
            "next": "Extend the shared scope evaluator to every remaining client-bearing query and add automated cross-tenant isolation tests.",
        },
        {
            "id": "device-identity",
            "name": "Device identity",
            "status": "partial",
            "owner": "Nexus Agent",
            "evidence": f"{devices} endpoint records use the shared Nexus device identity.",
            "next": "Replace enrollment secrets with per-device certificates, mutual TLS, rotation and hardware-backed keys where available.",
        },
        {
            "id": "user-identity",
            "name": "User identity and access",
            "status": "partial",
            "owner": "Identity",
            "evidence": f"{users} users; {mfa_users} have verified application MFA.",
            "next": "Add passkeys, Entra SSO and session revocation; continue extending enforced client/site scope to remaining routes.",
        },
        {
            "id": "audit",
            "name": "Unified audit evidence",
            "status": "operational" if activities else "partial",
            "owner": "Audit",
            "evidence": f"{activities} cross-entity activity records are retained, with specialist ledgers for tickets, finance and field work.",
            "next": "Converge specialist ledgers behind one immutable tenant-scoped audit projection and archive policy.",
        },
        {
            "id": "event-stream",
            "name": "Durable event backbone",
            "status": "operational" if event_health.get("status") == "healthy" else "partial",
            "owner": "Platform Events",
            "evidence": (
                f"{platform_events} immutable events; {event_health.get('enabled_subscriptions', 0)} enabled subscriber(s), "
                f"{event_health.get('queue_depth', 0)} queued and {event_health.get('dead_letter', 0)} dead-letter deliveries."
            ),
            "next": "Attach NATS JetStream as the distributed transport while retaining this envelope, checkpoint and replay contract.",
        },
        {
            "id": "automation",
            "name": "Governed automation",
            "status": "operational" if workflows else "partial",
            "owner": "Automation",
            "evidence": f"{workflows} workflows, {simulations} simulations, {workflow_logs} executions and {pending_approvals} pending approvals.",
            "next": "Add durable waiting, compensation checkpoints and worker leases so long-running workflows survive every restart.",
        },
        {
            "id": "permissions",
            "name": "Fine-grained permissions",
            "status": "partial",
            "owner": "Identity",
            "evidence": f"{len(ACTION_PERMISSION_IDS)} stable action subjects protect representative DNS, remote, identity, billing and automation routes; client/site boundaries are evaluated independently; {permission_denials + scope_denials} denied actions are retained as evidence.",
            "next": "Extend both shared evaluators to every remaining mutating and client-bearing read route.",
        },
        {
            "id": "correlation",
            "name": "Request correlation",
            "status": "operational",
            "owner": "Observability",
            "evidence": "Every API response now carries the sanitised X-Correlation-ID used by the shared event envelope.",
            "next": "Propagate the same ID through background jobs, connector calls, agent commands and OpenTelemetry spans.",
        },
        {
            "id": "entitlements",
            "name": "Feature entitlements and metering",
            "status": "partial",
            "owner": "Commercial Platform",
            "evidence": f"{service_tiers} active client service tiers; DNS and Voice expose usage-ready billing quantities ({active_pbxs} active PBXs).",
            "next": "Centralise endpoints, protected users, sites, tenants, workloads and module entitlements in one metering ledger.",
        },
        {
            "id": "dns-edge",
            "name": "Nexus DNS edge",
            "status": "partial",
            "owner": "Nexus DNS",
            "evidence": "The policy, intelligence, audit and deployment control plane is present." if dns_settings else "Nexus DNS has no retained platform settings yet.",
            "next": "Deploy dnsdist plus a primary recursive resolver fleet and distribute compiled in-memory policy snapshots.",
        },
        {
            "id": "analytics",
            "name": "High-volume analytics plane",
            "status": "planned",
            "owner": "Data Platform",
            "evidence": "Operational reporting currently reads the primary application database.",
            "next": "Introduce ClickHouse for DNS, endpoint and security telemetry, with object storage for long-term archives.",
        },
        {
            "id": "secrets",
            "name": "Tenant-scoped secrets and keys",
            "status": "planned",
            "owner": "Security Platform",
            "evidence": "Connector secrets use existing application configuration boundaries; envelope encryption is not yet platform-wide.",
            "next": "Adopt managed KMS or Vault, per-tenant data keys, rotation and secret references instead of ordinary settings fields.",
        },
    ]

    technology_path = [
        {"layer": "Web experience", "current": "React JavaScript + shared Nexus components", "target": "React TypeScript with a versioned Nexus Design System", "decision": "Migrate incrementally; do not interrupt current workspaces."},
        {"layer": "Core business API", "current": "Python FastAPI", "target": "ASP.NET Core services where Microsoft-heavy business domains justify it", "decision": "Use strangler services and stable contracts; no big-bang rewrite."},
        {"layer": "Endpoint agent", "current": "Go Nexus Agent", "target": "Retain the proven agent; evaluate Rust for DNS, networking or security-sensitive sidecars", "decision": "Security and signed-update evidence matter more than language fashion."},
        {"layer": "Transactional data", "current": "MongoDB application store", "target": "PostgreSQL source of truth with tenant row-level security", "decision": "Migrate bounded domains only after isolation and reconciliation tests exist."},
        {"layer": "Telemetry", "current": "Primary-store reporting", "target": "ClickHouse plus S3-compatible archive storage", "decision": "Keep raw DNS and endpoint telemetry away from billing and ticket transactions."},
        {"layer": "Events", "current": "Durable MongoDB envelope + SSE live fan-out", "target": "NATS JetStream transport and replayable consumers", "decision": "The event schema remains transport-neutral."},
        {"layer": "Cache and locks", "current": "Process-local short-lived state", "target": "Redis-compatible sessions, rate limits, caches and distributed locks", "decision": "Never use cache state as the permanent source of truth."},
        {"layer": "Observability", "current": "Structured application logs + correlation IDs", "target": "OpenTelemetry traces, metrics and logs with Prometheus/Grafana-compatible backends", "decision": "Propagate one correlation ID from portal to provider and agent."},
        {"layer": "Secrets", "current": "Application configuration and environment secrets", "target": "Managed KMS/Vault with envelope encryption", "decision": "Tenant data keys and rotation are required before centralising sensitive credentials."},
        {"layer": "Nexus DNS", "current": "Policy and security control plane", "target": "dnsdist + PowerDNS Recursor + compiled RPZ/policy snapshots", "decision": "Never make the DNS request path call the primary API or database."},
    ]

    status_counts = {
        status: sum(1 for item in capabilities if item["status"] == status)
        for status in ("operational", "partial", "planned")
    }
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            **status_counts,
            "event_subjects": len(EVENT_SUBJECTS),
            "correlation_header": "X-Correlation-ID",
            "schema_version": 1,
            "core_entities": core_integrity.get("entities", 0),
            "core_relationships": core_integrity.get("relationships", 0),
            "core_anomalies": core_integrity.get("anomaly_count", 0),
        },
        "principles": [
            "One tenant and client context",
            "One canonical relationship model",
            "One device identity",
            "One user identity",
            "One audit contract",
            "One automation contract",
            "One event envelope",
            "One permission vocabulary",
        ],
        "event_contract": {
            "required_fields": [
                "id", "subject", "schema_version", "source", "tenant_id",
                "correlation_id", "actor", "payload", "occurred_at",
                "partition_key", "sequence", "published_at", "retention_until",
            ],
            "transport": "mongodb-durable+sse",
            "target_transport": "nats-jetstream",
            "subjects": EVENT_SUBJECTS,
            "health": event_health,
            "delivery_guarantee": "at-least-once",
            "idempotency": "tenant-scoped publisher key",
            "replay": "governed retained-event redelivery",
        },
        "core_model": {
            "schema": core_schema(),
            "integrity": core_integrity,
        },
        "capabilities": capabilities,
        "technology_path": technology_path,
        "guardrails": [
            "Do not build a recursive DNS server, identity provider, cryptographic primitive, database engine or message broker.",
            "No high-impact action runs without an action-specific permission, audit evidence and an approval boundary where policy requires one.",
            "Agents must move toward signed binaries, signed staged updates, per-device certificates, rollback and secure uninstall.",
            "Configuration changes must be versioned, diffable, attributable and restorable.",
            "Telemetry and analytics workloads must not degrade ticketing, billing or authentication.",
            "Every connector must declare authentication, capabilities, sync health, retry behaviour, mappings and billing usage.",
        ],
    }


async def _find(collection, query: dict, projection: dict, limit: int = 8) -> list[dict]:
    return await collection.find(query, {"_id": 0, **projection}).limit(limit).to_list(limit)


@router.get("/control-plane/search")
async def control_plane_search(
    q: str = Query(..., min_length=2, max_length=120),
    current_user: dict = Depends(get_current_user),
):
    term = q.strip()
    escaped = re.escape(term)
    regex = {"$regex": escaped, "$options": "i"}

    (
        clients,
        tickets,
        devices,
        m365_users,
        invoices,
        voice,
        backups,
        knowledge,
        products,
    ) = await asyncio.gather(
        _find(
            db.clients,
            {"$or": [{"name": regex}, {"company_name": regex}, {"email": regex}, {"phone": regex}]},
            {"id": 1, "name": 1, "company_name": 1, "email": 1, "status": 1},
        ),
        _find(
            db.tickets,
            {"$or": [{"title": regex}, {"ticket_number": regex}, {"client_name": regex}, {"requester_email": regex}]},
            {"id": 1, "ticket_number": 1, "title": 1, "client_name": 1, "status": 1, "priority": 1},
        ),
        _find(
            db.devices,
            {"$or": [{"hostname": regex}, {"name": regex}, {"serial_number": regex}, {"client_name": regex}]},
            {"id": 1, "hostname": 1, "name": 1, "serial_number": 1, "client_name": 1, "status": 1},
        ),
        _find(
            db.m365_users,
            {"source": {"$in": ["m365_graph", "m365_partner_center"]}, "$or": [{"display_name": regex}, {"upn": regex}, {"tenant_name": regex}]},
            {"id": 1, "display_name": 1, "upn": 1, "tenant_name": 1, "tenant_id": 1, "account_enabled": 1},
        ),
        _find(
            db.invoices,
            {"$or": [{"invoice_number": regex}, {"invoice_name": regex}, {"name": regex}, {"client_name": regex}]},
            {"id": 1, "invoice_number": 1, "invoice_name": 1, "name": 1, "client_name": 1, "status": 1, "total": 1},
        ),
        _find(
            db.yeastar_pbxs,
            {"$or": [{"name": regex}, {"pbx_name": regex}, {"client_name": regex}, {"fqdn": regex}, {"cloud_url": regex}]},
            {"id": 1, "name": 1, "pbx_name": 1, "client_name": 1, "status": 1, "extension_count": 1},
        ),
        _find(
            db.backup_jobs,
            {"$or": [{"name": regex}, {"job_name": regex}, {"client_name": regex}, {"device_name": regex}]},
            {"id": 1, "name": 1, "job_name": 1, "client_name": 1, "status": 1, "last_run": 1},
        ),
        _find(
            db.kb_articles,
            {"$or": [{"title": regex}, {"summary": regex}, {"category": regex}, {"tags": regex}]},
            {"id": 1, "slug": 1, "title": 1, "summary": 1, "category": 1, "status": 1},
        ),
        _find(
            db.products,
            {"$or": [{"name": regex}, {"sku": regex}, {"description": regex}, {"category": regex}]},
            {"id": 1, "name": 1, "sku": 1, "category": 1, "status": 1, "price": 1},
        ),
    )

    groups = {
        "clients": [
            {
                "kind": "Client",
                "id": item.get("id"),
                "title": item.get("name") or item.get("company_name"),
                "subtitle": item.get("email"),
                "status": item.get("status"),
                "route": f"/clients?client={item.get('id')}",
            }
            for item in clients
        ],
        "tickets": [
            {
                "kind": "Ticket",
                "id": item.get("id"),
                "title": f"{item.get('ticket_number') or 'Ticket'} · {item.get('title') or ''}".strip(),
                "subtitle": item.get("client_name"),
                "status": item.get("status"),
                "route": f"/tickets?ticket={item.get('id')}",
            }
            for item in tickets
        ],
        "devices": [
            {
                "kind": "Managed asset",
                "id": item.get("id"),
                "title": item.get("hostname") or item.get("name"),
                "subtitle": item.get("client_name") or item.get("serial_number"),
                "status": item.get("status"),
                "route": f"/devices/{item.get('id')}",
            }
            for item in devices
        ],
        "microsoft_users": [
            {
                "kind": "Microsoft user",
                "id": item.get("id"),
                "title": item.get("display_name") or item.get("upn"),
                "subtitle": f"{item.get('upn') or ''} · {item.get('tenant_name') or ''}".strip(" ·"),
                "status": "enabled" if item.get("account_enabled", True) else "blocked",
                "route": f"/control-plane?module=microsoft365&search={item.get('upn') or item.get('display_name') or ''}",
            }
            for item in m365_users
        ],
        "invoices": [
            {
                "kind": "Invoice",
                "id": item.get("id"),
                "title": item.get("invoice_name") or item.get("name") or item.get("invoice_number"),
                "subtitle": f"{item.get('invoice_number') or ''} · {item.get('client_name') or ''}".strip(" ·"),
                "status": item.get("status"),
                "route": f"/invoices?invoice={item.get('id')}",
            }
            for item in invoices
        ],
        "voice": [
            {
                "kind": "Voice PBX",
                "id": item.get("id"),
                "title": item.get("pbx_name") or item.get("name"),
                "subtitle": f"{item.get('client_name') or ''} · {item.get('extension_count') or 0} extensions".strip(" ·"),
                "status": item.get("status"),
                "route": f"/voice?pbx={item.get('id')}",
            }
            for item in voice
        ],
        "backups": [
            {
                "kind": "Backup job",
                "id": item.get("id"),
                "title": item.get("job_name") or item.get("name"),
                "subtitle": item.get("client_name"),
                "status": item.get("status"),
                "route": "/backup-center",
            }
            for item in backups
        ],
        "knowledge": [
            {
                "kind": "Knowledge",
                "id": item.get("id") or item.get("slug"),
                "title": item.get("title"),
                "subtitle": item.get("category") or item.get("summary"),
                "status": item.get("status"),
                "route": f"/documentation-hub?tab=library&article={item.get('id') or item.get('slug')}",
            }
            for item in knowledge
        ],
        "products": [
            {
                "kind": "Product",
                "id": item.get("id"),
                "title": item.get("name"),
                "subtitle": f"{item.get('sku') or ''} · {item.get('category') or ''}".strip(" ·"),
                "status": item.get("status"),
                "route": f"/products?product={item.get('id')}",
            }
            for item in products
        ],
    }
    return {
        "query": term,
        "count": sum(len(items) for items in groups.values()),
        "groups": groups,
    }
