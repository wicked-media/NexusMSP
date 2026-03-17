from fastapi import FastAPI, Request as FastAPIRequest
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from datetime import datetime, timezone
import os
import logging

from app.database import db, client, UPLOADS_DIR
from app.services.seed import seed_data

# Import all routers
from app.routers import (
    auth, clients, clients_contacts, tickets, devices, assets, contracts,
    invoices, time_entries, knowledge_base, integrations, dashboard,
    technicians, scheduling, products, networking, purchase_orders,
    remote, crm, scripting, it_docs, portal, projects, admin,
    infrastructure, yeastar, activity_logs, achievements,
    technicians_profile, microsoft_config, vendors, rentals, ticket_categories,
    suped, splynx, hudu, ticket_suggestions, ai_service, xero, syncro,
    o365_mailbox, asset_lifecycle, predictive_maintenance, event_bus, health_radar,
    whitelabel, ticket_ping
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="NexusOps API", version="3.0.0")

# Static files for uploads
app.mount("/api/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# Include all routers with /api prefix
all_routers = [
    auth, clients, clients_contacts, tickets, devices, assets, contracts,
    invoices, time_entries, knowledge_base, integrations, dashboard,
    technicians, scheduling, products, networking, purchase_orders,
    remote, crm, scripting, it_docs, portal, projects, admin,
    infrastructure, yeastar, activity_logs, achievements,
    technicians_profile, microsoft_config, vendors, rentals, ticket_categories,
    suped, splynx, hudu, ticket_suggestions, ai_service, xero, syncro,
    o365_mailbox, asset_lifecycle, predictive_maintenance, event_bus, health_radar,
    whitelabel, ticket_ping
]

for router_module in all_routers:
    app.include_router(router_module.router, prefix="/api")

# Root endpoint
@app.get("/api/")
async def root():
    return {"message": "NexusOps API v3.0.0", "status": "operational"}

# Stripe webhook - outside api prefix since it needs raw body
@app.post("/api/webhook/stripe")
async def stripe_webhook(request: FastAPIRequest):
    body = await request.body()
    sig = request.headers.get("Stripe-Signature", "")
    stripe_key = os.environ.get("STRIPE_API_KEY")
    if not stripe_key:
        return {"status": "stripe not configured"}
    try:
        from emergentintegrations.payments.stripe.checkout import StripeCheckout
        stripe_checkout = StripeCheckout(api_key=stripe_key, webhook_url="")
        webhook_response = await stripe_checkout.handle_webhook(body, sig)
        if webhook_response.payment_status == "paid" and webhook_response.session_id:
            existing = await db.payment_transactions.find_one({"session_id": webhook_response.session_id, "payment_status": "paid"})
            if not existing:
                await db.payment_transactions.update_one(
                    {"session_id": webhook_response.session_id},
                    {"$set": {"payment_status": "paid", "updated_at": datetime.now(timezone.utc).isoformat()}}
                )
                inv_id = webhook_response.metadata.get("invoice_id")
                if inv_id:
                    invoice = await db.invoices.find_one({"id": inv_id}, {"_id": 0})
                    if invoice:
                        new_paid = float(invoice.get("amount_paid", 0)) + float(webhook_response.amount_total / 100)
                        p_status = "paid" if new_paid >= float(invoice.get("total", 0)) else "partial"
                        await db.invoices.update_one({"id": inv_id}, {
                            "$set": {"payment_status": p_status, "amount_paid": new_paid,
                                     "status": "paid" if p_status == "paid" else invoice.get("status"),
                                     "paid_date": datetime.now(timezone.utc).strftime("%Y-%m-%d") if p_status == "paid" else None},
                            "$push": {"payments": {"amount": webhook_response.amount_total / 100, "method": "stripe",
                                                   "date": datetime.now(timezone.utc).isoformat(), "session_id": webhook_response.session_id}}
                        })
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return {"status": "error", "detail": str(e)}

# Startup event
@app.on_event("startup")
async def startup_event():
    await seed_data()
    # Assign ticket numbers to existing tickets that don't have one
    from app.routers.ticket_suggestions import generate_ticket_number
    tickets_without_number = await db.tickets.find(
        {"$or": [{"ticket_number": None}, {"ticket_number": {"$exists": False}}, {"ticket_number": ""}]},
        {"_id": 0, "id": 1, "ticket_type": 1}
    ).to_list(1000)
    for t in tickets_without_number:
        tn = await generate_ticket_number(t.get("ticket_type", "incident"))
        await db.tickets.update_one({"id": t["id"]}, {"$set": {"ticket_number": tn}})
    if tickets_without_number:
        logger.info(f"Assigned ticket numbers to {len(tickets_without_number)} tickets")
    logger.info("NexusOps API v3.0.0 started successfully")

# Shutdown event
@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
