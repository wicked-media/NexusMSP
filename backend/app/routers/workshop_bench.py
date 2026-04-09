from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ─── Workshop Bench (Kanban for repairs) ───

@router.get("/workshop/bench")
async def get_bench_jobs(current_user: dict = Depends(get_current_user)):
    """Fetch all workshop bench jobs."""
    jobs = await db.workshop_bench.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return jobs


@router.post("/workshop/bench")
async def create_bench_job(data: dict, current_user: dict = Depends(get_current_user)):
    """Create a new workshop bench job."""
    count = await db.workshop_bench.count_documents({})
    job = {
        "id": str(uuid.uuid4()),
        "job_number": f"WS-{str(count + 1).zfill(5)}",
        "title": data.get("title", ""),
        "description": data.get("description", ""),
        "client_name": data.get("client_name", ""),
        "client_id": data.get("client_id", ""),
        "device_name": data.get("device_name", ""),
        "device_id": data.get("device_id", ""),
        "assigned_to": data.get("assigned_to", ""),
        "assigned_to_name": data.get("assigned_to_name", ""),
        "bench_stage": "intake",
        "priority": data.get("priority", "medium"),
        "notes": [],
        "parts": [],
        "created_by": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.workshop_bench.insert_one(job)
    return {"id": job["id"], "job_number": job["job_number"]}


@router.put("/workshop/bench/move")
async def move_bench_job(data: dict, current_user: dict = Depends(get_current_user)):
    """Move a workshop job to a different bench stage."""
    job_id = data.get("job_id")
    stage = data.get("stage")
    valid_stages = ["intake", "diagnosing", "parts_ordered", "repairing", "testing", "ready"]
    if stage not in valid_stages:
        return {"error": f"Invalid stage. Must be one of: {valid_stages}"}
    result = await db.workshop_bench.update_one(
        {"id": job_id},
        {"$set": {"bench_stage": stage, "updated_at": datetime.now(timezone.utc).isoformat()},
         "$push": {"history": {"stage": stage, "moved_by": current_user.get("name", ""), "at": datetime.now(timezone.utc).isoformat()}}}
    )
    return {"message": "Moved", "modified": result.modified_count}


@router.get("/workshop/bench/{job_id}")
async def get_bench_job(job_id: str, current_user: dict = Depends(get_current_user)):
    job = await db.workshop_bench.find_one({"id": job_id}, {"_id": 0})
    if not job:
        return {"error": "Job not found"}
    return job
