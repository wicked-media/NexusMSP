# Proxmox VE integration

How Nexus talks to a customer's Proxmox VE cluster, what it is allowed to do,
and what has deliberately not been verified yet. This is the first
**executing** adapter in the Universal Connector: unlike `nexus_connector`
(which only translates a capability verb into a plan), this adapter performs
the provider call, verifies the outcome, and fails closed when it cannot.

## Shape of the integration

```
frontend  ──►  Nexus API (/api/proxmox/*)
                    │
                    ├─ app/routers/proxmox.py           permission, scope, descriptor,
                    │                                  approval, evidence, audit, events
                    ├─ app/services/proxmox_inventory.py reconciliation: the single writer
                    │                                  for the guest projection (operator
                    │                                  sync and the scheduled pass)
                    ├─ app/services/proxmox_adapter.py connection, provider client,
                    │                                  task verification, simulation
                    ├─ app/services/nexus_protocol.py   canonical action descriptor (P0 #1)
                    └─ app/services/action_permissions.py  virtualization.vm.control
                    │
                    ▼
             Proxmox VE REST API  https://{host}:{port}/api2/json/...

worker (durable loop proxmox-inventory)
       └──►  app/services/proxmox_inventory.py  the same reconciliation, on a schedule
```

The browser never talks to a cluster. It calls Nexus, which resolves the
guest record inside the caller's tenant and client scope, holds the API token,
submits the action and records what the provider actually reported. The
inventory projection has exactly one writer, so the scheduled pass and the
operator's Sync inventory button can never reconcile by two different rules.

## Read paths: observation with provenance

- `GET /api/proxmox/connection` — configured state and a live health probe per
  connection (`health: ok | auth | unreachable | not_configured` plus the
  reason), plus a `reconciliation` block (`enabled`, `interval_minutes`,
  `last_run_at`) so the surface can state the schedule instead of implying the
  inventory only moves when someone presses Sync. It is platform-wide facts
  only: per-customer observation totals are never returned to a scoped caller.
  Returns no token material, ever.
- `GET /api/proxmox/nodes` — live node status from `GET /version`, `/nodes`
  and `/cluster/resources`, each row carrying `source` (`proxmox:{server_id}`)
  and `observed_at`. **When nothing is configured the response is empty** —
  this endpoint used to fabricate three demo nodes, and no read path may invent
  provider state.
- `GET /api/proxmox/vms` — stored guest inventory (owned by the
  `infrastructure` router; the shadowed copy in `proxmox.py` is skipped at
  startup). Scoped, and empty rather than invented. It is populated only by the
  explicit sync below.
- `POST /api/proxmox/servers/{server_id}/sync` — observe one connection and
  reconcile its guests into that stored inventory. Read-only toward Proxmox:
  it stores the provider's own report (with `source`/`observed_at`) or nothing
  at all. Answers 409 for a connection with no stored token, 502 when the
  provider could not be reached, and reports `observed` / `created` / `updated`
  / `removed` / `unbindable` counts so the operator sees exactly what was and
  was not learned. It is the *operator trigger* for the reconciliation the
  scheduled pass below runs on its own timer; both go through
  `app/services/proxmox_inventory.py`.

## The scheduled pass (staying current without an operator)

A durable worker loop, `proxmox-inventory`, registered in
`backend/server.py`'s `background_worker_specs()` alongside the other Nexus
loops, reconciles every configured connection on the platform's own schedule:

- **Cadence.** The `proxmox_inventory_sync` settings document owns the schedule
  (`enabled`, default true; `interval_minutes`, default 30 and clamped to
  5-1440, so a mistyped value can neither hammer a cluster nor leave the
  inventory stale for more than a day). The loop reads the cadence after each
  pass, so an operator's change applies from the next cycle and a missing
  document means the documented defaults — a fresh installation reconciles
  without anyone creating anything.
- **One policy, two triggers.** The pass calls the same
  `sync_connection` the operator route calls: observe the provider, store what
  it reported, drop what it stopped reporting, write nothing when it could not
  be observed. There is no second reconciliation rule that could drift.
