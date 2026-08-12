"""Microsoft 365 connection, reference policy and verified-evidence endpoints.

This workspace deliberately does not manufacture Microsoft 365 tenants, posture,
alerts, or remediation results.  It can store connection details and local policy
configuration, but operational data is returned only when it has been written by
a verified Microsoft Graph/Partner Center synchronisation provider.
"""
from datetime import datetime, timezone
from typing import Any
import json
import logging
import os
import re
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.action_permissions import require_action


logger = logging.getLogger(__name__)
router = APIRouter()

# Only a dedicated synchroniser may write data under one of these sources.  The
# current application has no Graph synchroniser, so the workspace truthfully
# remains empty until one is installed and verified.
VERIFIED_SOURCES = ("m365_graph", "m365_partner_center")
LEGACY_MOCK_SOURCE = "m365cc"

STANDARD_LIBRARY = [
    {
        "key": "require_mfa_all_users",
        "name": "Require MFA for all users",
        "category": "identity",
        "severity": "high",
        "description": "Require phishing-resistant MFA where licensing and risk justify it.",
    },
    {
        "key": "block_legacy_auth",
        "name": "Block legacy authentication",
        "category": "identity",
        "severity": "high",
        "description": "Block legacy protocols after validating required exceptions.",
    },
    {
        "key": "mailbox_auditing_on",
        "name": "Enable mailbox auditing",
        "category": "exchange",
        "severity": "medium",
        "description": "Record owner, delegate and administrator mailbox actions.",
    },
    {
        "key": "disable_external_forwarding",
        "name": "Block external email forwarding",
        "category": "exchange",
        "severity": "high",
        "description": "Prevent unauthorised forwarding rules that can exfiltrate mail.",
    },
    {
        "key": "sharepoint_block_anonymous",
        "name": "Block anonymous SharePoint links",
        "category": "sharepoint",
        "severity": "high",
        "description": "Review and restrict 'Anyone with the link' sharing defaults.",
    },
    {
        "key": "teams_external_chat_restrict",
        "name": "Restrict Teams external chat",
        "category": "teams",
        "severity": "medium",
        "description": "Limit external communication to approved domains and partners.",
    },
    {
        "key": "intune_compliance_baseline",
        "name": "Apply Intune compliance baseline",
        "category": "intune",
        "severity": "high",
        "description": "Define a compliant-device baseline before Conditional Access enforcement.",
    },
]

CA_TEMPLATE_LIBRARY = [
    {"key": "require_mfa_admins", "name": "Require MFA for administrator roles", "source": "Nexus reference", "category": "identity", "severity": "critical"},
    {"key": "block_legacy_auth_ca", "name": "Block legacy authentication", "source": "Nexus reference", "category": "identity", "severity": "high"},
    {"key": "require_mfa_guest", "name": "Require MFA for guests", "source": "Nexus reference", "category": "identity", "severity": "high"},
    {"key": "require_compliant_device", "name": "Require compliant device", "source": "Nexus reference", "category": "device", "severity": "high"},
    {"key": "block_high_risk_signin", "name": "Block high-risk sign-ins", "source": "Nexus reference", "category": "risk", "severity": "high"},
    {"key": "require_terms_of_use", "name": "Require Terms of Use", "source": "Nexus reference", "category": "governance", "severity": "low"},
]

GDAP_ROLE_TEMPLATES = [
    {"id": "tier1-helpdesk", "name": "Tier 1 - Helpdesk", "roles": ["Helpdesk Administrator", "User Administrator", "Reports Reader"]},
    {"id": "tier2-l2-tech", "name": "Tier 2 - L2 Technician", "roles": ["User Administrator", "Authentication Administrator", "Application Administrator", "Exchange Administrator", "Intune Administrator", "Reports Reader"]},
    {"id": "tier3-engineer", "name": "Tier 3 - Engineer", "roles": ["Cloud Application Administrator", "Conditional Access Administrator", "Security Administrator", "Intune Administrator", "Exchange Administrator", "Teams Administrator", "Reports Reader"]},
    {"id": "billing-only", "name": "Billing only", "roles": ["License Administrator", "Reports Reader"]},
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_settings() -> dict:
    settings = await db.settings.find_one({"key": "m365_connection"}, {"_id": 0}) or {}
    return settings.get("value") or {}


def _connection_status(settings: dict) -> str:
    configured = [
        settings.get("app_id"),
        settings.get("partner_tenant_id") or settings.get("tenant_id"),
        settings.get("app_secret"),
    ]
    if not any(configured):
        return "not_configured"
    if not all(configured):
        return "incomplete"
    # Do not call this live until a Graph token test and sync implementation exist.
    return "configured_unverified"


def _verified_query(extra: dict | None = None) -> dict:
    query: dict[str, Any] = {"source": {"$in": list(VERIFIED_SOURCES)}}
    if extra:
        query.update(extra)
    return query


async def _retire_legacy_mock_data() -> None:
    """Remove the former demo records without touching verified provider data."""
    tenants = await db.m365_tenants.find({"source": LEGACY_MOCK_SOURCE}, {"_id": 0, "id": 1}).to_list(500)
    tenant_ids = [tenant.get("id") for tenant in tenants if tenant.get("id")]
    await db.m365_tenants.delete_many({"source": LEGACY_MOCK_SOURCE})
    if tenant_ids:
        await db.m365_users.delete_many({"tenant_id": {"$in": tenant_ids}, "source": LEGACY_MOCK_SOURCE})
        await db.m365_gdap.delete_many({"tenant_id": {"$in": tenant_ids}})
        await db.m365_standard_runs.delete_many({"tenant_id": {"$in": tenant_ids}})
        await db.m365_ca_deployments.delete_many({"tenant_id": {"$in": tenant_ids}})
    await db.m365_standards.delete_many({"id": {"$regex": "^std-"}})
    await db.m365_standard_run_summaries.delete_many({"standard_id": {"$regex": "^std-"}})
    await db.m365_ca_templates.delete_many({"id": {"$regex": "^cat-"}})
    await db.m365_scripted_alerts.delete_many({"id": {"$regex": "^sa-"}})


async def _connection_payload() -> dict:
    settings = await _get_settings()
    telemetry_available = await db.m365_tenants.count_documents(_verified_query()) > 0
    partner_tenant_id = settings.get("partner_tenant_id") or settings.get("tenant_id")
    return {
        "app_id": settings.get("app_id"),
        "tenant_id": partner_tenant_id,
        "partner_tenant_id": partner_tenant_id,
        "secret_configured": bool(settings.get("app_secret")),
        "refresh_token_configured": bool(settings.get("refresh_token")),
        "partner_center_account": settings.get("partner_center_account"),
        "admin_consent_redirect_uri": settings.get("admin_consent_redirect_uri"),
        "connection_strategy": settings.get("connection_strategy") or "partner_center",
        "mode": _connection_status(settings),
        "last_synced": settings.get("last_synced"),
        "last_discovery_at": settings.get("last_discovery_at"),
        "last_tested_at": settings.get("last_tested_at"),
        "last_test_status": settings.get("last_test_status"),
        "verified_at": settings.get("verified_at"),
        "sync_provider": settings.get("sync_provider"),
        "telemetry_available": telemetry_available,
    }


def _clean_partner_error(response: httpx.Response, fallback: str) -> str:
    try:
        payload = response.json()
    except Exception:
        payload = {}
    if isinstance(payload, dict):
        nested_error = payload.get("error")
        nested_message = nested_error.get("message") if isinstance(nested_error, dict) else None
        detail = payload.get("error_description") or nested_message or payload.get("description") or payload.get("message")
        if detail:
            return str(detail)[:500]
    return fallback


async def _partner_center_customers(settings: dict, max_pages: int = 20) -> list[dict]:
    app_id = str(settings.get("app_id") or "").strip()
    tenant_id = str(settings.get("partner_tenant_id") or settings.get("tenant_id") or "").strip()
    secret = str(settings.get("app_secret") or "").strip()
    if not app_id or not tenant_id or not secret:
        raise HTTPException(
            status_code=409,
            detail="Save the partner tenant ID, App ID and client secret before using Partner Center discovery.",
        )

    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=15.0)) as client:
        try:
            token_response = await client.post(
                token_url,
                data={
                    "client_id": app_id,
                    "client_secret": secret,
                    "grant_type": "client_credentials",
                    "scope": "https://api.partnercenter.microsoft.com/.default",
                },
            )
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"Microsoft identity could not be reached: {str(exc)[:180]}") from exc
        if token_response.status_code >= 400:
            detail = _clean_partner_error(token_response, "Microsoft rejected the Partner Center application credentials.")
            raise HTTPException(status_code=401, detail=detail)
        access_token = (token_response.json() or {}).get("access_token")
        if not access_token:
            raise HTTPException(status_code=502, detail="Microsoft did not return a Partner Center access token.")

        url = "https://api.partnercenter.microsoft.com/v1/customers?size=500"
        customers: list[dict] = []
        for _ in range(max_pages):
            try:
                response = await client.get(
                    url,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/json",
                    },
                )
            except httpx.RequestError as exc:
                raise HTTPException(status_code=503, detail=f"Partner Center could not be reached: {str(exc)[:180]}") from exc
            if response.status_code >= 400:
                detail = _clean_partner_error(response, "Partner Center customer discovery failed.")
                raise HTTPException(status_code=response.status_code if response.status_code < 500 else 502, detail=detail)
            payload = response.json() or {}
            page_items = payload if isinstance(payload, list) else payload.get("items") or payload.get("value") or []
            customers.extend(item for item in page_items if isinstance(item, dict))
            next_link = (payload.get("links") or {}).get("next") if isinstance(payload, dict) else None
            url = (next_link or {}).get("uri") if isinstance(next_link, dict) else None
            if not url:
                break
        return customers


