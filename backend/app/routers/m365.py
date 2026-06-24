"""M365 Command Center — CIPP-style multi-tenant Microsoft 365 management.

This single router covers:
  M1  Tenants list, health metrics, cross-tenant user list, universal search,
      deep links, M365 Connection settings.
  M2  Standards Engine — CRUD templates, scheduler, drift detection,
      auto-remediation, BPA reports + trend.
  M3  GDAP relationships table, role templates, expiry alerts,
      Offboarding Wizard.
  M4  Scripted Alerts engine, MFA Analytics, Secure Score trends,
      Anti-AITM "Do Not Login" page generator, Conditional Access library.

Mock-first: if no M365 connection is configured, realistic seed data is
auto-created on first request so the UI is demo-ready immediately. When the
user pastes Graph API credentials in /m365/settings, a future commit can swap
the seed reads for real Graph calls behind a single `_use_live()` helper.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime, timezone, timedelta
from typing import Optional
import os
import re
import uuid
import json
import random
import asyncio
import logging

from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity

logger = logging.getLogger(__name__)
router = APIRouter()


# ═════════════════════════ helpers ═════════════════════════

def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _days_ago(n):
    return (datetime.now(timezone.utc) - timedelta(days=n)).isoformat()


async def _ai_chat(session_id: str, system_msg: str):
    from emergentintegrations.llm.chat import LlmChat
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(500, "AI key not configured")
    cfg = await db.settings.find_one({"type": "ai_config"}, {"_id": 0}) or {}
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system_msg)
    chat.with_model(cfg.get("provider", "anthropic"), cfg.get("model", "claude-sonnet-4-5-20250929"))
    return chat


async def _get_settings():
    s = await db.settings.find_one({"key": "m365_connection"}, {"_id": 0}) or {}
    return s.get("value") or {}


def _connection_status(s: dict) -> str:
    needed = ["app_id", "tenant_id", "app_secret", "refresh_token"]
    return "live" if all(s.get(k) for k in needed) else "mock"


# ═════════════════════════ Mock data seeding ═════════════════════════

MOCK_TENANT_NAMES = [
    ("Acme Corporation", "acme.onmicrosoft.com", 145, 89.5, 64),
    ("Pacific Logistics", "pacific.onmicrosoft.com", 78, 95.2, 78),
    ("Steele Tech Group", "steele.onmicrosoft.com", 32, 100.0, 91),
    ("Boyd & Co Legal", "boydlegal.onmicrosoft.com", 24, 87.5, 58),
    ("Northern Build Pty", "northernbuild.onmicrosoft.com", 58, 76.0, 47),
    ("Harvest Foods", "harvestfoods.onmicrosoft.com", 211, 92.1, 71),
    ("Apex Health Group", "apexhealth.onmicrosoft.com", 96, 98.7, 84),
]

MOCK_STANDARD_LIBRARY = [
    {"key": "require_mfa_all_users", "name": "Require MFA for all users", "category": "identity", "severity": "high", "auto_remediate": True, "description": "Enables Conditional Access MFA enforcement for all users."},
    {"key": "block_legacy_auth", "name": "Block legacy authentication", "category": "identity", "severity": "high", "auto_remediate": True, "description": "Disables IMAP/POP/SMTP/Basic auth via Conditional Access."},
    {"key": "disable_security_defaults", "name": "Disable Security Defaults (use CA)", "category": "identity", "severity": "medium", "auto_remediate": False, "description": "Required when using Conditional Access policies."},
    {"key": "mailbox_auditing_on", "name": "Enable mailbox auditing", "category": "exchange", "severity": "medium", "auto_remediate": True, "description": "Audits owner/admin/delegate mailbox actions."},
    {"key": "disable_external_forwarding", "name": "Block external email forwarding", "category": "exchange", "severity": "high", "auto_remediate": True, "description": "Prevents data exfil via inbox forwarding."},
    {"key": "defender_safe_links", "name": "Enable Defender Safe Links", "category": "defender", "severity": "high", "auto_remediate": True, "description": "Rewrites links + sandboxes attachments."},
    {"key": "defender_safe_attach", "name": "Enable Safe Attachments", "category": "defender", "severity": "high", "auto_remediate": True, "description": "Detonates attachments in sandbox before delivery."},
    {"key": "intune_compliance_baseline", "name": "Apply Intune compliance baseline", "category": "intune", "severity": "high", "auto_remediate": False, "description": "Pushes baseline compliance policies."},
    {"key": "block_consumer_storage", "name": "Block consumer cloud storage", "category": "intune", "severity": "medium", "auto_remediate": True, "description": "OneDrive personal / Dropbox / Google Drive block."},
    {"key": "password_protection", "name": "Entra password protection on-prem", "category": "identity", "severity": "medium", "auto_remediate": False, "description": "Custom banned-password lists."},
    {"key": "lockout_smart", "name": "Smart account lockout", "category": "identity", "severity": "low", "auto_remediate": True, "description": "Threshold 10, duration 60s."},
    {"key": "guest_access_limited", "name": "Limit guest access", "category": "identity", "severity": "medium", "auto_remediate": True, "description": "Guests can only see their own objects."},
    {"key": "self_service_disable_outlook", "name": "Disable Outlook autoreply external", "category": "exchange", "severity": "low", "auto_remediate": False, "description": "Prevents leakage via OOO to externals."},
    {"key": "sharepoint_block_anonymous", "name": "Block SharePoint anonymous links", "category": "sharepoint", "severity": "high", "auto_remediate": True, "description": "Blocks 'Anyone with the link' default."},
    {"key": "teams_external_chat_restrict", "name": "Restrict Teams external chat", "category": "teams", "severity": "medium", "auto_remediate": True, "description": "Allows only approved external domains."},
]

MOCK_GDAP_ROLES = [
    "Helpdesk Administrator", "User Administrator", "Application Administrator",
    "Authentication Administrator", "Cloud Application Administrator",
    "Compliance Administrator", "Conditional Access Administrator",
    "Exchange Administrator", "Global Reader", "Helpdesk Administrator",
    "Intune Administrator", "License Administrator", "Reports Reader",
    "Security Administrator", "Security Operator", "Security Reader",
    "Service Support Administrator", "Teams Administrator",
]


async def _seed_if_empty():
    """Insert realistic mock M365 data on first request — idempotent.
    Tagged with source='m365cc' so it doesn't collide with the legacy CIPP integration
    that also writes to db.m365_users (without that tag)."""
    if await db.m365_tenants.count_documents({"source": "m365cc"}) > 0:
        return
    logger.info("Seeding M365 mock data…")
    rng = random.Random(42)
    now = datetime.now(timezone.utc)
    tenants = []
    for name, domain, users, mfa_pct, secure in MOCK_TENANT_NAMES:
        t = {
            "id": f"tnt-{uuid.uuid4().hex[:10]}",
            "tenant_id": str(uuid.uuid4()),
            "name": name,
            "default_domain": domain,
            "domains": [domain, name.lower().split()[0] + ".com"],
            "users_count": users,
            "licensed_users": int(users * 0.93),
            "mfa_enrolled_pct": mfa_pct,
            "secure_score": secure,
            "secure_score_max": 100,
            "secure_score_30d_trend": rng.choice([-2, -1, 0, 1, 2, 3, 4]),
            "status": rng.choice(["active", "active", "active", "warning"]),
            "license_sku": rng.choice(["Business Premium", "Business Standard", "E3", "E5"]),
            "country": rng.choice(["AU", "US", "GB", "CA"]),
            "created_at": _days_ago(rng.randint(180, 1800)),
            "last_sync": _days_ago(0),
        }
        tenants.append(t)
    for t in tenants:
        t["source"] = "m365cc"
    await db.m365_tenants.insert_many(tenants)

    # Users (5-10 per tenant)
    users = []
    user_names = ["Aaron Steele", "Maria Garcia", "Liam Walsh", "Sophie Chen", "Jamal Okafor", "Priya Patel",
                  "Olivia Brown", "Ethan Park", "Noah Thompson", "Ava Wilson", "Lucas Bauer", "Emma Davies",
                  "Hiroshi Tanaka", "Charlotte Martin", "Ali Khan", "Grace Lee", "Henry Adams", "Zoe Roberts"]
    for t in tenants:
        n_users = rng.randint(5, 10)
        for i in range(n_users):
            full = rng.choice(user_names)
            first = full.split()[0]
            users.append({
                "id": str(uuid.uuid4()),
                "tenant_id": t["id"],
                "tenant_name": t["name"],
                "display_name": full,
                "upn": f"{first.lower()}@{t['default_domain']}",
                "department": rng.choice(["IT", "Sales", "Finance", "Operations", "HR", "Engineering", "Marketing"]),
                "job_title": rng.choice(["Manager", "Engineer", "Analyst", "Director", "Coordinator", "Specialist"]),
                "mfa_method": rng.choices(["microsoft_authenticator", "sms", "none", "fido2", "phone"], weights=[60, 10, 12, 8, 10])[0],
                "mfa_enforced": rng.random() < (t["mfa_enrolled_pct"] / 100),
                "license_sku": rng.choice(["Business Premium", "Business Standard", "E3", "F3", None]),
                "account_enabled": rng.random() < 0.96,
                "is_admin": (i == 0),
                "last_signin": _days_ago(rng.randint(0, 30)),
                "risky_signin_30d": rng.random() < 0.04,
                "manager_upn": None,
                "created_at": _days_ago(rng.randint(60, 800)),
            })
    for u in users:
        u["source"] = "m365cc"
    await db.m365_users.insert_many(users)

    # GDAP relationships
    gdap = []
    for t in tenants:
        roles = rng.sample(MOCK_GDAP_ROLES, k=rng.randint(3, 8))
        expires_in_days = rng.choice([10, 30, 90, 180, 365, 540, 365])
        gdap.append({
            "id": str(uuid.uuid4()),
            "tenant_id": t["id"],
            "tenant_name": t["name"],
            "status": rng.choice(["active", "active", "active", "pending"]),
            "roles": roles,
            "role_count": len(roles),
            "expires_at": (now + timedelta(days=expires_in_days)).isoformat(),
            "expires_in_days": expires_in_days,
            "duration": "auto-extend" if expires_in_days > 180 else "fixed",
            "created_at": _days_ago(rng.randint(30, 400)),
            "last_activated_at": _days_ago(rng.randint(0, 14)),
        })
    await db.m365_gdap.insert_many(gdap)

    # Standards library (idempotent seed)
    if await db.m365_standards.count_documents({}) == 0:
        await db.m365_standards.insert_many([{
            **s,
            "id": f"std-{s['key']}",
            "enabled": False,
            "assigned_tenants": [],
            "schedule_hours": 12,
            "actions": ["report"],
            "created_at": _now_iso(),
        } for s in MOCK_STANDARD_LIBRARY])

    # CA template library (idempotent seed)
    if await db.m365_ca_templates.count_documents({}) == 0:
        ca_templates = [
            {"key": "require_mfa_admins", "name": "Require MFA for admin roles", "source": "CyberDrain Baseline", "category": "identity", "severity": "critical"},
            {"key": "block_legacy_auth_ca", "name": "Block legacy authentication", "source": "CyberDrain Baseline", "category": "identity", "severity": "high"},
            {"key": "require_mfa_guest", "name": "Require MFA for guests", "source": "Open Intune Baseline", "category": "identity", "severity": "high"},
            {"key": "block_unknown_countries", "name": "Block sign-ins from unknown countries", "source": "CyberDrain Baseline", "category": "location", "severity": "medium"},
            {"key": "require_compliant_device", "name": "Require compliant device", "source": "Microsoft Baseline", "category": "device", "severity": "high"},
            {"key": "session_lifetime_office", "name": "Session lifetime — Office apps", "source": "Open Intune Baseline", "category": "session", "severity": "medium"},
            {"key": "block_high_risk_signin", "name": "Block high-risk sign-ins", "source": "Microsoft Baseline", "category": "risk", "severity": "high"},
            {"key": "require_terms_of_use", "name": "Require Terms of Use", "source": "Custom", "category": "governance", "severity": "low"},
        ]
        await db.m365_ca_templates.insert_many([{**c, "id": f"cat-{c['key']}", "created_at": _now_iso()} for c in ca_templates])


# ═════════════════════════ Connection Settings ═════════════════════════

@router.get("/m365/connection")
async def get_connection(current_user: dict = Depends(get_current_user)):
    s = await _get_settings()
    # never return secrets verbatim
    masked = {
        "app_id": s.get("app_id"),
        "tenant_id": s.get("tenant_id"),
        "app_secret": ("****" + s["app_secret"][-4:]) if s.get("app_secret") else None,
        "refresh_token": ("****" + s["refresh_token"][-4:]) if s.get("refresh_token") else None,
        "mode": _connection_status(s),
        "last_synced": s.get("last_synced"),
        "partner_center_account": s.get("partner_center_account"),
    }
    return masked


@router.put("/m365/connection")
async def update_connection(data: dict, current_user: dict = Depends(get_current_user)):
    s = await _get_settings()
    for k in ("app_id", "tenant_id", "app_secret", "refresh_token", "partner_center_account"):
        if k in data and data[k] is not None:
            s[k] = str(data[k]).strip() or None
    s["updated_by"] = current_user.get("name")
    s["updated_at"] = _now_iso()
    await db.settings.update_one({"key": "m365_connection"}, {"$set": {"value": s, "key": "m365_connection"}}, upsert=True)
    await log_activity(current_user, "m365_connection_updated", "settings", "m365_connection", "M365 connection", _connection_status(s))
    return {"success": True, "mode": _connection_status(s)}


@router.post("/m365/connection/test")
async def test_connection(current_user: dict = Depends(get_current_user)):
    s = await _get_settings()
    mode = _connection_status(s)
    if mode != "live":
        return {"ok": False, "mode": "mock", "reason": "Missing app_id / tenant_id / app_secret / refresh_token"}
    # Future: real Graph token endpoint call goes here
    return {"ok": True, "mode": "live", "scope": "GDAP.Read.All Directory.Read.All Policy.Read.All"}


# ═════════════════════════ M1: Tenants + Users + Universal Search ═════════════════════════

@router.get("/m365/tenants")
async def list_tenants(current_user: dict = Depends(get_current_user)):
    await _seed_if_empty()
    items = await db.m365_tenants.find({"source": "m365cc"}, {"_id": 0}).sort("name", 1).to_list(500)
    return items


@router.get("/m365/tenants/{tid}")
async def get_tenant(tid: str, current_user: dict = Depends(get_current_user)):
    await _seed_if_empty()
    t = await db.m365_tenants.find_one({"id": tid, "source": "m365cc"}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Tenant not found")
    user_count = await db.m365_users.count_documents({"tenant_id": tid, "source": "m365cc"})
    no_mfa = await db.m365_users.count_documents({"tenant_id": tid, "source": "m365cc", "mfa_enforced": False, "account_enabled": True})
    admins = await db.m365_users.count_documents({"tenant_id": tid, "source": "m365cc", "is_admin": True})
    gdap = await db.m365_gdap.find_one({"tenant_id": tid}, {"_id": 0})
    t["computed"] = {"user_count": user_count, "users_no_mfa": no_mfa, "admins": admins, "gdap_status": (gdap or {}).get("status")}
    t["deep_links"] = {
        "entra": f"https://entra.microsoft.com/{t.get('default_domain')}/?login_hint=admin@{t.get('default_domain')}",
        "exchange": f"https://admin.exchange.microsoft.com/?login_hint=admin@{t.get('default_domain')}",
        "intune": f"https://intune.microsoft.com/?login_hint=admin@{t.get('default_domain')}",
        "sharepoint": f"https://{(t.get('default_domain') or '').split('.')[0]}-admin.sharepoint.com",
        "defender": f"https://security.microsoft.com/?login_hint=admin@{t.get('default_domain')}",
    }
    return t


@router.get("/m365/tenants/health/summary")
async def tenants_health_summary(current_user: dict = Depends(get_current_user)):
    """Aggregate KPIs across all tenants."""
    await _seed_if_empty()
    tenants = await db.m365_tenants.find({"source": "m365cc"}, {"_id": 0}).to_list(500)
    if not tenants:
        return {"tenants": 0, "users": 0, "avg_mfa_pct": 0, "avg_secure_score": 0, "secure_trend": 0}
    avg_mfa = sum(t.get("mfa_enrolled_pct", 0) for t in tenants) / len(tenants)
    avg_secure = sum(t.get("secure_score", 0) for t in tenants) / len(tenants)
    avg_trend = sum(t.get("secure_score_30d_trend", 0) for t in tenants) / len(tenants)
    users_total = sum(t.get("users_count", 0) for t in tenants)
    risky = await db.m365_users.count_documents({"source": "m365cc", "risky_signin_30d": True})
    expiring_gdap = await db.m365_gdap.count_documents({"expires_in_days": {"$lte": 30}})
    return {
        "tenants": len(tenants),
        "users": users_total,
        "avg_mfa_pct": round(avg_mfa, 1),
        "avg_secure_score": round(avg_secure, 1),
        "secure_trend": round(avg_trend, 1),
        "risky_signins_30d": risky,
        "gdap_expiring_30d": expiring_gdap,
    }


@router.get("/m365/users")
async def list_users(tenant_id: str | None = None, q: str | None = None, no_mfa: bool = False, current_user: dict = Depends(get_current_user)):
    await _seed_if_empty()
    query = {"source": "m365cc"}
    if tenant_id:
        query["tenant_id"] = tenant_id
    if no_mfa:
        query["mfa_enforced"] = False
        query["account_enabled"] = True
    if q:
        rgx = re.escape(q)
        query["$or"] = [
            {"display_name": {"$regex": rgx, "$options": "i"}},
            {"upn": {"$regex": rgx, "$options": "i"}},
            {"department": {"$regex": rgx, "$options": "i"}},
        ]
    rows = await db.m365_users.find(query, {"_id": 0}).limit(2000).to_list(2000)
    return rows


@router.get("/m365/search")
async def universal_search(q: str = Query(..., min_length=2), current_user: dict = Depends(get_current_user)):
    """Search users, tenants, GDAP roles across all tenants in one query."""
    await _seed_if_empty()
    rgx = re.escape(q)
    users = await db.m365_users.find(
        {"source": "m365cc", "$or": [{"display_name": {"$regex": rgx, "$options": "i"}}, {"upn": {"$regex": rgx, "$options": "i"}}]},
        {"_id": 0, "id": 1, "display_name": 1, "upn": 1, "tenant_name": 1, "tenant_id": 1, "department": 1, "mfa_enforced": 1, "account_enabled": 1, "is_admin": 1},
    ).limit(40).to_list(40)
    tenants = await db.m365_tenants.find(
        {"source": "m365cc", "$or": [{"name": {"$regex": rgx, "$options": "i"}}, {"default_domain": {"$regex": rgx, "$options": "i"}}]},
        {"_id": 0, "id": 1, "name": 1, "default_domain": 1, "users_count": 1, "secure_score": 1},
    ).limit(20).to_list(20)
    gdap = await db.m365_gdap.find({"roles": {"$regex": rgx, "$options": "i"}}, {"_id": 0, "id": 1, "tenant_name": 1, "tenant_id": 1, "roles": 1, "expires_in_days": 1}).limit(20).to_list(20)
    return {"users": users, "tenants": tenants, "gdap": gdap, "count": len(users) + len(tenants) + len(gdap)}


# ═════════════════════════ M2: Standards Engine ═════════════════════════

@router.get("/m365/standards")
async def list_standards(category: str | None = None, current_user: dict = Depends(get_current_user)):
    await _seed_if_empty()
    q = {}
    if category:
        q["category"] = category
    items = await db.m365_standards.find(q, {"_id": 0}).sort("severity", -1).to_list(500)
    return items


@router.put("/m365/standards/{sid}")
async def update_standard(sid: str, data: dict, current_user: dict = Depends(get_current_user)):
    patch = {}
    for k in ("enabled", "assigned_tenants", "schedule_hours", "actions", "auto_remediate", "name", "description"):
        if k in data:
            patch[k] = data[k]
    patch["updated_at"] = _now_iso()
    patch["updated_by"] = current_user.get("name")
    r = await db.m365_standards.update_one({"id": sid}, {"$set": patch})
    if not r.matched_count:
        raise HTTPException(404, "Standard not found")
    return await db.m365_standards.find_one({"id": sid}, {"_id": 0})


@router.post("/m365/standards/{sid}/run")
async def run_standard(sid: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    """Run a standard now — performs BPA + (optionally) remediation. Returns per-tenant
    results with compliant / drifted / remediated counts."""
    await _seed_if_empty()
    std = await db.m365_standards.find_one({"id": sid}, {"_id": 0})
    if not std:
        raise HTTPException(404, "Standard not found")
    assigned = std.get("assigned_tenants") or []
    if assigned:
        tenants = await db.m365_tenants.find({"id": {"$in": assigned}, "source": "m365cc"}, {"_id": 0}).to_list(200)
    else:
        tenants = await db.m365_tenants.find({"source": "m365cc"}, {"_id": 0}).to_list(200)

    actions = std.get("actions") or ["report"]
    remediate = "remediate" in actions and std.get("auto_remediate", False)
    rng = random.Random(hash(sid) & 0xFFFFFFFF)
    results = []
    summary = {"compliant": 0, "drifted": 0, "remediated": 0, "skipped": 0}
    for t in tenants:
        # Simulate compliance check (mock): bias by secure_score
        score = t.get("secure_score", 50)
        is_compliant = (rng.random() * 100) < score
        record = {
            "id": str(uuid.uuid4()),
            "standard_id": sid,
            "standard_key": std.get("key"),
            "tenant_id": t["id"],
            "tenant_name": t["name"],
            "compliant": is_compliant,
            "checked_at": _now_iso(),
            "action": "report",
            "message": "",
        }
        if not is_compliant:
            if remediate:
                record["action"] = "remediated"
                record["message"] = f"Drift detected and auto-remediated for {std.get('key')}."
                summary["remediated"] += 1
            else:
                record["action"] = "drift_logged"
                record["message"] = f"Drift detected for {std.get('key')} — manual review needed."
                summary["drifted"] += 1
        else:
            summary["compliant"] += 1
        results.append(record)

    await db.m365_standard_runs.insert_many(results)
    # Strip _id from records before returning (insert_many mutates the dicts).
    for r in results:
        r.pop("_id", None)

    run_doc = {
        "id": str(uuid.uuid4()),
        "standard_id": sid,
        "standard_key": std.get("key"),
        "standard_name": std.get("name"),
        "started_at": _now_iso(),
        "finished_at": _now_iso(),
        "tenant_count": len(tenants),
        "summary": summary,
        "triggered_by": current_user.get("name"),
        "actions": actions,
    }
    await db.m365_standard_run_summaries.insert_one(run_doc)
    await db.m365_standards.update_one({"id": sid}, {"$set": {"last_run_at": _now_iso(), "last_run_summary": summary}})
    await log_activity(current_user, "m365_standard_run", "m365_standard", sid, std.get("name", ""), f"compliant={summary['compliant']} drift={summary['drifted']} remediated={summary['remediated']}")
    run_doc.pop("_id", None)
    return {"run": run_doc, "results": results}


@router.get("/m365/standards/{sid}/runs")
async def list_standard_runs(sid: str, current_user: dict = Depends(get_current_user)):
    items = await db.m365_standard_run_summaries.find({"standard_id": sid}, {"_id": 0}).sort("started_at", -1).limit(50).to_list(50)
    return items


@router.get("/m365/bpa-report")
async def bpa_report(tenant_id: str | None = None, current_user: dict = Depends(get_current_user)):
    """Aggregate latest standard results across enabled standards. Returns a BPA matrix."""
    await _seed_if_empty()
    enabled = await db.m365_standards.find({"enabled": True}, {"_id": 0}).to_list(200)
    tenants = await db.m365_tenants.find({"source": "m365cc"} if not tenant_id else {"id": tenant_id, "source": "m365cc"}, {"_id": 0}).to_list(200)

    matrix = []
    for t in tenants:
        row = {"tenant_id": t["id"], "tenant_name": t["name"], "secure_score": t.get("secure_score"), "items": []}
        for s in enabled:
            latest = await db.m365_standard_runs.find_one({"standard_id": s["id"], "tenant_id": t["id"]}, {"_id": 0}, sort=[("checked_at", -1)])
            row["items"].append({
                "standard_id": s["id"], "standard_name": s["name"], "category": s.get("category"),
                "severity": s.get("severity"),
                "compliant": (latest or {}).get("compliant"),
                "action": (latest or {}).get("action"),
                "checked_at": (latest or {}).get("checked_at"),
            })
        compliance_pct = 0
        if row["items"]:
            checked = [i for i in row["items"] if i["compliant"] is not None]
            if checked:
                compliance_pct = round(sum(1 for i in checked if i["compliant"]) / len(checked) * 100, 1)
        row["compliance_pct"] = compliance_pct
        matrix.append(row)
    return {"matrix": matrix, "standards": [{"id": s["id"], "name": s["name"], "category": s.get("category"), "severity": s.get("severity")} for s in enabled]}


# ═════════════════════════ M3: GDAP + Offboarding ═════════════════════════

@router.get("/m365/gdap")
async def list_gdap(expiring_only: bool = False, current_user: dict = Depends(get_current_user)):
    await _seed_if_empty()
    q = {"expires_in_days": {"$lte": 30}} if expiring_only else {}
    items = await db.m365_gdap.find(q, {"_id": 0}).sort("expires_in_days", 1).to_list(500)
    return items


@router.post("/m365/gdap/{gid}/extend")
async def extend_gdap(gid: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    days = int((data or {}).get("days", 365))
    g = await db.m365_gdap.find_one({"id": gid}, {"_id": 0})
    if not g:
        raise HTTPException(404, "GDAP relationship not found")
    new_expiry = datetime.now(timezone.utc) + timedelta(days=days)
    await db.m365_gdap.update_one({"id": gid}, {"$set": {
        "expires_at": new_expiry.isoformat(),
        "expires_in_days": days,
        "last_extended_at": _now_iso(),
    }})
    await log_activity(current_user, "gdap_extended", "m365_gdap", gid, g.get("tenant_name", ""), f"+{days}d")
    return {"success": True, "expires_at": new_expiry.isoformat()}


@router.get("/m365/gdap/role-templates")
async def list_role_templates(current_user: dict = Depends(get_current_user)):
    items = await db.m365_gdap_role_templates.find({}, {"_id": 0}).to_list(200)
    if not items:
        defaults = [
            {"id": "tier1-helpdesk", "name": "Tier 1 — Helpdesk", "roles": ["Helpdesk Administrator", "User Administrator", "Reports Reader"]},
            {"id": "tier2-l2-tech", "name": "Tier 2 — L2 Technician", "roles": ["User Administrator", "Authentication Administrator", "Application Administrator", "Exchange Administrator", "Intune Administrator", "Reports Reader"]},
            {"id": "tier3-engineer", "name": "Tier 3 — Engineer", "roles": ["Cloud Application Administrator", "Conditional Access Administrator", "Security Administrator", "Intune Administrator", "Exchange Administrator", "Teams Administrator", "Reports Reader"]},
            {"id": "billing-only", "name": "Billing only", "roles": ["License Administrator", "Reports Reader"]},
        ]
        await db.m365_gdap_role_templates.insert_many([{**d, "created_at": _now_iso()} for d in defaults])
        return defaults
    return items


@router.post("/m365/offboarding")
async def start_offboarding(data: dict, current_user: dict = Depends(get_current_user)):
    """Run the offboarding wizard for a user: disable sign-in + remove licenses +
    hide from address book + set OOO + convert to shared. Mock-safe."""
    user_id = data.get("user_id")
    tenant_id = data.get("tenant_id")
    if not user_id or not tenant_id:
        raise HTTPException(400, "user_id and tenant_id required")
    user = await db.m365_users.find_one({"id": user_id, "tenant_id": tenant_id, "source": "m365cc"}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")

    steps = data.get("steps") or {
        "disable_signin": True,
        "remove_licenses": True,
        "hide_from_gal": True,
        "set_ooo": True,
        "convert_to_shared": True,
        "delegate_email": False,
        "transfer_onedrive": False,
        "forward_email_to_manager": False,
    }
    ooo_message = (data.get("ooo_message") or
                   "Hello, I am no longer with the organisation. For assistance please contact your manager.")

    results = []
    if steps.get("disable_signin"):
        await db.m365_users.update_one({"id": user_id}, {"$set": {"account_enabled": False}})
        results.append({"step": "disable_signin", "ok": True, "message": "Sign-in disabled"})
    if steps.get("remove_licenses"):
        await db.m365_users.update_one({"id": user_id}, {"$set": {"license_sku": None}})
        results.append({"step": "remove_licenses", "ok": True, "message": "Licenses removed"})
    if steps.get("hide_from_gal"):
        results.append({"step": "hide_from_gal", "ok": True, "message": "Hidden from Global Address List"})
    if steps.get("set_ooo"):
        results.append({"step": "set_ooo", "ok": True, "message": "Out-of-Office configured", "preview": ooo_message[:120]})
    if steps.get("convert_to_shared"):
        results.append({"step": "convert_to_shared", "ok": True, "message": "Mailbox converted to shared"})
    if steps.get("forward_email_to_manager") and data.get("forward_to_upn"):
        results.append({"step": "forward_email_to_manager", "ok": True, "message": f"Forwarding → {data['forward_to_upn']}"})
    if steps.get("transfer_onedrive") and data.get("transfer_onedrive_to_upn"):
        results.append({"step": "transfer_onedrive", "ok": True, "message": f"OneDrive transferred → {data['transfer_onedrive_to_upn']}"})

    log = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "user_id": user_id,
        "user_upn": user.get("upn"),
        "user_display_name": user.get("display_name"),
        "steps": steps,
        "results": results,
        "executed_by": current_user.get("name"),
        "executed_at": _now_iso(),
    }
    await db.m365_offboardings.insert_one(log)
    await log_activity(current_user, "m365_offboarding", "m365_user", user_id, user.get("upn", ""), f"steps={sum(1 for v in steps.values() if v)}")
    log.pop("_id", None)
    return log


@router.get("/m365/offboardings")
async def list_offboardings(current_user: dict = Depends(get_current_user)):
    items = await db.m365_offboardings.find({}, {"_id": 0}).sort("executed_at", -1).limit(100).to_list(100)
    return items


# ═════════════════════════ M4: Security & Alerts ═════════════════════════

@router.get("/m365/mfa-analytics")
async def mfa_analytics(tenant_id: str | None = None, current_user: dict = Depends(get_current_user)):
    """Per-method MFA breakdown across users."""
    await _seed_if_empty()
    q = {"source": "m365cc", "account_enabled": True}
    if tenant_id:
        q["tenant_id"] = tenant_id
    pipeline = [
        {"$match": q},
        {"$group": {"_id": "$mfa_method", "n": {"$sum": 1}}},
    ]
    rows = await db.m365_users.aggregate(pipeline).to_list(20)
    methods = {r["_id"] or "none": r["n"] for r in rows}
    total = sum(methods.values())
    no_mfa_users = await db.m365_users.find({**q, "mfa_method": "none"}, {"_id": 0, "display_name": 1, "upn": 1, "tenant_name": 1, "is_admin": 1}).limit(50).to_list(50)
    no_mfa_admins = [u for u in no_mfa_users if u.get("is_admin")]
    return {
        "by_method": methods,
        "total_users": total,
        "no_mfa_users": no_mfa_users,
        "no_mfa_admin_count": len(no_mfa_admins),
        "mfa_pct": round(sum(v for k, v in methods.items() if k != "none") / max(1, total) * 100, 1),
    }


@router.get("/m365/secure-score/trend")
async def secure_score_trend(current_user: dict = Depends(get_current_user)):
    await _seed_if_empty()
    tenants = await db.m365_tenants.find({"source": "m365cc"}, {"_id": 0, "id": 1, "name": 1, "secure_score": 1, "secure_score_30d_trend": 1}).to_list(500)
    # Build a fake 30-day series for visualization
    rng = random.Random(7)
    series = []
    today = datetime.now(timezone.utc)
    for i in range(30):
        d = (today - timedelta(days=29 - i)).strftime("%Y-%m-%d")
        avg = sum(t["secure_score"] for t in tenants) / max(1, len(tenants))
        jitter = (rng.random() - 0.5) * 4
        series.append({"date": d, "avg": round(avg + jitter, 1)})
    return {"tenants": tenants, "series": series}


@router.get("/m365/ca-templates")
async def list_ca_templates(current_user: dict = Depends(get_current_user)):
    await _seed_if_empty()
    return await db.m365_ca_templates.find({}, {"_id": 0}).to_list(500)


@router.post("/m365/ca-templates/{cid}/deploy")
async def deploy_ca_template(cid: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Deploy a CA template to N tenants. Mock-safe."""
    tpl = await db.m365_ca_templates.find_one({"id": cid}, {"_id": 0})
    if not tpl:
        raise HTTPException(404, "Template not found")
    tenants = data.get("tenant_ids") or []
    if not tenants:
        raise HTTPException(400, "tenant_ids required")
    results = []
    for tid in tenants:
        t = await db.m365_tenants.find_one({"id": tid}, {"_id": 0, "id": 1, "name": 1})
        if not t:
            results.append({"tenant_id": tid, "ok": False, "message": "tenant not found"})
            continue
        await db.m365_ca_deployments.insert_one({
            "id": str(uuid.uuid4()), "tenant_id": tid, "tenant_name": t["name"],
            "template_id": cid, "template_name": tpl["name"], "status": "deployed",
            "deployed_at": _now_iso(), "deployed_by": current_user.get("name"),
        })
        results.append({"tenant_id": tid, "tenant_name": t["name"], "ok": True, "message": f"Deployed: {tpl['name']}"})
    await log_activity(current_user, "ca_template_deployed", "m365_ca_template", cid, tpl["name"], f"to {len(results)} tenants")
    return {"deployed": sum(1 for r in results if r["ok"]), "results": results}


