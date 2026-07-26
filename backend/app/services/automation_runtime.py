"""Durable, restart-safe execution for Nexus Automation Studio.

Workflow definitions are snapshotted into each run. MongoDB is both the run
ledger and the worker checkpoint store, so a process restart cannot silently
lose a wait, approval boundary, or completed step.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from fnmatch import fnmatchcase
import os
import socket
from typing import Any
import uuid

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.database import db


LEASE_SECONDS = max(30, int(os.environ.get("NEXUS_AUTOMATION_LEASE_SECONDS", "60")))
MAX_RUN_ATTEMPTS = max(1, int(os.environ.get("NEXUS_AUTOMATION_MAX_ATTEMPTS", "3")))
_INDEX_LOCK = asyncio.Lock()
_INDEXES_READY = False

SUBJECT_TRIGGER_MAP = {
    "ticket.created": "ticket_created",
    "backup.job.failed": "backup_failed",
    "device.connected": "device_updated",
    "device.health.changed": "device_warning",
    "dns.query.blocked": "alert_triggered",
    "user.offboard.requested": "termination_request",
    "invoice.reconciliation.failed": "invoice_overdue",
}


def utc_now_dt() -> datetime:
    return datetime.now(timezone.utc)


def utc_now() -> str:
    return utc_now_dt().isoformat()


def _actor_name(actor: dict | None) -> str:
    actor = actor or {}
    return actor.get("name") or actor.get("email") or actor.get("id") or "Nexus Automation"


def event_context(event: dict | None) -> dict:
    event = event or {}
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    merged = dict(payload)
    merged.update({
        key: value
        for key, value in event.items()
        if key not in {"payload", "_id"} and value is not None
    })
    merged["event_id"] = event.get("id") or event.get("event_id")
    merged["event_subject"] = event.get("subject") or event.get("event_subject")
    return merged


def condition_matches(condition: dict, context: dict) -> bool:
    field = str(condition.get("field") or "").strip()
    if not field:
        return True
    value = context.get(field)
    expected = condition.get("value")
    operator = condition.get("operator", "equals")
    if operator == "equals":
        return str(value).lower() == str(expected).lower()
    if operator == "not_equals":
        return str(value).lower() != str(expected).lower()
    if operator == "contains":
        return str(expected).lower() in str(value).lower()
    if operator == "is_empty":
        return value in (None, "", [], {})
    if operator == "is_not_empty":
        return value not in (None, "", [], {})
    try:
        if operator == "greater_than":
            return float(value) > float(expected)
        if operator == "less_than":
            return float(value) < float(expected)
    except (TypeError, ValueError):
        return False
    return False


def workflow_matches_event(workflow: dict, event: dict) -> bool:
    trigger = workflow.get("trigger") or {}
    subject = str(event.get("subject") or "").lower()
    trigger_type = str(trigger.get("type") or "")
    if trigger_type == "platform_event":
        pattern = str(trigger.get("event_subject") or "").strip().lower()
        if not pattern or not fnmatchcase(subject, pattern):
            return False
    elif SUBJECT_TRIGGER_MAP.get(subject) != trigger_type:
        return False
    context = event_context(event)
    return all(condition_matches(condition, context) for condition in workflow.get("conditions") or [])


def make_run_key(workflow_id: str, source_id: str) -> str:
    return f"{workflow_id}:{source_id}"


async def ensure_automation_runtime_indexes() -> None:
    global _INDEXES_READY
    if _INDEXES_READY:
        return
    async with _INDEX_LOCK:
        if _INDEXES_READY:
            return
        await db.workflow_runs.create_index("id", unique=True, name="workflow_run_id_unique")
        await db.workflow_runs.create_index("run_key", unique=True, name="workflow_run_key_unique")
        await db.workflow_runs.create_index(
            [("status", 1), ("wake_at", 1), ("lease_expires_at", 1)],
            name="workflow_run_due",
        )
        await db.workflow_runs.create_index(
            [("workflow_id", 1), ("created_at", -1)],
            name="workflow_run_workflow_time",
        )
        await db.workflow_run_approvals.create_index("id", unique=True, name="workflow_runtime_approval_id_unique")
        await db.workflow_run_approvals.create_index(
            [("run_id", 1), ("status", 1)],
            name="workflow_runtime_approval_run",
        )
        _INDEXES_READY = True


async def _emit(subject: str, run: dict, payload: dict | None = None, actor: dict | None = None) -> None:
    from app.services.platform_foundation import emit_platform_event

    await emit_platform_event(
        subject=subject,
        source="nexus.automation.runtime",
        payload={"run_id": run["id"], "workflow_id": run["workflow_id"], **(payload or {})},
        actor=actor or {"id": "automation-runtime", "name": "Nexus Automation", "role": "system"},
        client_id=run.get("client_id"),
        correlation_id=run.get("correlation_id"),
        causation_id=run.get("trigger_event_id"),
        idempotency_key=f"{subject}:{run['id']}:{payload.get('step_index') if payload else 'run'}",
    )


async def queue_workflow_run(
    workflow: dict,
    event: dict,
    *,
    actor: dict | None = None,
    source_id: str | None = None,
) -> dict:
    await ensure_automation_runtime_indexes()
    context = event_context(event)
    event_id = str(source_id or event.get("id") or event.get("event_id") or uuid.uuid4())
    run_key = make_run_key(workflow["id"], event_id)
    existing = await db.workflow_runs.find_one({"run_key": run_key}, {"_id": 0})
    if existing:
        return {**existing, "deduplicated": True}

    now = utc_now()
    run = {
        "id": f"RUN-{uuid.uuid4().hex[:10].upper()}",
        "run_key": run_key,
        "workflow_id": workflow["id"],
        "workflow_name": workflow.get("name") or "Untitled workflow",
        "workflow_version": workflow.get("updated_at") or workflow.get("created_at") or now,
        "trigger_event_id": event.get("id") or event.get("event_id"),
        "trigger_subject": event.get("subject") or event.get("event_subject") or "manual",
        "trigger": workflow.get("trigger") or {},
        "event": {key: value for key, value in event.items() if key != "_id"},
        "context": context,
        "steps": [
            {
                "id": action.get("id") or f"step-{index + 1}",
                "type": action.get("type") or "",
                "config": action.get("config") or {},
                "order": index + 1,
            }
            for index, action in enumerate(workflow.get("actions") or [])
        ],
        "status": "queued",
        "current_step": 0,
        "step_results": [],
        "checkpoints": [],
        "compensation_status": "not_required",
        "attempts": 0,
        "max_attempts": MAX_RUN_ATTEMPTS,
        "lease_owner": None,
        "lease_expires_at": None,
        "wake_at": now,
        "approval_id": None,
        "failure": None,
        "client_id": context.get("client_id") or event.get("client_id"),
        "correlation_id": event.get("correlation_id") or str(uuid.uuid4()),
        "queued_by": _actor_name(actor),
        "queued_by_id": (actor or {}).get("id") or "system",
        "created_at": now,
        "updated_at": now,
        "started_at": None,
        "completed_at": None,
    }
    try:
        await db.workflow_runs.insert_one({**run})
    except DuplicateKeyError:
        existing = await db.workflow_runs.find_one({"run_key": run_key}, {"_id": 0})
        return {**(existing or run), "deduplicated": True}
    await _emit("automation.run.queued", run, {"trigger_subject": run["trigger_subject"]}, actor)
    return {**run, "deduplicated": False}


async def queue_runs_for_platform_event(event: dict) -> list[dict]:
    """Queue every approved workflow matching a newly persisted platform event."""
    if str(event.get("subject") or "").startswith("automation."):
        return []
    trigger_type = SUBJECT_TRIGGER_MAP.get(str(event.get("subject") or "").lower())
    query: dict[str, Any] = {
        "enabled": True,
        "approval_status": {"$in": ["approved", "not_required"]},
        "$or": [{"trigger.type": "platform_event"}],
    }
    if trigger_type:
        query["$or"].append({"trigger.type": trigger_type})
    workflows = await db.workflows.find(query, {"_id": 0}).to_list(500)
    queued = []
    for workflow in workflows:
        if workflow_matches_event(workflow, event):
            queued.append(await queue_workflow_run(workflow, event))
    return queued


async def queue_runs_for_legacy_event(trigger_type: str, event: dict) -> list[dict]:
    workflows = await db.workflows.find(
        {
            "enabled": True,
            "trigger.type": trigger_type,
            "approval_status": {"$in": ["approved", "not_required"]},
        },
        {"_id": 0},
    ).to_list(500)
    queued = []
    source_id = str(event.get("id") or event.get("event_id") or uuid.uuid4())
    for workflow in workflows:
        if all(condition_matches(condition, event) for condition in workflow.get("conditions") or []):
            queued.append(await queue_workflow_run(
                workflow,
                {**event, "event_subject": trigger_type, "event_id": source_id},
                source_id=source_id,
            ))
    return queued


def _worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"


async def claim_due_run(worker_id: str | None = None) -> dict | None:
    await ensure_automation_runtime_indexes()
    worker = worker_id or _worker_id()
    now_dt = utc_now_dt()
    now = now_dt.isoformat()
    lease_until = (now_dt + timedelta(seconds=LEASE_SECONDS)).isoformat()
    return await db.workflow_runs.find_one_and_update(
        {
            "$or": [
                {"status": "queued", "wake_at": {"$lte": now}},
                {"status": "waiting", "wake_at": {"$lte": now}},
                {"status": "running", "lease_expires_at": {"$lte": now}},
            ],
            "attempts": {"$lt": MAX_RUN_ATTEMPTS},
        },
        {
            "$set": {
                "status": "running",
                "lease_owner": worker,
                "lease_expires_at": lease_until,
                "updated_at": now,
                "started_at": now,
            },
            "$inc": {"attempts": 1},
        },
        sort=[("wake_at", 1), ("created_at", 1)],
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )


def _tags(value: Any) -> list[str]:
    raw = value if isinstance(value, list) else str(value or "").split(",")
    return sorted({str(item).strip() for item in raw if str(item).strip()})


async def _prepare_checkpoint(run: dict, step: dict, step_index: int) -> dict | None:
    existing = next(
        (item for item in run.get("checkpoints") or [] if item.get("step_id") == step.get("id")),
        None,
    )
    if existing:
        return existing
    action_type = step["type"]
    config = step.get("config") or {}
    context = run.get("context") or {}
    ticket_id, device_id = context.get("ticket_id"), context.get("device_id")
    checkpoint = None
    if action_type == "change_priority":
        if not ticket_id or not config.get("new_priority"):
            raise RuntimeError("Ticket ID and new priority are required")
        ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "priority": 1})
        if not ticket:
            raise RuntimeError("The target ticket no longer exists")
        checkpoint = {"type": action_type, "entity": "ticket", "entity_id": ticket_id, "field": "priority", "before": ticket.get("priority"), "after": config["new_priority"], "reversible": True}
    elif action_type == "assign_ticket":
        if not ticket_id or not config.get("assign_to"):
            raise RuntimeError("Ticket ID and assignee are required")
        ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "assigned_to": 1})
        if not ticket:
            raise RuntimeError("The target ticket no longer exists")
        checkpoint = {"type": action_type, "entity": "ticket", "entity_id": ticket_id, "field": "assigned_to", "before": ticket.get("assigned_to"), "after": config["assign_to"], "reversible": True}
    elif action_type == "add_note":
        if not ticket_id or not config.get("note_text"):
            raise RuntimeError("Ticket ID and note text are required")
        note_id = f"automation-{run['id'].lower()}-{step['id']}"[:120]
        checkpoint = {"type": action_type, "entity": "ticket_note", "entity_id": note_id, "before": None, "after": "created", "reversible": False, "reason": "Audit notes are append-only"}
    elif action_type == "tag_device":
        if not device_id or not config.get("tags"):
            raise RuntimeError("Asset ID and at least one tag are required")
        device = await db.devices.find_one({"id": device_id}, {"_id": 0, "tags": 1})
        if not device:
            raise RuntimeError("The target asset no longer exists")
        before = _tags(device.get("tags"))
        checkpoint = {"type": action_type, "entity": "device", "entity_id": device_id, "field": "tags", "before": before, "after": sorted(set(before + _tags(config["tags"]))), "reversible": True}
    if not checkpoint:
        return None
    checkpoint = {
        **checkpoint,
        "step_index": step_index,
        "step_id": step["id"],
        "state": "prepared",
        "captured_at": utc_now(),
        "applied_at": None,
    }
    update = {"$push": {"checkpoints": checkpoint}, "$set": {"updated_at": utc_now()}}
    if checkpoint.get("reversible"):
        update["$set"]["compensation_status"] = "available"
    inserted = await db.workflow_runs.update_one(
        {"id": run["id"], "lease_owner": run.get("lease_owner"), "checkpoints.step_id": {"$ne": step["id"]}},
        update,
    )
    if inserted.modified_count:
        run.setdefault("checkpoints", []).append(checkpoint)
        return checkpoint
    current = await db.workflow_runs.find_one({"id": run["id"]}, {"_id": 0, "checkpoints": 1})
    return next((item for item in (current or {}).get("checkpoints") or [] if item.get("step_id") == step["id"]), None)


async def _execute_mutation(run: dict, step: dict, checkpoint: dict | None) -> tuple[dict, dict | None]:
    action_type = step["type"]
    config = step.get("config") or {}
    context = run.get("context") or {}
    ticket_id = context.get("ticket_id")
    device_id = context.get("device_id")
    now = utc_now()

    if action_type == "change_priority":
        before, after = checkpoint["before"], checkpoint["after"]
        await db.tickets.update_one({"id": ticket_id}, {"$set": {"priority": after, "updated_at": now}})
        return (
            {"status": "completed", "message": f"Ticket priority changed from {before or 'unset'} to {after}."},
            checkpoint,
        )

    if action_type == "assign_ticket":
        before, after = checkpoint["before"], checkpoint["after"]
        await db.tickets.update_one({"id": ticket_id}, {"$set": {"assigned_to": after, "updated_at": now}})
        return (
            {"status": "completed", "message": "Ticket assignment updated."},
            checkpoint,
        )

    if action_type == "add_note":
        note_id = checkpoint["entity_id"]
        await db.ticket_notes.update_one(
            {"id": note_id},
            {"$setOnInsert": {
                "id": note_id,
                "ticket_id": ticket_id,
                "body": config["note_text"],
                "author": "Nexus Automation",
                "author_type": "system",
                "is_internal": True,
                "automation_run_id": run["id"],
                "automation_step_id": step["id"],
                "created_at": now,
            }},
            upsert=True,
        )
        return (
            {"status": "completed", "message": "Auditable internal ticket note added.", "note_id": note_id},
            checkpoint,
        )

    if action_type == "tag_device":
        before, after = checkpoint["before"], checkpoint["after"]
        await db.devices.update_one({"id": device_id}, {"$set": {"tags": after, "updated_at": now}})
        return (
            {"status": "completed", "message": f"Asset classification now has {len(after)} tag(s)."},
            checkpoint,
        )

    raise RuntimeError(
        f"{action_type.replace('_', ' ').title()} is not connected to an executable provider. "
        "No external change was made."
    )


async def _pause_for_approval(run: dict, step: dict) -> dict:
    now = utc_now()
    approval = {
        "id": f"APR-{uuid.uuid4().hex[:8].upper()}",
        "run_id": run["id"],
        "workflow_id": run["workflow_id"],
        "workflow_name": run["workflow_name"],
        "step_index": run["current_step"],
        "step_id": step["id"],
        "approval_group": (step.get("config") or {}).get("approval_group") or "Automation Approvers",
        "reason": (step.get("config") or {}).get("reason") or "Protected workflow boundary",
        "status": "pending",
        "requested_at": now,
        "decided_at": None,
        "decided_by": None,
        "decision_reason": None,
    }
    await db.workflow_run_approvals.insert_one({**approval})
    step_result = {
        "step_index": run["current_step"],
        "step_id": step["id"],
        "type": step["type"],
        "status": "awaiting_approval",
        "message": f"Waiting for {approval['approval_group']}.",
        "started_at": now,
        "completed_at": None,
        "approval_id": approval["id"],
    }
    await db.workflow_runs.update_one(
        {"id": run["id"], "lease_owner": run["lease_owner"]},
        {
            "$set": {
                "status": "awaiting_approval",
                "approval_id": approval["id"],
                "lease_owner": None,
                "lease_expires_at": None,
                "updated_at": now,
            },
            "$push": {"step_results": step_result},
        },
    )
    await _emit("automation.approval.required", run, {"step_index": run["current_step"], "approval_id": approval["id"]})
    return {"status": "awaiting_approval", "run_id": run["id"], "approval_id": approval["id"]}


async def execute_claimed_run(run: dict) -> dict:
    steps = run.get("steps") or []
    worker = run.get("lease_owner")
    current = int(run.get("current_step") or 0)
    try:
        while current < len(steps):
            step = steps[current]
            started = utc_now()
            action_type = step.get("type") or ""

            if action_type == "request_approval":
                run["current_step"] = current
                return await _pause_for_approval(run, step)

            if action_type == "wait":
                try:
                    duration = max(0.0, float((step.get("config") or {}).get("duration_minutes") or 0))
                except (TypeError, ValueError):
                    raise RuntimeError("Wait duration must be a valid number of minutes")
                wake_at = (utc_now_dt() + timedelta(minutes=duration)).isoformat()
                result = {
                    "step_index": current,
                    "step_id": step["id"],
                    "type": action_type,
                    "status": "completed",
                    "message": f"Continuation checkpointed until {wake_at}.",
                    "started_at": started,
                    "completed_at": utc_now(),
                }
                await db.workflow_runs.update_one(
                    {"id": run["id"], "lease_owner": worker},
                    {
                        "$set": {
                            "status": "waiting",
                            "current_step": current + 1,
                            "wake_at": wake_at,
                            "lease_owner": None,
                            "lease_expires_at": None,
                            "updated_at": utc_now(),
                        },
                        "$push": {"step_results": result},
                    },
                )
                await _emit("automation.run.waiting", run, {"step_index": current, "wake_at": wake_at})
                return {"status": "waiting", "run_id": run["id"], "wake_at": wake_at}

            if action_type == "condition":
                matches = condition_matches(step.get("config") or {}, run.get("context") or {})
                outcome = {"status": "completed", "message": f"Condition evaluated to {str(matches).lower()}.", "matched": matches}
                checkpoint = None
                if not matches:
                    current += 1
                    result = {
                        "step_index": current - 1,
                        "step_id": step["id"],
                        "type": action_type,
                        **outcome,
                        "started_at": started,
                        "completed_at": utc_now(),
                    }
                    await db.workflow_runs.update_one(
                        {"id": run["id"], "lease_owner": worker},
                        {
                            "$set": {
                                "status": "completed",
                                "current_step": current,
                                "completed_at": utc_now(),
                                "lease_owner": None,
                                "lease_expires_at": None,
                                "updated_at": utc_now(),
                            },
                            "$push": {"step_results": result},
                        },
                    )
                    await _emit("automation.run.completed", run, {"step_index": current - 1, "condition_stopped": True})
                    return {"status": "completed", "run_id": run["id"], "condition_stopped": True}
            elif action_type == "ai_decision":
                raise RuntimeError("AI decision requires a configured model and governed tool policy; no decision was fabricated")
            else:
                checkpoint = await _prepare_checkpoint(run, step, current)
                outcome, checkpoint = await _execute_mutation(run, step, checkpoint)

            result = {
                "step_index": current,
                "step_id": step["id"],
                "type": action_type,
                **outcome,
                "started_at": started,
                "completed_at": utc_now(),
            }
            update: dict[str, Any] = {
                "$set": {"current_step": current + 1, "updated_at": utc_now()},
                "$push": {"step_results": result},
            }
            matched = await db.workflow_runs.update_one({"id": run["id"], "lease_owner": worker}, update)
            if not matched.modified_count:
                raise RuntimeError("Worker lease was lost before the step checkpoint could be committed")
            if checkpoint:
                await db.workflow_runs.update_one(
                    {"id": run["id"], "lease_owner": worker},
                    {"$set": {
                        "checkpoints.$[checkpoint].state": "applied",
                        "checkpoints.$[checkpoint].applied_at": utc_now(),
                    }},
                    array_filters=[{"checkpoint.step_id": step["id"]}],
                )
            current += 1

        completed_at = utc_now()
        await db.workflow_runs.update_one(
            {"id": run["id"], "lease_owner": worker},
            {"$set": {
                "status": "completed",
                "current_step": len(steps),
                "completed_at": completed_at,
                "lease_owner": None,
                "lease_expires_at": None,
                "updated_at": completed_at,
            }},
        )
        await db.workflows.update_one(
            {"id": run["workflow_id"]},
            {"$inc": {"execution_count": 1}, "$set": {"last_executed": completed_at}},
        )
        await db.workflow_logs.insert_one({
            "id": f"wflog-{uuid.uuid4().hex[:8]}",
            "workflow_id": run["workflow_id"],
            "run_id": run["id"],
            "status": "completed",
            "trigger_data": run.get("context") or {},
            "results": await db.workflow_runs.find_one({"id": run["id"]}, {"_id": 0, "step_results": 1}) or {},
            "executed_at": completed_at,
            "executed_by": "Nexus Automation Runtime",
            "is_test": False,
        })
        await _emit("automation.run.completed", run, {"steps_completed": len(steps)})
        return {"status": "completed", "run_id": run["id"]}
    except Exception as error:
        failed_at = utc_now()
        failure = {
            "step_index": current,
            "step_id": steps[current].get("id") if current < len(steps) else None,
            "type": steps[current].get("type") if current < len(steps) else None,
            "message": str(error),
            "failed_at": failed_at,
        }
        await db.workflow_runs.update_one(
            {"id": run["id"]},
            {"$set": {
                "status": "failed",
                "failure": failure,
                "lease_owner": None,
                "lease_expires_at": None,
                "updated_at": failed_at,
            }},
        )
        await _emit("automation.run.failed", run, failure)
        return {"status": "failed", "run_id": run["id"], "failure": failure}


async def process_due_runs(limit: int = 25, worker_id: str | None = None) -> dict:
    worker = worker_id or _worker_id()
    now = utc_now()
    exhausted = await db.workflow_runs.find(
        {
            "status": "running",
            "lease_expires_at": {"$lte": now},
            "attempts": {"$gte": MAX_RUN_ATTEMPTS},
        },
        {"_id": 0},
    ).to_list(100)
    for run in exhausted:
        failure = {
            "step_index": run.get("current_step"),
            "step_id": (run.get("steps") or [{}])[int(run.get("current_step") or 0)].get("id") if int(run.get("current_step") or 0) < len(run.get("steps") or []) else None,
            "type": "worker_lease",
            "message": "The worker lease expired after the maximum recovery attempts. Review or compensate this run.",
            "failed_at": now,
        }
        await db.workflow_runs.update_one(
            {"id": run["id"], "status": "running", "lease_expires_at": {"$lte": now}},
            {"$set": {"status": "failed", "failure": failure, "lease_owner": None, "lease_expires_at": None, "updated_at": now}},
        )
        await _emit("automation.run.failed", run, failure)
    processed = []
    for _ in range(max(1, min(int(limit or 25), 100))):
        run = await claim_due_run(worker)
        if not run:
            break
        processed.append(await execute_claimed_run(run))
    return {
        "processed": len(processed),
        "completed": sum(item["status"] == "completed" for item in processed),
        "waiting": sum(item["status"] == "waiting" for item in processed),
        "awaiting_approval": sum(item["status"] == "awaiting_approval" for item in processed),
        "failed": sum(item["status"] == "failed" for item in processed),
        "exhausted_leases": len(exhausted),
        "runs": processed,
    }


async def decide_run_approval(run_id: str, approved: bool, actor: dict, reason: str) -> dict:
    run = await db.workflow_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise ValueError("Automation run not found")
    if run.get("status") != "awaiting_approval" or not run.get("approval_id"):
        raise ValueError("This run is not waiting for approval")
    decision_reason = str(reason or "").strip()
    if len(decision_reason) < 8:
        raise ValueError("Record a decision reason of at least 8 characters")
    now = utc_now()
    status = "approved" if approved else "rejected"
    result = await db.workflow_run_approvals.update_one(
        {"id": run["approval_id"], "status": "pending"},
        {"$set": {
            "status": status,
            "decided_at": now,
            "decided_by": _actor_name(actor),
            "decided_by_id": actor.get("id"),
            "decision_reason": decision_reason,
        }},
    )
    if not result.modified_count:
        raise ValueError("The approval has already been decided")
    if approved:
        await db.workflow_runs.update_one(
            {"id": run_id, "status": "awaiting_approval"},
            {
                "$set": {
                    "status": "queued",
                    "approval_id": None,
                    "current_step": int(run.get("current_step") or 0) + 1,
                    "wake_at": now,
                    "updated_at": now,
                    "step_results.$[approval].status": "approved",
                    "step_results.$[approval].message": f"Approved by {_actor_name(actor)}: {decision_reason}",
                    "step_results.$[approval].completed_at": now,
                }
            },
            array_filters=[{"approval.approval_id": run["approval_id"]}],
        )
    else:
        await db.workflow_runs.update_one(
            {"id": run_id, "status": "awaiting_approval"},
            {
                "$set": {
                    "status": "cancelled",
                    "approval_id": None,
                    "completed_at": now,
                    "updated_at": now,
                    "failure": {"message": f"Approval rejected: {decision_reason}", "failed_at": now},
                    "step_results.$[approval].status": "rejected",
                    "step_results.$[approval].message": f"Rejected by {_actor_name(actor)}: {decision_reason}",
                    "step_results.$[approval].completed_at": now,
                }
            },
            array_filters=[{"approval.approval_id": run["approval_id"]}],
        )
    return await db.workflow_runs.find_one({"id": run_id}, {"_id": 0})


def compensation_preview(run: dict) -> dict:
    checkpoints = list(reversed(run.get("checkpoints") or []))
    steps = []
    for checkpoint in checkpoints:
        steps.append({
            "step_index": checkpoint.get("step_index"),
            "type": checkpoint.get("type"),
            "entity": checkpoint.get("entity"),
            "entity_id": checkpoint.get("entity_id"),
            "field": checkpoint.get("field"),
            "before": checkpoint.get("before"),
            "after": checkpoint.get("after"),
            "reversible": bool(checkpoint.get("reversible")),
            "reason": checkpoint.get("reason"),
        })
    return {
        "run_id": run.get("id"),
        "status": run.get("status"),
        "can_execute": any(step["reversible"] for step in steps),
        "reversible_steps": sum(step["reversible"] for step in steps),
        "manual_review_steps": sum(not step["reversible"] for step in steps),
        "steps": steps,
        "guard": "A field is restored only when its current value still matches the value written by this run.",
    }


async def compensate_run(run_id: str, actor: dict, reason: str) -> dict:
    run = await db.workflow_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise ValueError("Automation run not found")
    if run.get("status") not in {"failed", "completed", "cancelled"}:
        raise ValueError("Only a terminal run can be compensated")
    rationale = str(reason or "").strip()
    if len(rationale) < 12:
        raise ValueError("Record a compensation reason of at least 12 characters")
    existing_status = run.get("compensation_status")
    if existing_status in {"running", "completed"}:
        raise ValueError(f"Compensation is already {existing_status}")

    now = utc_now()
    await db.workflow_runs.update_one(
        {"id": run_id, "compensation_status": {"$nin": ["running", "completed"]}},
        {"$set": {"compensation_status": "running", "updated_at": now}},
    )
    results = []
    for checkpoint in reversed(run.get("checkpoints") or []):
        item = {
            "step_index": checkpoint.get("step_index"),
            "type": checkpoint.get("type"),
            "entity": checkpoint.get("entity"),
            "entity_id": checkpoint.get("entity_id"),
            "status": "manual_review",
            "message": checkpoint.get("reason") or "This action is not automatically reversible.",
        }
        if checkpoint.get("reversible") and checkpoint.get("entity") == "ticket":
            result = await db.tickets.update_one(
                {"id": checkpoint["entity_id"], checkpoint["field"]: checkpoint.get("after")},
                {"$set": {checkpoint["field"]: checkpoint.get("before"), "updated_at": utc_now()}},
            )
            item["status"] = "completed" if result.modified_count else "conflict"
            item["message"] = "Previous ticket value restored." if result.modified_count else "Current value changed after the run; no overwrite was performed."
        elif checkpoint.get("reversible") and checkpoint.get("entity") == "device":
            device = await db.devices.find_one({"id": checkpoint["entity_id"]}, {"_id": 0, checkpoint["field"]: 1})
            if device and _tags(device.get(checkpoint["field"])) == _tags(checkpoint.get("after")):
                await db.devices.update_one(
                    {"id": checkpoint["entity_id"]},
                    {"$set": {checkpoint["field"]: checkpoint.get("before"), "updated_at": utc_now()}},
                )
                item["status"], item["message"] = "completed", "Previous asset classification restored."
            else:
                item["status"], item["message"] = "conflict", "Asset classification changed after the run; no overwrite was performed."
        results.append(item)

    completed_at = utc_now()
    final_status = "completed" if not any(item["status"] == "conflict" for item in results) else "completed_with_conflicts"
    record = {
        "id": f"CMP-{uuid.uuid4().hex[:8].upper()}",
        "reason": rationale,
        "requested_by": _actor_name(actor),
        "requested_by_id": actor.get("id"),
        "results": results,
        "status": final_status,
        "completed_at": completed_at,
    }
    await db.workflow_runs.update_one(
        {"id": run_id},
        {"$set": {
            "compensation_status": final_status,
            "compensation": record,
            "updated_at": completed_at,
        }},
    )
    await _emit("automation.compensation.completed", run, {"status": final_status, "conflicts": sum(item["status"] == "conflict" for item in results)}, actor)
    return record


async def retry_run(run_id: str, actor: dict, reason: str) -> dict:
    run = await db.workflow_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise ValueError("Automation run not found")
    if run.get("status") != "failed":
        raise ValueError("Only failed runs can be retried")
    rationale = str(reason or "").strip()
    if len(rationale) < 8:
        raise ValueError("Record a retry reason of at least 8 characters")
    if int(run.get("attempts") or 0) >= int(run.get("max_attempts") or MAX_RUN_ATTEMPTS):
        raise ValueError("Maximum retry attempts reached; review or compensate this run")
    now = utc_now()
    await db.workflow_runs.update_one(
        {"id": run_id, "status": "failed"},
        {
            "$set": {"status": "queued", "wake_at": now, "failure": None, "updated_at": now},
            "$push": {"recovery_history": {
                "action": "retry_requested",
                "reason": rationale,
                "by": _actor_name(actor),
                "by_id": actor.get("id"),
                "at": now,
            }},
        },
    )
    return await db.workflow_runs.find_one({"id": run_id}, {"_id": 0})


async def runtime_health() -> dict:
    await ensure_automation_runtime_indexes()
    now = utc_now()
    statuses = ["queued", "running", "waiting", "awaiting_approval", "completed", "failed", "cancelled"]
    counts = {status: await db.workflow_runs.count_documents({"status": status}) for status in statuses}
    return {
        **counts,
        "active": sum(counts[status] for status in ("queued", "running", "waiting", "awaiting_approval")),
        "terminal": sum(counts[status] for status in ("completed", "failed", "cancelled")),
        "expired_leases": await db.workflow_runs.count_documents({"status": "running", "lease_expires_at": {"$lte": now}}),
        "compensation_available": await db.workflow_runs.count_documents({"compensation_status": "available"}),
        "worker_lease_seconds": LEASE_SECONDS,
        "max_attempts": MAX_RUN_ATTEMPTS,
        "checked_at": now,
    }
