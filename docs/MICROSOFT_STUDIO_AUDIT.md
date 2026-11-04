# Microsoft Studio integration inventory

## Purpose and boundary

Microsoft Studio is the primary Nexus interface for Microsoft cloud evidence. It reuses the existing Microsoft provider boundary and never creates a browser-to-Graph path, a second tenant registry, or a duplicate synchroniser. Microsoft tenant IDs remain external-provider identifiers; Nexus client and platform tenancy is resolved server-side before any provider evidence is read.

## Reused capabilities

| Capability | Existing boundary | Studio exposure | State |
|---|---|---|---|
| Tenant inventory and client mapping | `m365_tenants`, `m365_tenant_connections`, provider visibility resolver | Overview and Inventory | Reused |
| Connection status and collector contract | `GET /m365/connection`, `GET /m365/sync/readiness` | Diagnostics | Reused |
| Entra user and MFA evidence | `m365_users`, `GET /m365/mfa-analytics` | Overview; source route retained | Reused, collector dependent |
| GDAP evidence | `m365_gdap`, `GET /m365/gdap` | Overview attention | Reused, provider evidence required |
| Microsoft security evidence | security alerts, identity risk, CA and Defender provider caches; `GET /m365/security/posture` | Security | Reused, collector dependent |
| Licence evidence | `m365_licenses`, `GET /m365/licensing/posture` | Existing Control Plane route retained | Reused, provider evidence required |
| Reference standards | `GET /m365/standards`, CIPP/Nexus policy surfaces | Existing Control Plane route retained | Reference-only until a verified evaluator exists |
| Governed actions | existing action permissions, activity audit and Control Plane action centre | Linked from Studio; not duplicated | Reused |

## Consolidation decisions

- `GET /m365/studio-overview` is a read-time composition only. It owns no documents, credentials, Graph client or background job.
- Existing Control Plane routes remain canonical for connection configuration and governed actions. Studio links to them rather than copying their workflows.
- A missing stream is rendered as `not_reported` or `connection_required`, never as zero alerts, zero risk, a passing control or a current data point.
- No Graph write, bulk action, CA deployment, licence change, account lifecycle operation or PowerShell execution is enabled by the Studio overview.

## Implemented Studio command catalogue

Microsoft Studio now exposes the Nexus-governed command catalogue through
`GET /m365/capabilities/{area}` for Administration, Changes, Automation and
Settings.  Each card names the server-side route family, required Nexus action
permissions, provider/client-mapping prerequisites, execution state and the
contextual Control Plane or settings workflow that owns the action.

This catalogue is intentionally not an assertion that every endpoint in every
CIPP deployment is compatible with Nexus. CIPP remains an optional execution
adapter. A card never grants provider access, bypasses a tenant mapping, or
turns saved credentials into verified provider authority. Microsoft Activity
remains planned until the event catalogue has a Microsoft-specific subject
family; unrelated connector events are not displayed as a tenant action
timeline.

## Current blockers and admission requirements

The current repository has no verified Microsoft Graph synchroniser. Before activating additional administration or reporting features, Nexus needs a separately approved provider adapter with: least-privilege consent per evidence stream, tenant-scoped token isolation, pagination/delta strategy, retry/backoff and throttling policy, source timestamps, idempotent writes, audit attribution, and an action preview/approval/verification path. Features requiring Microsoft licensing, Partner Center/GDAP consent, Exchange or Teams PowerShell, Defender APIs, or retained audit logs remain unavailable until their specific provider capability is verified.

## Next admitted work

1. Verify a read-only Graph collector in a safe tenant and record source freshness for identity, licences and security streams.
2. Add paginated, server-scoped tenant and user drill-downs to Studio without altering current Control Plane authority.
3. Add a baseline evaluator as a read-only comparison with explicit evidence gaps; do not enable remediation until an approved action adapter can read back a result.
4. Expand Intune, Exchange, SharePoint, Teams, Defender and audit views only after their provider evidence and licensing requirements are separately admitted.
