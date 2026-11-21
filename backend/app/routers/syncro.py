from fastapi import APIRouter, Body, Depends, HTTPException, Response
from datetime import datetime, timezone
import asyncio
import logging

from app.database import db
from app.auth import get_current_user
from app.services import syncro_migration as migration
from app.services.action_permissions import require_action
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

logger = logging.getLogger(__name__)
router = APIRouter()

# Keep strong references to migration tasks for the lifetime of the process.
# The task itself owns its failure state in MongoDB, so a process restart leaves
# an operator-visible failed/interrupted job rather than a silent disappearance.
_migration_tasks: set[asyncio.Task] = set()


async def _syncro_config(current_user: dict) -> dict | None:
    return await db.settings.find_one(
        tenant_scoped_query(current_user, {"type": "syncro"}),
        {"_id": 0},
    )


async def _save_syncro_config(current_user: dict, values: dict) -> None:
    """Update the tenant's Syncro document without creating a duplicate."""
    tenant_id = platform_tenant_id(current_user)
    existing = await db.settings.find_one(
        tenant_scoped_query(current_user, {"type": "syncro"}),
        {"_id": 1},
    )
    payload = {
        "type": "syncro",
        "tenant_id": tenant_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        **values,
    }
    if existing:
        await db.settings.update_one({"_id": existing["_id"]}, {"$set": payload})
    else:
        await db.settings.insert_one(payload)


def _start_job_task(job_id: str) -> None:
    task = asyncio.create_task(migration.run_migration_job(job_id))
    _migration_tasks.add(task)

    def _done(completed: asyncio.Task) -> None:
        _migration_tasks.discard(completed)
        try:
            completed.result()
        except Exception:
            logger.exception("Syncro migration task %s ended unexpectedly", job_id)

    task.add_done_callback(_done)


# ============== SYNCRO SETTINGS ==============

@router.get("/syncro/settings")
async def get_syncro_settings(current_user: dict = Depends(get_current_user)):
    doc = await _syncro_config(current_user)
    key_configured = bool(doc and doc.get("api_key"))
    if doc and key_configured:
        key = str(doc["api_key"])
        doc["api_key"] = key[:8] + "..." + key[-4:] if len(key) > 12 else "****"
    result = doc or {"type": "syncro", "subdomain": "", "api_key": "", "enabled": False}
    result["api_key_configured"] = key_configured
    return result


@router.put("/syncro/settings")
async def update_syncro_settings(
    data: dict,
    current_user: dict = Depends(get_current_user),
    _: dict = Depends(require_action("platform.data.import.manage")),
):
    subdomain = str(data.get("subdomain") or "").strip()
    if subdomain:
        try:
            subdomain = migration.normalise_subdomain(subdomain)
        except migration.SyncroConfigurationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    existing = await _syncro_config(current_user)
    api_key = str(data.get("api_key") or "").strip()
    if not api_key and not (existing and existing.get("api_key")):
        raise HTTPException(status_code=422, detail="Syncro API key is required")
    values = {
        "subdomain": subdomain,
        "enabled": bool(data.get("enabled", False)),
    }
    # An empty field means "keep the existing secret", not "erase it". The
    # settings response only returns a masked value, so the browser must never
    # save that mask back over the real token.
    if api_key:
        values["api_key"] = api_key
    await _save_syncro_config(current_user, values)
    return {"message": "Syncro settings saved"}


@router.post("/syncro/test-connection")
async def test_syncro_connection(
    current_user: dict = Depends(get_current_user),
    _: dict = Depends(require_action("platform.data.import.manage")),
):
    doc = await _syncro_config(current_user)
    if not doc or not doc.get("api_key") or not doc.get("subdomain"):
        raise HTTPException(status_code=400, detail="Syncro not configured")

    client = None
    try:
        client = migration.SyncroClient(doc["subdomain"], doc["api_key"])
        await client.get("/customers", {"page": 1, "per_page": 1})
        return {"status": "connected", "message": "Successfully connected to Syncro"}
    except migration.SyncroConfigurationError as exc:
        return {"status": "error", "message": str(exc)}
    except migration.SyncroAPIError as exc:
        return {"status": "error", "message": str(exc)}
    except Exception:
        logger.warning("Syncro connection test failed", exc_info=True)
        return {"status": "error", "message": "Syncro connection failed. Check the subdomain and API token."}
    finally:
        if client is not None:
            await client.close()


