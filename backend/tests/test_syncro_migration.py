"""Focused coverage for the one-time Syncro migration connector.

These tests exercise the service directly, with a small in-memory database and
a fake Syncro client. They deliberately do not call the live Syncro API.
"""

from __future__ import annotations

import asyncio
import csv
import io
import re
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from app.routers import syncro as syncro_router
from app.services import syncro_migration as migration


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue
        present = key in row
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$regex" in expected:
                flags = re.IGNORECASE if "i" in str(expected.get("$options") or "") else 0
                if not re.search(str(expected["$regex"]), str(actual or ""), flags):
                    return False
                continue
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$nin" in expected and actual in expected["$nin"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$exists" in expected and present != bool(expected["$exists"]):
                return False
            if "$gte" in expected and (actual is None or actual < expected["$gte"]):
                return False
            if "$lte" in expected and (actual is None or actual > expected["$lte"]):
                return False
            continue
        if actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    def sort(self, field: str, direction: int = 1) -> "_Cursor":
        self.rows.sort(key=lambda row: row.get(field) or "", reverse=direction < 0)
        return self

    async def to_list(self, limit: int) -> list[dict[str, Any]]:
        return deepcopy(self.rows[:limit])


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query: dict[str, Any], projection: dict[str, Any] | None = None):
        row = next((row for row in self.rows if _matches(row, query)), None)
        if row is None:
            return None
        return {key: deepcopy(value) for key, value in row.items() if key != "_id"}

    def find(self, query: dict[str, Any], projection: dict[str, Any] | None = None) -> _Cursor:
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], upsert: bool = False):
        row = next((row for row in self.rows if _matches(row, query)), None)
        if row is None and upsert:
            row = {}
            self.rows.append(row)
        if row is None:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        for key, value in (update.get("$setOnInsert") or {}).items():
            row.setdefault(key, deepcopy(value))
        for key, value in (update.get("$set") or {}).items():
            row[key] = deepcopy(value)
        for key, value in (update.get("$push") or {}).items():
            row.setdefault(key, []).append(deepcopy(value))
        for key, value in (update.get("$inc") or {}).items():
            row[key] = (row.get(key) or 0) + value
        return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=row.get("id"))

    async def delete_one(self, query: dict[str, Any]):
        row = next((row for row in self.rows if _matches(row, query)), None)
        if row is not None:
            self.rows.remove(row)
            return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class _Database:
    def __init__(self):
        self._collections: dict[str, _Collection] = {}

    def __getattr__(self, name: str) -> _Collection:
        if name.startswith("_"):
            raise AttributeError(name)
        if name not in self._collections:
            self._collections[name] = _Collection()
        return self._collections[name]

    def __getitem__(self, name: str) -> _Collection:
        return getattr(self, name)

    def seed(self, name: str, rows: list[dict[str, Any]]) -> None:
        self._collections[name] = _Collection(rows)


class _FakeClient:
    def __init__(
        self,
        payloads: dict[str, Any],
        downloads: dict[str, tuple[bytes, str, str]] | None = None,
    ):
        self.payloads = payloads
        self.downloads = downloads or {}
        self.download_calls: list[tuple[str, int]] = []
        self.closed = False
        self.calls: list[tuple[str, dict[str, Any] | None]] = []

    async def iter_items(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        page_size: int | None = None,
    ):
        self.calls.append((path, params))
        for item in self.payloads.get(path, []):
            yield deepcopy(item)

    async def get(self, path: str, params: dict[str, Any] | None = None):
        self.calls.append((path, params))
        return deepcopy(self.payloads.get(path, {}))

    async def download(self, url: str, *, max_bytes: int, filename: str | None = None):
        self.download_calls.append((url, max_bytes))
        content, content_type, remote_name = self.downloads[url]
        return migration.DownloadedAttachment(
            content=content,
            content_type=content_type,
            filename=filename or remote_name,
            url=url,
        )

    async def close(self):
        self.closed = True


def _seed_config(database: _Database, tenant_id: str = "tenant-a") -> None:
    database.seed(
        "settings",
        [{"type": "syncro", "tenant_id": tenant_id, "subdomain": "acme", "api_key": "token"}],
    )


def _run(coro):
    return asyncio.run(coro)


def test_subdomain_validation_accepts_full_url_and_rejects_origins():
    assert migration.normalise_subdomain("https://acme.syncromsp.com/") == "acme"
    assert migration.normalise_subdomain("acme") == "acme"
    with pytest.raises(migration.SyncroConfigurationError):
        migration.normalise_subdomain("https://evil.example.com")


def test_status_and_priority_mapping_is_explicit():
    assert migration._ticket_status("Waiting on Customer") == "on_hold"
    assert migration._ticket_status("In Progress") == "in_progress"
    assert migration._ticket_status("Resolved") == "resolved"
    assert migration._ticket_status("Closed") == "closed"
    assert migration._ticket_priority("Critical") == "urgent"
    assert migration._ticket_priority("High") == "high"
    assert migration._invoice_status("Paid") == "paid"
    assert migration._invoice_status("Void") == "cancelled"
    assert migration._frequency("Yearly") == "annually"
    assert migration._frequency("Biweekly") == "fortnightly"
    assert migration._lead_status("In Negotiation") == ("negotiation", 5)
    assert migration._lead_status("Won") == ("won", 6)
    assert migration._po_status("Partially Received") == "partial"
    assert migration._po_status("Received") == "received"


