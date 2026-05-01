"""Growth / Revenue Opportunity Scanner.

Walks every client's environment to surface concrete upsell/refresh opportunities
with estimated $ value, ranked by priority and confidence.

Detectors (v1):
  1. EOL Windows devices        → hardware refresh
  2. Missing/weak M365 hygiene   → managed MFA / MDR upsell
  3. Security posture gap        → EDR upsell
  4. Backup reliability gap      → managed backup upsell
  5. Expiring contracts          → renewal / upgrade
  6. Contract over-utilisation   → hour-pack upsell

Opportunities are stored in db.growth_opportunities with status lifecycle:
  new → quoted → won | lost | dismissed
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
import uuid
import os
from app.database import db
from app.auth import get_current_user

router = APIRouter()


# ─────────────────────────── Price book (configurable) ───────────────────────────
# These are defaults; in the future could be stored in db.settings.type='growth_pricebook'.
PRICE = {
    "hardware_refresh": 2000,      # per device
    "mdr_per_user": 18,            # monthly recurring
    "edr_per_device": 8,           # monthly recurring
    "managed_backup_per_device": 15,  # monthly recurring
    "hour_pack_monthly": 150,      # per extra hour
}

EOL_OS_PATTERNS = [
    ("Windows 7", "Windows 7 · EOL Jan 2020"),
    ("Windows 8", "Windows 8/8.1 · EOL Jan 2023"),
    ("Windows 10", "Windows 10 · EOL Oct 2025"),
    ("Server 2012", "Server 2012/R2 · EOL Oct 2023"),
    ("Server 2008", "Server 2008/R2 · EOL Jan 2020"),
]


def _priority(monthly_value: float, one_time_value: float, confidence: float) -> int:
    """Score 0-100. Higher monthly values with high confidence score highest."""
    annual = (monthly_value * 12) + one_time_value
    base = min(100, int(annual / 500))  # $50k annual → 100
    return min(100, int(base * confidence))


async def _get_client_snapshot(client: dict) -> dict:
    """Pre-compute everything the detectors need so we query Mongo once per client."""
    cid = client["id"]
    devices = await db.devices.find({"client_id": cid}, {"_id": 0}).to_list(1000)
    contracts = await db.contracts.find({"client_id": cid}, {"_id": 0}).to_list(100)
    # Backup health
    backup_failures = await db.backup_jobs.count_documents({
        "client_id": cid,
        "status": {"$in": ["failed", "error"]},
    })
    backup_total = await db.backup_jobs.count_documents({"client_id": cid})
    # CIPP hygiene cache
    m365_hygiene = None
    if client.get("cipp_tenant_id"):
        h = await db.cipp_hygiene_cache.find_one({"tenant_id": client["cipp_tenant_id"]}, {"_id": 0})
        if h and h.get("hygiene"):
            m365_hygiene = h["hygiene"]
    # Security alerts
    security_alerts = await db.security_alerts.count_documents({"client_id": cid, "resolved": {"$ne": True}})
    return {
        "client": client,
        "devices": devices,
        "contracts": contracts,
        "backup_failures": backup_failures,
        "backup_total": backup_total,
        "m365_hygiene": m365_hygiene,
        "security_alerts": security_alerts,
    }


def _detect(snapshot: dict) -> list:
    """Run all detectors against a client snapshot. Returns list of opportunity dicts."""
    c = snapshot["client"]
    cid = c["id"]
    cname = c.get("name", "Unknown")
    out = []

    # 1. EOL Windows devices → hardware refresh
    eol_matches = []
    for dev in snapshot["devices"]:
        os_name = (dev.get("os") or dev.get("operating_system") or "")
        for pattern, description in EOL_OS_PATTERNS:
            if pattern in os_name:
                eol_matches.append({"device_id": dev["id"], "hostname": dev.get("name") or dev.get("hostname"), "os": os_name, "eol_reason": description})
                break
    if eol_matches:
        monthly = 0
        one_time = len(eol_matches) * PRICE["hardware_refresh"]
        out.append({
            "type": "hardware_refresh",
            "title": f"Hardware refresh · {len(eol_matches)} EOL device(s)",
            "category": "Hardware",
            "severity": "high" if len(eol_matches) >= 5 else "medium",
            "summary": f"{len(eol_matches)} endpoints running unsupported Windows versions — refresh opportunity ~${one_time:,}.",
            "evidence": eol_matches[:20],
            "monthly_value": monthly,
            "one_time_value": one_time,
            "confidence": 0.9,
            "suggested_action": "Quote refresh + migration; pair with MDM enrollment for managed lifecycle.",
        })

    # 2. M365 hygiene gap → managed MFA / MDR upsell
    if snapshot["m365_hygiene"] is not None:
        h = snapshot["m365_hygiene"]
        score = h.get("score", 100)
        if score < 70:
            # Estimate user count from hygiene risks that reference user counts, or fall back to 25
            user_count = h.get("user_count") or 25
            monthly = user_count * PRICE["mdr_per_user"]
            out.append({
                "type": "managed_mfa_mdr",
                "title": f"Managed MFA / MDR · M365 hygiene {score}",
                "category": "Security",
                "severity": "high" if score < 50 else "medium",
                "summary": f"M365 hygiene score {score}/100. {len(h.get('risks', []))} active risks. MDR/MFA upsell ~${monthly:,}/mo for {user_count} users.",
                "evidence": [{"risk": r.get("factor"), "severity": r.get("severity")} for r in (h.get("risks") or [])[:8]],
                "monthly_value": monthly,
                "one_time_value": 0,
                "confidence": 0.85,
                "suggested_action": "Propose Managed MFA tier with breach-attempt monitoring. Lead with the specific risk list.",
            })

    # 3. Security posture gap → EDR upsell (if no existing EDR flag on client)
    if snapshot["security_alerts"] >= 3 and not c.get("has_edr"):
        endpoints = len([d for d in snapshot["devices"] if d.get("type") in (None, "workstation", "laptop", "server")]) or 15
        monthly = endpoints * PRICE["edr_per_device"]
        out.append({
            "type": "edr_upsell",
            "title": f"Managed EDR · {snapshot['security_alerts']} active alerts",
            "category": "Security",
            "severity": "high" if snapshot["security_alerts"] >= 10 else "medium",
            "summary": f"{snapshot['security_alerts']} unresolved security alerts with no managed EDR. Estimated ${monthly:,}/mo for {endpoints} endpoints.",
            "evidence": [{"alerts": snapshot["security_alerts"], "endpoints": endpoints}],
            "monthly_value": monthly,
            "one_time_value": 0,
            "confidence": 0.75,
            "suggested_action": "Attach Huntress or CrowdStrike Complete. Lead with dwell-time metrics from recent alerts.",
        })

    # 4. Backup reliability → managed backup upsell
    if snapshot["backup_total"] >= 5:
        fail_rate = snapshot["backup_failures"] / snapshot["backup_total"]
        if fail_rate > 0.1:
            endpoints_needing = max(3, len(snapshot["devices"]) // 4)
            monthly = endpoints_needing * PRICE["managed_backup_per_device"]
            out.append({
                "type": "managed_backup",
                "title": f"Managed Backup upgrade · {int(fail_rate*100)}% failure rate",
                "category": "Data Protection",
                "severity": "high" if fail_rate > 0.25 else "medium",
                "summary": f"{snapshot['backup_failures']}/{snapshot['backup_total']} jobs failing ({int(fail_rate*100)}%). Immutable backup tier ~${monthly:,}/mo.",
                "evidence": [{"fail_rate": fail_rate, "failed": snapshot["backup_failures"], "total": snapshot["backup_total"]}],
                "monthly_value": monthly,
                "one_time_value": 0,
                "confidence": 0.9,
                "suggested_action": "Upsell to immutable-backup tier (Veeam/Acronis Cyber Protect). Lead with the exact failure count from the last 30 days.",
            })

    # 5. Expiring contracts → renewal / upgrade
    now = datetime.now(timezone.utc)
    for contract in snapshot["contracts"]:
        end = contract.get("end_date") or contract.get("renewal_date")
        if not end:
            continue
        try:
            end_dt = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
            if end_dt.tzinfo is None:
                end_dt = end_dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        days = (end_dt - now).days
        if 0 < days <= 90:
            mrr = contract.get("monthly_value") or contract.get("mrr") or 0
            uplift = int(mrr * 0.15)  # suggest 15% uplift at renewal
            out.append({
                "type": "contract_renewal",
                "title": f"Contract renewal · expires in {days} days",
                "category": "Contracts",
                "severity": "high" if days <= 30 else "medium",
                "summary": f"{contract.get('name') or 'Managed Services Agreement'} ends {end_dt.date()}. Suggested renewal with 15% uplift = ${mrr + uplift:,}/mo (current ${mrr:,}).",
                "evidence": [{"contract_id": contract.get("id"), "name": contract.get("name"), "current_mrr": mrr, "end_date": str(end_dt.date())}],
                "monthly_value": uplift,
                "one_time_value": 0,
                "confidence": 0.95 if days <= 30 else 0.7,
                "suggested_action": "Open renewal conversation. Build in scope creep from last 12 months of tickets as justification for uplift.",
            })

    # 6. Contract over-utilisation → hour-pack upsell
    for contract in snapshot["contracts"]:
        hours_contracted = contract.get("monthly_hours") or contract.get("included_hours")
        hours_used = contract.get("hours_used_last_month")
        if hours_contracted and hours_used and hours_used > hours_contracted * 1.1:
            extra = hours_used - hours_contracted
            monthly = int(extra * PRICE["hour_pack_monthly"])
            out.append({
                "type": "hour_pack_upsell",
                "title": f"Hour pack upsell · {extra:.1f}h/mo over cap",
                "category": "Contracts",
                "severity": "medium",
                "summary": f"{contract.get('name')} ran {hours_used}h vs {hours_contracted}h contracted. Bill-by-hour or upsell hour pack = ~${monthly:,}/mo.",
                "evidence": [{"contract_id": contract.get("id"), "used": hours_used, "contracted": hours_contracted, "over": extra}],
                "monthly_value": monthly,
                "one_time_value": 0,
                "confidence": 0.8,
                "suggested_action": "Offer a larger hour pack or shift to block-hours model. Show them the variance chart.",
            })

    # Stamp every opportunity with client + priority
    stamped = []
    for o in out:
        o["id"] = f"opp-{uuid.uuid4().hex[:12]}"
        o["client_id"] = cid
        o["client_name"] = cname
        o["priority"] = _priority(o["monthly_value"], o["one_time_value"], o["confidence"])
        o["annual_value"] = int(o["monthly_value"] * 12 + o["one_time_value"])
        o["status"] = "new"
        o["detected_at"] = datetime.now(timezone.utc).isoformat()
        stamped.append(o)
    return stamped


@router.post("/growth/scan")
async def scan(data: dict = None, current_user: dict = Depends(get_current_user)):
    """Run the scanner. Body: {client_id?: str} — if omitted, scans all clients.

    Strategy: delete existing opportunities with status='new' for the target(s)
    (keeps human-curated statuses like quoted/won/lost/dismissed intact), then
    insert fresh detections.
    """
    body = data or {}
    cid_filter = body.get("client_id")
    q = {"id": cid_filter} if cid_filter else {}
    clients = await db.clients.find(q, {"_id": 0}).to_list(500)
    if not clients:
        raise HTTPException(404, "No clients matched")

    # Wipe stale 'new' opps only
    wipe_q = {"status": "new"}
    if cid_filter:
        wipe_q["client_id"] = cid_filter
    wiped = (await db.growth_opportunities.delete_many(wipe_q)).deleted_count

    total_opps = 0
    total_value = 0
    per_client = []
    for c in clients:
        snap = await _get_client_snapshot(c)
        opps = _detect(snap)
        if opps:
            await db.growth_opportunities.insert_many([{**o} for o in opps])
        client_value = sum(o["annual_value"] for o in opps)
        total_opps += len(opps)
        total_value += client_value
        per_client.append({"client_id": c["id"], "client_name": c.get("name"), "count": len(opps), "annual_value": client_value})

    now = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one(
        {"type": "growth_scan_meta"},
        {"$set": {"type": "growth_scan_meta", "last_scan_at": now, "last_total_opps": total_opps, "last_total_value": total_value, "last_scan_by": current_user.get("name")}},
        upsert=True,
    )
    return {
        "success": True,
        "clients_scanned": len(clients),
        "opportunities_created": total_opps,
        "stale_wiped": wiped,
        "pipeline_value": total_value,
        "per_client": sorted(per_client, key=lambda x: -x["annual_value"])[:20],
        "scanned_at": now,
    }


@router.get("/growth/opportunities")
async def list_opportunities(status: str = "new,quoted", client_id: str = None, category: str = None, limit: int = 500, current_user: dict = Depends(get_current_user)):
    statuses = [s.strip() for s in status.split(",") if s.strip()] if status else []
    q = {}
    if statuses:
        q["status"] = {"$in": statuses}
    if client_id:
        q["client_id"] = client_id
    if category:
        q["category"] = category
    cursor = db.growth_opportunities.find(q, {"_id": 0}).sort("priority", -1).limit(limit)
    return await cursor.to_list(limit)


@router.get("/growth/summary")
async def growth_summary(current_user: dict = Depends(get_current_user)):
    """High-level dashboard numbers."""
    all_opps = await db.growth_opportunities.find({}, {"_id": 0}).to_list(5000)
    by_status = {}
    by_category = {}
    pipeline = 0
    won_value = 0
    for o in all_opps:
        s = o.get("status") or "new"
        by_status[s] = by_status.get(s, 0) + 1
        cat = o.get("category", "Other")
        by_category[cat] = by_category.get(cat, 0) + o.get("annual_value", 0)
        if s in ("new", "quoted"):
            pipeline += o.get("annual_value", 0)
        if s == "won":
            won_value += o.get("annual_value", 0)
    meta = await db.settings.find_one({"type": "growth_scan_meta"}, {"_id": 0}) or {}
    # Top 10 opps by priority from active pipeline
    top = sorted(
        [o for o in all_opps if o.get("status") in ("new", "quoted")],
        key=lambda x: -x.get("priority", 0),
    )[:10]
    # Top clients by pipeline
    by_client = {}
    for o in all_opps:
        if o.get("status") not in ("new", "quoted"):
            continue
        k = (o.get("client_id"), o.get("client_name"))
        by_client[k] = by_client.get(k, 0) + o.get("annual_value", 0)
    top_clients = sorted(
        [{"client_id": k[0], "client_name": k[1], "value": v} for k, v in by_client.items()],
        key=lambda x: -x["value"],
    )[:10]
    return {
        "total_opps": len(all_opps),
        "by_status": by_status,
        "by_category": by_category,
        "pipeline_value": pipeline,
        "won_value": won_value,
        "top_opportunities": top,
        "top_clients": top_clients,
        "last_scan_at": meta.get("last_scan_at"),
        "last_scan_by": meta.get("last_scan_by"),
    }


@router.patch("/growth/opportunities/{opp_id}")
async def update_opportunity(opp_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update status (new/quoted/won/lost/dismissed), notes, or quoted_value."""
    allowed_status = {"new", "quoted", "won", "lost", "dismissed"}
    patch = {}
    if "status" in data:
        s = data["status"]
        if s not in allowed_status:
            raise HTTPException(400, f"status must be in {allowed_status}")
        patch["status"] = s
        patch[f"{s}_at"] = datetime.now(timezone.utc).isoformat()
        patch[f"{s}_by"] = current_user.get("name")
    if "notes" in data:
        patch["notes"] = str(data["notes"])[:4000]
    if "quoted_value" in data:
        try:
            patch["quoted_value"] = float(data["quoted_value"])
        except Exception:
            pass
    if not patch:
        raise HTTPException(400, "No valid fields to update")
    res = await db.growth_opportunities.update_one({"id": opp_id}, {"$set": patch})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    doc = await db.growth_opportunities.find_one({"id": opp_id}, {"_id": 0})
    return {"success": True, "opportunity": doc}


