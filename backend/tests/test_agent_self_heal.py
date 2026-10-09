"""NexusOps Agent self-healing policy, evidence and probe tests.

The endpoint agent now reports whether it can still reach NexusMSP, which repair
it attempted, and whether its Windows performance guard decided to run the
inbuilt component repair. These tests pin the server half of that contract:

- the signed policy that gates a privileged repair on a customer endpoint, and
  its fail-closed default when no operator has opted in;
- the bounded heartbeat evidence a device record accepts, including that absurd
  or malformed input is truncated rather than stored or raised;
- the authenticated ping the agent uses to prove that it is the network, not its
  own loop, that failed — and that probing consumes no queued work.
"""

import asyncio

import pytest
from fastapi import HTTPException

from app.routers import nexus_agent
from app.services import agent_trust
from app.services.agent_trust import build_agent_policy

# The whole self-healing policy block. Detection is on; repairing the customer's
# Windows image is off until an operator opts in.
EXPECTED_SELF_HEAL_POLICY = {
    "enabled": True,
    "windows_repair_enabled": False,
    "windows_repair_max_runs_per_day": 1,
    "windows_repair_cooldown_hours": 24,
    "windows_repair_window_start_hour": 2,
    "windows_repair_window_end_hour": 5,
    "windows_repair_enforce_window": False,
    # The last rung of the agent's repair ladder. Restarting the service is the
    # most disruptive thing it can do to a working endpoint, so it is off too.
    "allow_service_restart": False,
}

DNS_PROFILE = {"enabled": True, "mode": "visibility", "deployment_id": "dns-1"}


@pytest.fixture(autouse=True)
def _deterministic_signing_metadata(monkeypatch):
    """Keep policy generation hermetic.

    ``build_agent_policy`` embeds the command/update signing metadata and the
    backup envelope key. Those belong to update and backup trust, not to
    self-healing, and they depend on deployment secrets that an ordinary unit
    run does not have. Pinning them keeps this suite focused on the block under
    test instead of failing for an unrelated missing key.
    """
    monkeypatch.setattr(
        agent_trust,
        "agent_command_signing_metadata",
        lambda: {
            "signature_algorithm": "ed25519",
            "signing_public_key": "unit-test-public-key",
            "signing_key_id": "unit-test-key-id",
        },
    )
    monkeypatch.setattr(
        agent_trust,
        "backup_envelope_public_material",
        lambda: {"state": "unit-test"},
    )


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


class _Collection:
    """In-memory stand-in that records every write for read-only assertions."""

    def __init__(self):
        self.rows = []
        self.updates = []
        self.inserts = []

    async def find_one(self, query, _projection=None):
        # An unmatched lookup returns an empty document rather than None: the
        # agent routes treat a missing record as falsy, and a real auth failure
        # must not turn into an AttributeError.
        return next((dict(row) for row in self.rows if _matches(row, query)), {})

    async def update_one(self, query, update, upsert=False):
        self.updates.append(update)
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set") or {})
                return _Result(1)
        return _Result(0)

    async def insert_one(self, document):
        self.inserts.append(dict(document))
        self.rows.append(dict(document))
        return _Result(1)


class _Db:
    """Attribute-style stand-in for the Motor database handle."""

    def __init__(self):
        self._collections = {}

    def __getattr__(self, name):
        return self._collections.setdefault(name, _Collection())


def test_the_windows_repair_policy_is_opt_in_and_cacheable():
    closed = build_agent_policy({}, DNS_PROFILE)
    # Nothing an agent can do on its own turns the privileged repair on.
    assert closed["self_heal"] == EXPECTED_SELF_HEAL_POLICY

    opened = build_agent_policy({"windows_self_heal_enabled": True}, DNS_PROFILE)
    assert opened["self_heal"]["windows_repair_enabled"] is True
    # Turning the repair on changes nothing else in the self-healing contract,
    # and never weakens the existing local self-repair block.
    assert opened["self_heal"]["windows_repair_max_runs_per_day"] == 1
    assert opened["self_repair"] == closed["self_repair"]

    # The document is cacheable: identical settings hash identically, and the
    # gate is part of that hash.
    assert build_agent_policy({"windows_self_heal_enabled": True}, DNS_PROFILE)["checksum_sha256"] == (
        opened["checksum_sha256"]
    )
    assert closed["checksum_sha256"] != opened["checksum_sha256"]

    # An operator disabling the wider self-repair block disables self-healing
    # with it, so a disabled deployment never keeps observing or repairing.
    disabled = build_agent_policy({"self_repair_enabled": False}, DNS_PROFILE)
    assert disabled["self_heal"]["enabled"] is False


