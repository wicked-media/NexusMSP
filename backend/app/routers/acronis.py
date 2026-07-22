from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
import os
from app.database import db
from app.auth import get_current_user
from app.services.integrations import acronis_service

router = APIRouter()


async def _record_acronis_activity(
    current_user: dict,
    action: str,
    entity_type: str,
    entity_id: str,
    entity_name: str,
    details: str,
    metadata: Optional[dict] = None,
):
    """Write a best-effort audit event without masking the primary operation."""
    try:
        await db.activity_logs.insert_one({
            "id": str(uuid.uuid4()),
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "entity_name": entity_name,
            "user_id": current_user.get("id", ""),
            "user_name": current_user.get("name") or current_user.get("email", ""),
            "details": details,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "metadata": metadata or {},
        })
    except Exception:
        pass


# ============== ACRONIS LIVE INTEGRATION ==============


@router.get("/acronis/config")
async def get_acronis_config(current_user: dict = Depends(get_current_user)):
    """Get Acronis connection configuration (masked secrets)."""
    api_url = os.environ.get("ACRONIS_API_URL", "")
    client_id = os.environ.get("ACRONIS_CLIENT_ID", "")
    has_secret = bool(os.environ.get("ACRONIS_CLIENT_SECRET", ""))
    # Also check DB
    config = await db.settings.find_one({"key": "acronis_config"}, {"_id": 0})
    db_val = config.get("value", {}) if config else {}
    configured_api_url = api_url or db_val.get("api_url", "")
    configured_client_id = client_id or db_val.get("client_id", "")
    configured_has_secret = has_secret or bool(db_val.get("client_secret"))
    return {
        "api_url": configured_api_url,
        "client_id": configured_client_id,
        "has_secret": configured_has_secret,
        # `connected` is preserved for existing callers. `configured` makes it
        # explicit that saved credentials still need a successful test call.
        "connected": bool(api_url and client_id and has_secret),
        "configured": bool(configured_api_url and configured_client_id and configured_has_secret),
    }


