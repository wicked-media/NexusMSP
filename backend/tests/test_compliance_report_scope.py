"""Tenant boundaries for retained compliance evidence reports."""

import asyncio
from types import SimpleNamespace

from app.routers import compliance


class _Cursor:
    def sort(self, *_args):
        return self

    async def to_list(self, _limit):
        return []


class _Reports:
    def __init__(self):
        self.query = None

    def find(self, query, *_args):
        self.query = query
        return _Cursor()

    async def find_one(self, query, *_args):
        self.query = query
        return {
            "id": "scan-1", "tenant_id": "tenant-a", "client_id": "client-a",
            "framework": "essential8", "framework_name": "Essential Eight",
            "controls": [], "passed": 0, "evaluated": 0, "total": 0,
        }


class _Generated:
    def __init__(self):
        self.query = None
        self.inserted = None

    def find(self, query, *_args):
        self.query = query
        return _Cursor()

    async def insert_one(self, document):
        self.inserted = dict(document)


def _user():
    return {"id": "tech-1", "name": "Technician", "is_admin": True, "tenant_id": "tenant-a"}


def test_compliance_report_list_and_generation_are_tenant_scoped(monkeypatch):
    scans = _Reports()
    generated = _Generated()
    monkeypatch.setattr(compliance, "db", SimpleNamespace(compliance_reports=scans, compliance_generated_reports=generated))

    assert asyncio.run(compliance.get_generated_reports(_user())) == []
    assert generated.query == {"$and": [{"source": "evidence_scan"}, {"tenant_id": "tenant-a"}]}

    report = asyncio.run(compliance.generate_compliance_report({"scan_id": "scan-1"}, _user()))
    assert scans.query == {"$and": [{"id": "scan-1"}, {"tenant_id": "tenant-a"}]}
    assert report["tenant_id"] == "tenant-a"
    assert generated.inserted["client_id"] == "client-a"
