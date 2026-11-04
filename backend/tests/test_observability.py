"""Production observability contracts and safe alert delivery."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
import yaml

from app.services import malware_scanner, observability


ROOT = Path(__file__).resolve().parents[2]


def test_production_stack_is_private_and_has_owned_alert_routes():
    compose = yaml.safe_load((ROOT / "docker-compose.production.yml").read_text(encoding="utf-8"))
    services = compose["services"]

    assert {"prometheus", "alertmanager", "grafana", "tempo", "loki", "otel-collector"} <= services.keys()
    assert "ports" not in services["prometheus"]
    assert "ports" not in services["alertmanager"]
    assert "ports" not in services["tempo"]
    assert "ports" not in services["loki"]
    assert services["grafana"]["ports"] == ["${NEXUS_GRAFANA_BIND_HOST:-127.0.0.1}:${NEXUS_GRAFANA_PORT:-3001}:3000"]
    assert services["api"]["secrets"] == ["nexus-observability-ingest-token"]
    assert services["alertmanager"]["secrets"] == ["nexus-observability-ingest-token"]

    rules = yaml.safe_load((ROOT / "observability/alerts.yml").read_text(encoding="utf-8"))
    alerts = [rule for group in rules["groups"] for rule in group["rules"]]
    assert alerts
    assert all(rule["labels"].get("owner") and rule["labels"].get("escalation") for rule in alerts)


def test_metrics_use_route_templates_without_customer_identifiers():
    observability.observe_http(
        method="GET", route="/api/tickets/{ticket_id}", status_code=200, elapsed_seconds=0.01
    )
    payload, content_type = observability.metrics_payload()
    rendered = payload.decode("utf-8")

    assert "text/plain" in content_type
    assert 'route="/api/tickets/{ticket_id}"' in rendered
    assert "ticket-actual-customer-id" not in rendered


def test_operational_scrape_refreshes_dependencies_queue_and_provider_state(monkeypatch):
    class _Counts:
        def __init__(self, values):
            self.values = values

        async def count_documents(self, query):
            return self.values.get(query.get("status"), 0)

    class _Cursor:
        async def to_list(self, _limit):
            return [{"type": "xero", "last_test_status": "connected"}]

    class _Settings:
        def find(self, *_args):
            return _Cursor()

    class _Database:
        platform_event_deliveries = _Counts({"pending": 3, "retrying": 2, "processing": 1, "dead_letter": 0})
        workflow_runs = _Counts({"running": 0})
        settings = _Settings()

        async def command(self, name):
            assert name == "ping"

    async def healthy_scanner():
        return {"provider": "clamav", "ready": True}

    monkeypatch.setattr(malware_scanner, "scanner_health", healthy_scanner)
    asyncio.run(observability.refresh_operational_metrics(_Database()))
    rendered = observability.metrics_payload()[0].decode("utf-8")

    assert "nexus_event_queue_depth 6.0" in rendered
    assert 'nexus_provider_configured{provider="xero"} 1.0' in rendered
    assert 'nexus_provider_ready{provider="xero"} 1.0' in rendered
    assert 'nexus_dependency_ready{dependency="malware_scanner"} 1.0' in rendered


def test_json_log_formatter_uses_stable_safe_fields():
    record = __import__("logging").LogRecord(
        name="nexus.test", level=20, pathname=__file__, lineno=1,
        msg="request_complete correlation_id=correlation-1", args=(), exc_info=None,
    )
    payload = json.loads(observability.JsonLogFormatter().format(record))

    assert payload["logger"] == "nexus.test"
    assert payload["message"].endswith("correlation_id=correlation-1")
    assert set(payload) == {"timestamp", "level", "logger", "message", "service", "environment"}


def test_json_log_formatter_redacts_common_secret_shapes():
    record = __import__("logging").LogRecord(
        name="nexus.test", level=40, pathname=__file__, lineno=1,
        msg="provider failed api_key=live-key Authorization: Bearer live-token password=hunter2",
        args=(), exc_info=None,
    )
    message = json.loads(observability.JsonLogFormatter().format(record))["message"]

    assert "live-key" not in message
    assert "live-token" not in message
    assert "hunter2" not in message
    assert message.count("[REDACTED]") == 3


def test_production_alert_delivery_rejects_plain_http(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("NEXUS_ALERT_WEBHOOK_URL", "http://alerts.example.invalid")

    with pytest.raises(RuntimeError, match="HTTPS"):
        asyncio.run(observability.deliver_alertmanager_webhook({"alerts": []}))


def test_alertmanager_ingest_requires_exact_file_backed_bearer(monkeypatch, tmp_path):
    secret = tmp_path / "observability-token"
    secret.write_text("expected-secret\n", encoding="utf-8")
    monkeypatch.setenv("NEXUS_OBSERVABILITY_INGEST_TOKEN_FILE", str(secret))

    assert observability.observability_ingest_authorized("Bearer expected-secret") is True
    assert observability.observability_ingest_authorized("Bearer wrong-secret") is False
    assert observability.observability_ingest_authorized(None) is False


def test_alert_delivery_sanitises_payload(monkeypatch):
    captured = {}

    class _Response:
        def raise_for_status(self):
            return None

    class _Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, json, headers):
            captured.update({"url": url, "json": json, "headers": headers})
            return _Response()

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("NEXUS_ALERT_WEBHOOK_URL", "https://alerts.example.invalid/nexus")
    monkeypatch.setattr(observability.httpx, "AsyncClient", _Client)
    count = asyncio.run(observability.deliver_alertmanager_webhook({
        "receiver": "nexus-on-call",
        "alerts": [{
            "status": "firing",
            "labels": {"alertname": "NexusApiUnavailable", "owner": "platform-operations", "tenant_id": "tenant-secret"},
            "annotations": {"summary": "API unavailable", "provider_payload": "secret-body"},
        }],
    }))

    assert count == 1
    assert captured["url"].startswith("https://")
    assert captured["headers"]["Idempotency-Key"] == captured["json"]["delivery_id"]
    assert "tenant_id" not in captured["json"]["alerts"][0]["labels"]
    assert "provider_payload" not in captured["json"]["alerts"][0]["annotations"]


def test_clamav_health_uses_ping_without_uploading_bytes(monkeypatch):
    async def exercise():
        received = None

        async def handle(reader, writer):
            nonlocal received
            received = await reader.readuntil(b"\0")
            writer.write(b"PONG\0")
            await writer.drain()
            writer.close()
            await writer.wait_closed()

        server = await asyncio.start_server(handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        monkeypatch.setenv("NEXUS_MALWARE_SCANNER", "clamav")
        monkeypatch.setenv("NEXUS_CLAMAV_HOST", "127.0.0.1")
        monkeypatch.setenv("NEXUS_CLAMAV_PORT", str(port))
        try:
            result = await malware_scanner.scanner_health()
        finally:
            server.close()
            await server.wait_closed()
        return received, result

    received, result = asyncio.run(exercise())
    assert received == b"zPING\0"
    assert result == {"provider": "clamav", "ready": True}
