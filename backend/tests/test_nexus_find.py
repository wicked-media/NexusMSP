"""Contract tests for Find Everywhere (one value, every Nexus store)."""

import asyncio
import copy
import os
import re
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.services import nexus_find  # noqa: E402


# ============== MINIMAL MONGO FAKES (same contract as test_tech_fun) ==============


def _match_value(value, condition):
    if isinstance(condition, dict):
        for op, operand in condition.items():
            if op == "$in" and value not in operand:
                return False
            if op == "$nin" and value in operand:
                return False
            if op == "$exists" and (value is not None) != bool(operand):
                return False
            if op == "$ne" and value == operand:
                return False
            if op == "$gt" and not (value is not None and value > operand):
                return False
            if op == "$gte" and not (value is not None and value >= operand):
                return False
            if op == "$lt" and not (value is not None and value < operand):
                return False
            if op == "$lte" and not (value is not None and value <= operand):
                return False
            if op == "$regex" and not re.search(operand, str(value or "")):
                return False
        return True
    if condition is None:
        return value is None
    return value == condition


def _matches(row, query):
    for key, condition in query.items():
        if key == "$or":
            if not any(_matches(row, sub) for sub in condition):
                return False
        elif key == "$and":
            if not all(_matches(row, sub) for sub in condition):
                return False
        elif not _match_value(row.get(key), condition):
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, field, direction=1):
        self._rows = sorted(self._rows, key=lambda row: (row.get(field) is None, row.get(field)),
                            reverse=direction < 0)
        return self

    def limit(self, count):
        self._rows = self._rows[:count]
        return self

    async def to_list(self, _count=None):
        return [copy.deepcopy(row) for row in self._rows]


class _Collection:
    def __init__(self, rows=None):
        self.rows = [copy.deepcopy(row) for row in (rows or [])]
        self.inserted = []
        self.updates = []

    def find(self, query=None, _projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query or {})])

    async def find_one(self, query=None, _projection=None):
        for row in self.rows:
            if _matches(row, query or {}):
                return copy.deepcopy(row)
        return None

    async def insert_one(self, row):
        self.rows.append(copy.deepcopy(row))
        self.inserted.append(copy.deepcopy(row))

    async def update_one(self, query, update, upsert=False, **_kwargs):
        for row in self.rows:
            if _matches(row, query):
                for field, value in (update.get("$set") or {}).items():
                    row[field] = value
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def count_documents(self, query=None):
        return sum(1 for row in self.rows if _matches(row, query or {}))


def _db(**collections):
    namespace = SimpleNamespace()
    for entry in nexus_find.SEARCH_SOURCES:
        setattr(namespace, entry["collection"], collections.get(entry["collection"], _Collection()))
    return namespace


def _user(tenant="platform-a"):
    return {"id": "tech-1", "name": "Terry Tech", "role": "tech", "is_admin": False,
            "tenant_id": tenant, "client_scope_mode": "all"}


_VALUED_IP = "192.168.1.14"


def _fixture(**overrides):
    defaults = dict(
        devices=_Collection([
            {"id": "dev-1", "tenant_id": "platform-a", "hostname": "ACME-DC-01",
             "ip_address": _VALUED_IP, "client_id": "CLI-001", "client_name": "ACME"},
            {"id": "dev-2", "tenant_id": "platform-a", "hostname": "ACME-DC-02",
             "ip_address": "192.168.1.15", "client_id": "CLI-001", "client_name": "ACME"},
            {"id": "dev-9", "tenant_id": "platform-b", "hostname": "OTHER-DC-01",
             "ip_address": _VALUED_IP, "client_id": "CLI-009"},
        ]),
        script_library=_Collection([
            {"id": "s-1", "tenant_id": "platform-a", "name": "Repoint print server",
             "script": f"Set-Printer -Host {_VALUED_IP} -Name 'MAIL01'"},
        ]),
        ssl_certificates=_Collection([
            {"id": "c-1", "tenant_id": "platform-a", "domain": "mail.acme.com.au",
             "issuer": "DigiCert", "san": "mail.acme.com.au, autodiscover.acme.com.au"},
        ]),
    )
    defaults.update(overrides)
    return _db(**defaults)


# ============== THE PUBLISHED SOURCE LIST ==============


def test_search_sources_publishes_owners_and_the_honest_limit():
    published = nexus_find.search_sources()
    assert len(published["sources"]) == 10
    assert published["max_documents_per_source"] == nexus_find.MAX_DOCS_PER_SOURCE
    owners = {entry["source"]: entry["owner"] for entry in published["sources"]}
    assert owners["devices"] == "asset inventory"
    assert owners["runbooks"] == "command recorder"
    for entry in published["sources"]:
        assert entry["fields"] and entry["label"]
    assert "cannot see hardcoded values inside applications" in published["note"]


# ============== FIND EVERYWHERE ==============


def test_find_everywhere_groups_hits_by_store():
    result = asyncio.run(nexus_find.find_everywhere(_fixture(), _user(), _VALUED_IP))
    assert result["found"] is True
    assert result["total"] == 2
    sources = [group["source"] for group in result["groups"]]
    assert sources == ["devices", "scripts"]
    device_hit = result["groups"][0]["hits"][0]
    assert device_hit["id"] == "dev-1"
    assert device_hit["matched_fields"] == ["ip_address"]
    assert device_hit["label"] == "ACME-DC-01"
    assert _VALUED_IP in device_hit["excerpt"]
    assert "mail-shield" not in result["empty"]
    assert "certificates" in result["empty"]
    assert result["sources_searched"][0] == "devices"