# Scripted Alerts engine
@router.get("/m365/scripted-alerts")
async def list_scripted_alerts(current_user: dict = Depends(get_current_user)):
    items = await db.m365_scripted_alerts.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    if not items:
        defaults = [
            {"key": "impossible_travel", "name": "Impossible travel", "expression": "signin.country != last_signin.country AND time_delta < 2h", "severity": "high", "enabled": True, "trigger_count_30d": 12},
            {"key": "new_admin", "name": "New admin role assignment", "expression": "audit.activity == 'Add member to role' AND target_role IN admin_roles", "severity": "critical", "enabled": True, "trigger_count_30d": 3},
            {"key": "mass_delete", "name": "Mass delete (>50 items in 5min)", "expression": "audit.activity == 'Delete' COUNT > 50 WITHIN 5m", "severity": "high", "enabled": True, "trigger_count_30d": 1},
            {"key": "inbox_forward_external", "name": "Inbox forward to external", "expression": "audit.activity == 'New-InboxRule' AND rule.forwardTo CONTAINS @external", "severity": "high", "enabled": True, "trigger_count_30d": 7},
            {"key": "guest_admin", "name": "Guest user gets admin role", "expression": "user.userType == 'Guest' AND role IN admin_roles", "severity": "critical", "enabled": True, "trigger_count_30d": 0},
        ]
        await db.m365_scripted_alerts.insert_many([{**d, "id": f"sa-{d['key']}", "created_at": _now_iso(), "last_fired_at": _days_ago(7)} for d in defaults])
        return defaults
    return items


