from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/rpe/dashboard")
async def rpe_dashboard(current_user: dict = Depends(get_current_user)):
    """Revenue Per Endpoint dashboard."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "tier": 1}).to_list(500)
    results = []
    total_revenue = 0
    total_endpoints = 0

    for c in clients:
        cid = c["id"]
        devices = await db.devices.count_documents({"client_id": cid})
        contracts = await db.contracts.find({"client_id": cid, "status": "active"}, {"_id": 0, "value": 1}).to_list(10)
        monthly_rev = sum(ct.get("value", 0) for ct in contracts)

        rpe = round(monthly_rev / max(devices, 1), 2) if devices > 0 else 0
        total_revenue += monthly_rev
        total_endpoints += devices

        results.append({
            "client_id": cid, "client_name": c.get("name", ""),
            "tier": c.get("tier", "standard"),
            "devices": devices, "monthly_revenue": monthly_rev, "rpe": rpe,
            "status": "above_target" if rpe >= 15 else "at_target" if rpe >= 10 else "below_target" if devices > 0 else "no_devices",
        })

    results.sort(key=lambda x: x["rpe"])
    avg_rpe = round(total_revenue / max(total_endpoints, 1), 2)
    below = [r for r in results if r["status"] == "below_target"]
    above = [r for r in results if r["status"] == "above_target"]

    return {
        "clients": results,
        "summary": {
            "total_revenue": total_revenue, "total_endpoints": total_endpoints,
            "avg_rpe": avg_rpe, "target_rpe": 15.00,
            "below_target": len(below), "above_target": len(above),
            "revenue_gap": round(sum(max(0, 15 - r["rpe"]) * r["devices"] for r in below), 2),
        },
    }
