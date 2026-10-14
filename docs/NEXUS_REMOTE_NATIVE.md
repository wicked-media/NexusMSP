# Native Nexus Remote — implementation status

Nexus Native is now the only active remote-access path. External provider routes, launch hand-offs and background synchronisation are retired. Historical provider records remain read-only audit or migration evidence and must never authorise a new session.

Implemented: an attended-session authorisation controller in the Go agent runtime, with tenant/device binding, explicit local consent, server-enforced view-only mode and terminal revocation. The server issues ten-minute grants. The verifier supports an append-and-sync replay ledger that survives service restarts and rejects corrupt ledgers. The typed companion coordinator accepts only policy-pinned, agent-delivered grants and reports local consent through the protected agent API. Agent-only transport state can activate a session; the browser cannot. The first relay contract holds one bounded JPEG frame for an active session for two minutes, after which it expires; it is neither a recording store nor a file-transfer path. Windows capture code targets the visible primary desktop only. The unauthenticated local broker deliberately exposes no remote grants or acknowledgement routes; authenticated user-session IPC remains required.

Required before a working native session:

1. **Implemented, not production-certified:** signed, expiring server grants, agent-bound delivery, audit-gated delivery, replay prevention, attended consent, protected user-session IPC and primary-desktop JPEG capture. Further concurrency, signing-key lifecycle and end-to-end revocation validation are required before enabling a pilot.
2. Persistent user-visible stop indicator. An attended local revoke action is implemented as `Ctrl+Shift+F12`; it stops capture, terminally revokes the grant through the protected agent path, ends the session and removes the transient relay frame. The technician viewer also has an audited **End session** action that revokes the server grant; the companion independently discovers that revocation on its protected status check. A service in session zero cannot substitute for the user's desktop session.
3. Secure desktop, secondary monitors and elevated-input handling. Native Remote remains view-only until those controls are explicitly designed and tested.
4. Encrypted authenticated transport, bounded buffers, bandwidth limits, connection timeout and relay deployment. No custom cryptography.
5. Technician viewer resilience and honest connection-state handling. No clipboard or file transfer in the initial attended milestone.
6. Two-machine acceptance tests covering consent denial, expiry, revocation, disconnection, cross-tenant requests, replay and reconnect. Only then enable pilot rollout.

The agent package verifies domain-separated Ed25519 grants with a policy-pinned public key, strict payload shape, bounded lifetime and durable replay rejection. The relay also reserves strictly increasing capture-frame sequence numbers, enforces a bounded frame cadence and refuses stale or replayed frame uploads, so an older capture or a rapid upload burst cannot overwrite or exhaust the technician view. Frames are accepted only after the protected agent has reported an active connected transport; a frame cannot reactivate a disconnected session. An accepted frame refreshes only the matching active session's protected heartbeat, giving the console current companion evidence without trusting the browser. A protected status check that finds a revoked or elapsed grant terminally closes the matching server session and deletes its transient frame. Tests cover tampering, restart-safe replay rejection, tenant binding and mandatory local consent. The server provisions the public trust key through the authenticated agent policy and keeps the matching private key encrypted per platform tenant.

No production remote control, capture engine or relay is claimed by this package.

## Product parity target

Nexus Native should not ship as a thin screen-sharing clone. The first production release must combine the strongest expected remote-support capabilities with Nexus-owned service evidence:

- fast attended and policy-controlled unattended sessions;
- multi-monitor viewing, reboot and reconnect, technician handoff and multi-technician collaboration;
- explicitly authorised clipboard and file transfer, in-session chat, and session recording;
- background diagnostics and repair tools that do not expose the customer's active desktop;
- visible consent, persistent session indication, view-only default and immediate local revocation;
- ticket, Work Session, client scope, technician time and billing evidence retained as one auditable service journey; and
- least-privilege elevation and future credential injection without revealing credentials to technicians.

