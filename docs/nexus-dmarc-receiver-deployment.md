# Nexus DMARC receiver deployment contract

Nexus DMARC is designed to receive aggregate (`rua`) reports through a dedicated,
owned hostname such as `reports.nexusmsp.com`. This document is the deployment
contract for the inbound provider or edge service; it deliberately keeps the
public internet edge separate from the authenticated Nexus API.

## Required components

1. A DNS hostname owned by the Nexus operator, configured in **Email Security →
   Nexus DMARC control plane**.
2. An inbound email provider or mail gateway that accepts DMARC aggregate-report
   messages for that hostname and invokes the Nexus receiver webhook.
3. A receiver edge that validates the provider signature, extracts the XML from
   the message attachment, applies a 1 MB payload cap, and forwards it over the
   private network to `POST /api/nexus-dmarc/reports/xml` using a Nexus service
   identity.
4. The authenticated Nexus API, which verifies the registered client domain and
   records normalised evidence. It never publishes DNS from an incoming report.

## Required webhook payload

The receiver must supply the Nexus domain record ID and the raw aggregate XML:

```json
{
  "domain_id": "dmarc-domain-…",
  "xml": "<feedback>…</feedback>"
}
```

The edge must reject oversized messages, malformed archives, unsigned provider
webhooks, and reports whose destination address cannot be mapped to one Nexus
domain record. Do not expose the authenticated Nexus API directly to the public
mail provider.

## Operator validation

- Send a controlled DMARC aggregate sample through the provider.
- Confirm one new row appears in **Aggregate report evidence**.
- Verify source candidates show as *unverified*.
- Confirm no DNS record, mailbox, or enforcement policy changed as a side effect.
- Run the standard DNS-change approval path before publishing or editing any
  DMARC/SPF record.
