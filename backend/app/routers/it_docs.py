from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, Dict, Any
from datetime import datetime, timezone
import re
import uuid
from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity
from app.services.scope_permissions import (
    assert_global_scope,
    assert_record_scope,
    assert_tenant_record_scope,
    effective_scope,
    scoped_query,
    tenant_scoped_query,
)
from app.models import *

router = APIRouter()


# Documentation can be either client-owned operational knowledge or deliberately
# shared MSP knowledge.  A missing/blank client ID was historically how the UI
# represented the latter, so preserve that read compatibility while making all
# writes prove a scope explicitly.
_GLOBAL_DOCUMENT_CLAUSES = (
    {"client_id": None},
    {"client_id": ""},
    {"client_id": {"$exists": False}},
)
_DOCUMENTATION_MUTABLE_FIELDS = frozenset({
    "title", "content", "category", "parent_id", "is_template", "tags",
})


def _normalise_documentation_client_id(value: Any) -> Optional[str]:
    candidate = str(value or "").strip()
    return candidate or None


def _documentation_identity_query(document: dict) -> dict:
    """Pin a mutation to the ownership record that was just authorised."""
    client_id = _normalise_documentation_client_id(document.get("client_id"))
    if client_id:
        return {"id": document["id"], "client_id": client_id}
    return {"id": document["id"], "$or": list(_GLOBAL_DOCUMENT_CLAUSES)}


def _documentation_list_query(current_user: dict, query: dict) -> dict:
    """Keep shared procedures readable without exposing another client's docs."""
    scope = effective_scope(current_user)
    if scope["mode"] == "all":
        return query
    return {
        "$and": [
            query,
            {
                "$or": [
                    {"client_id": {"$in": scope["client_ids"]}},
                    *list(_GLOBAL_DOCUMENT_CLAUSES),
                ]
            },
        ]
    }


async def _documentation_in_scope(doc_id: str, current_user: dict, operation: str) -> dict:
    """Load a visible documentation record before reading or mutating it."""
    document = await db.documentation.find_one({"id": doc_id}, {"_id": 0})
    if not document:
        raise HTTPException(status_code=404, detail="Resource not found")
    if _normalise_documentation_client_id(document.get("client_id")):
        return await assert_record_scope(
            current_user,
            db.documentation,
            doc_id,
            operation=operation,
            resource_name="Documentation",
        )
    return document


async def _documentation_target_scope(current_user: dict, client_id: Any, operation: str) -> tuple[Optional[str], Optional[str]]:
    """Resolve a client target from canonical data, or require global authority."""
    normalised_client_id = _normalise_documentation_client_id(client_id)
    if not normalised_client_id:
        await assert_global_scope(current_user, operation=operation)
        return None, None
    client = await assert_record_scope(
        current_user,
        db.clients,
        normalised_client_id,
        client_field="id",
        operation=operation,
        resource_name="Client",
    )
    return normalised_client_id, client.get("name")


async def _validate_documentation_parent(
    parent_id: Any,
    client_id: Optional[str],
    current_user: dict,
    operation: str,
) -> Optional[str]:
    """Retain only a parent that is visible and cannot bridge two clients."""
    normalised_parent_id = str(parent_id or "").strip() or None
    if not normalised_parent_id:
        return None
    parent = await _documentation_in_scope(normalised_parent_id, current_user, operation)
    parent_client_id = _normalise_documentation_client_id(parent.get("client_id"))
    if parent_client_id and parent_client_id != client_id:
        raise HTTPException(status_code=422, detail="Parent documentation must belong to the same client scope")
    return normalised_parent_id


async def _write_documentation_activity(current_user: dict, action: str, document: dict) -> None:
    await log_activity(
        current_user,
        action,
        "documentation",
        document["id"],
        document.get("title") or "Documentation",
        "Documentation record changed through the governed client scope.",
        metadata={
            "client_id": _normalise_documentation_client_id(document.get("client_id")),
            "is_global": not bool(_normalise_documentation_client_id(document.get("client_id"))),
            "is_template": bool(document.get("is_template", False)),
        },
    )

# ============== IT DOCUMENTATION ENDPOINTS ==============

