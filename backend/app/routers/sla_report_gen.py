"""Compatibility endpoints for the retired SLA report demo generator."""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db


router = APIRouter()


async def _retire_demo_sla_reports() -> None:
    await db.sla_generated_reports.delete_many({})


@router.get("/sla-report-gen/reports")
async def get_sla_reports(current_user: dict = Depends(get_current_user)):
    await _retire_demo_sla_reports()
    return []


@router.post("/sla-report-gen/generate")
async def generate_sla_report(data: dict, current_user: dict = Depends(get_current_user)):
    await _retire_demo_sla_reports()
    raise HTTPException(
        status_code=410,
        detail="The legacy SLA report generator was retired because it fabricated KPI values. Generate SLA reporting from Reporting Hub.",
    )