# ============== MIGRATION API ==============

@router.get(
    "/syncro/migration/capabilities",
    dependencies=[Depends(require_action("platform.data.import.view"))],
)
async def syncro_migration_capabilities(current_user: dict = Depends(get_current_user)):
    """Return the supported one-time migration surface without touching Syncro."""
    return migration.capabilities()


@router.get(
    "/syncro/migration/jobs",
    dependencies=[Depends(require_action("platform.data.import.view"))],
)
async def list_syncro_migration_jobs(
    limit: int = 20,
    current_user: dict = Depends(get_current_user),
):
    jobs = await migration.list_jobs(db, platform_tenant_id(current_user), limit=limit)
    return {"jobs": jobs}


@router.post(
    "/syncro/migration/jobs",
    dependencies=[Depends(require_action("platform.data.import.manage"))],
)
async def create_syncro_migration_job(
    payload: dict = Body(default={}),
    current_user: dict = Depends(get_current_user),
):
    doc = await _syncro_config(current_user)
    if not doc or not doc.get("api_key") or not doc.get("subdomain"):
        raise HTTPException(status_code=400, detail="Configure Syncro before starting a migration")

    mode = str(payload.get("mode") or "dry_run").strip().lower()
    if mode not in {"dry_run", "apply"}:
        raise HTTPException(status_code=422, detail="mode must be dry_run or apply")
    entities = payload.get("entities")
    if entities is not None and not isinstance(entities, list):
        raise HTTPException(status_code=422, detail="entities must be a list")

    try:
        job = await migration.create_job(
            db,
            tenant_id=platform_tenant_id(current_user),
            requested_by=str(current_user.get("name") or current_user.get("email") or current_user.get("id") or "system"),
            entities=entities,
            mode=mode,
        )
    except migration.ActiveMigrationError as exc:
        raise HTTPException(
            status_code=409,
            detail=f"A Syncro migration is already running (job {exc.job_id})",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    _start_job_task(job["id"])
    return job


@router.get(
    "/syncro/migration/jobs/{job_id}",
    dependencies=[Depends(require_action("platform.data.import.view"))],
)
async def get_syncro_migration_job(
    job_id: str,
    current_user: dict = Depends(get_current_user),
):
    job = await migration.get_job(db, platform_tenant_id(current_user), job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Migration job not found")
    return job


@router.post(
    "/syncro/migration/jobs/{job_id}/cancel",
    dependencies=[Depends(require_action("platform.data.import.manage"))],
)
async def cancel_syncro_migration_job(
    job_id: str,
    current_user: dict = Depends(get_current_user),
):
    tenant_id = platform_tenant_id(current_user)
    job = await migration.get_job(db, tenant_id, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Migration job not found")
    if job.get("status") not in {"queued", "running"}:
        return job
    updates = {
        "cancel_requested": True,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if job.get("status") == "queued":
        updates.update({"status": "cancelled", "completed_at": datetime.now(timezone.utc).isoformat()})
    await db.syncro_migration_jobs.update_one(
        migration.tenant_query(tenant_id, {"id": job_id}),
        {"$set": updates},
    )
    updated = await migration.get_job(db, tenant_id, job_id)
    return updated or job


@router.get(
    "/syncro/migration/jobs/{job_id}/failures",
    dependencies=[Depends(require_action("platform.data.import.view"))],
)
async def list_syncro_migration_failures(
    job_id: str,
    limit: int = 100,
    current_user: dict = Depends(get_current_user),
):
    failures = await migration.list_failures(
        db,
        platform_tenant_id(current_user),
        job_id,
        limit=limit,
    )
    return {"failures": failures}


@router.get(
    "/syncro/migration/jobs/{job_id}/reconciliation",
    dependencies=[Depends(require_action("platform.data.import.view"))],
)
async def get_syncro_migration_reconciliation(
    job_id: str,
    issues_only: bool = True,
    limit: int = 100,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """Compare archived Syncro invoice/payment evidence with current Nexus records."""
    tenant_id = platform_tenant_id(current_user)
    job = await migration.get_job(db, tenant_id, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Migration job not found")
    if job.get("mode") != "apply":
        raise HTTPException(
            status_code=409,
            detail="Reconciliation is available after an applied migration, not a dry run",
        )
    if job.get("status") != "completed":
        raise HTTPException(
            status_code=409,
            detail="Reconciliation is available only after the migration job completes",
        )
    report = await migration.build_reconciliation_report(
        db,
        tenant_id,
        job_id,
        issues_only=issues_only,
        limit=limit,
        offset=offset,
    )
    if not report:
        raise HTTPException(status_code=404, detail="Migration job not found")
    return report


@router.get(
    "/syncro/migration/jobs/{job_id}/reconciliation.csv",
    dependencies=[Depends(require_action("platform.data.import.view"))],
)
async def export_syncro_migration_reconciliation(
    job_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Export the read-only reconciliation evidence as a CSV attachment."""
    tenant_id = platform_tenant_id(current_user)
    job = await migration.get_job(db, tenant_id, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Migration job not found")
    if job.get("mode") != "apply":
        raise HTTPException(
            status_code=409,
            detail="Reconciliation is available after an applied migration, not a dry run",
        )
    if job.get("status") != "completed":
        raise HTTPException(
            status_code=409,
            detail="Reconciliation is available only after the migration job completes",
        )
    report = await migration.build_reconciliation_report(
        db,
        tenant_id,
        job_id,
        issues_only=False,
        all_rows=True,
    )
    if not report:
        raise HTTPException(status_code=404, detail="Migration job not found")
    filename = f"syncro-reconciliation-{report['job']['id']}.csv"
    return Response(
        content=migration.reconciliation_csv(report),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ============== COMPATIBILITY ENDPOINTS ==============

@router.post("/syncro/import-clients")
async def import_clients_from_syncro(
    current_user: dict = Depends(get_current_user),
    _: dict = Depends(require_action("platform.data.import.manage")),
):
    """Compatibility entry point for the old client-only import button.

    The old synchronous importer skipped existing customers, so it could not
    update names or assets. It now starts the same idempotent migration job as
    the full migration workspace.
    """
    doc = await _syncro_config(current_user)
    if not doc or not doc.get("api_key") or not doc.get("subdomain"):
        raise HTTPException(status_code=400, detail="Configure Syncro before starting an import")
    try:
        job = await migration.create_job(
            db,
            tenant_id=platform_tenant_id(current_user),
            requested_by=str(current_user.get("name") or current_user.get("email") or "system"),
            entities=["customers", "contacts", "assets"],
            mode="apply",
        )
    except migration.ActiveMigrationError as exc:
        raise HTTPException(status_code=409, detail=f"Migration already running (job {exc.job_id})") from exc
    _start_job_task(job["id"])
    return {
        "status": "accepted",
        "job_id": job["id"],
        "message": "Syncro import queued. Follow progress in the migration panel.",
        "job": job,
    }


@router.get("/syncro/import-preview")
async def preview_syncro_import(current_user: dict = Depends(get_current_user)):
    """Retained for clients that expected the old preview route.

    A real preview is a dry-run migration job so it exercises the same
    pagination, mappings and duplicate checks as the applied run.
    """
    return {
        "deprecated": True,
        "message": "Start a dry-run migration job to preview counts without writing records.",
        "capabilities": migration.capabilities(),
    }
