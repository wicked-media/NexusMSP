# Nexus Remote product boundary

## Product intent

Nexus Remote is the first-party **remote-support control plane**. It gives a
technician one governed journey from a Nexus ticket or managed asset through
endpoint readiness, customer consent, authorisation, connection evidence,
outcome and time. The product must never pretend that a protocol hand-off is
proof of a successful screen connection.

Nexus owns:

- client and device scope;
- technician identity, permissions and policy;
- ticket and Work Session context;
- consent, purpose, approval and session lifecycle evidence;
- time, ticket notes, activity records and platform events; and
- endpoint readiness and safe repair requests through Nexus Agent.

The current screen transport is explicitly a RustDesk adapter. RustDesk is not
the Nexus business model or source of truth: it carries pixels and input while
the governed session record remains a Nexus `remote_sessions` document. The
same boundary allows approved providers to be replaced without changing ticket
or billing behaviour.

## What is available now

- Nexus Remote workspace at `/nexus-remote`, with `/remote-access` retained for
  existing deep links.
- A provider-neutral fleet, transport registry, connector, live-peer and
  session-evidence workspace.
- Server-side target scope checks, consent, purpose, idempotency, ticket/Work
  Session binding, audit events and explicit "connection opened" confirmation.
- Agent-backed remote-health checks and repair queues.
- A RustDesk transport adapter whose credentials remain server-side and whose
  live probe accepts only an approved saved configuration.

## What is not claimed yet

Nexus does **not** yet have a production-owned screen-capture/input transport,
native technician viewer, relay, recording pipeline, file-transfer engine or
unattended-access vault. The UI must describe these as transport capability
gaps, not as features already delivered.

## Safe path to a Nexus-native transport

1. **Agent capability contract** — Extend the deployed Nexus Agent with an
   explicit, signed capability attestation for an optional Remote Companion.
   The agent only reports whether the companion is installed, healthy and
   eligible; it never accepts a browser-supplied shell command or token.
2. **JIT broker** — Introduce a server-side session broker that issues a short
   lived, one-time, ticket/device/technician-bound capability after the existing
   Nexus policy and consent checks. Device certificates, expiry, nonce replay
   protection and revocation are required.
3. **Native companion and viewer** — Build capture/input and clipboard/file
   features as a signed native component, starting attended-only. Screen and
   input controls must run with the least privilege required for the active OS
   session. Do not expose an unauthenticated local listener.
4. **Relay and audit** — Add mutually authenticated relay paths, connection
   health, explicit session open/close evidence and a recording policy. A relay
   is a transport component, not a bypass around Nexus permissions.
5. **Controlled rollout** — Internal → pilot tenants → production. Require
   two-client isolation tests, revoked-token tests, connection failure tests,
   attended/unattended policy tests, and support evidence before enabling the
   feature broadly.

## Engineering rules

- Preserve provider adapters during a staged rollout; do not break existing
  RustDesk sessions to introduce branding.
- Keep all remote business logic in the Nexus API/domain layer. Browser code
  must not compose transport state with client records or own sensitive tokens.
- `remote_sessions` remains the authoritative session-evidence store. Provider
  peer status is derived operational evidence only.
- Any new relay, certificate, recording or transfer persistence must receive an
  explicit entry in `docs/DATA_OWNERSHIP.md` before implementation.
- No remote command, access token, customer credential or private connection
  URL may be logged or returned to an unauthorised browser.
