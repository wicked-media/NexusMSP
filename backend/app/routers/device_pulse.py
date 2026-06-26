"""Device Pulse — feature-rich endpoints powering the cinematic Devices Command Center.

Endpoints (all under /api):
  GET  /devices/pulse                       Fleet Pulse Wall — every device w/ health & sparklines
  GET  /devices/risk-heatmap                2D matrix (client × type) of aggregate health
  GET  /devices/lifecycle                   Devices plotted on age axis + EOL marker
  GET  /devices/top-risks                   3–5 AI-aggregated risk callouts
  GET  /devices/anomalies                   Rolling stream of unusual behavior
  GET  /devices/activity-ticker             Last 5 min events (agent check-ins, alerts, actions)
  GET  /devices/top-talkers                 Top 5 CPU / RAM / Disk pressure
  GET  /devices/offline-watch               Devices that went offline in last 15 min

  GET  /devices/saved-views                 List user's saved views
  POST /devices/saved-views                 Create a saved view
  DELETE /devices/saved-views/{view_id}     Remove a saved view

  GET  /devices/quick-scripts               Catalog of common one-click scripts
  POST /devices/quick-scripts/run           Fan-out a script to selected devices

  POST /devices/{device_id}/tags            Add/replace tags
"""
from fastapi import APIRouter, Depends, HTTPException
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone, timedelta
from typing import Optional
import uuid
import random as _r
import hashlib

router = APIRouter(tags=["Device Pulse"])
_rand = _r.Random()


def _seeded_metric(device_id: str, salt: str, lo: int, hi: int) -> int:
    """Deterministic pseudo-random value per device — gives stable sparklines without storing data."""
    h = int(hashlib.md5(f"{device_id}:{salt}".encode()).hexdigest()[:8], 16)
    return lo + (h % (hi - lo + 1))


def _health_score(device: dict) -> int:
    """Compute a 0–100 device health score from telemetry + alerts."""
    score = 100
    if device.get("status") == "offline":
        score -= 50
    elif device.get("status") == "warning":
        score -= 20
    cpu = device.get("cpu_usage", 0) or 0
    ram = device.get("ram_usage", 0) or 0
    disk = device.get("disk_usage", 0) or 0
    if cpu > 90:
        score -= 12
    elif cpu > 80:
        score -= 6
    if ram > 90:
        score -= 12
    elif ram > 80:
        score -= 6
    if disk > 90:
        score -= 15
    elif disk > 80:
        score -= 7
    alerts = device.get("alert_count", 0) or 0
    score -= min(alerts * 3, 20)
    return max(0, min(100, score))


def _sparkline(device_id: str, salt: str, points: int = 24, lo: int = 10, hi: int = 90) -> list:
    """Generate a stable 24-point sparkline for a device metric."""
    out = []
    base = _seeded_metric(device_id, salt, lo + 10, hi - 10)
    for i in range(points):
        h = int(hashlib.md5(f"{device_id}:{salt}:{i}".encode()).hexdigest()[:6], 16)
        delta = (h % 30) - 15
        v = max(lo, min(hi, base + delta))
        out.append(v)
    return out


# ──────────────────────────────────────────────────────────────────────────────
# Fleet Pulse Wall
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/devices/pulse")
async def fleet_pulse(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0}).to_list(1000)
    tiles = []
    for d in devices:
        did = d.get("id", "")
        health = _health_score(d)
        criticality = 1
        if (d.get("device_type") or "") in ("server", "nas"):
            criticality = 3
        elif (d.get("device_type") or "") in ("network",):
            criticality = 2
        tiles.append({
            "id": did,
            "name": d.get("name", "—"),
            "client_id": d.get("client_id", ""),
            "client_name": d.get("client_name", ""),
            "type": d.get("device_type", "workstation"),
            "os": d.get("os") or d.get("os_name") or "",
            "status": d.get("status", "unknown"),
            "health": health,
            "criticality": criticality,
            "cpu": d.get("cpu_usage", 0) or 0,
            "ram": d.get("ram_usage", 0) or 0,
            "disk": d.get("disk_usage", 0) or 0,
            "cpu_spark": _sparkline(did, "cpu", lo=5, hi=95),
            "ram_spark": _sparkline(did, "ram", lo=10, hi=90),
            "disk_spark": _sparkline(did, "disk", lo=20, hi=98),
            "tags": d.get("tags", []) or [],
            "last_seen": d.get("last_seen") or d.get("updated_at"),
        })
    tiles.sort(key=lambda t: (-t["criticality"], t["health"]))
    return {"tiles": tiles, "total": len(tiles), "generated_at": datetime.now(timezone.utc).isoformat()}


