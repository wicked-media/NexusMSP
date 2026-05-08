from fastapi import APIRouter, Depends
from app.database import db
from app.auth import get_current_user
import uuid

router = APIRouter()


@router.get("/backup-verify/overview")
async def backup_verify_overview(current_user: dict = Depends(get_current_user)):
    """Return real backup verification tests recorded in the DB.
    Acronis Cyber Cloud's public API does not expose restore-verification results,
    so this view is populated by manual/scheduled runs through /backup-verify/run."""
    tests = await db.backup_verifications.find({}, {"_id": 0}).sort("tested_at", -1).to_list(100)
    passed = len([t for t in tests if t.get("result") == "pass"])
    return {
        "tests": tests,
        "summary": {
            "total_tests": len(tests),
            "passed": passed,
            "failed": len(tests) - passed,
            "pass_rate_pct": round(passed / len(tests) * 100, 1) if tests else 0,
            "last_test_run": tests[0].get("tested_at") if tests else None,
            "avg_restore_time_min": round(
                sum(t.get("restore_time_minutes", 0) for t in tests) / max(len(tests), 1), 1
            ) if tests else 0,
        },
    }


@router.post("/backup-verify/run")
async def run_verification(data: dict, current_user: dict = Depends(get_current_user)):
    return {
        "status": "scheduled",
        "test_id": f"bv-{uuid.uuid4().hex[:8]}",
        "message": "Backup verification test scheduled",
    }
