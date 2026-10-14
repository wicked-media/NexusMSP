"""The database-migration ledger, its rollback paths and the fail-closed schema gate.

Every test here is hermetic: the ledger is exercised through a small in-process
database that implements exactly the four calls the runner makes, so the
deterministic gate never needs a live MongoDB. The last group drives the real
operator CLI with that same database substituted, which is where the exit codes
the release drill depends on are pinned.
"""
import asyncio
import json
import sys
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from pymongo.errors import OperationFailure

from app.services import schema_migrations as sm

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT / "scripts"))

import nexus_migrate  # noqa: E402  (import path set above)


def run(coroutine):
    return asyncio.run(coroutine)


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, limit):
        return deepcopy(self.rows[:limit])


class Ledger:
    """The collection surface ``schema_migrations`` actually uses.

    It also stands in for ``platform_events`` when a migration's up and down
    paths are exercised, so index creation and MongoDB's "index not found"
    refusal are modelled closely enough to prove that a down path removes exactly
    what its up path created.
    """

    def __init__(self):
        self.rows = {}
        self.indexes = []
        self.index_names = set()

    def find(self, query, projection=None):
        return Cursor(list(self.rows.values()))

    async def update_one(self, query, update, upsert=False):
        key = query["id"]
        if key not in self.rows:
            if not upsert:
                return SimpleNamespace(matched_count=0)
            self.rows[key] = {"id": key}
        self.rows[key].update(deepcopy(update.get("$set", {})))
        return SimpleNamespace(matched_count=1)

    async def delete_one(self, query):
        removed = self.rows.pop(query["id"], None)
        return SimpleNamespace(deleted_count=0 if removed is None else 1)

    async def create_index(self, *args, **kwargs):
        self.indexes.append((args, kwargs))
        if kwargs.get("name"):
            self.index_names.add(kwargs["name"])

    async def drop_index(self, name):
        if name not in self.index_names:
            # The real server refuses a drop for an index that is already gone.
            raise OperationFailure(f"index not found with name [{name}]", code=27)
        self.index_names.discard(name)


class FakeDatabase:
    def __init__(self):
        self.collections = {}

    def __getitem__(self, name):
        return self.collections.setdefault(name, Ledger())

    @property
    def ledger(self):
        return self[sm.LEDGER_COLLECTION]


def migration(migration_id, log, *, reversible=True):
    async def up(database):
        log.append(f"up:{migration_id}")

    async def down(database):
        log.append(f"down:{migration_id}")

    return sm.Migration(
        id=migration_id,
        description=f"test migration {migration_id}",
        up=up,
        down=down if reversible else None,
        irreversible_reason="" if reversible else "one-way seal; restore the recovery capture instead",
    )


def three_migrations(log):
    return (
        migration("0001-first", log),
        migration("0002-second", log),
        migration("0003-third", log, reversible=False),
    )


# --------------------------------------------------------------------------- #
# The registry itself
# --------------------------------------------------------------------------- #


def test_registry_is_ordered_unique_and_declares_irreversible_work_honestly():
    ids = [item.id for item in sm.REGISTRY]
    assert ids == sorted(ids)
    assert len(set(ids)) == len(ids)
    assert sm.KNOWN_MIGRATION_IDS == tuple(ids)

    for item in sm.REGISTRY:
        if item.reversible:
            assert not item.irreversible_reason
        else:
            # A migration with no down path must say what rollback actually is.
            assert len(item.irreversible_reason) > 40


def test_the_first_migration_adopts_the_boot_backfills_rather_than_reimplementing_them():
    import inspect

    first = sm.REGISTRY[0]
    assert first.id == "0001-adopt-prelaunch-event-backfills"
    assert first.reversible is False
    # The refusal has to name the recovery path an operator must use instead.
    assert "recovery capture" in first.irreversible_reason.lower()
    assert "platform_recovery_runbook" in first.irreversible_reason.lower()

    # The adopted work must stay the platform's existing implementation: if the
    # registry ever grew its own copy of the backfill, the ledger would record
    # work different from what the API actually runs at boot.
    source = inspect.getsource(first.up)
    assert "backfill_legacy_event_metadata" in source
    assert "backfill_event_integrity" in source
    assert "app.services.event_backbone" in source


