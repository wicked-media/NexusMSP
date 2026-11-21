# NexusMSP release runbook

This runbook covers the release pipeline for the containerised platform (API
and web images) and the Windows Agent release components: how releases are cut,
deployed, rolled back to a previous tag, and what evidence is retained. It
complements `docs/PRODUCTION_READINESS.md` (§4 backup proof, §7 rollback) and
`docs/PLATFORM_RECOVERY_RUNBOOK.md` (data recovery).

## Release model

- Every release produces **immutable image references**: an exact semantic
  version tag (`<registry>/<owner>/nexusmsp-api:1.4.0`) and a `sha-<commit>`
  tag. The truly immutable reference is the image **digest**, recorded in the
  workflow summary and in the release evidence.
- Tags are immutable by policy: never retag or overwrite a released version
  tag. If your registry supports tag immutability rules, enable them.
- Deployments pin images through `NEXUS_API_IMAGE` / `NEXUS_WEB_IMAGE`; a host
  never runs `:latest`, and `scripts/Deploy-NexusImageTag.ps1` refuses it.
- The registry is parameterised. The default is GitHub Container Registry
  (matching the Nexus OS Edge workflow); any other OCI registry can be used by
  dispatching the workflow with a `registry` input and configuring the
  `NEXUS_REGISTRY_USERNAME` / `NEXUS_REGISTRY_PASSWORD` secrets.

## Cutting a container release

1. Ensure CI is green on the commit being released.
2. Run the **Nexus Agent release** workflow first (tag `agent-v<version>` or
   manual dispatch with signing enabled). Note its successful run ID and
   version. The workflow now builds `nexus-agent.exe`, `nexus-client-chat.exe`,
   `nexus-agent-tray.exe`, `nexus-remote-companion.exe` and the release
   `VERSION`, signs and verifies all four executables, and uploads the signing
   evidence plus `SHA256SUMS.txt`. Older agent artifacts without the bundle
   VERSION or a matching source commit are rejected; rerun the Agent release
   before cutting the container release.
3. Either push a tag `v<version>` (for example `v1.4.0`), or run the
   **NexusMSP container release** workflow manually with the `version` input.
   For a deterministic API image, also pass the successful `agent_run_id` from
   step 2. Without it, the workflow resolves the newest successful agent run
   reachable from the release commit and fails if no signed bundle is found.
   A manual dispatch from a branch must pass `agent_run_id`; dispatch from the
   release tag when relying on automatic resolution.
4. The API image is built from `backend/Dockerfile.release`, which validates
   that signed bundle before the runtime stage. The verification stage requires
   the signer to match the repository variable
   `NEXUS_AGENT_SIGNER_THUMBPRINT`, verifies every PE with `osslsigncode`
   (trust chain, Authenticode message digest and RFC 3161 timestamp), and
   rechecks the bundle VERSION against its evidence and artifact name, the
   source commit against the agent run, and per-file SHA-256 sums. The build
   fails closed if the artifact is unsigned, incomplete, tampered with, signed
   by another signer, missing a valid timestamp, or bound to a different
   commit/version. The web image continues to use `frontend/Dockerfile`.
5. Both images are built and signed under unique per-run staging tags. Before
   promotion, the workflow uploads a `nexus-promotion-<version>-<run-id>`
   manifest recording the exact image digests and release tags. Only after both
   Cosign signatures verify does it promote the version and `sha-` release tags
   to those signed digests. No release tag is created before both signatures pass; staging tags
   are not deployment targets. If promotion fails partway, use the
   promotion-only recovery below; do not rebuild or hand-tag. Retain the
   workflow summary and promotion manifest (image names, staging tags, release
   tags, version, commit, digests, signed agent version, agent run ID, signed
   commit and pinned signer thumbprint) with the release record. These digests
   are the rollback target of last resort.

## Recovering an interrupted promotion

Use this only when a release run stopped after the promotion manifest was
uploaded but before every version and `sha-` tag was promoted. It does not
rebuild either image.