@router.post("/m365/scripted-alerts")
async def create_scripted_alert(data: dict, current_user: dict = Depends(get_current_user)):
    if not data.get("name") or not data.get("expression"):
        raise HTTPException(400, "name and expression required")
    a = {
        "id": str(uuid.uuid4()),
        "key": (data.get("name") or "").lower().replace(" ", "_")[:50],
        "name": data["name"],
        "expression": data["expression"],
        "severity": data.get("severity", "medium"),
        "enabled": bool(data.get("enabled", True)),
        "trigger_count_30d": 0,
        "created_at": _now_iso(),
        "created_by": current_user.get("name"),
    }
    await db.m365_scripted_alerts.insert_one(a)
    a.pop("_id", None)
    return a


@router.delete("/m365/scripted-alerts/{aid}")
async def delete_scripted_alert(aid: str, current_user: dict = Depends(get_current_user)):
    await db.m365_scripted_alerts.delete_one({"id": aid})
    return {"success": True}


# Anti-AITM "Do Not Login" page CSS generator
@router.get("/m365/aitm-page")
async def get_aitm_page(current_user: dict = Depends(get_current_user)):
    s = await db.settings.find_one({"key": "m365_aitm_page"}, {"_id": 0}) or {}
    return s.get("value") or {
        "enabled": False,
        "company_name": "Your Company",
        "warning_text": "DO NOT LOGIN — If you see this message, the page you're on is fake. Close it immediately and report to IT.",
        "primary_color": "#DC2626",
    }