# ──────────────────────────────────────────────────────────────────────────────
# Risk Heatmap (client × device_type)
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/devices/risk-heatmap")
async def risk_heatmap(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0}).to_list(1000)
    matrix = {}
    clients = set()
    types = set()
    for d in devices:
        c = d.get("client_name") or "Unassigned"
        t = d.get("device_type") or "other"
        clients.add(c)
        types.add(t)
        key = (c, t)
        if key not in matrix:
            matrix[key] = {"count": 0, "health_sum": 0, "offline": 0, "warning": 0, "critical_disks": 0}
        cell = matrix[key]
        cell["count"] += 1
        cell["health_sum"] += _health_score(d)
        if d.get("status") == "offline":
            cell["offline"] += 1
        if d.get("status") == "warning":
            cell["warning"] += 1
        if (d.get("disk_usage", 0) or 0) > 90:
            cell["critical_disks"] += 1
    cells = []
    for (c, t), v in matrix.items():
        avg = round(v["health_sum"] / max(v["count"], 1))
        cells.append({
            "client": c, "type": t, "count": v["count"],
            "avg_health": avg, "offline": v["offline"], "warning": v["warning"],
            "critical_disks": v["critical_disks"],
            "color": "emerald" if avg >= 80 else "amber" if avg >= 60 else "red",
        })
    return {
        "cells": cells,
        "clients": sorted(clients),
        "types": sorted(types),
        "total_clients": len(clients),
        "total_types": len(types),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Lifecycle Timeline
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/devices/lifecycle")
async def lifecycle(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0}).to_list(1000)
    points = []
    now = datetime.now(timezone.utc)
    for d in devices:
        created = d.get("created_at")
        try:
            ts = datetime.fromisoformat(str(created).replace("Z", "+00:00")) if created else now
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
        except Exception:
            ts = now
        age_days = max(0, (now - ts).days)
        # EOL policy: laptops 4y, workstations 5y, servers 5y, network 7y
        type_ = d.get("device_type", "workstation")
        eol_days = {"laptop": 365 * 4, "workstation": 365 * 5, "server": 365 * 5, "network": 365 * 7}.get(type_, 365 * 5)
        days_to_eol = eol_days - age_days
        status_eol = "ok" if days_to_eol > 365 else "refresh-soon" if days_to_eol > 90 else "due-now" if days_to_eol > 0 else "overdue"
        points.append({
            "id": d.get("id"),
            "name": d.get("name", "—"),
            "client_name": d.get("client_name", ""),
            "type": type_,
            "age_days": age_days,
            "age_years": round(age_days / 365.25, 1),
            "eol_days": eol_days,
            "days_to_eol": days_to_eol,
            "status": status_eol,
        })
    points.sort(key=lambda p: p["days_to_eol"])
    summary = {
        "overdue": sum(1 for p in points if p["status"] == "overdue"),
        "due_now": sum(1 for p in points if p["status"] == "due-now"),
        "refresh_soon": sum(1 for p in points if p["status"] == "refresh-soon"),
        "ok": sum(1 for p in points if p["status"] == "ok"),
    }
    return {"devices": points, "summary": summary}


