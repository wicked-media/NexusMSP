"""Retired compatibility routes for the pre-governance automation surface.

The original ``/automation`` API wrote arbitrary records into the shared
``runbooks`` collection and presented a local simulation as if it were an
automation runtime. Governed automation now lives in ``workflow_automation``:
it owns scope, simulation, approval, audit and durable execution evidence.

Keep these URLs explicit and fail closed so an old bookmark or integration
cannot silently create a second, ungoverned execution path.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user


router = APIRouter()

_RETIRED_DETAIL = (
    "Legacy automation runbooks are retired. Use the governed Workflow Automation "
    "workspace and /api/workflows instead."
)


def _retired() -> None:
    raise HTTPException(status_code=410, detail=_RETIRED_DETAIL)


@router.get("/automation")
async def get_runbooks(current_user: dict = Depends(get_current_user)):
    _retired()


@router.get("/automation/logs")
async def get_runbook_logs(current_user: dict = Depends(get_current_user)):
    _retired()


@router.get("/automation/templates")
async def get_runbook_templates(current_user: dict = Depends(get_current_user)):
    _retired()


@router.post("/automation")
async def create_runbook(data: dict, current_user: dict = Depends(get_current_user)):
    _retired()


@router.put("/automation/{runbook_id}")
async def update_runbook(runbook_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    _retired()


@router.delete("/automation/{runbook_id}")
async def delete_runbook(runbook_id: str, current_user: dict = Depends(get_current_user)):
    _retired()


@router.post("/automation/{runbook_id}/test")
async def test_runbook(runbook_id: str, current_user: dict = Depends(get_current_user)):
    _retired()
