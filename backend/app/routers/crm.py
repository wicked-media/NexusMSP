from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== LEADS / CRM ENDPOINTS ==============

@router.get("/leads", response_model=List[Lead])
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
    
    leads = await db.leads.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for l in leads:
        for field in ['created_at', 'updated_at', 'last_contact', 'next_follow_up']:
            if isinstance(l.get(field), str):
                l[field] = datetime.fromisoformat(l[field])
    return leads

@router.get("/leads/{lead_id}")
async def get_lead(lead_id: str, current_user: dict = Depends(get_current_user)):
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead

@router.post("/leads", response_model=Lead)
async def create_lead(lead_data: LeadCreate, current_user: dict = Depends(get_current_user)):
    assigned_name = None
    if lead_data.assigned_to:
        user = await db.users.find_one({"id": lead_data.assigned_to}, {"_id": 0})
        assigned_name = user['name'] if user else None
    
    lead = Lead(**lead_data.model_dump(), assigned_name=assigned_name)
    doc = lead.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    if doc.get('last_contact'):
        doc['last_contact'] = doc['last_contact'].isoformat()
    if doc.get('next_follow_up'):
        doc['next_follow_up'] = doc['next_follow_up'].isoformat()
    await db.leads.insert_one(doc)
    return lead

@router.put("/leads/{lead_id}")
async def update_lead(lead_id: str, lead_data: dict, current_user: dict = Depends(get_current_user)):
    lead_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    
    # Update pipeline stage based on status
    status_to_stage = {
        "new": 1, "contacted": 2, "qualified": 3, 
        "proposal": 4, "negotiation": 5, "won": 6, "lost": 0
    }
    if 'status' in lead_data:
        lead_data['pipeline_stage'] = status_to_stage.get(lead_data['status'], 1)
    
    result = await db.leads.update_one({"id": lead_id}, {"$set": lead_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"message": "Lead updated"}

@router.delete("/leads/{lead_id}")
async def delete_lead(lead_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.leads.delete_one({"id": lead_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"message": "Lead deleted"}

@router.post("/leads/{lead_id}/convert")
async def convert_lead_to_client(lead_id: str, current_user: dict = Depends(get_current_user)):
    """Convert a lead to a client"""
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
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
        mrr=lead.get('estimated_value', 0)
    )
    doc = client.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.clients.insert_one(doc)
    
    # Update lead status
    await db.leads.update_one(
        {"id": lead_id},
        {"$set": {
            "status": "won",
            "pipeline_stage": 6,
            "converted_to_client": client.id,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    return {"message": "Lead converted to client", "client_id": client.id}

@router.post("/leads/{lead_id}/create-ticket")
async def create_ticket_from_lead(lead_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Create a ticket directly from a lead (Syncro-style)"""
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Find or create client for this lead
    client_id = lead.get('converted_to_client')
    client_name = lead.get('company_name', '')
    if not client_id:
        # Use a temporary/prospect client or create one
        existing = await db.clients.find_one({"name": lead['company_name']}, {"_id": 0})
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
    await db.lead_activities.insert_one(adoc)
    
    # Update lead last contact
    await db.leads.update_one(
        {"id": lead_id},
        {"$set": {"last_contact": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"message": "Ticket created from lead", "ticket_id": ticket.id, "ticket_number": ticket_number}

@router.post("/leads/{lead_id}/assign-client")
async def assign_client_to_lead(lead_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Assign an existing client to a lead"""
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    client_id = data.get("client_id")
    if not client_id:
        raise HTTPException(status_code=400, detail="client_id required")
    
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    await db.leads.update_one(
        {"id": lead_id},
        {"$set": {
            "converted_to_client": client_id,
            "status": "won",
            "pipeline_stage": 6,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    return {"message": f"Lead assigned to client: {client['name']}", "client_id": client_id}

# ============== LEAD ACTIVITIES ENDPOINTS ==============

@router.get("/leads/{lead_id}/activities")
async def get_lead_activities(lead_id: str, current_user: dict = Depends(get_current_user)):
    activities = await db.lead_activities.find(
        {"lead_id": lead_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return activities

@router.post("/leads/{lead_id}/activities")
async def create_lead_activity(lead_id: str, activity_data: dict, current_user: dict = Depends(get_current_user)):
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
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
    if doc.get('scheduled_at'):
        doc['scheduled_at'] = doc['scheduled_at'].isoformat()
    if doc.get('completed_at'):
        doc['completed_at'] = doc['completed_at'].isoformat()
    await db.lead_activities.insert_one(doc)
    
    # Update last contact on lead
    await db.leads.update_one(
        {"id": lead_id},
        {"$set": {"last_contact": datetime.now(timezone.utc).isoformat()}}
    )
    
    return activity

# ============== PROPOSALS ENDPOINTS ==============

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
    if status:
        query["status"] = status
    
    proposals = await db.proposals.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return proposals

@router.get("/proposals/{proposal_id}")
async def get_proposal(proposal_id: str, current_user: dict = Depends(get_current_user)):
    proposal = await db.proposals.find_one({"id": proposal_id}, {"_id": 0})
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return proposal

@router.post("/proposals")
async def create_proposal(proposal_data: dict, current_user: dict = Depends(get_current_user)):
    lead_name = None
    client_name = None
    
    if proposal_data.get('lead_id'):
        lead = await db.leads.find_one({"id": proposal_data['lead_id']}, {"_id": 0})
        lead_name = lead['company_name'] if lead else None
    
    if proposal_data.get('client_id'):
        client = await db.clients.find_one({"id": proposal_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    line_items = proposal_data.get('line_items', [])
    subtotal = sum(item.get('total', item.get('quantity', 1) * item.get('unit_price', 0)) for item in line_items)
    discount_amount = subtotal * (proposal_data.get('discount_percent', 0) / 100)
    tax_amount = (subtotal - discount_amount) * (proposal_data.get('tax_percent', 0) / 100)
    total = subtotal - discount_amount + tax_amount
    
    proposal = Proposal(
        lead_id=proposal_data.get('lead_id'),
        lead_name=lead_name,
        client_id=proposal_data.get('client_id'),
        client_name=client_name,
        title=proposal_data.get('title', 'Service Proposal'),
        description=proposal_data.get('description'),
        valid_until=proposal_data.get('valid_until'),
        line_items=line_items,
        subtotal=subtotal,
        discount_percent=proposal_data.get('discount_percent', 0),
        discount_amount=discount_amount,
        tax_percent=proposal_data.get('tax_percent', 0),
        tax_amount=tax_amount,
        total=total,
        terms_and_conditions=proposal_data.get('terms_and_conditions'),
        created_by=current_user['id']
    )
    doc = proposal.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.proposals.insert_one(doc)
    return proposal

@router.put("/proposals/{proposal_id}")
async def update_proposal(proposal_id: str, proposal_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.proposals.update_one({"id": proposal_id}, {"$set": proposal_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return {"message": "Proposal updated"}

@router.delete("/proposals/{proposal_id}")
async def delete_proposal(proposal_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.proposals.delete_one({"id": proposal_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return {"message": "Proposal deleted"}

@router.post("/proposals/{proposal_id}/send")
async def send_proposal(proposal_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.proposals.update_one(
        {"id": proposal_id},
        {"$set": {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Proposal not found")
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