def _normalise_partner_customer(raw: dict) -> dict | None:
    company = raw.get("companyProfile") or raw.get("company_profile") or {}
    tenant_id = (
        company.get("tenantId")
        or raw.get("tenantId")
        or raw.get("customerId")
        or raw.get("id")
    )
    if not tenant_id:
        return None
    name = company.get("companyName") or raw.get("displayName") or raw.get("name") or str(tenant_id)
    domain = company.get("domain") or raw.get("defaultDomainName") or raw.get("domain") or ""
    return {
        "tenant_id": str(tenant_id).strip(),
        "tenant_name": str(name).strip(),
        "default_domain": str(domain).strip().lower(),
        "partner_customer_id": str(raw.get("id") or raw.get("customerId") or tenant_id).strip(),
    }


def _tenant_access_state(row: dict, verified_ids: set[str]) -> tuple[bool, str]:
    verified = bool(row.get("graph_verified")) or str(row.get("tenant_id")) in verified_ids
    if verified:
        return True, "connected"
    if row.get("consent_method") == "customer_admin":
        return False, "consent_required"
    return False, "gdap_required"


async def _mapping_target_client(tenant_id: str, client_id: str | None) -> dict | None:
    """Return a safe client mapping target without silently replacing another tenant."""
    if not client_id:
        return None
    client = await db.clients.find_one(
        {"id": client_id},
        {"_id": 0, "id": 1, "name": 1, "cipp_tenant_id": 1, "cipp_tenant_display": 1},
    )
    if not client:
        raise HTTPException(status_code=404, detail="Nexus client not found.")

    linked_tenant_id = str(client.get("cipp_tenant_id") or "")
    if linked_tenant_id and linked_tenant_id != tenant_id:
        linked_name = client.get("cipp_tenant_display") or linked_tenant_id
        raise HTTPException(
            status_code=409,
            detail=f"{client.get('name') or 'This Nexus client'} is already linked to {linked_name}. Unlink that tenant before assigning another.",
        )

    duplicate = await db.m365_tenant_connections.find_one(
        {"client_id": client_id, "tenant_id": {"$ne": tenant_id}},
        {"_id": 0, "tenant_id": 1, "tenant_name": 1},
    )
    if duplicate:
        linked_name = duplicate.get("tenant_name") or duplicate.get("tenant_id")
        raise HTTPException(
            status_code=409,
            detail=f"{client.get('name') or 'This Nexus client'} is already mapped to {linked_name} in the Microsoft onboarding registry.",
        )
    return client


def _execution_unavailable(detail: str = "A verified Microsoft Graph synchronisation provider is required before this action can run.") -> HTTPException:
    return HTTPException(status_code=409, detail=detail)


# Connection -----------------------------------------------------------------

@router.get("/m365/sync/readiness")
async def microsoft_sync_readiness(current_user: dict = Depends(get_current_user)):
    """Describe the bounded Graph evidence streams Nexus 365 is ready to collect.

    This is a deployment contract, not a permission grant. The route exposes no
    secrets and does not attempt a live Graph call; it gives a technician a
    precise least-privilege checklist before a collector is installed.
    """
    connection = await _connection_payload()
    counts = await asyncio.gather(*[
        getattr(db, stream["collection"]).count_documents(_verified_query())
        for stream in M365_COLLECTOR_STREAMS
    ])
    connection_ready = connection.get("mode") == "configured_unverified" or bool(connection.get("verified_at"))
    streams = []
    for stream, records in zip(M365_COLLECTOR_STREAMS, counts):
        status = "evidence_active" if records else ("ready_to_connect" if connection_ready else "connection_required")
        streams.append({**stream, "records": records, "status": status})
    return {
        "connection": {
            "configured": bool(connection.get("secret_configured") and connection.get("app_id") and connection.get("partner_tenant_id")),
            "verified_at": connection.get("verified_at"),
            "last_sync": connection.get("last_synced"),
        },
        "streams": streams,
        "boundary": "Nexus requests only the read permissions listed for the enabled evidence streams. Write permissions and tenant changes belong to separately governed action workflows.",
    }


@router.get("/m365/connection")
async def get_connection(current_user: dict = Depends(get_current_user)):
    await _retire_legacy_mock_data()
    return await _connection_payload()


@router.put("/m365/connection")
async def update_connection(
    data: dict,
    current_user: dict = Depends(get_current_user),
    _: dict = Depends(require_action("m365.tenant.manage")),
):
    settings = await _get_settings()
    credential_keys = {"app_id", "tenant_id", "partner_tenant_id", "app_secret", "refresh_token"}
    credentials_changed = False
    for key in (
        "app_id",
        "tenant_id",
        "partner_tenant_id",
        "app_secret",
        "refresh_token",
        "partner_center_account",
        "admin_consent_redirect_uri",
        "connection_strategy",
    ):
        if key in data and data[key] is not None:
            value = str(data[key]).strip() or None
            if key in credential_keys and settings.get(key) != value:
                credentials_changed = True
            settings[key] = value
    if settings.get("partner_tenant_id"):
        # Preserve the old key for compatibility with existing provider checks.
        settings["tenant_id"] = settings["partner_tenant_id"]
    # Rotated credentials invalidate the previous test result. Do not leave a
    # stale "verified" badge visible until the new credentials are tested.
    if credentials_changed:
        for key in ("last_test_status", "last_tested_at", "verified_at", "sync_provider"):
            settings.pop(key, None)
        settings["credentials_changed_at"] = _now_iso()
    settings["updated_by"] = current_user.get("name")
    settings["updated_at"] = _now_iso()
    await db.settings.update_one(
        {"key": "m365_connection"},
        {"$set": {"value": settings, "key": "m365_connection"}},
        upsert=True,
    )
    mode = _connection_status(settings)
    await log_activity(current_user, "m365_connection_saved", "settings", "m365_connection", "Microsoft 365 connection", mode)
    return {
        "success": True,
        "mode": mode,
        "message": "Partner connection details saved. Tenant discovery and Graph access are verified separately.",
    }


