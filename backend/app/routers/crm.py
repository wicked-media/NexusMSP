from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.services.scope_permissions import assert_client_scope, assert_global_scope, assert_record_scope, scoped_query
from app.services.scope_permissions import tenant_scoped_query, platform_tenant_id
from app.services.action_permissions import require_action
from app.models import *

router = APIRouter()

# ============== LEADS / CRM ENDPOINTS ==============

@router.get("/leads", response_model=List[Lead], dependencies=[Depends(require_action("crm.lead.view"))])
async def get_leads(
    status: Optional[str] = None,
    source: Optional[str] = None,
    assigned_to: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if status:
        query["status"] = status
    if source:
        query["source"] = source
    if assigned_to:
        query["assigned_to"] = assigned_to
    
    leads = await db.leads.find(tenant_scoped_query(current_user, query), {"_id": 0}).sort("created_at", -1).to_list(1000)
    for l in leads:
        for field in ['created_at', 'updated_at', 'last_contact', 'next_follow_up']:
            if isinstance(l.get(field), str):
                l[field] = datetime.fromisoformat(l[field])
    return leads

@router.get("/leads/{lead_id}", dependencies=[Depends(require_action("crm.lead.view"))])
async def get_lead(lead_id: str, current_user: dict = Depends(get_current_user)):
    lead = await db.leads.find_one(tenant_scoped_query(current_user, {"id": lead_id}), {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead

@router.post("/leads", response_model=Lead, dependencies=[Depends(require_action("crm.lead.manage"))])
async def create_lead(lead_data: LeadCreate, current_user: dict = Depends(get_current_user)):
    assigned_name = None
    if lead_data.assigned_to:
        user = await db.users.find_one(tenant_scoped_query(current_user, {"id": lead_data.assigned_to}), {"_id": 0})
        assigned_name = user['name'] if user else None
    
    lead = Lead(**lead_data.model_dump(), assigned_name=assigned_name, assigned_to_name=assigned_name)
    doc = lead.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    doc['tenant_id'] = platform_tenant_id(current_user)
    if doc.get('last_contact'):
        doc['last_contact'] = doc['last_contact'].isoformat()
    if doc.get('next_follow_up'):
        doc['next_follow_up'] = doc['next_follow_up'].isoformat()
    await db.leads.insert_one(doc)
    return lead

@router.put("/leads/{lead_id}", dependencies=[Depends(require_action("crm.lead.manage"))])
async def update_lead(lead_id: str, lead_data: dict, current_user: dict = Depends(get_current_user)):
    lead_data.pop("tenant_id", None)
    lead_data.pop("id", None)
    if "assigned_to" in lead_data:
        assigned_user = await db.users.find_one(
            tenant_scoped_query(current_user, {"id": lead_data.get("assigned_to")}),
            {"_id": 0, "name": 1},
        ) if lead_data.get("assigned_to") else None
        assigned_name = assigned_user.get("name") if assigned_user else None
        lead_data["assigned_name"] = assigned_name
        lead_data["assigned_to_name"] = assigned_name
    lead_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    
    # Update pipeline stage based on status
    status_to_stage = {
        "new": 1, "contacted": 2, "qualified": 3, 
        "proposal": 4, "negotiation": 5, "won": 6, "lost": 0
    }
    if 'status' in lead_data:
        lead_data['pipeline_stage'] = status_to_stage.get(lead_data['status'], 1)
    
    result = await db.leads.update_one(tenant_scoped_query(current_user, {"id": lead_id}), {"$set": lead_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"message": "Lead updated"}

@router.delete("/leads/{lead_id}", dependencies=[Depends(require_action("crm.lead.manage"))])
async def delete_lead(lead_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.leads.delete_one(tenant_scoped_query(current_user, {"id": lead_id}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"message": "Lead deleted"}

@router.post("/leads/{lead_id}/convert", dependencies=[Depends(require_action("crm.lead.convert"))])
async def convert_lead_to_client(lead_id: str, current_user: dict = Depends(get_current_user)):
    """Convert a lead to a client"""
    # Creating a new client extends the portfolio, rather than editing an
    # already assigned account. Restricted technicians cannot perform this.
    await assert_global_scope(current_user, operation="lead.convert")
    lead_query = tenant_scoped_query(current_user, {"id": lead_id})
    lead = await db.leads.find_one(lead_query, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    if lead.get('converted_to_client'):
        raise HTTPException(status_code=400, detail="Lead already converted")
    
    # Create new client from lead
    client = Client(
        name=lead['company_name'],
        email=lead.get('email'),
        phone=lead.get('phone'),
        industry=lead.get('industry'),
        # Pipeline estimates are not contracted recurring revenue.
        mrr=0
    )
    doc = client.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['tenant_id'] = platform_tenant_id(current_user)
    doc['source_lead_id'] = lead_id
    await db.clients.insert_one(doc)
    
    # Update lead status
    await db.leads.update_one(
        lead_query,
        {"$set": {
            "status": "won",
            "pipeline_stage": 6,
            "converted_to_client": client.id,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    await log_activity(current_user, "lead_converted", "lead", lead_id,
                       entity_name=lead.get('company_name', ''),
                       metadata={"client_id": client.id, "tenant_id": platform_tenant_id(current_user)})
    return {"message": "Lead converted to client", "client_id": client.id}

@router.post("/leads/{lead_id}/create-ticket", dependencies=[Depends(require_action("crm.lead.manage")), Depends(require_action("crm.lead.convert"))])
async def create_ticket_from_lead(lead_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Create a ticket directly from a lead (Syncro-style)"""
    lead_query = tenant_scoped_query(current_user, {"id": lead_id})
    lead = await db.leads.find_one(lead_query, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Find or create client for this lead
    client_id = lead.get('converted_to_client')
    client_name = lead.get('company_name', '')
    if not client_id:
        # Use a temporary/prospect client or create one
        existing = await db.clients.find_one(tenant_scoped_query(current_user, {"name": lead['company_name']}), {"_id": 0})
        if existing:
            client_id = existing['id']
            client_name = existing['name']
        else:
            client_doc = Client(
                name=lead['company_name'],
                email=lead.get('email'),
                phone=lead.get('phone'),
                industry=lead.get('industry'),
            )
            cd = client_doc.model_dump()
            cd['created_at'] = cd['created_at'].isoformat()
            cd['tenant_id'] = platform_tenant_id(current_user)
            await db.clients.insert_one(cd)
            client_id = client_doc.id
            client_name = client_doc.name
    
    # Create ticket
    from app.routers.ticket_suggestions import generate_ticket_number
    ticket_number = await generate_ticket_number(data.get("ticket_type", "service_request"))
    
    ticket = Ticket(
        title=data.get('title', f"Inquiry from {lead['company_name']}"),
        description=data.get('description', f"Lead inquiry from {lead['contact_name']} at {lead['company_name']}.\n\nNotes: {lead.get('notes', '')}"),
        client_id=client_id,
        client_name=client_name,
        priority=data.get('priority', 'medium'),
        category=data.get('category', 'support'),
        ticket_type=data.get('ticket_type', 'service_request'),
        assigned_to=lead.get('assigned_to') or current_user['id'],
        assigned_name=lead.get('assigned_name') or current_user['name'],
        ticket_number=ticket_number,
    )
    tdoc = ticket.model_dump()
    tdoc['created_at'] = tdoc['created_at'].isoformat()
    tdoc['updated_at'] = tdoc['updated_at'].isoformat()
    if tdoc.get('sla_due'):
        tdoc['sla_due'] = tdoc['sla_due'].isoformat()
    tdoc['tenant_id'] = platform_tenant_id(current_user)
    await db.tickets.insert_one(tdoc)
    
    # Log activity on lead
    activity = LeadActivity(
        lead_id=lead_id,
        lead_name=lead['company_name'],
        user_id=current_user['id'],
        user_name=current_user['name'],
        activity_type="task",
        subject=f"Ticket created: {ticket.title}",
        description=f"Ticket #{ticket_number} created from this lead",
        outcome="positive"
    )
    adoc = activity.model_dump()
    adoc['created_at'] = adoc['created_at'].isoformat()
    adoc['tenant_id'] = platform_tenant_id(current_user)
    await db.lead_activities.insert_one(adoc)
    
    # Update lead last contact
    await db.leads.update_one(
        lead_query,
        {"$set": {"last_contact": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"message": "Ticket created from lead", "ticket_id": ticket.id, "ticket_number": ticket_number}

@router.post("/leads/{lead_id}/assign-client", dependencies=[Depends(require_action("crm.lead.manage")), Depends(require_action("crm.lead.convert"))])
async def assign_client_to_lead(lead_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Assign an existing client to a lead"""
    lead_query = tenant_scoped_query(current_user, {"id": lead_id})
    lead = await db.leads.find_one(lead_query, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    client_id = data.get("client_id")
    if not client_id:
        raise HTTPException(status_code=400, detail="client_id required")
    
    client = await db.clients.find_one(tenant_scoped_query(current_user, {"id": client_id}), {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    await db.leads.update_one(
        lead_query,
        {"$set": {
            "converted_to_client": client_id,
            "status": "won",
            "pipeline_stage": 6,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    return {"message": f"Lead assigned to client: {client['name']}", "client_id": client_id}

# ============== LEAD ACTIVITIES ENDPOINTS ==============

@router.get("/leads/{lead_id}/activities", dependencies=[Depends(require_action("crm.lead.view"))])
async def get_lead_activities(lead_id: str, current_user: dict = Depends(get_current_user)):
    activities = await db.lead_activities.find(
        tenant_scoped_query(current_user, {"lead_id": lead_id}), {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return activities

@router.post("/leads/{lead_id}/activities", dependencies=[Depends(require_action("crm.lead.manage"))])
async def create_lead_activity(lead_id: str, activity_data: dict, current_user: dict = Depends(get_current_user)):
    lead_query = tenant_scoped_query(current_user, {"id": lead_id})
    lead = await db.leads.find_one(lead_query, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    activity = LeadActivity(
        lead_id=lead_id,
        lead_name=lead['company_name'],
        user_id=current_user['id'],
        user_name=current_user['name'],
        activity_type=activity_data.get('activity_type', 'note'),
        subject=activity_data.get('subject', ''),
        description=activity_data.get('description'),
        outcome=activity_data.get('outcome')
    )
    doc = activity.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['tenant_id'] = platform_tenant_id(current_user)
    if doc.get('scheduled_at'):
        doc['scheduled_at'] = doc['scheduled_at'].isoformat()
    if doc.get('completed_at'):
        doc['completed_at'] = doc['completed_at'].isoformat()
    await db.lead_activities.insert_one(doc)
    
    # Update last contact on lead
    await db.leads.update_one(
        lead_query,
        {"$set": {"last_contact": datetime.now(timezone.utc).isoformat()}}
    )
    
    return activity

# ============== PROPOSALS ENDPOINTS ==============

_PROPOSAL_EDITABLE_FIELDS = {
    "title", "description", "summary", "scope_of_work", "contract_term",
    "payment_terms", "currency", "notes", "valid_until", "terms_and_conditions",
    "line_items", "discount_percent", "tax_percent", "tax_rate", "client_email",
}


def _proposal_money(value: Any, *, field: str) -> float:
    try:
        amount = round(float(value or 0), 2)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{field.replace('_', ' ').capitalize()} must be a number") from None
    if amount < 0:
        raise HTTPException(status_code=422, detail=f"{field.replace('_', ' ').capitalize()} cannot be negative")
    return amount


def _normalise_proposal_line_items(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise HTTPException(status_code=422, detail="Line items must be a list")
    prepared: list[dict[str, Any]] = []
    for index, raw_item in enumerate(value):
        if not isinstance(raw_item, dict):
            raise HTTPException(status_code=422, detail=f"Line item {index + 1} is invalid")
        item = dict(raw_item)
        description = str(item.get("description") or "").strip()
        if not description:
            continue
        quantity = _proposal_money(item.get("quantity", 1), field=f"line item {index + 1} quantity")
        rate_value = item.get("unit_price", item.get("rate"))
        amount = _proposal_money(item.get("amount", item.get("total", 0)), field=f"line item {index + 1} amount")
        if rate_value not in (None, ""):
            rate = _proposal_money(rate_value, field=f"line item {index + 1} rate")
            amount = round(quantity * rate, 2)
            item["rate"] = rate
            item["unit_price"] = rate
        item["description"] = description
        item["quantity"] = quantity
        item["amount"] = amount
        item["total"] = amount
        item["billing_type"] = "recurring" if item.get("billing_type") == "recurring" else "one_time"
        prepared.append(item)
    if not prepared:
        raise HTTPException(status_code=422, detail="At least one described line item is required")
    return prepared


def _proposal_totals(line_items: list[dict[str, Any]], discount_percent: Any, tax_percent: Any) -> dict[str, float]:
    discount_rate = _proposal_money(discount_percent, field="discount percent")
    tax_rate = _proposal_money(tax_percent, field="tax percent")
    if discount_rate > 100 or tax_rate > 100:
        raise HTTPException(status_code=422, detail="Tax and discount percentages cannot exceed 100")
    subtotal = round(sum(_proposal_money(item.get("amount"), field="line item amount") for item in line_items), 2)
    discount_amount = round(subtotal * discount_rate / 100, 2)
    taxable_amount = subtotal - discount_amount
    tax_amount = round(taxable_amount * tax_rate / 100, 2)
    recurring_amount = round(sum(_proposal_money(item.get("amount"), field="line item amount") for item in line_items if item.get("billing_type") == "recurring"), 2)
    return {
        "subtotal": subtotal,
        "discount_percent": discount_rate,
        "discount_amount": discount_amount,
        "tax_percent": tax_rate,
        "tax_amount": tax_amount,
        "total": round(taxable_amount + tax_amount, 2),
        "mrr": recurring_amount,
    }


async def _proposal_or_404(proposal_id: str, current_user: dict, *, operation: str = "proposal.access") -> dict:
    return await assert_record_scope(
        current_user,
        db.proposals,
        str(proposal_id),
        operation=operation,
        resource_name="Proposal",
    )

@router.get("/proposals")
async def get_proposals(
    lead_id: Optional[str] = None,
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if lead_id:
        query["lead_id"] = lead_id
    if client_id:
        query["client_id"] = client_id
    if status and status != "all":
        query["status"] = status
    
    proposals = await db.proposals.find(
        scoped_query(current_user, query, site_field=None), {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    return proposals


@router.get("/proposals/stats")
async def get_proposal_stats(current_user: dict = Depends(get_current_user)):
    all_p = await db.proposals.find(
        scoped_query(current_user, {}, site_field=None), {"_id": 0}
    ).to_list(500)
    total = len(all_p)
    by_status = {}
    for s in ["draft", "sent", "viewed", "accepted", "declined", "expired", "converted"]:
        by_status[s] = len([p for p in all_p if p.get("status") == s])
    total_value = sum(p.get("total", 0) for p in all_p)
    won_value = sum(p.get("total", 0) for p in all_p if p.get("status") in ("accepted", "converted"))
    pipeline_value = sum(p.get("total", 0) for p in all_p if p.get("status") in ("draft", "sent", "viewed"))
    declined_count = by_status.get("declined", 0)
    accepted_count = by_status.get("accepted", 0) + by_status.get("converted", 0)
    win_rate = round((accepted_count / max(accepted_count + declined_count, 1)) * 100, 1)
    return {
        "total": total, "by_status": by_status,
        "total_value": round(total_value, 2), "won_value": round(won_value, 2),
        "pipeline_value": round(pipeline_value, 2), "win_rate": win_rate,
    }


@router.get("/proposals/{proposal_id}")
async def get_proposal(proposal_id: str, current_user: dict = Depends(get_current_user)):
    return await _proposal_or_404(proposal_id, current_user)

@router.post("/proposals")
async def create_proposal(proposal_data: dict, current_user: dict = Depends(get_current_user)):
    lead_name = None
    client_name = None
    client = None
    
    if proposal_data.get('lead_id'):
        lead = await db.leads.find_one({"id": proposal_data['lead_id']}, {"_id": 0})
        lead_name = lead['company_name'] if lead else None
    
    if proposal_data.get('client_id'):
        client_id = str(proposal_data['client_id']).strip()
        await assert_client_scope(current_user, client_id, operation="proposal.create")
        client = await db.clients.find_one({"id": client_id}, {"_id": 0})
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        client_name = client.get('name')
    else:
        # A lead-only proposal has no tenant/client boundary yet. Restricted
        # technicians must not create unscoped commercial records.
        await assert_global_scope(current_user, operation="proposal.create.unscoped")
    
    line_items = _normalise_proposal_line_items(proposal_data.get('line_items', []))
    tax_percent = proposal_data.get('tax_percent', proposal_data.get('tax_rate', 0))
    totals = _proposal_totals(line_items, proposal_data.get('discount_percent', 0), tax_percent)
    
    proposal = Proposal(
        lead_id=proposal_data.get('lead_id'),
        lead_name=lead_name,
        client_id=proposal_data.get('client_id'),
        client_name=client_name,
        title=proposal_data.get('title', 'Service Proposal'),
        description=proposal_data.get('description') or proposal_data.get('summary'),
        valid_until=proposal_data.get('valid_until'),
        line_items=line_items,
        subtotal=totals['subtotal'],
        discount_percent=totals['discount_percent'],
        discount_amount=totals['discount_amount'],
        tax_percent=totals['tax_percent'],
        tax_amount=totals['tax_amount'],
        total=totals['total'],
        terms_and_conditions=proposal_data.get('terms_and_conditions'),
        created_by=current_user['id']
    )
    doc = proposal.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    # The original Proposal model intentionally keeps its core compact. These
    # fields are still controlled commercial metadata and must survive the
    # authoring form rather than becoming browser-only state.
    doc.update({
        "summary": str(proposal_data.get("summary") or "").strip() or None,
        "scope_of_work": str(proposal_data.get("scope_of_work") or "").strip() or None,
        "contract_term": str(proposal_data.get("contract_term") or "").strip() or None,
        "payment_terms": str(proposal_data.get("payment_terms") or "").strip() or None,
        "currency": str(proposal_data.get("currency") or "AUD").strip().upper()[:3] or "AUD",
        "notes": str(proposal_data.get("notes") or "").strip() or None,
        "client_email": str((client or {}).get("email") or proposal_data.get("client_email") or "").strip() or None,
        "mrr": totals["mrr"],
        "updated_at": doc['created_at'],
    })
    await db.proposals.insert_one(doc)
    await log_activity(
        current_user,
        "proposal_created",
        "proposal",
        doc["id"],
        doc.get("title", "Proposal"),
        "Created scoped commercial proposal",
        metadata={"client_id": doc.get("client_id"), "lead_id": doc.get("lead_id"), "total": doc.get("total"), "currency": doc.get("currency")},
    )
    return {key: value for key, value in doc.items() if key != "_id"}

@router.put("/proposals/{proposal_id}")
async def update_proposal(proposal_id: str, proposal_data: dict, current_user: dict = Depends(get_current_user)):
    proposal = await _proposal_or_404(proposal_id, current_user, operation="proposal.update")
    if proposal.get("status") not in {"draft", "sent", "viewed"}:
        raise HTTPException(status_code=409, detail="Accepted or converted proposals are commercially locked; duplicate them to create a revised proposal")
    updates = {key: value for key, value in proposal_data.items() if key in _PROPOSAL_EDITABLE_FIELDS}
    if not updates:
        raise HTTPException(status_code=422, detail="No editable proposal fields were supplied")
    if "title" in updates:
        updates["title"] = str(updates["title"] or "").strip()
        if len(updates["title"]) < 3:
            raise HTTPException(status_code=422, detail="Proposal title must be at least 3 characters")
    if "tax_rate" in updates:
        updates["tax_percent"] = updates.pop("tax_rate")
    if "line_items" in updates:
        updates["line_items"] = _normalise_proposal_line_items(updates["line_items"])
    if {"line_items", "discount_percent", "tax_percent"}.intersection(updates):
        current_lines = updates.get("line_items", proposal.get("line_items") or [])
        totals = _proposal_totals(
            current_lines,
            updates.get("discount_percent", proposal.get("discount_percent", 0)),
            updates.get("tax_percent", proposal.get("tax_percent", 0)),
        )
        updates.update(totals)
    for text_field in {"description", "summary", "scope_of_work", "contract_term", "payment_terms", "notes", "terms_and_conditions", "client_email"}.intersection(updates):
        updates[text_field] = str(updates[text_field] or "").strip() or None
    if "currency" in updates:
        updates["currency"] = str(updates["currency"] or "AUD").strip().upper()[:3] or "AUD"
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.proposals.update_one({"id": proposal_id}, {"$set": updates})
    await log_activity(
        current_user,
        "proposal_updated",
        "proposal",
        proposal_id,
        updates.get("title", proposal.get("title", "Proposal")),
        "Updated commercial proposal",
        changes={key: {"from": proposal.get(key), "to": value} for key, value in updates.items() if key != "updated_at" and proposal.get(key) != value},
        metadata={"client_id": proposal.get("client_id")},
    )
    return {"message": "Proposal updated"}

@router.delete("/proposals/{proposal_id}")
async def delete_proposal(proposal_id: str, current_user: dict = Depends(get_current_user)):
    proposal = await _proposal_or_404(proposal_id, current_user, operation="proposal.delete")
    linked_contract = await db.contracts.find_one({"proposal_id": proposal_id}, {"_id": 0, "id": 1})
    linked_project = await db.projects.find_one({"proposal_id": proposal_id}, {"_id": 0, "id": 1})
    linked_recurring = await db.recurring_invoices.find_one({"proposal_id": proposal_id}, {"_id": 0, "id": 1})
    if linked_contract or linked_project or linked_recurring:
        raise HTTPException(status_code=409, detail="This proposal has downstream commercial or delivery records and cannot be deleted. Duplicate it for a revised scope instead.")
    await db.proposals.delete_one({"id": proposal_id})
    await log_activity(
        current_user,
        "proposal_deleted",
        "proposal",
        proposal_id,
        proposal.get("title", "Proposal"),
        "Deleted standalone commercial proposal",
        metadata={"client_id": proposal.get("client_id")},
    )
    return {"message": "Proposal deleted"}

@router.post("/proposals/{proposal_id}/send")
async def send_proposal(proposal_id: str, current_user: dict = Depends(get_current_user)):
    proposal = await _proposal_or_404(proposal_id, current_user, operation="proposal.send")
    if proposal.get("status") != "draft":
        raise HTTPException(status_code=409, detail="Only draft proposals can be sent")
    sent_at = datetime.now(timezone.utc).isoformat()
    await db.proposals.update_one(
        {"id": proposal_id},
        {"$set": {"status": "sent", "sent_at": sent_at, "updated_at": sent_at}}
    )
    await log_activity(current_user, "proposal_sent", "proposal", proposal_id, proposal.get("title", "Proposal"), "Marked proposal as sent for customer review", metadata={"client_id": proposal.get("client_id")})
    return {"message": "Proposal sent"}

# ============== CRM DASHBOARD ==============

@router.get("/crm/dashboard")
async def get_crm_dashboard(current_user: dict = Depends(get_current_user)):
    """Get CRM dashboard stats"""
    # Lead counts by status
    total_leads = await db.leads.count_documents({})
    new_leads = await db.leads.count_documents({"status": "new"})
    qualified_leads = await db.leads.count_documents({"status": "qualified"})
    won_leads = await db.leads.count_documents({"status": "won"})
    lost_leads = await db.leads.count_documents({"status": "lost"})
    
    # Pipeline value
    pipeline = await db.leads.aggregate([
        {"$match": {"status": {"$nin": ["won", "lost"]}}},
        {"$group": {"_id": None, "total_value": {"$sum": "$estimated_value"}}}
    ]).to_list(1)
    pipeline_value = pipeline[0]['total_value'] if pipeline else 0
    
    # Proposal stats
    total_proposals = await db.proposals.count_documents({})
    sent_proposals = await db.proposals.count_documents({"status": "sent"})
    accepted_proposals = await db.proposals.count_documents({"status": "accepted"})
    
    # Revenue from proposals
    revenue = await db.proposals.aggregate([
        {"$match": {"status": "accepted"}},
        {"$group": {"_id": None, "total": {"$sum": "$total"}}}
    ]).to_list(1)
    proposal_revenue = revenue[0]['total'] if revenue else 0
    
    # Lead sources
    sources = await db.leads.aggregate([
        {"$group": {"_id": "$source", "count": {"$sum": 1}}}
    ]).to_list(10)
    
    return {
        "leads": {
            "total": total_leads,
            "new": new_leads,
            "qualified": qualified_leads,
            "won": won_leads,
            "lost": lost_leads,
            "pipeline_value": pipeline_value
        },
        "proposals": {
            "total": total_proposals,
            "sent": sent_proposals,
            "accepted": accepted_proposals,
            "revenue": proposal_revenue
        },
        "lead_sources": [{"source": s['_id'], "count": s['count']} for s in sources],
        "conversion_rate": round((won_leads / total_leads * 100) if total_leads > 0 else 0, 1)
    }


# ============== ENHANCED PROPOSAL ENDPOINTS ==============

@router.post("/proposals/{proposal_id}/accept")
async def accept_proposal(proposal_id: str, current_user: dict = Depends(get_current_user)):
    p = await _proposal_or_404(proposal_id, current_user, operation="proposal.accept")
    if p.get("status") not in {"sent", "viewed"}:
        raise HTTPException(status_code=409, detail="Only proposals awaiting a customer decision can be accepted")
    now = datetime.now(timezone.utc).isoformat()
    await db.proposals.update_one({"id": proposal_id}, {"$set": {"status": "accepted", "accepted_at": now, "responded_at": now, "updated_at": now}})
    await log_activity(current_user, "proposal_accepted", "proposal", proposal_id, p.get("title", "Proposal"), "Recorded an accepted customer proposal", metadata={"client_id": p.get("client_id")})
    return {"message": "Proposal accepted"}


@router.post("/proposals/{proposal_id}/decline")
async def decline_proposal(proposal_id: str, current_user: dict = Depends(get_current_user)):
    p = await _proposal_or_404(proposal_id, current_user, operation="proposal.decline")
    if p.get("status") not in {"sent", "viewed"}:
        raise HTTPException(status_code=409, detail="Only proposals awaiting a customer decision can be declined")
    now = datetime.now(timezone.utc).isoformat()
    await db.proposals.update_one({"id": proposal_id}, {"$set": {"status": "declined", "declined_at": now, "responded_at": now, "updated_at": now}})
    await log_activity(current_user, "proposal_declined", "proposal", proposal_id, p.get("title", "Proposal"), "Recorded a declined customer proposal", metadata={"client_id": p.get("client_id")})
    return {"message": "Proposal declined"}


@router.post("/proposals/{proposal_id}/duplicate")
async def duplicate_proposal(proposal_id: str, current_user: dict = Depends(get_current_user)):
    p = await _proposal_or_404(proposal_id, current_user, operation="proposal.duplicate")
    now = datetime.now(timezone.utc)
    new_p = {**p}
    new_p["id"] = f"prop-{uuid.uuid4().hex[:8]}"
    new_p["proposal_number"] = f"PROP-{now.strftime('%Y%m')}-{uuid.uuid4().hex[:4].upper()}"
    new_p["title"] = f"{p.get('title', 'Proposal')} (Copy)"
    new_p["status"] = "draft"
    new_p["sent_at"] = None
    new_p["accepted_at"] = None
    new_p["declined_at"] = None
    new_p["responded_at"] = None
    new_p["converted_to_contract"] = None
    new_p["converted_to_recurring"] = None
    new_p["project_id"] = None
    new_p["project_launched_at"] = None
    new_p["created_by"] = current_user.get("id")
    new_p["created_at"] = now.isoformat()
    new_p["updated_at"] = now.isoformat()
    new_p.pop("_id", None)
    await db.proposals.insert_one(new_p)
    await log_activity(current_user, "proposal_duplicated", "proposal", new_p["id"], new_p.get("title", "Proposal"), f"Duplicated {p.get('proposal_number', proposal_id)} as a new draft", metadata={"client_id": p.get("client_id"), "source_proposal_id": proposal_id})
    return {k: v for k, v in new_p.items() if k != "_id"}


@router.post("/proposals/{proposal_id}/convert-to-contract")
async def convert_proposal_to_contract(proposal_id: str, current_user: dict = Depends(get_current_user)):
    """Convert an accepted proposal into a contract + recurring invoice."""
    p = await _proposal_or_404(proposal_id, current_user, operation="proposal.convert")
    client_id = str(p.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=409, detail="Associate this proposal with a client before creating an agreement")
    if p.get("status") == "converted":
        existing_contract = await db.contracts.find_one({"proposal_id": proposal_id, "client_id": client_id}, {"_id": 0})
        if not existing_contract:
            raise HTTPException(status_code=409, detail="This proposal is marked converted but its agreement needs reconciliation")
        existing_recurring = await db.recurring_invoices.find_one(
            {"$or": [{"proposal_id": proposal_id}, {"contract_id": existing_contract["id"]}], "client_id": client_id},
            {"_id": 0, "id": 1},
        )
        return {
            "message": "Existing commercial handoff returned",
            "contract_id": existing_contract["id"],
            "recurring_invoice_id": (existing_recurring or {}).get("id"),
            "reused": True,
        }
    if p.get("status") != "accepted":
        raise HTTPException(status_code=409, detail="Only accepted proposals can become agreements")

    now = datetime.now(timezone.utc)
    line_items = p.get("line_items", [])
    recurring_items = [li for li in line_items if li.get("billing_type") == "recurring"]
    mrr = round(sum(_proposal_money(li.get("amount", li.get("total", 0)), field="line item amount") for li in recurring_items), 2)
    term_days = {
        "month_to_month": 30,
        "6_months": 182,
        "12_months": 365,
        "24_months": 730,
        "36_months": 1095,
    }.get(str(p.get("contract_term") or "12_months"), 365)

    # Create contract
    contract = {
        "id": f"contract-{uuid.uuid4().hex[:8]}",
        "client_id": client_id,
        "client_name": p.get("client_name"),
        "name": p.get("title", ""),
        "description": p.get("scope_of_work") or p.get("summary") or p.get("description", ""),
        "value": p.get("total", 0),
        "mrr": mrr,
        "start_date": now.strftime("%Y-%m-%d"),
        "end_date": (now + timedelta(days=term_days)).strftime("%Y-%m-%d"),
        "sla_tier": "gold",
        "status": "active",
        "auto_renew": True,
        "proposal_id": proposal_id,
        "created_at": now.isoformat(),
        "created_by": current_user.get("name", ""),
    }
    await db.contracts.insert_one(contract)

    # Create recurring invoice if MRR exists
    recurring_id = None
    if mrr > 0:
        tax_rate = _proposal_money(p.get("tax_percent", p.get("tax_rate", 10)), field="tax percent")
        subtotal = round(sum(_proposal_money(li.get("amount", li.get("total", 0)), field="line item amount") for li in recurring_items), 2)
        tax_amount = round(subtotal * tax_rate / 100, 2)
        ri = {
            "id": f"ri-{uuid.uuid4().hex[:8]}",
            "client_id": client_id,
            "client_name": p.get("client_name"),
            "description": p.get("title", ""),
            "line_items": recurring_items,
            "subtotal": subtotal,
            "tax_rate": tax_rate,
            "tax_amount": tax_amount,
            "amount": round(subtotal + tax_amount, 2),
            "currency": "AUD",
            "frequency": "monthly",
            "start_date": now.strftime("%Y-%m-%d"),
            "next_generation": (now + timedelta(days=30)).strftime("%Y-%m-%d"),
            "contract_id": contract["id"],
            "proposal_id": proposal_id,
            "payment_terms": p.get("payment_terms") or "net_30",
            "auto_send": True,
            "auto_send_email": p.get("client_email", ""),
            "status": "active",
            "invoices_generated": 0,
            "total_billed": 0,
            "generation_history": [],
            "notes": f"Auto-created from proposal {p.get('proposal_number', proposal_id)}",
            "created_by": current_user.get("name", ""),
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }
        await db.recurring_invoices.insert_one(ri)
        recurring_id = ri["id"]

    await db.proposals.update_one({"id": proposal_id}, {"$set": {
        "status": "converted",
        "converted_to_contract": contract["id"],
        "converted_to_recurring": recurring_id,
        "updated_at": now.isoformat(),
    }})
    await log_activity(
        current_user,
        "proposal_converted",
        "proposal",
        proposal_id,
        p.get("title", "Proposal"),
        "Created the linked agreement and recurring billing record",
        metadata={"client_id": client_id, "contract_id": contract["id"], "recurring_invoice_id": recurring_id},
    )

    return {
        "message": "Proposal converted to contract" + (" and recurring invoice" if recurring_id else ""),
        "contract_id": contract["id"],
        "recurring_invoice_id": recurring_id,
    }


async def _proposal_handoff(proposal: dict) -> dict:
    """Return Nexus-owned downstream links without inventing second records.

    The record IDs in this response are stable Nexus IDs.  A missing stage is
    intentionally shown as missing rather than inferred from a matching name
    or amount, which keeps commercial provenance honest.
    """
    proposal_id = str(proposal.get("id") or "")
    client_id = str(proposal.get("client_id") or "")
    contract = await db.contracts.find_one({"proposal_id": proposal_id, "client_id": client_id}, {"_id": 0}) if client_id else None
    recurring_links = [{"proposal_id": proposal_id}]
    if (contract or {}).get("id"):
        recurring_links.append({"contract_id": contract["id"]})
    recurring_records = await db.recurring_invoices.find(
        {"$and": [{"client_id": client_id}, {"$or": recurring_links}]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(25) if client_id else []
    project = await db.projects.find_one({"proposal_id": proposal_id, "client_id": client_id}, {"_id": 0}) if client_id else None
    purchase_orders = await db.purchase_orders.find(
        {"proposal_id": proposal_id, "client_id": client_id}, {"_id": 0, "id": 1, "po_number": 1, "status": 1}
    ).sort("created_at", -1).to_list(25) if client_id else []

    proposal_status = str(proposal.get("status") or "draft")
    agreement_status = str((contract or {}).get("status") or ("ready" if proposal_status == "accepted" else "waiting"))
    billing_status = str((recurring_records[0] if recurring_records else {}).get("status") or ("not_required" if agreement_status == "active" and not proposal.get("mrr") else "not_started"))
    delivery_status = str((project or {}).get("status") or ("ready" if proposal_status == "converted" else "not_started"))
    if proposal_status == "accepted":
        next_action = {"key": "convert", "label": "Create agreement & billing", "detail": "The customer decision is recorded. Turn the accepted scope into the authoritative agreement."}
    elif proposal_status == "converted" and not project:
        next_action = {"key": "launch_project", "label": "Start delivery project", "detail": "Agreement and billing are linked. Create a governed delivery project for the work."}
    elif project:
        next_action = {"key": "open_project", "label": "Open delivery project", "detail": "Delivery work is now governed in the linked project workspace.", "project_id": project.get("id")}
    elif proposal_status in {"sent", "viewed"}:
        next_action = {"key": "await_decision", "label": "Await customer decision", "detail": "Nexus keeps the commercial record ready without creating delivery or billing work early."}
    else:
        next_action = {"key": "send", "label": "Send for customer review", "detail": "Finalise scope, terms and pricing before starting the approval path."}

    return {
        "proposal": {
            "id": proposal_id,
            "number": proposal.get("proposal_number"),
            "title": proposal.get("title"),
            "status": proposal_status,
            "client_id": client_id or None,
            "client_name": proposal.get("client_name"),
            "total": proposal.get("total"),
            "currency": proposal.get("currency") or "AUD",
        },
        "stages": [
            {"key": "proposal", "label": "Customer proposal", "status": proposal_status, "detail": proposal.get("proposal_number") or "Commercial scope"},
            {"key": "agreement", "label": "Agreement", "status": agreement_status, "detail": (contract or {}).get("name") or "No agreement created", "record_id": (contract or {}).get("id")},
            {"key": "billing", "label": "Recurring billing", "status": billing_status, "detail": f"{len(recurring_records)} linked recurring record(s)", "record_id": (recurring_records[0] if recurring_records else {}).get("id")},
            {"key": "delivery", "label": "Delivery project", "status": delivery_status, "detail": (project or {}).get("name") or "No delivery project created", "record_id": (project or {}).get("id")},
        ],
        "records": {
            "contract": {"id": (contract or {}).get("id"), "name": (contract or {}).get("name"), "status": (contract or {}).get("status")},
            "recurring_invoices": [{"id": record.get("id"), "description": record.get("description"), "status": record.get("status"), "amount": record.get("amount")} for record in recurring_records],
            "project": {"id": (project or {}).get("id"), "name": (project or {}).get("name"), "status": (project or {}).get("status")},
            "purchase_orders": purchase_orders,
        },
        "next_action": next_action,
    }


@router.get("/proposals/{proposal_id}/handoff")
async def get_proposal_handoff(proposal_id: str, current_user: dict = Depends(get_current_user)):
    proposal = await _proposal_or_404(proposal_id, current_user, operation="proposal.handoff.view")
    return await _proposal_handoff(proposal)


@router.post("/proposals/{proposal_id}/launch-project")
async def launch_proposal_project(proposal_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
    """Create one governed delivery project from an already converted proposal.

    The upsert key is the immutable proposal ID, so a retry returns the same
    project instead of creating a second, untracked delivery stream.
    """
    proposal = await _proposal_or_404(proposal_id, current_user, operation="proposal.project.launch")
    if proposal.get("status") != "converted":
        raise HTTPException(status_code=409, detail="Create the agreement and billing handoff before starting delivery")
    client_id = str(proposal.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=409, detail="Associate this proposal with a client before starting delivery")

    manager_id = str(payload.get("project_manager_id") or current_user.get("id") or "").strip()
    manager = await db.users.find_one({"id": manager_id}, {"_id": 0, "id": 1, "name": 1})
    if not manager:
        raise HTTPException(status_code=409, detail="Assign an active Nexus user as the Project Manager before starting delivery")
    name = str(payload.get("name") or f"{proposal.get('title') or 'Proposal'} delivery").strip()
    if len(name) < 3:
        raise HTTPException(status_code=422, detail="Project name must be at least 3 characters")
    priority = str(payload.get("priority") or "high").strip()
    if priority not in {"low", "medium", "high", "urgent"}:
        raise HTTPException(status_code=422, detail="Invalid project priority")
    now = datetime.now(timezone.utc)
    project = Project(
        name=name,
        description=str(payload.get("description") or proposal.get("scope_of_work") or proposal.get("summary") or proposal.get("description") or "").strip() or None,
        client_id=client_id,
        client_name=proposal.get("client_name"),
        status="planning",
        priority=priority,
        start_date=str(payload.get("start_date") or now.date().isoformat()),
        target_end_date=str(payload.get("target_end_date") or "").strip() or None,
        budget_hours=payload.get("budget_hours"),
        project_manager=manager["id"],
        project_manager_name=manager.get("name"),
        team_members=[manager["id"]],
        tags=["commercial-handoff", "proposal"],
    )
    document = project.model_dump()
    document["created_at"] = document["created_at"].isoformat()
    document["updated_at"] = document["updated_at"].isoformat()
    document.update({
        "proposal_id": proposal_id,
        "contract_id": proposal.get("converted_to_contract"),
        "recurring_invoice_id": proposal.get("converted_to_recurring"),
        "commercial_source": "proposal",
    })
    upsert = await db.projects.update_one(
        {"proposal_id": proposal_id},
        {"$setOnInsert": document},
        upsert=True,
    )
    project_record = await db.projects.find_one({"proposal_id": proposal_id}, {"_id": 0})
    if not project_record:
        raise HTTPException(status_code=503, detail="Nexus could not confirm the delivery project")
    if str(project_record.get("client_id") or "") != client_id:
        raise HTTPException(status_code=409, detail="The linked delivery project belongs to a different client and needs reconciliation")
    created = bool(getattr(upsert, "upserted_id", None))
    if created:
        await db.proposals.update_one({"id": proposal_id}, {"$set": {"project_id": project_record["id"], "project_launched_at": now.isoformat(), "updated_at": now.isoformat()}})
        await log_activity(
            current_user,
            "proposal_delivery_project_created",
            "proposal",
            proposal_id,
            proposal.get("title", "Proposal"),
            "Created the governed delivery project for this commercial handoff",
            metadata={"client_id": client_id, "project_id": project_record["id"], "contract_id": proposal.get("converted_to_contract")},
        )
        await log_activity(
            current_user,
            "project_created_from_proposal",
            "project",
            project_record["id"],
            project_record.get("name", "Project"),
            "Created from an approved Nexus commercial proposal",
            metadata={"client_id": client_id, "proposal_id": proposal_id, "contract_id": proposal.get("converted_to_contract")},
        )
    return {"project": project_record, "reused": not created, "message": "Delivery project created" if created else "Existing delivery project returned"}