def test_client_paginates_and_retries_transient_failures(monkeypatch):
    monkeypatch.setattr(migration, "PER_PAGE", 2)
    requests: list[tuple[str, dict[str, Any]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        requests.append((str(request.url.path), params))
        if str(request.url.path).endswith("/customers") and params.get("page") == "1" and len(requests) == 1:
            return httpx.Response(429, headers={"Retry-After": "0"})
        if params.get("page") == "1":
            return httpx.Response(200, json={"customers": [{"id": 1}, {"id": 2}]})
        if params.get("page") == "2":
            return httpx.Response(200, json={"customers": [{"id": 3}]})
        return httpx.Response(200, json={"customers": []})

    async def run():
        client = migration.SyncroClient(
            "acme",
            "token",
            transport=httpx.MockTransport(handler),
            min_interval_seconds=0,
            retry_base_seconds=0.01,
        )
        try:
            return [item async for item in client.iter_items("/customers")]
        finally:
            await client.close()

    items = _run(run())
    assert [item["id"] for item in items] == [1, 2, 3]
    assert len(requests) == 3
    # The first request was the 429; the retry must carry the documented auth.
    assert requests[0][1].get("page") == "1"


def test_page_size_override_handles_purchase_orders_fixed_twenty_page():
    requests: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        requests.append(params)
        if params.get("page") == "1":
            return httpx.Response(200, json={"purchase_orders": [{"id": i} for i in range(20)]})
        if params.get("page") == "2":
            return httpx.Response(200, json={"purchase_orders": [{"id": 20}]})
        return httpx.Response(200, json={"purchase_orders": []})

    async def run():
        client = migration.SyncroClient(
            "acme",
            "token",
            transport=httpx.MockTransport(handler),
            min_interval_seconds=0,
        )
        try:
            return [item async for item in client.iter_items("/purchase_orders", page_size=20)]
        finally:
            await client.close()

    items = _run(run())
    assert len(items) == 21
    assert len(requests) == 2
    assert all(request.get("per_page") == "20" for request in requests)


def test_client_downloads_attachment_with_syncro_auth_and_follows_safe_redirect(monkeypatch):
    from app.services import event_backbone

    async def allow_public(url):
        return url

    monkeypatch.setattr(event_backbone, "assert_outbound_destination", allow_public)
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.host == "acme.syncromsp.com":
            return httpx.Response(302, headers={"Location": "https://files.example.test/receipt.pdf"})
        return httpx.Response(200, content=b"%PDF-1.4\nreceipt", headers={"Content-Type": "application/pdf"})

    async def run():
        client = migration.SyncroClient(
            "acme",
            "token",
            transport=httpx.MockTransport(handler),
            min_interval_seconds=0,
        )
        try:
            result = await client.download(
                "https://acme.syncromsp.com/api/v1/tickets/10/attachments/70",
                max_bytes=1024,
            )
            try:
                await client.download("https://files.example.test/too-large.pdf", max_bytes=4)
            except migration.SyncroAttachmentError as exc:
                too_large = str(exc)
            else:
                too_large = ""
            try:
                await client.download("http://127.0.0.1/internal", max_bytes=1024)
            except migration.SyncroAttachmentError as exc:
                unsafe = str(exc)
            else:
                unsafe = ""
            return result, too_large, unsafe
        finally:
            await client.close()

    result, too_large, unsafe = _run(run())
    assert result.content == b"%PDF-1.4\nreceipt"
    assert result.content_type == "application/pdf"
    assert result.filename == "receipt.pdf"
    assert requests[0].headers.get("authorization") == "Bearer token"
    assert "authorization" not in requests[1].headers
    assert "size limit" in too_large
    assert "HTTPS" in unsafe


def test_dry_run_counts_without_writing_canonical_or_raw_records():
    database = _Database()
    _seed_config(database)
    fake = _FakeClient(
        {
            "/customers": [{"id": 1, "business_name": "Acme", "email": "ops@acme.test"}],
            "/tickets": [{"id": 10, "customer_id": 1, "subject": "Help", "status": "Open"}],
        }
    )

    async def run():
        job = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=["customers", "tickets"],
            mode="dry_run",
        )
        return await migration.run_migration_job(job["id"], database=database, client_factory=lambda _: fake)

    job = _run(run())
    assert job["status"] == "completed"
    assert job["counts"]["customers"]["created"] == 1
    assert job["counts"]["tickets"]["created"] == 1
    assert database.clients.rows == []
    assert database.tickets.rows == []
    assert database.syncro_migration_records.rows == []


def test_apply_is_idempotent_and_links_existing_customer_by_name_and_email():
    database = _Database()
    _seed_config(database)
    database.seed(
        "clients",
        [{"id": "existing-acme", "tenant_id": "tenant-a", "name": "Acme", "email": "ops@acme.test"}],
    )
    fake = _FakeClient(
        {
            "/customers": [
                {
                    "id": 1,
                    "business_name": "Acme",
                    "email": "ops@acme.test",
                    "phone": "123",
                    "address": "1 Main St",
                }
            ],
            "/contacts": [
                {"id": 2, "customer_id": 1, "name": "Jane Doe", "email": "jane@acme.test", "title": "Owner"}
            ],
            "/customer_assets": [
                {
                    "id": 3,
                    "customer_id": 1,
                    "name": "ACME-PC01",
                    "asset_type": "Desktop",
                    "properties": {"Operating System": "Windows 11", "Local IP": "10.0.0.5"},
                }
            ],
            "/products": [{"id": 4, "name": "Managed endpoint", "price": 25, "sku": "MSP-EP"}],
            "/contracts": [
                {
                    "id": 5,
                    "customer_id": 1,
                    "name": "Managed services",
                    "start_date": "2026-01-01",
                    "value": 500,
                }
            ],
            "/tickets": [
                {
                    "id": 6,
                    "number": 1001,
                    "customer_id": 1,
                    "subject": "Login issue",
                    "description": "Cannot sign in",
                    "status": "In Progress",
                    "priority": "High",
                    "asset_id": 3,
                }
            ],
            "/ticket_comments": [
                {"id": 7, "ticket_id": 6, "body": "Investigating", "user_name": "Tech"}
            ],
            "/invoices": [
                {
                    "id": 8,
                    "number": "INV-1001",
                    "customer_id": 1,
                    "contract_id": 5,
                    "status": "Paid",
                    "total": 25,
                    "amount_paid": 25,
                    "line_items": [{"name": "Managed endpoint", "quantity": 1, "unit_price": 25}],
                }
            ],
            "/schedules": [
                {
                    "id": 9,
                    "customer_id": 1,
                    "contract_id": 5,
                    "name": "Monthly managed services",
                    "frequency": "Monthly",
                    "next_run_at": "2026-12-01",
                    "line_items": [{"name": "Managed endpoint", "quantity": 2, "unit_price": 25}],
                }
            ],
            "/timelogs": [
                {"id": 11, "ticket_id": 6, "duration_minutes": 30, "notes": "Diagnosed", "billable": True}
            ],
            "/payments": [{"id": 12, "invoice_id": 8, "amount": 25}],
            "/users": [{"id": 13, "name": "Syncro Tech"}],
        }
    )

    async def run():
        job = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=[
                "customers",
                "contacts",
                "assets",
                "products",
                "contracts",
                "tickets",
                "ticket_comments",
                "invoices",
                "recurring_invoices",
                "timelogs",
                "payments",
                "users",
            ],
            mode="apply",
        )
        return await migration.run_migration_job(job["id"], database=database, client_factory=lambda _: fake)

    job = _run(run())
    assert job["status"] == "completed"
    assert job["totals"]["failed"] == 0
    assert job["counts"]["customers"]["linked"] == 1

    assert len(database.clients.rows) == 1
    assert database.clients.rows[0]["id"] == "existing-acme"
    assert database.clients.rows[0]["syncro_id"] == "1"
    assert database.clients.rows[0]["tenant_id"] == "tenant-a"

    client_id = database.clients.rows[0]["id"]
    assert database.contacts.rows[0]["client_id"] == client_id
    assert database.contacts.rows[0]["syncro_contact_id"] == "2"
    assert database.devices.rows[0]["client_id"] == client_id
    assert database.devices.rows[0]["syncro_asset_id"] == "3"
    assert database.devices.rows[0]["client_name"] == "Acme"
    assert database.tickets.rows[0]["client_name"] == "Acme"
    assert database.tickets.rows[0]["status"] == "in_progress"
    assert database.tickets.rows[0]["priority"] == "high"
    assert database.tickets.rows[0]["syncro_ticket_id"] == "6"
    assert database.ticket_comments.rows[0]["ticket_id"] == database.tickets.rows[0]["id"]
    assert len(database.invoices.rows[0]["line_items"]) == 1
    assert database.invoices.rows[0]["syncro_invoice_id"] == "8"
    assert database.invoices.rows[0]["contract_id"] == database.contracts.rows[0]["id"]
    assert database.invoices.rows[0]["client_name"] == "Acme"
    assert database.recurring_invoices.rows[0]["syncro_recurring_invoice_id"] == "9"
    assert database.recurring_invoices.rows[0]["contract_id"] == database.contracts.rows[0]["id"]
    assert database.time_entries.rows[0]["syncro_timelog_id"] == "11"
    invoice_payments = database.invoices.rows[0]["payments"]
    assert len(invoice_payments) == 1
    assert invoice_payments[0]["syncro_payment_id"] == "12"
    assert invoice_payments[0]["amount"] == 25
    assert invoice_payments[0]["source"] == "syncro_migration"
    assert job["counts"]["payments"]["created"] == 1
    assert any(
        row.get("entity") == "payments" and row.get("syncro_id") == "12"
        for row in database.syncro_migration_records.rows
    )
    assert any(
        row.get("entity") == "users" and row.get("syncro_id") == "13"
        for row in database.syncro_migration_records.rows
    )

    report = _run(
        migration.build_reconciliation_report(database, "tenant-a", job["id"])
    )
    assert report["status"] == "reconciled"
    assert report["matched"] is True
    assert report["source"]["invoice_count"] == 1
    assert report["source"]["invoice_total"] == 25
    assert report["source"]["amount_paid"] == 25
    assert report["source"]["payment_count"] == 1
    assert report["source"]["payment_total"] == 25
    assert report["nexus"]["invoice_total"] == 25
    assert report["nexus"]["amount_paid"] == 25
    assert report["nexus"]["payment_count"] == 1
    assert report["nexus"]["payment_total"] == 25
    assert report["difference"] == {
        "invoice_total": 0.0,
        "amount_paid": 0.0,
        "payment_total": 0.0,
        "payment_count": 0,
    }
    assert report["mismatch_invoice_count"] == 0
    assert report["invoice_total_count"] == 0
    assert report["payment_exceptions"]["orphan_source_payments"]["count"] == 0
    assert report["payment_exceptions"]["unexpected_nexus_payments"]["count"] == 0

    # Re-running the same source must update rather than duplicate.
    async def rerun():
        second = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=[
                "customers",
                "contacts",
                "assets",
                "products",
                "contracts",
                "tickets",
                "ticket_comments",
                "invoices",
                "recurring_invoices",
                "timelogs",
                "payments",
            ],
            mode="apply",
        )
        return await migration.run_migration_job(second["id"], database=database, client_factory=lambda _: fake)

    second_job = _run(rerun())
    assert second_job["status"] == "completed"
    assert second_job["totals"]["created"] == 0
    assert second_job["counts"]["payments"]["updated"] == 1
    assert len(database.clients.rows) == 1
    assert len(database.tickets.rows) == 1
    assert len(database.invoices.rows) == 1
    assert len(database.invoices.rows[0]["payments"]) == 1


