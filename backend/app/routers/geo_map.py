"""Compatibility endpoint for the retired simulated geo-map workspace."""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user


router = APIRouter()


@router.get("/geo-map/data")
async def geo_map_data(current_user: dict = Depends(get_current_user)):
    """Do not fabricate technician locations or client-site coordinates."""
    raise HTTPException(
        status_code=410,
        detail="Geo Map was retired because NexusMSP does not collect verified GPS location data. Use Dispatch availability and the linked ticket appointment instead.",
    )