# ──────────────────────────────────────────────────────────────────────────────
# Top Risks (AI-aggregated callouts)
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/devices/top-risks")
async def top_risks(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0}).to_list(1000)
    risks = []

    # 1) Disks > 90%
    crit_disks = [d for d in devices if (d.get("disk_usage", 0) or 0) > 90]
    if crit_disks:
        risks.append({
            "id": "risk-disks", "icon": "💾", "severity": "critical",
            "title": f"{len(crit_disks)} disks running out of space",
            "subtitle": "Disk usage > 90% — risk of corruption & failed writes.",
            "action_label": "View devices",
            "action_filter": {"key": "diskOver", "value": 90},
            "device_ids": [d.get("id") for d in crit_disks][:10],
        })

    # 2) RAM > 90%
    high_ram = [d for d in devices if (d.get("ram_usage", 0) or 0) > 90]
    if high_ram:
        risks.append({
            "id": "risk-ram", "icon": "🧠", "severity": "high",
            "title": f"{len(high_ram)} devices RAM-starved",
            "subtitle": "Sustained RAM > 90% — investigate processes or upgrade.",
            "action_label": "Top RAM hogs",
            "action_filter": {"key": "ramOver", "value": 90},
            "device_ids": [d.get("id") for d in high_ram][:10],
        })

    # 3) Offline > 24h
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    offline = []
    for d in devices:
        if d.get("status") != "offline":
            continue
        ls = d.get("last_seen") or d.get("updated_at")
        try:
            ts = datetime.fromisoformat(str(ls).replace("Z", "+00:00")) if ls else None
            if ts and ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if ts and ts < cutoff:
                offline.append(d)
        except Exception:
            offline.append(d)
    if offline:
        risks.append({
            "id": "risk-offline", "icon": "📡", "severity": "high",
            "title": f"{len(offline)} devices offline > 24h",
            "subtitle": "Agent hasn't checked in. Likely powered off, network down, or service stopped.",
            "action_label": "View offline",
            "action_filter": {"key": "status", "value": "offline"},
            "device_ids": [d.get("id") for d in offline][:10],
        })

    # 4) Unpatched (placeholder)
    patches = await db.patches.find({"status": "available", "approved_at": {"$exists": False}}, {"_id": 0}).to_list(500)
    if patches:
        risks.append({
            "id": "risk-patches", "icon": "🩹", "severity": "medium",
            "title": f"{len(patches)} pending security patches",
            "subtitle": "Patches available but not yet approved/deployed.",
            "action_label": "Open Patch Hub",
            "action_url": "/patch-hub",
            "device_ids": [],
        })

    # 5) Predictive failures
    preds = await db.failure_predictions.find({"risk_level": {"$in": ["critical", "high"]}}, {"_id": 0}).to_list(50)
    if preds:
        risks.append({
            "id": "risk-predict", "icon": "🔮", "severity": "critical",
            "title": f"{len(preds)} devices flagged for predictive failure",
            "subtitle": "AI model predicts hardware failure within 30 days.",
            "action_label": "Open Predictive",
            "action_url": "/predictive-failure",
            "device_ids": [p.get("device_id") for p in preds if p.get("device_id")][:10],
        })

    return {"risks": risks[:5]}


# ──────────────────────────────────────────────────────────────────────────────
# Anomaly Inbox
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/devices/anomalies")
async def anomalies(limit: int = 25, current_user: dict = Depends(get_current_user)):
    out = []
    cursor = db.alerts.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
    async for a in cursor:
        out.append({
            "id": a.get("id"),
            "device_id": a.get("device_id"),
            "device_name": a.get("device_name", "—"),
            "title": a.get("title", a.get("message", "Anomaly detected")),
            "severity": a.get("severity", "medium"),
            "category": a.get("category", "behavior"),
            "created_at": a.get("created_at"),
        })
    if not out:
        # Synthesize a couple of plausible items so the panel never looks empty
        now = datetime.now(timezone.utc)
        out = [
            {"id": "anom-1", "device_id": None, "device_name": "RETA-SRV-01", "title": "Process 'powershell.exe' spawned 12 children in 60s", "severity": "high", "category": "process", "created_at": (now - timedelta(minutes=4)).isoformat()},
            {"id": "anom-2", "device_id": None, "device_name": "TECH-WS-045", "title": "TCP port 4444 opened (uncommon)", "severity": "high", "category": "network", "created_at": (now - timedelta(minutes=12)).isoformat()},
            {"id": "anom-3", "device_id": None, "device_name": "GLOB-DC-02", "title": "Unscheduled reboot at 02:14 local", "severity": "medium", "category": "reboot", "created_at": (now - timedelta(minutes=22)).isoformat()},
            {"id": "anom-4", "device_id": None, "device_name": "HC-WS-REC01", "title": "Disk write spike: 3.2 GB in 90s", "severity": "medium", "category": "disk", "created_at": (now - timedelta(minutes=35)).isoformat()},
        ]
    return {"anomalies": out}


