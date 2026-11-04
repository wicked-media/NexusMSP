"""Conformance guards for the database-migration ledger and its rehearsal.

The rehearsal (`scripts/Test-NexusMigrationRollback.ps1`) needs a Docker host and
PowerShell, so it cannot execute here, exactly like the recovery and
application-rollback drills. What *is* deterministic is the contract around it:
the drill must drive the real shipped CLI rather than re-implement migration
logic, it must read the ledger from the database rather than from CLI output, it
must require the refusal in every place production depends on, it must disclose
that the newer release's ledger row is written rather than built, and the
runbooks and checklist must not describe the gate as closed while no
deployment-host run exists.

These are drift guards, not a substitute for the rehearsal. A passing run here
proves the tooling and the documentation still agree; it does not prove migration
rollback works on a host.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
DRILL_PATH = SCRIPTS / "Test-NexusMigrationRollback.ps1"
CLI_PATH = ROOT / "backend" / "scripts" / "nexus_migrate.py"
SERVICE_PATH = ROOT / "backend" / "app" / "services" / "schema_migrations.py"
DOCKERFILE_PATH = ROOT / "backend" / "Dockerfile.production"
RUNBOOK_PATH = ROOT / "docs" / "RELEASE_RUNBOOK.md"
READINESS_PATH = ROOT / "docs" / "PRODUCTION_READINESS.md"
CHECKLIST_PATH = ROOT / "docs" / "NEXUS_PRODUCTION_READINESS_CHECKLIST.md"
OWNERSHIP_PATH = ROOT / "docs" / "DATA_OWNERSHIP.md"


def _drill() -> str:
    return DRILL_PATH.read_text(encoding="utf-8")


def _flat(path: Path) -> str:
    """Prose is wrapped in markdown and in PowerShell comments; assert on the
    prose, not on where a line happened to break."""
    return re.sub(r"\s+", " ", path.read_text(encoding="utf-8"))


def _flat_drill_prose() -> str:
    """The drill's disclosures live in comments, so drop the comment leaders
    before flattening or a wrapped sentence keeps its ``#`` between words."""
    text = re.sub(r"(?m)^\s*#\s?", "", DRILL_PATH.read_text(encoding="utf-8"))
    return re.sub(r"\s+", " ", text)


def test_the_drill_exists_and_rehearses_the_shipped_cli_inside_the_image():
    assert DRILL_PATH.is_file()
    assert CLI_PATH.is_file()

    drill = _drill()

    # The rehearsal is worthless if it reimplements the migration path: the point
    # is that the shipped operator interface is what gets exercised.
    assert "cd /app && python scripts/nexus_migrate.py" in drill
    assert 'echo "CLI_EXIT=$?"' in drill
    for argument in (
        "--status --json",
        "--apply --actor migration-drill",
        "--status",
        "--rollback-to",
        "--rollback-all",
        "--rollback-all --dry-run",
    ):
        assert argument in drill, f"the drill no longer exercises '{argument}'"

    # It must refuse to run without the CLI it is proving.
    assert "The migration ledger CLI (backend/scripts/nexus_migrate.py) was not found." in drill

    # And the CLI must actually be in the image it migrates, or a change window
    # would need a host checkout again.
    dockerfile = DOCKERFILE_PATH.read_text(encoding="utf-8")
    assert "COPY --chown=nexus:nexus backend/scripts/nexus_migrate.py ./scripts/nexus_migrate.py" in dockerfile


def test_the_drill_reads_the_ledger_from_the_database_not_from_cli_output():
    drill = _drill()

    # CLI output is a display surface; the ledger row ids are the cross-release
    # contract, so the drill has to read them out of MongoDB itself.
    assert "schema_migrations.find" in drill
    # The database-side script must emit the marker the parser then expects.
    assert "print('LEDGER_ID=' + row.id);" in drill
    assert "-like 'LEDGER_ID=*'" in drill
    assert "$ledgerAfterApply -contains $knownMigrationId" in drill
    assert "$ledgerBeforeRefusal" in drill