def test_the_reversible_migration_owns_exactly_the_index_its_down_path_removes():
    import inspect

    reversible = sm.migration_by_id("0002-index-platform-event-retention")
    assert reversible is not None
    assert reversible.reversible is True
    # A reversible migration must not also claim an irreversibility reason.
    assert reversible.irreversible_reason == ""

    up_source = inspect.getsource(reversible.up)
    down_source = inspect.getsource(reversible.down)
    # The pair has to name the same collection, index and key, or "down" is not
    # the inverse of what "up" did and the ledger is recording a fiction.
    for source in (up_source, down_source):
        assert "PLATFORM_EVENTS_COLLECTION" in source
        assert "RETENTION_PURGE_INDEX_NAME" in source
    assert '[("retention_until", 1)]' in up_source
    assert sm.RETENTION_PURGE_INDEX_NAME == "event_retention_until"
    assert sm.PLATFORM_EVENTS_COLLECTION == "platform_events"


def test_the_boot_index_family_does_not_own_an_index_the_ledger_must_be_able_to_remove():
    import inspect

    from app.services import event_backbone

    # If the boot path created the retention index, a recorded rollback would be
    # undone by the next API start: the ledger would report a successful down path
    # while the index it removed came straight back.
    boot_source = inspect.getsource(event_backbone.ensure_event_backbone_indexes)
    assert "retention_until" not in boot_source
    assert sm.RETENTION_PURGE_INDEX_NAME not in boot_source
    # ...and the index must stay the one the purge query actually needs.
    assert "retention_until" in inspect.getsource(event_backbone.purge_expired_events)


def test_registry_validation_rejects_unsortable_ids_and_undeclared_irreversibility():
    async def noop(database):  # pragma: no cover - never called
        return None

    with pytest.raises(sm.SchemaMigrationError):
        sm.Migration(id="not-numbered", description="d", up=noop)
    with pytest.raises(sm.SchemaMigrationError):
        sm.Migration(id="0001-x", description="   ", up=noop)
    with pytest.raises(sm.SchemaMigrationError):
        # No down path and no reason: the ledger would be unable to explain rollback.
        sm.Migration(id="0001-x", description="d", up=noop)
    with pytest.raises(sm.SchemaMigrationError):
        # A reason for an irreversible step that actually has a down path.
        sm.Migration(id="0001-x", description="d", up=noop, down=noop, irreversible_reason="because")

    with pytest.raises(sm.SchemaMigrationError):
        run(sm.apply_pending(FakeDatabase(), (migration("0002-b", []), migration("0001-a", []))))


# --------------------------------------------------------------------------- #
# Applying
# --------------------------------------------------------------------------- #


def test_apply_records_each_migration_in_order_and_is_idempotent():
    database, log = FakeDatabase(), []
    registry = three_migrations(log)

    assert run(sm.apply_pending(database, registry, applied_by="ops-1")) == [
        "0001-first",
        "0002-second",
        "0003-third",
    ]
    assert log == ["up:0001-first", "up:0002-second", "up:0003-third"]

    recorded = database.ledger.rows
    assert set(recorded) == {"0001-first", "0002-second", "0003-third"}
    assert recorded["0002-second"]["mode"] == "executed"
    assert recorded["0002-second"]["applied_by"] == "ops-1"
    assert recorded["0002-second"]["reversible"] is True
    assert recorded["0003-third"]["reversible"] is False
    assert isinstance(recorded["0001-first"]["duration_ms"], int)

    # Re-running is a no-op: the boot path and a retried change window both rely
    # on this, and a second apply must not re-run a data-shape change.
    assert run(sm.apply_pending(database, registry)) == []
    assert log == ["up:0001-first", "up:0002-second", "up:0003-third"]


