# Nexus security architecture

Nexus enforces sensitive workflows server-side: authenticated identity, tenant/client scope, permission/policy evaluation, audit history and verifiable outcomes. Browser permission checks improve UX only.

Supabase service-role access is backend-only. MongoDB queries for client data must retain explicit server-side scope. Cross-tenant access is release-blocking. The current verification backlog and production controls are maintained in `SECURITY_REVIEW.md` and `NEXUS_ARCHITECTURE_PLAN.md`.
