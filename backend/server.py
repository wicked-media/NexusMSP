from fastapi import FastAPI, Request as FastAPIRequest
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from datetime import datetime, timezone
import os
import logging
import importlib
import pkgutil

from app.database import db, client, UPLOADS_DIR
from app.services.seed import seed_data

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="NexusOps API", version="3.0.0")

# Static files for uploads
app.mount("/api/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# Auto-discover and register all routers from app/routers/
# Priority ordering ensures specific routes are matched before dynamic ones
ROUTER_PRIORITY = [
    "auth",
    "ticket_attachments", "ticket_email_notifications",
    "device_discovery", "device_viewers", "device_chat",
    "invoice_pdf",
]

def discover_and_register_routers():
    import app.routers as routers_pkg
    discovered = {}
    for _importer, modname, _ispkg in pkgutil.iter_modules(routers_pkg.__path__):
        if modname.startswith('_'):
            continue
        try:
            module = importlib.import_module(f'app.routers.{modname}')
            if hasattr(module, 'router'):
                discovered[modname] = module
        except Exception as e:
            logger.warning(f"Failed to import router '{modname}': {e}")

    # Register priority routers first (order matters for route matching)
    registered = set()
    for name in ROUTER_PRIORITY:
        if name in discovered:
            app.include_router(discovered[name].router, prefix="/api")
            registered.add(name)

    # Register remaining routers alphabetically
    for name in sorted(discovered.keys()):
        if name not in registered:
            app.include_router(discovered[name].router, prefix="/api")
            registered.add(name)

    logger.info(f"Auto-discovered and registered {len(registered)} routers")

discover_and_register_routers()

# Root endpoint
@app.get("/api/")
async def root():
    return {"message": "NexusOps API v3.0.0", "status": "operational"}

# Stripe webhook
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
    # Start RustDesk auto-sync background task
    import asyncio
    asyncio.create_task(_rustdesk_auto_sync_loop())
    logger.info("NexusOps API v3.0.0 started successfully")

async def _rustdesk_auto_sync_loop():
    """Background loop that syncs RustDesk peers every 5 minutes if enabled."""
    import asyncio
    while True:
        try:
            await asyncio.sleep(300)  # 5 minutes
            config = await db.settings.find_one({"key": "rustdesk_config"}, {"_id": 0})
            if not config:
                continue
            val = config.get("value", {})
            if not val.get("enabled") or not val.get("server_url") or not val.get("auto_sync", True):
                continue
            # Import and call sync logic
            try:
                from app.routers.rustdesk import _rustdesk_api_request
                import httpx
                server_url = val["server_url"].rstrip("/")
                api_key = val.get("api_key", "")
                headers_dict = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                peers = []
                async with httpx.AsyncClient(timeout=15.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()=='true') as cl:
                    for path in ["/peers", "/v1/peers", "/ab/peers"]:
                        try:
                            resp = await cl.get(f"{server_url}/api{path}", headers=headers_dict)
                            if resp.status_code == 200:
                                data = resp.json()
                                if isinstance(data, list):
                                    peers = data; break
                                elif isinstance(data, dict) and "data" in data:
                                    peers = data["data"]; break
                        except Exception:
                            continue
                if peers:
                    import uuid
                    now = datetime.now(timezone.utc).isoformat()
                    for p in peers:
                        rd_id = str(p.get("id") or p.get("Id") or p.get("peer_id") or "")
                        if not rd_id:
                            continue
                        online = p.get("online", False) if isinstance(p.get("online"), bool) else str(p.get("online", "")).lower() in ["true", "1"]
                        status = "online" if online else "offline"
                        await db.devices.update_many({"rustdesk_id": rd_id}, {"$set": {"status": status, "rd_last_seen": now}})
                        await db.rustdesk_devices.update_many({"rustdesk_id": rd_id}, {"$set": {"status": status, "last_online": now if online else None}})
                    await db.settings.update_one({"key": "rustdesk_config"}, {"$set": {"value.last_auto_sync": now, "value.last_auto_sync_peers": len(peers)}})
                    logger.info(f"RustDesk auto-sync: {len(peers)} peers synced")
            except Exception as e:
                logger.debug(f"RustDesk auto-sync skipped: {e}")
        except Exception as e:
            logger.debug(f"RustDesk auto-sync loop error: {e}")
            import asyncio
            await asyncio.sleep(60)

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
