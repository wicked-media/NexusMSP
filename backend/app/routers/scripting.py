from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta, time
from zoneinfo import ZoneInfo
import uuid
from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.routers.nexus_agent import require_agent_operator
from app.services.scope_permissions import assert_client_scope, assert_record_scope, effective_scope, scoped_query
from app.models import *

router = APIRouter()


def _normalise_target_ids(value: Any) -> list[str]:
    """Accept only stable, de-duplicated device-ID collections."""
    if not isinstance(value, (list, tuple, set, frozenset)):
        return []
    return list(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))


def _task_client_ids(task: dict) -> list[str]:
    values = task.get("client_ids")
    if not isinstance(values, (list, tuple, set, frozenset)):
        return []
    return sorted({str(item).strip() for item in values if str(item).strip()})


def _target_scope_map(task: dict) -> dict[str, dict]:
    """Read the immutable per-device authorisation snapshot for a saved task."""
    scopes = task.get("target_scopes")
    if not isinstance(scopes, list):
        return {}
    return {
        str(scope.get("device_id") or "").strip(): scope
        for scope in scopes
        if isinstance(scope, dict) and str(scope.get("device_id") or "").strip()
    }


def _target_scopes(devices: list[dict]) -> list[dict]:
    """Persist stable device/client/site provenance only from scoped records."""
    return [
        {
            "device_id": device["id"],
            "client_id": str(device.get("client_id") or "").strip(),
            "site_id": str(device.get("site_id") or "").strip() or None,
        }
        for device in devices
    ]


def _scheduled_task_scope_query(current_user: dict, query: dict | None = None) -> dict:
    """Fail closed for legacy tasks that have no durable client provenance."""
    operational = dict(query or {})
    scope = effective_scope(current_user)
    if scope["mode"] == "all":
        return operational
    provenance_clause = {
        "client_ids.0": {"$exists": True},
        "client_ids": {"$not": {"$elemMatch": {"$nin": scope["client_ids"]}}},
    }
    clauses = ([operational] if operational else []) + [provenance_clause]
    return clauses[0] if len(clauses) == 1 else {"$and": clauses}


async def _resolve_scoped_target_devices(
    current_user: dict,
    target_ids: Any,
    *,
    operation: str,
    allow_empty: bool = False,
) -> list[dict]:
    """Resolve all user-selected targets before any execution record or command exists."""
    ids = _normalise_target_ids(target_ids)
    if not ids:
        if allow_empty:
            return []
        raise HTTPException(400, "At least one target device is required")
    return [
        await assert_record_scope(
            current_user,
            db.devices,
            device_id,
            operation=operation,
            resource_name="Managed asset",
        )
        for device_id in ids
    ]


async def _load_scoped_scheduled_task(
    task_id: str,
    current_user: dict,
    *,
    operation: str,
    require_target_provenance: bool = False,
    validate_target_provenance: bool = True,
) -> tuple[dict, list[dict]]:
    """Load a task and re-authorise every current target before mutation/run-now."""
    task = await db.scheduled_tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Scheduled task not found")

    target_ids = _normalise_target_ids(task.get("target_ids"))
    if not target_ids:
        declared_client_ids = _task_client_ids(task)
        if declared_client_ids:
            for client_id in declared_client_ids:
                await assert_client_scope(
                    current_user,
                    client_id,
                    operation=operation,
                    mask_not_found=True,
                )
        else:
            await assert_client_scope(
                current_user,
                None,
                operation=operation,
                mask_not_found=True,
            )
        return task, []

    devices = await _resolve_scoped_target_devices(current_user, target_ids, operation=operation)
    declared_client_ids = set(_task_client_ids(task))
    current_client_ids = {str(device.get("client_id") or "").strip() for device in devices}
    if validate_target_provenance and declared_client_ids and (not current_client_ids or current_client_ids != declared_client_ids):
        raise HTTPException(409, "Scheduled task target ownership changed and requires revalidation")
    target_scopes = _target_scope_map(task)
    if require_target_provenance and (not declared_client_ids or len(target_scopes) != len(target_ids)):
        raise HTTPException(409, "Scheduled task requires target-scope revalidation before dispatch")
    if validate_target_provenance:
        for device in devices:
            expected = target_scopes.get(device["id"])
            if not expected:
                continue
            if (
                str(expected.get("client_id") or "").strip() != str(device.get("client_id") or "").strip()
                or (str(expected.get("site_id") or "").strip() or None) != (str(device.get("site_id") or "").strip() or None)
            ):
                raise HTTPException(409, "Scheduled task target ownership changed and requires revalidation")
    return task, devices


