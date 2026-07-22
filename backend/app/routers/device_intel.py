"""
Device Intelligence — outclasses Syncro/Ninja/Halo with a unified
dossier, smart inbox, compare, and bulk-action engine.
"""
from fastapi import APIRouter, Depends, HTTPException, Body, Query
from datetime import datetime, timezone, timedelta
from typing import List, Optional
import asyncio
import base64
import logging
import os

from app.database import db
from app.routers.auth import get_current_user
from app.services.activity import log_activity

router = APIRouter()
logger = logging.getLogger("device_intel")


def _iso(dt):
    if isinstance(dt, datetime):
        return dt.isoformat()
    return dt


# ─────────────────────── Smart Inbox ───────────────────────
@router.get("/devices/smart-inbox")
async def smart_inbox(current_user: dict = Depends(get_current_user)):
    """What needs attention right now across the device fleet."""
    items = []
    now = datetime.now(timezone.utc)

    # Failing checks (mocked from device.checks_failing or alerts)
    cursor = db.devices.find(
        {"$or": [{"checks_failing": {"$gt": 0}}, {"alerts": {"$exists": True, "$ne": []}}]},
        {"_id": 0, "id": 1, "name": 1, "hostname": 1, "client_id": 1, "client_name": 1, "checks_failing": 1, "alerts": 1, "status": 1},
    )
    async for d in cursor:
        n = d.get("checks_failing") or len(d.get("alerts") or [])
        if n > 0:
            items.append({
                "kind": "failing_checks",
                "device_id": d["id"],
                "device_name": d.get("name") or d.get("hostname"),
                "client_name": d.get("client_name"),
                "severity": "critical" if n >= 3 else "warning",
                "title": f"{n} check{'s' if n != 1 else ''} failing",
                "subtitle": d.get("client_name") or "",
            })

    # Offline 24h+
    cutoff = (now - timedelta(hours=24)).isoformat()
    cursor = db.devices.find(
        {"status": "offline", "last_seen": {"$lt": cutoff}},
        {"_id": 0, "id": 1, "name": 1, "hostname": 1, "client_name": 1, "last_seen": 1},
    )
    async for d in cursor:
        items.append({
            "kind": "offline_long",
            "device_id": d["id"],
            "device_name": d.get("name") or d.get("hostname"),
            "client_name": d.get("client_name"),
            "severity": "warning",
            "title": "Offline > 24h",
            "subtitle": f"last seen {d.get('last_seen', '?')[:10]}",
        })

    # Disk-at-risk (>90%)
    cursor = db.devices.find(
        {"disk_pct": {"$gte": 90}},
        {"_id": 0, "id": 1, "name": 1, "hostname": 1, "client_name": 1, "disk_pct": 1},
    )
    async for d in cursor:
        items.append({
            "kind": "disk_low",
            "device_id": d["id"],
            "device_name": d.get("name") or d.get("hostname"),
            "client_name": d.get("client_name"),
            "severity": "critical",
            "title": f"Disk {int(d['disk_pct'])}% — at risk",
            "subtitle": "free space critical",
        })

    # Patches pending (>10)
    cursor = db.devices.find(
        {"patches_pending": {"$gte": 10}},
        {"_id": 0, "id": 1, "name": 1, "hostname": 1, "client_name": 1, "patches_pending": 1},
    )
    async for d in cursor:
        items.append({
            "kind": "patches_pending",
            "device_id": d["id"],
            "device_name": d.get("name") or d.get("hostname"),
            "client_name": d.get("client_name"),
            "severity": "warning",
            "title": f"{d['patches_pending']} patches pending",
            "subtitle": "Windows updates queue",
        })

    # Sort: critical first, newest second
    sev_rank = {"critical": 0, "warning": 1, "info": 2}
    items.sort(key=lambda x: sev_rank.get(x["severity"], 3))
    return {"items": items[:50], "total": len(items), "generated_at": now.isoformat()}