@router.put("/m365/aitm-page")
async def update_aitm_page(data: dict, current_user: dict = Depends(get_current_user)):
    cur = await db.settings.find_one({"key": "m365_aitm_page"}, {"_id": 0}) or {}
    val = cur.get("value") or {}
    for k in ("enabled", "company_name", "warning_text", "primary_color", "logo_url"):
        if k in data:
            val[k] = data[k]
    val["updated_at"] = _now_iso()
    await db.settings.update_one({"key": "m365_aitm_page"}, {"$set": {"value": val, "key": "m365_aitm_page"}}, upsert=True)
    # Generate the CSS payload
    css = _generate_aitm_css(val)
    return {**val, "css": css}


def _generate_aitm_css(cfg: dict) -> str:
    color = cfg.get("primary_color", "#DC2626")
    text = (cfg.get("warning_text") or "").replace('"', "'")
    company = cfg.get("company_name", "Your Company")
    return f"""/* Anti-AITM CSS injected via Entra Custom Branding for {company} */
body::before {{
  content: "{text}";
  display: block;
  background: {color};
  color: white;
  font-family: Arial, sans-serif;
  font-size: 18px;
  font-weight: bold;
  padding: 16px;
  text-align: center;
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 999999;
  border-bottom: 4px solid #fff;
}}
body {{ padding-top: 80px !important; }}
"""


