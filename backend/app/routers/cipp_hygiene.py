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
            return await coro
        except Exception:
            return None

    users, mfa, conditional, guests = await asyncio.gather(
        safe(_cipp_call("GET", "ListUsers", params={"TenantFilter": tenant_id})),
        safe(_cipp_call("GET", "ListMFAUsers", params={"TenantFilter": tenant_id})),
        safe(_cipp_call("GET", "ListConditionalAccessPolicies", params={"TenantFilter": tenant_id})),
        safe(_cipp_call("GET", "ListGuests", params={"TenantFilter": tenant_id})),
    )

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
    }


def compute_hygiene(data: dict) -> dict:
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
# Endpoints
# ───────────────────────────────────────────────────────────────────────────

async def _hygiene_for_tenant(tenant_id: str, force: bool = False) -> dict:
    now = datetime.now(timezone.utc)
    if not force:
        cached = await db.cipp_hygiene_cache.find_one({"tenant_id": tenant_id}, {"_id": 0})
        if cached and cached.get("computed_at"):
            dt = _parse_dt(cached["computed_at"])
            if dt and (now - dt) < timedelta(minutes=CACHE_TTL_MIN):
                return cached["hygiene"]

    data = await _fetch_tenant_data(tenant_id)
    hygiene = compute_hygiene(data)
    await db.cipp_hygiene_cache.update_one(
        {"tenant_id": tenant_id},
        {"$set": {"tenant_id": tenant_id, "hygiene": hygiene, "computed_at": now.isoformat()}},
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
                "score": h.get("score", 0),
                "grade": h.get("grade", "F"),
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
    avg = round(sum(r["score"] for r in scored) / len(scored), 1) if scored else 0
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
    """Generate digest + email it via Resend (if configured). body: { to?: ['a@b.com'] }"""
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
    try:
        from app.routers.email_utils import send_email, is_resend_configured
        if await is_resend_configured():
            for addr in to_list:
                await send_email(to=addr, subject=f"NexusOps · M365 Hygiene Digest · avg {digest['avg_score']}", html=html)
            sent_via = "resend"
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
        "by": current_user.get("name"),
    })

    return {"sent": bool(sent_via), "sent_via": sent_via, "to": to_list, "error": error, "avg_score": digest["avg_score"], "preview_html": html if not sent_via else None}


@router.get("/cipp/digests")
async def list_digests(current_user: dict = Depends(get_current_user)):
    rows = await db.cipp_digests.find({}, {"_id": 0}).sort("generated_at", -1).to_list(20)
    return rows