def test_dry_run_reports_work_without_changing_the_ledger_or_the_data():
    database, log = FakeDatabase(), []
    registry = three_migrations(log)

    assert len(run(sm.apply_pending(database, registry, dry_run=True))) == 3
    assert log == []
    assert database.ledger.rows == {}
    assert run(sm.status(database, registry)).pending == ("0001-first", "0002-second", "0003-third")


def test_adopt_baseline_records_adopted_mode_and_refuses_a_ledger_that_already_ran():
    database, log = FakeDatabase(), []
    registry = three_migrations(log)

    assert run(sm.adopt_baseline(database, registry, applied_by="ops-1")) == [
        "0001-first",
        "0002-second",
        "0003-third",
    ]
    # Adoption executes nothing: the boot path already did this work.
    assert log == []
    assert database.ledger.rows["0001-first"]["mode"] == "adopted"
    assert run(sm.status(database, registry)).adopted == ("0001-first", "0002-second", "0003-third")

    # An executed migration must never be reclassified as adopted.
    with pytest.raises(sm.LedgerNotEmptyError):
        run(sm.adopt_baseline(database, registry))


# --------------------------------------------------------------------------- #
# Rolling back
# --------------------------------------------------------------------------- #


def test_rollback_through_leaves_the_target_applied_and_reverts_newest_first():
    database, log = FakeDatabase(), []
    registry = three_migrations(log)
    run(sm.adopt_baseline(database, registry))

    # 0003 has no down path, so rolling past it must refuse and change nothing.
    with pytest.raises(sm.IrreversibleMigration) as blocked:
        run(sm.rollback_through(database, "0001-first", registry))
    assert "0003-third" in str(blocked.value)
    assert log == []
    assert set(database.ledger.rows) == {"0001-first", "0002-second", "0003-third"}

    # With the irreversible migration out of the way, the reversible ones revert
    # newest first and the target stays applied.
    reversible = (migration("0001-first", log), migration("0002-second", log))
    relaxed = FakeDatabase()
    run(sm.apply_pending(relaxed, reversible))
    assert run(sm.rollback_through(relaxed, "0001-first", reversible)) == ["0002-second"]
    assert log == ["up:0001-first", "up:0002-second", "down:0002-second"]
    assert set(relaxed.ledger.rows) == {"0001-first"}
    assert run(sm.status(relaxed, reversible)).applied == ("0001-first",)


def test_rollback_without_a_target_empties_the_ledger():
    database, log = FakeDatabase(), []
    registry = (migration("0001-first", log), migration("0002-second", log))
    run(sm.apply_pending(database, registry))

    assert run(sm.rollback_through(database, None, registry)) == ["0002-second", "0001-first"]
    assert log[-2:] == ["down:0002-second", "down:0001-first"]
    assert database.ledger.rows == {}
    assert run(sm.status(database, registry)).pending == ("0001-first", "0002-second")


def test_rollback_rejects_a_target_that_is_not_in_this_release():
    database, log = FakeDatabase(), []
    registry = (migration("0001-first", log),)
    with pytest.raises(sm.SchemaMigrationError) as unknown:
        run(sm.rollback_through(database, "0009-invented", registry))
    assert "not a migration in this release" in str(unknown.value)


def test_the_reversible_migration_creates_and_removes_exactly_its_index():
    reversible = sm.migration_by_id("0002-index-platform-event-retention")
    database = FakeDatabase()
    events = database[sm.PLATFORM_EVENTS_COLLECTION]

    # up creates the index the retention purge needs, under the pinned name.
    run(reversible.up(database))
    assert events.index_names == {sm.RETENTION_PURGE_INDEX_NAME}
    assert events.indexes[-1][0] == ([("retention_until", 1)],)
    assert events.indexes[-1][1]["name"] == sm.RETENTION_PURGE_INDEX_NAME

    # down removes it and nothing else. That is the whole inverse.
    run(reversible.down(database))
    assert events.index_names == set()

    # Both directions are safe to repeat: an interrupted change window must not
    # strand the ledger, and a rollback of an already-removed index must not fail.
    run(reversible.up(database))
    run(reversible.up(database))
    assert events.index_names == {sm.RETENTION_PURGE_INDEX_NAME}
    run(reversible.down(database))
    run(reversible.down(database))
    assert events.index_names == set()

    # Reversing an index change must never touch a stored record.
    assert events.rows == {}


