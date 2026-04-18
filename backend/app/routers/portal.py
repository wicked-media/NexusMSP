# Legacy portal router - all endpoints moved to portal_v2.py and client_portal.py
# Keeping router stub to prevent import errors from auto-discovery
from fastapi import APIRouter, Depends
from app.auth import get_current_user

router = APIRouter()


@router.get("/portal/users")
async def get_portal_users_legacy(client_id: str = None, current_user: dict = Depends(get_current_user)):
    """Deprecated - use /client-portal/users/{client_id} instead."""
    from app.database import db
    query = {"client_id": client_id} if client_id else {}
    users = await db.portal_users.find(query, {"_id": 0, "password_hash": 0}).to_list(1000)
    return users
