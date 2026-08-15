# Nexus data ownership registry

Status: initial audit baseline, 2026-08-14. This is a classification document, not a migration directive.

| Data domain | Authoritative store now | Secondary store | Classification | Reason / retention | Tenant scoped |
|---|---|---|---|---|---|
| Core clients, contacts, sites, users, tickets, contracts, invoices, products, projects and workflow records | MongoDB | None | Keep MongoDB; review before future relational migration | Existing live application documents and linked operational records | Client scope is widespread; formal tenant ownership is incomplete |
| Device identity, agent enrolment, commands and audit | MongoDB | None | Keep MongoDB | Current Agent control plane and operational history | Yes, by client/device; tenant standardisation is P0/P1 |
| Device telemetry, inventory, health, patches, network discovery and snapshots | MongoDB | None | Keep MongoDB | Flexible, changing, high-volume document workloads | Yes, by client/device |
| Web delivery records, client websites and provider-action intents | MongoDB (`web_sites`, `web_provider_actions`) | Synergy Wholesale is external evidence only | Keep MongoDB | Client-scoped delivery workflow; no provider credential or response becomes Nexus business truth | Yes, by client |
| Provider payloads, integrations, discovery caches and sync histories | MongoDB | None | Keep MongoDB | Flexible vendor schemas and ingestion data | Yes, provider/client mapping required |
| Events, event deliveries, AI analysis, diagnostics and generated operational documents | MongoDB | None | Keep MongoDB; review retention/indexes | Document/event-shaped workload | Tenant/client fields need consistent enforcement |
| PDFs, attachments, branded exports and client artifacts | MongoDB metadata / filesystem today | Optional Supabase Storage binary mirror | Derived/replicated binary artifact | Supabase adapter stores immutable private objects; Nexus metadata and permissions remain in MongoDB | Yes; object paths include record/client IDs but require server authorisation |
| Supabase Auth, Realtime, Postgres business tables | Not used as business authority in repository | Optional future infrastructure | Review | No SQL migrations or domain table access are present in source audit | Not yet applicable |

## MongoDB collection placement map

The following static collection families were found through `db.<collection>` usage. Individual collections inherit the stated classification; a collection should be promoted to an individual decision when it is migrated, externally replicated, or handles a regulated retention class.

| Collection family | Examples | Classification | Ownership rule |
|---|---|---|---|
| Core business records | `clients`, `contacts`, `tickets`, `contracts`, `invoices`, `products`, `projects`, `time_entries`, `purchase_orders` | Keep MongoDB | Current authoritative operational data; no migration without counts, mapping, tests and rollback |
| Client and portal records | `client_*`, `portal_*`, `onboarding_*`, `client_portal_users` | Keep MongoDB | Require explicit `client_id`; formal `tenant_id` rollout is a P1 boundary |
| Endpoint and network observations | `devices`, `device_*`, `network_*`, `bandwidth_*`, `health_*`, `patch_*` | Keep MongoDB | Natural document/snapshot workload; define retention, TTL and indexes before scale-out |
| Agent / Edge / OS control plane | `nexus_agent_*`, `nexus_agents`, `nexus_deployments`, `nexus_edge_*`, `nexus_jump_*` | Keep MongoDB | Privileged records require client/device scope, immutable audit and expiry policies |
| Security, DNS and mail telemetry | `nexus_shield_*`, `nexus_dmarc_*`, `nexus_dns_*`, `nexus_mail_shield_*`, `identity_threats` | Keep MongoDB | Flexible signals and reports; materialised scores must identify their source and timestamp |
| Integrations and provider caches | `m365_*`, `acronis_*`, `pax8_*`, `cipp_*`, `huntress_*`, `yeastar_*` | Keep MongoDB | Vendor response/cache data is not a second source of truth for Nexus business entities |
| Web delivery and provider intents | `web_sites`, `web_provider_actions` | Keep MongoDB | Nexus owns the client delivery record; Synergy actions and responses are provider evidence, approval-gated and auditable |
| Workflow, approvals and automation | `approvals`, `approval_workflows`, `automation_*`, `playbook_executions`, `maintenance_*`, `change_*` | Keep MongoDB | Sensitive actions require actor, scope, policy, correlation and audit evidence |
| Events, activity and analysis | `activity_logs`, `audit_logs`, `platform_events`, `platform_event_*`, `events`, `ai_*`, `diagnostic_*` | Keep MongoDB | Append-oriented history; set retention, idempotency and correlation standards |
| Documentation and binary metadata | `documentation`, `knowledge_articles`, `help_articles`, `generated_reports`, `client_documents`, `chat_files` | Mongo metadata + optional Supabase Storage replica | Record whether content is in Mongo/filesystem/Supabase and retain one authoritative metadata record |
| Personal productivity / UX | `dashboard_layouts`, `saved_views`, `notifications`, `presence_state`, `team_*`, `chat_*` | Keep MongoDB | Must be bound to actor and tenant/client as appropriate |

## Required placement decision

Use PostgreSQL when a new domain needs transactional, relational, constrained business truth. Use MongoDB for variable-shape ingestion, telemetry, snapshots and document-centric retrieval. Add the decision and any cache/replica semantics here before introducing the new store.
