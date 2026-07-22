"""Device Smart Engine â€” AI Diagnose, Live Metrics Drawer, Screenshot to Ticket,
Health Score, and Fleet-wide AI insights.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from typing import Optional
import os
import uuid
import json
import logging
import asyncio
import base64

from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity

logger = logging.getLogger(__name__)
router = APIRouter()


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _parse_date(s):
    if not s:
        return None
    try:
        if "T" in s:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        else:
            dt = datetime.strptime(s[:10], "%Y-%m-%d")
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


async def _ai_chat(session_id: str, system_msg: str):
    from app.services.ai_provider import LlmChat
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(500, "AI key not configured")
    cfg = await db.settings.find_one({"type": "ai_config"}, {"_id": 0}) or {}
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system_msg)
    chat.with_model("openai", cfg.get("model", "gpt-5.6-terra"))
    return chat


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   1) AI DIAGNOSE â€” analyze telemetry + recent events + services   â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/devices/{device_id}/ai-diagnose")
async def ai_diagnose(device_id: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    """Pull device telemetry + recent agent events + services and ask Nexus AI to write a
    succinct diagnostic. Optionally posts the result as a comment to the provided ticket_id."""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(404, "Device not found")

    payload = data or {}
    ticket_id = payload.get("ticket_id")

    # Gather snapshots (best-effort from existing collections)
    latest_telemetry = await db.device_metrics.find({"device_id": device_id}, {"_id": 0}).sort("ts", -1).limit(30).to_list(30)
    recent_events = await db.device_events.find({"device_id": device_id}, {"_id": 0}).sort("ts", -1).limit(20).to_list(20)
    services = await db.device_services.find({"device_id": device_id}, {"_id": 0}).limit(40).to_list(40)
    pending_patches = await db.device_winupdates.find({"device_id": device_id, "installed": {"$ne": True}}, {"_id": 0}).limit(20).to_list(20)

    # Compute quick signals
    cpu_avg = sum((m.get("cpu") or 0) for m in latest_telemetry) / max(1, len(latest_telemetry))
    mem_avg = sum((m.get("memory") or 0) for m in latest_telemetry) / max(1, len(latest_telemetry))
    disk = (latest_telemetry[0].get("disk") if latest_telemetry else None) or device.get("disk_usage", 0)
    sustained_high_cpu = sum(1 for m in latest_telemetry if (m.get("cpu") or 0) > 85) >= max(3, int(len(latest_telemetry) * 0.5))
    sustained_high_mem = sum(1 for m in latest_telemetry if (m.get("memory") or 0) > 85) >= max(3, int(len(latest_telemetry) * 0.5))
    low_disk = (disk or 0) > 90
    stopped_critical = [s.get("name") for s in services if (s.get("status") or "").lower() not in ("running",) and s.get("start_type", "").lower() == "auto"][:5]

    summary = {
        "device_name": device.get("name"),
        "os": device.get("os_name") or device.get("os"),
        "status": device.get("status"),
        "ip_address": device.get("ip_address"),
        "last_seen": device.get("last_seen"),
        "agent_version": device.get("agent_version"),
        "telemetry": {
            "cpu_avg_pct": round(cpu_avg, 1), "memory_avg_pct": round(mem_avg, 1), "disk_pct": disk,
            "sustained_high_cpu": sustained_high_cpu, "sustained_high_mem": sustained_high_mem, "low_disk": low_disk,
        },
        "stopped_auto_services": stopped_critical,
        "pending_patches_count": len(pending_patches),
        "recent_events_count": len(recent_events),
        "recent_event_titles": [e.get("title") or e.get("event_type") for e in recent_events[:8]],
    }

    diagnosis = ""
    actions = []
    try:
        from app.services.ai_provider import UserMessage
        sys = (
            "You are a senior MSP technician. Given device telemetry + events + services + patches, "
            "write a CONCISE diagnostic (3-5 bullet points) describing what's wrong (or healthy) and a "
            "remediation list. Output strict JSON: {diagnosis, severity:'low|medium|high|critical', actions:[..]}"
        )
        chat = await _ai_chat(f"diag-{device_id}-{uuid.uuid4().hex[:6]}", sys)
        resp = await chat.send_message(UserMessage(text=json.dumps(summary)))
        text = resp.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        parsed = json.loads(text)
        diagnosis = parsed.get("diagnosis", "")
        if isinstance(diagnosis, list):
            diagnosis = "\n".join(f"â€¢ {x}" for x in diagnosis)
        severity = parsed.get("severity", "medium")
        actions = parsed.get("actions", [])[:6]
        if isinstance(actions, str):
            actions = [actions]
    except Exception as e:
        logger.warning(f"AI diagnose failed: {e}")
        # Fallback heuristic
        bullets = []
        if sustained_high_cpu:
            bullets.append("- Sustained high CPU (>85%) for several samples")
        if sustained_high_mem:
            bullets.append("- Sustained high memory pressure")
        if low_disk:
            bullets.append(f"- Low disk free ({disk}%)")
        if stopped_critical:
            bullets.append(f"- Critical auto-start services stopped: {', '.join(stopped_critical[:3])}")
        if len(pending_patches) > 5:
            bullets.append(f"- {len(pending_patches)} pending Windows updates")
        if not bullets:
            bullets.append("- No critical issues detected on this device.")
        diagnosis = "\n".join(bullets)
        severity = "high" if low_disk or stopped_critical else ("medium" if (sustained_high_cpu or sustained_high_mem) else "low")
        actions = []
        if low_disk:
            actions.append("Run disk cleanup / clear temp")
        if sustained_high_cpu:
            actions.append("Check top processes; consider reboot if process hung")
        if stopped_critical:
            actions.append("Restart stopped auto services")
        if len(pending_patches) > 0:
            actions.append("Install pending patches in next maintenance window")

    result = {
        "device_id": device_id,
        "device_name": device.get("name"),
        "severity": severity,
        "diagnosis": diagnosis,
        "actions": actions,
        "signals": summary["telemetry"],
        "generated_at": _now_iso(),
        "generated_by": current_user.get("name"),
    }
    await db.device_diagnoses.insert_one({**result, "id": str(uuid.uuid4())})

    # Optional ticket comment
    if ticket_id:
        tk = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "id": 1, "ticket_number": 1, "comments": 1})
        if tk:
            body = (
                f"ðŸ¤– AI Device Diagnose â€” {device.get('name')}  ({severity.upper()})\n"
                f"{diagnosis}\n\n"
                + ("Recommended actions:\n" + "\n".join(f"â€¢ {a}" for a in actions) if actions else "")
            )
            comment = {
                "id": str(uuid.uuid4()),
                "ticket_id": ticket_id,
                "author": current_user.get("name", "AI"),
                "author_id": current_user.get("id"),
                "content": body,
                "kind": "ai_diagnose",
                "created_at": _now_iso(),
            }
            await db.ticket_comments.insert_one(comment)
            await db.tickets.update_one({"id": ticket_id}, {"$inc": {"comments_count": 1}, "$set": {"updated_at": _now_iso()}})
            await log_activity(current_user, "ai_diagnose", "device", device_id, device.get("name", ""), f"posted to ticket {tk.get('ticket_number')}")
            result["posted_to_ticket"] = True

    return result


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   2) LIVE METRICS â€” last N minutes time-series for the drawer     â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/devices/{device_id}/live-metrics")
async def live_metrics(device_id: str, minutes: int = 30, current_user: dict = Depends(get_current_user)):
    """Return CPU/RAM/Disk/Net time-series for the last `minutes` minutes for charting."""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(404, "Device not found")
    since = datetime.now(timezone.utc) - timedelta(minutes=int(minutes))
    rows = await db.device_metrics.find(
        {"device_id": device_id, "ts": {"$gte": since.isoformat()}},
        {"_id": 0}
    ).sort("ts", 1).to_list(2000)

    # If empty, synthesise a small series from the current snapshot so the chart still renders
    if not rows:
        now = datetime.now(timezone.utc)
        cpu = device.get("cpu_usage", 0) or 0
        mem = device.get("memory_usage", 0) or 0
        disk = device.get("disk_usage", 0) or 0
        rows = []
        for i in range(20):
            ts = (now - timedelta(seconds=(20 - i) * 60)).isoformat()
            jitter_cpu = max(0, cpu + ((i % 5) - 2) * 3)
            jitter_mem = max(0, mem + ((i % 4) - 1) * 2)
            rows.append({"ts": ts, "cpu": jitter_cpu, "memory": jitter_mem, "disk": disk, "synthetic": True})

    return {
        "device_id": device_id,
        "device_name": device.get("name"),
        "online": (device.get("status") == "online"),
        "agent_version": device.get("agent_version"),
        "ip_address": device.get("ip_address"),
        "current": {
            "cpu": device.get("cpu_usage", 0),
            "memory": device.get("memory_usage", 0),
            "disk": device.get("disk_usage", 0),
        },
        "series": rows,
        "minutes": minutes,
    }


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   3) SCREENSHOT TO TICKET â€” capture user screen, attach to ticketâ•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/devices/{device_id}/screenshot-to-ticket")
async def screenshot_to_ticket(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Request a TRMM screenshot from the device and post it as a ticket attachment+comment.
    If TRMM is not configured, returns a 'pending' record stub so the UX still works."""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(404, "Device not found")
    ticket_id = data.get("ticket_id")
    if not ticket_id:
        raise HTTPException(400, "ticket_id required")
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "id": 1, "ticket_number": 1})
    if not ticket:
        raise HTTPException(404, "Ticket not found")

    # Best-effort TRMM call (graceful skip if not configured)
    image_url = None
    trmm_url = (await db.settings.find_one({"key": "trmm_config"}, {"_id": 0, "value": 1}) or {}).get("value", {}).get("url") or os.environ.get("TRMM_URL")
    trmm_key = (await db.settings.find_one({"key": "trmm_config"}, {"_id": 0, "value": 1}) or {}).get("value", {}).get("api_key") or os.environ.get("TRMM_API_KEY")
    if trmm_url and trmm_key and device.get("trmm_agent_id"):
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as cli:
                r = await cli.post(
                    f"{trmm_url.rstrip('/')}/agents/{device['trmm_agent_id']}/screenshot/",
                    headers={"Authorization": f"Token {trmm_key}"},
                )
                if r.status_code in (200, 202):
                    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
                    image_url = body.get("url") or body.get("screenshot_url")
        except Exception as e:
            logger.warning(f"TRMM screenshot failed: {e}")

    # Persist a marker comment + (if we have data) attachment record
    comment_text = f"ðŸ“¸ Screenshot requested on {device.get('name')} â€” " + ("captured." if image_url else "pending agent response.")
    comment = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "author": current_user.get("name"),
        "author_id": current_user.get("id"),
        "content": comment_text,
        "image_url": image_url,
        "kind": "screenshot_request",
        "device_id": device_id,
        "created_at": _now_iso(),
    }
    await db.ticket_comments.insert_one(comment)
    await db.tickets.update_one({"id": ticket_id}, {"$inc": {"comments_count": 1}, "$set": {"updated_at": _now_iso()}})
    await log_activity(current_user, "screenshot_request", "device", device_id, device.get("name", ""), f"ticket {ticket.get('ticket_number')}")
    comment.pop("_id", None)
    return {"success": True, "image_url": image_url, "comment_id": comment["id"], "pending": image_url is None}


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   4) FLEET HEALTH SCORE                                           â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/devices/fleet-health")
async def fleet_health(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0}).to_list(5000)
    total = len(devices)
    online = sum(1 for d in devices if d.get("status") == "online")
    offline = sum(1 for d in devices if d.get("status") == "offline")
    warning = sum(1 for d in devices if d.get("status") == "warning")
    no_agent = sum(1 for d in devices if not d.get("has_agent") and not d.get("trmm_agent_id"))
    stale = 0
    now = datetime.now(timezone.utc)
    for d in devices:
        ls = _parse_date(d.get("last_seen", ""))
        if ls and (now - ls).days > 7:
            stale += 1
    high_cpu = sum(1 for d in devices if (d.get("cpu_usage") or 0) > 85)
    high_mem = sum(1 for d in devices if (d.get("memory_usage") or 0) > 85)
    low_disk = sum(1 for d in devices if (d.get("disk_usage") or 0) > 90)

    # Health score = 100 - weighted penalties
    score = 100
    if total:
        score -= (offline / total) * 30
        score -= (warning / total) * 15
        score -= (no_agent / total) * 12
        score -= (stale / total) * 8
        score -= (high_cpu / total) * 8
        score -= (high_mem / total) * 8
        score -= (low_disk / total) * 12
    score = max(0, min(100, int(score)))
    band = "excellent" if score >= 85 else "good" if score >= 70 else "fair" if score >= 50 else "poor"

    return {
        "score": score, "band": band,
        "counts": {
            "total": total, "online": online, "offline": offline, "warning": warning,
            "no_agent": no_agent, "stale": stale, "high_cpu": high_cpu, "high_mem": high_mem, "low_disk": low_disk,
        },
    }


