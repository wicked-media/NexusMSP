"""
Huntress Labs integration — read-only security telemetry.
Base URL: https://api.huntress.io
Auth: HTTP Basic (api_key : secret_key)
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from typing import Optional
import httpx
import asyncio

from app.database import db
from app.auth import get_current_user

router = APIRouter()

HUNTRESS_BASE_URL = "https://api.huntress.io"
SETTINGS_KEY = "huntress"

# --- credentials helpers ---------------------------------------------------

async def _get_creds() -> Optional[dict]:
    doc = await db.settings.find_one({"type": SETTINGS_KEY}, {"_id": 0})
    if not doc or not doc.get("api_key") or not doc.get("secret_key"):
        return None
    return doc


def _auth(creds: dict) -> tuple:
    return (creds["api_key"], creds["secret_key"])


async def _get(path: str, params: Optional[dict] = None) -> dict:
    creds = await _get_creds()
    if not creds:
        raise HTTPException(503, "Huntress not configured")
    url = f"{HUNTRESS_BASE_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=30.0, auth=_auth(creds)) as c:
            r = await c.get(url, params=params or {})
            if r.status_code == 401:
                raise HTTPException(401, "Huntress authentication failed — check API key & secret")
            if r.status_code == 429:
                raise HTTPException(429, "Huntress rate-limit hit (60 req/min)")
            r.raise_for_status()
            return r.json() if r.content else {}
    except httpx.TimeoutException:
        raise HTTPException(504, "Huntress API timeout")
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"Huntress error: {e.response.text[:200]}")


# --- settings endpoints ----------------------------------------------------

@router.get("/huntress/status")
async def huntress_status(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": SETTINGS_KEY}, {"_id": 0})
    return {
        "configured": bool(doc and doc.get("api_key") and doc.get("secret_key")),
        "api_key_preview": (doc.get("api_key", "")[:6] + "…" + doc.get("api_key", "")[-4:]) if doc and doc.get("api_key") else None,
        "last_test_status": (doc or {}).get("last_test_status"),
        "last_tested_at": (doc or {}).get("last_tested_at"),
        "last_synced_at": (doc or {}).get("last_synced_at"),
        "updated_at": (doc or {}).get("updated_at"),
        "updated_by": (doc or {}).get("updated_by"),
    }


@router.post("/huntress/settings")
async def save_huntress_settings(data: dict, current_user: dict = Depends(get_current_user)):
    api_key = (data or {}).get("api_key", "").strip()
    secret_key = (data or {}).get("secret_key", "").strip()
    if not api_key or not secret_key:
        raise HTTPException(400, "api_key and secret_key are required")
    now = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one(
        {"type": SETTINGS_KEY},
        {"$set": {
            "type": SETTINGS_KEY,
            "api_key": api_key,
            "secret_key": secret_key,
            "updated_at": now,
            "updated_by": current_user.get("name"),
        }},
        upsert=True,
    )
    return {"message": "Huntress settings saved", "updated_at": now}


@router.delete("/huntress/settings")
async def clear_huntress_settings(current_user: dict = Depends(get_current_user)):
    await db.settings.delete_one({"type": SETTINGS_KEY})
    return {"message": "Huntress credentials removed"}


@router.get("/huntress/test-connection")
async def huntress_test_connection(current_user: dict = Depends(get_current_user)):
    creds = await _get_creds()
    if not creds:
        return {"success": False, "message": "Not configured — enter API key & secret first"}
    try:
        async with httpx.AsyncClient(timeout=15.0, auth=_auth(creds)) as c:
            r = await c.get(f"{HUNTRESS_BASE_URL}/v1/account")
        now = datetime.now(timezone.utc).isoformat()
        success = r.status_code == 200
        account_info = r.json() if success and r.content else {}
        await db.settings.update_one(
            {"type": SETTINGS_KEY},
            {"$set": {
                "last_test_status": "success" if success else f"failed_{r.status_code}",
                "last_tested_at": now,
            }},
        )
        if success:
            return {"success": True, "message": "Connected to Huntress", "account": account_info.get("account") or account_info}
        return {"success": False, "message": f"Huntress returned {r.status_code}: {r.text[:200]}"}
    except Exception as e:
        await db.settings.update_one(
            {"type": SETTINGS_KEY},
            {"$set": {"last_test_status": f"error: {str(e)[:100]}", "last_tested_at": datetime.now(timezone.utc).isoformat()}},
        )
        return {"success": False, "message": str(e)[:300]}


# --- data pull endpoints ---------------------------------------------------

@router.get("/huntress/organizations")
async def list_organizations(current_user: dict = Depends(get_current_user)):
    data = await _get("/v1/organizations", {"limit": 500})
    return data.get("organizations", data) if isinstance(data, dict) else data


@router.get("/huntress/agents")
async def list_agents(
    status: Optional[str] = None,
    platform: Optional[str] = None,
    organization_id: Optional[str] = None,
    limit: int = 500,
    current_user: dict = Depends(get_current_user),
):
    params = {"limit": min(max(1, limit), 500)}
    if status:
        params["status"] = status
    if platform:
        params["platform"] = platform
    if organization_id:
        params["organization_id"] = organization_id
    data = await _get("/v1/agents", params)
    return data.get("agents", data) if isinstance(data, dict) else data


@router.get("/huntress/incident-reports")
async def list_incident_reports(
    severity: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 500,
    current_user: dict = Depends(get_current_user),
):
    params = {"limit": min(max(1, limit), 500)}
    if severity:
        params["severity"] = severity
    if status:
        params["status"] = status
    data = await _get("/v1/incident_reports", params)
    return data.get("incident_reports", data) if isinstance(data, dict) else data


@router.get("/huntress/signals")
async def list_signals(limit: int = 200, current_user: dict = Depends(get_current_user)):
    try:
        data = await _get("/v1/signals", {"limit": min(max(1, limit), 500)})
        return data.get("signals", data) if isinstance(data, dict) else data
    except HTTPException as e:
        if e.status_code in (404, 501):
            return []  # signals endpoint not enabled on this account
        raise


# --- write actions (best-effort against Huntress response APIs) -----------

async def _post(path: str, payload: Optional[dict] = None) -> dict:
    creds = await _get_creds()
    if not creds:
        raise HTTPException(503, "Huntress not configured")
    url = f"{HUNTRESS_BASE_URL}{path}"
    async with httpx.AsyncClient(timeout=30.0, auth=_auth(creds)) as c:
        r = await c.post(url, json=payload or {})
        return {"status_code": r.status_code, "text": r.text, "json": (r.json() if r.content and r.headers.get("content-type","").startswith("application/json") else None)}


async def _try_paths(paths: list, payload: Optional[dict] = None) -> dict:
    """Try a list of candidate paths; return first 2xx or the last non-2xx response."""
    last = None
    for p in paths:
        try:
            res = await _post(p, payload)
            last = res
            if 200 <= res["status_code"] < 300:
                return {"success": True, "path": p, "status_code": res["status_code"], "response": res.get("json") or res.get("text")}
        except HTTPException:
            raise
        except Exception as e:
            last = {"status_code": 0, "text": str(e)[:200]}
    if last is None:
        return {"success": False, "message": "No write path attempted"}
    return {
        "success": False,
        "status_code": last.get("status_code"),
        "message": (last.get("text") or "")[:500] or "Huntress rejected the action",
        "hint": "Huntress may not expose this action on your plan/beta. Check feedback.huntress.com/changelog for response-API status.",
    }


@router.post("/huntress/incident-reports/{incident_id}/action")
async def incident_action(
    incident_id: str,
    data: dict,
    current_user: dict = Depends(get_current_user),
):
    """
    action: close | resolve | assign | comment | acknowledge
    body: { action, assignee, note }
    """
    action = (data or {}).get("action", "").lower()
    note = (data or {}).get("note", "")
    assignee = (data or {}).get("assignee", "")
    if action not in ("close", "resolve", "assign", "comment", "acknowledge"):
        raise HTTPException(400, "action must be close|resolve|assign|comment|acknowledge")

    # Candidate path sets per action — we try each until one succeeds
    path_map = {
        "close":        [f"/v1/incident_reports/{incident_id}/close",
                         f"/v1/incident_reports/{incident_id}/resolve",
                         f"/v1/incident_reports/{incident_id}/responses"],
        "resolve":      [f"/v1/incident_reports/{incident_id}/resolve",
                         f"/v1/incident_reports/{incident_id}/close",
                         f"/v1/incident_reports/{incident_id}/responses"],
        "assign":       [f"/v1/incident_reports/{incident_id}/assign",
                         f"/v1/incident_reports/{incident_id}/assignee"],
        "comment":      [f"/v1/incident_reports/{incident_id}/comments",
                         f"/v1/incident_reports/{incident_id}/notes"],
        "acknowledge":  [f"/v1/incident_reports/{incident_id}/acknowledge",
                         f"/v1/incident_reports/{incident_id}/ack"],
    }
    payload = {}
    if action == "assign" and assignee:
        payload = {"assignee": assignee}
    if action in ("comment", "close", "resolve", "acknowledge") and note:
        payload["note"] = note
        payload["message"] = note

    result = await _try_paths(path_map[action], payload=payload)

    # Mirror the action locally so the dashboard reflects it even if Huntress silently rejects
    now = datetime.now(timezone.utc).isoformat()
    await db.huntress_actions.insert_one({
        "incident_id": incident_id,
        "action": action,
        "payload": payload,
        "result": result,
        "by": current_user.get("name"),
        "by_id": current_user.get("id"),
        "timestamp": now,
    })
    return result


@router.post("/huntress/agents/{agent_id}/isolate")
async def agent_isolate(agent_id: str, data: Optional[dict] = None, current_user: dict = Depends(get_current_user)):
    note = (data or {}).get("note", "") if data else ""
    paths = [
        f"/v1/agents/{agent_id}/isolate",
        f"/v1/agents/{agent_id}/isolation",
        f"/v1/agents/{agent_id}/contain",
    ]
    result = await _try_paths(paths, payload={"note": note} if note else {})
    await db.huntress_actions.insert_one({
        "agent_id": agent_id, "action": "isolate", "result": result,
        "by": current_user.get("name"), "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return result


@router.post("/huntress/agents/{agent_id}/release")
async def agent_release(agent_id: str, data: Optional[dict] = None, current_user: dict = Depends(get_current_user)):
    note = (data or {}).get("note", "") if data else ""
    paths = [
        f"/v1/agents/{agent_id}/release",
        f"/v1/agents/{agent_id}/unisolate",
        f"/v1/agents/{agent_id}/uncontain",
    ]
    result = await _try_paths(paths, payload={"note": note} if note else {})
    await db.huntress_actions.insert_one({
        "agent_id": agent_id, "action": "release", "result": result,
        "by": current_user.get("name"), "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return result


@router.get("/huntress/actions")
async def list_actions(limit: int = 50, current_user: dict = Depends(get_current_user)):
    rows = await db.huntress_actions.find({}, {"_id": 0}).sort("timestamp", -1).to_list(max(1, min(200, limit)))
    return rows


# --- dashboard summary -----------------------------------------------------

@router.get("/huntress/summary")
async def huntress_summary(current_user: dict = Depends(get_current_user)):
    """Aggregated security telemetry powering Security module dashboards."""
    creds = await _get_creds()
    if not creds:
        return {
            "configured": False,
            "message": "Huntress not configured — add API key & secret in Settings → Integrations",
            "stats": {
                "agents_total": 0, "agents_online": 0, "agents_offline": 0,
                "incidents_total": 0, "incidents_critical": 0, "incidents_high": 0, "incidents_low": 0,
                "incidents_open": 0, "incidents_resolved": 0,
                "signals_count": 0, "organizations_count": 0,
            },
        }

    # Fetch in parallel — if signals fails (account doesn't have it), fall back to []
    async def safe(coro):
        try:
            return await coro
        except HTTPException:
            return []
        except Exception:
            return []

    agents, incidents, signals, orgs = await asyncio.gather(
        safe(_get("/v1/agents", {"limit": 500})),
        safe(_get("/v1/incident_reports", {"limit": 500})),
        safe(_get("/v1/signals", {"limit": 500})),
        safe(_get("/v1/organizations", {"limit": 500})),
    )

    agents_list = agents.get("agents", []) if isinstance(agents, dict) else (agents or [])
    incidents_list = incidents.get("incident_reports", []) if isinstance(incidents, dict) else (incidents or [])
    signals_list = signals.get("signals", []) if isinstance(signals, dict) else (signals or [])
    orgs_list = orgs.get("organizations", []) if isinstance(orgs, dict) else (orgs or [])

    def norm(v: str) -> str:
        return (v or "").lower()

    stats = {
        "agents_total": len(agents_list),
        "agents_online": sum(1 for a in agents_list if norm(a.get("status")) == "online"),
        "agents_offline": sum(1 for a in agents_list if norm(a.get("status")) == "offline"),
        "incidents_total": len(incidents_list),
        "incidents_critical": sum(1 for i in incidents_list if norm(i.get("severity")) in ("critical", "high")),
        "incidents_high": sum(1 for i in incidents_list if norm(i.get("severity")) == "high"),
        "incidents_low": sum(1 for i in incidents_list if norm(i.get("severity")) == "low"),
        "incidents_open": sum(1 for i in incidents_list if norm(i.get("status")) in ("sent", "open", "reviewing")),
        "incidents_resolved": sum(1 for i in incidents_list if norm(i.get("status")) in ("resolved", "closed")),
        "signals_count": len(signals_list),
        "organizations_count": len(orgs_list),
    }

    # Cache last synced stamp
    now = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one(
        {"type": SETTINGS_KEY},
        {"$set": {"last_synced_at": now, "last_synced_stats": stats}},
    )

    # Top 5 most recent incidents (by detected_at or created_at)
    def ts(i): return i.get("detected_at") or i.get("created_at") or ""
    recent = sorted(incidents_list, key=ts, reverse=True)[:10]
    recent_slim = [{
        "id": i.get("id"),
        "severity": i.get("severity"),
        "status": i.get("status"),
        "summary": i.get("summary") or i.get("title"),
        "organization": i.get("organization_name") or i.get("organization_id"),
        "hostname": i.get("agent_hostname") or i.get("hostname"),
        "detected_at": ts(i),
    } for i in recent]

    # Per-org breakdown: agents + incidents grouped by organization_id / name
    org_map: dict = {}
    for o in orgs_list:
        oid = o.get("id") or o.get("organization_id")
        if oid is None:
            continue
        org_map[oid] = {
            "id": oid,
            "name": o.get("name") or o.get("organization_name") or f"Org {oid}",
            "agents_total": 0, "agents_online": 0, "agents_offline": 0,
            "incidents_total": 0, "incidents_critical": 0, "incidents_open": 0,
        }
    for a in agents_list:
        oid = a.get("organization_id")
        if oid is None:
            continue
        row = org_map.setdefault(oid, {"id": oid, "name": f"Org {oid}", "agents_total": 0, "agents_online": 0, "agents_offline": 0, "incidents_total": 0, "incidents_critical": 0, "incidents_open": 0})
        row["agents_total"] += 1
        if norm(a.get("status")) == "online":
            row["agents_online"] += 1
        elif norm(a.get("status")) == "offline":
            row["agents_offline"] += 1
    for i in incidents_list:
        oid = i.get("organization_id")
        if oid is None:
            continue
        row = org_map.setdefault(oid, {"id": oid, "name": i.get("organization_name") or f"Org {oid}", "agents_total": 0, "agents_online": 0, "agents_offline": 0, "incidents_total": 0, "incidents_critical": 0, "incidents_open": 0})
        row["incidents_total"] += 1
        if norm(i.get("severity")) in ("critical", "high"):
            row["incidents_critical"] += 1
        if norm(i.get("status")) in ("sent", "open", "reviewing"):
            row["incidents_open"] += 1

    per_org = sorted(
        org_map.values(),
        key=lambda r: (-r["incidents_critical"], -r["incidents_open"], -r["agents_offline"], r["name"]),
    )[:20]

    # Severity mix for chart
    sev_mix = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for i in incidents_list:
        s = norm(i.get("severity"))
        if s in sev_mix:
            sev_mix[s] += 1

    # Recent signals (up to 5)
    recent_signals = sorted(signals_list, key=lambda s: s.get("created_at") or s.get("detected_at") or "", reverse=True)[:5]
    recent_signals_slim = [{
        "id": s.get("id"),
        "kind": s.get("signal_type") or s.get("kind"),
        "severity": s.get("severity"),
        "summary": s.get("summary") or s.get("title"),
        "detected_at": s.get("created_at") or s.get("detected_at"),
    } for s in recent_signals]

    return {
        "configured": True,
        "stats": stats,
        "recent_incidents": recent_slim,
        "per_org": per_org,
        "severity_mix": sev_mix,
        "recent_signals": recent_signals_slim,
        "last_synced_at": now,
    }