def test_payments_are_embedded_in_invoice_history_and_preserve_local_reconciliation():
    database = _Database()
    _seed_config(database)
    fake = _FakeClient(
        {
            "/customers": [{"id": 1, "business_name": "Acme", "email": "ops@acme.test"}],
            "/invoices": [
                {
                    "id": 8,
                    "number": "INV-PAY",
                    "customer_id": 1,
                    "status": "Sent",
                    "total": 100,
                    "amount_paid": 30,
                    "line_items": [],
                }
            ],
            "/payments": [
                {
                    "id": 12,
                    "invoice_id": 8,
                    "amount": 25,
                    "payment_method": "Credit Card",
                    "date": "2026-01-05",
                    "reference": "CC-1",
                    "created_at": "2026-01-05T10:00:00+00:00",
                },
                {
                    "id": 13,
                    "invoice_id": 8,
                    "amount": 10,
                    "payment_method": "Bank Transfer",
                    "date": "2026-01-06",
                    "reference": "BANK-1",
                    "reconciled": True,
                },
                {
                    "id": 14,
                    "invoice_id": 999,
                    "amount": 5,
                    "payment_method": "Cash",
                },
                {
                    "id": 15,
                    "invoice_id": 8,
                    "amount": -5,
                    "payment_method": "Refund",
                    "date": "2026-01-07",
                    "reference": "REFUND-1",
                },
            ],
        }
    )
    entities = ["customers", "invoices", "payments"]

    async def run():
        job = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=entities,
            mode="apply",
        )
        return await migration.run_migration_job(job["id"], database=database, client_factory=lambda _: fake)

    job = _run(run())
    assert job["status"] == "completed"
    assert job["counts"]["payments"]["created"] == 3
    assert job["counts"]["payments"]["failed"] == 1

    invoice = database.invoices.rows[0]
    assert invoice["amount_paid"] == 30
    assert invoice["payment_status"] == "partial"
    assert len(invoice["payments"]) == 3
    by_payment = {item["syncro_payment_id"]: item for item in invoice["payments"]}
    assert by_payment["12"]["method"] == "other"
    assert by_payment["12"]["syncro_method"] == "Credit Card"
    assert by_payment["12"]["date"] == "2026-01-05"
    assert by_payment["12"]["reconciliation_status"] == "pending_xero_reconciliation"
    assert by_payment["13"]["method"] == "bank_transfer"
    assert by_payment["13"]["reconciliation_status"] == "matched"
    assert by_payment["13"]["syncro_invoice_id"] == "8"
    assert by_payment["13"]["invoice_id"] == invoice["id"]
    assert by_payment["15"]["amount"] == -5
    assert by_payment["15"]["entry_type"] == "refund"

    failed_raw = [
        row
        for row in database.syncro_migration_records.rows
        if row.get("entity") == "payments" and row.get("syncro_id") == "14"
    ]
    assert len(failed_raw) == 1
    assert failed_raw[0]["status"] == "raw_archived"

    by_payment["12"]["reconciliation_status"] = "settled_pending_xero"
    by_payment["12"]["settlement_id"] = "SET-LOCAL"
    # Simulate an entry written by the earlier connector version, which copied
    # the Syncro payment ID into `id` but had no syncro_payment_id field.
    by_payment["13"]["id"] = "13"
    by_payment["13"]["source"] = "syncro"
    by_payment["13"]["notes"] = "stale note"
    by_payment["13"]["reconciliation_status"] = "pending_xero_reconciliation"
    by_payment["13"].pop("syncro_payment_id", None)

    async def rerun():
        second = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=entities,
            mode="apply",
        )
        return await migration.run_migration_job(second["id"], database=database, client_factory=lambda _: fake)

    second = _run(rerun())
    assert second["status"] == "completed"
    assert second["counts"]["payments"]["created"] == 0
    assert second["counts"]["payments"]["updated"] == 3
    assert second["counts"]["payments"]["failed"] == 1
    invoice = database.invoices.rows[0]
    assert invoice["amount_paid"] == 30
    assert len(invoice["payments"]) == 3
    by_payment = {item["syncro_payment_id"]: item for item in invoice["payments"]}
    assert by_payment["12"]["reconciliation_status"] == "settled_pending_xero"
    assert by_payment["12"]["settlement_id"] == "SET-LOCAL"
    assert by_payment["13"]["id"] == "syncro-payment-13"
    assert by_payment["13"]["syncro_invoice_id"] == "8"
    assert by_payment["13"]["notes"] == ""
    assert by_payment["13"]["reconciliation_status"] == "matched"
    assert by_payment["15"]["entry_type"] == "refund"

    report = _run(
        migration.build_reconciliation_report(database, "tenant-a", second["id"])
    )
    assert report["status"] == "attention_required"
    assert report["matched"] is False
    assert report["source"]["payment_count"] == 4
    assert report["nexus"]["payment_count"] == 3
    assert report["difference"]["payment_count"] == 1
    assert report["difference"]["payment_total"] == 5.0
    orphan_payments = report["payment_exceptions"]["orphan_source_payments"]
    assert orphan_payments["count"] == 1
    assert orphan_payments["items"][0]["syncro_payment_id"] == "14"
    assert orphan_payments["items"][0]["invoice_syncro_id"] == "999"


