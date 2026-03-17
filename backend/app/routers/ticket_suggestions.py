from fastapi import APIRouter, HTTPException, Depends
from typing import List
from datetime import datetime, timezone
import re
from app.database import db
from app.auth import get_current_user

router = APIRouter()

def extract_keywords(text: str) -> List[str]:
    """Extract meaningful keywords from text for matching"""
    if not text:
        return []
    stop_words = {"the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
                  "have", "has", "had", "do", "does", "did", "will", "would", "could",
                  "should", "may", "might", "can", "shall", "it", "its", "i", "me", "my",
                  "we", "our", "you", "your", "he", "she", "they", "them", "their", "this",
                  "that", "these", "those", "and", "or", "but", "not", "no", "nor", "for",
                  "with", "from", "to", "of", "in", "on", "at", "by", "as", "up", "out",
                  "off", "if", "so", "too", "very", "just", "also", "about", "into", "all",
                  "some", "any", "each", "every", "both", "few", "more", "other", "than",
                  "when", "where", "how", "what", "which", "who", "whom", "there", "here",
                  "please", "help", "need", "get", "got", "issue", "problem", "error",
                  "work", "working", "able", "unable", "user", "users", "client"}
    words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
    return list(set(w for w in words if w not in stop_words))[:20]

def score_match(keywords: List[str], text: str) -> int:
    """Score how well keywords match against text"""
    if not text or not keywords:
        return 0
    text_lower = text.lower()
    score = 0
    for kw in keywords:
        if kw in text_lower:
            score += 1
            # Bonus for exact word match
            if re.search(rf'\b{re.escape(kw)}\b', text_lower):
                score += 1
    return score


# ============== TICKET NUMBER SCHEME ==============

DEFAULT_SCHEME = {
    "incident": {"prefix": "INC", "description": "Incidents"},
    "service_request": {"prefix": "SR", "description": "Service Requests"},
    "problem": {"prefix": "PRB", "description": "Problems"},
    "change_request": {"prefix": "CHG", "description": "Change Requests"},
    "alert": {"prefix": "ALR", "description": "Alerts/Monitoring"},
    "task": {"prefix": "TSK", "description": "Tasks"},
    "default": {"prefix": "TKT", "description": "Default/Other"},
}

