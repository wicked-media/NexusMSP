# ADR-0001: deliberate polyglot persistence

**Status:** Accepted, audit baseline (2026-08-14).

Nexus will retain MongoDB and Supabase/PostgreSQL where each has a clear responsibility. MongoDB remains the existing authoritative application store. Supabase Storage is optional private artifact infrastructure and is not a business source of truth. No data migration is approved by this decision.

New Postgres business domains require a separately approved source-of-truth declaration, schema mapping, dry run, validation, backup and rollback plan.
