from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== KNOWLEDGE BASE ENDPOINTS ==============

@router.get("/kb-articles", response_model=List[KBArticle])
async def get_kb_articles(
    category: Optional[str] = None,
    is_public: Optional[bool] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if category:
        query["category"] = category
    if is_public is not None:
        query["is_public"] = is_public
    
    articles = await db.kb_articles.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    
    if search:
        search_lower = search.lower()
        articles = [a for a in articles if search_lower in a['title'].lower() or search_lower in a['content'].lower()]
    
    for a in articles:
        if isinstance(a.get('created_at'), str):
            a['created_at'] = datetime.fromisoformat(a['created_at'])
        if isinstance(a.get('updated_at'), str):
            a['updated_at'] = datetime.fromisoformat(a['updated_at'])
    return articles

@router.get("/kb-articles/{article_id}")
async def get_kb_article(article_id: str, current_user: dict = Depends(get_current_user)):
    article = await db.kb_articles.find_one({"id": article_id}, {"_id": 0})
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    
    # Increment view count
    await db.kb_articles.update_one({"id": article_id}, {"$inc": {"views": 1}})
    article['views'] = article.get('views', 0) + 1
    return article

@router.post("/kb-articles", response_model=KBArticle)
async def create_kb_article(article_data: KBArticleCreate, current_user: dict = Depends(get_current_user)):
    article = KBArticle(
        **article_data.model_dump(),
        author_id=current_user['id'],
        author_name=current_user['name']
    )
    doc = article.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.kb_articles.insert_one(doc)
    return article

@router.put("/kb-articles/{article_id}")
async def update_kb_article(article_id: str, article_data: dict, current_user: dict = Depends(get_current_user)):
    article_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    result = await db.kb_articles.update_one({"id": article_id}, {"$set": article_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Article not found")
    return {"message": "Article updated"}

@router.delete("/kb-articles/{article_id}")
async def delete_kb_article(article_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.kb_articles.delete_one({"id": article_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Article not found")
    return {"message": "Article deleted"}

@router.post("/kb-articles/{article_id}/helpful")
async def mark_article_helpful(article_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.kb_articles.update_one({"id": article_id}, {"$inc": {"helpful_count": 1}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Article not found")
    return {"message": "Marked as helpful"}

