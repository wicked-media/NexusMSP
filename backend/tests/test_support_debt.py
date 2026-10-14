"""Nexus Support Debt tests.

Support Debt turns repeated ticket work into a management figure. These tests pin
the signature rules, the annualisation, the refusal to invent a labour rate and
the disclosed cost basis, plus the route's tenant and client scope.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.routers import support_debt as support_debt_router
from app.services.support_debt import (
    cost_basis,
    labour_by_ticket,
    normalise_signature,
    support_debt_signatures,
    support_debt_totals,
    support_debt_value,
)

NOW = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)


def _ticket(ticket_id, title, days_ago, client_id="cli-1", category="hardware"):
    return {
        "id": ticket_id,
        "title": title,
        "client_id": client_id,
        "client_name": "ACME",
        "category": category,
        "created_at": (NOW - timedelta(days=days_ago)).isoformat(),
    }


def test_the_signature_collapses_wording_differences_and_numbers():
    assert normalise_signature("Printer offline again") == normalise_signature("The printer is offline") == "offline printer"
    # Asset numbers drop out, so the same fault on two servers shares a shape.
    assert normalise_signature("SERVER03 down") == normalise_signature("SERVER04 is down") == "down server"
    # Word order is not part of the shape.
    assert normalise_signature("Rebuild Outlook profile for user 42") == normalise_signature("outlook profile rebuild")
    # A title with nothing but noise carries no usable shape.
    assert normalise_signature("Please help!!!") == ""


def test_recurrence_needs_the_minimum_occurrences():
    tickets = [_ticket(f"tkt-{index}", "Printer offline", index) for index in range(3)]
    assert support_debt_signatures(tickets, {}, min_occurrences=4, now=NOW) == []

    tickets.append(_ticket("tkt-3", "Printer offline", 3))
    rows = support_debt_signatures(tickets, {}, min_occurrences=4, now=NOW)
    assert len(rows) == 1
    assert rows[0]["occurrences"] == 4


def test_a_rate_is_never_invented_and_the_cost_basis_is_disclosed():
    tickets = [_ticket(f"tkt-{index}", "Printer offline", index + 1) for index in range(4)]
    labour = labour_by_ticket([
        {"ticket_id": "tkt-0", "minutes": 60},
        {"ticket_id": "tkt-1", "minutes": 60},
        {"ticket_id": "tkt-2", "minutes": 60, "total_amount": 120},
        {"ticket_id": "tkt-3", "minutes": 60},
    ])
    rows = support_debt_signatures(tickets, labour, min_occurrences=4, window_days=90, now=NOW)
    row = rows[0]
    assert row["hours"] == 4.0
    assert row["cost"] == 120.0
    assert row["cost_basis"] == "partial"
    assert row["annual_cost"] is not None
    # Only the recorded value is annualised, never a substituted hourly rate.
    assert row["annual_cost"] == round(120.0 * 365 / 90, 2)

    uncosted = support_debt_signatures(
        tickets,
        labour_by_ticket([{"ticket_id": f"tkt-{index}", "minutes": 60} for index in range(4)]),
        min_occurrences=4,
        window_days=90,
        now=NOW,
    )[0]
    assert uncosted["cost"] is None
    assert uncosted["annual_cost"] is None
    assert uncosted["cost_basis"] == "none"
    assert uncosted["annual_hours"] > 0


def test_value_is_annualised_from_the_observed_window():
    value = support_debt_value(8, 12.0, 300.0, window_days=180)
    assert value["annual_repeats"] == 16
    assert value["annual_hours"] == 24.3
    assert value["annual_cost"] == 608.33
    assert "projected to a year" in value["projection_basis"]

    with pytest.raises(ValueError):
        support_debt_value(1, 1.0, 1.0, window_days=0)


def test_cost_basis_reports_absent_partial_and_complete():
    assert cost_basis(4.0, 0.0) == "none"
    assert cost_basis(4.0, 2.0) == "partial"
    assert cost_basis(4.0, 4.0) == "complete"


def test_undated_and_out_of_window_tickets_are_left_out_rather_than_guessed():
    tickets = [_ticket(f"tkt-{index}", "Printer offline", index + 1) for index in range(4)]
    tickets.append(_ticket("tkt-old", "Printer offline", 200))
    tickets.append({"id": "tkt-undated", "title": "Printer offline", "client_id": "cli-1"})

    rows = support_debt_signatures(tickets, {}, min_occurrences=4, window_days=90, now=NOW)
    assert rows[0]["occurrences"] == 4
    assert "tkt-old" not in rows[0]["ticket_ids"]
    assert "tkt-undated" not in rows[0]["ticket_ids"]


def test_the_same_title_for_two_clients_is_two_signatures():
    tickets = [_ticket(f"tkt-a{index}", "Printer offline", index + 1) for index in range(3)]
    tickets += [_ticket(f"tkt-b{index}", "Printer offline", index + 1, client_id="cli-2") for index in range(3)]
    rows = support_debt_signatures(tickets, {}, min_occurrences=3, now=NOW)
    assert {(row["client_id"], row["occurrences"]) for row in rows} == {("cli-1", 3), ("cli-2", 3)}


def test_totals_disclose_how_many_signatures_carry_recorded_value():
    signatures = [
        {"occurrences": 4, "annual_hours": 16.0, "annual_cost": 640.0},
        {"occurrences": 5, "annual_hours": 5.0, "annual_cost": None},
    ]
    totals = support_debt_totals(signatures)
    assert totals == {
        "signatures": 2,
        "recurring_tickets": 9,
        "annual_hours": 21.0,
        "annual_cost": 640.0,
        "costed_signatures": 1,
        "uncosted_signatures": 1,
    }


# ── route boundary ───────────────────────────────────────────────────────────


class _Result:
    def __init__(self, matched_count=0):
        self.matched_count = matched_count


def _matches(row, query):
    for key, expected in query.items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$exists" in expected and (key in row) != bool(expected["$exists"]):
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            continue
        if actual != expected:
            return False
    return True


class _Rows:
    def __init__(self):
        self.rows = []

    async def find_one(self, query, _projection=None):
        return next((dict(row) for row in self.rows if _matches(row, query)), None)

    async def insert_one(self, document):
        self.rows.append(dict(document))

    def find(self, query, _projection=None):
        return _Cursor([dict(row) for row in self.rows if _matches(row, query)])


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self._rows)


class _Db:
    def __init__(self):
        self._tables = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._tables.setdefault(name, _Rows())


def _user(tenant="tenant-a", client_ids=None):
    user = {"id": "tech-1", "tenant_id": tenant, "name": "Flow Tech", "email": "tech-1@example.com", "is_admin": client_ids is None}
    if client_ids is not None:
        user["client_scope_mode"] = "restricted"
        user["client_scope_ids"] = list(client_ids)
    return user


def _seed(db, tenant="tenant-a", client_id="cli-1", prefix="a"):
    for index in range(4):
        db.tickets.rows.append({
            "id": f"tkt-{prefix}{index}",
            "tenant_id": tenant,
            "title": "Printer offline again",
            "client_id": client_id,
            "client_name": "ACME",
            "category": "hardware",
            "created_at": (datetime.now(timezone.utc) - timedelta(days=index + 1)).isoformat(),
        })
        db.time_entries.rows.append({
            "tenant_id": tenant,
            "ticket_id": f"tkt-{prefix}{index}",
            "client_id": client_id,
            "minutes": 60,
            "total_amount": 95.0,
        })


def test_support_debt_overview_is_tenant_and_client_scoped(monkeypatch):
    db = _Db()
    monkeypatch.setattr(support_debt_router, "db", db)
    _seed(db, tenant="tenant-a", client_id="cli-1", prefix="a")
    _seed(db, tenant="tenant-b", client_id="cli-9", prefix="b")

    overview = asyncio.run(support_debt_router.support_debt_overview(current_user=_user()))
    assert overview["window_days"] == 90
    assert overview["totals"]["signatures"] == 1
    assert overview["totals"]["recurring_tickets"] == 4
    assert overview["signatures"][0]["client_id"] == "cli-1"
    assert overview["signatures"][0]["cost_basis"] == "complete"
    assert overview["by_client"][0]["client_id"] == "cli-1"
    assert "never invents a labour rate" in overview["boundary"]

    other_tenant = asyncio.run(support_debt_router.support_debt_overview(current_user=_user(tenant="tenant-b")))
    assert other_tenant["totals"]["signatures"] == 1
    assert other_tenant["signatures"][0]["client_id"] == "cli-9"

    restricted = asyncio.run(support_debt_router.support_debt_overview(current_user=_user(client_ids=["cli-1"])))
    assert restricted["totals"]["signatures"] == 1
    assert restricted["signatures"][0]["client_id"] == "cli-1"

    none_visible = asyncio.run(support_debt_router.support_debt_overview(current_user=_user(client_ids=["cli-nope"])))
    assert none_visible["totals"]["signatures"] == 0


def test_a_higher_threshold_hides_smaller_recurrences(monkeypatch):
    db = _Db()
    monkeypatch.setattr(support_debt_router, "db", db)
    _seed(db, prefix="a")
    strict = asyncio.run(support_debt_router.support_debt_overview(min_occurrences=8, current_user=_user()))
    assert strict["totals"]["signatures"] == 0
    assert strict["min_occurrences"] == 8