def test_the_heartbeat_payload_accepts_self_heal_evidence_and_defaults_empty():
    assert nexus_agent.HeartbeatPayload().self_heal == {}
    payload = nexus_agent.HeartbeatPayload(self_heal={"state": "disconnected", "cause": "network"})
    assert payload.self_heal["state"] == "disconnected"


def test_self_heal_evidence_is_bounded_and_command_output_is_dropped():
    noise = "x" * 10_000
    evidence = nexus_agent._self_heal_evidence_update(
        {
            "state": noise,
            "cause": noise,
            "consecutive_failures": "not-a-number",
            "outage_seconds": 10**12,
            "last_success": noise,
            "outages_recovered": -5,
            "performance": {"band": noise, "score": "nan-ish", "samples": 12.7, "reasons": [noise] * 40},
            "repairs": [
                {
                    "started_at": noise,
                    "status": noise,
                    "verified": 1,
                    "reboot_required": 0,
                    "duration_seconds": 90_000,
                    "output": noise,
                }
            ]
            * 9,
            "raw_command_output": noise,
        },
        "2026-10-09T00:00:00+00:00",
    )

    assert evidence["state"] == "x" * 40
    assert evidence["cause"] == "x" * 40
    # An unparseable counter becomes zero, never an exception or a 500.
    assert evidence["consecutive_failures"] == 0
    # A reported outage is clamped to a day rather than trusted at 31 years.
    assert evidence["outage_seconds"] == 86_400_000
    assert evidence["last_success"] == "x" * 64
    assert evidence["outages_recovered"] == 0
    assert evidence["reported_at"] == "2026-10-09T00:00:00+00:00"

    performance = evidence["performance"]
    assert performance["band"] == "x" * 40
    assert performance["score"] == 0.0
    assert performance["samples"] == 12
    assert len(performance["reasons"]) == 8

    # At most five repair outcomes, and raw DISM/SFC output never reaches the
    # device record.
    assert len(evidence["repairs"]) == 5
    assert evidence["repairs"][0] == {
        "started_at": "x" * 64,
        "status": "x" * 40,
        "verified": True,
        "reboot_required": False,
        "duration_seconds": 90_000,
    }
    assert set(evidence) == {
        "state",
        "cause",
        "consecutive_failures",
        "outage_seconds",
        "last_success",
        "outages_recovered",
        "performance",
        "repairs",
        "reported_at",
    }


def test_absent_self_heal_evidence_still_produces_a_renderable_block():
    evidence = nexus_agent._self_heal_evidence_update({}, "2026-10-09T00:00:00+00:00")
    assert evidence["state"] == "unknown"
    assert evidence["cause"] == ""
    assert evidence["performance"] == {"band": "unknown", "score": 0.0, "samples": 0, "reasons": []}
    assert evidence["repairs"] == []


def test_the_ping_probe_refuses_a_missing_agent_token(monkeypatch):
    monkeypatch.setattr(nexus_agent, "db", _Db())
    with pytest.raises(HTTPException) as failure:
        asyncio.run(nexus_agent.agent_ping(x_agent_token=None, x_client_cert_fingerprint=None))
    assert failure.value.status_code in (401, 403)


def test_the_ping_probe_answers_an_enrolled_agent_without_touching_any_record(monkeypatch):
    fake_db = _Db()

    async def _verified(db, token, fingerprint):
        assert token == "agent-token"
        return {"id": "dev-1", "client_id": "cli-1"}

    monkeypatch.setattr(nexus_agent, "db", fake_db)
    monkeypatch.setattr(nexus_agent, "_verify_agent_token", _verified)

    response = asyncio.run(nexus_agent.agent_ping(x_agent_token="agent-token", x_client_cert_fingerprint=None))
    assert response["ok"] is True
    assert response["device_id"] == "dev-1"
    assert response["server_time"]

    # The probe is read-only: it must never claim, acknowledge or cancel a
    # queued command, so no collection may be written to.
    for collection in fake_db._collections.values():
        assert collection.updates == []
        assert collection.inserts == []


def test_the_agent_settings_surface_exposes_the_gate_but_defaults_it_off():
    settings = nexus_agent.NexusAgentSettings()
    assert settings.windows_self_heal_enabled is False


def test_ping_route_is_registered_on_the_agent_router():
    paths = {route.path for route in nexus_agent.router.routes}
    assert "/nexus-agent/ping" in paths
    # A probe must be safe to repeat, so it is never a mutating verb.
    methods = {
        method
        for route in nexus_agent.router.routes
        if route.path == "/nexus-agent/ping"
        for method in route.methods
    }
    assert methods == {"GET"}
