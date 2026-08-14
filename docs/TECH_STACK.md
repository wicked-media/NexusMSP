# Nexus technology standard

| Technology | Approved responsibility |
|---|---|
| React / JavaScript | Nexus user experience and API consumers |
| Python / FastAPI | APIs, domain services, automation, integrations, AI and workers |
| MongoDB / Motor | Existing operational system of record; telemetry, snapshots and flexible documents |
| Supabase | Optional private Storage now; future Postgres/Auth/Realtime only behind Nexus services |
| Go | Existing Nexus Agent runtime |
| Rust | Future privileged Agent/OS/Edge/transport components when justified |

Adding technology is not an objective. Each addition needs an ownership, security, operations and rollback case.
