# Operator-supplied TLS certificates

Automatic HTTPS needs no files here. For a private CA or wildcard certificate,
place `fullchain.pem` and `privkey.pem` in this directory (they are excluded
from git), then enable the `tls` line documented in `../Caddyfile`.

Certificate and ACME material lives in the `nexus-caddy-data` volume at
runtime. It is deployment infrastructure state: never commit it, never include
it in recovery packages, and renew or replace it through the approved
certificate process.
