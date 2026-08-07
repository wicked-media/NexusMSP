from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import Optional
from datetime import datetime, timezone
import uuid, os, base64
from app.database import db, UPLOADS_DIR
from app.auth import get_current_user
from app.services.upload_security import IMAGE_EXTENSIONS, safe_upload_extension

router = APIRouter()

WALLPAPER_DIR = UPLOADS_DIR / "wallpapers"
WALLPAPER_DIR.mkdir(parents=True, exist_ok=True)


async def _require_branding_admin(current_user: dict) -> None:
    if current_user.get("is_admin") in (True, 1) or str(current_user.get("role") or "").lower() == "admin":
        return
    raise HTTPException(status_code=403, detail="Admin access required")

TEMPLATE_WALLPAPERS = [
    {"id": "tpl-cyber-city", "name": "Cyber City", "url": "https://images.unsplash.com/photo-1728330458318-70438beffc44?w=1920&q=80", "category": "cyberpunk"},
    {"id": "tpl-neon-glow", "name": "Neon Glow", "url": "https://images.unsplash.com/photo-1641650265007-b2db704cd9f3?w=1920&q=80", "category": "cyberpunk"},
    {"id": "tpl-dark-desk", "name": "Dark Workspace", "url": "https://images.unsplash.com/photo-1668713239048-0746aac1fec1?w=1920&q=80", "category": "workspace"},
    {"id": "tpl-tech-setup", "name": "Tech Setup", "url": "https://images.unsplash.com/photo-1665360786531-28f152b73086?w=1920&q=80", "category": "workspace"},
    {"id": "tpl-neon-sign", "name": "Neon Nights", "url": "https://images.unsplash.com/photo-1688377051459-aebb99b42bff?w=1920&q=80", "category": "cyberpunk"},
    {"id": "tpl-minimalist", "name": "Minimalist", "url": "https://images.unsplash.com/photo-1668714341253-81139e265a19?w=1920&q=80", "category": "workspace"},
]


@router.get("/settings/login-wallpaper")
async def get_login_wallpaper():
    """Get the current login wallpaper setting (public - no auth required for login page)"""
    setting = await db.settings.find_one({"type": "login_wallpaper"}, {"_id": 0})
    if not setting:
        return {"type": "default", "url": None, "overlay_opacity": 0.7}
    return {
        "type": setting.get("wallpaper_type", "default"),
        "url": setting.get("url"),
        "overlay_opacity": setting.get("overlay_opacity", 0.7),
    }


@router.get("/settings/login-wallpaper/templates")
async def get_wallpaper_templates(current_user: dict = Depends(get_current_user)):
    """Get available template wallpapers"""
    return TEMPLATE_WALLPAPERS


@router.put("/settings/login-wallpaper")
async def update_login_wallpaper(data: dict, current_user: dict = Depends(get_current_user)):
    """Update login wallpaper setting"""
    wallpaper_type = data.get("type", "default")  # default, template, custom
    url = data.get("url")
    overlay_opacity = data.get("overlay_opacity", 0.7)

    await db.settings.update_one(
        {"type": "login_wallpaper"},
        {"$set": {
            "type": "login_wallpaper",
            "wallpaper_type": wallpaper_type,
            "url": url,
            "overlay_opacity": overlay_opacity,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": current_user.get("id"),
        }},
        upsert=True,
    )
    return {"message": "Login wallpaper updated", "type": wallpaper_type, "url": url}


@router.post("/settings/login-wallpaper/upload")
async def upload_login_wallpaper(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """Upload a custom wallpaper image"""
    await _require_branding_admin(current_user)
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    # Read file (max 10MB)
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    ext = safe_upload_extension(file.filename, allowed=IMAGE_EXTENSIONS, default="jpg")
    filename = f"wallpaper-{uuid.uuid4().hex[:12]}.{ext}"
    filepath = WALLPAPER_DIR / filename

    with open(filepath, "wb") as f:
        f.write(contents)

    # Store as base64 data URL for portability
    b64 = base64.b64encode(contents).decode("utf-8")
    data_url = f"data:{file.content_type};base64,{b64}"

    # Save setting
    await db.settings.update_one(
        {"type": "login_wallpaper"},
        {"$set": {
            "type": "login_wallpaper",
            "wallpaper_type": "custom",
            "url": data_url,
            "filename": filename,
            "overlay_opacity": 0.7,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": current_user.get("id"),
        }},
        upsert=True,
    )
    return {"message": "Wallpaper uploaded", "url": data_url, "filename": filename}