def test_reconciliation_report_flags_duplicate_source_linked_invoices_and_payments():
    database = _Database()
    database.seed(
        "syncro_migration_jobs",
        [
            {
                "id": "job-1",
                "tenant_id": "tenant-a",
                "status": "completed",
                "mode": "apply",
                "requested_by": "tester",
                "completed_at": "2026-01-01T00:00:00+00:00",
            }
        ],
    )
    database.seed(
        "syncro_migration_records",
        [
            {
                "tenant_id": "tenant-a",
                "entity": "invoices",
                "syncro_id": "8",
                "raw": {
                    "id": 8,
                    "number": "INV-DUP",
                    "customer_id": 1,
                    "total": 100,
                    "amount_paid": 25,
                },
            },
            {
                "tenant_id": "tenant-a",
                "entity": "payments",
                "syncro_id": "12",
                "raw": {"id": 12, "invoice_id": 8, "amount": 25},
            },
        ],
    )
    database.seed(
        "invoices",
        [
            {
                "id": "invoice-1",
                "tenant_id": "tenant-a",
                "syncro_invoice_id": "8",
                "invoice_number": "INV-DUP",
                "total": 100,
                "amount_paid": 25,
                "payment_status": "partial",
                "payments": [{"syncro_payment_id": "12", "amount": 25}],
            },
            {
                "id": "invoice-2",
                "tenant_id": "tenant-a",
                "syncro_invoice_id": "8",
                "invoice_number": "INV-DUP",
                "total": 100,
                "amount_paid": 25,
                "payment_status": "partial",
                "payments": [{"syncro_payment_id": "12", "amount": 25}],
            },
        ],
    )

    report = _run(
        migration.build_reconciliation_report(database, "tenant-a", "job-1")
    )
    assert report["status"] == "attention_required"
    assert report["matched"] is False
    duplicate_invoices = report["payment_exceptions"]["duplicate_nexus_invoices"]
    duplicate_payments = report["payment_exceptions"]["duplicate_nexus_payments"]
    assert duplicate_invoices["count"] == 1
    assert duplicate_invoices["items"][0]["invoice_count"] == 2
    assert duplicate_payments["count"] == 1
    assert duplicate_payments["items"][0]["entry_count"] == 2
    assert report["difference"]["payment_total"] == -25.0
    assert report["difference"]["payment_count"] == -1
    assert report["mismatch_invoice_count"] == 1
    assert "duplicate_nexus_invoice" in report["invoices"][0]["issue_codes"]
    assert "duplicate_payment" in report["invoices"][0]["issue_codes"]

    csv_text = migration.reconciliation_csv(report)
    assert csv_text.startswith("\ufeff")
    assert "record_type,syncro_id" in csv_text
    assert "invoice,8" in csv_text
    assert "duplicate_nexus_invoice" in csv_text
    assert "duplicate_nexus_payment" in csv_text
    parsed = list(csv.reader(io.StringIO(csv_text.lstrip("\ufeff"))))
    assert all(len(row) == 18 for row in parsed)


