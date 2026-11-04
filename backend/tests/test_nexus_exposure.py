"""Scope and evidence boundaries for the Nexus Exposure read model."""

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import nexus_exposure  # noqa: E402


def _async_result(value):
    async def handler(*_args, **_kwargs):
        return value

    return handler


def _install_sources(monkeypatch, *, domains=(), certificates=(), dmarc=(), sites=(), vulnerabilities=(), triggers=()):
    monkeypatch.setattr(nexus_exposure, "get_domains", _async_result(list(domains)))
    monkeypatch.setattr(nexus_exposure, "get_ssl_certificates", _async_result(list(certificates)))
    monkeypatch.setattr(nexus_exposure, "nexus_dmarc_overview", _async_result({"domains": list(dmarc)}))
    monkeypatch.setattr(nexus_exposure, "get_web_studio_overview", _async_result({"sites": list(sites)}))
    monkeypatch.setattr(nexus_exposure, "get_vulnerability_overview", _async_result({"findings": list(vulnerabilities)}))
    monkeypatch.setattr(nexus_exposure, "get_canary_status", _async_result({"triggers": list(triggers)}))


def _restricted_user():
    return {
        "id": "tech-a",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def test_exposure_filters_foreign_source_rows_and_preserves_unknowns(monkeypatch):
    expires_soon = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    _install_sources(
        monkeypatch,
        domains=[
            {"id": "domain-a", "client_id": "client-a", "client_name": "Alpha", "domain": "alpha.example", "expiry_date": expires_soon},
            {"id": "domain-b", "client_id": "client-b", "client_name": "Bravo", "domain": "bravo.example", "expiry_date": expires_soon},
            {"id": "domain-unbound", "client_id": "", "client_name": "Unassigned", "domain": "unbound.example", "expiry_date": expires_soon},
        ],
        vulnerabilities=[
            {"id": "finding-a", "client_id": "client-a", "client_name": "Alpha", "title": "Alpha patch", "severity": "high", "status": "open", "device_name": "ALPHA-01"},
            {"id": "finding-b", "client_id": "client-b", "client_name": "Bravo", "title": "Bravo patch", "severity": "critical", "status": "open", "device_name": "BRAVO-01"},
        ],
    )

    result = asyncio.run(nexus_exposure.get_nexus_exposure_overview(client_id="", current_user=_restricted_user()))

    assert result["scope"]["mode"] == "restricted"
    assert {item["client_id"] for item in result["exposures"]} == {"client-a"}
    assert all("Bravo" not in item["title"] for item in result["exposures"])
    assert all(item["client_id"] for item in result["exposures"])
    assert next(source for source in result["sources"] if source["key"] == "domains")["records"] == 1
    identity_leaks = next(source for source in result["sources"] if source["key"] == "identity_leaks")
    assert identity_leaks["state"] == "not_connected"
    assert "makes no claim" in identity_leaks["detail"]


def test_exposure_rejects_foreign_selected_client_before_reading_sources(monkeypatch):
    calls = []

    async def deny_scope(_user, client_id, **kwargs):
        calls.append((client_id, kwargs.get("operation")))
        raise HTTPException(status_code=403, detail="Foreign client")

    async def unexpected_source(*_args, **_kwargs):
        raise AssertionError("Exposure must deny a foreign selected client before reading source evidence")

    monkeypatch.setattr(nexus_exposure, "assert_client_scope", deny_scope)
    for source_name in (
        "get_domains",
        "get_ssl_certificates",
        "nexus_dmarc_overview",
        "get_web_studio_overview",
        "get_vulnerability_overview",
        "get_canary_status",
    ):
        monkeypatch.setattr(nexus_exposure, source_name, unexpected_source)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(nexus_exposure.get_nexus_exposure_overview(client_id="client-b", current_user=_restricted_user()))

    assert denied.value.status_code == 403
    assert calls == [("client-b", "nexus_exposure.overview")]


def test_exposure_passes_selected_client_to_capped_source_overviews(monkeypatch):
    _install_sources(monkeypatch)
    selected_calls = []

    async def allow_scope(_user, client_id, **kwargs):
        assert client_id == "client-a"
        return {"mode": "restricted", "client_ids": ["client-a"]}

    async def vulnerability_overview(*_args, **kwargs):
        selected_calls.append(("vulnerabilities", kwargs.get("client_id")))
        return {"findings": []}

    async def canary_status(*_args, **kwargs):
        selected_calls.append(("canaries", kwargs.get("client_id")))
        return {"triggers": []}

    monkeypatch.setattr(nexus_exposure, "assert_client_scope", allow_scope)
    monkeypatch.setattr(nexus_exposure, "get_vulnerability_overview", vulnerability_overview)
    monkeypatch.setattr(nexus_exposure, "get_canary_status", canary_status)

    result = asyncio.run(nexus_exposure.get_nexus_exposure_overview(client_id="client-a", current_user=_restricted_user()))

    assert result["scope"]["selected_client_id"] == "client-a"
    assert selected_calls == [("vulnerabilities", "client-a"), ("canaries", "client-a")]


def test_exposure_marks_unavailable_source_without_creating_a_clean_result(monkeypatch):
    _install_sources(monkeypatch)

    async def unavailable_domains(*_args, **_kwargs):
        raise RuntimeError("Provider not reachable")

    monkeypatch.setattr(nexus_exposure, "get_domains", unavailable_domains)

    result = asyncio.run(nexus_exposure.get_nexus_exposure_overview(client_id="", current_user={"id": "admin-1", "role": "admin"}))

    domains = next(source for source in result["sources"] if source["key"] == "domains")
    assert domains["state"] == "unavailable"
    assert domains["records"] == 0
    assert result["summary"]["unavailable_sources"] >= 2  # domain source + explicitly unconnected leak intelligence
    assert "does not discover" in result["boundary"]
    assert "never scans arbitrary" in result["discovery_boundary"]
