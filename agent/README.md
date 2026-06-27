# NexusOps Agent

Cross-platform RMM agent (Windows-first) for the NexusOps platform.

## Architecture

```
+------------------+       HTTPS         +-----------------------+
|  NexusOps Agent  |  <-- poll cmds -->  |   NexusOps Backend    |
|  (Go binary)     |  --> heartbeat -->  |   /api/nexus-agent/*  |
|  + Splashtop     |                     |                       |
|  Streamer        |                     |   MongoDB             |
+------------------+                     +-----------------------+
```

- Heartbeat every 60s (configurable) with telemetry: CPU, RAM, disks, network, OS, uptime, processes, services.
- Long-poll every 10s for new commands; processes them; reports results.
- Phase 1: HTTPS long-poll. Phase 2 will upgrade transport to WebSocket.
- Auto-update: agent compares `version` against `/api/nexus-agent/version` on each heartbeat.

## Build

```bash
cd /app/agent
make windows         # Cross-compile windows/amd64 -> dist/nexus-agent.exe
```

## Install (test machine)

The backend's installer builder produces a ZIP per client containing:

- `nexus-agent.exe`
- `config.json` (per-client enrollment token + server URL)
- `install.bat` (silent installer — creates service "NexusOps Agent" + auto-start)

Run `install.bat` as Administrator.

## Files

- `cmd/nexus-agent/main.go` — entry point + service lifecycle
- `internal/config/`           — config load + persistence
- `internal/enroll/`           — first-run enrollment
- `internal/heartbeat/`        — telemetry loop
- `internal/commands/`         — command poller + executor
- `internal/telemetry/`        — system inventory collectors
- `internal/transport/`        — HTTP client (with auth, retry)
- `internal/splashtop/`        — Splashtop Streamer bootstrapper

## Phase status

- [x] Phase 1 — Enrollment + heartbeat
- [x] Phase 2 — Full telemetry (CPU/RAM/disks/services/processes/software)
- [x] Phase 3 — Remote command execution (scripts/reboot/etc.)
- [ ] Phase 4 — Splashtop bundling + per-client deployment packs
- [ ] Phase 5 — Auto-update, code signing, MSI builder
