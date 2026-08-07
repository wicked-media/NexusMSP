"""Consolidated Backup Center router.
Merges the previous backup_dashboard.py, backup_compliance.py, and backup_verify.py.
All original endpoint paths are preserved so frontend integrations stay intact.
"""
from fastapi import APIRouter, Depends, HTTPException
from app.database import db
from app.auth import get_current_user
from app.services.integrations import acronis_service
from app.services.backup_assurance import build_backup_confidence, simulate_recovery
from app.services.scope_permissions import assert_client_scope, scoped_query
from datetime import datetime, timezone
import uuid

router = APIRouter(tags=["Backup Center"])


def _backup_client_match(row: dict, client_id: str, client_name: str = "") -> bool:
    if not client_id:
        return True
    aliases = {client_id.strip().lower(), client_name.strip().lower()} - {""}
    values = {
        str(row.get("client_id") or "").strip().lower(),
        str(row.get("client_name") or "").strip().lower(),
    }
    return bool(aliases & values)


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
    failed = len([t for t in tests if t.get("result") in {"fail", "failed"}])
    pending = len([t for t in tests if t.get("result") in {"pending", "scheduled"}])
    measured_restore_times = [
        float(test["restore_time_minutes"])
        for test in tests
        if test.get("result") in {"pass", "fail", "failed"} and test.get("restore_time_minutes") is not None
    ]
    return {
        "tests": tests,
        "summary": {
            "total_tests": len(tests),
            "passed": passed,
            "failed": failed,
            "pending": pending,
            "pass_rate_pct": round(passed / max(passed + failed, 1) * 100, 1) if passed or failed else 0,
            "last_test_run": tests[0].get("tested_at") if tests else None,
            "avg_restore_time_min": round(sum(measured_restore_times) / len(measured_restore_times), 1) if measured_restore_times else None,
        },
    }


@router.post("/backup-verify/run")
async def run_verification(data: dict, current_user: dict = Depends(get_current_user)):
    """Create an auditable restore-verification request for the backup team."""
    client_id = str(data.get("client_id") or "")
    if not client_id:
        raise HTTPException(status_code=400, detail="Choose the customer whose recovery evidence is being tested")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1, "company_name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Selected client was not found")
    now = datetime.now(timezone.utc).isoformat()
    test_id = f"bv-{uuid.uuid4().hex[:8]}"
    record = {
        "id": test_id,
        "client_id": client_id,
        "client_name": client.get("company_name") or client.get("name") or "Customer",
        "backup_type": data.get("backup_type") or "Recovery test",
        "backup_solution": data.get("backup_solution") or "Acronis",
        "result": "pending",
        "status": "scheduled",
        "requested_at": now,
        "tested_at": now,
        "requested_by": current_user.get("id") or current_user.get("email"),
        "requested_by_name": current_user.get("name") or current_user.get("email"),
        "notes": data.get("notes") or "Restore verification requested from NexusMSP Backup Centre.",
    }
    await db.backup_verifications.insert_one(record)
    await db.activity_logs.insert_one({
        "id": str(uuid.uuid4()), "action": "backup_verification_requested", "entity_type": "backup_verification",
        "entity_id": test_id, "entity_name": record["client_name"], "user_id": current_user.get("id", ""),
        "user_name": record["requested_by_name"], "details": f"{record['backup_type']} scheduled for {record['client_name']}", "created_at": now,
        "changes": {"status": {"old": None, "new": "scheduled"}},
        "metadata": {"client_id": client_id, "backup_solution": record["backup_solution"], "backup_type": record["backup_type"]},
    })
    return {
        "status": "scheduled",
        "test_id": test_id,
        "message": "Backup verification request recorded and scheduled",
    }