def test_find_everywhere_searches_inside_long_text_and_is_case_insensitive():
    result = asyncio.run(nexus_find.find_everywhere(_fixture(), _user(), "mail.acme.com.AU"))
    assert result["total"] == 1
    assert result["groups"][0]["source"] == "certificates"
    assert set(result["groups"][0]["hits"][0]["matched_fields"]) == {"domain", "san"}


def test_find_everywhere_rejects_empty_query_and_unknown_source():
    db = _fixture()
    assert asyncio.run(nexus_find.find_everywhere(db, _user(), "   "))["error"] == "query is required"
    too_long = asyncio.run(nexus_find.find_everywhere(db, _user(), "x" * 201))
    assert "too long" in too_long["error"]
    unknown = asyncio.run(nexus_find.find_everywhere(db, _user(), "acme", sources=["devices", "ghost"]))
    assert "unknown source 'ghost'" in unknown["error"]
    empty = asyncio.run(nexus_find.find_everywhere(db, _user(), "acme", sources=[]))
    assert empty["error"] == "sources must not be empty"


def test_find_everywhere_can_be_narrowed_to_named_sources():
    result = asyncio.run(nexus_find.find_everywhere(
        _fixture(), _user(), _VALUED_IP, sources=["scripts"]))
    assert result["sources_searched"] == ["scripts"]
    assert [group["source"] for group in result["groups"]] == ["scripts"]


def test_find_everywhere_never_leaves_the_tenant_partition():
    result = asyncio.run(nexus_find.find_everywhere(_fixture(), _user(), "OTHER-DC-01"))
    assert result["total"] == 0
    assert result["groups"] == []
    other = asyncio.run(nexus_find.find_everywhere(
        _fixture(), _user(tenant="platform-b"), "OTHER-DC-01"))
    assert other["total"] == 1
    assert other["groups"][0]["hits"][0]["id"] == "dev-9"


# ============== LITERAL SCAN ==============


def test_literal_scan_locates_one_value_and_bands_the_risk():
    result = asyncio.run(nexus_find.literal_scan(_fixture(), _user(), {"value": _VALUED_IP}))
    assert result["found"] is True
    assert result["mode"] == "locate"
    assert result["kind"] == "ip"
    assert result["total"] == 2
    assert result["change_impact"]["band"] == "medium"
    assert result["change_impact"]["certainty"] == "observed"


def test_literal_scan_discovers_private_addresses_and_name_shaped_tokens():
    result = asyncio.run(nexus_find.literal_scan(_fixture(), _user(), {"kind": "auto"}))
    assert result["found"] is True
    assert result["mode"] == "discover"
    assert result["scanned"]["documents"] >= 4
    by_value = {item["value"]: item for item in result["literals"]}
    assert by_value[_VALUED_IP]["kind"] == "ip"
    assert by_value[_VALUED_IP]["private"] is True
    assert by_value[_VALUED_IP]["occurrences"] == 2
    assert by_value[_VALUED_IP]["sources"] == ["devices", "scripts"]
    assert "mail.acme.com.au" in by_value
    assert by_value["mail.acme.com.au"]["kind"] == "domain"
    assert any(item["kind"] == "hostname" for item in result["literals"])
    assert "declared heuristic" in result["note"]
    assert result["literals"][0]["occurrences"] >= result["literals"][-1]["occurrences"]


def test_literal_scan_rejects_an_unknown_kind():
    bad = asyncio.run(nexus_find.literal_scan(_fixture(), _user(), {"kind": "serial"}))
    assert bad["found"] is False
    assert "kind must be one of" in bad["error"]


def test_literal_scan_hostname_only_skips_ips_and_domains():
    result = asyncio.run(nexus_find.literal_scan(_fixture(), _user(), {"kind": "hostname"}))
    kinds = {item["kind"] for item in result["literals"]}
    assert kinds == {"hostname"}
    assert _VALUED_IP not in {item["value"] for item in result["literals"]}


# ============== CHANGE IMPACT ==============


def test_change_impact_reports_references_affected_objects_and_the_subnet():
    result = asyncio.run(nexus_find.change_impact(_fixture(), _user(), {"value": _VALUED_IP}))
    assert result["found"] is True
    assert result["total"] == 2
    assert result["affected"] == {"devices": 1, "clients": 1}
    assert result["risk_band"]["band"] == "medium"
    assert "192.168.1.0/24" in result["note"]
    assert "2 device address(es) are recorded" in result["note"]
    assert result["note"].startswith(nexus_find.SEARCH_NOTE)


def test_change_impact_with_no_references_is_honestly_unverified():
    result = asyncio.run(nexus_find.change_impact(_fixture(), _user(), {"value": "10.99.99.99"}))
    assert result["found"] is True
    assert result["total"] == 0
    assert result["risk_band"] == {"band": "low",
                                   "reason": "No reference to this value was found in the stores Nexus can see.",
                                   "certainty": "unverified"}
    assert result["affected"] == {"devices": 0, "clients": 0}


def test_change_impact_requires_a_value_and_propagates_validation():
    assert asyncio.run(nexus_find.change_impact(_fixture(), _user(), {}))["error"] == "value is required"
    bad = asyncio.run(nexus_find.change_impact(_fixture(), _user(), {"value": "acme", "sources": ["ghost"]}))
    assert "unknown source 'ghost'" in bad["error"]


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
