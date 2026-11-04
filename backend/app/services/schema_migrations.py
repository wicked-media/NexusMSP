"""Versioned database migrations and the fail-closed schema gate.

Why this exists
---------------

Nexus stores its operational records in MongoDB, so no release has ever needed a
schema DDL script — and that is exactly why the platform had no migration
ledger until now.  Data-shape changes were applied by unversioned functions that
the API called on *every* boot (``backfill_legacy_event_metadata``,
``backfill_event_integrity``, the ``ensure_*_indexes`` family).  Three properties
were missing, and each one is a data-corruption risk for a paying tenant:

1. **No record.**  Nothing recorded which data-shape changes a given database
   had already received, so no one could answer "can this database serve this
   release?" before rolling images.
2. **No order.**  Backfills ran in whatever order ``_boot_warmup`` reached them,
   each limited, retried on the next boot, and reported only through a log line.
3. **No failure.**  Every one of those blocks was wrapped in
   ``except Exception: logger.error(...)``, so a half-applied migration produced
   a running API and a successful readiness probe.

The missing piece for release safety is therefore not a schema tool.  It is the
*ledger*: an explicit, ordered, recorded set of migrations, plus a gate that
refuses to let a release run against a database it cannot reason about.

The property the rollback gate depends on
-----------------------------------------

``scripts/Deploy-NexusImageTag.ps1`` rolls images back to a previous immutable
tag.  Without this module, an older image could start against a database that a
newer release had already migrated forward, silently reading a shape it does not
understand.  ``assert_compatible`` makes that case a refusal:

- **unknown** — the database records a migration this code does not define.
  The code is older than the data.  Blocking.
- **drifted** — a recorded migration's description no longer matches this code,
  i.e. an already-applied migration was edited.  Blocking.
- **pending** — this code defines a migration the database has not recorded.
  Reported, and logged, but not fatal: that is the normal forward-deploy state
  before the operator runs ``backend/scripts/nexus_migrate.py --apply``.

Reversible and irreversible migrations
-------------------------------------

A migration declares a ``down`` path when its change can be undone exactly, and
must state a reason when it cannot.  ``0001-adopt-prelaunch-event-backfills`` is
irreversible: it adopts a one-way integrity seal.  ``0002-index-platform-event-
retention`` is the first reversible one, and it is deliberately the smallest kind
of data-shape change that still matters — an index.

Index ownership is the part to get right.  ``app/services/event_backbone.py``
creates the rest of ``platform_events``' indexes on every boot through
``ensure_event_backbone_indexes``, and an index declared there could not be
rolled back: the next API start would recreate it and the ledger would be
recording a down path that does not hold.  The retention index is therefore
created *only* by this ledger, and a deterministic test fails if the boot family
ever starts recreating a ledger-owned index.

Ownership decision (recorded in ``docs/DATA_OWNERSHIP.md``): the
``schema_migrations`` collection is owned by the Release/platform boundary, is
written only by the migration runner and the startup gate, is never
tenant-scoped (it describes the database, not a customer), and contains no
customer data and no secrets.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Awaitable, Callable, Sequence

from pymongo.errors import OperationFailure

from app.services.runtime_config import acceptance_environment_enabled, environment

logger = logging.getLogger("nexus.schema")

LEDGER_COLLECTION = "schema_migrations"
_MIGRATION_ID_PATTERN = re.compile(r"^\d{4}-[a-z0-9][a-z0-9-]*$")

# The collection whose retention purge this ledger indexes, and the index name
# the operator surfaces pin.  They are exported so the migration, the drill and
# the tests cannot disagree about which index a rollback has to remove.
PLATFORM_EVENTS_COLLECTION = "platform_events"
RETENTION_PURGE_INDEX_NAME = "event_retention_until"

# MongoDB's IndexNotFound code, returned when a drop targets an index that is
# already gone.  That state satisfies the inverse rather than failing it.
_INDEX_NOT_FOUND = 27

# A runtime that must not be allowed to serve a database it cannot reason about.
# Development, test, CI and the disposable acceptance stack report the same
# state without refusing, so a developer or a test run is never blocked by a
# migration that has not been applied locally yet.
_NON_BLOCKING_ENVIRONMENTS = frozenset({"", "dev", "development", "local", "test", "testing"})

# Break-glass acknowledgement, deliberately explicit and named in the runbook.
# A recovery-capture restore can legitimately land a newer ledger against older
# code; every use is logged as a warning.
_SCHEMA_MISMATCH_ACK_ENV = "NEXUS_ALLOW_SCHEMA_MISMATCH"


class SchemaMigrationError(Exception):
    """Base class for migration-ledger failures."""


class SchemaMismatchError(SchemaMigrationError):
    """The database's recorded migrations cannot be served by this code."""


