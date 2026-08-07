"""Maintenance Window Scheduler â€” autonomous overnight maintenance.

A "window" bundles N devices + a list of actions (patches/reboot/run-checks/run-script)
+ a scheduled_at time. A background loop in server.py picks up windows that are due
and runs them in parallel with bounded concurrency. Each device's per-action result is
recorded, an AI summary is generated at completion, and (optionally) posted back to a
parent ticket.

Collections used:
  db.maintenance_windows   { id, name, scheduled_at, status, ... }
  db.maintenance_window_runs  per-device per-action records
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from typing import Optional
import os
import uuid
import json
import asyncio
import logging

from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity
from app.routers.nexus_agent import require_agent_operator

logger = logging.getLogger(__name__)
router = APIRouter()


VALID_ACTIONS = {"run-checks", "install-patches", "install-winget", "reboot", "run-script"}


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _parse_dt(s):
    if not s:
        return None
    try:
        if "T" in s:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        else:
            dt = datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


async def _ai_chat(session_id: str, system_msg: str):
    from app.services.ai_provider import LlmChat
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(500, "AI key not configured")
    cfg = await db.settings.find_one({"type": "ai_config"}, {"_id": 0}) or {}
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system_msg)
    chat.with_model("openai", cfg.get("model", "gpt-5.6-terra"))
    return chat


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/maintenance-windows")
async def list_windows(status: str | None = None, limit: int = 100, current_user: dict = Depends(require_agent_operator)):
    q = {}
    if status:
        q["status"] = status
    items = await db.maintenance_windows.find(q, {"_id": 0}).sort("scheduled_at", -1).to_list(limit)
    return items


@router.get("/maintenance-windows/{wid}")
async def get_window(wid: str, current_user: dict = Depends(require_agent_operator)):
    w = await db.maintenance_windows.find_one({"id": wid}, {"_id": 0})
    if not w:
        raise HTTPException(404, "Window not found")
    runs = await db.maintenance_window_runs.find({"window_id": wid}, {"_id": 0}).to_list(2000)
    w["runs"] = runs
    return w


@router.post("/maintenance-windows")
async def create_window(data: dict, current_user: dict = Depends(require_agent_operator)):
    device_ids = data.get("device_ids") or []
    if not device_ids:
        raise HTTPException(400, "device_ids required")
    if len(device_ids) > 200:
        raise HTTPException(400, "max 200 devices per window")
    actions = data.get("actions") or ["install-patches"]
    for a in actions:
        if a not in VALID_ACTIONS:
            raise HTTPException(400, f"invalid action {a}; must be in {sorted(VALID_ACTIONS)}")
    scheduled = _parse_dt(data.get("scheduled_at"))
    if not scheduled:
        raise HTTPException(400, "scheduled_at required (ISO or 'YYYY-MM-DD HH:MM:SS')")
    device_ids = list(dict.fromkeys(str(device_id).strip() for device_id in device_ids if str(device_id).strip()))
    devices = await db.devices.find({"id": {"$in": device_ids}}, {"_id": 0}).to_list(500)
    found_ids = {device.get("id") for device in devices}
    unknown_ids = [device_id for device_id in device_ids if device_id not in found_ids]
    if unknown_ids:
        raise HTTPException(400, f"Unknown managed asset: {unknown_ids[0]}")
    unmanaged = [device.get("name") or device.get("id") for device in devices if not device.get("nexus_agent_id")]
    if unmanaged:
        raise HTTPException(409, f"Nexus Agent is not enrolled on: {', '.join(unmanaged[:3])}")
    parent_ticket_id = (data.get("parent_ticket_id") or "").strip()
    if parent_ticket_id:
        parent_ticket = await db.tickets.find_one(
            {"$or": [{"id": parent_ticket_id}, {"ticket_number": parent_ticket_id}]},
            {"_id": 0, "id": 1, "ticket_number": 1},
        )
        if not parent_ticket:
            raise HTTPException(400, "Related ticket was not found")
        parent_ticket_id = parent_ticket["id"]
    devices_meta = [{
        "id": d["id"], "name": d.get("name"), "client_id": d.get("client_id"), "client_name": d.get("client_name"),
        "nexus_agent_id": d.get("nexus_agent_id"), "status": d.get("status"),
    } for d in devices]

    window = {
        "id": str(uuid.uuid4()),
        "name": (data.get("name") or "").strip()[:140] or f"Maintenance - {scheduled.strftime('%Y-%m-%d %H:%M')}",
        "description": (data.get("description") or "").strip()[:600],
        "scheduled_at": scheduled.isoformat(),
        "actions": actions,
        "device_ids": [d["id"] for d in devices_meta],
        "devices_meta": devices_meta,
        "parent_ticket_id": parent_ticket_id or None,
        "script_id": data.get("script_id"),
        "status": "scheduled",
        "created_at": _now_iso(),
        "created_by": current_user.get("name"),
        "created_by_id": current_user.get("id"),
    }
    await db.maintenance_windows.insert_one(window)
    await log_activity(
        current_user,
        "maintenance_window_created",
        "maintenance_window",
        window["id"],
        window["name"],
        f"{len(device_ids)} assets - {scheduled.isoformat()}",
        metadata={"actions": actions, "device_ids": window["device_ids"], "parent_ticket_id": parent_ticket_id or None},
    )
    window.pop("_id", None)
    return window


@router.delete("/maintenance-windows/{wid}")
async def cancel_window(wid: str, current_user: dict = Depends(require_agent_operator)):
    w = await db.maintenance_windows.find_one({"id": wid}, {"_id": 0, "status": 1, "name": 1})
    if not w:
        raise HTTPException(404, "Window not found")
    if w.get("status") != "scheduled":
        raise HTTPException(400, f"Only a scheduled window can be cancelled (current status: {w.get('status')})")
    await db.maintenance_windows.update_one({"id": wid}, {"$set": {"status": "cancelled", "cancelled_at": _now_iso(), "cancelled_by": current_user.get("name")}})
    await log_activity(current_user, "maintenance_window_cancelled", "maintenance_window", wid, w["name"], "cancelled")
    return {"success": True}


@router.post("/maintenance-windows/{wid}/run-now")
async def run_now(wid: str, current_user: dict = Depends(require_agent_operator)):
    claimed = await db.maintenance_windows.update_one(
        {"id": wid, "status": "scheduled"},
        {"$set": {
            "status": "dispatching",
            "run_now_requested_at": _now_iso(),
            "run_now_requested_by": current_user.get("id") or current_user.get("email"),
        }},
    )
    if claimed.modified_count != 1:
        window = await db.maintenance_windows.find_one({"id": wid}, {"_id": 0, "status": 1})
        if not window:
            raise HTTPException(404, "Window not found")
        raise HTTPException(409, f"Window is {window.get('status')}")
    await log_activity(current_user, "maintenance_window_run_now", "maintenance_window", wid, "", "Immediate dispatch requested")
    asyncio.create_task(execute_window(wid, allow_dispatching=True))
    return {
        "success": True,
        "status": "dispatching",
        "message": "Maintenance commands are being dispatched to eligible Nexus Agents",
    }


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Execution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def _run_device_action(device: dict, action: str, window: dict) -> dict:
    """Queue a real Nexus Agent command when the device is enrolled and online.

    Windows Update deployment is only ever invoked from an approved maintenance
    window. Winget deployments additionally require an explicit allow-list.
    """
    rec = {
        "id": str(uuid.uuid4()),
        "window_id": window["id"],
        "device_id": device["id"],
        "device_name": device.get("name"),
        "action": action,
        "started_at": _now_iso(),
        "status": "running",
        "message": "",
    }
    if not device.get("nexus_agent_id"):
        rec.update({"status": "skipped", "message": "device has no enrolled Nexus Agent", "finished_at": _now_iso()})
        return rec
    try:
        from app.routers.nexus_agent import queue_command_for_device
        if action == "reboot":
            command_id = await queue_command_for_device(device, "reboot", {}, queued_by="maintenance-window")
        elif action == "run-checks":
            command_id = await queue_command_for_device(
                device, "run_powershell",
                {"script": "Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,LastBootUpTime; Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free", "timeout_sec": 90},
                queued_by="maintenance-window",
            )
        elif action == "install-patches":
            # Native Windows Update Agent API. This excludes drivers and runs
            # only within the window selected by a technician.
            script = """$ErrorActionPreference='Stop'
