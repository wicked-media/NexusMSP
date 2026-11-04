"""Focused safety contracts for role-aware Microsoft 365 delivery tests."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from app.routers import email_utils


class _Settings:
    def __init__(self):
        self.updates: list[tuple[dict, dict]] = []

    async def update_one(self, query, update, **_kwargs):
        self.updates.append((query, update))


class _Database:
    def __init__(self):
        self.settings = _Settings()


def test_role_delivery_test_uses_the_selected_route_and_records_the_actual_sender(monkeypatch):
    async def exercise():
        database = _Database()
        delivery_calls: list[dict] = []

        async def allow_admin(_current_user):
            return None

        async def configured():
            return True

        async def deliver(to_email, subject, html, category="notifications", **_kwargs):
            delivery_calls.append({"to": to_email, "subject": subject, "html": html, "category": category})
            return {
                "status": "sent",
                "sender": "field-jobs@example.com",
                "message": "Accepted by Microsoft Graph",
            }

        monkeypatch.setattr(email_utils, "db", database)
        monkeypatch.setattr(email_utils, "_require_admin", allow_admin)
        monkeypatch.setattr(email_utils, "is_microsoft365_configured", configured)
        monkeypatch.setattr(email_utils, "send_email", deliver)

        result = await email_utils.test_microsoft365_delivery(
            {"to_email": "operator@example.com", "category": "service_job_replies"},
            current_user={"id": "admin-1", "email": "admin@example.com", "name": "Nexus Admin"},
        )

        assert result["status"] == "sent"
        assert result["category"] == "service_job_replies"
        assert delivery_calls[0]["category"] == "service_job_replies"
        assert "Service Job Replies" in delivery_calls[0]["subject"]

        query, update = database.settings.updates[-1]
        assert query == {"type": "o365_mailbox"}
        assert update["$set"]["last_outbound_test_role"] == "service_job_replies"
        assert update["$set"]["last_outbound_test_sender"] == "field-jobs@example.com"

    asyncio.run(exercise())


def test_role_delivery_test_rejects_an_invalid_role_before_trying_to_send(monkeypatch):
    async def exercise():
        async def allow_admin(_current_user):
            return None

        monkeypatch.setattr(email_utils, "_require_admin", allow_admin)

        with pytest.raises(HTTPException) as error:
            await email_utils.test_microsoft365_delivery(
                {"to_email": "operator@example.com", "category": "ticket replies!"},
                current_user={"id": "admin-1", "email": "admin@example.com", "name": "Nexus Admin"},
            )

        assert error.value.status_code == 400
        assert error.value.detail == "Invalid outbound email role"

    asyncio.run(exercise())


def test_organisation_footer_is_applied_once_and_escapes_branding_text(monkeypatch):
    class _BrandingSettings:
        async def find_one(self, _query, _projection):
            return {
                "email_sender_name": "Nexus <Operations>",
                "email_footer_text": "Support <support@example.com>\nAuthorised users only",
            }

    class _BrandingDatabase:
        settings = _BrandingSettings()

    async def exercise():
        monkeypatch.setattr(email_utils, "db", _BrandingDatabase())
        rendered = await email_utils._append_organisation_email_footer("<p>Update</p>")

        assert "<!--nx-organisation-footer-->" in rendered
        assert "Nexus &lt;Operations&gt;" in rendered
        assert "Support &lt;support@example.com&gt;<br/>Authorised users only" in rendered
        assert await email_utils._append_organisation_email_footer(rendered) == rendered

    asyncio.run(exercise())
