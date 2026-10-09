"""Web Studio fleet intelligence and Safe Update Engine tests.

The fleet command centre and Safe Update Engine are only trustworthy if their
policy is deterministic. These tests pin the pure rules (version distance,
plugin normalisation, fleet aggregation, preflight, risk, execution policy and
plan transitions) and then exercise the router boundaries against a fake,
tenant-scoped database.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.routers import web_studio
from app.services.web_studio_fleet import (
    backup_evidence,
    build_update_plan,
    can_transition,
    fleet_plugin_intelligence,
    fleet_summary,
    normalise_plugin_inventory,
    policy_allows_execution,
    site_attention,
    update_preflight,
    update_risk,
    version_distance,
)

NOW = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)


# ── fake database ────────────────────────────────────────────────────────────

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


class _Result:
    def __init__(self, matched_count=0):
        self.matched_count = matched_count


class _Rows:
    def __init__(self):
        self.rows = []

    async def find_one(self, query, _projection=None):
        return next((dict(row) for row in self.rows if _matches(row, query)), None)

    async def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set") or {})
                for key, value in (update.get("$push") or {}).items():
                    row.setdefault(key, []).append(value)
                return _Result(1)
        if upsert:
            created = {k: v for k, v in query.items() if not isinstance(v, dict)}
            created.update(update.get("$set") or {})
            self.rows.append(created)
            return _Result(1)
        return _Result(0)

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


class _Audit:
    def __init__(self):
        self.entries = []

    async def __call__(self, user, action, entity_type, entity_id, entity_name="", details="", **kwargs):
        self.entries.append({"action": action, "entity_type": entity_type, "entity_id": entity_id})


def _user(user_id="tech-1", tenant="tenant-a"):
    return {"id": user_id, "tenant_id": tenant, "name": "Web Tech", "email": f"{user_id}@example.com", "is_admin": True}


def _site(site_id="site-1", **overrides):
    site = {
        "id": site_id,
        "tenant_id": "tenant-a",
        "client_id": "client-1",
        "client_name": "Acme",
        "name": "Acme Business",
        "primary_domain": "acme.example",
        "platform": "wordpress",
        "stage": "live",
        "php_version": "8.2",
        "wordpress_version": "6.6",
        "update_policy": "manual",
        "wordpress_connection": {"api_url": "https://acme.example/wp-json", "username": "nexus", "application_password_encrypted": "x"},
        "last_wordpress_sync_at": (NOW - timedelta(hours=2)).isoformat(),
        "last_backup_at": (NOW - timedelta(hours=3)).isoformat(),
        "wordpress_inventory": {
            "plugins": [
                {"plugin": "akismet/akismet.php", "name": "Akismet", "version": "5.3", "status": "active",
                 "update": {"new_version": "5.3.1"}, "requires_php": "7.2", "tested_up_to": "6.6"},
                {"plugin": "woo/woo.php", "name": "WooCommerce", "version": "9.0", "status": "active",
                 "update": {"new_version": "10.0"}, "requires_php": "7.4", "tested_up_to": "6.6"},
            ],
        },
    }
    site.update(overrides)
    return site


def _install(monkeypatch, db):
    monkeypatch.setattr(web_studio, "db", db)
    audit = _Audit()
    monkeypatch.setattr(web_studio, "log_activity", audit)

    async def _noop_scope(*_args, **_kwargs):
        return None

    async def _identity_record(user, collection, record_id, operation=None, resource_name=None):
        record = await collection.find_one({"id": record_id}, {"_id": 0})
        if not record:
            raise ValueError(f"{resource_name or 'Record'} not found")
        return record

    monkeypatch.setattr(web_studio, "assert_client_scope", _noop_scope)
    monkeypatch.setattr(web_studio, "assert_global_scope", _noop_scope)
    monkeypatch.setattr(web_studio, "assert_record_scope", _identity_record)
    monkeypatch.setattr(web_studio, "scoped_query", lambda user, query: query)

    async def _status():
        return {"provider": "synergy_wholesale", "configured": False}

    monkeypatch.setattr(web_studio, "_integration_status", _status)

    async def _approval(payload, user):
        return {"id": "approval-1", **payload}

    monkeypatch.setattr(web_studio, "create_approval", _approval)
    return audit


# ── pure policy ──────────────────────────────────────────────────────────────

def test_version_distance_reads_major_minor_patch_and_unknown():
    assert version_distance("9.0", "10.0") == "major"
    assert version_distance("5.3", "5.4") == "minor"
    assert version_distance("5.3.0", "5.3.1") == "patch"
    assert version_distance("", "5.3") == "unknown"
    assert version_distance("nightly", "5.3") == "unknown"


def test_normalise_plugin_inventory_keeps_every_plugin_and_reads_updates():
    rows = normalise_plugin_inventory([
        {"plugin": "a/a.php", "name": "A", "version": "1.0", "status": "ACTIVE", "update": {"new_version": "1.1"}},
        {"plugin": "b/b.php", "name": "B", "version": "2.0", "update": False, "requires_php": "7.4"},
        {"name": "No slug"},  # must still resolve a slug, or be dropped
        "not-a-dict",
    ])
    assert [row["plugin"] for row in rows] == ["a/a.php", "b/b.php", "No slug"]
    assert rows[0]["update_available"] is True and rows[0]["new_version"] == "1.1"
    assert rows[0]["status"] == "active"
    assert rows[1]["update_available"] is False and rows[1]["requires_php"] == "7.4"


def test_fleet_plugin_intelligence_aggregates_across_sites_and_never_invents_findings():
    sites = [
        _site("site-1"),
        _site("site-2", client_name="Central", wordpress_inventory={
            "plugins": [{"plugin": "akismet/akismet.php", "name": "Akismet", "version": "5.2", "status": "active", "update": {"new_version": "5.3.1"}}],
        }, security_findings=[{"plugin": "akismet/akismet.php", "cve": "CVE-x"}]),
    ]
    rows = fleet_plugin_intelligence(sites)
    akismet = next(row for row in rows if row["plugin"] == "akismet/akismet.php")
    assert akismet["sites_installed"] == 2
    assert akismet["sites_with_updates"] == 2
    assert akismet["security_findings"] == 1
    assert akismet["abandoned"] is False
    assert akismet["licence_status"] == "unknown"
    # The plugin with no recorded finding stays at zero, it is not guessed.
    woo = next(row for row in rows if row["plugin"] == "woo/woo.php")
    assert woo["security_findings"] == 0
    # Findings sort first.
    assert rows[0]["plugin"] == "akismet/akismet.php"


def test_backup_evidence_distinguishes_missing_from_stale():
    missing = backup_evidence({"id": "s"}, now=NOW)
    assert missing["assessed"] is False and missing["fresh"] is False
    fresh = backup_evidence({"last_backup_at": (NOW - timedelta(hours=3)).isoformat()}, now=NOW)
    assert fresh["fresh"] is True
    stale = backup_evidence({"last_backup_at": (NOW - timedelta(hours=48)).isoformat()}, now=NOW)
    assert stale["assessed"] is True and stale["fresh"] is False


def test_fleet_summary_reports_assessed_dimensions_and_attention():
    sites = [
        _site("site-1"),
        _site("site-2", website_health={"status": "unreachable"}, last_backup_at=""),
    ]
    summary = fleet_summary(sites, now=NOW)
    assert summary["managed_websites"] == 2
    assert summary["plugin_updates"] == 4  # 2 plugins on each of two sites
    assert summary["backup_warnings"] == 1
    assert summary["unreachable_sites"] == 1
    assert summary["attention_count"] == 2
    assert summary["assessed"]["plugins"] is True
    assert summary["assessed"]["backups"] is True

    empty = fleet_summary([], now=NOW)
    # Nothing has been assessed yet, and that is stated rather than implied clean.
    assert empty["assessed"] == {"plugins": False, "security": False, "backups": False}


def test_site_attention_names_reasons_and_escalates_on_findings():
    healthy = site_attention(_site("s", wordpress_inventory={"plugins": []}, last_backup_at=(NOW - timedelta(hours=1)).isoformat()), now=NOW)
    # No plugins, no findings, fresh backup -> healthy with no reasons.
    assert healthy["level"] == "healthy" and healthy["reasons"] == []

    critical = site_attention(_site("s", security_findings=[{"plugin": "x/x.php"}]), now=NOW)
    assert critical["level"] == "critical"
    assert any("security finding" in reason for reason in critical["reasons"])


def test_update_risk_escalates_major_core_and_php_mismatch():
    routine = update_risk({"kind": "plugin", "from_version": "5.3", "to_version": "5.3.1"}, _site())
    assert routine["risk"] == "low"

    major = update_risk({"kind": "plugin", "from_version": "9.0", "to_version": "10.0"}, _site())
    assert major["risk"] in {"medium", "high"}

    core = update_risk({"kind": "core", "from_version": "6.6", "to_version": "6.7"}, _site())
    assert core["risk"] == "high"

    php = update_risk({"kind": "plugin", "from_version": "1.0", "to_version": "1.0.1", "requires_php": "8.3"}, _site(php_version="8.0"))
    assert php["risk"] == "high"
    assert any("Requires PHP" in reason for reason in php["reasons"])


def test_update_preflight_blocks_missing_backup_and_stale_inventory():
    blocked = update_preflight(_site("s", last_backup_at=""), [{"plugin": "akismet/akismet.php"}], now=NOW)
    assert blocked["allowed"] is False
    assert "backup" in blocked["blockers"]

    stale = update_preflight(_site("s", last_wordpress_sync_at=(NOW - timedelta(hours=48)).isoformat()), [{"plugin": "akismet/akismet.php"}], now=NOW)
    assert stale["allowed"] is False and "inventory" in stale["blockers"]

    unlinked = update_preflight(_site("s", wordpress_connection={}), [{"plugin": "akismet/akismet.php"}], now=NOW)
    assert unlinked["allowed"] is False and "connection" in unlinked["blockers"]

    missing_target = update_preflight(_site("s"), [{"plugin": "ghost/ghost.php"}], now=NOW)
    assert missing_target["allowed"] is False and "inventory_match" in missing_target["blockers"]

    ok = update_preflight(_site("s"), [{"plugin": "akismet/akismet.php"}], now=NOW)
    assert ok["allowed"] is True and ok["blockers"] == []


def test_build_update_plan_is_a_record_not_an_execution():
    plan = build_update_plan(_site("s"), [{"kind": "plugin", "plugin": "akismet/akismet.php", "from_version": "5.3", "to_version": "5.3.1"}], policy="assisted", now=NOW)
    assert plan["status"] == "preflight_passed"
    assert plan["policy"] == "assisted"
    assert plan["items"][0]["risk"] in {"low", "medium", "high"}

    failed = build_update_plan(_site("s", last_backup_at=""), [{"kind": "plugin", "plugin": "akismet/akismet.php", "from_version": "5.3", "to_version": "5.3.1"}], now=NOW)
    assert failed["status"] == "preflight_failed"


def test_policy_allows_execution_never_auto_runs_manual_or_risky():
    assert policy_allows_execution("manual", "low", approved=True)["allowed"] is False
    assert policy_allows_execution("assisted", "low", approved=True)["allowed"] is False
    assert policy_allows_execution("policy_driven", "low", approved=True)["allowed"] is True
    assert policy_allows_execution("policy_driven", "high", approved=True)["allowed"] is False
    assert policy_allows_execution("policy_driven", "low", approved=False)["allowed"] is False


def test_can_transition_enforces_the_plan_lifecycle():
    assert can_transition("draft", "preflight_passed") is True
    assert can_transition("preflight_failed", "approved") is False
    assert can_transition("pending_approval", "approved") is True
    assert can_transition("approved", "queued") is True
    assert can_transition("queued", "completed") is True
    assert can_transition("completed", "queued") is False


# ── router boundaries ────────────────────────────────────────────────────────

def test_fleet_endpoint_returns_summary_and_site_attention(monkeypatch):
    db = _Db()
    _install(monkeypatch, db)
    db.web_sites.rows = [_site("site-1"), _site("site-2", website_health={"status": "unreachable"})]

    result = asyncio.run(web_studio.get_web_studio_fleet(client_id=None, user=_user()))
    assert result["summary"]["managed_websites"] == 2
    assert result["summary"]["plugin_updates"] == 4
    assert {site["id"] for site in result["sites"]} == {"site-1", "site-2"}
    unreachable = next(site for site in result["sites"] if site["id"] == "site-2")
    assert unreachable["attention"]["level"] == "critical"
    assert unreachable["wordpress_connected"] is True


def test_plugin_intelligence_endpoint_aggregates_scoped_sites(monkeypatch):
    db = _Db()
    _install(monkeypatch, db)
    db.web_sites.rows = [_site("site-1")]
    result = asyncio.run(web_studio.get_web_studio_plugin_intelligence(client_id=None, user=_user()))
    assert result["site_count"] == 1
    assert result["plugins"][0]["plugin"] == "akismet/akismet.php"


def test_create_update_plan_persists_and_never_claims_execution(monkeypatch):
    db = _Db()
    audit = _install(monkeypatch, db)
    db.web_sites.rows = [_site("site-1")]
    payload = web_studio.UpdatePlanInput(
        items=[web_studio.UpdatePlanItem(kind="plugin", plugin="akismet/akismet.php", name="Akismet", from_version="5.3", to_version="5.3.1")],
        policy="assisted",
        reason="Routine plugin maintenance during the approved change window",
    )

    plan = asyncio.run(web_studio.create_web_studio_update_plan("site-1", payload, user=_user()))
    assert plan["status"] == "preflight_passed"
    assert plan["risk"] in {"low", "medium"}
    assert db.web_update_plans.rows[0]["id"] == plan["id"]
    assert {entry["action"] for entry in audit.entries} == {"web_update_plan_created"}


def test_create_update_plan_records_failed_preflight_without_a_blocker_leak(monkeypatch):
    db = _Db()
    _install(monkeypatch, db)
    db.web_sites.rows = [_site("site-1", last_backup_at="")]
    payload = web_studio.UpdatePlanInput(
        items=[web_studio.UpdatePlanItem(kind="plugin", plugin="akismet/akismet.php", name="Akismet", from_version="5.3", to_version="5.3.1")],
        reason="Routine plugin maintenance during the approved change window",
    )
    plan = asyncio.run(web_studio.create_web_studio_update_plan("site-1", payload, user=_user()))
    assert plan["status"] == "preflight_failed"
    assert "backup" in plan["preflight"]["blockers"]


def test_approve_refuses_a_failed_preflight_and_requires_eligibility(monkeypatch):
    db = _Db()
    _install(monkeypatch, db)
    db.web_sites.rows = [_site("site-1", last_backup_at="")]
    db.web_update_plans.rows = [{
        "id": "plan-1", "site_id": "site-1", "client_id": "client-1", "status": "preflight_failed",
        "policy": "manual", "risk": "low", "items": [{"plugin": "akismet/akismet.php"}],
    }]
    with pytest.raises(Exception) as refused:
        asyncio.run(web_studio.approve_web_studio_update_plan("plan-1", user=_user()))
    assert "preflight" in str(refused.value).lower()


def test_approve_then_execute_queues_for_worker(monkeypatch):
    db = _Db()
    _install(monkeypatch, db)
    db.web_sites.rows = [_site("site-1")]
    db.web_update_plans.rows = [{
        "id": "plan-1", "site_id": "site-1", "client_id": "client-1", "status": "preflight_passed",
        "policy": "assisted", "risk": "low", "items": [{"plugin": "akismet/akismet.php", "kind": "plugin",
                                                          "from_version": "5.3", "to_version": "5.3.1"}],
        "history": [],
    }]

    approved = asyncio.run(web_studio.approve_web_studio_update_plan("plan-1", user=_user()))
    assert approved["status"] == "approved"
    assert approved["execution"]["allowed"] is False  # assisted never auto-executes

    queued = asyncio.run(web_studio.execute_web_studio_update_plan("plan-1", user=_user()))
    assert queued["status"] == "awaiting_worker"
    assert "must record the verified result" in queued["message"]
    row = db.web_update_plans.rows[0]
    assert row["execution_mode"] == "nexus_wordpress_control_worker_required"
    assert [entry["event"] for entry in row["history"]] == ["approved", "queued"]