$session=New-Object -ComObject Microsoft.Update.Session
$updates=$session.CreateUpdateSearcher().Search(\"IsInstalled=0 and Type='Software' and IsHidden=0\").Updates
$toInstall=New-Object -ComObject Microsoft.Update.UpdateColl
foreach($u in $updates){ if(-not $u.EulaAccepted){$u.AcceptEula()}; [void]$toInstall.Add($u) }
if($toInstall.Count -eq 0){'No applicable Windows updates'; exit 0}
$result=$session.CreateUpdateInstaller(); $result.Updates=$toInstall; $out=$result.Install()
[pscustomobject]@{installed=$toInstall.Count;result_code=$out.ResultCode;reboot_required=$out.RebootRequired}|ConvertTo-Json -Compress"""
            command_id = await queue_command_for_device(device, "run_powershell", {"script": script, "timeout_sec": 7200}, queued_by="maintenance-window")
        elif action == "install-winget":
            policy = await db.nexus_agent_settings.find_one({"_id": "settings"}, {"_id": 0}) or {}
            allowed = [str(item).strip() for item in (policy.get("winget_allowed_ids") or []) if str(item).strip()]
            if not policy.get("winget_enabled") or not allowed:
                rec.update({"status": "skipped", "message": "Winget requires patch policy enablement and an approved package allow-list", "finished_at": _now_iso()})
                return rec
            commands = "; ".join([f"winget upgrade --id '{package}' --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity" for package in allowed])
            command_id = await queue_command_for_device(device, "run_powershell", {"script": "$ErrorActionPreference='Continue'; " + commands, "timeout_sec": 7200}, queued_by="maintenance-window")
        elif action == "run-script":
            script_id = window.get("script_id")
            script = await db.scripts.find_one({"id": script_id}, {"_id": 0}) if script_id else None
            if not script or not (script.get("content") or "").strip():
                rec.update({"status": "skipped", "message": "select a valid script for this maintenance window", "finished_at": _now_iso()})
                return rec
            shell = "powershell" if str(script.get("os_target", "")).lower() != "linux" else "bash"
            command_id = await queue_command_for_device(device, "run_script", {"script": script["content"], "shell": shell, "timeout_sec": 900}, queued_by="maintenance-window")
        else:
            rec.update({"status": "skipped", "message": f"unsupported maintenance action: {action}", "finished_at": _now_iso()})
            return rec
        rec.update({"status": "queued", "command_id": command_id, "message": f"{action} queued for Nexus Agent", "finished_at": _now_iso()})
    except Exception as e:
        rec.update({"status": "skipped", "message": str(e)[:200], "finished_at": _now_iso()})
    return rec


async def _post_completion_to_ticket(window: dict, counts: dict, summary: str) -> None:
    """Post one factual maintenance record to the related ticket, if supplied."""
    parent_ticket_id = window.get("parent_ticket_id")
    if not parent_ticket_id:
        return
    ticket = await db.tickets.find_one({"id": parent_ticket_id}, {"_id": 0, "id": 1})
    if not ticket:
        return
    body = (
        f"Maintenance window completed - {window.get('name', 'Untitled window')}\n"
        f"Assets: {len(window.get('device_ids') or [])}; Actions: {', '.join(window.get('actions') or [])}\n"
        f"Successful: {counts.get('ok', 0)}; Failed: {counts.get('failed', 0)}; Skipped: {counts.get('skipped', 0)}\n\n"
        f"{summary}"
    )
    await db.ticket_comments.insert_one({
        "id": str(uuid.uuid4()),
        "ticket_id": parent_ticket_id,
        "author": "Nexus Agent",
        "author_id": "nexus-agent",
        "content": body,
        "kind": "maintenance_window",
        "window_id": window["id"],
        "created_at": _now_iso(),
    })
    await db.tickets.update_one({"id": parent_ticket_id}, {"$inc": {"comments_count": 1}, "$set": {"updated_at": _now_iso()}})


async def reconcile_window_from_runs(wid: str) -> dict | None:
    """Recalculate a window from returned commands without treating a queue as a result."""
    window = await db.maintenance_windows.find_one({"id": wid}, {"_id": 0})
    if not window or window.get("status") in {"completed", "failed", "cancelled"}:
        return window

    runs = await db.maintenance_window_runs.find({"window_id": wid}, {"_id": 0, "status": 1}).to_list(2000)
    counts = {"queued": 0, "ok": 0, "failed": 0, "skipped": 0}
    for run in runs:
        status = run.get("status", "skipped")
        counts[status] = counts.get(status, 0) + 1

    if counts.get("queued", 0) or any(run.get("status") == "running" for run in runs):
        await db.maintenance_windows.update_one(
            {"id": wid, "status": {"$in": ["dispatching", "running", "awaiting_results"]}},
            {"$set": {"status": "awaiting_results", "summary_counts": counts, "reconciled_at": _now_iso()}},
        )
        return {**window, "status": "awaiting_results", "summary_counts": counts}

    final_status = "failed" if counts.get("failed", 0) else "completed"
    summary = (
        f"Endpoint results returned for {len(runs)} action(s): {counts.get('ok', 0)} successful, "
        f"{counts.get('failed', 0)} failed, and {counts.get('skipped', 0)} skipped."
    )
    completed = await db.maintenance_windows.update_one(
        {"id": wid, "status": {"$in": ["dispatching", "running", "awaiting_results"]}},
        {"$set": {
            "status": final_status,
            "finished_at": _now_iso(),
            "summary_counts": counts,
            "ai_summary": summary,
            "reconciled_at": _now_iso(),
        }},
    )
    if completed.modified_count:
        actor = {"id": "nexus-agent", "name": "Nexus Agent"}
        await log_activity(actor, "maintenance_window_completed", "maintenance_window", wid, window.get("name", ""), summary, metadata={"status": final_status, "summary_counts": counts})
        await _post_completion_to_ticket(window, counts, summary)
    return {**window, "status": final_status, "summary_counts": counts, "ai_summary": summary}


async def execute_window(wid: str, allow_dispatching: bool = False):
    """Dispatch a window once, then wait for returned Nexus Agent results.

    A queued command is deliberately not reported as completed. The command-result
    callback reconciles the final window status after each endpoint responds.
    """
    w = await db.maintenance_windows.find_one({"id": wid}, {"_id": 0})
    expected_statuses = ["scheduled"] + (["dispatching"] if allow_dispatching else [])
    if not w or w.get("status") not in expected_statuses:
        return
    claimed = await db.maintenance_windows.update_one(
        {"id": wid, "status": {"$in": expected_statuses}},
        {"$set": {"status": "running", "started_at": _now_iso()}},
    )
    if claimed.modified_count != 1:
        return

    sem = asyncio.Semaphore(8)
    actions = w.get("actions") or []
    devices = w.get("devices_meta") or []

    async def run_one(device, action):
        async with sem:
            rec = await _run_device_action(device, action, w)
            await db.maintenance_window_runs.insert_one(rec)
            rec.pop("_id", None)
            return rec

    tasks = [run_one(d, a) for d in devices for a in actions]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    results = [r for r in results if isinstance(r, dict)]
    summary_counts = {"queued": 0, "ok": 0, "failed": 0, "skipped": 0}
    for r in results:
        summary_counts[r.get("status", "skipped")] = summary_counts.get(r.get("status", "skipped"), 0) + 1

    # Queueing is only dispatch. The command-result callback reconciles actual
    # endpoint results and closes the window once every queued action returns.
    await reconcile_window_from_runs(wid)
    return

    # AI summary
    ai_summary = ""
    try:
        from app.services.ai_provider import UserMessage
        sys = "You are a senior MSP technician writing a concise (3-4 bullet) post-maintenance report covering successes, skips, failures and next steps."
        prompt = json.dumps({
            "window_name": w.get("name"),
            "devices_total": len(devices),
            "actions": actions,
            "counts": summary_counts,
            "sample_failures": [{"device": r["device_name"], "action": r["action"], "msg": r["message"]} for r in results if r.get("status") == "failed"][:6],
            "sample_skips": [{"device": r["device_name"], "action": r["action"], "msg": r["message"]} for r in results if r.get("status") == "skipped"][:6],
        })
        chat = await _ai_chat(f"mw-{wid}", sys)
        resp = await chat.send_message(UserMessage(text=prompt))
        ai_summary = resp.strip()[:2000]
    except Exception as e:
        logger.warning(f"MW AI summary failed: {e}")
        ai_summary = f"Maintenance window '{w.get('name')}' complete. {summary_counts.get('ok', 0)} ok, {summary_counts.get('failed', 0)} failed, {summary_counts.get('skipped', 0)} skipped across {len(devices)} devices."

    await db.maintenance_windows.update_one({"id": wid}, {"$set": {
        "status": "completed",
        "finished_at": _now_iso(),
        "summary_counts": summary_counts,
        "ai_summary": ai_summary,
    }})

    # Post to parent ticket if linked
    parent = w.get("parent_ticket_id")
    if parent:
        tk = await db.tickets.find_one({"id": parent}, {"_id": 0, "id": 1, "ticket_number": 1})
        if tk:
            body = (
                f"ðŸ”§ Maintenance Window Completed â€” {w.get('name')}\n"
                f"Devices: {len(devices)} Â· Actions: {', '.join(actions)}\n"
                f"Results: âœ“ {summary_counts.get('ok', 0)} Â· âœ— {summary_counts.get('failed', 0)} Â· â€” {summary_counts.get('skipped', 0)}\n\n"
                f"{ai_summary}"
            )
            comment = {
                "id": str(uuid.uuid4()),
                "ticket_id": parent,
                "author": w.get("created_by") or "Scheduler",
                "author_id": w.get("created_by_id"),
                "content": body,
                "kind": "maintenance_window",
                "window_id": wid,
                "created_at": _now_iso(),
            }
            await db.ticket_comments.insert_one(comment)
            await db.tickets.update_one({"id": parent}, {"$inc": {"comments_count": 1}, "$set": {"updated_at": _now_iso()}})


# Background scheduler loop â€” picks up windows whose time has come
_SCHEDULER_STARTED = False


async def maintenance_window_scheduler():
    global _SCHEDULER_STARTED
    if _SCHEDULER_STARTED:
        return
    _SCHEDULER_STARTED = True
    logger.info("Maintenance Window scheduler started")
    while True:
        try:
            now = datetime.now(timezone.utc)
            due = await db.maintenance_windows.find(
                {"status": "scheduled", "scheduled_at": {"$lte": now.isoformat()}},
                {"_id": 0, "id": 1}
            ).to_list(20)
            for w in due:
                logger.info(f"Maintenance Window {w['id']} due â€” executing")
                asyncio.create_task(execute_window(w["id"]))
        except Exception as e:
            logger.warning(f"MW scheduler tick failed: {e}")
        await asyncio.sleep(60)


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/maintenance-windows/stats/summary")
async def stats_summary(current_user: dict = Depends(get_current_user)):
    pipeline = [{"$group": {"_id": "$status", "n": {"$sum": 1}}}]
    rows = await db.maintenance_windows.aggregate(pipeline).to_list(20)
    counts = {r["_id"]: r["n"] for r in rows}
    upcoming = await db.maintenance_windows.find(
        {"status": "scheduled"}, {"_id": 0, "id": 1, "name": 1, "scheduled_at": 1, "device_ids": 1}
    ).sort("scheduled_at", 1).limit(5).to_list(5)
    return {"counts": counts, "upcoming": upcoming}
