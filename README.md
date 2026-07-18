# NexusMSP

NexusMSP is a FastAPI, React, MongoDB, and Go-based managed-services platform. The repository contains:

- `backend/` — FastAPI API and MongoDB persistence
- `frontend/` — React web application
- `agent/` — NexusOps endpoint agent
- `backend/tests/` — API and safety regression tests

## Prerequisites

- Python 3.11 or newer
- Node.js 20 or newer and pnpm 11
- MongoDB
- Go 1.22 or newer when building the endpoint agent

## Local setup

1. Copy `backend/.env.example` to `backend/.env` and replace every placeholder. `JWT_SECRET` is mandatory; the API intentionally refuses to start without it.
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
pnpm test -- --watchAll=false
pnpm build
```

Run endpoint-agent tests:

```powershell
Set-Location agent
go test ./...
```

## Agent command security

Remote scripts, installer generation, agent settings changes, and command output require either administrator access or the explicit `permissions.agent_commands.execute` capability. Fleet scripts target only agents seen in the last three minutes unless an authorised API caller deliberately sets `include_offline=true`. Pending fleet commands can be cancelled before an agent claims them.

Use a long random `JWT_SECRET`, restrict `CORS_ORIGINS` to trusted web origins, and grant agent-command permission only to staff who are authorised to execute code on managed endpoints.
