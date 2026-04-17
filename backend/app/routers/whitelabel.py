from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
import os
from app.database import db
from app.auth import get_current_user

router = APIRouter()

UPLOAD_DIR = "/app/backend/uploads/branding"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ============== WHITE LABEL / BRANDING ==============

@router.get("/settings/branding")
async def get_branding(current_user: dict = Depends(get_current_user)):
    branding = await db.settings.find_one({"type": "branding"}, {"_id": 0})
    return branding or _default_branding()


@router.get("/settings/branding/public")
async def get_branding_public():
    """Public endpoint for login page and sidebar branding (no auth)."""
    branding = await db.settings.find_one({"type": "branding"}, {"_id": 0})
    b = branding or _default_branding()
    return {
        "company_name": b.get("company_name", "NexusOps"),
        "company_logo_url": b.get("company_logo_url", ""),
        "company_icon_url": b.get("company_icon_url", ""),
        "favicon_url": b.get("favicon_url", ""),
        "primary_color": b.get("primary_color", "#10b981"),
        "accent_color": b.get("accent_color", "#06b6d4"),
        "login_tagline": b.get("login_tagline", ""),
        "login_features": b.get("login_features", []),
        "powered_by_visible": b.get("powered_by_visible", True),
    }


def _default_branding():
    return {
        "type": "branding",
        "company_name": "NexusOps",
        "company_logo_url": "",
        "company_icon_url": "",
        "primary_color": "#10b981",
        "secondary_color": "#8b5cf6",
        "accent_color": "#06b6d4",
        "login_tagline": "Unified RMM & PSA platform for modern managed service providers",
        "login_features": ["RMM", "Ticketing", "Invoicing", "Networking", "Assets", "Reporting"],
        "powered_by_visible": True,
        "sidebar_style": "default",
        "invoice_logo_url": "",
        "invoice_header_text": "",
        "invoice_footer_text": "",
        "email_sender_name": "",
        "email_footer_text": "",
        "favicon_url": "",
        "updated_at": None,
    }

