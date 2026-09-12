"""Security regressions for the governed Stripe customer billing portal.

The portal gives customers a bearer-like Stripe session URL and exposes
collections data.  Restricted technicians may only see and act on their own
client scope; global configuration must stay global-admin controlled and must
not return provider secrets.
"""

from __future__ import annotations

import asyncio
import inspect
import sys
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import email_utils, stripe_billing_portal as portal
from app.services import activity, scope_permissions


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            continue
        if actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    def sort(self, *_args: Any, **_kwargs: Any):
        return self

    async def to_list(self, _limit: int) -> list[dict[str, Any]]:
        return deepcopy(self.rows)


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], *, upsert: bool = False, **_kwargs: Any):
        for row in self.rows:
            if not _matches(row, query):
                continue
            row.update(deepcopy(update.get("$set", {})))
            for field, value in update.get("$push", {}).items():
                row.setdefault(field, []).append(deepcopy(value))
            return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if upsert:
            document = deepcopy(query)
            document.update(deepcopy(update.get("$set", {})))
            self.rows.append(document)
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=document.get("id"))
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)

    async def count_documents(self, query: dict[str, Any]) -> int:
        return sum(1 for row in self.rows if _matches(row, query))


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            users=_Collection([{"id": "admin-1", "role": "admin", "is_admin": True}]),
            clients=_Collection(
                [
                    {
                        "id": "client-a",
                        "name": "Client A",
                        "email": "billing-a@example.com",
                        "mrr": 100,
                    },
                    {
                        "id": "client-b",
                        "name": "Client B",
                        "email": "billing-b@example.com",
                        "mrr": 200,
                        "stripe_customer_id": "cus_other_client",
                    },
                ]
            ),
            invoices=_Collection(
                [
                    {"id": "invoice-a-sent", "client_id": "client-a", "status": "sent", "amount_due": 25, "total": 25},
                    {"id": "invoice-a-paid", "client_id": "client-a", "status": "paid", "amount_due": 0, "total": 100},
                    {"id": "invoice-b-overdue", "client_id": "client-b", "status": "overdue", "amount_due": 500, "total": 500},
                ]
            ),
            settings=_Collection(
                [
                    {
                        "type": "stripe_billing_portal",
                        "enabled": True,
                        "allow_self_service": True,
                        "payment_methods": ["card"],
                        "auto_reminders": True,
                        "provider_secret": "must-never-be-returned",
                    }
                ]
            ),
            billing_portal_links=_Collection(),
            payment_reminders=_Collection(
                [
                    {"id": "rem-a", "client_id": "client-a", "status": "sent"},
                    {"id": "rem-b", "client_id": "client-b", "status": "failed"},
                ]
            ),
            activity_logs=_Collection(),
            scope_denials=_Collection(),
        )


def _restricted_client_a() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A Technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _global_admin() -> dict[str, Any]:
    return {
        "id": "admin-1",
        "name": "Administrator",
        "role": "admin",
        "is_admin": True,
        "client_scope_mode": "all",
    }