async def _resolve_worker_task_targets(task: dict) -> tuple[list[dict], str | None]:
    """Protect server-owned scheduled dispatch from stale or forged target state."""
    target_ids = _normalise_target_ids(task.get("target_ids"))
    if not target_ids:
        return [], None
    client_ids = set(_task_client_ids(task))
    if not client_ids:
        return [], "Task requires client-scope revalidation before scheduled dispatch"
    target_scopes = _target_scope_map(task)
    if len(target_scopes) != len(target_ids):
        return [], "Task requires target-scope revalidation before scheduled dispatch"
    devices: list[dict] = []
    for device_id in target_ids:
        device = await db.devices.find_one({"id": device_id}, {"_id": 0})
        if not device:
            return [], "A target device no longer exists"
        expected = target_scopes.get(device_id) or {}
        if (
            str(device.get("client_id") or "").strip() not in client_ids
            or str(expected.get("client_id") or "").strip() != str(device.get("client_id") or "").strip()
            or (str(expected.get("site_id") or "").strip() or None) != (str(device.get("site_id") or "").strip() or None)
        ):
            return [], "A target device client binding changed"
        devices.append(device)
    return devices, None


def _schedule_timezone(value: str | None):
    try:
        return ZoneInfo(value or "UTC")
    except Exception:
        return timezone.utc


def next_scheduled_run(task: dict, now: datetime | None = None) -> str:
    """Return the next due time in UTC for a saved script schedule."""
    now = now or datetime.now(timezone.utc)
    tz = _schedule_timezone(task.get("timezone"))
    local_now = now.astimezone(tz)
    try:
        hour, minute = [int(part) for part in str(task.get("schedule_time") or "09:00").split(":")[:2]]
        run_time = time(hour=max(0, min(23, hour)), minute=max(0, min(59, minute)))
    except Exception:
        run_time = time(9, 0)

    schedule_type = task.get("schedule_type", "once")
    if schedule_type in {"once", "daily"}:
        candidate = datetime.combine(local_now.date(), run_time, tzinfo=tz)
        if candidate <= local_now:
            candidate += timedelta(days=1)
        return candidate.astimezone(timezone.utc).isoformat()

    if schedule_type == "weekly":
        days = {int(day) for day in task.get("schedule_days", []) if str(day).isdigit() and 0 <= int(day) <= 6}
        days = days or {local_now.weekday()}
        for offset in range(8):
            candidate = datetime.combine(local_now.date() + timedelta(days=offset), run_time, tzinfo=tz)
            if candidate.weekday() in days and candidate > local_now:
                return candidate.astimezone(timezone.utc).isoformat()

    if schedule_type == "monthly":
        days = {int(day) for day in task.get("schedule_days", []) if str(day).isdigit() and 1 <= int(day) <= 31}
        days = days or {local_now.day}
        for month_offset in range(0, 14):
            month = (local_now.month - 1 + month_offset) % 12 + 1
            year = local_now.year + (local_now.month - 1 + month_offset) // 12
            for day in sorted(days):
                try:
                    candidate = datetime(year, month, day, run_time.hour, run_time.minute, tzinfo=tz)
                except ValueError:
                    continue
                if candidate > local_now:
                    return candidate.astimezone(timezone.utc).isoformat()

    return (now + timedelta(days=1)).isoformat()


def _agent_shell(script: dict) -> str | None:
    """Translate a saved-script type into a shell understood by Nexus Agent."""
    script_type = str(script.get("script_type") or "powershell").lower()
    if script_type in {"powershell", "ps1", "pwsh"}:
        return "powershell"
    if script_type in {"cmd", "batch", "bat"}:
        return "cmd"
    if script_type in {"bash", "shell", "sh"}:
        return "bash"
    return None


