"""Evidence-based procurement recommendations from inventory and linked assets."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.database import db
from app.auth import get_current_user


router = APIRouter(prefix="/procurement-planner", tags=["Procurement Planner"])
USEFUL_LIFE_YEARS = {"server": 5, "hardware": 4, "laptop": 3, "mobile": 3, "network": 7, "peripheral": 5, "other": 4}


def _parse_date(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _estimated_replacement_cost(asset: dict):
    cost = asset.get("cost", asset.get("purchase_cost"))
    try:
        return float(cost) if cost not in (None, "") and float(cost) > 0 else None
    except (TypeError, ValueError):
        return None


@router.get("/recommendations")
async def get_procurement_recommendations(user=Depends(get_current_user)):
    assets = await db.assets.find({}, {"_id": 0}).to_list(1000)
    linked_ids = [asset.get("device_id") for asset in assets if asset.get("device_id")]
    devices = await db.devices.find({"id": {"$in": linked_ids}}, {"_id": 0}).to_list(len(linked_ids) or 1)
    devices_by_id = {device["id"]: device for device in devices}
    now = datetime.now(timezone.utc)
    recommendations = []
    warranty_issues = 0
    end_of_life = 0
    high_utilization = 0

    for asset in assets:
        if asset.get("status") in {"retired", "lost"}:
            continue
        recommendation = None
        estimate = _estimated_replacement_cost(asset)
        warranty_end = _parse_date(asset.get("warranty_expiry") or asset.get("warranty_end"))
        if warranty_end:
            if warranty_end.tzinfo is None:
                warranty_end = warranty_end.replace(tzinfo=timezone.utc)
            days_left = (warranty_end - now).days
            if days_left < 0:
                warranty_issues += 1
                recommendation = {
                    "reason": "warranty_expired", "detail": f"Warranty expired {abs(days_left)} days ago",
                    "recommendation": "Review replacement or warranty extension", "urgency": "high",
                }
            elif days_left < 90:
                warranty_issues += 1
                recommendation = {
                    "reason": "warranty_expiring", "detail": f"Warranty expires in {days_left} days",
                    "recommendation": "Plan replacement or warranty renewal", "urgency": "medium",
                }

        purchase_date = _parse_date(asset.get("purchase_date"))
        if purchase_date:
            if purchase_date.tzinfo is None:
                purchase_date = purchase_date.replace(tzinfo=timezone.utc)
            asset_type = asset.get("asset_type") or "other"
            lifespan_months = asset.get("expected_lifespan_months")
            useful_life = (float(lifespan_months) / 12) if lifespan_months else USEFUL_LIFE_YEARS.get(asset_type, 4)
            age_years = max(0, (now - purchase_date).days / 365.25)
            if age_years >= useful_life:
                end_of_life += 1
                if not recommendation:
                    recommendation = {
                        "reason": "end_of_life", "detail": f"Asset is {age_years:.1f} years old (recorded useful life: {useful_life:.1f} years)",
                        "recommendation": "Schedule a hardware refresh", "urgency": "high",
                    }

        linked_device = devices_by_id.get(asset.get("device_id"))
        if linked_device and not recommendation:
            readings = {
                "CPU": linked_device.get("cpu_usage"),
                "RAM": linked_device.get("memory_usage"),
                "Disk": linked_device.get("disk_usage"),
            }
            pressure = [f"{name}: {value}%" for name, value in readings.items() if isinstance(value, (int, float)) and value > 85]
            if pressure:
                high_utilization += 1
                recommendation = {
                    "reason": "high_utilization", "detail": f"Linked managed asset reports {', '.join(pressure)}",
                    "recommendation": "Assess capacity upgrade or replacement", "urgency": "medium",
                }

        if recommendation:
            recommendations.append({
                "asset_id": asset["id"], "device_id": asset.get("device_id"), "device_name": asset.get("name", ""),
                "client_name": asset.get("client_name", ""), "asset_tag": asset.get("asset_tag", ""),
                "estimated_cost": estimate, **recommendation,
            })

    known_budget = sum(item["estimated_cost"] for item in recommendations if item["estimated_cost"] is not None)
    return {
        "stats": {
            "total_recommendations": len(recommendations), "warranty_issues": warranty_issues,
            "eol_devices": end_of_life, "high_utilization": high_utilization,
            "estimated_budget": round(known_budget, 2),
            "unknown_cost_count": sum(item["estimated_cost"] is None for item in recommendations),
        },
        "recommendations": sorted(recommendations, key=lambda item: {"high": 0, "medium": 1, "low": 2}.get(item["urgency"], 2)),
    }