1. Open the interrupted **NexusMSP container release** run and copy its run ID.
   If that run is still in progress, cancel it first; the workflow's concurrency
   group queues recovery behind the same ref.
2. Dispatch the same workflow from the release tag or the ref used by the
   interrupted run, with `promotion_only: true`, `source_run_id` set to that
   run ID, the same `version` shown in the interrupted run's summary, and the
   same `registry` value. The version must match the promotion manifest.
3. The recovery job downloads the `nexus-promotion-<version>-<run-id>`
   manifest, validates the image names, digests and release tags, re-verifies
   both Cosign signatures, and re-runs `crane tag` for both images. It never
   builds or signs a new image.
4. Confirm the recovery summary lists both release digests, then run the deploy
   preflight and the `VERSION` check below. Do not deploy if recovery fails.

The promotion manifest is retained for 30 days. If it has expired, run a new
full release; do not tag manually reconstructed or unverified digests.

### Drill the recovery path

Run this after any change to the promotion manifest, the shared promotion
script or the recovery job:

```bash
python scripts/promotion_recovery_drill.py
```

It extracts the real manifest writer and recovery run blocks from the release
workflow, records a manifest, interrupts the real promotion script at the first
web tag, and then runs only the recovery steps against a disposable fake
registry. It requires both images to carry both the version and `sha-` tag on
the recorded digests, repeats recovery to prove idempotency, and writes
`artifacts/release-drills/promotion-recovery-drill-*.json`.

It also replaces the recorded API and web digests in turn with valid-format but
unrecorded digests, requires recovery to fail before any tag command and leave
the partial tag map unchanged for each, then restores the recorded manifest and
completes the positive recovery. These are the corrupted-digest controls.

It does not contact a real registry, verify real keyless signatures, upload or
download a GitHub Actions artifact, or rebuild either image. It proves the
recorded-digest recovery logic; live interrupted-run recovery on the real
registry remains the end-to-end check.

CI runs the same drill in the `promotion-recovery-drill` job on every pull
request and push to `main` or `master`, and uploads the JSON as the
`promotion-recovery-drill-evidence` artifact for 30 days. The job summary links
the uploaded evidence artifact and shows each API/web tamper control's tag and
verification counts and whether positive recovery completed. The failure path is
covered by a forced-failure test: the drill still writes the same JSON evidence,
and the CI upload step is unconditional. Retain that artifact with the release
evidence; a local run writes the same file.

## Deploying a released image

On the deployment host, with the normal Compose variables already configured:

```powershell
./scripts/Deploy-NexusImageTag.ps1 `
  -ApiImage 'ghcr.io/<owner>/nexusmsp-api:1.4.0' `
  -WebImage 'ghcr.io/<owner>/nexusmsp-web:1.4.0'
```

The script validates the pinned Compose model (`docker compose config`), pulls
the pinned images, and rolls `api`, `worker` and `web` with `--no-build` — no
rebuild can silently substitute different code. Use `-ValidateOnly` to check a
pin without touching the running stack.

The API image is built only after the Authenticode gate accepts the signed
Agent bundle. Confirm the pinned image carries the expected bundle version; it
must match the signed Agent version in the container workflow summary:

```powershell
docker run --rm --entrypoint cat ghcr.io/<owner>/nexusmsp-api:1.4.0 /app/agent/dist/VERSION
```

A missing file, an invalid version or a mismatch is a release fault: do not
roll that image to the fleet.

On a host that stages images ahead of the change window (air-gapped deployment,
or a pre-loaded release), add `-SkipPull` to roll to images already present on
the host without a registry round-trip. `-SkipPull` refuses a reference it
cannot find locally instead of silently rolling something else, and it does not
relax the immutable-reference checks: `:latest` and tagless references are
still rejected.

## Rollback to a previous tag

Rollback is the identical command with the previous accepted release:

