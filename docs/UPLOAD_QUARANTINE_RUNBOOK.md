# Upload quarantine and malware-scanning runbook

## Boundary

Ticket attachments, inbound-email ticket evidence and client documents use the
same server-owned upload boundary. The browser never receives a storage path or
private artifact URL. MongoDB owns the upload identity, client/record scope,
scan disposition and audit evidence; the private filesystem is temporary
quarantine and retained binary storage, with Supabase Storage remaining an
optional private replica.

New customer evidence moves through these states:

1. `pending`: bytes exist only as a random file under
   `backend/private_uploads/quarantine` (or the container equivalent).
2. `scanning`: Nexus streams those bytes to the configured private scanner.
3. `clean`: the scanner returned an explicit clean verdict; the file is still
   not available to a caller.
4. `released`: Nexus created the scoped metadata and private retained copy, then
   removed the quarantine file.
5. `infected` or `error`: Nexus rejected the request and removed the staged
   bytes. Metadata and safe reason codes remain for operations and audit.

Only `clean` content may be copied to retained storage. Download routes also
reject any current metadata whose scan state is not clean. Legacy records with
no scan metadata remain available through their existing authenticated,
client-scoped route; no migration or false scan claim is made for them.

## Production configuration

`docker-compose.production.yml` runs ClamAV only on the private backend network
and configures the API and worker with:

```text
NEXUS_MALWARE_SCANNER=clamav
NEXUS_CLAMAV_HOST=clamav
NEXUS_CLAMAV_PORT=3310
NEXUS_MALWARE_SCAN_TIMEOUT_SECONDS=30
```

Do not expose port 3310 publicly. The API returns HTTP 503 when ClamAV is
unreachable, times out or returns an unrecognised response. It returns HTTP 422
for a malware verdict and HTTP 400 for an unsupported or mismatched file type.
Provider response text is never returned to callers or copied into audit logs.

`NEXUS_MALWARE_SCANNER=test` is a deterministic clean/EICAR test double. The
service refuses that provider unless `NEXUS_TEST_ENVIRONMENT=1` is also active,
which in turn requires a disposable `nexus_acceptance_` database. Never use it
for development, staging or production evidence.

## Deployment and verification

1. Pull the versioned ClamAV image and start the stack; retain the resolved
   digest with the release evidence.
2. Confirm freshclam has successfully loaded a current signature database and
   `clamd` is listening only inside the backend network.
3. Upload a harmless text file through a disposable client-document or ticket
   record; confirm a clean response, scoped download and the staged → clean →
   released metadata sequence.
4. Upload the official EICAR test file in the same disposable tenant; confirm
   HTTP 422, no client document/attachment record, no retained binary and an
   `upload_quarantine_rejected` audit entry with `malware_detected`.
5. Stop ClamAV and repeat with a harmless file; confirm HTTP 503, no retained
   binary and `scanner_unavailable` or `scan_timeout` evidence.
6. Attempt the clean record from another restricted client identity; confirm
   the existing parent-record scope dependency denies list, download, mutation
   and deletion.

Retain timestamps, container image identity, signature freshness, the safe audit
records and the cross-client denial result with release evidence. Never retain
the EICAR bytes or a customer sample in Git or an externally visible report.

## Operations and recovery

- Alert on `upload_quarantine_failed`, repeated scanner timeouts, ClamAV restarts
  and stale signature updates. Failures must not be changed to clean manually.
- Retry by resubmitting the original file after scanner recovery. A failed
  request has no released record, so retries cannot expose the earlier bytes.
- Startup removes quarantine files older than one hour and marks matching
  interrupted records `error` with `stale_quarantine_removed`.
- Quarantine and retained private uploads are included in the platform recovery
  inventory. Restored non-clean records must remain inaccessible.
- Roll back the application and Compose definitions together. If the scanner
  boundary cannot be preserved, disable customer evidence uploads; never route
  around the scanner.
