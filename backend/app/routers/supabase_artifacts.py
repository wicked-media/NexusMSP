"""Authenticated readiness endpoint for Nexus's optional Supabase artifact layer."""
from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.services.supabase_storage import storage_status


router = APIRouter(tags=["Supabase Artifacts"])


@router.get("/supabase/artifacts/status")
async def get_supabase_artifact_status(current_user: dict = Depends(get_current_user)):
    """Expose configuration health without exposing credentials or object data."""
    del current_user
    return await storage_status()
