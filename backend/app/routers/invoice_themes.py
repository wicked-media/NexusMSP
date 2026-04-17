from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

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


@router.get("/invoice-themes")
async def get_invoice_themes(current_user: dict = Depends(get_current_user)):
    custom = await db.invoice_themes.find({}, {"_id": 0}).to_list(50)
    return BUILT_IN_THEMES + custom


@router.get("/invoice-themes/active")
async def get_active_theme(current_user: dict = Depends(get_current_user)):
    setting = await db.settings.find_one({"type": "invoice_theme"}, {"_id": 0})
    if setting:
        return {"active_theme_id": setting.get("active_theme_id", "theme-modern")}
    return {"active_theme_id": "theme-modern"}


@router.put("/invoice-themes/active")
async def set_active_theme(data: dict, current_user: dict = Depends(get_current_user)):
    theme_id = data.get("theme_id", "theme-modern")
    await db.settings.update_one(
        {"type": "invoice_theme"},
        {"$set": {"type": "invoice_theme", "active_theme_id": theme_id, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"message": "Active theme updated", "active_theme_id": theme_id}


@router.post("/invoice-themes")
async def create_custom_theme(data: dict, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    theme = {
        "id": f"theme-{uuid.uuid4().hex[:8]}",
        "name": data.get("name", "Custom Theme"),
        "description": data.get("description", ""),
        "preview_colors": data.get("preview_colors", {"header": "#10b981", "accent": "#06b6d4", "text": "#1f2937"}),
        "config": data.get("config", {}),
        "is_builtin": False,
        "created_by": current_user.get("name", ""),
        "created_at": now,
    }
    await db.invoice_themes.insert_one(theme)
    return {k: v for k, v in theme.items() if k != "_id"}


@router.delete("/invoice-themes/{theme_id}")
async def delete_custom_theme(theme_id: str, current_user: dict = Depends(get_current_user)):
    if theme_id.startswith("theme-") and any(t["id"] == theme_id for t in BUILT_IN_THEMES):
        raise HTTPException(status_code=400, detail="Cannot delete built-in themes")
    result = await db.invoice_themes.delete_one({"id": theme_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Theme not found")
    return {"message": "Theme deleted"}
