# NexusMSP security review

Review date: 2026-08-06  
Scope: FastAPI backend, React production dependencies/build, Go endpoint agent, production container model, and the highest-impact client/device/ticket/remote/billing paths.

## Outcome

The validated findings discovered in this pass were fixed. The final Python static scan reports no medium or high findings. This is a strong engineering gate, not a penetration-test certification.

## Fixed findings

| Boundary | Issue | Resolution | Verification |
|---|---|---|---|
| Remote access | RustDesk secrets could be retained without a single encrypted boundary and remote session targeting needed stronger scope guarantees. | Central encrypted secret handling, permission checks, target scoping, expiry, and session audit controls. | `test_rustdesk_security.py` and the deterministic backend gate. |
| Workshop/field exports | Static shared temporary filenames allowed collisions and symlink-style replacement risk. | PDFs and QR images are generated in memory; download names are sanitized. | `test_workshop_field_scope_contracts.py`. |
| Workshop/field records | Several specialist ticket routes loaded records by ID without a consistent client boundary. | Router-level record-scope dependencies and scoped queue queries. | Focused tenant-boundary tests. |
| Device/ticket attachments | Routes accepted attacker-controlled extensions and did not consistently enforce the parent record's client scope. | Shared allow-listed extension handling, canonical upload roots, parent record-scope dependencies, and safe display filenames. | `test_upload_security.py`. |
| Client profile assets | Client paths lacked a shared scope dependency and allowed active SVG uploads on the application origin. | Client-identity scope enforcement and removal of SVG from public asset types. | `test_upload_security.py`. |
| Invoice QR generation | A predictable temporary QR filename could collide in a shared runtime. | Unique OS-managed temporary file with guaranteed cleanup. | Compile, regression, and static-analysis gates. |
| Non-security hashes | MD5/SHA-1 used for stable visual or record identifiers were misclassified as cryptographic use. | Explicit `usedforsecurity=False` annotations document the invariant. | Final static scan. |

## Verification evidence

- Backend: 276 deterministic tests passed; 163 legacy live-stack probes are explicitly excluded from the unit gate.
- Frontend: 23 tests passed; production build completed; high/critical production dependency gate passed.
- Agent: `go test ./...`, `go vet ./...`, and Windows amd64 build passed.
- Python static analysis: 95k+ lines reviewed by Bandit; 0 medium and 0 high results. Remaining low results are dominated by non-cryptographic randomness, deliberately ignored best-effort enrichments, literal status values, and `xml.sax.saxutils.escape` false positives.

## Threat model summary

Primary assets are customer isolation, technician identity and authorization, endpoint command authority, integration secrets, audit history, customer correspondence, invoices/contracts, and recovery evidence. Principal boundaries are browser → API, API → MongoDB, API/worker → external providers, API → agent command queue, agent → endpoint OS, and public/static upload delivery.

The most consequential attacker paths are:

1. A restricted technician changes a path identifier to access another customer's record.
2. A stolen technician token invokes remote or endpoint command capabilities.
3. A crafted upload escapes storage, serves active content, or overwrites another file.
4. A forged provider/webhook event changes billing, service quantity, or customer correspondence.
5. A compromised agent impersonates another device or accepts an unauthorized command.
6. A background task reports success before the provider-side effect is durable.

## Residual work before broad production

- Run authenticated dynamic API tests with two restricted technicians and at least two clients; verify cross-client IDs return indistinguishable 404/403 outcomes as designed.
- Add malware scanning and content-signature verification for customer uploads before enabling broad external portal uploads.
- Keep defence-in-depth rate limiting at the public ingress for login and add edge policy for upload, webhook, password reset, and expensive AI/report routes. Login also has a Mongo-backed application guard with hashed identifiers and explicit proxy trust.
- Complete external delivery tests for email/SMS, Microsoft, Xero, Yeastar, backup providers, and RustDesk using dedicated sandbox tenants.
- Commission an independent penetration test before handling broad customer fleets or regulated data.
- Replace the remaining 127 frontend lint warnings incrementally, prioritising hook dependencies rather than hiding them with a larger warning budget. The accessibility-specific lint backlog is now clear.

## Reviewed surfaces

| Surface | Risk area | Outcome | Notes |
|---|---|---|---|
| Authentication and secret configuration | Token forging, credential exposure | No surviving finding | Production refuses to start without JWT secret; encrypted integration-secret boundary added. |
| Remote access and agent commands | Privileged endpoint control | Fixed | Explicit permission, client scope, target binding, expiry, and audit checks. |
| Workshop, field, client, device and ticket identifiers | Cross-tenant object access | Fixed on reviewed paths | Focused tests added; broader authenticated DAST remains required. |
| Uploads and generated documents | Traversal, active content, collision | Fixed on reviewed paths | Shared extension control, canonical roots, SVG restriction, in-memory documents. |
| Billing/recurring services | Cross-client and false-success integrity | No surviving finding on golden paths | Fail-closed source quantity and idempotent invoice hand-offs covered by tests. |
| Frontend production dependencies | Known high/critical advisories | Passed | One documented React Router advisory is temporarily accepted because the SPA does not use RSC/server actions and no patched 7.x release exists. |
| Go agent | Build, tests, static vetting | Passed | Windows amd64 artifact built locally and in CI. |