@router.put("/backup-verify/{test_id}")
async def complete_verification(test_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Record the measured outcome of a completed restore verification."""
    existing = await db.backup_verifications.find_one({"id": test_id}, {"_id": 0})
    if not existing:
        return {"status": "not_found", "message": "Verification request not found"}
    result = str(data.get("result") or "").lower()
    if result not in {"pass", "fail"}:
        return {"status": "invalid", "message": "Result must be pass or fail"}
    try:
        restore_time = float(data.get("restore_time_minutes", 0) or 0)
    except (TypeError, ValueError):
        return {"status": "invalid", "message": "Restore time must be a number"}
    now = datetime.now(timezone.utc).isoformat()
    update = {
        "result": result,
        "status": "completed",
        "restore_time_minutes": restore_time,
        "data_integrity_check": str(data.get("data_integrity_check") or "not_recorded"),
        "notes": str(data.get("notes") or existing.get("notes") or ""),
        "tested_at": now,
        "completed_at": now,
        "completed_by": current_user.get("id") or current_user.get("email"),
        "completed_by_name": current_user.get("name") or current_user.get("email"),
    }
    await db.backup_verifications.update_one({"id": test_id}, {"$set": update})
    await db.activity_logs.insert_one({
        "id": str(uuid.uuid4()), "action": "backup_verification_completed", "entity_type": "backup_verification",
        "entity_id": test_id, "entity_name": existing.get("client_name") or "Backup verification",
        "user_id": current_user.get("id", ""), "user_name": update["completed_by_name"],
        "details": f"Restore verification recorded as {result} ({restore_time:g} minutes)", "created_at": now,
        "changes": {"result": {"old": existing.get("result"), "new": result}, "status": {"old": existing.get("status"), "new": "completed"}},
        "metadata": {"restore_time_minutes": restore_time, "data_integrity_check": update["data_integrity_check"], "client_id": existing.get("client_id")},
    })
    return {"status": "completed", "result": result, "message": "Restore verification outcome recorded"}


@router.get("/backup-assurance/overview")
async def backup_assurance_overview(client_id: str = "", current_user: dict = Depends(get_current_user)):
    """Return explainable recovery confidence and retained simulation history."""
    client = None
    if client_id:
        await assert_client_scope(current_user, client_id, operation="backup.assurance.read")
        client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1, "company_name": 1})
        if not client:
            raise HTTPException(status_code=404, detail="Selected customer was not found")
    client_name = (client or {}).get("company_name") or (client or {}).get("name") or ""
    jobs = await db.backup_jobs.find(scoped_query(current_user, {}, site_field=None), {"_id": 0}).to_list(2000)
    if not jobs:
        jobs = await _build_overview_from_acronis()
    records = await db.backup_records.find(scoped_query(current_user, {}, site_field=None), {"_id": 0}).to_list(5000)
    tests = await db.backup_verifications.find(scoped_query(current_user, {}, site_field=None), {"_id": 0}).to_list(2000)
    if client_id:
        jobs = [row for row in jobs if _backup_client_match(row, client_id, client_name)]
        records = [row for row in records if _backup_client_match(row, client_id, client_name)]
        tests = [row for row in tests if _backup_client_match(row, client_id, client_name)]
    simulations_query = scoped_query(
        current_user,
        {"client_id": client_id} if client_id else {},
        site_field=None,
    )
    simulations = await db.backup_recovery_simulations.find(simulations_query, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": {"client_id": client_id, "client_name": client_name or "All managed clients"},
        "confidence": build_backup_confidence(jobs, records, tests),
        "simulations": simulations,
        "engine_boundary": {
            "management_layer": "Nexus recovery assurance and orchestration",
            "provider_engines": sorted({str(row.get("provider") or row.get("backup_solution") or "Unknown") for row in [*jobs, *tests]} - {"Unknown"}),
            "native_engine_status": "roadmap",
            "statement": "Nexus manages evidence and recovery workflows; provider engines remain authoritative for backup execution.",
        },
    }


@router.post("/backup-assurance/simulate")
async def create_recovery_simulation(data: dict, current_user: dict = Depends(get_current_user)):
    """Create a read-only recovery preview using current customer evidence."""
    client_id = str(data.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=400, detail="Choose the customer whose recovery is being simulated")
    await assert_client_scope(current_user, client_id, operation="backup.recovery.simulate")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1, "company_name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Selected customer was not found")
    workload = str(data.get("workload") or "").strip()
    if not workload:
        raise HTTPException(status_code=400, detail="Describe the workload or service being recovered")
    try:
        target_rto = float(data.get("target_rto_hours") or 0)
        target_rpo = float(data.get("target_rpo_hours") or 0)
        data_size = float(data.get("data_size_gb") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="RTO, RPO and data size must be numeric")
    if not 0 < target_rto <= 720 or not 0 < target_rpo <= 720:
        raise HTTPException(status_code=422, detail="RTO and RPO must be between 0 and 720 hours")
    if not 0 <= data_size <= 10_000_000:
        raise HTTPException(status_code=422, detail="Data size must be between 0 and 10,000,000 GB")
    raw_dependencies = data.get("dependencies") or []
    if isinstance(raw_dependencies, str):
        dependencies = [part.strip() for part in raw_dependencies.split(",") if part.strip()]
    elif isinstance(raw_dependencies, list):
        dependencies = [str(part).strip() for part in raw_dependencies if str(part).strip()]
    else:
        raise HTTPException(status_code=422, detail="Dependencies must be a comma-separated list")

    jobs = await db.backup_jobs.find({}, {"_id": 0}).to_list(2000)
    if not jobs:
        jobs = await _build_overview_from_acronis()
    records = await db.backup_records.find({}, {"_id": 0}).to_list(5000)
    tests = await db.backup_verifications.find({}, {"_id": 0}).to_list(2000)
    client_name = client.get("company_name") or client.get("name") or "Customer"
    result = simulate_recovery(
        client_id=client_id,
        client_name=client_name,
        workload=workload,
        target_rto_hours=target_rto,
        target_rpo_hours=target_rpo,
        data_size_gb=data_size,
        dependencies=dependencies,
        jobs=jobs,
        records=records,
        tests=tests,
    )
    now = datetime.now(timezone.utc).isoformat()
    simulation_id = f"recovery-sim-{uuid.uuid4().hex[:12]}"
    technician_name = current_user.get("name") or current_user.get("email") or "Authenticated technician"
    record = {
        **result,
        "id": simulation_id,
        "created_at": now,
        "created_by": current_user.get("id") or current_user.get("email"),
        "created_by_name": technician_name,
        "assumptions": str(data.get("assumptions") or "").strip(),
    }
    await db.backup_recovery_simulations.insert_one(record)
    await db.activity_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": "backup_recovery_simulated",
        "entity_type": "backup_recovery_simulation",
        "entity_id": simulation_id,
        "entity_name": f"{client_name} · {workload}",
        "user_id": current_user.get("id", ""),
        "user_name": technician_name,
        "details": f"Recorded a read-only recovery simulation with status {result['readiness']}",
        "created_at": now,
        "metadata": {"client_id": client_id, "external_changes": False, "blockers": len(result["blockers"])},
    })
    record.pop("_id", None)
    return {"message": "Recovery simulation recorded without changing production systems", "simulation": record}
