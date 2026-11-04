"""NexusMSP's source-controlled 210-item Studio requirements register.

This is a requirements inventory, not a catalogue of claimed implementations.
It reconciles the master register with the admitted Studio registry and the
proposal ledger at read time, so a requirement without a canonical record stays
explicitly unmapped rather than gaining a decorative workspace.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Iterable

MASTER_REGISTER_VERSION = "2026-10-15"


# A portfolio parent is an explicit architecture decision, not an admission or
# an implementation claim. The master register's domains are intentionally
# broader than the current Studio names; retaining that distinction means every
# requirement has an accountable Nexus product without creating 210 duplicate
# workspaces or quietly treating a parent route as a delivered capability.
#
# Keep these ids aligned with the admitted Studio registry. A requirement that
# exact-matches an admitted Studio or a proposal always takes precedence over
# this fallback in ``reconcile``.
PORTFOLIO_PARENT_BY_DOMAIN: dict[str, str] = {
    "Cloud & Identity": "identity",
    "Commerce": "finance",
    "Communications": "communications",
    "Customer": "client",
    "Delivery": "service-desk",
    "Endpoint & Devices": "devices",
    "Governance": "compliance",
    "ISP & Carrier": "telecom",
    "Infrastructure": "network",
    "Operations": "service-desk",
    "Physical & Specialist": "devices",
    "Platform": "automation",
    "Protection": "backup",
    "Security & Identity": "security",
    "Web & Applications": "web",
}


def _key(value: str) -> str:
    """Normalise a Studio title for conservative identity matching."""

    value = str(value or "").lower().replace("&", "and")
    value = re.sub(r"\bstudio\b", "", value)
    return re.sub(r"[^a-z0-9]+", "", value)


# The master handoff is retained here as static product declaration. It does not
# contain tenant data and creates no persistence owner or execution surface.
MASTER_STUDIOS: tuple[dict[str, Any], ...] = tuple(
[    {"number":1,"name":"Microsoft 365 Studio","domain":"Cloud & Identity","scope":"Entra Exchange SharePoint OneDrive Teams Intune licensing"},
    {"number":2,"name":"Server Studio","domain":"Infrastructure","scope":"Windows and Linux server administration"},
    {"number":3,"name":"Network Studio","domain":"Infrastructure","scope":"Firewalls switches routers VPN VLAN topology"},
    {"number":4,"name":"Security Studio","domain":"Protection","scope":"Security operations endpoint and incident response"},
    {"number":5,"name":"Backup & Recovery Studio","domain":"Protection","scope":"Backup policies restores verification disaster recovery"},
    {"number":6,"name":"Telecom Studio","domain":"Communications","scope":"Yeastar PBX Atom Telecom services and billing"},
    {"number":7,"name":"Cloud Studio","domain":"Cloud & Identity","scope":"Azure AWS Google Cloud resource administration"},
    {"number":8,"name":"Virtualisation Studio","domain":"Infrastructure","scope":"VMware Hyper-V Proxmox clusters and VMs"},
    {"number":9,"name":"Email Studio","domain":"Communications","scope":"Mail flow mailbox management and delivery diagnostics"},
    {"number":10,"name":"Identity Studio","domain":"Cloud & Identity","scope":"Directory identity lifecycle roles SSO MFA"},
    {"number":11,"name":"Database Studio","domain":"Infrastructure","scope":"SQL Server MySQL PostgreSQL MongoDB operations"},
    {"number":12,"name":"DNS & Domains Studio","domain":"Infrastructure","scope":"DNS registrar DNSSEC certificates and renewals"},
    {"number":13,"name":"Hosting Studio","domain":"Web & Applications","scope":"Web hosting panels runtimes resources and certificates"},
    {"number":14,"name":"Print Studio","domain":"Endpoint & Devices","scope":"Printer fleet queues drivers and supplies"},
    {"number":15,"name":"Wi-Fi Studio","domain":"Infrastructure","scope":"Wireless infrastructure SSIDs roaming and diagnostics"},
    {"number":16,"name":"SaaS Studio","domain":"Cloud & Identity","scope":"Third-party SaaS subscriptions accounts and usage"},
    {"number":17,"name":"Migration Studio","domain":"Delivery","scope":"Tenant infrastructure email and website migrations"},
    {"number":18,"name":"Hardware Studio","domain":"Endpoint & Devices","scope":"Physical asset lifecycle warranty and diagnostics"},
    {"number":19,"name":"Application Studio","domain":"Web & Applications","scope":"Line-of-business software administration and troubleshooting"},
    {"number":20,"name":"Automation Studio","domain":"Platform","scope":"Automation authoring testing and orchestration"},
    {"number":21,"name":"Compliance Studio","domain":"Governance","scope":"Controls evidence exceptions and remediation"},
    {"number":22,"name":"Data Centre Studio","domain":"Infrastructure","scope":"Racks power cooling physical infrastructure"},
    {"number":23,"name":"ISP Studio","domain":"ISP & Carrier","scope":"Circuits CPE IP services provisioning and wholesale operations"},
    {"number":24,"name":"Field Studio","domain":"Delivery","scope":"Onsite technician jobs checklists and mobile workflows"},
    {"number":25,"name":"CCTV Studio","domain":"Physical & Specialist","scope":"Camera NVR DVR recording and health"},
    {"number":26,"name":"Access Control Studio","domain":"Physical & Specialist","scope":"Doors credentials access controllers and schedules"},
    {"number":27,"name":"IoT Studio","domain":"Physical & Specialist","scope":"Sensors gateways firmware telemetry and device identity"},
    {"number":28,"name":"POS Studio","domain":"Physical & Specialist","scope":"Retail payment terminals and store transaction systems"},
    {"number":29,"name":"Digital Signage Studio","domain":"Physical & Specialist","scope":"Displays media players playlists and playback"},
    {"number":30,"name":"Meeting Room Studio","domain":"Physical & Specialist","scope":"Conference rooms AV systems and readiness"},
    {"number":31,"name":"Mobile Device Studio","domain":"Endpoint & Devices","scope":"iOS Android MDM and device lifecycle"},
    {"number":32,"name":"Storage Studio","domain":"Infrastructure","scope":"NAS SAN shares capacity snapshots and performance"},
    {"number":33,"name":"Contract Studio","domain":"Commerce","scope":"Managed service agreements SLA terms and renewals"},
    {"number":34,"name":"Procurement Studio","domain":"Commerce","scope":"Supplier purchasing goods receipt and returns"},
    {"number":35,"name":"Finance Studio","domain":"Commerce","scope":"Billing AP AR margin reconciliation and reporting"},
    {"number":36,"name":"Project Studio","domain":"Delivery","scope":"Project planning milestones budgets and deliverables"},
    {"number":37,"name":"Workforce Studio","domain":"Delivery","scope":"Technician schedules skills rosters and capacity"},
    {"number":38,"name":"Customer Success Studio","domain":"Customer","scope":"Customer health satisfaction adoption and renewals"},
    {"number":39,"name":"Vendor Studio","domain":"Commerce","scope":"Supplier support cases contracts and performance"},
    {"number":40,"name":"Training Studio","domain":"Delivery","scope":"Technician learning paths and assessments"},
    {"number":41,"name":"Asset Disposal Studio","domain":"Endpoint & Devices","scope":"Data wiping recycling resale and certificates"},
    {"number":42,"name":"Insurance & Claims Studio","domain":"Commerce","scope":"Claims evidence damaged assets and replacement workflows"},
    {"number":43,"name":"Experience Studio","domain":"Endpoint & Devices","scope":"End-user digital experience diagnostics"},
    {"number":44,"name":"Incident Command Studio","domain":"Operations","scope":"Major incident coordination and recovery"},
    {"number":45,"name":"Change Control Studio","domain":"Operations","scope":"Technical change planning approval and verification"},
    {"number":46,"name":"Discovery Studio","domain":"Platform","scope":"Authorised asset and service discovery"},
    {"number":47,"name":"Documentation Studio","domain":"Platform","scope":"Self-maintaining technical documentation"},
    {"number":48,"name":"Customer Verification Studio","domain":"Customer","scope":"Identity verification for sensitive service desk requests"},
    {"number":49,"name":"Licence Intelligence Studio","domain":"Commerce","scope":"Cross-vendor licence entitlements and optimisation"},
    {"number":50,"name":"Operational Intelligence Studio","domain":"Platform","scope":"Cross-platform insights and improvement opportunities"},
    {"number":51,"name":"Certificate Studio","domain":"Security & Identity","scope":"Public certificates lifecycle deployment and trust"},
    {"number":52,"name":"API Studio","domain":"Web & Applications","scope":"API integrations webhooks auth and diagnostics"},
    {"number":53,"name":"Container Studio","domain":"Infrastructure","scope":"Docker Kubernetes registries and orchestration"},
    {"number":54,"name":"Endpoint Configuration Studio","domain":"Endpoint & Devices","scope":"Endpoint configuration policies and drift"},
    {"number":55,"name":"Patch Studio","domain":"Endpoint & Devices","scope":"OS application firmware patch management"},
    {"number":56,"name":"Power Studio","domain":"Infrastructure","scope":"UPS PDU power and outage readiness"},
    {"number":57,"name":"Connectivity Studio","domain":"Infrastructure","scope":"WAN VPN SD-WAN connectivity and failover"},
    {"number":58,"name":"Email Security Studio","domain":"Communications","scope":"SPF DKIM DMARC phishing and filtering"},
    {"number":59,"name":"Certificate Authority Studio","domain":"Security & Identity","scope":"Private PKI issuance revocation and lifecycle"},
    {"number":60,"name":"Firmware Studio","domain":"Endpoint & Devices","scope":"Device firmware inventory and rollout"},
    {"number":61,"name":"Warehouse Studio","domain":"Physical & Specialist","scope":"Warehouse scanners printers and connectivity"},
    {"number":62,"name":"Hospitality Studio","domain":"Physical & Specialist","scope":"Hotel technology guest connectivity and integrations"},
    {"number":63,"name":"Education Studio","domain":"Physical & Specialist","scope":"School classroom and education technology"},
    {"number":64,"name":"Healthcare IT Studio","domain":"Physical & Specialist","scope":"Healthcare practice technology and support"},
    {"number":65,"name":"Fleet Technology Studio","domain":"Physical & Specialist","scope":"Vehicle telematics gateways and fleet software"},
    {"number":66,"name":"Building Systems Studio","domain":"Physical & Specialist","scope":"Building management HVAC and telemetry"},
    {"number":67,"name":"Energy Studio","domain":"Physical & Specialist","scope":"Solar battery metering and energy monitoring"},
    {"number":68,"name":"Retail Studio","domain":"Physical & Specialist","scope":"Store kiosks POS and retail infrastructure"},
    {"number":69,"name":"Manufacturing IT Studio","domain":"Physical & Specialist","scope":"Plant IT dependencies and monitored OT interfaces"},
    {"number":70,"name":"Agriculture Technology Studio","domain":"Physical & Specialist","scope":"Rural telemetry connectivity and farm IoT"},
    {"number":71,"name":"Service Dependency Studio","domain":"Platform","scope":"Business service dependency mapping"},
    {"number":72,"name":"Technical Debt Studio","domain":"Operations","scope":"Legacy risk remediation and upgrade backlog"},
    {"number":73,"name":"Service Quality Studio","domain":"Operations","scope":"Support quality repeat incidents and outcomes"},
    {"number":74,"name":"Warranty & RMA Studio","domain":"Commerce","scope":"Warranty claims replacement and returns"},
    {"number":75,"name":"Technology Lifecycle Studio","domain":"Operations","scope":"Asset and service lifecycle planning"},
    {"number":76,"name":"Business Continuity Studio","domain":"Protection","scope":"Continuity plans recovery objectives and exercises"},
    {"number":77,"name":"Customer Onboarding Studio","domain":"Customer","scope":"Managed customer onboarding and acceptance"},
    {"number":78,"name":"Customer Offboarding Studio","domain":"Customer","scope":"Access transfer services billing and data handover"},
    {"number":79,"name":"Integration Reliability Studio","domain":"Platform","scope":"Connector health auth expiry and sync diagnostics"},
    {"number":80,"name":"AI Operations Studio","domain":"Platform","scope":"AI policy oversight evaluations and execution governance"},
    {"number":81,"name":"Firewall Studio","domain":"Infrastructure","scope":"Firewall rules NAT VPN and policy diagnostics"},
    {"number":82,"name":"Directory Studio","domain":"Cloud & Identity","scope":"Active Directory domains GPO and replication"},
    {"number":83,"name":"File Services Studio","domain":"Infrastructure","scope":"SMB NFS DFS access and file service diagnostics"},
    {"number":84,"name":"Collaboration Studio","domain":"Cloud & Identity","scope":"Teams SharePoint OneDrive and sharing"},
    {"number":85,"name":"Browser Studio","domain":"Endpoint & Devices","scope":"Enterprise browser policies and extensions"},
    {"number":86,"name":"Software Deployment Studio","domain":"Endpoint & Devices","scope":"Application packages staged deployment and removal"},
    {"number":87,"name":"Remote Workforce Studio","domain":"Endpoint & Devices","scope":"VPN VDI remote work connectivity"},
    {"number":88,"name":"Certificate Trust Studio","domain":"Security & Identity","scope":"Trusted roots certificate chains and stores"},
    {"number":89,"name":"Time & Synchronisation Studio","domain":"Infrastructure","scope":"NTP time drift and clock hierarchy"},
    {"number":90,"name":"Licensing Compliance Studio","domain":"Commerce","scope":"Entitlement usage and vendor compliance"},
    {"number":91,"name":"Problem Management Studio","domain":"Operations","scope":"Recurring incident root cause and known errors"},
    {"number":92,"name":"Service Catalogue Studio","domain":"Commerce","scope":"Service definitions provisioning and billing policies"},
    {"number":93,"name":"Customer Environment Studio","domain":"Customer","scope":"Unified customer technology operating context"},
    {"number":94,"name":"Service Activation Studio","domain":"Operations","scope":"Service provisioning verification and billing start"},
    {"number":95,"name":"Service Cancellation Studio","domain":"Operations","scope":"Deprovisioning supplier cancellation and billing stop"},
    {"number":96,"name":"Escalation Studio","domain":"Operations","scope":"Internal and vendor escalation orchestration"},
    {"number":97,"name":"Maintenance Studio","domain":"Operations","scope":"Cross-customer maintenance planning and windows"},
    {"number":98,"name":"Capacity Planning Studio","domain":"Operations","scope":"Forecast infrastructure licences and workload"},
    {"number":99,"name":"Customer Communication Studio","domain":"Customer","scope":"Incident and service customer communications"},
    {"number":100,"name":"Operations Assurance Studio","domain":"Operations","scope":"Verified managed-service outcomes and evidence"},
    {"number":101,"name":"Decision Studio","domain":"Operations","scope":"Technical decision analysis costs risks and options"},
    {"number":102,"name":"Runbook Studio","domain":"Platform","scope":"Executable versioned procedures"},
    {"number":103,"name":"Lab Studio","domain":"Platform","scope":"Isolated testing and simulation environments"},
    {"number":104,"name":"Trust Studio","domain":"Governance","scope":"Platform security attestations and customer assurance"},
    {"number":105,"name":"Extension Studio","domain":"Platform","scope":"Nexus-native extension SDK and governance"},
    {"number":106,"name":"Apple Studio","domain":"Endpoint & Devices","scope":"Apple endpoints and Apple Business Manager"},
    {"number":107,"name":"Linux Studio","domain":"Endpoint & Devices","scope":"Linux endpoint and server operations"},
    {"number":108,"name":"Windows Studio","domain":"Endpoint & Devices","scope":"Windows endpoint management and diagnostics"},
    {"number":109,"name":"Browser Management Studio","domain":"Endpoint & Devices","scope":"Managed browser settings policies and extensions"},
    {"number":110,"name":"Authentication Studio","domain":"Cloud & Identity","scope":"SAML OAuth OIDC federation and sign-in diagnostics"},
    {"number":111,"name":"Endpoint Performance Studio","domain":"Endpoint & Devices","scope":"Endpoint responsiveness startup and user experience"},
    {"number":112,"name":"Storage Recovery Studio","domain":"Infrastructure","scope":"Storage array snapshots and recovery"},
    {"number":113,"name":"Connectivity Diagnostics Studio","domain":"Infrastructure","scope":"Path MTU latency DNS and VPN diagnostics"},
    {"number":114,"name":"Peripheral Studio","domain":"Endpoint & Devices","scope":"Docks monitors USB scanners webcams and drivers"},
    {"number":115,"name":"Update Compatibility Studio","domain":"Endpoint & Devices","scope":"Software firmware OS and driver compatibility"},
    {"number":116,"name":"DevOps Studio","domain":"Web & Applications","scope":"Repositories CI/CD releases and production changes"},
    {"number":117,"name":"Application Runtime Studio","domain":"Web & Applications","scope":"Services workers queues and application hosts"},
    {"number":118,"name":"Observability Studio","domain":"Platform","scope":"Logs metrics traces and operational events"},
    {"number":119,"name":"Data Pipeline Studio","domain":"Web & Applications","scope":"ETL sync queues imports and exports"},
    {"number":120,"name":"Release Studio","domain":"Delivery","scope":"Coordinated software and infrastructure releases"},
    {"number":121,"name":"Sales Engineering Studio","domain":"Commerce","scope":"Technical assessments and proposal design"},
    {"number":122,"name":"Quoting Studio","domain":"Commerce","scope":"Quotes products labour margins and approvals"},
    {"number":123,"name":"Customer Roadmap Studio","domain":"Customer","scope":"Customer technology plans and upgrade proposals"},
    {"number":124,"name":"SLA Studio","domain":"Operations","scope":"Contractual response and resolution tracking"},
    {"number":125,"name":"Dispatch Studio","domain":"Delivery","scope":"Onsite job allocation routing and appointments"},
    {"number":126,"name":"Stockroom Studio","domain":"Commerce","scope":"Physical stock serials and transfers"},
    {"number":127,"name":"Subscription Studio","domain":"Commerce","scope":"Recurring services entitlements and quantities"},
    {"number":128,"name":"Customer Profitability Studio","domain":"Commerce","scope":"Customer margin cost and profitability"},
    {"number":129,"name":"Partner Studio","domain":"Customer","scope":"Delegated subcontractor and partner collaboration"},
    {"number":130,"name":"Marketplace Operations Studio","domain":"Platform","scope":"Extension distribution and lifecycle"},
    {"number":131,"name":"Repair Studio","domain":"Operations","scope":"Cross-system diagnosis repair and verification"},
    {"number":132,"name":"Policy Studio","domain":"Platform","scope":"Cross-platform configuration and operational policy"},
    {"number":133,"name":"Workflow Studio","domain":"Platform","scope":"Multi-system workflows retries and approvals"},
    {"number":134,"name":"Reliability Studio","domain":"Operations","scope":"Service reliability and recurring failure trends"},
    {"number":135,"name":"Automation Testing Studio","domain":"Platform","scope":"Safe testing of automation and scripts"},
    {"number":136,"name":"Configuration Studio","domain":"Platform","scope":"Cross-technology baselines and drift"},
    {"number":137,"name":"Deployment Studio","domain":"Delivery","scope":"Phased agents software and policy deployments"},
    {"number":138,"name":"Recovery Orchestration Studio","domain":"Protection","scope":"Dependency-aware business recovery"},
    {"number":139,"name":"Operational Forensics Studio","domain":"Operations","scope":"Incident timelines logs evidence and hypotheses"},
    {"number":140,"name":"Automation Economics Studio","domain":"Platform","scope":"Verified automation ROI time and costs"},
    {"number":141,"name":"Customer Technology Twin Studio","domain":"Customer","scope":"Living customer technical and commercial graph"},
    {"number":142,"name":"Service Profitability Investigator Studio","domain":"Commerce","scope":"Service-level costs revenue and margin analysis"},
    {"number":143,"name":"Customer Risk Forecast Studio","domain":"Customer","scope":"Customer technical risk forecasts"},
    {"number":144,"name":"Customer Investment Studio","domain":"Customer","scope":"Customer technology investment evaluation"},
    {"number":145,"name":"Revenue Assurance Studio","domain":"Commerce","scope":"Detect underbilling overbilling and supplier leakage"},
    {"number":146,"name":"Technician Memory Studio","domain":"Delivery","scope":"Preserved technician investigation context"},
    {"number":147,"name":"Time Intelligence Studio","domain":"Delivery","scope":"Evidence-assisted technician time entries"},
    {"number":148,"name":"Work Routing Studio","domain":"Delivery","scope":"Skills and context based work assignment"},
    {"number":149,"name":"Collaboration Intelligence Studio","domain":"Delivery","scope":"Cross-ticket discussion context and handovers"},
    {"number":150,"name":"Technician Development Studio","domain":"Delivery","scope":"Skills assessments and technician learning"},
    {"number":151,"name":"Service Simulation Studio","domain":"Platform","scope":"Service change impact simulation"},
    {"number":152,"name":"Vendor Replacement Studio","domain":"Operations","scope":"Vendor migration and tool replacement planning"},
    {"number":153,"name":"Autonomous Operations Studio","domain":"Platform","scope":"Policy-governed automated operations"},
    {"number":154,"name":"Product Engineering Studio","domain":"Platform","scope":"Internal Nexus engineering readiness and releases"},
    {"number":155,"name":"Ecosystem Studio","domain":"Platform","scope":"Developer vendor and partner ecosystem"},
    {"number":156,"name":"Contact Centre Studio","domain":"Communications","scope":"Call queues agents IVR and contact centre"},
    {"number":157,"name":"SMS Studio","domain":"Communications","scope":"Business messaging and delivery diagnostics"},
    {"number":158,"name":"Fax Studio","domain":"Communications","scope":"Cloud fax routing and transmission"},
    {"number":159,"name":"Unified Communications Studio","domain":"Communications","scope":"Voice video presence and collaboration"},
    {"number":160,"name":"SIP Studio","domain":"Communications","scope":"SIP trunks signalling SBC and call diagnostics"},
    {"number":161,"name":"Video Conferencing Studio","domain":"Communications","scope":"Conferencing endpoints and call quality"},
    {"number":162,"name":"Voice Quality Studio","domain":"Communications","scope":"Jitter latency loss and MOS diagnostics"},
    {"number":163,"name":"Number Management Studio","domain":"Communications","scope":"DID inventory porting allocation and billing"},
    {"number":164,"name":"Messaging Compliance Studio","domain":"Communications","scope":"Business messaging retention and policy"},
    {"number":165,"name":"Reception Studio","domain":"Communications","scope":"Virtual reception and call handling"},
    {"number":166,"name":"Data Governance Studio","domain":"Governance","scope":"Data classification ownership and retention"},
    {"number":167,"name":"Data Loss Prevention Studio","domain":"Governance","scope":"DLP controls alerts and remediation"},
    {"number":168,"name":"eDiscovery Studio","domain":"Governance","scope":"Legal hold authorised searches and exports"},
    {"number":169,"name":"Privacy Operations Studio","domain":"Governance","scope":"Privacy requests consent and retention"},
    {"number":170,"name":"Encryption Studio","domain":"Security & Identity","scope":"Encryption status keys and policies"},
    {"number":171,"name":"Secrets Studio","domain":"Security & Identity","scope":"Service credentials API keys and rotation"},
    {"number":172,"name":"Threat Exposure Studio","domain":"Protection","scope":"External attack surface and vulnerability posture"},
    {"number":173,"name":"Software Supply Chain Studio","domain":"Protection","scope":"SBOM dependencies and software provenance"},
    {"number":174,"name":"Identity Threat Studio","domain":"Protection","scope":"Identity security anomalies and investigations"},
    {"number":175,"name":"Data Recovery Studio","domain":"Protection","scope":"File and data restore investigations"},
    {"number":176,"name":"Rack Studio","domain":"Infrastructure","scope":"Rack layouts device placement and power"},
    {"number":177,"name":"Cabling Studio","domain":"Infrastructure","scope":"Patch panels structured cabling and test records"},
    {"number":178,"name":"Fibre Studio","domain":"ISP & Carrier","scope":"Fibre optics paths levels and diagnostics"},
    {"number":179,"name":"Environmental Studio","domain":"Infrastructure","scope":"Temperature humidity and leak sensors"},
    {"number":180,"name":"UPS Studio","domain":"Infrastructure","scope":"Battery health runtime and shutdown coordination"},
    {"number":181,"name":"Kiosk Studio","domain":"Physical & Specialist","scope":"Kiosk terminals connectivity and maintenance"},
    {"number":182,"name":"Laboratory Equipment Studio","domain":"Physical & Specialist","scope":"Authorised laboratory device monitoring"},
    {"number":183,"name":"Broadcast Studio","domain":"Physical & Specialist","scope":"Streaming encoding and distribution infrastructure"},
    {"number":184,"name":"Satellite Studio","domain":"ISP & Carrier","scope":"Satellite connectivity terminals and diagnostics"},
    {"number":185,"name":"Edge Studio","domain":"Infrastructure","scope":"Edge nodes gateways and offline operations"},
    {"number":186,"name":"SD-WAN Studio","domain":"ISP & Carrier","scope":"Software defined WAN policies and paths"},
    {"number":187,"name":"BGP Studio","domain":"ISP & Carrier","scope":"BGP sessions routes peers and policies"},
    {"number":188,"name":"IP Transit Studio","domain":"ISP & Carrier","scope":"Transit peers interconnect utilisation and cost"},
    {"number":189,"name":"IP Address Management Studio","domain":"ISP & Carrier","scope":"IPv4 IPv6 allocation and subnet management"},
    {"number":190,"name":"Carrier Interconnect Studio","domain":"ISP & Carrier","scope":"Carrier circuits handoffs and dependencies"},
    {"number":191,"name":"RADIUS Studio","domain":"ISP & Carrier","scope":"Network access authentication and logs"},
    {"number":192,"name":"Network Access Control Studio","domain":"Infrastructure","scope":"802.1X admission and network policy"},
    {"number":193,"name":"Wireless ISP Studio","domain":"ISP & Carrier","scope":"Fixed wireless towers radios and subscribers"},
    {"number":194,"name":"GPON Studio","domain":"ISP & Carrier","scope":"OLT ONT fibre access and subscriber operations"},
    {"number":195,"name":"Carrier Billing Studio","domain":"ISP & Carrier","scope":"Wholesale rating charges and reconciliation"},
    {"number":196,"name":"Privileged Access Studio","domain":"Security & Identity","scope":"JIT privilege elevation and session audit"},
    {"number":197,"name":"Service Account Studio","domain":"Security & Identity","scope":"Non-human identities and credential lifecycle"},
    {"number":198,"name":"Access Review Studio","domain":"Security & Identity","scope":"Periodic access review and remediation"},
    {"number":199,"name":"Zero Trust Studio","domain":"Security & Identity","scope":"Device identity and access posture"},
    {"number":200,"name":"Identity Lifecycle Studio","domain":"Security & Identity","scope":"Joiner mover leaver verification"},
    {"number":201,"name":"Service Gap Studio","domain":"Operations","scope":"Contracted provisioned monitored and billed reconciliation"},
    {"number":202,"name":"Service Acceptance Studio","domain":"Operations","scope":"Service delivery acceptance evidence"},
    {"number":203,"name":"Environment Comparison Studio","domain":"Operations","scope":"Customer environment baseline comparisons"},
    {"number":204,"name":"Change Risk Studio","domain":"Operations","scope":"Risk analysis for proposed technical changes"},
    {"number":205,"name":"Operational Readiness Studio","domain":"Operations","scope":"Readiness for launches moves and events"},
    {"number":206,"name":"MSP Acquisition Studio","domain":"Commerce","scope":"Acquired MSP integration and customer migration"},
    {"number":207,"name":"Multi-MSP Studio","domain":"Customer","scope":"Delegated cross-provider service operations"},
    {"number":208,"name":"Technology Procurement Intelligence Studio","domain":"Commerce","scope":"Supplier technical price and lifecycle comparisons"},
    {"number":209,"name":"Customer Value Studio","domain":"Customer","scope":"Evidence-backed customer outcomes"},
    {"number":210,"name":"Platform Health Studio","domain":"Platform","scope":"Nexus platform reliability and integration health"},
]
)


def _by_title(rows: Iterable[dict[str, Any]], *, title_key: str = "name") -> dict[str, dict[str, Any]]:
    return {_key(row.get(title_key, "")): row for row in rows}


def reconcile(
    registered_studios: Iterable[dict[str, Any]],
    proposals: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return one evidence-bearing accountability row for every master item.

    Matching is deliberately conservative: titles must resolve exactly after
    removing only the word Studio and punctuation. Requirements that do not
    resolve to an admitted Studio or proposal are still assigned to a reviewed
    portfolio parent by their declared domain. That parent is deliberately not
    presented as implementation evidence.
    """

    admitted = _by_title(registered_studios)
    planned = _by_title(proposals, title_key="title")
    admitted_by_id = {str(studio.get("id")): studio for studio in registered_studios}
    rows: list[dict[str, Any]] = []

    for requirement in MASTER_STUDIOS:
        key = _key(requirement["name"])
        studio = admitted.get(key)
        proposal = planned.get(key)
        row = {
            **requirement,
            "source": f"master-register #{requirement['number']}",
            "canonical_id": None,
            "canonical_kind": "unmapped",
            "implementation_status": "Unmapped requirement",
            "evidence": [],
            "blocker": (
                "No exact canonical Studio or proposal record has been admitted. "
                "Map this requirement to an existing product, an extension, or a "
                "new governed capability before implementation."
            ),
        }
        if studio:
            row.update(
                {
                    "canonical_id": studio["id"],
                    "canonical_kind": "registered_studio",
                    "implementation_status": studio.get("status", "Status not stated"),
                    "evidence": [
                        "backend/app/services/studio_registry.py",
                        "backend/app/routers/studio_fleet.py",
                    ],
                    "blocker": (
                        "Studio admission and its wired evidence determine release "
                        "readiness; a registry row alone is not production proof."
                    ),
                }
            )
        elif proposal:
            disposition = proposal.get("disposition", "studio")
            row.update(
                {
                    "canonical_id": proposal["id"],
                    "canonical_kind": f"proposal:{disposition}",
                    "implementation_status": (
                        "Planned Studio" if disposition == "studio" else proposal.get(
                            "disposition_label", disposition
                        )
                    ),
                    "evidence": list(proposal.get("sources", ())),
                    "blocker": (
                        " · ".join(proposal.get("gates", ()))
                        or proposal.get("already_exists_at")
                        or "Canonical capability decision required"
                    ),
                }
            )
        else:
            parent_id = PORTFOLIO_PARENT_BY_DOMAIN.get(requirement["domain"])
            parent = admitted_by_id.get(parent_id)
            if parent:
                row.update(
                    {
                        "canonical_id": parent_id,
                        "canonical_kind": "portfolio_parent",
                        "implementation_status": "Portfolio mapped; capability delivery pending",
                        "evidence": [
                            "backend/app/services/studio_master_register.py#PORTFOLIO_PARENT_BY_DOMAIN",
                            "backend/app/services/studio_registry.py",
                        ],
                        "blocker": (
                            f"Assigned to {parent.get('name', parent_id)} as its accountable "
                            "portfolio parent. This decision does not admit a new capability, "
                            "provider integration, or execution surface."
                        ),
                    }
                )
        rows.append(row)
    return rows


def summary(
    registered_studios: Iterable[dict[str, Any]],
    proposals: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """A compact, honest roll-up for the Marketplace and API."""

    rows = reconcile(registered_studios, proposals)
    kinds = Counter(row["canonical_kind"] for row in rows)
    statuses = Counter(row["implementation_status"] for row in rows)
    return {
        "version": MASTER_REGISTER_VERSION,
        "total": len(rows),
        "canonical_matches": len(rows) - kinds["unmapped"],
        "evidence_backed_matches": len(rows) - kinds["unmapped"] - kinds["portfolio_parent"],
        "portfolio_parent_decisions": kinds["portfolio_parent"],
        "unmapped_requirements": kinds["unmapped"],
        "by_canonical_kind": dict(sorted(kinds.items())),
        "by_implementation_status": dict(sorted(statuses.items())),
        "disclosure": (
            "The master register tracks requirements, not claimed delivery. "
            "A portfolio parent is accountable architecture, not proof that the "
            "requirement's provider integration, execution surface or release "
            "admission is complete."
        ),
    }


__all__ = [
    "MASTER_REGISTER_VERSION",
    "MASTER_STUDIOS",
    "PORTFOLIO_PARENT_BY_DOMAIN",
    "reconcile",
    "summary",
]
