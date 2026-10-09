# Nexus Agent self-healing and endpoint performance guard

Status: implemented, monitoring-by-default; privileged Windows component repair is
opt-in and fail-closed.
Owner: Agent / Platform. Evidence: `agent/internal/selfheal/`,
`backend/tests/test_agent_self_heal.py`.

Governing rules: [Nexus data ownership registry](DATA_OWNERSHIP.md) for the
endpoint-local state file, and the `AGENTS.md` change discipline for anything that
changes an endpoint.

## The problem this solves

Before this change the Windows agent could be asked to repair itself
(`nexus_agent_commands` `repair_agent_local`) and it logged heartbeat errors, but it
had no idea what state it was in:

1. **It did not know it had stopped phoning home.** A lost control plane was a
   `log.Printf` line. Nothing counted failures, nothing distinguished "the network
   is down" from "my credentials were rejected", and nothing was reported upwards,
   so NexusMSP only learned an endpoint was offline by noticing it had gone quiet —
   and a quiet endpoint cannot tell you *why*.
2. **It did not act on its own findings.** Recovery existed only as an operator
   -initiated command. An endpoint that could have fixed itself waited for a human.
3. **It was blind to its own performance.** Local slowness was invisible until a
   user called the service desk, and the repairs Windows already ships for exactly
   that condition (DISM `/RestoreHealth`, `sfc /scannow`) were never run
   proactively.

## What the agent now does

Three loops, all inside one new package, `agent/internal/selfheal/`.

### 1. Connectivity self-awareness (`selfheal.go`)

The heartbeat feeds every control-plane result into a `Watchdog` — success *and*
failure — which turns "are we phoning home?" into explicit state:

| State | Meaning | How it is reached |
|---|---|---|
| `unknown` | No control-plane interaction yet | Initial |
| `connected` | Within the tolerated missed-heartbeat window | Last request succeeded |
| `degraded` | Behind on heartbeats | Learned patience exceeded |
| `disconnected` | Sustained loss of contact | Learned patience exceeded |
| `rejected` | NexusMSP answered and refused this endpoint | `401/403` or another non-auth 4xx |

Every failure is also classified into a **cause** the repair ladder reasons about:
`auth`, `tls`, `dns`, `timeout`, `server`, `network`, `request_rejected`, `unknown`.
`server` (5xx) is deliberate: NexusMSP being broken is the platform's problem, and
repairing a healthy endpoint would make an outage worse. `rejected` is its own
state because waiting never fixes refused credentials.

The evidence the agent reports with the next successful heartbeat includes state,
cause, consecutive failures, outage seconds, last success, recovered-outage count
and the last few ladder actions. That is what lets NexusMSP learn an endpoint was
offline **from the endpoint itself**, with the reason attached, instead of
inferring it from silence.

### 2. The repair ladder, which learns what works (`loop.go`, `learn.go`)

An endpoint that is not connected escalates through the safest rungs first, paced so
a fast-failing endpoint cannot race down the whole ladder in a minute. Every rung is
an existing, already-audited agent capability:

| Rung | What it does |
|---|---|
| `probe_control_plane` | Read-only authenticated `GET /api/nexus-agent/ping`. Always pinned first: it distinguishes "my loop is stuck" from "the link is down", and cannot make anything worse. |
| `repair_local_state` | The same identity/config/policy repair the `repair_agent_local` command already runs. |
| `renew_identity` | Certificate renewal of the device identity. |
| `reset_transport` | Drops the presented client certificate and falls back to the bearer token the endpoint already holds. |
| `reenroll` | Re-enrollment (consumes an enrollment token, so once a day at most). |
| `restart_service` | Restarts the agent's own service. Off unless a deployment explicitly enables it. |

Two properties make this adaptive rather than a fixed script:

- **Credit assignment.** A rung is credited only when contact actually returns. A
  rung still open when the next one starts closed as failed, so the ladder learns
  which action really restores contact *for the cause it observed on this endpoint*.
  Scores are a Beta-style ratio with a safety prior (probe 0.9, restart 0.15), so one
  result moves the ranking without flipping it wildly.