def test_the_rollback_tolerates_a_missing_index_and_never_a_real_failure():
    reversible = sm.migration_by_id("0002-index-platform-event-retention")

    class NotAuthorised(Ledger):
        async def drop_index(self, name):
            raise OperationFailure("not authorized on platform_events to execute command", code=13)

    class Database:
        def __getitem__(self, name):
            return NotAuthorised()

    # Only IndexNotFound means the inverse already holds. Anything else is a real
    # failure the ledger must not record as a completed rollback.
    with pytest.raises(OperationFailure):
        run(reversible.down(Database()))


def test_rollback_dry_run_changes_nothing():
    database, log = FakeDatabase(), []
    registry = (migration("0001-first", log), migration("0002-second", log))
    run(sm.apply_pending(database, registry))

    assert run(sm.rollback_through(database, None, registry, dry_run=True)) == ["0002-second", "0001-first"]
    assert log[-2:] == ["up:0001-first", "up:0002-second"]
    assert set(database.ledger.rows) == {"0001-first", "0002-second"}


# --------------------------------------------------------------------------- #
# The compatibility gate
# --------------------------------------------------------------------------- #


def test_a_database_ahead_of_this_release_is_incompatible_and_refuses_a_blocking_startup(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("NEXUS_TEST_ENVIRONMENT", raising=False)
    monkeypatch.delenv(sm._SCHEMA_MISMATCH_ACK_ENV, raising=False)

    database, log = FakeDatabase(), []
    registry = (migration("0001-first", log),)
    database.ledger.rows["0042-later-release"] = {
        "id": "0042-later-release",
        "description": "a migration this release does not define",
        "mode": "executed",
    }

    current = run(sm.status(database, registry))
    assert current.unknown == ("0042-later-release",)
    assert current.compatible is False

    with pytest.raises(sm.SchemaMismatchError) as mismatch:
        run(sm.assert_compatible(database, registry))
    assert "older than the data" in str(mismatch.value)
    assert "rollback" in str(mismatch.value)

    with pytest.raises(sm.SchemaNotReadyError):
        run(sm.startup_schema_gate(database, registry))


def test_an_edited_applied_migration_is_drift_and_blocks():
    database, log = FakeDatabase(), []
    registry = (migration("0001-first", log),)
    run(sm.apply_pending(database, registry))
    database.ledger.rows["0001-first"]["description"] = "the description this code no longer carries"

    current = run(sm.status(database, registry))
    assert current.drifted == ("0001-first",)
    assert current.compatible is False
    with pytest.raises(sm.SchemaMismatchError):
        run(sm.assert_compatible(database, registry))


def test_pending_migrations_are_reported_and_are_not_fatal(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("NEXUS_TEST_ENVIRONMENT", raising=False)
    monkeypatch.delenv(sm._SCHEMA_MISMATCH_ACK_ENV, raising=False)

    database, log = FakeDatabase(), []
    registry = (migration("0001-first", log),)

    current = run(sm.startup_schema_gate(database, registry))
    assert current.pending == ("0001-first",)
    assert current.compatible is True
    # assert_compatible is the *release* contract; the boot gate is the deploy one.
    assert run(sm.assert_compatible(database, registry)).pending == ("0001-first",)


def test_the_gate_blocks_production_staging_and_unknown_environments_only(monkeypatch):
    monkeypatch.delenv("NEXUS_TEST_ENVIRONMENT", raising=False)
    monkeypatch.delenv(sm._SCHEMA_MISMATCH_ACK_ENV, raising=False)

    for name in ("production", "prod", "staging"):
        monkeypatch.setenv("APP_ENV", name)
        assert sm.schema_gate_blocking() is True, name

    for name in ("development", "dev", "local", "test", "testing", ""):
        monkeypatch.setenv("APP_ENV", name)
        assert sm.schema_gate_blocking() is False, name

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv(sm._SCHEMA_MISMATCH_ACK_ENV, "1")
    assert sm.schema_gate_blocking() is False

    monkeypatch.delenv(sm._SCHEMA_MISMATCH_ACK_ENV, raising=False)
    monkeypatch.setenv("NEXUS_TEST_ENVIRONMENT", "1")
    assert sm.schema_gate_blocking() is False


def test_an_unreadable_ledger_is_treated_as_unmigrated_rather_than_fatal():
    class BrokenDatabase:
        def __getitem__(self, name):
            raise RuntimeError("mongo is unreachable")

    assert run(sm.read_ledger(BrokenDatabase())) == {}
    assert run(sm.status(BrokenDatabase(), ())).compatible is True


def test_the_status_payload_is_json_safe_for_the_drill_evidence():
    database, log = FakeDatabase(), []
    registry = three_migrations(log)
    run(sm.apply_pending(database, registry))

    payload = run(sm.status(database, registry)).as_dict()
    assert json.loads(json.dumps(payload)) == {
        "applied": ["0001-first", "0002-second", "0003-third"],
        "adopted": [],
        "pending": [],
        "unknown": [],
        "drifted": [],
        "compatible": True,
    }


# --------------------------------------------------------------------------- #
# The operator CLI
# --------------------------------------------------------------------------- #


@pytest.fixture
def cli_database(monkeypatch):
    from app import database as database_module

    fake = FakeDatabase()
    monkeypatch.setattr(database_module, "db", fake)
    monkeypatch.delenv(sm._SCHEMA_MISMATCH_ACK_ENV, raising=False)
    return fake


def test_cli_exit_codes_are_the_documented_values():
    # The runbooks and the change window both gate on these numbers, so they are
    # pinned as literals rather than only compared against the constants.
    assert nexus_migrate.EXIT_OK == 0
    assert nexus_migrate.EXIT_REFUSED == 1
    assert nexus_migrate.EXIT_USAGE == 2


def test_cli_status_is_read_only_and_exits_zero_for_a_compatible_database(cli_database, capsys):
    assert nexus_migrate.main(["--status", "--json"]) == nexus_migrate.EXIT_OK
    payload = json.loads(capsys.readouterr().out)
    assert payload["status"]["pending"] == list(sm.KNOWN_MIGRATION_IDS)
    assert payload["status"]["compatible"] is True
    assert cli_database.ledger.rows == {}


def test_cli_refuses_a_database_it_cannot_reason_about_with_exit_code_one(cli_database, capsys):
    cli_database.ledger.rows["0042-later-release"] = {
        "id": "0042-later-release",
        "description": "later",
        "mode": "executed",
    }
    assert nexus_migrate.main(["--status"]) == nexus_migrate.EXIT_REFUSED
    assert "REFUSED" in capsys.readouterr().err


def _seed_recorded_registry(cli_database) -> dict:
    """Record the registry as executed, without running it.

    The registry's first migration adopts the boot backfills, which are not
    executed against a fake database. These tests are about the CLI's rollback
    behaviour against the ledger a migrated database already holds.
    """
    for migration_ in sm.REGISTRY:
        cli_database.ledger.rows[migration_.id] = {
            "id": migration_.id,
            "description": migration_.description,
            "mode": "executed",
        }
    return dict(cli_database.ledger.rows)


def test_cli_rolls_the_reversible_migration_back_and_keeps_the_irreversible_one(cli_database, capsys):
    _seed_recorded_registry(cli_database)
    # Model the database effect the reversible migration left behind, so the test
    # proves the CLI's rollback removed it rather than passing on an empty index.
    events = cli_database[sm.PLATFORM_EVENTS_COLLECTION]
    events.index_names.add(sm.RETENTION_PURGE_INDEX_NAME)

    # Rolling back to the oldest recorded migration reverts everything after it,
    # which is now the reversible one, through its real down path.
    assert nexus_migrate.main(["--rollback-to", sm.KNOWN_MIGRATION_IDS[0]]) == nexus_migrate.EXIT_OK
    capsys.readouterr()

    assert events.index_names == set()
    assert set(cli_database.ledger.rows) == {sm.KNOWN_MIGRATION_IDS[0]}
    # The irreversible migration stays recorded: nothing here describes its seal
    # as reversed, and the reversible migration is unapplied again.
    current = run(sm.status(cli_database))
    assert current.applied == (sm.KNOWN_MIGRATION_IDS[0],)
    assert current.pending == (sm.KNOWN_MIGRATION_IDS[1],)
    assert current.compatible is True


def test_cli_reports_an_irreversible_rollback_as_a_refusal_and_changes_nothing(cli_database, capsys):
    applied = _seed_recorded_registry(cli_database)
    events = cli_database[sm.PLATFORM_EVENTS_COLLECTION]
    events.index_names.add(sm.RETENTION_PURGE_INDEX_NAME)

    # The registry now holds a reversible migration, but clearing the whole ledger
    # still crosses the irreversible one, so the documented rollback is the
    # recovery-capture restore and the CLI must say so rather than revert part of
    # the registry and stop.
    assert nexus_migrate.main(["--rollback-all"]) == nexus_migrate.EXIT_REFUSED
    captured = capsys.readouterr()
    assert "REFUSED" in captured.err
    assert "recovery capture" in captured.err
    # The refusal must report the ledger as it really is. An operator reading this
    # mid-incident must not conclude that a refused rollback emptied the database.
    assert f"applied:  {sm.KNOWN_MIGRATION_IDS[0]}" in captured.out
    assert "compatible: True" in captured.out
    assert "applied:  (none)" not in captured.out
    assert cli_database.ledger.rows == applied
    # A refused rollback must not have run the reversible migration's down path
    # either: it changes nothing at all.
    assert events.index_names == {sm.RETENTION_PURGE_INDEX_NAME}

    # --dry-run cannot be talked into reporting a rollback it must refuse.
    assert nexus_migrate.main(["--rollback-all", "--dry-run"]) == nexus_migrate.EXIT_REFUSED
    assert cli_database.ledger.rows == applied
    assert events.index_names == {sm.RETENTION_PURGE_INDEX_NAME}


def test_cli_adopt_baseline_is_the_only_path_that_earns_rows_without_executing(cli_database, capsys):
    assert nexus_migrate.main(["--adopt-baseline", "--actor", "ops-1"]) == nexus_migrate.EXIT_OK
    assert set(cli_database.ledger.rows) == set(sm.KNOWN_MIGRATION_IDS)
    assert {row["mode"] for row in cli_database.ledger.rows.values()} == {"adopted"}
    # A second adoption must refuse rather than overwrite real history.
    assert nexus_migrate.main(["--adopt-baseline"]) == nexus_migrate.EXIT_REFUSED
    assert "REFUSED" in capsys.readouterr().err


def test_cli_dry_run_and_missing_environment_are_reported_without_side_effects(cli_database, capsys):
    assert nexus_migrate.main(["--apply", "--dry-run", "--json"]) == nexus_migrate.EXIT_OK
    assert cli_database.ledger.rows == {}
    assert json.loads(capsys.readouterr().out)["dry_run"] is True

    with pytest.raises(SystemExit) as usage:
        nexus_migrate.main([])
    assert usage.value.code == nexus_migrate.EXIT_USAGE
