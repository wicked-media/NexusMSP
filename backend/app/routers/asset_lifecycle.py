"""Lifecycle views over the canonical inventory-assets collection.

Inventory, depreciation, QR labels and lifecycle history must describe the same
asset record. This router intentionally does not maintain a parallel asset
register.
"""

from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.database import db
from app.auth import get_current_user


router = APIRouter()
VALID_STAGES = {"procurement", "deployment", "active", "maintenance", "decommission", "disposed"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_name(user: dict) -> str:
    return user.get("name") or user.get("email") or "Technician"


def _lifecycle_view(asset: dict) -> dict:
    """Map a canonical inventory asset to the lifecycle presentation contract."""
    item = dict(asset)
    item.pop("_id", None)
    item["asset_tag"] = item.get("asset_tag") or f"AST-{str(item.get('id') or '')[:6].upper()}"
    item["lifecycle_stage"] = item.get("lifecycle_stage") or (
        "disposed" if item.get("status") == "retired" else
        "maintenance" if item.get("status") == "in_repair" else "active"
    )
    item["purchase_cost"] = float(item.get("purchase_cost", item.get("cost", 0)) or 0)
    item["cost"] = float(item.get("cost", item["purchase_cost"]) or 0)
    item["warranty_end"] = item.get("warranty_end") or item.get("warranty_expiry") or ""
    item["warranty_expiry"] = item.get("warranty_expiry") or item["warranty_end"]
    item.setdefault("expected_lifespan_months", 36)
    item.setdefault("history", [])
    return item


def _asset_status_for_stage(stage: str, current_status: str | None = None) -> str:
    if stage == "disposed":
        return "retired"
    if stage == "maintenance":
        return "in_repair"
    if stage in {"procurement", "deployment", "decommission"}:
        return current_status or "active"
    return "active"


@router.get("/asset-lifecycle")
async def get_all_lifecycle_assets(
    stage: str | None = None,
    client_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    query = {}
    if client_id:
        query["client_id"] = client_id
    assets = await db.assets.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    rows = [_lifecycle_view(asset) for asset in assets]
    if stage:
        rows = [asset for asset in rows if asset["lifecycle_stage"] == stage]
    return rows


@router.get("/asset-lifecycle/dashboard")
async def get_lifecycle_dashboard(current_user: dict = Depends(get_current_user)):
    assets = [_lifecycle_view(asset) for asset in await db.assets.find({}, {"_id": 0}).to_list(10000)]
    by_stage = {stage: 0 for stage in VALID_STAGES}
    by_type: dict[str, int] = {}
    now = datetime.now(timezone.utc).date()
    warranty_expiring = 0
    total_investment = 0.0

    for asset in assets:
        by_stage[asset["lifecycle_stage"]] = by_stage.get(asset["lifecycle_stage"], 0) + 1
        asset_type = asset.get("asset_type") or "other"
        by_type[asset_type] = by_type.get(asset_type, 0) + 1
        total_investment += asset["purchase_cost"]
        warranty_end = asset.get("warranty_end")
        if warranty_end and asset["lifecycle_stage"] not in {"disposed", "decommission"}:
            try:
                if datetime.fromisoformat(warranty_end).date() <= now:
                    warranty_expiring += 1
            except ValueError:
                pass

    return {
        "total": len(assets),
        "by_stage": by_stage,
        "total_investment": round(total_investment, 2),
        "warranty_expiring": warranty_expiring,
        "by_type": [{"type": asset_type, "count": count} for asset_type, count in sorted(by_type.items())],
    }


@router.get("/asset-lifecycle/{asset_id}")
async def get_lifecycle_asset(asset_id: str, current_user: dict = Depends(get_current_user)):
    asset = await db.assets.find_one({"id": asset_id}, {"_id": 0})
    if not asset:
        raise HTTPException(status_code=404, detail="Inventory asset not found")
    return _lifecycle_view(asset)


@router.post("/asset-lifecycle")
async def create_lifecycle_asset(data: dict, current_user: dict = Depends(get_current_user)):
    name = str(data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Asset name is required")
    stage = data.get("lifecycle_stage") or "procurement"
    if stage not in VALID_STAGES:
        raise HTTPException(status_code=400, detail="Invalid lifecycle stage")

    client_id = data.get("client_id") or None
    client_name = ""
    if client_id:
        client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        client_name = client.get("name") or ""

    asset_id = str(uuid.uuid4())
    purchase_cost = float(data.get("purchase_cost", data.get("cost", 0)) or 0)
    warranty_end = data.get("warranty_end") or data.get("warranty_expiry") or ""
    asset = {
        "id": asset_id,
        "asset_tag": data.get("asset_tag") or f"AST-{asset_id[:6].upper()}",
        "name": name,
        "asset_type": data.get("asset_type") or "hardware",
        "category": data.get("category") or "computer",
        "manufacturer": data.get("manufacturer") or "",
        "model": data.get("model") or "",
        "serial_number": data.get("serial_number") or "",
        "client_id": client_id,
        "client_name": client_name,
        "device_id": data.get("device_id") or None,
        "assigned_to": data.get("assigned_to") or "",
        "assigned_user_name": data.get("assigned_user_name") or "",
        "location": data.get("location") or "",
        "lifecycle_stage": stage,
        "status": _asset_status_for_stage(stage),
        "cost": purchase_cost,
        "purchase_cost": purchase_cost,
        "purchase_date": data.get("purchase_date") or "",
        "vendor": data.get("vendor") or "",
        "purchase_order_number": data.get("purchase_order_number") or "",
        "warranty_start": data.get("warranty_start") or "",
        "warranty_end": warranty_end,
        "warranty_expiry": warranty_end,
        "expected_lifespan_months": int(data.get("expected_lifespan_months", 36) or 36),
        "depreciation_method": data.get("depreciation_method") or "straight_line",
        "depreciation_rate": float(data.get("depreciation_rate", 0) or 0),
        "current_value": purchase_cost,
        "notes": data.get("notes") or "",
        "history": [{
            "id": str(uuid.uuid4()),
            "action": "created",
            "stage": stage,
            "user_id": current_user.get("id"),
            "user_name": _user_name(current_user),
            "notes": "Inventory asset created",
            "timestamp": _now(),
        }],
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.assets.insert_one(asset)
    return _lifecycle_view(asset)


@router.put("/asset-lifecycle/{asset_id}")
async def update_lifecycle_asset(asset_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    existing = await db.assets.find_one({"id": asset_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Inventory asset not found")

    allowed = {
        "name", "asset_type", "category", "manufacturer", "model", "serial_number", "client_id", "client_name",
        "device_id", "assigned_to", "assigned_user_name", "location", "purchase_date", "vendor", "purchase_order_number",
        "warranty_start", "notes", "expected_lifespan_months", "depreciation_method", "depreciation_rate",
    }
    update = {key: value for key, value in data.items() if key in allowed}
    if "purchase_cost" in data or "cost" in data:
        cost = float(data.get("purchase_cost", data.get("cost", 0)) or 0)
        update.update({"cost": cost, "purchase_cost": cost})
    if "warranty_end" in data or "warranty_expiry" in data:
        warranty_end = data.get("warranty_end", data.get("warranty_expiry")) or ""
        update.update({"warranty_end": warranty_end, "warranty_expiry": warranty_end})
    update["updated_at"] = _now()

    if "lifecycle_stage" in data and data["lifecycle_stage"] != _lifecycle_view(existing)["lifecycle_stage"]:
        stage = data["lifecycle_stage"]
        if stage not in VALID_STAGES:
            raise HTTPException(status_code=400, detail="Invalid lifecycle stage")
        update.update({"lifecycle_stage": stage, "status": _asset_status_for_stage(stage, existing.get("status"))})
        history = {
            "id": str(uuid.uuid4()), "action": "stage_change", "stage": stage,
            "previous_stage": _lifecycle_view(existing)["lifecycle_stage"],
            "user_id": current_user.get("id"), "user_name": _user_name(current_user),
            "notes": data.get("transition_notes") or f"Moved to {stage}", "timestamp": _now(),
        }
        await db.assets.update_one({"id": asset_id}, {"$push": {"history": history}})

    await db.assets.update_one({"id": asset_id}, {"$set": update})
    return {"message": "Inventory asset updated"}


@router.delete("/asset-lifecycle/{asset_id}")
async def delete_lifecycle_asset(asset_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.assets.delete_one({"id": asset_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Inventory asset not found")
    return {"message": "Inventory asset deleted"}


@router.post("/asset-lifecycle/{asset_id}/transition")
async def transition_lifecycle_stage(asset_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    asset = await db.assets.find_one({"id": asset_id}, {"_id": 0})
    if not asset:
        raise HTTPException(status_code=404, detail="Inventory asset not found")
    new_stage = data.get("new_stage") or ""
    if new_stage not in VALID_STAGES:
        raise HTTPException(status_code=400, detail=f"Invalid stage. Must be one of: {sorted(VALID_STAGES)}")

    existing = _lifecycle_view(asset)
    if new_stage == existing["lifecycle_stage"]:
        return {"message": "Asset is already in this lifecycle stage", "new_stage": new_stage}
    history = {
        "id": str(uuid.uuid4()), "action": "stage_change", "stage": new_stage,
        "previous_stage": existing["lifecycle_stage"], "user_id": current_user.get("id"),
        "user_name": _user_name(current_user), "notes": data.get("notes") or f"Transitioned to {new_stage}",
        "timestamp": _now(),
    }
    update = {
        "lifecycle_stage": new_stage,
        "status": _asset_status_for_stage(new_stage, asset.get("status")),
        "updated_at": _now(),
    }
    if new_stage == "disposed":
        update["disposal_date"] = data.get("disposal_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        update["disposal_method"] = data.get("disposal_method") or "recycled"
        update["disposal_value"] = float(data.get("disposal_value", 0) or 0)
    await db.assets.update_one({"id": asset_id}, {"$set": update, "$push": {"history": history}})
    return {"message": f"Asset transitioned to {new_stage}", "new_stage": new_stage}
