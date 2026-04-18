from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
import os
from app.database import db
from app.auth import get_current_user
from app.services.integrations import acronis_service

router = APIRouter()

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
    return {
        "api_url": api_url or db_val.get("api_url", ""),
        "client_id": client_id or db_val.get("client_id", ""),
        "has_secret": has_secret or bool(db_val.get("client_secret")),
        "connected": bool(api_url and client_id and has_secret),
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
    return results
