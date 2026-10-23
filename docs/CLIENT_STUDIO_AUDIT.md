# Client Studio consolidation audit

## Outcome

Client Studio is an operating surface over the existing client domain. It does
not create a second customer, device, ticket, contract, invoice, document or
provider-integration registry.

## Reused evidence

| Technician question | Canonical projection or route | Boundary |
| --- | --- | --- |
| Which client accounts need attention? | `GET /api/client-health/dashboard` | Health is evidence-weighted; a client without sufficient independent evidence is unassessed, not healthy. |
| What is in the current account book? | `GET /api/clients-enriched` | Existing Clients workspace rollup; server-side tenant/client scope is preserved. |
| What is true for one client? | `GET /api/client-studio/{client_id}/360-context` | Canonical devices, contracts, subscriptions, tickets, invoices, stakeholders and notes, all bound to a stable client ID. |
| What renewals need a review? | `GET /api/client-studio/renewal-watch` | Recorded active contracts with a renewal/end date only; risk signals are disclosed evidence, not a churn prediction. |
| What changed recently around an account? | `GET /api/events/platform/recent` filtered to registered client-adjacent subjects | A bounded, tenant/client-scoped recent-event window; canonical tickets, devices, backup runs and billing records remain the authority. |
| Who is involved in the account? | Existing client contacts plus `client_stakeholders` | Contact ownership remains under review as recorded in `DATA_OWNERSHIP.md`; stakeholder maps are internal relationship context, not a replacement contact directory. |

## Deliberate non-claims

- No health or churn score is invented from missing integrations.
- No currency is presented by the Studio adapter when the source does not
  provide a verified currency convention.
- No billing, asset, ticket or provider mutation is introduced by the Studio
  overview.
- The renewal queue is a bounded 90-day review list, not a revenue, renewal or
  churn forecast.
- Existing per-client actions retain their own permission checks, client scope
  validation and audit record.

## Remaining delivery gates

The Client Studio can surface only recorded provider evidence. Provider-backed
Microsoft, security, backup and network dimensions remain unassessed until the
corresponding scoped collector/mapping has completed a verified read. Any new
write workflow must be admitted against the existing action catalogue, include
an audit event and preserve the owning collection described in
`DATA_OWNERSHIP.md`.