@router.put("/settings/branding")
async def update_branding(data: dict, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    data["type"] = "branding"
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one({"type": "branding"}, {"$set": data}, upsert=True)
    return {"message": "Branding settings updated"}

@router.post("/settings/branding/upload-logo")
async def upload_branding_logo(logo_type: str = "company", file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    ext = file.filename.split(".")[-1] if "." in file.filename else "png"
    filename = f"{logo_type}_{uuid.uuid4().hex[:8]}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")
    
    with open(filepath, "wb") as f:
        f.write(content)
    
    logo_url = f"/api/uploads/branding/{filename}"
    
    field_map = {
        "company": "company_logo_url",
        "invoice": "invoice_logo_url",
        "letterhead": "letterhead_logo_url",
        "contract": "contract_logo_url",
        "icon": "company_icon_url",
        "favicon": "favicon_url",
    }
    field = field_map.get(logo_type, "company_logo_url")
    
    await db.settings.update_one(
        {"type": "branding"},
        {"$set": {field: logo_url, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    
    return {"message": f"{logo_type} logo uploaded", "url": logo_url}

@router.post("/clients/{client_id}/upload-logo")
async def upload_client_logo(client_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    ext = file.filename.split(".")[-1] if "." in file.filename else "png"
    filename = f"client_{client_id[:8]}_{uuid.uuid4().hex[:8]}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    
    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)
    
    logo_url = f"/api/uploads/branding/{filename}"
    await db.clients.update_one({"id": client_id}, {"$set": {"logo_url": logo_url}})
    
    return {"message": "Client logo uploaded", "url": logo_url}

# ============== CLIENT TENURE ACHIEVEMENTS ==============

TENURE_ACHIEVEMENTS = {
    "1_year": {"label": "1 Year Partner", "description": "Loyal client for 1 year", "months": 12, "color": "#60a5fa", "tier": "blue"},
    "2_years": {"label": "2 Year Partner", "description": "Trusted partnership for 2 years", "months": 24, "color": "#a78bfa", "tier": "purple"},
    "3_years": {"label": "3 Year Veteran", "description": "Long-standing client for 3 years", "months": 36, "color": "#34d399", "tier": "emerald"},
    "5_years": {"label": "5 Year Champion", "description": "Champion client for 5 years", "months": 60, "color": "#f59e0b", "tier": "amber"},
    "10_years": {"label": "Decade Partner", "description": "An incredible 10-year partnership", "months": 120, "color": "#f97316", "tier": "gold"},
    "15_years": {"label": "Legacy Partner", "description": "15 years of unwavering trust", "months": 180, "color": "#ef4444", "tier": "ruby"},
    "20_years": {"label": "Platinum Partner", "description": "A legendary 20-year partnership", "months": 240, "color": "#e2e8f0", "tier": "platinum"},
}

SLA_ACHIEVEMENTS = {
    "gold": {"label": "Gold SLA", "description": "Premium 4-hour response guarantee", "icon": "shield", "color": "#fbbf24", "tier": "gold"},
    "silver": {"label": "Silver SLA", "description": "Priority 8-hour response guarantee", "icon": "shield", "color": "#94a3b8", "tier": "silver"},
    "bronze": {"label": "Bronze SLA", "description": "Standard support agreement", "icon": "shield", "color": "#d97706", "tier": "bronze"},
    "platinum": {"label": "Platinum SLA", "description": "Elite 1-hour response guarantee", "icon": "shield", "color": "#e2e8f0", "tier": "platinum"},
    "standard": {"label": "Standard SLA", "description": "24-hour response commitment", "icon": "shield", "color": "#6b7280", "tier": "standard"},
}

@router.get("/clients/{client_id}/achievements")
async def get_client_achievements(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    achievements = []
    
    # Calculate tenure
    created_at = client.get("created_at")
    if created_at:
        if isinstance(created_at, str):
            try:
                created = datetime.fromisoformat(created_at)
            except:
                created = datetime.now(timezone.utc)
        else:
            created = created_at
        
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        months_active = (datetime.now(timezone.utc) - created).days // 30
        
        for key, ach in TENURE_ACHIEVEMENTS.items():
            if months_active >= ach["months"]:
                achievements.append({
                    "id": f"tenure_{key}",
                    "type": "tenure",
                    "key": key,
                    "label": ach["label"],
                    "description": ach["description"],
                    "color": ach["color"],
                    "tier": ach["tier"],
                    "earned": True,
                    "earned_at": (created + timedelta(days=ach["months"] * 30)).isoformat(),
                })
            else:
                achievements.append({
                    "id": f"tenure_{key}",
                    "type": "tenure",
                    "key": key,
                    "label": ach["label"],
                    "description": ach["description"],
                    "color": ach["color"],
                    "tier": ach["tier"],
                    "earned": False,
                    "progress": round(min(100, (months_active / ach["months"]) * 100), 1),
                })
    
    # SLA achievements from contracts
    contracts = await db.contracts.find({"client_id": client_id, "status": "active"}, {"_id": 0}).to_list(20)
    sla_tiers_earned = set()
    for c in contracts:
        tier = c.get("sla_tier", "standard")
        if tier in SLA_ACHIEVEMENTS:
            sla_tiers_earned.add(tier)
    
    for key, ach in SLA_ACHIEVEMENTS.items():
        achievements.append({
            "id": f"sla_{key}",
            "type": "sla",
            "key": key,
            "label": ach["label"],
            "description": ach["description"],
            "icon": ach["icon"],
            "color": ach["color"],
            "tier": ach["tier"],
            "earned": key in sla_tiers_earned,
        })
    
    # Loyalty achievements
    total_tickets = await db.tickets.count_documents({"client_id": client_id})
    total_invoices = await db.invoices.count_documents({"client_id": client_id})
    
    loyalty_badges = [
        {"key": "first_ticket", "label": "First Ticket", "description": "Submitted their first support request", "threshold": 1, "current": total_tickets, "color": "#60a5fa"},
        {"key": "power_user", "label": "Power User", "description": "50+ tickets submitted", "threshold": 50, "current": total_tickets, "color": "#8b5cf6"},
        {"key": "first_invoice", "label": "First Payment", "description": "First invoice paid", "threshold": 1, "current": total_invoices, "color": "#34d399"},
        {"key": "loyal_payer", "label": "Loyal Payer", "description": "10+ invoices processed", "threshold": 10, "current": total_invoices, "color": "#f59e0b"},
    ]
    
    for badge in loyalty_badges:
        achievements.append({
            "id": f"loyalty_{badge['key']}",
            "type": "loyalty",
            "key": badge["key"],
            "label": badge["label"],
            "description": badge["description"],
            "color": badge["color"],
            "tier": "loyalty",
            "earned": badge["current"] >= badge["threshold"],
            "progress": round(min(100, (badge["current"] / badge["threshold"]) * 100), 1) if badge["current"] < badge["threshold"] else 100,
        })
    
    return {
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "achievements": achievements,
        "total_earned": sum(1 for a in achievements if a.get("earned")),
        "total_available": len(achievements),
    }

# ============== CLIENT LOYALTY & READINESS ==============

@router.get("/clients/{client_id}/loyalty")
async def get_client_loyalty(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    tickets = await db.tickets.count_documents({"client_id": client_id})
    invoices = await db.invoices.find({"client_id": client_id}, {"_id": 0}).to_list(100)
    total_paid = sum(float(i.get("amount_paid", 0)) for i in invoices)
    contracts = await db.contracts.find({"client_id": client_id, "status": "active"}, {"_id": 0}).to_list(10)
    
    loyalty_points = tickets * 5 + len(invoices) * 10 + int(total_paid / 100) + len(contracts) * 50
    
    if loyalty_points >= 1000:
        tier = "platinum"
    elif loyalty_points >= 500:
        tier = "gold"
    elif loyalty_points >= 200:
        tier = "silver"
    else:
        tier = "bronze"
    
    return {
        "client_id": client_id,
        "client_name": client.get("name"),
        "loyalty_points": loyalty_points,
        "tier": tier,
        "total_spend": total_paid,
        "total_tickets": tickets,
        "total_invoices": len(invoices),
        "active_contracts": len(contracts),
        "discount_eligible": loyalty_points >= 500,
        "suggested_discount": 5 if tier == "gold" else 10 if tier == "platinum" else 0,
    }

@router.get("/clients/{client_id}/portal-readiness")
async def get_portal_readiness(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    checks = []
    score = 0
    total = 8
    
    # Check contacts
    contacts = client.get("contacts", [])
    has_primary = any(c.get("is_primary") for c in contacts)
    checks.append({"name": "Primary Contact", "done": has_primary, "description": "Has a primary contact designated"})
    if has_primary: score += 1
    
    has_email = bool(client.get("email"))
    checks.append({"name": "Email Address", "done": has_email, "description": "Company email address on file"})
    if has_email: score += 1
    
    has_phone = bool(client.get("phone"))
    checks.append({"name": "Phone Number", "done": has_phone, "description": "Phone number on file"})
    if has_phone: score += 1
    
    has_address = bool(client.get("address"))
    checks.append({"name": "Address", "done": has_address, "description": "Physical address recorded"})
    if has_address: score += 1
    
    devices = await db.devices.count_documents({"client_id": client_id})
    checks.append({"name": "Devices Registered", "done": devices > 0, "description": "At least one device registered"})
    if devices > 0: score += 1
    
    contracts = await db.contracts.count_documents({"client_id": client_id, "status": "active"})
    checks.append({"name": "Active Contract", "done": contracts > 0, "description": "Has an active service contract"})
    if contracts > 0: score += 1
    
    has_logo = bool(client.get("logo_url"))
    checks.append({"name": "Company Logo", "done": has_logo, "description": "Company logo uploaded"})
    if has_logo: score += 1
    
    has_industry = bool(client.get("industry"))
    checks.append({"name": "Industry Set", "done": has_industry, "description": "Industry classification set"})
    if has_industry: score += 1
    
    return {
        "client_id": client_id,
        "client_name": client.get("name"),
        "readiness_score": round((score / total) * 100),
        "checks": checks,
        "completed": score,
        "total": total,
    }

# ============== CONTRACT AUTO-RENEWAL PROPOSALS ==============

@router.get("/contracts/auto-renewal-proposals")
async def get_auto_renewal_proposals(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    from datetime import timedelta
    cutoff = (now + timedelta(days=60)).strftime("%Y-%m-%d")
    
    contracts = await db.contracts.find({
        "status": "active",
        "end_date": {"$lte": cutoff, "$ne": "", "$exists": True},
    }, {"_id": 0}).to_list(100)
    
    proposals = []
    for c in contracts:
        client = await db.clients.find_one({"id": c.get("client_id")}, {"_id": 0})
        devices = await db.devices.count_documents({"client_id": c.get("client_id")})
        tickets_30d = await db.tickets.count_documents({
            "client_id": c.get("client_id"),
            "created_at": {"$gte": (now - timedelta(days=30)).isoformat()}
        })
        
        upsell = []
        current_value = float(c.get("value", 0))
        sla_tier = c.get("sla_tier", "standard")
        
        if sla_tier == "standard":
            upsell.append({"type": "sla_upgrade", "description": "Upgrade to Silver SLA (8h response)", "additional_mrr": current_value * 0.15})
        elif sla_tier == "silver":
            upsell.append({"type": "sla_upgrade", "description": "Upgrade to Gold SLA (4h response)", "additional_mrr": current_value * 0.2})
        elif sla_tier == "gold":
            upsell.append({"type": "sla_upgrade", "description": "Upgrade to Platinum SLA (1h response)", "additional_mrr": current_value * 0.3})
        
        if devices < 10:
            upsell.append({"type": "device_expansion", "description": f"Currently managing {devices} devices - room for fleet expansion", "additional_mrr": 15 * (10 - devices)})
        
        if tickets_30d > 5:
            upsell.append({"type": "proactive", "description": "High ticket volume - suggest proactive monitoring package", "additional_mrr": 200})
        
        try:
            end = datetime.strptime(c["end_date"][:10], "%Y-%m-%d")
            days_remaining = (end - now.replace(tzinfo=None)).days
        except:
            days_remaining = 30
        
        proposals.append({
            "contract_id": c["id"],
            "contract_name": c.get("name", ""),
            "client_id": c.get("client_id", ""),
            "client_name": c.get("client_name", client.get("name", "") if client else ""),
            "current_value": current_value,
            "sla_tier": sla_tier,
            "end_date": c.get("end_date", ""),
            "days_remaining": days_remaining,
            "auto_renew": c.get("auto_renew", False),
            "upsell_opportunities": upsell,
            "total_upsell_potential": sum(u.get("additional_mrr", 0) for u in upsell),
            "recommended_new_value": current_value + sum(u.get("additional_mrr", 0) for u in upsell),
        })
    
    proposals.sort(key=lambda x: x["days_remaining"])
    
    return {
        "proposals": proposals,
        "total_current_mrr": sum(p["current_value"] for p in proposals),
        "total_potential_mrr": sum(p["recommended_new_value"] for p in proposals),
        "total_upsell_potential": sum(p["total_upsell_potential"] for p in proposals),
    }

# ============== LOYALTY DASHBOARD ==============

@router.get("/loyalty/dashboard")
async def get_loyalty_dashboard(current_user: dict = Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0}).to_list(500)
    
    tier_counts = {"platinum": 0, "gold": 0, "silver": 0, "bronze": 0}
    client_loyalties = []
    
    for client in clients:
        client_id = client["id"]
        tickets = await db.tickets.count_documents({"client_id": client_id})
        invoices = await db.invoices.find({"client_id": client_id}, {"_id": 0}).to_list(100)
        total_paid = sum(float(i.get("amount_paid", 0)) for i in invoices)
        contracts = await db.contracts.count_documents({"client_id": client_id, "status": "active"})
        
        points = tickets * 5 + len(invoices) * 10 + int(total_paid / 100) + contracts * 50
        tier = "platinum" if points >= 1000 else "gold" if points >= 500 else "silver" if points >= 200 else "bronze"
        tier_counts[tier] += 1
        
        client_loyalties.append({
            "client_id": client_id,
            "client_name": client.get("name", ""),
            "loyalty_points": points,
            "tier": tier,
            "total_spend": total_paid,
            "active_contracts": contracts,
        })
    
    client_loyalties.sort(key=lambda x: x["loyalty_points"], reverse=True)
    
    return {
        "tier_counts": tier_counts,
        "total_clients": len(clients),
        "clients": client_loyalties[:30],
    }
