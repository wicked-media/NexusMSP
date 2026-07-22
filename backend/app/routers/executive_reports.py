"""Compatibility endpoints for the retired mock executive-report generator.

Executive reporting is now generated through the evidence-backed Reporting Hub.
This router remains registered only so historic links do not silently create or
display fabricated client KPIs.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db


router = APIRouter(prefix="/executive-reports", tags=["executive-reports"])


async def _retire_mock_reports() -> None:
    # This collection was used exclusively by the former random-data generator.
    await db.executive_reports.delete_many({})


@router.get("/list")
async def list_reports(current_user: dict = Depends(get_current_user)):
    await _retire_mock_reports()
    return {
        "reports": [],
        "availability": "retired",
        "message": "The mock Executive Reports generator was retired. Generate client and executive packs from Reporting Hub so every output has recorded source evidence.",
    }


@router.post("/generate")
async def generate_report(current_user: dict = Depends(get_current_user)):
    await _retire_mock_reports()
    raise HTTPException(
        status_code=410,
        detail="The legacy Executive Reports generator was retired because it could fabricate KPIs. Use Reporting Hub to generate an evidence-backed report.",
    )


@router.delete("/{report_id}")
async def delete_report(report_id: str, current_user: dict = Depends(get_current_user)):
    await _retire_mock_reports()
    raise HTTPException(status_code=410, detail="Legacy Executive Reports were retired; there is no report to delete.")
