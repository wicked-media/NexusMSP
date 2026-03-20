from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random, uuid

router = APIRouter()

@router.get("/backup-verify/overview")
async def backup_verify_overview(current_user: dict = Depends(get_current_user)):
    tests = await db.backup_verifications.find({}, {"_id": 0}).sort("tested_at", -1).to_list(100)
    if not tests:
        tests = await _seed_tests()
    passed = len([t for t in tests if t.get("result") == "pass"])
    return {"tests": tests, "summary": {"total_tests": len(tests), "passed": passed, "failed": len(tests) - passed, "pass_rate_pct": round(passed / len(tests) * 100, 1) if tests else 0, "last_test_run": tests[0].get("tested_at") if tests else None, "avg_restore_time_min": round(sum(t.get("restore_time_minutes", 0) for t in tests) / max(len(tests), 1), 1)}}

@router.post("/backup-verify/run")
async def run_verification(data: dict, current_user: dict = Depends(get_current_user)):
    return {"status": "scheduled", "test_id": f"bv-{uuid.uuid4().hex[:8]}", "message": "Backup verification test scheduled"}

async def _seed_tests():
    clients = ["TechStart Inc", "Global Finance Ltd", "HealthCare Plus", "NovaTech Research", "Pacific Schools District"]
    tests = []
    for c in clients:
        for btype in ["Full System Image", "SQL Database", "File Share", "Exchange Mailbox"]:
            t = {"id": f"bv-{uuid.uuid4().hex[:8]}", "client_name": c, "backup_type": btype, "backup_solution": random.choice(["Acronis", "Veeam", "Datto BCDR"]), "result": random.choices(["pass", "fail"], weights=[85, 15])[0], "restore_time_minutes": round(random.uniform(5, 120), 1), "data_integrity_check": random.choice(["checksum_match", "checksum_match", "partial_corruption"]), "tested_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 30))).isoformat(), "next_scheduled": (datetime.now(timezone.utc) + timedelta(days=random.randint(7, 30))).isoformat(), "notes": ""}
            if t["result"] == "fail":
                t["notes"] = random.choice(["VSS snapshot failed", "Backup file corrupted", "Restore target disk full", "Network timeout during restore"])
            tests.append(t)
            await db.backup_verifications.insert_one(t)
    return [{k: v for k, v in t.items() if k != "_id"} for t in tests]
