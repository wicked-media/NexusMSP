"""Low-cardinality production telemetry for the Nexus API and worker.

Metrics never use tenant, client, user, path-parameter, or provider identifiers
as labels. Those values belong in access-controlled audit evidence, not in the
shared operations plane.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import hashlib
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import httpx
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

HTTP_REQUESTS = Counter("nexus_http_requests_total", "Completed Nexus HTTP requests.", ("method", "route", "status_class"))
HTTP_DURATION = Histogram(
    "nexus_http_request_duration_seconds", "Nexus HTTP request latency.", ("method", "route"),
    buckets=(0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10),
)
HTTP_IN_PROGRESS = Gauge("nexus_http_requests_in_progress", "Nexus HTTP requests currently in progress.")
DEPENDENCY_READY = Gauge(
    "nexus_dependency_ready", "Whether a required Nexus dependency is ready (1) or unavailable (0).", ("dependency",),
)
PROVIDER_CONFIGURED = Gauge("nexus_provider_configured", "Whether a supported provider has configuration.", ("provider",))
PROVIDER_READY = Gauge("nexus_provider_ready", "Whether a configured provider has verified healthy evidence.", ("provider",))
EVENT_QUEUE_DEPTH = Gauge("nexus_event_queue_depth", "Pending, retrying, or processing event deliveries.")
EVENT_DEAD_LETTERS = Gauge("nexus_event_dead_letters", "Current dead-letter event delivery count.")
AUTOMATION_EXPIRED_LEASES = Gauge("nexus_automation_expired_leases", "Workflow runs whose worker lease has expired.")
WORKER_LOOP_UP = Gauge("nexus_worker_loop_up", "Whether a named durable worker loop is running (1) or stopped (0).", ("worker",))
WORKER_LOOP_FAILURES = Counter("nexus_worker_loop_failures_total", "Unexpected durable worker loop exits.", ("worker",))
ALERT_DELIVERIES = Counter("nexus_alert_deliveries_total", "Alertmanager webhook delivery attempts.", ("status",))

_tracer: Any = None
_trace_provider: Any = None
_log_provider: Any = None
_configured = False
_SECRET_PATTERN = re.compile(
    r"(?i)(api[_-]?key|[a-z0-9_-]*token|secret|password)"
    r"(\s*[:=]\s*)([^\s,&;]+)"
)
_AUTH_PATTERN = re.compile(r"(?i)\bauthorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;&]+")
_BEARER_PATTERN = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]+=*")


def redact_log_message(value: Any) -> str:
    message = str(value)
    message = _AUTH_PATTERN.sub("Authorization: [REDACTED]", message)
    message = _SECRET_PATTERN.sub(lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]", message)
    return _BEARER_PATTERN.sub("Bearer [REDACTED]", message)


class JsonLogFormatter(logging.Formatter):
    """Emit one machine-readable record without adding request or secret data."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_log_message(record.getMessage()),
            "service": os.getenv("OTEL_SERVICE_NAME", "nexus-api"),
            "environment": os.getenv("APP_ENV", "development"),
        }
        if record.exc_info:
            payload["exception_type"] = record.exc_info[0].__name__
        try:
            from opentelemetry import trace
            context = trace.get_current_span().get_span_context()
            if context.is_valid:
                payload["trace_id"] = format(context.trace_id, "032x")
                payload["span_id"] = format(context.span_id, "016x")
        except Exception:
            pass
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def configure_observability(*, service_name: str) -> None:
    """Configure JSON logs and optional OTLP tracing once per process."""
    global _configured, _tracer, _trace_provider, _log_provider
    if _configured:
        return
    _configured = True
    os.environ.setdefault("OTEL_SERVICE_NAME", service_name)
    if os.getenv("NEXUS_LOG_FORMAT", "text").strip().lower() == "json":
        root = logging.getLogger()
        handler = logging.StreamHandler()
        handler.setFormatter(JsonLogFormatter())
        root.handlers[:] = [handler]
        root.setLevel(logging.INFO)

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip().rstrip("/")
    if not endpoint:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
        from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter

        resource = Resource.create({
            "service.name": service_name,
            "service.version": "3.0.0",
            "deployment.environment.name": os.getenv("APP_ENV", "development"),
        })
        provider = TracerProvider(resource=resource)
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces")))
        trace.set_tracer_provider(provider)
        _trace_provider = provider
        _tracer = trace.get_tracer("nexus.http")
        log_provider = LoggerProvider(resource=resource)
        log_provider.add_log_record_processor(
            BatchLogRecordProcessor(OTLPLogExporter(endpoint=f"{endpoint}/v1/logs"))
        )
        otel_handler = LoggingHandler(level=logging.INFO, logger_provider=log_provider)
        otel_handler.setFormatter(JsonLogFormatter())
        logging.getLogger().addHandler(otel_handler)
        _log_provider = log_provider
    except Exception:
        logging.getLogger(__name__).exception("observability_trace_configuration_failed")


