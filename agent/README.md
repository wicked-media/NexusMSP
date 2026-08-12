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

## Nexus Shield deployment profile

Every newly generated Windows installer now includes the Nexus Shield profile:

- Endpoint posture telemetry for Microsoft Defender, real-time protection, firewall, disk encryption and pending Windows updates.
- Nexus Canary integrity monitoring every 30 seconds.
- One default Canary sensor queued on first enrollment. The agent creates the
  decoy and reports its SHA-256 fingerprint before the workspace marks it
  active.

The deployment profile is deliberately monitoring and detection only. It does
not claim to install antivirus, silently alter protection settings, or isolate
an endpoint automatically. Those actions remain explicit, reviewed workflows.

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

## Nexus Elevate (native endpoint privilege approvals)

Nexus Elevate is available to every customer with an enrolled NexusOps Agent;
it does not require Keeper EPM or any other third-party privilege product.

The agent-side launch contract is deliberately narrow:

- an endpoint companion submits a request through `/api/nexus-elevate/agent/requests`;
- the request contains one absolute Windows `.exe` path, a SHA-256 fingerprint,
  a plain argv array, endpoint/user context and justification;
- a permitted NexusMSP technician approves or denies the request in the Nexus
  Elevate workspace; and
- on approval, this agent receives `elevate_launch`, rechecks the approval
  expiry and SHA-256 immediately before invoking the exact executable.

The command never invokes `cmd`, PowerShell or a shell parser. A hash mismatch,
expired approval or malformed request fails safely and is reported to the
NexusMSP audit trail. The initial native contract is Windows-first and covers
controlled approved launches; OS-wide UAC interception belongs to the signed
user-session companion and service-hardening rollout.

### User-session companion

The `nexus-client-chat.exe` companion is included in current installer packs.
It opens a local-only window at `http://127.0.0.1:5967` for client chat and
**Request administrator access**. The companion fingerprints the selected
executable locally, relays the request with the protected agent token, and
polls the technician decision. The browser window never receives the token.

The installer and the managed rollout both add **Nexus Client Chat** to the
Windows Start Menu under **NexusMSP**. It is deliberately user launched: the
background service does not inject a GUI into an endpoint user's session.

## Nexus Edge

`nexus-edge` is the optional, customer-scoped Linux connector prepared from
**Deployment Hub**. It is not a remote-control replacement and it does not
open an inbound management port. Its purpose is to establish an auditable
customer deployment identity, report health to Nexus, and provide the safe
foundation for future local discovery and customer-side service connectors.

```bash
cd /app/agent
docker build -f Dockerfile.edge -t nexus-edge:local .
# or: make edge-linux
```

The Deployment Hub bundle supplies the control-plane URL, deployment ID and a
single-use activation code. On first start the Edge exchanges that code for a
non-recoverable token stored only in its persistent `/var/lib/nexus-edge`
volume. After the first accepted heartbeat, remove `NEXUS_ACTIVATION_CODE`
from the host `.env` file and restart the container. Nexus derives client Edge
agent metering from its own agent registry; a customer-side heartbeat cannot
inflate the billable count.

## Phase status

- [x] Phase 1 — Enrollment + heartbeat
- [x] Phase 2 — Full telemetry (CPU/RAM/disks/services/processes/software)
- [x] Phase 3 — Remote command execution (scripts/reboot/etc.)
- [ ] Phase 4 — Splashtop bundling + per-client deployment packs
- [ ] Phase 5 — Auto-update, code signing, MSI builder