class SchemaNotReadyError(SchemaMigrationError):
    """A blocking runtime was asked to start against an incompatible database."""


class IrreversibleMigration(SchemaMigrationError):
    """A required rollback step has no down path and must not be faked."""


class LedgerNotEmptyError(SchemaMigrationError):
    """Baseline adoption was requested for a database that already has rows."""


MigrationCallable = Callable[[object], Awaitable[None]]


@dataclass(frozen=True)
class Migration:
    """One ordered, recorded data-shape change.

    ``down`` is ``None`` for a migration that genuinely cannot be reversed — for
    example a one-way integrity seal over existing evidence.  Declaring that
    honestly is required: :func:`rollback_through` refuses to roll back through
    an irreversible migration instead of pretending the data came back.
    """

    id: str
    description: str
    up: MigrationCallable
    down: MigrationCallable | None = None
    irreversible_reason: str = ""

    @property
    def reversible(self) -> bool:
        return self.down is not None

    def __post_init__(self) -> None:
        if not _MIGRATION_ID_PATTERN.match(self.id):
            raise SchemaMigrationError(
                f"Migration id {self.id!r} must be '<4 digits>-<kebab-case name>' so the ledger keeps a total order."
            )
        if not str(self.description or "").strip():
            raise SchemaMigrationError(f"Migration {self.id} needs a description: it is the drift-detection key.")
        if self.reversible and self.irreversible_reason:
            raise SchemaMigrationError(
                f"Migration {self.id} declares a down path and an irreversibility reason; pick one."
            )
        if not self.reversible and not self.irreversible_reason:
            raise SchemaMigrationError(
                f"Migration {self.id} has no down path, so it must state why rollback requires a restore."
            )


@dataclass(frozen=True)
class MigrationStatus:
    """The ledger's view of one database against one code revision."""

    applied: tuple[str, ...] = field(default_factory=tuple)
    adopted: tuple[str, ...] = field(default_factory=tuple)
    pending: tuple[str, ...] = field(default_factory=tuple)
    unknown: tuple[str, ...] = field(default_factory=tuple)
    drifted: tuple[str, ...] = field(default_factory=tuple)

    @property
    def compatible(self) -> bool:
        """Whether this code may serve the database at all."""
        return not self.unknown and not self.drifted

    def as_dict(self) -> dict:
        return {
            "applied": list(self.applied),
            "adopted": list(self.adopted),
            "pending": list(self.pending),
            "unknown": list(self.unknown),
            "drifted": list(self.drifted),
            "compatible": self.compatible,
        }


# --------------------------------------------------------------------------- #
# The registry
# --------------------------------------------------------------------------- #


async def _adopt_legacy_event_backfills(database) -> None:
    """Run the platform-event backfills that predate this ledger.

    These two functions already run on every boot; calling them from the ledger
    does not duplicate logic, it gives the work an id, an order and a record.
    Both are idempotent — the metadata backfill only matches envelopes missing
    their fields and the integrity seal refuses to rewrite an existing seal.
    """
    from app.services.event_backbone import backfill_event_integrity, backfill_legacy_event_metadata

    await backfill_legacy_event_metadata()
    await backfill_event_integrity()


async def _index_platform_event_retention(database) -> None:
    """Give the platform-event retention purge an index instead of a scan.

    ``purge_expired_events`` runs from the API's retention loop every six hours
    and selects every event whose ``retention_until`` has passed, sorted by that
    same field, over the platform's fastest-growing collection.  The boot-time
    ``ensure_event_backbone_indexes`` family covers five other access paths on
    ``platform_events`` and never covered this one, so the purge has been a
    collection scan plus an in-memory sort since the event backbone shipped.

    Creating an index that already exists with the same key and name is a no-op,
    so a re-applied or interrupted run is safe.
    """
    await database[PLATFORM_EVENTS_COLLECTION].create_index(
        [("retention_until", 1)],
        name=RETENTION_PURGE_INDEX_NAME,
    )