The build order remains security core → signed Remote Companion → authenticated relay → technician viewer → controlled collaboration and transfer features. Production availability still requires two-machine attended and unattended acceptance, reconnect and relay-failure coverage, cross-tenant isolation, grant replay/revocation tests, and a recorded rollback drill.

## First native control-plane slice

The API now creates encrypted per-tenant Ed25519 trust identities and ten-minute, single-session grants bound to stable tenant, client, device, agent and technician IDs. Enrolled agents can poll only their own pending grants and must acknowledge local acceptance or rejection. Ending the Nexus session revokes the grant. Grant delivery and revocation evidence is retained in MongoDB with a 30-day TTL after expiry.

Only one unexpired native grant may be active for an endpoint at a time. The fleet marks that endpoint as in-session until its current grant is closed or expires, preventing competing attended prompts or captures.

When a session is ended, its grant is revoked rather than reused. That immediately releases the endpoint for a fresh, separately authorised attended request and preserves the original session's audit boundary.

Before issuing a grant, the technician preflight reports the server-checked agent heartbeat and the policy-pinned `native_remote_v1` companion capability. This is evidence from the authenticated control plane, not a browser reachability guess.

The agent runtime capability gate is `native_remote_v1`. Until a signed agent build advertises that capability, the API fails closed with `Remote Companion required`; no external transport fallback is available.

### Standing authorisation (controlled V2 capability)

The source package also defines `native_remote_v2` for **view-only** sessions on
an endpoint with an explicit standing authorisation. It is disabled by default
at both the organisation policy and endpoint setting. Enabling the endpoint
setting requires an administrator acknowledgement, server-side action and
client-scope checks, and records the modifying technician and time. A V2 grant
must contain a signed `consent_required: false` flag; the Companion rejects a
V2 grant without that explicit flag and retains the same expiry, binding,
replay and revocation protections. The endpoint still shows a local active
session notice, identifies the technician and purpose, offers local chat, and
allows the user to stop sharing. This is not enabled for production or pilot
use until the updated signed package is deployed and two-machine acceptance
tests complete.

## Safety and rollback

The executable two-machine pilot checklist and sign-off requirements are in
`docs/NEXUS_REMOTE_PILOT_ACCEPTANCE.md`. Every listed case must pass before a
pilot policy is enabled.

The native viewer defaults to view-only. Browser confirmation cannot activate a native session or start billable time. Late acknowledgements cannot overwrite ended sessions, and grant envelopes are delivered only to the authenticated endpoint, not the technician browser. Portal remote launches return 410 until a native portal journey exists; other portal routes and historical evidence remain available.

The technician viewer presents only recorded service evidence (authorisation, consent, companion acknowledgement, protected transport/capture timestamps and closure). It does not infer endpoint state from browser activity, and clears the desktop image if capture becomes stale, the companion disconnects or the signed session limit elapses.

Risk: removing the external provider means desktop access is unavailable until the native transport is implemented and tested. This change does not uninstall software from managed endpoints or delete historical provider data. Roll back through a reviewed code revert; do not silently restore provider fallback or mutate persistence ownership. New native trust/grant records may remain inert when rolled back.

## User-session companion

`cmd/nexus-remote-companion` is a separate Windows executable. It carries no
agent token: it receives a signed grant and public tenant/device trust policy
from the protected service over a bounded local pipe, shows a topmost attended
consent prompt, then uses the view-only primary-desktop capture path. The agent
checks the installed companion against the SHA-256 pinned in the authenticated
agent policy, then checks the connecting pipe client's executable path and
SHA-256 again before it delivers a grant. It relays only same-session acknowledgement,
transport and bounded-frame messages. The signed installer includes the companion and
registers it at interactive user sign-in. The existing loopback broker is not
reused because it cannot prove the caller is the intended user-session
executable.

During a live session, the endpoint user can press `Ctrl+Shift+F12` to stop
sharing. This is local to the companion, cancels capture before the next frame,
then records a terminal `endpoint_user` grant revocation through the protected
agent channel. The technician viewer cannot reverse that local decision.