async def _dispatch_execution_to_agent(execution: dict, script: dict, device: dict, queued_by: str) -> bool:
    """Attach a ScriptExecution to the durable Nexus Agent command queue.

    Script history remains the technician-facing record while the agent command is
    the delivery mechanism.  A device without a live Nexus Agent is recorded as a
    failed run rather than left looking like work is still pending forever.
    """
    now = datetime.now(timezone.utc).isoformat()
    shell = _agent_shell(script)
    if not shell:
        await db.script_executions.update_one({"id": execution["id"]}, {"$set": {
            "status": "failed", "completed_at": now,
            "error_output": f"Unsupported script type: {script.get('script_type') or 'unknown'}",
        }})
        return False
    try:
        # Execution records carry the target client identity selected at the
        # authorisation boundary. Re-read just before queueing so a reassigned
        # device cannot be dispatched with stale target metadata.
        current_device = await db.devices.find_one({"id": device.get("id")}, {"_id": 0})
        if (
            not current_device
            or not execution.get("client_id")
            or current_device.get("client_id") != execution.get("client_id")
        ):
            raise HTTPException(409, "Managed asset ownership changed; command was not queued")
        # Kept local so the scheduled-task worker does not create an import cycle
        # while the application registers router modules at startup.
        from app.routers.nexus_agent import queue_command_for_device
        command_id = await queue_command_for_device(current_device, "run_script", {
            "script": script.get("content") or "",
            "shell": shell,
            "timeout_sec": int(script.get("timeout_seconds") or 300),
        }, queued_by=queued_by)
        if not command_id:
            raise HTTPException(409, "No active NexusOps Agent is linked to this device")
        await db.nexus_agent_commands.update_one({"id": command_id}, {"$set": {
            "script_execution_id": execution["id"],
            "script_id": script.get("id"),
            "scheduled_task_id": execution.get("scheduled_task_id"),
        }})
        await db.script_executions.update_one({"id": execution["id"]}, {"$set": {
            "command_id": command_id, "queued_at": now, "delivery": "nexus-agent",
        }})
        return True
    except HTTPException as exc:
        await db.script_executions.update_one({"id": execution["id"]}, {"$set": {
            "status": "failed", "completed_at": now, "error_output": str(exc.detail),
        }})
        return False


async def process_due_scheduled_tasks(now: datetime | None = None) -> dict:
    """Queue due saved-script runs for the agent, recording a durable run audit."""
    now = now or datetime.now(timezone.utc)
    due_tasks = await db.scheduled_tasks.find({"enabled": True, "next_run": {"$lte": now.isoformat()}} , {"_id": 0}).to_list(200)
    queued = 0
    processed = 0
    for task in due_tasks:
        script = await db.scripts.find_one({"id": task.get("script_id")}, {"_id": 0})
        if not script:
            await db.scheduled_tasks.update_one({"id": task["id"]}, {"$set": {"enabled": False, "last_error": "Script no longer exists", "updated_at": now.isoformat()}})
            continue
        target_devices, target_error = await _resolve_worker_task_targets(task)
        if target_error:
            await db.scheduled_tasks.update_one({"id": task["id"]}, {"$set": {
                "enabled": False,
                "last_error": target_error,
                "updated_at": now.isoformat(),
            }})
            continue
        is_once = task.get("schedule_type") == "once"
        next_run = None if is_once else next_scheduled_run(task, now)
        claim = await db.scheduled_tasks.update_one(
            {"id": task["id"], "enabled": True, "next_run": task.get("next_run")},
            {"$set": {"last_run": now.isoformat(), "next_run": next_run, "enabled": not is_once, "updated_at": now.isoformat()}, "$inc": {"run_count": 1}}
        )
        if not claim.modified_count:
            continue
        processed += 1
        executions = []
        for device in target_devices:
            device_id = device["id"]
            execution = ScriptExecution(
                script_id=script["id"], script_name=script.get("name"), device_id=device_id,
                device_name=device.get("name") or device.get("hostname"), client_id=device.get("client_id"),
                user_id=task.get("created_by", "scheduler"), user_name="Scheduler", status="pending"
            ).model_dump()
            execution.update({"created_at": now.isoformat(), "scheduled_task_id": task["id"]})
            executions.append(execution)
        if executions:
            await db.script_executions.insert_many(executions)
            for execution in executions:
                device = await db.devices.find_one({"id": execution["device_id"]}, {"_id": 0})
                if device and device.get("client_id") == execution.get("client_id"):
                    await _dispatch_execution_to_agent(execution, script, device, "scheduler")
            await db.scripts.update_one({"id": script["id"]}, {"$inc": {"run_count": len(executions)}, "$set": {"last_run": now.isoformat()}})
            queued += len(executions)
        await db.scheduled_task_runs.insert_one({"id": str(uuid.uuid4()), "task_id": task["id"], "script_id": script["id"], "queued_count": len(executions), "status": "queued", "ran_at": now.isoformat()})
    return {"processed": processed, "queued": queued}

