"""CSAT workflow: seeded responses, duplicate surfaces and delivery honesty."""

import asyncio
import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import csat_surveys, tech_performance, ticket_workflow
from app.routers import email_utils


USER = {"id": "tech-1", "name": "Tech One", "role": "admin", "tenant_id": "tenant-1"}


class _Cursor:
    def __init__(self, items):
        self.items = items

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, limit):
        return self.items[:limit]


class _Collection:
    def __init__(self, documents=None):
        self.documents = [dict(document) for document in (documents or [])]
        self.inserted = []
        self.updates = []
        self.queries = []

    async def insert_one(self, document):
        self.inserted.append(dict(document))
        self.documents.append(dict(document))
        return SimpleNamespace(inserted_id=len(self.documents))

    async def find_one(self, query, _projection=None):
        self.queries.append(query)
        for document in self.documents:
            if all(document.get(key) == value for key, value in query.items()):
                return dict(document)
        return None

    def find(self, query=None, _projection=None):
        self.queries.append(query or {})
        return _Cursor([dict(document) for document in self.documents])

    async def update_one(self, query, update):
        self.updates.append(dict(update["$set"]))
        for document in self.documents:
            if all(document.get(key) == value for key, value in query.items()):
                document.update(update["$set"])
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


def _install_db(monkeypatch, module, **collections):
    monkeypatch.setattr(module, "db", SimpleNamespace(**collections))
    return collections


def _patch_ticket_scope(monkeypatch, ticket):
    async def fake_scope(_ticket_id, _user, _operation):
        return dict(ticket)

    monkeypatch.setattr(ticket_workflow, "_ticket_in_scope", fake_scope)


def _patch_audit(monkeypatch):
    audit = []

    async def fake_audit(ticket_id, user, action, details, **_kwargs):
        audit.append({"ticket_id": ticket_id, "action": action, "details": details})

    monkeypatch.setattr(ticket_workflow, "_audit", fake_audit)
    return audit


def test_startup_sample_data_module_was_removed():
    # The demo seeder that fabricated CSAT ratings and other business records is
    # gone, not merely disabled, so no runtime can turn it back on.
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("app.services.seed")


def test_dashboard_ignores_scored_rows_without_a_response_status(monkeypatch):
    surveys = _Collection(
        [
            # Legacy demo row: a score, no workflow status, never answered by a customer.
            {"id": "csat-001", "score": 5, "client_name": "Acme", "tech_name": "Tech One"},
            {"id": "real-1", "score": 4, "status": "responded", "client_name": "Acme", "tech_name": "Tech One"},
        ]
    )
    _install_db(monkeypatch, csat_surveys, csat_surveys=surveys)

    dashboard = asyncio.run(csat_surveys.csat_dashboard(current_user=USER))
    responses = asyncio.run(csat_surveys.get_surveys(current_user=USER))

    assert dashboard["total_responses"] == 1
    assert [survey["id"] for survey in responses] == ["real-1"]


def test_public_survey_exposes_only_rendering_fields(monkeypatch):
    surveys = _Collection(
        [
            {
                "id": "survey-1",
                "status": "sent",
                "ticket_number": "TKT-0001",
                "client_name": "Acme",
                "contact_email": "customer@example.com",
                "tenant_id": "tenant-1",
            }
        ]
    )
    _install_db(monkeypatch, csat_surveys, csat_surveys=surveys)

    payload = asyncio.run(csat_surveys.get_public_survey("survey-1", Response()))

    assert payload == {
        "id": "survey-1",
        "ticket_number": "TKT-0001",
        "client_name": "Acme",
        "status": "open",
    }
    assert "contact_email" not in payload
    assert "tenant_id" not in payload


@pytest.mark.parametrize(
    "documents",
    [
        [],
        [{"id": "survey-1", "status": "responded", "ticket_number": "TKT-0001"}],
    ],
)
def test_public_survey_is_unavailable_once_answered(monkeypatch, documents):
    _install_db(monkeypatch, csat_surveys, csat_surveys=_Collection(documents))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(csat_surveys.get_public_survey("survey-1", Response()))
    assert exc.value.status_code == 404


