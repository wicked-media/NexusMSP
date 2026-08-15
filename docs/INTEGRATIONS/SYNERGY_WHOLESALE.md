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
