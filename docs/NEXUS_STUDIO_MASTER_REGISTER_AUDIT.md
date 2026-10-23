# Nexus Studio Master Register Audit

Last reviewed: 2026-10-15
Scope: the supplied 210 numbered Studio requirements

## Purpose

`backend/app/services/studio_master_register.py` is the permanent, source-controlled
requirements inventory for the 210-item handoff. It is deliberately separate from
the admitted Studio fleet: a requirement is not promoted to an operating Studio
merely because its title resembles a route or an existing page.

The authenticated read-only API exposes the full reconciliation at
`GET /api/studios/master-register`. The normal fleet endpoint also returns its
compact summary as `master_register`, allowing Market Place to show portfolio
coverage without inventing a second data store.

## Evidence-backed baseline

| Measure | Current value | Meaning |
| --- | ---: | --- |
| Numbered requirements | 210 | Every supplied row is preserved with its source number, domain and scope. |
| Evidence-backed canonical matches | 108 | A registered Studio or proposal has the same normalised title. |
| Registered Studio matches | 15 | These are admitted registry entries; their own admission and wired evidence still determine readiness. |
| Planned Studio matches | 69 | These remain proposals, not functional workspaces. |
| Extension, section, merge or served matches | 24 | These deliberately reuse a canonical surface rather than creating a duplicate Studio. |
| Portfolio-parent decisions | 102 | Domain-led ownership decisions that prevent orphaned scope. They are explicitly not feature, provider or release evidence. |
| Unmapped requirements | 0 | Every supplied requirement now has an accountable existing Nexus portfolio parent. |

The reconciliation first uses exact-title evidence. Every remaining item then
receives a reviewed, domain-led portfolio-parent decision in
`PORTFOLIO_PARENT_BY_DOMAIN`. For example, the Microsoft 365 requirement is
owned by the Cloud & Identity portfolio and Backup & Recovery is owned by the
Protection portfolio. These are architecture decisions, not title matching and
not proof that a provider integration or operating workflow is delivered.

## Architecture boundary

- The master register is static product declaration. It creates no MongoDB or
  PostgreSQL record, no collection, no new data owner and no customer-scoped
  write path.
- Admitted Studios remain governed by `studio_registry.py`; proposed work remains
  governed by `studio_proposals.py` and its gates.
- The browser reads the Nexus API; it does not read the register from a database
  or static client asset.
- A future canonical mapping must name its owning product, data owner, server-side
  authorisation boundary, audit event, test plan and provider limitation.

## Completion sequence

1. For each portfolio-parented requirement, attach existing route/API/test evidence or mark
   it `missing` / `blocked`; never infer `implemented` from a title match.
2. Promote only the highest-value items whose admission gates, tenancy,
   permissions, auditability and rollback behaviours are complete.
3. Keep the Marketplace limited to admitted Studios and approved proposals; do
   not generate pages for the remaining requirements.

## Verification

- `backend/tests/test_studio_master_register.py` checks count, unique source
  numbers, parent-map disclosure and summary derivation.
- `backend/tests/test_studio_fleet.py` continues to protect the admitted fleet,
  proposal disposition and gate contracts.
- `frontend/src/pages/StudiosHubPage.jsx` displays the compact summary only; it
  does not represent an unresolved requirement as a usable technician tool.
