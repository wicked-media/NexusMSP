from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()

router = APIRouter()

@router.get("/backup-dashboard/overview")
async def get_backup_overview(current_user: dict = Depends(get_current_user)):
    data = await db.backup_jobs.find({}, {"_id": 0}).to_list(500)
    if not data:
        data = await _seed_backup_data()
    total = len(data)
    success = sum(1 for d in data if d.get("status") == "success")
    failed = sum(1 for d in data if d.get("status") == "failed")
    running = sum(1 for d in data if d.get("status") == "running")
    total_size_gb = sum(d.get("size_gb", 0) for d in data)
    return {"summary": {"total_jobs": total, "successful": success, "failed": failed, "running": running, "success_rate": round(success / total * 100, 1) if total else 0, "total_size_gb": round(total_size_gb, 1)}, "jobs": data}

@router.get("/backup-dashboard/clients")
async def get_backup_by_client(current_user: dict = Depends(get_current_user)):
    pipeline = [{"$group": {"_id": "$client_name", "total": {"$sum": 1}, "success": {"$sum": {"$cond": [{"$eq": ["$status", "success"]}, 1, 0]}}, "failed": {"$sum": {"$cond": [{"$eq": ["$status", "failed"]}, 1, 0]}}, "total_size_gb": {"$sum": "$size_gb"}}}]
    results = await db.backup_jobs.aggregate(pipeline).to_list(50)
    return [{"client_name": r["_id"], "total": r["total"], "success": r["success"], "failed": r["failed"], "total_size_gb": round(r["total_size_gb"], 1), "success_rate": round(r["success"] / r["total"] * 100, 1) if r["total"] else 0} for r in results]

async def _seed_backup_data():
    now = datetime.now(timezone.utc)
    clients = [("client-001", "Acme Corporation"), ("client-002", "TechStart Inc"), ("client-003", "Global Finance Ltd"), ("client-004", "HealthCare Plus"), ("client-005", "RetailMax"), ("client-006", "Summit Legal Group"), ("client-009", "Cascade Manufacturing"), ("client-014", "GreenVolt Energy")]
    providers = ["Acronis", "Veeam", "Datto"]
    jobs = []
    for i, (cid, cname) in enumerate(clients):
        for j in range(random.randint(3, 6)):
            status = random.choices(["success", "failed", "running", "warning"], weights=[75, 10, 5, 10])[0]
            provider = random.choice(providers)
            job = {"id": f"bj-{i*10+j+1:03d}", "client_id": cid, "client_name": cname, "device_name": f"{cname.split()[0].upper()}-{'SRV' if j < 2 else 'WS'}-{j+1:02d}", "provider": provider, "job_type": random.choice(["full", "incremental", "differential"]), "status": status, "size_gb": round(random.uniform(5, 500), 1), "duration_minutes": random.randint(5, 180), "last_run": (now - timedelta(hours=random.randint(1, 48))).isoformat(), "next_run": (now + timedelta(hours=random.randint(1, 24))).isoformat(), "retention_days": random.choice([7, 14, 30, 90])}
            jobs.append(job)
    for j in jobs:
        await db.backup_jobs.insert_one(j)
    return [dict((k, v) for k, v in j.items() if k != "_id") for j in jobs]
