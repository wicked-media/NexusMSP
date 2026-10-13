"""Extension Studio routes — a controlled way to add capability without editing core.

The endpoint that matters is ``POST /extensions/validate``. It runs the disclosed
checks in ``app.services.extension_studio`` against a submitted manifest and
returns a verdict. It **persists nothing**, builds nothing, signs nothing and
executes nothing — an approval here is a review outcome, not a deployment and not
a grant of privilege.

Capability references are resolved against the routes this Nexus actually serves
(``build_catalogue``), reusing the same grounding Nexus Forge uses, so a manifest
cannot reference a capability the API does not have.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.services import extension_studio as policy
from app.services.action_permissions import require_action
from app.services.nexus_forge import build_catalogue

router = APIRouter(prefix="/extensions", tags=["Extension Studio"])


class ManifestRequest(BaseModel):
    manifest: dict[str, Any] = Field(default_factory=dict)


def _served_capabilities(request: Request) -> list[dict[str, Any]]:
    routes: list[tuple[str, Any]] = []
    for route in getattr(request.app, "routes", []) or []:
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        if path and methods:
            routes.append((path, methods))
    return build_catalogue(routes)


@router.get("/contract")
async def extension_contract(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """The manifest contract the UI renders, so the rules live in one place."""
    return policy.manifest_contract()


@router.get("/capabilities")
async def extension_capabilities(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Capabilities a manifest may declare, grounded in the served route table."""
    capabilities = _served_capabilities(request)
    return {
        "capabilities": capabilities,
        "count": len(capabilities),
        "boundary": (
            "Capability references resolve against the routes this Nexus serves. A manifest "
            "that declares a capability the API does not serve cannot be approved."
        ),
    }


@router.post("/validate")
async def validate_extension(
    payload: ManifestRequest,
    request: Request,
    user: dict[str, Any] = Depends(require_action("platform.configuration.manage")),
) -> dict[str, Any]:
    """Run every disclosed check over a manifest and return its verdict.

    Requires ``platform.configuration.manage``: reviewing an extension is a
    configuration act, and the endpoint refuses a caller without it rather than
    returning a verdict to anyone who asks.
    """
    capabilities = _served_capabilities(request)
    result = policy.validate_manifest(
        payload.manifest,
        known_capabilities=[entry["id"] for entry in capabilities],
    )
    result["checks_summary"] = policy.summarize_checks(result["checks"])
    result["capability_count"] = len(capabilities)
    return result
