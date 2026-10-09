#!/bin/sh
# Local full-stack dev harness for the Freebuff preview.
#
# Boots a real MongoDB and the FastAPI API in the sandbox, then runs the CRA dev
# server, which proxies same-origin /api -> the API. The browser therefore gets a
# data-backed NexusMSP (demo-seeded) that can be clicked through and tested.
#
# This is a TEST-ONLY harness. Runtime secrets are generated per boot and are
# never real values. The Go endpoint agent, ClamAV, the durable worker and the
# Docker/TLS stack are intentionally out of scope here.
#
# Run from the repository root:  sh ./scripts/dev-stack.sh
set -e

ROOT="$(pwd)"
PY="$ROOT/.venv/bin/python"
UVICORN="$ROOT/.venv/bin/uvicorn"
MONGO_BIN="$ROOT/.local/mongo/bin/mongod"
MONGO_DATA="$ROOT/.local/mongo-data"

wait_port() {
  i=0
  while ! "$PY" -c "import socket,sys; socket.create_connection((sys.argv[1],int(sys.argv[2])),2).close()" "$1" "$2" 2>/dev/null; do
    i=$((i+1)); [ "$i" -ge 90 ] && { echo "[dev-stack] $3 not listening on $1:$2"; exit 1; }
    sleep 1
  done
}

wait_http() {
  i=0
  while ! "$PY" -c "import sys,urllib.request; urllib.request.urlopen(sys.argv[1],timeout=3).read()" "$1" 2>/dev/null; do
    i=$((i+1)); [ "$i" -ge 90 ] && { echo "[dev-stack] $2 not healthy at $1"; exit 1; }
    sleep 1
  done
}

# Best-effort cleanup of any stale harness processes left by a previous run so
# the fixed ports (27017, 8000) are free before we bind them again.
pkill -f 'mongod --dbpath' 2>/dev/null || true
pkill -f 'uvicorn server:app' 2>/dev/null || true

mkdir -p "$MONGO_DATA" "$ROOT/backend/uploads/preview" "$ROOT/.local"

# Test-only runtime configuration. Secrets are generated per boot so nothing
# sensitive is committed or reused. NEXUS_SEED_DEMO_DATA is intentionally left
# unset so the development seeder populates demo clients/devices/tickets.
export MONGO_URL="mongodb://127.0.0.1:27017"
export DB_NAME="nexusops_preview"
export JWT_SECRET="$("$PY" -c 'import secrets; print(secrets.token_urlsafe(48))')"
export NEXUS_SECRET_ENCRYPTION_KEY="$("$PY" -c 'import secrets; print(secrets.token_hex(32))')"
export NEXUS_RUN_BACKGROUND_WORKERS="false"
export NEXUS_UPLOADS_DIR="$ROOT/backend/uploads/preview"
unset NEXUS_SEED_DEMO_DATA

echo "[dev-stack] starting mongod..."
"$MONGO_BIN" --dbpath "$MONGO_DATA" --bind_ip 127.0.0.1 --port 27017 \
  --logpath "$ROOT/.local/mongod.log" >/dev/null 2>&1 &
wait_port 127.0.0.1 27017 "mongod"
echo "[dev-stack] mongod ready"

# Start the API in the background. Mongo is already up, so the startup seeding
# (demo clients/devices/tickets) succeeds. The API is ready well before the CRA
# dev server finishes compiling, so the UI never blocks on this.
echo "[dev-stack] starting FastAPI on 127.0.0.1:8000..."
"$UVICORN" server:app --host 127.0.0.1 --port 8000 --app-dir "$ROOT/backend" \
  > "$ROOT/.local/uvicorn.log" 2>&1 &
( wait_http "http://127.0.0.1:8000/api/health" "FastAPI" \
    && echo "[dev-stack] FastAPI healthy (demo seeding runs on startup)" ) &

echo "[dev-stack] starting CRA dev server on 0.0.0.0:${PORT:-3000}..."
cd "$ROOT/frontend"
export HOST=0.0.0.0
export BROWSER=none
export REACT_APP_BACKEND_URL=
export PORT="${PORT:-3000}"
exec pnpm start
