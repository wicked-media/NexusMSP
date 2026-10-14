# NexusMSP

NexusMSP is a FastAPI, React, MongoDB, and Go-based managed-services platform. The repository contains:

- `backend/` — FastAPI API and MongoDB persistence
- `frontend/` — React web application
- `agent/` — NexusOps endpoint agent
- `backend/tests/` — API and safety regression tests

NexusMSP runs independently: it has no Emergent runtime, package, storage, or AI dependency. Agent installers are stored locally by default, Stripe uses its official SDK, and optional AI features use your own OpenAI API key.

## Prerequisites

- Python 3.11 or newer
- Node.js 20 or newer and pnpm 11
- MongoDB
- Go 1.22 or newer when building the endpoint agent
- Docker Desktop with Docker Compose v2 for the recommended container workflow

## Docker-first setup (recommended)

The production Compose stack runs a Caddy TLS ingress (`edge`), the React web tier, FastAPI API, dedicated worker, MongoDB, ClamAV and observability services. Docker Compose manages service networking and persistent named volumes; MongoDB, uploads, private evidence and generated installers are not host-published. Customer traffic enters over HTTPS on the `edge` service — `NEXUS_TLS_DOMAIN` and `NEXUS_TLS_ACME_EMAIL` control automatic certificate issuance and renewal. The plain web port binds to `127.0.0.1` and stays for local smoke tests only. See [the production readiness runbook](docs/PRODUCTION_READINESS.md) before using customer data.

1. Install Docker Desktop for your operating system and make sure its engine is running. On Windows, complete the supported WSL 2/virtualization prerequisites if Docker Desktop requests them.
2. Configure the production Compose variables through your deployment secret manager or a private, uncommitted host environment file. Required names are `MONGO_USERNAME`, `MONGO_PASSWORD`, `JWT_SECRET`, `NEXUS_SECRET_ENCRYPTION_KEY`, `NEXUS_DMARC_RECEIVER_TOKEN`, `CORS_ORIGINS`, `NEXUS_ALERT_WEBHOOK_URL`, `NEXUS_GRAFANA_ADMIN_PASSWORD`, and `NEXUS_OBSERVABILITY_INGEST_TOKEN`. Use unique secrets; `MONGO_PASSWORD` must be URL-safe because it is embedded in the Mongo connection URI.
3. From the repository root, validate and start the stack:

   ```powershell
   docker version
   docker compose version
   docker compose -f docker-compose.production.yml config --quiet
   docker compose -f docker-compose.production.yml up -d --build
   docker compose -f docker-compose.production.yml ps
   ```

4. Open `http://127.0.0.1:8080` for a local smoke test (or `https://127.0.0.1`, where a local-CA certificate warning is expected). Inspect service startup with `docker compose -f docker-compose.production.yml logs --tail=100 api web worker mongo clamav` and check `/api/health` plus `/api/ready` before beginning acceptance tests.
5. To stop without deleting persistent data, run `docker compose -f docker-compose.production.yml down`. Do **not** add `--volumes` when you need to preserve the database and uploaded files.

The Compose file is the application/runtime package, not a complete Internet-facing production platform: TLS ingress, secret management, encrypted off-host backups, restore/rollback drills and signed Windows-agent release evidence remain separate deployment gates.

## Local setup

1. Copy `backend/.env.example` to `backend/.env` and replace every placeholder. `JWT_SECRET` is mandatory; the API intentionally refuses to start without it. `OPENAI_API_KEY` is optional and only enables AI-assisted features. `STRIPE_WEBHOOK_SECRET` is required only if you configure Stripe webhooks.
2. Copy `frontend/.env.example` to `frontend/.env`.
3. Install and start the backend:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r backend\requirements.txt
   uvicorn server:app --app-dir backend --reload --port 8000
   ```

4. In a second terminal, install and start the frontend:

   ```powershell
   Set-Location frontend
   pnpm install --frozen-lockfile
   pnpm start
   ```

The frontend defaults to `http://localhost:3000` and calls the backend URL configured in `frontend/.env`.

### Local restart

Use `Restart-Nexus.cmd` from Windows Explorer, or run the following from the
repository root. It manages only the local Nexus frontend (port 3000) and API
(port 8000), retains live logs in the repository root, waits for both services
to respond, and opens Nexus when ready.

```powershell
.\scripts\NexusLocal.ps1 -Action Restart
```

Other actions are `Start`, `Stop`, and `Status`.

## Verification

Run the backend safety tests:

```powershell
$env:JWT_SECRET = "test-only-local-secret"
$env:MONGO_URL = "mongodb://127.0.0.1:27017"
$env:DB_NAME = "nexusops-tests"
python backend\scripts\run_unit_tests.py
```

### Live API integration probes

The historical `backend/tests/test_iteration*.py` API probes can create and
modify records. They are excluded from a normal `pytest` run so a developer or
CI job cannot accidentally exercise a local, shared, or production-like Nexus
environment. They must only run against a disposable, non-production stack.

To opt in deliberately, set all of the following in the shell that launches
pytest (never commit their values):

```powershell
$env:NEXUS_RUN_LIVE_INTEGRATION_TESTS = "1"
$env:NEXUS_TEST_ENVIRONMENT = "1"
$env:REACT_APP_BACKEND_URL = "http://127.0.0.1:8001"
$env:NEXUS_TEST_ADMIN_PASSWORD = "<isolated-test-account-password>"
python -m pytest backend\tests\test_iteration20_new_features.py
```

`NEXUS_TEST_ENVIRONMENT=1` is an explicit operator acknowledgement, not a
substitute for an isolated database and test account. The live probes are not
part of the deterministic CI unit gate.

Run frontend tests and a production build:

```powershell
Set-Location frontend
pnpm test --watchAll=false --runInBand
pnpm build
```

Run endpoint-agent tests:

```powershell
Set-Location agent
go test ./...
```

## Production pilot

Use [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) as the release gate. It covers secret setup, container deployment, recovery proof, golden-workflow acceptance, pilot controls, and rollback. Supply the Compose variables from a deployment secret manager or a private host-only environment file; never put real secrets in the repository.

The current security review and remaining pre-launch work are documented in [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md). If Docker Desktop fails to install or its engine will not start, use the diagnostic checklist in [the production readiness runbook](docs/PRODUCTION_READINESS.md#9-docker-desktop-installation-and-first-run-troubleshooting) and capture the exact error plus diagnostic ID before retrying.

## Agent command security

Remote scripts, installer generation, agent settings changes, and command output require either administrator access or the explicit `permissions.agent_commands.execute` capability. Fleet scripts target only agents seen in the last three minutes unless an authorised API caller deliberately sets `include_offline=true`. Pending fleet commands can be cancelled before an agent claims them.

Use a long random `JWT_SECRET`, restrict `CORS_ORIGINS` to trusted web origins, and grant agent-command permission only to staff who are authorised to execute code on managed endpoints.
