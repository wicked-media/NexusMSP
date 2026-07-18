from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta, time
from zoneinfo import ZoneInfo
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()


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
        for device_id in task.get("target_ids", []):
            device = await db.devices.find_one({"id": device_id}, {"_id": 0})
            if not device:
                continue
            execution = ScriptExecution(
                script_id=script["id"], script_name=script.get("name"), device_id=device_id,
                device_name=device.get("name") or device.get("hostname"), client_id=device.get("client_id"),
                user_id=task.get("created_by", "scheduler"), user_name="Scheduler", status="pending"
            ).model_dump()
            execution.update({"created_at": now.isoformat(), "scheduled_task_id": task["id"]})
            executions.append(execution)
        if executions:
            await db.script_executions.insert_many(executions)
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

@router.put("/scripts/{script_id}")
async def update_script(script_id: str, script_data: dict, current_user: dict = Depends(get_current_user)):
    script_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    result = await db.scripts.update_one({"id": script_id}, {"$set": script_data})
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
async def execute_script(script_id: str, device_ids: List[str], parameters: Dict[str, Any] = {}, current_user: dict = Depends(get_current_user)):
    """Execute a script on one or more devices"""
    script = await db.scripts.find_one({"id": script_id}, {"_id": 0})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    
    executions = []
    for device_id in device_ids:
        device = await db.devices.find_one({"id": device_id}, {"_id": 0})
        if not device:
            continue
        
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
        executions.append(execution)
    
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
    device = await db.devices.find_one({"id": device_id}, {"_id": 0}) if device_id else None
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
                output_lines.append({"time": (now + timedelta(milliseconds=base_ms)).isoformat(), "type": "success", "text": f"Operation completed successfully"})
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
    execution = await db.script_executions.find_one({"id": execution_id}, {"_id": 0})
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    return execution

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
    
    executions = await db.script_executions.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return executions

# ============== SCHEDULED TASKS ENDPOINTS ==============

@router.get("/scheduled-tasks")
async def get_scheduled_tasks(current_user: dict = Depends(get_current_user)):
    tasks = await db.scheduled_tasks.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    return tasks

@router.post("/scheduled-tasks")
async def create_scheduled_task(task_data: dict, current_user: dict = Depends(get_current_user)):
    script = await db.scripts.find_one({"id": task_data.get('script_id')}, {"_id": 0})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    
    task = ScheduledTask(
        name=task_data.get('name'),
        script_id=task_data.get('script_id'),
        script_name=script['name'],
        target_type=task_data.get('target_type', 'device'),
        target_ids=task_data.get('target_ids', []),
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
    await db.scheduled_tasks.insert_one(doc)
    doc.pop('_id', None)
    return doc

@router.put("/scheduled-tasks/{task_id}")
async def update_scheduled_task(task_id: str, task_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.scheduled_tasks.update_one({"id": task_id}, {"$set": task_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task updated"}

@router.delete("/scheduled-tasks/{task_id}")
async def delete_scheduled_task(task_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.scheduled_tasks.delete_one({"id": task_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task deleted"}

# ============== PATCH MANAGEMENT ENDPOINTS ==============

@router.get("/patch-policies")
async def get_patch_policies(current_user: dict = Depends(get_current_user)):
    policies = await db.patch_policies.find({}, {"_id": 0}).to_list(100)
    return policies

@router.post("/patch-policies")
async def create_patch_policy(policy_data: dict, current_user: dict = Depends(get_current_user)):
    policy = PatchPolicy(**policy_data)
    doc = policy.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.patch_policies.insert_one(doc)
    return policy

@router.put("/patch-policies/{policy_id}")
async def update_patch_policy(policy_id: str, policy_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.patch_policies.update_one({"id": policy_id}, {"$set": policy_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Policy not found")
    return {"message": "Policy updated"}

@router.delete("/patch-policies/{policy_id}")
async def delete_patch_policy(policy_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.patch_policies.delete_one({"id": policy_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Policy not found")
    return {"message": "Policy deleted"}

@router.get("/patches")
async def get_patches(
    device_id: Optional[str] = None,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if device_id:
        query["device_id"] = device_id
    if status:
        query["status"] = status
    if severity:
        query["severity"] = severity
    
    patches = await db.device_patches.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return patches

@router.get("/patches/dashboard")
async def get_patches_dashboard(current_user: dict = Depends(get_current_user)):
    """Get patch management dashboard stats"""
    total = await db.device_patches.count_documents({})
    available = await db.device_patches.count_documents({"status": "available"})
    approved = await db.device_patches.count_documents({"status": "approved"})
    installed = await db.device_patches.count_documents({"status": "installed"})
    failed = await db.device_patches.count_documents({"status": "failed"})
    
    critical = await db.device_patches.count_documents({"severity": "Critical", "status": {"$ne": "installed"}})
    important = await db.device_patches.count_documents({"severity": "Important", "status": {"$ne": "installed"}})
    
    return {
        "total": total,
        "available": available,
        "approved": approved,
        "installed": installed,
        "failed": failed,
        "pending_critical": critical,
        "pending_important": important
    }

@router.post("/patches/{patch_id}/approve")
async def approve_patch(patch_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.device_patches.update_one({"id": patch_id}, {"$set": {"status": "approved"}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Patch not found")
    return {"message": "Patch approved"}

@router.post("/patches/{patch_id}/hide")
async def hide_patch(patch_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.device_patches.update_one({"id": patch_id}, {"$set": {"status": "hidden"}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Patch not found")
    return {"message": "Patch hidden"}

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