async def _drop_platform_event_retention_index(database) -> None:
    """Undo :func:`_index_platform_event_retention` exactly.

    Dropping an index cannot lose a record or change a stored value, which is
    what makes this migration's rollback a command rather than a restore
    decision.  A missing index already satisfies the inverse, so an interrupted
    rollback can be re-run instead of stranding the ledger.
    """
    collection = database[PLATFORM_EVENTS_COLLECTION]
    try:
        await collection.drop_index(RETENTION_PURGE_INDEX_NAME)
    except OperationFailure as exc:
        if getattr(exc, "code", None) != _INDEX_NOT_FOUND:
            raise
        logger.info(
            "Rollback found %s already absent on %s; the inverse is satisfied.",
            RETENTION_PURGE_INDEX_NAME,
            PLATFORM_EVENTS_COLLECTION,
        )


REGISTRY: tuple[Migration, ...] = (
    Migration(
        id="0001-adopt-prelaunch-event-backfills",
        description=(
            "Adopt the pre-ledger platform-event metadata and integrity backfills "
            "that Nexus applied on every boot before this ledger existed."
        ),
        up=_adopt_legacy_event_backfills,
        down=None,
        irreversible_reason=(
            "The backfill adds ordering/retention metadata and seals each event into the "
            "Black Box integrity chain. A seal is one-way evidence: rewriting or removing it "
            "would falsify the chain rather than reverse the change. Reverse it by restoring "
            "the pre-migration recovery capture (docs/PLATFORM_RECOVERY_RUNBOOK.md)."
        ),
    ),
    Migration(
        id="0002-index-platform-event-retention",
        description=(
            "Index platform_events.retention_until so the six-hourly retention purge stops "
            "scanning the collection it deletes from."
        ),
        up=_index_platform_event_retention,
        down=_drop_platform_event_retention_index,
    ),
)


def _validate_registry(registry: Sequence[Migration]) -> tuple[Migration, ...]:
    ids = [migration.id for migration in registry]
    if len(set(ids)) != len(ids):
        raise SchemaMigrationError("Two migrations share an id; the ledger cannot order them.")
    if ids != sorted(ids):
        raise SchemaMigrationError("The migration registry must be declared in ascending id order.")
    return tuple(registry)


_REGISTRY = _validate_registry(REGISTRY)
KNOWN_MIGRATION_IDS: tuple[str, ...] = tuple(migration.id for migration in _REGISTRY)


def migration_by_id(migration_id: str, registry: Sequence[Migration] | None = None) -> Migration | None:
    for migration in registry if registry is not None else _REGISTRY:
        if migration.id == migration_id:
            return migration
    return None


# --------------------------------------------------------------------------- #
# Ledger access
# --------------------------------------------------------------------------- #


def _ledger(database):
    return database[LEDGER_COLLECTION]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_actor() -> str:
    return str(os.environ.get("NEXUS_MIGRATION_ACTOR") or "nexus-api").strip()


def _resolve_registry(registry: Sequence[Migration] | None) -> tuple[Migration, ...]:
    return _REGISTRY if registry is None else _validate_registry(registry)


async def read_ledger(database) -> dict[str, dict]:
    """Return recorded migrations keyed by id, ignoring an unreadable ledger.

    A database that has never been migrated simply has no collection; that is a
    normal state, not an error.
    """
    try:
        records = await _ledger(database).find({}, {"_id": 0}).to_list(1000)
    except Exception as exc:  # pragma: no cover - driver/network failure path
        logger.error("Reading the migration ledger failed: %s", exc)
        return {}
    return {str(record.get("id")): record for record in records if record.get("id")}


async def status(database, registry: Sequence[Migration] | None = None) -> MigrationStatus:
    """Compare one database's ledger with one code revision's registry."""
    expected = _resolve_registry(registry)
    records = await read_ledger(database)

    by_id = {migration.id: migration for migration in expected}
    applied: list[str] = []
    adopted: list[str] = []
    drifted: list[str] = []
    for migration in expected:
        record = records.get(migration.id)
        if record is None:
            continue
        if record.get("mode") == "adopted":
            adopted.append(migration.id)
        else:
            applied.append(migration.id)
        if str(record.get("description") or "") != migration.description:
            drifted.append(migration.id)

    unknown = sorted(migration_id for migration_id in records if migration_id not in by_id)
    pending = [migration.id for migration in expected if migration.id not in records]
    return MigrationStatus(
        applied=tuple(applied),
        adopted=tuple(adopted),
        pending=tuple(pending),
        unknown=tuple(unknown),
        drifted=tuple(drifted),
    )


