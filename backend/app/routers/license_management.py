"""License Management - Full MSP license tracking with seat allocation, cost reconciliation, and expiry alerts"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid, random

router = APIRouter(prefix="/license-management", tags=["license-management"])

VENDORS = ["Microsoft", "Adobe", "SentinelOne", "Acronis", "Datto", "ConnectWise", "Veeam", "Sophos", "Cisco Meraki", "Google", "Bitdefender", "Pax8"]
PRODUCTS = {
    "Microsoft": ["Microsoft 365 Business Basic", "Microsoft 365 Business Standard", "Microsoft 365 Business Premium", "Microsoft Defender P2", "Azure AD P1", "Windows 365", "Exchange Online Plan 1", "Visio Plan 2", "Project Plan 3"],
    "Adobe": ["Adobe Creative Cloud", "Adobe Acrobat Pro"],
    "SentinelOne": ["SentinelOne Complete", "SentinelOne Control"],
    "Acronis": ["Acronis Cyber Protect", "Acronis Advanced Backup"],
    "Google": ["Google Workspace Business Starter", "Google Workspace Business Standard"],
}

def _gen_licenses():
    """Generate realistic mock license data"""
    clients = ["Acme Corp", "TechFlow Industries", "Pinnacle Holdings", "Emerald Finance", "BlueRock Engineering",
               "Harbour Medical", "DataVault Solutions", "Pacific Retail", "Summit Legal", "Oceanic Logistics"]
    licenses = []
    for client in clients:
        for vendor in random.sample(VENDORS, random.randint(2, 5)):
            prods = PRODUCTS.get(vendor, [f"{vendor} Standard"])
            for product in random.sample(prods, min(random.randint(1, 3), len(prods))):
                purchased = random.choice([5, 10, 15, 20, 25, 30, 50, 100])
                used = random.randint(max(1, purchased - 10), purchased)
                unit_cost = round(random.uniform(5, 45), 2)
                renewal = (datetime.now(timezone.utc) + timedelta(days=random.randint(-30, 365))).strftime("%Y-%m-%d")
                auto_renew = random.choice([True, True, False])
                licenses.append({
                    "id": f"LIC-{uuid.uuid4().hex[:6].upper()}",
                    "product_name": product, "vendor": vendor, "client_name": client,
                    "purchased": purchased, "used": used, "available": purchased - used,
                    "unit_cost": unit_cost, "monthly_cost": round(purchased * unit_cost, 2),
                    "renewal_date": renewal, "auto_renew": auto_renew,
                    "billing_cycle": random.choice(["monthly", "annual"]),
                    "license_type": random.choice(["per_user", "per_device", "site"]),
                    "status": "active" if used > 0 else "inactive",
                    "cost_vs_billing": round(random.uniform(0.8, 1.3), 2),
                    "notes": "",
                })
    return licenses


@router.get("/overview")
async def get_overview(current_user: dict = Depends(get_current_user)):
    stored = await db.licenses.find({}, {"_id": 0}).to_list(500)
    if not stored:
        stored = _gen_licenses()
        for lic in stored:
            await db.licenses.insert_one(lic)
        stored = await db.licenses.find({}, {"_id": 0}).to_list(500)

    total_purchased = sum(l["purchased"] for l in stored)
    total_used = sum(l["used"] for l in stored)
    total_cost = sum(l["monthly_cost"] for l in stored)
    wasted = sum(l["available"] for l in stored)
    wasted_cost = sum(l["available"] * l["unit_cost"] for l in stored)
    expiring_soon = [l for l in stored if l.get("renewal_date") and l["renewal_date"] <= (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")]
    overutilized = [l for l in stored if l["used"] >= l["purchased"]]

    # Per-vendor breakdown
    vendor_breakdown = {}
    for l in stored:
        v = l["vendor"]
        if v not in vendor_breakdown:
            vendor_breakdown[v] = {"vendor": v, "licenses": 0, "total_cost": 0, "total_seats": 0, "used_seats": 0}
        vendor_breakdown[v]["licenses"] += 1
        vendor_breakdown[v]["total_cost"] += l["monthly_cost"]
        vendor_breakdown[v]["total_seats"] += l["purchased"]
        vendor_breakdown[v]["used_seats"] += l["used"]

    # Per-client breakdown
    client_breakdown = {}
    for l in stored:
        c = l["client_name"]
        if c not in client_breakdown:
            client_breakdown[c] = {"client": c, "licenses": 0, "total_cost": 0, "wasted_cost": 0, "utilization": 0, "total_seats": 0, "used_seats": 0}
        client_breakdown[c]["licenses"] += 1
        client_breakdown[c]["total_cost"] += l["monthly_cost"]
        client_breakdown[c]["wasted_cost"] += l["available"] * l["unit_cost"]
        client_breakdown[c]["total_seats"] += l["purchased"]
        client_breakdown[c]["used_seats"] += l["used"]
    for c in client_breakdown.values():
        c["utilization"] = round(c["used_seats"] / max(c["total_seats"], 1) * 100)
        c["total_cost"] = round(c["total_cost"], 2)
        c["wasted_cost"] = round(c["wasted_cost"], 2)

    return {
        "summary": {
            "total_licenses": len(stored),
            "total_purchased": total_purchased,
            "total_used": total_used,
            "utilization_pct": round(total_used / max(total_purchased, 1) * 100),
            "total_monthly_cost": round(total_cost, 2),
            "total_annual_cost": round(total_cost * 12, 2),
            "wasted_licenses": wasted,
            "wasted_cost_monthly": round(wasted_cost, 2),
            "expiring_soon": len(expiring_soon),
            "overutilized": len(overutilized),
        },
        "licenses": sorted(stored, key=lambda x: x["monthly_cost"], reverse=True),
        "vendor_breakdown": sorted(vendor_breakdown.values(), key=lambda x: x["total_cost"], reverse=True),
        "client_breakdown": sorted(client_breakdown.values(), key=lambda x: x["total_cost"], reverse=True),
        "expiring_soon": expiring_soon[:10],
        "optimization_suggestions": [
            {"type": "downsize", "message": f"Remove {wasted} unused seats to save ${round(wasted_cost, 2)}/month", "savings": round(wasted_cost, 2), "priority": "high"},
            {"type": "consolidate", "message": "Consolidate duplicate Microsoft 365 plans across clients", "savings": round(total_cost * 0.05, 2), "priority": "medium"},
            {"type": "negotiate", "message": "Negotiate volume discounts with top 3 vendors", "savings": round(total_cost * 0.08, 2), "priority": "medium"},
        ],
    }


@router.put("/licenses/{license_id}")
async def update_license(license_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    updates = {}
    for k in ["purchased", "used", "auto_renew", "notes", "unit_cost", "billing_cycle"]:
        if k in data:
            updates[k] = data[k]
    if "purchased" in updates or "used" in updates:
        lic = await db.licenses.find_one({"id": license_id}, {"_id": 0})
        if lic:
            p = updates.get("purchased", lic["purchased"])
            u = updates.get("used", lic["used"])
            updates["available"] = p - u
            uc = updates.get("unit_cost", lic["unit_cost"])
            updates["monthly_cost"] = round(p * uc, 2)
    result = await db.licenses.update_one({"id": license_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="License not found")
    return {"message": "License updated"}


@router.post("/licenses")
async def add_license(data: dict, current_user: dict = Depends(get_current_user)):
    lic = {
        "id": f"LIC-{uuid.uuid4().hex[:6].upper()}",
        "product_name": data.get("product_name", ""),
        "vendor": data.get("vendor", ""),
        "client_name": data.get("client_name", ""),
        "purchased": data.get("purchased", 0),
        "used": data.get("used", 0),
        "available": data.get("purchased", 0) - data.get("used", 0),
        "unit_cost": data.get("unit_cost", 0),
        "monthly_cost": round(data.get("purchased", 0) * data.get("unit_cost", 0), 2),
        "renewal_date": data.get("renewal_date", ""),
        "auto_renew": data.get("auto_renew", True),
        "billing_cycle": data.get("billing_cycle", "monthly"),
        "license_type": data.get("license_type", "per_user"),
        "status": "active",
        "cost_vs_billing": 1.0,
        "notes": data.get("notes", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.licenses.insert_one(lic)
    lic.pop("_id", None)
    return lic


@router.delete("/licenses/{license_id}")
async def delete_license(license_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.licenses.delete_one({"id": license_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "Deleted"}
