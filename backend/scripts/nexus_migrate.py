"""Operator entry point for the Nexus database-migration ledger.

Run this from the repository root or from ``backend/`` with the same environment
the API uses (``MONGO_URL``, ``DB_NAME``, ``JWT_SECRET``) — there is deliberately
only one Mongo connection definition in the platform, and a maintenance window
should not have a second one.

    python backend/scripts/nexus_migrate.py --status
    python backend/scripts/nexus_migrate.py --apply
    python backend/scripts/nexus_migrate.py --rollback-to 0001-adopt-prelaunch-event-backfills
    python backend/scripts/nexus_migrate.py --adopt-baseline      # existing database
    python backend/scripts/nexus_migrate.py --apply --dry-run     # show, change nothing

Exit codes are part of the interface, because the deployment drill and a change
window both gate on them:

    0  the requested action succeeded (for ``--status``: the database is compatible)
    1  the action was refused — incompatible ledger, irreversible rollback, or a
       ledger that already has rows. Nothing was changed.
    2  usage error (argparse).

No command prints a secret, and the CLI never runs a migration implicitly: every
change is an explicit action an operator typed.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services import schema_migrations as migrations  # noqa: E402

EXIT_OK = 0
EXIT_REFUSED = 1
EXIT_USAGE = 2


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="nexus_migrate.py",
        description="Inspect and change the Nexus database-migration ledger.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Deploy order: apply migrations during the change window, then roll the images.\n"
            "Rollback order: roll the images back only after restoring the database state the\n"
            "previous release expects (docs/RELEASE_RUNBOOK.md)."
        ),
    )
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--status", action="store_true", help="Show applied, adopted, pending and unknown migrations.")
    action.add_argument("--apply", action="store_true", help="Apply every unrecorded migration in id order.")
    action.add_argument(
        "--rollback-to",
        metavar="MIGRATION_ID",
        help="Roll recorded migrations back, newest first, leaving MIGRATION_ID applied.",
    )
    action.add_argument(
        "--rollback-all",
        action="store_true",
        help=(
            "Roll every recorded migration back, leaving the pre-ledger database a release "
            "before the first migration expects."
        ),
    )
    action.add_argument(
        "--adopt-baseline",
        action="store_true",
        help="Record the registry as already satisfied by a pre-ledger database, without running it.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Report what would change and change nothing.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON (used by the release drill).")
    parser.add_argument(
        "--actor",
        default=None,
        help="Recorded in the ledger as applied_by. Defaults to NEXUS_MIGRATION_ACTOR or 'nexus-migrate'.",
    )
    return parser


async def _run(args: argparse.Namespace) -> int:
    from app.database import db

    actor = (args.actor or "nexus-migrate").strip()
    payload: dict = {"dry_run": bool(args.dry_run), "actor": actor}

    try:
        if args.status:
            current = await migrations.status(db)
            payload["status"] = current.as_dict()
            payload["registry"] = list(migrations.KNOWN_MIGRATION_IDS)
            _emit(payload, args.json)
            if not current.compatible:
                _warn(
                    "This database records migrations this release does not define, or an applied "
                    "migration was edited. Refusing is the point: see the ledger above."
                )
                return EXIT_REFUSED
            if current.pending:
                _note("Unapplied migrations exist. Apply them before accepting the release.")
            return EXIT_OK

        if args.apply:
            applied = await migrations.apply_pending(db, applied_by=actor, dry_run=args.dry_run)
            payload["applied"] = applied
            current = await migrations.status(db)
            payload["status"] = current.as_dict()
            _emit(payload, args.json)
            if not current.compatible:
                _warn("The ledger is incompatible after applying; stopping before this release serves traffic.")
                return EXIT_REFUSED
            return EXIT_OK

        if args.rollback_to or args.rollback_all:
            target = None if args.rollback_all else args.rollback_to
            rolled = await migrations.rollback_through(db, target, dry_run=args.dry_run)
            payload["rolled_back"] = rolled
            payload["rolled_back_to"] = target
            payload["status"] = (await migrations.status(db)).as_dict()
            _emit(payload, args.json)
            return EXIT_OK

        adopted = await migrations.adopt_baseline(db, applied_by=actor, dry_run=args.dry_run)
        payload["adopted"] = adopted
        payload["status"] = (await migrations.status(db)).as_dict()
        _emit(payload, args.json)
        return EXIT_OK
    except migrations.SchemaMigrationError as exc:
        payload["refused"] = True
        payload["reason"] = str(exc)
        # A refusal must still show the ledger as it actually is: an operator
        # reading this mid-incident must not conclude that a refused rollback
        # emptied the database.
        try:
            payload["status"] = (await migrations.status(db)).as_dict()
        except Exception as read_error:  # pragma: no cover - driver failure path
            payload["status_unavailable"] = str(read_error)
        _emit(payload, args.json)
        _warn(str(exc))
        return EXIT_REFUSED


def _emit(payload: dict, as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, indent=2, sort_keys=True))
        return
    status = payload.get("status")
    if status is None:
        print("Nexus database-migration ledger: unavailable (the ledger could not be read)")
    else:
        _print_status(status)
    for key in ("applied", "rolled_back", "adopted"):
        if payload.get(key):
            verb = "would change" if payload.get("dry_run") else "changed"
            print(f"  {key} ({verb}): {', '.join(payload[key])}")
    if payload.get("dry_run"):
        print("  dry run: nothing was changed.")


def _print_status(status: dict) -> None:
    print("Nexus database-migration ledger")
    print(f"  applied:  {', '.join(status.get('applied') or []) or '(none)'}")
    print(f"  adopted:  {', '.join(status.get('adopted') or []) or '(none)'}")
    print(f"  pending:  {', '.join(status.get('pending') or []) or '(none)'}")
    print(f"  unknown:  {', '.join(status.get('unknown') or []) or '(none)'}")
    print(f"  drifted:  {', '.join(status.get('drifted') or []) or '(none)'}")
    print(f"  compatible: {bool(status.get('compatible'))}")


def _warn(message: str) -> None:
    print(f"REFUSED: {message}", file=sys.stderr)


def _note(message: str) -> None:
    # A pending migration is not a refusal: the previous release is still serving.
    print(f"NOTICE: {message}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        return asyncio.run(_run(args))
    except migrations.SchemaMigrationError as exc:  # pragma: no cover - import-time guard
        _warn(str(exc))
        return EXIT_REFUSED
    except RuntimeError as exc:
        # A missing JWT_SECRET/MONGO_URL/DB_NAME lands here: the operator gets the
        # reason, and no credential value is ever printed.
        print(f"Unable to read the Nexus environment: {exc}", file=sys.stderr)
        return EXIT_USAGE


if __name__ == "__main__":
    raise SystemExit(main())
