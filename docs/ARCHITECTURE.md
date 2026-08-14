# Nexus architecture

Nexus is a modular FastAPI/React platform with a Go endpoint agent, MongoDB operational persistence and optional Supabase platform capabilities. The public architecture is:

`React UI -> Nexus API -> domain/application services -> approved data/integration infrastructure`

The UI must not compose business decisions from direct database calls. Authentication, server-side authorisation, client/tenant scope, audit and policy checks belong in Nexus services. See `DATA_OWNERSHIP.md`, `DATA_ARCHITECTURE.md` and `SECURITY_ARCHITECTURE.md` for the operational rules.
