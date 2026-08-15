# Synergy Wholesale integration boundary

Nexus Web Studio is the governed operational workspace for client-owned websites, domains, hosting, WordPress delivery and associated provider actions. The source of truth for Nexus web-delivery records is the `web_sites` MongoDB collection; Synergy responses are external evidence and must never silently replace the Nexus record.

The Synergy Wholesale API v3.17 is SOAP/WSDL at `https://api.synergywholesale.com`. It supports domain inventory and renewal, DNS/DNSSEC, hosting/cPanel lifecycle and temporary URLs, SSL lifecycle, and Microsoft 365 subscription lifecycle.

## Production connection prerequisites

- Set `SYNERGY_WHOLESALE_RESELLER_ID` and `SYNERGY_WHOLESALE_API_KEY` only in the backend secret store.
- Allowlist the production Nexus connector egress IP with Synergy before enabling any live call.
- Never send credentials to the browser, records, logs, tickets or generated documents.
- Begin with read-only inventory sync. Provider mutations require a Nexus action, an approval policy, an idempotency key, audit evidence and post-action verification.

## Supported safe workflow states

Until the server-side connector is configured, Nexus can create web-delivery records and provider-action requests, but does not call Synergy. Such actions remain `pending_connector`. Once configured they must be reviewed under the shared Nexus Action Model before invoking any provider mutation.
# Synergy Wholesale

Nexus supports the documented Synergy Wholesale v3.17 SOAP/WSDL surface for
domains, DNS, hosting/cPanel, SSL certificates and Microsoft 365 subscriptions.

## Security and workflow

- Synergy reseller ID and API key are server-side environment variables only.
- Configure `SYNERGY_WHOLESALE_WSDL` in the deployment along with
  `SYNERGY_WHOLESALE_RESELLER_ID` and `SYNERGY_WHOLESALE_API_KEY`.
- Configure a distinct Fernet key in `SYNERGY_ACTION_ENCRYPTION_KEY`; pending
  provider-change inputs are encrypted at rest and only decrypted immediately
  before approved execution.
- Allowlist the Nexus connector's source IP in Synergy before enabling live use.
- The connector validates a fixed Nexus operation catalogue against the live
  WSDL; the browser cannot request arbitrary SOAP commands.
- Read operations are tenant-scoped and auditable. Purchases, renewals,
  transfers, DNS/hosting changes, certificate changes and subscription changes
  create a shared approval request. A global operator must execute the exact
  approved action after it is approved.
- Provider responses and stored action evidence redact credential-shaped fields.

## API routes

- `GET /web-studio/integrations/synergy-wholesale/catalogue` shows the governed
  Nexus catalogue.
- `POST /web-studio/integrations/synergy-wholesale/actions` submits a scoped
  read or approval-backed change.
- `POST /web-studio/integrations/synergy-wholesale/actions/{id}/execute` runs
  an independently approved change once.

Nexus remains the system of record for customer, domain, certificate and web
delivery records. Synergy responses are integration evidence, not a second
authoritative customer record.

## Managed WordPress sites

Each Web Studio site is explicitly linked to its Nexus client and may carry a
service plan, agreement reference, billing status and monthly service value.
This keeps website support visible to service and billing workflows instead of
leaving it as an unowned hosting login.

To enable WordPress inventory, configure a distinct Fernet key in
`WEB_STUDIO_ENCRYPTION_KEY`, then link the site using a dedicated WordPress
Application Password over HTTPS. Nexus encrypts that password at rest and only
uses it server-side for the WordPress REST API inventory check.

Plugin, theme and core updates are approval-backed Nexus work items. They are
not silently executed through the browser; production execution is reserved for
the Nexus WordPress Control worker (for example a controlled WP-CLI/cPanel
worker) so backups, verification and rollback evidence can be required first.
