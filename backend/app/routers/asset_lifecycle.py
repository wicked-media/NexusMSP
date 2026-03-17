from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, List
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== ASSET LIFECYCLE MANAGEMENT ==============

@router.get("/asset-lifecycle")
async def get_all_lifecycle_assets(
    stage: Optional[str] = None,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if stage:
        query["lifecycle_stage"] = stage
    if client_id:
        query["client_id"] = client_id
    assets = await db.asset_lifecycle.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return assets

@router.get("/asset-lifecycle/dashboard")
async def get_lifecycle_dashboard(current_user: dict = Depends(get_current_user)):
    total = await db.asset_lifecycle.count_documents({})
    procurement = await db.asset_lifecycle.count_documents({"lifecycle_stage": "procurement"})
    deployment = await db.asset_lifecycle.count_documents({"lifecycle_stage": "deployment"})
    active = await db.asset_lifecycle.count_documents({"lifecycle_stage": "active"})
    maintenance = await db.asset_lifecycle.count_documents({"lifecycle_stage": "maintenance"})
    decommission = await db.asset_lifecycle.count_documents({"lifecycle_stage": "decommission"})
    disposed = await db.asset_lifecycle.count_documents({"lifecycle_stage": "disposed"})
    
    total_cost = await db.asset_lifecycle.aggregate([
        {"$group": {"_id": None, "total": {"$sum": "$purchase_cost"}}}
    ]).to_list(1)
    total_cost_val = total_cost[0]["total"] if total_cost else 0
    
    warranty_expiring = await db.asset_lifecycle.count_documents({
        "warranty_end": {"$lte": datetime.now(timezone.utc).isoformat()},
        "lifecycle_stage": {"$nin": ["disposed", "decommission"]}
    })
    
    by_type = await db.asset_lifecycle.aggregate([
        {"$group": {"_id": "$asset_type", "count": {"$sum": 1}}}
    ]).to_list(20)
    
    return {
        "total": total,
        "by_stage": {
            "procurement": procurement,
            "deployment": deployment,
            "active": active,
            "maintenance": maintenance,
            "decommission": decommission,
            "disposed": disposed,
        },
        "total_investment": total_cost_val,
        "warranty_expiring": warranty_expiring,
        "by_type": [{"type": t["_id"], "count": t["count"]} for t in by_type],
    }

@router.get("/asset-lifecycle/{asset_id}")
async def get_lifecycle_asset(asset_id: str, current_user: dict = Depends(get_current_user)):
    asset = await db.asset_lifecycle.find_one({"id": asset_id}, {"_id": 0})
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset

@router.post("/asset-lifecycle")
async def create_lifecycle_asset(data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if data.get("client_id"):
        client = await db.clients.find_one({"id": data["client_id"]}, {"_id": 0})
        client_name = client["name"] if client else None
    
    asset = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", ""),
        "asset_tag": data.get("asset_tag", f"AST-{str(uuid.uuid4())[:6].upper()}"),
        "asset_type": data.get("asset_type", "hardware"),
        "category": data.get("category", "computer"),
        "manufacturer": data.get("manufacturer", ""),
        "model": data.get("model", ""),
        "serial_number": data.get("serial_number", ""),
        "client_id": data.get("client_id", ""),
        "client_name": client_name,
        "assigned_to": data.get("assigned_to", ""),
        "assigned_user_name": data.get("assigned_user_name", ""),
        "location": data.get("location", ""),
        "lifecycle_stage": data.get("lifecycle_stage", "procurement"),
        "purchase_cost": float(data.get("purchase_cost", 0)),
        "purchase_date": data.get("purchase_date", ""),
        "vendor": data.get("vendor", ""),
        "purchase_order_number": data.get("purchase_order_number", ""),
        "warranty_start": data.get("warranty_start", ""),
        "warranty_end": data.get("warranty_end", ""),
        "expected_lifespan_months": int(data.get("expected_lifespan_months", 36)),
        "depreciation_method": data.get("depreciation_method", "straight_line"),
        "current_value": float(data.get("purchase_cost", 0)),
        "disposal_method": "",
        "disposal_date": "",
        "disposal_value": 0,
        "notes": data.get("notes", ""),
        "history": [{
            "id": str(uuid.uuid4()),
            "action": "created",
            "stage": data.get("lifecycle_stage", "procurement"),
            "user_id": current_user["id"],
            "user_name": current_user["name"],
            "notes": "Asset created",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.asset_lifecycle.insert_one(asset)
    asset.pop("_id", None)
    return asset

@router.put("/asset-lifecycle/{asset_id}")
async def update_lifecycle_asset(asset_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    existing = await db.asset_lifecycle.find_one({"id": asset_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    if "lifecycle_stage" in data and data["lifecycle_stage"] != existing.get("lifecycle_stage"):
        history_entry = {
            "id": str(uuid.uuid4()),
            "action": "stage_change",
            "stage": data["lifecycle_stage"],
            "previous_stage": existing.get("lifecycle_stage"),
            "user_id": current_user["id"],
            "user_name": current_user["name"],
            "notes": data.get("transition_notes", f"Moved to {data['lifecycle_stage']}"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await db.asset_lifecycle.update_one({"id": asset_id}, {"$push": {"history": history_entry}})
    
    data.pop("transition_notes", None)
    await db.asset_lifecycle.update_one({"id": asset_id}, {"$set": data})
    return {"message": "Asset updated"}

@router.delete("/asset-lifecycle/{asset_id}")
async def delete_lifecycle_asset(asset_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.asset_lifecycle.delete_one({"id": asset_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"message": "Asset deleted"}

@router.post("/asset-lifecycle/{asset_id}/transition")
async def transition_lifecycle_stage(asset_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Transition an asset to the next lifecycle stage"""
    asset = await db.asset_lifecycle.find_one({"id": asset_id}, {"_id": 0})
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    new_stage = data.get("new_stage", "")
    valid_stages = ["procurement", "deployment", "active", "maintenance", "decommission", "disposed"]
    if new_stage not in valid_stages:
        raise HTTPException(status_code=400, detail=f"Invalid stage. Must be one of: {valid_stages}")
    
    history_entry = {
        "id": str(uuid.uuid4()),
        "action": "stage_change",
        "stage": new_stage,
        "previous_stage": asset.get("lifecycle_stage"),
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "notes": data.get("notes", f"Transitioned to {new_stage}"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    
    update = {
        "lifecycle_stage": new_stage,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    
    if new_stage == "disposed":
        update["disposal_date"] = data.get("disposal_date", datetime.now(timezone.utc).strftime("%Y-%m-%d"))
        update["disposal_method"] = data.get("disposal_method", "recycled")
        update["disposal_value"] = float(data.get("disposal_value", 0))
    
    await db.asset_lifecycle.update_one({"id": asset_id}, {"$set": update, "$push": {"history": history_entry}})
    return {"message": f"Asset transitioned to {new_stage}", "new_stage": new_stage}
