"""
Advanced Acronis backup operations:
  - Orphan detection (resources without active backup policy, or stale-but-still-billing)
  - Agent health snapshots (online/offline/stale)
  - Alert management (dismiss, deep-link to Acronis console)
  - Live activity feed with progress %
"""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
from typing import Optional
import httpx
from app.database import db
from app.auth import get_current_user
from app.services.integrations import acronis_service

router = APIRouter()


@router.get("/acronis/orphans")
async def detect_acronis_orphans(stale_days: int = 30, current_user: dict = Depends(get_current_user)):
    """
    Detect orphaned backup data:
      - Resources with no active backup policy (exists but unprotected)
      - Resources whose last successful backup is older than `stale_days`
      - Applications referencing non-existent / removed resources
      - Agents marked offline > 30d but still consuming storage
    """
    try:
        # Pull resources, statuses, applications, agents in parallel
        resources_data = await acronis_service.get_resources()
        statuses_data = await acronis_service.get_resource_statuses()
        apps_data = await acronis_service.get_applications()
        agents_data = await acronis_service.get_agents()

        resources = resources_data.get("items", []) if isinstance(resources_data, dict) else []
        statuses = statuses_data.get("items", []) if isinstance(statuses_data, dict) else []
        flat_apps = acronis_service.flatten_applications(apps_data)
        agents = agents_data.get("items", []) if isinstance(agents_data, dict) else []

        # Build maps
        resource_map = {r.get("id"): r for r in resources if isinstance(r, dict)}
        status_map = {s.get("id"): s for s in statuses if isinstance(s, dict)}

        # Map: resource_id -> active backup applications
        backup_apps_by_resource = {}
        for app in flat_apps:
            if not isinstance(app, dict) or not app.get("enabled", True):
                continue
            ctx_id = (app.get("context", {}) or {}).get("id", "")
            ptype = (app.get("policy", {}) or {}).get("type", "") or ""
            if "backup" in ptype and ctx_id:
                backup_apps_by_resource.setdefault(ctx_id, []).append(app)

        now = datetime.now(timezone.utc)
        stale_cutoff = now - timedelta(days=stale_days)

        unprotected = []   # resource exists but has no active backup app
        stale = []         # resource has backup app but last successful backup is old
        zombie_apps = []   # backup application references missing resource
        offline_consuming = []  # agent offline > 30d but still in inventory

        for res in resources:
            if not isinstance(res, dict):
                continue
            rid = res.get("id")
            rname = res.get("name", rid or "unknown")
            rtype = res.get("type", "unknown")
            if not rid:
                continue
            apps = backup_apps_by_resource.get(rid, [])
            status = status_map.get(rid, {})
            last_backup = status.get("last_successful_run") or status.get("last_run")

            if not apps:
                unprotected.append({
                    "resource_id": rid,
                    "resource_name": rname,
                    "resource_type": rtype,
                    "tenant_name": res.get("tenant_name", ""),
                    "issue": "No backup policy assigned",
                    "severity": "high",
                    "last_seen": res.get("last_login_time") or res.get("updated_at"),
                })
                continue

            # Stale check
            if last_backup:
                try:
                    lb_dt = datetime.fromisoformat(last_backup.replace("Z", "+00:00"))
                    if lb_dt < stale_cutoff:
                        days_stale = (now - lb_dt).days
                        stale.append({
                            "resource_id": rid,
                            "resource_name": rname,
                            "resource_type": rtype,
                            "tenant_name": res.get("tenant_name", ""),
                            "last_backup": last_backup,
                            "days_stale": days_stale,
                            "policy_count": len(apps),
                            "issue": f"No successful backup in {days_stale} days",
                            "severity": "critical" if days_stale > 60 else "high",
                        })
                except (ValueError, TypeError):
                    pass

        # Zombie applications
        for app in flat_apps:
            if not isinstance(app, dict):
                continue
            ctx = app.get("context", {}) or {}
            ctx_id = ctx.get("id")
            ptype = (app.get("policy", {}) or {}).get("type", "") or ""
            if "backup" not in ptype:
                continue
            if ctx_id and ctx_id not in resource_map:
                zombie_apps.append({
                    "application_id": app.get("id"),
                    "policy_id": (app.get("policy", {}) or {}).get("id"),
                    "policy_name": (app.get("policy", {}) or {}).get("name", ""),
                    "missing_resource_id": ctx_id,
                    "missing_resource_name": ctx.get("resourceName", "(unknown)"),
                    "issue": "Backup plan references missing resource",
                    "severity": "medium",
                })

        # Offline agents that may still be consuming storage
        for ag in agents:
            if not isinstance(ag, dict):
                continue
            online = ag.get("online")
            last_seen = ag.get("last_connection_time") or ag.get("updated_at")
            if online is False and last_seen:
                try:
                    ls_dt = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
                    days_offline = (now - ls_dt).days
                    if days_offline > 30:
                        offline_consuming.append({
                            "agent_id": ag.get("id"),
                            "agent_name": ag.get("name", ag.get("hostname", ag.get("id"))),
                            "tenant_name": ag.get("tenant_name", ""),
                            "last_seen": last_seen,
                            "days_offline": days_offline,
                            "version": ag.get("version", ""),
                            "issue": f"Agent offline {days_offline} days — storage may still be billed",
                            "severity": "medium" if days_offline < 90 else "high",
                        })
                except (ValueError, TypeError):
                    pass

        total = len(unprotected) + len(stale) + len(zombie_apps) + len(offline_consuming)

        return {
            "scanned_at": now.isoformat(),
            "stale_threshold_days": stale_days,
            "totals": {
                "unprotected": len(unprotected),
                "stale": len(stale),
                "zombie_apps": len(zombie_apps),
                "offline_consuming": len(offline_consuming),
                "total_orphans": total,
            },
            "unprotected": unprotected,
            "stale": stale,
            "zombie_apps": zombie_apps,
            "offline_consuming": offline_consuming,
            "data_source": "live",
        }
    except Exception as e:
        return {
            "scanned_at": datetime.now(timezone.utc).isoformat(),
            "totals": {"total_orphans": 0, "unprotected": 0, "stale": 0, "zombie_apps": 0, "offline_consuming": 0},
            "unprotected": [], "stale": [], "zombie_apps": [], "offline_consuming": [],
            "data_source": "error",
            "error": str(e),
        }