def _install_database(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(portal, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    monkeypatch.setattr(activity, "db", database)
    return database


def _install_fake_stripe(monkeypatch: pytest.MonkeyPatch) -> None:
    stripe_module = SimpleNamespace()
    stripe_module.Customer = SimpleNamespace(
        create=lambda **_kwargs: SimpleNamespace(id="cus_client_a"),
    )
    stripe_module.billing_portal = SimpleNamespace(
        Session=SimpleNamespace(
            create=lambda **_kwargs: SimpleNamespace(
                id="bps_client_a",
                url="https://billing.stripe.test/session/client-a",
            )
        )
    )
    monkeypatch.setitem(sys.modules, "stripe", stripe_module)


def test_billing_portal_status_and_stats_are_scoped_to_the_current_technician(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_billing_portal_status_and_stats_are_scoped_to_the_current_technician(monkeypatch))


async def _test_billing_portal_status_and_stats_are_scoped_to_the_current_technician(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_database(monkeypatch)
    user = _restricted_client_a()

    clients = await portal.get_client_billing_status(current_user=user)
    assert clients == [
        {
            "id": "client-a",
            "name": "Client A",
            "email": "billing-a@example.com",
            "mrr": 100,
            "total_invoices": 2,
            "outstanding_amount": 25,
            "overdue_count": 0,
            "has_payment_method": False,
        }
    ]
    assert "stripe_customer_id" not in clients[0]

    stats = await portal.get_billing_portal_stats(current_user=user)
    assert stats["total_clients"] == 1
    assert stats["total_revenue"] == 100
    assert stats["outstanding"] == 25
    assert stats["overdue"] == 0
    assert stats["reminder_attempts"] == 1
    assert stats["reminders_sent"] == 1
    assert stats["reminder_delivery_issues"] == 0


def test_billing_portal_configuration_requires_global_scope_and_never_echoes_secret_fields(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_billing_portal_configuration_requires_global_scope_and_never_echoes_secret_fields(monkeypatch))


async def _test_billing_portal_configuration_requires_global_scope_and_never_echoes_secret_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_not_returned")

    with pytest.raises(HTTPException) as denied:
        await portal.get_billing_portal_config(request=None, current_user=_restricted_client_a())
    assert denied.value.status_code == 403
    assert database.scope_denials.rows[0]["operation"] == "billing.portal.configuration.read"

    config = await portal.get_billing_portal_config(request=None, current_user=_global_admin())
    assert config == {
        "enabled": True,
        "allow_self_service": True,
        "payment_methods": ["card"],
        "auto_reminders": True,
        "stripe_configured": True,
    }
    assert "provider_secret" not in config
    assert "api_key" not in config

    await portal.update_billing_portal_config(
        {"enabled": False, "api_key": "sk_should_not_be_stored"},
        request=None,
        current_user=_global_admin(),
    )
    stored = database.settings.rows[0]
    assert stored["enabled"] is False
    assert "api_key" not in stored
    assert database.activity_logs.rows[-1]["action"] == "billing_portal_configuration_updated"
    assert database.activity_logs.rows[-1]["metadata"] == {"updated_fields": ["enabled"]}


def test_portal_sessions_require_client_scope_and_write_audit_evidence(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_portal_sessions_require_client_scope_and_write_audit_evidence(monkeypatch))


async def _test_portal_sessions_require_client_scope_and_write_audit_evidence(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    _install_fake_stripe(monkeypatch)
    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_not_returned")
    user = _restricted_client_a()

    with pytest.raises(HTTPException) as foreign:
        await portal.create_client_portal_link("client-b", request=None, current_user=user)
    assert foreign.value.status_code == 404
    assert database.billing_portal_links.rows == []
    assert database.scope_denials.rows[-1]["operation"] == "billing.portal.link.create"

    result = await portal.create_client_portal_link("client-a", request=None, current_user=user)
    assert result["client_id"] == "client-a"
    assert result["url"] == "https://billing.stripe.test/session/client-a"
    assert "api_key" not in result
    assert database.clients.rows[0]["stripe_customer_id"] == "cus_client_a"
    assert len(database.billing_portal_links.rows) == 1
    audit = database.activity_logs.rows[-1]
    assert audit["action"] == "billing_portal_session_created"
    assert audit["entity_id"] == "client-a"
    assert audit["metadata"]["customer_created"] is True
    assert "url" not in audit["metadata"]


def test_portal_reminders_mask_foreign_clients_before_any_delivery(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_portal_reminders_mask_foreign_clients_before_any_delivery(monkeypatch))


async def _test_portal_reminders_mask_foreign_clients_before_any_delivery(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)

    with pytest.raises(HTTPException) as foreign:
        await portal.send_payment_reminder({"client_id": "client-b"}, request=None, current_user=_restricted_client_a())
    assert foreign.value.status_code == 404
    assert len(database.payment_reminders.rows) == 2
    assert database.scope_denials.rows[-1]["operation"] == "billing.portal.reminder.send"


def test_portal_reminder_invoice_reference_must_belong_to_the_reminded_client(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_portal_reminder_invoice_reference_must_belong_to_the_reminded_client(monkeypatch))


async def _test_portal_reminder_invoice_reference_must_belong_to_the_reminded_client(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    user = _restricted_client_a()

    with pytest.raises(HTTPException) as foreign_invoice:
        await portal.send_payment_reminder(
            {"client_id": "client-a", "invoice_id": "invoice-b-overdue"},
            request=None,
            current_user=user,
        )
    assert foreign_invoice.value.status_code == 404
    assert len(database.payment_reminders.rows) == 2
    assert database.scope_denials.rows[-1]["operation"] == "billing.portal.reminder.invoice"

    with pytest.raises(HTTPException) as mismatched_global_invoice:
        await portal.send_payment_reminder(
            {"client_id": "client-a", "invoice_id": "invoice-b-overdue"},
            request=None,
            current_user=_global_admin(),
        )
    assert mismatched_global_invoice.value.status_code == 404
    assert len(database.payment_reminders.rows) == 2

    async def _delivered(*_args: Any, **_kwargs: Any) -> dict[str, str]:
        return {"status": "sent", "message": "sent", "email_id": "message-a"}

    monkeypatch.setattr(email_utils, "send_email", _delivered)
    result = await portal.send_payment_reminder(
        {"client_id": "client-a", "invoice_id": "invoice-a-sent"},
        request=None,
        current_user=user,
    )
    assert result["sent"] is True
    assert database.payment_reminders.rows[-1]["client_id"] == "client-a"
    assert database.payment_reminders.rows[-1]["invoice_id"] == "invoice-a-sent"


def test_portal_session_provider_errors_do_not_echo_stripe_details(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_portal_session_provider_errors_do_not_echo_stripe_details(monkeypatch))


async def _test_portal_session_provider_errors_do_not_echo_stripe_details(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    stripe_module = SimpleNamespace(
        Customer=SimpleNamespace(create=lambda **_kwargs: SimpleNamespace(id="cus_client_a")),
        billing_portal=SimpleNamespace(
            Session=SimpleNamespace(
                create=lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("sk_test_provider_detail")),
            )
        ),
    )
    monkeypatch.setitem(sys.modules, "stripe", stripe_module)
    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_not_returned")

    with pytest.raises(HTTPException) as failed:
        await portal.create_client_portal_link("client-a", request=None, current_user=_restricted_client_a())
    assert failed.value.status_code == 502
    assert failed.value.detail == "Stripe could not create the customer portal session"
    assert "sk_test" not in failed.value.detail
    assert database.billing_portal_links.rows == []
    assert database.activity_logs.rows == []


def test_billing_portal_routes_use_stable_action_permissions():
    expected_permissions = {
        ("/billing-portal/config", "GET"): "billing.integration.manage",
        ("/billing-portal/config", "PUT"): "billing.integration.manage",
        ("/billing-portal/clients", "GET"): "billing.portal.view",
        ("/billing-portal/clients/{client_id}/create-portal-link", "POST"): "billing.portal.link.create",
        ("/billing-portal/send-reminder", "POST"): "billing.portal.reminder.send",
        ("/billing-portal/stats", "GET"): "billing.portal.view",
    }
    for (path, method), expected_permission in expected_permissions.items():
        route = next(candidate for candidate in portal.router.routes if candidate.path == path and method in candidate.methods)
        permissions = {
            inspect.getclosurevars(dependency.call).nonlocals["permission_id"]
            for dependency in route.dependant.dependencies
            if dependency.call is not None and "permission_id" in inspect.getclosurevars(dependency.call).nonlocals
        }
        assert expected_permission in permissions