@router.post("/growth/opportunities/{opp_id}/pitch")
async def generate_pitch(opp_id: str, current_user: dict = Depends(get_current_user)):
    """Use Emergent LLM key to generate a tailored email pitch paragraph for this opportunity."""
    opp = await db.growth_opportunities.find_one({"id": opp_id}, {"_id": 0})
    if not opp:
        raise HTTPException(404, "Opportunity not found")

    # Best-effort client context
    client = await db.clients.find_one({"id": opp["client_id"]}, {"_id": 0}) or {}
    primary_contact = client.get("primary_contact") or client.get("contact_name") or "team"

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        return {"success": False, "pitch": None, "message": "EMERGENT_LLM_KEY not configured"}

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        system = (
            "You are a senior MSP account manager writing a warm, concise, outcome-focused upsell email "
            "(3-5 sentences, no fluff). Open with the client's name, cite the specific evidence, quantify the "
            "impact or risk in plain English, then present the solution and next step. Avoid hype words. "
            "Sign-off not needed — we'll add it."
        )
        prompt = (
            f"Client: {opp['client_name']} (primary contact: {primary_contact}).\n"
            f"Opportunity type: {opp['type']} — {opp['title']}\n"
            f"Summary: {opp['summary']}\n"
            f"Evidence: {opp.get('evidence')}\n"
            f"Monthly value: ${opp.get('monthly_value', 0):,} · One-time: ${opp.get('one_time_value', 0):,}\n"
            f"Suggested action: {opp.get('suggested_action', '')}\n\n"
            f"Write the email body only (no subject, no sign-off)."
        )
        chat = LlmChat(api_key=api_key, session_id=f"pitch-{opp_id}", system_message=system)
        chat.with_model("anthropic", "claude-sonnet-4-5-20250929")
        pitch = await chat.send_message(UserMessage(text=prompt))
        pitch_text = pitch.strip() if isinstance(pitch, str) else str(pitch)
    except Exception as e:
        return {"success": False, "pitch": None, "message": f"AI error: {str(e)[:200]}"}

    await db.growth_opportunities.update_one({"id": opp_id}, {"$set": {"pitch": pitch_text, "pitch_generated_at": datetime.now(timezone.utc).isoformat()}})
    return {"success": True, "pitch": pitch_text}
