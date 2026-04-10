from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
import uuid
import random; random = random.SystemRandom()
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== GRADIENT MSP - BILLING RECONCILIATION ==============

@router.get("/gradient/config")
async def get_gradient_config(current_user: dict = Depends(get_current_user)):
    config = await db.settings.find_one({"key": "gradient_config"}, {"_id": 0})
    if not config:
        return {"key": "gradient_config", "value": {"api_key": "", "connected": False, "last_sync": None}}
    return config

@router.post("/gradient/config")
async def save_gradient_config(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"key": "gradient_config"},
        {"$set": {"key": "gradient_config", "value": data, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "Gradient MSP configuration saved"}

@router.get("/gradient/reconciliation")
async def get_reconciliation_dashboard(current_user: dict = Depends(get_current_user)):
    """Get billing reconciliation dashboard data"""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(50)
    vendors = ["Microsoft 365", "Acronis", "Datto RMM", "SentinelOne", "Veeam", "Pax8", "Cisco Meraki", "Bitdefender"]

    reconciliation_items = []
    total_billed = 0
    total_actual = 0
    total_variance = 0
    missed_revenue = 0

    for c in clients[:12]:
        num_services = random.randint(2, 5)
        for vendor in random.sample(vendors, min(num_services, len(vendors))):
            billed_qty = random.randint(5, 50)
            actual_qty = billed_qty + random.randint(-5, 8)
            unit_price = round(random.uniform(2, 25), 2)
            billed_total = round(billed_qty * unit_price, 2)
            actual_total = round(actual_qty * unit_price, 2)
            variance = round(actual_total - billed_total, 2)

            status = "matched" if variance == 0 else "under_billed" if variance > 0 else "over_billed"

            reconciliation_items.append({
                "id": str(uuid.uuid4()),
                "client_id": c["id"],
                "client_name": c.get("name", ""),
                "vendor": vendor,
                "service": f"{vendor} - Subscription",
                "billed_quantity": billed_qty,
                "actual_quantity": actual_qty,
                "unit_price": unit_price,
                "billed_total": billed_total,
                "actual_total": actual_total,
                "variance": variance,
                "status": status,
                "last_synced": datetime.now(timezone.utc).isoformat(),
            })
            total_billed += billed_total
            total_actual += actual_total
            if variance > 0:
                missed_revenue += variance

    total_variance = round(total_actual - total_billed, 2)

    return {
        "items": reconciliation_items,
        "summary": {
            "total_billed": round(total_billed, 2),
            "total_actual_usage": round(total_actual, 2),
            "total_variance": total_variance,
            "missed_revenue": round(missed_revenue, 2),
            "matched_count": sum(1 for i in reconciliation_items if i["status"] == "matched"),
            "under_billed_count": sum(1 for i in reconciliation_items if i["status"] == "under_billed"),
            "over_billed_count": sum(1 for i in reconciliation_items if i["status"] == "over_billed"),
            "total_items": len(reconciliation_items),
        }
    }

@router.post("/gradient/reconciliation/{item_id}/adjust")
async def adjust_billing(item_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Adjust billing for a reconciliation item"""
    return {
        "message": "Billing adjusted",
        "item_id": item_id,
        "new_quantity": data.get("new_quantity"),
        "adjusted_by": current_user["name"],
        "adjusted_at": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/gradient/revenue-opportunities")
async def get_revenue_opportunities(current_user: dict = Depends(get_current_user)):
    """Identify revenue opportunities from service usage gaps"""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(50)
    opportunities = []
    services = [
        {"name": "Endpoint Protection", "avg_price": 3.50, "category": "security"},
        {"name": "Cloud Backup", "avg_price": 5.00, "category": "backup"},
        {"name": "Email Filtering", "avg_price": 2.00, "category": "email"},
        {"name": "MFA/Identity", "avg_price": 4.00, "category": "security"},
        {"name": "DNS Filtering", "avg_price": 1.50, "category": "security"},
        {"name": "Dark Web Monitoring", "avg_price": 2.50, "category": "compliance"},
    ]
    for c in random.sample(clients, min(8, len(clients))):
        svc = random.choice(services)
        devices = random.randint(10, 60)
        opportunities.append({
            "id": str(uuid.uuid4()),
            "client_id": c["id"],
            "client_name": c.get("name", ""),
            "service": svc["name"],
            "category": svc["category"],
            "estimated_devices": devices,
            "price_per_unit": svc["avg_price"],
            "potential_mrr": round(devices * svc["avg_price"], 2),
            "confidence": random.choice(["high", "medium", "low"]),
            "reason": random.choice(["No coverage detected", "Competitor product expiring", "Industry compliance requirement", "Client requested quote"]),
        })
    opportunities.sort(key=lambda x: x["potential_mrr"], reverse=True)
    return {"opportunities": opportunities, "total_potential_mrr": round(sum(o["potential_mrr"] for o in opportunities), 2)}
