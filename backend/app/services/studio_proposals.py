"""Nexus catalogue consolidation — one record per proposed capability.

Batches 2 to 6 proposed 142 operational ideas between them. Written batch by
batch, the same capability appears more than once under different names: batch 4's
*Browser* and batch 5's *Browser Management* describe one managed-browser policy
with one blocker; batch 4's *Service Catalogue*, *Licensing Compliance* and batch
5's *Quoting*, *Subscription* are four names for one missing commercial source of
truth; batch 3's *Recovery Confidence Map* and batch 5's *Storage Recovery* are
the same restore-evidence projection. Neither document cross-references the
other, so the duplication was invisible in prose and would have become parallel
owners in code.

This module is the single consolidation record. Every catalogue idea appears once,
with one disposition, and the vocabulary is small enough to be checked in code:

=========== =========================================================
disposition what it means
=========== =========================================================
``studio``  a future admitted studio: a real capability that does not exist
            yet. It is filed under a product and counted in that product's
            ``planned_studios``.
``section`` a specialist section inside a studio that is already registered,
            because that studio owns the domain. ``merges_into`` names it.
``merged``  the same capability as another proposal, under a second name.
            ``merges_into`` names the work item that owns it.
``extend``  an existing non-studio surface owns it; what remains is a named
            gap on that surface. ``already_exists_at`` cites the owning file.
``served``  already delivered. ``already_exists_at`` cites where it lives.
=========== =========================================================

Two disciplines the docs state and this module now enforces:

1. **A proposal a reader cannot find is a dropped proposal.** A proposal that is
   not ``served`` either names the gate blocking it or names the records it is a
   projection of (``buildable_from``). "Later" is not a disposition.
2. **A named gate is a plan; an unnamed one is not.** Every gate lives in
   ``GATES`` with its blocking reason and where it was recorded, a referenced
   gate must exist, and a gate that blocks nothing is refused.

The register is static code, like ``studio_registry``: no customer data, no
secrets, so it needs no tenant partition (docs/DATA_OWNERSHIP.md). Docs:
docs/NEXUS_STUDIO_MERGE_REVIEW.md is the human-readable record of these merges;
``studio_registry.product_catalogue()`` emits them so the hub shows what a
product is intended to hold and what was consolidated into existing capability.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

# backend/app/services/studio_proposals.py -> repository root.
REPO_ROOT = Path(__file__).resolve().parents[3]

PROPOSAL_DISPOSITIONS: tuple[str, ...] = ("studio", "section", "merged", "extend", "served")

DISPOSITION_LABELS: dict[str, str] = {
    "studio": "Proposed studio",
    "section": "Section of a studio",
    "merged": "Merged into a shared work item",
    "extend": "Extends an existing surface",
    "served": "Already served",
}

PROPOSAL_NOTE = (
    "Every catalogue idea from batches 2-6 is recorded once with one disposition: a "
    "gated studio (planned_studios), a section of a registered studio, a merge into a "
    "shared work item, a named gap on an existing surface, or already delivered. A "
    "proposal that is not already served either names the gate blocking it or names "
    "the records it is a projection of."
)

_ID_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


# ============== THE NAMED GATES ==============
#
# Each gate is a decision that must be made before the capability can be built.
# ``recorded_in`` is where the batch that found it wrote it down, so a gate can be
# traced back rather than remembered.


def _gate(gate_id: str, title: str, blocking_reason: str, recorded_in: str,
          *, cleared_by: str | None = None, cleared_note: str | None = None) -> dict:
    """One gate: what blocks the work, and — once it is opened — what opened it.

    A cleared gate is kept rather than deleted, because the record of *why* a
    capability waited is the part a later reader needs. `cleared_by` cites the
    artifact that closed it, so "the gate is open" is a checkable claim, and
    ``validate`` refuses a cleared gate that anything is still blocked by.
    """
    return {
        "id": gate_id,
        "title": title,
        "blocking_reason": blocking_reason,
        "recorded_in": recorded_in,
        "cleared_by": cleared_by,
        "cleared_note": cleared_note,
    }


GATES: dict[str, dict] = {
    gate["id"]: gate
    for gate in (
        _gate("agent-platform-parity", "macOS/Linux agent parity",
              "The Go agent is Windows-mature; a per-platform workspace would present "
              "coverage Nexus cannot collect.", "batch 4 #85, batch 5 #106-107"),
        _gate("fleet-baseline", "Fleet baseline projection",
              "A healthy baseline exists per endpoint; nothing compares a device against "
              "the fleet, so the projection must be built first.", "batch 5 #108, #111",
              cleared_by="backend/app/services/fleet_baseline.py",
              cleared_note=(
                  "Cleared 2026-10-12. The projection ships as GET "
                  "/api/fleet-baseline/contract plus the per-cohort deviations and "
                  "recurrence reads, over device records Nexus already stores, and "
                  "Windows Studio and Endpoint Performance Studio are admitted against "
                  "it in studio_registry."
              )),
        _gate("endpoint-enumeration-consent", "Endpoint enumeration and consent policy",
              "Extension inventory needs agent-side enumeration plus a retention and "
              "consent decision before any collection.", "batch 4 #85, batch 5 #109"),
        _gate("endpoint-capture-consent", "Bounded endpoint capture consent boundary",
              "Process, DNS, connection and token capture needs a policy that never "
              "records unrelated customer content, plus a retention rule.",
              "batch 3 Application Black Box"),
        _gate("endpoint-device-inventory", "Agent-side device inventory",
              "Driver and peripheral compatibility cannot be inferred; it needs inventory "
              "the agent does not collect yet.", "batch 5 #114"),
        # Surveyed 2026-10-12 and left open by decision, not by restatement. The
        # provenance half of this gate already exists, so it is not what blocks
        # the ten batch-2 concepts: ``app/services/core_relationships.py`` records
        # every edge's assertion evidence, the source record and, for approved
        # human context, who recorded it and under which decision, and the
        # governed event timeline is correlated rather than merely timestamped
        # (``nexus_objects.build_object_story`` already refuses to read timeline
        # proximity as causation). What does not exist is the dependency half —
        # edges between assets and services saying which endpoint depends on
        # which other, which only collection can author. That is a persistence
        # decision, so it stays open rather than being projected from records
        # Nexus already holds.
        _gate("dependency-graph-provenance", "Dependency graph with provenance",
              "A consequence may only be linked to the change that produced it when the "
              "graph carries change-time attribution, not timing alone. The provenance "
              "half is already stored (app/services/core_relationships.py): every edge "
              "carries its source record, its assertion evidence and, for approved "
              "context, who recorded it under which decision. What is missing is the "
              "dependency half — asset-to-service edges that only collection can "
              "author — which is a persistence decision this programme has not taken "
              "(see docs/NEXUS_STUDIO_MERGE_REVIEW.md).",
              "batch 2 gates, batch 4 #88/#101/#115, batch 3 Preflight"),
        _gate("certificate-inventory", "Certificate inventory and bindings",
              "Expiry is readable today; dependent services and renewal ownership need a "
              "certificate inventory joined to bindings.", "batch 3 Certificate Detective"),
        _gate("time-source-read", "Authoritative time-source read",
              "Clock drift can only be correlated with auth and certificate failures once "
              "each endpoint's time source is read.", "batch 4 #89"),
        _gate("effective-access-evaluation", "Verified effective-access evaluation",
              "Which rule denied which file operation must be evaluated by the provider; "
              "Nexus must not infer an explanation.", "batch 3 Permission Microscope"),
        _gate("graph-sharing-ingestion", "Microsoft Graph sharing ingestion",
              "Sharing and permission state must be ingested, never inferred from a link.",
              "batch 4 #84"),
        _gate("authorised-network-probes", "Authorised network observation points",
              "Comparing paths needs a probe at each point with its own access and rate "
              "policy.", "batch 3 DNS Propagation Lab, batch 5 #113"),
        _gate("switch-port-inventory", "Switch port and VLAN inventory",
              "There is no source of truth for switch-port state, so history cannot be "
              "attributed.", "batch 3 Nexus Port Historian"),
        _gate("restore-test-evidence", "Recorded restore tests per dependency chain",
              "Green backup jobs prove a job ran, not that a business process is "
              "recoverable.", "batch 2 #5, batch 3 Recovery Confidence Map, batch 5 #112"),
        _gate("authentication-journey", "Identity-provider sign-in ingestion",
              "Why an authentication attempt failed cannot be inferred; sign-in and "
              "Conditional Access ingestion comes first.", "batch 2, batch 3, batch 4 #82, batch 5 #110"),
        _gate("assurance-evidence-model", "Evidence model for Nexus's own claims",
              "Access reviews, attestations and residency are assurance claims about "
              "Nexus itself and need an evidence model and a review cadence owner.",
              "batch 4 #104"),
        _gate("durable-problem-object", "Durable problem record with an owner",
              "A cross-customer problem record must span tickets and changes and needs a "
              "declared owner before it exists.", "batch 4 #91"),
        _gate("autonomy-contract", "Evidenced, recoverable execution state",
              "Every service-activation stage needs recorded execution state and the "
              "autonomy contract (P0 #6).", "batch 4 #94"),
        _gate("provisioning-adapters", "Per-service provisioning adapters",
              "Activating a service for a customer needs an adapter per service type.",
              "batch 4 #94"),
        _gate("contract-terms-clock", "Clock reads contract terms and calendars",
              "One global SLA timer cannot calculate a deadline; the clock must read "
              "contract terms, calendars and exclusions.", "batch 4 #97, batch 5 #124"),
        _gate("vendor-case-ingestion", "External vendor case ingestion",
              "Vendor case status and case diffs need a per-vendor API or mailbox "
              "ingestion with its own sandbox acceptance.", "batch 3, batch 4 #96"),
        _gate("usage-time-series", "Usage time-series per customer",
              "Forecasting storage, compute, bandwidth and technician load needs usage "
              "history Nexus does not retain.", "batch 4 #98"),
        _gate("commercial-source-of-truth", "Owned commercial source of truth",
              "Entitlements, assignments and vendor usage rights by contract are one "
              "owned datum attached to contracts and billing, not a screen.",
              "batch 4 #90/#92, batch 5 #122/#127"),
        _gate("integration-ingestion", "Provider ingestion for build and pipeline data",
              "Repository, CI and pipeline records are a provider integration plus a "
              "docs/DATA_OWNERSHIP.md entry.", "batch 5 #116/#119/#120"),
        _gate("deployment-record-ownership", "Owned deployment record",
              "A deployment record is a new datum and needs an approved owner before "
              "code (docs/DATA_OWNERSHIP.md).", "batch 5 #116"),
        _gate("shared-capability-scope", "Shared capability, not a per-customer studio",
              "The evidence layer is consumed by every product; making it a per-customer "
              "studio would fragment it.", "batch 5 #118/#119"),
        _gate("stock-ownership", "Per-location stock persistence decision",
              "Per-location stock, serials, reservations and transfers are a new shared "
              "datum: one owner, labelled replicas only.", "batch 5 #126"),
        _gate("partner-tenancy", "Approved partner tenancy boundary",
              "Delegated partner access adds a fourth scope axis to a platform that "
              "treats cross-tenant access as a release blocker.", "batch 5 #129"),
        _gate("publisher-signing", "Signing and trust model for publishers",
              "Who signs, what a signature attests and how it is revoked is a security "
              "decision before a feature.", "batch 3 Repair Exchange, batch 5 #130"),
        _gate("marketplace-distribution", "Distribution authority",
              "Signing infrastructure, a review authority, isolated execution and a "
              "liability model must exist before anything is distributed.",
              "batch 3, batch 4 #105, batch 5 #130"),
        _gate("isolated-execution", "Isolated execution with destruction evidence",
              "Sandbox provisioning, isolation, expiry and destruction evidence do not "
              "exist; Forge's sandbox_plan check is the design-time half only.",
              "batch 3, batch 4 #103"),
        _gate("before-value-capture", "Captured before-values and dependency check",
              "Undo needs the previous value of an arbitrary setting with provenance, a "
              "check that nothing else changed since, and an explicit irreversible list.",
              "batch 3 Undo Everything"),
        _gate("external-privilege-visibility", "Visibility of privileges granted outside Nexus",
              "A post-work review can only revoke what Nexus can see; values granted "
              "elsewhere must be reported as unseen rather than assumed revoked.",
              "batch 3 Temporary Access Expiry"),
        _gate("runbook-contract", "Runbook contract change",
              "Executable, version-controlled procedures with branching, approval and "
              "rollback are a contract change, and an adaptive step must propose a "
              "correction for review rather than deviate silently.", "batch 3, batch 4 #102"),
        _gate("contact-policy", "Consent rule for contacting a person",
              "What Nexus may recall about a person, how it is redacted, how it is scoped "
              "and when someone may be contacted is a policy deliverable before a feature.",
              "batch 2 customer continuity, batch 3 Last Known Human"),
        _gate("knowledge-provenance", "Verified-procedure extraction",
              "Extracting procedures from historical work needs evidence links plus "
              "retention and redaction policy for departed-staff content.",
              "batch 2 The Missing Technician"),
        _gate("event-provenance", "Per-fact provenance on every mutation",
              "Reconstruction needs a time-ordered evidence stream with source, "
              "confidence and observation time per fact (P0 #4, P0 #8).",
              "batch 2 Nexus Reality Replay"),
        _gate("deployment-authority", "Deployment authority with rollback evidence",
              "Deploying a detection-and-response package to other environments is a "
              "blast-radius decision and 'safe response' must be provable.",
              "batch 2 Nexus Operational Antibodies"),
        _gate("fingerprint-recurrence", "Recurring-failure evidence per stable fault identity",
              "Recurrence must be keyed to a stable service or fault identity; Support "
              "Debt supplies the ticket half only.", "batch 2 false-fix cluster"),
        _gate("ordered-action-retention", "Ordered action-sequence retention decision",
              "Noticing that Certificate Detective follows DNS diagnostics needs ordered "
              "per-technician sequences, which nobody has yet agreed to retain.",
              "batch 3 Nexus Tool Evolution"),
        _gate("failure-context-capture", "Operation context captured at failure",
              "OS build, process identity, permission and surrounding evidence must be "
              "captured against the operation before it can be explained.",
              "batch 3 Error Translator"),
        _gate("mission-lifecycle", "Explicit mission lifecycle contract",
              "A durable work object spanning tickets, devices, approvals and time needs "
              "a declared owner for progress, evidence and interruption.",
              "batch 3 Nexus Mission Mode"),
        _gate("print-topology-source", "Print topology source",
              "Application to spooler to driver to queue to server to device is recorded "
              "nowhere today.", "batch 3 Nexus Print Path Visualiser"),
        _gate("workspace-definition-ownership", "Owned workspace definition",
              "A shared workspace needs server-side definitions, a permission contract "
              "per composable component and a tenancy model for sharing it.",
              "batch 3 Nexus Zero-Friction Workspace"),
        _gate("firewall-provider-contract", "Firewall provider contract",
              "Policy, NAT and VPN objects, config backup and traffic diagnostics each "
              "need a provider contract with its own sandbox acceptance.", "batch 4 #81"),
        _gate("technician-memory-retention", "Technician memory retention decision",
              "Per-technician operational memory needs a retention decision before it is "
              "assembled, and it must never surface during a critical incident.",
              "batch 2 assembled-context cluster"),
        # --- Batch 6 gates: communications, protection and physical infrastructure.
        #
        # The 30 studios of batch 6 (156-185) are wide rather than deep: ten are
        # communications, ten are data protection and governance, ten are physical
        # infrastructure. Almost every one of them is blocked by the same shape of
        # decision — a provider contract Nexus does not read yet, or a collection and
        # retention boundary nobody has agreed to — so the gates below are named once
        # and referenced by every studio they actually block.
        _gate("carrier-call-path-evidence", "Carrier-to-agent call-path evidence",
              "Diagnosing a customer call from carrier to agent needs per-leg evidence "
              "from the carrier, the PBX and the endpoint, each with its own access, "
              "rate and retention decision.",
              "batch 6 #156, #159, #160, #162"),
        _gate("messaging-carrier-contract", "Messaging provider delivery and charge contract",
              "Sender identities, delivery reports, transmission failures and carrier "
              "charge reconciliation come from per-provider APIs plus a charge record "
              "Nexus does not collect.", "batch 6 #157, #158, #164"),
        _gate("meeting-quality-evidence", "Meeting endpoint and call-quality ingestion",
              "Whether poor meeting quality came from the endpoint, the network or the "
              "service needs call-quality records from the conferencing platform, which "
              "are permission-scoped and retained for a bounded window.",
              "batch 6 #159, #161"),
        _gate("carrier-number-ownership", "Carrier number ownership and billing record",
              "DID allocation, porting state, assignment and carrier billing need a "
              "number-ownership record joined to the number; without it a number is "
              "orphaned or billed twice with nothing able to say which.",
              "batch 6 #163"),
        _gate("data-classification-model", "Data classification and retention model",
              "Governance, loss prevention, eDiscovery, privacy requests and messaging "
              "retention all need one declared classification-and-retention model with "
              "a named owner before any policy engine exists.",
              "batch 6 #164, #166, #167, #168, #169"),
        _gate("key-management-integration", "Key-management provider integration",
              "Encryption status and recovery-key governance must read the customer's "
              "key-management provider; Nexus must not become the key authority.",
              "batch 6 #170"),
        _gate("secret-provider-integration", "Secret-manager provider integration",
              "Secrets must be read, leased and rotated through established secret "
              "managers with their own audit trail, so the provider contract and the "
              "rotation-ownership decision come first and a home-grown vault is the "
              "last resort rather than the starting point.", "batch 6 #171"),
        _gate("sbom-ingestion", "Software bill-of-materials ingestion",
              "Package provenance, dependency vulnerabilities and release integrity need "
              "SBOM and attestation data collected where a build is produced.",
              "batch 6 #173"),
        _gate("power-placement-and-runtime-model", "Rack placement, power and runtime model",
              "Rack units, power allocation, UPS battery health, runtime estimates and "
              "shutdown coordination need a declared placement-and-power model joined to "
              "the asset record.", "batch 6 #176, #180"),
        _gate("passive-infrastructure-inventory", "Passive infrastructure inventory",
              "Patch panels, ports, copper and fibre runs, optical levels and test "
              "results have no source of truth, so a run cannot be traced and a fault "
              "cannot be attributed to one.", "batch 6 #177, #178"),
        _gate("facility-sensor-feed", "Equipment-room sensor feed",
              "Temperature, humidity and water-leak readings need the sensor-gateway "
              "feed plus a retention and alarm-threshold decision.", "batch 6 #179"),
        _gate("kiosk-public-device-inventory", "Managed public-access device inventory",
              "The public kiosk surface exists; managing a fleet of terminals needs the "
              "device inventory, connectivity and remote-maintenance consent decision.",
              "batch 6 #181"),
        _gate("laboratory-equipment-monitoring-consent", "Laboratory-equipment monitoring boundary",
              "Monitoring network-connected laboratory equipment is read-only and needs "
              "the equipment owner's authorisation plus a boundary that never touches "
              "the instrument's own control system.", "batch 6 #182"),
        _gate("media-pipeline-inventory", "Media pipeline inventory",
              "Encoders, media servers and distribution paths need a declared inventory "
              "before broadcast health can be attributed to any of them.", "batch 6 #183"),
        _gate("satellite-provider-contract", "Satellite terminal and provider read contract",
              "Signal quality, service usage and connectivity come from the terminal and "
              "its provider API, each with its own contract.", "batch 6 #184"),
        _gate("edge-node-inventory", "Edge node and local-application inventory",
              "Edge nodes, remote gateways, local applications and synchronisation state "
              "are not collected by the agent yet, so resilient offline operation cannot "
              "be observed.", "batch 6 #185"),
    )
}


# ============== THE REGISTER ==============


def _proposal(
    proposal_id: str,
    title: str,
    product: str,
    disposition: str,
    sources: tuple[str, ...],
    *,
    gates: tuple[str, ...] = (),
    buildable_from: tuple[str, ...] = (),
    merges_into: str | None = None,
    already_exists_at: str | None = None,
    covers: tuple[str, ...] = (),
    note: str | None = None,
) -> dict:
    return {
        "id": proposal_id,
        "title": title,
        "product": product,
        "disposition": disposition,
        "sources": list(sources),
        "gates": list(gates),
        "buildable_from": list(buildable_from),
        "merges_into": merges_into,
        "already_exists_at": already_exists_at,
        "covers": list(covers),
        "note": note,
    }


# Declaration order is the catalogue order the API and the hub emit. Each entry
# records one catalogue idea, and ``covers`` names the other ideas it absorbs, so
# nothing proposed in batches 2-5 can be dropped by the consolidation itself.

PROPOSALS: dict[str, dict] = {
    proposal["id"]: proposal
    for proposal in (
        # --- Batch 4, studios 81-90: specialist administration ---
        _proposal(
            "firewall", "Firewall Studio", "nexus-infrastructure", "section",
            ("batch 4 #81",),
            merges_into="network",
            gates=("firewall-provider-contract",),
            note="Batch 4 asked for Firewall inside Network Studio, and Network Studio "
                 "already owns the domain: this is a section, not a second product.",
        ),
        _proposal(
            "directory", "Directory Studio", "nexus-identity", "section",
            ("batch 4 #82",),
            merges_into="identity",
            gates=("authentication-journey",),
            note="AD forest, domain-controller, replication and GPO evidence is the "
                 "Authentication Journey gate unchanged, and Identity Studio owns it.",
        ),
        _proposal(
            "file-services", "File Services Studio", "nexus-infrastructure", "studio",
            ("batch 4 #83",),
            gates=("effective-access-evaluation",),
            note="The differentiator is verified effective-access evaluation — why can "
                 "this user not open this folder — which is a provider integration.",
        ),
        _proposal(
            "collaboration", "Collaboration Studio", "nexus-identity", "studio",
            ("batch 4 #84",),
            gates=("graph-sharing-ingestion",),
            note="SharePoint, OneDrive and Teams sharing state must be ingested from "
                 "Graph; a link is not evidence of sharing.",
        ),
        _proposal(
            "remote-workforce", "Remote Workforce Studio", "nexus-endpoint", "section",
            ("batch 4 #87",),
            merges_into="remote",
            gates=("dependency-graph-provenance",),
            note="VPN, VDI and remote-app diagnosis is endpoint-to-application evidence "
                 "on the remote studio, not a second remote product.",
        ),
        _proposal(
            "certificate-trust", "Certificate Trust Studio", "nexus-shield", "studio",
            ("batch 4 #88", "batch 3 Certificate Detective"),
            gates=("dependency-graph-provenance", "certificate-inventory"),
            covers=("certificate-detective",),
            note="Batch 4's Certificate Trust and batch 3's Certificate Detective are one "
                 "capability: expiry plus the dependent services a renewal can break.",
        ),
        _proposal(
            "time-sync", "Time and Synchronisation Studio", "nexus-endpoint", "studio",
            ("batch 4 #89",),
            gates=("time-source-read",),
            note="Correlating clock drift with authentication and certificate failures "
                 "needs the time-source read plus timestamped failures.",
        ),
        _proposal(
            "licensing-compliance", "Licensing Compliance Studio", "nexus-commerce", "extend",
            ("batch 4 #90",),
            already_exists_at="backend/app/routers/license_management.py",
            gates=("commercial-source-of-truth",),
            note="Licence records exist; entitlement, assignment and vendor usage-rights "
                 "data by contract is the missing commercial source of truth.",
        ),
        _proposal(
            "problem-management", "Problem Management Studio", "nexus-service", "studio",
            ("batch 4 #91",),
            gates=("durable-problem-object",),
            note="The per-customer half already shipped as the Customer Environment "
                 "correlation; the cross-customer problem record with root-cause "
                 "hypotheses and permanent-fix progress is what remains.",
        ),
        _proposal(
            "service-catalogue", "Service Catalogue Studio", "nexus-commerce", "studio",
            ("batch 4 #92",),
            gates=("commercial-source-of-truth",),
            note="The commercial and technical catalogue of what an MSP sells must attach "
                 "to contracts and billing, so it is an ownership decision plus a "
                 "docs/DATA_OWNERSHIP.md entry before a studio.",
        ),

        # --- Batch 4, the three shipped foundations ---
        _proposal(
            "customer-environment", "Customer Environment Studio", "nexus-service", "served",
            ("batch 4 #93",),
            already_exists_at="backend/app/routers/customer_environment.py",
            note="Foundation 1 of 3, shipped in batch 4. Registering it here keeps the "
                 "catalogue complete rather than counting delivered work as a proposal.",
        ),
        _proposal(
            "service-activation", "Service Activation and Cancellation Studio",
            "nexus-service", "studio",
            ("batch 4 #94", "batch 4 #95"),
            gates=("autonomy-contract", "provisioning-adapters"),
            covers=("service-cancellation",),
            note="Activation and cancellation are the two halves of one lifecycle: both "
                 "need an evidenced, reversible execution state and per-service adapters, "
                 "so they are one work item rather than two studios.",
        ),
        _proposal(
            "escalation", "Escalation Studio", "nexus-service", "extend",
            ("batch 4 #96", "batch 3 Vendor Escalation Tracker",
             "batch 2 Vendor Case Companion"),
            already_exists_at="backend/app/routers/escalation_matrix.py",
            gates=("vendor-case-ingestion",),
            covers=("vendor-escalation-tracker", "vendor-case-companion"),
            note="Three batches asked for the same thing: the escalation matrix exists, "
                 "and external vendor case ingestion plus an evidence package is the "
                 "provider integration that unlocks all three.",
        ),
        _proposal(
            "capacity-planning", "Capacity Planning Studio", "nexus-infrastructure",
            "studio",
            ("batch 4 #98",),
            gates=("usage-time-series",),
            note="The estate counts shipped with Customer Environment; forecasting "
                 "storage, compute, bandwidth and technician load needs usage history, "
                 "and connecting a forecast to procurement needs the commercial engine.",
        ),
        _proposal(
            "customer-communication", "Customer Communication Studio", "nexus-communications",
            "served",
            ("batch 4 #99",),
            already_exists_at="backend/app/routers/ticket_email_notifications.py",
            note="The communications studio and ticket.public_update.send already own "
                 "client-linked outbound records with delivery evidence; preferences and "
                 "templates belong there, not in a second comms product.",
        ),
        _proposal(
            "operations-assurance", "Operations Assurance Studio", "nexus-service", "served",
            ("batch 4 #100",),
            already_exists_at="backend/app/routers/operations_assurance.py",
            note="Foundation 2 of 3, shipped in batch 4. The departed-access commitment "
                 "remains gated and is not claimed as evaluated.",
        ),

        # --- Batch 4, platforms 101-105 ---
        _proposal(
            "decision", "Decision Studio", "nexus-automation", "studio",
            ("batch 4 #101",),
            gates=("dependency-graph-provenance",),
            note="Comparing migration, upgrade and vendor options needs a cost, risk and "
                 "dependency model with provenance plus the Executive Cockpit's what-if "
                 "primitive; the provenance half is the gate.",
        ),
        _proposal(
            "runbook", "Runbook Studio", "nexus-knowledge", "extend",
            ("batch 4 #102", "batch 3 Live Runbook"),
            already_exists_at="backend/app/routers/runbooks.py",
            gates=("runbook-contract",),
            covers=("live-runbook",),
            note="Runbooks and the workflow runtime exist; executable, version-controlled "
                 "procedures with approval, branching, verification and rollback are one "
                 "contract change, and an adaptive step proposes a correction for review.",
        ),
        _proposal(
            "lab", "Lab Studio", "nexus-automation", "studio",
            ("batch 4 #103", "batch 3 Phantom Lab, Instant Lab, Technician Sandbox, "
             "Safe Experiment"),
            gates=("isolated-execution",),
            covers=("instant-lab", "technician-sandbox", "safe-experiment"),
            note="Four batches proposed disposable environments under four names: "
                 "provisioning, isolation, expiry and destruction evidence is one "
                 "infrastructure decision, and the reversible-endpoint-execution half of "
                 "Safe Experiment rides on the same isolation.",
        ),
        _proposal(
            "trust", "Trust Studio", "nexus-shield", "studio",
            ("batch 4 #104",),
            gates=("assurance-evidence-model",),
            note="Access reviews, attestations, residency and subprocessor records are "
                 "assurance claims about Nexus itself, so they need an evidence model and "
                 "a review cadence owner before a screen.",
        ),
        _proposal(
            "extension", "Extension Studio", "nexus-platform", "served",
            ("batch 4 #105",),
            already_exists_at="backend/app/routers/extension_studio.py",
            note="Foundation 3 of 3, shipped in part: manifest review only. Signing, "
                 "isolated execution and marketplace distribution remain the named gates "
                 "recorded against marketplace-operations.",
        ),

        # --- Batch 5, studios 106-115: infrastructure and technology control ---
        _proposal(
            "apple", "Apple Studio", "nexus-endpoint", "studio",
            ("batch 5 #106",),
            gates=("agent-platform-parity",),
            note="A platform-scoped view inside Nexus Endpoint sharing one agent, asset "
                 "and policy stack, not a separate product; ABM and Jamf ingestion sit on "
                 "top of the parity gate.",
        ),
        _proposal(
            "linux", "Linux Studio", "nexus-endpoint", "studio",
            ("batch 5 #107",),
            gates=("agent-platform-parity",),
            note="Safely executing verified repairs is script_library plus agent command "
                 "approval, both of which exist; the honest blocker is evidence, not "
                 "authority.",
        ),
        _proposal(
            "windows", "Windows Studio", "nexus-endpoint", "served",
            ("batch 5 #108",),
            already_exists_at="backend/app/services/fleet_baseline.py",
            note="Its gate is cleared, not deferred: the fleet baseline projection ships "
                 "as /api/fleet-baseline and Windows Studio is admitted in studio_registry "
                 "reading it. It ships Partially implemented — the per-platform views it "
                 "would extend to macOS and Linux still wait on agent platform parity, "
                 "which remains an open gate.",
        ),
        _proposal(
            "browser-management", "Browser Management Studio", "nexus-endpoint", "studio",
            ("batch 5 #109", "batch 4 #85 Browser"),
            gates=("endpoint-enumeration-consent",),
            covers=("browser",),
            note="Batch 4's Browser and batch 5's Browser Management are one object "
                 "(managed-browser policy plus extension inventory) with one blocker; "
                 "configuration drift is already expressible as declared state.",
        ),
        _proposal(
            "authentication", "Authentication Studio", "nexus-identity", "studio",
            ("batch 5 #110", "batch 3 Login Journey Recorder", "batch 2 Authentication Journey"),
            gates=("authentication-journey",),
            covers=("login-journey-recorder", "authentication-journey"),
            note="Three batches named the same capability and the same blocker: Nexus "
                 "must not infer a denial reason it did not read.",
        ),
        _proposal(
            "endpoint-performance", "Endpoint Performance Studio", "nexus-endpoint", "served",
            ("batch 5 #111",),
            already_exists_at="backend/app/routers/fleet_baseline.py",
            note="Its gate is cleared, not deferred: the recurring-deviation projection "
                 "counts the shapes more than one endpoint shares from the same deviations "
                 "the per-device view returns, and the studio is admitted reading it. It "
                 "ships Partially implemented — raising a ticket from a shape is not wired, "
                 "and a shape is evidence rather than a fault.",
        ),
        _proposal(
            "storage-recovery", "Storage Recovery Studio", "nexus-recovery", "studio",
            ("batch 5 #112", "batch 3 Recovery Confidence Map"),
            gates=("restore-test-evidence",),
            covers=("recovery-confidence-map",),
            note="One projection over two names: mapping a storage fault or a business "
                 "process to recoverability needs a recorded restore test per dependency "
                 "chain, not a green backup job.",
        ),
        _proposal(
            "connectivity-diagnostics", "Connectivity Diagnostics Studio",
            "nexus-infrastructure", "studio",
            ("batch 5 #113", "batch 3 DNS Propagation Lab"),
            gates=("authorised-network-probes",),
            covers=("dns-propagation-lab",),
            note="Batch 3's DNS Propagation Lab is batch 5's Connectivity Diagnostics in "
                 "a different costume: both need an authorised probe at each observation "
                 "point with its own access and rate policy.",
        ),
        _proposal(
            "peripheral", "Peripheral Studio", "nexus-endpoint", "studio",
            ("batch 5 #114",),
            gates=("endpoint-device-inventory",),
            note="Peripheral policy compliance is declared state today; driver "
                 "compatibility correlation needs agent-side inventory first, and no "
                 "compatibility matrix may be fabricated.",
        ),
        _proposal(
            "update-compatibility", "Update Compatibility Studio", "nexus-endpoint", "studio",
            ("batch 5 #115", "batch 4 #86 Software Deployment",
             "batch 3 Update Compatibility Gate", "batch 2 Update Autopsy"),
            gates=("dependency-graph-provenance",),
            covers=("software-deployment", "update-compatibility-gate", "update-autopsy"),
            note="Four names, one object: package, ring and dependency preflight. The "
                 "apply half already ships (the agent's app-update path plus Patch "
                 "Studio); the missing half is the customer-specific dependency map.",
        ),

        # --- Batch 5, studios 116-120: build and application engineering ---
        _proposal(
            "devops", "DevOps Studio", "nexus-build", "studio",
            ("batch 5 #116",),
            gates=("integration-ingestion", "deployment-record-ownership"),
            note="GitHub/GitLab/Azure DevOps ingestion is the gate, and the deployment "
                 "record needs an owner. deployment_hub is Nexus deploying itself, so it "
                 "is not evidence for this studio.",
        ),
        _proposal(
            "application-runtime", "Application Runtime Studio", "nexus-build", "merged",
            ("batch 5 #117",),
            merges_into="devops",
            note="Deferred behind DevOps: correlating an application failure with a "
                 "deployment change needs the deployment record to correlate against. "
                 "Queues and scheduled jobs are already Nexus-owned and observable.",
        ),
        _proposal(
            "observability", "Observability Studio", "nexus-observability", "studio",
            ("batch 5 #118",),
            gates=("shared-capability-scope",),
            note="An evidence-backed explanation of a degradation is a projection over "
                 "records Nexus already stores plus the alert and event streams, so it "
                 "needs no new store. It must not become a fifth dashboard, and it must "
                 "not become a per-customer studio.",
        ),
        _proposal(
            "data-pipeline", "Data Pipeline Studio", "nexus-build", "merged",
            ("batch 5 #119",),
            merges_into="observability",
            note="Duplicate and incomplete-record detection already ships as the "
                 "data-quality read model; the ETL and pipeline-run half belongs in the "
                 "same evidence layer as observability, and additionally needs provider "
                 "ingestion rather than a separate workspace.",
        ),
        _proposal(
            "release", "Release Studio", "nexus-build", "extend",
            ("batch 5 #120",),
            already_exists_at="backend/app/routers/change_management.py",
            gates=("integration-ingestion",),
            note="A workspace over the existing change machinery: approvals, verification "
                 "kinds and rollback plans exist and the staged-deployment half arrives "
                 "with DevOps. A second release engine beside Change Management would be "
                 "the wrong answer.",
        ),

        # --- Batch 5, studios 121-130: operating and growing ---
        _proposal(
            "sales-engineering", "Sales Engineering Studio", "nexus-service", "section",
            ("batch 5 #121",),
            merges_into="customer-environment",
            buildable_from=("backend/app/routers/qbr_generator.py",
                            "backend/app/routers/client_360.py",
                            "backend/app/services/customer_environment.py"),
            note="Batch 5 says it itself: this is exactly the shape of the Customer "
                 "Environment foundation. It is the commercial framing of the same "
                 "projection, so it becomes a section and adds no second store. Batch 5 "
                 "filed it under Nexus Growth; as a section of Customer Environment it "
                 "lives in Nexus Service.",
        ),
        _proposal(
            "quoting", "Quoting Studio", "nexus-commerce", "extend",
            ("batch 5 #122",),
            already_exists_at="backend/app/routers/estimates.py",
            gates=("commercial-source-of-truth",),
            note="Do not build a second quoting engine: the brief asks it to share the "
                 "commercial engine with Finance and Procurement and it already does. "
                 "Complex bundles, margins and approval thresholds ride on the catalogue.",
        ),
        _proposal(
            "customer-roadmap", "Customer Roadmap Studio", "nexus-growth", "studio",
            ("batch 5 #123",),
            buildable_from=("backend/app/routers/hardware_refresh.py",
                            "backend/app/routers/asset_lifecycle.py",
                            "backend/app/routers/license_management.py",
                            "backend/app/routers/contracts.py"),
            note="A projection over lifecycle, warranty, licence and contract dates that "
                 "already exist, so it is buildable with no new store. One trap recorded: "
                 "services/product_roadmap.py is Nexus's OWN roadmap and must not be "
                 "repurposed as a customer roadmap.",
        ),
        _proposal(
            "sla", "SLA and Maintenance Clock Studio", "nexus-service", "section",
            ("batch 5 #124", "batch 4 #97 Maintenance", "batch 3 Smart Maintenance Window"),
            merges_into="service-desk",
            gates=("contract-terms-clock",),
            covers=("maintenance", "smart-maintenance-window"),
            note="Three batches, one missing thing: the clock must read contract terms, "
                 "calendars and exclusions, and window impact needs authoritative backup "
                 "schedules. That is policy work in stores that already exist.",
        ),
        _proposal(
            "dispatch", "Dispatch Studio", "nexus-service", "served",
            ("batch 5 #125",),
            already_exists_at="backend/app/routers/dispatch_board.py",
            note="Visit allocation, travel and technician availability exist. The three "
                 "practical fields a dispatcher still wants on the visit record — "
                 "required equipment, access instructions and appointment confirmation — "
                 "are a field addition on this surface, not a studio.",
        ),
        _proposal(
            "stockroom", "Stockroom Studio", "nexus-commerce", "studio",
            ("batch 5 #126",),
            gates=("stock-ownership",),
            note="Knowing whether a replacement device is already available needs "
                 "per-location stock with serials, reservations, transfers and reorder "
                 "points. That is a new shared datum, so an owner comes first.",
        ),
        _proposal(
            "subscription", "Subscription Studio", "nexus-commerce", "extend",
            ("batch 5 #127",),
            already_exists_at="backend/app/routers/service_subscriptions.py",
            gates=("commercial-source-of-truth",),
            note="Mostly shipped: the read model already refuses to pretend an unlinked "
                 "provider quantity is being billed. Reconciling technical service state "
                 "against billed quantities needs the catalogue and entitlements.",
        ),
        _proposal(
            "customer-profitability", "Customer Profitability Studio", "nexus-commerce",
            "section",
            ("batch 5 #128",),
            merges_into="finance",
            note="Section of an existing studio, as batch 5 concluded. Distinguishing "
                 "estimated costs from confirmed transactions is the honesty rule "
                 "finance_integrity already applies, so it is reused rather than "
                 "reinvented.",
        ),
        _proposal(
            "partner", "Partner Studio", "nexus-growth", "studio",
            ("batch 5 #129",),
            gates=("partner-tenancy",),
            note="Delegated access to shared customer records adds a fourth scope axis "
                 "(partner to client to site) to a platform whose constitution treats "
                 "cross-tenant access as a release blocker. The tenancy boundary is a "
                 "security review before any code, and this is the most security-"
                 "sensitive proposal in the batch.",
        ),
        _proposal(
            "marketplace-operations", "Marketplace Operations Studio", "nexus-platform",
            "studio",
            ("batch 5 #130",),
            gates=("publisher-signing", "marketplace-distribution"),
            note="Complements Extension Studio, which reviews packaging: this is "
                 "lifecycle — install, permissions, subscription billing, version "
                 "compatibility, updates, publisher verification and health — and it is "
                 "deferred behind the distribution gate.",
        ),

        # --- Batch 3, the deferred list ---
        _proposal(
            "undo-everything", "Undo Everything Studio", "nexus-automation", "studio",
            ("batch 3 Undo Everything",),
            gates=("before-value-capture",),
            note="The device state engine reports desired state and drift but retains no "
                 "previous value per change, so an undo button would promise more than it "
                 "can restore — which batch 3 itself rules out.",
        ),
        _proposal(
            "preflight", "Preflight Studio", "nexus-automation", "studio",
            ("batch 3 Preflight",),
            gates=("dependency-graph-provenance", "restore-test-evidence"),
            note="Depends on the same dependency graph with provenance as the "
                 "consequence-engine concepts and on authoritative restore verification; "
                 "disk space, DNS and replication health are per-provider reads that each "
                 "need their own integration acceptance.",
        ),
        _proposal(
            "last-known-human", "Last Known Human Studio", "nexus-service", "studio",
            ("batch 3 Nexus Last Known Human",),
            gates=("contact-policy",),
            buildable_from=("backend/app/routers/change_management.py",
                            "backend/app/routers/tickets.py"),
            note="Buildable from records Nexus already holds with no new store, so the "
                 "work is a scoped projection plus the consent rule for contacting a "
                 "person — the same decision Customer Memory Shield waits on.",
        ),
        _proposal(
            "technician-radar", "Technician Radar", "nexus-endpoint", "section",
            ("batch 3 Technician Radar",),
            merges_into="devices",
            note="Already covered in part by the shipped work locks, which stop two "
                 "technicians unknowingly working the same device. The genuinely missing "
                 "pieces are scheduled changes and maintenance windows in the same panel, "
                 "which is a section of the device workspace, not a second collision "
                 "system.",
        ),
        _proposal(
            "permission-microscope", "Permission Microscope Studio", "nexus-identity",
            "studio",
            ("batch 3 Permission Microscope",),
            gates=("effective-access-evaluation",),
            note="The distinction between verified evaluation and inferred explanation is "
                 "the whole design constraint, so this stays a provider integration: "
                 "neither the tenant-readiness read nor the JIT access governor answers "
                 "which rule denied this file operation.",
        ),
        _proposal(
            "application-black-box", "Application Black Box Studio", "nexus-endpoint",
            "studio",
            ("batch 3 Application Black Box",),
            gates=("endpoint-capture-consent",),
            note="Bounded endpoint capture from the agent plus the privacy boundary that "
                 "never records unrelated customer content. The retention and consent "
                 "policy is a deliverable before the feature.",
        ),
        _proposal(
            "error-translator", "Error Translator", "nexus-service", "studio",
            ("batch 3 Error Translator",),
            gates=("failure-context-capture",),
            note="Feasible from existing records once the operation context is captured, "
                 "and it must not become a generic 'this error might mean' lookup: a "
                 "generic explanation is worth little.",
        ),
        _proposal(
            "handover-simulator", "Handover Simulator", "nexus-service", "extend",
            ("batch 3 Handover Simulator",),
            already_exists_at="backend/app/routers/tickets.py",
            note="Partly shipped: the scoped handover projection exists and the ticket "
                 "outcome contract already refuses a close-out it cannot verify. The "
                 "missing-items gate — no reproduction steps, expectation unrecorded, next "
                 "action unclear — belongs in the handover panel on this surface.",
        ),
        _proposal(
            "mission-mode", "Nexus Mission Mode", "nexus-service", "studio",
            ("batch 3 Nexus Mission Mode",),
            gates=("mission-lifecycle",),
            note="The largest claim in the batch and the one most likely to become a "
                 "fourth parallel orchestrator. Every piece it would aggregate exists, so "
                 "the gate is an explicit mission lifecycle contract and an ownership "
                 "decision, not more endpoints.",
        ),
        _proposal(
            "port-historian", "Nexus Port Historian", "nexus-infrastructure", "studio",
            ("batch 3 Nexus Port Historian",),
            gates=("switch-port-inventory",),
            note="Switch, port and VLAN state over time with change attribution needs an "
                 "authoritative source; there is none today.",
        ),
        _proposal(
            "print-path-visualiser", "Nexus Print Path Visualiser", "nexus-endpoint",
            "studio",
            ("batch 3 Nexus Print Path Visualiser",),
            gates=("print-topology-source",),
            note="Application to spooler to driver to queue to server to device is "
                 "recorded nowhere; endpoint discovery telemetry is the prerequisite.",
        ),
        _proposal(
            "hardware-swap-assistant", "Nexus Hardware Swap Assistant", "nexus-commerce",
            "extend",
            ("batch 3 Nexus Hardware Swap Assistant",),
            already_exists_at="backend/app/routers/assets.py",
            buildable_from=("backend/app/routers/asset_lifecycle.py",
                            "backend/app/services/nexus_device_state.py"),
            note="Buildable from existing asset, configuration and relationship records, "
                 "so the guide can ship before the automation. It must not promise "
                 "transfer of what it cannot read: the configuration transfer is the "
                 "endpoint-execution half and is not claimed here.",
        ),
        _proposal(
            "temporary-access-expiry", "Nexus Temporary Access Expiry", "nexus-identity",
            "extend",
            ("batch 3 Nexus Temporary Access Expiry",),
            already_exists_at="backend/app/routers/permission_elevation.py",
            gates=("external-privilege-visibility",),
            note="Mostly shipped: approvals are already time-boxed with auto-expiry, "
                 "break-glass and session evidence. The missing piece is a post-work "
                 "review that revokes temporary privileges granted outside Nexus and "
                 "reports the ones it cannot see.",
        ),
        _proposal(
            "change-witness", "Nexus Change Witness", "nexus-service", "extend",
            ("batch 3 Nexus Change Witness",),
            already_exists_at="backend/app/routers/change_management.py",
            buildable_from=("backend/app/routers/nexus_proving_ground.py",),
            note="An extension of Change Management plus the outcome contract: the "
                 "verification kinds exist, and the Proving Ground already benches a "
                 "candidate before rollout.",
        ),
        _proposal(
            "forge", "Nexus Forge", "nexus-platform", "served",
            ("batch 3 Nexus Forge",),
            already_exists_at="backend/app/services/nexus_forge.py",
            note="Shipped in batch 3 as design requests, not code generation: "
                 "route-grounded capability discovery, twelve disclosed checks, a person "
                 "decides and versions are governance rather than deployment.",
        ),
        _proposal(
            "tool-evolution", "Nexus Tool Evolution", "nexus-platform", "studio",
            ("batch 3 Nexus Tool Evolution",),
            gates=("ordered-action-retention",),
            note="The evidence it would consume already exists, so the feature is one "
                 "decision away: whether to retain ordered per-technician action "
                 "sequences with a retention and privacy rule.",
        ),
        _proposal(
            "repair-exchange", "Nexus Repair Exchange", "nexus-platform", "studio",
            ("batch 3 Nexus Repair Exchange",),
            gates=("publisher-signing", "marketplace-distribution"),
            note="Distributing signed tools between MSPs is a trust, signing and "
                 "liability model before it is code: who reviews an MSP-authored tool, "
                 "what a signature attests, how customer data is provably excluded, and "
                 "who is accountable when a shared procedure damages a customer.",
        ),
        _proposal(
            "zero-friction-workspace", "Nexus Zero-Friction Workspace", "nexus-platform",
            "studio",
            ("batch 3 Nexus Zero-Friction Workspace",),
            gates=("workspace-definition-ownership",),
            note="Workspace composition already exists per browser, so a shared workspace "
                 "needs server-side definitions, a capability and permission contract for "
                 "every composable component, and a tenancy model for sharing it. It is "
                 "the honest prerequisite for anything Forge might later generate.",
        ),

        # --- Batch 2, the shipped pair ---
        _proposal(
            "dead-end-detector", "Nexus Dead End Detector", "nexus-service", "served",
            ("batch 2 Nexus Dead End Detector",),
            already_exists_at="backend/app/services/nexus_flow.py",
            note="Shipped in batch 2 inside the ticket workspace's Outcome & flow tab, "
                 "built from breadcrumbs the technician already records.",
        ),
        _proposal(
            "support-debt", "Nexus Support Debt", "nexus-service", "served",
            ("batch 2 Nexus Support Debt",),
            already_exists_at="backend/app/services/support_debt.py",
            note="Shipped in batch 2 as a recurring-work card in the Cost-Per-Ticket "
                 "workspace, and it never invents a labour rate.",
        ),

        # --- Batch 2, the three strongest unbuilt candidates ---
        _proposal(
            "reality-replay", "Nexus Reality Replay", "nexus-observability", "studio",
            ("batch 2 Nexus Reality Replay",),
            gates=("event-provenance",),
            note="Reconstructing what the technician could reasonably have known needs a "
                 "time-ordered evidence stream with source, confidence and observation "
                 "time per fact; the timeline and event backbone exist without it.",
        ),
        _proposal(
            "missing-technician", "Nexus The Missing Technician", "nexus-knowledge", "studio",
            ("batch 2 Nexus The Missing Technician",),
            gates=("knowledge-provenance",),
            note="A knowledge-provenance programme, not a screen: verified-procedure "
                 "extraction with evidence links, plus retention and redaction policy for "
                 "departed-staff-authored content.",
        ),
        _proposal(
            "operational-antibodies", "Nexus Operational Antibodies", "nexus-automation",
            "studio",
            ("batch 2 Nexus Operational Antibodies",),
            gates=("deployment-authority",),
            note="Shipping the registry before the deployment authority exists would "
                 "create either a registry nobody can action or an unreviewed fleet-wide "
                 "change.",
        ),

        # --- Batch 2, the concept clusters ---
        _proposal(
            "dependency-map", "Dependency Map", "nexus-infrastructure", "studio",
            ("batch 2 Fix Fallout cluster", "batch 2 Reboot Negotiator cluster"),
            gates=("dependency-graph-provenance",),
            covers=("fix-fallout", "repair-side-effect-map", "ticket-collision-detector",
                    "work-collision-forecast", "reboot-negotiator",
                    "service-dependency-doctor", "invisible-dependency-hunter",
                    "network-path-memory", "driver-compatibility-radar",
                    "software-conflict-investigator"),
            note="Ten concepts across two of batch 2's rows resolve to one missing "
                 "substrate: a dependency graph that carries provenance and change-time "
                 "attribution. Until it exists each of them would infer a consequence "
                 "from timing alone, which batch 2 itself rules out.",
        ),
        _proposal(
            "customer-continuity", "Customer Continuity", "nexus-service", "studio",
            ("batch 2 customer continuity cluster",),
            gates=("contact-policy",),
            covers=("customer-memory-shield", "customer-frustration-prevention",
                    "the-customer-who-never-calls", "zero-question-support"),
            note="One consent-aware continuity decision, four names for it: what Nexus "
                 "may recall about a person, how it is redacted, how it is scoped, and "
                 "that Nexus never invents a fact when identity or device mapping is "
                 "uncertain.",
        ),
        _proposal(
            "technician-memory", "Technician Memory", "nexus-knowledge", "studio",
            ("batch 2 assembled-context cluster",),
            gates=("technician-memory-retention",),
            covers=("technician-second-brain", "the-technician-who-never-has-to-ask-twice",
                    "escalation-quality-gate", "support-passport", "escalation-packet"),
            note="These depend on the assembled-context primitives that partly exist; "
                 "the per-technician operational memory needs a retention decision first, "
                 "and batch 1's personality candidates stay last for the same reason they "
                 "always did: cheap, but they must never appear during a critical "
                 "incident.",
        ),
        _proposal(
            "recurring-failure-evidence", "Recurring Failure Evidence", "nexus-service",
            "studio",
            ("batch 2 false-fix cluster",),
            gates=("fingerprint-recurrence",),
            covers=("false-fix-detector", "fix-expiry", "diagnostic-replay",
                    "known-good-library", "maintenance-debt"),
            note="All five need recurrence keyed to a stable service or fault identity. "
                 "Support Debt supplies the ticket half; the per-service "
                 "restart-and-recurrence half has no authoritative source yet.",
        ),
        _proposal(
            "customer-promise-guardian", "Customer Promise Guardian", "nexus-service",
            "section",
            ("batch 2 Customer Promise Guardian",),
            merges_into="service-desk",
            buildable_from=("backend/app/routers/sla_timer.py",
                            "backend/app/routers/service_tiers.py"),
            note="Batch 2's own conclusion: it overlaps the existing SLA, timer and "
                 "notification surfaces, so the honest next step is a review of those "
                 "workspaces on Service Desk rather than a new tool.",
        ),

        # --- Batch 6, studios 156-165: communications and collaboration ---
        #
        # The batch files these under Nexus Communications, with Telecom Studio
        # remaining the technical administration hub, and the dispositions keep that
        # true: the ten become eight plans, one section of the voice studio that
        # already owns the domain, and one named gap on the voice service desk that
        # already answers calls with a ticket.
        _proposal(
            "contact-centre", "Contact Centre Studio", "nexus-communications", "studio",
            ("batch 6 #156",),
            gates=("carrier-call-path-evidence",),
            note="Queues, agents, IVR, recordings and wallboards are a product family of "
                 "their own, and the differentiator the batch names — diagnosing a "
                 "customer call from carrier to agent — is the gate, not the wallboard.",
        ),
        _proposal(
            "business-sms", "Business SMS Studio", "nexus-communications", "studio",
            ("batch 6 #157",),
            gates=("messaging-carrier-contract",),
            note="Business messaging is a different provider family from voice: sender "
                 "identities, templates, delivery reports and carrier charges each need "
                 "the provider contract before a failed message can be traced.",
        ),
        _proposal(
            "cloud-fax", "Cloud Fax Studio", "nexus-communications", "studio",
            ("batch 6 #158",),
            gates=("messaging-carrier-contract",),
            note="Legacy fax is still a live service in most client estates, and it shares "
                 "the messaging provider contract with SMS rather than deserving a second "
                 "collection decision.",
        ),
        _proposal(
            "unified-communications", "Unified Communications Studio",
            "nexus-communications", "studio", ("batch 6 #159",),
            gates=("carrier-call-path-evidence", "meeting-quality-evidence"),
            note="Correlating a communication failure across devices, networks and "
                 "providers needs both halves of the evidence — the call path and the "
                 "meeting quality — so it is gated on both rather than on either.",
        ),
        _proposal(
            "sip", "SIP Studio", "nexus-communications", "studio", ("batch 6 #160",),
            gates=("carrier-call-path-evidence",),
            note="Registrations, trunks, codec negotiation and session border controllers "
                 "are the signalling half of the call-path gate; the batch's own "
                 "standout capability is a visualised signalling sequence.",
        ),
        _proposal(
            "video-conferencing", "Video Conferencing Studio", "nexus-communications",
            "studio", ("batch 6 #161",),
            gates=("meeting-quality-evidence",),
            note="Meeting platforms and room endpoints sit with communications, not with "
                 "the endpoint estate: the question the batch asks — endpoint, network or "
                 "service — is answered from platform call-quality records.",
        ),
        _proposal(
            "voice-quality", "Voice Quality Studio", "nexus-communications", "section",
            ("batch 6 #162",),
            merges_into="voice",
            gates=("carrier-call-path-evidence",),
            note="Jitter, latency, packet loss and MOS estimates are a view over the call "
                 "path Voice Studio already owns, so this is a section of that studio "
                 "rather than a second voice product.",
        ),
        _proposal(
            "number-management", "Number Management Studio", "nexus-communications",
            "studio", ("batch 6 #163",),
            gates=("carrier-number-ownership",),
            note="A number register is only useful if it knows who is billed for the "
                 "number, which is the ownership record the batch's standout capability "
                 "— no orphaned or incorrectly billed numbers — depends on.",
        ),
        _proposal(
            "messaging-compliance", "Messaging Compliance Studio", "nexus-communications",
            "studio", ("batch 6 #164",),
            gates=("messaging-carrier-contract", "data-classification-model"),
            note="Retention, approved channels and audit evidence over business messaging "
                 "needs both the messaging inventory and the classification and retention "
                 "model, because measuring a communication against policy requires a "
                 "policy that exists.",
        ),
        _proposal(
            "reception", "Reception Studio", "nexus-communications", "extend",
            ("batch 6 #165",),
            already_exists_at="backend/app/routers/voice_service_desk.py",
            buildable_from=("backend/app/routers/tickets.py",),
            note="Call answering already produces a service-desk record, so what remains "
                 "is a named gap on that surface — answering workflows and business-hours "
                 "configuration across a customer's offices — not a parallel reception "
                 "product.",
        ),

        # --- Batch 6, studios 166-175: data, protection and governance ---
        #
        # Five of these are one missing model, not five products: classification and
        # retention decide all of them. Secrets is deliberately filed under Nexus
        # Platform as a shared capability, and it integrates established secret
        # managers rather than becoming a vault.
        _proposal(
            "data-governance", "Data Governance Studio", "nexus-shield", "studio",
            ("batch 6 #166",),
            gates=("data-classification-model",),
            note="Classification, ownership, sharing and lifecycle are the model itself, "
                 "so this is the studio the model is declared in rather than a projection "
                 "of one.",
        ),
        _proposal(
            "data-loss-prevention", "Data Loss Prevention Studio", "nexus-shield", "studio",
            ("batch 6 #167",),
            gates=("data-classification-model",),
            note="A DLP policy is only meaningful against a classification: the batch's "
                 "incidents and approved remediation cannot be ranked before something "
                 "says which data matters.",
        ),
        _proposal(
            "ediscovery", "eDiscovery Studio", "nexus-shield", "studio",
            ("batch 6 #168",),
            gates=("data-classification-model",),
            note="Authorised searches, legal holds and chain of custody need the same "
                 "classification and retention model, plus the authorisation boundary the "
                 "gate names.",
        ),
        _proposal(
            "privacy-operations", "Privacy Operations Studio", "nexus-shield", "studio",
            ("batch 6 #169",),
            gates=("data-classification-model",),
            note="Access requests, deletion workflows and consent records are where the "
                 "classification model meets an obligation; without it a deletion request "
                 "has nothing to search.",
        ),
        _proposal(
            "encryption", "Encryption Studio", "nexus-shield", "studio",
            ("batch 6 #170",),
            gates=("key-management-integration",),
            note="Encryption status and recovery-key governance are read from the "
                 "customer's key-management provider. Nexus is never the key authority, "
                 "which is a provider contract before it is a screen.",
        ),
        _proposal(
            "secrets", "Secrets Studio", "nexus-platform", "studio",
            ("batch 6 #171",),
            gates=("secret-provider-integration",),
            note="Filed under Nexus Platform because every other product consumes it, and "
                 "gated on integrating established secret managers: a home-grown "
                 "cryptographic vault needs a compelling reason Nexus does not have.",
        ),
        _proposal(
            "threat-exposure", "Threat Exposure Studio", "nexus-shield", "extend",
            ("batch 6 #172",),
            already_exists_at="backend/app/routers/nexus_exposure.py",
            gates=("authorised-network-probes",),
            note="An exposure surface already exists; what the batch adds is "
                 "internet-facing discovery and remediation tracking, which needs "
                 "authorised observation points rather than a second exposure workspace.",
        ),
        _proposal(
            "software-supply-chain", "Software Supply Chain Studio", "nexus-build",
            "studio", ("batch 6 #173",),
            gates=("sbom-ingestion",),
            note="Provenance and dependency vulnerability are read where software is "
                 "built, so this belongs to Nexus Build beside DevOps Studio and is "
                 "gated on SBOM collection.",
        ),
        _proposal(
            "identity-threat", "Identity Threat Studio", "nexus-identity", "extend",
            ("batch 6 #174",),
            already_exists_at="backend/app/routers/identity_threats.py",
            gates=("authentication-journey",),
            note="Identity threat investigation is a named gap on the existing identity "
                 "threats surface: risky sign-ins and privileged anomalies need the "
                 "identity-provider sign-in ingestion to be complete first.",
        ),
        _proposal(
            "data-recovery", "Data Recovery Studio", "nexus-recovery", "section",
            ("batch 6 #175",),
            merges_into="backup",
            gates=("restore-test-evidence",),
            note="File-level recovery, deleted-data investigation and recovery "
                 "verification are Backup Studio's own restore surface, so this is a "
                 "section of it; the planned storage-recovery proposal covers "
                 "storage-level fault recovery, which is a different evidence set.",
        ),

        # --- Batch 6, studios 176-185: physical infrastructure and specialists ---
        #
        # These extend Nexus beyond conventional MSP software into communications and
        # facilities infrastructure. Each one needs an inventory Nexus does not collect "
        # yet, which is why the batch's hardware provider families stay plans rather "
        # than being folded into Monitoring Studio for looking like telemetry.
        _proposal(
            "rack", "Rack Studio", "nexus-infrastructure", "studio", ("batch 6 #176",),
            gates=("power-placement-and-runtime-model",),
            note="Interactive rack layouts, unit allocation and patching are the placement "
                 "half of the power model; without it a rack diagram is a drawing rather "
                 "than a record.",
        ),
        _proposal(
            "cabling", "Cabling Studio", "nexus-infrastructure", "studio",
            ("batch 6 #177",),
            gates=("passive-infrastructure-inventory",),
            note="Structured cabling, patch panels, ports and test results share one "
                 "missing source of truth with fibre, so both are blocked by the same "
                 "inventory decision rather than by two.",
        ),
        _proposal(
            "fibre", "Fibre Studio", "nexus-infrastructure", "studio", ("batch 6 #178",),
            gates=("passive-infrastructure-inventory",),
            note="Optical levels, transceivers and link diagnostics only mean something "
                 "against recorded runs and endpoints; for an MSP that also runs ISP "
                 "services this is the specialist capability the batch asked for.",
        ),
        _proposal(
            "environmental", "Environmental Studio", "nexus-observability", "studio",
            ("batch 6 #179",),
            gates=("facility-sensor-feed",),
            note="Filed under Nexus Observability because it is telemetry and alarms, but "
                 "kept as a plan rather than a section of Monitoring Studio: equipment-room "
                 "sensors are a facility-collection decision Monitoring Studio does not own.",
        ),
        _proposal(
            "ups", "UPS Studio", "nexus-infrastructure", "studio", ("batch 6 #180",),
            gates=("power-placement-and-runtime-model",),
            note="Battery health, runtime estimates and shutdown coordination are the "
                 "runtime half of the power model, and they are read from the UPS rather "
                 "than inferred from a device record.",
        ),
        _proposal(
            "kiosk", "Kiosk Studio", "nexus-endpoint", "extend", ("batch 6 #181",),
            already_exists_at="backend/app/routers/kiosk.py",
            gates=("kiosk-public-device-inventory",),
            note="A tokenised public kiosk surface already ships; managing self-service "
                 "terminals as a fleet — software, connectivity and remote maintenance — "
                 "is the named gap on it.",
        ),
        _proposal(
            "laboratory-equipment", "Laboratory Equipment Studio", "nexus-observability",
            "studio", ("batch 6 #182",),
            gates=("laboratory-equipment-monitoring-consent",),
            note="Deliberately narrow: authorised, read-only monitoring of "
                 "network-connected laboratory equipment and the IT systems supporting it, "
                 "bounded so it never reaches into an instrument's own control system.",
        ),
        _proposal(
            "broadcast", "Broadcast Studio", "nexus-infrastructure", "studio",
            ("batch 6 #183",),
            gates=("media-pipeline-inventory",),
            note="Streaming infrastructure, encoders and distribution sit on the network "
                 "Nexus already observes, but attributing broadcast health needs the "
                 "pipeline inventory first.",
        ),
        _proposal(
            "satellite", "Satellite Studio", "nexus-infrastructure", "studio",
            ("batch 6 #184",),
            gates=("satellite-provider-contract",),
            note="Terminals, signal quality and provider usage are a connectivity provider "
                 "family of their own; the batch calls this out for ISP operations "
                 "alongside fibre and cabling.",
        ),
        _proposal(
            "edge", "Edge Studio", "nexus-endpoint", "studio", ("batch 6 #185",),
            gates=("edge-node-inventory",),
            note="Edge nodes and remote gateways are managed endpoints with resident "
                 "applications and offline behaviour, so the studio belongs to the "
                 "endpoint estate but is blocked on inventory the agent does not collect.",
        ),
    )
}


# ============== PUBLIC API ==============


def public_proposal(proposal: dict) -> dict:
    """The API shape: the disposition, its label, and the gate that blocks it."""
    return {
        "id": proposal["id"],
        "title": proposal["title"],
        "product": proposal["product"],
        "disposition": proposal["disposition"],
        "disposition_label": DISPOSITION_LABELS[proposal["disposition"]],
        "sources": list(proposal["sources"]),
        "gates": [
            {"id": gate_id, "title": GATES[gate_id]["title"]}
            for gate_id in proposal["gates"]
        ],
        "merges_into": proposal["merges_into"],
        "already_exists_at": proposal["already_exists_at"],
        "covers": list(proposal["covers"]),
        "note": proposal["note"],
    }


def proposals_for_product(product_id: str) -> list[dict]:
    """Every proposal filed under one product, in catalogue order."""
    return [
        public_proposal(proposal)
        for proposal in PROPOSALS.values()
        if proposal["product"] == product_id
    ]


def planned_studios_by_product() -> dict[str, list[str]]:
    """The ``planned_studios`` a product actually holds.

    Only ``studio`` proposals land here. A section, a merge, a named gap on an
    existing surface and a delivered capability are all removed from the plan by
    the consolidation, so a product cannot claim work it has decided not to do.
    """
    planned: dict[str, list[str]] = {}
    for proposal in PROPOSALS.values():
        planned.setdefault(proposal["product"], [])
        if proposal["disposition"] == "studio":
            planned[proposal["product"]].append(proposal["id"])
    return planned


def validate(*, studio_products: dict[str, str], product_ids: frozenset[str],
             repo_root: Path = REPO_ROOT) -> None:
    """Refuse a register that cannot be trusted.

    Called at import time so a bad consolidation fails the process rather than
    the screen, and called directly by the tests. It enforces the vocabulary, the
    target rules, that ``covers`` never lists a duplicate or a shadowed proposal,
    that every cited file exists, and that no gate blocks nothing.
    """
    covered_by: dict[str, str] = {}
    for proposal_id, proposal in PROPOSALS.items():
        where = f"proposal '{proposal_id}'"
        if not _ID_PATTERN.match(proposal_id):
            raise ValueError(f"{where}: id must be lower-kebab-case")
        if proposal["disposition"] not in PROPOSAL_DISPOSITIONS:
            raise ValueError(f"{where}: unknown disposition '{proposal['disposition']}'")
        if proposal["product"] not in product_ids:
            raise ValueError(f"{where}: unknown product '{proposal['product']}'")
        if not proposal["sources"]:
            raise ValueError(f"{where}: every proposal must cite the batch that made it")
        for gate_id in proposal["gates"]:
            if gate_id not in GATES:
                raise ValueError(f"{where}: unknown gate '{gate_id}'")

        disposition = proposal["disposition"]
        merges_into = proposal["merges_into"]
        exists_at = proposal["already_exists_at"]
        buildable = proposal["buildable_from"]

        if disposition == "studio":
            if proposal_id in studio_products:
                raise ValueError(
                    f"{where}: a proposal cannot share a registered studio's id"
                )
            if merges_into or exists_at:
                raise ValueError(f"{where}: a studio proposal merges into nothing")
            if not proposal["gates"] and not buildable:
                raise ValueError(
                    f"{where}: a studio proposal must name its gate or the records it "
                    "projects from"
                )
        elif disposition == "section":
            if merges_into not in studio_products:
                raise ValueError(
                    f"{where}: section target '{merges_into}' is not a registered studio"
                )
            if exists_at:
                raise ValueError(f"{where}: use merges_into, not already_exists_at")
            if studio_products[merges_into] != proposal["product"]:
                raise ValueError(
                    f"{where}: a section is filed under its studio's product "
                    f"'{studio_products[merges_into]}', not '{proposal['product']}'"
                )
        elif disposition == "merged":
            if proposal["gates"] or buildable or exists_at:
                raise ValueError(
                    f"{where}: a merged proposal inherits its target's gates and "
                    "records, so it declares neither"
                )
            if merges_into not in PROPOSALS:
                raise ValueError(f"{where}: merged target '{merges_into}' is no proposal")
            if PROPOSALS[merges_into]["disposition"] == "merged":
                raise ValueError(f"{where}: merges must not chain")
        else:  # extend / served
            if merges_into:
                raise ValueError(f"{where}: '{disposition}' extends a surface, not a target")
            if not exists_at:
                raise ValueError(f"{where}: '{disposition}' must cite the owning file")
            if not (repo_root / exists_at).exists():
                raise ValueError(f"{where}: cited file '{exists_at}' does not exist")
            if disposition == "served" and (proposal["gates"] or buildable):
                raise ValueError(
                    f"{where}: a served proposal names no gate and projects from nothing"
                )

        for path in buildable:
            if not (repo_root / path).exists():
                raise ValueError(f"{where}: buildable_from '{path}' does not exist")

        for covered in proposal["covers"]:
            if covered in PROPOSALS:
                raise ValueError(f"{where}: covers '{covered}', which is itself a proposal")
            if covered in covered_by:
                raise ValueError(
                    f"{where}: covers '{covered}', already covered by "
                    f"'{covered_by[covered]}' — the same idea twice"
                )
            covered_by[covered] = proposal_id

    referenced = {gate_id for proposal in PROPOSALS.values() for gate_id in proposal["gates"]}
    for gate_id, gate in GATES.items():
        cleared_by = gate.get("cleared_by")
        if cleared_by is None:
            if gate_id not in referenced:
                raise ValueError(f"gate '{gate_id}' blocks nothing")
            continue
        # A cleared gate is history rather than a blocker: it must say what cleared
        # it, cite evidence that exists, and nothing may still be blocked by it.
        if gate_id in referenced:
            raise ValueError(
                f"gate '{gate_id}' is recorded as cleared but a proposal is still "
                "blocked by it"
            )
        if not gate.get("cleared_note"):
            raise ValueError(f"gate '{gate_id}' is cleared without saying what cleared it")
        if not (repo_root / cleared_by).exists():
            raise ValueError(f"gate '{gate_id}' cites missing evidence '{cleared_by}'")


def catalogue_note(proposal: dict) -> str:
    """One line for the hub: what the disposition means for this proposal."""
    target = proposal["merges_into"] or proposal["already_exists_at"]
    label = DISPOSITION_LABELS[proposal["disposition"]]
    return f"{label}: {target}" if target else label


__all__: list[Any] = [
    "DISPOSITION_LABELS",
    "GATES",
    "PROPOSALS",
    "PROPOSAL_DISPOSITIONS",
    "PROPOSAL_NOTE",
    "REPO_ROOT",
    "catalogue_note",
    "planned_studios_by_product",
    "proposals_for_product",
    "public_proposal",
    "validate",
]
