from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/campaigns")
async def get_campaigns(current_user: dict = Depends(get_current_user)):
    """Get all email campaigns."""
    campaigns = await db.campaigns.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return campaigns


@router.post("/campaigns")
async def create_campaign(data: dict, current_user: dict = Depends(get_current_user)):
    """Create a new email campaign."""
    campaign_id = str(uuid.uuid4())[:8]
    doc = {
        "id": campaign_id,
        "name": data.get("name", "Untitled Campaign"),
        "subject": data.get("subject", ""),
        "body": data.get("body", ""),
        "type": data.get("type", "maintenance"),  # maintenance, security, newsletter, custom
        "recipients": data.get("recipients", "all"),  # all, tier:premium, tag:xyz, manual
        "recipient_list": data.get("recipient_list", []),
        "status": "draft",
        "stats": {"sent": 0, "delivered": 0, "opened": 0, "clicked": 0},
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", ""),
        "sent_at": None,
    }
    await db.campaigns.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/campaigns/{campaign_id}")
async def update_campaign(campaign_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update a campaign."""
    updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for key in ["name", "subject", "body", "type", "recipients", "recipient_list"]:
        if key in data:
            updates[key] = data[key]
    await db.campaigns.update_one({"id": campaign_id}, {"$set": updates})
    return await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})


@router.post("/campaigns/{campaign_id}/send")
async def send_campaign(campaign_id: str, current_user: dict = Depends(get_current_user)):
    """Send a campaign to recipients."""
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not campaign:
        return {"error": "Campaign not found"}

    # Determine recipients
    recipients_filter = campaign.get("recipients", "all")
    if recipients_filter == "all":
        clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(500)
    elif recipients_filter.startswith("tier:"):
        tier = recipients_filter.split(":")[1]
        clients = await db.clients.find({"tier": tier}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(500)
    else:
        manual_ids = campaign.get("recipient_list", [])
        clients = await db.clients.find({"id": {"$in": manual_ids}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(500)

    # Simulate sending (in production, integrate with Resend/SendGrid)
    sent_count = len(clients)
    await db.campaigns.update_one({"id": campaign_id}, {"$set": {
        "status": "sent",
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "stats.sent": sent_count,
        "stats.delivered": sent_count,
        "recipient_details": [{"id": c["id"], "name": c.get("name", ""), "email": c.get("email", "")} for c in clients],
    }})

    return {"message": f"Campaign sent to {sent_count} recipients", "sent": sent_count}


@router.delete("/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a campaign."""
    await db.campaigns.delete_one({"id": campaign_id})
    return {"message": "Deleted"}


@router.get("/campaigns/templates")
async def get_campaign_templates(current_user: dict = Depends(get_current_user)):
    """Get pre-built campaign templates."""
    return [
        {"name": "Scheduled Maintenance", "type": "maintenance", "subject": "Scheduled Maintenance Notice - {date}",
         "body": "Dear {client_name},\n\nWe will be performing scheduled maintenance on {date} from {start_time} to {end_time}.\n\nServices affected: {services}\n\nPlease plan accordingly. Contact us if you have questions.\n\nBest regards,\n{company_name}"},
        {"name": "Security Advisory", "type": "security", "subject": "Important Security Update",
         "body": "Dear {client_name},\n\nWe are writing to inform you of an important security update regarding {topic}.\n\nAction Required: {action}\n\nPlease ensure compliance by {deadline}.\n\nStay secure,\n{company_name}"},
        {"name": "Monthly Newsletter", "type": "newsletter", "subject": "{company_name} Monthly Update - {month}",
         "body": "Dear {client_name},\n\nHere's your monthly IT summary:\n\n- Tickets Resolved: {tickets_resolved}\n- Uptime: {uptime}%\n- New Features: {features}\n\nThank you for your continued partnership.\n\n{company_name}"},
        {"name": "Service Upgrade", "type": "custom", "subject": "Enhance Your IT with {service_name}",
         "body": "Dear {client_name},\n\nWe noticed your current setup could benefit from {service_name}.\n\nBenefits:\n- {benefit_1}\n- {benefit_2}\n- {benefit_3}\n\nWould you like to schedule a quick call to discuss?\n\n{company_name}"},
    ]
