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

# Health probes — MUST be lightweight + synchronous (no DB calls) so K8s readiness
# checks pass immediately even while seed_data / background tasks are warming up.
# Both /health (unprefixed, used by ingress/K8s) and /api/health are exposed.
@app.get("/health")
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "nexusops-api", "version": "3.0.0"}

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
    # Kick heavy DB seeding + ticket backfill off to a background task so uvicorn
    # completes startup fast and production readiness probes (/health) pass on time.
    import asyncio
    asyncio.create_task(_boot_warmup())
    # Start RustDesk auto-sync background task
    asyncio.create_task(_rustdesk_auto_sync_loop())
    # Start recurring invoice auto-generation scheduler
    asyncio.create_task(_recurring_invoice_scheduler())
    # Start 7am morning standup-digest delivery scheduler
    asyncio.create_task(_standup_digest_scheduler())
    logger.info("NexusOps API v3.0.0 started successfully")


async def _boot_warmup():
    """Run seed + ticket-number backfill without blocking app startup."""
    try:
        await seed_data()
    except Exception as e:
        logger.error(f"seed_data failed: {e}")
    try:
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
    except Exception as e:
        logger.error(f"Ticket number backfill failed: {e}")

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

async def _recurring_invoice_scheduler():
    """Background loop that checks for due recurring invoices and auto-generates them."""
    import asyncio
    while True:
        try:
            await asyncio.sleep(300)  # Check every 5 minutes
            now = datetime.now(timezone.utc)
            today_str = now.strftime("%Y-%m-%d")

            # Find active recurring invoices that are due today or overdue
            due_invoices = await db.recurring_invoices.find({
                "status": "active",
                "next_generation": {"$lte": today_str},
            }, {"_id": 0}).to_list(100)

            if not due_invoices:
                continue

            generated_count = 0
            for ri in due_invoices:
                try:
                    import uuid as _uuid
                    inv_number = f"INV-{now.strftime('%Y%m')}-{_uuid.uuid4().hex[:4].upper()}"
                    # Calculate due date from payment terms
                    days_map = {"due_on_receipt": 0, "net_7": 7, "net_14": 14, "net_30": 30, "net_45": 45, "net_60": 60, "net_90": 90}
                    days = days_map.get(ri.get("payment_terms", "net_30"), 30)
                    from datetime import timedelta as _td
                    due_date = (now + _td(days=days)).strftime("%Y-%m-%d")

                    invoice = {
                        "id": f"inv-{_uuid.uuid4().hex[:8]}",
                        "invoice_number": inv_number,
                        "client_id": ri.get("client_id", ""),
                        "client_name": ri.get("client_name", ""),
                        "description": ri.get("description", ""),
                        "line_items": ri.get("line_items", []),
                        "subtotal": ri.get("subtotal", ri.get("amount", 0)),
                        "tax_rate": ri.get("tax_rate", 0),
                        "tax_amount": ri.get("tax_amount", 0),
                        "total": ri.get("amount", 0),
                        "amount_due": ri.get("amount", 0),
                        "amount_paid": 0,
                        "currency": ri.get("currency", "AUD"),
                        "status": "sent",
                        "payment_status": "unpaid",
                        "due_date": due_date,
                        "recurring_invoice_id": ri["id"],
                        "notes": ri.get("notes", ""),
                        "auto_generated": True,
                        "created_at": now.isoformat(),
                        "created_by": "Auto-Scheduler",
                    }
                    await db.invoices.insert_one(invoice)

                    # Calculate next generation date
                    from app.routers.recurring_invoices import _calc_next_date
                    next_date = _calc_next_date(today_str, ri.get("frequency", "monthly"))
                    gen_entry = {
                        "invoice_id": invoice["id"],
                        "invoice_number": inv_number,
                        "amount": ri.get("amount", 0),
                        "generated_at": now.isoformat(),
                        "generated_by": "Auto-Scheduler",
                    }
                    await db.recurring_invoices.update_one({"id": ri["id"]}, {
                        "$inc": {"invoices_generated": 1, "total_billed": ri.get("amount", 0)},
                        "$set": {"last_generated": now.isoformat(), "next_generation": next_date, "updated_at": now.isoformat()},
                        "$push": {"generation_history": gen_entry},
                    })
                    generated_count += 1

                    # Log the auto-generation
                    await db.scheduler_logs.insert_one({
                        "id": f"slog-{_uuid.uuid4().hex[:8]}",
                        "type": "recurring_invoice",
                        "recurring_invoice_id": ri["id"],
                        "invoice_id": invoice["id"],
                        "invoice_number": inv_number,
                        "client_name": ri.get("client_name", ""),
                        "amount": ri.get("amount", 0),
                        "auto_send": ri.get("auto_send", False),
                        "status": "generated",
                        "timestamp": now.isoformat(),
                    })

                except Exception as e:
                    logger.error(f"Failed to auto-generate invoice for {ri.get('id')}: {e}")
                    await db.scheduler_logs.insert_one({
                        "type": "recurring_invoice_error",
                        "recurring_invoice_id": ri.get("id"),
                        "error": str(e),
                        "timestamp": now.isoformat(),
                    })

            if generated_count > 0:
                logger.info(f"Recurring invoice scheduler: auto-generated {generated_count} invoices")

        except Exception as e:
            logger.debug(f"Recurring invoice scheduler error: {e}")
            import asyncio
            await asyncio.sleep(60)

