"""Depreciation calculated from the canonical inventory-assets register."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.database import db
from app.auth import get_current_user
from app.services.scope_permissions import scoped_query


router = APIRouter()
USEFUL_LIFE_YEARS = {
    "server": 5, "hardware": 4, "laptop": 3, "mobile": 3,
    "network": 7, "peripheral": 5, "software": 3, "license": 3, "other": 4,
}


def _parse_date(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


@router.get("/asset-depreciation")
async def asset_depreciation(current_user: dict = Depends(get_current_user)):
    """Calculate refresh timing from recorded inventory acquisition and value data."""
    assets = await db.assets.find(scoped_query(current_user), {"_id": 0}).to_list(1000)
    now = datetime.now(timezone.utc)
    results = []

    for asset in assets:
        purchase_date = _parse_date(asset.get("purchase_date"))
        if not purchase_date:
            # A refresh forecast without an acquisition date would be invented.
            continue
        if purchase_date.tzinfo is None:
            purchase_date = purchase_date.replace(tzinfo=timezone.utc)
        age_years = max(0, round((now - purchase_date).days / 365.25, 1))
        asset_type = asset.get("asset_type") or "other"
        lifespan_months = asset.get("expected_lifespan_months")
        useful_life = round((float(lifespan_months) / 12), 1) if lifespan_months else USEFUL_LIFE_YEARS.get(asset_type, 4)
        useful_life = max(useful_life, 0.1)
        purchase_price = float(asset.get("cost", asset.get("purchase_cost", 0)) or 0)
        depreciation_rate = float(asset.get("depreciation_rate", 0) or 0)

        if purchase_price > 0:
            annual_depreciation = purchase_price * (depreciation_rate / 100) if depreciation_rate > 0 else purchase_price / useful_life
            accumulated = min(purchase_price, annual_depreciation * age_years)
            current_value = max(0, purchase_price - accumulated)
            depreciation_pct = round((accumulated / purchase_price) * 100, 1)
        else:
            current_value = 0
            depreciation_pct = round(min(100, (age_years / useful_life) * 100), 1)

        refresh_in_years = max(0, useful_life - age_years)
        status = "end_of_life" if age_years >= useful_life else "refresh_soon" if refresh_in_years < 1 else "active"
        results.append({
            "id": asset["id"], "hostname": asset.get("name", ""), "asset_tag": asset.get("asset_tag", ""),
            "type": asset_type, "manufacturer": asset.get("manufacturer", ""), "model": asset.get("model", ""),
            "client_name": asset.get("client_name", ""), "client_id": asset.get("client_id", ""),
            "purchase_price": purchase_price, "current_value": round(current_value, 2),
            "age_years": age_years, "useful_life": useful_life, "depreciation_pct": depreciation_pct,
            "refresh_in_years": round(refresh_in_years, 1), "status": status,
        })

    results.sort(key=lambda item: item["refresh_in_years"])
    end_of_life = [asset for asset in results if asset["status"] == "end_of_life"]
    refresh_soon = [asset for asset in results if asset["status"] == "refresh_soon"]
    return {
        "assets": results,
        "stats": {
            "total": len(results), "end_of_life": len(end_of_life), "refresh_soon": len(refresh_soon),
            "active": len(results) - len(end_of_life) - len(refresh_soon),
            "total_current_value": round(sum(asset["current_value"] for asset in results), 2),
            "total_original_value": round(sum(asset["purchase_price"] for asset in results), 2),
        },
    }
