"""Retired compatibility endpoint for the former simulated Zero Trust page."""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user


router = APIRouter()


@router.get("/zero-trust/overview")
async def zero_trust_overview(current_user: dict = Depends(get_current_user)):
    """Do not fabricate policy enforcement, sign-in events, or trust scores.

    Conditional Access and identity posture belong to the configured Microsoft
    365 / CIPP tenant. NexusMSP retains the compatibility endpoint so an old
    bookmark receives a clear resolution rather than random sample data.
    """
    raise HTTPException(
        status_code=410,
        detail="The simulated Zero Trust workspace was retired. Configure and review Microsoft Conditional Access through the Microsoft 365 or CIPP integration.",
    )