def test_legacy_csat_surfaces_are_retired():
    with pytest.raises(HTTPException) as report:
        asyncio.run(tech_performance.get_csat_report(current_user=USER))
    assert report.value.status_code == 410

    with pytest.raises(HTTPException) as response:
        asyncio.run(csat_surveys.respond_public("survey-1"))
    assert response.value.status_code == 410


def test_send_csat_without_a_mailbox_never_claims_delivery(monkeypatch):
    surveys = _Collection()
    tickets = _Collection([{"id": "ticket-1", "tenant_id": "tenant-1"}])
    _install_db(monkeypatch, ticket_workflow, csat_surveys=surveys, tickets=tickets)
    _patch_ticket_scope(
        monkeypatch,
        {
            "id": "ticket-1",
            "ticket_number": "TKT-0001",
            "client_id": "client-1",
            "client_name": "Acme",
            "contact_email": "customer@example.com",
        },
    )
    audit = _patch_audit(monkeypatch)

    async def mocked_email(*_args, **_kwargs):
        return {"status": "mocked", "message": "Email logged (Microsoft 365 mailbox not connected)"}

    monkeypatch.setattr(email_utils, "send_email", mocked_email)

    result = asyncio.run(ticket_workflow.send_csat("ticket-1", current_user=USER))

    assert result["delivery"]["mailed"] is False
    assert result["survey_path"].startswith("/feedback/")
    assert "csat_sent" not in tickets.updates[0]
    assert tickets.updates[0]["csat_link_created_at"]
    assert audit[-1]["action"] == "csat_link_created"
    assert surveys.inserted[0]["status"] == "sent"


def test_send_csat_records_a_send_only_when_mail_is_accepted(monkeypatch):
    surveys = _Collection()
    tickets = _Collection([{"id": "ticket-1", "tenant_id": "tenant-1"}])
    _install_db(monkeypatch, ticket_workflow, csat_surveys=surveys, tickets=tickets)
    _patch_ticket_scope(
        monkeypatch,
        {
            "id": "ticket-1",
            "ticket_number": "TKT-0001",
            "client_id": "client-1",
            "contact_email": "customer@example.com",
        },
    )
    _patch_audit(monkeypatch)

    async def accepted_email(*_args, **_kwargs):
        return {"status": "sent", "message": "Email sent via Microsoft 365"}

    monkeypatch.setattr(email_utils, "send_email", accepted_email)

    result = asyncio.run(ticket_workflow.send_csat("ticket-1", current_user=USER))

    assert result["delivery"]["mailed"] is True
    assert tickets.updates[0]["csat_sent"] is True
    assert tickets.updates[0]["csat_sent_at"]


def test_send_csat_keeps_the_link_when_the_provider_raises(monkeypatch):
    surveys = _Collection()
    tickets = _Collection([{"id": "ticket-1", "tenant_id": "tenant-1"}])
    _install_db(monkeypatch, ticket_workflow, csat_surveys=surveys, tickets=tickets)
    _patch_ticket_scope(
        monkeypatch,
        {"id": "ticket-1", "ticket_number": "TKT-0001", "contact_email": "customer@example.com"},
    )
    audit = _patch_audit(monkeypatch)

    async def broken_email(*_args, **_kwargs):
        raise RuntimeError("graph timeout")

    monkeypatch.setattr(email_utils, "send_email", broken_email)

    result = asyncio.run(ticket_workflow.send_csat("ticket-1", current_user=USER))

    assert result["delivery"]["mailed"] is False
    assert len(surveys.inserted) == 1
    assert audit[-1]["action"] == "csat_link_created"
    assert "csat_sent" not in tickets.updates[0]


def test_respond_csat_refuses_a_second_answer(monkeypatch):
    surveys = _Collection(
        [{"id": "survey-1", "status": "sent", "ticket_id": "ticket-1", "tenant_id": "tenant-1"}]
    )
    _install_db(monkeypatch, ticket_workflow, csat_surveys=surveys)
    _patch_audit(monkeypatch)

    async def already_answered(_query, _update):
        return SimpleNamespace(matched_count=0, modified_count=0)

    surveys.update_one = already_answered

    with pytest.raises(HTTPException) as exc:
        asyncio.run(ticket_workflow.respond_csat("survey-1", payload={"score": 5}))
    assert exc.value.status_code == 409
