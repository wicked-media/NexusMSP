"""Tactical RMM Sync & Reliability.

Keeps `db.devices` in lock-step with live TRMM agent state. When TRMM is not
configured, a 'demo mode' generates realistic synthetic state so every UI
flow can be tested immediately.

Endpoints:
  GET  /api/trmm-sync/status                 — Last sync time, counts, demo flag
  POST /api/trmm-sync/run                    — Manual sync now
  GET  /api/trmm-sync/stale-agents           — Agents silent > N days
  GET  /api/trmm-sync/outages                — Active outage candidates (live)
  GET  /api/trmm-sync/state-log/{device_id}  — Online/offline transitions
  GET  /api/trmm-sync/client-health          — Per-client roll-up
  POST /api/trmm-sync/bulk-action            — Bulk reboot/script/patch on selected devices
"""
from fastapi import APIRouter, Depends, HTTPException, Body
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import uuid, random, logging, asyncio

from app.database import db
from app.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

SYNC_DOC_KEY = "trmm_sync_state"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso() -> str:
    return _now().isoformat()


async def _get_trmm_cfg():
    """Return TRMM config if valid credentials exist, else None (triggers demo mode)."""
    cfg = await db.settings.find_one({"type": "trmm_settings"}, {"_id": 0})
    if not cfg: return None
    if not cfg.get("base_url") or not cfg.get("api_key"): return None
    return cfg


# ──────────────────── SYNC CORE ────────────────────

async def _fetch_live_agents() -> list:
    """Pull agents from live TRMM — returns normalized list."""
    from app.routers.tactical_rmm import _trmm_call, _data, _norm_agent
    try:
        raw = await _trmm_call("GET", "agents/")
        return [_norm_agent(a) for a in _data(raw)]
    except Exception as e:
        logger.warning(f"TRMM agent fetch failed: {e}")
        return []


async def _fetch_demo_agents() -> list:
    """Generate synthetic TRMM-shaped agents from existing linked devices
    so UIs have something live-looking when TRMM isn't configured yet."""
    devices = await db.devices.find(
        {},
        {"_id": 0, "id": 1, "name": 1, "client_name": 1, "status": 1, "ip_address": 1, "trmm_agent_id": 1}
    ).limit(500).to_list(500)

    now = _now()
    out = []
    for d in devices:
        # Use existing trmm_agent_id if present; otherwise mint one
        agent_id = d.get("trmm_agent_id") or f"demo-{d['id'][:16]}"
        # 82% online, 10% offline, 5% warning, 3% stale
        r = random.random()
        if r < 0.82:
            status = "online"
            last_seen = (now - timedelta(seconds=random.randint(5, 60))).isoformat()
        elif r < 0.92:
            status = "offline"
            last_seen = (now - timedelta(minutes=random.randint(6, 180))).isoformat()
        elif r < 0.97:
            status = "warning"
            last_seen = (now - timedelta(seconds=random.randint(60, 300))).isoformat()
        else:
            status = "offline"  # stale candidate
            last_seen = (now - timedelta(days=random.randint(4, 30))).isoformat()

        out.append({
            "id": agent_id,
            "agent_id": agent_id,
            "hostname": d.get("name") or "unknown",
            "client": d.get("client_name") or "Unknown",
            "status": status,
            "last_seen": last_seen,
            "cpu_load": random.randint(5, 80) if status == "online" else 0,
            "used_ram": random.randint(20, 90) if status == "online" else 0,
            "checks_failing": 1 if status == "warning" else 0,
            "patches_pending": random.randint(0, 8),
            "logged_in_username": random.choice(["jdoe", "jsmith", "admin", ""]) if status == "online" else "",
            "version": "2.4.5",
        })
    return out