# ═════════════════════════ AI Tenant Brief ═════════════════════════

@router.get("/m365/tenants/{tid}/ai-brief")
async def tenant_ai_brief(tid: str, current_user: dict = Depends(get_current_user)):
    """Claude-written executive brief for a tenant covering MFA, Secure Score, GDAP, risks."""
    t = await db.m365_tenants.find_one({"id": tid, "source": "m365cc"}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Tenant not found")
    users_no_mfa = await db.m365_users.count_documents({"tenant_id": tid, "source": "m365cc", "mfa_enforced": False, "account_enabled": True})
    risky = await db.m365_users.count_documents({"tenant_id": tid, "source": "m365cc", "risky_signin_30d": True})
    gdap = await db.m365_gdap.find_one({"tenant_id": tid}, {"_id": 0})
    payload = {
        "tenant": {"name": t.get("name"), "domain": t.get("default_domain"), "users": t.get("users_count"),
                   "license": t.get("license_sku"), "secure_score": t.get("secure_score"), "trend_30d": t.get("secure_score_30d_trend")},
        "mfa": {"enrolled_pct": t.get("mfa_enrolled_pct"), "users_no_mfa": users_no_mfa},
        "risk": {"risky_signins_30d": risky},
        "gdap": gdap or {},
    }
    try:
        from emergentintegrations.llm.chat import UserMessage
        chat = await _ai_chat(f"m365-brief-{tid}", "You are an MSP M365 analyst. Write a 4-bullet executive brief covering posture, risks, and 3 prioritised actions. Keep under 140 words.")
        resp = await chat.send_message(UserMessage(text=json.dumps(payload)))
        return {"brief": resp.strip(), "payload": payload}
    except Exception as e:
        logger.warning(f"AI brief failed: {e}")
        return {"brief": f"{t.get('name')} — Secure Score {t.get('secure_score')}/100 (trend {t.get('secure_score_30d_trend'):+d}). MFA {t.get('mfa_enrolled_pct')}% enrolled; {users_no_mfa} users without MFA; {risky} risky sign-ins in 30 days. Prioritise: enforce MFA on holdouts, review GDAP expiry, run Standards Engine BPA.", "payload": payload}
