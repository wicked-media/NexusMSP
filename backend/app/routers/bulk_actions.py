from fastapi import APIRouter, Depends, Body, HTTPException
from app.auth import get_current_user

router = APIRouter(prefix="/bulk-actions", tags=["Bulk Device Actions"])


def _retired() -> None:
    """Fail closed instead of retaining a second, unaudited action path.

    The frontend has already redirected this legacy workspace to Managed
    Assets.  The supported `/devices/bulk-action` endpoint performs the
    client-scope, Agent availability, permission and Change Guardian checks.
    """
    raise HTTPException(
        status_code=410,
        detail="Legacy bulk device actions are retired. Use the Managed Assets bulk-action workflow.",
    )

@router.post("/execute")
async def execute_bulk_action(
    payload: dict = Body(...),
    user=Depends(get_current_user)
):
    _retired()

@router.get("/actions")
async def get_available_actions(user=Depends(get_current_user)):
    _retired()

@router.get("/history")
async def get_bulk_action_history(user=Depends(get_current_user)):
    _retired()