- **Attribution.** A scheduled pass has no authenticated user, so every audit
  entry and every `virtualization.inventory.observed` event it publishes is
  attributed to the named actor `system-proxmox-inventory` with
  `trigger: "scheduled"` in the payload. Observations never read as if a
  technician made them.
- **Tenancy.** Each connection is reconciled inside the tenant partition that
  owns it (legacy marker-less connections stay in `nexus-local`), so a pass with
  no session still writes rows the owning tenant can read back — and nothing
  into another tenant's partition.
- **Isolation and honesty.** One customer's unreachable cluster is counted and
  disclosed in the pass summary, and recorded on that connection
  (`last_sync_status` / `last_sync_error` / `last_sync_trigger`), without
  touching its stored guests and without stopping another tenant's
  reconciliation. A connection with no stored token is skipped, not counted as
  observed. A disabled schedule calls no provider at all.
- **Where it runs.** The loop is a durable worker loop, so it runs in the
  dedicated worker deployment and, when `NEXUS_RUN_BACKGROUND_WORKERS` is
  enabled, in the API process — the same gate every other Nexus loop uses. With
  background workers off (the acceptance stack), reconciliation is
  operator-triggered only.

## Action: one canonical descriptor, then reality

`POST /api/proxmox/vms/{vm_id}/action` with `{action, mode?, reason?,
idempotency_key?}` and one of `start, resume, shutdown, stop, reboot, reset,
suspend`.

```
permission (virtualization.vm.control)
  → tenant + client scope on the guest record
  → canonical action descriptor validated by nexus_protocol
  → mode=simulate           → plan recorded, status "simulated", no provider call
  → no configured connection → 409, status "not_configured", nothing executed
  → destructive             → approval request, status "pending_approval", nothing executed
  → otherwise               → provider call → task → verification → evidence + audit + event
```

Then `POST /api/proxmox/vms/{vm_id}/action/{action_id}/execute` runs an
approved destructive action **exactly once** through a conditional claim on
the record's status; a replay returns 409 rather than a second provider call.

### Destructive versus not

| Action | Destructive | Expected end state | Rollback |
|---|---|---|---|
| `start` | no | `running` | `shutdown` |
| `resume` | no | `running` | `suspend` |
| `shutdown` | **yes** | `stopped` | `start` |
| `stop` | **yes** (force, data-loss risk on the guest) | `stopped` | `start` |
| `reboot` | **yes** (service interruption) | `running` | `start` |
| `reset` | **yes** (force, data-loss risk on the guest) | `running` | `start` |
| `suspend` | **yes** | *recorded, not asserted* | `resume` |

Every descriptor declares `destructive`, `reversible`, a rollback plan, an
autonomy level and a verification plan; `nexus_protocol` rejects a descriptor
missing any of them.

### Verification verdicts

Nexus claims only what it observed. After submitting the action the adapter
polls the Proxmox task (`GET /nodes/{node}/tasks/{upid}/status`) and then
re-reads `status/current`:

| Verdict | Meaning | Record status | HTTP |
|---|---|---|---|
| `verified` | task finished with exitstatus `OK` **and** the observed guest state matches the pre-action expectation | `completed` | 200 |
| `inconclusive` | task finished `OK` but the observed state did not match; both values are kept as evidence | `completed_unverified` | 200 |
| `failed` | task finished with a non-OK exitstatus | `execution_failed` | 502 |
| `unknown` | the task did not finish inside the verification window | `outcome_unknown` | 504 |

Provider rejections (unreachable, HTTP 4xx/5xx, auth) are recorded as
`execution_failed` with a `failure_kind` and returned as 502 — the message
states plainly that no change was made. `suspend` does not assert an end state
because Proxmox reports it inconsistently; its evidence is the task outcome
plus the recorded observation.

`GET /api/proxmox/vms/{vm_id}/action-log` returns the attributable history:
who requested it, the descriptor, the approval, the task UPID, the observed
state and the verdict.

## Action permission

`virtualization.vm.control` (category Infrastructure, impact high) gates every
power action. It is **not** in the technician defaults: a technician without
the grant receives 403 with `X-Required-Permission` and a recorded denial.
Admins hold it by default; grant it explicitly to anyone authorised to change
power state on customer infrastructure. Destructive actions additionally need
an independent admin approval regardless of who requested them.

## Credentials and tokens

