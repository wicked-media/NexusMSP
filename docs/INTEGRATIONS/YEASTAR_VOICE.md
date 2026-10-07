# Yeastar Voice integration

How Nexus talks to a customer's Yeastar P-Series PBX, what it is allowed to do,
and what has deliberately not been verified yet.

## Shape of the integration

```
frontend  ──►  Nexus API (/api/yeastar/*, /api/voice/*)
                    │
                    ├─ app/services/yeastar/registry.py   declarative interface catalogue
                    ├─ app/services/yeastar/client.py     pooled HTTP, token cache, scoping
                    ├─ app/services/yeastar/ycm.py        Central Management fleet transport
                    ├─ app/services/yeastar/cdr.py        CDR normalisation
                    └─ app/services/yeastar/errors.py     failure taxonomy
                    │
                    ▼
             Yeastar P-Series OpenAPI  {pbx_url}/openapi/v{1.0|2.0}/{path}
             Yeastar Central Management {base_url}/dm/open_api/{path}
```

The browser never talks to a PBX. It calls Nexus, which resolves a client PBX
inside the caller's scope, holds the credential, and relays or normalises the
provider response.

## Capability: the catalogue, not hand-written routes

`app/services/yeastar/registry.py` describes every reachable provider interface
as data — method, path, API version, category, whether it needs an action
permission, and whether it returns a download URL.

- `GET /api/yeastar/catalogue` returns the grouped, browser-safe description.
- `GET /api/yeastar/operations/{id}` runs a read.
- `POST /api/yeastar/operations/{id}` runs a write.

Three invariants keep the dispatcher safe:

1. **Allow-list.** An operation is reachable only if the catalogue names it, so
   a caller cannot append a path or an argument the catalogue does not declare.
   Undeclared query parameters and body keys are dropped.
2. **Gate on every mutation.** Every `access = "write"` operation names a Nexus
   action permission and is refused without it, and each one leaves an
   `voice_operation_executed` audit record that includes whether it is
   destructive.