def _mismatch_message(current: MigrationStatus) -> str:
    parts: list[str] = []
    if current.unknown:
        parts.append(
            "the database records migrations this release does not define "
            f"({', '.join(current.unknown)}), so the running code is older than the data"
        )
    if current.drifted:
        parts.append(
            "already-applied migrations were edited in this release "
            f"({', '.join(current.drifted)}), so the ledger can no longer certify them"
        )
    return (
        "Nexus refused to run against an incompatible database: "
        + "; ".join(parts)
        + ". Run 'python backend/scripts/nexus_migrate.py --status' for the ledger view. "
        "If images were rolled back, run the newer release's migration rollback first "
        "(docs/RELEASE_RUNBOOK.md, 'Rolling a database migration back'). "
        f"A deliberate recovery-capture mismatch can be acknowledged with {_SCHEMA_MISMATCH_ACK_ENV}=1, "
        "which logs a warning and proceeds."
    )


async def assert_compatible(database, registry: Sequence[Migration] | None = None) -> MigrationStatus:
    """Return the ledger status, raising :class:`SchemaMismatchError` when unsafe."""
    current = await status(database, registry)
    if not current.compatible:
        raise SchemaMismatchError(_mismatch_message(current))
    return current


def schema_gate_blocking() -> bool:
    """Whether this runtime must refuse to serve an incompatible database."""
    if str(os.environ.get(_SCHEMA_MISMATCH_ACK_ENV) or "").strip().lower() in {"1", "true", "yes", "on"}:
        logger.warning(
            "%s is set: the schema gate will report an incompatible database and continue.",
            _SCHEMA_MISMATCH_ACK_ENV,
        )
        return False
    if acceptance_environment_enabled():
        return False
    return environment() not in _NON_BLOCKING_ENVIRONMENTS


async def startup_schema_gate(database, registry: Sequence[Migration] | None = None) -> MigrationStatus:
    """The boot gate: report pending work, refuse a database we cannot reason about.

    ``pending`` is deliberately not fatal.  A release that adds a migration is
    expected to have that migration applied by ``nexus_migrate.py --apply``
    during the change window; until then the previous release is still serving.
    ``unknown`` and ``drifted`` mean the code and the data have diverged, and
    that is where silent corruption would begin.
    """
    current = await status(database, registry)
    if current.pending:
        logger.warning(
            "Schema ledger has %s unapplied migration(s): %s. Apply them with "
            "'python backend/scripts/nexus_migrate.py --apply' before accepting the release.",
            len(current.pending),
            ", ".join(current.pending),
        )
    if current.compatible:
        return current

    message = _mismatch_message(current)
    if schema_gate_blocking():
        raise SchemaNotReadyError(message)
    logger.error("%s (this runtime only reports; it is not a blocking environment)", message)
    return current


# --------------------------------------------------------------------------- #
# Running migrations
# --------------------------------------------------------------------------- #


def _record(
    migration: Migration,
    *,
    mode: str,
    actor: str,
    duration_ms: int,
) -> dict:
    return {
        "id": migration.id,
        "description": migration.description,
        "mode": mode,
        "reversible": migration.reversible,
        "irreversible_reason": migration.irreversible_reason,
        "applied_at": _utc_now(),
        "applied_by": actor,
        "duration_ms": duration_ms,
    }


async def apply_pending(
    database,
    registry: Sequence[Migration] | None = None,
    *,
    applied_by: str | None = None,
    dry_run: bool = False,
) -> list[str]:
    """Apply every unrecorded migration in id order and record each one.

    Recording happens immediately after each migration so an interrupted run
    leaves an accurate ledger rather than reporting work that did not finish.
    """
    expected = _resolve_registry(registry)
    actor = (applied_by or _default_actor()).strip()
    records = await read_ledger(database)

    applied: list[str] = []
    for migration in expected:
        if migration.id in records:
            continue
        applied.append(migration.id)
        if dry_run:
            continue
        started = datetime.now(timezone.utc)
        await migration.up(database)
        duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
        await _ledger(database).update_one(
            {"id": migration.id},
            {"$set": _record(migration, mode="executed", actor=actor, duration_ms=duration_ms)},
            upsert=True,
        )
        logger.info("Applied migration %s (%s ms)", migration.id, duration_ms)
    return applied