# ─────────────────────── Stat tiles ───────────────────────
@router.get("/devices/intel/stats")
async def device_intel_stats(current_user: dict = Depends(get_current_user)):
    """Aggregated stats for the Command Center HeroTile strip."""
    total = await db.devices.count_documents({})
    online = await db.devices.count_documents({"status": "online"})
    offline = await db.devices.count_documents({"status": "offline"})
    warning = await db.devices.count_documents({
        "$or": [
            {"cpu_load": {"$gte": 90}},
            {"memory_pct": {"$gte": 90}},
            {"disk_pct": {"$gte": 90}},
            {"checks_failing": {"$gt": 0}},
        ]
    })
    patches = 0
    cursor = db.devices.find({}, {"_id": 0, "patches_pending": 1})
    async for d in cursor:
        patches += int(d.get("patches_pending") or 0)
    disk_at_risk = await db.devices.count_documents({"disk_pct": {"$gte": 90}})
    # Asset value — sum of `purchase_price` if present (fallback heuristic)
    pipeline = [{"$group": {"_id": None, "v": {"$sum": "$purchase_price"}}}]
    val = 0
    try:
        async for r in db.devices.aggregate(pipeline):
            val = int(r.get("v") or 0)
    except Exception:
        pass

    # MTTR (last 30d, on tickets that closed)
    thirty = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    closed = await db.tickets.find(
        {"closed_at": {"$gte": thirty}},
        {"_id": 0, "created_at": 1, "closed_at": 1},
    ).to_list(500)
    deltas = []
    for t in closed:
        try:
            ca = t.get("created_at"); cl = t.get("closed_at")
            if ca and cl:
                a = datetime.fromisoformat(ca.replace("Z", "+00:00")) if isinstance(ca, str) else ca
                b = datetime.fromisoformat(cl.replace("Z", "+00:00")) if isinstance(cl, str) else cl
                deltas.append((b - a).total_seconds() / 60)
        except Exception:
            pass
    mttr = round(sum(deltas) / len(deltas)) if deltas else None

    return {
        "total": total,
        "online": online,
        "offline": offline,
        "warning": warning,
        "patches_pending": patches,
        "disk_at_risk": disk_at_risk,
        "asset_value_cents": val,
        "mttr_30d_minutes": mttr,
    }


# ─────────────────────── Device Dossier (per device) ───────────────────────
def _health_score(d: dict) -> tuple[int, str]:
    """Compute a 0-100 health score with one-line tactical commentary."""
    score = 100
    reasons = []
    if d.get("status") == "offline":
        score -= 40; reasons.append("offline")
    cpu = d.get("cpu_usage") or d.get("cpu_load") or 0
    if cpu >= 90: score -= 15; reasons.append(f"CPU {int(cpu)}%")
    elif cpu >= 75: score -= 5
    mem = d.get("memory_usage") or d.get("memory_pct") or 0
    if mem >= 90: score -= 15; reasons.append(f"RAM {int(mem)}%")
    elif mem >= 75: score -= 5
    disk = d.get("disk_usage") or d.get("disk_pct") or 0
    if disk >= 95: score -= 25; reasons.append(f"disk {int(disk)}% — critical")
    elif disk >= 90: score -= 15; reasons.append(f"disk {int(disk)}%")
    elif disk >= 80: score -= 5
    cf = d.get("checks_failing") or 0
    if cf > 0: score -= min(20, cf * 5); reasons.append(f"{cf} failing checks")
    pp = d.get("pending_patches") or d.get("patches_pending") or 0
    if pp >= 30: score -= 10; reasons.append(f"{pp} patches behind")
    elif pp >= 10: score -= 5
    score = max(0, min(100, score))

    if score >= 85:
        commentary = "Healthy — nominal across all signals."
    elif score >= 65:
        commentary = "Acceptable — minor pressure points: " + ", ".join(reasons[:2])
    elif score >= 40:
        commentary = "Degraded — needs attention: " + ", ".join(reasons[:3])
    else:
        commentary = "CRITICAL — multiple failures: " + ", ".join(reasons[:4])
    return score, commentary


def _lifecycle_band(d: dict) -> dict:
    """Estimate lifecycle phase from purchase_date / age."""
    purchased = d.get("purchase_date") or d.get("install_date")
    age_years = None
    if purchased:
        try:
            pd_dt = datetime.fromisoformat(purchased.replace("Z", "+00:00")) if isinstance(purchased, str) else purchased
            age_years = (datetime.now(timezone.utc) - pd_dt).days / 365.25
        except Exception:
            pass
    if age_years is None:
        return {"band": "unknown", "label": "Unknown", "tone": "zinc", "age_years": None, "renewal_due": False}
    if age_years < 1:
        return {"band": "new", "label": "Brand new", "tone": "emerald", "age_years": round(age_years, 1), "renewal_due": False}
    if age_years < 3:
        return {"band": "healthy", "label": "Healthy", "tone": "cyan", "age_years": round(age_years, 1), "renewal_due": False}
    if age_years < 5:
        return {"band": "aging", "label": "Aging", "tone": "amber", "age_years": round(age_years, 1), "renewal_due": False}
    return {"band": "eol", "label": "EOL · Replace", "tone": "rose", "age_years": round(age_years, 1), "renewal_due": True}