Connection documents live in `proxmox_servers` (created through
`POST /api/proxmox/servers`, which enforces the caller's client scope):

- `token_value` is encrypted through `app/services/secret_store` before it is
  written; tokens written before that change are decrypted only in request
  memory on read.
- Every read route projects `token_value` out; no route, log, event or action
  record ever carries the token, and adapter error messages are constructed
  without echoing provider bodies that could contain it.
- The token is assembled as `PVEAPIToken={user}@{realm}!{token_id}={secret}`
  for one request and lives only on the in-memory connection object.
- `ssl_verify` is stored per connection; leaving it false is a per-customer
  decision about a self-signed cluster certificate.

## Tenancy

Connection, inventory, action, log and backup reads all apply the actor's
platform tenant partition plus client scope server-side. A restricted
technician cannot see another client's connection, act on another client's
guest, or learn whether a foreign record exists — out-of-scope direct IDs
answer the same 404 as missing records. Action records carry `tenant_id`,
`client_id` and stable `vm_id`; the provider's `vmid`/`node` are used only to
reach the API, never as relationship keys.

## Backup records (not yet provider-backed)

`/api/proxmox/backups` and `/api/proxmox/backup-schedules` maintain Nexus-side
job records only. They do not drive `POST /nodes/{node}/storage/{storage}/vzdump/*`
yet, so a created job is recorded as `status: "requested",
execution: "not_connected"` — a request, never a claim that a provider job is
running. Driving Proxmox backup/restore through this adapter is follow-up work
behind the same descriptor, approval and verification contract.

## Not yet verified

- **No live cluster acceptance.** The adapter is proven against a scripted
  HTTP transport (task success, task failure, timeout, auth rejection,
  unreachable host). Release 1 queue item 6 — provider sandbox acceptance —
  must exercise it against a real Proxmox VE cluster before this integration
  is called production ready.
- **No pilot evidence.** No customer cluster has been connected, so the
  capability register status stays `Implemented, Testing`.
- **Cluster-level operations** (migrate, clone, snapshot, resize, storage,
  users/ACL) are not implemented; only guest power state is wired, and
  `nexus_connector` registers exactly one verb for it:
  `workload.power.manage`.
- **The scheduled pass has no live-cluster or deployed-worker evidence.** The
  reconciliation itself is proven against a scripted provider (see Tests), and
  the worker loop is a registered durable loop, but the scheduled cadence has
  not yet been exercised against a real cluster from a running worker
  deployment. Neither the schedule nor a cluster change has been watched
  propagate in production; treat "the inventory stays current" as implemented
  and unit-tested, not pilot-proven.
- **Inventory reconciliation is not event-driven.** A change on the cluster is
  visible after the next pass (default 30 minutes) or the next manual sync, not
  immediately. Proxmox task/resource notifications are not consumed.
- **An action against a record with no binding is still refused** (409,
  `binding`) rather than guessed at, and the projection only ever holds guests
  the provider itself reported, each with `source` and `observed_at`.

## Tests

`backend/tests/test_proxmox_actions.py` covers the whole contract: fail-closed
configuration, token round-trip without leakage, task verification verdicts,
the permission gate with recorded denials, descriptor validation, simulation
that provably never reaches the provider, approval-gated destructive actions,
exactly-once approved execution, provider failures recorded rather than
reported as success, tenant/client scoping and unfabricated reads, and the
inventory sync: stored provider bindings with provenance, in-place update
rather than duplication, reconciliation of a retired guest, an unbindable guest
counted instead of invented, and an unconfigured or unreachable provider
writing nothing. The same file covers the scheduled pass: the durable loop is
registered, a pass observes each connection inside its own tenant partition, one
unreachable cluster is disclosed instead of fatal, a disabled schedule calls no
provider and writes nothing, the interval is clamped, the schedule a tenant can
read carries no other tenant's totals, and a scheduled pass and a manual sync
write a byte-identical projection.
`frontend/src/pages/ProxmoxPage.test.jsx` pins the surface's own honesty: an
unconfigured studio says so, a simulation is never reported as an execution, a
refusal is shown as the server stated it, a sync reports what Proxmox reported,
and a guest the provider did not describe is `unknown` rather than `off`.
