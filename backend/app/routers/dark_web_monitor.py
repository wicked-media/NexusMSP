"""Compatibility endpoints for the retired Dark Web Monitor workspace.

NexusMSP does not currently have a configured breach-intelligence provider.  The
previous implementation fabricated exposure findings, affected users, and scan
times whenever this endpoint was opened.  That is unsafe in a security product,
so the workspace remains unavailable until a provider-backed integration is
implemented.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user


router = APIRouter()


def _retired_error() -> HTTPException:
    return HTTPException(
        status_code=410,
        detail=(
            "Dark Web Monitor was retired because NexusMSP has no connected "
            "breach-intelligence provider. Configure a provider-backed "
            "integration before presenting exposure findings to technicians."
        ),
    )


@router.get("/dark-web-monitor/overview")
async def dark_web_overview(current_user: dict = Depends(get_current_user)):
    raise _retired_error()


@router.post("/dark-web-monitor/{alert_id}/resolve")
async def resolve_alert(alert_id: str, current_user: dict = Depends(get_current_user)):
    raise _retired_error()
