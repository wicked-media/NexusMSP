from fastapi import APIRouter, Depends
from app.database import db
from app.auth import get_current_user
from app.services.integrations import acronis_service

router = APIRouter()


def _machine_health_to_status(h: str) -> str:
    """Map Acronis backup_health → legacy job status keyword."""
    if h == "ok":
        return "success"
    if h == "failed":
        return "failed"
    if h == "warning":
        return "warning"
    return "unknown"


async def _build_overview_from_acronis():
    """Synthesise a dashboard overview from live Acronis backup-statuses.
    Returns the same shape as the legacy endpoint so existing UI keeps working."""
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


@router.get("/backup-dashboard/overview")
async def get_backup_overview(current_user: dict = Depends(get_current_user)):
    # Prefer locally tracked jobs (e.g. from non-Acronis providers); else synthesise from Acronis live data.
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

    # Fallback: aggregate Acronis live data by tenant_name
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
