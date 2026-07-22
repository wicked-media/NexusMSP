"""Compatibility endpoint for the retired hardware-refresh demo."""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user


router = APIRouter()


@router.get("/hardware-refresh/overview")
async def hardware_refresh_overview(current_user: dict = Depends(get_current_user)):
    """Keep old API clients honest rather than generating fictitious refresh plans."""
    raise HTTPException(
        status_code=410,
        detail="Hardware Refresh was retired. Use Procurement Planner, which is based on recorded Inventory Assets and linked managed-asset telemetry.",
    )