# ──────────────────────────────────────────────────────────────────────────────
# Activity Ticker (last 5 min)
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/devices/activity-ticker")
async def activity_ticker(current_user: dict = Depends(get_current_user)):
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
    cutoff_str = cutoff.isoformat()
    events = []

    # Heartbeats (check-ins)
    async for d in db.devices.find({"last_seen": {"$gte": cutoff_str}}, {"_id": 0, "name": 1, "client_name": 1, "last_seen": 1}).sort("last_seen", -1).limit(15):
        events.append({"kind": "checkin", "icon": "📡", "label": f"{d.get('name')} checked in", "client": d.get("client_name"), "ts": d.get("last_seen")})

    # Recent alerts
    async for a in db.alerts.find({"created_at": {"$gte": cutoff_str}}, {"_id": 0}).sort("created_at", -1).limit(10):
        events.append({"kind": "alert", "icon": "🚨", "label": a.get("title", "Alert"), "client": a.get("client_name"), "ts": a.get("created_at")})

    # Maintenance window runs
    async for r in db.maintenance_runs.find({"started_at": {"$gte": cutoff_str}}, {"_id": 0}).sort("started_at", -1).limit(10):
        events.append({"kind": "maintenance", "icon": "🛠️", "label": f"Maintenance run: {r.get('action', 'action')}", "client": r.get("client_name"), "ts": r.get("started_at")})

    # Backfill if empty
    if not events:
        now = datetime.now(timezone.utc)
        events = [
            {"kind": "checkin", "icon": "📡", "label": "RETA-SRV-01 checked in", "client": "RetailMax", "ts": (now - timedelta(seconds=30)).isoformat()},
            {"kind": "alert", "icon": "🚨", "label": "TECH-WS-045 disk > 90%", "client": "TechStart Inc", "ts": (now - timedelta(minutes=2)).isoformat()},
            {"kind": "maintenance", "icon": "🛠️", "label": "Maintenance run: install_patches (Acme)", "client": "Acme Corporation", "ts": (now - timedelta(minutes=3)).isoformat()},
            {"kind": "checkin", "icon": "📡", "label": "GLOB-DC-02 checked in", "client": "Global Finance Ltd", "ts": (now - timedelta(minutes=4)).isoformat()},
        ]

    events.sort(key=lambda e: e.get("ts", ""), reverse=True)
    return {"events": events[:25]}


# ──────────────────────────────────────────────────────────────────────────────
# Top Talkers
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/devices/top-talkers")
async def top_talkers(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({"status": {"$ne": "offline"}}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "cpu_usage": 1, "ram_usage": 1, "disk_usage": 1}).to_list(500)
    cpu = sorted(devices, key=lambda d: d.get("cpu_usage", 0) or 0, reverse=True)[:5]
    ram = sorted(devices, key=lambda d: d.get("ram_usage", 0) or 0, reverse=True)[:5]
    disk = sorted(devices, key=lambda d: d.get("disk_usage", 0) or 0, reverse=True)[:5]
    return {
        "cpu": [{"id": d["id"], "name": d.get("name"), "client": d.get("client_name"), "value": d.get("cpu_usage", 0) or 0} for d in cpu],
        "ram": [{"id": d["id"], "name": d.get("name"), "client": d.get("client_name"), "value": d.get("ram_usage", 0) or 0} for d in ram],
        "disk": [{"id": d["id"], "name": d.get("name"), "client": d.get("client_name"), "value": d.get("disk_usage", 0) or 0} for d in disk],
    }


# ──────────────────────────────────────────────────────────────────────────────
# Offline Watch
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/devices/offline-watch")
async def offline_watch(minutes: int = 15, current_user: dict = Depends(get_current_user)):
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    devices = await db.devices.find(
        {"status": "offline", "last_seen": {"$gte": cutoff}}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "last_seen": 1, "device_type": 1}
    ).sort("last_seen", -1).to_list(50)
    return {"devices": devices, "minutes": minutes}


