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
python -m pytest backend\tests\test_nexus_agent_safety.py
```

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

Use [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) as the release gate. It covers secret setup, container deployment, recovery proof, golden-workflow acceptance, pilot controls, and rollback. Copy `.env.production.example` to a deployment-host `.env`; never put real secrets in the repository.

The current security review and remaining pre-launch work are documented in [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md).

## Agent command security

Remote scripts, installer generation, agent settings changes, and command output require either administrator access or the explicit `permissions.agent_commands.execute` capability. Fleet scripts target only agents seen in the last three minutes unless an authorised API caller deliberately sets `include_offline=true`. Pending fleet commands can be cancelled before an agent claims them.

Use a long random `JWT_SECRET`, restrict `CORS_ORIGINS` to trusted web origins, and grant agent-command permission only to staff who are authorised to execute code on managed endpoints.
