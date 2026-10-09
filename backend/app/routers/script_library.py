"""Nexus Script Library — curated catalogue endpoints.

The library is the premium, reviewed script collection an MSP installs from.
Installation copies a catalogue entry into the live scripting workspace
(``db.scripts``) carrying its library provenance, so every installed script can
be distinguished from technician-authored ones and uninstalled safely.

Writes follow the platform's boundary rules: executing a script still goes
through the scripting workspace's agent-operator gate; this router only manages
library membership.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.database import db
from app.services.script_library_catalog import (
    CATEGORIES,
    OS_TARGETS,
    SCRIPT_TYPES,
    category_counts,
    get_entry,
    library_version,
    list_entries,
)

router = APIRouter()


class LibraryInstallRequest(BaseModel):
    model_config = {"extra": "forbid"}

    name: Optional[str] = Field(default=None, max_length=200, description="Optional override for the installed script name")


def _installed_view(doc: dict) -> dict:
    return {
        "script_id": doc.get("id"),
        "slug": doc.get("library_template_name"),
        "name": doc.get("name"),
        "category": doc.get("category"),
        "installed_at": doc.get("library_installed_at", doc.get("created_at")),
        "run_count": doc.get("run_count", 0),
    }


@router.get("/script-library")
async def browse_library(
    category: Optional[str] = None,
    os_target: Optional[str] = None,
    script_type: Optional[str] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Browse the curated library with filters. Catalogue is code, always in sync."""
    entries = list_entries(category=category, os_target=os_target, script_type=script_type, search=search)
    return {
        "version": library_version(),
        "count": len(entries),
        "filters": {"categories": CATEGORIES, "os_targets": OS_TARGETS, "script_types": SCRIPT_TYPES},
        "category_counts": category_counts(),
        "scripts": [
            {
                "slug": e["slug"],
                "name": e["name"],
                "description": e["description"],
                "category": e["category"],
                "os_target": e["os_target"],
                "script_type": e["script_type"],
                "run_as_admin": e["run_as_admin"],
                "timeout_seconds": e["timeout_seconds"],
                "tags": e["tags"],
                "parameters": e["parameters"],
            }
            for e in entries
        ],
    }


@router.get("/script-library/{slug}")
async def get_library_entry(slug: str, current_user: dict = Depends(get_current_user)):
    """Full catalogue entry including the script body."""
    entry = get_entry(slug)
    if not entry:
        raise HTTPException(status_code=404, detail="Library entry not found")
    installed = await db.scripts.find_one(
        {"library_template_name": slug}, {"_id": 0, "id": 1, "name": 1, "created_at": 1}
    )
    return {
        "version": library_version(),
        "entry": entry,
        "installed": bool(installed),
        "installed_script_id": (installed or {}).get("id"),
    }


@router.get("/script-library/installed/list")
async def list_installed(current_user: dict = Depends(get_current_user)):
    """Which library entries are installed in this workspace, with provenance."""
    docs = await db.scripts.find(
        {"library_pack_ids": "premium-library"}, {"_id": 0}
    ).sort("name", 1).to_list(500)
    return {"count": len(docs), "installed": [_installed_view(d) for d in docs]}


@router.post("/script-library/{slug}/install")
async def install_library_entry(
    slug: str,
    payload: LibraryInstallRequest | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Copy a catalogue entry into the live scripting workspace (idempotent per slug)."""
    entry = get_entry(slug)
    if not entry:
        raise HTTPException(status_code=404, detail="Library entry not found")

    existing = await db.scripts.find_one({"library_template_name": slug}, {"_id": 0})
    if existing:
        return {"status": "already_installed", "script": _installed_view(existing)}

    name = (payload.name.strip() if payload and payload.name else entry["name"])
    if not name:
        raise HTTPException(status_code=422, detail="Installed script needs a name")

    now = datetime.now(timezone.utc)
    doc = {
        "id": f"lib-{slug}-{now.strftime('%Y%m%d%H%M%S')}",
        "name": name,
        "description": entry["description"],
        "script_type": entry["script_type"],
        "content": entry["content"],
        "category": entry["category"],
        "os_target": entry["os_target"],
        "run_as_admin": entry["run_as_admin"],
        "timeout_seconds": entry["timeout_seconds"],
        "parameters": entry["parameters"],
        "is_built_in": True,
        "library_pack_ids": ["premium-library"],
        "library_template_name": slug,
        "library_installed_at": now.isoformat(),
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name", ""),
        "run_count": 0,
        "last_run": None,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    await db.scripts.insert_one(dict(doc))
    doc.pop("_id", None)
    return {"status": "installed", "script": _installed_view(doc)}


@router.delete("/script-library/{slug}/install")
async def uninstall_library_entry(slug: str, current_user: dict = Depends(get_current_user)):
    """Remove a library-installed script. Technician-authored scripts are never touched."""
    existing = await db.scripts.find_one({"library_template_name": slug}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Library entry is not installed")
    if "premium-library" not in (existing.get("library_pack_ids") or []):
        raise HTTPException(status_code=422, detail="Script is not library-managed; delete it from the scripting workspace")
    await db.scripts.delete_one({"id": existing["id"]})
    return {"status": "uninstalled", "script": _installed_view(existing)}
