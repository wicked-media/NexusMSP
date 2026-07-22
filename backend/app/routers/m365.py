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

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity


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
    configured = [settings.get(key) for key in ("app_id", "tenant_id", "app_secret")]
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
    return {
        "app_id": settings.get("app_id"),
        "tenant_id": settings.get("tenant_id"),
        "secret_configured": bool(settings.get("app_secret")),
        "refresh_token_configured": bool(settings.get("refresh_token")),
        "partner_center_account": settings.get("partner_center_account"),
        "mode": _connection_status(settings),
        "last_synced": settings.get("last_synced"),
        "verified_at": settings.get("verified_at"),
        "sync_provider": settings.get("sync_provider"),
        "telemetry_available": telemetry_available,
    }


def _execution_unavailable(detail: str = "A verified Microsoft Graph synchronisation provider is required before this action can run.") -> HTTPException:
    return HTTPException(status_code=409, detail=detail)


# Connection -----------------------------------------------------------------

@router.get("/m365/connection")
async def get_connection(current_user: dict = Depends(get_current_user)):
    await _retire_legacy_mock_data()
    return await _connection_payload()


@router.put("/m365/connection")
async def update_connection(data: dict, current_user: dict = Depends(get_current_user)):
    settings = await _get_settings()
    for key in ("app_id", "tenant_id", "app_secret", "refresh_token", "partner_center_account"):
        if key in data and data[key] is not None:
            settings[key] = str(data[key]).strip() or None
    # Credentials being saved is not verification.  A future real Graph test may
    # set these only after successfully authenticating and completing a sync.
    settings.pop("verified_at", None)
    settings.pop("sync_provider", None)
    settings["updated_by"] = current_user.get("name")
    settings["updated_at"] = _now_iso()
    await db.settings.update_one(
        {"key": "m365_connection"},
        {"$set": {"value": settings, "key": "m365_connection"}},
        upsert=True,
    )
    mode = _connection_status(settings)
    await log_activity(current_user, "m365_connection_saved", "settings", "m365_connection", "Microsoft 365 connection", mode)
    return {"success": True, "mode": mode, "message": "Connection details saved. They are not yet verified against Microsoft Graph."}


@router.post("/m365/connection/test")
async def test_connection(current_user: dict = Depends(get_current_user)):
    settings = await _get_settings()
    mode = _connection_status(settings)
    if mode != "configured_unverified":
        return {
            "ok": False,
            "mode": mode,
            "reason": "Enter the App ID, Directory (tenant) ID and client secret before verification can be attempted.",
        }
    return {
        "ok": False,
        "mode": mode,
        "reason": "Microsoft Graph token verification and tenant synchronisation are not installed in this environment yet.",
        "next_steps": [
            "Register a Microsoft Entra application with least-privilege Microsoft Graph application permissions.",
            "Grant tenant admin consent and store its App ID, Directory ID and client secret here.",
            "Install and verify the Nexus Microsoft Graph synchronisation provider before relying on this workspace for customer posture.",
        ],
    }


# Verified tenant evidence ----------------------------------------------------

@router.get("/m365/tenants")
async def list_tenants(current_user: dict = Depends(get_current_user)):
    await _retire_legacy_mock_data()
    return await db.m365_tenants.find(_verified_query(), {"_id": 0}).sort("name", 1).to_list(500)


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
