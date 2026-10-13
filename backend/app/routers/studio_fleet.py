"""Studio fleet API — read-only access to the studio capability registry.

The registry (``app.services.studio_registry``) is static capability-contract
code: no customer data, no secrets, no tenant partition needed. These endpoints
therefore return admission evidence and tab states only — never live provider
health, which each wired tab reads from its own scoped endpoint instead.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.services import studio_registry

router = APIRouter()


@router.get("/studios")
async def list_studios(current_user: dict = Depends(get_current_user)) -> dict:
    """Every studio in the fleet with its honest status and per-tab states."""
    return studio_registry.list_studios()


@router.get("/studios/{studio_id}")
async def get_studio(studio_id: str, current_user: dict = Depends(get_current_user)) -> dict:
    """One studio's full contract: spine, provider contract, admission, tabs."""
    studio = studio_registry.get_studio(studio_id)
    if not studio:
        raise HTTPException(status_code=404, detail=f"Unknown studio '{studio_id}'")
    return studio
