# Network Studio audit and consolidation plan

## Scope and outcome

Network Studio is the technician-facing operating surface over the existing Nexus network domain. This audit preserves the current MongoDB-owned network site, device, client, telemetry and provider evidence. It does **not** introduce a second device registry, controller credential store, alert engine, collector, topology authority or customer/site relationship model.

## Discovered functionality

| Capability | Existing owner / route | Classification | Network Studio treatment |
| --- | --- | --- | --- |
| Network site register and site/device/client inventory | `network_sites`, `network_devices`, `network_clients`; `app.routers.networking` | Existing and working | Reused through `/networking/dashboard` and `/networking/sites`. Stable Nexus site IDs remain the scope boundary. |
| Direct UniFi controller management | `app.routers.unifi_controllers`; `/unifi/controllers/*` | Existing and working | Reused through the UniFi command centre; controller credentials remain encrypted and server-only. |
| UniFi Site Manager | `app.routers.unifi`; `/unifi/*` | Existing and working | Reused; tenant-bound Site Manager settings and derived `unifi_site_cache` remain the existing model. |
| Site WLANs, port profiles, DPI and controller sync | `app.routers.networking` | Existing but incomplete | Retained in Network Operations; action scope and provider support remain route-enforced. |
| Bandwidth observations and alerts | `bandwidth_data`, `bandwidth_alerts`; `app.routers.bandwidth_monitor` | Existing but incomplete | Reused as source-labelled controller telemetry. Counter totals are not rendered as live throughput. |
| DNS monitoring and controlled DNS policy | `app.routers.dns_monitor` | Existing and working | Linked as a complementary operating surface; it remains the DNS authority, not a duplicate Network Studio policy register. |
| Topology display | `app.routers.topology`; `/topology` | Existing but incomplete | Kept separate pending a provenance-carrying relationship model. Current inferred layout must not be presented as verified physical topology. |
| Edge connectivity verification | Nexus Edge ticket workflow | Existing and working | Reused for ticket-bound, allowlisted checks only; it is not general network scanning. |
| SNMP, LLDP/CDP, Syslog, multi-vendor collector, event streaming | No admitted collector/authority found | Missing | Not fabricated. Requires an approved adapter and collection architecture before implementation. |

## Phase 0 evidence matrix (2026-10-18)

The directive's broader search terms were reconciled against the repository.
This table is deliberately specific about what is *not* present: a navigation
item or seeded-development payload is not evidence of a production collector.

| Directive concern | Evidence found | Classification | Decision |
| --- | --- | --- | --- |
| Client and site association | `network_sites` with stable Nexus `id`, `client_id`, `site_id`; `app.routers.networking` | Existing and working | Keep `network_sites.id` as the site boundary; provider IDs remain metadata. |
| Network devices and clients | `network_devices`, `network_clients`; networking and bandwidth routes | Existing and working | Reuse as the existing inventory projections; do not create a Studio copy. |
| Direct UniFi controller access | `app.routers.unifi_controllers`, encrypted controller credentials and origin allowlisting | Existing and working | Keep the controller store and server-only calls. Private targets require the existing production allowlist. |
| UniFi Site Manager | `app.routers.unifi`, tenant-bound `settings.type: unifi`, `unifi_site_cache` | Existing and working | Reuse as the cloud-management adapter. It remains global-scope until a verified provider-site/client map is available. |
| WLAN, port profile and DPI records | Existing network child routes and `network_wlans`, `network_port_profiles`, `network_dpi` projections | Existing but incomplete | Retain behind the authoritative site scope; no claim of vendor parity where a provider does not report a field. |
| Bandwidth observations | `bandwidth_data`, `bandwidth_alerts`, `app.routers.bandwidth_monitor` | Existing but incomplete | Reuse only as retained, source-labelled observations. Cumulative bytes are not live Mbps; genuine rate graphs require timestamped deltas. |
| Network topology | `app.routers.topology`, `TopologyPage` | Existing but incomplete | Keep as inferred/current-device topology until relationship source, confidence and observation time are persisted. Do not call it a verified cable or port map. |
| DNS and domain checks | `app.routers.dns_monitor`, `DnsMonitorPage` | Existing and working | Link from Network Studio; DNS remains its own control and evidence owner. |
| Ticket-bound reachability checks | Nexus Edge / ticket connectivity verification surfaces | Existing and working | Reuse only for ticket-bound, target-allowlisted diagnostics. It is not a general scanner. |
| ICMP, TCP, SNMPv2/v3, LLDP, CDP, Syslog, VPN collection | No admitted backend collector or secure credential/target model | Missing | Phase 2 admission gate: adapter capability declaration, encrypted credentials, site-bound target allowlist, scheduler, rate/backpressure controls, retention/index decision, audit and tenant tests. |
| Push/SSE/WebSocket telemetry | No network telemetry fan-out found | Missing | Do not label periodic controller reads as push telemetry. Add only after the collection and retention contract exists. |
| Configuration export/backup, firmware orchestration, firewall/VPN administration | Provider-specific pages/actions only; no generic managed workflow | Unsupported or incomplete | Keep behind provider-specific permissions. A generic workflow needs change preview, approval, verification and vendor rollback evidence first. |
| Network security findings and incidents | Existing Security/DNS surfaces; no network-specific incident authority | Existing but poorly located | Feed source-labelled observations into Security Studio when admitted. Do not create a second incident engine. |

