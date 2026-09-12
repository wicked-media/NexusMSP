"""Shared action-specific permission vocabulary and enforcement.

NexusMSP historically stored broad module permissions (view/create/edit/delete)
on each user.  Those values remain a compatibility input, while this service
adds stable action subjects for high-impact operations.  Roles can opt into an
explicit action list without changing their stable role ID.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db


ACTION_PERMISSIONS: tuple[dict[str, Any], ...] = (
    {
        "id": "platform.core.rebuild",
        "category": "Platform",
        "label": "Rebuild Nexus Core relationships",
        "description": "Reconcile the canonical client/entity graph from operational source records.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "confidence.verify",
        "category": "Platform",
        "label": "Verify Nexus Confidence evidence",
        "description": "Attest that a client, device or documentation confidence profile was reviewed without overriding source-evidence gaps.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "platform.events.view",
        "category": "Platform",
        "label": "View event operations",
        "description": "View governed platform event health, subscriptions, deliveries and replay evidence.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("settings", "view"),
    },
    {
        "id": "platform.events.publish",
        "category": "Platform",
        "label": "Publish governed platform events",
        "description": "Publish an authenticated, scope-checked event through the Nexus event backbone.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "platform.events.manage",
        "category": "Platform",
        "label": "Manage event subscriptions",
        "description": "Create, update, pause and repair durable platform event deliveries.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "platform.events.replay",
        "category": "Platform",
        "label": "Replay retained events",
        "description": "Re-deliver retained platform events to governed subscribers.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "platform.readiness.view",
        "category": "Platform",
        "label": "View production readiness",
        "description": "View launch gates, evidence requirements and the internal production-readiness register.",
        "impact": "low",
        "approval_required": False,
        "legacy": ("settings", "view"),
    },
    {
        "id": "platform.audit.view",
        "category": "Platform",
        "label": "View central audit trail",
        "description": "Review the cross-client administrative audit ledger for authorised operational or security investigation.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("settings", "view"),
    },
    {
        "id": "platform.configuration.manage",
        "category": "Platform",
        "label": "Manage organisation configuration",
        "description": "Change global operational configuration such as custom fields and legacy escalation rotations.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "platform.migration.view",
        "category": "Platform",
        "label": "View Nexus Switchboard migration plans",
        "description": "Review global MSP migration planning, mapping and reconciliation evidence without granting any provider-import capability.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("settings", "view"),
    },
    {
        "id": "platform.migration.manage",
        "category": "Platform",
        "label": "Manage Nexus Switchboard migration plans",
        "description": "Create and review global MSP migration plans, exception ownership and cutover evidence. This permission does not authorise external imports.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "platform.recovery.view",
        "category": "Platform",
        "label": "View platform recovery evidence",
        "description": "Review Nexus Core backup profiles, restore-point evidence and isolated recovery verification without exposing backup payloads or secrets.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("settings", "view"),
    },
    {
        "id": "platform.recovery.manage",
        "category": "Platform",
        "label": "Manage platform recovery plans",
        "description": "Configure non-secret recovery policy, request restore points and retain backup or validation evidence.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "platform.recovery.restore",
        "category": "Platform",
        "label": "Plan platform recovery or cutover",
        "description": "Create a guarded fresh-host recovery or cutover plan from an independently verified restore point. It never permits a live in-place database overwrite.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("settings", "delete"),
    },
    {
        "id": "platform.readiness.manage",
        "category": "Platform",
        "label": "Manage production readiness",
        "description": "Create and review launch evidence, test results and production-blocker decisions.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "dns.policy.modify",
        "category": "DNS",
        "label": "Modify DNS policies",
        "description": "Create or edit client and endpoint DNS policy.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("networking", "edit"),
    },
    {
        "id": "dns.deployment.stage",
        "category": "DNS",
        "label": "Stage DNS deployment",
        "description": "Queue a resolver or endpoint policy rollout.",
        "impact": "high",
        "approval_required": True,
        "legacy": ("networking", "edit"),
    },
    {
        "id": "dns.exception.create",
        "category": "DNS",
        "label": "Create DNS exception",
        "description": "Temporarily allow a blocked destination with a recorded reason.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("networking", "edit"),
    },
    {
        "id": "dns.emergency.disable",
        "category": "DNS",
        "label": "Emergency-disable DNS enforcement",
        "description": "Return enrolled endpoints to visibility mode during an incident.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("networking", "delete"),
    },
    {
        "id": "device.remote.start",
        "category": "Remote & devices",
        "label": "Start remote session",
        "description": "Initiate an attended or authorised remote session.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "device.remote.end",
        "category": "Remote & devices",
        "label": "End remote session",
        "description": "Close a remote session and write its service, ticket and time evidence.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "device.remote.configure",
        "category": "Remote & devices",
        "label": "Configure remote access",
        "description": "Change provider assignment, consent policy and remote endpoint identity.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "device.remote.repair",
        "category": "Remote & devices",
        "label": "Repair remote access",
        "description": "Run a bounded provider health repair through the trusted Nexus Agent.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "device.command.execute",
        "category": "Remote & devices",
        "label": "Execute endpoint command",
        "description": "Run a device command, script, reboot, patch or process action.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "asset.lifecycle.manage",
        "category": "Remote & devices",
        "label": "Manage connected asset lifecycle",
        "description": "Create or link the canonical inventory and lifecycle record for a managed endpoint.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("assets", "edit"),
    },
    {
        "id": "agent.trust.remediate",
        "category": "Remote & devices",
        "label": "Repair agent trust",
        "description": "Repair device identity, policy cache, configuration permissions or the support companion.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "m365.tenant.manage",
        "category": "Microsoft 365",
        "label": "Manage Microsoft tenant connections",
        "description": "Configure Partner Center discovery, add tenants and map Microsoft tenants to Nexus clients.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "entra.user.create",
        "category": "Identity",
        "label": "Create cloud user",
        "description": "Create a Microsoft 365 or Entra user through Nexus Control.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "entra.user.disable",
        "category": "Identity",
        "label": "Disable or offboard user",
        "description": "Block sign-in or run a governed offboarding action.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "entra.license.modify",
        "category": "Identity",
        "label": "Modify cloud licence",
        "description": "Assign or remove a Microsoft cloud licence.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "entra.group.modify",
        "category": "Identity",
        "label": "Modify cloud group access",
        "description": "Add or remove a Microsoft user from a cloud group through a governed tenant workflow.",
        "impact": "high",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "entra.role.modify",
        "category": "Identity",
        "label": "Modify privileged directory role",
        "description": "Assign, remove or time-bound a Microsoft directory role through an independently approved workflow.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "exchange.mailbox.delegate",
        "category": "Microsoft 365",
        "label": "Modify mailbox delegation",
        "description": "Grant, change or remove shared-mailbox delegation through a governed, auditable workflow.",
        "impact": "high",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "intune.device.retire",
        "category": "Microsoft 365",
        "label": "Retire or wipe managed device",
        "description": "Retire, wipe or remove a Microsoft Intune managed device through a protected tenant workflow.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "entra.conditional_access.modify",
        "category": "Microsoft 365",
        "label": "Modify Conditional Access policy",
        "description": "Create, update, enable, disable or remove a Microsoft Conditional Access policy through a controlled change workflow.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "entra.credential.reset",
        "category": "Identity",
        "label": "Reset cloud credential",
        "description": "Reset a user password or authentication credential.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "ticket.handoff.manage",
        "category": "Service desk",
        "label": "Create and respond to ticket handovers",
        "description": "Pass, accept, decline, assist, consult, cover, return, escalate or swarm a ticket through Nexus Connect.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("tickets", "edit"),
    },
    {
        "id": "ticket.conversation.create",
        "category": "Service desk",
        "label": "Add ticket conversation entries",
        "description": "Create audited internal notes and customer-visible updates on an authorised ticket.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("tickets", "edit"),
    },
    {
        "id": "ticket.public_update.send",
        "category": "Service desk",
        "label": "Send customer ticket updates",
        "description": "Publish a ticket update to a client portal and, when selected, its configured customer email route.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("tickets", "edit"),
    },
    {
        "id": "ticket.time.create",
        "category": "Service desk",
        "label": "Log ticket time",
        "description": "Create an attributable, auditable time entry against an authorised ticket.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("tickets", "edit"),
    },
    {
        "id": "ticket.bulk.modify",
        "category": "Service desk",
        "label": "Modify tickets in bulk",
        "description": "Apply a governed bulk update to a validated, client-scoped ticket selection.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("tickets", "edit"),
    },
    {
        "id": "ticket.attachment.upload",
        "category": "Service desk",
        "label": "Add ticket evidence",
        "description": "Attach approved customer evidence, exports and diagnostics to a ticket.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("tickets", "edit"),
    },
    {
        "id": "ticket.attachment.delete",
        "category": "Service desk",
        "label": "Permanently remove ticket evidence",
        "description": "Delete a retained ticket attachment while preserving a central audit record.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("tickets", "delete"),
    },
    {
        "id": "billing.invoice.create",
        "category": "Billing",
        "label": "Create invoice",
        "description": "Create a client invoice or generate one from an agreement.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("invoices", "create"),
    },
    {
        "id": "billing.invoice.modify",
        "category": "Billing",
        "label": "Modify invoice",
        "description": "Change invoice details, allocations or client ownership.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("invoices", "edit"),
    },
    {
        "id": "billing.analytics.view",
        "category": "Billing",
        "label": "View organisation billing analytics",
        "description": "View cross-client receivables, revenue, purchase-order and cash-flow analytics.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("financial_reports", "view"),
    },
    {
        # Deliberately has no legacy mapping or role default.  Catalogue cost,
        # retail and kit changes can affect every future customer charge.
        "id": "billing.catalogue.pricing.manage",
        "category": "Billing",
        "label": "Manage catalogue pricing and product kits",
        "description": "Change global product prices, product kits, and client-specific price books through a governed workflow.",
        "impact": "high",
        "approval_required": False,
    },
    {
        "id": "billing.payment.record",
        "category": "Billing",
        "label": "Record payment",
        "description": "Record or settle a client payment against an invoice.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("invoices", "edit"),
    },
    {
        "id": "billing.invoice.void",
        "category": "Billing",
        "label": "Void invoice",
        "description": "Void a financial document while retaining its audit evidence.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("invoices", "delete"),
    },
    {
        "id": "billing.late_fee.policy.manage",
        "category": "Billing",
        "label": "Manage late-fee policy",
        "description": "Change the global or client-specific late-fee rules that can alter customer financial documents.",
        "impact": "critical",
        "approval_required": True,
    },
    {
        "id": "billing.document_template.manage",
        "category": "Billing",
        "label": "Manage commercial document templates",
        "description": "Create, change, retire or select the organisation-wide templates used for customer invoices, estimates, statements and QBRs.",
        "impact": "high",
        "approval_required": False,
    },
    {
        "id": "automation.workflow.modify",
        "category": "Automation",
        "label": "Modify workflow",
        "description": "Create, install, edit, toggle or retire an automation.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "automation.workflow.view",
        "category": "Automation",
        "label": "View workflow evidence",
        "description": "View scoped workflow definitions, retained simulations and governed run evidence without receiving permission to simulate or execute.",
        "impact": "low",
        "approval_required": False,
        "legacy": ("settings", "view"),
    },
    {
        "id": "automation.workflow.simulate",
        "category": "Automation",
        "label": "Simulate workflow",
        "description": "Run a non-mutating workflow simulation or controlled test.",
        "impact": "low",
        "approval_required": False,
        "legacy": ("settings", "view"),
    },
    {
        "id": "automation.workflow.execute",
        "category": "Automation",
        "label": "Execute workflow",
        "description": "Run an approved automation against its selected scope.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "automation.workflow.approve",
        "category": "Automation",
        "label": "Approve workflow change",
        "description": "Submit or approve governed automation execution.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "automation.autopilot.manage",
        "category": "Automation",
        "label": "Manage Nexus Autopilot policy",
        "description": "Configure the maximum autonomy level, client scope, confidence gate, and action allow-list.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "automation.autopilot.simulate",
        "category": "Automation",
        "label": "Simulate Nexus Autopilot",
        "description": "Generate a non-mutating Autopilot plan from retained Nexus evidence.",
        "impact": "low",
        "approval_required": False,
        "legacy": ("settings", "view"),
    },
    {
        "id": "automation.autopilot.pause",
        "category": "Automation",
        "label": "Pause Nexus Autopilot",
        "description": "Immediately return Autopilot to suggestion-only mode while preserving queued evidence.",
        "impact": "low",
        "approval_required": False,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "executive.intelligence.view",
        "category": "Executive",
        "label": "View CEO Mode",
        "description": "View cross-client revenue, cash, client-health, capacity, and business-risk evidence.",
        "impact": "low",
        "approval_required": False,
        "legacy": ("financial_reports", "view"),
    },
    {
        "id": "executive.scenario.simulate",
        "category": "Executive",
        "label": "Simulate an owner scenario",
        "description": "Run a non-mutating what-if model against the current executive baseline.",
        "impact": "low",
        "approval_required": False,
        "legacy": ("financial_reports", "view"),
    },
    {
        "id": "executive.board.snapshot",
        "category": "Executive",
        "label": "Save executive board snapshot",
        "description": "Retain a point-in-time board briefing with its source-quality statement.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("financial_reports", "create"),
    },
    {
        "id": "voice.pbx.modify",
        "category": "Voice",
        "label": "Modify PBX connection",
        "description": "Add or change a client PBX integration.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "voice.billing.recalculate",
        "category": "Voice",
        "label": "Recalculate voice billing",
        "description": "Recalculate billable extension quantity and agreement mapping.",
        "impact": "high",
        "approval_required": True,
        "legacy": ("invoices", "edit"),
    },
    {
        "id": "billing.integration.manage",
        "category": "Billing",
        "label": "Manage accounting integrations",
        "description": "Configure or rotate the organisation-wide accounting connection and its provider credentials.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "billing.portal.view",
        "category": "Billing",
        "label": "View customer billing portal status",
        "description": "View client-scoped billing portal status, collections evidence and reminder health.",
        "impact": "low",
        "approval_required": False,
        "legacy": ("invoices", "view"),
    },
    {
        "id": "billing.portal.link.create",
        "category": "Billing",
        "label": "Create customer billing portal session",
        "description": "Create an auditable Stripe customer billing portal session for an authorised client.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("invoices", "edit"),
    },
    {
        "id": "billing.portal.reminder.send",
        "category": "Billing",
        "label": "Send customer payment reminder",
        "description": "Send an auditable payment reminder to an authorised client billing contact.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("invoices", "edit"),
    },
    {
        "id": "synergy.wholesale.manage",
        "category": "Web & domains",
        "label": "Manage Synergy Wholesale services",
        "description": "Request governed domain, DNS, hosting, certificate and Microsoft 365 provider actions.",
        "impact": "high",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "platform.webhooks.manage",
        "category": "Platform",
        "label": "Manage outbound webhooks",
        "description": "Configure, test, pause and retire compatibility outbound webhook integrations.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "portal.audit.view",
        "category": "Client portal",
        "label": "View client portal audit evidence",
        "description": "Review client portal access and administration evidence for an authorised client scope.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("clients", "view"),
    },
    {
        "id": "portal.configuration.manage",
        "category": "Client portal",
        "label": "Manage client portal configuration",
        "description": "Change portal availability, branding and exposed self-service capabilities.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("clients", "edit"),
    },
    {
        "id": "portal.link.manage",
        "category": "Client portal",
        "label": "Manage secure portal links",
        "description": "Issue or revoke a bearer link that provides client portal access.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("clients", "edit"),
    },
    {
        "id": "portal.user.manage",
        "category": "Client portal",
        "label": "Manage client portal users",
        "description": "Create, change, remove or reset client portal user access.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("clients", "edit"),
    },
    {
        "id": "client.contact.manage",
        "category": "Client success",
        "label": "Manage client contacts",
        "description": "Create, update or remove operational contacts for a permitted client account.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("clients", "edit"),
    },
    {
        "id": "client.follow_up.manage",
        "category": "Client success",
        "label": "Manage client follow-ups",
        "description": "Create, reassign, complete or cancel accountable client follow-ups for a permitted account.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("clients", "edit"),
    },
    {
        "id": "crm.lead.convert",
        "category": "Client success",
        "label": "Convert leads to clients",
        "description": "Create a client record from a lead in the permitted tenant portfolio.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("clients", "create"),
    },
    {
        "id": "client.account.manage",
        "category": "Client success",
        "label": "Manage client account plan and stakeholders",
        "description": "Create or change account plans, stakeholder records and client service-priority markers.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("clients", "edit"),
    },
    {
        "id": "client.site.manage",
        "category": "Client success",
        "label": "Manage client sites",
        "description": "Create, update or retire a client site, address and service-location record.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("clients", "edit"),
    },
    {
        "id": "client.portfolio.recalculate",
        "category": "Client success",
        "label": "Recalculate client portfolio suggestions",
        "description": "Recalculate suggested service tiers across the client portfolio without overwriting technician-managed tiers.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "security.containment.approve",
        "category": "Security",
        "label": "Approve containment",
        "description": "Approve isolation, suppression or another containment action.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("devices", "delete"),
    },
)

ACTION_PERMISSION_BY_ID = {item["id"]: item for item in ACTION_PERMISSIONS}
ACTION_PERMISSION_IDS = frozenset(ACTION_PERMISSION_BY_ID)


TECHNICIAN_DEFAULTS = frozenset(
    {
        "dns.exception.create",
        "device.remote.start",
        "device.remote.end",
        "device.remote.repair",
        "device.command.execute",
        "asset.lifecycle.manage",
        "confidence.verify",
        "entra.credential.reset",
        "ticket.conversation.create",
        "ticket.public_update.send",
        "ticket.time.create",
        "ticket.handoff.manage",
        "ticket.attachment.upload",
        "automation.autopilot.pause",
        "automation.autopilot.simulate",
        "automation.workflow.view",
        "automation.workflow.simulate",
    }
)
DISPATCHER_DEFAULTS = frozenset({"automation.workflow.view", "automation.workflow.simulate"})
SERVICE_DESK_MANAGER_DEFAULTS = frozenset(
    permission_id
    for permission_id in ACTION_PERMISSION_IDS
    if permission_id
    not in {
        "billing.catalogue.pricing.manage",
        "billing.payment.record",
        "billing.invoice.void",
        "billing.analytics.view",
        "billing.late_fee.policy.manage",
        "billing.document_template.manage",
        "ticket.bulk.modify",
        "dns.emergency.disable",
        "platform.core.rebuild",
        "platform.events.replay",
        "platform.readiness.manage",
        "platform.migration.view",
        "platform.migration.manage",
        "platform.recovery.view",
        "platform.recovery.manage",
        "platform.recovery.restore",
        "security.containment.approve",
        "executive.intelligence.view",
        "executive.scenario.simulate",
        "executive.board.snapshot",
    }
)

DEFAULT_ROLE_ACTION_PERMISSIONS: dict[str, frozenset[str]] = {
    "technician": TECHNICIAN_DEFAULTS,
    "dispatcher": DISPATCHER_DEFAULTS,
    "service_desk_manager": SERVICE_DESK_MANAGER_DEFAULTS,
    "admin": ACTION_PERMISSION_IDS,
}


def normalise_action_permissions(value: Any) -> list[str]:
    """Return a stable, validated action-permission list."""
    if isinstance(value, dict):
        values = [key for key, enabled in value.items() if enabled]
    elif isinstance(value, (list, tuple, set, frozenset)):
        values = list(value)
    else:
        values = []
    return sorted({str(item).strip() for item in values if str(item).strip() in ACTION_PERMISSION_IDS})


def default_permissions_for_role(role_id: str) -> list[str]:
    defaults = DEFAULT_ROLE_ACTION_PERMISSIONS.get(str(role_id or "").strip().lower(), TECHNICIAN_DEFAULTS)
    return sorted(defaults)


def permission_catalogue() -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for raw in ACTION_PERMISSIONS:
        item = {key: value for key, value in raw.items() if key != "legacy"}
        grouped[item["category"]].append(item)
    return {
        "actions": [
            {key: value for key, value in item.items() if key != "legacy"}
            for item in ACTION_PERMISSIONS
        ],
        "categories": [
            {"name": category, "actions": actions}
            for category, actions in grouped.items()
        ],
        "impact_levels": ["low", "medium", "high", "critical"],
    }


async def _stored_role_permission(role_id: str) -> tuple[bool, set[str]]:
    stored = await db.settings.find_one(
        {"key": "access_role_catalogue"},
        {"_id": 0, "value": 1},
    ) or {}
    for item in stored.get("value", []):
        if isinstance(item, dict) and item.get("id") == role_id and "action_permissions" in item:
            return True, set(normalise_action_permissions(item.get("action_permissions")))
    return False, set()


def _user_override(user: dict[str, Any], permission_id: str) -> tuple[bool, bool]:
    value = user.get("action_permissions")
    if isinstance(value, dict) and permission_id in value:
        return True, bool(value[permission_id])
    if isinstance(value, (list, tuple, set, frozenset)):
        return True, permission_id in normalise_action_permissions(value)
    return False, False


async def evaluate_action_permission(user: dict[str, Any], permission_id: str) -> dict[str, Any]:
    if permission_id not in ACTION_PERMISSION_BY_ID:
        return {"allowed": False, "source": "unknown-action", "permission": permission_id}

    if user.get("is_admin") or str(user.get("role") or "").lower() == "admin":
        return {"allowed": True, "source": "administrator", "permission": permission_id}

    has_override, override_allowed = _user_override(user, permission_id)
    if has_override:
        return {
            "allowed": override_allowed,
            "source": "user-override",
            "permission": permission_id,
        }

    role_id = str(user.get("role") or "technician").strip().lower()
    role_is_explicit, role_permissions = await _stored_role_permission(role_id)
    if role_is_explicit:
        return {
            "allowed": permission_id in role_permissions,
            "source": "role-action-policy",
            "permission": permission_id,
        }

    action = ACTION_PERMISSION_BY_ID[permission_id]
    module, operation = action.get("legacy") or (None, None)
    legacy_permissions = user.get("permissions") if isinstance(user.get("permissions"), dict) else {}
    module_permissions = legacy_permissions.get(module) if isinstance(legacy_permissions.get(module), dict) else {}
    legacy_allowed = bool(module_permissions.get(operation))
    default_allowed = permission_id in DEFAULT_ROLE_ACTION_PERMISSIONS.get(role_id, TECHNICIAN_DEFAULTS)
    return {
        "allowed": legacy_allowed or default_allowed,
        "source": "legacy-compatible-role-default",
        "permission": permission_id,
    }


async def effective_action_permissions(user: dict[str, Any]) -> dict[str, Any]:
    evaluations = [await evaluate_action_permission(user, item["id"]) for item in ACTION_PERMISSIONS]
    allowed = [item["permission"] for item in evaluations if item["allowed"]]
    denied = [item["permission"] for item in evaluations if not item["allowed"]]
    return {
        "user_id": user.get("id"),
        "role": user.get("role", "technician"),
        "administrator": bool(user.get("is_admin") or user.get("role") == "admin"),
        "allowed": allowed,
        "denied": denied,
        "evaluations": evaluations,
    }


async def assert_action_permission(
    user: dict[str, Any],
    permission_id: str,
    *,
    request: Request | None = None,
) -> dict[str, Any]:
    """Enforce one action permission outside a FastAPI dependency chain.

    Composite workflows (for example, publishing a client update while also
    logging time) need more than one action grant.  Keep their denial evidence
    identical to ordinary ``require_action`` routes rather than treating a
    second permission check as a frontend-only convention.
    """
    result = await evaluate_action_permission(user, permission_id)
    if result["allowed"]:
        return user

    await db.permission_denials.insert_one(
        {
            "permission": permission_id,
            "user_id": user.get("id"),
            "user_name": user.get("name"),
            "role": user.get("role"),
            "source": result.get("source"),
            "method": request.method if request else None,
            "path": str(request.url.path) if request else None,
            "correlation_id": getattr(getattr(request, "state", None), "correlation_id", None),
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    raise HTTPException(
        status_code=403,
        detail=f"Action permission required: {permission_id}",
        headers={"X-Required-Permission": permission_id},
    )


def require_action(permission_id: str) -> Callable[..., Any]:
    if permission_id not in ACTION_PERMISSION_BY_ID:
        raise RuntimeError(f"Unknown NexusMSP action permission: {permission_id}")

    async def dependency(
        request: Request,
        current_user: dict = Depends(get_current_user),
    ) -> dict:
        return await assert_action_permission(current_user, permission_id, request=request)

    return dependency
