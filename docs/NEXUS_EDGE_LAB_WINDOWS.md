# Nexus Edge lab on Windows

Use this short-lived foreground workflow to test Nexus Edge on an existing
Windows computer without Docker, a VM image, a scheduled task, or a service
installation.

## Before starting

1. Start Nexus locally with `Restart-Nexus.cmd` or deploy it to a reachable
   test control-plane URL.
2. In **Deployment Hub**, prepare an **Edge** for the test client and select
   the required roles. For the first lab use `Discovery probe`, `Network
   monitor`, and optionally `Nexus Jump gateway`.
3. Download the bundle and copy the one-time activation code. Treat that code
   as a secret; it expires and cannot be recovered.
4. Ensure Go is installed on the test computer. The launcher builds the local
   Edge executable from this checked-out source.

## Start the Edge lab session

Run PowerShell from the repository root:

```powershell
.\scripts\Start-NexusEdgeLab.ps1 `
  -ControlPlaneUrl "http://127.0.0.1:8000" `
  -DeploymentId "YOUR_DEPLOYMENT_ID" `
  -ActivationCode "YOUR_ONE_TIME_ACTIVATION_CODE"
```

The process stays visible in the terminal. On its first successful heartbeat,
Deployment Hub will show the Edge as authenticated and online. Its identity is
persisted under `%LOCALAPPDATA%\NexusMSP\EdgeLab` rather than in the source
tree.

## Current boundaries

- No inbound firewall rule, public listener, remote-control tunnel, or WireGuard
  interface is created.
- A role is only declared or reports its narrow evidence. The active `Network
  monitor` role observes Edge-to-control-plane connectivity.
- Ticket-bound connectivity checks can run only after the Edge is active.
- Live subnet discovery remains intentionally unavailable until the agent-side,
  rate-limited discovery dispatcher and its approval/audit path are implemented.

Delete `%LOCALAPPDATA%\NexusMSP\EdgeLab\state.json` only when retiring this
lab identity. Do not reuse the state directory for another deployment.
