"""Nexus Pulse — a read-only, client-scoped operational evidence view."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db
from app.services.nexus_pulse import compose_nexus_pulse
from app.services.scope_permissions import scoped_query, tenant_scoped_query


router = APIRouter(tags=["Nexus Pulse"])


@router.get("/nexus-pulse/overview")
async def nexus_pulse_overview(current_user: dict = Depends(get_current_user)):
    """Compose evidence from existing authoritative operational records only."""
    device_query = tenant_scoped_query(current_user, scoped_query(current_user, {}))
    agent_query = tenant_scoped_query(current_user, scoped_query(current_user, {"is_active": True}, site_field=None))
    ticket_query = tenant_scoped_query(current_user, scoped_query(current_user, {}))
    run_query = tenant_scoped_query(current_user, scoped_query(current_user, {}, site_field=None))
    backup_query = tenant_scoped_query(current_user, scoped_query(current_user, {}, site_field=None))
    devices, agents, tickets, runs, backup_jobs = await asyncio.gather(
        db.devices.find(device_query, {"_id": 0, "id": 1, "name": 1, "hostname": 1, "last_heartbeat": 1, "last_seen": 1, "telemetry_at": 1, "observed_at": 1}).to_list(3000),
        db.nexus_agents.find(agent_query, {"_id": 0, "id": 1, "hostname": 1, "name": 1, "last_seen": 1, "last_heartbeat": 1, "observed_at": 1}).to_list(3000),
        db.tickets.find(ticket_query, {"_id": 0, "id": 1, "status": 1, "priority": 1, "title": 1, "client_id": 1, "client_name": 1}).to_list(3000),
        db.workflow_runs.find(run_query, {"_id": 0, "id": 1, "status": 1, "workflow_id": 1, "workflow_name": 1, "client_id": 1, "client_name": 1, "created_at": 1, "updated_at": 1}).to_list(1000),
        db.backup_jobs.find(backup_query, {"_id": 0, "id": 1, "name": 1, "status": 1, "state": 1, "client_id": 1, "client_name": 1, "updated_at": 1, "last_run": 1}).to_list(3000),
    )
    return compose_nexus_pulse(
        devices=devices,
        agents=agents,
        tickets=tickets,
        automation_runs=runs,
        backup_jobs=backup_jobs,
    )
