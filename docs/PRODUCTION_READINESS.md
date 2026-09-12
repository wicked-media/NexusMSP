# NexusMSP production readiness runbook

This runbook is the release gate for a controlled MSP pilot. A green build is necessary, but it is not sufficient: every section below needs named evidence and an owner before production customer data is introduced.

## 1. Required release gates

Run from the repository root:

```powershell
& '.\.venv\Scripts\python.exe' backend\scripts\run_unit_tests.py
& '.\.venv\Scripts\python.exe' -m compileall -q backend\app

Set-Location frontend
pnpm run lint:ci
pnpm test --watchAll=false --runInBand
pnpm run build
pnpm run audit:production

Set-Location ..\agent
go test ./...
go vet ./...
$env:GOOS='windows'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'
go build -trimpath -o dist\nexus-agent-windows-amd64.exe .\cmd\nexus-agent
```

CI must also build both containers and validate `docker-compose.production.yml`.

## 2. Environment and secrets

1. Copy `.env.production.example` to `.env` on the deployment host.
2. Generate unique MongoDB, JWT, and Nexus encryption secrets. Do not reuse local, CI, or vendor credentials.
3. Set `CORS_ORIGINS` to the exact HTTPS origin; never use `*` in production.
4. Keep `OPENAI_API_KEY` empty until AI data handling, tenancy, retention, and spend controls have been accepted.
5. Store production secrets in the deployment platform's secret store and restrict read access.
6. Rotate the JWT and encryption secrets under an approved change plan; changing the encryption key without a migration can make stored integration credentials unreadable.
7. Keep `NEXUS_MALWARE_SCANNER=clamav`; never use the acceptance-only deterministic scanner outside the isolated test runner. See [UPLOAD_QUARANTINE_RUNBOOK.md](UPLOAD_QUARANTINE_RUNBOOK.md).

## 3. Deployment

```powershell
docker compose -f docker-compose.production.yml config --quiet
docker compose -f docker-compose.production.yml build --pull
docker compose -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml ps
```

Confirm:

- Web responds over the intended TLS endpoint.
- `/api/health` and `/api/ready` return success through the reverse proxy.
- MongoDB is not published to the public network.
- The API and worker use the same uploads and installer volumes.
- Correlation IDs appear in proxy responses and API logs.
- ClamAV is reachable only on the backend network, its signatures are current,
  and the clean/EICAR/outage checks in the upload-quarantine runbook pass.

## 4. Backup and restore proof

Before pilot launch, capture and retain evidence for all three stores:

- MongoDB: scheduled encrypted `mongodump`, retention policy, and a restore into an isolated database.
- `nexus-uploads`: encrypted volume or filesystem backup plus file-level restore proof.
- `nexus-installers`: reproducible build source and retained signed release artifacts.

A backup is not accepted until an isolated restore has been timed and validated. Record the achieved RPO/RTO, restore operator, timestamp, checksum or record counts, and any exceptions in Production Readiness.

### Agent release evidence

The production Docker build compiles the Windows Agent service, Client Chat and
Tray from checked-in source; it must never copy a developer's `agent/dist` or
per-device `config.json` into the runtime image. Before a fleet rollout, retain
evidence for a clean source build, Windows Authenticode verification, installer
contents and ACLs, pilot install, upgrade, rollback, and post-reboot heartbeat.
Application-level update-manifest verification does not replace code signing.
Local Client Chat requests are forced to technician approval; do not treat that
defence as a replacement for the future OS-authenticated companion channel.

## 5. Golden workflow acceptance

Use non-production pilot records and capture screenshots plus audit entries for:

1. Ticket creation → public reply → client delivery → resolution/closure → client history.
2. Device → one-click remote request → authorization → session audit → time entry.
3. Purchase order line → ticket link → receipt → technician notification and auditable ticket note.
4. Ticket products/time → invoice → payment → Xero hand-off or clearly retained pending state.
5. Service quantity source → contract reconciliation → approved recurring invoice change.
6. Client PBX → extension sync → billable quantity → agreement/product mapping.
7. Microsoft 365 Control Plane → save connection → non-mutating readiness check → customer discovery → stable client mapping → approval-backed provider action. A saved credential must never be presented as live tenant evidence.
8. Web Studio → client-linked website → agreement/billing link → public health evidence → secured WordPress inventory → approval-backed maintenance request. A maintenance request must never be presented as an executed WordPress update without worker verification evidence.

Fail the release if an action reports success without a durable record, audit entry, or verified downstream delivery.

## 6. Pilot controls

- Start with internal data and one low-risk pilot customer.
- Assign a release owner, security owner, support owner, and rollback decision maker.
- Enable destructive automations in suggestion/simulation mode first.
- Require explicit approval for isolation, account disablement, reboot, software changes, billing changes, and external messages.
- Configure and test integrations one provider at a time. Synergy requires its source-IP allowlist, a server-side WSDL/reseller/API-key configuration and the production `NEXUS_SECRET_ENCRYPTION_KEY` vault; WordPress inventory requires `WEB_STUDIO_ENCRYPTION_KEY` plus a dedicated Application Password. Do not put either credential into browser configuration.
- Keep WordPress updates in approval-backed request mode until the WordPress Control worker has been deployed with backup, verification and rollback evidence. The absence of that worker is a production-test limitation, not a successful update.
- Review denied scope events, failed jobs, delivery failures, worker restarts, and agent trust failures daily.
- Publish a support and incident escalation path before inviting pilot users.

## 7. Rollback

1. Freeze new writes and automation execution.
2. Capture logs and the last known correlation IDs before replacing containers.
3. Roll back application images to the last accepted immutable tag.
4. Restore MongoDB or uploads only when the incident commander confirms data rollback is necessary.
5. Validate login, client isolation, ticket history, billing integrity, and agent heartbeat before reopening.
6. Record the decision, evidence, operator, and customer impact in the audit ledger.

## 8. Release decision

Production-ready means all critical and high risks are closed, every golden workflow has current evidence, recovery has been demonstrated, monitoring has an owner, and rollback has been rehearsed. Unimplemented provider actions must be labelled as simulations or pending integrations; they must never present a false success state.

## 9. Architecture and data ownership gate

Before enabling multi-MSP/channel production, review [DATA ownership](DATA_OWNERSHIP.md) and the [architecture plan](NEXUS_ARCHITECTURE_PLAN.md). Confirm environment-level controls that source review cannot prove: authenticated tenant-isolation tests, MongoDB indexes/retention/restore evidence, Supabase RLS and private Storage policy, and server-only service-role credential handling. No cross-store migration is permitted without its own approved migration and rollback plan.

Run the non-mutating local metadata check before a release and retain its output with the release evidence. It inventories collection/index metadata, TTL retention indexes, unique indexes, MongoDB schema-validator presence and private-artifact adapter status; it does not read business documents or change either store:

```powershell
Set-Location backend
..\.venv\Scripts\python.exe scripts\audit_data_stores.py
```

The API boot reconciliation creates only the documented, idempotent indexes required by high-volume runtime paths (security throttling, event delivery, automation, remote, project-ticket plans, chat and central audit timelines). Review index build duration and storage impact on a production-sized MongoDB replica before a large-data rollout.