# Shutdown event
@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

async def _standup_digest_scheduler():
    """Background loop: once per minute check if digest is due for any admin; deliver via configured channels."""
    import asyncio
    # Small grace period after boot so DB + routers settle
    await asyncio.sleep(30)
    while True:
        try:
            cfg_doc = await db.settings.find_one({"key": "standup_digest"}, {"_id": 0}) or {}
            val = cfg_doc.get("value", {})
            if not val.get("enabled", False):
                await asyncio.sleep(60)
                continue

            send_hour = int(val.get("send_hour_local", 7))
            tz_name = val.get("timezone", "Australia/Sydney")
            window_hours = int(val.get("window_hours", 12))
            channels = val.get("channels", {"banner": True, "email": False, "sms": False})
            email_to = val.get("email_to", []) or []
            sms_to = val.get("sms_to", []) or []

            try:
                from zoneinfo import ZoneInfo
                now_local = datetime.now(timezone.utc).astimezone(ZoneInfo(tz_name))
            except Exception:
                now_local = datetime.now(timezone.utc)

            today_tag = now_local.strftime("%Y-%m-%d")
            last_tag = val.get("last_sent_tag")
            # Only deliver once per day, at or after the configured hour
            if now_local.hour == send_hour and last_tag != today_tag:
                from app.routers.ai_wave_a import _build_overnight_snapshot, _format_digest_prompt, _llm_complete
                snap = await _build_overnight_snapshot(hours=window_hours)
                prompt_body = _format_digest_prompt(snap)
                system = (
                    "You are the 7am MSP standup briefer. Produce a 4-6 bullet briefing for the service-desk "
                    "team. Lead with what requires IMMEDIATE action, then note SLA risk, then ops health. "
                    "Be concrete (use numbers and client names). Plain text, no markdown headers, no preamble."
                )
                ai_brief = await _llm_complete(system, prompt_body, session_prefix="digest-sched")
                if ai_brief.startswith("__AI_"):
                    ai_brief = "AI briefing unavailable today."

                # Persist as a digest record
                digest_doc = {
                    "id": f"digest-{now_local.strftime('%Y%m%d-%H%M')}",
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "window_hours": window_hours,
                    "ai_brief": ai_brief,
                    "stats": {
                        "new_tickets": snap["new_ticket_count"],
                        "critical_open": len(snap["critical_open"]),
                        "sla_breaches": len(snap["sla_breaches"]),
                        "offline_devices": snap["offline_devices"],
                        "warning_devices": snap["warning_devices"],
                        "failed_backups": snap["failed_backups"],
                        "active_alerts": snap["active_alerts"],
                        "overdue_invoices_count": snap["overdue_invoices_count"],
                        "overdue_total": snap["overdue_total"],
                    },
                    "delivery": {"scheduled": True},
                }
                try:
                    await db.standup_digests.insert_one(digest_doc)
                except Exception:
                    pass

                # Email delivery
                if channels.get("email") and email_to:
                    try:
                        from app.routers.email_utils import send_email, is_resend_configured
                        if is_resend_configured():
                            html = (
                                f"<h2>NexusOps Morning Standup · {today_tag}</h2>"
                                f"<pre style='font-family:inherit;white-space:pre-wrap'>{ai_brief}</pre>"
                                f"<hr><small>Window: last {window_hours}h · {snap['new_ticket_count']} new tickets · "
                                f"{len(snap['critical_open'])} critical · {snap['offline_devices']} offline devices.</small>"
                            )
                            for addr in email_to:
                                try:
                                    await send_email(addr, f"Morning Standup Digest — {today_tag}", html)
                                except Exception as _e:
                                    logger.warning(f"Digest email to {addr} failed: {_e}")
                    except Exception as e:
                        logger.warning(f"Digest email delivery error: {e}")

                # SMS delivery
                if channels.get("sms") and sms_to:
                    try:
                        from app.routers.sms import _send_via_provider
                        # First line only, keep under 160 chars
                        first_line = (ai_brief.split("\n")[0] or "")[:140]
                        sms_body = f"NexusOps AM: {first_line}"
                        for num in sms_to:
                            try:
                                await _send_via_provider(num, sms_body)
                            except Exception as _e:
                                logger.warning(f"Digest SMS to {num} failed: {_e}")
                    except Exception as e:
                        logger.warning(f"Digest SMS delivery error: {e}")

                # Mark sent
                await db.settings.update_one(
                    {"key": "standup_digest"},
                    {"$set": {"value.last_sent_tag": today_tag, "value.last_run_at": datetime.now(timezone.utc).isoformat()}},
                    upsert=True,
                )
                logger.info(f"Morning Standup Digest delivered for {today_tag} (email={bool(channels.get('email'))}, sms={bool(channels.get('sms'))})")

            await asyncio.sleep(60)
        except Exception as e:
            logger.debug(f"Digest scheduler error: {e}")
            import asyncio as _a
            await _a.sleep(120)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