def test_reconciliation_csv_route_returns_a_no_store_attachment(monkeypatch):
    database = _Database()
    database.seed(
        "syncro_migration_jobs",
        [
            {
                "id": "job-csv",
                "tenant_id": "tenant-a",
                "status": "completed",
                "mode": "apply",
                "requested_by": "tester",
            }
        ],
    )
    database.seed(
        "syncro_migration_records",
        [
            {
                "tenant_id": "tenant-a",
                "entity": "invoices",
                "syncro_id": "8",
                "raw": {
                    "id": 8,
                    "number": "INV-CSV",
                    "customer_id": 1,
                    "total": 25,
                    "amount_paid": 25,
                },
            },
            {
                "tenant_id": "tenant-a",
                "entity": "payments",
                "syncro_id": "12",
                "raw": {"id": 12, "invoice_id": 8, "amount": 25},
            },
        ],
    )
    database.seed(
        "invoices",
        [
            {
                "id": "invoice-1",
                "tenant_id": "tenant-a",
                "syncro_invoice_id": "8",
                "invoice_number": "INV-CSV",
                "total": 25,
                "amount_paid": 25,
                "payment_status": "paid",
                "payments": [{"syncro_payment_id": "12", "amount": 25}],
            }
        ],
    )
    monkeypatch.setattr(syncro_router, "db", database)

    response = _run(
        syncro_router.export_syncro_migration_reconciliation(
            "job-csv",
            {"tenant_id": "tenant-a"},
        )
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == (
        'attachment; filename="syncro-reconciliation-job-csv.csv"'
    )
    assert response.headers["cache-control"] == "no-store"
    assert response.body.startswith(b"\xef\xbb\xbf")
    assert b"invoice,8" in response.body
    parsed = list(csv.reader(io.StringIO(response.body.decode("utf-8-sig"))))
    assert all(len(row) == 18 for row in parsed)
    assert parsed[0][-1] == "currency"
    assert parsed[1][-1] == "UNSPECIFIED"


def test_reconciliation_report_groups_totals_by_currency():
    database = _Database()
    database.seed(
        "syncro_migration_jobs",
        [
            {
                "id": "job-currency",
                "tenant_id": "tenant-a",
                "status": "completed",
                "mode": "apply",
                "requested_by": "tester",
            }
        ],
    )
    database.seed(
        "syncro_migration_records",
        [
            {
                "tenant_id": "tenant-a",
                "entity": "invoices",
                "syncro_id": "8",
                "raw": {
                    "id": 8,
                    "number": "AUD-1",
                    "total": 100,
                    "amount_paid": 50,
                    "currency": "aud",
                },
            },
            {
                "tenant_id": "tenant-a",
                "entity": "invoices",
                "syncro_id": "9",
                "raw": {
                    "id": 9,
                    "number": "USD-1",
                    "total": 200,
                    "amount_paid": 200,
                    "currency": "USD",
                },
            },
            {
                "tenant_id": "tenant-a",
                "entity": "payments",
                "syncro_id": "12",
                "raw": {"id": 12, "invoice_id": 8, "amount": 50, "currency": "AUD"},
            },
            {
                "tenant_id": "tenant-a",
                "entity": "payments",
                "syncro_id": "13",
                "raw": {"id": 13, "invoice_id": 9, "amount": 200, "currency": "USD"},
            },
        ],
    )
    database.seed(
        "invoices",
        [
            {
                "id": "invoice-aud",
                "tenant_id": "tenant-a",
                "syncro_invoice_id": "8",
                "invoice_number": "AUD-1",
                "currency": "AUD",
                "total": 100,
                "amount_paid": 50,
                "payments": [{"syncro_payment_id": "12", "amount": 50}],
            },
            {
                "id": "invoice-usd",
                "tenant_id": "tenant-a",
                "syncro_invoice_id": "9",
                "invoice_number": "USD-1",
                "currency": "USD",
                "total": 200,
                "amount_paid": 200,
                "payments": [{"syncro_payment_id": "13", "amount": 200}],
            },
        ],
    )

    report = _run(
        migration.build_reconciliation_report(database, "tenant-a", "job-currency")
    )
    assert report["status"] == "reconciled"
    assert report["matched"] is True
    assert report["currencies"] == ["AUD", "USD"]
    assert report["currency_status"] == "mixed"
    assert report["warnings"][0]["code"] == "multiple_currencies"
    assert report["source"]["invoice_total"] == 300
    assert report["nexus"]["invoice_total"] == 300
    assert report["difference"]["invoice_total"] == 0
    assert report["by_currency"]["AUD"]["source"]["invoice_total"] == 100
    assert report["by_currency"]["AUD"]["nexus"]["invoice_total"] == 100
    assert report["by_currency"]["USD"]["source"]["invoice_total"] == 200
    assert report["by_currency"]["USD"]["nexus"]["invoice_total"] == 200
    assert report["by_currency"]["AUD"]["difference"]["payment_total"] == 0
    assert report["by_currency"]["USD"]["difference"]["payment_total"] == 0


def test_reconciliation_report_does_not_hide_cross_currency_cancellation():
    database = _Database()
    database.seed(
        "syncro_migration_jobs",
        [
            {
                "id": "job-currency-mismatch",
                "tenant_id": "tenant-a",
                "status": "completed",
                "mode": "apply",
                "requested_by": "tester",
            }
        ],
    )
    database.seed(
        "syncro_migration_records",
        [
            {
                "tenant_id": "tenant-a",
                "entity": "invoices",
                "syncro_id": "8",
                "raw": {
                    "id": 8,
                    "number": "AUD-1",
                    "total": 100,
                    "amount_paid": 100,
                    "currency": "AUD",
                },
            },
            {
                "tenant_id": "tenant-a",
                "entity": "payments",
                "syncro_id": "12",
                "raw": {"id": 12, "invoice_id": 8, "amount": 100, "currency": "AUD"},
            },
        ],
    )
    database.seed(
        "invoices",
        [
            {
                "id": "invoice-usd",
                "tenant_id": "tenant-a",
                "syncro_invoice_id": "8",
                "invoice_number": "AUD-1",
                "currency": "USD",
                "total": 100,
                "amount_paid": 100,
                "payments": [{"syncro_payment_id": "12", "amount": 100}],
            }
        ],
    )

    report = _run(
        migration.build_reconciliation_report(
            database, "tenant-a", "job-currency-mismatch"
        )
    )
    assert report["status"] == "attention_required"
    assert report["matched"] is False
    assert report["currencies"] == ["AUD", "USD"]
    assert report["issue_counts"]["currency_mismatch"] == 1
    assert report["difference"]["invoice_total"] == 0
    assert report["by_currency"]["AUD"]["difference"]["invoice_total"] == 100
    assert report["by_currency"]["USD"]["difference"]["invoice_total"] == -100


def test_reconciliation_report_flags_a_source_invoice_missing_from_nexus():
    database = _Database()
    database.seed(
        "syncro_migration_jobs",
        [
            {
                "id": "job-1",
                "tenant_id": "tenant-a",
                "status": "completed",
                "mode": "apply",
                "requested_by": "tester",
            }
        ],
    )
    database.seed(
        "syncro_migration_records",
        [
            {
                "tenant_id": "tenant-a",
                "entity": "invoices",
                "syncro_id": "8",
                "raw": {
                    "id": 8,
                    "number": "INV-MISSING",
                    "customer_id": 1,
                    "total": 100,
                    "amount_paid": 25,
                },
            },
            {
                "tenant_id": "tenant-a",
                "entity": "payments",
                "syncro_id": "12",
                "raw": {"id": 12, "invoice_id": 8, "amount": 25},
            },
        ],
    )

    report = _run(
        migration.build_reconciliation_report(database, "tenant-a", "job-1")
    )
    assert report["status"] == "attention_required"
    assert report["matched"] is False
    assert report["nexus"]["linked_invoice_count"] == 0
    assert report["nexus"]["missing_invoice_count"] == 1
    assert report["difference"] == {
        "invoice_total": 100.0,
        "amount_paid": 25.0,
        "payment_total": 25.0,
        "payment_count": 1,
    }
    assert report["invoice_total_count"] == 1
    assert report["invoices"][0]["issue_codes"] == [
        "missing_invoice",
        "missing_payment",
        "payment_count_mismatch",
        "payment_sum_mismatch",
    ]


def test_reconciliation_report_does_not_claim_success_without_source_records():
    database = _Database()
    database.seed(
        "syncro_migration_jobs",
        [
            {
                "id": "job-empty",
                "tenant_id": "tenant-a",
                "status": "completed",
                "mode": "apply",
                "requested_by": "tester",
            }
        ],
    )

    report = _run(
        migration.build_reconciliation_report(database, "tenant-a", "job-empty")
    )
    assert report["status"] == "no_source_records"
    assert report["matched"] is False
    assert report["has_source_records"] is False
    assert report["source"]["invoice_count"] == 0
    assert report["source"]["payment_count"] == 0
    assert report["invoices"] == []


def test_payment_method_mapping_does_not_treat_checkout_as_cheque():
    assert migration._payment_method({"payment_method": "Stripe Checkout"}) == "other"
    assert migration._payment_method({"payment_method": "Check"}) == "cheque"


def test_payment_dry_run_previews_before_the_invoice_is_written():
    database = _Database()
    _seed_config(database)
    fake = _FakeClient(
        {
            "/invoices": [
                {
                    "id": 8,
                    "number": "INV-PAY",
                    "customer_id": 1,
                    "status": "Sent",
                    "total": 100,
                    "amount_paid": 25,
                    "line_items": [],
                }
            ],
            "/payments": [
                {"id": 12, "invoice_id": 8, "amount": 25, "payment_method": "Cash"},
                {"id": 14, "amount": 5, "payment_method": "Cash"},
            ],
        }
    )

    async def run():
        job = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=["invoices", "payments"],
            mode="dry_run",
        )
        return await migration.run_migration_job(job["id"], database=database, client_factory=lambda _: fake)

    job = _run(run())
    assert job["status"] == "completed"
    assert job["counts"]["payments"]["created"] == 1
    assert job["counts"]["payments"]["failed"] == 1
    assert database.invoices.rows == []
    assert database.syncro_migration_records.rows == []
    failures = _run(migration.list_failures(database, "tenant-a", job["id"]))
    assert len(failures) == 1
    assert failures[0]["entity"] == "payments"
    assert "has no invoice" in failures[0]["error"]