@router.post("/acronis/config")
async def save_acronis_config(data: dict, current_user: dict = Depends(get_current_user)):
    """Save Acronis API configuration to DB (env vars take precedence)."""
    await db.settings.update_one(
        {"key": "acronis_config"},
        {"$set": {"key": "acronis_config", "value": data, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "Acronis configuration saved"}


@router.get("/acronis/test-connection")
async def test_acronis_connection(current_user: dict = Depends(get_current_user)):
    """Test Acronis API connection by authenticating."""
    try:
        token = await acronis_service.authenticate()
        return {"status": "connected", "message": "Successfully authenticated with Acronis Cyber Cloud"}
    except Exception as e:
        return {"status": "failed", "message": str(e)}


@router.get("/acronis/tenants")
async def get_acronis_tenants(current_user: dict = Depends(get_current_user)):
    """Get all tenants from Acronis (partner view — shows all customer tenants)."""
    try:
        data = await acronis_service.get_tenants()
        items = data.get("items", [])
        # Filter to customer-type tenants
        tenants = []
        for t in items:
            tenants.append({
                "id": t.get("id", ""),
                "name": t.get("name", ""),
                "kind": t.get("kind", ""),
                "enabled": t.get("enabled", True),
                "brand_id": t.get("brand_id"),
                "customer_type": t.get("customer_type", ""),
                "mfa_status": t.get("mfa_status", ""),
                "pricing_mode": t.get("pricing_mode", ""),
                "parent_id": t.get("parent_id", ""),
                "has_children": t.get("has_children", False),
            })
        return {"tenants": tenants, "total": len(tenants)}
    except Exception as e:
        return {"tenants": [], "total": 0, "error": str(e)}


@router.get("/acronis/customers")
async def get_acronis_customers(current_user: dict = Depends(get_current_user)):
    """Get Acronis customer tenants with linked NexusOps clients."""
    # First try to get from cache/DB
    cached = await db.acronis_customers.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    if cached:
        return cached

    # Fetch from API
    try:
        data = await acronis_service.get_tenants()
        items = data.get("items", [])
        customers = []
        for t in items:
            kind = t.get("kind", "")
            if kind not in ("customer", "unit"):
                continue
            # Check if linked to a NexusOps client
            linked = await db.acronis_customer_links.find_one({"acronis_tenant_id": t["id"]}, {"_id": 0})
            customers.append({
                "id": f"acr-{t['id'][:12]}",
                "acronis_tenant_id": t.get("id", ""),
                "name": t.get("name", ""),
                "kind": kind,
                "enabled": t.get("enabled", True),
                "linked_client_id": linked.get("client_id", "") if linked else "",
                "linked_client_name": linked.get("client_name", "") if linked else "",
                "status": "active" if t.get("enabled", True) else "disabled",
                "last_sync": datetime.now(timezone.utc).isoformat(),
            })
        return customers
    except Exception as e:
        # Fallback to seed data
        clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(10)
        import random
        rng = random.SystemRandom()
        return [{
            "id": f"acr-demo-{i}",
            "acronis_tenant_id": f"demo-{uuid.uuid4().hex[:12]}",
            "name": c.get("name", f"Customer {i}"),
            "kind": "customer",
            "enabled": True,
            "linked_client_id": c.get("id", ""),
            "linked_client_name": c.get("name", ""),
            "status": "active",
            "edition": rng.choice(["Cyber Protect", "Cyber Protect Essentials"]),
            "total_devices": rng.randint(3, 50),
            "protected_devices": rng.randint(2, 40),
            "storage_used_gb": round(rng.uniform(10, 500), 1),
            "last_sync": datetime.now(timezone.utc).isoformat(),
            "error": str(e),
        } for i, c in enumerate(clients)]


@router.post("/acronis/customers/{customer_id}/link")
async def link_acronis_customer(customer_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Link an Acronis tenant to a NexusOps client."""
    client_id = data.get("client_id")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    acronis_tenant_id = data.get("acronis_tenant_id", customer_id)
    await db.acronis_customer_links.update_one(
        {"acronis_tenant_id": acronis_tenant_id},
        {"$set": {
            "acronis_tenant_id": acronis_tenant_id,
            "client_id": client_id,
            "client_name": client.get("name", ""),
            "linked_at": datetime.now(timezone.utc).isoformat(),
            "linked_by": current_user.get("name", ""),
        }},
        upsert=True
    )
    return {"message": f"Linked to {client.get('name', '')}"}



@router.get("/acronis/backup-statuses")
async def get_acronis_backup_statuses(current_user: dict = Depends(get_current_user)):
    """Get backup status per machine from Acronis — grouped by tenant.
    Includes last backup time, status, applied plans, next run, agent online state."""
    try:
        resp = await acronis_service.get_resource_statuses()
        items = resp.get("items", [])

        # Fetch agents to map online status
        agent_online_map = {}
        try:
            agents_data = await acronis_service.get_agents()
            for ag in agents_data.get("items", []):
                agent_online_map[ag.get("id", "")] = bool(ag.get("online", False))
        except Exception:
            pass

        # Fetch all backup applications to map resource_id -> [application_ids]
        resource_to_app_ids = {}
        try:
            apps_data = await acronis_service.get_applications()
            flat_apps = acronis_service.flatten_applications(apps_data)
            for app in flat_apps:
                if not isinstance(app, dict):
                    continue
                if not app.get("enabled", True):
                    continue
                policy_type = (app.get("policy", {}) or {}).get("type", "") or ""
                if "backup" not in policy_type:
                    continue
                ctx_id = (app.get("context", {}) or {}).get("id", "")
                app_id = app.get("id")
                if not (ctx_id and app_id):
                    continue
                resource_to_app_ids.setdefault(ctx_id, []).append(app_id)
        except Exception:
            pass

        machines = []
        for item in items:
            ctx = item.get("context", {})
            if ctx.get("type") != "resource.machine":
                continue
            agg = item.get("aggregate", {})
            policies = item.get("policies", [])
            backup_policies = [p for p in policies if "backup" in (p.get("type", "") or "")]

            last_run = None
            last_success = None
            next_run = None
            plan_names = agg.get("names", "")

            backup_application_ids = []
            for bp in backup_policies:
                lr = bp.get("last_run")
                ls = bp.get("last_success_run")
                nr = bp.get("next_run")
                if lr and (not last_run or lr > last_run):
                    last_run = lr
                if ls and (not last_success or ls > last_success):
                    last_success = ls
                if nr and (not next_run or nr < next_run):
                    next_run = nr

            # Attach application IDs from the applications-map (source of truth for /run)
            resource_id_for_apps = ctx.get("id", "")
            backup_application_ids = resource_to_app_ids.get(resource_id_for_apps, [])

            # Determine backup health
            status = agg.get("status", "unknown")
            if status == "idle" and last_success:
                backup_health = "ok"
            elif status in ("ok", "idle"):
                backup_health = "ok"
            elif status in ("error", "critical"):
                backup_health = "failed"
            elif status == "warning":
                backup_health = "warning"
            else:
                backup_health = status

            agent_id = ctx.get("agent_id", "")
            agent_online = agent_online_map.get(agent_id) if agent_id in agent_online_map else None

            machines.append({
                "resource_id": ctx.get("id", ""),
                "machine_name": ctx.get("name") or ctx.get("user_defined_name", "Unknown"),
                "tenant_id": ctx.get("tenant_id", ""),
                "tenant_name": ctx.get("tenant_name", ""),
                "agent_id": agent_id,
                "agent_online": agent_online,
                "backup_health": backup_health,
                "aggregate_status": status,
                "plan_names": plan_names,
                "last_backup": last_run,
                "last_success": last_success,
                "next_backup": next_run,
                "policy_count": len(backup_policies),
                "backup_application_ids": backup_application_ids,
                "all_policies": [{"type": p.get("type", ""), "last_run": p.get("last_run"), "next_run": p.get("next_run")} for p in policies],
                "licensing": item.get("licensing", {}).get("current_offering_item", ""),
            })

        machines.sort(key=lambda x: x["tenant_name"])

        # Group by tenant for summary
        tenant_summary = {}
        for m in machines:
            tn = m["tenant_name"]
            if tn not in tenant_summary:
                tenant_summary[tn] = {"total": 0, "ok": 0, "failed": 0, "warning": 0}
            tenant_summary[tn]["total"] += 1
            if m["backup_health"] == "ok":
                tenant_summary[tn]["ok"] += 1
            elif m["backup_health"] == "failed":
                tenant_summary[tn]["failed"] += 1
            elif m["backup_health"] == "warning":
                tenant_summary[tn]["warning"] += 1

        return {
            "machines": machines,
            "tenant_summary": tenant_summary,
            "total_machines": len(machines),
            "healthy": len([m for m in machines if m["backup_health"] == "ok"]),
            "failed": len([m for m in machines if m["backup_health"] == "failed"]),
            "warning": len([m for m in machines if m["backup_health"] == "warning"]),
        }
    except Exception as e:
        return {"machines": [], "tenant_summary": {}, "total_machines": 0, "error": str(e)}


@router.post("/acronis/backup/run")
async def run_acronis_backup(data: dict, current_user: dict = Depends(get_current_user)):
    """Trigger a manual backup run on one or more machines.
    Body accepts either:
      - {"application_ids": [...]}  (preferred, from backup-statuses)
      - {"resource_id": "..."}      (auto-discovers backup applications for the resource)
    """
    application_ids = list(data.get("application_ids") or [])
    resource_id = data.get("resource_id")

    try:
        # Load all applications once
        apps_data = await acronis_service.get_applications()
        flat_apps = acronis_service.flatten_applications(apps_data)

        # If only resource_id, discover backup app_ids
        if not application_ids and resource_id:
            for app in flat_apps:
                if not isinstance(app, dict) or not app.get("enabled", True):
                    continue
                ctx_id = (app.get("context", {}) or {}).get("id", "")
                if ctx_id != resource_id:
                    continue
                ptype = (app.get("policy", {}) or {}).get("type", "") or ""
                if "backup" in ptype:
                    aid = app.get("id")
                    if aid:
                        application_ids.append(aid)

        if not application_ids:
            raise HTTPException(
                status_code=400,
                detail="No active backup plan found for this machine. Apply a backup plan first."
            )

        # Build map: app_id -> (policy_id, resource_id)
        app_lookup = {}
        for app in flat_apps:
            if isinstance(app, dict) and app.get("id"):
                app_lookup[app["id"]] = {
                    "policy_id": (app.get("policy", {}) or {}).get("id"),
                    "resource_id": (app.get("context", {}) or {}).get("id"),
                }

        # Group resource_ids by policy_id
        grouped = {}
        missing = []
        for aid in application_ids:
            info = app_lookup.get(aid)
            if not info or not info.get("policy_id") or not info.get("resource_id"):
                missing.append(aid)
                continue
            grouped.setdefault(info["policy_id"], []).append(info["resource_id"])

        if not grouped:
            raise HTTPException(status_code=400, detail="Unable to resolve backup plan details for the given applications")

        runs = [{"policy_id": pid, "resource_ids": rids} for pid, rids in grouped.items()]
        results = await acronis_service.run_applications(runs)

        succeeded = [r for r in results if r.get("status_code") in (200, 202, 204)]
        # Acronis often returns 500 with "Zmqgw" dispatcher errors when some agents are
        # unreachable — but the run IS queued for reachable agents. Treat as partial success.
        zmqgw_partial = [r for r in results if r.get("status_code") == 500 and "Zmqgw" in (r.get("body") or "")]
        failed = [r for r in results if r not in succeeded and r not in zmqgw_partial]

        if not succeeded and not zmqgw_partial and failed:
            first = failed[0]
            raise HTTPException(
                status_code=first.get("status_code", 500),
                detail=f"Acronis run failed: {first.get('body')}"
            )

        triggered = len(succeeded) + len(zmqgw_partial)
        msg = f"Triggered {triggered} backup plan(s)"
        if zmqgw_partial:
            msg += " — some agents may be unreachable; check Activities tab"
        if failed:
            msg += f", {len(failed)} failed"

        response = {
            "status": "triggered" if not failed else "partial",
            "triggered_plans": triggered,
            "failed_plans": len(failed),
            "message": msg,
            "results": results,
        }
        await _record_acronis_activity(
            current_user,
            "acronis_backup_run",
            "backup_run",
            resource_id or (application_ids[0] if application_ids else "acronis-backup-run"),
            resource_id or f"{len(application_ids)} backup application(s)",
            msg,
            {
                "application_ids": application_ids,
                "resource_id": resource_id,
                "policy_count": len(grouped),
                "status": response["status"],
                "failed_plans": len(failed),
            },
        )
        return response
    except HTTPException as exc:
        await _record_acronis_activity(
            current_user,
            "acronis_backup_run_failed",
            "backup_run",
            resource_id or "acronis-backup-run",
            resource_id or "Backup run",
            str(exc.detail),
            {"application_ids": application_ids, "resource_id": resource_id},
        )
        raise
    except Exception as e:
        await _record_acronis_activity(
            current_user,
            "acronis_backup_run_failed",
            "backup_run",
            resource_id or "acronis-backup-run",
            resource_id or "Backup run",
            str(e),
            {"application_ids": application_ids, "resource_id": resource_id},
        )
        raise HTTPException(status_code=500, detail=f"Run backup failed: {str(e)}")


@router.get("/acronis/activities")
async def get_acronis_activities(limit: int = 50, current_user: dict = Depends(get_current_user)):
    """Get recent backup activities/tasks from Acronis."""
    try:
        resp = await acronis_service._get(f"/api/task_manager/v2/activities?limit={limit}&order=desc(startedAt)")
        if resp.status_code != 200:
            return {"items": []}
        data = resp.json()
        items = data.get("items", [])
        activities = []
        for a in items:
            ctx = a.get("context", {})
            tenant = a.get("tenant", {})
            policy = a.get("policy", {})
            activities.append({
                "id": a.get("idString", a.get("uuid", "")),
                "state": a.get("state", ""),
                "resource_name": ctx.get("resourceName", ""),
                "resource_type": ctx.get("resourceKind", ""),
                "activity_type": ctx.get("activityType", ""),
                "plan_name": policy.get("name", ctx.get("policyName", "")),
                "tenant_name": tenant.get("name", ""),
                "started_at": a.get("startedAt", ""),
                "completed_at": a.get("completedAt", ""),
                "started_by": a.get("startedByUser", ""),
                "progress": a.get("progress", {}).get("current", 0) if isinstance(a.get("progress"), dict) else 0,
            })
        return {"items": activities, "total": len(activities)}
    except Exception as e:
        return {"items": [], "error": str(e)}



@router.get("/acronis/resources")
async def get_acronis_resources(tenant_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Get protected resources/agents from Acronis."""
    try:
        data = await acronis_service.get_resources(tenant_id)
        return data
    except Exception as e:
        return {"items": [], "error": str(e)}


@router.get("/acronis/resource-statuses")
async def get_acronis_resource_statuses(tenant_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Get backup/protection statuses for all resources."""
    try:
        data = await acronis_service.get_resource_statuses(tenant_id)
        return data
    except Exception as e:
        return {"items": [], "error": str(e)}


@router.get("/acronis/alerts")
async def get_acronis_alerts(tenant_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Get active Acronis alerts."""
    try:
        data = await acronis_service.get_alerts(tenant_id)
        return data
    except Exception as e:
        return {"items": [], "error": str(e)}


@router.get("/acronis/usage-summary")
async def get_acronis_usage_summary(current_user: dict = Depends(get_current_user)):
    """Get aggregated Acronis usage across all tenants."""
    try:
        tenants_data = await acronis_service.get_tenants()
        items = tenants_data.get("items", [])
        customer_tenants = [t for t in items if t.get("kind") in ("customer", "unit")]

        total_tenants = len(customer_tenants)
        active_tenants = len([t for t in customer_tenants if t.get("enabled", True)])

        # Get resource statuses for overall protection rate
        statuses = await acronis_service.get_resource_statuses()
        status_items = statuses.get("items", [])
        total_resources = len(status_items)
        protected = len([s for s in status_items if s.get("policy_status", {}).get("status") in ("ok", "protected")])
        failed = len([s for s in status_items if s.get("policy_status", {}).get("status") in ("error", "failed", "critical")])

        # Get alerts
        alerts_data = await acronis_service.get_alerts()
        alert_items = alerts_data.get("items", [])
        critical_alerts = len([a for a in alert_items if a.get("severity") in ("critical", "error")])

        return {
            "total_tenants": total_tenants,
            "active_tenants": active_tenants,
            "total_resources": total_resources,
            "protected_resources": protected,
            "failed_resources": failed,
            "protection_rate": round((protected / total_resources * 100) if total_resources else 0, 1),
            "total_alerts": len(alert_items),
            "critical_alerts": critical_alerts,
            "data_source": "live",
        }
    except Exception as e:
        # Fallback to cached data
        customers = await db.acronis_customers.find({}, {"_id": 0}).to_list(100)
        subs = await db.acronis_subscriptions.find({}, {"_id": 0}).to_list(500)
        total_devices = sum(c.get("total_devices", 0) for c in customers)
        protected = sum(c.get("protected_devices", 0) for c in customers)
        total_mrr = sum(s.get("monthly_cost", 0) for s in subs)
        return {
            "total_tenants": len(customers),
            "active_tenants": len([c for c in customers if c.get("status") == "active"]),
            "total_resources": total_devices,
            "protected_resources": protected,
            "failed_resources": 0,
            "protection_rate": round((protected / total_devices * 100) if total_devices else 0, 1),
            "total_monthly_revenue": round(total_mrr, 2),
            "data_source": "cached",
            "error": str(e),
        }


@router.get("/acronis/subscriptions")
async def get_acronis_subscriptions(customer_id: Optional[str] = None, client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Get Acronis subscriptions/usage per tenant."""
    query = {}
    if customer_id:
        query["acronis_customer_id"] = customer_id
    if client_id:
        query["linked_client_id"] = client_id

    subs = await db.acronis_subscriptions.find(query, {"_id": 0}).to_list(200)
    if subs:
        return subs

    # Generate from API tenant data
    try:
        customers_data = await get_acronis_customers(current_user)
        customers = customers_data if isinstance(customers_data, list) else []
        import random
        rng = random.SystemRandom()
        service_types = [
            {"name": "Cyber Protect - Workstations", "unit": "devices", "price_per_unit": 2.50},
            {"name": "Cyber Protect - Servers", "unit": "devices", "price_per_unit": 8.00},
            {"name": "Cloud Backup Storage", "unit": "GB", "price_per_unit": 0.12},
            {"name": "Advanced Security", "unit": "devices", "price_per_unit": 3.00},
            {"name": "Disaster Recovery", "unit": "servers", "price_per_unit": 15.00},
            {"name": "EDR/XDR", "unit": "devices", "price_per_unit": 5.00},
        ]
        subs = []
        for cust in customers:
            selected = rng.sample(service_types, min(rng.randint(2, 4), len(service_types)))
            for st in selected:
                qty = rng.randint(3, 40)
                subs.append({
                    "id": str(uuid.uuid4()),
                    "acronis_customer_id": cust.get("id", ""),
                    "customer_name": cust.get("name", ""),
                    "linked_client_id": cust.get("linked_client_id", ""),
                    "service_name": st["name"],
                    "unit": st["unit"],
                    "quantity": qty,
                    "price_per_unit": st["price_per_unit"],
                    "monthly_cost": round(qty * st["price_per_unit"], 2),
                    "status": "active",
                })
        return subs
    except Exception:
        return []


# ============== ACRONIS BILLING / USAGE-TO-INVOICE ==============

# Default pricing per offering-item code (USD/AUD). Admin can override via /acronis/pricing.
# Prices are per-unit (bytes→GB for storage items; count for seats/workloads).
DEFAULT_ACRONIS_PRICING = {
    # Storage (per GB/month)
    "pw_base_storage":       {"label": "Cloud Backup Storage",      "unit": "GB",       "unit_price": 0.12, "category": "storage"},
    "pw_base_c2c_storage":   {"label": "Cloud-to-Cloud Storage",    "unit": "GB",       "unit_price": 0.12, "category": "storage"},
    "pw_base_dr_storage":    {"label": "Disaster Recovery Storage", "unit": "GB",       "unit_price": 0.18, "category": "storage"},
    # Workloads (per unit/month)
    "pw_base_workstations":  {"label": "Workstations",              "unit": "device",   "unit_price": 2.50, "category": "workload"},
    "pw_base_servers":       {"label": "Servers",                   "unit": "device",   "unit_price": 8.00, "category": "workload"},
    "pw_base_virtual_hosts": {"label": "Virtual Hosts",             "unit": "host",     "unit_price": 15.00, "category": "workload"},
    "pw_base_mobile":        {"label": "Mobile Devices",            "unit": "device",   "unit_price": 1.50, "category": "workload"},
    "pw_base_m365_seats":    {"label": "M365 Seats",                "unit": "seat",     "unit_price": 3.00, "category": "seats"},
    "pw_base_gsuite_seats":  {"label": "Google Workspace Seats",    "unit": "seat",     "unit_price": 3.00, "category": "seats"},
    "pw_base_websites":      {"label": "Websites",                  "unit": "site",     "unit_price": 1.00, "category": "workload"},
    # Advanced packs
    "pw_pack_adv_security":  {"label": "Advanced Security",         "unit": "device",   "unit_price": 3.00, "category": "addon"},
    "pw_pack_adv_backup":    {"label": "Advanced Backup",           "unit": "device",   "unit_price": 2.50, "category": "addon"},
    "pw_pack_adv_management":{"label": "Advanced Management",       "unit": "device",   "unit_price": 2.00, "category": "addon"},
    "pw_pack_adv_edr":       {"label": "EDR / XDR",                 "unit": "device",   "unit_price": 5.00, "category": "addon"},
    "pw_pack_adv_dlp":       {"label": "Advanced DLP",              "unit": "device",   "unit_price": 4.00, "category": "addon"},
    "pw_pack_adv_dr":        {"label": "Disaster Recovery",         "unit": "device",   "unit_price": 15.00, "category": "addon"},
    "pw_pack_adv_email":     {"label": "Advanced Email Security",   "unit": "seat",     "unit_price": 1.50, "category": "addon"},
    "pw_pack_adv_filesync":  {"label": "Advanced File Sync",        "unit": "seat",     "unit_price": 2.00, "category": "addon"},
}


def _normalize_usage_value(raw_value: float, measurement_unit: str) -> tuple[float, str]:
    """Convert raw Acronis usage to billable quantity + display unit.
    Bytes are normalized to GB. Counts stay as-is."""
    mu = (measurement_unit or "").lower()
    if mu == "bytes":
        return round(raw_value / (1024 ** 3), 3), "GB"
    return raw_value, measurement_unit or "unit"


@router.get("/acronis/pricing")
async def get_acronis_pricing(current_user: dict = Depends(get_current_user)):
    """Get current pricing config merged with defaults. Values are in the configured currency.
    Defaults are seeded in USD; if user switches currency, pricing is auto-converted on save."""
    doc = await db.settings.find_one({"key": "acronis_pricing"}, {"_id": 0}) or {}
    overrides = doc.get("value", {})
    currency = doc.get("currency", "AUD")
    fx_rate = float(doc.get("fx_rate_from_usd", 1.0))  # rate to convert USD defaults → target currency
    fx_updated_at = doc.get("fx_updated_at")

    merged = {}
    for code, default in DEFAULT_ACRONIS_PRICING.items():
        o = overrides.get(code, {})
        # If user has an override, use it verbatim (it's in target currency).
        # Otherwise take USD default × FX rate.
        if "unit_price" in o:
            unit_price = float(o["unit_price"])
        else:
            unit_price = round(default["unit_price"] * fx_rate, 4)
        merged[code] = {
            **default,
            "unit_price": unit_price,
            "enabled": bool(o.get("enabled", True)),
            "markup_pct": float(o.get("markup_pct", 0)),
        }
    for code, o in overrides.items():
        if code not in merged:
            merged[code] = {
                "label": o.get("label", code),
                "unit": o.get("unit", "unit"),
                "unit_price": float(o.get("unit_price", 0)),
                "category": o.get("category", "custom"),
                "enabled": bool(o.get("enabled", True)),
                "markup_pct": float(o.get("markup_pct", 0)),
            }
    return {
        "pricing": merged,
        "currency": currency,
        "fx_rate_from_usd": fx_rate,
        "fx_updated_at": fx_updated_at,
    }


@router.post("/acronis/fx/refresh")
async def refresh_acronis_fx(data: dict = None, current_user: dict = Depends(get_current_user)):
    """Fetch live USD→target FX rate from exchangerate.host (free, no auth)."""
    data = data or {}
    target = (data.get("currency") or "AUD").upper()
    if target == "USD":
        rate = 1.0
    else:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=15.0) as c:
                resp = await c.get("https://api.exchangerate-api.com/v4/latest/USD")
                if resp.status_code != 200:
                    raise HTTPException(status_code=502, detail=f"FX API returned {resp.status_code}")
                data_fx = resp.json()
                rate = float(data_fx.get("rates", {}).get(target, 0))
                if not rate:
                    raise HTTPException(status_code=400, detail=f"Unsupported currency: {target}")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"FX fetch failed: {e}")

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one(
        {"key": "acronis_pricing"},
        {"$set": {"currency": target, "fx_rate_from_usd": rate, "fx_updated_at": now_iso}},
        upsert=True
    )
    return {"currency": target, "fx_rate_from_usd": rate, "fx_updated_at": now_iso}


@router.post("/acronis/pricing")
async def save_acronis_pricing(data: dict, current_user: dict = Depends(get_current_user)):
    """Save pricing overrides. Body: {pricing: {code: {unit_price, markup_pct, enabled}}, currency}"""
    pricing = data.get("pricing", {})
    currency = data.get("currency", "USD")
    await db.settings.update_one(
        {"key": "acronis_pricing"},
        {"$set": {"key": "acronis_pricing", "value": pricing, "currency": currency,
                  "updated_at": datetime.now(timezone.utc).isoformat(),
                  "updated_by": current_user.get("name", "")}},
        upsert=True
    )
    return {"message": "Pricing saved", "items": len(pricing)}


async def _get_pricing_map():
    """Helper to get merged pricing map for internal use (in target currency)."""
    doc = await db.settings.find_one({"key": "acronis_pricing"}, {"_id": 0}) or {}
    overrides = doc.get("value", {})
    currency = doc.get("currency", "AUD")
    fx_rate = float(doc.get("fx_rate_from_usd", 1.0))
    out = {}
    for code, default in DEFAULT_ACRONIS_PRICING.items():
        o = overrides.get(code, {})
        if "unit_price" in o:
            unit_price = float(o["unit_price"])
        else:
            unit_price = round(default["unit_price"] * fx_rate, 4)
        out[code] = {
            **default,
            "unit_price": unit_price,
            "enabled": bool(o.get("enabled", True)),
            "markup_pct": float(o.get("markup_pct", 0)),
        }
    for code, o in overrides.items():
        if code not in out:
            out[code] = {
                "label": o.get("label", code),
                "unit": o.get("unit", "unit"),
                "unit_price": float(o.get("unit_price", 0)),
                "category": o.get("category", "custom"),
                "enabled": bool(o.get("enabled", True)),
                "markup_pct": float(o.get("markup_pct", 0)),
            }
    return out, currency


@router.get("/acronis/billing/preview")
async def preview_acronis_billing(current_user: dict = Depends(get_current_user)):
    """Preview per-client Acronis usage → billing line items for the current month.
    Only includes tenants linked to NexusOps clients."""
    pricing_map, currency = await _get_pricing_map()
    links = await db.acronis_customer_links.find({}, {"_id": 0}).to_list(500)

    results = []
    for link in links:
        tenant_id = link.get("acronis_tenant_id")
        client_id = link.get("client_id")
        if not (tenant_id and client_id):
            continue
        try:
            usage_resp = await acronis_service.get_tenant_usage(tenant_id)
        except Exception as e:
            results.append({
                "client_id": client_id,
                "client_name": link.get("client_name", ""),
                "tenant_id": tenant_id,
                "error": str(e),
                "line_items": [],
                "total": 0.0,
            })
            continue

        # Aggregate by offering code (a tenant can have multiple infra entries per code)
        agg = {}
        for item in usage_resp.get("items", []):
            code = item.get("name", "")
            val = item.get("value", 0) or 0
            if val <= 0:
                continue
            mu = item.get("measurement_unit", "")
            qty, display_unit = _normalize_usage_value(val, mu)
            if code not in agg:
                agg[code] = {"quantity": 0, "unit": display_unit, "edition": item.get("edition", "")}
            agg[code]["quantity"] += qty

        # Build line items from pricing
        line_items = []
        total = 0.0
        for code, u in agg.items():
            price_cfg = pricing_map.get(code)
            if not price_cfg or not price_cfg.get("enabled"):
                # Unknown/disabled — still surface with 0 price so admin can add pricing
                line_items.append({
                    "code": code, "label": code, "unit": u["unit"],
                    "quantity": round(u["quantity"], 2),
                    "unit_price": 0.0, "markup_pct": 0.0,
                    "total": 0.0, "unknown": True,
                })
                continue
            unit_price = price_cfg["unit_price"] * (1 + price_cfg.get("markup_pct", 0) / 100)
            line_total = round(u["quantity"] * unit_price, 2)
            line_items.append({
                "code": code,
                "label": price_cfg["label"],
                "unit": price_cfg["unit"],
                "quantity": round(u["quantity"], 2),
                "unit_price": round(unit_price, 4),
                "markup_pct": price_cfg.get("markup_pct", 0),
                "total": line_total,
                "category": price_cfg.get("category", ""),
                "unknown": False,
            })
            total += line_total

        # Find existing contract for this client (any active)
        contract = await db.contracts.find_one(
            {"client_id": client_id, "status": {"$ne": "cancelled"}},
            {"_id": 0, "id": 1, "name": 1}
        )

        # Fetch active recurring invoices for this client + auto-bill state
        active_ris = await db.recurring_invoices.find(
            {"client_id": client_id, "status": "active"},
            {"_id": 0, "id": 1, "description": 1, "amount": 1, "frequency": 1, "include_acronis_usage": 1}
        ).to_list(20)
        auto_bill_enabled = any(r.get("include_acronis_usage") for r in active_ris)

        results.append({
            "client_id": client_id,
            "client_name": link.get("client_name", ""),
            "tenant_id": tenant_id,
            "contract_id": contract.get("id") if contract else None,
            "contract_name": contract.get("name") if contract else None,
            "line_items": line_items,
            "total": round(total, 2),
            "unknown_count": sum(1 for li in line_items if li.get("unknown")),
            "active_recurring_invoices": active_ris,
            "auto_bill_recurring": auto_bill_enabled,
        })

    grand_total = sum(r["total"] for r in results)
    return {
        "period": datetime.now(timezone.utc).strftime("%Y-%m"),
        "currency": currency,
        "results": results,
        "grand_total": round(grand_total, 2),
        "linked_clients": len(results),
    }


@router.post("/acronis/billing/sync")
async def sync_acronis_billing(data: dict = None, current_user: dict = Depends(get_current_user)):
    """Materialize Acronis usage as LineItems on each linked client's default contract.
    Replaces any existing Acronis-synced line items for that contract/period.
    Body (optional): {"client_ids": [...], "dry_run": bool}"""
    data = data or {}
    dry_run = bool(data.get("dry_run", False))
    client_filter = set(data.get("client_ids") or [])

    preview = await preview_acronis_billing(current_user=current_user)
    now = datetime.now(timezone.utc)
    period = now.strftime("%Y-%m")

    synced = []
    skipped = []
    for r in preview["results"]:
        cid = r["client_id"]
        if client_filter and cid not in client_filter:
            continue
        if not r.get("contract_id"):
            skipped.append({"client_id": cid, "client_name": r["client_name"], "reason": "No active contract"})
            continue
        if not r["line_items"] or r["total"] == 0:
            skipped.append({"client_id": cid, "client_name": r["client_name"], "reason": "No billable usage"})
            continue

        if dry_run:
            synced.append({"client_id": cid, "client_name": r["client_name"],
                           "contract_id": r["contract_id"], "total": r["total"],
                           "items": len(r["line_items"]), "dry_run": True})
            continue

        # Remove existing Acronis-synced line items for this contract + period
        await db.line_items.delete_many({
            "contract_id": r["contract_id"],
            "acronis_synced": True,
            "acronis_period": period,
        })

        # Insert fresh line items
        for li in r["line_items"]:
            if li.get("unknown") or li.get("total", 0) <= 0:
                continue
            doc = {
                "id": str(uuid.uuid4()),
                "contract_id": r["contract_id"],
                "client_id": cid,
                "client_name": r["client_name"],
                "name": f"Acronis — {li['label']} ({period})",
                "description": f"Acronis Cyber Cloud usage billing for {period}. "
                               f"{li['quantity']} {li['unit']} × ${li['unit_price']:.4f}"
                               + (f" (+{li['markup_pct']:.0f}% markup)" if li.get("markup_pct") else ""),
                "quantity": li["quantity"],
                "unit_price": li["unit_price"],
                "total": li["total"],
                "billing_frequency": "monthly",
                "acronis_synced": True,
                "acronis_tenant_id": r["tenant_id"],
                "acronis_offering_code": li["code"],
                "acronis_period": period,
                "synced_at": now.isoformat(),
                "created_at": now.isoformat(),
            }
            await db.line_items.insert_one(doc)

        # Also store a snapshot for audit/history
        await db.acronis_billing_snapshots.update_one(
            {"client_id": cid, "period": period},
            {"$set": {
                "client_id": cid,
                "client_name": r["client_name"],
                "tenant_id": r["tenant_id"],
                "contract_id": r["contract_id"],
                "period": period,
                "total": r["total"],
                "line_items": r["line_items"],
                "synced_at": now.isoformat(),
                "synced_by": current_user.get("name", ""),
            }},
            upsert=True
        )

        synced.append({
            "client_id": cid,
            "client_name": r["client_name"],
            "contract_id": r["contract_id"],
            "total": r["total"],
            "items": len(r["line_items"]),
        })

    return {
        "period": period,
        "dry_run": dry_run,
        "synced": synced,
        "skipped": skipped,
        "total_billed": round(sum(s["total"] for s in synced), 2),
        "synced_count": len(synced),
    }


@router.get("/acronis/billing/history")
async def get_acronis_billing_history(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Return historical billing snapshots."""
    query = {}
    if client_id:
        query["client_id"] = client_id
    snaps = await db.acronis_billing_snapshots.find(query, {"_id": 0}).sort("period", -1).to_list(200)
    return {"snapshots": snaps}


@router.get("/acronis/billing/client/{client_id}")
async def get_client_acronis_billing(client_id: str, current_user: dict = Depends(get_current_user)):
    """Compact billing view for a single client (used by the client-detail widget)."""
    link = await db.acronis_customer_links.find_one({"client_id": client_id}, {"_id": 0})
    if not link:
        return {"linked": False, "message": "No Acronis tenant linked to this client"}

    pricing_map, currency = await _get_pricing_map()
    tenant_id = link.get("acronis_tenant_id")
    try:
        usage_resp = await acronis_service.get_tenant_usage(tenant_id)
    except Exception as e:
        return {"linked": True, "tenant_id": tenant_id, "error": str(e), "total": 0, "line_items": []}

    agg = {}
    for item in usage_resp.get("items", []):
        code = item.get("name", "")
        val = item.get("value", 0) or 0
        if val <= 0:
            continue
        qty, unit = _normalize_usage_value(val, item.get("measurement_unit", ""))
        if code not in agg:
            agg[code] = {"quantity": 0, "unit": unit}
        agg[code]["quantity"] += qty

    line_items, total = [], 0.0
    for code, u in agg.items():
        cfg = pricing_map.get(code)
        if not cfg or not cfg.get("enabled"):
            continue
        unit_price = cfg["unit_price"] * (1 + cfg.get("markup_pct", 0) / 100)
        lt = round(u["quantity"] * unit_price, 2)
        line_items.append({"label": cfg["label"], "quantity": round(u["quantity"], 2), "unit": cfg["unit"],
                           "unit_price": round(unit_price, 4), "total": lt})
        total += lt

    latest_snapshot = await db.acronis_billing_snapshots.find_one(
        {"client_id": client_id}, {"_id": 0}, sort=[("period", -1)]
    )

    return {
        "linked": True,
        "tenant_id": tenant_id,
        "tenant_name": link.get("client_name", ""),
        "period": datetime.now(timezone.utc).strftime("%Y-%m"),
        "currency": currency,
        "total": round(total, 2),
        "line_items": sorted(line_items, key=lambda x: -x["total"]),
        "last_synced": latest_snapshot.get("synced_at") if latest_snapshot else None,
        "last_synced_total": latest_snapshot.get("total") if latest_snapshot else None,
    }


@router.post("/acronis/billing/client/{client_id}/link-to-recurring")
async def link_client_billing_to_recurring(client_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """Enable auto-attach of Acronis usage to this client's recurring invoice(s).
    Body (all optional):
      - recurring_invoice_id: target a specific RI (otherwise applies to all active RIs for the client)
      - create_if_missing: if True and no active RI exists, create a scaffold one
      - frequency, tax_rate, currency, description: used only when create_if_missing is True
    """
    data = data or {}

    # Confirm the client is linked on Acronis side
    link = await db.acronis_customer_links.find_one({"client_id": client_id}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=400, detail="This client is not linked to an Acronis tenant. Link the tenant first on the Tenants tab.")

    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    now = datetime.now(timezone.utc).isoformat()
    target_id = data.get("recurring_invoice_id")

    modified, created_id = [], None

    if target_id:
        ri = await db.recurring_invoices.find_one({"id": target_id, "client_id": client_id}, {"_id": 0, "id": 1})
        if not ri:
            raise HTTPException(status_code=404, detail="Recurring invoice not found for this client")
        await db.recurring_invoices.update_one(
            {"id": target_id},
            {"$set": {"include_acronis_usage": True, "updated_at": now}}
        )
        modified.append(target_id)
    else:
        active = await db.recurring_invoices.find(
            {"client_id": client_id, "status": "active"}, {"_id": 0, "id": 1}
        ).to_list(50)
        for r in active:
            await db.recurring_invoices.update_one(
                {"id": r["id"]},
                {"$set": {"include_acronis_usage": True, "updated_at": now}}
            )
            modified.append(r["id"])

        # Optionally create a scaffold RI if none exists
        if not modified and data.get("create_if_missing"):
            new_id = f"ri-{uuid.uuid4().hex[:8]}"
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            frequency = data.get("frequency", "monthly")
            scaffold = {
                "id": new_id,
                "client_id": client_id,
                "client_name": client.get("name", ""),
                "description": data.get("description", f"Acronis Usage Billing — {client.get('name','')}"),
                "line_items": [],  # purely Acronis-driven
                "subtotal": 0.0,
                "tax_rate": float(data.get("tax_rate", 10)),
                "tax_amount": 0.0,
                "amount": 0.0,
                "currency": data.get("currency", "AUD"),
                "frequency": frequency,
                "start_date": today,
                "next_generation": today,  # bill right away next run
                "end_date": None,
                "contract_id": None,
                "payment_terms": data.get("payment_terms", "net_30"),
                "notes": "Auto-created to attach monthly Acronis usage. Line items sourced live each generation from Acronis.",
                "auto_send": False,
                "auto_send_email": "",
                "include_pdf": True,
                "include_acronis_usage": True,
                "status": "active",
                "invoices_generated": 0,
                "total_billed": 0,
                "last_generated": None,
                "generation_history": [],
                "created_by": current_user.get("name", ""),
                "created_at": now,
                "updated_at": now,
            }
            await db.recurring_invoices.insert_one(scaffold)
            created_id = new_id
            modified.append(new_id)

    # Mark the link so the UI can show this client is auto-billed
    await db.acronis_customer_links.update_one(
        {"client_id": client_id},
        {"$set": {
            "auto_bill_recurring": True,
            "auto_bill_ri_ids": modified,
            "auto_bill_linked_at": now,
            "auto_bill_linked_by": current_user.get("name", ""),
        }}
    )

    return {
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "updated_recurring_invoices": modified,
        "created_recurring_invoice_id": created_id,
        "count": len(modified),
        "message": (
            f"Created new recurring invoice {created_id} with Acronis auto-billing" if created_id
            else f"Enabled Acronis auto-billing on {len(modified)} recurring invoice(s)" if modified
            else "No active recurring invoices found — pass create_if_missing=true to create one"
        ),
    }


@router.post("/acronis/billing/client/{client_id}/unlink-recurring")
async def unlink_client_billing_from_recurring(client_id: str, current_user: dict = Depends(get_current_user)):
    """Disable auto-attach of Acronis usage for this client (across all RIs)."""
    now = datetime.now(timezone.utc).isoformat()
    res = await db.recurring_invoices.update_many(
        {"client_id": client_id, "include_acronis_usage": True},
        {"$set": {"include_acronis_usage": False, "updated_at": now}}
    )
    await db.acronis_customer_links.update_one(
        {"client_id": client_id},
        {"$set": {"auto_bill_recurring": False, "auto_bill_unlinked_at": now}}
    )
    return {"client_id": client_id, "disabled_on": res.modified_count}


@router.post("/acronis/sync")
async def sync_acronis_data(current_user: dict = Depends(get_current_user)):
    """Full sync: Pull tenants, resources, and statuses from Acronis API into local DB."""
    results = {"tenants_synced": 0, "resources_synced": 0, "alerts_synced": 0, "errors": []}
    now = datetime.now(timezone.utc).isoformat()

    try:
        # Sync tenants
        tenants_data = await acronis_service.get_tenants()
        tenants = tenants_data.get("items", [])
        for t in tenants:
            if t.get("kind") not in ("customer", "unit"):
                continue
            linked = await db.acronis_customer_links.find_one({"acronis_tenant_id": t["id"]}, {"_id": 0})
            doc = {
                "id": f"acr-{t['id'][:12]}",
                "acronis_tenant_id": t["id"],
                "name": t.get("name", ""),
                "kind": t.get("kind", ""),
                "enabled": t.get("enabled", True),
                "status": "active" if t.get("enabled") else "disabled",
                "linked_client_id": linked.get("client_id", "") if linked else "",
                "linked_client_name": linked.get("client_name", "") if linked else "",
                "last_sync": now,
            }
            await db.acronis_customers.update_one(
                {"acronis_tenant_id": t["id"]},
                {"$set": doc},
                upsert=True
            )
            results["tenants_synced"] += 1
    except Exception as e:
        results["errors"].append(f"Tenants: {str(e)}")

    try:
        # Sync resource statuses
        statuses = await acronis_service.get_resource_statuses()
        for s in statuses.get("items", []):
            await db.acronis_resources.update_one(
                {"resource_id": s.get("id", s.get("resource_id", ""))},
                {"$set": {**s, "last_sync": now}},
                upsert=True
            )
            results["resources_synced"] += 1
    except Exception as e:
        results["errors"].append(f"Resources: {str(e)}")

    try:
        # Sync alerts
        alerts = await acronis_service.get_alerts()
        for a in alerts.get("items", []):
            await db.acronis_alerts.update_one(
                {"alert_id": a.get("id", "")},
                {"$set": {**a, "synced_at": now}},
                upsert=True
            )
            results["alerts_synced"] += 1
    except Exception as e:
        results["errors"].append(f"Alerts: {str(e)}")

    results["synced_at"] = now
    results["status"] = "completed" if not results["errors"] else "partial"

    # Also snapshot billing usage for all linked clients (read-only — does NOT push to line_items yet)
    try:
        preview = await preview_acronis_billing(current_user=current_user)
        period = datetime.now(timezone.utc).strftime("%Y-%m")
        for r in preview.get("results", []):
            if r.get("total", 0) <= 0:
                continue
            await db.acronis_billing_snapshots.update_one(
                {"client_id": r["client_id"], "period": period, "auto_sync": True},
                {"$set": {
                    "client_id": r["client_id"],
                    "client_name": r["client_name"],
                    "tenant_id": r["tenant_id"],
                    "contract_id": r.get("contract_id"),
                    "period": period,
                    "total": r["total"],
                    "line_items": r["line_items"],
                    "auto_sync": True,
                    "synced_at": now,
                    "synced_by": "sync-acronis-job",
                }},
                upsert=True
            )
        results["billing_snapshots"] = len(preview.get("results", []))
        results["billing_total"] = preview.get("grand_total", 0)
    except Exception as e:
        results["errors"].append(f"Billing snapshot: {str(e)}")

    return results