def _failure_risk(d: dict) -> dict:
    """Predict failure risk from SMART, age, error counters, disk pressure."""
    risk = 0
    factors = []
    age = _lifecycle_band(d).get("age_years") or 0
    if age >= 5: risk += 30; factors.append(f"age {age:.1f}y")
    elif age >= 3: risk += 15
    smart = d.get("smart_status")
    if smart and str(smart).lower() not in ("ok", "passed", "healthy"):
        risk += 35; factors.append(f"SMART: {smart}")
    if (d.get("disk_usage") or d.get("disk_pct") or 0) >= 95:
        risk += 20; factors.append("disk critical")
    if (d.get("memory_errors") or 0) > 0:
        risk += 15; factors.append("memory errors detected")
    if (d.get("bsod_count_30d") or 0) >= 3:
        risk += 20; factors.append(f"{d['bsod_count_30d']} BSODs in 30d")
    risk = min(100, risk)
    if risk >= 70:
        verdict = "high"
    elif risk >= 40:
        verdict = "moderate"
    elif risk > 0:
        verdict = "low"
    else:
        verdict = "minimal"
    return {"risk_pct": risk, "verdict": verdict, "factors": factors}


@router.get("/devices/{device_id}/dossier")
async def device_dossier(device_id: str, current_user: dict = Depends(get_current_user)):
    """Full intelligence dossier for a single device."""
    d = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Device not found")
    score, commentary = _health_score(d)
    lifecycle = _lifecycle_band(d)
    risk = _failure_risk(d)

    # Recent open tickets
    tickets = await db.tickets.find(
        {"$or": [{"device_id": device_id}, {"device_ids": device_id}], "status": {"$in": ["open", "in_progress", "pending"]}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "priority": 1, "status": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(15)

    # Build "What changed today" timeline (last 24h)
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    timeline = []
    # Device audit and agent activity. These are the operational source of truth
    # for a device; ticket audit logs do not reliably reference an endpoint.
    try:
        audit = await db.activity_logs.find(
            {"entity_type": "device", "entity_id": device_id, "created_at": {"$gte": since}},
            {"_id": 0, "action": 1, "details": 1, "created_at": 1, "user_name": 1},
        ).sort("created_at", -1).to_list(40)
        for a in audit:
            timeline.append({
                "ts": a.get("created_at"),
                "kind": a.get("action") or "event",
                "title": a.get("details") or a.get("action"),
                "by": a.get("user_name"),
            })
    except Exception:
        pass

    # Agent events provide check-ins, command results, patch installs, and alerts.
    try:
        events = await db.device_events.find(
            {"device_id": device_id, "timestamp": {"$gte": since}},
            {"_id": 0, "event_type": 1, "message": 1, "timestamp": 1, "source": 1},
        ).sort("timestamp", -1).to_list(40)
        for event in events:
            timeline.append({
                "ts": event.get("timestamp"),
                "kind": event.get("event_type") or "agent_event",
                "title": event.get("message") or (event.get("event_type") or "Device event").replace("_", " ").title(),
                "by": event.get("source") or "NexusOps Agent",
            })
    except Exception:
        pass

    # Surface the latest inventory and update evidence even when there was no
    # configuration change. This tells a technician exactly how fresh the data is.
    try:
        software = await db.device_software.find({"device_id": device_id}, {"_id": 0, "last_inventory_at": 1}).to_list(5000)
        inventory_at = max((row.get("last_inventory_at") for row in software if row.get("last_inventory_at")), default=None)
        if inventory_at and inventory_at >= since:
            timeline.append({"ts": inventory_at, "kind": "inventory", "title": f"Software inventory refreshed - {len(software)} applications recorded", "by": "NexusOps Agent"})
        patches = await db.device_patches.find(
            {"device_id": device_id, "detected_at": {"$gte": since}}, {"_id": 0, "status": 1, "detected_at": 1}
        ).to_list(500)
        pending = sum(1 for patch in patches if patch.get("status") in {"pending", "approved"})
        if pending:
            patch_ts = max((patch.get("detected_at") for patch in patches if patch.get("detected_at")), default=None)
            timeline.append({"ts": patch_ts, "kind": "patches", "title": f"{pending} Windows update{'s' if pending != 1 else ''} detected for review", "by": "Windows Update"})
    except Exception:
        pass

    # Compare the newest and oldest collected readings in the period. CPU is
    # intentionally omitted because it is transient; memory and disk changes are
    # durable and useful to a technician.
    history = []
    try:
        history = await db.device_performance.find(
            {"device_id": device_id, "timestamp": {"$gte": since}},
            {"_id": 0, "timestamp": 1, "cpu": 1, "memory": 1, "disk": 1, "cpu_usage": 1, "memory_usage": 1, "disk_usage": 1},
        ).sort("timestamp", 1).to_list(500)
        if len(history) >= 2:
            first, latest = history[0], history[-1]
            for label, keys in (("Memory usage", ("memory_usage", "memory")), ("Disk usage", ("disk_usage", "disk"))):
                before = next((first.get(key) for key in keys if first.get(key) is not None), None)
                after = next((latest.get(key) for key in keys if latest.get(key) is not None), None)
                if isinstance(before, (int, float)) and isinstance(after, (int, float)) and abs(after - before) >= 3:
                    direction = "increased" if after > before else "decreased"
                    timeline.append({"ts": latest.get("timestamp"), "kind": "telemetry", "title": f"{label} {direction} from {before:.0f}% to {after:.0f}%", "by": "NexusOps Agent"})
    except Exception:
        pass

    timeline.sort(key=lambda item: item.get("ts") or "", reverse=True)

    return {
        "device": d,
        "health_score": score,
        "commentary": commentary,
        "lifecycle": lifecycle,
        "failure_risk": risk,
        "open_tickets": tickets,
        "change_timeline": timeline[:50],
        "telemetry_24h": history,
    }


# ─────────────────────── Compare 2-4 devices ───────────────────────
@router.post("/devices/compare")
async def compare_devices(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Body: { device_ids: [..., ...] } — returns side-by-side data for up to 4 devices."""
    ids = list(payload.get("device_ids") or [])
    if not ids or len(ids) > 4:
        raise HTTPException(400, "Provide 1-4 device_ids")
    out = []
    for did in ids:
        d = await db.devices.find_one({"id": did}, {"_id": 0})
        if not d:
            continue
        score, commentary = _health_score(d)
        lifecycle = _lifecycle_band(d)
        risk = _failure_risk(d)
        ticket_count = await db.tickets.count_documents(
            {"$or": [{"device_id": did}, {"device_ids": did}]}
        )
        out.append({
            "device": d,
            "health_score": score,
            "commentary": commentary,
            "lifecycle": lifecycle,
            "failure_risk": risk,
            "ticket_count": ticket_count,
        })
    return {"devices": out}


# ─────────────────────── Bulk fan-out actions site-wide ───────────────────────
@router.post("/devices/bulk-action")
async def bulk_action(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Run an action against many devices in parallel.

    Body: { device_ids: [...], action: "run-checks"|"install-patches"|"reboot"|"send-message"|"tag", value?: any }
    Returns per-device result + summary.
    """
    from app.routers.nexus_agent import queue_command_for_device
    ids = list(payload.get("device_ids") or [])
    action = payload.get("action")
    if not ids or not action:
        raise HTTPException(400, "device_ids and action required")
    allowed = {"run-checks", "install-patches", "reboot", "shutdown", "send-message", "tag"}
    if action not in allowed:
        raise HTTPException(400, f"action must be one of {sorted(allowed)}")
    if action != "tag":
        from app.routers.nexus_agent import _can_execute_agent_commands
        if not _can_execute_agent_commands(current_user):
            raise HTTPException(403, "Agent command permission required")

    cursor = db.devices.find({"id": {"$in": ids}}, {"_id": 0})
    targets = [d async for d in cursor]

    async def _run_one(d: dict) -> dict:
        name = d.get("name") or d.get("hostname") or d.get("id")
        if action == "tag":
            tag = (payload.get("value") or "").strip()
            if not tag:
                return {"device_id": d["id"], "device_name": name, "status": "failed", "message": "value required"}
            tags = list(d.get("tags") or [])
            if tag in tags:
                return {"device_id": d["id"], "device_name": name, "status": "skipped", "message": "tag exists"}
            tags.append(tag)
            await db.devices.update_one({"id": d["id"]}, {"$set": {"tags": tags}})
            await log_activity(
                current_user,
                "device_tagged",
                "device",
                d["id"],
                name,
                f"Applied device tag: {tag}",
                metadata={"tag": tag, "source": "bulk-actions"},
            )
            return {"device_id": d["id"], "device_name": name, "status": "completed", "message": "Tag applied"}

        if not d.get("nexus_agent_id"):
            return {"device_id": d["id"], "device_name": name, "status": "skipped", "message": "No NexusOps Agent installed"}
        if action in ("reboot", "shutdown", "send-message") and d.get("status") != "online":
            return {"device_id": d["id"], "device_name": name, "status": "skipped", "message": "Offline"}
        try:
            kind_map = {
                "reboot": "reboot",
                "shutdown": "shutdown",
                "run-checks": "ping",
                "install-patches": "run_script",
                "send-message": "run_script",
            }
            cmd_payload: dict = {}
            if action == "install-patches":
                # Use the built-in Windows Update Agent COM API. This avoids
                # pretending PSWindowsUpdate is installed on every endpoint.
                cmd_payload = {
                    "shell": "powershell",
                    "script": (
                        "$session = New-Object -ComObject Microsoft.Update.Session; "
                        "$searcher = $session.CreateUpdateSearcher(); "
                        "$updates = $searcher.Search('IsInstalled=0 and Type=\'Software\' and IsHidden=0').Updates; "
                        "if ($updates.Count -eq 0) { Write-Output 'No applicable Windows updates'; exit 0 }; "
                        "$collection = New-Object -ComObject Microsoft.Update.UpdateColl; "
                        "foreach ($update in $updates) { [void]$collection.Add($update) }; "
                        "$installer = $session.CreateUpdateInstaller(); $installer.Updates = $collection; "
                        "$result = $installer.Install(); Write-Output ('Windows Update result code: ' + $result.ResultCode)"
                    ),
                    "timeout_sec": 1800,
                }
            elif action == "send-message":
                title = (payload.get("title") or "Message from IT").strip()
                body = (payload.get("body") or "").strip()
                if not body:
                    return {"device_id": d["id"], "device_name": name, "status": "failed", "message": "body required"}
                # Base64 keeps user-provided content out of the PowerShell
                # syntax, preventing message text from becoming executable.
                title64 = base64.b64encode(title.encode("utf-8")).decode("ascii")
                body64 = base64.b64encode(body.encode("utf-8")).decode("ascii")
                cmd_payload = {
                    "shell": "powershell",
                    "script": (
                        "$title = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + title64 + "')); "
                        "$body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + body64 + "')); "
                        "& msg.exe * /TIME:60 ($title + ': ' + $body)"
                    ),
                    "timeout_sec": 30,
                }
            cmd_id = await queue_command_for_device(d, kind_map[action], cmd_payload, queued_by=current_user.get("email") or "bulk")
            return {
                "device_id": d["id"],
                "device_name": name,
                "status": "queued",
                "command_id": cmd_id,
                "message": "Queued for the live Nexus Agent",
            }
        except Exception as e:
            return {"device_id": d["id"], "device_name": name, "status": "failed", "message": str(e)[:200]}

    results = await asyncio.gather(*[_run_one(d) for d in targets])
    queued = sum(1 for r in results if r["status"] == "queued")
    completed = sum(1 for r in results if r["status"] == "completed")
    failed = sum(1 for r in results if r["status"] == "failed")
    skipped = sum(1 for r in results if r["status"] == "skipped")
    return {
        "action": action,
        "results": results,
        "summary": {
            "total": len(results),
            "queued": queued,
            "completed": completed,
            "failed": failed,
            "skipped": skipped,
        },
    }


# ─────────────────────── Site map (geo) ───────────────────────
@router.get("/devices/sites-map")
async def sites_map(current_user: dict = Depends(get_current_user)):
    """Aggregate devices by site/client for the geographic map view."""
    pipeline = [
        {"$group": {
            "_id": "$client_id",
            "client_name": {"$first": "$client_name"},
            "total": {"$sum": 1},
            "online": {"$sum": {"$cond": [{"$eq": ["$status", "online"]}, 1, 0]}},
            "offline": {"$sum": {"$cond": [{"$eq": ["$status", "offline"]}, 1, 0]}},
        }},
    ]
    sites = []
    async for r in db.devices.aggregate(pipeline):
        cid = r.get("_id")
        client = await db.clients.find_one({"id": cid}, {"_id": 0, "name": 1, "address": 1, "city": 1, "country": 1, "lat": 1, "lng": 1}) or {}
        # Fallback: pseudo-random but consistent lat/lng based on client id (so map is populated even without geocoding)
        seed = sum(ord(c) for c in (cid or "x"))
        lat = client.get("lat") if client.get("lat") is not None else -36.85 + ((seed % 1000) / 1000.0 - 0.5) * 8  # NZ-ish
        lng = client.get("lng") if client.get("lng") is not None else 174.76 + ((seed % 1300) / 1300.0 - 0.5) * 8
        sites.append({
            "client_id": cid,
            "client_name": r.get("client_name") or client.get("name") or "Unknown",
            "address": client.get("address") or client.get("city") or "",
            "lat": lat,
            "lng": lng,
            "total": r["total"],
            "online": r["online"],
            "offline": r["offline"],
            "severity": "critical" if r["offline"] >= 3 else "warning" if r["offline"] > 0 else "ok",
        })
    return {"sites": sites}