async def run_trmm_sync(force_demo: bool = False) -> dict:
    """Sync TRMM agent state → db.devices. Also logs state transitions."""
    cfg = await _get_trmm_cfg()
    demo_mode = force_demo or cfg is None
    agents = await (_fetch_demo_agents() if demo_mode else _fetch_live_agents())

    now_iso = _iso()
    now = _now()
    updated = 0
    transitions: list = []
    offline_by_client: dict = {}

    # Build lookup by trmm_agent_id for O(1) matching
    by_agent_id = {a["id"]: a for a in agents if a.get("id")}
    by_hostname = {(a.get("hostname") or "").strip().lower(): a for a in agents if a.get("hostname")}

    devices = await db.devices.find(
        {},
        {"_id": 0, "id": 1, "name": 1, "client_id": 1, "client_name": 1, "status": 1, "trmm_agent_id": 1}
    ).to_list(5000)

    for d in devices:
        agent = None
        if d.get("trmm_agent_id"):
            agent = by_agent_id.get(d["trmm_agent_id"])
        if not agent:
            agent = by_hostname.get((d.get("name") or "").lower())
        if not agent:
            continue  # unlinked — skipped

        new_status = agent.get("status", "unknown")
        old_status = d.get("status")
        update = {
            "status": new_status,
            "last_seen": agent.get("last_seen") or now_iso,
            "last_trmm_sync": now_iso,
            "cpu_usage": agent.get("cpu_load"),
            "checks_failing": agent.get("checks_failing", 0),
            "needs_patching": agent.get("patches_pending", 0),
            "logged_in_user": agent.get("logged_in_username") or "",
            "trmm_agent_id": agent.get("id"),
        }
        await db.devices.update_one({"id": d["id"]}, {"$set": update})
        updated += 1

        # State transitions
        if old_status and old_status != new_status:
            transitions.append({
                "device_id": d["id"], "device_name": d["name"],
                "from_status": old_status, "to_status": new_status,
                "client_id": d.get("client_id"), "client_name": d.get("client_name"),
                "ts": now_iso,
            })
            await db.device_state_log.insert_one({
                "id": uuid.uuid4().hex,
                "device_id": d["id"],
                "device_name": d["name"],
                "client_id": d.get("client_id"),
                "client_name": d.get("client_name"),
                "from_status": old_status,
                "to_status": new_status,
                "ts": now_iso,
            })

        if new_status == "offline" and d.get("client_id"):
            offline_by_client.setdefault(d["client_id"], []).append({
                "device_id": d["id"], "device_name": d["name"], "client_name": d.get("client_name"),
            })

    # ───── Outage Detective ─────
    outages_created = 0
    five_min_ago = now - timedelta(minutes=5)
    for cid, offs in offline_by_client.items():
        if len(offs) < 3: continue
        # How many of these just transitioned to offline in last 5 min?
        recent = await db.device_state_log.count_documents({
            "client_id": cid, "to_status": "offline",
            "ts": {"$gte": five_min_ago.isoformat()}
        })
        if recent < 3: continue
        # Idempotent per client per day
        today = now.strftime("%Y-%m-%d")
        already = await db.outages.find_one({"client_id": cid, "date_key": today, "resolved": {"$ne": True}}, {"_id": 0})
        if already: continue
        outage_id = uuid.uuid4().hex
        outage_doc = {
            "id": outage_id, "client_id": cid,
            "client_name": offs[0]["client_name"],
            "date_key": today,
            "detected_at": now_iso,
            "offline_count": len(offs),
            "devices": offs[:50],
            "resolved": False,
            "source": "outage_detective",
        }
        await db.outages.insert_one(dict(outage_doc))
        outages_created += 1
        # Auto-create a ticket
        try:
            ticket_id = uuid.uuid4().hex
            ticket_number = f"TKT-{(await db.tickets.count_documents({}) + 1):05d}"
            await db.tickets.insert_one({
                "id": ticket_id, "ticket_number": ticket_number,
                "title": f"🔴 Outage detected — {len(offs)} devices offline at {offs[0]['client_name']}",
                "description": (
                    f"Outage Detective fired: {len(offs)} devices went offline in the last 5 min.\n\n"
                    + "\n".join([f"- {o['device_name']}" for o in offs[:20]])
                    + "\n\nCheck ISP / WAN / UPS / UniFi gateway."
                ),
                "status": "open", "priority": "critical", "source": "auto_outage",
                "client_id": cid, "client_name": offs[0]["client_name"],
                "created_at": now_iso, "updated_at": now_iso,
                "ref_type": "outage", "ref_id": outage_id,
            })
            outage_doc["ticket_id"] = ticket_id
            await db.outages.update_one({"id": outage_id}, {"$set": {"ticket_id": ticket_id, "ticket_number": ticket_number}})
        except Exception as e:
            logger.warning(f"outage-ticket create failed: {e}")

    # Persist sync state
    await db.settings.update_one(
        {"type": SYNC_DOC_KEY},
        {"$set": {
            "type": SYNC_DOC_KEY,
            "last_sync_at": now_iso,
            "devices_updated": updated,
            "agents_seen": len(agents),
            "demo_mode": demo_mode,
            "transitions_count": len(transitions),
            "outages_created_this_tick": outages_created,
        }},
        upsert=True,
    )

    return {
        "ok": True,
        "demo_mode": demo_mode,
        "devices_updated": updated,
        "agents_seen": len(agents),
        "transitions": transitions[:30],
        "outages_created": outages_created,
    }


