# Pilot route scope matrix

Last verified: 2026-10-06
Purpose: route-level evidence for the production-readiness gate *"Every pilot API/query/export/file/event/job/websocket enforces tenant and client scope"* (`NEXUS_PRODUCTION_READINESS_CHECKLIST.md`). This matrix is evidence, not the control: scope correctness is asserted by the focused suites listed below.

## Regenerating the route inventory

```bash
cd backend
../.venv/bin/python scripts/audit_route_scope.py
```

Prints one row per registered route with the authentication and tenant-scope markers found in its handler source, plus the "manual review" list of routes that carry no `get_current_user`-style marker. Marker detection is indicative evidence only — a route without a marker may authenticate through a capability token, agent identity or provider signature (see the triage table below), and a route with a marker is only *proven* safe by its tests.

## Inventory summary (2026-10-06)

| Measure | Count |
|---|---:|
| Registered routes (excluding health/docs) | 2,756 |
| Routes with an auth marker in handler source | 2,589 |
| Routes with a tenant-scope marker (`tenant_scoped_query`, `platform_tenant_id`, scope dependencies) | 1,088 |
| Routes requiring manual auth-mechanism triage | 167 |

## Pilot surfaces (the eight golden workflows)

All eight are covered end-to-end in `frontend/e2e/golden-workflows.spec.js` with separate client-restricted browser identities, and each denies foreign-client identifiers. Focused backend scope suites live in `backend/tests/` (49 `*scope*` / `*tenant*` suites).

| # | Golden workflow (E2E) | Route families | Cross-scope denial evidence |
|---|---|---|---|
| 1 | Ticket delivery and client history remain scoped | tickets, ticket notifications, nav counts | `test_ticket_*_scope.py`, `test_tenant_isolation.py`, `test_nav_counts_scope.py` |
| 2 | Remote request fails honestly when transport is unavailable and masks foreign devices | remote, device chat, command queue | `test_command_scope_boundaries.py`, `test_device_smart_scope.py`, `test_device_file_transfers_scope.py` |
| 3 | Purchase order receipt records ticket notification and rejects foreign orders | purchase orders, workshop/field | `test_workshop_field_scope_contracts.py`, `test_field_workshop_photo_scope.py` |
| 4 | Invoice and provider handoff state remain client scoped | invoices, billing reconciliation, Stripe | `test_invoice_*_scope.py`, `test_billing_reconcile_scope.py`, `test_stripe_billing_portal_scope.py` |
| 5 | Contract records stay client scoped; organisation reconciliation stays global | contracts, recurring services, finance | `test_recurring_invoice_scope.py`, `test_legacy_finance_scope.py` |
| 6 | PBX workspace keeps an unconfigured provider honest and denies foreign linking | Yeastar PBX, extensions | `test_yeastar_billing_scope.py`, `test_yeastar_extension_override_scope.py` |
| 7 | Microsoft control plane separates saved configuration from verified provider evidence | M365 lifecycle, control plane | `test_m365_tenant_scope.py`, `test_control_plane_overview_tenant_scope.py` |
| 8 | Web Studio records pending connector intent without crossing client scope | workflow automation, connectors | `test_workflow_automation_scope_boundaries.py` |

Cross-cutting surfaces: authentication/secret configuration (`app/database.py` refuses a missing JWT secret in production), uploads and quarantine (`test_upload_security.py`, `test_upload_quarantine.py`), and platform-wide isolation (`test_tenant_scope_queries.py`).

## Manual-review triage (the 167 marker-less routes)

These routes authenticate through mechanisms other than the marker vocabulary, so the inventory flags them for human confirmation. By bucket:

| Bucket | Routes | Intended auth mechanism | Required proof |
|---|---:|---|---|
| `/api/portal/v2/*` (customer chat portal) | 37 | Portal session/token | Confirm every room/message read validates the portal identity's client scope |
| `/api/portal-api/{token}/*` (client portal) | 9 | Opaque capability token bound to one client | Confirm token → client binding is enforced server-side on every call |
| `/api/nexus-agent/*`, `/api/nexus-elevate/agent` | 14 | Signed agent identity | Covered by agent trust services; confirm at release with the signed-binary gate |
| `/api/webhooks`, `/api/webhook-builder/*` | 8 | Admin dependency not in marker vocabulary / provider signature | Verify admin dependency on builder CRUD; verify signature checks on inbound webhooks |
| `/api/pay/*`, `/api/magic-portal/*`, `/api/csat/*`, `/api/kiosk/*` | 11 | Payment/session capability tokens | Confirm each token grants exactly one object scope |
| `/api/live-chat/agent`, `/api/status-board/*`, `/api/sms/webhook`, misc | remainder | Mixed (agent session, public board, provider signature) | Case-by-case review |

## Remaining work to close the checklist gate

1. Work through the triage table above and record the auth mechanism per route family (extend this doc's table).
2. Route any family without a deliberate mechanism behind `get_current_user`/module permissions or a scoped capability dependency, with a focused `test_*_scope.py`.
3. Commission the independent security review of this matrix (the checklist gate names it explicitly).