@router.post("/m365/connection/test")
async def test_connection(
    current_user: dict = Depends(get_current_user),
    _: dict = Depends(require_action("m365.tenant.manage")),
):
    settings = await _get_settings()
    mode = _connection_status(settings)
    if mode != "configured_unverified":
        return {
            "ok": False,
            "mode": mode,
            "reason": "Enter the App ID, Directory (tenant) ID and client secret before verification can be attempted.",
        }
    now = _now_iso()
    try:
        customers = await _partner_center_customers(settings, max_pages=1)
    except HTTPException as exc:
        # A provider outage means we have no trustworthy connection result to
        # persist. In particular, never turn saved credentials into live
        # telemetry merely because Partner Center is unavailable.
        if exc.status_code >= 500:
            return {
                "ok": False,
                "mode": mode,
                "reason": exc.detail,
                "next_steps": [
                    "Check the Partner Center provider and try the connection test again.",
                ],
            }
        await db.settings.update_one(
            {"key": "m365_connection"},
            {"$set": {"value.last_test_status": "failed", "value.last_tested_at": now}},
        )
        return {
            "ok": False,
            "mode": mode,
            "reason": exc.detail,
            "next_steps": [
                "Confirm the app is registered in the MSP partner tenant.",
                "Confirm Partner Center API permissions and admin consent are present.",
                "Use the Secure Application Model or GDAP for delegated customer operations.",
            ],
        }
    await db.settings.update_one(
        {"key": "m365_connection"},
        {"$set": {"value.last_test_status": "success", "value.last_tested_at": now}},
    )
    await log_activity(
        current_user,
        "m365_partner_connection_tested",
        "settings",
        "m365_connection",
        "Microsoft Partner Center",
        f"{len(customers)} customers visible on first page",
    )
    return {
        "ok": True,
        "mode": "partner_center_verified",
        "message": f"Partner Center authenticated successfully. {len(customers)} customer tenants were visible on the first page.",
        "customer_count": len(customers),
        "next_steps": [
            "Discover the complete customer list.",
            "Map each tenant to its Nexus client.",
            "Verify GDAP or customer-admin consent before enabling tenant actions.",
        ],
    }


# Multi-tenant onboarding ----------------------------------------------------

@router.get("/m365/onboarding")
async def get_onboarding(current_user: dict = Depends(get_current_user)):
    settings_payload = await _connection_payload()
    clients = await db.clients.find(
        {},
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "website": 1,
            "domain": 1,
            "cipp_tenant_id": 1,
            "cipp_tenant_display": 1,
            "cipp_tenant_domain": 1,
            "cipp_linked_at": 1,
        },
    ).sort("name", 1).to_list(2000)
    client_by_id = {str(client.get("id")): client for client in clients if client.get("id")}

    verified = await db.m365_tenants.find(
        _verified_query(),
        {"_id": 0, "id": 1, "tenant_id": 1, "name": 1, "domain": 1, "client_id": 1},
    ).to_list(2000)
    verified_ids = {
        str(item.get("tenant_id") or item.get("id"))
        for item in verified
        if item.get("tenant_id") or item.get("id")
    }
    rows = await db.m365_tenant_connections.find({}, {"_id": 0}).sort("tenant_name", 1).to_list(2000)
    row_by_tenant = {str(row.get("tenant_id")): row for row in rows if row.get("tenant_id")}

    # Preserve verified provider tenants and historic client mappings in the
    # onboarding view without falsely rewriting their source or access state.
    for item in verified:
        tenant_id = str(item.get("tenant_id") or item.get("id") or "")
        if tenant_id and tenant_id not in row_by_tenant:
            row_by_tenant[tenant_id] = {
                "id": f"m365-tenant-{tenant_id}",
                "tenant_id": tenant_id,
                "tenant_name": item.get("name") or tenant_id,
                "default_domain": item.get("domain") or "",
                "source": "verified_provider",
                "client_id": item.get("client_id"),
                "graph_verified": True,
                "discovered_at": item.get("verified_at") or item.get("updated_at"),
            }
    for client in clients:
        tenant_id = str(client.get("cipp_tenant_id") or "")
        if tenant_id and tenant_id not in row_by_tenant:
            row_by_tenant[tenant_id] = {
                "id": f"m365-tenant-{tenant_id}",
                "tenant_id": tenant_id,
                "tenant_name": client.get("cipp_tenant_display") or tenant_id,
                "default_domain": client.get("cipp_tenant_domain") or "",
                "source": "existing_client_link",
                "client_id": client.get("id"),
                "graph_verified": tenant_id in verified_ids,
                "discovered_at": client.get("cipp_linked_at"),
            }

    output = []
    for row in row_by_tenant.values():
        linked_client = client_by_id.get(str(row.get("client_id"))) if row.get("client_id") else None
        graph_verified, access_status = _tenant_access_state(row, verified_ids)
        output.append({
            **row,
            "graph_verified": graph_verified,
            "access_status": access_status,
            "client_name": (linked_client or {}).get("name"),
            "mapped": bool(linked_client),
        })
    output.sort(key=lambda item: (str(item.get("tenant_name") or "").lower(), str(item.get("tenant_id") or "")))
    return {
        "connection": settings_payload,
        "summary": {
            "discovered": len(output),
            "mapped": sum(1 for row in output if row.get("mapped")),
            "graph_connected": sum(1 for row in output if row.get("graph_verified")),
            "needs_mapping": sum(1 for row in output if not row.get("mapped")),
            "needs_access": sum(1 for row in output if not row.get("graph_verified")),
        },
        "tenants": output,
        "clients": clients,
    }


@router.post("/m365/onboarding/discover")
async def discover_partner_customers(
    current_user: dict = Depends(get_current_user),
    _: dict = Depends(require_action("m365.tenant.manage")),
):
    settings = await _get_settings()
    raw_customers = await _partner_center_customers(settings)
    customers = [item for item in (_normalise_partner_customer(raw) for raw in raw_customers) if item]
    clients = await db.clients.find(
        {},
        {"_id": 0, "id": 1, "name": 1, "website": 1, "domain": 1, "cipp_tenant_id": 1, "cipp_tenant_domain": 1},
    ).to_list(2000)

    def normalise_domain(value: Any) -> str:
        text = str(value or "").strip().lower()
        return re.sub(r"^https?://", "", text).split("/")[0].lstrip("www.")

    client_by_tenant = {str(client.get("cipp_tenant_id")): client for client in clients if client.get("cipp_tenant_id")}
    client_by_domain: dict[str, dict] = {}
    for client in clients:
        for candidate in (client.get("cipp_tenant_domain"), client.get("domain"), client.get("website")):
            domain = normalise_domain(candidate)
            if domain:
                client_by_domain.setdefault(domain, client)

    now = _now_iso()
    created = 0
    updated = 0
    auto_mapped = 0
    for customer in customers:
        existing = await db.m365_tenant_connections.find_one({"tenant_id": customer["tenant_id"]}, {"_id": 0})
        matched_client = client_by_tenant.get(customer["tenant_id"]) or client_by_domain.get(normalise_domain(customer["default_domain"]))
        client_id = existing.get("client_id") if existing else None
        if not client_id and matched_client:
            client_id = matched_client.get("id")
            auto_mapped += 1
        record = {
            **customer,
            "id": (existing or {}).get("id") or f"m365-tenant-{uuid.uuid4().hex[:12]}",
            "source": "partner_center",
            "client_id": client_id,
            "consent_method": (existing or {}).get("consent_method") or "gdap",
            "graph_verified": bool((existing or {}).get("graph_verified")),
            "discovery_status": "discovered",
            "discovered_at": (existing or {}).get("discovered_at") or now,
            "updated_at": now,
            "updated_by": current_user.get("name"),
        }
        await db.m365_tenant_connections.update_one(
            {"tenant_id": customer["tenant_id"]},
            {"$set": record},
            upsert=True,
        )
        if existing:
            updated += 1
        else:
            created += 1
        if matched_client and client_id == matched_client.get("id") and not matched_client.get("cipp_tenant_id"):
            await db.clients.update_one(
                {"id": client_id},
                {"$set": {
                    "cipp_tenant_id": customer["tenant_id"],
                    "cipp_tenant_display": customer["tenant_name"],
                    "cipp_tenant_domain": customer["default_domain"],
                    "cipp_linked_at": now,
                }},
            )

    settings["last_discovery_at"] = now
    settings["last_discovery_count"] = len(customers)
    settings["last_test_status"] = "success"
    await db.settings.update_one(
        {"key": "m365_connection"},
        {"$set": {"key": "m365_connection", "value": settings}},
        upsert=True,
    )
    await log_activity(
        current_user,
        "m365_partner_customers_discovered",
        "integration",
        "partner_center",
        "Microsoft Partner Center",
        f"{len(customers)} tenants discovered; {auto_mapped} mapped to clients",
    )
    return {
        "success": True,
        "discovered": len(customers),
        "created": created,
        "updated": updated,
        "auto_mapped": auto_mapped,
        "message": f"{len(customers)} Partner Center customer tenants discovered.",
    }