@router.get("/acronis/agents/health")
async def get_acronis_agents_health(current_user: dict = Depends(get_current_user)):
    """Get all agents with online/offline/stale categorization."""
    try:
        agents_data = await acronis_service.get_agents()
        agents = agents_data.get("items", []) if isinstance(agents_data, dict) else []
        now = datetime.now(timezone.utc)
        online = []
        offline = []
        stale = []  # offline > 24h
        for ag in agents:
            if not isinstance(ag, dict):
                continue
            is_online = ag.get("online", False)
            last_seen_raw = ag.get("last_connection_time") or ag.get("updated_at")
            days_offline = None
            hours_offline = None
            if last_seen_raw:
                try:
                    ls = datetime.fromisoformat(last_seen_raw.replace("Z", "+00:00"))
                    delta = now - ls
                    days_offline = delta.days
                    hours_offline = round(delta.total_seconds() / 3600, 1)
                except (ValueError, TypeError):
                    pass
            row = {
                "id": ag.get("id"),
                "name": ag.get("name") or ag.get("hostname") or ag.get("id"),
                "hostname": ag.get("hostname"),
                "tenant_name": ag.get("tenant_name", ""),
                "version": ag.get("version", ""),
                "platform": ag.get("platform", {}) if isinstance(ag.get("platform"), dict) else {"name": ag.get("platform", "")},
                "online": is_online,
                "last_seen": last_seen_raw,
                "hours_offline": hours_offline,
                "days_offline": days_offline,
            }
            if is_online:
                online.append(row)
            elif hours_offline and hours_offline > 24:
                stale.append(row)
            else:
                offline.append(row)
        return {
            "summary": {
                "total": len(agents),
                "online": len(online),
                "offline_recent": len(offline),
                "stale": len(stale),
                "online_pct": round((len(online) / len(agents) * 100) if agents else 0, 1),
            },
            "online": online,
            "offline_recent": offline,
            "stale": stale,
        }
    except Exception as e:
        return {"summary": {}, "online": [], "offline_recent": [], "stale": [], "error": str(e)}


