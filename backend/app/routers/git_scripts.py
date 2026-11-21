from fastapi import APIRouter, Depends
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()

router = APIRouter()

@router.get("/git-scripts/list")
async def list_scripts(current_user: dict = Depends(get_current_user)):
    return await db.git_scripts.find({}, {"_id": 0}).to_list(100)

@router.get("/git-scripts/{script_id}/history")
async def script_history(script_id: str, current_user: dict = Depends(get_current_user)):
    script = await db.git_scripts.find_one({"id": script_id}, {"_id": 0})
    if not script:
        return {"error": "Not found"}
    return {"script": script, "commits": script.get("commits", [])}
