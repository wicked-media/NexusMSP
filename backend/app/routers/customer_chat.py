"""Approved customer-to-technician direct chat connections.

Portal routes use the portal token dependency; technician decision routes use
the regular Nexus account dependency.  They deliberately meet only through a
private, client-bound ``chat_channels`` record after a technician accepts.
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import get_current_user
from app.routers.portal_v2 import get_portal_user
from app.services import customer_chat


router = APIRouter(tags=["Customer chat connections"])


@router.get("/portal/v2/chat-connections/technicians")
async def portal_technicians(portal_user: dict = Depends(get_portal_user)):
    return await customer_chat.list_portal_technicians(portal_user)


@router.get("/portal/v2/chat-connections/favourites")
async def portal_favourites(portal_user: dict = Depends(get_portal_user)):
    return await customer_chat.list_portal_technicians(portal_user, favourites_only=True)


@router.put("/portal/v2/chat-connections/technicians/{technician_id}/favourite")
async def portal_set_favourite(
    technician_id: str,
    payload: dict = Body(...),
    portal_user: dict = Depends(get_portal_user),
):
    favourite = payload.get("favourite")
    if not isinstance(favourite, bool):
        raise HTTPException(status_code=422, detail="favourite must be true or false")
    return await customer_chat.set_portal_favourite(
        portal_user,
        technician_id,
        favourite=favourite,
    )


@router.get("/portal/v2/chat-connections/requests")
async def portal_requests(portal_user: dict = Depends(get_portal_user)):
    return await customer_chat.list_portal_requests(portal_user)


@router.post("/portal/v2/chat-connections/requests")
async def portal_create_request(payload: dict = Body(...), portal_user: dict = Depends(get_portal_user)):
    return await customer_chat.create_portal_request(portal_user, payload)


@router.get("/portal/v2/chat-connections/conversations")
async def portal_conversations(portal_user: dict = Depends(get_portal_user)):
    return await customer_chat.list_portal_conversations(portal_user)


@router.get("/portal/v2/chat-connections/conversations/{channel_id}/messages")
async def portal_conversation_messages(channel_id: str, portal_user: dict = Depends(get_portal_user)):
    return await customer_chat.list_portal_messages(portal_user, channel_id)


@router.post("/portal/v2/chat-connections/conversations/{channel_id}/messages")
async def portal_send_message(
    channel_id: str,
    payload: dict = Body(...),
    portal_user: dict = Depends(get_portal_user),
):
    return await customer_chat.send_portal_message(portal_user, channel_id, payload)


@router.get("/chat-connections/requests")
async def technician_requests(current_user: dict = Depends(get_current_user)):
    return await customer_chat.list_technician_requests(current_user)


@router.post("/chat-connections/requests/{request_id}/decision")
async def technician_decide_request(
    request_id: str,
    payload: dict = Body(...),
    current_user: dict = Depends(get_current_user),
):
    return await customer_chat.decide_technician_request(current_user, request_id, payload)
