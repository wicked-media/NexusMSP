"""Validate the release-controlled Nexus OS application compatibility catalogue."""
from __future__ import annotations

import json
import sys
from pathlib import Path


CATALOG = Path(__file__).with_name("applications.json")
LANES = {"native", "pwa", "wine", "proton", "remoteapp", "windows_vm", "unsupported"}
STATUSES = {"proposed", "tested", "approved", "blocked"}
ARCHITECTURES = {"x86_64", "aarch64"}
APPROVED_REQUIRED = {"version", "licensing", "owner", "evidence", "rollback"}


def fail(message: str) -> None:
    print(f"catalog validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    try:
        payload = json.loads(CATALOG.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"could not read {CATALOG.name}: {exc}")
    if payload.get("schema_version") != 1:
        fail("schema_version must be 1")
    applications = payload.get("applications")
    if not isinstance(applications, list):
        fail("applications must be an array")
    seen: set[str] = set()
    for index, app in enumerate(applications):
        if not isinstance(app, dict):
            fail(f"application {index} must be an object")
        app_id = app.get("id")
        if not isinstance(app_id, str) or not app_id.strip():
            fail(f"application {index} needs a non-empty id")
        if app_id in seen:
            fail(f"duplicate application id: {app_id}")
        seen.add(app_id)
        if not isinstance(app.get("display_name"), str) or not app["display_name"].strip():
            fail(f"{app_id}: display_name is required")
        if app.get("lane") not in LANES:
            fail(f"{app_id}: lane must be one of {sorted(LANES)}")
        if app.get("status") not in STATUSES:
            fail(f"{app_id}: status must be one of {sorted(STATUSES)}")
        architectures = app.get("architectures")
        if not isinstance(architectures, list) or not architectures or not set(architectures) <= ARCHITECTURES:
            fail(f"{app_id}: architectures must contain only supported values")
        if app["status"] == "approved":
            missing = [field for field in sorted(APPROVED_REQUIRED) if not isinstance(app.get(field), str) or not app[field].strip()]
            if missing:
                fail(f"{app_id}: approved entries require {', '.join(missing)}")
            if app["lane"] in {"wine", "proton"} and app.get("driver_dependency"):
                fail(f"{app_id}: driver-dependent apps cannot be approved through {app['lane']}")
    print(f"Nexus OS application catalogue valid ({len(applications)} entries)")


if __name__ == "__main__":
    main()