@router.post("/acronis/alerts/{alert_id}/dismiss")
async def dismiss_acronis_alert(alert_id: str, current_user: dict = Depends(get_current_user)):
    """Mark an alert as handled in Acronis."""
    try:
        token = await acronis_service.get_token()
        api_url, _, _ = await acronis_service.get_credentials()
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{api_url}/api/alert_manager/v1/alerts/{alert_id}/handled",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code in (200, 202, 204):
                return {"status": "dismissed", "alert_id": alert_id}
            raise HTTPException(status_code=resp.status_code, detail=f"Acronis returned {resp.status_code}: {resp.text[:200]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Dismiss failed: {str(e)}")


@router.get("/acronis/console-link")
async def get_acronis_console_deep_link(resource_id: Optional[str] = None, alert_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Build a deep-link URL into the Acronis Cloud console (UI)."""
    api_url, _, _ = await acronis_service.get_credentials()
    if not api_url:
        return {"url": None, "error": "Acronis not configured"}
    base = api_url.replace("/api", "").rstrip("/")
    # Acronis Cloud UI typically serves at the same datacenter base URL
    if resource_id:
        return {"url": f"{base}/mc/devices?id={resource_id}"}
    if alert_id:
        return {"url": f"{base}/mc/alerts?id={alert_id}"}
    return {"url": f"{base}/mc"}


@router.get("/acronis/live-activities")
async def get_live_acronis_activities(current_user: dict = Depends(get_current_user)):
    """Live activities focused on running/in-progress backups for the animated UI."""
    try:
        resp = await acronis_service._get(
            "/api/task_manager/v2/activities?limit=100&order=desc(startedAt)"
        )
        if resp.status_code != 200:
            return {"running": [], "recent": [], "stats": {}}
        items = resp.json().get("items", [])
        running = []
        recent = []
        for a in items:
            ctx = a.get("context", {}) or {}
            tenant = a.get("tenant", {}) or {}
            policy = a.get("policy", {}) or {}
            progress_obj = a.get("progress", {}) if isinstance(a.get("progress"), dict) else {}
            row = {
                "id": a.get("idString", a.get("uuid", "")),
                "state": a.get("state", ""),
                "phase": ctx.get("phase") or progress_obj.get("currentStepName") or "",
                "resource_id": ctx.get("id") or ctx.get("resourceId"),
                "resource_name": ctx.get("resourceName", ""),
                "resource_type": ctx.get("resourceKind", ""),
                "activity_type": ctx.get("activityType", ""),
                "policy_id": policy.get("id") or ctx.get("policyId"),
                "plan_name": policy.get("name", ctx.get("policyName", "")),
                "tenant_name": tenant.get("name", ""),
                "started_at": a.get("startedAt", ""),
                "completed_at": a.get("completedAt", ""),
                "progress": progress_obj.get("current", 0) or progress_obj.get("percentage", 0),
                "transferred_bytes": progress_obj.get("transferredBytes", 0),
                "total_bytes": progress_obj.get("totalBytes", 0),
                "speed_bps": progress_obj.get("rate", 0),
            }
            state = (row["state"] or "").lower()
            if state in ("running", "in_progress", "running_v2"):
                running.append(row)
            else:
                recent.append(row)
        recent = recent[:30]
        states = {}
        for a in items:
            s = (a.get("state") or "unknown").lower()
            states[s] = states.get(s, 0) + 1
        return {
            "running": running,
            "recent": recent,
            "stats": {
                "running_count": len(running),
                "by_state": states,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            },
        }
    except Exception as e:
        return {"running": [], "recent": [], "stats": {}, "error": str(e)}


# ============================================================================
# Backup operations: Run / Cancel / Apply Plan / Remove Plan / List Policies
# ============================================================================

@router.post("/acronis/backup/run")
async def run_backup_now(body: dict, current_user: dict = Depends(get_current_user)):
    """Run a backup plan now for the given resources.
    Body: {"policy_id": "...", "resource_ids": ["..."]}
    """
    policy_id = (body or {}).get("policy_id")
    resource_ids = (body or {}).get("resource_ids") or []
    if not policy_id or not resource_ids:
        raise HTTPException(status_code=400, detail="policy_id and resource_ids required")
    try:
        results = await acronis_service.run_applications([{"policy_id": policy_id, "resource_ids": resource_ids}])
        ok = bool(results) and (results[0].get("status_code") in (200, 202, 204))
        return {"status": "started" if ok else "failed", "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Run failed: {str(e)}")


@router.post("/acronis/backup/cancel")
async def cancel_backup(body: dict, current_user: dict = Depends(get_current_user)):
    """Stop a running backup plan for the given resources.
    Body: {"policy_id": "...", "resource_ids": ["..."]}
    Acronis only supports stopping (no pause). Same endpoint as run, with state: stopped.
    """
    policy_id = (body or {}).get("policy_id")
    resource_ids = (body or {}).get("resource_ids") or []
    if not policy_id or not resource_ids:
        raise HTTPException(status_code=400, detail="policy_id and resource_ids required")
    try:
        token = await acronis_service.get_token()
        api_url, _, _ = await acronis_service.get_credentials()
        url = f"{api_url}/api/policy_management/v4/applications/run"
        payload = {"items": resource_ids, "state": "stopped", "policy_id": policy_id}
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.put(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=payload,
            )
            if resp.status_code in (200, 202, 204):
                return {"status": "cancelled", "policy_id": policy_id, "resource_count": len(resource_ids)}
            raise HTTPException(status_code=resp.status_code, detail=f"Acronis: {resp.text[:300]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cancel failed: {str(e)}")


@router.get("/acronis/policies")
async def list_acronis_policies(policy_type: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """List backup policies (plans) available in this Acronis tenant.
    Optional filter: policy_type=policy.backup.machine, policy.backup.virtual_machine, etc.
    """
    try:
        token = await acronis_service.get_token()
        api_url, _, _ = await acronis_service.get_credentials()
        url = f"{api_url}/api/policy_management/v4/policies?include_settings=true"
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {token}"})
            if resp.status_code != 200:
                return {"items": [], "error": f"{resp.status_code}: {resp.text[:200]}"}
            data = resp.json()
            raw_items = data.get("items", [])
            # Acronis wraps each policy under a "policy" array
            backup_items = []
            for wrapper in raw_items:
                if not isinstance(wrapper, dict):
                    continue
                policy_list = wrapper.get("policy")
                # Some endpoints return policy as a list; some as direct dict
                policies = policy_list if isinstance(policy_list, list) else [wrapper]
                for p in policies:
                    if not isinstance(p, dict):
                        continue
                    ptype = p.get("type", "") or ""
                    if policy_type and ptype != policy_type:
                        continue
                    # Default: only show real backup plans (not security scanning, EDR, etc.)
                    if not policy_type and not ptype.startswith("policy.backup."):
                        continue
                    if not p.get("name"):
                        continue  # skip unnamed sub-plans like CDP shadow records
                    backup_items.append({
                        "id": p.get("id"),
                        "name": p.get("name"),
                        "type": ptype,
                        "tenant_id": p.get("tenant_id"),
                        "tenant_name": p.get("tenant_name", ""),
                        "enabled": p.get("enabled", True),
                        "created_at": p.get("created_at"),
                        "updated_at": p.get("updated_at"),
                    })
            return {"items": backup_items, "count": len(backup_items)}
    except Exception as e:
        return {"items": [], "error": str(e)}


@router.post("/acronis/policies/apply")
async def apply_acronis_policy(body: dict, current_user: dict = Depends(get_current_user)):
    """Apply (assign) a backup policy to one or more resources.
    Body: {"policy_id": "...", "resource_ids": ["..."], "run_now": false}
    Creates an application binding via POST /api/policy_management/v4/applications.
    Optionally triggers an immediate run.
    """
    policy_id = (body or {}).get("policy_id")
    resource_ids = (body or {}).get("resource_ids") or []
    run_now = bool((body or {}).get("run_now", False))
    if not policy_id or not resource_ids:
        raise HTTPException(status_code=400, detail="policy_id and resource_ids required")
    try:
        token = await acronis_service.get_token()
        api_url, _, _ = await acronis_service.get_credentials()
        url = f"{api_url}/api/policy_management/v4/applications"
        results = []
        async with httpx.AsyncClient(timeout=30.0) as client:
            for rid in resource_ids:
                payload = {"policy_id": policy_id, "context": {"id": rid}, "enabled": True}
                resp = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json=payload,
                )
                results.append({
                    "resource_id": rid,
                    "status_code": resp.status_code,
                    "body": resp.text[:300] if resp.status_code >= 400 else "ok",
                    "application_id": (resp.json() or {}).get("id") if resp.status_code in (200, 201) else None,
                })

        ok_count = sum(1 for r in results if r["status_code"] in (200, 201))

        # Optionally trigger an immediate run
        run_result = None
        if run_now and ok_count > 0:
            run_result = await acronis_service.run_applications([{"policy_id": policy_id, "resource_ids": resource_ids}])

        return {
            "status": "applied" if ok_count == len(resource_ids) else "partial",
            "applied_count": ok_count,
            "total": len(resource_ids),
            "results": results,
            "run_result": run_result,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Apply policy failed: {str(e)}")


@router.delete("/acronis/applications/{application_id}")
async def remove_acronis_application(application_id: str, current_user: dict = Depends(get_current_user)):
    """Remove (unassign) a backup plan from a resource."""
    try:
        token = await acronis_service.get_token()
        api_url, _, _ = await acronis_service.get_credentials()
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.delete(
                f"{api_url}/api/policy_management/v4/applications/{application_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code in (200, 202, 204):
                return {"status": "removed", "application_id": application_id}
            raise HTTPException(status_code=resp.status_code, detail=f"Acronis: {resp.text[:300]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Remove failed: {str(e)}")


@router.get("/acronis/resources/{resource_id}/applications")
async def get_resource_applications(resource_id: str, current_user: dict = Depends(get_current_user)):
    """Get all backup plans currently assigned to a resource."""
    try:
        token = await acronis_service.get_token()
        api_url, _, _ = await acronis_service.get_credentials()
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                f"{api_url}/api/policy_management/v4/applications?context_id={resource_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code != 200:
                return {"items": [], "error": f"{resp.status_code}: {resp.text[:200]}"}
            data = resp.json()
            items = []
            for app in data.get("items", []):
                if not isinstance(app, dict):
                    continue
                policy = app.get("policy", {}) or {}
                items.append({
                    "application_id": app.get("id"),
                    "policy_id": policy.get("id"),
                    "policy_name": policy.get("name"),
                    "policy_type": policy.get("type"),
                    "enabled": app.get("enabled", True),
                    "state": app.get("state"),
                })
            return {"items": items, "count": len(items)}
    except Exception as e:
        return {"items": [], "error": str(e)}
