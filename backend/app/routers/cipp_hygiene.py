"""
CIPP M365 hygiene scoring + weekly digest.

Hygiene score (0-100) per tenant, composed of:
  - License efficiency        · unlicensed active users (20 pts)
  - MFA coverage              · % enabled or enforced    (25 pts)
  - Stale users               · sign-in > 90d            (15 pts)
  - Disabled-but-licensed     · license waste            (15 pts)
  - Admin sprawl              · global admins > 4        (10 pts)
  - Guest posture             · stale guests             (10 pts)
  - Basic auth / legacy       · any found                (5 pts)

Data comes from CIPP (best-effort; missing signals just skip that dimension).
Cached per tenant for 6h in db.cipp_hygiene_cache.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from typing import Optional
import asyncio

from app.database import db
from app.auth import get_current_user
from app.routers.cipp import _cipp_call, _get_config, _norm_tenants

router = APIRouter()

CACHE_TTL_MIN = 360  # 6h
STALE_DAYS = 90
HYGIENE_SCHEMA_VERSION = 2


def _parse_dt(val) -> Optional[datetime]:
    if not val:
        return None
    if isinstance(val, datetime):
        return val
    try:
        s = str(val).replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except Exception:
        return None


async def _fetch_tenant_data(tenant_id: str) -> dict:
    """Fan out all CIPP calls needed for hygiene. Each call is best-effort."""
    async def safe(coro):
        try:
            return True, await coro
        except Exception:
            return False, None

    users_result, mfa_result, conditional_result, guests_result = await asyncio.gather(
        safe(_cipp_call("GET", "ListUsers", params={"TenantFilter": tenant_id})),
        safe(_cipp_call("GET", "ListMFAUsers", params={"TenantFilter": tenant_id})),
        safe(_cipp_call("GET", "ListConditionalAccessPolicies", params={"TenantFilter": tenant_id})),
        safe(_cipp_call("GET", "ListGuests", params={"TenantFilter": tenant_id})),
    )
    users_available, users = users_result
    mfa_available, mfa = mfa_result
    conditional_available, conditional = conditional_result
    guests_available, guests = guests_result

    def _to_list(x):
        if isinstance(x, list):
            return x
        if isinstance(x, dict):
            for k in ("Users", "users", "Results", "value"):
                if isinstance(x.get(k), list):
                    return x[k]
        return []

    return {
        "users": _to_list(users),
        "mfa": _to_list(mfa),
        "conditional": _to_list(conditional),
        "guests": _to_list(guests),
        "_sources": {
            "users": users_available,
            "mfa": mfa_available,
            "conditional": conditional_available,
            "guests": guests_available,
        },
    }


def _compute_hygiene_legacy(data: dict) -> dict:
    users = data.get("users") or []
    mfa_rows = data.get("mfa") or []
    cond = data.get("conditional") or []
    guests = data.get("guests") or []

    total = len(users)
    if total == 0:
        return {
            "score": 0,
            "grade": "F",
            "total_users": 0,
            "breakdown": {},
            "risks": [{"factor": "No users returned from CIPP", "severity": "warning", "impact": -0}],
            "positives": [],
            "counts": {},
        }

    # --- accounts -----------------------------------------------------------
    def _ge(u, *keys):
        for k in keys:
            if k in u and u.get(k) is not None:
                return u.get(k)
        return None

    enabled_users = [u for u in users if _ge(u, "accountEnabled", "AccountEnabled", "enabled") is not False]
    disabled_users = [u for u in users if _ge(u, "accountEnabled", "AccountEnabled", "enabled") is False]

    def _license_count(u):
        lic = _ge(u, "assignedLicenses", "AssignedLicenses") or []
        return len(lic) if isinstance(lic, list) else 0

    unlicensed_active = [u for u in enabled_users if _license_count(u) == 0]
    disabled_licensed = [u for u in disabled_users if _license_count(u) > 0]

    def _last_signin(u):
        sia = _ge(u, "signInActivity", "SignInActivity") or {}
        if isinstance(sia, dict):
            return _parse_dt(sia.get("lastSignInDateTime") or sia.get("LastSignInDateTime"))
        return _parse_dt(_ge(u, "lastSignIn", "LastSignIn"))

    cutoff = datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)
    stale_users = []
    for u in enabled_users:
        ls = _last_signin(u)
        if ls and ls < cutoff:
            stale_users.append(u)

    # --- MFA ----------------------------------------------------------------
    mfa_by_upn = {}
    for m in mfa_rows:
        upn = m.get("UPN") or m.get("userPrincipalName") or m.get("UserPrincipalName")
        if upn:
            mfa_by_upn[str(upn).lower()] = m

    mfa_registered = 0
    mfa_enforced = 0
    mfa_checked = 0
    for u in enabled_users:
        upn = _ge(u, "userPrincipalName", "UserPrincipalName")
        if not upn:
            continue
        m = mfa_by_upn.get(str(upn).lower())
        if m is None:
            continue
        mfa_checked += 1
        reg = m.get("MFARegistration") or m.get("mfaRegistration") or m.get("isMfaRegistered")
        enforced = m.get("MFAEnforced") or m.get("mfaEnforced") or m.get("PerUserMFAState") in ("enforced", "enabled")
        if reg:
            mfa_registered += 1
        if enforced:
            mfa_enforced += 1

    mfa_coverage_pct = round((mfa_registered / mfa_checked) * 100) if mfa_checked else None

    # --- admins -------------------------------------------------------------
    global_admins = 0
    for u in users:
        roles = _ge(u, "assignedRoles", "AssignedRoles", "memberOf") or []
        if isinstance(roles, list):
            for r in roles:
                rn = (r.get("displayName") if isinstance(r, dict) else str(r)) or ""
                if "global administrator" in rn.lower():
                    global_admins += 1
                    break

    # --- guests -------------------------------------------------------------
    stale_guests = 0
    for g in guests:
        ls = _last_signin(g) or _parse_dt(g.get("createdDateTime") or g.get("CreatedDateTime"))
        if ls and ls < cutoff:
            stale_guests += 1

    # --- scoring ------------------------------------------------------------
    # Each dimension returns (earned, max)
    dims = {}

    # License efficiency (20 pts)
    unl_pct = len(unlicensed_active) / max(len(enabled_users), 1)
    dims["license_efficiency"] = (round(20 * (1 - min(unl_pct * 2, 1))), 20)

    # MFA coverage (25 pts) — only counts when we have MFA data
    if mfa_coverage_pct is None:
        dims["mfa_coverage"] = (12, 25)  # unknown → half
    else:
        dims["mfa_coverage"] = (round(25 * (mfa_coverage_pct / 100)), 25)

    # Stale users (15 pts)
    stale_pct = len(stale_users) / max(len(enabled_users), 1)
    dims["stale_users"] = (round(15 * (1 - min(stale_pct * 1.5, 1))), 15)

    # Disabled-but-licensed (15 pts)
    dims["license_waste"] = (15 if len(disabled_licensed) == 0 else max(0, 15 - len(disabled_licensed) * 3), 15)

    # Admin sprawl (10 pts) — target: <=4 global admins
    if global_admins == 0:
        dims["admin_sprawl"] = (6, 10)  # 0 admins is itself a risk (lockout)
    elif global_admins <= 4:
        dims["admin_sprawl"] = (10, 10)
    else:
        dims["admin_sprawl"] = (max(0, 10 - (global_admins - 4) * 2), 10)

    # Guest posture (10 pts)
    dims["guest_posture"] = (10 if stale_guests == 0 else max(0, 10 - stale_guests), 10)

    # Conditional access / MFA policy presence (5 pts)
    has_mfa_policy = False
    for p in cond:
        name = (p.get("displayName") or p.get("DisplayName") or "").lower()
        if "mfa" in name or "require multi" in name:
            has_mfa_policy = True
            break
    dims["modern_auth"] = (5 if has_mfa_policy else 0, 5)

    earned = sum(e for e, _ in dims.values())
    max_possible = sum(m for _, m in dims.values())
    score = round((earned / max_possible) * 100) if max_possible else 0

    grade = "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D" if score >= 40 else "F"

    # --- risks + positives --------------------------------------------------
    risks = []
    if len(unlicensed_active) > 0:
        risks.append({"factor": f"{len(unlicensed_active)} active users without a license", "severity": "warning", "impact": -(20 - dims["license_efficiency"][0])})
    if mfa_coverage_pct is not None and mfa_coverage_pct < 90:
        risks.append({"factor": f"MFA coverage only {mfa_coverage_pct}% ({mfa_registered}/{mfa_checked})", "severity": "critical" if mfa_coverage_pct < 50 else "warning", "impact": -(25 - dims["mfa_coverage"][0])})
    if len(stale_users) > 0:
        risks.append({"factor": f"{len(stale_users)} users haven't signed in for {STALE_DAYS}+ days", "severity": "warning", "impact": -(15 - dims["stale_users"][0])})
    if len(disabled_licensed) > 0:
        risks.append({"factor": f"{len(disabled_licensed)} disabled users still hold licenses (license waste)", "severity": "warning", "impact": -(15 - dims["license_waste"][0])})
    if global_admins > 4:
        risks.append({"factor": f"{global_admins} global admins (target ≤4)", "severity": "warning", "impact": -(10 - dims["admin_sprawl"][0])})
    if global_admins == 0:
        risks.append({"factor": "No global admin visible — potential lockout risk", "severity": "critical", "impact": -4})
    if stale_guests > 0:
        risks.append({"factor": f"{stale_guests} stale guest accounts (>{STALE_DAYS}d)", "severity": "info", "impact": -(10 - dims["guest_posture"][0])})
    if not has_mfa_policy:
        risks.append({"factor": "No MFA conditional access policy detected", "severity": "critical", "impact": -5})

    positives = []
    if len(unlicensed_active) == 0:
        positives.append({"factor": "Every active user is licensed", "impact": "+5"})
    if mfa_coverage_pct is not None and mfa_coverage_pct >= 95:
        positives.append({"factor": f"MFA coverage {mfa_coverage_pct}%", "impact": "+5"})
    if len(disabled_licensed) == 0 and len(disabled_users) > 0:
        positives.append({"factor": "Clean offboarding — no license waste", "impact": "+3"})
    if has_mfa_policy:
        positives.append({"factor": "MFA conditional access policy active", "impact": "+5"})

    return {
        "score": score,
        "grade": grade,
        "total_users": total,
        "breakdown": {k: {"earned": e, "max": m} for k, (e, m) in dims.items()},
        "risks": risks,
        "positives": positives,
        "counts": {
            "total_users": total,
            "enabled_users": len(enabled_users),
            "disabled_users": len(disabled_users),
            "unlicensed_active": len(unlicensed_active),
            "disabled_licensed": len(disabled_licensed),
            "stale_users": len(stale_users),
            "global_admins": global_admins,
            "stale_guests": stale_guests,
            "mfa_registered": mfa_registered,
            "mfa_enforced": mfa_enforced,
            "mfa_checked": mfa_checked,
            "mfa_coverage_pct": mfa_coverage_pct,
            "has_mfa_policy": has_mfa_policy,
        },
    }


# ───────────────────────────────────────────────────────────────────────────
# Evidence-first scoring replacement.  The earlier scoring function remains
# above only to preserve review history; this implementation is the active
# function and never awards points for missing CIPP evidence.
def compute_hygiene(data: dict) -> dict:
    weights = {
        "license_efficiency": 20,
        "mfa_coverage": 25,
        "stale_users": 15,
        "license_waste": 15,
        "admin_sprawl": 10,
        "guest_posture": 10,
        "modern_auth": 5,
    }
    labels = {
        "license_efficiency": "License evidence",
        "mfa_coverage": "MFA evidence",
        "stale_users": "Sign-in activity evidence",
        "license_waste": "Disabled-user license evidence",
        "admin_sprawl": "Administrator role evidence",
        "guest_posture": "Guest account evidence",
        "modern_auth": "Conditional Access evidence",
    }
    users = data.get("users") or []
    mfa_rows = data.get("mfa") or []
    conditional = data.get("conditional") or []
    guests = data.get("guests") or []
    supplied_sources = data.get("_sources") or {}
    sources = {
        "users": bool(supplied_sources.get("users", "users" in data)),
        "mfa": bool(supplied_sources.get("mfa", "mfa" in data)),
        "conditional": bool(supplied_sources.get("conditional", "conditional" in data)),
        "guests": bool(supplied_sources.get("guests", "guests" in data)),
    }

    def value_of(item, *keys):
        for key in keys:
            if key in item and item.get(key) is not None:
                return item.get(key)
        return None

    def dimensions_unassessed():
        return {key: {"earned": None, "max": maximum, "status": "not_assessed"} for key, maximum in weights.items()}

    if not sources["users"] or not users:
        reason = "CIPP did not return tenant users" if sources["users"] else "CIPP user inventory is unavailable"
        return {
            "score": None,
            "observed_score": None,
            "grade": None,
            "evidence_coverage_pct": 0,
            "evidence_state": "not_assessed",
            "total_users": len(users),
            "breakdown": dimensions_unassessed(),
            "risks": [{"factor": reason, "severity": "info", "impact": None}],
            "positives": [],
            "counts": {"total_users": len(users), "evidence_sources": sources},
        }

    account_state_available = any(value_of(user, "accountEnabled", "AccountEnabled", "enabled") is not None for user in users)
    license_data_available = any(value_of(user, "assignedLicenses", "AssignedLicenses") is not None for user in users)

    def license_count(user):
        licenses = value_of(user, "assignedLicenses", "AssignedLicenses")
        return len(licenses) if isinstance(licenses, list) else 0

    def last_signin(user):
        activity = value_of(user, "signInActivity", "SignInActivity") or {}
        if isinstance(activity, dict):
            return _parse_dt(activity.get("lastSignInDateTime") or activity.get("LastSignInDateTime"))
        return _parse_dt(value_of(user, "lastSignIn", "LastSignIn"))

    enabled_users = [user for user in users if value_of(user, "accountEnabled", "AccountEnabled", "enabled") is not False] if account_state_available else []
    disabled_users = [user for user in users if value_of(user, "accountEnabled", "AccountEnabled", "enabled") is False] if account_state_available else []
    cutoff = datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)
    signin_observed = sum(1 for user in enabled_users if last_signin(user) is not None)
    stale_users = [user for user in enabled_users if (last_signin(user) and last_signin(user) < cutoff)]

    mfa_by_upn = {}
    for row in mfa_rows:
        upn = row.get("UPN") or row.get("userPrincipalName") or row.get("UserPrincipalName")
        if upn:
            mfa_by_upn[str(upn).lower()] = row
    mfa_registered = 0
    mfa_enforced = 0
    mfa_checked = 0
    for user in enabled_users:
        upn = value_of(user, "userPrincipalName", "UserPrincipalName")
        row = mfa_by_upn.get(str(upn).lower()) if upn else None
        if row is None:
            continue
        mfa_checked += 1
        if row.get("MFARegistration") or row.get("mfaRegistration") or row.get("isMfaRegistered"):
            mfa_registered += 1
        if row.get("MFAEnforced") or row.get("mfaEnforced") or row.get("PerUserMFAState") in ("enforced", "enabled"):
            mfa_enforced += 1
    mfa_coverage_pct = round((mfa_registered / mfa_checked) * 100) if mfa_checked else None

    roles_observed = any(value_of(user, "assignedRoles", "AssignedRoles", "memberOf") is not None for user in users)
    global_admins = 0
    if roles_observed:
        for user in users:
            roles = value_of(user, "assignedRoles", "AssignedRoles", "memberOf") or []
            for role in roles if isinstance(roles, list) else []:
                name = (role.get("displayName") if isinstance(role, dict) else str(role)) or ""
                if "global administrator" in name.lower():
                    global_admins += 1
                    break

    stale_guests = 0
    if sources["guests"]:
        for guest in guests:
            seen = last_signin(guest) or _parse_dt(guest.get("createdDateTime") or guest.get("CreatedDateTime"))
            if seen and seen < cutoff:
                stale_guests += 1
    has_mfa_policy = False
    if sources["conditional"]:
        has_mfa_policy = any("mfa" in str(policy.get("displayName") or policy.get("DisplayName") or "").lower() or "require multi" in str(policy.get("displayName") or policy.get("DisplayName") or "").lower() for policy in conditional)

    dimensions = dimensions_unassessed()
    def assessed(key, earned):
        dimensions[key] = {"earned": max(0, min(round(earned), weights[key])), "max": weights[key], "status": "assessed"}

    if account_state_available and license_data_available:
        unlicensed = [user for user in enabled_users if license_count(user) == 0]
        unlicensed_pct = len(unlicensed) / max(len(enabled_users), 1)
        assessed("license_efficiency", weights["license_efficiency"] * (1 - min(unlicensed_pct * 2, 1)))
        assessed("license_waste", weights["license_waste"] if not [user for user in disabled_users if license_count(user) > 0] else max(0, weights["license_waste"] - len([user for user in disabled_users if license_count(user) > 0]) * 3))
    else:
        unlicensed = []
    if sources["mfa"] and mfa_checked:
        assessed("mfa_coverage", weights["mfa_coverage"] * (mfa_coverage_pct / 100))
    if account_state_available and signin_observed:
        stale_pct = len(stale_users) / max(signin_observed, 1)
        assessed("stale_users", weights["stale_users"] * (1 - min(stale_pct * 1.5, 1)))
    if roles_observed:
        assessed("admin_sprawl", 6 if global_admins == 0 else weights["admin_sprawl"] if global_admins <= 4 else max(0, weights["admin_sprawl"] - (global_admins - 4) * 2))
    if sources["guests"]:
        assessed("guest_posture", weights["guest_posture"] if stale_guests == 0 else max(0, weights["guest_posture"] - stale_guests))
    if sources["conditional"]:
        assessed("modern_auth", weights["modern_auth"] if has_mfa_policy else 0)

    assessed_weight = sum(value["max"] for value in dimensions.values() if value["status"] == "assessed")
    earned = sum(value["earned"] for value in dimensions.values() if value["status"] == "assessed")
    coverage = round((assessed_weight / sum(weights.values())) * 100)
    observed_score = round((earned / assessed_weight) * 100) if assessed_weight else None
    score = observed_score if coverage >= 60 else None
    grade = "A" if score is not None and score >= 90 else "B" if score is not None and score >= 75 else "C" if score is not None and score >= 60 else "D" if score is not None and score >= 40 else "F" if score is not None else None

    risks = []
    if dimensions["license_efficiency"]["status"] == "assessed" and unlicensed:
        risks.append({"factor": f"{len(unlicensed)} active users without a license", "severity": "warning", "impact": -(weights["license_efficiency"] - dimensions["license_efficiency"]["earned"])})
    if dimensions["mfa_coverage"]["status"] == "assessed" and mfa_coverage_pct < 90:
        risks.append({"factor": f"MFA coverage only {mfa_coverage_pct}% ({mfa_registered}/{mfa_checked})", "severity": "critical" if mfa_coverage_pct < 50 else "warning", "impact": -(weights["mfa_coverage"] - dimensions["mfa_coverage"]["earned"])})
    if dimensions["stale_users"]["status"] == "assessed" and stale_users:
        risks.append({"factor": f"{len(stale_users)} users have not signed in for {STALE_DAYS}+ days", "severity": "warning", "impact": -(weights["stale_users"] - dimensions["stale_users"]["earned"])})
    if dimensions["admin_sprawl"]["status"] == "assessed" and global_admins == 0:
        risks.append({"factor": "No global administrator was visible in the provider response", "severity": "critical", "impact": -4})
    elif dimensions["admin_sprawl"]["status"] == "assessed" and global_admins > 4:
        risks.append({"factor": f"{global_admins} global administrators (target <=4)", "severity": "warning", "impact": -(weights["admin_sprawl"] - dimensions["admin_sprawl"]["earned"])})
    if dimensions["modern_auth"]["status"] == "assessed" and not has_mfa_policy:
        risks.append({"factor": "No MFA Conditional Access policy detected in provider evidence", "severity": "critical", "impact": -weights["modern_auth"]})
    for key, value in dimensions.items():
        if value["status"] == "not_assessed":
            risks.append({"factor": f"Evidence gap: {labels[key]} is unavailable", "severity": "info", "impact": None})

    positives = []
    if dimensions["license_efficiency"]["status"] == "assessed" and not unlicensed:
        positives.append({"factor": "Every observed active user is licensed", "impact": "+5"})
    if dimensions["mfa_coverage"]["status"] == "assessed" and mfa_coverage_pct >= 95:
        positives.append({"factor": f"Observed MFA coverage {mfa_coverage_pct}%", "impact": "+5"})
    if dimensions["modern_auth"]["status"] == "assessed" and has_mfa_policy:
        positives.append({"factor": "An MFA Conditional Access policy is visible in provider evidence", "impact": "+5"})

    return {
        "score": score,
        "observed_score": observed_score,
        "grade": grade,
        "evidence_coverage_pct": coverage,
        "evidence_state": "evidence_available" if score is not None else "partial_evidence" if assessed_weight else "not_assessed",
        "total_users": len(users),
        "breakdown": dimensions,
        "risks": risks,
        "positives": positives,
        "counts": {
            "total_users": len(users), "enabled_users": len(enabled_users), "disabled_users": len(disabled_users),
            "unlicensed_active": len(unlicensed), "stale_users": len(stale_users), "global_admins": global_admins,
            "stale_guests": stale_guests, "mfa_registered": mfa_registered, "mfa_enforced": mfa_enforced,
            "mfa_checked": mfa_checked, "mfa_coverage_pct": mfa_coverage_pct, "has_mfa_policy": has_mfa_policy,
            "evidence_sources": sources,
        },
    }


# Endpoints
# ───────────────────────────────────────────────────────────────────────────

async def _hygiene_for_tenant(tenant_id: str, force: bool = False) -> dict:
    now = datetime.now(timezone.utc)
    if not force:
        cached = await db.cipp_hygiene_cache.find_one({"tenant_id": tenant_id}, {"_id": 0})
        if cached and cached.get("schema_version") == HYGIENE_SCHEMA_VERSION and cached.get("computed_at"):
            dt = _parse_dt(cached["computed_at"])
            if dt and (now - dt) < timedelta(minutes=CACHE_TTL_MIN):
                return cached["hygiene"]

    data = await _fetch_tenant_data(tenant_id)
    hygiene = compute_hygiene(data)
    await db.cipp_hygiene_cache.update_one(
        {"tenant_id": tenant_id},
        {"$set": {"tenant_id": tenant_id, "hygiene": hygiene, "computed_at": now.isoformat(), "schema_version": HYGIENE_SCHEMA_VERSION}},
        upsert=True,
    )
    return hygiene


@router.get("/cipp/tenants/{tenant_id}/hygiene")
async def tenant_hygiene(tenant_id: str, force: bool = False, current_user: dict = Depends(get_current_user)):
    cfg = await _get_config()
    if not cfg:
        raise HTTPException(503, "CIPP not configured")
    return await _hygiene_for_tenant(tenant_id, force=force)


@router.get("/clients/{client_id}/cipp-hygiene")
async def client_hygiene(client_id: str, force: bool = False, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1, "cipp_tenant_id": 1, "cipp_tenant_display": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    tenant_id = client.get("cipp_tenant_id")
    if not tenant_id:
        return {"linked": False, "message": "No CIPP tenant linked"}
    cfg = await _get_config()
    if not cfg:
        return {"linked": True, "configured": False, "message": "CIPP not configured"}
    hygiene = await _hygiene_for_tenant(tenant_id, force=force)
    return {"linked": True, "configured": True, "tenant_id": tenant_id, "tenant_display": client.get("cipp_tenant_display"), "hygiene": hygiene}


@router.get("/cipp/hygiene-digest")
async def hygiene_digest(current_user: dict = Depends(get_current_user)):
    """Compute hygiene for every linked client. Cached per-tenant."""
    cfg = await _get_config()
    if not cfg:
        return {"configured": False, "clients": [], "message": "CIPP not configured"}

    linked = await db.clients.find(
        {"cipp_tenant_id": {"$exists": True, "$ne": ""}},
        {"_id": 0, "id": 1, "name": 1, "cipp_tenant_id": 1, "cipp_tenant_display": 1, "cipp_tenant_domain": 1},
    ).to_list(500)

    rows = []
    for c in linked:
        try:
            h = await _hygiene_for_tenant(c["cipp_tenant_id"])
            rows.append({
                "client_id": c["id"],
                "client_name": c["name"],
                "tenant_display": c.get("cipp_tenant_display", ""),
                "tenant_domain": c.get("cipp_tenant_domain", ""),
                "score": h.get("score"),
                "observed_score": h.get("observed_score"),
                "evidence_coverage_pct": h.get("evidence_coverage_pct", 0),
                "evidence_state": h.get("evidence_state", "not_assessed"),
                "grade": h.get("grade"),
                "top_risks": [r["factor"] for r in (h.get("risks") or [])[:3]],
                "counts": h.get("counts", {}),
            })
        except Exception as e:
            rows.append({
                "client_id": c["id"],
                "client_name": c["name"],
                "tenant_display": c.get("cipp_tenant_display", ""),
                "score": None,
                "error": str(e)[:120],
            })

    rows.sort(key=lambda r: (r.get("score") if r.get("score") is not None else -1))

    # Summary + upsell hooks
    scored = [r for r in rows if r.get("score") is not None]
    avg = round(sum(r["score"] for r in scored) / len(scored), 1) if scored else None
    critical = [r for r in scored if r["score"] < 50]
    needs_upsell = [r for r in scored if any("MFA" in f or "unlicensed" in f.lower() or "license waste" in f.lower() for f in r.get("top_risks", []))]

    return {
        "configured": True,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "avg_score": avg,
        "total_tenants": len(rows),
        "critical_count": len(critical),
        "upsell_candidates": needs_upsell[:10],
        "clients": rows,
    }


@router.post("/cipp/hygiene-digest/send")
async def send_hygiene_digest(data: dict = None, current_user: dict = Depends(get_current_user)):
    """Generate digest + email it through the configured Microsoft 365 mailbox."""
    data = data or {}
    digest = await hygiene_digest(current_user)
    if not digest.get("configured"):
        return {"sent": False, "reason": "CIPP not configured"}

    to_list = data.get("to") or []
    if not to_list:
        # Fall back to main admin email
        admin = await db.users.find_one({"role": "admin"}, {"_id": 0, "email": 1})
        if admin and admin.get("email"):
            to_list = [admin["email"]]
    if not to_list:
        return {"sent": False, "reason": "No recipient"}

    # Build HTML digest
    rows_html = ""
    for r in digest["clients"][:30]:
        score = r.get("score")
        color = "#34d399" if score is not None and score >= 75 else "#fbbf24" if score is not None and score >= 50 else "#fb7185"
        score_txt = f"{score}" if score is not None else "—"
        risks = "<br>".join(f"• {x}" for x in r.get("top_risks", [])[:3]) or "<em>no major issues</em>"
        rows_html += f"""
        <tr>
          <td style="padding:10px;border-bottom:1px solid #27272a;">{r['client_name']}<br><span style="color:#71717a;font-size:11px;">{r.get('tenant_display','')}</span></td>
          <td style="padding:10px;border-bottom:1px solid #27272a;text-align:center;"><span style="color:{color};font-size:22px;font-weight:600;">{score_txt}</span><br><span style="color:#71717a;font-size:11px;">grade {r.get('grade','—')}</span></td>
          <td style="padding:10px;border-bottom:1px solid #27272a;font-size:12px;color:#d4d4d8;">{risks}</td>
        </tr>"""

    html = f"""
    <div style="font-family:Inter,system-ui,sans-serif;max-width:680px;margin:0 auto;background:#09090b;color:#fafafa;padding:32px;border-radius:12px;">
      <h1 style="margin:0 0 4px;font-size:22px;">🧹 Weekly M365 Hygiene Digest</h1>
      <p style="color:#a1a1aa;margin:0 0 20px;font-size:13px;">Generated {digest['generated_at'][:19].replace('T',' ')} UTC</p>
      <table cellspacing="0" cellpadding="0" style="width:100%;margin-bottom:20px;">
        <tr>
          <td style="padding:12px;background:#18181b;border-radius:8px;text-align:center;">
            <div style="color:#a1a1aa;font-size:10px;text-transform:uppercase;letter-spacing:1px;">Avg score</div>
            <div style="font-size:28px;font-weight:600;color:#818cf8;margin-top:4px;">{digest['avg_score']}</div>
          </td>
          <td style="width:12px;"></td>
          <td style="padding:12px;background:#18181b;border-radius:8px;text-align:center;">
            <div style="color:#a1a1aa;font-size:10px;text-transform:uppercase;letter-spacing:1px;">Tenants</div>
            <div style="font-size:28px;font-weight:600;color:#34d399;margin-top:4px;">{digest['total_tenants']}</div>
          </td>
          <td style="width:12px;"></td>
          <td style="padding:12px;background:#18181b;border-radius:8px;text-align:center;">
            <div style="color:#a1a1aa;font-size:10px;text-transform:uppercase;letter-spacing:1px;">Critical</div>
            <div style="font-size:28px;font-weight:600;color:#fb7185;margin-top:4px;">{digest['critical_count']}</div>
          </td>
          <td style="width:12px;"></td>
          <td style="padding:12px;background:#18181b;border-radius:8px;text-align:center;">
            <div style="color:#a1a1aa;font-size:10px;text-transform:uppercase;letter-spacing:1px;">Upsell</div>
            <div style="font-size:28px;font-weight:600;color:#fbbf24;margin-top:4px;">{len(digest['upsell_candidates'])}</div>
          </td>
        </tr>
      </table>

      <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#a1a1aa;margin:24px 0 8px;">Tenant scores</h2>
      <table cellspacing="0" cellpadding="0" style="width:100%;background:#18181b;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#27272a;">
            <th style="padding:10px;text-align:left;font-size:10px;text-transform:uppercase;color:#a1a1aa;">Client</th>
            <th style="padding:10px;text-align:center;font-size:10px;text-transform:uppercase;color:#a1a1aa;">Score</th>
            <th style="padding:10px;text-align:left;font-size:10px;text-transform:uppercase;color:#a1a1aa;">Top risks</th>
          </tr>
        </thead>
        <tbody>{rows_html}</tbody>
      </table>

      <p style="color:#71717a;font-size:11px;margin-top:24px;">NexusOps · Scored across 7 dimensions: License efficiency · MFA coverage · Stale users · License waste · Admin sprawl · Guest posture · Modern auth.</p>
    </div>
    """

    sent_via = None
    error = None
    deliveries = []
    try:
        from app.routers.email_utils import send_email, is_microsoft365_configured
        if await is_microsoft365_configured():
            for addr in to_list:
                delivery = await send_email(addr, f"NexusOps · M365 Hygiene Digest · avg {digest['avg_score']}", html, category="notifications")
                deliveries.append({"email": addr, "status": delivery.get("status"), "message": delivery.get("message")})
            if deliveries and all(item["status"] == "sent" for item in deliveries):
                sent_via = "microsoft_365"
            elif deliveries:
                error = "; ".join(item["message"] or f"{item['email']}: delivery failed" for item in deliveries if item["status"] != "sent")
        else:
            error = "Microsoft 365 mailbox is not connected"
    except Exception as e:
        error = str(e)[:120]

    await db.cipp_digests.insert_one({
        "generated_at": digest["generated_at"],
        "avg_score": digest["avg_score"],
        "total_tenants": digest["total_tenants"],
        "critical_count": digest["critical_count"],
        "to": to_list,
        "sent_via": sent_via,
        "error": error,
        "deliveries": deliveries,
        "by": current_user.get("name"),
    })

    return {"sent": bool(sent_via), "sent_via": sent_via, "to": to_list, "deliveries": deliveries, "error": error, "avg_score": digest["avg_score"], "preview_html": html if not sent_via else None}


@router.get("/cipp/digests")
async def list_digests(current_user: dict = Depends(get_current_user)):
    rows = await db.cipp_digests.find({}, {"_id": 0}).sort("generated_at", -1).to_list(20)
    return rows
