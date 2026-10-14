# Nexus Invent — batch 7: provider operations, identity and service assurance

Last reviewed: 2026-10-14
Governed by: [Nexus Product Constitution](NEXUS_PRODUCT_CONSTITUTION.md) · [Studio fleet](NEXUS_STUDIO_FLEET.md) · [Master capability register](NEXUS_MASTER_CAPABILITY_REGISTER.md)

Batch 7 records Studios **186–210**. It does not claim that any of them are
implemented. The catalogue entries live in
`backend/app/services/studio_proposals.py`, where every entry is either a gated
future studio, a section of a studio that already owns the domain, or an
explicit extension of an existing surface.

## Product decisions

| Capability group | Product home | Decision |
| --- | --- | --- |
| SD-WAN, BGP, transit, IPAM, interconnect and access networks | Nexus Infrastructure | Specialist provider-facing studios, read-only diagnostics first. |
| RADIUS, NAC, privileged operations, service accounts, reviews and lifecycle | Nexus Identity | Identity/provider adapters; Nexus never becomes a credential authority. |
| Service Gap and Operational Readiness | Operations Assurance | Sections of the existing evidence-first assurance studio. |
| Service Acceptance and Environment Comparison | Nexus Service | Gated service-delivery capabilities. |
| Change Risk | Nexus Automation | Governed proposal/approval/rollback capability, not an opaque score. |
| Acquisition, Multi-MSP and Customer Value | Nexus Growth | Gated on delegated scope and defensible outcome evidence. |
| Carrier Billing and Procurement Intelligence | Nexus Commerce | Reconciliation/recommendation over declared external sources; no automatic invoice changes. |
| Platform Health | Nexus Platform | Reliability capability with SLO and tenant-isolation evidence. |

## Admission rules

1. Network and carrier configuration begins **read-only**. Any future mutation
   needs provider-specific validation, a recorded approval, target scope
   validation, rollback evidence and post-change verification.
2. A missing signal is **unverified**, not healthy, failed or billable.
3. Service Gap may identify a mismatch, but it cannot alter a contract, service
   or invoice. Those records retain their existing authoritative owners.
4. Privileged Access extends Nexus Access/Elevate. Nexus records governed
   references and evidence; it does not receive, store or replay credentials.
5. Multi-MSP work remains blocked until a server-enforced delegated-scope model
   is approved. Tenant/client isolation is a release blocker.

## Data ownership

This batch adds no persistence, collection, replica or provider credential.
It is static capability-contract code, so no new datum has an owner yet. A
future implementation that creates service entitlements, provider routing
snapshots, access-review decisions, delegated-provider grants or SLO evidence
must first add a specific authoritative-owner decision to
`docs/DATA_OWNERSHIP.md` and enforce the corresponding server-side scope.