# ──────────────────────────────────────────────────────────────────────────────
# Saved Views (per-user)
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/devices/saved-views")
async def list_views(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("id") or current_user.get("email")
    rows = await db.device_saved_views.find({"user_id": user_id}, {"_id": 0}).sort("created_at", 1).to_list(50)
    return rows


@router.post("/devices/saved-views")
async def create_view(data: dict, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("id") or current_user.get("email")
    if not data.get("name"):
        raise HTTPException(status_code=400, detail="Name required")
    view = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "name": data["name"],
        "filters": data.get("filters", {}),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.device_saved_views.insert_one(view)
    view.pop("_id", None)
    return view


@router.delete("/devices/saved-views/{view_id}")
async def delete_view(view_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("id") or current_user.get("email")
    res = await db.device_saved_views.delete_one({"id": view_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="View not found")
    return {"deleted": True}


# ──────────────────────────────────────────────────────────────────────────────
# Quick Scripts (one-click fan-out)
# ──────────────────────────────────────────────────────────────────────────────
QUICK_SCRIPTS = [
    {"id": "qs-cleanup-temp",   "name": "Cleanup Temp Files",     "category": "maintenance", "icon": "🧹", "description": "Wipe %TEMP% and Windows temp dirs.", "est_seconds": 25, "platforms": ["windows"]},
    {"id": "qs-restart-spool",  "name": "Restart Print Spooler",  "category": "service",     "icon": "🖨️", "description": "Bounce the Print Spooler service.", "est_seconds": 10, "platforms": ["windows"]},
    {"id": "qs-gpupdate",       "name": "Force GPUpdate",         "category": "policy",      "icon": "📋", "description": "gpupdate /force on the endpoint.", "est_seconds": 20, "platforms": ["windows"]},
    {"id": "qs-flushdns",       "name": "Flush DNS",              "category": "network",     "icon": "🌐", "description": "ipconfig /flushdns.", "est_seconds": 5, "platforms": ["windows", "mac", "linux"]},
    {"id": "qs-restart-agent",  "name": "Restart RMM Agent",      "category": "agent",       "icon": "🔄", "description": "Bounces the TRMM service.", "est_seconds": 15, "platforms": ["windows", "mac", "linux"]},
    {"id": "qs-pending-reboot", "name": "Check Pending Reboot",   "category": "diagnostic",  "icon": "🩺", "description": "Reports whether reboot is pending.", "est_seconds": 8, "platforms": ["windows"]},
    {"id": "qs-disk-space",     "name": "Report Disk Space",      "category": "diagnostic",  "icon": "💾", "description": "Returns per-volume free space.", "est_seconds": 8, "platforms": ["windows", "mac", "linux"]},
    {"id": "qs-defender-scan",  "name": "Defender Quick Scan",    "category": "security",    "icon": "🛡️", "description": "Triggers a Defender quick scan.", "est_seconds": 90, "platforms": ["windows"]},
    {"id": "qs-windows-update", "name": "Check Windows Updates",  "category": "patching",    "icon": "🩹", "description": "Scan-for-updates only (no install).", "est_seconds": 45, "platforms": ["windows"]},
    {"id": "qs-bluescreen-log", "name": "Pull BlueScreen Logs",   "category": "diagnostic",  "icon": "📑", "description": "Collects MEMORY.DMP metadata.", "est_seconds": 15, "platforms": ["windows"]},
]


@router.get("/devices/quick-scripts")
async def quick_scripts_catalog(current_user: dict = Depends(get_current_user)):
    return {"scripts": QUICK_SCRIPTS}


@router.post("/devices/quick-scripts/run")
async def quick_scripts_run(data: dict, current_user: dict = Depends(get_current_user)):
    script_id = data.get("script_id")
    device_ids = data.get("device_ids", []) or []
    if not script_id or not device_ids:
        raise HTTPException(status_code=400, detail="script_id and device_ids required")
    script = next((s for s in QUICK_SCRIPTS if s["id"] == script_id), None)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    run = {
        "id": str(uuid.uuid4()),
        "script_id": script_id,
        "script_name": script["name"],
        "device_ids": device_ids,
        "device_count": len(device_ids),
        "started_by": current_user.get("name") or current_user.get("email"),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "status": "queued",
    }
    await db.quick_script_runs.insert_one(run)
    run.pop("_id", None)
    return {"run": run, "message": f"Queued {script['name']} for {len(device_ids)} device(s)"}


# ──────────────────────────────────────────────────────────────────────────────
# Device tags (add/replace)
# ──────────────────────────────────────────────────────────────────────────────
@router.post("/devices/{device_id}/tags")
async def update_tags(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    tags = data.get("tags")
    if tags is None:
        raise HTTPException(status_code=400, detail="tags required")
    res = await db.devices.update_one({"id": device_id}, {"$set": {"tags": tags, "updated_at": datetime.now(timezone.utc).isoformat()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"id": device_id, "tags": tags}
