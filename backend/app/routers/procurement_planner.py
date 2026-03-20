from fastapi import APIRouter, Depends
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone, timedelta

router = APIRouter(prefix="/procurement-planner", tags=["Procurement Planner"])

@router.get("/recommendations")
async def get_procurement_recommendations(user=Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0}).to_list(500)
    now = datetime.now(timezone.utc)
    
    recommendations = []
    warranty_expiring = []
    eol_devices = []
    high_utilization = []
    
    for d in devices:
        rec = None
        
        # Check warranty
        if d.get("warranty_expiry"):
            try:
                warranty_date = datetime.fromisoformat(d["warranty_expiry"])
                days_left = (warranty_date - now.replace(tzinfo=None)).days
                if days_left < 0:
                    warranty_expiring.append({**d, "days_expired": abs(days_left)})
                    rec = {
                        "device_id": d["id"], "device_name": d.get("name", ""),
                        "client_name": d.get("client_name", ""),
                        "reason": "warranty_expired",
                        "detail": f"Warranty expired {abs(days_left)} days ago",
                        "recommendation": "Replace or extend warranty",
                        "urgency": "high" if abs(days_left) > 180 else "medium",
                        "estimated_cost": d.get("purchase_price", 1000),
                    }
                elif days_left < 90:
                    warranty_expiring.append({**d, "days_left": days_left})
                    rec = {
                        "device_id": d["id"], "device_name": d.get("name", ""),
                        "client_name": d.get("client_name", ""),
                        "reason": "warranty_expiring",
                        "detail": f"Warranty expires in {days_left} days",
                        "recommendation": "Plan replacement or renewal",
                        "urgency": "medium",
                        "estimated_cost": d.get("purchase_price", 1000),
                    }
            except (ValueError, TypeError):
                pass
        
        # Check age (purchase date)
        if d.get("purchase_date"):
            try:
                purchase = datetime.fromisoformat(d["purchase_date"])
                age_years = (now.replace(tzinfo=None) - purchase).days / 365
                useful_life = {"server": 5, "workstation": 4, "laptop": 3, "network": 7}.get(d.get("device_type", ""), 5)
                if age_years > useful_life:
                    eol_devices.append(d)
                    if not rec:
                        rec = {
                            "device_id": d["id"], "device_name": d.get("name", ""),
                            "client_name": d.get("client_name", ""),
                            "reason": "end_of_life",
                            "detail": f"Device is {round(age_years, 1)} years old (useful life: {useful_life}y)",
                            "recommendation": "Schedule hardware refresh",
                            "urgency": "high",
                            "estimated_cost": d.get("purchase_price", 1000),
                        }
            except (ValueError, TypeError):
                pass
        
        # Check utilization
        if d.get("cpu_usage", 0) > 85 or d.get("memory_usage", 0) > 85 or d.get("disk_usage", 0) > 85:
            high_utilization.append(d)
            if not rec:
                metrics = []
                if d.get("cpu_usage", 0) > 85: metrics.append(f"CPU: {d['cpu_usage']}%")
                if d.get("memory_usage", 0) > 85: metrics.append(f"RAM: {d['memory_usage']}%")
                if d.get("disk_usage", 0) > 85: metrics.append(f"Disk: {d['disk_usage']}%")
                rec = {
                    "device_id": d["id"], "device_name": d.get("name", ""),
                    "client_name": d.get("client_name", ""),
                    "reason": "high_utilization",
                    "detail": f"Resource pressure: {', '.join(metrics)}",
                    "recommendation": "Upgrade or add capacity",
                    "urgency": "medium",
                    "estimated_cost": 500,
                }
        
        if rec:
            recommendations.append(rec)
    
    total_budget = sum(r["estimated_cost"] for r in recommendations)
    
    return {
        "stats": {
            "total_recommendations": len(recommendations),
            "warranty_issues": len(warranty_expiring),
            "eol_devices": len(eol_devices),
            "high_utilization": len(high_utilization),
            "estimated_budget": round(total_budget, 2),
        },
        "recommendations": sorted(recommendations, key=lambda x: {"high": 0, "medium": 1, "low": 2}.get(x["urgency"], 2)),
    }