@router.get("/devices/fleet-insights")
async def fleet_insights(current_user: dict = Depends(get_current_user)):
    """AI commentary on the fleet â€” what to fix this week."""
    health = await fleet_health(current_user)
    devices = await db.devices.find({}, {"_id": 0}).to_list(5000)
    top_risky = sorted(devices, key=lambda d: ((d.get("disk_usage") or 0) + (d.get("cpu_usage") or 0) + (d.get("memory_usage") or 0)) / 3, reverse=True)[:5]
    risky = [{"name": d.get("name"), "client": d.get("client_name"), "cpu": d.get("cpu_usage", 0), "mem": d.get("memory_usage", 0), "disk": d.get("disk_usage", 0), "status": d.get("status")} for d in top_risky]

    summary = ""
    try:
        from app.services.ai_provider import UserMessage
        sys = "You're a fleet operations analyst. Write 3-4 concise bullets prioritised by impact."
        prompt = json.dumps({"health": health, "top_5_risky": risky})
        chat = await _ai_chat(f"fleet-{uuid.uuid4().hex[:6]}", sys)
        resp = await chat.send_message(UserMessage(text=prompt))
        summary = resp.strip()
    except Exception as e:
        logger.warning(f"fleet insights AI failed: {e}")
        bullets = []
        if health["counts"]["low_disk"] > 0:
            bullets.append(f"- {health['counts']['low_disk']} devices have <10% free disk â€” clear temp + reboot.")
        if health["counts"]["offline"] > 0:
            bullets.append(f"- {health['counts']['offline']} devices offline â€” contact site or schedule physical check.")
        if health["counts"]["stale"] > 0:
            bullets.append(f"- {health['counts']['stale']} agents stale (>7d since check-in) â€” reinstall agent.")
        if health["counts"]["high_cpu"]:
            bullets.append(f"- {health['counts']['high_cpu']} devices running >85% CPU â€” investigate runaway processes.")
        if not bullets:
            bullets.append("- Fleet looks healthy. Plan next maintenance window for patches.")
        summary = "\n".join(bullets)
    return {**health, "ai_summary": summary, "top_5_risky": risky}


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   5) FAN-OUT AI DIAGNOSE â€” across many devices                   â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/devices/bulk-diagnose")
async def bulk_diagnose(data: dict, current_user: dict = Depends(get_current_user)):
    """Run AI diagnose against multiple devices in parallel; return their severities + diagnoses."""
    ids = data.get("device_ids") or []
    if not ids:
        raise HTTPException(400, "device_ids required")
    if len(ids) > 25:
        raise HTTPException(400, "max 25 devices per request")
    sem = asyncio.Semaphore(5)
    results = []

    async def run_one(did):
        async with sem:
            try:
                r = await ai_diagnose(did, {}, current_user)
                return r
            except Exception as e:
                return {"device_id": did, "severity": "error", "diagnosis": str(e)[:120]}

    results = await asyncio.gather(*(run_one(d) for d in ids))
    return {"count": len(results), "results": results}