def test_mid_transition_ticket_and_invoice_numbers_link_without_duplicates():
    database = _Database()
    _seed_config(database)
    database.seed(
        "clients",
        [
            {
                "id": "client-1",
                "tenant_id": "tenant-a",
                "name": "Acme",
                "email": "ops@acme.test",
                "syncro_id": "1",
            }
        ],
    )
    database.seed(
        "tickets",
        [
            {
                "id": "ticket-local",
                "tenant_id": "tenant-a",
                "client_id": "client-1",
                "ticket_number": "T-1001",
                "title": "Created in Nexus during transition",
                "status": "in_progress",
                "created_at": "2026-01-01T00:00:00+00:00",
            }
        ],
    )
    database.seed(
        "invoices",
        [
            {
                "id": "invoice-local",
                "tenant_id": "tenant-a",
                "client_id": "client-1",
                "invoice_number": "INV-1001",
                "status": "sent",
                "total": 25,
                "created_at": "2026-01-01T00:00:00+00:00",
            }
        ],
    )
    fake = _FakeClient(
        {
            "/customers": [{"id": 1, "business_name": "Acme", "email": "ops@acme.test"}],
            "/tickets": [
                {
                    "id": 10,
                    "number": "t-1001",
                    "customer_id": 1,
                    "subject": "Syncro ticket",
                    "status": "Open",
                }
            ],
            "/invoices": [
                {
                    "id": 20,
                    "number": "inv-1001",
                    "customer_id": 1,
                    "status": "Paid",
                    "total": 25,
                    "amount_paid": 25,
                }
            ],
        }
    )
    entities = ["customers", "tickets", "invoices"]

    async def run(mode: str):
        job = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=entities,
            mode=mode,
        )
        return await migration.run_migration_job(job["id"], database=database, client_factory=lambda _: fake)

    dry_run = _run(run("dry_run"))
    assert dry_run["status"] == "completed"
    assert dry_run["counts"]["tickets"]["updated"] == 1
    assert dry_run["counts"]["invoices"]["updated"] == 1
    assert len(database.tickets.rows) == 1
    assert len(database.invoices.rows) == 1

    applied = _run(run("apply"))
    assert applied["status"] == "completed"
    assert applied["totals"]["failed"] == 0
    assert applied["counts"]["tickets"]["linked"] == 1
    assert applied["counts"]["invoices"]["linked"] == 1
    assert len(database.tickets.rows) == 1
    assert database.tickets.rows[0]["id"] == "ticket-local"
    assert database.tickets.rows[0]["syncro_ticket_id"] == "10"
    assert len(database.invoices.rows) == 1
    assert database.invoices.rows[0]["id"] == "invoice-local"
    assert database.invoices.rows[0]["syncro_invoice_id"] == "20"

    second = _run(run("apply"))
    assert second["status"] == "completed"
    assert second["totals"]["created"] == 0
    assert len(database.tickets.rows) == 1
    assert len(database.invoices.rows) == 1


def test_number_match_rejects_cross_client_collision_without_creating_duplicate():
    database = _Database()
    _seed_config(database)
    database.seed(
        "clients",
        [
            {
                "id": "client-1",
                "tenant_id": "tenant-a",
                "name": "Acme",
                "email": "ops@acme.test",
                "syncro_id": "1",
            }
        ],
    )
    database.seed(
        "tickets",
        [
            {
                "id": "ticket-other-client",
                "tenant_id": "tenant-a",
                "client_id": "client-2",
                "ticket_number": "T-1001",
                "title": "Another client's ticket",
            }
        ],
    )
    database.seed(
        "invoices",
        [
            {
                "id": "invoice-other-client",
                "tenant_id": "tenant-a",
                "client_id": "client-2",
                "invoice_number": "INV-1001",
                "total": 25,
            }
        ],
    )
    fake = _FakeClient(
        {
            "/customers": [{"id": 1, "business_name": "Acme", "email": "ops@acme.test"}],
            "/tickets": [
                {
                    "id": 10,
                    "number": "T-1001",
                    "customer_id": 1,
                    "subject": "Syncro ticket",
                    "status": "Open",
                }
            ],
            "/invoices": [
                {
                    "id": 20,
                    "number": "INV-1001",
                    "customer_id": 1,
                    "status": "Sent",
                    "total": 25,
                }
            ],
        }
    )

    async def run():
        job = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=["customers", "tickets", "invoices"],
            mode="apply",
        )
        return await migration.run_migration_job(job["id"], database=database, client_factory=lambda _: fake)

    job = _run(run())
    assert job["status"] == "completed"
    assert job["counts"]["tickets"]["failed"] == 1
    assert job["counts"]["invoices"]["failed"] == 1
    assert job["counts"]["tickets"]["created"] == 0
    assert job["counts"]["invoices"]["created"] == 0
    assert len(database.tickets.rows) == 1
    assert "syncro_ticket_id" not in database.tickets.rows[0]
    assert len(database.invoices.rows) == 1
    assert "syncro_invoice_id" not in database.invoices.rows[0]
    failures = _run(migration.list_failures(database, "tenant-a", job["id"]))
    assert len(failures) == 2
    assert all("different Nexus client" in failure["error"] for failure in failures)


