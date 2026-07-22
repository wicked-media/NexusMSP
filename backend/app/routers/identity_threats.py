"""Identity threat compatibility endpoints.

Identity findings must come from a configured provider such as Huntress or a
future Microsoft Graph ingestion pipeline. The old endpoint seeded invented
breaches, IP addresses, and user accounts, which cannot be security evidence.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user


router = APIRouter()


@router.get("/identity-threats/overview")
async def get_identity_overview(current_user: dict = Depends(get_current_user)):
    return {
        "source_configured": False,
        "availability": "no_identity_provider",
        "summary": {"total_alerts": 0, "active": 0, "critical": 0, "high": 0},
        "threats": [],
    }


@router.post("/identity-threats/{threat_id}/resolve")
async def resolve_identity_threat(threat_id: str, current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail=(
            "There is no provider-backed identity finding to resolve. "
            "Configure an identity telemetry source first."
        ),
    )
