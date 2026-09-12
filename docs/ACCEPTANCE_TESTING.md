# Disposable API and browser acceptance testing

`scripts/Run-NexusAcceptance.ps1` runs authenticated API or Playwright browser
acceptance against a **new disposable MongoDB database**. It proves that two
restricted technicians can work only in their assigned client scope; it does
not use the normal development database, a production compose stack, seeded
demo data, external integrations, or provider credentials.

## Run it locally

From the repository root, with the Python virtual environment available and
either Docker Compose v2 or Podman Compose installed:

```powershell
.\scripts\Run-NexusAcceptance.ps1
```

The runner prefers `docker compose`. If it is not usable, it falls back to
`podman compose`, then `podman-compose`.

### Podman on Windows

Podman needs one running local machine before it can start the disposable
stack:

```powershell
podman machine init --now
```

If Windows reports that WSL2 cannot start because virtualisation or the Virtual
Machine Platform component is disabled, enable that Windows/firmware
prerequisite and restart the computer before retrying. The Nexus runner never
enables Windows features, changes firmware settings, or falls back to an
existing database automatically.

It generates a unique Compose project name, a random database name beginning
with `nexus_acceptance_`, and random test-only JWT/encryption values in process
memory. It binds the API only to `127.0.0.1:18000`, waits for `/api/ready`, runs
`backend/tests/test_two_client_api_acceptance.py`, then removes only that
generated Compose project and its volumes. MongoDB data is held on container
tmpfs and disappears at teardown.

Use another unused local port if necessary:

```powershell
.\scripts\Run-NexusAcceptance.ps1 -Port 18080
```

### Authenticated browser gate

Install the pinned Playwright Chromium runtime once, then run the same isolated
environment with the browser suite enabled:

```powershell
pnpm --dir frontend exec playwright install chromium
.\scripts\Run-NexusAcceptance.ps1 -UseLocalMongo -Browser
```

The browser runner binds the React development server only to
`127.0.0.1:13000` by default; use `-FrontendPort` to select another unused
loopback port. It provisions a fresh administrator, two clients, two
client-restricted technicians, their account-owned readiness attestations and
the workflow records needed by the eight golden-path checks. Each technician
signs in through the real login page. Cross-client probes run from separate
browser contexts, and provider-disabled paths must report an honest unavailable
or pending state rather than fabricated success.

The generated HTML report, JSON result and per-workflow screenshots are written
under `test_reports/browser-acceptance/`. They are local execution evidence and
are intentionally ignored by Git because they contain machine-specific paths
and randomly generated acceptance identifiers.

### Explicit local-Mongo fallback

The runner does **not** automatically fall back from containers. If no Compose
runtime is available, and an isolated MongoDB listener is already running on
this workstation, opt in deliberately:

```powershell
.\scripts\Run-NexusAcceptance.ps1 -UseLocalMongo
```

`-UseLocalMongo` defaults to `mongodb://127.0.0.1:27017`. A different local
loopback listener can be supplied with `-LocalMongoUrl`; remote hosts,
`mongodb+srv` URLs, and embedded credentials are rejected. The fallback starts
only a new API process owned by the runner, with generated in-memory secrets
and a unique `nexus_acceptance_...` database. In `finally`, it stops that exact
process and drops only that generated prefixed database. `-KeepEnvironment` is
intentionally unavailable for the local-Mongo path so cleanup cannot be
accidentally skipped.

`-KeepEnvironment` is intended only for debugging a failing run. The script
prints the exact generated Compose project name; clean it up with the same
runtime selected by the script and that project name. Do not repoint this
environment at an existing database.

## Safety controls

- `NEXUS_TEST_ENVIRONMENT=1` makes the API fail closed unless `DB_NAME` starts
  with `nexus_acceptance_`; it also prevents the acceptance API from loading a
  local backend `.env` file.
- `NEXUS_SEED_DEMO_DATA=false` is enforced in acceptance, test, and production
  runtimes. Normal development continues to seed demo data unless explicitly
  disabled.
- Background workers are disabled, so the harness does not run schedulers,
  webhooks, providers, or other long-running automation.
- The authenticated test refuses to make mutable requests unless both
  `NEXUS_ACCEPTANCE_BASE_URL` and `NEXUS_TEST_ENVIRONMENT=1` are present.
- Browser mode also requires an explicit loopback API origin, assigns a separate
  loopback frontend origin to CORS, refuses occupied ports, and runs with one
  worker so shared workflow state is deterministic.
- The local-Mongo fallback accepts only loopback MongoDB addresses and refuses
  credentials or remote connection strings before it can start the API.

## Latest execution — 2026-09-12

The explicit local-Mongo path completed successfully against a generated
`nexus_acceptance_*` database. It authenticated an administrator and two
restricted technicians, created two separate client/device/ticket estates,
proved permitted same-client work, rejected cross-client reads and mutations,
then stopped its API process and dropped only the generated database.

The ticket golden path now additionally publishes a client-visible update,
proves portal-only delivery through the secure-link ticket history endpoint,
rejects a foreign technician reply, masks foreign and missing portal ticket
lookups identically, resolves the request through the normal closed lifecycle,
and verifies the retained public history plus create/update/public-reply audit
events. External email is deliberately not sent by this harness; provider
delivery and failure/retry evidence remains a separate sandbox gate.

The first 2026-08-24 execution also caught a real ticket-creation contract defect:
`Ticket` did not declare its persisted `client_logo_url` field. That model
contract was corrected before the passing run. The runner now prints the
isolated API log tail before cleanup when an acceptance failure occurs, so
future failures retain actionable server evidence without retaining data.

The 2026-09-12 browser execution passed all eight checks in 1.6 minutes. It
covered login and readiness, ticket/client history, failed-closed remote access,
the complete purchase-order approval and receipt path, invoice/Xero pending
state, contract/global-reconciliation boundaries, unavailable Yeastar handling,
Microsoft readiness without secret disclosure, and Web Studio pending-connector
evidence. It also exposed and drove a fix for PyMongo `Database` truth-value
evaluation in Microsoft provider visibility. Provider-success acceptance still
requires the dedicated vendor sandboxes listed in the production checklist.