## Implementation order and gates

1. **Consolidation (in progress):** make `/networking` the premium operating
   view over existing scoped records. It must disclose observation freshness,
   collector source and unsupported dimensions. The Network Studio shell links
   to the same projections; it owns no copy.
2. **Collector admission:** before SNMP/ICMP/TCP or a site probe is introduced,
   document the adapter capability model, exact target allowlist, encrypted
   credential reference, collection schedule, retry/backoff policy, collector
   health and retention/index strategy in `DATA_OWNERSHIP.md`.
3. **Measured telemetry:** accept only timestamped counter samples with source
   and collection time. Calculate rates from counter deltas with reset and
   discontinuity handling. An empty or stale stream is unknown, never zero or
   healthy.
4. **Topology provenance:** retain discovered/manual/inferred relationship
   source, confidence and observation time before adding port maps, traffic
   overlays or saved topology positions.
5. **Controlled operations:** configuration export, firmware, port and firewall
   actions require an explicit provider action contract, least privilege,
   approval for disruptive work, audit evidence, outcome verification and a
   stated rollback limitation.

## Consolidation decisions

1. `network_sites.id` remains the authoritative Nexus network-site boundary. UniFi provider aliases and IDs are provider metadata.
2. Existing controller/site-manager configuration is retained. Network Studio only links to the existing UniFi surfaces.
3. `network_devices` and `network_clients` remain the sole existing network inventory projections. No duplicate Studio-specific collection is created.
4. `bandwidth_data` and `bandwidth_alerts` remain the source-labelled observation and alert records. The Studio cannot call periodic polling "live" or treat missing data as a zero value.
5. Topology needs source, confidence and observation-time metadata before it can become an authoritative NOC map; current inferred relationships remain a disclosed separate workspace.

## Delivery phases

1. **Now:** a premium NOC overview over existing scoped records, a consolidated Studio contract, direct routes to Network Operations, UniFi, topology, bandwidth and DNS, and this audit.
2. **Next admitted backend phase:** capability-declared UniFi/SNMP/ICMP adapters, encrypted credential references, allowlisted targets, collection scheduling, retention/index plan, freshness and retry policy.
3. **After collector evidence exists:** retained telemetry graphs, interface counter normalisation, controller/site discovery, relationship provenance, health scoring and dependency-aware alert correlation.
4. **Only with vendor support and approval:** configuration backup, firmware/change workflows, firewall/VPN management and controlled diagnostics.

## Current limitations

- No universal SNMP, Syslog, LLDP/CDP, ICMP or TCP collector is currently admitted.
- No WebSocket/SSE network telemetry stream is currently available.
- Network topology is inferred from existing endpoint records and lacks relationship provenance; it is not a verified cable/port map.
- Direct controller actions are provider-specific and subject to existing RBAC/audit controls. No automatic disruptive network actions are introduced.
