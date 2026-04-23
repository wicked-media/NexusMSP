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
    recent = sorted(incidents_list, key=ts, reverse=True)[:5]
    recent_slim = [{
        "id": i.get("id"),
        "severity": i.get("severity"),
        "status": i.get("status"),
        "summary": i.get("summary") or i.get("title"),
        "organization": i.get("organization_name") or i.get("organization_id"),
        "detected_at": ts(i),
    } for i in recent]

    return {
        "configured": True,
        "stats": stats,
        "recent_incidents": recent_slim,
        "last_synced_at": now,
    }
