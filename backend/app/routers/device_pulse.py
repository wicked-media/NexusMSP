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
from app.services.scope_permissions import assert_record_scope, scoped_query
from datetime import datetime, timezone, timedelta
import uuid

router = APIRouter(tags=["Device Pulse"])

# A recorded device row is not necessarily a current endpoint observation.
# Keep this intentionally stricter than the generic record update time so a
# technician can see a last snapshot without mistaking it for live telemetry.
FRESH_OBSERVATION_SECONDS = 15 * 60


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


def _parse_observed_date(value: object) -> datetime | None:
    """Parse an explicitly recorded lifecycle date without inventing one."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _first_present(device: dict, *fields: str):
    """Return a real reported value, preserving 0 but never inventing one."""
    for field in fields:
        value = device.get(field)
        if value not in (None, ""):
            return value
    return None


def _observation_evidence(device: dict, *, now: datetime | None = None) -> dict:
    """Classify device telemetry freshness without relying on mutable status."""
    now = now or datetime.now(timezone.utc)
    observed = max(
        (
            parsed for parsed in (
                _parse_observed_date(device.get(field))
                for field in ("last_heartbeat", "last_seen", "telemetry_at", "observed_at")
            )
            if parsed is not None
        ),
        default=None,
    )
    if observed is None:
        return {"state": "not_collected", "observed_at": None, "age_seconds": None}
    age_seconds = max(0, int((now - observed).total_seconds()))
    return {
        "state": "observed" if age_seconds <= FRESH_OBSERVATION_SECONDS else "stale",
        "observed_at": observed.isoformat(),
        "age_seconds": age_seconds,
    }


async def _visible_device_ids(current_user: dict) -> list[str]:
    """Return the endpoint identities this technician may use as child-data keys.

    Older child collections are not uniformly client-scoped, so fleet routes
    must derive their device filter from the authorised asset collection rather
    than query child telemetry globally and filter it in the browser.
    """
    rows = await db.devices.find(
        scoped_query(current_user),
        {"_id": 0, "id": 1},
    ).to_list(10_000)
    return [str(row["id"]) for row in rows if row.get("id")]


# ──────────────────────────────────────────────────────────────────────────────
# Fleet Pulse Wall
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/devices/pulse")
async def fleet_pulse(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find(scoped_query(current_user), {"_id": 0}).to_list(1000)
    tiles = []
    for d in devices:
        did = d.get("id", "")
        evidence = _observation_evidence(d)
        health = _health_score(d) if evidence["state"] == "observed" else None
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
            # Devices imported from integrations and devices enrolled through
            # the Nexus agent use slightly different telemetry field names.
            # Normalise them here so the Pulse wall never displays a false 0%.
            "cpu": _first_present(d, "cpu_usage", "cpu_load", "cpu_percent"),
            "ram": _first_present(d, "memory_usage", "ram_usage", "memory_pct", "mem_percent"),
            "disk": _first_present(d, "disk_usage", "disk_pct"),
            # A trend without stored observations is not a trend.  The UI
            # renders this as an explicit evidence gap rather than a plausible
            # looking generated chart.
            "cpu_spark": [],
            "ram_spark": [],
            "disk_spark": [],
            "trend_state": "not_collected",
            "observation_state": evidence["state"],
            "observed_at": evidence["observed_at"],
            "observation_age_seconds": evidence["age_seconds"],
            "tags": d.get("tags", []) or [],
            "last_seen": d.get("last_seen"),
        })
    tiles.sort(key=lambda t: (
        t["observation_state"] != "observed",
        -t["criticality"],
        t["health"] if t["health"] is not None else 101,
    ))
    return {"tiles": tiles, "total": len(tiles), "generated_at": datetime.now(timezone.utc).isoformat()}


# ──────────────────────────────────────────────────────────────────────────────
# Risk Heatmap (client × device_type)
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/devices/risk-heatmap")
async def risk_heatmap(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find(scoped_query(current_user), {"_id": 0}).to_list(1000)
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
    devices = await db.devices.find(scoped_query(current_user), {"_id": 0}).to_list(1000)
    points = []
    now = datetime.now(timezone.utc)
    for d in devices:
        purchase_date = _parse_observed_date(
            d.get("purchase_date") or d.get("acquired_at") or d.get("in_service_date")
        )
        eol_date = _parse_observed_date(
            d.get("eol_date") or d.get("lifecycle_eol_date") or d.get("replacement_target")
        )
        type_ = d.get("device_type", "workstation")
        if not purchase_date or not eol_date:
            points.append({
                "id": d.get("id"),
                "name": d.get("name", "—"),
                "client_name": d.get("client_name", ""),
                "type": type_,
                "age_days": max(0, (now - purchase_date).days) if purchase_date else None,
                "age_years": round(max(0, (now - purchase_date).days) / 365.25, 1) if purchase_date else None,
                "eol_days": None,
                "days_to_eol": None,
                "status": "not_assessed",
                "evidence_state": "not_assessed",
                "missing_evidence": [
                    label for label, value in (("purchase date", purchase_date), ("lifecycle target", eol_date)) if not value
                ],
            })
            continue

        age_days = max(0, (now - purchase_date).days)
        days_to_eol = (eol_date - now).days
        status_eol = "ok" if days_to_eol > 365 else "refresh-soon" if days_to_eol > 90 else "due-now" if days_to_eol > 0 else "overdue"
        points.append({
            "id": d.get("id"),
            "name": d.get("name", "—"),
            "client_name": d.get("client_name", ""),
            "type": type_,
            "age_days": age_days,
            "age_years": round(age_days / 365.25, 1),
            "eol_days": max(0, (eol_date - purchase_date).days),
            "days_to_eol": days_to_eol,
            "status": status_eol,
            "evidence_state": "assessed",
            "purchase_date": purchase_date.isoformat(),
            "eol_date": eol_date.isoformat(),
        })
    points.sort(key=lambda p: (p["days_to_eol"] is None, p["days_to_eol"] or 0))
    summary = {
        "overdue": sum(1 for p in points if p["status"] == "overdue"),
        "due_now": sum(1 for p in points if p["status"] == "due-now"),
        "refresh_soon": sum(1 for p in points if p["status"] == "refresh-soon"),
        "ok": sum(1 for p in points if p["status"] == "ok"),
        "not_assessed": sum(1 for p in points if p["status"] == "not_assessed"),
    }
    return {"devices": points, "summary": summary}


# ──────────────────────────────────────────────────────────────────────────────
# Top Risks (AI-aggregated callouts)
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/devices/top-risks")
async def top_risks(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find(scoped_query(current_user), {"_id": 0}).to_list(1000)
    visible_device_ids = [str(device["id"]) for device in devices if device.get("id")]
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
    patches = await db.patches.find(
        {"device_id": {"$in": visible_device_ids}, "status": "available", "approved_at": {"$exists": False}},
        {"_id": 0},
    ).to_list(500)
    if patches:
        risks.append({
            "id": "risk-patches", "icon": "🩹", "severity": "medium",
            "title": f"{len(patches)} pending security patches",
            "subtitle": "Patches available but not yet approved/deployed.",
            "action_label": "Open Maintenance",
            "action_url": "/maintenance-scheduler",
            "device_ids": [],
        })

    # 5) Predictive failures
    preds = await db.failure_predictions.find(
        {"device_id": {"$in": visible_device_ids}, "risk_level": {"$in": ["critical", "high"]}},
        {"_id": 0},
    ).to_list(50)
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
    limit = max(1, min(int(limit), 100))
    visible_device_ids = await _visible_device_ids(current_user)
    out = []
    cursor = db.alerts.find(
        {"device_id": {"$in": visible_device_ids}},
        {"_id": 0},
    ).sort("created_at", -1).limit(limit)
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
    return {
        "anomalies": out,
        "evidence_state": "observed" if out else "no_observed_anomalies",
    }


# ──────────────────────────────────────────────────────────────────────────────
# Activity Ticker (last 5 min)
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/devices/activity-ticker")
async def activity_ticker(current_user: dict = Depends(get_current_user)):
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
    cutoff_str = cutoff.isoformat()
    events = []

    # Heartbeats (check-ins)
    async for d in db.devices.find(
        scoped_query(current_user, {"last_seen": {"$gte": cutoff_str}}),
        {"_id": 0, "name": 1, "client_name": 1, "last_seen": 1},
    ).sort("last_seen", -1).limit(15):
        events.append({"kind": "checkin", "icon": "📡", "label": f"{d.get('name')} checked in", "client": d.get("client_name"), "ts": d.get("last_seen")})

    # Recent alerts
    visible_device_ids = await _visible_device_ids(current_user)
    async for a in db.alerts.find(
        {"device_id": {"$in": visible_device_ids}, "created_at": {"$gte": cutoff_str}},
        {"_id": 0},
    ).sort("created_at", -1).limit(10):
        events.append({"kind": "alert", "icon": "🚨", "label": a.get("title", "Alert"), "client": a.get("client_name"), "ts": a.get("created_at")})

    # Maintenance window runs
    async for r in db.maintenance_runs.find(
        scoped_query(current_user, {"started_at": {"$gte": cutoff_str}}),
        {"_id": 0},
    ).sort("started_at", -1).limit(10):
        events.append({"kind": "maintenance", "icon": "🛠️", "label": f"Maintenance run: {r.get('action', 'action')}", "client": r.get("client_name"), "ts": r.get("started_at")})

    events.sort(key=lambda e: e.get("ts", ""), reverse=True)
    return {
        "events": events[:25],
        "evidence_state": "observed" if events else "no_recent_observations",
    }


# ──────────────────────────────────────────────────────────────────────────────
# Top Talkers
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/devices/top-talkers")
async def top_talkers(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find(
        scoped_query(current_user, {"status": {"$ne": "offline"}}),
        {"_id": 0, "id": 1, "name": 1, "client_name": 1, "cpu_usage": 1, "ram_usage": 1, "disk_usage": 1},
    ).to_list(500)
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
    minutes = max(1, min(int(minutes), 24 * 60))
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    devices = await db.devices.find(
        scoped_query(current_user, {"status": "offline", "last_seen": {"$gte": cutoff}}),
        {"_id": 0, "id": 1, "name": 1, "client_name": 1, "last_seen": 1, "device_type": 1},
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
    # The legacy catalogue had no command executor behind it.  Returning an
    # empty, explicit capability state prevents the interface from implying
    # that a privileged endpoint action can be dispatched when it cannot.
    return {
        "scripts": [],
        "execution_state": "not_configured",
        "message": "Quick scripts are not configured for Nexus Agent dispatch yet. Use a governed maintenance window or the Nexus Agent command centre.",
    }


@router.post("/devices/quick-scripts/run")
async def quick_scripts_run(data: dict, current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=409,
        detail="Quick-script execution is not configured. Nexus did not queue a device command.",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Device tags (add/replace)
# ──────────────────────────────────────────────────────────────────────────────
@router.post("/devices/{device_id}/tags")
async def update_tags(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    tags = data.get("tags")
    if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
        raise HTTPException(status_code=400, detail="tags must be a list of text values")
    normalised_tags = list(dict.fromkeys(tag.strip() for tag in tags if tag.strip()))
    if any(len(tag) > 80 for tag in normalised_tags):
        raise HTTPException(status_code=400, detail="tags must be 80 characters or fewer")
    await assert_record_scope(
        current_user,
        db.devices,
        device_id,
        operation="device.tags.update",
        resource_name="Managed asset",
    )
    res = await db.devices.update_one(
        {"id": device_id},
        {"$set": {"tags": normalised_tags, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"id": device_id, "tags": normalised_tags}
