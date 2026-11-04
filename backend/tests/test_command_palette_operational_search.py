"""Focused contracts for the operational search surface.

These tests exercise the server-side composition layer rather than a browser
mock.  They make sure a restricted technician cannot receive a foreign
ticket/contact and that the identifiers technicians actually type (ticket
prefixes, phone fragments and product barcodes) resolve into actionable rows.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
import re
from types import SimpleNamespace

from app.routers import command_palette, csat_surveys, products


def _path_values(value, path: str):
    values = [value]
    for segment in path.split("."):
        next_values = []
        for current in values:
            if isinstance(current, dict):
                next_values.append(current.get(segment))
            elif isinstance(current, list):
                for item in current:
                    if isinstance(item, dict):
                        next_values.append(item.get(segment))
        values = next_values
    return [value for value in values if value is not None]


def _matches(row: dict, query: dict) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue

        values = _path_values(row, key)
        if isinstance(expected, dict):
            if "$in" in expected and not any(value in expected["$in"] for value in values):
                return False
            if "$size" in expected and not any(isinstance(value, list) and len(value) == expected["$size"] for value in values):
                return False
            if "$exists" in expected:
                exists = bool(values)
                if bool(expected["$exists"]) != exists:
                    return False
            if "$ne" in expected and any(value == expected["$ne"] for value in values):
                return False
            if "$regex" in expected:
                flags = re.IGNORECASE if "i" in str(expected.get("$options") or "") else 0
                if not any(re.search(str(expected["$regex"]), str(value), flags) for value in values):
                    return False
        elif expected not in values:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict]):
        self.rows = deepcopy(rows)
        self._limit = len(self.rows)

    def limit(self, value: int):
        self._limit = value
        return self

    def sort(self, *_args):
        return self

    async def to_list(self, value: int):
        return deepcopy(self.rows[: min(value, self._limit)])


class _Collection:
    def __init__(self, rows: list[dict] | None = None):
        self.rows = deepcopy(rows or [])

    def find(self, query: dict, _projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query)])


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            tickets=_Collection([
                {"id": "ticket-a", "client_id": "client-a", "ticket_number": "TKT-48291", "title": "MFA reset", "client_name": "Acme"},
                {"id": "ticket-b", "client_id": "client-b", "ticket_number": "TKT-48299", "title": "Foreign ticket", "client_name": "Other"},
            ]),
            clients=_Collection([
                {"id": "client-a", "name": "Acme", "phone": "+61 412 555 010", "contacts": [{"id": "embedded-a", "name": "Mary Acme", "phone": "+61 412 555 010"}]},
                {"id": "client-b", "name": "Other", "phone": "+61 499 000 000", "contacts": [{"id": "embedded-b", "name": "Foreign Contact", "phone": "+61 499 000 000"}]},
            ]),
            contacts=_Collection([
                {"id": "contact-a", "client_id": "client-a", "name": "Mary Acme", "phone": "+61 412 555 010", "email": "mary@acme.example"},
                {"id": "contact-b", "client_id": "client-b", "name": "Foreign Contact", "phone": "+61 499 000 000", "email": "foreign@other.example"},
            ]),
            client_contacts=_Collection(),
            devices=_Collection(),
            users=_Collection(),
            invoices=_Collection(),
            purchase_orders=_Collection(),
            projects=_Collection(),
            contracts=_Collection(),
            vendors=_Collection(),
            leads=_Collection([
                {"id": "lead-a", "company_name": "Acme Growth", "contact_name": "Mary Acme", "phone": "+61 412 555 010", "status": "qualified", "converted_to_client": "client-a"},
                {"id": "lead-b", "company_name": "Other Growth", "contact_name": "Foreign Contact", "phone": "+61 499 000 000", "status": "new", "converted_to_client": "client-b"},
            ]),
            chat_channels=_Collection([
                {"id": "channel-ops", "name": "ops", "display_name": "Operations", "description": "Service coordination", "kind": "team", "is_private": False, "member_ids": []},
                {"id": "channel-private", "name": "private", "display_name": "Foreign private", "kind": "team", "is_private": True, "member_ids": ["other-tech"]},
            ]),
            yeastar_pbxs=_Collection(),
            backup_jobs=_Collection(),
            csat_surveys=_Collection([
                {"id": "survey-a", "client_id": "client-a", "client_name": "Acme", "ticket_number": "TKT-48291", "tech_name": "Mary Tech", "score": 5, "status": "responded", "feedback": "Great result"},
                {"id": "survey-b", "client_id": "client-b", "client_name": "Other", "ticket_number": "TKT-48299", "tech_name": "Foreign Tech", "score": 1, "status": "responded", "feedback": "Foreign response"},
            ]),
            knowledge_articles=_Collection(),
            products=_Collection([
                {"id": "product-a", "name": "Nexus Router", "sku": "NX-RTR-01", "barcode": "9482910001", "vendor": "Nexus Supply", "description": "Edge router"},
            ]),
        )


def _restricted_technician() -> dict:
    return {
        "id": "tech-a",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "site_scope_ids": [],
    }


def test_operational_search_resolves_ticket_prefix_and_preserves_client_scope(monkeypatch):
    database = _Database()
    monkeypatch.setattr(command_palette, "db", database)

    result = asyncio.run(command_palette.palette_search(q="TKT-482", current_user=_restricted_technician()))

    assert [ticket["id"] for ticket in result["tickets"]] == ["ticket-a"]
    assert result["tickets"][0]["ticket_number"] == "TKT-48291"


def test_operational_search_matches_phone_formatting_and_product_barcodes(monkeypatch):
    database = _Database()
    monkeypatch.setattr(command_palette, "db", database)
    monkeypatch.setattr(products, "db", database)

    phone_result = asyncio.run(command_palette.palette_search(q="+61 412", current_user=_restricted_technician()))
    product_result = asyncio.run(command_palette.palette_search(q="948291", current_user=_restricted_technician()))
    endpoint_result = asyncio.run(products.get_products(search="948291", current_user=_restricted_technician()))

    assert {contact["id"] for contact in phone_result["contacts"]} >= {"contact-a", "embedded-a"}
    assert all(contact["client_id"] == "client-a" for contact in phone_result["contacts"])
    assert [product["id"] for product in product_result["products"]] == ["product-a"]
    assert [product["id"] for product in endpoint_result] == ["product-a"]


def test_operational_search_covers_collaboration_growth_and_feedback_without_scope_leaks(monkeypatch):
    database = _Database()
    monkeypatch.setattr(command_palette, "db", database)

    collaboration = asyncio.run(command_palette.palette_search(q="ops", current_user=_restricted_technician()))
    scoped_feedback = asyncio.run(
        command_palette.palette_search(q="TKT-482", current_user=_restricted_technician())
    )
    scoped_leads = asyncio.run(
        command_palette.palette_search(q="Acme", client_id="client-a", current_user=_restricted_technician())
    )

    assert [channel["id"] for channel in collaboration["conversations"]] == ["channel-ops"]
    assert [survey["id"] for survey in scoped_feedback["csat_surveys"]] == ["survey-a"]
    assert [lead["id"] for lead in scoped_leads["leads"]] == ["lead-a"]


def test_csat_dashboard_and_rows_respect_scope_and_normalize_ticket_feedback(monkeypatch):
    database = _Database()
    monkeypatch.setattr(csat_surveys, "db", SimpleNamespace(csat_surveys=database.csat_surveys))

    responses = asyncio.run(csat_surveys.get_surveys(current_user=_restricted_technician()))
    dashboard = asyncio.run(csat_surveys.csat_dashboard(current_user=_restricted_technician()))

    assert [survey["id"] for survey in responses] == ["survey-a"]
    assert responses[0]["comment"] == "Great result"
    assert dashboard["total_responses"] == 1
    assert dashboard["by_client"] == [{"name": "Acme", "avg": 5.0, "count": 1}]
