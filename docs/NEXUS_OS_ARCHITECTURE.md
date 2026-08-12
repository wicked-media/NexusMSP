# Nexus OS architecture

## Product definition

Nexus OS is a Linux-based, Nexus-managed operating system programme. It is not a
replacement kernel and it must not claim that every Windows application runs
natively. Nexus owns the managed experience: device identity, policy, updates,
recovery, application delivery and evidence.

The first commercial release is **Nexus OS Edge**: an appliance image for
customer sites. It uses the Nexus Edge enrolment and heartbeat contract already
implemented in Deployment Hub. The future workstation edition is **Nexus OS
Workplace**. Both share identity, policy, update and recovery primitives.

## Windows application compatibility

Nexus OS Workplace supports Windows workloads through deliberately separate
lanes. The catalogue must display the lane selected for each application and
the reason it was selected.

| Lane | Suitable for | Boundary |
| --- | --- | --- |
| Native/PWA | Browsers, SaaS and Linux-native applications | Preferred; no Windows dependency. |
| Wine/Bottles | Tested user-mode Win32 applications | Compatibility is per-app and version-tested; no driver guarantee. |
| Proton | Approved productivity or specialist applications validated for Proton | Not an enterprise compatibility promise by itself. |
| Windows RemoteApp | Applications retained on an approved Windows host/Cloud PC | Requires Windows licensing, a managed host and entitlement. |
| Managed Windows VM | Legacy apps requiring Windows APIs, drivers or isolation | Requires Windows licensing, hardware virtualisation and a supported VM profile. |

Kernel drivers, security products, hardware-management tools and unsupported
legacy software are never silently forced through Wine. They are routed to a
supported Windows lane or marked incompatible.

## Initial technology direction

- **Base**: a Fedora Atomic/ostree-style immutable desktop or appliance base,
  subject to a licensing and hardware-lab decision.
- **Identity**: Nexus device key and certificate; TPM binding and Secure Boot
  evidence are future gates, not assumed from a hostname or container token.
- **Agent**: `nexusd` is a small privileged service. User-facing features use
  authenticated local IPC and least privilege.
- **Applications**: signed Nexus catalogue metadata declares compatibility lane,
  policy, licence prerequisite and rollback behaviour.
- **Updates**: A/B or ostree deployment model, staged rings (lab, canary, pilot,
  production), post-update health checks and automatic rollback.
- **Recovery**: a separate bootable Nexus OS Recovery image with tenant-scoped
  authorisation before restore, remote assistance or secure wipe.

## Nexus OS 0.1 — Edge appliance acceptance slice

The current Deployment Hub and Edge companion provide customer scope, one-time
activation, persistent identity token, outbound heartbeat, declared appliance
roles, resource-aware role planning and a bounded **Site Pulse**. Site Pulse
proves only whether the Edge can resolve and reach its configured Nexus control
plane; it is not evidence that general internet access, a customer LAN or a
business service is healthy. The remaining proof for an actual
Nexus OS Edge image is:

1. Reproducible image build plus SBOM and image signing.
2. First-boot enrolment with hardware identity evidence.
3. Immutable update deployment, signed metadata and rollback drill.
4. Role probes that replace declared intent with health evidence.
5. Offline signed policy cache, event queue and reconciliation.
6. Hardware-lab verification on supported x86_64 devices.

Future Mesh, private access, synthetic journeys, out-of-band recovery and
business-service verification must be implemented as separately authorised
Edge roles with explicit scope, policy, audit evidence and health probes. They
must never be inferred from a successful Site Pulse.

## Nexus Jump: managed local-resource access

Nexus Jump is the planned replacement path for a traditional always-on VPN or
general-purpose jump box. It is intended to provide a constrained path:

`Technician → Nexus identity + MFA → ticket/policy decision → Nexus Edge → one approved local resource`

The current **Nexus Jump gateway** role is only a capacity-planned deployment
role. It does not install a tunnel, proxy a browser, open a firewall, expose a
management interface, or grant remote access. A production implementation must
use proven transport technology, issue short-lived credentials, restrict each
session to a customer, ticket, host, port and protocol, record session audit
metadata, expire access automatically, and provide a customer-controlled kill
switch. Until those controls and their tests exist, unmanaged onsite devices
remain reachable only through their existing approved management path.

This makes the roadmap compatible with Domotz-like local visibility and
gateway-assisted access without overstating the current Edge capability.

### Transport evidence slice

Edge can report whether an explicitly configured local WireGuard interface is
absent, configured without an active peer session, or has an observed
handshake. This is evidence only: Edge never creates an interface, peer, route
or tunnel from an environment variable or a cloud request. The transport
controller, key delivery, peer lifecycle, policy enforcement and revocation
tests remain required before a Jump request can become a real session.

No appliance may be described as Nexus OS, Secure Boot protected, TPM-bound,
signed-update protected or rollback capable before these tests and device
evidence exist.

## Nexus OS 0.2 — Workplace compatibility acceptance slice

1. Boot a branded immutable desktop in a test VM.
2. Enrol into Nexus and apply a user/device policy.
3. Install one approved PWA, one Linux-native application and one Wine/Bottles
   application from the catalogue.
4. Launch one licensed Windows RemoteApp or Windows VM workflow.
5. Capture compatible/incompatible outcome and support evidence in Nexus.
6. Perform an update and recovery rollback test without losing enrolment.

## Programme boundary

Nexus OS is a separate product programme with its own image repository,
signing keys, release process, hardware lab and support matrix. The NexusMSP
repository remains the control plane and source of deployment, policy and
evidence contracts.