@router.post("/m365/onboarding/tenants")
async def add_individual_tenant(
    data: dict,
    current_user: dict = Depends(get_current_user),
    _: dict = Depends(require_action("m365.tenant.manage")),
):
    tenant_id = str((data or {}).get("tenant_id") or "").strip()
    tenant_name = str((data or {}).get("tenant_name") or "").strip()
    if len(tenant_id) < 3 or not tenant_name:
        raise HTTPException(status_code=400, detail="Tenant ID and tenant name are required.")
    consent_method = str((data or {}).get("consent_method") or "gdap").strip()
    if consent_method not in {"gdap", "customer_admin"}:
        raise HTTPException(status_code=400, detail="Consent method must be GDAP or customer_admin.")
    client_id = str((data or {}).get("client_id") or "").strip() or None
    client = await _mapping_target_client(tenant_id, client_id)
    now = _now_iso()
    existing = await db.m365_tenant_connections.find_one({"tenant_id": tenant_id}, {"_id": 0})
    if existing and existing.get("client_id") and client_id and existing.get("client_id") != client_id:
        raise HTTPException(
            status_code=409,
            detail="This Microsoft tenant is already mapped to another Nexus client. Move it from the onboarding registry instead of adding it again.",
        )
    record = {
        "id": (existing or {}).get("id") or f"m365-tenant-{uuid.uuid4().hex[:12]}",
        "tenant_id": tenant_id,
        "tenant_name": tenant_name,
        "default_domain": str((data or {}).get("default_domain") or "").strip().lower(),
        "source": "manual",
        "client_id": client_id,
        "consent_method": consent_method,
        "graph_verified": bool((existing or {}).get("graph_verified")),
        "discovery_status": "pending_verification",
        "discovered_at": (existing or {}).get("discovered_at") or now,
        "updated_at": now,
        "updated_by": current_user.get("name"),
    }
    await db.m365_tenant_connections.update_one({"tenant_id": tenant_id}, {"$set": record}, upsert=True)
    if client:
        await db.clients.update_one(
            {"id": client_id},
            {"$set": {
                "cipp_tenant_id": tenant_id,
                "cipp_tenant_display": tenant_name,
                "cipp_tenant_domain": record["default_domain"],
                "cipp_linked_at": now,
            }},
        )
    await log_activity(current_user, "m365_tenant_added", "m365_tenant", record["id"], tenant_name, consent_method)
    return {"success": True, "tenant": record, "message": "Tenant added. Microsoft access still requires verification."}


@router.put("/m365/onboarding/tenants/{connection_id}/mapping")
async def map_tenant_to_client(
    connection_id: str,
    data: dict,
    current_user: dict = Depends(get_current_user),
    _: dict = Depends(require_action("m365.tenant.manage")),
):
    row = await db.m365_tenant_connections.find_one({"id": connection_id}, {"_id": 0})
    if not row:
        tenant_id = connection_id.removeprefix("m365-tenant-")
        verified = await db.m365_tenants.find_one(
            _verified_query({"$or": [{"tenant_id": tenant_id}, {"id": tenant_id}]}),
            {"_id": 0},
        )
        linked_client = await db.clients.find_one({"cipp_tenant_id": tenant_id}, {"_id": 0})
        source = verified or linked_client
        if not source:
            raise HTTPException(status_code=404, detail="Tenant onboarding record not found.")
        row = {
            "id": connection_id,
            "tenant_id": tenant_id,
            "tenant_name": (verified or {}).get("name") or (linked_client or {}).get("cipp_tenant_display") or tenant_id,
            "default_domain": (verified or {}).get("domain") or (linked_client or {}).get("cipp_tenant_domain") or "",
            "source": "verified_provider" if verified else "existing_client_link",
            "client_id": (verified or {}).get("client_id") or (linked_client or {}).get("id"),
            "consent_method": "gdap",
            "graph_verified": bool(verified),
            "discovered_at": (verified or {}).get("verified_at") or (linked_client or {}).get("cipp_linked_at"),
        }
        await db.m365_tenant_connections.insert_one({**row, "updated_at": _now_iso(), "updated_by": current_user.get("name")})
    client_id = str((data or {}).get("client_id") or "").strip() or None
    now = _now_iso()
    previous_client_id = row.get("client_id")
    client = await _mapping_target_client(str(row.get("tenant_id") or ""), client_id)
    if previous_client_id and previous_client_id != client_id:
        await db.clients.update_one(
            {"id": previous_client_id, "cipp_tenant_id": row.get("tenant_id")},
            {"$unset": {
                "cipp_tenant_id": "",
                "cipp_tenant_display": "",
                "cipp_tenant_domain": "",
                "cipp_linked_at": "",
            }},
        )
    if client_id:
        await db.clients.update_one(
            {"id": client_id},
            {"$set": {
                "cipp_tenant_id": row.get("tenant_id"),
                "cipp_tenant_display": row.get("tenant_name"),
                "cipp_tenant_domain": row.get("default_domain"),
                "cipp_linked_at": now,
            }},
        )
    await db.m365_tenant_connections.update_one(
        {"id": connection_id},
        {"$set": {"client_id": client_id, "updated_at": now, "updated_by": current_user.get("name")}},
    )
    await log_activity(
        current_user,
        "m365_tenant_mapping_changed",
        "m365_tenant",
        connection_id,
        row.get("tenant_name") or row.get("tenant_id"),
        (client or {}).get("name") or "Unmapped",
    )
    return {"success": True, "client_id": client_id, "client_name": (client or {}).get("name")}


# Verified tenant evidence ----------------------------------------------------

@router.get("/m365/tenants")
async def list_tenants(current_user: dict = Depends(get_current_user)):
    await _retire_legacy_mock_data()
    return await db.m365_tenants.find(_verified_query(), {"_id": 0}).sort("name", 1).to_list(500)