# Retired: password storage is handled by Keeper/Hudu, not NexusMSP.
# @router.get("/passwords")
async def get_passwords(client_id: Optional[str] = None, category: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if category:
        query["category"] = category
    
    passwords = await db.passwords.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    # Mask passwords in list view
    for p in passwords:
        p['password'] = '••••••••'
    return passwords

# @router.get("/passwords/{password_id}")
async def get_password(password_id: str, current_user: dict = Depends(get_current_user)):
    """Get a password entry (reveals actual password)"""
    password = await db.passwords.find_one({"id": password_id}, {"_id": 0})
    if not password:
        raise HTTPException(status_code=404, detail="Password not found")
    
    # Update access tracking
    await db.passwords.update_one(
        {"id": password_id},
        {"$set": {"last_accessed": datetime.now(timezone.utc).isoformat()}, "$inc": {"access_count": 1}}
    )
    
    # Log access for audit
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user['id'],
        "user_name": current_user['name'],
        "user_email": current_user['email'],
        "action": "view",
        "entity_type": "password",
        "entity_id": password_id,
        "entity_name": password.get('name'),
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return password

# @router.post("/passwords")
async def create_password(password_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if password_data.get('client_id'):
        client = await db.clients.find_one({"id": password_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    password = PasswordEntry(
        client_id=password_data.get('client_id'),
        client_name=client_name,
        name=password_data.get('name'),
        category=password_data.get('category', 'general'),
        username=password_data.get('username'),
        password=password_data.get('password'),
        url=password_data.get('url'),
        notes=password_data.get('notes'),
        tags=password_data.get('tags', []),
        created_by=current_user['id']
    )
    doc = password.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.passwords.insert_one(doc)
    return {"id": password.id, "name": password.name, "message": "Password created"}

# @router.put("/passwords/{password_id}")
async def update_password(password_id: str, password_data: dict, current_user: dict = Depends(get_current_user)):
    password_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    result = await db.passwords.update_one({"id": password_id}, {"$set": password_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Password not found")
    return {"message": "Password updated"}

# @router.delete("/passwords/{password_id}")
async def delete_password(password_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.passwords.delete_one({"id": password_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Password not found")
    return {"message": "Password deleted"}

# ============== DOCUMENTATION PAGES ENDPOINTS ==============

@router.get("/documentation")
async def get_documentation_pages(
    client_id: Optional[str] = None,
    category: Optional[str] = None,
    is_template: bool = False,
    current_user: dict = Depends(get_current_user)
):
    query = {"is_template": is_template}
    requested_client_id = _normalise_documentation_client_id(client_id)
    if requested_client_id:
        # A client-filtered list is still an object-scope operation. Resolve the
        # canonical client instead of trusting the query parameter.
        await assert_record_scope(
            current_user,
            db.clients,
            requested_client_id,
            client_field="id",
            operation="documentation.list.client",
            resource_name="Client",
        )
        query["client_id"] = requested_client_id
    if category:
        query["category"] = category

    pages = await db.documentation.find(
        _documentation_list_query(current_user, query),
        {"_id": 0},
    ).sort("title", 1).to_list(1000)
    return pages

@router.get("/documentation/{doc_id}")
async def get_documentation_page(doc_id: str, current_user: dict = Depends(get_current_user)):
    doc = await _documentation_in_scope(doc_id, current_user, "documentation.read")
    await db.documentation.update_one(_documentation_identity_query(doc), {"$inc": {"view_count": 1}})
    return doc

@router.post("/documentation")
async def create_documentation_page(doc_data: dict, current_user: dict = Depends(get_current_user)):
    client_id, client_name = await _documentation_target_scope(
        current_user,
        doc_data.get("client_id"),
        "documentation.create",
    )
    parent_id = await _validate_documentation_parent(
        doc_data.get("parent_id"),
        client_id,
        current_user,
        "documentation.parent.create",
    )
    doc = DocumentationPage(
        client_id=client_id,
        client_name=client_name,
        title=doc_data.get('title'),
        content=doc_data.get('content', ''),
        category=doc_data.get('category', 'general'),
        parent_id=parent_id,
        is_template=doc_data.get('is_template', False),
        tags=doc_data.get('tags', []),
        last_edited_by=current_user['id'],
        last_edited_by_name=current_user['name']
    )
    doc_dict = doc.model_dump()
    doc_dict['created_at'] = doc_dict['created_at'].isoformat()
    doc_dict['updated_at'] = doc_dict['updated_at'].isoformat()
    await db.documentation.insert_one(doc_dict)
    await _write_documentation_activity(current_user, "documentation_created", doc_dict)
    return doc

@router.put("/documentation/{doc_id}")
async def update_documentation_page(doc_id: str, doc_data: dict, current_user: dict = Depends(get_current_user)):
    existing = await _documentation_in_scope(doc_id, current_user, "documentation.update")
    existing_client_id = _normalise_documentation_client_id(existing.get("client_id"))
    if not existing_client_id:
        # Shared docs are intentionally readable by technicians, but only a
        # global operator may change or re-home shared MSP knowledge.
        await assert_global_scope(current_user, operation="documentation.update.global")
    target_client_id = existing_client_id
    target_client_name = existing.get("client_name")
    if "client_id" in doc_data:
        target_client_id, target_client_name = await _documentation_target_scope(
            current_user,
            doc_data.get("client_id"),
            "documentation.move",
        )

    update = {
        key: value
        for key, value in doc_data.items()
        if key in _DOCUMENTATION_MUTABLE_FIELDS
    }
    parent_to_validate = update.get("parent_id", existing.get("parent_id"))
    if "parent_id" in update or target_client_id != existing_client_id:
        update["parent_id"] = await _validate_documentation_parent(
            parent_to_validate,
            target_client_id,
            current_user,
            "documentation.parent.update",
        )
    if "client_id" in doc_data:
        update["client_id"] = target_client_id
        update["client_name"] = target_client_name
    update['updated_at'] = datetime.now(timezone.utc).isoformat()
    update['last_edited_by'] = current_user['id']
    update['last_edited_by_name'] = current_user['name']
    result = await db.documentation.update_one(_documentation_identity_query(existing), {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Resource not found")
    await _write_documentation_activity(
        current_user,
        "documentation_updated",
        {**existing, **update},
    )
    return {"message": "Documentation updated"}

@router.delete("/documentation/{doc_id}")
async def delete_documentation_page(doc_id: str, current_user: dict = Depends(get_current_user)):
    document = await _documentation_in_scope(doc_id, current_user, "documentation.delete")
    if not _normalise_documentation_client_id(document.get("client_id")):
        await assert_global_scope(current_user, operation="documentation.delete.global")
    result = await db.documentation.delete_one(_documentation_identity_query(document))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Resource not found")
    await _write_documentation_activity(current_user, "documentation_deleted", document)
    return {"message": "Documentation deleted"}

# ============== RUNBOOK ENDPOINTS ==============

# ``runbooks`` historically mixed unrelated automation definitions, generated
# knowledge procedures and generic documents. The only public compatibility
# read is now the ticket-derived knowledge library; automation execution has a
# single owner in ``workflow_automation``. New knowledge records carry a
# stable client_id. Older records without that binding stay available only to a
# global operator, which is safer than silently exposing them to every
# restricted technician.
_LEGACY_RUNBOOK_DETAIL = (
    "Legacy runbook execution is retired. Use the governed Workflow Automation "
    "workspace and /api/workflows instead."
)


def _retire_legacy_runbook_execution() -> None:
    raise HTTPException(status_code=410, detail=_LEGACY_RUNBOOK_DETAIL)


async def _knowledge_runbook_in_scope(runbook_id: str, current_user: dict, operation: str) -> dict:
    candidate = await db.runbooks.find_one(
        tenant_scoped_query(current_user, {"id": runbook_id, "source_ticket_id": {"$exists": True}}),
        {"_id": 0},
    )
    if not candidate:
        raise HTTPException(status_code=404, detail="Resource not found")
    return await assert_tenant_record_scope(
        current_user,
        db.runbooks,
        runbook_id,
        operation=operation,
        resource_name="Knowledge runbook",
    )


@router.get("/runbooks")
async def get_runbooks(
    category: Optional[str] = None,
    q: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """List published, ticket-derived knowledge runbooks inside caller scope."""
    query: dict[str, Any] = {"published": True, "source_ticket_id": {"$exists": True}}
    if category:
        query["category"] = category
    search = str(q or "").strip()
    if search:
        # Search is an operator convenience, never a raw Mongo expression.
        pattern = re.escape(search[:80])
        query["$or"] = [
            {"title": {"$regex": pattern, "$options": "i"}},
            {"tags": {"$regex": pattern, "$options": "i"}},
            {"category": {"$regex": pattern, "$options": "i"}},
        ]
    return await db.runbooks.find(
        scoped_query(current_user, tenant_scoped_query(current_user, query), site_field=None),
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)


@router.get("/runbooks/{runbook_id}")
async def get_runbook(runbook_id: str, current_user: dict = Depends(get_current_user)):
    return await _knowledge_runbook_in_scope(runbook_id, current_user, "knowledge_runbook.read")


@router.post("/runbooks")
async def create_runbook(runbook_data: dict, current_user: dict = Depends(get_current_user)):
    _retire_legacy_runbook_execution()


@router.put("/runbooks/{runbook_id}")
async def update_runbook(runbook_id: str, runbook_data: dict, current_user: dict = Depends(get_current_user)):
    _retire_legacy_runbook_execution()


@router.delete("/runbooks/{runbook_id}")
async def delete_runbook(runbook_id: str, current_user: dict = Depends(get_current_user)):
    _retire_legacy_runbook_execution()


@router.post("/runbooks/{runbook_id}/execute")
async def execute_runbook(runbook_id: str, context: Dict[str, Any] = {}, current_user: dict = Depends(get_current_user)):
    _retire_legacy_runbook_execution()


@router.get("/runbook-executions")
async def get_runbook_executions(runbook_id: Optional[str] = None, limit: int = 50, current_user: dict = Depends(get_current_user)):
    _retire_legacy_runbook_execution()