@contextmanager
def request_span(*, method: str, correlation_id: str) -> Iterator[Any]:
    if _tracer is None:
        yield None
        return
    with _tracer.start_as_current_span(f"HTTP {method}") as span:
        span.set_attribute("http.request.method", method)
        span.set_attribute("nexus.correlation_id", correlation_id)
        yield span


def observe_http(*, method: str, route: str, status_code: int, elapsed_seconds: float) -> None:
    safe_route = route if route.startswith("/") and "?" not in route else "unmatched"
    HTTP_REQUESTS.labels(method=method, route=safe_route, status_class=f"{max(0, status_code) // 100}xx").inc()
    HTTP_DURATION.labels(method=method, route=safe_route).observe(elapsed_seconds)


async def refresh_operational_metrics(database: Any) -> None:
    """Refresh dependency and durable-queue gauges immediately before a scrape."""
    try:
        await database.command("ping")
        DEPENDENCY_READY.labels(dependency="mongodb").set(1)
    except Exception:
        DEPENDENCY_READY.labels(dependency="mongodb").set(0)
    try:
        from app.services.malware_scanner import scanner_health
        scanner = await scanner_health()
        DEPENDENCY_READY.labels(dependency="malware_scanner").set(1 if scanner["ready"] else 0)
    except Exception:
        DEPENDENCY_READY.labels(dependency="malware_scanner").set(0)
    try:
        pending, retrying, processing, dead_letters, expired = await asyncio.gather(
            database.platform_event_deliveries.count_documents({"status": "pending"}),
            database.platform_event_deliveries.count_documents({"status": "retrying"}),
            database.platform_event_deliveries.count_documents({"status": "processing"}),
            database.platform_event_deliveries.count_documents({"status": "dead_letter"}),
            database.workflow_runs.count_documents({
                "status": "running",
                "lease_expires_at": {"$lte": datetime.now(timezone.utc).isoformat()},
            }),
        )
        EVENT_QUEUE_DEPTH.set(pending + retrying + processing)
        EVENT_DEAD_LETTERS.set(dead_letters)
        DEPENDENCY_READY.labels(dependency="event_queue").set(1 if dead_letters == 0 else 0)
        AUTOMATION_EXPIRED_LEASES.set(expired)
        DEPENDENCY_READY.labels(dependency="automation_runtime").set(1 if expired == 0 else 0)
    except Exception:
        DEPENDENCY_READY.labels(dependency="event_queue").set(0)
        DEPENDENCY_READY.labels(dependency="automation_runtime").set(0)

    provider_aliases = {
        "microsoft": {"cipp", "m365_connection"},
        "xero": {"xero"},
        "email": {"o365_mailbox"},
        "sms": {"sms"},
        "billing": {"stripe", "pax8"},
        "backup": {"acronis"},
        "remote": {"rustdesk", "rustdesk_config"},
        "network": {"unifi"},
    }
    try:
        aliases = sorted({item for values in provider_aliases.values() for item in values})
        settings = await database.settings.find(
            {"$or": [{"type": {"$in": aliases}}, {"key": {"$in": aliases}}]},
            {"_id": 0, "type": 1, "key": 1, "last_test_status": 1, "value.last_test_status": 1},
        ).to_list(100)
        for provider, accepted in provider_aliases.items():
            matches = [row for row in settings if row.get("type") in accepted or row.get("key") in accepted]
            statuses = [
                str(row.get("last_test_status") or (row.get("value") or {}).get("last_test_status") or "").lower()
                for row in matches
            ]
            verified = any(any(token in status for token in ("success", "connected", "passed", "healthy")) for status in statuses)
            PROVIDER_CONFIGURED.labels(provider=provider).set(1 if matches else 0)
            PROVIDER_READY.labels(provider=provider).set(1 if verified else 0)
    except Exception:
        for provider in provider_aliases:
            PROVIDER_CONFIGURED.labels(provider=provider).set(0)
            PROVIDER_READY.labels(provider=provider).set(0)


