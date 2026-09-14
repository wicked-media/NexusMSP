# Native Nexus Remote — implementation status

Existing remote access delegates transport to external providers. Preserve it until native acceptance tests pass. Do not present a native Connect action as available yet.

Implemented: local, in-memory attended-session authorisation controller in the existing Go agent runtime, with tenant/device binding, one-hour maximum grant lifetime, explicit local consent, view/control separation and terminal revocation. This isolated package has no capture, network or input side effects and is not yet wired into the agent. Removing it is the rollback; existing provider behaviour is unchanged.

Required before a working native session:

1. Signed, expiring server grants and replay prevention tied to authenticated agent identity; permission, tenant/client and ticket checks with durable session audit.
2. Interactive Windows companion with genuine local consent and a persistent stop indicator. A service in session zero cannot substitute for the user's desktop session.
3. Screen capture and input adapter, checking authorisation on every operation. Secure desktop and elevated input remain unsupported until explicitly designed and tested.
4. Encrypted authenticated transport, bounded buffers, bandwidth limits, connection timeout and relay deployment. No custom cryptography.
5. Technician viewer with honest connection state and view-only default. No clipboard or file transfer in the initial attended milestone.
6. Two-machine acceptance tests covering consent denial, expiry, revocation, disconnection, cross-tenant requests, replay and reconnect. Only then enable pilot rollout.

The agent package now also verifies domain-separated Ed25519 grants with a pinned public key, strict payload shape, bounded lifetime and process-local replay rejection. Tests cover tampering, replay, tenant binding and mandatory local consent. No signing service or trust-key provisioning is wired yet. Replay records are memory-only and do not survive restart, so production rollout remains blocked until durable replay protection is integrated.

No production remote control, capture engine or relay is claimed by this package. Persistence remains unchanged.

## Product parity target

Nexus Native should not ship as a thin screen-sharing clone. The first production release must combine the strongest expected remote-support capabilities with Nexus-owned service evidence:

- fast attended and policy-controlled unattended sessions;
- multi-monitor viewing, reboot and reconnect, technician handoff and multi-technician collaboration;
- explicitly authorised clipboard and file transfer, in-session chat, and session recording;
- background diagnostics and repair tools that do not expose the customer's active desktop;
- visible consent, persistent session indication, view-only default and immediate local revocation;
- ticket, Work Session, client scope, technician time and billing evidence retained as one auditable service journey; and
- least-privilege elevation and future credential injection without revealing credentials to technicians.

The build order remains security core → signed Remote Companion → authenticated relay → technician viewer → controlled collaboration and transfer features. The current compatibility bridge may only be removed after two-machine attended and unattended acceptance, reconnect and relay-failure coverage, cross-tenant isolation, grant replay/revocation tests, and a recorded rollback drill all pass.
