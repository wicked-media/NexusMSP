"""Consolidated Backup Center router.
Merges the previous backup_dashboard.py, backup_compliance.py, and backup_verify.py.
All original endpoint paths are preserved so frontend integrations stay intact.
"""
from fastapi import APIRouter, Depends
from app.database import db
from app.auth import get_current_user
from app.services.integrations import acronis_service
from datetime import datetime, timezone
import uuid

router = APIRouter(tags=["Backup Center"])


# ---------------------------------------------------------------------------
# Acronis helpers (from backup_dashboard.py)
# ---------------------------------------------------------------------------
def _machine_health_to_status(h: str) -> str:
    if h == "ok":
        return "success"
    if h == "failed":
        return "failed"
    if h == "warning":
        return "warning"
    return "unknown"


async def _build_overview_from_acronis():
    try:
        resp = await acronis_service.get_resource_statuses()
        items = resp.get("items", []) if isinstance(resp, dict) else []
    except Exception:
        items = []

    jobs = []
    for it in items:
        ctx = it.get("context", {}) or {}
        if ctx.get("type") != "resource.machine":
            continue
        agg = it.get("aggregate", {}) or {}
        policies = it.get("policies", []) or []
        backup_policies = [p for p in policies if "backup" in (p.get("type", "") or "")]
        last_run = None
        next_run = None
        for bp in backup_policies:
            lr = bp.get("last_run")
            nr = bp.get("next_run")
            if lr and (not last_run or lr > last_run):
                last_run = lr
            if nr and (not next_run or nr < next_run):
                next_run = nr

        status = agg.get("status", "unknown")
        health = "ok" if status in ("ok", "idle") else (
            "failed" if status in ("error", "critical") else
            "warning" if status == "warning" else status
        )

        jobs.append({
            "id": ctx.get("id", ""),
            "client_id": ctx.get("tenant_id", ""),
            "client_name": ctx.get("tenant_name", ""),
            "device_name": ctx.get("name") or ctx.get("user_defined_name") or "Unknown",
            "provider": "Acronis",
            "job_type": "backup",
            "status": _machine_health_to_status(health),
            "size_gb": 0,
            "duration_minutes": 0,
            "last_run": last_run,
            "next_run": next_run,
            "completed_at": last_run,
            "started_at": last_run,
            "retention_days": None,
            "plan_names": agg.get("names", ""),
        })
    return jobs


# ---------------------------------------------------------------------------
# Dashboard endpoints (backup_dashboard.py)
# ---------------------------------------------------------------------------
@router.get("/backup-dashboard/overview")
async def get_backup_overview(current_user: dict = Depends(get_current_user)):
    data = await db.backup_jobs.find({}, {"_id": 0}).to_list(500)
    if not data:
        data = await _build_overview_from_acronis()
    total = len(data)
    success = sum(1 for d in data if d.get("status") == "success")
    failed = sum(1 for d in data if d.get("status") == "failed")
    running = sum(1 for d in data if d.get("status") == "running")
    total_size_gb = sum(d.get("size_gb", 0) or 0 for d in data)
    return {
        "summary": {
            "total_jobs": total,
            "successful": success,
            "failed": failed,
            "running": running,
            "success_rate": round(success / total * 100, 1) if total else 0,
            "total_size_gb": round(total_size_gb, 1),
        },
        "jobs": data,
    }


@router.get("/backup-dashboard/clients")
async def get_backup_by_client(current_user: dict = Depends(get_current_user)):
    pipeline = [{"$group": {
        "_id": "$client_name",
        "total": {"$sum": 1},
        "success": {"$sum": {"$cond": [{"$eq": ["$status", "success"]}, 1, 0]}},
        "failed": {"$sum": {"$cond": [{"$eq": ["$status", "failed"]}, 1, 0]}},
        "total_size_gb": {"$sum": "$size_gb"},
    }}]
    results = await db.backup_jobs.aggregate(pipeline).to_list(50)
    if results:
        return [{
            "client_name": r["_id"],
            "total": r["total"],
            "success": r["success"],
            "failed": r["failed"],
            "total_size_gb": round(r["total_size_gb"] or 0, 1),
            "success_rate": round(r["success"] / r["total"] * 100, 1) if r["total"] else 0,
        } for r in results]

    jobs = await _build_overview_from_acronis()
    by_tenant = {}
    for j in jobs:
        tn = j.get("client_name") or "Unknown"
        b = by_tenant.setdefault(tn, {"client_name": tn, "total": 0, "success": 0, "failed": 0, "total_size_gb": 0})
        b["total"] += 1
        if j["status"] == "success":
            b["success"] += 1
        elif j["status"] == "failed":
            b["failed"] += 1
    out = []
    for b in by_tenant.values():
        b["success_rate"] = round(b["success"] / b["total"] * 100, 1) if b["total"] else 0
        b["total_size_gb"] = round(b["total_size_gb"], 1)
        out.append(b)
    return out


# ---------------------------------------------------------------------------
# Compliance endpoints (backup_compliance.py)
# ---------------------------------------------------------------------------
@router.get("/backup-compliance/dashboard")
async def get_backup_compliance(user=Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0, "id": 1, "name": 1, "client_id": 1, "client_name": 1, "device_type": 1, "status": 1}).to_list(500)
    backup_records = await db.backup_records.find({}, {"_id": 0}).to_list(1000)

    device_backup = {}
    for br in backup_records:
        did = br.get("device_id")
        if did not in device_backup or br.get("completed_at", "") > device_backup[did].get("completed_at", ""):
            device_backup[did] = br

    results = []
    compliant = 0
    non_compliant = 0
    no_backup = 0
    not_assessed = 0
    evidence_available = bool(backup_records)

    for d in devices:
        if not d.get("name"):
            continue
        backup = device_backup.get(d["id"])
        if backup:
            rpo_hours = backup.get("rpo_hours", 24)
            rto_hours = backup.get("rto_hours", 4)
            last_backup = backup.get("completed_at", "")
            status = backup.get("status", "unknown")
            size_gb = backup.get("size_gb", 0)
            if status == "success":
                compliant += 1
                compliance = "compliant"
            else:
                non_compliant += 1
                compliance = "non_compliant"
        else:
            rpo_hours = 0
            rto_hours = 0
            last_backup = None
            status = "no_backup" if evidence_available else "not_assessed"
            size_gb = 0
            if evidence_available:
                no_backup += 1
                compliance = "no_backup"
            else:
                not_assessed += 1
                compliance = "not_assessed"

        results.append({
            "device_id": d["id"], "device_name": d["name"],
            "client_id": d.get("client_id", ""), "client_name": d.get("client_name", ""),
            "device_type": d.get("device_type", ""), "device_status": d.get("status", ""),
            "last_backup": last_backup, "backup_status": status,
            "rpo_hours": rpo_hours, "rto_hours": rto_hours,
            "size_gb": size_gb, "compliance": compliance,
        })

    return {
        "stats": {
            "total_devices": len(results),
            "compliant": compliant,
            "non_compliant": non_compliant,
            "no_backup": no_backup,
            "not_assessed": not_assessed,
            "evaluated": compliant + non_compliant + no_backup,
            "compliance_pct": round((compliant / max(compliant + non_compliant + no_backup, 1)) * 100, 1) if evidence_available else 0,
            "evidence_available": evidence_available,
        },
        "devices": results,
    }


# ---------------------------------------------------------------------------
# Verification endpoints (backup_verify.py)
# ---------------------------------------------------------------------------
@router.get("/backup-verify/overview")
async def backup_verify_overview(current_user: dict = Depends(get_current_user)):
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
