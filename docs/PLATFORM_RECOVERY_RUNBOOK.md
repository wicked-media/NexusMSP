# Nexus platform recovery runbook

Nexus customer backup monitoring is not a backup of the Nexus platform itself. This runbook covers the **Nexus application database and persistent Nexus files** so that a fresh host can be restored or a controlled server cutover can be performed.

The recovery package is confidential. It contains a MongoDB application dump and may therefore contain confidential or encrypted business records. Store it only in an approved encrypted, access-controlled, off-host backup location.

## Scope and deliberate exclusions

`Export-NexusPlatformRecovery.ps1` packages:

- the selected MongoDB Nexus database via `mongodump`;
- public uploads (`backend/uploads` by default);
- private uploads (`backend/private_uploads` by default);
- generated Agent installers (`data/agent-installers` by default);
- `manifest.json` with payload checksums, source database name and inclusion state.

It deliberately does **not** package or display:

- MongoDB connection credentials, `.env` files or host secrets;
- `JWT_SECRET`, `NEXUS_SECRET_ENCRYPTION_KEY`, provider credentials or TLS keys;
- Agent PKI/signing keys (`data/agent-pki`);
- container images, DNS/TLS/ingress configuration, external-provider state or customer endpoint data.

Those settings must be recreated or restored through the approved secret-management and infrastructure process. A package is not encrypted by the script itself; protect it with encrypted storage and restrict access.

## Pre-requisites

1. Install matching MongoDB Database Tools (`mongodump`, `mongorestore`, `mongosh`) on the backup and restore host.
2. Confirm the database, public uploads, private uploads and installer paths are durable. In Docker, named volumes are not ordinary host folders: expose or stage each relevant volume before invoking the scripts.
3. Keep the package checksum separately from the package. Test a recovery in an isolated environment at least quarterly and after major platform changes.
4. Never run a restore against a live production target while the API or worker can write data.

The production Compose configuration mounts `nexus-uploads`, `nexus-private-uploads` and `nexus-installers`. Confirm that the deployed host is using that current Compose configuration before relying on a recovery result; older deployments may not contain the private-artifact volume. This is a production-readiness requirement, not a cosmetic warning.

## Create a recovery package

Run from the repository root or provide absolute paths. Supply the Mongo URI through a secure shell/history policy; the script never print it.

```powershell
./scripts/Export-NexusPlatformRecovery.ps1 `
  -MongoUri '<secure MongoDB URI>' `
  -DatabaseName 'nexusmsp' `
  -OutputDirectory 'D:\Nexus-Recovery' `
  -UploadsPath 'D:\Nexus-Volumes\uploads' `
  -PrivateUploadsPath 'D:\Nexus-Volumes\private-uploads' `
  -InstallersPath 'D:\Nexus-Volumes\agent-installers' `
  -Label 'pre-release'
```

Record the package filename, SHA-256 output, time, actor, MongoDB tool version and off-host storage location in the change record. Do not keep the only copy on the Nexus server.

## Validate a package without changing anything

The import command is inspect-only unless both execution switches are supplied. It validates archive paths, the manifest, every payload checksum and the target database name.

```powershell
./scripts/Import-NexusPlatformRecovery.ps1 `
  -PackagePath 'D:\Nexus-Recovery\nexus-platform-pre-release-YYYYMMDD-HHMMSS.nexus-recovery.zip' `
  -MongoUri '<secure target MongoDB URI>' `
  -DatabaseName 'nexusmsp'
```

Use this validation on the destination host before a cutover.

## Fresh-host restore and server cutover

1. Build the destination using the approved Nexus release and infrastructure configuration. Create the target MongoDB database but do not allow API or worker traffic.
2. Supply new secure environment configuration. Do not reuse or transfer secret files casually. Preserve the original encryption key only through the approved secret-management process if existing encrypted records must remain readable.
3. Stage the recovery package on the destination host, verify it using the inspect-only command, and confirm the target database plus artifact destinations are empty.
4. Stop the target API and worker. Apply the package only after a change approval:

```powershell
./scripts/Import-NexusPlatformRecovery.ps1 `
  -PackagePath 'D:\Nexus-Recovery\nexus-platform-pre-release-YYYYMMDD-HHMMSS.nexus-recovery.zip' `
  -MongoUri '<secure target MongoDB URI>' `
  -DatabaseName 'nexusmsp' `
  -UploadsPath 'D:\Nexus-Volumes\uploads' `
  -PrivateUploadsPath 'D:\Nexus-Volumes\private-uploads' `
  -InstallersPath 'D:\Nexus-Volumes\agent-installers' `
  -Apply -AllowRestore
```

5. Start the API and worker only after the database and artifact files are present. Run the production health endpoint, authenticate as an approved administrator, open a client, ticket, device, attachment and Agent installer record, then retain the result as restore evidence.
6. Reconfigure and test integrations, inbound webhooks, email, DNS/TLS/ingress, worker scheduling and Agent connectivity. Rotate credentials that are not intentionally retained through the approved secret store.
7. Switch traffic only after the smoke test, audit review and rollback decision are recorded. Keep the previous host available but fenced from writes until the acceptance window closes.

## Existing-target overwrite (exception only)

The import script refuses to overwrite any non-empty database or included artifact directory by default. A live overwrite is an exception procedure:

1. Stop API and worker writes.
2. Create and verify a new recovery package of the **current target**.
3. Obtain an approved change and use a maintenance window.
4. Provide all of `-Apply`, `-AllowRestore`, `-AllowOverwrite`, a matching `-TargetConfirmation 'RESTORE nexusmsp'`, and `-PreRestoreBackupPackagePath` pointing to the verified current-target package.

The script retains replaced artifact directories beside the original path for manual rollback verification. Database restoration is not an atomic Windows System Restore action: external providers, secrets, Agent state, DNS and inbound messages do not roll back with MongoDB.

## Restore points and routine operations

Create a labelled package before material changes (release, schema-affecting deployment, bulk import, integration cutover) and on a schedule owned by operations. A “restore point” is only valid when its checksum, storage location, recovery scope and a successful isolated restore test are recorded.

For an individual Nexus action, prefer the action’s own audit trail, compensating action or approval workflow. Do not use a full platform restore to undo a single ticket, invoice or configuration edit.

## Completion evidence

Record: package ID, checksum, actor, source/destination, start/end time, MongoDB tool versions, included artifact folders, import log location, smoke-test results, unresolved exceptions and the final cutover/rollback decision. A successful UI load alone is not restore proof.
