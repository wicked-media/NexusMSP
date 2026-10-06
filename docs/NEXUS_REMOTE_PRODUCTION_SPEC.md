# Nexus Remote Production Specification v1

Status: proposed specification. Supersedes nothing; it is the buildable layer
beneath `docs/NEXUS_REMOTE_PRODUCT.md` (product boundary),
`docs/NEXUS_REMOTE_NATIVE.md` (implementation status) and
`docs/NEXUS_REMOTE_PILOT_ACCEPTANCE.md` (pilot gate). Where this document and
those conflict about *current capability*, those documents and the code are
authoritative and this document is wrong.

This document is a plan, not a capability claim. Read
[Current state](#2-current-state) before quoting anything here to a customer.

---

## 1. Product objective

Do not build software that lets a technician see another computer. Build
software that understands what the technician is trying to accomplish on that
computer.

The differentiator is not "remote control with AI". Screen sharing is
commodity, and post-session AI summarisation is already shipping elsewhere. The
defensible asset is a closed loop the platform already has the raw material for:

```
technician works  ->  Nexus records authorised operational context
                  ->  outcome is verified
                  ->  knowledge is retained as a durable object
                  ->  the next repair starts smarter
                  ->  a repeated repair becomes a reviewed recipe
                  ->  a recipe becomes staged fleet remediation
```

The ticket stays at the centre of that loop, so ownership, communication, SLA,
evidence, time and billing remain intact.

Honest qualification, stated once and carried through this document: no
combination here can be proven unique — no one can guarantee a particular idea
has never been conceived elsewhere. What can be built and defended is the
*execution model*: the specific combination of governed session evidence, a
retained repair record, durability scoring, and tenant-isolated learning. Every
section below is written to make that combination real, testable and hard to
reproduce piecemeal.

Non-goals for this specification:

- Reintroducing a retired external provider as a fallback
  (`docs/NEXUS_REMOTE_PRODUCT.md` Engineering rules).
- Covert or "stealth" remote access. Every path is visible, consented and
  audited.
- Letting a model hold or use a privileged transport or execution credential.

---

## 2. Current state

### Implemented and exercised in code

| Capability | Where |
| --- | --- |
| Governed session record (authoritative lifecycle) | `remote_sessions`; `backend/app/services/native_remote.py` |
| Per-tenant encrypted Ed25519 trust identity | `settings` document `type: native_remote_trust`; `signing_identity()` |
| Short-lived, single-session, multi-ID-bound grants | `native_remote_grants`; `GRANT_DOMAIN`, `ATTENDED_GRANT_TTL_HOURS` |
| Agent-only grant delivery + local acceptance/rejection | `GET /nexus-agent/native-remote/grants/pending`, `.../grants/{session_id}/ack` |
| Companion fail-closed status check | `GET /nexus-agent/native-remote/grants/{session_id}/status` |
| Authenticated transport evidence (`connected` / `disconnected`) | `POST .../grants/{session_id}/transport` |
| Bounded view-only JPEG relay with strict sequence reservation and 2-minute TTL | `native_remote_frames`; `NATIVE_REMOTE_FRAME_STALE_SECONDS = 20` |
| Typed, bounded control envelopes (pointer/key), ordered, 20s TTL, acked | `native_remote_control_events`; `NativeControlEvent` |
| Endpoint-owned terminal stop | `POST .../grants/{session_id}/stop` |
| Viewer read path with server-side scope checks | `GET /remote/sessions/{session_id}/native-frame` |
| Display topology evidence (rectangles only) | `NativeDisplayInfo`; `X-Nexus-Remote-Displays` |
| Companion health attestation | `POST /nexus-agent/native-remote/health` |
| Standalone Windows companion process, hash-pinned by agent policy | `agent/cmd/nexus-remote-companion` (see `docs/NEXUS_REMOTE_NATIVE.md`) |
| Go grant verification, local consent, restart-safe replay ledger | `agent/internal/nexusremote` (see `docs/NEXUS_REMOTE_NATIVE.md`) |
| Technician workspace, viewer, session evidence, studio preferences | `frontend/src/pages/NativeRemoteAccessPage.jsx`, `frontend/src/lib/remoteSessionStudio.js` |
| Deep-link entry from device/ticket surfaces | `frontend/src/components/devices/RemoteAccessButton.jsx` |

### Explicitly NOT claimed

- No production-certified remote control. Interactive input code exists but the
  shipped gate is **attended, view-only** (`docs/NEXUS_REMOTE_PILOT_ACCEPTANCE.md`).
- No hardware-accelerated capture, no real codec pipeline (frames are bounded
  JPEG), no adaptive bitrate, no audio.
- No multi-monitor capture beyond the bounded display-topology list; Windows
  capture targets the visible primary desktop.
- No secure-desktop / UAC / secondary-monitor / elevated-input handling.
- No native file-transfer engine, no clipboard sync, no recording pipeline, no
  searchable recordings.
- No unattended-access vault enabled by default (`native_remote_v2` is
  implemented but disabled pending two-machine acceptance).
- No Nexus Edge relay, no regional relay fleet, no route selection.
- No Session Brain, Repair Genome, durability scoring or fleet remediation
  wired into the remote path.
- No cross-tenant or ecosystem learning export is enabled.

### Adjacent primitives that already exist and must be reused, not duplicated

This is the most important line in the document. Several ideas in the vision are
already owned by existing collections. Re-implementing them is a release
blocker (AGENTS.md: one datum has one authoritative owner).

| Vision idea | Existing owner | Do not create |
| --- | --- | --- |
| Session Brain hypotheses, "Next Best Test", posterior recalculation | `investigations` (`backend/app/services/*` diagnostic investigations) | a second posterior store |
| "Teach Nexus by Doing" / Show Nexus Once | `recorded_sessions` (append-only redacted steps) | a new session-capture collection |
| Verified repair recipe / Recipe generation | `recorded_runbooks` (prerequisites, variables, actions, verification, rollback, `verified-success count`, `use count`, autonomy-candidate flag) | a new recipe collection |
| Durability scoring | extend `recorded_runbooks` counters + ticket recurrence evidence | a parallel "repair score" store |
| Fleet matching / "81 endpoints show this state" | `fleet_object_sets` (frozen membership) + `device_state_declarations` / `drift_findings` | an ad-hoc device query store |
| Automatic work journal / evidence packs | `operation_evidence` + `evidence_packs` (per-tenant hash chain) | a second evidence log |
| "What changed?" inside a session | Client Timeline / What Changed (derived, no persisted timeline) | a session-local timeline collection |
| Ecosystem / emerging-vendor-problem intelligence | `genome_patterns` (one-way fingerprints, `MIN_CLUSTER`) | any new cross-tenant store |
| Out-of-band recovery planning | `rescue_sessions` | an "IPMI/vPro" side table |
| Execution permission for any repair | `operational_mode_state` | a session-local permission flag |
| Approvals / consent receipts / risk acceptance | `decision_family` | a session-local approval record |
| Usage economics | `usage_meter_events`, `ledger_entries` | a session-local meter |

---

## 3. RustDesk reuse / retire analysis

The self-hosted RustDesk base was retired as the transport by explicit product
decision (`docs/NEXUS_REMOTE_PRODUCT.md`). This section records what is worth
carrying forward as **design precedent** and what replaces it. Nothing here
describes current capability.

| Concept from the self-hosted RustDesk model | Decision | Rationale |
| --- | --- | --- |
| Rendezvous / signalling separated from relay | **Retain as precedent** | The split is correct and is adopted: Nexus issues grants (signalling) independently of the relay that carries bytes. |
| Self-hosted relay topology | **Retain as architecture, replace the implementation** | Nexus Relay must be a Nexus component bound to Nexus grants; the current bounded JPEG relay is the pre-production seed of it. |
| Broad client-platform coverage | **Retain as a requirement** | Windows first (agent + companion exist); macOS/Linux are backlog items, not assumptions. |
| Direct-connect-first, relay-fallback | **Retain as a target** | Route ladder in [Session protocol](#5-session-protocol--transport). |
| Unattended access by stored credential | **Replace** | Replaced by `device_unattended_access_*` standing authorisation plus a signed `consent_required: false` V2 grant that is off by default. |
| Per-peer identity keys | **Replace** | Replaced by Nexus per-tenant Ed25519 trust identities and device-bound grants. |
| Session recording to local storage | **Replace** | Must be a governed Nexus recording pipeline with policy, retention and scope; not a local file. |
| Clipboard/file transfer over the peer channel | **Replace** | Must be an authorised Nexus transfer with provenance evidence; the peer channel never carries transfers directly. |
| Idle client UI branding | **Do not retain** | Nexus owns the identity and consent surface on both ends. |
| Third-party update path in the transport | **Do not retain** | Nexus Agent owns signed updates and release rings; the transport does not self-update. |
| Provider fallback if native fails | **Do not retain** | Fails closed. Restoring a retired provider silently is forbidden. |

---

## 4. Component model

```
                          NEXUS REMOTE
                     ┌───────────────────┐
                     │  Session Broker   │  (Nexus API, in-process today)
                     └─────────┬─────────┘
                               │ grants, not bytes
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        Rendezvous        Regional Relay     Nexus Edge
      (grant delivery)   (transport, later)  (on-site, later)
              │                │                │
              └────────────────┼────────────────┘
                               ▼
                        Endpoint Agent  (Go, enrolled)
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
  Screen Capture        Background API          File Engine
  Input Injection       Shell/Services          Transfer
  Audio (later)         Registry/Eventlog       Cache (later)
        │                      │                      │
        └──────────────────────┼──────────────────────┘
                               ▼
                      Session Event Bus
                    (platform_events today)
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
    Evidence              Ticketing              Session Brain
  (operation_evidence)   (tickets, time)      (investigations)
        └──────────────────────┼──────────────────────┘
                               ▼
                         Repair Genome
                       (recorded_sessions,
                        recorded_runbooks)
                               │
                               ▼
                        Learning Engine
                        (genome_patterns,
                          fleet_object_sets)
```

### Components and ownership

| Component | Responsibility | Today | Store |
| --- | --- | --- | --- |
| **Session Broker** | Authorise a session; bind tenant/client/site/device/agent/actor/ticket; issue and revoke grants; own lifecycle | In `backend/app/services/native_remote.py` + `backend/app/routers/native_remote.py` | `remote_sessions`, `native_remote_grants` |
| **Rendezvous (grant delivery)** | Deliver the signed one-time grant to the enrolled endpoint only | Implemented (agent pull) | Delivery evidence on `native_remote_grants` |
| **Regional Relay** | Carry captured frames/streams between endpoint and viewer; measure route health | Partial: single bounded JPEG relay | `native_remote_frames` |
| **Nexus Edge** | On-site relay/cache/WoL/pre-login assistance | Not built (Edge control plane exists separately) | `nexus_edge_*` |
| **Endpoint Agent** | Authenticate, verify grants, enforce policy/consent/replay, report capability and transport evidence | Go, implemented | `nexus_agents`, `nexus_agent_commands` |
| **Remote Companion** | User-session capture/input, consent prompt, local stop | Go, implemented (attended) | Local; policy-pinned hash |
| **Screen Capture** | Frame production, dirty-region/change detection, codec selection | Primary-desktop JPEG only | ephemeral |
| **Background API** | Services, processes, events, registry, software, updates, network, printers — behind the agent, no desktop exposure | Adjacent agent capabilities exist; not exposed as a remote workspace | `nexus_agent_commands`, `terminal_sessions` |
| **File Engine** | Resumable, parallel, provenance-carrying transfer | Agent file transfers exist for a different surface; not wired to remote | `agent_file_transfers` |
| **Session Event Bus** | Ordered session events | `platform_events` + session fields | `platform_events`, `remote_sessions` |
| **Evidence** | Verifiable proof of what an operation achieved | `operation_evidence`, `evidence_packs` | per-tenant hash chain |
| **Ticketing / time** | Ticket binding, notes, labour | `tickets`, `time_entries` | authoritative |
| **Session Brain** | Hypotheses, next best test, "what changed" | `investigations` (unwired to remote) | authoritative for posteriors |
| **Repair Genome** | Structured record of symptom→cause→action→verification→durability | `recorded_sessions`, `recorded_runbooks` | authoritative |
| **Learning Engine** | Pattern detection, recipe promotion, precursor matching | `genome_patterns`, `fleet_object_sets` | derived, tenant-isolated |

### Trust boundary (non-negotiable)

```
   UNTRUSTED            TRUSTED                  PRIVILEGED
   browser  ───────▶  Nexus API  ───────▶  Agent + Companion  ──▶ endpoint OS
   (never a token)     (authorises,         (verifies signature,
                        audits, scopes)      owns consent, injects)

   ADVISORY (outside the privileged boundary):
   Session Brain / models  ──propose──▶  Guardian  ──authorise──▶  deterministic
                                        (policy,               executor (typed,
                                         decision_family)       bounded, audited)
                                                                       │
                                                                       ▼
                                                                  Evidence
                                                                  (verified)
```

The rule, in one line:

> **AI proposes → Guardian authorises → a deterministic execution service performs
> the privileged action → Evidence verifies.**

Consequences that must hold in every implementation:

1. No model output is ever a credential, a grant, a command string or a file path
   handed to a transport.
2. The browser never composes transport state and never receives a grant, a
   token or a customer credential.
3. A repair proposal is a *plan object* with preconditions, expected
   interruption, rollback and verification, and it is inert until a human (or a
   policy that explicitly names the plan) approves it.
4. `operational_mode_state` gates every execution path, including proposed ones.
5. Guardian verdicts are recorded in `decision_family`, not in the session.

---

## 5. Session protocol & transport

### Capability negotiation

Both ends advertise and intersect:

| Layer | Preference order | Fallback |
| --- | --- | --- |
| Video codec | AV1 → H.265 → H.264 → bounded JPEG | JPEG (today's only implemented path) |
| Acceleration | hardware encode/decode → software | software |
| Audio | Opus low-latency | none (no audio today) |
| Transport | direct P2P → site relay → regional relay → alternate relay | fail closed |

A session must never *assume* a layer. The negotiated set is recorded as session
evidence so a technician can see why quality differs between endpoints.

### Adaptive pipeline

```
Capture → Change detection → GPU preprocessing → Adaptive encoder
   → Transport → Jitter/congestion control → Decoder → GPU render
```

Adaptation inputs (all already observable or cheap to observe): RTT, packet loss,
encode time, decode time, dropped frames, relay load, route (direct/relay).
Adaptation outputs: codec, resolution, frame rate, region priority.

### Route selection and failover

Ladder, chosen continuously from measured latency, loss, relay load, geography
and policy:

```
DIRECT P2P → SITE EDGE RELAY → REGIONAL NEXUS RELAY → ALTERNATE RELAY
```

Failover must not kill an attended session where technically possible. A route
change is event evidence (`remote.session.route.changed`) and is visible in the
session timeline.

### Semantic quality (R&D)

Treat regions differently: text is readability-critical, video is
motion-critical, static wallpaper is irrelevant. Under constrained bandwidth,
keep text sharp and let the wallpaper degrade. Not in Remote 1.0.

### Reconnect and network change

Reconnect requires a fresh, protected transport before a new frame is trusted
(already enforced). Network change handling (interface switch, address change,
NAT rebind) is a Remote 2.0 item.

### Out-of-band (longer term)

Safe mode, pre-login, recovery environment, Intel vPro/AMT and BMC/IPMI belong
to `rescue_sessions` planning and a separate privileged adapter. They are not a
bypass: they are a separate governed capability with their own acceptance gate.

---

## 6. Data & schemas

Ownership follows AGENTS.md and `docs/DATA_OWNERSHIP.md`. **One datum, one
authoritative owner.** `docs/DATA_OWNERSHIP.md` already carries a
"Nexus Native Remote trust, grants and transport evidence" row; this
specification requires that row to be extended — the exact follow-up is listed
in [Required ownership follow-up](#required-ownership-follow-up). Do not edit
that registry as a side effect of implementing this spec; it is its own change.

### Existing collections (authoritative today)

| Collection | Owns | Key fields | Indexes | TTL |
| --- | --- | --- | --- | --- |
| `remote_sessions` | Session lifecycle, transport state, consent/closure evidence | `id`, `tenant_id`, `client_id`, `site_id`, `device_id`, `user_id`, `ticket_id`, `status`, `provider: nexus`, `purpose`, `mode`, `transport_state`, `started_at`/`ended_at`, `launch_status`, `companion_*`, `last_control_input_*`, `last_heartbeat_at` | tenant + status/dates | retained evidence |
| `native_remote_grants` | Grant issue/delivery/ack/revocation evidence | `id`, `tenant_id`, `session_id`, `device_id`, `client_id`, `agent_id`, `actor_id`, `key_id`, `mode`, `status`, `expires_at`, `revoked_at`, `purge_at` | unique (tenant, session); (tenant, device, status, expires) | purge +30 days after expiry |
| `native_remote_frames` | Latest bounded JPEG view only | `tenant_id`, `session_id`, `device_id`, `client_id`, `sequence`, `jpeg`, `displays[]`, `updated_at`, `purge_at` | unique (tenant, session) | 2 minutes |
| `native_remote_control_events` | Ordered, short-lived typed input delivery | `tenant_id`, `session_id`, `agent_id`, `device_id`, `actor_id`, `sequence`, `payload`, `expires_at`, `purge_at` | unique (tenant, session, sequence) | grant-bounded / 20s |
| `settings` (`type: native_remote_trust`) | Per-tenant encrypted signing identity | encrypted private key, public key, `key_id` | unique partial | retained |
| `settings` (`type: remote_access_policy`) | Remote policy configuration | policy flags | unique partial | retained |
| `devices.remote_unattended_access_*` | Endpoint standing-authorisation state | enabled flag, acknowledged by/at | on `devices` | retained |
| `remote_studio_preferences`, `remote_studio_usage` | Per-technician layout preference and per-tool counters | stable user ID, counters | tenant + user | retained |

### Reused collections for the vision (do not duplicate)

`investigations`, `recorded_sessions`, `recorded_runbooks`, `operation_evidence`,
`evidence_packs`, `fleet_object_sets`, `device_state_declarations`,
`drift_findings`, `genome_patterns`, `rescue_sessions`,
`operational_mode_state`, `decision_family`, `usage_meter_events`,
`ledger_entries`, `platform_events`, `time_entries`, `tickets`.

### Proposed additions (each requires an ownership entry before implementation)

These are proposals, deliberately minimal. Anything an existing owner can carry
must be carried there instead.

| Proposed datum | Proposed owner | Why it cannot live elsewhere |
| --- | --- | --- |
| Session recording artifact + index | New `remote_recordings` (metadata) + private binary artifact store | A recording is neither a frame cache nor an evidence pack; retention and playback policy differ. Requires an explicit retention/jurisdiction decision. |
| Session chapter markers | Embedded in `remote_recordings` | Derived from session events; must not become a second event log. |
| Transfer provenance | Extend `agent_file_transfers` (`session_id`, `transfer_reason`, `approval_ref`, `direction`) | Ownership already exists; extension only. |
| Standing-authorisation change history | Extend `decision_family` (kind `consent_receipt`) | Governance already owns approvals and receipts. |
| Relay/route health samples | `platform_events` (bounded, aggregated) or Prometheus only | Must not become business records; telemetry retention rules apply. |
| Session risk score | Derived, not persisted (or bounded snapshot if retention is approved) | Derived views recompute from evidence; persisting a score invites it being treated as truth. |

### Event contracts

Names below are proposed for the `Session Event Bus`; each is a
`platform_events` entry with the stated payload thesis. Events are evidence of
what was observed, never authority to act.

| Event | Payload thesis |
| --- | --- |
| `remote.session.authorised` | session, tenant, client, site, device, actor, ticket, purpose, mode |
| `remote.grant.issued` / `.delivered` / `.acked` / `.rejected` / `.revoked` | grant ref, reason, actor kind (server/agent/endpoint_user) |
| `remote.session.transport.connected` / `.disconnected` | reported state, detail, timestamp |
| `remote.session.route.changed` | from-route, to-route, measured latency/loss |
| `remote.session.control.event_batch` | count, first/last sequence (never key content) |
| `remote.session.capture.stale` | last accepted sequence, staleness age |
| `remote.session.ended` | end reason, duration, evidence refs |
| `remote.session.evidence.captured` | evidence pack ref, hash root |
| `remote.repair.proposed` | plan ref, source session, target set, risk, rollback availability |
| `remote.repair.approved` / `.declined` | decision ref in `decision_family`, actor |
| `remote.repair.executed` | plan ref, outcome, verification result |
| `remote.repair.durability.observed` | bucket (immediate/24h/7d/30d), outcome |
| `remote.recipe.verified` / `.promoted` | runbook ref, verified-success count |
| `remote.fleet.precursor.matched` | object set ref, member count, unavailable count |

Payloads must exclude: key content, clipboard content, file paths, credentials,
private URLs and any cross-tenant identifier.

### Required ownership follow-up

Before implementation of any proposed datum in this section, add or extend the
relevant row in `docs/DATA_OWNERSHIP.md`:

- extend the existing **Nexus Native Remote trust, grants and transport
  evidence** row to name the relay route-evidence classification; and
- add a row for the recording metadata + private binary artifact, its retention
  policy, and the explicit statement that it is never served from a public path.

---

## 7. Permissions & governance

| Control | Requirement |
| --- | --- |
| Session purpose | Every session carries a purpose (ticket, maintenance, incident, security response, approved administrative work). High-risk environments may require one; an empty "because I could" session is refused. |
| Server-side scope | Tenant, client and site scope rechecked on every read and write, including the frame read path. Frontend filtering is never a control. |
| Consent | Attended sessions require endpoint-local consent. Standalone (V2) standing authorisation is off by default, requires an admin acknowledgement recorded with actor and time, and requires a signed `consent_required: false` flag the companion independently validates. |
| Local stop | Endpoint-owned `Ctrl+Shift+F12` (companion) and the audited technician **End session** action both terminally revoke. The technician cannot reverse an endpoint stop. |
| JIT privilege | Elevation is requested, not assumed: Nexus Elevate / Guardian evaluate technician permission, customer policy, ticket context and requested operation, then issue a scoped, expiring decision. Credentials are never disclosed to a technician. |
| Step-up | Elevated or high-risk actions may require step-up MFA or second approval via `decision_family`. |
| Session risk score | Derived in real time from verified factors (ticket attached, endpoint managed, consent recorded, privileged-action count, sensitive transfer count, out-of-hours). Crossing a policy threshold triggers a step-up requirement, never an automatic block without evidence. |
| Recording | Governed by policy, never default-on. Visible indication required. Missing policy means no recording. |
| Retention | Every new artifact states its retention. Frames are minutes; grants purge 30 days after expiry; control events are seconds; recordings follow an explicit, jurisdiction-aware policy. |
| Audit | Grant lifecycle, consent, transport transitions, control batches, transfers, approvals and AI involvement are all auditable with actor and timestamp. |
| Tenant isolation | Cross-tenant access is a release blocker. Every new path needs an isolation test. |

---

## 8. APIs

Conventions: thin routes; reusable policy in services; server-side scope;
idempotency where a caller can retry; no secret in any response.

### Implemented today (see `backend/app/routers/native_remote.py`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/devices/{device_id}/native-remote/readiness` | Server-checked readiness + policy-pinned companion capability |
| POST | `/nexus-agent/native-remote/health` | Companion readiness attestation (agent-authenticated) |
| GET | `/nexus-agent/native-remote/grants/pending` | Pull the next still-valid grant (endpoint only) |
| POST | `/nexus-agent/native-remote/grants/{session_id}/ack` | Record local acceptance/rejection |
| GET | `/nexus-agent/native-remote/grants/{session_id}/status` | Fail-closed revocation check |
| POST | `/nexus-agent/native-remote/grants/{session_id}/transport` | Report transport state (agent only) |
| POST | `/nexus-agent/native-remote/grants/{session_id}/frame` | Replace the bounded latest frame |
| GET | `/nexus-agent/native-remote/grants/{session_id}/control-events` | Bounded input batch (agent only) |
| POST | `/nexus-agent/native-remote/grants/{session_id}/control-events/{sequence}/ack` | Acknowledge a delivered input event |
| POST | `/nexus-agent/native-remote/grants/{session_id}/stop` | Endpoint-owned terminal stop |
| POST | `/remote/sessions/{session_id}/native-input` | Queue one typed control event (requires `device.remote.control`) |
| GET | `/remote/sessions/{session_id}/native-frame` | Latest frame for an authorised viewer |

### Proposed route groups

Only the outline is fixed here; field-level contracts belong in the
implementation tickets. Each group follows the existing scope and audit rules.

| Group | Intended surface |
| --- | --- |
| Session lifecycle | Create/authorise, list scoped sessions, get session evidence, end session (audited), revoke grant |
| Session context | Session summary (ticket, device, client, user, previous related sessions), "what changed" (derived), timeline |
| Workspace (background) | Agent-backed services/processes/events/registry/software/updates/network operations — every call a scoped agent command |
| Files | List/read/write/transfer with provenance, approval and retention; resumable and honouring policy |
| Evidence | Capture screenshot evidence into a pack; download evidence through a scoped route only |
| Brain | Hypotheses, next best test, similar past incidents (read-only advisory) |
| Repair | Propose plan, approve/decline (via `decision_family`), execute (deterministic), verify, durability observation |
| Fleet | Precursor match for an object set; staged remediation with canary gates |
| Recordings | Policy, start/stop, metadata, chapters, search, scoped playback |

---

## 9. UI screens

### Smart Canvas (the default remote desk)

```
┌─────────────────────────────────────────────────────────────┐
│ ACME › Sarah › LT-041              INC-18441       18ms  ●  │
├─────────┬─────────────────────────────────────┬─────────────┤
│ DEVICE  │                                     │ NEXUS BRAIN │
│ CPU 21% │        REMOTE DESKTOP               │ 88% likely  │
│ RAM 67% │                                     │ VendorSvc   │
│ Disk 81%│                                     │ NEXT TEST   │
│ Net ✓   │                                     │ Event Log   │
├─────────┴─────────────────────────────────────┴─────────────┤
│ Files │ Shell │ Services │ Events │ Registry │ Network     │
├─────────────────────────────────────────────────────────────┤
│ ● Recording | Ticket linked | Evidence 7 | Risk LOW        │
└─────────────────────────────────────────────────────────────┘
```

Rules: the freshness badge is honest (no frame ⇒ no image, never a stale one);
the risk indicator is derived and cites its factors; every panel names the store
it read from.

### Multi-monitor

- **Monitor strip**: every remote display as a draggable tile — drag any remote
  monitor onto any local monitor.
- **Auto Map**: remembers a technician's arrangement per device class, offered
  as "Restore Aaron's workspace?" — never applied silently.
- **Focus mode**: one display at full fidelity, others as live thumbnails.
- **Wall mode**: an N×M grid of live displays.
- **Application focus**: target "Outlook" rather than "Monitor 2"; Nexus finds
  the window wherever it moves. (Requires window-tree capture; not in Remote 1.0.)

### Shadow Workspace (background, no desktop exposure)

Native Nexus interfaces over management APIs for: terminal, PowerShell,
services, processes, event viewer, registry, device manager, software, updates,
scheduled tasks, users, network, firewall, certificates, drivers, printers,
environment variables, file explorer. Never a re-hosted native Windows tool.

### Smart File Explorer

Multi-pane (local, remote, Nexus Vault, another managed endpoint, Nexus Toolbox)
so `SERVER01 → LT-041` transfers without touching the technician's machine.
Resumable, parallel, delta/de-duplicated where appropriate. Query syntax for
time-correlated searches (`*.log changed since ticket opened`), size
attribution with an "Explain" action that cites evidence, and a safety layer
that records technician, customer, ticket, file, direction, hash and timestamp
for every transfer, with policy for tier-restricted, approval-required and
sensitive paths.

### Session intelligence surfaces

- Hypothesis panel with recalculated posteriors as diagnostics run.
- "Next best test" that names *why* it distinguishes the leading hypotheses.
- One-button **What changed?** timeline (derived).
- Before/after state capture with an explicit "What you changed" diff.
- Live work journal built from session events, reviewable before it becomes a
  ticket note.
- Command palette (`Ctrl+K`) of approved, scope-checked actions.

### Explain-once surfaces

"Show Nexus once" capture indicator, a review screen that turns a recorded
session into a structured repair recipe (preconditions, diagnostics, actions,
decision points, verification, rollback), and an explicit technician
verification step before the recipe can be reused.

---

## 10. Security threat model

### Assets

Grants and signing identities; customer desktops and file content; customer
credentials and privileged tokens; session recordings; audit trail integrity;
tenant isolation; the platform's own control plane.

### Trust boundaries

1. Browser ↔ Nexus API (untrusted ↔ trusted).
2. Nexus API ↔ Agent/Companion (mutually authenticated, grant-verified).
3. Agent/Companion ↔ endpoint OS (privileged; least privilege required).
4. Relay ↔ endpoints (must be mutually authenticated before production).
5. Advisory model ↔ privileged execution (must never be a direct path).

### Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Browser crafts a session or injects input | Session activation requires an agent-verified grant; the browser cannot call transport or control routes. |
| Stolen or replayed grant | Signed, single-session, short-lived, bound to tenant/client/device/agent/actor, with restart-persistent replay rejection. |
| Replayed or stale capture | Strictly increasing frame sequence reserved before write; staleness window; frame deleted on disconnect/stop/expiry. |
| Input burst or macro abuse | Typed bounded envelopes, monotonic sequence, batch limits, short TTL, per-event acknowledgement. |
| Unauthorised viewing | Server-side tenant/client/site checks on the frame route; cross-tenant attempts return no body. |
| Silent or covert access | No stealth mode; visible consent, session indication and local stop are requirements. |
| Recording leak | Policy-gated recording, private artifact storage, scoped download route, explicit retention. |
| Cross-tenant data mixing | Tenant partition on every read/write; isolation tests are release-blocking. |
| Relay as a permission bypass | Relay carries bytes only; authorisation stays in the broker. |
| Model-driven dangerous action | AI is advisory only; Guardian + `operational_mode_state` + deterministic executor + evidence. |
| Secret exposure in logs/responses | Never log or return grants, tokens, credentials, private URLs, key content or clipboard content. |
| Supply-chain / tampered companion | Companion hash pinned in authenticated agent policy, re-checked at pipe connect; signed installer. |
| Blast-radius mistake | Device dependency context surfaced before high-impact actions; warning cites evidence and offers the historically safer action. |

### Release blockers

Cross-tenant access; secret exposure; unaudited privileged actions; data
corruption; any claim of capability that the code does not implement; any path
where a model output reaches a privileged executor without a Guardian decision.

---

## 11. Test strategy

| Layer | Coverage | Evidence required |
| --- | --- | --- |
| Unit (Python) | Grant lifecycle, TTL/expiry, scope helpers, frame validation, control-event validation, sequence reservation, risk-score derivation | Deterministic tests in the standard suite |
| Unit (Go) | Grant signature verification, payload shape, replay ledger durability, consent state, hash pinning | `go test ./...` for `agent/` |
| Integration (API) | Scope enforcement, cross-tenant denial, consent deny/accept, revocation, disconnect, replay | Scoped API tests with real Mongo |
| Two-machine acceptance | The nine cases in `docs/NEXUS_REMOTE_PILOT_ACCEPTANCE.md` | Recorded run via `docs/templates/NEXUS_REMOTE_PILOT_RUN.md` |
| Browser E2E | Viewer freshness, session evidence, end-session, deep-link from device/ticket, workspace panels | Browser run with captures |
| Load / soak | Relay throughput, concurrent sessions, frame cadence, connection churn, bounded memory | Reported numbers against a stated workload model |
| Security | Threat-model cases above, plus an independent penetration test before broad customer fleets | Independent report |
| Rollback | Disable policy ⇒ new grants fail closed; history preserved; no provider fallback | Recorded drill on the real host |

No gate may be claimed from a passing build alone. A capability is "delivered"
only when the acceptance case for it has run and its evidence is retained.

---

## 12. Release sequence

Each phase has exit criteria. Do not start the next phase while the current
exit criteria are unmet.

### Remote 1.0 — parity (attended, rock solid)
Fast attended sessions; multi-monitor viewing; attended + policy-controlled
unattended; file manager; authorised clipboard; audio; in-session chat;
recording; background tools; terminal; reboot/reconnect; elevation; ticket
integration.

Exit: every pilot acceptance case passes on two machines with retained evidence;
relay is mutually authenticated, encrypted, bounded and regionally deployable;
no open release blocker in [Security](#10-security-threat-model).

### Remote 2.0 — beat MSP products
Smart Canvas; Shadow Workspace; advanced file explorer; session timeline; Graph
context; "what changed"; ticket evidence; multi-endpoint workspace; JIT
privileges.

Exit: browser E2E of the golden remote journey (ticket → session → evidence →
note → time); multi-endpoint workspace tested; JIT privilege tests pass.

### Remote 3.0 — become different
Session Brain; hypotheses; next best test; before/after state capture; repair
verification; automatic work journal; adaptive workspace.

Exit: hypothesis recalculation is deterministic and reproducible from stored
evidence; work journal maps to real session events with no invented steps; a
ticket note is generated and reviewed, never auto-sent.

### Remote 4.0 — build the moat
Teach Nexus by doing; Repair Genome; durable repair score; recipe generation;
fleet matching; staged fleet remediation; problem detection.

Exit: a recipe cannot be reused without technician verification; durability is
observed at 24h/7d/30d and never asserted early; fleet remediation respects
canary gates and `fleet_object_sets` frozen membership; `operational_mode_state`
gates every execution.

### Remote 5.0 — compound
Privacy-preserving cross-environment pattern intelligence; emerging vendor
problem detection; repair ranking; failure prediction; global operational
learning.

Exit: `genome_patterns` `MIN_CLUSTER` is enforced; no customer-identifying datum
crosses tenants; participation is explicit and revocable; an opt-out leaves no
residual linkage.

---

## 13. Ordered implementation backlog

Dependencies are listed so the order is real, not aspirational. "In-repo" means
it can be completed inside this repository; "external" means it needs a resource
or decision outside it.

Track keys: **T1** Remote Core · **T2** Technician Workspace · **T3** Nexus
Integration · **T4** Security · **T5** Session Intelligence · **T6** Learning ·
**T7** Advanced R&D.

### Foundation (blocking everything else)

- [ ] **[1] Multi-monitor capture contract** — T1, in-repo. Deps: none.
  Capture per-display frames (or a full virtual desktop plus display geometry)
  with per-display sequence. Accept: viewer renders two displays with correct
  geometry; a stale/torn display never replaces a newer one; a single-display
  endpoint is unchanged.
- [ ] **[2] Codec negotiation + adaptive quality** — T1, in-repo. Deps: 1.
  Capability exchange and the AV1→H.265→H.264→JPEG ladder with adaptive bitrate
  from measured RTT/loss. Accept: negotiation recorded as session evidence;
  degraded link lowers quality without dropping the session.
- [ ] **[3] Relay production hardening** — T4/T1, external (DNS, regions, certs).
  Deps: 1, 2. Mutual endpoint authentication, encrypted transport, bounded
  queues, connection timeout, reconnect coverage, regional deployment policy.
  Accept: `docs/NEXUS_REMOTE_PILOT_ACCEPTANCE.md#relay-production-gate` satisfied.
- [ ] **[4] Secure desktop & elevated input** — T1, in-repo. Deps: none.
  UAC/secure-desktop and elevated-input handling with an explicit test matrix.
  Accept: documented matrix; view-only fallback when the OS denies capture.
- [ ] **[5] Reconnect / network-change recovery** — T1, in-repo. Deps: 3.
  Accept: interface switch and NAT rebind recover without a false "connected".

### Technician workspace

- [ ] **[6] Smart Canvas shell** — T2, in-repo. Deps: 1.
  Device/Brain/evidence rails, honest freshness badge, risk indicator citing
  factors, store provenance per panel. Accept: E2E capture of the golden journey.
- [ ] **[7] Shadow Workspace** — T2, in-repo. Deps: agent capability contract.
  Native Nexus interfaces over services/processes/events/registry/software/etc.
  Accept: every panel issues a scoped agent command; no desktop exposure.
- [ ] **[8] Smart File Explorer** — T2/T4, in-repo. Deps: 7, transfer provenance.
  Multi-pane, resumable, provenance-carrying, policy-gated. Accept: policy denial
  test, resume test, hash-verified transfer test.
- [ ] **[9] File safety policy** — T4, in-repo. Deps: 8.
  Tier/path/sensitivity policy, approval-required paths, temporary-file expiry.
  Accept: a restricted technician cannot download; attempt is audited.
- [ ] **[10] Drag-file-to-ticket** — T3, in-repo. Deps: 8.
  Accept: attached evidence records source device, original path, timestamp, hash.
- [ ] **[11] Multi-endpoint workspace + group actions** — T2, in-repo. Deps: 6.
  Accept: two-plus live endpoints in one workspace; group command compares results.
- [ ] **[12] Command palette** — T2, in-repo. Deps: 6.
  Accept: only approved, scope-checked actions appear.

### Nexus integration

- [ ] **[13] Session ↔ ticket binding surfaced** — T3, in-repo. Deps: none.
  Accept: session shows technician, customer, device, user, ticket; deep links work.
- [ ] **[14] Evidence capture into packs** — T3/T4, in-repo. Deps: 13.
  Accept: captured evidence lands in `evidence_packs` with a verifiable hash root.
- [ ] **[15] Work journal → ticket note** — T3/T5, in-repo. Deps: 13.
  Accept: journal is built from real session events; technician edits and sends.
- [ ] **[16] Automatic labour suggestion** — T3, in-repo. Deps: 15.
  Accept: suggestion excludes configured non-work periods; technician confirms.
- [ ] **[17] Customer-friendly summary** — T5, in-repo. Deps: 15.
  Accept: technical and customer variants differ and both cite real evidence.
- [ ] **[18] JIT remote permissions** — T4, in-repo. Deps: 13, `decision_family`.
  Accept: time-boxed capability expires and is audited.

### Session intelligence

- [ ] **[19] "What changed?" in-session** — T5, in-repo. Deps: 13.
  Accept: derived timeline; explicitly no causation claimed.
- [ ] **[20] Before/after state capture** — T5, in-repo. Deps: 19, `drift_findings`.
  Accept: before/after diff produced; unchanged fields shown as unchanged.
- [ ] **[21] Hypothesis panel + next best test** — T5, in-repo. Deps: `investigations`.
  Accept: posteriors are the arithmetic of recorded evidence; inconclusive
  evidence moves nothing; next test names why it discriminates.
- [ ] **[22] Session risk score** — T4, in-repo. Deps: 13.
  Accept: score cites its factors; threshold raises a requirement, never a silent block.
- [ ] **[23] Blast-radius awareness** — T5, in-repo. Deps: Graph/dependency data.
  Accept: high-impact action warns with cited dependencies and a safer alternative.
- [ ] **[24] Mistake protection** — T5, in-repo. Deps: 23, `recorded_runbooks`.
  Accept: in-use path warns and cites the historically successful action.
- [ ] **[25] Session time machine (state rewind view)** — T5/T6, in-repo. Deps: 20.
  Accept: starting state is viewable; reversible changes carry a rollback plan.

### Learning

- [ ] **[26] Record a fix session** — T6, in-repo. Deps: 15.
  Extend `recorded_sessions` from the remote path with redaction. Accept:
  redaction test; closed sessions immutable.
- [ ] **[27] Derive intent, not clicks** — T6, in-repo. Deps: 26.
  Accept: a recipe survives a different tool path for the same intent in test.
- [ ] **[28] Recipe generation + verification** — T6, in-repo. Deps: 27.
  Extend `recorded_runbooks`. Accept: no reuse before technician verification.
- [ ] **[29] Durable repair score** — T6, in-repo. Deps: 28.
  Accept: durability observed at 24h/7d/30d; never asserted early; recurrence
  detection reads ticket evidence.
- [ ] **[30] Solution evolution** — T6, in-repo. Deps: 29.
  Accept: a higher-durability repair is surfaced and the old recipe demoted with
  retained history.
- [ ] **[31] Session → problem detection** — T6, in-repo. Deps: 29.
  Accept: a recurring problem record is proposed, never auto-created.
- [ ] **[32] Fleet precursor match + staged remediation** — T6, in-repo + external
  (canary policy). Deps: 29, `fleet_object_sets`, `device_state_declarations`.
  Accept: canary gates enforced; unavailable members reported, never silently
  included or dropped; `operational_mode_state` gates execution.

### Advanced R&D

- [ ] **[33] Semantic region streaming** — T7, in-repo. Deps: 2.
- [ ] **[34] Predictive input** — T7, in-repo. Deps: 5. Local feedback only; never
  fakes authoritative machine state.
- [ ] **[35] Mobile / camera-assisted support** — T7, in-repo. Deps: 6.
- [ ] **[36] AR field assist** — T7, in-repo. Deps: 35. Human-verified overlays only.
- [ ] **[37] Out-of-band recovery (safe mode, pre-login, vPro/AMT, BMC)** — T7,
  in-repo + external (hardware). Deps: `rescue_sessions`. [!] Blocked on
  hardware/site access for acceptance.
- [ ] **[38] Ecosystem pattern intelligence** — T7, in-repo + external (participation
  policy). Deps: 29, `genome_patterns`. [ ] Not enabled until `MIN_CLUSTER`,
  opt-out and isolation tests pass.
- [ ] **[39] Independent penetration test of the remote surface** — T4, external.
  [!] Required before broad customer fleets.
- [ ] **[40] Recording pipeline + searchable chapters** — T4/T2, in-repo + external
  (retention/jurisdiction decision). Deps: 14, Data ownership follow-up.
  [!] Blocked on the retention and jurisdiction decision.

### Critical path

`1 → 2 → 3 → 6 → 13 → 15 → 19 → 20 → 26 → 27 → 28 → 29 → 32`

Everything else is parallelisable or later. Items 37, 39 and 40 are externally
blocked and must be scheduled early because they are the longest poles.

---

## Related documents

- `docs/NEXUS_REMOTE_PRODUCT.md` — product boundary (authoritative for scope)
- `docs/NEXUS_REMOTE_NATIVE.md` — implementation status (authoritative for state)
- `docs/NEXUS_REMOTE_PILOT_ACCEPTANCE.md` — pilot gate
- `docs/DATA_OWNERSHIP.md` — data ownership registry
- `docs/NEXUS_PRODUCTION_READINESS_CHECKLIST.md` — release gates
- `docs/SECURITY_REVIEW.md` — security review