def metrics_payload() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST


def observability_ingest_authorized(authorization: str | None) -> bool:
    """Authenticate Alertmanager with a Docker secret, never an application token."""
    token_path = os.getenv("NEXUS_OBSERVABILITY_INGEST_TOKEN_FILE", "/run/secrets/nexus-observability-ingest-token")
    try:
        expected = Path(token_path).read_text(encoding="utf-8").strip()
    except OSError:
        return False
    supplied = str(authorization or "")
    if not supplied.startswith("Bearer ") or not expected:
        return False
    return secrets.compare_digest(supplied[7:], expected)


def mark_worker_started(name: str) -> None:
    WORKER_LOOP_UP.labels(worker=name).set(1)


def mark_worker_stopped(name: str, *, failed: bool) -> None:
    WORKER_LOOP_UP.labels(worker=name).set(0)
    if failed:
        WORKER_LOOP_FAILURES.labels(worker=name).inc()


def start_worker_metrics_server() -> None:
    from prometheus_client import start_http_server
    start_http_server(int(os.getenv("NEXUS_METRICS_PORT", "9101")), addr="0.0.0.0")


async def deliver_alertmanager_webhook(payload: dict[str, Any]) -> int:
    """Forward a bounded, sanitised alert batch to the configured on-call webhook."""
    destination = os.getenv("NEXUS_ALERT_WEBHOOK_URL", "").strip()
    if not destination:
        ALERT_DELIVERIES.labels(status="not_configured").inc()
        raise RuntimeError("On-call alert destination is not configured")
    if os.getenv("APP_ENV", "development").lower() == "production" and not destination.startswith("https://"):
        ALERT_DELIVERIES.labels(status="rejected").inc()
        raise RuntimeError("Production on-call alert destination must use HTTPS")
    alerts = payload.get("alerts") if isinstance(payload, dict) else None
    if not isinstance(alerts, list) or len(alerts) > 100:
        ALERT_DELIVERIES.labels(status="rejected").inc()
        raise ValueError("Alert payload is invalid")
    safe_alerts = []
    for alert in alerts:
        if not isinstance(alert, dict):
            continue
        labels = alert.get("labels") if isinstance(alert.get("labels"), dict) else {}
        annotations = alert.get("annotations") if isinstance(alert.get("annotations"), dict) else {}
        safe_alerts.append({
            "status": str(alert.get("status") or "unknown")[:20],
            "labels": {key: str(labels.get(key) or "")[:160] for key in ("alertname", "severity", "service", "owner", "escalation")},
            "annotations": {key: str(annotations.get(key) or "")[:500] for key in ("summary", "description", "runbook_url")},
            "startsAt": str(alert.get("startsAt") or "")[:64],
            "endsAt": str(alert.get("endsAt") or "")[:64],
        })
    outgoing = {
        "receiver": str(payload.get("receiver") or "nexus-on-call")[:80],
        "status": str(payload.get("status") or "unknown")[:20],
        "alerts": safe_alerts,
    }
    delivery_material = json.dumps(outgoing, sort_keys=True, separators=(",", ":")).encode("utf-8")
    delivery_id = hashlib.sha256(delivery_material).hexdigest()
    outgoing["delivery_id"] = delivery_id
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(destination, json=outgoing, headers={"Idempotency-Key": delivery_id})
            response.raise_for_status()
    except Exception:
        ALERT_DELIVERIES.labels(status="failed").inc()
        raise
    ALERT_DELIVERIES.labels(status="delivered").inc()
    return len(safe_alerts)


def shutdown_observability() -> None:
    if _trace_provider is not None:
        _trace_provider.shutdown()
    if _log_provider is not None:
        _log_provider.shutdown()