- **Learned patience.** The agent keeps a bounded history of how long its own outages
  last. An endpoint whose median outage is hours escalates after the first missed
  heartbeat; a flaky one that recovers in seconds keeps its patience.

The ladder stays finite and explainable: every rung is attempted once per outage,
disruptive rungs are daily-capped, and when the ladder is exhausted the agent says so
in its evidence instead of looping forever.

### 3. Endpoint performance guard and the inbuilt Windows repair (`perf.go`, `platform_windows.go`)

This is the "one of a kind" part. The agent watches its own endpoint and, when the
machine is genuinely degrading, runs the repair Windows already ships.

**Detection is against a baseline learned on that endpoint, not a fixed number.** A
quiet CAD workstation and a busy build server have very different normal CPU and
memory curves; both are healthy until they leave *their own* envelope and stay
there. The baseline is an exponential moving mean and variance per signal, fed by
healthy samples only — a degraded endpoint is never allowed to redefine "normal",
because that is how a performance guard silently stops guarding anything.

Signals and weighting:

- `cpu_percent` (weight 1.0)
- `memory_percent` (weight 1.0)
- `disk_free_min_percent` (weight 1.5, worse when low — a nearly full system volume
  degrades everything else, including the ability to repair it)
- `component_store_health` — a **hard** signal, not a statistical one: cached
  `DISM /Online /Cleanup-Image /CheckHealth` output, re-read once a day (corruption
  is exactly what the repair exists to fix)
- `pending_reboot` — reported, never a repair trigger; a restart between patch
  cycles is normal operation

