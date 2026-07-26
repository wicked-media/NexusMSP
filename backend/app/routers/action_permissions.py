"""Read-only permission evidence for Team Command and Control Plane."""

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.services.action_permissions import (
    effective_action_permissions,
    permission_catalogue,
)
from app.services.scope_permissions import effective_scope


router = APIRouter()


@router.get("/permissions/catalog")
async def get_permission_catalog(current_user: dict = Depends(get_current_user)):
    return permission_catalogue()


@router.get("/permissions/me")
async def get_my_effective_permissions(current_user: dict = Depends(get_current_user)):
    permissions = await effective_action_permissions(current_user)
    permissions["scope"] = effective_scope(current_user)
    return permissions
