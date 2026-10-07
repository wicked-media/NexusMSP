from fastapi import APIRouter, HTTPException, Depends
import uuid
from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity
from app.services.scope_permissions import assert_client_scope, platform_tenant_id, tenant_scoped_query
from app.services.action_permissions import require_action
from app.services.client_contacts import (
    MAX_CONTACTS_PER_CLIENT,
    contact_delete_pipeline,
    contact_map_pipeline,
    editable_contact,
    now_iso,
)

router = APIRouter()


async def _client_or_404(client_id: str, current_user: dict, projection: dict | None = None) -> dict:
    client = await db.clients.find_one(
        tenant_scoped_query(current_user, {"id": client_id}),
        projection or {"_id": 0},
    )
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    await assert_client_scope(
        current_user,
        client.get("id"),
        operation="client.contact.access",
        mask_not_found=True,
    )
    return client

# ============== CLIENT CONTACTS ==============

@router.get("/clients/{client_id}/contacts")
async def get_client_contacts(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await _client_or_404(client_id, current_user)
    return client.get("contacts", [])

@router.post("/clients/{client_id}/contacts")
async def add_client_contact(
    client_id: str,
    contact_data: dict,
    current_user: dict = Depends(get_current_user),
    _permission: None = Depends(require_action("client.contact.manage")),
):
    client = await _client_or_404(client_id, current_user, {"_id": 0, "id": 1, "contacts": 1})
    contacts = client.get("contacts", [])
    if len(contacts) >= MAX_CONTACTS_PER_CLIENT:
        raise HTTPException(status_code=422, detail="This client has reached the contact limit")
    editable = editable_contact(contact_data)
    # A first contact is operationally the primary contact until a technician changes it.
    editable["is_primary"] = editable["is_primary"] or not contacts
    contact = {
        "id": str(uuid.uuid4()),
        **editable,
        "created_at": now_iso(),
    }
    existing = {"$map": {"input": {"$ifNull": ["$contacts", []]}, "as": "existing", "in": {
        "$mergeObjects": ["$$existing", {"is_primary": False}],
    }}} if contact["is_primary"] else {"$ifNull": ["$contacts", []]}
    result = await db.clients.update_one(
        tenant_scoped_query(current_user, {
            "id": client_id,
            "$expr": {"$lt": [{"$size": {"$ifNull": ["$contacts", []]}}, MAX_CONTACTS_PER_CLIENT]},
        }),
        [{"$set": {"contacts": {"$concatArrays": [existing, {"$literal": [contact]}]}}}],
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Contact list changed. Refresh the client record and try again")
    await log_activity(
        current_user, "client_contact_added", "client", client_id,
        details="Client contact added",
        changes={"contact_id": contact["id"], "role": contact["role"], "is_primary": contact["is_primary"]},
        metadata={"tenant_id": platform_tenant_id(current_user), "contact_id": contact["id"]},
    )
    return contact

@router.put("/clients/{client_id}/contacts/{contact_id}")
async def update_client_contact(
    client_id: str,
    contact_id: str,
    contact_data: dict,
    current_user: dict = Depends(get_current_user),
    _permission: None = Depends(require_action("client.contact.manage")),
):
    client = await _client_or_404(client_id, current_user)
    contacts = client.get("contacts", [])
    existing = next((contact for contact in contacts if contact.get("id") == contact_id), None)
    if not existing:
        raise HTTPException(status_code=404, detail="Contact not found")
    updated = {**existing, **editable_contact(contact_data, existing), "updated_at": now_iso()}
    result = await db.clients.update_one(
        tenant_scoped_query(current_user, {"id": client_id, "contacts.id": contact_id}),
        contact_map_pipeline(contact_id, updated),
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Contact changed or was removed. Refresh the client record and try again")
    await log_activity(
        current_user, "client_contact_updated", "client", client_id,
        details="Client contact updated",
        changes={"contact_id": contact_id, "role": updated["role"], "is_primary": updated["is_primary"]},
        metadata={"tenant_id": platform_tenant_id(current_user), "contact_id": contact_id},
    )
    return {"message": "Contact updated"}

@router.delete("/clients/{client_id}/contacts/{contact_id}")
async def delete_client_contact(
    client_id: str,
    contact_id: str,
    current_user: dict = Depends(get_current_user),
    _permission: None = Depends(require_action("client.contact.manage")),
):
    client = await _client_or_404(client_id, current_user, {"_id": 0, "id": 1, "contacts": 1})
    contacts = client.get("contacts", [])
    removed = next((contact for contact in contacts if contact.get("id") == contact_id), None)
    if not removed:
        raise HTTPException(status_code=404, detail="Contact not found")
    promoted = next((contact for contact in contacts if contact.get("id") != contact_id), None) if removed.get("is_primary") else None
    result = await db.clients.update_one(
        tenant_scoped_query(current_user, {"id": client_id, "contacts.id": contact_id}),
        contact_delete_pipeline(contact_id, promoted.get("id") if promoted else None),
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Contact changed or was removed. Refresh the client record and try again")
    await log_activity(
        current_user, "client_contact_removed", "client", client_id,
        details="Client contact removed",
        changes={"contact_id": contact_id, "promoted_contact_id": promoted.get("id") if promoted else None},
        metadata={"tenant_id": platform_tenant_id(current_user), "contact_id": contact_id},
    )
    return {"message": "Contact deleted"}

@router.get("/clients/{client_id}/detail")
async def get_client_detail(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await _client_or_404(client_id, current_user)
    tickets = await db.tickets.find(tenant_scoped_query(current_user, {"client_id": client_id}), {"_id": 0}).to_list(500)
    devices = await db.devices.find(tenant_scoped_query(current_user, {"client_id": client_id}), {"_id": 0}).to_list(500)
    contracts = await db.contracts.find(tenant_scoped_query(current_user, {"client_id": client_id}), {"_id": 0}).to_list(100)
    return {"client": client, "tickets": tickets, "devices": devices, "contracts": contracts}