```powershell
./scripts/Deploy-NexusImageTag.ps1 `
  -ApiImage 'ghcr.io/<owner>/nexusmsp-api:1.3.2' `
  -WebImage 'ghcr.io/<owner>/nexusmsp-web:1.3.2'
```

Then complete `docs/PRODUCTION_READINESS.md` §7 (freeze writes, capture logs,
validate login/tenant isolation/ticket history/billing/agent heartbeat). If the
rolled-back release applied a database migration, the migration's documented
rollback must run **before** older images start; the image pin alone does not
revert schema or data changes. `backend/scripts/nexus_migrate.py --status` tells
you what this database has actually recorded, and
[Database migrations and their rollback](#database-migrations-and-their-rollback)
below gives the apply and rollback commands.

### Rehearse the rollback before you need it

The application-rollback gate is not satisfied by this procedure existing. Run
the rehearsal on the deployment Docker host:

```powershell
./scripts/Test-NexusApplicationRollback.ps1
```

The drill generates its own Compose project name, generated database name and
test-only secrets; builds two genuinely different API releases from the
checkout; deploys the previous release through
`scripts/Deploy-NexusImageTag.ps1`; seeds database and upload markers; adopts the
newer release; rolls back to the previous one; and then verifies that the API
container is running the previous release's **exact image identity**, that
`/api/health` answers, that the seeded data survived an application-only
rollback, that a mutable `:latest` reference is still refused, and that a
`-ValidateOnly` pass changes nothing. It writes retained JSON evidence
(image identities in/out, rollback duration, verification results) under
`artifacts/release-drills/`, cleans up its disposable project and removes the
drill images it built.

Scope is disclosed rather than implied: the drill pins the API/worker tier
twice, because that tier carries the application logic and the migration risk;
the web tier is rolled with the identical pin mechanism but is not
version-discriminated. **Database migration rollback is not rehearsed by this
drill** — it stays a per-migration procedure that runs before older images
start, and it is rehearsed separately by `scripts/Test-NexusMigrationRollback.ps1`
(see [Database migrations and their rollback](#database-migrations-and-their-rollback)).
It remains open on the production-readiness checklist until that drill has run
on the deployment Docker host.

## Database migrations and their rollback

Nexus keeps its operational records in MongoDB, so a release's data-shape change
is an ordered, recorded migration rather than a schema DDL script.
`backend/app/services/schema_migrations.py` owns the migration registry and the
`schema_migrations` ledger; `backend/scripts/nexus_migrate.py` is the operator
entry point and ships inside the API image at `/app/scripts/nexus_migrate.py`, so
a change window never needs a host checkout.

The ledger has five states, and only two of them block:

- **applied** / **adopted** — recorded as done. `adopted` means an existing
  pre-ledger database already received the work and was recorded without being
  executed again.
- **pending** — this release defines a migration the database has not recorded.
  Reported and logged, deliberately not fatal: the previous release is still
  serving while the window opens.
- **unknown** — the database records a migration this release does not define,
  so the running code is older than the data. **Blocking.**
- **drifted** — an already-applied migration's description was edited in this
  release, so the ledger can no longer certify it. **Blocking.**

An incompatible database is refused in three places, so it cannot pass a change
window unnoticed: `/api/ready` answers 503, the API's own startup gate stops the
container instead of serving a shape it does not understand, and `--status`
exits 1.

The ordering contract is the part that matters:

1. Migrations are **applied before the images are rolled** forward, during the
   change window. Rolling forward first would run new code against a shape it
   has not prepared.
2. On rollback, restore the database state the previous release expects and
   **roll the images back only after** that. The image pin cannot revert a
   recorded migration by itself.

```powershell
# Before the window: what has this database already applied?
# Add --json for machine-readable output. Exit 1 means it is not compatible.
python backend/scripts/nexus_migrate.py --status

# During the window, before the images are rolled forward.
python backend/scripts/nexus_migrate.py --apply

# A database that predates this ledger: record the work it already received,
# without running it again. Refuses a ledger that already has rows.
python backend/scripts/nexus_migrate.py --adopt-baseline

# Roll back to the migration a previous release expects to remain applied...
python backend/scripts/nexus_migrate.py --rollback-to 0001-adopt-prelaunch-event-backfills
# ...or clear the ledger back to the pre-ledger state.
python backend/scripts/nexus_migrate.py --rollback-all
```

Every action accepts `--dry-run` (report and change nothing) and `--actor <name>`
(recorded in the ledger as `applied_by`). Exit codes are part of the interface:
**0** succeeded (for `--status`, the database is compatible), **1** refused with
nothing changed, **2** usage error.

A migration declares a `down` path when its change can be undone exactly, and
must then state why if it cannot. The registry's first migration,
`0001-adopt-prelaunch-event-backfills`, is irreversible: it adopts the
platform-event metadata and Black Box integrity backfills that previously ran
unversioned on every boot, and a one-way integrity seal cannot be reversed by
rewriting it. Rolling through such a migration refuses before changing anything
and names the recovery-capture restore as the real rollback path
(`docs/PLATFORM_RECOVERY_RUNBOOK.md`), so a rollback that crosses one is a
restore decision rather than a command.

The registry's first reversible migration is
`0002-index-platform-event-retention`. The event retention purge selects
`platform_events` by `retention_until` and sorts by that same field every six
hours, and no index covered it, so each pass scanned the platform's
fastest-growing collection. The migration creates that index; its down path drops
it, restoring the previous index set exactly. Reversing it cannot lose a record
or change a stored value, which is why it is the first migration whose rollback
is a command rather than a restore:

```powershell
# Roll the reversible migration back, leaving 0001 applied.
python backend/scripts/nexus_migrate.py --rollback-to 0001-adopt-prelaunch-event-backfills
```

The index is created *only* by the ledger, deliberately not by the boot-time
`ensure_*_indexes` family. An index the API recreated on every start could not be
rolled back — the next start would bring it straight back and the ledger would be
recording a down path that does not hold.

`NEXUS_ALLOW_SCHEMA_MISMATCH=1` is the explicit break-glass acknowledgement for a
recovery-capture restore that legitimately lands a newer ledger against older
code. Every use is logged as a warning; it must never be set to get past a
refusal whose cause has not been understood.

### Rehearse the migration ledger before you need it

Run on the deployment Docker host:

```powershell
./scripts/Test-NexusMigrationRollback.ps1
```

The drill builds the release from the checkout into a disposable Compose project
(unique project name, generated database contents and test-only secrets), starts
it with `APP_ENV=production`, and applies the ledger through the shipped CLI
inside the API container. It then writes the ledger row a newer release leaves
behind and requires the refusal to be visible in all three places above: the CLI
exit code, `/api/ready` returning 503, and the API's startup failing with a log
line that names the remedy. It also verifies that the irreversible
`--rollback-all` refusal names the recovery runbook, that a refused rollback
changes nothing, and that the service recovers once the ledger matches the
release. The evidence is retained as
`artifacts/release-drills/migration-drill-*.json`.

The drill also rehearses a reversible migration's apply, rollback and re-apply.
It reads the migration's whole database effect back from MongoDB (the
`event_retention_until` index on `platform_events`), rolls
`0002-index-platform-event-retention` back with
`--rollback-to 0001-adopt-prelaunch-event-backfills`, and requires the index to
be gone, the ledger row to be removed and `--status` to report the migration
pending again before re-applying it. Nothing in that sequence is taken from the
rollback's own report of what it did.

Scope is disclosed rather than implied. The newer-release ledger row is
*written*, not built, because a ledger row for a migration id this release does
not define is the only thing a newer release leaves behind that affects this
release's decision; the evidence records it as `newer_release_simulation`. The
reversible migration the drill rolls back indexes an existing field, so its down
path restores the previous index set and cannot lose a record. A reversible
migration that *transforms* customer data does not exist yet, so the rollback of
one remains uncovered until it does.

## Windows Agent release and Authenticode signing

1. Run the **Nexus Agent release** workflow (tag `agent-v<version>` or manual
   dispatch with the `version` input). It runs the Go tests and vet, then builds
   `nexus-agent.exe`, `nexus-client-chat.exe`, `nexus-agent-tray.exe` and
   `nexus-remote-companion.exe`, and writes the exact release `VERSION`.
2. Configure the signing certificate and expected-signer pin for real releases:
   - `NEXUS_AGENT_SIGNING_CERTIFICATE` — base64-encoded PFX of the Authenticode
     code-signing certificate.
   - `NEXUS_AGENT_SIGNING_PASSWORD` — the PFX password.
   - Repository variable `NEXUS_AGENT_SIGNER_THUMBPRINT` — the SHA-1 thumbprint
     of the same certificate. The container release fails before building the
     API image when it is unset.
3. Release runs fail without the certificate secret. Dispatch with `sign=false`
   only for explicitly unsigned lab builds; those artifacts are labelled
   `UNSIGNED` and must never ship to managed endpoints.
4. Signing runs `scripts/Sign-NexusAgent.ps1`, which signs each component with
   `signtool` (SHA-256 + RFC3161 timestamp), verifies every signature, and
   writes `artifacts/agent-signing/agent-signing-evidence-*.json` (agent version,
   source commit, signer identity, thumbprint, timestamp URL, per-file SHA-256)
   plus `SHA256SUMS.txt`. The same script signs local release builds when run on
   a Windows host with the certificate installed.
5. The **NexusMSP container release** workflow consumes that artifact for the
   API image. An unsigned lab build is labelled `UNSIGNED` and is rejected before
   the release image is built; it must never ship to managed endpoints.

## Release evidence checklist

Retain with every release:

- [ ] Container workflow summary: image names, staging tags, release tags,
      version, commit, digests, signed Agent version, Agent release run ID,
      signed commit and the pinned Agent signer thumbprint.
- [ ] `nexus-promotion-<version>-<run-id>` manifest with both signed image
      digests and release tags, plus the promotion recovery summary if used.
- [ ] Promotion recovery drill evidence
      (`promotion-recovery-drill-evidence` CI artifact, or
      `artifacts/release-drills/promotion-recovery-drill-*.json` from a local
      run) from `scripts/promotion_recovery_drill.py`, run after any change to
      the promotion or recovery path and covering the interrupted-promotion and
      corrupted-digest controls.
- [ ] Cosign verification output for the published digests (`cosign verify`).
- [ ] Signed Agent release run ID and its retained signing evidence JSON +
      `SHA256SUMS.txt`. An `UNSIGNED` lab artifact is not valid evidence for a
      container release and is rejected by the API image build.
- [ ] Recovery drill evidence (`artifacts/recovery-drills/recovery-drill-*.json`)
      from `scripts/Smoke-Test-NexusDockerRecovery.ps1`, run on the deployment
      Docker host after any change to the capture/storage/restore path.
- [ ] Application rollback drill evidence
      (`artifacts/release-drills/release-drill-*.json`) from
      `scripts/Test-NexusApplicationRollback.ps1`, run on the deployment Docker
      host after any change to the image pin, registry or roll command.
- [ ] Migration ledger drill evidence
      (`artifacts/release-drills/migration-drill-*.json`) from
      `scripts/Test-NexusMigrationRollback.ps1`, run on the deployment Docker
      host after any change to the migration registry, the ledger gate or the
      migration CLI, and before any release that applies a migration to customer
      data.
- [ ] Migration ledger status captured before the change window
      (`python backend/scripts/nexus_migrate.py --status`), showing the applied
      and adopted migration ids for the target database.
- [ ] Golden-workflow acceptance evidence (`docs/PRODUCTION_READINESS.md` §5).
- [ ] The exact previous release tag or digest that rollback will pin.
