# Nexus data architecture

MongoDB currently owns Nexus operational records. Supabase Storage may retain immutable private binary artifacts while MongoDB retains record metadata, permissions and workflow state. PostgreSQL is not yet an in-repository business-data authority.

Every cross-store link uses stable Nexus IDs. Derived copies must be marked derived, cached, replicated or materialised. New storage placement must follow the registry in `DATA_OWNERSHIP.md`; no migration is implied by this document.
