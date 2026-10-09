"""Governed settings for the shared invoice and purchase-order document language."""

from fastapi import APIRouter, Depends, Request

from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.commercial_documents import (
    COMMERCIAL_DOCUMENT_TYPES,
    get_commercial_document_profile,
    save_commercial_document_profile,
)
from app.services.scope_permissions import assert_global_scope


router = APIRouter()


async def _require_commercial_document_manager(current_user: dict, request: Request, operation: str) -> None:
    await assert_global_scope(current_user, operation=operation, request=request)


@router.get(
    "/commercial-documents/{document_type}/profile",
    dependencies=[Depends(require_action("billing.document_template.manage"))],
)
async def read_commercial_document_profile(
    document_type: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    await _require_commercial_document_manager(current_user, request, "commercial_document.profile.read")
    return await get_commercial_document_profile(document_type)


@router.put(
    "/commercial-documents/{document_type}/profile",
    dependencies=[Depends(require_action("billing.document_template.manage"))],
)
async def update_commercial_document_profile(
    document_type: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    await _require_commercial_document_manager(current_user, request, "commercial_document.profile.update")
    result = await save_commercial_document_profile(document_type, data, actor=current_user)
    await log_activity(
        current_user,
        "commercial_document_profile_updated",
        "commercial_document_profile",
        document_type,
        result["profile"].get("label") or document_type,
        "Updated an organisation-wide commercial document profile",
        metadata={
            "document_type": document_type,
            "revision": result["revision"],
            "template_id": result["profile"].get("template_id") or None,
            "fields": sorted((data.get("profile") if isinstance(data.get("profile"), dict) else data).keys()),
        },
    )
    return result


@router.get("/commercial-documents/types")
async def list_commercial_document_types(current_user: dict = Depends(get_current_user)):
    """Expose a stable vocabulary for the Settings UI without revealing designs."""
    del current_user
    return {"document_types": sorted(COMMERCIAL_DOCUMENT_TYPES)}
