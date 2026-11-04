"""Regressions for the shared client-facing document output.

The reports hub, QBR packs, invoices, purchase orders and portal audit records
all print through ``app.services.nexus_document_pdf``, so these checks pin the
properties a customer-facing document must keep: a real PDF, one numbered
section per evidence group, a unit read from the field name rather than from
magnitude, and a stated page count.
"""

from __future__ import annotations

import asyncio
import re
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException
from reportlab import rl_config

from app.routers import scheduled_reports
from app.services.nexus_document_pdf import render_nexus_document_pdf

BRANDING = {"company_name": "Nexus Test MSP", "primary_color": "#14B8A6"}

SECTIONS: list[tuple[str, Any]] = [
    ("Summary", {"tickets_total": 148, "devices_total": 214, "devices_online": 201}),
    ("Tickets", {"by_status": {"open": 7, "resolved": 121, "closed": 15}, "by_priority": {"high": 25}}),
    ("Billing", {"total_invoiced": 184320.55, "outstanding": 33100.45, "invoice_count": 63}),
]


def _render(**overrides) -> bytes:
    """Render without content compression so recorded text can be asserted."""
    previous = rl_config.pageCompression
    rl_config.pageCompression = 0
    try:
        return render_nexus_document_pdf(
            **{
                "title": "Client assurance pack",
                "document_kind": "Service operations",
                "subtitle": "Managed service evidence",
                "metadata": [("Generated", "11 Oct 2026 at 22:15 UTC")],
                "metric_cards": [("Managed devices", 214, "All permitted clients"), ("Open tickets", 12)],
                "sections": SECTIONS,
                "branding": BRANDING,
                "generated_by": "Aaron",
                **overrides,
            }
        )
    finally:
        rl_config.pageCompression = previous


def test_document_is_a_pdf_with_numbered_sections_and_evidence_tables():
    rendered = _render()

    assert rendered.startswith(b"%PDF-")
    assert rendered.rstrip().endswith(b"%%EOF")
    for expected in (
        b"Client assurance pack",
        b"PREPARED BY",
        b"Aaron",
        b"IN THIS DOCUMENT",
        b"BY STATUS",
        b"Category",
        b"Share of total",
        b"84.6%",
        b"$33,100.45",
    ):
        assert expected in rendered, expected


def test_a_record_group_is_never_collapsed_into_one_line():
    rendered = _render()

    # The previous layout printed this breakdown as "Open: 7; Resolved: 121".
    assert b"Open: 7; Resolved" not in rendered
    assert b"Total" in rendered


def test_every_unit_is_read_from_the_field_name_and_never_from_magnitude():
    rendered = _render(sections=[("Summary", {"tickets_total": 148, "invoice_count": 63, "outstanding": 125})])

    assert b"148" in rendered
    assert b"$148.00" not in rendered
    assert b"$63.00" not in rendered
    assert b"$125.00" in rendered


def test_page_count_is_stated_rather_than_left_open():
    rendered = _render()

    assert re.search(rb"Page 1 of \d+", rendered), "the footer must state the page total"


def test_field_names_read_as_client_language_not_database_columns():
    rendered = _render(sections=[("Summary", {
        "sla_compliance_pct": 96.4, "m365_mailboxes": 118, "rpo_hours": 24, "device_id": "dev-1",
    })])

    for expected in (b"SLA Compliance", b"M365 Mailboxes", b"RPO Hours", b"Device ID"):
        assert expected in rendered, expected
    # A leaked column name is exactly what made a generated pack read as a
    # database dump rather than a client document.
    assert b"Sla Compliance Pct" not in rendered
    assert b"Pct" not in rendered


def test_a_measured_value_does_not_print_float_padding():
    rendered = _render(sections=[("Summary", {
        "sla_compliance_pct": 96.4, "average_resolution_hours": 6.4, "invoice_count": 63,
    })])

    assert b"96.4%" in rendered
    assert b"96.40%" not in rendered
    assert b"6.4" in rendered
    assert b"6.40" not in rendered
    # Currency is the one unit that must keep its cents.
    assert b"$33,100.45" in _render()


class _Collection:
    """Minimal stand-in: the scoped query semantics are covered elsewhere."""

    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = rows

    async def find_one(self, query: dict[str, Any], projection: dict[str, Any] | None = None):
        return deepcopy(self.rows[0]) if self.rows else None

    async def update_one(self, query: dict[str, Any], update: dict[str, Any]):
        return SimpleNamespace(modified_count=0)


def _database(*, client_ids: list[str]) -> SimpleNamespace:
    history = {
        "id": "rrh-1", "output_id": "sro-1", "tenant_id": "nexus-local", "client_ids": client_ids,
        "report_type": "service_operations", "name": "Client assurance pack - Q3",
        "generated_at": "2026-10-11T22:15:00+00:00", "generated_by": "Aaron", "origin": "on_demand",
    }
    output = {
        "id": "sro-1", "schedule_id": "manual-1", "tenant_id": "nexus-local", "client_ids": client_ids,
        "schedule_name": "Client assurance pack", "report_type": "service_operations",
        "generated_at": "2026-10-11T22:15:00+00:00", "generated_by": "Aaron",
        "scope": {"client_ids": client_ids, "period": "Current system snapshot", "scope_mode": "all"},
        "sections": dict(SECTIONS),
    }
    return SimpleNamespace(
        report_run_history=_Collection([history]),
        scheduled_report_outputs=_Collection([output]),
        settings=_Collection([{"type": "branding", "value": BRANDING}]),
    )


async def _download(output_id: str, user: dict[str, Any]):
    response = await scheduled_reports.download_generated_report_pdf(output_id, current_user=user)
    return response, b"".join([chunk async for chunk in response.body_iterator])


def test_generated_report_pdf_endpoint_returns_a_downloadable_pdf(monkeypatch):
    monkeypatch.setattr(scheduled_reports, "db", _database(client_ids=["client-1"]))
    user = {"id": "user-1", "name": "Aaron", "role": "admin", "tenant_id": "nexus-local"}

    response, body = asyncio.run(_download("sro-1", user))

    assert response.media_type == "application/pdf"
    assert body.startswith(b"%PDF-")
    assert "filename=" in response.headers["content-disposition"]


def test_generated_report_pdf_endpoint_hides_a_record_without_a_client_boundary(monkeypatch):
    # A restricted operator cannot be proven safe against a retained record that
    # carries no client boundary, so the document must not be produced at all.
    monkeypatch.setattr(scheduled_reports, "db", _database(client_ids=[]))
    user = {
        "id": "user-2", "name": "Technician", "tenant_id": "nexus-local",
        "client_scope_mode": "restricted", "client_scope_ids": ["client-1"],
    }

    with pytest.raises(HTTPException) as raised:
        asyncio.run(scheduled_reports.download_generated_report_pdf("sro-1", current_user=user))

    assert raised.value.status_code == 404
