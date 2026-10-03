# NexusOps Agent

Cross-platform RMM agent (Windows-first) for the NexusOps platform.

## Architecture

```
+------------------+       HTTPS         +-----------------------+
|  NexusOps Agent  |  <-- poll cmds -->  |   NexusOps Backend    |
|  (Go binary)     |  --> heartbeat -->  |   /api/nexus-agent/*  |
|  + local broker  |                     |   MongoDB             |
|  + companions    |                     |                       |
+------------------+                     +-----------------------+
```

- Heartbeat every 60s (configurable) with telemetry: CPU, RAM, disks, network, OS, uptime, processes, services.
- Long-poll every 10s for new commands; processes them; reports results.
- HTTPS control plane with signed command envelopes and replay protection.
- Signed update manifests are evaluated on heartbeat; the agent fails closed if
  the version, pinned signing key, signature or artifact fingerprint is wrong.
- Nexus Remote is first-party. The Windows service brokers only a
  policy-hash-verified, attended Remote Companion (view-only by default;
  interactive control requires fresh endpoint approval per session); it never
  starts or repairs an external remote-access provider.

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
make all             # Build service, Client Chat and Tray for windows/amd64
make windows-remote  # Build the Native Remote user-session companion
```

The production API image builds these components from the checked-in
Agent source in its Docker build stage. It does not copy a developer's
ignored `agent/dist` directory or any per-device `config.json` into the image.
Pass the same `NEXUS_AGENT_VERSION` build argument and API environment value
when promoting a release so the advertised and embedded versions agree.

## Install (test machine)

The backend's installer builder produces a ZIP per client containing:

- `nexus-agent.exe`
- `nexus-client-chat.exe` and `nexus-agent-tray.exe`
- `nexus-remote-companion.exe` when the Native Remote build is available
- `config.json` (per-client enrollment token + server URL, ACL-restricted to
  `SYSTEM` and local Administrators after installation)
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
- `internal/localbroker/`      — narrow, service-owned localhost bridge for companions
- `internal/updater/`          — signed update verification and staged swap/rollback

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

The installer includes `nexus-client-chat.exe` and `nexus-agent-tray.exe`.
Client Chat opens a local-only window at `http://127.0.0.1:5967` for client
chat and **Request administrator access**. The companion fingerprints the
selected executable locally, then asks the protected Agent service to forward
only that narrow request through its local broker at `127.0.0.1:5968`.
The long-lived Agent token stays in the protected service configuration; it is
not read by Client Chat, the Tray app or the browser.

The loopback broker is deliberately route-limited, but it is not yet an
OS-authenticated caller boundary. Requests arriving through Client Chat are
therefore forcibly held for technician approval even when an auto-allow policy
matches. Do not use an Agent-side caller as a substitute for Windows
caller-bound IPC; a Windows pilot install/update/rollback drill remains a
release gate.

The installer and managed rollout add **Nexus Client Chat** to the Windows
Start Menu under **NexusMSP**. The tray companion is registered for sign-in so
the user can see Agent status, included services, updates, chat and Elevate
progress. Both companions are deliberately user-session processes: the
background service never injects a GUI into an endpoint user's session.

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
- [x] Phase 4 — Per-client deployment packs, Client Chat and Tray companions
- [~] Phase 5a — Application-level update verification and swap/rollback code paths
- [ ] Phase 5b — Release code signing, MSI builder and staged production rings

Phase 5 is not production-complete until Windows code signing, caller-bound
companion IPC, staged rings, and a retained endpoint update/rollback drill are
in place. An Ed25519 application manifest is integrity logic; it is not a
replacement for Windows Authenticode signing or release provenance.