@router.get("/ticket-numbering")
async def get_ticket_numbering(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": "ticket_numbering"}, {"_id": 0})
    if not doc:
        return {"type": "ticket_numbering", "scheme": DEFAULT_SCHEME, "pad_digits": 4, "separator": "-"}
    return doc

@router.put("/ticket-numbering")
async def update_ticket_numbering(data: dict, current_user: dict = Depends(get_current_user)):
    scheme = data.get("scheme", DEFAULT_SCHEME)
    pad_digits = data.get("pad_digits", 4)
    separator = data.get("separator", "-")
    await db.settings.update_one({"type": "ticket_numbering"}, {"$set": {
        "type": "ticket_numbering",
        "scheme": scheme,
        "pad_digits": pad_digits,
        "separator": separator,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    return {"message": "Ticket numbering scheme updated"}

async def generate_ticket_number(ticket_type: str) -> str:
    """Generate a ticket number based on the configured scheme"""
    doc = await db.settings.find_one({"type": "ticket_numbering"}, {"_id": 0})
    scheme = (doc or {}).get("scheme", DEFAULT_SCHEME)
    pad_digits = (doc or {}).get("pad_digits", 4)
    separator = (doc or {}).get("separator", "-")
    
    type_config = scheme.get(ticket_type, scheme.get("default", {"prefix": "TKT"}))
    prefix = type_config.get("prefix", "TKT")
    
    # Count tickets of this type for sequential numbering
    count = await db.ticket_counters.find_one_and_update(
        {"prefix": prefix},
        {"$inc": {"count": 1}},
        upsert=True,
        return_document=True,
        projection={"_id": 0}
    )
    num = count.get("count", 1) if count else 1
    return f"{prefix}{separator}{str(num).zfill(pad_digits)}"


# ============== SMART SUGGESTIONS ==============

@router.get("/tickets/{ticket_id}/suggestions")
async def get_ticket_suggestions(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Get AI-powered fix suggestions based on similar resolved tickets and KB articles"""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    search_text = f"{ticket.get('title', '')} {ticket.get('description', '')} {ticket.get('category', '')}"
    keywords = extract_keywords(search_text)
    
    if not keywords:
        return {"similar_tickets": [], "kb_articles": [], "keywords": []}
    
    # Search resolved/closed tickets
    resolved_tickets = await db.tickets.find(
        {"status": {"$in": ["resolved", "closed"]}, "id": {"$ne": ticket_id}},
        {"_id": 0, "id": 1, "title": 1, "description": 1, "ticket_number": 1, 
         "category": 1, "resolution_notes": 1, "status": 1, "tags": 1,
         "total_time_minutes": 1, "assigned_name": 1, "priority": 1}
    ).to_list(500)
    
    scored_tickets = []
    for rt in resolved_tickets:
        match_text = f"{rt.get('title', '')} {rt.get('description', '')} {rt.get('category', '')} {' '.join(rt.get('tags', []))}"
        score = score_match(keywords, match_text)
        if score >= 2:
            # Get resolution comments for this ticket
            comments = await db.ticket_comments.find(
                {"ticket_id": rt["id"]},
                {"_id": 0, "content": 1, "is_internal": 1, "user_name": 1}
            ).sort("created_at", -1).to_list(5)
            
            resolution_summary = rt.get("resolution_notes", "")
            if not resolution_summary and comments:
                resolution_summary = comments[0].get("content", "")[:500]
            
            scored_tickets.append({
                "ticket_id": rt["id"],
                "ticket_number": rt.get("ticket_number", ""),
                "title": rt.get("title", ""),
                "category": rt.get("category", ""),
                "priority": rt.get("priority", ""),
                "assigned_name": rt.get("assigned_name", ""),
                "resolution_notes": resolution_summary,
                "resolution_comments": [{"content": c.get("content", "")[:300], "user_name": c.get("user_name", "")} for c in comments[:3]],
                "time_spent": rt.get("total_time_minutes", 0),
                "relevance_score": score,
            })
    
    scored_tickets.sort(key=lambda x: -x["relevance_score"])
    
    # Search KB articles
    kb_articles = await db.kb_articles.find(
        {}, {"_id": 0, "id": 1, "title": 1, "content": 1, "category": 1, 
             "tags": 1, "views": 1, "helpful_count": 1, "author_name": 1}
    ).to_list(500)
    
    scored_articles = []
    for article in kb_articles:
        match_text = f"{article.get('title', '')} {article.get('content', '')} {' '.join(article.get('tags', []))}"
        score = score_match(keywords, match_text)
        if score >= 2:
            scored_articles.append({
                "article_id": article["id"],
                "title": article.get("title", ""),
                "category": article.get("category", ""),
                "content_preview": (article.get("content", "") or "")[:400],
                "tags": article.get("tags", []),
                "views": article.get("views", 0),
                "helpful_count": article.get("helpful_count", 0),
                "author_name": article.get("author_name", ""),
                "relevance_score": score,
            })
    
    scored_articles.sort(key=lambda x: (-x["relevance_score"], -x.get("helpful_count", 0)))
    
    return {
        "similar_tickets": scored_tickets[:8],
        "kb_articles": scored_articles[:8],
        "keywords": keywords[:10],
    }

@router.get("/ticket-search/suggestions")
async def global_search_suggestions(q: str = "", current_user: dict = Depends(get_current_user)):
    """Quick search across tickets and KB for resolution hints"""
    if not q or len(q) < 3:
        return {"tickets": [], "articles": []}
    
    keywords = extract_keywords(q)
    if not keywords:
        return {"tickets": [], "articles": []}
    
    regex_parts = [{"title": {"$regex": kw, "$options": "i"}} for kw in keywords[:5]]
    
    tickets = await db.tickets.find(
        {"$or": regex_parts, "status": {"$in": ["resolved", "closed"]}},
        {"_id": 0, "id": 1, "title": 1, "ticket_number": 1, "category": 1, "resolution_notes": 1}
    ).limit(5).to_list(5)
    
    articles = await db.kb_articles.find(
        {"$or": [{"title": {"$regex": kw, "$options": "i"}} for kw in keywords[:5]]},
        {"_id": 0, "id": 1, "title": 1, "category": 1}
    ).limit(5).to_list(5)
    
    return {"tickets": tickets, "articles": articles}
