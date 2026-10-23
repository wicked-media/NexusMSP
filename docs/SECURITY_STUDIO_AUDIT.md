# Security Studio audit and consolidation plan

## Purpose and boundary

Security Studio is the Nexus operations surface for observed security posture,
alerts, incidents, investigations and governed response. It composes existing
provider and Nexus evidence; it does not create a parallel endpoint registry,
Microsoft tenant registry, alert engine or incident database. Missing provider
evidence is displayed as unmeasured or unavailable, never as a clean posture.

## Existing capability inventory — 2026-10-18

| Area | Existing owner | Classification | Consolidation decision |
| --- | --- | --- | --- |
| SOC alert lifecycle and ticket linkage | `soc_alerts`, `soc.py`, tickets, audit logs | Existing, working | Keep as the canonical Nexus incident workflow; enforce client scope and audit every state change. |
| Security posture projection | `security_dashboard.py`, devices, SOC alerts, canary triggers | Existing, working derived view | Reuse in Security Studio; freshness and unassessed coverage stay explicit. |
| Endpoint posture | `endpoint_security.py`, agent evidence | Existing, partial | Keep agent-backed assessments and distinguish enrolled, assessed and inventory-only endpoints. |
| Vulnerability management | `vulnerability_scanner.py`, `vulnerabilities` | Existing, partial | Reuse as the authoritative Nexus vulnerability projection; add provider adapters only with verified source/provenance. |
| Huntress | `huntress.py`, settings, action/audit records | Existing, partial | Canonicalise secure server-side credentials and retain capability/plan limitations. Provider organisation-to-client mapping remains a release gate. |
| Legacy Huntress settings | `soc.py`, `integration_settings` | Duplicated / unsafe legacy path | Preserve backward-compatible GET/PUT routes but delegate them to the canonical encrypted credential owner. |
| Microsoft/Entra security | Microsoft Studio, M365 routers and connector evidence | Existing, partial | Reuse the existing tenant registry, Graph permissions and evidence models; do not make a second tenant store. |
| DNS, DMARC and mail security | DNS Monitor, Nexus DMARC, Mail Shield | Existing, specialised | Keep each specialised Studio authoritative; Security Studio consumes only scoped posture and finding projections. |
| Emsisoft, Sentinel, Wazuh and provider-neutral SIEM ingestion | No verified adapter in this installation | Missing / unsupported | Add only as documented capability-declared adapters with explicit licensing and client mapping. |

## Security corrections in this pass

- Huntress API credentials now write only encrypted server-side fields.
- The legacy `PUT /huntress/settings` route delegates to the canonical secure
  handler rather than persisting an alternate plaintext credential record.
- The legacy settings GET now returns safe canonical connection state only.
- Security Dashboard and score-trend reads now combine tenant and client scope;
  the dashboard also exposes the latest recorded evidence timestamp without
  calling it live telemetry.
- Existing plaintext records remain available only in server memory for upgrade
  continuity; saving the integration replaces them with encrypted fields.

## Delivery order and gates

1. **Evidence consolidation** — finish provider/client mapping and timestamp
   disclosure across SOC alerts, endpoint posture and vulnerability evidence.
2. **Capability contracts** — publish documented, per-provider capabilities
   for Huntress, Defender/Graph, email security and future Emsisoft/SIEM sources.
3. **Incident correlation** — link only stable client/device/tenant IDs;
   deduplicate source events without destroying original provider evidence.
4. **Governed response** — containment, remediation and release actions remain
   scope-checked, approval-gated and outcome-verified.
5. **Coverage and reporting** — coverage gaps, baseline drift, RPO/resilience
   signals and compliance reports must retain provenance and source freshness.

## Current limitations

- Huntress is global-only until an explicit provider-organisation to Nexus
  client mapping is verified; restricted technicians must not receive raw
  provider telemetry.
- No connected Emsisoft, Sentinel or Wazuh adapter is verified here.
- Endpoint isolation through a Nexus record is intentionally retired; a real
  provider or agent-backed containment command is required.
- A successful provider request is not a verified containment result until
  the resulting endpoint/provider state is observed and recorded.
