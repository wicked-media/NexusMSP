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

The user has explicitly chosen to retire RustDesk now and build a native
Nexus transport. External provider routes and launch handoffs are disabled;
historical records remain evidence only. There is currently no working native
screen transport. The governed session record remains a Nexus
`remote_sessions` document.

## What is available now

- Nexus Remote workspace at `/nexus-remote`, with `/remote-access` retained for
  existing deep links.
- A native-only fleet readiness and session-evidence workspace.
- Server-side target scope checks, consent, purpose, idempotency, ticket/Work
  Session binding and audit events. Browser confirmation cannot activate native sessions.
- Agent-backed capability readiness, signed grant issuance and endpoint delivery.
- Go grant verification, local-consent state and restart-persistent replay protection.

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

- External providers are retired by explicit product decision. Do not silently
  restore them as a fallback. Do not delete historical evidence or uninstall
  endpoint software as a side effect of API retirement.
- Keep all remote business logic in the Nexus API/domain layer. Browser code
  must not compose transport state with client records or own sensitive tokens.
- `remote_sessions` remains the authoritative session-evidence store. Provider
  peer status is derived operational evidence only.
- Any new relay, certificate, recording or transfer persistence must receive an
  explicit entry in `docs/DATA_OWNERSHIP.md` before implementation.
- No remote command, access token, customer credential or private connection
  URL may be logged or returned to an unauthorised browser.
