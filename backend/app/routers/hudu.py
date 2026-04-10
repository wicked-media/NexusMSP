import os
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import httpx
from app.database import db
from app.auth import get_current_user

router = APIRouter()

async def get_hudu_config():
    config = await db.settings.find_one({"type": "hudu"}, {"_id": 0})
    if not config or not config.get("url") or not config.get("api_key_full"):
        return None
    return config

async def hudu_get(config, path, params=None):
    url = config["url"].rstrip("/")
    api_url = f"{url}/api/v1/{path}"
    headers = {"x-api-key": config["api_key_full"], "Content-Type": "application/json", "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=30, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()=='true') as client:
        resp = await client.get(api_url, headers=headers, params=params)
        if resp.status_code == 200:
            return resp.json()
        elif resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Hudu API authentication failed")
        elif resp.status_code == 403:
            raise HTTPException(status_code=403, detail="Hudu API access denied")
        return None

# ============== SETTINGS ==============

@router.get("/settings/hudu")
async def get_hudu_settings(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": "hudu"}, {"_id": 0})
    if not doc:
        return {"type": "hudu", "url": "", "api_key": "", "configured": False}
    doc.pop("api_key_full", None)
    return doc

@router.put("/settings/hudu")
async def update_hudu_settings(data: dict, current_user: dict = Depends(get_current_user)):
    url = data.get("url", "").rstrip("/")
    api_key = data.get("api_key", "")
    masked = f"{'*' * max(0, len(api_key) - 6)}{api_key[-6:]}" if len(api_key) > 6 else "***"
    await db.settings.update_one({"type": "hudu"}, {"$set": {
        "type": "hudu",
        "url": url,
        "api_key_full": api_key,
        "api_key": masked,
        "configured": bool(url and api_key),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    return {"message": "Hudu settings saved", "configured": bool(url and api_key)}

@router.post("/settings/hudu/test")
async def test_hudu_connection(current_user: dict = Depends(get_current_user)):
    config = await get_hudu_config()
    if not config:
        raise HTTPException(status_code=400, detail="Hudu not configured")
    try:
        result = await hudu_get(config, "articles", params={"page_size": 1})
        if result is not None:
            return {"success": True, "message": "Connected to Hudu successfully"}
        return {"success": False, "message": "Failed to connect"}
    except HTTPException as e:
        return {"success": False, "message": e.detail}
    except Exception as e:
        return {"success": False, "message": f"Connection error: {str(e)[:100]}"}

# ============== ARTICLES ==============

@router.get("/hudu/articles")
async def get_hudu_articles(page: int = 1, search: str = "", current_user: dict = Depends(get_current_user)):
    config = await get_hudu_config()
    if not config:
        return {"articles": [], "error": "Hudu not configured. Add your Hudu API key in Settings."}
    try:
        params = {"page": page, "page_size": 25}
        if search:
            params["name"] = search
        result = await hudu_get(config, "articles", params=params)
        if result and "articles" in result:
            articles = []
            for a in result["articles"]:
                articles.append({
                    "id": a.get("id"),
                    "name": a.get("name", ""),
                    "slug": a.get("slug", ""),
                    "content": a.get("content", ""),
                    "folder_id": a.get("folder_id"),
                    "company_id": a.get("company_id"),
                    "company_name": a.get("company_name", ""),
                    "updated_at": a.get("updated_at", ""),
                    "created_at": a.get("created_at", ""),
                })
            return {"articles": articles, "error": None}
        return {"articles": [], "error": None}
    except HTTPException as e:
        return {"articles": [], "error": e.detail}
    except Exception as e:
        return {"articles": [], "error": str(e)[:100]}

@router.get("/hudu/articles/{article_id}")
async def get_hudu_article(article_id: int, current_user: dict = Depends(get_current_user)):
    config = await get_hudu_config()
    if not config:
        raise HTTPException(status_code=400, detail="Hudu not configured")
    try:
        result = await hudu_get(config, f"articles/{article_id}")
        if result and "article" in result:
            return result["article"]
        raise HTTPException(status_code=404, detail="Article not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:100])

@router.post("/hudu/sync")
async def sync_hudu_to_kb(data: dict = {}, current_user: dict = Depends(get_current_user)):
    """Sync Hudu articles into the local Knowledge Base"""
    config = await get_hudu_config()
    if not config:
        raise HTTPException(status_code=400, detail="Hudu not configured")
    
    imported = 0
    skipped = 0
    page = 1
    max_pages = data.get("max_pages", 5)
    
    while page <= max_pages:
        try:
            result = await hudu_get(config, "articles", params={"page": page, "page_size": 25})
            if not result or "articles" not in result or not result["articles"]:
                break
            for article in result["articles"]:
                hudu_id = str(article.get("id", ""))
                existing = await db.kb_articles.find_one({"hudu_id": hudu_id}, {"_id": 0})
                if existing:
                    await db.kb_articles.update_one({"hudu_id": hudu_id}, {"$set": {
                        "title": article.get("name", ""),
                        "content": article.get("content", ""),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                        "source": "hudu",
                    }})
                    skipped += 1
                else:
                    import uuid
                    kb_article = {
                        "id": str(uuid.uuid4()),
                        "title": article.get("name", "Untitled"),
                        "content": article.get("content", ""),
                        "category": "general",
                        "tags": ["hudu", "imported"],
                        "is_public": False,
                        "author_id": current_user["id"],
                        "author_name": current_user["name"],
                        "views": 0,
                        "helpful_count": 0,
                        "hudu_id": hudu_id,
                        "source": "hudu",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                    await db.kb_articles.insert_one(kb_article)
                    imported += 1
            page += 1
        except Exception:
            break
    
    return {"imported": imported, "updated": skipped, "message": f"Synced {imported} new, {skipped} updated articles from Hudu"}

# ============== KB PROCEDURES (Hudu Knowledge Base for Fixes) ==============

@router.get("/hudu/procedures/search")
async def search_hudu_procedures(q: str = "", current_user: dict = Depends(get_current_user)):
    """Search Hudu for procedures/fix guides matching a query"""
    config = await get_hudu_config()
    if not config:
        return {"results": [], "error": "Hudu not configured"}
    try:
        params = {"page_size": 10}
        if q:
            params["name"] = q
        result = await hudu_get(config, "articles", params=params)
        if result and "articles" in result:
            return {"results": [{"id": a.get("id"), "name": a.get("name", ""), "content_preview": (a.get("content", "") or "")[:300], "company_name": a.get("company_name", "")} for a in result["articles"][:10]], "error": None}
        return {"results": [], "error": None}
    except Exception as e:
        return {"results": [], "error": str(e)[:100]}