def test_the_drill_requires_the_refusal_in_every_place_production_uses():
    drill = _drill()

    # 1. the CLI exit code, 2. readiness, 3. the API's own startup.
    assert "cli_refused_database_ahead" in drill
    assert "($status.exit_code -eq 1)" in drill
    assert "readiness_refused_database_ahead" in drill
    assert "-eq 503" in drill
    assert "startup_refused_database_ahead" in drill
    assert "refused to run against an incompatible database" in drill
    assert "'nexus_migrate\\.py --status'" in drill

    # The irreversible refusal must name the recovery path instead of pretending.
    assert "irreversible_rollback_refused_and_named_the_path" in drill
    assert "PLATFORM_RECOVERY_RUNBOOK" in drill
    assert "refused_rollback_changed_nothing" in drill

    # Applying is real, and so is the recovery afterwards.
    assert "migration_applied_by_cli" in drill
    assert "service_recovered_after_ledger_restored" in drill
    assert "seeded_data_survived_the_migration" in drill


def test_the_drill_is_disposable_and_never_touches_a_deployment():
    drill = _drill()

    assert '"nexus-migration-drill-$runId"' in drill
    assert "nexus-migration-drill-" in drill
    # Every Compose variable the production file requires is generated in process
    # for the disposable project instead of being read from the host.
    for variable in (
        "MONGO_USERNAME",
        "MONGO_PASSWORD",
        "JWT_SECRET",
        "NEXUS_SECRET_ENCRYPTION_KEY",
        "NEXUS_DMARC_RECEIVER_TOKEN",
        "NEXUS_OBSERVABILITY_INGEST_TOKEN",
    ):
        assert variable in drill
    assert "RandomNumberGenerator" in drill
    # No host environment file may be sourced to obtain anything.
    assert ".env" not in drill
    assert "dotenv" not in drill

    # Fail closed before doing anything, and always clean up.
    assert "Get-Command docker" in drill
    assert "Docker Compose v2 (docker compose) is required" in drill
    assert "down --volumes --remove-orphans" in drill

    # Evidence is retained in the documented location.
    assert "release-drills" in drill
    assert "migration-drill-{0}-{1}.json" in drill


def test_the_drill_rehearses_a_real_rollback_of_the_reversible_migration():
    drill = _drill()

    # Both migration ids and the migration's whole database effect are pinned by
    # literal, so a rename in the registry fails the drill instead of quietly
    # rehearsing a different migration.
    assert "$knownMigrationId = '0001-adopt-prelaunch-event-backfills'" in drill
    assert "$reversibleMigrationId = '0002-index-platform-event-retention'" in drill
    assert "$reversibleIndexName = 'event_retention_until'" in drill

    # The rollback is the shipped CLI's, and it targets the migration that must
    # stay applied, so the rehearsal cannot cross the irreversible seal.
    assert '"--rollback-to {0}" -f $knownMigrationId' in drill

    # The migration's effect and its reversal are read from MongoDB, and the
    # "unapplied again" half is read from the CLI's own status payload. Neither is
    # taken from the rollback's report of what it did.
    assert "getIndexes().forEach(function (index) {{ print('INDEX_NAME=' + index.name); }})" in drill
    assert "-contains $reversibleIndexName" in drill
    assert "$payload.status.pending" in drill
    assert "NOTICE:" in drill

    for key in (
        "reversible_migration_effect_observed",
        "reversible_migration_rolled_back_by_cli",
        "rolled_back_effect_reverted",
        "rolled_back_migration_is_pending_again",
        "rolled_back_migration_reapplied_cleanly",
    ):
        assert key in drill, key

    # Every check above must be able to fail the drill rather than only be
    # recorded, and re-applying is part of the rehearsal: a change window that
    # rolls back and then forward again must not be left half-applied.
    for guard in (
        "did not produce the index",
        "did not roll the reversible migration back",
        "payload could not be read after the reversible rollback",
        "did not restore both its ledger row and its index",
    ):
        assert guard in drill, guard

    # The rollback is timed like the apply, so a slow reversal is visible in the
    # retained evidence instead of only in a log line.
    assert "$evidence.reversible_migration_rollback = [ordered]@{" in drill
    assert "duration_seconds = [math]::Round(($reversibleRollbackEnded - $reversibleRollbackStarted).TotalSeconds, 1)" in drill
    assert "reversible_migration_id = $reversibleMigrationId" in drill