# ============== SCRIPTING ENDPOINTS ==============

@router.get("/scripts")
async def get_scripts(
    category: Optional[str] = None,
    os_target: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if category:
        query["category"] = category
    if os_target:
        query["os_target"] = os_target
    
    scripts = await db.scripts.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    return scripts

@router.get("/scripts/{script_id}")
async def get_script(script_id: str, current_user: dict = Depends(get_current_user)):
    script = await db.scripts.find_one({"id": script_id}, {"_id": 0})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    return script

@router.post("/scripts")
async def create_script(script_data: ScriptCreate, current_user: dict = Depends(get_current_user)):
    script = Script(
        **script_data.model_dump(),
        created_by=current_user['id'],
        created_by_name=current_user['name']
    )
    doc = script.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.scripts.insert_one(doc)
    return script

# Only technician-editable fields may be updated. Identity, authorship and
# run-counter fields are server-owned and cannot be overwritten by a payload;
# library provenance is editable because pack install/uninstall flows maintain
# it through this endpoint.
SCRIPT_EDITABLE_FIELDS = {
    "name", "description", "script_type", "content", "category", "os_target",
    "run_as_admin", "timeout_seconds", "parameters",
    "library_pack_ids", "library_template_name",
}


@router.put("/scripts/{script_id}")
async def update_script(script_id: str, script_data: ScriptUpdate, current_user: dict = Depends(get_current_user)):
    update = {key: value for key, value in script_data.model_dump(exclude_unset=True).items() if key in SCRIPT_EDITABLE_FIELDS}
    if "name" in update and not str(update["name"] or "").strip():
        raise HTTPException(status_code=422, detail="Script name cannot be empty")
    if not update:
        raise HTTPException(status_code=422, detail="No editable fields supplied")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.scripts.update_one({"id": script_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Script not found")
    return {"message": "Script updated"}

@router.delete("/scripts/{script_id}")
async def delete_script(script_id: str, current_user: dict = Depends(get_current_user)):
    script = await db.scripts.find_one({"id": script_id}, {"_id": 0})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    if script.get('is_built_in'):
        raise HTTPException(status_code=400, detail="Cannot delete built-in scripts")
    
    await db.scripts.delete_one({"id": script_id})
    return {"message": "Script deleted"}

@router.post("/scripts/{script_id}/execute")
async def execute_script(script_id: str, device_ids: List[str], parameters: Dict[str, Any] = {}, current_user: dict = Depends(require_agent_operator)):
    """Execute a script on one or more devices"""
    script = await db.scripts.find_one({"id": script_id}, {"_id": 0})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    # Resolve every target before creating an execution record or queuing a
    # command. Mixed in-scope/foreign requests therefore fail atomically.
    devices = await _resolve_scoped_target_devices(
        current_user, device_ids, operation="script.execute"
    )
    executions = []
    for device in devices:
        device_id = device["id"]
        execution = ScriptExecution(
            script_id=script_id,
            script_name=script['name'],
            device_id=device_id,
            device_name=device.get('name'),
            client_id=device.get('client_id'),
            user_id=current_user['id'],
            user_name=current_user['name'],
            parameters_used=parameters,
            status="pending"
        )
        doc = execution.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        await db.script_executions.insert_one(doc)
        doc.pop("_id", None)
        await _dispatch_execution_to_agent(doc, script, device, current_user.get("email") or current_user["id"])
        executions.append(doc)
    
    # Update script run count
    await db.scripts.update_one(
        {"id": script_id},
        {"$inc": {"run_count": len(executions)}, "$set": {"last_run": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"message": f"Script queued for {len(executions)} devices", "executions": executions}

@router.post("/scripts/{script_id}/live-run")
async def live_run_script(script_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Execute a script and return simulated real-time output"""
    import random as _random_mod
    _srand = _random_mod.SystemRandom()
    script = await db.scripts.find_one({"id": script_id}, {"_id": 0})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    device_id = data.get("device_id", "")
    device = (
        await assert_record_scope(
            current_user,
            db.devices,
            device_id,
            operation="script.live_run",
            resource_name="Managed asset",
        )
        if device_id
        else None
    )
    target = device.get("name", device.get("hostname", "Target")) if device else data.get("target", "localhost")
    now = datetime.now(timezone.utc)
    script_content = script.get("content", "")
    lines = script_content.strip().split("\n") if script_content.strip() else ["echo 'No script content'"]
    # Build simulated output
    output_lines = []
    output_lines.append({"time": now.isoformat(), "type": "info", "text": f"Connecting to {target}..."})
    output_lines.append({"time": (now + timedelta(milliseconds=350)).isoformat(), "type": "success", "text": f"Session established with {target}"})
    output_lines.append({"time": (now + timedelta(milliseconds=600)).isoformat(), "type": "info", "text": f"Executing: {script.get('name', 'script')}"})
    output_lines.append({"time": (now + timedelta(milliseconds=800)).isoformat(), "type": "command", "text": "---"})
    # Simulate each line
    base_ms = 1000
    has_error = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("//") or stripped.startswith("REM"):
            output_lines.append({"time": (now + timedelta(milliseconds=base_ms)).isoformat(), "type": "comment", "text": stripped})
        else:
            output_lines.append({"time": (now + timedelta(milliseconds=base_ms)).isoformat(), "type": "command", "text": f"PS > {stripped}"})
            base_ms += _srand.randint(100, 500)
            # Simulate output for common commands
            if any(kw in stripped.lower() for kw in ["get-", "echo", "write-", "print", "select", "dir", "ls"]):
                output_lines.append({"time": (now + timedelta(milliseconds=base_ms)).isoformat(), "type": "output", "text": f"[OK] {stripped[:60]}... completed"})
            elif any(kw in stripped.lower() for kw in ["set-", "start-", "restart-", "stop-", "install", "remove", "new-"]):
                output_lines.append({"time": (now + timedelta(milliseconds=base_ms)).isoformat(), "type": "success", "text": "Operation completed successfully"})
            elif any(kw in stripped.lower() for kw in ["try", "catch", "if", "else", "for", "while", "foreach"]):
                pass  # Control flow - no output
            elif any(kw in stripped.lower() for kw in ["error", "throw", "fail"]):
                output_lines.append({"time": (now + timedelta(milliseconds=base_ms)).isoformat(), "type": "error", "text": f"Error in execution: {stripped[:40]}"})
                has_error = True
            else:
                output_lines.append({"time": (now + timedelta(milliseconds=base_ms)).isoformat(), "type": "output", "text": f"{stripped[:80]}"})
        base_ms += _srand.randint(200, 800)
    output_lines.append({"time": (now + timedelta(milliseconds=base_ms)).isoformat(), "type": "command", "text": "---"})
    final_status = "failed" if has_error else "completed"
    output_lines.append({"time": (now + timedelta(milliseconds=base_ms + 200)).isoformat(), "type": "success" if not has_error else "error", "text": f"Script execution {final_status} in {base_ms}ms"})
    output_lines.append({"time": (now + timedelta(milliseconds=base_ms + 300)).isoformat(), "type": "info", "text": "Session closed."})
    # Save execution record
    execution = {
        "id": str(uuid.uuid4()),
        "script_id": script_id,
        "script_name": script.get("name", ""),
        "device_id": device_id,
        "device_name": target,
        "client_id": device.get("client_id") if device else None,
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "status": final_status,
        "output": output_lines,
        "duration_ms": base_ms + 300,
        "created_at": now.isoformat(),
    }
    await db.script_executions.insert_one(execution)
    execution.pop("_id", None)
    await db.scripts.update_one({"id": script_id}, {"$inc": {"run_count": 1}, "$set": {"last_run": now.isoformat()}})
    return execution

@router.get("/script-executions/{execution_id}")
async def get_execution_detail(execution_id: str, current_user: dict = Depends(get_current_user)):
    return await assert_record_scope(
        current_user,
        db.script_executions,
        execution_id,
        operation="script_execution.read",
        resource_name="Script execution",
    )

@router.get("/script-executions")
async def get_script_executions(
    script_id: Optional[str] = None,
    device_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if script_id:
        query["script_id"] = script_id
    if device_id:
        query["device_id"] = device_id
    if status:
        query["status"] = status
    
    executions = await db.script_executions.find(
        scoped_query(current_user, query), {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    return executions

# ============== SCHEDULED TASKS ENDPOINTS ==============

@router.get("/scheduled-tasks")
async def get_scheduled_tasks(current_user: dict = Depends(get_current_user)):
    tasks = await db.scheduled_tasks.find(
        _scheduled_task_scope_query(current_user), {"_id": 0}
    ).sort("name", 1).to_list(1000)
    return tasks

@router.post("/scheduled-tasks")
async def create_scheduled_task(task_data: dict, current_user: dict = Depends(require_agent_operator)):
    script = await db.scripts.find_one({"id": task_data.get('script_id')}, {"_id": 0})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    
    target_devices = await _resolve_scoped_target_devices(
        current_user,
        task_data.get('target_ids', []),
        operation="scheduled_task.create",
        allow_empty=True,
    )
    target_ids = [device["id"] for device in target_devices]
    client_ids = sorted({str(device.get("client_id") or "").strip() for device in target_devices})
    if "" in client_ids:
        raise HTTPException(409, "Each scheduled target requires a client binding")

    task = ScheduledTask(
        name=task_data.get('name'),
        script_id=task_data.get('script_id'),
        script_name=script['name'],
        target_type=task_data.get('target_type', 'device'),
        target_ids=target_ids,
        schedule_type=task_data.get('schedule_type', 'once'),
        schedule_time=task_data.get('schedule_time', '09:00'),
        schedule_days=task_data.get('schedule_days', []),
        timezone=task_data.get('timezone', 'UTC'),
        enabled=task_data.get('enabled', True),
        created_by=current_user['id']
    )
    doc = task.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['next_run'] = next_scheduled_run(doc)
    doc['client_ids'] = client_ids
    doc['target_scopes'] = _target_scopes(target_devices)
    await db.scheduled_tasks.insert_one(doc)
    doc.pop('_id', None)
    return doc

@router.put("/scheduled-tasks/{task_id}")
async def update_scheduled_task(task_id: str, task_data: dict, current_user: dict = Depends(require_agent_operator)):
    _task, existing_target_devices = await _load_scoped_scheduled_task(
        task_id,
        current_user,
        operation="scheduled_task.update",
        validate_target_provenance=False,
    )
    updates = dict(task_data or {})
    # Client provenance is server-derived from scoped target identities; never
    # accept it as an editable browser field.
    updates.pop("client_ids", None)
    if "target_ids" in updates:
        target_devices = await _resolve_scoped_target_devices(
            current_user,
            updates.get("target_ids"),
            operation="scheduled_task.update",
            allow_empty=True,
        )
        updates["target_ids"] = [device["id"] for device in target_devices]
        client_ids = sorted({str(device.get("client_id") or "").strip() for device in target_devices})
        if "" in client_ids:
            raise HTTPException(409, "Each scheduled target requires a client binding")
        updates["client_ids"] = client_ids
        updates["target_scopes"] = _target_scopes(target_devices)
    elif existing_target_devices:
        # Updating any legacy task explicitly revalidates and upgrades its
        # current target provenance without a separate migration.
        updates["client_ids"] = sorted({str(device.get("client_id") or "").strip() for device in existing_target_devices})
        updates["target_scopes"] = _target_scopes(existing_target_devices)
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.scheduled_tasks.update_one({"id": task_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task updated"}


@router.post("/scheduled-tasks/{task_id}/run-now")
async def run_scheduled_task_now(task_id: str, current_user: dict = Depends(require_agent_operator)):
    """Queue a scheduled task immediately so technicians can validate it on demand."""
    task, target_devices = await _load_scoped_scheduled_task(
        task_id,
        current_user,
        operation="scheduled_task.run_now",
        require_target_provenance=True,
    )
    script = await db.scripts.find_one({"id": task.get("script_id")}, {"_id": 0})
    if not script:
        raise HTTPException(status_code=404, detail="Script no longer exists")
    now = datetime.now(timezone.utc)
    executions = []
    for device in target_devices:
        device_id = device["id"]
        execution = ScriptExecution(
            script_id=script["id"], script_name=script.get("name"), device_id=device_id,
            device_name=device.get("name") or device.get("hostname"), client_id=device.get("client_id"),
            user_id=current_user["id"], user_name=current_user.get("name", "Technician"), status="pending"
        ).model_dump()
        execution.update({"created_at": now.isoformat(), "scheduled_task_id": task_id, "trigger": "manual_schedule_run"})
        executions.append(execution)
    if not executions:
        raise HTTPException(status_code=400, detail="No valid target devices are configured")
    await db.script_executions.insert_many(executions)
    delivered = 0
    for execution in executions:
        device = await db.devices.find_one({"id": execution["device_id"]}, {"_id": 0})
        if (
            device
            and device.get("client_id") == execution.get("client_id")
            and await _dispatch_execution_to_agent(execution, script, device, current_user.get("email") or current_user["id"])
        ):
            delivered += 1
    await db.scripts.update_one({"id": script["id"]}, {"$inc": {"run_count": len(executions)}, "$set": {"last_run": now.isoformat()}})
    await db.scheduled_tasks.update_one({"id": task_id}, {"$set": {"last_run": now.isoformat(), "updated_at": now.isoformat()}, "$inc": {"run_count": 1}})
    await db.scheduled_task_runs.insert_one({"id": str(uuid.uuid4()), "task_id": task_id, "script_id": script["id"], "queued_count": len(executions), "status": "queued", "trigger": "manual", "ran_at": now.isoformat(), "actor": current_user.get("name")})
    return {"message": f"Queued {delivered} of {len(executions)} executions for Nexus Agent", "queued": delivered, "total": len(executions)}

@router.delete("/scheduled-tasks/{task_id}")
async def delete_scheduled_task(task_id: str, current_user: dict = Depends(require_agent_operator)):
    await _load_scoped_scheduled_task(
        task_id,
        current_user,
        operation="scheduled_task.delete",
        validate_target_provenance=False,
    )
    result = await db.scheduled_tasks.delete_one({"id": task_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task deleted"}

# ============== PATCH MANAGEMENT ENDPOINTS ==============

@router.get("/patch-policies")
async def get_patch_policies(current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail="Legacy patch policies are retired. Use the auditable Patch Compliance policy register.",
    )

@router.post(
    "/patch-policies",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def create_patch_policy(policy_data: dict, current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail="Legacy patch policies are retired. Use the auditable Patch Compliance policy register.",
    )

@router.put(
    "/patch-policies/{policy_id}",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def update_patch_policy(policy_id: str, policy_data: dict, current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail="Legacy patch policies are retired. Use the auditable Patch Compliance policy register.",
    )

@router.delete(
    "/patch-policies/{policy_id}",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def delete_patch_policy(policy_id: str, current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail="Legacy patch policies are retired. Use the auditable Patch Compliance policy register.",
    )

@router.get("/patches")
async def get_patches(
    device_id: Optional[str] = None,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    raise HTTPException(
        status_code=410,
        detail="Legacy patch rows are retired. Use Patch Compliance for scoped, fresh agent evidence.",
    )

@router.get("/patches/dashboard")
async def get_patches_dashboard(current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail="Legacy patch dashboard is retired. Use Patch Compliance for scoped, fresh agent evidence.",
    )

@router.post("/patches/{patch_id}/approve")
async def approve_patch(patch_id: str, current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail="Per-update patch approval is retired until a verified provider contract can queue the exact update. Use the governed maintenance-window workflow instead.",
    )

@router.post("/patches/{patch_id}/hide")
async def hide_patch(patch_id: str, current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail="Per-update patch hiding is retired until a verified provider contract can honour that exception. Record it in the governed maintenance workflow instead.",
    )

# ============== DEVICE GROUPS ENDPOINTS ==============

@router.get("/device-groups")
async def get_device_groups(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    
    groups = await db.device_groups.find(query, {"_id": 0}).sort("name", 1).to_list(100)
    return groups

@router.post("/device-groups")
async def create_device_group(group_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if group_data.get('client_id'):
        client = await db.clients.find_one({"id": group_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    group = DeviceGroup(
        name=group_data.get('name'),
        description=group_data.get('description'),
        client_id=group_data.get('client_id'),
        client_name=client_name,
        auto_assign_rules=group_data.get('auto_assign_rules', [])
    )
    doc = group.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.device_groups.insert_one(doc)
    return group

@router.put("/device-groups/{group_id}")
async def update_device_group(group_id: str, group_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.device_groups.update_one({"id": group_id}, {"$set": group_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Group not found")
    return {"message": "Group updated"}

@router.delete("/device-groups/{group_id}")
async def delete_device_group(group_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.device_groups.delete_one({"id": group_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Group not found")
    return {"message": "Group deleted"}

@router.post("/device-groups/{group_id}/devices")
async def add_devices_to_group(group_id: str, device_ids: List[str], current_user: dict = Depends(get_current_user)):
    """Add devices to a group"""
    group = await db.device_groups.find_one({"id": group_id}, {"_id": 0})
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    await db.devices.update_many(
        {"id": {"$in": device_ids}},
        {"$addToSet": {"groups": group_id}}
    )
    
    await db.device_groups.update_one({"id": group_id}, {"$inc": {"device_count": len(device_ids)}})
    return {"message": f"Added {len(device_ids)} devices to group"}

# ============== POLICIES ENDPOINTS ==============

@router.get("/policies")
async def get_policies(policy_type: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if policy_type:
        query["policy_type"] = policy_type
    
    policies = await db.policies.find(query, {"_id": 0}).sort("priority", 1).to_list(100)
    return policies

@router.post("/policies")
async def create_policy(policy_data: dict, current_user: dict = Depends(get_current_user)):
    policy = Policy(
        name=policy_data.get('name'),
        description=policy_data.get('description'),
        policy_type=policy_data.get('policy_type', 'monitoring'),
        enabled=policy_data.get('enabled', True),
        priority=policy_data.get('priority', 100),
        settings=policy_data.get('settings', {}),
        scripts_to_run=policy_data.get('scripts_to_run', []),
        alert_thresholds=policy_data.get('alert_thresholds', {}),
        target_groups=policy_data.get('target_groups', []),
        target_os=policy_data.get('target_os', ['windows', 'macos', 'linux']),
        created_by=current_user['id']
    )
    doc = policy.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.policies.insert_one(doc)
    return policy

@router.put("/policies/{policy_id}")
async def update_policy(policy_id: str, policy_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.policies.update_one({"id": policy_id}, {"$set": policy_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Policy not found")
    return {"message": "Policy updated"}

@router.delete("/policies/{policy_id}")
async def delete_policy(policy_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.policies.delete_one({"id": policy_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Policy not found")
    return {"message": "Policy deleted"}

