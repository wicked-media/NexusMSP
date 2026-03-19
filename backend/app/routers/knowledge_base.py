from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid, os, json
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/kb/articles")
async def get_articles(current_user: dict = Depends(get_current_user)):
    articles = await db.kb_articles.find({}, {"_id": 0}).sort("usefulness_score", -1).to_list(200)
    return articles


@router.get("/kb/search")
async def search_kb(q: str = "", current_user: dict = Depends(get_current_user)):
    if not q:
        return []
    words = q.lower().split()
    articles = await db.kb_articles.find({}, {"_id": 0}).to_list(500)
    scored = []
    for a in articles:
        text = f"{a.get('title','')} {a.get('content','')} {' '.join(a.get('tags',[]))}".lower()
        score = sum(1 for w in words if w in text)
        if score > 0:
            scored.append({**a, "relevance_score": score})
    scored.sort(key=lambda x: x["relevance_score"], reverse=True)
    return scored[:10]


@router.get("/kb/articles/{article_id}")
async def get_article(article_id: str, current_user: dict = Depends(get_current_user)):
    article = await db.kb_articles.find_one({"id": article_id}, {"_id": 0})
    if not article:
        return {"error": "Article not found"}
    await db.kb_articles.update_one({"id": article_id}, {"$inc": {"views": 1}})
    return article


@router.post("/kb/articles")
async def create_article(data: dict, current_user: dict = Depends(get_current_user)):
    article_id = str(uuid.uuid4())[:8]
    doc = {
        "id": article_id, "title": data.get("title", ""), "content": data.get("content", ""),
        "category": data.get("category", "general"), "tags": data.get("tags", []),
        "source": "manual", "source_ticket_id": data.get("ticket_id"),
        "views": 0, "usefulness_score": 0, "helpful_votes": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", ""),
    }
    await db.kb_articles.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/kb/generate-from-ticket/{ticket_id}")
async def generate_from_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        return {"error": "Ticket not found"}
    notes = ticket.get("notes", [])
    notes_text = "\n".join([f"- {n.get('text', '')}" for n in notes]) if notes else "No notes"
    system = """You are an IT knowledge base writer. Given a resolved support ticket, create a concise KB article.
Return ONLY valid JSON: {"title": "clear title", "content": "## Problem\\n...\\n## Solution\\n...\\n## Prevention\\n...", "category": "hardware|software|network|security|cloud|other", "tags": ["tag1","tag2"]}"""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        chat = LlmChat(api_key=api_key, session_id=f"kb-{uuid.uuid4().hex[:6]}", system_message=system)
        chat.with_model("anthropic", "claude-sonnet-4-5-20250929")
        prompt = f"Ticket: {ticket.get('title','')}\nPriority: {ticket.get('priority','')}\nCategory: {ticket.get('category','')}\nDescription: {ticket.get('description','')}\nNotes:\n{notes_text}"
        resp = await chat.send_message(UserMessage(text=prompt))
        text = resp.strip() if isinstance(resp, str) else str(resp)
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
    except Exception:
        result = {"title": f"Solution: {ticket.get('title','')}", "content": f"## Problem\n{ticket.get('description','')}\n\n## Solution\nRefer to ticket notes.", "category": ticket.get("category","general"), "tags": []}
    article_id = str(uuid.uuid4())[:8]
    doc = {"id": article_id, **result, "source": "ai_generated", "source_ticket_id": ticket_id,
           "source_ticket_title": ticket.get("title",""), "views": 0, "usefulness_score": 0, "helpful_votes": 0,
           "created_at": datetime.now(timezone.utc).isoformat(), "created_by": current_user.get("name","")}
    await db.kb_articles.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/kb/articles/{article_id}/vote")
async def vote_article(article_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    helpful = data.get("helpful", True)
    await db.kb_articles.update_one({"id": article_id}, {"$inc": {"helpful_votes": 1, "usefulness_score": 1 if helpful else -1}})
    return {"message": "Vote recorded"}


@router.delete("/kb/articles/{article_id}")
async def delete_article(article_id: str, current_user: dict = Depends(get_current_user)):
    await db.kb_articles.delete_one({"id": article_id})
    return {"message": "Deleted"}