# ──────────────────── ENDPOINTS ────────────────────

@router.get("/trmm-sync/status")
async def sync_status(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": SYNC_DOC_KEY}, {"_id": 0}) or {}
    cfg = await _get_trmm_cfg()
    last = doc.get("last_sync_at")
    staleness_seconds = None
    if last:
        try:
            dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            staleness_seconds = int((_now() - dt).total_seconds())
        except Exception:
            pass
    return {
        "configured": bool(cfg),
        "demo_mode": not bool(cfg),
        "last_sync_at": last,
        "staleness_seconds": staleness_seconds,
        "devices_updated": doc.get("devices_updated", 0),
        "agents_seen": doc.get("agents_seen", 0),
        "transitions_count": doc.get("transitions_count", 0),
    }


@router.post("/trmm-sync/run")
async def manual_sync(current_user: dict = Depends(get_current_user)):
    res = await run_trmm_sync()
    return res


@router.get("/trmm-sync/stale-agents")
async def stale_agents(days: int = 3, current_user: dict = Depends(get_current_user)):
    """Devices linked to a TRMM agent but not seen in N+ days."""
    cutoff = (_now() - timedelta(days=days)).isoformat()
    rows = await db.devices.find(
        {
            "trmm_agent_id": {"$exists": True, "$ne": ""},
            "$or": [
                {"last_seen": {"$lt": cutoff}},
                {"last_seen": {"$exists": False}},
            ],
        },
        {"_id": 0, "id": 1, "name": 1, "client_id": 1, "client_name": 1, "last_seen": 1, "trmm_agent_id": 1, "status": 1}
    ).limit(500).to_list(500)
    return {"stale": rows, "count": len(rows), "days_threshold": days}


@router.get("/trmm-sync/outages")
async def active_outages(current_user: dict = Depends(get_current_user)):
    rows = await db.outages.find({"resolved": {"$ne": True}}, {"_id": 0}).sort("detected_at", -1).limit(50).to_list(50)
    return {"outages": rows, "count": len(rows)}


@router.post("/trmm-sync/outages/{outage_id}/resolve")
async def resolve_outage(outage_id: str, current_user: dict = Depends(get_current_user)):
    res = await db.outages.update_one({"id": outage_id}, {"$set": {"resolved": True, "resolved_at": _iso()}})
    if res.matched_count == 0: raise HTTPException(404, "outage not found")
    return {"resolved": True}


@router.get("/trmm-sync/state-log/{device_id}")
async def device_state_log(device_id: str, limit: int = 30, current_user: dict = Depends(get_current_user)):
    rows = await db.device_state_log.find(
        {"device_id": device_id}, {"_id": 0}
    ).sort("ts", -1).limit(limit).to_list(limit)
    # Compute current offline duration if latest is offline→ we stopped seeing state change
    summary = {"online_pct_24h": None, "transitions_24h": 0}
    day_ago = (_now() - timedelta(hours=24)).isoformat()
    summary["transitions_24h"] = await db.device_state_log.count_documents({
        "device_id": device_id, "ts": {"$gte": day_ago}
    })
    return {"transitions": rows, "summary": summary, "count": len(rows)}


@router.get("/trmm-sync/client-health")
async def client_health(current_user: dict = Depends(get_current_user)):
    """Per-client live device health roll-up."""
    devices = await db.devices.find(
        {},
        {"_id": 0, "client_id": 1, "client_name": 1, "status": 1, "trmm_agent_id": 1}
    ).to_list(5000)
    out: dict = {}
    for d in devices:
        cid = d.get("client_id") or "unknown"
        o = out.setdefault(cid, {
            "client_id": cid, "client_name": d.get("client_name") or "Unknown",
            "total": 0, "online": 0, "offline": 0, "warning": 0, "linked": 0,
        })
        o["total"] += 1
        s = d.get("status")
        if s in o: o[s] += 1
        if d.get("trmm_agent_id"): o["linked"] += 1
    rows = list(out.values())
    for r in rows:
        r["online_pct"] = round(r["online"] / r["total"] * 100) if r["total"] else 0
        off_pct = (r["offline"] / r["total"]) if r["total"] else 0
        r["badge"] = "FULL OUTAGE" if off_pct > 0.6 else ("PARTIAL OUTAGE" if off_pct > 0.3 else "HEALTHY" if r["online_pct"] >= 80 else "WARNING")
    rows.sort(key=lambda x: -x.get("offline", 0))
    return {"clients": rows, "count": len(rows)}


@router.post("/trmm-sync/bulk-action")
async def bulk_action(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Run reboot / install-patches / run-checks across selected devices."""
    device_ids: List[str] = payload.get("device_ids") or []
    action = payload.get("action") or ""
    if action not in {"reboot", "install-patches", "run-checks"}:
        raise HTTPException(400, "action must be one of reboot|install-patches|run-checks")
    if not device_ids:
        raise HTTPException(400, "device_ids[] required")

    # Honour Change Freeze per-client
    try:
        from app.routers.change_freezes import _is_frozen
    except Exception:
        _is_frozen = None

    results = []
    # Map action → TRMM kind for freeze check
    kind = {"reboot": "reboot", "install-patches": "patch", "run-checks": "script"}[action]
    cfg = await _get_trmm_cfg()

    for dev_id in device_ids:
        d = await db.devices.find_one({"id": dev_id}, {"_id": 0, "trmm_agent_id": 1, "client_id": 1, "name": 1})
        if not d: results.append({"device_id": dev_id, "ok": False, "reason": "not found"}); continue
        if not d.get("trmm_agent_id"):
            results.append({"device_id": dev_id, "ok": False, "reason": "not linked to TRMM"}); continue

        # Change-freeze guard
        if _is_frozen:
            state = await _is_frozen(client_id=d.get("client_id"), kind=kind)
            if state.get("frozen"):
                results.append({"device_id": dev_id, "ok": False, "reason": "change_freeze_active"}); continue

        if not cfg:
            # Demo mode — simulate
            results.append({"device_id": dev_id, "ok": True, "simulated": True, "device_name": d["name"]})
            continue

        # Real TRMM dispatch
        try:
            from app.routers.tactical_rmm import _trmm_call
            if action == "reboot":
                await _trmm_call("POST", f"agents/{d['trmm_agent_id']}/reboot/")
            elif action == "install-patches":
                await _trmm_call("POST", f"winupdate/{d['trmm_agent_id']}/install/")
            elif action == "run-checks":
                await _trmm_call("POST", f"agents/{d['trmm_agent_id']}/runchecks/")
            results.append({"device_id": dev_id, "ok": True, "device_name": d["name"]})
        except Exception as e:
            results.append({"device_id": dev_id, "ok": False, "reason": str(e)[:120]})

    # Audit
    await db.trmm_actions.insert_one({
        "action": f"bulk-{action}",
        "agent_id": f"{len(device_ids)}-devices",
        "by": current_user.get("name"),
        "timestamp": _iso(),
        "result_preview": f"ok={sum(1 for r in results if r['ok'])} fail={sum(1 for r in results if not r['ok'])}",
    })
    return {"action": action, "results": results, "demo_mode": not bool(cfg)}