3. **The Nexus verb follows state, not the provider's verb.** A read is `GET
   /api/yeastar/operations/{id}`; anything that changes PBX state is a `POST`
   command on the same path. Yeastar performs its deletes with a GET, so
   `operation.method` can never be what selects the route — the dispatcher
   compares the operation's *access* with the route the caller used, and the
   provider method stays an internal detail of the call. A caller that uses the
   wrong route receives `405` with the reason, and no provider call is made.

Adding a provider capability is normally a catalogue entry plus a permission,
not a new route.

### Action permissions

| Permission | Covers |
| --- | --- |
| `voice.pbx.modify` | Adding, editing or unlinking a client PBX |
| `voice.billing.recalculate` | Recalculating billable extension quantity |
| `voice.extension.manage` | Extension and extension-group create, edit, delete, welcome mail |
| `voice.extension.secret.read` | Registration password and voicemail PIN reads |
| `voice.provisioning.manage` | Desk phone bulk create, re-provision, reboot, delete |
| `voice.queue.manage` | Queue configuration and agent login or pause |
| `voice.routing.manage` | IVR, ring groups, inbound and outbound routes, paging, conferences, phonebooks |
| `voice.calls.annotate` | Attaching or editing the note on a call |
| `voice.recording.listen` | Listening to recordings or voicemail, and playing one to a handset |
| `voice.compliance.manage` | Automatic recording, block and allow lists, PIN lists, stored voicemail |
| `voice.messaging.manage` | Sending messages and managing message sessions |
| `voice.prompts.manage` | Custom prompts, music on hold, ringtones |
| `voice.continuity.manage` | SIP trunks, PBX backups, status monitors, event push, audio streaming |

Reads are not gated by an action permission: they require authentication and a
client PBX inside the caller's scope, exactly like the rest of the application.

Note that `SERVICE_DESK_MANAGER_DEFAULTS` is derived as "every permission except
a blocklist", so a service desk manager receives all of the above. Technicians
receive none of them by default and can still read the workspace.

## The console: one screen for every capability family

The Voice workspace's **PBX operations** tab renders the catalogue itself, so
lifecycle work that previously had no screen — extension create/edit/delete and
credential reads, the handset fleet and its bulk operations, SIP trunks,
routing, compliance lists, prompts, storage and backups, messaging and the
continuity monitors — is reachable from one governed surface instead of a table
written per feature.

- Every interface is labelled with its category, access and whether it is
  destructive, and a write shows the action permission it needs before it runs.
- Only the parameters the catalogue declares are rendered, and the provider
  request body for a command is explicit JSON. The backend drops undeclared
  keys either way, so the form is a convenience, not the boundary.
- A destructive interface opens a confirmation that names the target PBX and
  the operands exactly as they will be sent. Its acknowledgement is the same
  POST the run button sends.
- Results are rendered from whatever envelope the provider used (a bare array,
  or records under `data`, `items`, `list`, `rows`, `instances` or `records`);
  that tolerance lives in `frontend/src/lib/voiceCapability.js` and is unit
  tested. Recording and voicemail rows offer playback through the Nexus relay,
  never a provider URL.
- A PBX must be selected and must still hold its own OpenAPI credentials, which
  is the same predicate the monitor and wallboard use.

The console is deliberately not a permission bypass: it renders what
`GET /api/yeastar/catalogue` returns, and the server gates every call again.
`proxied` interfaces are shown but cannot be dispatched — their provider URL
would be a capability, so they are served by the artifact relay instead.

## Credentials and tokens

- A PBX is configured with its base URL, API Client ID and API Client Secret.
  A secret is never returned by any endpoint, never written to an audit record
  and never included in a log line.
- The API token cache is **process-local, in memory**. Yeastar permits eight
  concurrent tokens per PBX, so every extra API worker can mint one more of
  them. A deployment that runs several workers should either pin the Yeastar
  routes to a single worker or, better, move the cache to a shared store — which
  is a persistence decision that must be recorded in `docs/DATA_OWNERSHIP.md`
  before it is made. Nexus deliberately did not add a credential store here.
- Unlinking a PBX and rotating its secret call `del_token` so the provider slot
  is released. Provider error `60002` is surfaced as an actionable message
  rather than a generic failure.
- Requests still carry the token as the provider's `access_token` query
  parameter. Moving to an `Authorization` header is worth doing, but it was not
  changed without a live PBX to verify against.

## Tenancy

- PBX records belong to a client and every read and write applies that scope
  server-side. Resolution never loads a PBX by identifier without asserting the
  caller's scope.
- The legacy single-tenant `settings` document (`type: "yeastar"`) carries the
  Yeastar **API** client ID, not a Nexus client. It is reachable only by an
  all-client actor that explicitly asks for it, and its API client ID is never
  recorded as customer ownership.
- Extension override reads are filtered to the PBX being enriched. The previous
  unfiltered read combined with a bare-extension-number fallback meant a shared
  number such as `101` could inherit another customer's billing exclusion.

## Service desk workflows

Endpoint | Purpose
--- | ---
`GET /api/voice/call-history` | Filtered call detail records for one client PBX: direction, disposition, free-text search, abandoned-only, date bounds, pagination
`GET /api/voice/queues` | Live queue depth, waiting callers and agent state, with the reads that did not answer named in `degraded_reads`
`POST /api/voice/calls/to-ticket` | Raise a ticket from a call record
`GET /api/voice/audio/{recording\|voicemail}/{id}` | Relay customer audio

Design points that matter:

- **Attribution comes from the PBX binding, never the request body.** A caller
  cannot attribute another customer's call to a ticket.
- **Ticket creation is delegated** to the canonical `POST /tickets` handler so
  idempotency, client scope, service-tier inheritance and audit behave exactly
  as they do for any other ticket. The idempotency key is derived from the call
  (`voice-call:{pbx}:{call_id}`), so a double submission cannot create two
  tickets. *Follow-up: that handler's policy still lives in a route rather than
  an application service.*
- **Wait time is only ever reported, never inferred.** When the PBX omits it,
  the API returns `wait_time: null` and `wait_time_reported: false`, and the
  ticket says "not reported by the PBX". Inferring a wait from total duration
  would overstate how long a customer waited.
- **Audio is relayed, not linked.** Yeastar's download interfaces answer with a
  URL that authorises the fetch. Nexus resolves and follows it server-side, so
  the URL never becomes a capability the browser holds, and the response is
  `Cache-Control: private, no-store`.

## Not yet verified

This work was built against fabricated provider payloads; there was no test PBX
available.

- No catalogue operation has been executed against a real appliance, so field
  names in passthrough responses (queue state in particular) reflect the
  published interface list rather than an observed response.
- The queue, recording and voicemail response shapes vary by P-Series release
  and are passed through unmodified; expect to confirm them on first contact.
- The artifact relay follows the first recognised download-URL key. Confirm
  which key each release uses.
- Yeastar's event push (`webhook/*`) and WebSocket audio streaming are in the
  catalogue but unused: the integration still polls. An event-driven
  missed-call ingestion should replace the poll before that workflow is relied
  on at scale.
- Yeastar Central Management (YCM) fleet handling now shares the service layer
  (`app/services/yeastar/ycm.py`), but its endpoints have never answered: the
  OAuth token exchange, the `v2/cloud_pbx/instances` fleet shape and the
  discovery envelope tolerance are built from the published YCM OpenAPI
  description, so confirm them on first contact with a real instance.
- The console's write forms send a provider body the operator types. Field
  names and required combinations come from the published interface list, not
  from a live appliance, so the first real create or update should be reviewed
  against the PBX portal's own payload.
