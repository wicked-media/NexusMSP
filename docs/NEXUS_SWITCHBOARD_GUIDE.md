# Nexus Switchboard guide

## What Switchboard does today

Nexus Switchboard is the MSP-wide migration workbench. It records the plan
that must exist before Nexus connects to a source, reads a source export or
writes a client, contact, ticket, device, billing or documentation record.

The current release is deliberately **planning and dry-run evidence only**.
It does not query Syncro, HaloPSA, NinjaOne, ConnectWise, Autotask, Hudu, IT
Glue or a CSV file. It does not import data.

## Start a migration programme

1. Open **Platform → Nexus Switchboard**.
2. Create a migration plan and select the source system.
3. Select only the object families that are intended to move in this wave.
4. Record the approved source-readiness evidence. Use a provider export or a
   fixture reference, never a personal token or credential.
5. Review every mapping. The relationship must use the source system plus an
   immutable source object ID, then resolve to a stable Nexus ID. Do not use a
   display name, email address or hostname as the relationship key.
6. Give every exception an owner, an outcome and a retry/compensation path.
7. Complete reconciliation and cutover gates only when their evidence exists.
8. Retain the plan review. It is not an approval to import or change a live
   customer system.

## What a provider adapter must prove later

Before a real import connector is enabled, it needs an isolated fixture or
sandbox, deterministic batch ID/checksum, repeat-import idempotency,
source-versus-Nexus reconciliation, attachment policy, failure/retry behaviour,
compensation or rollback handling, action permission, audit evidence and an
explicit cutover plan.

The legacy direct Syncro importer is not approved as the Switchboard engine.

## Related recovery rule

Before a migration pilot, use **Platform → Nexus Switchboard → Platform
recovery** to request and verify a Nexus Core restore point. A migration plan
does not replace a platform backup or a fresh-host restore drill.
