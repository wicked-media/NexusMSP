"""
Hudu integration Ã¢â‚¬â€ feature-rich read-only client.
Fixes: correct 'search' query param, paginated fetch of all resource types,
AI-powered KB suggestions for tickets via OpenAI API key (Claude Sonnet 4.5).
"""
import os
import re
import uuid
import asyncio
from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import httpx

from app.database import db
from app.auth import get_current_user

router = APIRouter()

# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Config + HTTP helpers
# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

async def get_hudu_config():
    doc = await db.settings.find_one({"type": "hudu"}, {"_id": 0})
    if not doc or not doc.get("url") or not doc.get("api_key_full"):
        return None
    return doc


async def _hudu_get(config: dict, path: str, params: Optional[dict] = None) -> Optional[dict]:
    url = config["url"].rstrip("/")
    api_url = f"{url}/api/v1/{path.lstrip('/')}"
    headers = {
        "x-api-key": config["api_key_full"],
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    verify_ssl = os.environ.get("ALLOW_SELF_SIGNED_CERTS", "false").lower() != "true"
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=verify_ssl) as client:
            r = await client.get(api_url, headers=headers, params=params or {})
            if r.status_code == 401:
                raise HTTPException(401, "Hudu authentication failed Ã¢â‚¬â€ check API key")
            if r.status_code == 403:
                # Endpoint disabled on plan Ã¢â‚¬â€ return empty, not an error
                return None
            if r.status_code == 429:
                raise HTTPException(429, "Hudu rate-limit hit Ã¢â‚¬â€ slow down")
            if r.status_code == 404:
                return None
            if r.status_code >= 400:
                raise HTTPException(r.status_code, f"Hudu error: {r.text[:200]}")
            return r.json() if r.content else {}
    except httpx.ConnectError as e:
        raise HTTPException(503, f"Cannot connect to Hudu: {str(e)[:100]}")
    except httpx.TimeoutException:
        raise HTTPException(504, "Hudu request timed out")
    except httpx.RequestError as e:
        raise HTTPException(503, f"Hudu request failed: {str(e)[:100]}")


async def _hudu_get_all(config: dict, path: str, collection_key: str, extra_params: Optional[dict] = None, max_pages: int = 10, page_size: int = 100) -> List[dict]:
    """Walk pagination for a list endpoint and return a flat list."""
    out: List[dict] = []
    for page in range(1, max_pages + 1):
        params = {"page": page, "page_size": page_size}
        if extra_params:
            params.update(extra_params)
        data = await _hudu_get(config, path, params=params)
        if not data:
            break
        items = data.get(collection_key, [])
        if not items:
            break
        out.extend(items)
        if len(items) < page_size:
            break
    return out


def _ok_config() -> dict:
    """Sync-style helper that raises 503 when not configured (used in endpoints)."""
    return {}  # placeholder Ã¢â‚¬â€ we check config async in each route


def _not_configured():
    return HTTPException(503, "Hudu not configured Ã¢â‚¬â€ add URL and API key in Settings")


# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Settings
# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.get("/settings/hudu")
async def get_hudu_settings(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": "hudu"}, {"_id": 0}) or {}
    return {
        "type": "hudu",
        "url": doc.get("url", ""),
        "api_key": doc.get("api_key", ""),  # masked preview
        "configured": bool(doc.get("url") and doc.get("api_key_full")),
        "last_test_status": doc.get("last_test_status"),
        "last_tested_at": doc.get("last_tested_at"),
        "last_synced_at": doc.get("last_synced_at"),
        "last_summary": doc.get("last_summary"),
    }


@router.put("/settings/hudu")
async def update_hudu_settings(data: dict, current_user: dict = Depends(get_current_user)):
    url = (data.get("url") or "").strip().rstrip("/")
    api_key = (data.get("api_key") or "").strip()
    if not url or not api_key:
        raise HTTPException(400, "url and api_key are required")
    masked = f"{'*' * max(0, len(api_key) - 6)}{api_key[-6:]}" if len(api_key) > 6 else "***"
    now = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one(
        {"type": "hudu"},
        {"$set": {
            "type": "hudu",
            "url": url,
            "api_key_full": api_key,
            "api_key": masked,
            "configured": True,
            "updated_at": now,
            "updated_by": current_user.get("name"),
        }},
        upsert=True,
    )
    return {"message": "Hudu settings saved", "configured": True}


@router.delete("/settings/hudu")
async def clear_hudu_settings(current_user: dict = Depends(get_current_user)):
    await db.settings.delete_one({"type": "hudu"})
    return {"message": "Hudu credentials removed"}


@router.post("/settings/hudu/test")
async def test_hudu_connection(current_user: dict = Depends(get_current_user)):
    config = await get_hudu_config()
    if not config:
        return {"success": False, "message": "Not configured Ã¢â‚¬â€ enter URL and API key first"}
    now = datetime.now(timezone.utc).isoformat()
    try:
        data = await _hudu_get(config, "api_info")
        if data is None:
            # Try a real resource endpoint as fallback (api_info may not exist on older Hudu)
            data = await _hudu_get(config, "companies", params={"page_size": 1})
        await db.settings.update_one(
            {"type": "hudu"},
            {"$set": {"last_test_status": "success", "last_tested_at": now}},
        )
        return {"success": True, "message": "Connected to Hudu", "info": data}
    except HTTPException as e:
        await db.settings.update_one(
            {"type": "hudu"},
            {"$set": {"last_test_status": f"failed_{e.status_code}", "last_tested_at": now}},
        )
        return {"success": False, "message": e.detail}
    except Exception as e:
        await db.settings.update_one(
            {"type": "hudu"},
            {"$set": {"last_test_status": f"error: {str(e)[:80]}", "last_tested_at": now}},
        )
        return {"success": False, "message": str(e)[:200]}


# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Lists
# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.get("/hudu/companies")
async def list_companies(page: int = 1, page_size: int = 25, search: str = "", current_user: dict = Depends(get_current_user)):
    config = await get_hudu_config()
    if not config:
        raise _not_configured()
    params = {"page": page, "page_size": min(max(1, page_size), 100)}
    if search:
        params["name"] = search
    data = await _hudu_get(config, "companies", params=params)
    return {"companies": (data or {}).get("companies", [])}


@router.get("/hudu/articles")
async def list_articles(
    page: int = 1,
    page_size: int = 25,
    search: str = "",
    company_id: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
):
    config = await get_hudu_config()
    if not config:
        return {"articles": [], "error": "Hudu not configured. Add your Hudu API key in Settings."}
    params = {"page": page, "page_size": min(max(1, page_size), 100)}
    # Hudu's v1 articles endpoint accepts both 'name' (title contains) and 'search'
    if search:
        params["search"] = search
        params["name"] = search
    if company_id:
        params["company_id"] = company_id
    data = await _hudu_get(config, "articles", params=params)
    items = (data or {}).get("articles", [])
    # Normalise shape
    articles = [{
        "id": a.get("id"),
        "name": a.get("name") or a.get("title") or "",
        "slug": a.get("slug"),
        "content": a.get("content", ""),
        "folder_id": a.get("folder_id"),
        "company_id": a.get("company_id"),
        "company_name": a.get("company_name") or "",
        "url": a.get("url"),
        "updated_at": a.get("updated_at"),
        "created_at": a.get("created_at"),
    } for a in items]
    return {"articles": articles, "error": None}


@router.get("/hudu/articles/{article_id}")
async def get_article(article_id: int, current_user: dict = Depends(get_current_user)):
    config = await get_hudu_config()
    if not config:
        raise _not_configured()
    data = await _hudu_get(config, f"articles/{article_id}")
    if not data:
        raise HTTPException(404, "Article not found")
    return data.get("article") or data


@router.get("/hudu/assets")
async def list_assets(page: int = 1, page_size: int = 25, company_id: Optional[int] = None, search: str = "", current_user: dict = Depends(get_current_user)):
    config = await get_hudu_config()
    if not config:
        raise _not_configured()
    params = {"page": page, "page_size": min(max(1, page_size), 100)}
    if company_id:
        params["company_id"] = company_id
    if search:
        params["name"] = search
    data = await _hudu_get(config, "assets", params=params)
    return {"assets": (data or {}).get("assets", [])}


@router.get("/hudu/asset-layouts")
async def list_asset_layouts(current_user: dict = Depends(get_current_user)):
    config = await get_hudu_config()
    if not config:
        raise _not_configured()
    data = await _hudu_get(config, "asset_layouts", params={"page_size": 100})
    return {"asset_layouts": (data or {}).get("asset_layouts", [])}


@router.get("/hudu/websites")
async def list_websites(page: int = 1, page_size: int = 25, company_id: Optional[int] = None, current_user: dict = Depends(get_current_user)):
    config = await get_hudu_config()
    if not config:
        raise _not_configured()
    params = {"page": page, "page_size": min(max(1, page_size), 100)}
    if company_id:
        params["company_id"] = company_id
    data = await _hudu_get(config, "websites", params=params)
    return {"websites": (data or {}).get("websites", [])}


@router.get("/hudu/procedures")
async def list_procedures(page: int = 1, page_size: int = 25, search: str = "", current_user: dict = Depends(get_current_user)):
    config = await get_hudu_config()
    if not config:
        raise _not_configured()
    params = {"page": page, "page_size": min(max(1, page_size), 100)}
    if search:
        params["name"] = search
    data = await _hudu_get(config, "procedures", params=params)
    return {"procedures": (data or {}).get("procedures", [])}


@router.get("/hudu/passwords")
async def list_passwords(page: int = 1, page_size: int = 25, company_id: Optional[int] = None, search: str = "", current_user: dict = Depends(get_current_user)):
    config = await get_hudu_config()
    if not config:
        raise _not_configured()
    params = {"page": page, "page_size": min(max(1, page_size), 100)}
    if company_id:
        params["company_id"] = company_id
    if search:
        params["name"] = search
    data = await _hudu_get(config, "asset_passwords", params=params)
    items = (data or {}).get("asset_passwords") or (data or {}).get("passwords", [])
    # Redact the password field in the list response
    redacted = []
    for p in items:
        r = {k: v for k, v in p.items() if k != "password"}
        r["password"] = None
        r["_has_password"] = bool(p.get("password"))
        redacted.append(r)
    return {"passwords": redacted, "note": "Passwords redacted in list; use /hudu/passwords/{id} for the full credential"}


@router.get("/hudu/passwords/{password_id}")
async def get_password(password_id: int, current_user: dict = Depends(get_current_user)):
    config = await get_hudu_config()
    if not config:
        raise _not_configured()
    data = await _hudu_get(config, f"asset_passwords/{password_id}")
    if not data:
        raise HTTPException(404, "Password not found")
    # Audit every decrypted reveal
    await db.hudu_password_reveals.insert_one({
        "password_id": password_id,
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return data.get("asset_password") or data.get("password") or data


# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# Global search + SUMMARY
# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.get("/hudu/search")
async def global_search(q: str = Query(..., min_length=1), current_user: dict = Depends(get_current_user)):
    """Fan-out search across articles, assets, passwords, procedures, websites."""
    config = await get_hudu_config()
    if not config:
        raise _not_configured()

    async def safe(coro):
        try:
            return await coro
        except HTTPException:
            return None
        except Exception:
            return None

    articles, assets, procedures, websites, passwords = await asyncio.gather(
        safe(_hudu_get(config, "articles", params={"search": q, "name": q, "page_size": 10})),
        safe(_hudu_get(config, "assets", params={"name": q, "page_size": 10})),
        safe(_hudu_get(config, "procedures", params={"name": q, "page_size": 10})),
        safe(_hudu_get(config, "websites", params={"name": q, "page_size": 10})),
        safe(_hudu_get(config, "asset_passwords", params={"name": q, "page_size": 10})),
    )
    return {
        "query": q,
        "articles": ((articles or {}).get("articles") or [])[:10],
        "assets": ((assets or {}).get("assets") or [])[:10],
        "procedures": ((procedures or {}).get("procedures") or [])[:10],
        "websites": ((websites or {}).get("websites") or [])[:10],
        "passwords": [{k: v for k, v in p.items() if k != "password"} for p in (((passwords or {}).get("asset_passwords") or (passwords or {}).get("passwords") or [])[:10])],
    }


@router.get("/hudu/summary")
async def summary(force: bool = False, current_user: dict = Depends(get_current_user)):
    """Dashboard roll-up. Reads from cache (db.settings type='hudu_summary_cache') unless
    force=true. Cache is refreshed by /hudu/sync and on first ever call.
    Always returns a `stats` block Ã¢â‚¬â€ never times out the UI."""
    config = await get_hudu_config()
    if not config:
        return {"configured": False, "message": "Hudu not configured", "stats": {"companies": 0, "articles": 0, "assets": 0, "procedures": 0, "websites": 0, "passwords": 0}}

    cache = await db.settings.find_one({"type": "hudu_summary_cache"}, {"_id": 0})
    cache_age_min = 999
    if cache and cache.get("computed_at"):
        try:
            dt = datetime.fromisoformat(cache["computed_at"].replace("Z", "+00:00"))
            cache_age_min = (datetime.now(timezone.utc) - dt).total_seconds() / 60
        except Exception:
            pass

    if cache and cache.get("stats") and not force and cache_age_min < 60:
        return {
            "configured": True,
            "stats": cache["stats"],
            "recent_articles": cache.get("recent_articles", []),
            "last_synced_at": cache.get("computed_at"),
            "cache_age_minutes": round(cache_age_min, 1),
        }

    # Cache miss / stale / force Ã¢â‚¬â€ compute fresh (best effort)
    fresh = await _compute_hudu_summary(config)
    return fresh


async def _compute_hudu_summary(config: dict) -> dict:
    """Compute counts live from Hudu, persist to db.settings cache, return."""
    async def safe(coro):
        try:
            return await coro
        except Exception:
            return None

    async def count(path: str, key: str):
        d = await safe(_hudu_get(config, path, params={"page_size": 1}))
        if not d:
            return 0
        total_pages = (d.get("meta") or {}).get("total_pages") or d.get("total_pages") or 0
        if total_pages and isinstance(total_pages, int):
            return total_pages  # per_page=1 Ã¢â€ â€™ total_pages == total items
        items = d.get(key) or []
        return len(items)

    companies_cnt, articles_cnt, assets_cnt, procs_cnt, websites_cnt, passwords_cnt = await asyncio.gather(
        count("companies", "companies"),
        count("articles", "articles"),
        count("assets", "assets"),
        count("procedures", "procedures"),
        count("websites", "websites"),
        count("asset_passwords", "asset_passwords"),
    )

    recent = await safe(_hudu_get(config, "articles", params={"page_size": 5}))
    recent_articles = [{
        "id": a.get("id"),
        "name": a.get("name"),
        "company_name": a.get("company_name"),
        "updated_at": a.get("updated_at"),
    } for a in ((recent or {}).get("articles") or [])]

    now = datetime.now(timezone.utc).isoformat()
    stats = {
        "companies": companies_cnt,
        "articles": articles_cnt,
        "assets": assets_cnt,
        "procedures": procs_cnt,
        "websites": websites_cnt,
        "passwords": passwords_cnt,
    }
    await db.settings.update_one(
        {"type": "hudu_summary_cache"},
        {"$set": {"type": "hudu_summary_cache", "stats": stats, "recent_articles": recent_articles, "computed_at": now}},
        upsert=True,
    )
    return {
        "configured": True,
        "stats": stats,
        "recent_articles": recent_articles,
        "last_synced_at": now,
        "cache_age_minutes": 0,
    }


# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# AI-powered KB suggestions for a ticket
# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

def _strip_html(text: str) -> str:
    if not text:
        return ""
    # cheap HTML stripper
    cleaned = re.sub(r"<[^>]+>", " ", text)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _keyword_query(title: str, description: str) -> str:
    """Pull 3-6 strongest keywords from the ticket for a Hudu search."""
    blob = f"{title or ''} {description or ''}".lower()
    blob = _strip_html(blob)
    # Strip common stopwords, punctuation
    tokens = re.findall(r"[a-z0-9][a-z0-9\-\.]{2,}", blob)
    stop = {"the", "and", "for", "with", "this", "that", "from", "have", "has", "you", "are", "our", "your",
            "when", "what", "will", "they", "any", "but", "not", "can", "get", "got", "was", "were",
            "been", "being", "into", "than", "then", "them", "their", "which", "there", "here",
            "could", "would", "should", "about", "ticket", "issue", "problem", "please", "help",
            "email", "office", "user", "client", "need", "trying", "unable", "doesnt", "dont",
            "using", "make", "sure", "also"}
    freq: Dict[str, int] = {}
    for t in tokens:
        if t in stop or len(t) < 3:
            continue
        freq[t] = freq.get(t, 0) + 1
    ranked = sorted(freq.items(), key=lambda x: (-x[1], x[0]))
    return " ".join(k for k, _ in ranked[:6])


@router.post("/hudu/suggest-for-ticket")
async def suggest_for_ticket(data: dict, current_user: dict = Depends(get_current_user)):
    """
    body: { "ticket_id"?: "...", "title": "...", "description": "...", "use_ai": true }
    Returns ranked Hudu articles/procedures with AI commentary when use_ai=true.
    """
    config = await get_hudu_config()
    if not config:
        return {"configured": False, "message": "Hudu not configured", "articles": [], "procedures": []}

    ticket_id = (data or {}).get("ticket_id")
    title = (data or {}).get("title", "")
    description = (data or {}).get("description", "")

    # If a ticket_id is given but not title/desc, pull the ticket
    if ticket_id and not (title or description):
        ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
        if ticket:
            title = ticket.get("title") or title
            description = ticket.get("description") or description

    query = _keyword_query(title, description) or (title[:60] if title else "")
    if not query:
        return {"configured": True, "query": "", "articles": [], "procedures": [], "ai": None}

    async def safe(coro):
        try:
            return await coro
        except Exception:
            return None

    # Fan-out across articles + procedures with both 'search' and 'name' variants
    articles_data, procs_data = await asyncio.gather(
        safe(_hudu_get(config, "articles", params={"search": query, "name": query, "page_size": 10})),
        safe(_hudu_get(config, "procedures", params={"name": query, "page_size": 10})),
    )
    articles_raw = ((articles_data or {}).get("articles") or [])
    procedures_raw = ((procs_data or {}).get("procedures") or [])

    def slim(a):
        content = _strip_html(a.get("content") or "")
        return {
            "id": a.get("id"),
            "name": a.get("name") or a.get("title") or "Untitled",
            "company_name": a.get("company_name") or "",
            "url": a.get("url"),
            "snippet": content[:400],
            "updated_at": a.get("updated_at"),
        }

    articles = [slim(a) for a in articles_raw[:8]]
    procedures = [slim(p) for p in procedures_raw[:5]]

    ai_block = None
    use_ai = bool((data or {}).get("use_ai", True))
    if use_ai and (articles or procedures):
        api_key = os.environ.get("OPENAI_API_KEY")
        if api_key:
            try:
                from app.services.ai_provider import LlmChat, UserMessage
                catalog_lines = []
                for a in articles[:5]:
                    catalog_lines.append(f"[article#{a['id']}] {a['name']}\n{a['snippet'][:280]}")
                for p in procedures[:3]:
                    catalog_lines.append(f"[procedure#{p['id']}] {p['name']}\n{p['snippet'][:280]}")
                catalog = "\n\n".join(catalog_lines)
                prompt = (
                    f"TICKET TITLE: {title}\n"
                    f"TICKET DESCRIPTION: {(description or '')[:2000]}\n\n"
                    f"HUDU KB CANDIDATES:\n{catalog}\n\n"
                    "Pick the 1-3 most relevant items. For each, give: id, why it's relevant (Ã¢â€°Â¤1 sentence), "
                    "and a concrete suggested fix (Ã¢â€°Â¤3 bullet points) distilled from the content. "
                    "Respond as JSON: {\"picks\":[{\"id\":..., \"kind\":\"article|procedure\", \"why\":\"...\", \"fix\":[\"...\"]}]}"
                )
                chat = LlmChat(
                    api_key=api_key,
                    session_id=f"hudu-suggest-{uuid.uuid4().hex[:6]}",
                    system_message="You are an MSP senior engineer. Recommend the single best KB articles to solve the ticket, drawing fix steps directly from the candidate content.",
                ).with_model("anthropic", "claude-sonnet-4-5-20250929")
                resp = await chat.send_message(UserMessage(text=prompt))
                text = resp if isinstance(resp, str) else str(resp)
                m = re.search(r"\{[\s\S]*\}", text)
                parsed = None
                if m:
                    try:
                        import json as _json
                        parsed = _json.loads(m.group(0))
                    except Exception:
                        parsed = None
                ai_block = {"raw": text, "parsed": parsed}
            except Exception as e:
                ai_block = {"error": str(e)[:200]}

    # Audit every suggestion for billing/traceability
    await db.hudu_suggestions.insert_one({
        "ticket_id": ticket_id,
        "query": query,
        "article_count": len(articles),
        "procedure_count": len(procedures),
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "used_ai": bool(ai_block and ai_block.get("parsed")),
    })

    return {
        "configured": True,
        "query": query,
        "articles": articles,
        "procedures": procedures,
        "ai": ai_block,
    }


# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
# KB sync (kept for backwards compatibility, now uses correct search param)
# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.post("/hudu/sync")
async def sync_hudu_to_kb(data: dict = None, current_user: dict = Depends(get_current_user)):
    """Sync Hudu articles into local KB AND refresh the summary count cache."""
    config = await get_hudu_config()
    if not config:
        raise _not_configured()
    data = data or {}
    max_pages = int(data.get("max_pages", 10))
    imported = 0
    updated = 0

    for page in range(1, max_pages + 1):
        result = await _hudu_get(config, "articles", params={"page": page, "page_size": 50})
        items = ((result or {}).get("articles")) or []
        if not items:
            break
        for article in items:
            hudu_id = str(article.get("id", ""))
            existing = await db.kb_articles.find_one({"hudu_id": hudu_id}, {"_id": 0})
            if existing:
                await db.kb_articles.update_one(
                    {"hudu_id": hudu_id},
                    {"$set": {
                        "title": article.get("name", ""),
                        "content": article.get("content", ""),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                        "source": "hudu",
                    }},
                )
                updated += 1
            else:
                kb_article = {
                    "id": str(uuid.uuid4()),
                    "title": article.get("name", "Untitled"),
                    "content": article.get("content", ""),
                    "category": "general",
                    "tags": ["hudu", "imported"],
                    "is_public": False,
                    "author_id": current_user.get("id"),
                    "author_name": current_user.get("name"),
                    "views": 0,
                    "helpful_count": 0,
                    "hudu_id": hudu_id,
                    "source": "hudu",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                await db.kb_articles.insert_one(kb_article)
                imported += 1

    # Refresh summary count cache so the dashboard tiles update immediately after sync
    summary_payload = {"stats": {}, "computed_at": None}
    try:
        summary_payload = await _compute_hudu_summary(config)
    except Exception as e:
        # Non-fatal Ã¢â‚¬â€ sync still succeeded
        summary_payload = {"error": str(e)[:160]}

    return {
        "imported": imported,
        "updated": updated,
        "message": f"Synced {imported} new, {updated} updated",
        "summary": summary_payload.get("stats"),
    }