@router.get("/m365/groups")
async def list_groups(
    tenant_id: str = Query(..., min_length=1),
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Return only provider-recorded Entra group inventory for a tenant.

    This is deliberately a read model: it gives a technician an auditable
    choice of an existing group, but never treats a typed group name as proof
    that the group exists or that its membership can be changed.
    """
    query = _verified_query({"tenant_id": tenant_id})
    if q and q.strip():
        term = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [
            {"display_name": term},
            {"displayName": term},
            {"mail": term},
            {"id": term},
        ]
    groups = await db.m365_groups.find(
        query,
        {"_id": 0, "id": 1, "display_name": 1, "displayName": 1, "mail": 1, "group_types": 1, "security_enabled": 1},
    ).sort("display_name", 1).to_list(limit)
    return groups


@router.get("/m365/tenants/health/summary")
async def tenants_health_summary(current_user: dict = Depends(get_current_user)):
    await _retire_legacy_mock_data()
    tenants = await db.m365_tenants.find(_verified_query(), {"_id": 0}).to_list(500)
    if not tenants:
        return {
            "telemetry_available": False,
            "tenants": 0,
            "users": None,
            "avg_mfa_pct": None,
            "avg_secure_score": None,
            "secure_trend": None,
            "risky_signins_30d": None,
            "gdap_expiring_30d": None,
        }
    user_count = sum(int(tenant.get("users_count") or 0) for tenant in tenants)
    numeric = lambda key: [float(tenant[key]) for tenant in tenants if isinstance(tenant.get(key), (int, float))]
    mfa = numeric("mfa_enrolled_pct")
    score = numeric("secure_score")
    trend = numeric("secure_score_30d_trend")
    risky = await db.m365_users.count_documents(_verified_query({"risky_signin_30d": True}))
    expiring = await db.m365_gdap.count_documents(_verified_query({"expires_in_days": {"$lte": 30}}))
    return {
        "telemetry_available": True,
        "tenants": len(tenants),
        "users": user_count,
        "avg_mfa_pct": round(sum(mfa) / len(mfa), 1) if mfa else None,
        "avg_secure_score": round(sum(score) / len(score), 1) if score else None,
        "secure_trend": round(sum(trend) / len(trend), 1) if trend else None,
        "risky_signins_30d": risky,
        "gdap_expiring_30d": expiring,
    }


@router.get("/m365/tenants/{tid}")
async def get_tenant(tid: str, current_user: dict = Depends(get_current_user)):
    tenant = await db.m365_tenants.find_one(_verified_query({"id": tid}), {"_id": 0})
    if not tenant:
        raise HTTPException(404, "Verified Microsoft 365 tenant not found")
    domain = tenant.get("default_domain") or ""
    tenant["computed"] = {
        "user_count": await db.m365_users.count_documents(_verified_query({"tenant_id": tid})),
        "users_no_mfa": await db.m365_users.count_documents(_verified_query({"tenant_id": tid, "mfa_enforced": False, "account_enabled": True})),
        "admins": await db.m365_users.count_documents(_verified_query({"tenant_id": tid, "is_admin": True})),
    }
    tenant["deep_links"] = {
        "entra": f"https://entra.microsoft.com/{domain}/",
        "exchange": "https://admin.exchange.microsoft.com/",
        "intune": "https://intune.microsoft.com/",
        "defender": "https://security.microsoft.com/",
    }
    return tenant


@router.get("/m365/users")
async def list_users(tenant_id: str | None = None, q: str | None = None, no_mfa: bool = False, current_user: dict = Depends(get_current_user)):
    query = _verified_query()
    if tenant_id:
        query["tenant_id"] = tenant_id
    if no_mfa:
        query.update({"mfa_enforced": False, "account_enabled": True})
    if q:
        search = re.escape(q)
        query["$or"] = [
            {"display_name": {"$regex": search, "$options": "i"}},
            {"upn": {"$regex": search, "$options": "i"}},
            {"department": {"$regex": search, "$options": "i"}},
        ]
    return await db.m365_users.find(query, {"_id": 0}).limit(2000).to_list(2000)


@router.get("/m365/exchange/posture")
async def exchange_posture(tenant_id: str | None = None, current_user: dict = Depends(get_current_user)):
    """Return provider-recorded Exchange posture without inspecting or changing mailboxes.

    A Graph synchroniser writes normalised mailbox, mailbox-rule, and transport-rule
    evidence using one of ``VERIFIED_SOURCES``.  This endpoint deliberately returns
    an empty, connection-gated state until that evidence exists; it does not infer
    forwarding or mail-flow safety from a saved Graph credential.
    """
    scope = {"tenant_id": tenant_id} if tenant_id else {}
    query = _verified_query(scope)
    mailboxes, mailbox_rules, transport_rules, tenants = await asyncio.gather(
        db.m365_mailboxes.find(query, {"_id": 0}).sort("display_name", 1).limit(5000).to_list(5000),
        db.m365_mailbox_rules.find(query, {"_id": 0}).sort("observed_at", -1).limit(5000).to_list(5000),
        db.m365_transport_rules.find(query, {"_id": 0}).sort("observed_at", -1).limit(2000).to_list(2000),
        db.m365_tenants.find(_verified_query(scope), {"_id": 0, "id": 1, "name": 1, "default_domain": 1}).sort("name", 1).to_list(500),
    )

    def external_forward(row: dict) -> bool:
        return bool(
            row.get("is_external")
            or row.get("external_recipient")
            or row.get("external_forwarding")
            or row.get("destination_type") == "external"
            or row.get("forward_to_external")
        )

    mailbox_forwards = [row for row in mailboxes if external_forward(row)]
    rule_forwards = [row for row in mailbox_rules if external_forward(row)]
    audit_unknown = [row for row in mailboxes if row.get("audit_enabled") is not True]
    disabled_mailboxes = [row for row in mailboxes if row.get("account_enabled") is False]
    attention = [
        {
            "id": row.get("id"),
            "kind": "mailbox_forward",
            "tenant_id": row.get("tenant_id"),
            "subject": row.get("display_name") or row.get("user_principal_name") or "Mailbox",
            "detail": row.get("forwarding_smtp_address") or row.get("forward_to") or "External forwarding recorded",
            "severity": "high",
            "observed_at": row.get("observed_at") or row.get("last_synced"),
        }
        for row in mailbox_forwards
    ] + [
        {
            "id": row.get("id"),
            "kind": "mailbox_rule",
            "tenant_id": row.get("tenant_id"),
            "subject": row.get("mailbox") or row.get("display_name") or "Mailbox rule",
            "detail": row.get("forward_to") or row.get("external_recipient") or row.get("name") or "External forwarding rule recorded",
            "severity": row.get("severity") or "high",
            "observed_at": row.get("observed_at"),
        }
        for row in rule_forwards
    ]
    attention.sort(key=lambda row: str(row.get("observed_at") or ""), reverse=True)

    return {
        "telemetry_available": bool(mailboxes or mailbox_rules or transport_rules),
        "connection_required": not bool(mailboxes or mailbox_rules or transport_rules),
        "tenant_id": tenant_id,
        "tenants": tenants,
        "summary": {
            "mailboxes": len(mailboxes),
            "external_forwards": len(mailbox_forwards) + len(rule_forwards),
            "mailbox_rules": len(mailbox_rules),
            "transport_rules": len(transport_rules),
            "audit_unknown": len(audit_unknown),
            "disabled_mailboxes": len(disabled_mailboxes),
        },
        "mailboxes": mailboxes[:250],
        "attention": attention[:100],
        "boundary": "Read-only provider evidence. Nexus does not create, remove, forward, quarantine, or alter a mailbox or transport rule from this view.",
        "required_evidence": [
            "Microsoft Graph mailbox inventory synchronisation",
            "Microsoft Graph inbox-rule / forwarding evidence synchronisation",
            "Exchange transport-rule evidence synchronisation",
        ],
    }


@router.get("/m365/intune/posture")
async def intune_posture(tenant_id: str | None = None, current_user: dict = Depends(get_current_user)):
    """Return synchronised Intune device evidence without issuing a device command.

    The collection is intentionally separate from Nexus Agent inventory. A future
    synchroniser can correlate records by tenant/device identity, while this route
    keeps the Microsoft source, evidence time and compliance state explicit.
    """
    scope = {"tenant_id": tenant_id} if tenant_id else {}
    devices, tenants = await asyncio.gather(
        db.m365_intune_devices.find(_verified_query(scope), {"_id": 0}).sort("device_name", 1).limit(10000).to_list(10000),
        db.m365_tenants.find(_verified_query(scope), {"_id": 0, "id": 1, "name": 1, "default_domain": 1}).sort("name", 1).to_list(500),
    )
    noncompliant_states = {"noncompliant", "error", "conflict", "unknown"}
    compliant = [row for row in devices if str(row.get("compliance_state") or "").lower() == "compliant"]
    attention = [row for row in devices if str(row.get("compliance_state") or "unknown").lower() in noncompliant_states]
    encryption_missing = [row for row in devices if str(row.get("encryption_state") or "unknown").lower() not in {"encrypted", "compliant", "protected"}]
    stale = [row for row in devices if bool(row.get("stale")) or int(row.get("last_sync_age_hours") or 0) >= 24]
    return {
        "telemetry_available": bool(devices),
        "connection_required": not bool(devices),
        "tenant_id": tenant_id,
        "tenants": tenants,
        "summary": {
            "devices": len(devices),
            "compliant": len(compliant),
            "needs_attention": len(attention),
            "encryption_review": len(encryption_missing),
            "stale": len(stale),
        },
        "devices": devices[:500],
        "attention": [
            {
                "id": row.get("id"),
                "tenant_id": row.get("tenant_id"),
                "device_name": row.get("device_name") or row.get("name") or "Intune device",
                "primary_user": row.get("primary_user") or row.get("user_principal_name"),
                "compliance_state": row.get("compliance_state") or "unknown",
                "encryption_state": row.get("encryption_state") or "unknown",
                "last_sync": row.get("last_sync") or row.get("observed_at"),
            }
            for row in attention[:250]
        ],
        "boundary": "Read-only Intune evidence. Nexus does not wipe, retire, sync, reboot, deploy applications, or change compliance policy from this view.",
        "required_evidence": [
            "Microsoft Graph managed-device inventory synchronisation",
            "Intune compliance-state synchronisation",
            "BitLocker or device-encryption posture synchronisation",
        ],
    }


@router.get("/m365/collaboration/posture")
async def collaboration_posture(tenant_id: str | None = None, current_user: dict = Depends(get_current_user)):
    """Return verified Teams, SharePoint and OneDrive governance evidence.

    This is an evidence surface only. It does not enumerate a tenant from a
    configured secret, create a Team, change a sharing policy, or revoke access.
    Those actions must remain separately approved when the Graph executor exists.
    """
    scope = {"tenant_id": tenant_id} if tenant_id else {}
    sites, teams, guests, tenants = await asyncio.gather(
        db.m365_sharepoint_sites.find(_verified_query(scope), {"_id": 0}).sort("display_name", 1).limit(5000).to_list(5000),
        db.m365_teams.find(_verified_query(scope), {"_id": 0}).sort("display_name", 1).limit(5000).to_list(5000),
        db.m365_guest_users.find(_verified_query(scope), {"_id": 0}).sort("created_at", -1).limit(10000).to_list(10000),
        db.m365_tenants.find(_verified_query(scope), {"_id": 0, "id": 1, "name": 1, "default_domain": 1}).sort("name", 1).to_list(500),
    )

    def externally_shared(row: dict) -> bool:
        sharing = str(row.get("sharing_capability") or row.get("sharing_state") or "").lower()
        return bool(row.get("external_sharing_enabled") or row.get("anonymous_links_enabled") or sharing in {"external", "anonymous", "anyone"})

    external_sites = [row for row in sites if externally_shared(row)]
    external_teams = [row for row in teams if externally_shared(row) or row.get("guest_access_enabled")]
    dormant_guests = [row for row in guests if bool(row.get("stale")) or int(row.get("days_since_signin") or 0) >= 90]
    attention = [
        {
            "id": row.get("id"), "kind": "sharepoint_site", "tenant_id": row.get("tenant_id"),
            "subject": row.get("display_name") or row.get("name") or "SharePoint site",
            "detail": row.get("sharing_capability") or row.get("sharing_state") or "External sharing enabled",
            "severity": "medium" if not row.get("anonymous_links_enabled") else "high",
            "observed_at": row.get("observed_at") or row.get("last_synced"),
        }
        for row in external_sites
    ] + [
        {
            "id": row.get("id"), "kind": "team", "tenant_id": row.get("tenant_id"),
            "subject": row.get("display_name") or row.get("name") or "Team",
            "detail": "Guest access or external sharing enabled",
            "severity": "medium", "observed_at": row.get("observed_at") or row.get("last_synced"),
        }
        for row in external_teams
    ] + [
        {
            "id": row.get("id"), "kind": "guest", "tenant_id": row.get("tenant_id"),
            "subject": row.get("display_name") or row.get("user_principal_name") or "Guest user",
            "detail": f"No sign-in for {row.get('days_since_signin')} days" if row.get("days_since_signin") is not None else "Guest evidence marked stale",
            "severity": "medium", "observed_at": row.get("last_signin_at") or row.get("observed_at"),
        }
        for row in dormant_guests
    ]
    attention.sort(key=lambda row: str(row.get("observed_at") or ""), reverse=True)
    telemetry_available = bool(sites or teams or guests)
    return {
        "telemetry_available": telemetry_available,
        "connection_required": not telemetry_available,
        "tenant_id": tenant_id,
        "tenants": tenants,
        "summary": {
            "sharepoint_sites": len(sites), "teams": len(teams), "guest_users": len(guests),
            "external_sites": len(external_sites), "external_teams": len(external_teams), "dormant_guests": len(dormant_guests),
        },
        "attention": attention[:250],
        "boundary": "Read-only collaboration evidence. Nexus does not create sites or Teams, change sharing, remove guests, or modify OneDrive content from this view.",
        "required_evidence": [
            "Microsoft Graph SharePoint site inventory and sharing posture synchronisation",
            "Microsoft Graph Teams and guest-access synchronisation",
            "Microsoft Entra guest sign-in evidence synchronisation",
        ],
    }


@router.get("/m365/security/posture")
async def security_posture(tenant_id: str | None = None, current_user: dict = Depends(get_current_user)):
    """Expose read-only Defender, Entra risk and Conditional Access evidence.

    Nexus Shield correlates these sources into incidents.  This Microsoft view
    remains the tenant-control surface and never resolves alerts, isolates a
    device, changes CA policy, or performs identity containment itself.
    """
    scope = {"tenant_id": tenant_id} if tenant_id else {}
    alerts, identity_risks, ca_policies, defender_devices = await asyncio.gather(
        db.m365_security_alerts.find(_verified_query(scope), {"_id": 0}).sort("observed_at", -1).limit(10000).to_list(10000),
        db.m365_identity_risks.find(_verified_query(scope), {"_id": 0}).sort("observed_at", -1).limit(10000).to_list(10000),
        db.m365_conditional_access_policies.find(_verified_query(scope), {"_id": 0}).sort("display_name", 1).limit(5000).to_list(5000),
        db.m365_defender_devices.find(_verified_query(scope), {"_id": 0}).sort("observed_at", -1).limit(10000).to_list(10000),
    )
    closed = {"resolved", "closed", "dismissed", "remediated"}
    high = {"high", "critical"}
    open_alerts = [row for row in alerts if str(row.get("status") or "new").lower() not in closed]
    high_alerts = [row for row in open_alerts if str(row.get("severity") or "").lower() in high]
    active_risks = [row for row in identity_risks if str(row.get("status") or "active").lower() not in closed]
    report_only = [row for row in ca_policies if str(row.get("state") or "").lower() in {"reportonly", "report_only"}]
    vulnerable_devices = [row for row in defender_devices if str(row.get("risk_level") or "").lower() in high]
    attention = [
        {
            "id": row.get("id"), "kind": "defender_alert", "tenant_id": row.get("tenant_id"),
            "subject": row.get("title") or row.get("device_name") or "Defender alert",
            "detail": row.get("description") or row.get("category") or "Open security alert",
            "severity": row.get("severity") or "medium", "observed_at": row.get("observed_at") or row.get("created_at"),
        }
        for row in open_alerts
    ] + [
        {
            "id": row.get("id"), "kind": "identity_risk", "tenant_id": row.get("tenant_id"),
            "subject": row.get("user_principal_name") or row.get("display_name") or "Risky identity",
            "detail": row.get("risk_detail") or row.get("risk_level") or "Active identity risk",
            "severity": row.get("risk_level") or "medium", "observed_at": row.get("observed_at") or row.get("detected_at"),
        }
        for row in active_risks
    ]
    attention.sort(key=lambda row: str(row.get("observed_at") or ""), reverse=True)
    telemetry_available = bool(alerts or identity_risks or ca_policies or defender_devices)
    return {
        "telemetry_available": telemetry_available,
        "connection_required": not telemetry_available,
        "tenant_id": tenant_id,
        "summary": {
            "open_alerts": len(open_alerts), "high_alerts": len(high_alerts), "identity_risks": len(active_risks),
            "conditional_access_policies": len(ca_policies), "report_only_policies": len(report_only), "defender_devices_at_risk": len(vulnerable_devices),
        },
        "attention": attention[:250],
        "boundary": "Read-only Microsoft security evidence. Use Nexus Shield to investigate and only execute approved containment through a governed Microsoft action workflow.",
        "required_evidence": [
            "Microsoft Defender alert synchronisation", "Microsoft Entra identity-risk synchronisation",
            "Conditional Access policy inventory synchronisation", "Microsoft Defender device-risk synchronisation",
        ],
    }


@router.get("/m365/licensing/posture")
async def licensing_posture(tenant_id: str | None = None, current_user: dict = Depends(get_current_user)):
    """Return Microsoft licence evidence for operational and billing review.

    The endpoint intentionally reports only provider-recorded assignments and
    purchased SKU evidence. It does not infer cost, mutate an invoice, or claim a
    service is reconciled until a contract/service mapping is explicitly present.
    """
    scope = {"tenant_id": tenant_id} if tenant_id else {}
    licenses, users = await asyncio.gather(
        db.m365_licenses.find(_verified_query(scope), {"_id": 0}).sort("sku_name", 1).limit(10000).to_list(10000),
        db.m365_users.find(_verified_query(scope), {"_id": 0}).limit(20000).to_list(20000),
    )

    def assignments(row: dict) -> list:
        value = row.get("assigned_licenses") or row.get("assignedLicenses") or row.get("licenses") or []
        return value if isinstance(value, list) else []

    active_users = [row for row in users if row.get("account_enabled") is not False]
    unlicensed_active = [row for row in active_users if not assignments(row)]
    disabled_licensed = [row for row in users if row.get("account_enabled") is False and assignments(row)]
    low_stock = [
        row for row in licenses
        if isinstance(row.get("total_units") or row.get("enabled_units"), (int, float))
        and isinstance(row.get("consumed_units"), (int, float))
        and (float(row.get("total_units") or row.get("enabled_units")) - float(row.get("consumed_units"))) <= 2
    ]
    telemetry_available = bool(licenses) or any(
        any(key in row for key in ("assigned_licenses", "assignedLicenses", "licenses"))
        for row in users
    )
    return {
        "telemetry_available": telemetry_available,
        "connection_required": not telemetry_available,
        "tenant_id": tenant_id,
        "summary": {
            "skus": len(licenses), "active_users": len(active_users), "unlicensed_active": len(unlicensed_active),
            "disabled_licensed": len(disabled_licensed), "low_stock_skus": len(low_stock),
        },
        "licenses": licenses[:500],
        "attention": [
            {"id": row.get("id"), "kind": "unlicensed_active_user", "tenant_id": row.get("tenant_id"), "subject": row.get("display_name") or row.get("upn") or "Active user", "detail": "No provider-recorded licence assignment", "severity": "medium"}
            for row in unlicensed_active
        ] + [
            {"id": row.get("id"), "kind": "disabled_licensed_user", "tenant_id": row.get("tenant_id"), "subject": row.get("display_name") or row.get("upn") or "Disabled user", "detail": f"{len(assignments(row))} licence assignment(s) retained", "severity": "medium"}
            for row in disabled_licensed
        ] + [
            {"id": row.get("id"), "kind": "low_stock_sku", "tenant_id": row.get("tenant_id"), "subject": row.get("sku_name") or row.get("display_name") or "Microsoft SKU", "detail": "Two or fewer provider-recorded seats remain", "severity": "low"}
            for row in low_stock
        ],
        "boundary": "Provider-recorded licence evidence only. Use the Nexus Action Centre for previewed assignment changes and the service/billing workspace for an approved reconciliation.",
    }


@router.get("/m365/search")
async def universal_search(q: str = Query(..., min_length=2), current_user: dict = Depends(get_current_user)):
    search = re.escape(q)
    users = await db.m365_users.find(
        _verified_query({"$or": [{"display_name": {"$regex": search, "$options": "i"}}, {"upn": {"$regex": search, "$options": "i"}}]}),
        {"_id": 0, "id": 1, "display_name": 1, "upn": 1, "tenant_name": 1, "tenant_id": 1},
    ).limit(40).to_list(40)
    tenants = await db.m365_tenants.find(
        _verified_query({"$or": [{"name": {"$regex": search, "$options": "i"}}, {"default_domain": {"$regex": search, "$options": "i"}}]}),
        {"_id": 0, "id": 1, "name": 1, "default_domain": 1},
    ).limit(20).to_list(20)
    gdap = await db.m365_gdap.find(
        _verified_query({"roles": {"$regex": search, "$options": "i"}}),
        {"_id": 0, "id": 1, "tenant_name": 1, "tenant_id": 1, "roles": 1, "expires_in_days": 1},
    ).limit(20).to_list(20)
    return {"users": users, "tenants": tenants, "gdap": gdap, "count": len(users) + len(tenants) + len(gdap)}


# Reference standards ---------------------------------------------------------

async def _standard_config(standard_id: str) -> dict:
    return await db.m365_standard_configs.find_one({"standard_id": standard_id}, {"_id": 0}) or {}


@router.get("/m365/standards")
async def list_standards(category: str | None = None, current_user: dict = Depends(get_current_user)):
    items = []
    for standard in STANDARD_LIBRARY:
        if category and standard["category"] != category:
            continue
        standard_id = f"std-{standard['key']}"
        config = await _standard_config(standard_id)
        items.append({
            **standard,
            "id": standard_id,
            "enabled": bool(config.get("enabled", False)),
            "assigned_tenants": config.get("assigned_tenants", []),
            "schedule_hours": config.get("schedule_hours"),
            "actions": config.get("actions", ["manual_review"]),
            "execution_available": False,
            "evidence_state": "reference_only",
            "updated_at": config.get("updated_at"),
        })
    return items


@router.put("/m365/standards/{sid}")
async def update_standard(sid: str, data: dict, current_user: dict = Depends(get_current_user)):
    if sid not in {f"std-{standard['key']}" for standard in STANDARD_LIBRARY}:
        raise HTTPException(404, "Standard not found")
    patch = {key: data[key] for key in ("enabled", "assigned_tenants", "schedule_hours", "actions") if key in data}
    patch.update({"standard_id": sid, "updated_at": _now_iso(), "updated_by": current_user.get("name")})
    await db.m365_standard_configs.update_one({"standard_id": sid}, {"$set": patch}, upsert=True)
    await log_activity(current_user, "m365_standard_plan_updated", "m365_standard", sid, sid, "Reference standard configuration updated; no provider action executed.")
    return next(item for item in await list_standards(current_user=current_user) if item["id"] == sid)


@router.post("/m365/standards/{sid}/run")
async def run_standard(sid: str, current_user: dict = Depends(get_current_user)):
    raise _execution_unavailable("Standards evaluation is disabled until a verified Microsoft Graph sync can collect evidence. No compliance result was generated.")


@router.get("/m365/standards/{sid}/runs")
async def list_standard_runs(sid: str, current_user: dict = Depends(get_current_user)):
    return await db.m365_standard_run_summaries.find(
        _verified_query({"standard_id": sid}), {"_id": 0}
    ).sort("started_at", -1).limit(50).to_list(50)


@router.get("/m365/bpa-report")
async def bpa_report(tenant_id: str | None = None, current_user: dict = Depends(get_current_user)):
    tenants = await db.m365_tenants.find(_verified_query({"id": tenant_id} if tenant_id else None), {"_id": 0}).to_list(200)
    standards = await list_standards(current_user=current_user)
    return {
        "telemetry_available": bool(tenants),
        "matrix": [],
        "standards": [{key: standard[key] for key in ("id", "name", "category", "severity", "enabled")} for standard in standards],
        "message": "No provider-backed standards evidence is available yet.",
    }


# GDAP and operational actions ------------------------------------------------

@router.get("/m365/gdap")
async def list_gdap(expiring_only: bool = False, current_user: dict = Depends(get_current_user)):
    query = _verified_query({"expires_in_days": {"$lte": 30}} if expiring_only else None)
    return await db.m365_gdap.find(query, {"_id": 0}).sort("expires_in_days", 1).to_list(500)


@router.get("/m365/gdap/role-templates")
async def list_role_templates(current_user: dict = Depends(get_current_user)):
    return GDAP_ROLE_TEMPLATES


@router.post("/m365/gdap/{gid}/extend")
async def extend_gdap(gid: str, current_user: dict = Depends(get_current_user)):
    raise _execution_unavailable("GDAP extension must be performed in Partner Center until the verified provider can execute and confirm this action.")


@router.post("/m365/offboarding")
async def start_offboarding(data: dict, current_user: dict = Depends(get_current_user)):
    raise _execution_unavailable("Microsoft 365 offboarding is disabled because this environment cannot confirm any Graph action. Use the Microsoft admin portal and document the completed work in the ticket.")


@router.get("/m365/offboardings")
async def list_offboardings(current_user: dict = Depends(get_current_user)):
    return await db.m365_offboardings.find(_verified_query(), {"_id": 0}).sort("executed_at", -1).limit(100).to_list(100)


# Security evidence, policy references and manual drafts ---------------------

@router.get("/m365/mfa-analytics")
async def mfa_analytics(tenant_id: str | None = None, current_user: dict = Depends(get_current_user)):
    query = _verified_query({"account_enabled": True, **({"tenant_id": tenant_id} if tenant_id else {})})
    rows = await db.m365_users.aggregate([{"$match": query}, {"$group": {"_id": "$mfa_method", "n": {"$sum": 1}}}]).to_list(20)
    methods = {row["_id"] or "none": row["n"] for row in rows}
    total = sum(methods.values())
    no_mfa = await db.m365_users.find(_verified_query({"account_enabled": True, "mfa_enforced": False, **({"tenant_id": tenant_id} if tenant_id else {})}), {"_id": 0, "display_name": 1, "upn": 1, "tenant_name": 1, "is_admin": 1}).limit(50).to_list(50)
    return {
        "telemetry_available": bool(total),
        "by_method": methods,
        "total_users": total,
        "no_mfa_users": no_mfa,
        "no_mfa_admin_count": sum(1 for user in no_mfa if user.get("is_admin")),
        "mfa_pct": round(sum(count for name, count in methods.items() if name != "none") / total * 100, 1) if total else None,
    }


@router.get("/m365/secure-score/trend")
async def secure_score_trend(current_user: dict = Depends(get_current_user)):
    tenants = await db.m365_tenants.find(_verified_query(), {"_id": 0, "id": 1, "name": 1, "secure_score": 1, "secure_score_30d_trend": 1}).to_list(500)
    # A synchroniser may write real dated snapshots later. Never interpolate a
    # chart from current values because that would falsely imply historical data.
    series = await db.m365_secure_score_snapshots.find(_verified_query(), {"_id": 0, "date": 1, "avg": 1}).sort("date", 1).limit(366).to_list(366)
    return {"telemetry_available": bool(tenants), "tenants": tenants, "series": series}


@router.get("/m365/ca-templates")
async def list_ca_templates(current_user: dict = Depends(get_current_user)):
    return [{**template, "id": f"cat-{template['key']}", "deployment_available": False} for template in CA_TEMPLATE_LIBRARY]


@router.post("/m365/ca-templates/{cid}/deploy")
async def deploy_ca_template(cid: str, current_user: dict = Depends(get_current_user)):
    raise _execution_unavailable("Conditional Access deployment is disabled until the Microsoft Graph provider can deploy and read back the policy safely.")


@router.get("/m365/scripted-alerts")
async def list_scripted_alerts(current_user: dict = Depends(get_current_user)):
    return await db.m365_scripted_alerts.find({"source": "m365_manual_config"}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("/m365/scripted-alerts")
async def create_scripted_alert(data: dict, current_user: dict = Depends(get_current_user)):
    if not data.get("name") or not data.get("expression"):
        raise HTTPException(400, "name and expression required")
    alert = {
        "id": str(uuid.uuid4()),
        "key": re.sub(r"[^a-z0-9_]+", "_", data["name"].lower()).strip("_")[:50],
        "name": str(data["name"]).strip(),
        "expression": str(data["expression"]).strip(),
        "severity": data.get("severity", "medium"),
        "enabled": bool(data.get("enabled", True)),
        "source": "m365_manual_config",
        "status": "not_evaluated",
        "created_at": _now_iso(),
        "created_by": current_user.get("name"),
    }
    await db.m365_scripted_alerts.insert_one(alert)
    await log_activity(current_user, "m365_detection_draft_created", "m365_scripted_alert", alert["id"], alert["name"], "Draft only; no telemetry evaluation or ticket action was performed.")
    alert.pop("_id", None)
    return alert


@router.delete("/m365/scripted-alerts/{aid}")
async def delete_scripted_alert(aid: str, current_user: dict = Depends(get_current_user)):
    await db.m365_scripted_alerts.delete_one({"id": aid, "source": "m365_manual_config"})
    return {"success": True}


@router.get("/m365/aitm-page")
async def get_aitm_page(current_user: dict = Depends(get_current_user)):
    stored = await db.settings.find_one({"key": "m365_aitm_page"}, {"_id": 0}) or {}
    return stored.get("value") or {
        "enabled": False,
        "company_name": "Your Company",
        "warning_text": "Do not sign in. If this warning appears unexpectedly, close the page and report it to IT.",
        "primary_color": "#DC2626",
    }


@router.put("/m365/aitm-page")
async def update_aitm_page(data: dict, current_user: dict = Depends(get_current_user)):
    stored = await db.settings.find_one({"key": "m365_aitm_page"}, {"_id": 0}) or {}
    value = stored.get("value") or {}
    for key in ("enabled", "company_name", "warning_text", "primary_color", "logo_url"):
        if key in data:
            value[key] = data[key]
    value["updated_at"] = _now_iso()
    await db.settings.update_one({"key": "m365_aitm_page"}, {"$set": {"value": value, "key": "m365_aitm_page"}}, upsert=True)
    return {**value, "css": _generate_aitm_css(value), "deployment_note": "This is a manual reference snippet. NexusMSP has not deployed it to Microsoft Entra."}


def _generate_aitm_css(config: dict) -> str:
    color = str(config.get("primary_color", "#DC2626"))
    text = str(config.get("warning_text") or "").replace('"', "'")
    company = str(config.get("company_name") or "Your Company")
    return f"""/* Manual Entra branding reference for {company}. Review before using. */
body::before {{
  content: \"{text}\";
  display: block;
  background: {color};
  color: white;
  font-family: Arial, sans-serif;
  font-size: 18px;
  font-weight: bold;
  padding: 16px;
  text-align: center;
}}
"""


@router.get("/m365/tenants/{tid}/ai-brief")
async def tenant_ai_brief(tid: str, current_user: dict = Depends(get_current_user)):
    tenant = await db.m365_tenants.find_one(_verified_query({"id": tid}), {"_id": 0})
    if not tenant:
        raise HTTPException(404, "Verified Microsoft 365 tenant not found")
    try:
        from app.services.ai_provider import LlmChat, UserMessage

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("AI key not configured")
        config = await db.settings.find_one({"type": "ai_config"}, {"_id": 0}) or {}
        payload = {key: tenant.get(key) for key in ("name", "default_domain", "users_count", "secure_score", "secure_score_30d_trend", "mfa_enrolled_pct")}
        chat = LlmChat(api_key=api_key, session_id=f"m365-brief-{tid}", system_message="You are an MSP Microsoft 365 analyst. State only the supplied evidence, identify data gaps, and give concise next actions. Do not invent posture or incidents.")
        chat.with_model(config.get("provider", "openai"), config.get("model", "gpt-4.1-mini"))
        brief = await chat.send_message(UserMessage(text=json.dumps(payload)))
        return {"brief": brief.strip(), "payload": payload, "evidence_state": "provider_recorded"}
    except Exception as exc:
        logger.warning("M365 AI brief unavailable: %s", exc)
        raise HTTPException(503, "The AI brief is unavailable. Review the provider-recorded tenant fields directly.")
