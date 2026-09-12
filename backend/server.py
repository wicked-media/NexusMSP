from fastapi import APIRouter, FastAPI, HTTPException, Request as FastAPIRequest
from fastapi.routing import APIRoute
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from datetime import datetime, timezone
import asyncio
import os
import logging
import importlib
import pkgutil
import re
import time
import uuid

from app.database import db, client, UPLOADS_DIR
from app.services.seed import seed_data
from app.services.runtime_config import background_workers_enabled, cors_origins, demo_seed_enabled

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="NexusOps API", version="3.0.0")
_background_tasks: set[asyncio.Task] = set()
_warmup_complete = False

_CORRELATION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


@app.middleware("http")
async def nexus_correlation_middleware(request: FastAPIRequest, call_next):
    """Carry one safe correlation ID through every Nexus API request."""
    supplied = str(request.headers.get("X-Correlation-ID") or "").strip()
    correlation_id = supplied if _CORRELATION_ID_RE.fullmatch(supplied) else str(uuid.uuid4())
    request.state.correlation_id = correlation_id
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        logger.exception(
            "request_failed correlation_id=%s method=%s path=%s elapsed_ms=%s",
            correlation_id,
            request.method,
            request.url.path,
            elapsed_ms,
        )
        raise
    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    response.headers["X-Correlation-ID"] = correlation_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    # PDFs are displayed inside the authenticated Nexus document preview. The
    # SPA and API use separate origins in development (and can do so in a
    # channel deployment), so SAMEORIGIN would incorrectly block a trusted
    # Nexus preview. Scope PDF framing to the configured application origins
    # with CSP instead; every non-document response remains unframeable.
    if str(response.headers.get("content-type", "")).startswith("application/pdf"):
        if "X-Frame-Options" in response.headers:
            del response.headers["X-Frame-Options"]
        trusted_frames = " ".join(origin for origin in cors_origins() if origin != "*")
        response.headers["Content-Security-Policy"] = f"frame-ancestors 'self' {trusted_frames}".strip()
    else:
        response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    logger.info(
        "request_complete correlation_id=%s method=%s path=%s status=%s elapsed_ms=%s",
        correlation_id,
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response

# Ticket evidence is served only through the scoped ticket attachment router.
# Block the legacy static location before registering the general public upload
# mount so known filenames cannot bypass ticket authorisation.
@app.api_route("/api/uploads/ticket_attachments/{legacy_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def block_public_ticket_attachment(legacy_path: str):
    raise HTTPException(status_code=404, detail="Not found")

# Client documents are customer-owned evidence. Historical records once stored
# them under the public uploads mount, so reject that path before static files
# are registered and force every download through the client-scoped route.
@app.api_route("/api/uploads/client-documents/{legacy_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def block_public_client_document(legacy_path: str):
    raise HTTPException(status_code=404, detail="Not found")

# Static files for public uploads (avatars, branding and public help assets).
app.mount("/api/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# Auto-discover and register all routers from app/routers/
# Priority ordering ensures specific routes are matched before dynamic ones
ROUTER_PRIORITY = [
    "auth",
    # The client portal also exposes /tickets. Register the technician-facing
    # ticket router first so the main application does not match portal routes.
    "tickets",
    "ticket_attachments", "ticket_email_notifications",
    "device_discovery", "device_viewers", "device_chat",
    "invoice_pdf",
]


# FastAPI matches route parameters by position and converter, not by the
# parameter variable name.  Keep registry ownership equally structural so
# ``/{invoice_id}`` and ``/{id}`` cannot silently register as two handlers for
# the same live URL.
_ROUTE_PARAMETER_RE = re.compile(r"\{[^}]+\}")


def _canonical_http_path(path: str) -> str:
    """Return the structural path FastAPI uses for collision ownership."""
    return _ROUTE_PARAMETER_RE.sub("{param}", path)


# Some older feature bundles still expose a handler at a path that a newer,
# already-live router owns.  FastAPI accepts both registrations and resolves
# requests to whichever was included first, which used to leave an unreachable
# handler in the app and generated duplicate OpenAPI operation IDs.  Keep the
# current public behaviour deterministic by declaring the existing owner here;
# the registration guard below excludes only the historical shadow route.
#
# New duplicate HTTP operations are *not* permitted.  They fail application
# construction with an actionable error instead of silently changing routing
# precedence in a future release.
_LEGACY_HTTP_OPERATION_OWNERS: dict[tuple[str, str], str] = {
    ("/api/tickets/active-viewers", "GET"): "tickets",
    ("/api/devices/{device_id}/chat", "GET"): "device_chat",
    ("/api/devices/{device_id}/chat", "POST"): "device_chat",
    ("/api/acronis/test-connection", "GET"): "acronis",
    ("/api/acronis/subscriptions", "GET"): "acronis",
    ("/api/schedule", "GET"): "admin",
    ("/api/schedule", "POST"): "admin",
    ("/api/clients/{client_id}/subscriptions", "GET"): "client_360",
    ("/api/contracts/auto-renewal-proposals", "GET"): "contracts",
    ("/api/huntress/test-connection", "GET"): "huntress",
    ("/api/huntress/agents", "GET"): "huntress",
    ("/api/proxmox/vms", "GET"): "infrastructure",
    ("/api/warranties", "GET"): "infrastructure",
    ("/api/warranties", "POST"): "infrastructure",
    ("/api/warranties/{warranty_id}", "DELETE"): "infrastructure",
    ("/api/vendors", "GET"): "infrastructure",
    ("/api/vendors", "POST"): "infrastructure",
    ("/api/vendors/{vendor_id}", "PUT"): "infrastructure",
    ("/api/vendors/{vendor_id}", "DELETE"): "infrastructure",
    # The live owner has historically been ``admin``.  The route parameter
    # names differed, which previously hid this duplicate from the registry.
    ("/api/schedule/{schedule_id}", "PUT"): "admin",
    ("/api/schedule/{schedule_id}", "DELETE"): "admin",
    ("/api/runbooks", "GET"): "it_docs",
}

# Keep the declarations readable with their public parameter names, while all
# collision checks below use the structural representation FastAPI matches.
_LEGACY_HTTP_OPERATION_OWNERS = {
    (_canonical_http_path(path), method): owner
    for (path, method), owner in _LEGACY_HTTP_OPERATION_OWNERS.items()
}


def _http_operation_keys(route: APIRoute, *, prefix: str) -> set[tuple[str, str]]:
    """Return the concrete method/path keys FastAPI will register for a route."""
    path = _canonical_http_path(f"{prefix}{route.path_format}")
    return {(path, method.upper()) for method in (route.methods or set())}


def _include_router_without_shadowed_operations(
    name: str,
    source_router: APIRouter,
    *,
    prefix: str,
    operation_owners: dict[tuple[str, str], str],
) -> None:
    """Include one router while rejecting ambiguous HTTP operation ownership.

    ``FastAPI.include_router`` deliberately permits duplicate routes.  Nexus
    auto-discovers a large router catalogue, so that permissive behaviour made
    accidental overlap particularly easy to miss.  A source route is skipped
    only when every one of its operations is a documented historical shadow;
    all other collisions stop startup so a new endpoint cannot silently become
    unreachable.
    """
    selected_routes = []
    for route in source_router.routes:
        if not isinstance(route, APIRoute):
            selected_routes.append(route)
            continue

        operation_keys = _http_operation_keys(route, prefix=prefix)
        conflicts = {
            key: operation_owners[key]
            for key in operation_keys
            if key in operation_owners
        }
        if not conflicts:
            selected_routes.append(route)
            for key in operation_keys:
                operation_owners[key] = name
            continue

        if len(conflicts) != len(operation_keys):
            raise RuntimeError(
                f"Router '{name}' partially overlaps registered HTTP operations "
                f"({sorted(conflicts)}). Split the route or assign explicit owners."
            )

        undeclared = {
            key: owner
            for key, owner in conflicts.items()
            if _LEGACY_HTTP_OPERATION_OWNERS.get(key) != owner
        }
        if undeclared:
            raise RuntimeError(
                f"Router '{name}' duplicates HTTP operation(s) owned by {undeclared}. "
                "Declare a single route owner or remove the duplicate registration."
            )

        logger.info(
            "Skipped documented shadow route(s) from router '%s': %s",
            name,
            ", ".join(f"{method} {path} (owner: {owner})" for (path, method), owner in sorted(conflicts.items())),
        )

    # Use a lightweight route view rather than mutating a module-level router;
    # imports and any intentional internal use of its handler functions remain
    # unchanged, while the live ASGI application gets one owner per operation.
    filtered_router = APIRouter(routes=selected_routes)
    app.include_router(filtered_router, prefix=prefix)

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

    # Start with operations defined directly on the application, then register
    # priority routers first (order matters for route matching).
    operation_owners: dict[tuple[str, str], str] = {}
    for route in app.routes:
        if isinstance(route, APIRoute):
            for operation_key in _http_operation_keys(route, prefix=""):
                operation_owners[operation_key] = "application"

    def include_discovered_router(name: str) -> None:
        _include_router_without_shadowed_operations(
            name,
            discovered[name].router,
            prefix="/api",
            operation_owners=operation_owners,
        )

    # Register priority routers first (order matters for route matching).
    registered = set()
    for name in ROUTER_PRIORITY:
        if name in discovered:
            include_discovered_router(name)
            registered.add(name)

    # Register remaining routers alphabetically
    for name in sorted(discovered.keys()):
        if name not in registered:
            include_discovered_router(name)
            registered.add(name)

    logger.info(f"Auto-discovered and registered {len(registered)} routers")

discover_and_register_routers()

# Root endpoint
@app.get("/api/")
async def root():
    return {"message": "NexusOps API v3.0.0", "status": "operational"}

# Health probes â€” MUST be lightweight + synchronous (no DB calls) so K8s readiness
# checks pass immediately even while seed_data / background tasks are warming up.
# Both /health (unprefixed, used by ingress/K8s) and /api/health are exposed.
@app.get("/health")
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "nexusops-api", "version": "3.0.0"}


@app.get("/ready")
@app.get("/api/ready")
async def readiness_check():
    """Only advertise readiness after boot reconciliation and a live DB ping."""
    from fastapi import HTTPException

    if not _warmup_complete:
        raise HTTPException(status_code=503, detail="NexusMSP is still warming up")
    try:
        await db.command("ping")
    except Exception as exc:
        logger.error("Readiness database ping failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database is unavailable") from exc
    return {"status": "ready", "service": "nexusops-api", "version": "3.0.0"}


def _start_background_task(coro, name: str) -> asyncio.Task:
    task = asyncio.create_task(coro, name=name)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


def background_worker_specs():
    """Return the durable-loop catalogue shared by API-dev and worker deployments."""
    from app.routers.maintenance_windows import maintenance_window_scheduler

    return (
        ("rustdesk-sync", _rustdesk_auto_sync_loop),
        ("recurring-invoices", _recurring_invoice_scheduler),
        ("standup-digest", _standup_digest_scheduler),
        ("warroom-escalation", _warroom_escalation_loop),
        ("chain-reactions", _chain_reactions_loop),
        ("m365-mail-sync", _microsoft365_mail_sync_loop),
        ("scheduled-scripts", _scheduled_script_loop),
        ("event-delivery", _event_delivery_loop),
        ("event-retention", _event_retention_loop),
        ("automation-runtime", _automation_runtime_loop),
        ("maintenance-windows", maintenance_window_scheduler),
    )

_STRIPE_SETTLEMENT_EVENTS = {
    "checkout.session.completed": ("checkout.session", ("stripe_session_id", "session_id")),
    "checkout.session.async_payment_succeeded": ("checkout.session", ("stripe_session_id", "session_id")),
    "payment_intent.succeeded": ("payment_intent", ("stripe_payment_intent_id",)),
}


def _stripe_amount_cents(value) -> int:
    """Convert known persisted amounts to cents without trusting webhook metadata."""
    return int(round(float(value or 0) * 100))


async def _settle_verified_stripe_event(event) -> str:
    """Apply one previously-bound Stripe settlement exactly once.

    Metadata is checked for consistency, but is not used as authority.  The
    server-side payment transaction created before checkout decides the invoice,
    amount and client that may be settled.
    """
    expected = _STRIPE_SETTLEMENT_EVENTS.get(event.event_type)
    if not expected or event.object_type != expected[0] or event.payment_status != "paid" or not event.object_id:
        return "ignored"

    provider_fields = expected[1]
    transaction = await db.payment_transactions.find_one(
        {"$or": [{field: event.object_id} for field in provider_fields]},
        {"_id": 0},
    )
    if not transaction:
        logger.warning(
            "stripe_webhook_ignored reason=unbound_payment event_id=%s object_id=%s",
            event.event_id,
            event.object_id,
        )
        return "ignored"

    invoice_id = str(transaction.get("invoice_id") or "")
    if not invoice_id or str(event.metadata.get("invoice_id") or "") != invoice_id:
        logger.warning(
            "stripe_webhook_ignored reason=invoice_binding_mismatch event_id=%s transaction_id=%s",
            event.event_id,
            transaction.get("id"),
        )
        return "ignored"

    expected_amount = int(transaction.get("amount_cents") or _stripe_amount_cents(transaction.get("amount")))
    expected_currency = str(transaction.get("currency") or "").lower()
    if expected_amount <= 0 or event.amount_total != expected_amount or event.currency.lower() != expected_currency:
        logger.warning(
            "stripe_webhook_ignored reason=amount_or_currency_mismatch event_id=%s transaction_id=%s",
            event.event_id,
            transaction.get("id"),
        )
        return "ignored"

    collection_name = str(transaction.get("invoice_collection") or "invoices")
    if collection_name not in {"invoices", "xero_invoices"}:
        logger.error(
            "stripe_webhook_ignored reason=invalid_invoice_collection transaction_id=%s",
            transaction.get("id"),
        )
        return "ignored"
    invoice_collection = db.xero_invoices if collection_name == "xero_invoices" else db.invoices
    invoice_query = {"id": invoice_id}
    if transaction.get("client_id"):
        invoice_query["client_id"] = transaction["client_id"]
    invoice = await invoice_collection.find_one(invoice_query, {"_id": 0})
    if not invoice:
        logger.warning(
            "stripe_webhook_ignored reason=bound_invoice_missing transaction_id=%s",
            transaction.get("id"),
        )
        return "ignored"
    if str(invoice.get("status") or "").strip().lower() in {"cancelled", "voided", "void"}:
        logger.warning(
            "stripe_webhook_ignored reason=invoice_not_collectible transaction_id=%s",
            transaction.get("id"),
        )
        return "ignored"

    amount = event.amount_total / 100
    outstanding = round(float(invoice.get("total", 0)) - float(invoice.get("amount_paid", 0)), 2)
    if amount > outstanding + 0.01:
        logger.warning(
            "stripe_webhook_ignored reason=amount_exceeds_current_balance transaction_id=%s",
            transaction.get("id"),
        )
        return "ignored"

    payment_link_id = transaction.get("payment_link_id")
    payment_link_payment_id = transaction.get("payment_link_payment_id")
    payment_link = None
    if payment_link_id:
        payment_link = await db.payment_links.find_one({"id": payment_link_id}, {"_id": 0})
        if not payment_link or payment_link.get("status") != "active":
            # A provider event for a checkout that was revoked/closed after it
            # started is financial evidence, not an instruction to credit a
            # different lifecycle state.  Preserve it for a human
            # reconciliation rather than silently accepting or dropping it.
            await db.payment_transactions.update_one(
                {"id": transaction.get("id"), "payment_status": {"$ne": "paid"}},
                {"$set": {
                    "payment_status": "reconciliation_required",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "last_settlement_error": "payment_link_not_active",
                    "stripe_event_id": event.event_id,
                }},
            )
            logger.error(
                "stripe_webhook_reconciliation_required reason=payment_link_not_active transaction_id=%s event_id=%s",
                transaction.get("id"),
                event.event_id,
            )
            return "reconciliation_required"

    # This state transition is the idempotency gate. A Stripe redelivery or a
    # duplicate webhook cannot get past it after the first accepted callback.
    now = datetime.now(timezone.utc).isoformat()
    marked = await db.payment_transactions.update_one(
        {"id": transaction.get("id"), "payment_status": {"$ne": "paid"}},
        {"$set": {
            "payment_status": "paid",
            "updated_at": now,
            "paid_at": now,
            "stripe_event_id": event.event_id,
            "stripe_event_type": event.event_type,
        }},
    )
    if marked.matched_count == 0:
        return "duplicate"

    new_paid = round(float(invoice.get("amount_paid", 0)) + amount, 2)
    paid_in_full = new_paid >= float(invoice.get("total", 0)) - 0.01
    payment_entry = {
        "amount": amount,
        "method": "stripe",
        "date": now,
        "session_id": event.object_id if event.object_type == "checkout.session" else None,
        "payment_intent_id": event.object_id if event.object_type == "payment_intent" else None,
        "stripe_event_id": event.event_id,
    }
    update_fields = {
        "payment_status": "paid" if paid_in_full else "partial",
        "amount_paid": new_paid,
        "amount_due": round(float(invoice.get("total", 0)) - new_paid, 2),
    }
    if paid_in_full:
        update_fields.update({"status": "paid", "paid_date": datetime.now(timezone.utc).strftime("%Y-%m-%d")})
    # The transaction state above is the idempotency gate, but it must not
    # become a false success if a concurrent payment changed the invoice before
    # this callback could apply its own mutation.  Bind the write to the exact
    # client-owned invoice snapshot we validated, then release the gate for a
    # provider retry if the update cannot be applied.
    invoice_update_query = {
        **invoice_query,
        "amount_paid": invoice.get("amount_paid", 0),
    }
    invoice_updated = await invoice_collection.update_one(
        invoice_update_query,
        {"$set": update_fields, "$push": {"payments": payment_entry}},
    )
    if invoice_updated.matched_count == 0:
        rollback = await db.payment_transactions.update_one(
            {
                "id": transaction.get("id"),
                "payment_status": "paid",
                "stripe_event_id": event.event_id,
            },
            {"$set": {
                "payment_status": "retryable",
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "last_settlement_error": "invoice_update_conflict",
            }},
        )
        if rollback.matched_count == 0:
            logger.error(
                "stripe_webhook_invoice_conflict_rollback_failed transaction_id=%s event_id=%s",
                transaction.get("id"),
                event.event_id,
            )
        raise RuntimeError("Invoice changed before Stripe settlement could be applied")

    if payment_link_id and payment_link_payment_id:
        link = payment_link or await db.payment_links.find_one({"id": payment_link_id}, {"_id": 0})
        if link:
            payments = list(link.get("payments", []))
            for payment in payments:
                if payment.get("id") == payment_link_payment_id:
                    payment.update({"status": "paid", "confirmed_at": now, "stripe_event_id": event.event_id})
                    break
            link_update = {"payments": payments}
            checkout_lock = link.get("checkout_lock")
            if isinstance(checkout_lock, dict) and checkout_lock.get("id") == payment_link_payment_id:
                link_update["checkout_lock"] = {
                    **checkout_lock,
                    "status": "paid",
                    "confirmed_at": now,
                    "stripe_event_id": event.event_id,
                }
            if paid_in_full:
                link_update.update({"status": "completed", "completed_at": now})
            await db.payment_links.update_one({"id": payment_link_id}, {"$set": link_update})
    return "processed"


# Stripe webhook
@app.post("/api/webhook/stripe")
async def stripe_webhook(request: FastAPIRequest):
    """Accept only cryptographically verified, Nexus-bound Stripe callbacks."""
    stripe_key = os.environ.get("STRIPE_API_KEY")
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET")
    if not stripe_key or not webhook_secret:
        logger.error("stripe_webhook_unavailable configuration_missing=%s", "api_key" if not stripe_key else "webhook_secret")
        raise HTTPException(status_code=503, detail="Stripe webhook is not configured")

    signature = request.headers.get("Stripe-Signature", "")
    if not signature:
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook signature")
    try:
        from app.services.stripe_checkout import StripeCheckout

        event = await StripeCheckout(api_key=stripe_key).handle_webhook(await request.body(), signature)
    except RuntimeError:
        logger.error("stripe_webhook_unavailable webhook_secret_not_configured")
        raise HTTPException(status_code=503, detail="Stripe webhook is not configured") from None
    except Exception:
        # Provider library exception strings may contain request identifiers or
        # parsing detail. Do not reflect them to the public webhook caller.
        logger.warning("stripe_webhook_rejected invalid_signature_or_payload")
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook signature") from None

    try:
        return {"status": await _settle_verified_stripe_event(event)}
    except Exception:
        # A 5xx tells Stripe to retry a verified event; details stay in logs.
        logger.exception("stripe_webhook_processing_failed event_id=%s", event.event_id)
        raise HTTPException(status_code=500, detail="Stripe webhook processing failed") from None

# Startup event
@app.on_event("startup")
async def startup_event():
    # Kick heavy DB seeding + ticket backfill off to a background task so uvicorn
    # completes startup fast and production readiness probes (/health) pass on time.
    try:
        from app.routers.ai_service import hydrate_openai_connection

        if await hydrate_openai_connection():
            logger.info("OpenAI API connection is available")
    except Exception as e:
        logger.warning(f"OpenAI connection hydration skipped: {e}")
    _start_background_task(_boot_warmup(), "nexus-boot-warmup")
    if background_workers_enabled():
        workers = background_worker_specs()
        for name, worker in workers:
            _start_background_task(worker(), f"nexus-{name}")
        logger.info("Started %s in-process background workers", len(workers))
    else:
        logger.info("In-process background workers disabled; run the dedicated worker deployment")
    logger.info("NexusOps API v3.0.0 started successfully")


async def _boot_warmup():
    """Run seed + ticket-number backfill without blocking app startup."""
    global _warmup_complete
    try:
        from app.services.academy import ensure_academy_indexes
        await ensure_academy_indexes(database=db)
    except Exception as e:
        logger.error(f"Academy index initialization failed: {e}")
    try:
        from app.services.request_throttling import ensure_request_throttle_indexes
        await ensure_request_throttle_indexes()
    except Exception as e:
        logger.error(f"Request throttle index initialization failed: {e}")
    try:
        from app.services.audit_log_storage import ensure_audit_log_indexes
        await ensure_audit_log_indexes()
    except Exception as e:
        logger.error(f"Audit-log index initialization failed: {e}")
    try:
        from app.services.event_backbone import (
            backfill_event_integrity,
            backfill_legacy_event_metadata,
            ensure_event_backbone_indexes,
        )
        await ensure_event_backbone_indexes()
        migrated_events = await backfill_legacy_event_metadata()
        if migrated_events:
            logger.info(f"Backfilled durable metadata for {migrated_events} platform events")
        sealed_events = await backfill_event_integrity()
        if sealed_events:
            logger.info(f"Sealed {sealed_events} platform events into the Nexus Black Box chain")
    except Exception as e:
        logger.error(f"Event backbone index initialization failed: {e}")
    try:
        from app.services.automation_runtime import ensure_automation_runtime_indexes
        await ensure_automation_runtime_indexes()
    except Exception as e:
        logger.error(f"Automation runtime index initialization failed: {e}")
    try:
        from app.services.chat_access import initialize_chat_storage
        await initialize_chat_storage()
    except Exception as e:
        logger.error(f"Chat index initialization failed: {e}")
    try:
        from app.services.time_machine import ensure_time_machine_indexes
        await ensure_time_machine_indexes(db)
    except Exception as e:
        logger.error(f"Time Machine index initialization failed: {e}")
    try:
        from app.routers.invoice_pdf import ensure_document_pdf_capability_indexes
        await ensure_document_pdf_capability_indexes()
    except Exception as e:
        logger.error(f"Document PDF capability index initialization failed: {e}")
    try:
        await db.yeastar_pbxs.create_index(
            [("client_id", 1), ("pbx_url", 1)],
            unique=True,
            name="unique_client_pbx_url",
        )
    except Exception as e:
        logger.error(f"Yeastar PBX uniqueness guard failed: {e}")
    try:
        from app.routers.projects import ensure_project_ticket_plan_indexes
        await ensure_project_ticket_plan_indexes()
    except Exception as e:
        logger.error(f"Project ticket-plan uniqueness guard failed: {e}")
    if demo_seed_enabled():
        try:
            await seed_data()
        except Exception as e:
            logger.error(f"seed_data failed: {e}")
    else:
        logger.info("Demo-data seeding is disabled for this runtime")
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
    _warmup_complete = True
    logger.info("NexusMSP boot reconciliation complete")


async def _event_delivery_loop():
    """Deliver due platform events with durable checkpoints and bounded retries."""
    import asyncio
    from app.services.event_backbone import process_due_deliveries

    while True:
        try:
            result = await process_due_deliveries(50)
            await asyncio.sleep(1 if result.get("processed") else 5)
        except Exception as e:
            logger.error(f"Event delivery worker failed: {e}")
            await asyncio.sleep(10)


async def _event_retention_loop():
    """Apply configured event retention without touching legal-hold evidence."""
    import asyncio
    from app.services.event_backbone import purge_expired_events

    while True:
        try:
            result = await purge_expired_events(5000)
            if result.get("events_purged"):
                logger.info(
                    "Event retention purged %s events and %s delivery checkpoints",
                    result["events_purged"],
                    result["deliveries_purged"],
                )
            await asyncio.sleep(21600)
        except Exception as e:
            logger.error(f"Event retention worker failed: {e}")
            await asyncio.sleep(600)


async def _automation_runtime_loop():
    """Resume queued workflows, timed waits and expired worker leases."""
    import asyncio
    from app.services.automation_runtime import process_due_runs

    while True:
        try:
            result = await process_due_runs(25)
            await asyncio.sleep(1 if result.get("processed") else 4)
        except Exception as e:
            logger.error(f"Automation runtime worker failed: {e}")
            await asyncio.sleep(10)


async def _rustdesk_auto_sync_loop():
    """Run the same scoped RustDesk reconciliation used by the governed API."""
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
            # Never rebuild an outbound provider URL or update by an unscoped
            # RustDesk ID here.  The governed sync validates the saved origin,
            # decrypts server-owned credentials and only reconciles canonical,
            # client-owned Nexus assets.
            try:
                from app.routers.rustdesk import sync_rustdesk_peers

                request = FastAPIRequest({
                    "type": "http",
                    "method": "POST",
                    "path": "/internal/rustdesk/auto-sync",
                    "headers": [],
                })
                request.state.correlation_id = str(uuid.uuid4())
                result = await sync_rustdesk_peers(
                    request,
                    {
                        "id": "system-rustdesk-auto-sync",
                        "name": "Nexus RustDesk Auto Sync",
                        "role": "admin",
                        "is_admin": True,
                        "client_scope_mode": "all",
                    },
                )
                now = datetime.now(timezone.utc).isoformat()
                await db.settings.update_one(
                    {"key": "rustdesk_config"},
                    {"$set": {
                        "value.last_auto_sync": now,
                        "value.last_auto_sync_peers": int(result.get("synced") or 0),
                    }},
                )
                logger.info(
                    "RustDesk auto-sync: synced=%s created=%s updated=%s skipped_unowned=%s skipped_ambiguous=%s",
                    result.get("synced", 0),
                    result.get("created", 0),
                    result.get("updated", 0),
                    result.get("skipped_unowned", 0),
                    result.get("skipped_ambiguous", 0),
                )
            except Exception as e:
                logger.debug(f"RustDesk auto-sync skipped: {e}")
        except Exception as e:
            logger.debug(f"RustDesk auto-sync loop error: {e}")
            import asyncio
            await asyncio.sleep(60)

async def _trmm_scheduled_broadcast_loop():
    """Removed â€” TRMM has been replaced by NexusOps Agent. This stub keeps backwards-compat with any old references."""
    return


async def _warroom_escalation_loop():
    """Background loop that auto-escalates unacked War Room pages tier by tier."""
    import asyncio
    await asyncio.sleep(25)
    while True:
        try:
            from app.routers.warroom import warroom_escalation_tick
            await warroom_escalation_tick()
        except Exception as e:
            logger.debug(f"War Room escalation loop error: {e}")
        await asyncio.sleep(30)


async def _chain_reactions_loop():
    """Background loop that fires the 5 zero-touch chain reactions every N minutes."""
    import asyncio
    from app.database import db as _db
    await asyncio.sleep(45)  # let app warm up
    while True:
        try:
            s = await _db.settings.find_one({"type": "ops_scheduler"}, {"_id": 0}) or {}
            enabled = bool(s.get("enabled", True))
            interval_min = max(5, int(s.get("interval_minutes") or 15))
            if enabled:
                from app.routers.power_features import run_chain_reactions
                summary = await run_chain_reactions(triggered_by="scheduler")
                logger.info(f"Ops chain-reactions tick: {summary.get('results', {})}")
                # Once-a-day storm broadcast (idempotent)
                try:
                    from app.routers.chat_help import _check_storm_broadcast, _check_all_clear_broadcast
                    storm_msg = await _check_storm_broadcast()
                    if storm_msg:
                        logger.info(f"Storm mood broadcast posted: {storm_msg.get('id')}")
                    clear_msg = await _check_all_clear_broadcast()
                    if clear_msg:
                        logger.info(f"All-clear broadcast posted: {clear_msg.get('id')}")
                except Exception as _e:
                    logger.debug(f"Storm broadcast skipped: {_e}")

                # TRMM live sync removed â€” devices are now updated in real-time by the NexusOps Agent heartbeat.
            await asyncio.sleep(interval_min * 60)
        except Exception as e:
            logger.debug(f"Chain-reactions loop error: {e}")
            await asyncio.sleep(60)


async def _scheduled_script_loop():
    """Queue due saved-script schedules for execution by the Nexus agent."""
    import asyncio
    await asyncio.sleep(20)
    while True:
        try:
            from app.routers.scripting import process_due_scheduled_tasks
            summary = await process_due_scheduled_tasks()
            if summary.get("processed"):
                logger.info("Scheduled scripts: processed %s schedules, queued %s executions", summary["processed"], summary["queued"])
        except Exception as exc:
            logger.debug("Scheduled script loop error: %s", exc)
        await asyncio.sleep(30)


async def _microsoft365_mail_sync_loop():
    """Poll verified Microsoft 365 inboxes so email intake does not rely on a manual refresh."""
    import asyncio
    await asyncio.sleep(60)
    while True:
        interval_minutes = 5
        try:
            mailbox_settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0}) or {}
            interval_minutes = max(1, min(30, int(mailbox_settings.get("mail_sync_interval_minutes") or 5)))
            if (
                mailbox_settings.get("connected")
                and mailbox_settings.get("live_sync_enabled")
                and mailbox_settings.get("mail_sync_enabled", True)
            ):
                from app.routers.o365_mailbox import sync_o365_emails
                result = await sync_o365_emails({"id": "system-microsoft365-sync", "name": "Microsoft 365 Sync", "role": "system"})
                logger.info(
                    "Microsoft 365 mailbox sync: %s fetched, %s errors",
                    result.get("emails_fetched", 0), result.get("errors", 0),
                )
        except Exception as exc:
            logger.debug("Microsoft 365 mailbox sync error: %s", exc)
        await asyncio.sleep(interval_minutes * 60)


async def _recurring_invoice_scheduler():
    """Background loop that checks for due recurring invoices and auto-generates them."""
    import asyncio
    import uuid as _uuid
    from datetime import timedelta
    while True:
        try:
            await asyncio.sleep(300)  # Check every 5 minutes
            now = datetime.now(timezone.utc)
            today_str = now.strftime("%Y-%m-%d")

            # === Auto CPI/Annual Indexation tick ===
            try:
                idx_due = await db.recurring_invoices.find({
                    "indexation.enabled": True,
                    "status": "active",
                    "indexation.next_apply": {"$lte": today_str},
                }, {"_id": 0}).to_list(200)
                for ri in idx_due:
                    idx = ri.get("indexation", {})
                    pct = float(idx.get("pct", 0) or 0)
                    if pct == 0:
                        continue
                    new_lines = []
                    old_total = 0.0
                    for li in ri.get("line_items", []):
                        old_rate = float(li.get("rate", 0) or 0)
                        qty = float(li.get("quantity", 1) or 1)
                        new_rate = round(old_rate * (1 + pct / 100), 2)
                        new_amount = round(qty * new_rate, 2)
                        old_total += float(li.get("amount", 0) or 0)
                        new_lines.append({**li, "rate": new_rate, "amount": new_amount})
                    subtotal = sum(li["amount"] for li in new_lines)
                    tax_rate = float(ri.get("tax_rate", 0))
                    tax_amount = round(subtotal * tax_rate / 100, 2)
                    try:
                        anniv_dt = datetime.fromisoformat(idx.get("next_apply")).replace(tzinfo=timezone.utc)
                        new_next = anniv_dt.replace(year=anniv_dt.year + 1).date().isoformat()
                    except Exception:
                        new_next = (now + timedelta(days=365)).date().isoformat()
                    await db.recurring_invoices.update_one(
                        {"id": ri["id"]},
                        {"$set": {
                            "line_items": new_lines, "subtotal": subtotal,
                            "tax_amount": tax_amount, "amount": round(subtotal + tax_amount, 2),
                            "indexation.next_apply": new_next,
                            "indexation.last_applied": today_str,
                            "updated_at": now.isoformat(),
                        }}
                    )
                    await db.recurring_indexation_log.insert_one({
                        "id": f"idx-{_uuid.uuid4().hex[:8]}",
                        "ri_id": ri["id"],
                        "client_name": ri.get("client_name"),
                        "applied_at": now.isoformat(),
                        "pct": pct,
                        "old_total": round(old_total, 2),
                        "new_total": round(subtotal, 2),
                        "delta": round(subtotal - old_total, 2),
                    })
                    logger.info(f"Indexation applied (+{pct}%) â†’ {ri.get('client_name')}: ${old_total:.2f} â†’ ${subtotal:.2f}")
            except Exception as _ie:
                logger.debug(f"Indexation tick error: {_ie}")

            # Use the same guarded generation path as the operator-triggered run.
            # This prevents duplicate billing periods and records delivery results.
            from app.routers.recurring_invoices import _run_scheduler_now
            summary = await _run_scheduler_now({
                "id": "system-recurring-scheduler",
                "name": "Automatic Scheduler",
                "role": "system",
                # The scheduler is a server-owned global actor.  It uses the
                # same governed generation helper as the operator route, but
                # has no browser-issued authentication context.
                "client_scope_mode": "all",
                "system_actor": True,
            })
            if summary.get("processed"):
                logger.info(
                    "Recurring invoice scheduler: generated %s invoice(s), skipped %s duplicate period(s)",
                    summary.get("generated", 0),
                    summary.get("skipped_duplicates", 0),
                )

        except Exception as e:
            logger.debug(f"Recurring invoice scheduler error: {e}")
            import asyncio
            await asyncio.sleep(60)

# Shutdown event
@app.on_event("shutdown")
async def shutdown_db_client():
    for task in tuple(_background_tasks):
        task.cancel()
    if _background_tasks:
        await asyncio.gather(*tuple(_background_tasks), return_exceptions=True)
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
                        from app.routers.email_utils import send_email, is_microsoft365_configured
                        if await is_microsoft365_configured():
                            html = (
                                f"<h2>NexusOps Morning Standup Â· {today_tag}</h2>"
                                f"<pre style='font-family:inherit;white-space:pre-wrap'>{ai_brief}</pre>"
                                f"<hr><small>Window: last {window_hours}h Â· {snap['new_ticket_count']} new tickets Â· "
                                f"{len(snap['critical_open'])} critical Â· {snap['offline_devices']} offline devices.</small>"
                            )
                            for addr in email_to:
                                try:
                                    await send_email(addr, f"Morning Standup Digest â€” {today_tag}", html)
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
    allow_origins=cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)
