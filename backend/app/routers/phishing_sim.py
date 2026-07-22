"""Compatibility endpoints for the retired phishing-simulation workspace.

The prior workspace generated campaign metrics without delivering a message or
collecting a tracked result. It is unavailable until NexusMSP has a consented
mail-delivery and tracking implementation.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user


router = APIRouter()


def _retired_error() -> HTTPException:
    return HTTPException(
        status_code=410,
        detail=(
            "Phishing Simulation was retired because no mail-delivery and "
            "tracking provider is connected. NexusMSP will not generate "
            "campaign metrics without actual delivery and audit evidence."
        ),
    )


@router.get("/phishing-sim/campaigns")
async def get_campaigns(current_user: dict = Depends(get_current_user)):
    raise _retired_error()


@router.post("/phishing-sim/campaigns")
async def create_campaign(current_user: dict = Depends(get_current_user)):
    raise _retired_error()
