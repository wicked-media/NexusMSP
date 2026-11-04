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
#
# MongoDB is always on 127.0.0.1:27017 and the API on 127.0.0.1:8000; the CRA
# dev server takes the port Freebuff injects as PORT (3000 in the sandbox).
# A host whose login shell cannot parse /etc/profile may print
# "sh: 29: source: not found" before this harness says anything: that is image
# noise from bash-only `source` under dash, not this script.
set -e

ROOT="$(pwd)"
PY="$ROOT/.venv/bin/python"
UVICORN="$ROOT/.venv/bin/uvicorn"
MONGO_BIN="$ROOT/.local/mongo/bin/mongod"
MONGO_DATA="$ROOT/.local/mongo-data"

# Every runtime this harness needs is provisioned outside git (the backend venv,
# the MongoDB server binary and the frontend install are all gitignored), so a
# resumed or fresh workspace must have them first. Name what is missing and how
# to restore it: the preview only reports that the command failed, so a bare
# "not found" would hide the real cause from whoever reads the log.
preflight() {
  missing=""
  [ -x "$PY" ] || missing="$missing
  - backend venv    missing $PY
                    fix: python3 -m venv $ROOT/.venv && $ROOT/.venv/bin/pip install -r $ROOT/backend/requirements.txt"
  [ -x "$UVICORN" ] || missing="$missing
  - uvicorn         missing $UVICORN
                    fix: $ROOT/.venv/bin/pip install -r $ROOT/backend/requirements.txt"
  [ -x "$MONGO_BIN" ] || missing="$missing
  - mongod          missing $MONGO_BIN (the local MongoDB server is gitignored)
                    fix: re-provision .local/mongo on this host"
  command -v pnpm >/dev/null 2>&1 || missing="$missing
  - pnpm            not on PATH
                    fix: corepack enable, or npm install -g pnpm"
  [ -x "$ROOT/frontend/node_modules/.bin/craco" ] || missing="$missing
  - frontend deps   missing $ROOT/frontend/node_modules
                    fix: cd $ROOT/frontend && pnpm install --frozen-lockfile"
  if [ -n "$missing" ]; then
    printf '[dev-stack] cannot start: missing prerequisites%s\n' "$missing"
    exit 1
  fi
}

wait_port() {
  i=0
  while ! "$PY" -c "import socket,sys; socket.create_connection((sys.argv[1],int(sys.argv[2])),2).close()" "$1" "$2" 2>/dev/null; do
    i=$((i+1)); [ "$i" -ge 90 ] && { echo "[dev-stack] $3 not listening on $1:$2"; return 1; }
    sleep 1
  done
}

wait_http() {
  i=0
  while ! "$PY" -c "import sys,urllib.request; urllib.request.urlopen(sys.argv[1],timeout=3).read()" "$1" 2>/dev/null; do
    i=$((i+1)); [ "$i" -ge 90 ] && { echo "[dev-stack] $2 not healthy at $1"; return 1; }
    sleep 1
  done
}

preflight

# Stop the children we started when the CRA dev server exits, so a crashed run
# never leaves a mongod holding its dbpath lock or a uvicorn holding port 8000 to
# break the next start.
MONGOD_PID=""
API_PID=""
cleanup() {
  [ -n "$MONGOD_PID" ] && kill "$MONGOD_PID" 2>/dev/null || true
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  return 0
}
trap cleanup EXIT INT TERM

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
MONGOD_PID=$!
if ! wait_port 127.0.0.1 27017 "mongod"; then
  echo "[dev-stack] tail of $ROOT/.local/mongod.log:"
  tail -n 20 "$ROOT/.local/mongod.log" 2>/dev/null || true
  echo "[dev-stack] if that reports a stale lock or an unclean shutdown, remove $MONGO_DATA/mongod.lock once no mongod is running."
  exit 1
fi
echo "[dev-stack] mongod ready"

# Start the API in the background. Mongo is already up, so the startup seeding
# (demo clients/devices/tickets) succeeds. The API is ready well before the CRA
# dev server finishes compiling, so the UI never blocks on this.
echo "[dev-stack] starting FastAPI on 127.0.0.1:8000..."
"$UVICORN" server:app --host 127.0.0.1 --port 8000 --app-dir "$ROOT/backend" \
  > "$ROOT/.local/uvicorn.log" 2>&1 &
API_PID=$!
# The UI is served even while the API is still seeding, so this wait only
# reports on the API; it never blocks the CRA dev server. A failure prints its
# cause here instead of leaving a silently broken same-origin /api proxy.
( if wait_http "http://127.0.0.1:8000/api/health" "FastAPI"; then
    echo "[dev-stack] FastAPI healthy (demo seeding runs on startup)"
  else
    echo "[dev-stack] tail of $ROOT/.local/uvicorn.log:"
    tail -n 20 "$ROOT/.local/uvicorn.log" 2>/dev/null || true
  fi ) &

echo "[dev-stack] starting CRA dev server on 0.0.0.0:${PORT:-3000}..."
cd "$ROOT/frontend"
export HOST=0.0.0.0
export BROWSER=none
export REACT_APP_BACKEND_URL=
export PORT="${PORT:-3000}"
# State readiness explicitly once the preview port answers, so the first slow
# webpack compile is never read as a failed start. pnpm start stays the
# foreground process: when it exits, the trap above retires mongod and uvicorn.
( wait_port 127.0.0.1 "$PORT" "CRA dev server" \
    && echo "[dev-stack] CRA dev server listening on 0.0.0.0:$PORT (preview ready)" ) &
pnpm start