def test_the_drill_discloses_what_a_reversible_migration_does_and_does_not_prove():
    drill = _drill()
    prose = _flat_drill_prose()

    # A reader must not infer that a customer-data migration was rolled back.
    assert "rehearses its rollback for real" in prose
    assert "A reversible migration that *transforms* customer data does not exist yet" in prose
    assert "its down path restores the previous index set and cannot lose a record" in prose
    # The irreversible half stays disclosed as a refusal, not as a reversal, and
    # the prose claim is tied to the check that actually makes it.
    assert "refuses to roll through it and names that path" in prose
    assert "irreversible_rollback_refused_and_named_the_path" in drill
    assert "backend/tests/test_schema_migrations.py" in prose


def test_the_drill_discloses_that_the_newer_release_is_written_rather_than_built():
    drill = _drill()
    prose = _flat_drill_prose()

    # A reader must not infer that a second patched release was built.
    assert "newer_release_simulation = [ordered]@{" in drill
    assert "building a second patched image would only restate that row" in prose
    # The evidence field and the lifecycle write that records the removal are a
    # pair: either one alone would let the disclosure drift or go unwritten.
    assert "$evidence.newer_release_simulation.removed_before_cleanup = $true" in drill
    assert "laterRowWritten = $false" in drill

    runbook = _flat(RUNBOOK_PATH)
    assert "Test-NexusMigrationRollback.ps1" in runbook
    assert "The newer-release ledger row is *written*, not built" in runbook
    assert "NEXUS_ALLOW_SCHEMA_MISMATCH" in runbook
    # The runbook has to describe the same rehearsal the script performs, or an
    # operator reads a rollback contract the drill does not actually prove.
    assert "rehearses a reversible migration's apply, rollback and re-apply" in runbook
    assert "0002-index-platform-event-retention" in runbook


def test_the_runbooks_document_the_ordering_contract_and_the_cli_interface():
    runbook = _flat(RUNBOOK_PATH)

    assert "## Database migrations and their rollback" in runbook
    assert "schema_migrations" in runbook
    assert "backend/scripts/nexus_migrate.py" in runbook
    for flag in ("--status", "--apply", "--rollback-to", "--rollback-all", "--adopt-baseline", "--dry-run"):
        assert flag in runbook, flag
    assert "applied before the images are rolled" in runbook
    assert "roll the images back only after" in runbook
    assert "artifacts/release-drills/migration-drill-*.json" in runbook

    # The pre-existing ordering instruction the application drill relies on stays.
    assert "migration's documented" in runbook
    assert "must run **before** older images" in runbook
    assert "Database migration rollback is not rehearsed by this" in runbook

    readiness = _flat(READINESS_PATH)
    assert "nexus_migrate.py --status" in readiness
    assert "Test-NexusMigrationRollback.ps1" in readiness
    assert "migration-drill-*.json" in readiness
    assert "schema_migrations" in readiness
    assert "has not been executed on a" in readiness


def test_the_gate_and_its_ownership_are_recorded_as_open_until_a_host_run_exists():
    checklist = _flat(CHECKLIST_PATH)

    assert "[!] | Immutable application rollback" not in checklist
    assert "[-] | Immutable application rollback" in checklist
    assert "database migration rollback is rehearsed per migration" in checklist
    # The row must name the mechanism, the rehearsal and the deterministic proof.
    for evidence in (
        "backend/app/services/schema_migrations.py",
        "backend/scripts/nexus_migrate.py",
        "scripts/Test-NexusMigrationRollback.ps1",
        "backend/tests/test_schema_migrations.py",
        "artifacts/release-drills/migration-drill-*.json",
    ):
        assert evidence in checklist, evidence
    # ...and must still state the work that only a deployment host can do.
    assert "nothing is proven on a host" in checklist
    assert "rollback decision owner" in checklist
    # The reversible migration now exists, so the row may no longer claim it does
    # not; what stays honest is that a data-transforming one still does not.
    assert "reversible migration that transforms customer data still does not exist" in checklist
    assert "0002-index-platform-event-retention" in checklist

    # The ledger is persistent data, so its ownership decision is recorded in
    # both the authoritative table and the collection placement map.
    ownership = _flat(OWNERSHIP_PATH)
    assert "schema_migrations" in ownership
    assert ownership.count("Database migration ledger") >= 2
    assert "not tenant-scoped" in ownership
    assert "backend/scripts/nexus_migrate.py" in ownership