def test_leads_vendors_and_purchase_orders_map_to_native_collections():
    database = _Database()
    _seed_config(database)
    vendor_payload = {
        "id": 30,
        "name": "C & S Wholesalers",
        "rep_first_name": "Bill",
        "rep_last_name": "Sales",
        "email": "info@candswholes.test",
        "phone": "603-344-5555",
        "address": "44 Billings Circle",
        "city": "Keene",
        "state": "NH",
        "zip": "03455",
        "website": "www.candswholes.test",
        "notes": "White label trucks",
        "created_at": "2026-01-02T03:04:05+00:00",
        "updated_at": "2026-02-03T04:05:06+00:00",
    }
    purchase_order = {
        "id": 50,
        "number": "PO-100",
        "status": "Received",
        "total": 60,
        "shipping": 10,
        "other": 0,
        "expected_date": "2026-03-04T00:00:00+00:00",
        "vendor_id": 30,
        "vendor": vendor_payload,
        "line_items": [],
        "created_at": "2026-01-05T00:00:00+00:00",
        "updated_at": "2026-02-05T00:00:00+00:00",
    }
    fake = _FakeClient(
        {
            "/customers": [{"id": 1, "business_name": "Acme", "email": "ops@acme.test"}],
            "/products": [{"id": 4, "name": "Managed endpoint", "price": 25, "sku": "MSP-EP"}],
            "/vendors": [vendor_payload],
            "/leads": [
                {
                    "id": 40,
                    "first_name": "Susy",
                    "last_name": "Ratke",
                    "email": "susy@klocko.test",
                    "phone": "555-0100",
                    "business_then_name": "Klocko-Stracke",
                    "customer_id": 1,
                    "status": "In Negotiation",
                    "opportunity_amount_dollars": 1200,
                    "address": "1 Main St",
                    "city": "Keene",
                    "state": "NH",
                    "zip": "03455",
                    "ticket_description": "Interested in managed services",
                    "hidden_notes": "Warm referral",
                    "user_id": 13,
                }
            ],
            "/purchase_orders": [purchase_order],
            "/purchase_orders/50": {
                "purchase_order": {
                    **purchase_order,
                    "line_items": [
                        {
                            "id": 60,
                            "product_id": 4,
                            "quantity": 2,
                            "cost_cents": 2500,
                            "total_cents": 5000,
                            "received": True,
                            "received_quantity": 2,
                        }
                    ],
                }
            },
        }
    )
    entities = ["customers", "products", "leads", "vendors", "purchase_orders"]

    async def run():
        job = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=entities,
            mode="apply",
        )
        return await migration.run_migration_job(job["id"], database=database, client_factory=lambda _: fake)

    job = _run(run())
    assert job["status"] == "completed"
    assert job["totals"]["failed"] == 0

    client_id = database.clients.rows[0]["id"]
    product_id = database.products.rows[0]["id"]
    vendor_id = database.vendors.rows[0]["id"]

    lead = database.leads.rows[0]
    assert lead["company_name"] == "Klocko-Stracke"
    assert lead["contact_name"] == "Susy Ratke"
    assert lead["status"] == "negotiation"
    assert lead["pipeline_stage"] == 5
    assert lead["estimated_value"] == 1200
    assert lead["converted_to_client"] == client_id
    assert lead["syncro_lead_id"] == "40"
    assert "Warm referral" in lead["notes"]

    vendor = database.vendors.rows[0]
    assert vendor["name"] == "C & S Wholesalers"
    assert vendor["contact_name"] == "Bill Sales"
    assert vendor["email"] == "info@candswholes.test"
    assert vendor["syncro_vendor_id"] == "30"
    assert vendor["status"] == "active"

    po = database.purchase_orders.rows[0]
    assert po["po_number"] == "PO-100"
    assert po["status"] == "received"
    assert po["vendor_id"] == vendor_id
    assert po["vendor"] == "C & S Wholesalers"
    assert po["subtotal"] == 50
    assert po["shipping"] == 10
    assert po["total"] == 60
    assert po["syncro_purchase_order_id"] == "50"
    assert len(po["line_items"]) == 1
    line = po["line_items"][0]
    assert line["product_id"] == product_id
    assert line["product_name"] == "Managed endpoint"
    assert line["unit_price"] == 25
    assert line["received_qty"] == 2
    assert line["status"] == "received"
    assert line["syncro_line_item_id"] == "60"

    assert any(
        row.get("entity") == "leads" and row.get("syncro_id") == "40"
        for row in database.syncro_migration_records.rows
    )

    async def rerun():
        second = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=entities,
            mode="apply",
        )
        return await migration.run_migration_job(second["id"], database=database, client_factory=lambda _: fake)

    second_job = _run(rerun())
    assert second_job["status"] == "completed"
    assert second_job["totals"]["created"] == 0
    assert len(database.leads.rows) == 1
    assert len(database.vendors.rows) == 1
    assert len(database.purchase_orders.rows) == 1