Bands: `unsupported`, `learning` (fewer than 20 quiet samples), `healthy`, `watch`
(something worth an operator's attention), `degraded`, `repairing`. Repairs require
sustained degradation (15 minutes) and sustained recovery (10 minutes) to close the
episode, so one bad sample never starts a repair and one good sample never claims the
repair worked.

**The repair is the inbuilt Windows sequence**, replacing nothing:

```
Dism.exe  /Online /Cleanup-Image /RestoreHealth   payload taken from Windows Update
sfc.exe   /scannow                                protected system files
Dism.exe  /Online /Cleanup-Image /CheckHealth     verify, do not assume
```

Order matters and matches an on-site technician: repair the servicing image first,
let `sfc` restore system files from that repaired image, then verify instead of
assuming. The record keeps outcomes and status, reboot-required detection, duration,
and bounded output tails. `sfc.exe` writes UTF-16LE, so the NUL bytes are stripped
remotely; a repair that cannot be verified reports `blocked`/`failed`, never
"repaired".

Safety gates, all of which must pass before anything changes the customer's image:

- the **signed deployment policy** enables it (`windows_repair_enabled`, fail-closed);
- the agent is **elevated** — without an administrator token DISM and `sfc` cannot
  run, and the agent says so rather than pretending;
- an optional **maintenance window** (wrap past midnight supported) keeps an
  hours-long DISM run out of the customer's working day;
- a **learned cooldown** (12/24/72 hours by observed success rate) and a **daily
  cap** (default 1) stop the agent thrashing a busy-but-healthy machine;
- only one repair runs at a time, and it runs off the watchdog path so connectivity
  monitoring keeps working while DISM takes tens of minutes.

Every blocked attempt records *why* it was blocked. "Nothing happened" is always
explainable in the evidence.

**Hard-coded command safety:** the package never builds a shell string. Each step is
an absolute path under `System32` (`%SystemRoot%\System32\Dism.exe`, `sfc.exe`) with
fixed arguments, so a binary planted on `PATH` can never be what the agent runs as
its repair. The optional service restart uses a fixed constant command line through
`cmd.exe` with `CREATE_NO_WINDOW | DETACHED_PROCESS` — the service must outlive the
process that stopped it — and interpolates nothing caller-supplied.

### 4. Learning lives on the endpoint (`learn.go`)

`self-heal-state.json` in the agent's base directory holds what this endpoint has
learned: per-cause action outcomes, the outage-length history, the performance
baseline, repair outcomes and cooldowns. Written atomically, `0600`, schema-versioned,
bounded in size, and inspectable by a technician during an incident.

A missing, corrupt or unreadable state file is **never fatal**: refusing to start
because the file that records self-repair is damaged would be the one failure mode
this package exists to prevent. A damaged file is replaced with a fresh profile and
the reason is recorded in the file's notes. This is endpoint-local bookkeeping about
the agent itself; NexusMSP owns the durable audit trail (see
[DATA_OWNERSHIP.md](DATA_OWNERSHIP.md)).

## Server side

- **New endpoint** `GET /api/nexus-agent/ping` — authenticated with the agent token
  (or client certificate), side-effect free. It claims no queued command and
  acknowledges none, so a probe can never consume or hide work an operator queued.
- **Heartbeat evidence** `self_heal` — whitelisted, length-capped and coerced in
  `_self_heal_evidence_update` before it reaches the device record. Command output is
  deliberately dropped: the record keeps outcomes, not raw DISM/SFC text. A malformed
  or hostile heartbeat cannot pollute the record, inflate a counter or raise inside
  the heartbeat handler. Stored on the device as `nexus_agents.self_heal`.
- **Signed policy** `platform_policy.self_heal` — `enabled`,
  `windows_repair_enabled`, `windows_repair_max_runs_per_day`,
  `windows_repair_cooldown_hours`, `windows_repair_window_start_hour`,
  `windows_repair_window_end_hour`, `windows_repair_enforce_window`,
  `allow_service_restart`. The policy always wins over the installer configuration,
  so an on-endpoint file can only tighten behaviour; the control plane decides what
  the fleet may do.
- **Operator setting** `windows_self_heal_enabled` (default **false**) in
  `/api/nexus-agent/settings`, alongside the existing `self_repair_enabled`. It is
  the setting that authorises repairing the customer's Windows component store, so it
  is fail-closed and audited like the other admin settings.

## Enabling Windows component repair

1. Set `windows_self_heal_enabled` for the tenant (Agents settings) — it defaults to
   off and must be a deliberate decision.
2. Confirm the agents you expect to repair are running **elevated**; a non-elevated
   agent reports `blocked` with the reason.
3. Installer-only pilots can instead use `self_heal.windows_repair.enabled` in
   `config.json`, with `max_runs_per_day` and a `maintenance_window`. A signed policy
   overrides it.
4. Watch the device's `self_heal` evidence: `performance.band`, `performance.reasons`
   and the `repairs` list carry the trigger, per-step exit codes, verification and
   reboot-required state.

## Observability

Agent log lines are prefixed `[self-heal]`: escalation, held-back reasons, repair
start and repair outcome. The heartbeat reports the same facts upward, so the device
record is the primary place to look. Learned values are reported as
`learned["action.<cause>/<action>"] = "3/4 succeeded"`, and
`learned["windows_repair.cooldown_hours"]` / `learned["performance.baseline_samples"]`
explain why the agent is (or is not) acting.

## Tests

- `agent/internal/selfheal/*_test.go` — connectivity classification and patience,
  ladder ordering and credit assignment, learning, performance scoring and
  hysteresis, repair gating (policy, elevation, window, budget, cooldown) and the
  repair record. Deterministic: injected clocks, injected platform, injected actions.
- `backend/tests/test_agent_self_heal.py` — the authenticated probe, evidence
  sanitisation and boundedness, the fail-closed default of the operator setting, and
  the signed policy block.

## Non-goals and limits

- The guard is **Windows-only** by design. Off Windows the agent reports
  `unsupported` instead of fabricating a capability it cannot honour.
- It never reboots an endpoint, never installs or removes components, and never
  repairs anything but the servicing image and protected system files. A pending
  restart is reported for an operator decision.
- In-memory counters reset when the service restarts; the durable learning does not.
- `RestoreHealth` timing is bounded at 75 minutes per step, with a 175-minute ceiling
  on the whole repair.

## Rollback

Detection and reporting are the default and need no configuration. To stop all
autonomous action, set the signed policy `self_heal.enabled` to `false` (the agent
keeps reporting its state, it just stops repairing). To stop only the Windows repair,
clear `windows_self_heal_enabled`. Deleting `self-heal-state.json` resets the learned
profile to a safe cold start; the agent does not fail if the file is absent.
