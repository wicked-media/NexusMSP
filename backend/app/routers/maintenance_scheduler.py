"""Compatibility endpoints for the retired maintenance scheduler.

Real maintenance now lives exclusively in ``maintenance_windows`` so each
scheduled action is tied to a Nexus Agent command and its returned result.
These read-only routes remain only to avoid a hard break for older bookmarks.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db


router = APIRouter()


@router.get("/maintenance-scheduler/schedules")
async def get_maintenance_schedules(current_user: dict = Depends(get_current_user)):
    """Return only previously persisted legacy schedules; never seed example data."""
    return await db.maintenance_schedules.find({}, {"_id": 0}).to_list(200)


@router.get("/maintenance-scheduler/history")
async def get_maintenance_history(current_user: dict = Depends(get_current_user)):
    """Return only previously persisted legacy history; never seed example data."""
    return await db.maintenance_history.find({}, {"_id": 0}).sort("executed_at", -1).to_list(100)


@router.post("/maintenance-scheduler/schedules")
@router.put("/maintenance-scheduler/schedules/{schedule_id}")
@router.delete("/maintenance-scheduler/schedules/{schedule_id}")
async def retired_mutation(schedule_id: str | None = None, current_user: dict = Depends(get_current_user)):
    raise HTTPException(410, "Legacy scheduler retired. Create an agent-backed maintenance window instead.")
