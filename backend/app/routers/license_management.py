from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid, random

router = APIRouter()

@router.get("/license-management/overview")
async def get_licenses(current_user: dict = Depends(get_current_user)):
    data = await db.software_licenses.find({}, {"_id": 0}).to_list(500)
    if not data:
        data = await _seed_license_data()
    total_cost = sum(l.get("monthly_cost", 0) for l in data)
    total_purchased = sum(l.get("purchased", 0) for l in data)
    total_used = sum(l.get("used", 0) for l in data)
    wasted = total_purchased - total_used
    return {"summary": {"total_licenses": len(data), "total_monthly_cost": round(total_cost, 2), "total_purchased": total_purchased, "total_used": total_used, "wasted_licenses": wasted, "utilization_pct": round(total_used / total_purchased * 100, 1) if total_purchased else 0}, "licenses": data}

@router.get("/license-management/by-client/{client_id}")
async def get_client_licenses(client_id: str, current_user: dict = Depends(get_current_user)):
    data = await db.software_licenses.find({"client_id": client_id}, {"_id": 0}).to_list(100)
    return data

@router.post("/license-management/licenses")
async def create_license(data: dict, current_user: dict = Depends(get_current_user)):
    license_entry = {**data, "id": f"lic-{uuid.uuid4().hex[:8]}", "created_at": datetime.now(timezone.utc).isoformat()}
    await db.software_licenses.insert_one(license_entry)
    license_entry.pop("_id", None)
    return license_entry

@router.put("/license-management/licenses/{license_id}")
async def update_license(license_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.software_licenses.update_one({"id": license_id}, {"$set": data})
    return {"status": "updated"}

async def _seed_license_data():
    clients = [("client-001", "Acme Corporation"), ("client-002", "TechStart Inc"), ("client-003", "Global Finance Ltd"), ("client-004", "HealthCare Plus"), ("client-005", "RetailMax"), ("client-006", "Summit Legal Group"), ("client-009", "Cascade Manufacturing"), ("client-014", "GreenVolt Energy")]
    products = [
        ("Microsoft 365 Business Premium", "Microsoft", 22.00, "monthly"),
        ("Microsoft 365 E3", "Microsoft", 36.00, "monthly"),
        ("Adobe Creative Cloud", "Adobe", 54.99, "monthly"),
        ("SentinelOne Complete", "SentinelOne", 5.50, "monthly"),
        ("Slack Business+", "Salesforce", 12.50, "monthly"),
        ("Zoom Business", "Zoom", 13.33, "monthly"),
        ("CrowdStrike Falcon Pro", "CrowdStrike", 8.99, "monthly"),
        ("Acronis Cyber Protect", "Acronis", 5.00, "monthly"),
        ("Google Workspace Business", "Google", 14.00, "monthly"),
        ("AutoCAD", "Autodesk", 235.00, "monthly"),
    ]
    licenses = []
    for i, (cid, cname) in enumerate(clients):
        num_products = random.randint(3, 6)
        selected = random.sample(products, num_products)
        for j, (pname, vendor, cost, billing) in enumerate(selected):
            purchased = random.randint(10, 80)
            used = random.randint(max(1, purchased - 15), purchased)
            lic = {"id": f"lic-{i*10+j+1:03d}", "client_id": cid, "client_name": cname, "product_name": pname, "vendor": vendor, "purchased": purchased, "used": used, "available": purchased - used, "unit_cost": cost, "monthly_cost": round(purchased * cost, 2), "billing_cycle": billing, "renewal_date": (datetime.now(timezone.utc) + timedelta(days=random.randint(30, 365))).strftime("%Y-%m-%d"), "status": "active", "created_at": datetime.now(timezone.utc).isoformat()}
            licenses.append(lic)
    for l in licenses:
        await db.software_licenses.insert_one(l)
    return [dict((k, v) for k, v in l.items() if k != "_id") for l in licenses]
