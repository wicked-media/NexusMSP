# Nexus production observability runbook

## Purpose and ownership

The production Compose stack sends low-cardinality API and worker metrics to
Prometheus, traces to Tempo, structured logs to Loki, alerts through
Alertmanager, and exposes the read-only operations view in Grafana. Platform
Operations owns the stack and first response. The Engineering Lead owns API
regressions, the Automation Owner owns durable queue/workflow failures, and the
Incident Commander owns critical escalation and customer communications.

Telemetry is operational evidence, not a customer-data store. Never add tenant,
client, user, device, ticket, raw URL, query-string, provider payload, or secret
values to metric labels or trace attributes.

## Deployment

Set `NEXUS_GRAFANA_ADMIN_PASSWORD` to a unique secret and
`NEXUS_ALERT_WEBHOOK_URL` to an HTTPS endpoint owned by the on-call system. The
webhook must return a 2xx response only after accepting the alert. Grafana binds
to loopback port 3001 by default; expose it only through the approved
authenticated administration ingress.

Set `NEXUS_OBSERVABILITY_INGEST_TOKEN` to a separate long random value. Compose
mounts it into the API and Alertmanager as a file-backed secret; it must never
be sent to the browser or reused as an on-call destination credential.

Start the stack with `docker compose -f docker-compose.production.yml up -d`.
Confirm:

1. `/ready` is healthy inside the API container.
2. Prometheus targets `nexus-api` and `nexus-worker` are up.
3. Grafana has Prometheus, Tempo, and Loki data sources and the `Nexus
   Production Operations` dashboard.
4. A request correlation ID appears in the JSON log and matching trace.

## Alert delivery drill

Temporarily stop the worker container. Within two minutes,
`NexusWorkerUnavailable` must fire, reach the configured on-call destination,
and be acknowledged by Platform Operations. Restart the worker and verify the
resolved notification. Retain the Alertmanager event, destination receipt,
acknowledger, timestamps, and incident link as launch evidence.

Repeat with ClamAV stopped. Confirm `NexusDependencyUnavailable` identifies the
malware scanner, customer uploads fail closed, and no quarantined bytes become
available. Then restart ClamAV and perform clean-file and EICAR upload checks as
specified in `UPLOAD_QUARANTINE_RUNBOOK.md`.

## API or worker unavailable

Page Platform Operations. Check container state, resource pressure, and the
latest correlated logs and traces. Do not repeatedly restart a crash-looping
service. Preserve the first failure evidence, roll back the most recent release
if it is implicated, and escalate a critical outage to the Incident Commander.

## Dependency unavailable

Identify the failed `dependency` label. For MongoDB, stop business mutations
and follow the recovery runbook. For ClamAV, keep upload quarantine fail closed.
For event queue or automation runtime, pause affected automations and preserve
leases/retry evidence. Escalate after two minutes or immediately if customer
data integrity is at risk.

## API errors or latency

Use the route template, status class, correlation ID, trace, and release marker
to isolate the regression without searching customer identifiers. Escalate to
the Engineering Lead. Roll back if the current release caused sustained 5xx or
p95 latency above the alert threshold.

## Provider unverified

Escalate to the Integration Owner. Use the provider's approved non-mutating
connection test and last successful sync evidence. Never log credentials or raw
provider payloads. A saved configuration is not proof of connectivity; keep the
provider readiness state degraded until a verified result is retained.

## Queue or automation degraded

Do not delete or manually mark deliveries successful. Inspect retry/dead-letter
evidence and expired leases, isolate the failing subscriber or workflow, and
use the existing replay/recovery controls. The Automation Owner must approve a
bulk replay.

## Alert delivery failed

Treat loss of the on-call route as a critical monitoring outage. Use the
secondary contact path, verify the webhook endpoint and TLS, and retain the
failed delivery counter plus Alertmanager state. Do not mark the readiness gate
passed until a new firing and resolved alert are both received and acknowledged.

## Rollback

The application remains functional when OTLP, Prometheus, Loki, Tempo, Grafana,
or Alertmanager is unavailable. Roll back by removing the observability services
and OTLP environment values, then redeploying the prior API/worker image. Do not
remove MongoDB, uploads, or application volumes. Preserve observability volumes
until incident evidence has been exported or retention approval is recorded.