async def rollback_through(
    database,
    target_id: str | None = None,    registry: Sequence[Migration] | None = None,
    *,
    dry_run: bool = False,
) -> list[str]:
    """Roll recorded migrations back, newest first, down to ``target_id``.

    ``target_id`` is the migration that must remain applied; ``None`` rolls the
    ledger back to empty.  A migration with no down path stops the rollback with
    :class:`IrreversibleMigration` *before* anything is changed, so a partial
    rollback cannot leave the database half-reverted by accident.

    A rollback leaves no ledger row: what a database has applied is the ledger,
    and the rollback's own record is the operator's retained evidence plus the
    API log line.
    """
    expected = _resolve_registry(registry)
    records = await read_ledger(database)

    if target_id is not None:
        known_ids = {migration.id for migration in expected}
        if target_id not in known_ids:
            raise SchemaMigrationError(
                f"{target_id} is not a migration in this release; pass an id from '--status'."
            )

    recorded_order = [migration.id for migration in expected if migration.id in records]
    if target_id is None:
        to_roll_back = list(reversed(recorded_order))
    else:
        to_roll_back = list(reversed([migration_id for migration_id in recorded_order if migration_id > target_id]))

    irreversible = [
        migration_id
        for migration_id in to_roll_back
        if (migration := migration_by_id(migration_id, expected)) is not None and not migration.reversible
    ]
    if irreversible:
        blocker = migration_by_id(irreversible[0], expected)
        raise IrreversibleMigration(
            f"Migration {blocker.id} cannot be rolled back: {blocker.irreversible_reason} "
            f"Rollback stopped before changing anything; the ledger still records {', '.join(recorded_order)}."
        )

    rolled: list[str] = []
    for migration_id in to_roll_back:
        migration = migration_by_id(migration_id, expected)
        if migration is None or migration.down is None:
            continue
        rolled.append(migration_id)
        if dry_run:
            continue
        await migration.down(database)
        await _ledger(database).delete_one({"id": migration_id})
        logger.info("Rolled back migration %s", migration_id)
    return rolled


async def adopt_baseline(
    database,
    registry: Sequence[Migration] | None = None,
    *,
    applied_by: str | None = None,
    dry_run: bool = False,
) -> list[str]:
    """Record the registry as already satisfied, without running it.

    An existing Nexus database already received the pre-ledger backfills from
    ``_boot_warmup``, so executing them again to earn a ledger row would be busy
    work.  Adoption records that honestly: ``mode`` is ``adopted``, not
    ``executed``, and it refuses a ledger that already has rows so that an
    executed migration cannot be reclassified.
    """
    expected = _resolve_registry(registry)
    actor = (applied_by or _default_actor()).strip()
    records = await read_ledger(database)
    if records:
        raise LedgerNotEmptyError(
            "This database already has a migration ledger "
            f"({', '.join(sorted(records))}); baseline adoption is only for a pre-ledger database."
        )

    adopted = [migration.id for migration in expected]
    if dry_run:
        return adopted
    for migration in expected:
        await _ledger(database).update_one(
            {"id": migration.id},
            {"$set": _record(migration, mode="adopted", actor=actor, duration_ms=0)},
            upsert=True,
        )
    if adopted:
        logger.info("Adopted %s migration(s) as already satisfied by this database", len(adopted))
    return adopted


async def ensure_ledger_indexes(database) -> None:
    """Keep the ledger itself cheap to read on every readiness probe."""
    await _ledger(database).create_index("id", unique=True, name="schema_migration_id_unique")


__all__ = [
    "IrreversibleMigration",
    "KNOWN_MIGRATION_IDS",
    "LEDGER_COLLECTION",
    "PLATFORM_EVENTS_COLLECTION",
    "RETENTION_PURGE_INDEX_NAME",
    "LedgerNotEmptyError",
    "Migration",
    "MigrationStatus",
    "REGISTRY",
    "SchemaMigrationError",
    "SchemaMismatchError",
    "SchemaNotReadyError",
    "adopt_baseline",
    "apply_pending",
    "assert_compatible",
    "ensure_ledger_indexes",
    "migration_by_id",
    "read_ledger",
    "rollback_through",
    "schema_gate_blocking",
    "startup_schema_gate",
    "status",
]
