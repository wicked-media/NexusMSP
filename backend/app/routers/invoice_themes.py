from fastapi import APIRouter, HTTPException, Depends, Request
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.scope_permissions import assert_global_scope

router = APIRouter()

BUILT_IN_THEMES = [
    {
        "id": "theme-modern",
        "name": "Modern Professional",
        "description": "Clean, modern layout with accent color header bar",
        "preview_colors": {"header": "#10b981", "accent": "#06b6d4", "text": "#1f2937"},
        "config": {"layout": "modern", "header_style": "bar", "show_logo": True, "show_company_details": True, "line_item_style": "striped", "footer_style": "minimal", "color_scheme": "brand"},
        "is_builtin": True,
    },
    {
        "id": "theme-classic",
        "name": "Classic Business",
        "description": "Traditional professional invoice with borders and formal layout",
        "preview_colors": {"header": "#1f2937", "accent": "#374151", "text": "#111827"},
        "config": {"layout": "classic", "header_style": "full_width", "show_logo": True, "show_company_details": True, "line_item_style": "bordered", "footer_style": "full", "color_scheme": "monochrome"},
        "is_builtin": True,
    },
    {
        "id": "theme-minimal",
        "name": "Minimal Clean",
        "description": "Ultra-clean minimalist design with lots of whitespace",
        "preview_colors": {"header": "#f9fafb", "accent": "#6b7280", "text": "#374151"},
        "config": {"layout": "minimal", "header_style": "line_only", "show_logo": True, "show_company_details": False, "line_item_style": "simple", "footer_style": "minimal", "color_scheme": "light"},
        "is_builtin": True,
    },
    {
        "id": "theme-bold",
        "name": "Bold Impact",
        "description": "Eye-catching design with large header and strong brand colors",
        "preview_colors": {"header": "#7c3aed", "accent": "#a855f7", "text": "#1e1b4b"},
        "config": {"layout": "bold", "header_style": "full_bleed", "show_logo": True, "show_company_details": True, "line_item_style": "highlight_totals", "footer_style": "branded", "color_scheme": "vibrant"},
        "is_builtin": True,
    },
    {
        "id": "theme-executive",
        "name": "Executive",
        "description": "Premium dark-accent design for high-value clients",
        "preview_colors": {"header": "#0f172a", "accent": "#f59e0b", "text": "#0f172a"},
        "config": {"layout": "executive", "header_style": "split", "show_logo": True, "show_company_details": True, "line_item_style": "premium", "footer_style": "full", "color_scheme": "dark_gold"},
        "is_builtin": True,
    },
]


LEGACY_THEME_GUIDANCE = (
    "This legacy theme preference does not alter standard invoice PDFs. "
    "Use Organisation Branding and the document template studio for customer documents."
)


async def _require_global_theme_scope(
    current_user: dict,
    request: Request | None,
    operation: str,
) -> None:
    """Invoice-theme records are organisation-wide legacy configuration."""
    await assert_global_scope(current_user, operation=operation, request=request)


async def _find_theme(theme_id: str) -> dict | None:
    for theme in BUILT_IN_THEMES:
        if theme["id"] == theme_id:
            return theme
    return await db.invoice_themes.find_one({"id": theme_id}, {"_id": 0})


@router.get(
    "/invoice-themes",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def get_invoice_themes(
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await _require_global_theme_scope(current_user, request, "commercial_document.legacy_theme.list")
    custom = await db.invoice_themes.find({}, {"_id": 0}).to_list(50)
    return BUILT_IN_THEMES + custom


@router.get(
    "/invoice-themes/active",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def get_active_theme(
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await _require_global_theme_scope(current_user, request, "commercial_document.legacy_theme.read")
    setting = await db.settings.find_one({"type": "invoice_theme"}, {"_id": 0})
    if setting:
        return {"active_theme_id": setting.get("active_theme_id", "theme-modern")}
    return {"active_theme_id": "theme-modern"}


@router.put(
    "/invoice-themes/active",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def set_active_theme(
    data: dict,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await _require_global_theme_scope(current_user, request, "commercial_document.legacy_theme.set_active")
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Theme payload must be an object")
    theme_id = str(data.get("theme_id") or "").strip()
    if not theme_id:
        raise HTTPException(status_code=400, detail="theme_id is required")
    if not await _find_theme(theme_id):
        raise HTTPException(status_code=404, detail="Theme not found")
    await db.settings.update_one(
        {"type": "invoice_theme"},
        {"$set": {"type": "invoice_theme", "active_theme_id": theme_id, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    await log_activity(
        current_user,
        "updated",
        "legacy_invoice_theme_setting",
        "invoice_theme",
        theme_id,
        "Updated a legacy invoice theme preference",
        metadata={"theme_id": theme_id, "deprecated": True},
    )
    return {
        "message": "Active theme updated",
        "active_theme_id": theme_id,
        "deprecated": True,
        "guidance": LEGACY_THEME_GUIDANCE,
    }


@router.post(
    "/invoice-themes",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def create_custom_theme(
    data: dict,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await _require_global_theme_scope(current_user, request, "commercial_document.legacy_theme.create")
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Theme payload must be an object")
    name = str(data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Theme name is required")
    preview_colors = data.get("preview_colors", {"header": "#10b981", "accent": "#06b6d4", "text": "#1f2937"})
    config = data.get("config", {})
    if not isinstance(preview_colors, dict) or not isinstance(config, dict):
        raise HTTPException(status_code=422, detail="Theme preview_colors and config must be objects")
    now = datetime.now(timezone.utc).isoformat()
    theme = {
        "id": f"theme-{uuid.uuid4().hex[:8]}",
        "name": name[:120],
        "description": str(data.get("description") or "")[:500],
        "preview_colors": preview_colors,
        "config": config,
        "is_builtin": False,
        "created_by": current_user.get("name", ""),
        "created_at": now,
    }
    await db.invoice_themes.insert_one(theme)
    result = {k: v for k, v in theme.items() if k != "_id"}
    await log_activity(
        current_user,
        "created",
        "legacy_invoice_theme",
        result["id"],
        result["name"],
        "Created a legacy invoice theme preference",
        metadata={"deprecated": True},
    )
    return {**result, "deprecated": True, "guidance": LEGACY_THEME_GUIDANCE}


@router.delete(
    "/invoice-themes/{theme_id}",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def delete_custom_theme(
    theme_id: str,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await _require_global_theme_scope(current_user, request, "commercial_document.legacy_theme.delete")
    if theme_id.startswith("theme-") and any(t["id"] == theme_id for t in BUILT_IN_THEMES):
        raise HTTPException(status_code=400, detail="Cannot delete built-in themes")
    existing = await db.invoice_themes.find_one({"id": theme_id}, {"_id": 0, "name": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Theme not found")
    result = await db.invoice_themes.delete_one({"id": theme_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Theme not found")
    active = await db.settings.find_one({"type": "invoice_theme"}, {"_id": 0, "active_theme_id": 1})
    if (active or {}).get("active_theme_id") == theme_id:
        await db.settings.update_one(
            {"type": "invoice_theme"},
            {"$set": {"active_theme_id": "theme-modern", "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
    await log_activity(
        current_user,
        "deleted",
        "legacy_invoice_theme",
        theme_id,
        existing.get("name") or "Legacy invoice theme",
        "Deleted a legacy invoice theme preference",
        metadata={"deprecated": True},
    )
    return {"message": "Theme deleted", "deprecated": True, "guidance": LEGACY_THEME_GUIDANCE}
