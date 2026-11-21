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

The browser runner builds the React production bundle and serves it only on
`127.0.0.1:13000` by default; use `-FrontendPort` to select another unused
loopback port. `frontend/playwright.config.js` runs `pnpm build` and starts
`frontend/scripts/serve-build.js`, which applies the same browser-history
fallback as the production ingress. It provisions a fresh administrator, two
clients, two client-restricted technicians, their account-owned readiness
attestations and the workflow records needed by the eight golden-path checks.
Each technician authenticates through the real browser login form; there is no
API-session fallback, so a login regression fails the gate instead of silently
degrading it. Cross-client probes run from separate browser contexts, and
provider-disabled paths must report an honest unavailable or pending state
rather than fabricated success.

The API and browser suites must each run against their **own fresh database**.
Both bootstrap the first administrator, which closes public registration for
that database; running the browser suite after the API suite against the same
database makes the browser fixture fail at `/auth/register` with HTTP 403. That
is an isolation mistake in the harness invocation, not a product failure. The
2026-11-18 run provisioned a separate `nexus_acceptance_*` database for each
suite.

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
- Startup demo seeding was removed on 2026-11-13. No runtime — development,
  acceptance, test, or production — manufactures sample customers, devices,
  tickets or other business records. A fresh database is empty until the first
  administrator registers and real records are created.
- Background workers are disabled, so the harness does not run schedulers,
  webhooks, providers, or other long-running automation.
- The authenticated test refuses to make mutable requests unless both
  `NEXUS_ACCEPTANCE_BASE_URL` and `NEXUS_TEST_ENVIRONMENT=1` are present.
- The runner sets `NEXUS_MALWARE_SCANNER=test` only inside that disposable
  runtime. It recognizes the EICAR marker and otherwise returns clean so upload
  lifecycle tests are deterministic without claiming a production ClamAV result.
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

The same run now uploads a clean client document through the quarantine
boundary, verifies its clean scan state and scoped download, rejects the EICAR
marker with HTTP 422, rejects active content disguised as PNG with HTTP 400,
and proves neither rejected payload creates a released client-document record.

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

The latest 2026-09-12 browser execution passed all eight checks in 4.1 minutes. It
covered login and readiness, ticket/client history, failed-closed remote access,
the complete purchase-order approval and receipt path, invoice/Xero pending
state, contract/global-reconciliation boundaries, unavailable Yeastar handling,
Microsoft readiness without secret disclosure, and Web Studio pending-connector
evidence. It also exposed and drove a fix for PyMongo `Database` truth-value
evaluation in Microsoft provider visibility. Provider-success acceptance still
requires the dedicated vendor sandboxes listed in the production checklist.

## Latest execution — 2026-11-18

The explicit local-Mongo path was used because the Docker daemon was not
accessible in this VM and no Podman runtime was present. The PowerShell wrapper
could not be executed because `pwsh` is absent; its underlying API acceptance
test was run directly against the same disposable API contract. A fresh
`nexus_acceptance_*` database for the API suite, a second fresh database for
the browser suite, API 3.0.0 on `127.0.0.1:18000`, and the React **production
build** served on `127.0.0.1:13000` were started independently. The build was
compiled with `REACT_APP_BACKEND_URL=http://127.0.0.1:18000`. The eight serial
golden workflows ran with one worker against the second disposable database.

**API acceptance: 1 passed in 2.93s** (`pytest tests/test_two_client_api_acceptance.py -q`)
on its own fresh database, covering the two-client authenticated scope contract.
The harness, not the test module, owns database and process cleanup.

**Browser result: 8/8 passed**, with 0 skipped, 0 unexpected and 0 flaky in
128.97s / 2m09s (`expected: 8`, `unexpected: 0`, `skipped: 0`, `flaky: 0`). The
production bundle was built by Node 22.23.5, the CI-major runtime. The login
waits use 15-second bounds and the fixed pre-fill 300ms sleep was removed after
the verification-integrity audit; the gate still passed. The
workflows covered ticket delivery/history, retired third-party remote transport
fail-closed behaviour, purchase-order receipt and foreign-order denial,
invoice/provider handoff scope, contract and global reconciliation boundaries,
unconfigured PBX and foreign-link denial, Microsoft saved-configuration versus
provider evidence, and Web Studio connector intent scope.

**Authentication evidence is complete.** All eight workflows authenticated the
generated client-restricted technicians through the real browser login form and
also exercised the administrator or foreign-technician login paths where the
workflow requires them. No workflow used an API-session fallback or seeded
browser storage; the previous dev-shell fallback was removed so a login failure
now fails the acceptance gate. Running the gate against the production bundle
also removes the on-demand CRA compilation that caused the intermittent
pre-render seen in the 2026-11-17 run.

Evidence is retained under `test_reports/browser-acceptance/`:
`results.json`, the HTML report at `html/index.html`, eight workflow screenshots
under `html/data/`, and `playwright-nineteenth.log`. The full local verification
matrix, including exact backend/frontend counts, lint, audits, build, Go builds
and the promotion drill, is recorded in the 2026-11-18 cycle record of
`NEXUS_PRODUCTION_READINESS_CHECKLIST.md`; raw logs are under
`test_reports/full-matrix-2026-11-18/`. These directories are local and ignored
by Git. No deployment or production-readiness claim follows from this run;
provider sandbox acceptance, container builds and deployment-host gates remain
separate. On 2026-11-21, CI run `44856885006` on validated code commit
`11b4864` (temporary draft PR #3) built all four images — API, production API,
release API from a verified signed-agent fixture, and web — and validated the
production Compose model on `ubuntu-latest` (job `136701052647`, times
02:37:17Z-02:45:50Z). Its `tenant-boundary-acceptance` job (`136701576056`)
also passed: step 02:39:55Z-02:42:08Z, `/api/ready` confirmed at 02:42:03Z with
`published port: 127.0.0.1:18000`, and `1 passed in 2.26s`. A separate
fix-validation run `44856147536` on commit `ddc88ef` passed the same gates
(`1 passed in 2.73s` at 02:33:55Z). The earlier failure on commit `2721e46` was
diagnosed from captured container logs (run `44855166233`): `/api/ready`
returned 200 inside the container while `compose port api 8000` returned
`invalid IP:0` and the host probe timed out, because Docker ignores published
ports on an internal-only network. `docker-compose.acceptance.yml` now attaches
the API to a second non-internal network for the loopback publish; MongoDB
remains internal-only. The evidence commit that records this run is
documentation-only; CI re-runs the same gates on it. Exact logs and step times
are in `test_reports/full-matrix-2026-11-18/container-remediation.log` and the
readiness checklist's cycle record.
