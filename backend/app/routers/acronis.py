from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
import random; random = random.SystemRandom()
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== ACRONIS INTEGRATION ==============

@router.get("/acronis/config")
async def get_acronis_config(current_user: dict = Depends(get_current_user)):
    """Get Acronis connection configuration"""
    config = await db.settings.find_one({"key": "acronis_config"}, {"_id": 0})
    if not config:
        return {"key": "acronis_config", "value": {"api_url": "", "client_id": "", "client_secret": "", "tenant_id": "", "connected": False}}
    return config

@router.post("/acronis/config")
async def save_acronis_config(data: dict, current_user: dict = Depends(get_current_user)):
    """Save Acronis API configuration"""
    await db.settings.update_one(
        {"key": "acronis_config"},
        {"$set": {"key": "acronis_config", "value": data, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "Acronis configuration saved"}

@router.get("/acronis/customers")
async def get_acronis_customers(current_user: dict = Depends(get_current_user)):
    """Get Acronis customers synced from the cloud"""
    customers = await db.acronis_customers.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    if not customers:
        # Demo data representing Acronis tenant customers
        clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(20)
        customers = []
        for i, c in enumerate(clients[:10]):
            customers.append({
                "id": f"acr-cust-{i+1}",
                "acronis_tenant_id": f"tn-{uuid.uuid4().hex[:12]}",
                "name": c.get("name", f"Customer {i+1}"),
                "linked_client_id": c.get("id", ""),
                "linked_client_name": c.get("name", ""),
                "status": "active",
                "edition": random.choice(["Cyber Protect", "Cyber Protect Essentials", "Cyber Backup"]),
                "total_devices": random.randint(3, 50),
                "protected_devices": random.randint(2, 40),
                "storage_used_gb": round(random.uniform(10, 500), 1),
                "storage_quota_gb": random.choice([500, 1000, 2000, 5000]),
                "last_sync": datetime.now(timezone.utc).isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
    return customers

@router.post("/acronis/customers/{customer_id}/link")
async def link_acronis_customer(customer_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Link an Acronis customer to a NexusOps client"""
    client_id = data.get("client_id")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    await db.acronis_customers.update_one(
        {"id": customer_id},
        {"$set": {"linked_client_id": client_id, "linked_client_name": client.get("name", "")}}
    )
    return {"message": f"Linked to {client.get('name', '')}"}

@router.get("/acronis/subscriptions")
async def get_acronis_subscriptions(customer_id: Optional[str] = None, client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Get Acronis subscriptions/usage"""
    query = {}
    if customer_id:
        query["acronis_customer_id"] = customer_id
    if client_id:
        query["linked_client_id"] = client_id

    subs = await db.acronis_subscriptions.find(query, {"_id": 0}).to_list(200)
    if not subs:
        # Generate demo subscriptions
        customers = await db.acronis_customers.find({}, {"_id": 0}).to_list(20)
        if not customers:
            customers = [{"id": f"acr-cust-{i}", "name": f"Customer {i}", "linked_client_id": ""} for i in range(5)]
        service_types = [
            {"name": "Cyber Protect - Workstations", "unit": "devices", "price_per_unit": 2.50},
            {"name": "Cyber Protect - Servers", "unit": "devices", "price_per_unit": 8.00},
            {"name": "Cloud Backup Storage", "unit": "GB", "price_per_unit": 0.12},
            {"name": "Advanced Security", "unit": "devices", "price_per_unit": 3.00},
            {"name": "Advanced Backup", "unit": "devices", "price_per_unit": 4.50},
            {"name": "Disaster Recovery", "unit": "servers", "price_per_unit": 15.00},
            {"name": "Email Security", "unit": "mailboxes", "price_per_unit": 1.80},
            {"name": "EDR/XDR", "unit": "devices", "price_per_unit": 5.00},
        ]
        subs = []
        for cust in customers:
            num_subs = random.randint(2, 5)
            selected = random.sample(service_types, min(num_subs, len(service_types)))
            for st in selected:
                qty = random.randint(3, 40)
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
                    "billing_period": "monthly",
                    "usage_percent": round(random.uniform(40, 100), 1),
                    "last_sync": datetime.now(timezone.utc).isoformat(),
                })
    return subs

@router.get("/acronis/usage-summary")
async def get_acronis_usage_summary(current_user: dict = Depends(get_current_user)):
    """Get overall Acronis usage summary"""
    customers = await db.acronis_customers.find({}, {"_id": 0}).to_list(100)
    subs = await db.acronis_subscriptions.find({}, {"_id": 0}).to_list(500)

    total_storage = sum(c.get("storage_used_gb", 0) for c in customers)
    total_devices = sum(c.get("total_devices", 0) for c in customers)
    protected = sum(c.get("protected_devices", 0) for c in customers)
    total_mrr = sum(s.get("monthly_cost", 0) for s in subs)

    return {
        "total_customers": len(customers),
        "total_devices": total_devices,
        "protected_devices": protected,
        "protection_rate": round((protected / total_devices * 100) if total_devices else 0, 1),
        "total_storage_used_gb": round(total_storage, 1),
        "total_monthly_revenue": round(total_mrr, 2),
        "subscription_count": len(subs),
    }

@router.post("/acronis/sync")
async def sync_acronis_data(current_user: dict = Depends(get_current_user)):
    """Trigger a sync of Acronis data (simulated)"""
    now = datetime.now(timezone.utc).isoformat()
    await db.acronis_customers.update_many({}, {"$set": {"last_sync": now}})
    await db.acronis_subscriptions.update_many({}, {"$set": {"last_sync": now}})
    return {"message": "Acronis data synced", "synced_at": now}
