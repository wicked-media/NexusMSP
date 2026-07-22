"""Compatibility endpoints for the retired QBR demo generator.

QBRs are generated from the Reporting Hub's recorded operational evidence.  The
former route constructed favourable security, uptime and SLA results at random;
it must never be used as a reporting source.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db


router = APIRouter()


async def _retire_demo_qbrs() -> None:
    await db.qbr_reports.delete_many({})


@router.get("/qbr-generator/list")
async def list_qbrs(current_user: dict = Depends(get_current_user)):
    await _retire_demo_qbrs()
    return []


@router.post("/qbr-generator/generate")
async def generate_qbr(data: dict, current_user: dict = Depends(get_current_user)):
    await _retire_demo_qbrs()
    raise HTTPException(
        status_code=410,
        detail="The legacy QBR generator was retired because it created unverified metrics. Generate an evidence-backed client or executive report from Reporting Hub.",
    )