def test_ticket_invoice_and_purchase_order_attachments_migrate_and_rerun_without_duplicates(tmp_path, monkeypatch):
    from app.routers import invoice_attachments, purchase_orders, ticket_attachments

    monkeypatch.setenv("NEXUS_MALWARE_SCANNER", "test")
    monkeypatch.setenv("NEXUS_TEST_ENVIRONMENT", "1")
    monkeypatch.setenv("APP_ENV", "test")
    ticket_dir = tmp_path / "ticket-attachments"
    legacy_dir = tmp_path / "legacy-ticket-attachments"
    invoice_dir = tmp_path / "invoice-attachments"
    po_dir = tmp_path / "purchase-orders"
    ticket_dir.mkdir()
    legacy_dir.mkdir()
    invoice_dir.mkdir()
    po_dir.mkdir()
    monkeypatch.setattr(ticket_attachments, "UPLOAD_DIR", ticket_dir)
    monkeypatch.setattr(ticket_attachments, "LEGACY_UPLOAD_DIR", legacy_dir)
    monkeypatch.setattr(invoice_attachments, "UPLOAD_DIR", invoice_dir)
    monkeypatch.setattr(purchase_orders, "PO_EVIDENCE_DIR", po_dir)

    ticket_attachment_url = "https://files.example.test/tickets/70"
    invoice_attachment_url = "https://files.example.test/invoices/90"
    po_attachment_url = "https://files.example.test/purchase-orders/80"
    ticket = {
        "id": 10,
        "number": 1001,
        "customer_id": 1,
        "subject": "Printer offline",
        "status": "Open",
    }
    invoice = {
        "id": 60,
        "number": "INV-200",
        "customer_id": 1,
        "status": "Sent",
        "total": 100,
        "line_items": [],
    }
    vendor = {"id": 30, "name": "C & S Wholesalers", "email": "info@candswholes.test"}
    purchase_order = {
        "id": 50,
        "number": "PO-100",
        "status": "Ordered",
        "vendor_id": 30,
        "vendor": vendor,
        "line_items": [],
    }
    ticket_detail = {
        "ticket": {
            **ticket,
            "attachments": [
                {
                    "id": 70,
                    "filename": "screen.png",
                    "url": ticket_attachment_url,
                    "content_type": "image/png",
                }
            ],
        }
    }
    invoice_detail = {
        "invoice": {
            **invoice,
            "attachments": [
                {
                    "id": 90,
                    "filename": "invoice-copy.pdf",
                    "url": invoice_attachment_url,
                    "content_type": "application/pdf",
                }
            ],
        }
    }
    po_detail = {
        "purchase_order": purchase_order,
        "attachments": [
            {
                "id": 80,
                "filename": "receipt.pdf",
                "download_url": po_attachment_url,
                "content_type": "application/pdf",
            }
        ],
    }
    png = b"\x89PNG\r\n\x1a\n" + b"ticket-image"
    invoice_pdf = b"%PDF-1.4\ninvoice-copy"
    pdf = b"%PDF-1.4\npurchase-order-receipt"
    fake = _FakeClient(
        {
            "/customers": [{"id": 1, "business_name": "Acme", "email": "ops@acme.test"}],
            "/vendors": [vendor],
            "/invoices": [invoice],
            "/invoices/60": invoice_detail,
            "/tickets": [ticket],
            "/tickets/10": ticket_detail,
            "/purchase_orders": [purchase_order],
            "/purchase_orders/50": po_detail,
        },
        downloads={
            ticket_attachment_url: (png, "image/png", "screen.png"),
            invoice_attachment_url: (invoice_pdf, "application/pdf", "invoice-copy.pdf"),
            po_attachment_url: (pdf, "application/pdf", "receipt.pdf"),
        },
    )
    entities = [
        "customers",
        "vendors",
        "invoices",
        "invoice_attachments",
        "tickets",
        "ticket_attachments",
        "purchase_orders",
        "purchase_order_attachments",
    ]

    async def run():
        job = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=entities,
            mode="apply",
        )
        return await migration.run_migration_job(job["id"], database=database, client_factory=lambda _: fake)

    database = _Database()
    _seed_config(database)
    job = _run(run())
    assert job["status"] == "completed"
    assert job["totals"]["failed"] == 0
    assert job["counts"]["ticket_attachments"]["created"] == 1
    assert job["counts"]["invoice_attachments"]["created"] == 1
    assert job["counts"]["purchase_order_attachments"]["created"] == 1

    assert len(database.ticket_attachments.rows) == 1
    stored_ticket = database.ticket_attachments.rows[0]
    assert stored_ticket["syncro_attachment_id"] == "70"
    assert stored_ticket["source"] == "syncro_migration"
    assert (ticket_dir / stored_ticket["stored_filename"]).read_bytes() == png

    assert len(database.invoice_attachments.rows) == 1
    stored_invoice = database.invoice_attachments.rows[0]
    assert stored_invoice["syncro_attachment_id"] == "90"
    assert stored_invoice["syncro_invoice_id"] == "60"
    assert stored_invoice["invoice_id"] == database.invoices.rows[0]["id"]
    assert stored_invoice["source"] == "syncro_migration"
    assert (invoice_dir / stored_invoice["stored_filename"]).read_bytes() == invoice_pdf

    stored_po = database.purchase_orders.rows[0]
    assert len(stored_po["attachments"]) == 1
    assert stored_po["attachments"][0]["syncro_attachment_id"] == "80"
    assert stored_po["attachments"][0]["source"] == "syncro_migration"
    assert (po_dir / stored_po["attachments"][0]["url"].rsplit("/", 1)[-1]).read_bytes() == pdf

    fake.download_calls.clear()

    async def rerun():
        second = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=entities,
            mode="apply",
        )
        return await migration.run_migration_job(second["id"], database=database, client_factory=lambda _: fake)

    second = _run(rerun())
    assert second["status"] == "completed"
    assert second["totals"]["created"] == 0
    assert second["counts"]["ticket_attachments"]["linked"] == 1
    assert second["counts"]["invoice_attachments"]["linked"] == 1
    assert second["counts"]["purchase_order_attachments"]["linked"] == 1
    assert len(database.ticket_attachments.rows) == 1
    assert len(database.invoice_attachments.rows) == 1
    assert len(database.purchase_orders.rows[0]["attachments"]) == 1
    assert fake.download_calls == []


def test_customer_name_match_does_not_merge_when_email_differs():
    database = _Database()
    _seed_config(database)
    database.seed(
        "clients",
        [{"id": "manual-acme", "tenant_id": "tenant-a", "name": "Acme", "email": "billing@acme.test"}],
    )
    fake = _FakeClient(
        {"/customers": [{"id": 1, "business_name": "Acme", "email": "ops@acme.test"}]}
    )

    async def run():
        job = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=["customers"],
            mode="apply",
        )
        return await migration.run_migration_job(job["id"], database=database, client_factory=lambda _: fake)

    job = _run(run())
    assert job["status"] == "completed"
    assert job["counts"]["customers"]["created"] == 1
    assert len(database.clients.rows) == 2
    assert database.clients.rows[0]["id"] == "manual-acme"
    assert database.clients.rows[1]["syncro_id"] == "1"


def test_create_job_defaults_to_every_entity_and_rejects_unknown_entities():
    database = _Database()
    _seed_config(database)

    async def run():
        default_job = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=None,
            mode="dry_run",
        )
        assert default_job["entities"] == list(migration.ENTITY_SPECS)
        with pytest.raises(ValueError, match="Unsupported Syncro entities"):
            await migration.create_job(
                database,
                tenant_id="tenant-a",
                requested_by="tester",
                entities=["customers", "not_a_syncro_entity"],
                mode="dry_run",
            )

    _run(run())


def test_stale_active_job_is_failed_before_a_new_job_can_start():
    database = _Database()
    _seed_config(database)

    async def run():
        first = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=["customers"],
            mode="apply",
        )
        await database.syncro_migration_jobs.update_one(
            {"id": first["id"]},
            {"$set": {"status": "running", "updated_at": "2020-01-01T00:00:00+00:00"}},
        )
        second = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=["customers"],
            mode="apply",
        )
        released = await migration.get_job(database, "tenant-a", first["id"])
        return second, released

    second, released = _run(run())
    assert second["id"] != released["id"]
    assert released["status"] == "failed"
    assert "worker stopped" in released["last_error"].lower()


def test_bad_relation_is_recorded_and_does_not_abort_the_job():
    database = _Database()
    _seed_config(database)
    fake = _FakeClient(
        {
            "/customers": [{"id": 1, "business_name": "Acme"}],
            "/contacts": [
                {"id": 2, "customer_id": 999, "name": "Orphan"},
                {"id": 3, "customer_id": 1, "name": "Valid"},
            ],
        }
    )

    async def run():
        job = await migration.create_job(
            database,
            tenant_id="tenant-a",
            requested_by="tester",
            entities=["customers", "contacts"],
            mode="apply",
        )
        return await migration.run_migration_job(job["id"], database=database, client_factory=lambda _: fake)

    job = _run(run())
    assert job["status"] == "completed"
    assert job["counts"]["contacts"]["failed"] == 1
    assert job["counts"]["contacts"]["created"] == 1
    failures = _run(migration.list_failures(database, "tenant-a", job["id"]))
    assert len(failures) == 1
    assert "unmigrated customer" in failures[0]["error"]
