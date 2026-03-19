from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/asset-depreciation")
async def asset_depreciation(current_user: dict = Depends(get_current_user)):
    """Calculate asset depreciation and refresh dates."""
    devices = await db.devices.find({}, {"_id": 0, "id": 1, "hostname": 1, "device_type": 1,
                                          "manufacturer": 1, "model": 1, "created_at": 1,
                                          "purchase_date": 1, "purchase_price": 1,
                                          "client_name": 1, "client_id": 1}).to_list(500)
    now = datetime.now(timezone.utc)
    results = []

    # Useful life in years by type
    useful_life = {"server": 5, "workstation": 4, "laptop": 3, "router": 5, "switch": 7, "firewall": 5, "printer": 5, "other": 4}

    for d in devices:
        dtype = d.get("device_type", "other")
        life_years = useful_life.get(dtype, 4)
        purchase_price = d.get("purchase_price", 0)

        # Determine age
        date_str = d.get("purchase_date") or d.get("created_at", "")
        if not date_str:
            continue
        try:
            if "T" in date_str:
                purchase_date = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            else:
                purchase_date = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            age_days = (now - purchase_date).days
            age_years = round(age_days / 365.25, 1)
        except Exception:
            continue

        # Straight-line depreciation
        if purchase_price > 0:
            annual_dep = purchase_price / life_years
            accumulated = min(purchase_price, annual_dep * age_years)
            current_value = max(0, purchase_price - accumulated)
            dep_pct = round((accumulated / purchase_price) * 100, 1)
        else:
            annual_dep = 0
            accumulated = 0
            current_value = 0
            dep_pct = round(min(100, (age_years / life_years) * 100), 1)

        refresh_in_years = max(0, life_years - age_years)
        status = "end_of_life" if age_years >= life_years else "refresh_soon" if refresh_in_years < 1 else "active"

        results.append({
            "id": d["id"], "hostname": d.get("hostname",""), "type": dtype,
            "manufacturer": d.get("manufacturer",""), "model": d.get("model",""),
            "client_name": d.get("client_name",""), "client_id": d.get("client_id",""),
            "purchase_price": purchase_price, "current_value": round(current_value, 2),
            "age_years": age_years, "useful_life": life_years,
            "depreciation_pct": dep_pct,
            "refresh_in_years": round(refresh_in_years, 1),
            "status": status,
        })

    results.sort(key=lambda x: x["refresh_in_years"])
    eol = [r for r in results if r["status"] == "end_of_life"]
    refresh = [r for r in results if r["status"] == "refresh_soon"]

    return {
        "assets": results,
        "stats": {
            "total": len(results),
            "end_of_life": len(eol),
            "refresh_soon": len(refresh),
            "active": len(results) - len(eol) - len(refresh),
            "total_current_value": round(sum(r["current_value"] for r in results), 2),
            "total_original_value": round(sum(r["purchase_price"] for r in results), 2),
        },
    }
