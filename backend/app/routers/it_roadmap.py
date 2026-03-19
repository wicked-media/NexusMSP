from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/it-roadmap/{client_id}")
async def get_roadmap(client_id: str, current_user: dict = Depends(get_current_user)):
    """Get IT roadmap for a client."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    items = await db.it_roadmap.find({"client_id": client_id}, {"_id": 0}).sort("target_date", 1).to_list(100)
    return {"client": client, "items": items}


@router.get("/it-roadmap")
async def get_all_roadmaps(current_user: dict = Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(200)
    result = []
    for c in clients:
        count = await db.it_roadmap.count_documents({"client_id": c["id"]})
        upcoming = await db.it_roadmap.count_documents({"client_id": c["id"], "status": {"$in": ["planned", "in_progress"]}})
        if count > 0:
            result.append({"client_id": c["id"], "client_name": c.get("name",""), "total_items": count, "upcoming": upcoming})
    return result


@router.post("/it-roadmap/{client_id}")
async def add_roadmap_item(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    item_id = str(uuid.uuid4())[:8]
    doc = {
        "id": item_id, "client_id": client_id,
        "title": data.get("title", ""), "description": data.get("description", ""),
        "category": data.get("category", "upgrade"),
        "target_date": data.get("target_date", ""),
        "quarter": data.get("quarter", ""),
        "estimated_cost": data.get("estimated_cost", 0),
        "priority": data.get("priority", "medium"),
        "status": "planned",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", ""),
    }
    await db.it_roadmap.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/it-roadmap/item/{item_id}")
async def update_roadmap_item(item_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    updates = {}
    for k in ["title", "description", "category", "target_date", "quarter", "estimated_cost", "priority", "status"]:
        if k in data:
            updates[k] = data[k]
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.it_roadmap.update_one({"id": item_id}, {"$set": updates})
    return {"message": "Updated"}


@router.delete("/it-roadmap/item/{item_id}")
async def delete_roadmap_item(item_id: str, current_user: dict = Depends(get_current_user)):
    await db.it_roadmap.delete_one({"id": item_id})
    return {"message": "Deleted"}
