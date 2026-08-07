"""Task-first NexusMSP Help Centre catalogue.

Every shipped article follows the same technician-friendly structure:
outcome, prerequisites, workflow, verification, and audit evidence.  This is
intentionally separate from the old feature-notes catalogue so the Help Centre
can stay useful in the moment of work rather than becoming an implementation
archive.
"""

HELP_CATALOG_VERSION = "2026-08-02-guide-system-v18-recovery-assurance"


_WORKSPACE_VISUALS = {
    "Start here": [{"url": "/uploads/help/guides/tickets-workspace.png", "caption": "NexusMSP service workspace reference — use the relevant live workspace for the task at hand."}],
    "Service desk": [{"url": "/uploads/help/guides/tickets-workspace.png", "caption": "Tickets workspace — locate the queue, ticket actions, and live service work."}],
    "Client operations": [{"url": "/uploads/help/guides/clients-workspace.png", "caption": "Clients workspace — search, select, and review a client operational profile."}],
    "Infrastructure & security": [{"url": "/uploads/help/guides/managed-assets.png", "caption": "Managed Assets — find device health, ownership, and remote actions."}],
    "Platform setup": [{"url": "/uploads/help/guides/settings-workspace.png", "caption": "Settings hub — organisation-level connections and configuration live here."}],
    "Billing & commercial": [{"url": "/uploads/help/guides/invoices-workspace.png", "caption": "Billing workspace — invoices, billing actions, and financial records."}],
    "Reporting & evidence": [{"url": "/uploads/help/guides/reports-workspace.png", "caption": "Reports workspace — select, generate, retain, and export evidence."}],
    "Knowledge & Docs": [{"url": "/uploads/help/guides/auto-docs-workspace.png", "caption": "Knowledge & Docs — generate, review, and publish technician documentation."}],
    # Automation workspaces differ enough that a generic screenshot is more
    # confusing than helpful. Add a guide-specific visual when one is available.
    "Automation & intelligence": [],
}

_GUIDE_VISUALS = {
    "backup-operations": [{"url": "/uploads/help/guides/backups-workspace.png", "caption": "Backups workspace — health, verification, compliance, and billing views."}],
    "voice-yeastar": [{"url": "/uploads/help/guides/voice-workspace.png", "caption": "Voice workspace — PBX health, client mappings, extension counts, and sync history."}],
    "voice-yeastar-pbx-onboarding": [{"url": "/uploads/help/guides/voice-workspace.png", "caption": "Voice workspace — add and validate a client PBX connection here."}],
    "nexus-shield-and-canary": [{"url": "/uploads/help/guides/nexus-shield-workspace.png", "caption": "Nexus Shield — endpoint protection, canary status, and response controls."}],
    "nexus-shield-canary": [{"url": "/uploads/help/guides/nexus-shield-workspace.png", "caption": "Nexus Shield — choose the target endpoint and verify canary coverage."}],
}


_CATEGORY_PROFILE = {
    "Service desk": ("10-20 minutes", "Low to medium", "Technician access to the client and ticket", "Ticket timeline and client history"),
    "Client operations": ("10-30 minutes", "Medium", "Client-management access", "Client activity feed and linked service record"),
    "Infrastructure & security": ("15-45 minutes", "Medium to high", "Approved endpoint, security, or infrastructure role", "Ticket, device activity, and security history"),
    "Platform setup": ("15-30 minutes", "Medium", "Administrator or integration-owner access", "Settings activity and connection history"),
    "Billing & commercial": ("10-25 minutes", "Medium", "Billing or commercial permission", "Document history and client financial audit"),
    "Reporting & evidence": ("10-20 minutes", "Low", "Report access to the selected scope", "Generated report and delivery history"),
    "Knowledge & Docs": ("15-30 minutes", "Low", "Knowledge author or reviewer access", "Article revision and review history"),
    "Automation & intelligence": ("15-30 minutes", "Medium to high", "Automation permission for the selected scope", "Execution, approval, and linked-ticket history"),
    "Start here": ("5-15 minutes", "Low", "Your assigned NexusMSP technician role", "Workspace activity and owned service records"),
}


def _guide(
    slug, title, category, icon, order, summary, outcome, before, steps, verify,
    audit, related="", screenshots=None, at_a_glance="", troubleshooting="",
    rollback="",
):
    profile = _CATEGORY_PROFILE.get(
        category,
        ("10-20 minutes", "Low to medium", "Access to the selected NexusMSP scope", "Activity history and linked operational record"),
    )
    glance = at_a_glance or (
        f"- **Expected time:** {profile[0]}\n"
        f"- **Risk:** {profile[1]}\n"
        f"- **Required access:** {profile[2]}\n"
        f"- **Evidence location:** {profile[3]}"
    )
    exception_help = troubleshooting or (
        "- **The expected record is missing:** Reconfirm the client or asset scope, refresh the source connection, and inspect the activity history for a rejected or failed action.\n"
        "- **The action completed with the wrong result:** Stop further changes, capture the current state, and return to the last verified configuration.\n"
        "- **The same failure repeats:** Link the error, timestamps, and affected records to a ticket before escalating to the workspace owner."
    )
    safe_recovery = rollback or (
        "Stop when the live state differs from the approved scope or the change could affect another client. "
        "Disable or reverse only the action performed in this procedure, confirm the previous healthy state, "
        "and escalate with the linked ticket, error details, timestamps, and evidence."
    )
    body = f"""## Outcome
{outcome}

## At a glance
{glance}

## Before you start
{before}

## Procedure
{steps}

## Verify the result
{verify}

## Troubleshooting
{exception_help}

## Rollback and escalation
{safe_recovery}

## Audit and handover
{audit}
"""
    if related:
        body += f"\n## Related guides\n{related}\n"
    return {
        "slug": slug,
        "title": title,
        "category": category,
        "icon": icon,
        "order": order,
        "summary": summary,
        "body_md": body,
        "guide_type": "procedure",
        "screenshots": screenshots if screenshots is not None else _GUIDE_VISUALS.get(slug, _WORKSPACE_VISUALS.get(category, [])),
    }


def _workspace_guide(
    slug, title, category, icon, order, summary, steps, verify, related="",
    before="", audit="", at_a_glance="", troubleshooting="", rollback="",
    screenshots=None,
):
    """A complete operational guide for a first-class NexusMSP workspace."""
    return _guide(
        slug,
        title,
        category,
        icon,
        order,
        summary,
        f"The technician has completed **{title.lower()}**, verified the live result, and attached the evidence to the correct NexusMSP operational record.",
        before or (
            "- Confirm the correct client, asset, ticket, or organisation scope before making a change.\n"
            "- Review client alerts, linked service records, maintenance windows, and approvals that apply to the work.\n"
            "- Capture the current state and identify the safe recovery point before changing production service."
        ),
        steps,
        verify,
        audit or (
            "- Record the technician, approval, affected scope, action, timestamp, and verified result.\n"
            "- Attach the relevant activity event, screenshot, report, or execution output to the ticket or client history.\n"
            "- Assign any exception or follow-up work to a named owner with a due date."
        ),
        related,
        screenshots,
        at_a_glance,
        troubleshooting,
        rollback,
    )


CURATED_ARTICLES = [
    {
        "slug": "whats-new",
        "title": "What's New in NexusMSP",
        "category": "Release Notes",
        "icon": "🆕",
        "order": -1,
        "summary": "A concise release record for changes that affect how technicians work.",
        "guide_type": "release-notes",
        "body_md": """## Latest Releases

### 2026-06-25 - Big Cleanup
- Consolidated related tools into their primary workspaces so the sidebar is easier to navigate.
- Settings now uses one structured hub with deep links for integrations, mailboxes, branding, AI, and notifications.
- The Help Centre now prioritises task-based technician procedures over feature notes.

### 2026-06-24 - Ticket workspace refinements
- Ticket, workshop, and cabling records share the same service-record structure and conversation workflow.
- Linked devices can be opened and remotely supported from the ticket context.

### 2026-06-23 - Reporting and documents
- Reports, scheduled delivery, and QBR downloads use a consistent NexusMSP evidence-document layout.
- Invoices, purchase orders, and recurring billing retain their branded templates.

## How to use release notes
Read the newest entry before a shift. If an item changes a procedure, follow its linked guide rather than relying on the release note alone.
""",
    },
    _guide(
        "getting-started", "Start a productive shift", "Start here", "🚀", 0,
        "Set up your workspace, establish your availability, and triage the day with the right operational context.",
        "You have a ready-to-use technician workspace, know what needs attention, and can safely begin work.",
        "Sign in with your assigned account. Confirm that you can access the client and ticket workspaces required for your role.",
        "1. Open **My Workspace** and confirm your profile, notification preferences, and working hours.\n2. Open **Dashboard** and use **Nexus Daily** to review priority alerts, backups, and handover items. Select **Daily sign-off** when an attributable NOC review is required.\n3. Open **Tickets** and use the queue filters to identify your assigned and unassigned urgent work.\n4. Set your availability in **Team** if you are starting, pausing, or finishing a shift.",
        "Your dashboard should show current data, your ticket queue should be visible, and your availability should be correct for dispatch.",
        "Use ticket notes for customer work. Use Team Chat or the handover workflow for internal operational context; never place credentials in either.",
        "[Ticket triage](/help/ticket-triage) and [Daily NOC sign-off](/help/daily-noc-sign-off).",
    ),
    _guide(
        "using-help-center", "Use the Help Centre", "Start here", "📘", 1,
        "Find a trustworthy procedure, ask the guide assistant a focused question, and improve a guide when the workflow changes.",
        "You can locate the correct procedure quickly and know when to escalate a documentation gap.",
        "Be signed in. Admins can create and update shared articles; all technicians can search and use them.",
        "1. Search by the task, not the page name - for example, 'record payment' or 'connect mailbox'.\n2. Select the category that matches the work you are performing.\n3. Follow the **Before you start**, **Procedure**, and **Verify** sections in order.\n4. Use Help Co-pilot for a question only after opening the closest guide; citations link back to the source procedure.\n5. If guidance is missing or wrong, tell an admin what task, screen, and decision needs documenting.",
        "The article title, outcome, and verify step should all match the work in front of you. Do not use old release notes as a procedure.",
        "Admins should review shipped guides after product changes. Custom guides remain separate from the product catalogue during a refresh.",
    ),
    _guide(
        "ticket-triage", "Triage and create a ticket", "Service desk", "🎫", 10,
        "Create a complete service record, assign the right urgency, and make the next technician's work obvious.",
        "A ticket is created with the right client, contact, impact, ownership, policy, and linked assets.",
        "Confirm the client and requester. Check for an existing related ticket before opening a duplicate.",
        "1. Select **New ticket** from Tickets.\n2. Search for the client and requester using autocomplete.\n3. Write a specific title: service, affected user or device, and symptom.\n4. Set priority from business impact and urgency, then choose the appropriate service policy.\n5. Link every affected asset; use the device action menu to start remote support without leaving the ticket.\n6. Add an internal case brief with the first action and next checkpoint.\n7. Save and confirm the owner, status, and customer communication plan.",
        "The ticket appears in the intended queue, the client and devices are linked, and a technician can understand the next action without asking for context.",
        "All client correspondence, status changes, time, device actions, and resolution notes remain on the ticket timeline.",
        "[Work a service ticket](/help/work-ticket) and [Communicate with a client](/help/ticket-communications).",
    ),
    _guide(
        "work-ticket", "Work, resolve, and close a service ticket", "Service desk", "🛠️", 11,
        "Keep a defensible live service record from first action through closure.",
        "The ticket contains a clear diagnosis, customer updates, time and materials, and a verified resolution.",
        "Open the ticket, review the case brief, linked assets, previous client notes, and active account alerts first.",
        "1. Claim or assign the ticket before beginning work.\n2. Add an internal note when you start and after each material diagnostic or action.\n3. Use the Conversation tab for customer email or SMS so correspondence remains auditable.\n4. Add time and billable items as they occur; link invoices or purchase orders from the ticket tools when required.\n5. Confirm service restoration with the requester or recorded evidence.\n6. Write a concise resolution: cause, action, validation, and any follow-up.\n7. Resolve the ticket only when the record is complete; the workflow closes it and retains it on the client profile.",
        "The customer-facing update is sent when required, linked assets and billing are correct, and the resolution can be understood during an audit.",
        "Do not delete a material note. Correct it with a follow-up note that explains the change and preserves the timeline.",
    ),
    _guide(
        "ticket-communications", "Send email, SMS, and updates from a ticket", "Service desk", "✉️", 12,
        "Send a customer update through the configured mailbox or SMS route and retain the complete correspondence history.",
        "The client receives the correct update and the message, recipient, and sending technician are retained on the ticket.",
        "Confirm that an O365 mailbox is configured in Settings and that the requester contact details are correct.",
        "1. Open the ticket **Conversation** tab.\n2. Choose email or SMS.\n3. Confirm the recipient, subject, and any attachments.\n4. Write a factual update with the next action or timeframe.\n5. Send and wait for the delivery status.\n6. Record any phone conversation as a ticket note immediately after the call.",
        "The outgoing message appears in the conversation timeline and is linked to the client contact. If delivery fails, correct the mailbox route or contact data before retrying.",
        "Messages sent from NexusMSP are retained in the ticket and client communication history for audit.",
        "[Configure service mailboxes](/help/configure-mailboxes).",
    ),
    _guide(
        "dispatch-and-scheduling", "Dispatch and schedule a technician", "Service desk", "📅", 13,
        "Book the right technician without creating an avoidable clash or losing the client context.",
        "An appointment is attached to the ticket, visible to dispatch, and conflict-checked against technician availability.",
        "The ticket must have a client, location or service area, an owner or required skill, and an agreed time window.",
        "1. Open the ticket Dispatch tools.\n2. Select the technician and proposed window.\n3. Review existing calendar commitments and nearby jobs.\n4. If a conflict warning appears, choose an alternative technician or provide a documented override reason.\n5. Add arrival, access, and customer contact details to the appointment.\n6. Save the booking and send the customer confirmation when appropriate.",
        "The appointment appears on the dispatch board and calendar, and the ticket timeline records the booking or override decision.",
        "Reschedules, no-access events, and travel changes must be recorded against the ticket so the customer record remains complete.",
    ),
    _guide(
        "war-rooms", "Run a major incident war room", "Service desk", "🚨", 14,
        "Coordinate a P1 incident with an accountable internal record and a controlled customer-facing status flow.",
        "A war room has an owner, clear severity, linked ticket, comms cadence, and documented exit criteria.",
        "Create or identify the primary incident ticket first. Confirm the customer communication owner and escalation contacts.",
        "1. Open **War Rooms** and create a room from the primary incident.\n2. Set severity, client, incident commander, and next-update time.\n3. Page the required technicians and set the internal communication channel.\n4. Use the public status page only for approved customer-safe updates.\n5. Update the incident timeline with decisions, restoration evidence, and customer messages.\n6. On restoration, close the room and generate a post-incident review from the retained record.",
        "The linked ticket, room timeline, and customer status history agree on impact, restoration time, and next steps.",
        "A major incident must retain decision points, pager acknowledgements, and the final communications record.",
    ),
    _guide(
        "client-360", "Maintain a client 360 profile", "Client operations", "🏢", 20,
        "Use the client profile as the operational source of truth for people, services, devices, contracts, and important notices.",
        "The client profile accurately represents the people, agreements, service links, account notes, and recent operational history.",
        "Confirm you have selected the correct client using the search field above the profile workspace.",
        "1. Review the account banner and acknowledge any critical account notice.\n2. Update contacts, sites, and service preferences as changes are verified.\n3. Review linked services such as managed assets, Microsoft 365, backup, Pax8, and Voice.\n4. Open tickets, documents, subscriptions, contracts, and activity from their respective tabs rather than duplicating notes.\n5. Add an account notice only when it is current, actionable, and has an owner or expiry.",
        "The active profile reflects the client record used by tickets, billing, assets, and communications.",
        "Critical notices require acknowledgement. Profile changes should leave an audit entry with the editing technician.",
    ),
    _guide(
        "client-account-notices", "Create and acknowledge an account notice", "Client operations", "📌", 21,
        "Surface important client-specific instructions at the moment a technician opens the profile or works a related ticket.",
        "A targeted notice is visible, editable, has a review date, and captures acknowledgement when appropriate.",
        "Only create a notice for information that is operationally important and cannot safely live only in a ticket.",
        "1. Open the client profile and choose **Manage account notices**.\n2. Set the title, severity, message, owner, and review or expiry date.\n3. Choose acknowledgement required for critical instructions.\n4. Save, then confirm the preview is clear and concise.\n5. Review and retire notices as the client situation changes.",
        "The notice appears in the client context and, when required, acknowledgement is recorded with the technician and timestamp.",
        "Do not place secrets, unverified accusations, or customer-sensitive personal information in an account notice.",
    ),
    _guide(
        "client-onboarding", "Onboard a new client", "Client operations", "🤝", 22,
        "Create a linked onboarding record that drives the correct parent and child ticket work without losing commercial context.",
        "The client, onboarding blueprint, work tickets, assets, contracts, and handover evidence are connected.",
        "Confirm the signed agreement, primary contacts, sites, service scope, and required start date before beginning.",
        "1. Start **Client Onboarding** and select the client.\n2. Choose a blueprint that matches the service package.\n3. Review the generated parent ticket and child tasks before creating them.\n4. Add required contacts, sites, mailbox, security, asset, and billing details.\n5. Assign work owners and due dates.\n6. Complete each child ticket with validation evidence, then close the parent only after the handover is accepted.",
        "All required child tasks are linked to the onboarding parent and the client profile shows the configured services.",
        "Keep the onboarding parent ticket as the index. Do not replace child-ticket validation with a loose spreadsheet or chat message.",
    ),
    _guide(
        "managed-assets", "Manage an asset and remote support session", "Infrastructure & security", "💻", 30,
        "Verify endpoint ownership and health, then use safe remote actions with a full audit trail.",
        "The asset is correctly linked to its client and the chosen remote action is recorded against the device and related ticket.",
        "Confirm the client, device name, current online state, and whether a user is actively working before taking disruptive action.",
        "1. Open **Managed Assets** and search for the endpoint.\n2. Confirm the client assignment, last-seen time, operating system, and current health signal.\n3. Open the relevant tab for performance, patches, software, security, or audit history.\n4. Start remote support from the device or its linked ticket.\n5. Document customer consent and material actions in the ticket.\n6. Verify the endpoint has checked in after any restart, script, or remediation.",
        "The device reflects the expected health state and the relevant ticket contains the work performed and validation result.",
        "Remote sessions, commands, patches, and assignment changes are retained in the asset audit history.",
    ),
    _guide(
        "backup-operations", "Verify backup protection and a restore", "Infrastructure & security", "💾", 31,
        "Use the Backups workspace to address failures, prove recoverability, and keep billing and client records accurate.",
        "Backup status, alert response, restore evidence, and client mapping are current and auditable.",
        "Confirm the backup provider is connected and the client has a mapped tenant or protected asset.",
        "1. Open **Backups** and review the live ticker, failures, and overdue verification items.\n2. Filter to the affected client or asset.\n3. Review the last successful job and failure reason.\n4. Escalate or remediate the failure using the linked ticket.\n5. Open **Verify** and read **Backup Confidence** together with **Evidence coverage**; an unassessed control is not a pass.\n6. Choose **Simulate recovery**, select the customer, enter the workload, RTO, RPO, protected data and dependencies, then review every evidence blocker. Simulation records a plan only and never starts a provider restore.\n7. Schedule an approved recovery test in an isolated destination, then record the measured duration, integrity result and technician notes.\n8. Confirm the client mapping and billable usage before the recurring billing run.",
        "The latest job state is current, failed protection has an owner, confidence identifies its evidence boundary, and a completed restore has attributable proof of what was recovered and when.",
        "Use the linked ticket for customer impact. Recovery simulations retain targets, assumptions, restore order, evidence counts and blockers with `external_changes: false`. Keep measured restore evidence in the backup record and client documentation; provider engines remain authoritative for backup execution.",
    ),
    _guide(
        "nexus-shield-and-canary", "Operate Nexus Shield and Canary", "Infrastructure & security", "🛡️", 32,
        "Deploy detection controls, investigate alerts, and retain a clear response record without presenting simulated data as live evidence.",
        "Canary coverage, alert ownership, device status, and remediation decisions are visible and auditable.",
        "Confirm the endpoint is actively enrolled in the Nexus agent and that you are operating on the intended client and asset.",
        "1. Open **Nexus Shield** and review active posture alerts.\n2. Use the Canary tab to select an active endpoint and deploy or verify a canary.\n3. When an alert arrives, open the affected asset and linked ticket.\n4. Validate the signal before isolating, remediating, or escalating.\n5. Record the decision, action, and verification result.\n6. Review policy exceptions and expiry dates regularly.",
        "The endpoint shows its intended protection state and every alert has a resolution, owner, or escalation path.",
        "NexusMSP records deployment, alert, approval, and remediation activity. Do not treat an unconnected provider as proof of protection.",
    ),
    _guide(
        "nexus-elevate", "Use Nexus Elevate approval policies", "Infrastructure & security", "🔐", 33,
        "Apply least-privilege approvals to endpoint elevation requests with a clear business justification and expiry.",
        "A request is approved, denied, or escalated according to policy and the exact decision is retained.",
        "Confirm the device is online, the request is associated with a known user or ticket, and the requested action is understood.",
        "1. Open **Nexus Elevate** and select the pending request.\n2. Review requester, endpoint, application, publisher, command, policy match, and justification.\n3. Approve only for the minimum duration and scope required, or deny with a helpful reason.\n4. Link or create a ticket for non-routine work.\n5. Verify completion or expiry, then review any recurrence before creating a permanent policy.",
        "The request record shows a final decision, approver, time limit, justification, and any related ticket.",
        "Treat every elevation as a security event. Permanent allow rules require policy ownership and periodic review.",
    ),
    _guide(
        "configure-mailboxes", "Configure O365 mailboxes and routing", "Platform setup", "📬", 40,
        "Connect the Microsoft 365 mailboxes used for ticket communications, billing, and lead intake with clear ownership for each route.",
        "Each required mailbox is connected, assigned to a purpose, tested, and visible to the technician configuring the service.",
        "Use an approved Microsoft 365 administrator account and know which shared mailbox should handle each workflow.",
        "1. Open **Settings** then **Mailbox & Email**.\n2. Choose **Connect Microsoft 365** for the mailbox.\n3. Complete the Microsoft sign-in and consent only for the selected mailbox.\n4. Assign the mailbox to ticket replies, ticket comments, billing, lead intake, or other required routes.\n5. Save the routing configuration.\n6. Send a controlled test message and confirm it is retained in the relevant NexusMSP history.",
        "Every enabled route has one active mailbox, the save state is visible, and the test appears in the ticket, billing, or lead audit trail.",
        "Mailbox changes are configuration actions. Record any failed test or routing decision in the relevant implementation ticket.",
    ),
    _guide(
        "microsoft-calendar", "Connect a calendar for dispatch", "Platform setup", "🗓️", 41,
        "Connect the approved Microsoft 365 calendar so dispatch can recognise conflicts before an appointment is committed.",
        "Availability information is available to dispatch and appointment conflicts can be reviewed with an auditable override.",
        "Use the technician or shared dispatch calendar approved by your organisation. Confirm you have consent to connect it.",
        "1. Open **Settings** then the calendar connection card.\n2. Select **Connect Microsoft 365 Calendar**.\n3. Complete the account consent and choose the intended calendar.\n4. Save the connection and allow the initial availability sync to finish.\n5. Create a test appointment from a ticket and confirm it appears in the calendar view.\n6. Review a deliberate time conflict to confirm dispatch presents the warning.",
        "The selected calendar is named in Settings, availability appears in dispatch, and a ticket appointment produces an audit entry.",
        "A conflict override must state the reason and remains attached to the ticket appointment record.",
    ),
    _guide(
        "voice-yeastar", "Connect a Yeastar PBX to Voice", "Platform setup", "📞", 42,
        "Link a customer's Yeastar PBX to its client profile, synchronise extensions, and map the billable extension count safely.",
        "The PBX is linked to a client, its connection is tested, extensions are synchronised, and billing mapping is reviewed before automation.",
        "On the customer's P-Series PBX, enable **Integrations > API** and obtain that PBX's base URL or FQDN, Client ID, and Client Secret. Also identify the client owner and the recurring invoice that will receive the billable quantity. A YCM credential is not required.",
        "1. Open **Voice** and choose **Add PBX**.\n2. Search for and select the client.\n3. Enter the PBX base address without an OpenAPI path, then enter the Client ID and Client Secret from **Integrations > API** on that PBX.\n4. Choose the billing policy, agreement mapping, product mapping, and approval threshold.\n5. Choose **Test & link PBX**. NexusMSP verifies the live P-Series system endpoint and discovers extensions before it saves the connection.\n6. Confirm the PBX shows online, then review the Extensions and Billing tabs; exclude non-billable items with a reason.\n7. Enable automated billing only after the first billable count is approved.",
        "The PBX shows online, a successful sync time, the extension list is current, and the linked client profile shows the Voice service indicator.",
        "Connection tests, initial discovery, syncs, exclusions, billing changes, and manual recalculations are retained in Voice activity and history. Duplicate links for the same client and PBX URL are rejected.",
    ),
    _guide(
        "integrations-safely", "Set up an integration safely", "Platform setup", "🧩", 43,
        "Use the same secure, evidence-first method for any third-party connection.",
        "Credentials are stored only in the appropriate integration settings, least privilege is used, and the connection outcome is clear.",
        "Read the provider-specific guide first. Have a dedicated integration account or app registration where the provider supports one.",
        "1. Open **Settings > Integrations** and select the provider.\n2. Read the in-product setup panel before entering a credential.\n3. Use the minimum provider permissions required for the intended sync.\n4. Save the configuration.\n5. Use **Test connection** and inspect the result.\n6. Run a controlled first sync and validate a real item in NexusMSP.\n7. Document the service owner, credential rotation date, and linked client mapping where required.",
        "A success state must include provider evidence or synced data. Saving fields alone is not a verified connection.",
        "Never paste secrets into tickets, chat, documentation, screenshots, or client notes. Use Keeper or the approved secret system.",
    ),
    _guide(
        "invoice-from-ticket", "Create an invoice from ticket work", "Billing & commercial", "💳", 50,
        "Create a complete, client-correct invoice linked to the ticket, with products, time, and audit context retained.",
        "The invoice has a clear name, correct client, linked ticket, reviewed line items, payment terms, and an auditable creation record.",
        "Ensure the ticket record, time entries, products, taxes, and client billing contact are correct before creating the invoice.",
        "1. Open **Invoices** and choose **Create invoice**, or use the ticket billing tools.\n2. Search for the client and related ticket using autocomplete.\n3. Enter an invoice name that explains the purpose of the charge.\n4. Add time, products, or manual items and confirm tax and quantities.\n5. Review the preview, linked ticket, due date, and delivery method.\n6. Save as draft or issue through the approved Xero workflow.\n7. Confirm the invoice and ticket timelines are linked.",
        "The invoice totals are correct, every charge has a clear source, and the related ticket contains the invoice reference.",
        "Invoice creation, edits, issue events, delivery, payments, and credit actions remain in financial and ticket audit history.",
    ),
    _guide(
        "recurring-billing", "Set up recurring billing", "Billing & commercial", "🔁", 51,
        "Create a recurring invoice that is stable, reviewable, and ready to absorb approved usage from linked services.",
        "The schedule, client, items, service agreement, billing rules, and review controls are correct before automated generation.",
        "Confirm the client agreement, billing contact, schedule, product mappings, and approval policy. Review any Pax8, backup, or Voice usage relationship first.",
        "1. Open **Recurring Invoices** and select **Create recurring invoice**.\n2. Search for the client and enter a descriptive name.\n3. Set frequency, next run date, payment terms, and approval mode.\n4. Add fixed products and link eligible usage sources.\n5. Review the generated preview and approval threshold.\n6. Save as draft, then activate only after commercial review.\n7. Inspect the first generated invoice before enabling unattended billing.",
        "The recurring record shows the correct next run, client, agreement, items, and usage source status. The preview matches the commercial expectation.",
        "Quantity changes from integrated services must retain source, previous value, new value, and approval history.",
    ),
    _guide(
        "purchase-order-receiving", "Receive a purchase order and notify the technician", "Billing & commercial", "📦", 52,
        "Receive stock or ticket-linked items without losing ownership, costing, or the technician notification trail.",
        "Line items are received against the correct purchase order, linked ticket items are clearly identified, and the responsible technician is notified.",
        "Confirm the delivery matches the supplier packing slip and the purchase order has the right client or ticket link before receiving stock.",
        "1. Open **Purchase Orders** and select the order.\n2. Check each item quantity, serial number, and condition.\n3. Mark the line as received, partial, or exception.\n4. For ticket-linked lines, verify the intended ticket and technician.\n5. Complete receiving.\n6. Confirm the system notification and ticket note were created under the signed-in receiving technician.",
        "Inventory and PO status are current, and the ticket timeline shows the arrival note for any ticket-linked part.",
        "Receiving preserves who received the item, what was received, relevant serial numbers, and the linked ticket context.",
    ),
    _guide(
        "split-billing", "Split an invoice between customers", "Billing & commercial", "🧾", 53,
        "Allocate invoice portions to more than one payer while retaining the complete commercial relationship and payment history.",
        "Each payer receives the correct allocation, the original work context is retained, and balances reconcile to the source invoice.",
        "Confirm the commercial agreement for each payer, tax treatment, billing contact, and whether each party needs a separate document.",
        "1. Start from the draft invoice and choose the split-billing option.\n2. Add each payer and set their allocation by line item or amount.\n3. Validate that all allocations total the source invoice.\n4. Review generated customer documents and related ticket references.\n5. Issue each payer document through the approved billing route.\n6. Record payments against the appropriate allocation, not only the original work record.",
        "Payer balances equal the original invoice total and each customer can see only their allocated charges.",
        "The allocation history records who created or changed the split, the rationale, and the resulting documents.",
    ),
    _guide(
        "reports-and-evidence", "Generate a report and download evidence", "Reporting & evidence", "📊", 60,
        "Run a report from the central Reports workspace, review the retained result, and download a branded NexusMSP evidence document.",
        "The report has a known scope, generation time, author, retained output, and professional PDF export.",
        "Confirm the report type, intended client or organisation scope, and date or snapshot context before generating it.",
        "1. Open **Reports** and choose the report library item that matches the question.\n2. Select scope and options, then choose **Generate report**.\n3. Review the generated evidence in the reader.\n4. Download PDF only after confirming the title, metrics, sections, and date are correct.\n5. Use scheduled delivery from the same Reports workspace when the output should recur.",
        "The generated report appears in history with the output ID, time, source, and available PDF download. The PDF carries the current Nexus branding.",
        "Report runs and scheduled output are retained as point-in-time evidence. Do not edit a generated output to change historical facts.",
        "[Quarterly business reviews](/help/qbr-reviews) and [Recurring billing](/help/recurring-billing).",
    ),
    _guide(
        "qbr-reviews", "Prepare and deliver a QBR", "Reporting & evidence", "📈", 61,
        "Create a client-facing Quarterly Business Review based on verified service, asset, backup, and commercial information.",
        "The QBR is client-specific, reviewed by an accountable technician, and delivered as a branded evidence document.",
        "Confirm the correct client, review quarter, service data, outstanding risks, and the commercial information approved for client presentation.",
        "1. Open **Reports** or the QBR workflow and select the client and quarter.\n2. Generate the draft.\n3. Review the executive summary, key wins, incident narrative, health metrics, risks, and next-quarter focus.\n4. Replace generic language with client-specific context where required.\n5. Save the final review and download the branded PDF.\n6. Attach or link the delivered review to the client record and meeting ticket.",
        "The final QBR has the correct client, quarter, author, metrics, recommendations, and a professional PDF output.",
        "Keep the QBR and meeting follow-up in the client history. Do not claim provider evidence that has not been synchronised.",
    ),
    _guide(
        "compliance-evidence", "Produce compliance evidence", "Reporting & evidence", "✅", 62,
        "Create evidence that clearly separates verified controls, exceptions, assumptions, and follow-up actions.",
        "A compliance report is scoped, traceable to its evidence source, and does not present unavailable telemetry as compliant.",
        "Confirm which framework, client, period, and evidence sources are approved for the assessment.",
        "1. Open **Compliance** and select the assessment or report.\n2. Review evidence-source status before generation.\n3. Investigate exceptions and assign owners before marking a control ready.\n4. Generate the report in the central Reports workspace.\n5. Include limitations or unavailable evidence in the narrative.\n6. Link resulting actions to tickets, change records, or client plans.",
        "The output identifies verified evidence, open exceptions, owner, due date, and next review. Missing data is clearly labelled.",
        "Compliance outputs and approvals remain in the audit trail; do not use demo or placeholder data as audit evidence.",
    ),
    _guide(
        "settings-and-branding", "Manage settings and document branding", "Platform setup", "⚙️", 70,
        "Use one Settings hub for organisation-level configuration while keeping personal preferences in My Workspace.",
        "Platform settings, integrations, email routes, branding, notification policies, and document presentation have clear owners.",
        "Confirm you are authorised to change organisation settings and have an approved change reference where required.",
        "1. Open **Settings** and select the relevant category.\n2. Read the in-product setup guidance before changing a connection or security setting.\n3. Save one related change set at a time.\n4. Test the change using the provided validation action.\n5. Review audit history and update the relevant implementation ticket.\n6. Use **My Workspace** only for technician-specific profile, signature, notification, and schedule preferences.",
        "The saved setting is visible after refresh and the associated test produces an expected result or clear error.",
        "Organisation settings should have a service owner, review date, and change record where they impact clients or billing.",
    ),
]


def _reference_guide(slug: str, title: str, category: str, icon: str, order: int, summary: str):
    """Keep established deep links useful while presenting the new guide standard."""
    return _guide(
        slug,
        title,
        category,
        icon,
        order,
        summary,
        "The technician can complete the task with a clear scope, validation, and audit trail.",
        "Confirm client scope, access, and change approval before making a production change.",
        "1. Open the relevant NexusMSP workspace.\n2. Review the current state and linked client or asset.\n3. Make one controlled change at a time.\n4. Use the workspace validation action.\n5. Record the outcome and any follow-up work.",
        "The result is visible after refresh, the requested state is correct, and any exception has a clear next action.",
        "Retain the linked ticket, activity event, and source evidence so another technician can understand what changed.",
    )


# Existing in-product links remain available, but now resolve to concise technician
# procedures instead of exposing release notes or implementation detail.
CURATED_ARTICLES.extend([
    _reference_guide("daily-noc-sign-off", "Complete the Daily NOC sign-off", "Start here", "☀️", 4, "Use Nexus Daily on Dashboard to review live operational evidence, assign exceptions, and retain an attributable shift handoff."),
    _reference_guide("team-hub", "Manage your team", "Platform setup", "👥", 21, "Invite technicians, manage roles, and keep team access and profiles current."),
    _reference_guide("settings-hub", "Use the Settings hub", "Platform setup", "⚙️", 22, "Find organisation-level configuration without mixing it with personal workspace preferences."),
    _reference_guide("m365-command-center", "Operate Microsoft 365 services", "Platform setup", "☁️", 23, "Review Microsoft 365 service data and use approved actions with the correct client context."),
    _reference_guide("client-insights-hub", "Review client insights", "Client operations", "🔎", 31, "Use client signals and commercial context to identify the next meaningful client action."),
    _reference_guide("tactical-ticket-console-v2", "Work a service ticket", "Service desk", "🎫", 32, "Use the shared ticket controls, timelines, communication, linked assets, and billing context consistently."),
    _reference_guide("auto-ops-hub", "Use AI Operations safely", "Infrastructure & security", "✨", 41, "Review AI suggestions, automations, and self-healing proposals with approvals and evidence in place."),
    _reference_guide("maintenance-windows", "Plan a maintenance window", "Infrastructure & security", "🛠️", 42, "Schedule approved maintenance, communicate impact, and retain the execution record."),
    _reference_guide("device-smart-bar", "Use device smart actions", "Infrastructure & security", "🖥️", 43, "Use device context and remote actions without leaving the audit trail or losing ticket linkage."),
    _reference_guide("credentials-hub", "Use external credential systems", "Platform setup", "🔐", 44, "Keep secrets in Keeper, Hudu, or Microsoft rather than duplicating them in NexusMSP."),
    _reference_guide("invoice-studio", "Choose a document template", "Billing & commercial", "🧾", 54, "Choose and preview a branded client document template before it is used for invoices or statements."),
    _reference_guide("email-intake-and-leads", "Configure email intake and leads", "Platform setup", "✉️", 45, "Connect approved Microsoft 365 mailboxes, map their purpose, and confirm inbound correspondence creates the intended lead or ticket record."),
    _reference_guide("secure-integration-setup", "Connect an integration securely", "Platform setup", "🧩", 46, "Use a least-privilege integration account, test the connection, and record the service owner without exposing a secret."),
    _guide(
        "voice-yeastar-pbx-onboarding", "Onboard a Yeastar PBX", "Platform setup", "☎️", 47,
        "Link the correct client directly to its Yeastar P-Series PBX, validate the live API, discover extensions, and approve billable quantities.",
        "The PBX is online in Voice, linked to one client, shows the expected extensions, and has a reviewed product and agreement mapping.",
        "On the customer PBX, open **Integrations > API**, enable API access, and copy the PBX base URL or FQDN, Client ID, and Client Secret. A Yeastar Central Management credential is not required.",
        "1. Open **Voice** and choose **Add PBX**.\n2. Search for and select the client that owns the PBX.\n3. Enter a recognisable PBX name and the base PBX URL only, without an `/openapi` path.\n4. Enter the Client ID and Client Secret copied from **Integrations > API** on that PBX.\n5. Choose the billing policy, agreement mapping, recurring product, sync schedule, and approval threshold.\n6. Select **Test & link PBX**. NexusMSP tests the live system endpoint and discovers extensions before saving anything.\n7. Confirm the PBX is online, then review **Extensions**, **Billing**, and **Sync history**. Exclude non-billable extensions with a reason.\n8. Enable automatic billing only after the first calculated quantity has been reviewed.",
        "The Voice summary shows one connected PBX for the client, the online state and last test are current, and extension and billable counts match the PBX. Run **Test** again to confirm live access.",
        "Connection tests, sync attempts, extension overrides, quantity changes, approvals, and billing recalculations remain attached to the client PBX. Store the secret only in the PBX setup form—never in a ticket, note, chat, or screenshot.",
    ),
    _reference_guide("nexus-elevate-setup", "Set up Nexus Elevate", "Infrastructure & security", "🛡️", 48, "Configure elevation controls, approvals, and technician notifications before enabling client requests."),
    _reference_guide("nexus-shield-canary", "Deploy Nexus Shield Canary", "Infrastructure & security", "🛡️", 49, "Deploy canary protection to an active managed endpoint, verify alerting, and retain the deployment evidence."),
])

CURATED_ARTICLES.extend([
    _workspace_guide(
        "nexus-shield-xdr",
        "Use Nexus Shield XDR and Security Confidence",
        "Infrastructure & security",
        "🛡️",
        5,
        "Assess cyber resilience across endpoint, identity, email, cloud, human, DNS, and recovery evidence without mistaking missing telemetry for a healthy result.",
        "1. Open **Nexus Shield > Shield XDR**.\n"
        "2. Read **Security Confidence** together with **Evidence Coverage**. Confidence scores only assessed domains; coverage shows how much Nexus can currently prove.\n"
        "3. Open each domain card and validate the authoritative endpoint, Microsoft, email, DNS, or backup evidence.\n"
        "4. Review correlated cases. Confirm that the customer and subject identifiers genuinely refer to the same person, endpoint, or service.\n"
        "5. Select **Investigate**, review the evidence snapshot, then choose **Open investigation**. Nexus creates a durable case, assigns the signed-in technician, and retains the evidence that was visible when the case opened.\n"
        "6. Use the **XDR investigation desk** to change the case through Investigating, Contained, Recovering, Resolved, or False positive. Every change requires a decision note.\n"
        "7. Preserve evidence before containment and open the linked response queue or remediation playbook. Record impact, client communication, approvals, and actions in the owning workflow.\n"
        "8. Complete Security Missions from highest impact to lowest, then refresh the originating connector.\n"
        "9. Open the evidence graph to review persisted relationships and likely exposure paths.\n"
        "10. Recheck confidence and coverage after the source systems synchronise, then use Reports for an executive outcome summary only after validating the underlying evidence.",
        "Every scored domain has current source evidence, unknown domains remain marked Not assessed, correlated cases have been validated by a technician, and containment or accepted risk is approval-backed and auditable.",
        related="[Open Nexus Shield XDR](/nexus-shield?tab=xdr), [Review the response queue](/nexus-shield?tab=response), [Open Security Graph](/security-graph), [Open remediation playbooks](/remediation-playbooks), and [Review Reports](/reports).",
        before="- Confirm connector health and the last successful sync before trusting a score.\n"
        "- Never interpret 100% confidence with partial evidence coverage as complete security.\n"
        "- Validate the client, identity, and endpoint relationship before containment.\n"
        "- Require approval for account disablement, session revocation, device isolation, blocking, or customer communication.",
        audit="- Confidence calculations retain observed counts, gaps, routes, and the evidence boundary for every domain.\n"
        "- Missing connectors produce Not assessed, never a synthetic pass.\n"
        "- Correlation uses persisted client and subject identifiers and does not claim causation.\n"
        "- Opening an investigation snapshots the observed evidence; case status changes retain the signed-in technician, timestamp, and required decision note.\n"
        "- Closed and false-positive cases remain in the investigation ledger and are not silently deleted.\n"
        "- Suggested actions do not execute from the confidence view; response remains approval-gated in the owning workflow.\n"
        "- Incident, ticket, playbook, communication, and change evidence remain attributable to the signed-in technician.",
        at_a_glance="- **Expected time:** 5-15 minutes for triage\n"
        "- **Risk:** Read-only until an owning response workflow is opened\n"
        "- **Required access:** Nexus Shield plus access to the linked source workspaces\n"
        "- **Evidence location:** Shield XDR, source connector, Security Graph, response playbook, incident ticket, and Audit Trail",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| A domain says Not assessed | Connector status, verified source, and last sync | Connect or repair the authoritative provider; do not enter a manual pass |\n"
        "| Confidence looks high but coverage is low | Assessed-domain count | Treat the score as narrow evidence, then close the missing coverage gaps |\n"
        "| Two alerts are not correlated | Client ID and subject identifier | Correct the source association only when verified; do not force a relationship |\n"
        "| A case combines unrelated evidence | Persisted user, endpoint, domain, and client identifiers | Split investigation in the source workflows and correct the bad association |\n"
        "| A mission remains after remediation | Source refresh and evidence timestamp | Resynchronise or rerun the agent assessment before closing it |",
        rollback="Shield XDR is read-only. If a linked containment or remediation action was incorrect, stop further actions, use the owning provider or playbook rollback, validate restored identity and endpoint state, notify affected parties when required, and retain the correction in the incident and audit history.",
        screenshots=[],
    ),
])

CURATED_ARTICLES.extend([
    _workspace_guide(
        "ambient-intelligence-and-motion",
        "Configure Ambient Intelligence and motion",
        "Personal workspace",
        "✨",
        4,
        "Understand Nexus semantic motion, choose the right motion level, and interpret quiet surface signals without relying on animation or colour alone.",
        "1. Open **My Settings > Display & workspace**.\n"
        "2. Choose **System preference** to follow the operating system's Reduced Motion setting, **Full motion** for purposeful ambient state, **Minimal motion** for short fades without ambient animation, or **Static** to remove non-essential motion.\n"
        "3. Save the workspace appearance so the preference follows your Nexus profile.\n"
        "4. Read every ambient surface together with its text, icon, count, or badge: blue means work is active, green means the source reports healthy or successful, amber means review, red means immediate attention, and violet means AI context or a recommendation.\n"
        "5. In Mission Control, select the surfaced panel or workstream to open its exact records. Motion is only a quiet state cue; it is never the evidence.\n"
        "6. In Nexus AI, a blue ambient line means a request is processing and violet means a recommendation is available. Validate the cited sources before acting.\n"
        "7. In Universal Inspector, compare source-reported health with evidence confidence. A red or amber surface can still have high confidence because Nexus strongly trusts the degraded evidence.\n"
        "8. Open **Nexus Quick Dock > Focus mode** when a ticket, quote, investigation, or change needs uninterrupted attention. Nexus removes sidebar navigation while leaving the active workflow unchanged.\n"
        "9. Choose **Exit focus mode**, press Escape, or navigate to another workspace to restore normal navigation.\n"
        "10. If animation is uncomfortable, distracting, or expensive on the device, choose Minimal or Static. Nexus retains every label, status, action, and source without animation.",
        "The chosen preference persists, operating-system Reduced Motion is honoured, and all operational states remain understandable when animation is disabled.",
        related="[Open My Settings](/my-settings), [Open Mission Control](/), [Review Nexus Fabric](/clients), and [Open Accessibility guidance](/documentation-hub?tab=help).",
        before="- Motion never replaces status text, icons, counts, evidence, or alerts.\n- Sounds remain off unless a future explicitly opt-in setting is approved.\n- Decorative effects such as particles, rain, fireworks, and background motion are not enabled globally.\n- Verify the owning record before acting on any ambient cue.",
        audit="- Display and motion preferences are stored with the technician profile and locally for immediate application.\n- Semantic colour meanings are centrally defined.\n- Minimal, Static, and operating-system Reduced Motion disable ambient animation.\n- Ambient Intelligence does not create alerts, recommendations, or health claims; it only reflects existing state.",
        at_a_glance="- **Expected time:** 1-2 minutes\n- **Risk:** None; display preference only\n- **Required access:** Signed-in technician\n- **Evidence location:** Owning operational record, Mission Control drill-down, Nexus AI citations, or Universal Inspector",
        troubleshooting="| Symptom | Check | Safe response |\n|---|---|---|\n| Motion still appears | Saved motion level and operating-system preference | Select Static, save, then refresh once |\n| A colour is unclear | Text label, badge, icon, and source record | Ignore colour and use the labelled state |\n| Surface is glowing but no item appears | Data refresh and owning workspace | Refresh the source; do not infer an issue from glow alone |\n| Animation affects performance | Browser graphics settings and motion level | Select Minimal or Static |",
        rollback="Return to My Settings and select System preference, Minimal motion, or Static. This changes presentation only and does not alter operational records.",
        screenshots=[],
    ),
])

CURATED_ARTICLES.extend([
    _workspace_guide(
        "nexus-ideas",
        "Capture and review ideas in Nexus Foundation",
        "Platform administration",
        "💡",
        4,
        "Capture product opportunities without confusing an idea with approved roadmap work, then assess each one against the four Nexus value principles.",
        "1. Open **Nexus Control Plane > Foundation** and locate **Nexus Ideas**.\n"
        "2. Search the retained catalog before adding an idea so the same opportunity is not captured twice.\n"
        "3. Select **Capture idea** and enter an outcome-focused title, category, and explanation of why it matters.\n"
        "4. Select at least one value principle: save time, reduce stress, increase confidence, or create opportunity.\n"
        "5. Save the idea. It begins as **Captured** and is not automatically approved, scheduled, or released.\n"
        "6. During product review, add evidence, dependencies, an owner, and a decision note before moving it to Reviewing or Validated.\n"
        "7. Promote an idea only when it has a defined roadmap dependency and release gate. Park or reject it with a retained reason instead of deleting product history.",
        "The idea is retained once, passes at least one Nexus value principle, and its state accurately distinguishes capture, review, validation, promotion, parking, or rejection.",
        related="[Open Nexus Foundation](/control-plane?module=foundation), [Review Production Readiness](/production-readiness), and [Review Audit Trail](/audit-trail).",
        before="- Search for an existing idea first.\n- Describe the user outcome, not just a visual effect or implementation technology.\n- Captured does not mean approved.\n- Do not promise a delivery date from the idea registry.",
        audit="- Idea capture and lifecycle changes emit durable Nexus Foundation events.\n- Rejected and parked ideas remain retained.\n- Roadmap promotion remains a separate deliberate product decision.\n- The four selected value principles are stored with the idea.",
        at_a_glance="- **Expected time:** 2-5 minutes\n- **Risk:** Low; no product or customer workflow is changed\n- **Required access:** Nexus Foundation product-administration permission\n- **Evidence location:** Nexus Ideas, Product Roadmap, platform events, and Audit Trail",
        troubleshooting="| Symptom | Check | Safe response |\n|---|---|---|\n| Save is rejected | Title, summary, and value principles | Select at least one value principle and provide a clear outcome |\n| Similar idea already exists | Idea number, title, category, and search terms | Update the existing idea rather than duplicating it |\n| Idea is mistaken for committed work | Current status and roadmap presence | Keep it Captured or Reviewing until formal promotion |\n| Permission denied | Product-administration role | Ask an authorised administrator to capture or revise it |",
        rollback="Idea capture does not alter product behavior. If an idea was entered incorrectly, retain it and mark it Rejected or Parked with the correction reason rather than deleting the decision history.",
        screenshots=[],
    ),
])

CURATED_ARTICLES.extend([
    _workspace_guide(
        "nexus-fabric",
        "Trace client relationships with Nexus Fabric",
        "Client operations",
        "🕸️",
        5,
        "Follow verified relationships between a client, its people, technology, services, commercial records, work, integrations, and documentation, then retrieve source-backed operational memory without guessing what happened before.",
        "1. Open **Clients**, select the client, and choose **Command > Nexus Fabric**.\n"
        "2. Review the object, relationship, operational-path, coverage, and attention totals.\n"
        "3. Use the relationship constellation to focus on people, devices, services, contracts, tickets, projects, invoices, documentation, or integrations.\n"
        "4. Search by name, status, provider ID, source collection, or record ID.\n"
        "5. Select an object to inspect every directly connected record.\n"
        "6. Review **Object story**. Health is the source-reported state; evidence confidence shows how much canonical, relationship, and timeline evidence supports that state. High confidence does not mean healthy.\n"
        "7. Choose **Open universal inspector** when you need to keep the object beside your current workflow. The inspector carries the same health, trust, impact, timeline, relationship, and source contract across Nexus.\n"
        "8. Select a related object inside the inspector to follow the relationship without opening another workspace. Choose **Open owning workspace** only when you need to change or fully validate the source record.\n"
        "9. Review recorded business impact. If Nexus says impact is unknown, add impact in the owning workflow rather than guessing from the relationship graph.\n"
        "10. Follow the recent object timeline to see the selected record's own history. Nearby events are chronological evidence and do not prove causation.\n"
        "11. Read the relationship evidence line before relying on a link. Nexus shows the source field or provider mapping used to create it.\n"
        "12. Select a related object to continue tracing the thread, or choose **Open in owning workspace** to validate the live source record.\n"
        "13. In **Nexus operational memory**, describe the prior issue, device, technician, category, or known fix you remember. Use short evidence terms such as `VPN Fortinet` or `printer closed ticket`.\n"
        "14. Read **Why Nexus recalled this** before relying on a result. Open the owning record to validate the full service history, resolution, or commercial context.\n"
        "15. Use **AI problem radius** to inspect the direct and extended records around an attention item. Treat these as records worth checking, not proof that one caused another.\n"
        "16. Read the five decision prompts separately: observed state, causal evidence, forecast, recommended validation, and currently approved Nexus action. Unknown answers deliberately remain unknown.\n"
        "17. Review **Memory Crystal** to understand knowledge readiness. Its score comes from relationship coverage, source diversity, operational memory, and linked documentation; it is not a client-health score.\n"
        "18. Review **Verified operational threads** for cross-object relationships such as a ticket concerning a device, a service governed by a contract, or an invoice billing a ticket.\n"
        "19. When an important business reason is not represented by an existing source field, an authorised administrator may choose **Record context**. Select two canonical objects and record the purpose, business process, requester, approval evidence, and decision record.\n"
        "20. Record context only for an already approved relationship. Nexus stores it as an auditable source record and rebuilds the fabric; it is not a free-form graph-only link.\n"
        "21. If the fabric is missing or stale, ask an administrator to choose **Refresh fabric**. The rebuild derives a new index from source records without renaming or deleting them.\n"
        "22. Correct a wrong or missing relationship in its owning source record, then refresh the fabric.",
        "The selected object opens in the correct owning workspace, every relationship and recalled memory used for a decision shows source evidence, and any corrected source relationship appears after the administrator refreshes the index.",
        related="[Open Clients](/clients), [Review Nexus Foundation](/control-plane?module=foundation), [Open the operational timeline](/client-insights?tab=client-timeline), and [Review Audit Trail](/audit-trail).",
        before="- Confirm you have selected the correct client profile.\n"
        "- Treat Nexus Fabric as a read model; the device, ticket, contract, invoice, provider, or document remains the authoritative source.\n"
        "- Do not treat an empty domain or missing line as proof that the relationship does not exist outside Nexus.\n"
        "- Only administrators with the platform-core rebuild permission can refresh the full canonical index.",
        audit="- Every object retains its source collection and native source ID.\n"
        "- Every relationship retains the exact field or provider mapping used as evidence.\n"
        "- Nexus does not infer missing links or generate synthetic relationships.\n"
        "- Operational memory retains the source record, relationship evidence, confidence label, and reason it was recalled; it does not invent a root cause or resolution.\n"
        "- Problem radius is a two-hop evidence view. It does not assert technical impact, business impact, or causation without a recorded source.\n"
        "- Memory Crystal is a transparent readiness calculation and never substitutes for client health, risk, or compliance evidence.\n"
        "- Approved context retains who requested and recorded it, its approval evidence, business purpose, decision reference, and timestamp.\n"
        "- Rebuilds are retained as platform events and Audit Trail activity with actor, timestamp, counts, integrity state, and correlation ID.",
        at_a_glance="- **Expected time:** 2-10 minutes for a relationship trace\n"
        "- **Risk:** Read-only; a fabric refresh rebuilds only the derived index\n"
        "- **Required access:** Client scope; administrator permission for Refresh fabric\n"
        "- **Evidence location:** Owning source record, Nexus Core index, client operational timeline, and Audit Trail",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| Fabric has not been indexed | Nexus Foundation status and last rebuild | Ask an administrator to choose **Build verified fabric** |\n"
        "| An expected object is missing | Client ID and ownership on the source record | Correct the source record, then refresh the fabric |\n"
        "| A relationship is wrong | The evidence line and named source field | Correct that source field; never create a manual graph-only link |\n"
        "| Relationship depth is low | Cross-object IDs such as device, contract, ticket, project, or service mappings | Add the missing reference in the owning workflow and rebuild |\n"
        "| Open in owning workspace goes to an empty result | Native source ID and source record lifecycle | Confirm the record still exists; retain an audit note before archival correction |\n"
        "| Refresh is denied | Role and `platform.core.rebuild` permission | Use an authorised administrator; do not bypass the action policy |",
        rollback="Nexus Fabric is read-only. A refresh replaces only the derived canonical index and does not mutate source collections. If a refresh exposes an incorrect relationship, preserve the evidence, correct the owning source record, and rebuild again rather than editing or deleting graph data directly.",
        screenshots=[],
    ),
])

CURATED_ARTICLES.extend([
    _workspace_guide(
        "nexus-autopilot",
        "Configure and review Nexus Autopilot",
        "Automation & intelligence",
        "🧭",
        3,
        "Set a permission-based autonomy boundary, review live readiness gates, and simulate evidence-backed work without giving AI unrestricted access.",
        "1. Open **AI Operations > Autopilot**.\n"
        "2. Read the **Autonomy ladder** from Level 0 to Level 4. The configured level is intent; the effective level is the lower level allowed by live readiness.\n"
        "3. Select **Policy** and keep Autopilot disabled while you choose an explicit client scope, approved action allow-list, confidence threshold, and maximum actions per run.\n"
        "4. Start at **Level 0 — Observe**. Select an operational candidate and choose **Simulate plan**.\n"
        "5. Confirm the source evidence, client, endpoint, confidence tier, proposed action, before/after plan, rollback, blockers, and approval path.\n"
        "6. Resolve every blocker. A trusted Nexus Agent, linked ticket, approved workflow, simulation evidence, and maintenance controls become mandatory as the level rises.\n"
        "7. Enable only the lowest level that meets the business need. Nexus caps the effective level when a readiness gate is missing.\n"
        "8. Keep protected security, identity, billing, certificate, and containment actions human-approved. This safeguard cannot be disabled in the policy form.\n"
        "9. Use **Kill switch** whenever scope, connector behaviour, evidence, or an active incident is unexpected. Record a decision reason.\n"
        "10. Resume only after reviewing the ladder. Nexus will refuse to resume when Level 1 readiness is not satisfied.",
        "The header shows the expected effective level, configured intent is not above the highest ready level unless visibly capped, simulations state **No changes executed**, and the policy decision appears in Recent decisions and the Black Box.",
        related="[Open AI Operations](/auto-ops?tab=autopilot), [Review Automation Studio](/workflow-automation), [Open Change Management](/change-management), [Plan maintenance windows](/maintenance-scheduler), and [Review the Audit Trail](/audit-trail).",
        before="- Confirm the technician is authorised to manage automation policy for the selected clients.\n"
        "- Confirm at least one Nexus Agent endpoint has an issued identity and acknowledged policy before considering Level 1.\n"
        "- Approve and simulate the owning workflow before considering Level 2.\n"
        "- Record maintenance controls and tested rollback evidence before considering Level 3.\n"
        "- Treat Level 4 as bounded overnight orchestration, not unrestricted autonomous administration.",
        audit="- Policy changes record configured and effective levels, selected client count, action count, technician, time, and correlation ID.\n"
        "- Simulations retain the candidate, source evidence, confidence, policy snapshot, blockers, before/after plan, rollback, and `will_execute: false`.\n"
        "- Kill-switch and resume decisions require reasons and publish durable Autopilot events.\n"
        "- Live changes do not execute from the Autopilot screen; eligible work must enter the approved Nexus Automation runtime and its connector-specific controls.\n"
        "- Protected categories always require a human decision regardless of the configured level.",
        at_a_glance="- **Expected time:** 10-20 minutes for initial policy and simulation review\n"
        "- **Risk:** None during simulation; live risk remains with the approved runtime action\n"
        "- **Required access:** Autopilot simulation access; policy management requires an automation manager or administrator\n"
        "- **Evidence location:** Autopilot Recent decisions, simulation record, workflow runtime, linked ticket, Change Management, and Black Box",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| Effective level stays at 0 | Enabled state, paused state, client scope, trusted agent, and action allow-list | Satisfy the first failed readiness gate; do not bypass it |\n"
        "| Configured level is higher than effective | The first level marked Attention in the ladder | Complete its missing gates or intentionally lower the configured level |\n"
        "| Candidate simulation is blocked | Client scope, action allow-list, confidence, ticket link, endpoint trust, and simulation-source marker | Correct the source record or return the work to a technician |\n"
        "| Resume is refused | Level 1 readiness and configured level | Review policy, trusted agent identity, and client scope before retrying |\n"
        "| Candidate does not appear | Source queue status and current need for review | Refresh the owning AI Resolution or Self-Healing evidence; Nexus does not fabricate queue items |\n"
        "| Protected action looks eligible | Category, approval path, and policy snapshot | Stop and escalate; protected work must remain human-approved |",
        rollback="Use **Kill switch** first. This immediately returns the effective boundary to Level 0 while preserving evidence. Pause or cancel live work through its owning workflow or maintenance window, apply connector-specific rollback from the recorded checkpoint, validate client state, and retain the correction in the linked ticket and change.",
        screenshots=[],
    ),
])

CURATED_ARTICLES.extend([
    _workspace_guide(
        "ceo-mode",
        "Use CEO Mode and the AI Board Meeting",
        "Billing & commercial",
        "📈",
        2,
        "Review business performance, customer resilience, aggregate capacity, cash outlook, and owner decisions without mixing operational noise into the executive view.",
        "1. Open **Executive > CEO Mode**.\n"
        "2. Read the six headline tiles. **Contract MRR** is agreement-backed; **Contribution** remains Not assessed until explicit direct costs exist; **Cash outlook** is receivables less open purchase commitments, not a bank balance.\n"
        "3. Read **Owner pulse** and open the first decision only after confirming its source and evidence label.\n"
        "4. Follow **How the business is moving** from contract revenue to recorded direct costs, service contribution, and the 30-day cash outlook.\n"
        "5. Review **What needs an owner**. Each item states the source, evidence, decision, and source-workspace link.\n"
        "6. Review **Service burden outliers**. Nexus compares each client's share of contract MRR with its share of tickets, after-hours tickets, and recorded service time. This is a commercial-fit signal, not an accounting profit claim.\n"
        "7. Review **Portfolio resilience** and open a client only when a health score, evidence-coverage percentage, or service pattern requires action.\n"
        "8. Read **Team capacity** as aggregate time coverage only. CEO Mode deliberately does not expose technician location, breaks, or live movement.\n"
        "9. Review **Evidence confidence** before using any figure externally. Correct missing costs, health sources, time entries, invoices, or purchase-order data in the owning workspace.\n"
        "10. Select **MSP Simulator** to model a client loss, pricing change, new monthly cost, and optional cash reserve. Confirm the result says no operational changes were made.\n"
        "11. Select **Board briefing**, review wins, risks, decisions, and outlook, then choose **Save board snapshot** to retain the reviewed point-in-time brief.",
        "The figures reconcile to their source workspaces, unavailable accounting inputs remain clearly labelled, the simulator states `will_execute: false`, and a saved board briefing appears as the latest retained snapshot with actor and time.",
        related="[Open CEO Mode](/executive), [Review Billing & Finance](/billing-dashboard), [Open Financial Analytics](/financial-analytics), [Review Client Health](/client-insights?tab=client-health), [Open Contracts](/contracts), and [Review the Audit Trail](/audit-trail).",
        before="- CEO Mode is cross-client commercial information. Use an administrator or explicitly authorised owner role with global client scope.\n"
        "- Reconcile invoices, contracts, purchase orders, and client mappings before relying on the briefing.\n"
        "- Record direct unit, wholesale, or internal costs before describing service contribution as profit.\n"
        "- Treat the simulator as a planning aid; obtain accounting and legal review for material business decisions.\n"
        "- Discuss aggregate capacity with the team as a planning input, never as individual surveillance.",
        audit="- CEO Mode reads existing contract, invoice, purchase-order, time, health, project, and approval evidence; it does not edit those records.\n"
        "- Scenario simulations retain their inputs, assumptions, result, actor, time, correlation ID, and `will_execute: false` state.\n"
        "- Board snapshots retain the source-quality statement that existed when the owner saved the briefing.\n"
        "- Scenario and board-snapshot events are published to the durable Nexus event ledger.\n"
        "- Source corrections remain in their owning billing, contract, project, team, client, or health workflow.",
        at_a_glance="- **Expected time:** 10-20 minutes for weekly review; 20-40 minutes for a monthly board snapshot\n"
        "- **Risk:** Low; CEO Mode is read-only except for retained simulations and board snapshots\n"
        "- **Required access:** Executive intelligence permission and global client scope\n"
        "- **Evidence location:** CEO Mode evidence-confidence panel, source workspace, saved board snapshot, scenario history, and Audit Trail",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| Contribution says Not assessed | Contract lines, subscriptions, and time entries for explicit cost fields | Add verified cost data at the source; do not estimate it in a ticket note |\n"
        "| Client health is partial | Evidence coverage and missing health sources | Connect or refresh the relevant agent/provider, then recalculate health |\n"
        "| Capacity looks unexpectedly low | Time-entry date, duration, technician mapping, and active service-team roles | Correct missing time evidence; do not infer that a technician was idle |\n"
        "| Cash outlook differs from the bank | Open invoices, due dates, purchase commitments, tax, and bank feeds | Treat the tile as an operational outlook and reconcile in the accounting platform |\n"
        "| A service-burden finding looks wrong | Contract MRR, ticket client, ticket time, and after-hours timestamp | Correct ownership at the source and refresh CEO Mode |\n"
        "| Access is denied | Executive action permission and global client scope | Ask an administrator to grant the owner role deliberately; do not broaden technician scope |",
        rollback="CEO Mode does not modify contracts, invoices, clients, projects, or team records. If a saved snapshot used incorrect evidence, correct the source, refresh CEO Mode, save a replacement snapshot, and retain a note explaining why the earlier briefing was superseded. A scenario has no operational rollback because it never executes.",
        screenshots=[],
    ),
])

CURATED_ARTICLES.extend([
    _workspace_guide(
        "asset-story",
        "Build and use a connected Asset Story",
        "Infrastructure & security",
        "📚",
        35,
        "Connect a managed endpoint to its canonical inventory, procurement, warranty, commercial and service evidence so technicians can understand the asset without searching disconnected workspaces.",
        "1. Open **Managed Assets**, search for the endpoint, and open its profile.\n"
        "2. Select **Asset Story**.\n"
        "3. Check the connection statement. **Matched by device ID** is canonical. A serial-number match must be confirmed before Nexus writes the relationship.\n"
        "4. If no inventory record exists, select **Connect lifecycle record**. Record the verified purchase date, historical purchase cost, supplier, PO number, warranty end, useful life and the business reason for purchase. Leave unknown values blank.\n"
        "5. Review **Lifecycle stage**, **Asset age**, **Warranty**, and **Evidence coverage**. Missing means Nexus could not find attributable source evidence; it does not mean the condition is healthy or not applicable.\n"
        "6. Read **Replacement decision** and every Explain Why reason. Nexus uses the recorded purchase date, useful life, warranty, endpoint status, capacity pressure, alerts and recent ticket history. It does not treat historical cost as a current replacement quote.\n"
        "7. Review **Why it was purchased**, **Custody & location**, and **Service footprint**. Correct inaccurate ownership or purchase evidence in the inventory, PO, quote, ticket or device source record.\n"
        "8. Follow **Connected history** to the owning PO, quote, ticket, invoice or endpoint record. Only directly attributable records are included.\n"
        "9. Review **Commercial links** for asset-locked contract inclusions and directly linked invoices. Client ownership alone is not enough to claim a commercial relationship.\n"
        "10. If replacement planning is required, open **Refresh planner**, obtain or link a current quote, record the decision on the ticket/project, and retain disposal or replacement history against the same canonical asset.",
        "The endpoint is connected to one canonical Inventory Asset, ownership and lifecycle values match their source records, missing evidence remains labelled, replacement guidance is explainable, and the approved outcome is retained on the related ticket, project, quote, PO, contract or disposal record.",
        related="[Open Managed Assets](/devices), [Open Inventory Assets](/assets), [Review Lifecycle & Warranty](/asset-lifecycle), [Open Refresh Planner](/procurement-planner), [Review Purchase Orders](/purchase-orders), and [Open Contracts](/contracts).",
        before="- Confirm the endpoint identity, serial number, client, assigned user and location before linking inventory.\n"
        "- Use supplier documents, an accepted quote, a PO, warranty portal or invoice as commercial evidence. Do not copy an estimate into the purchase-cost field.\n"
        "- Search Inventory Assets before creating a record to avoid duplicates. A serial match requires deliberate confirmation.\n"
        "- Obtain client and internal approval before ordering, replacing, decommissioning or disposing of equipment.\n"
        "- Never store passwords or recovery secrets in the purchase-reason or lifecycle notes. Link to the approved external vault reference instead.",
        audit="- Creating or confirming an Asset Story records the signed-in technician, time, client, endpoint, canonical asset and connection method.\n"
        "- `asset.story.connected` is published to the durable Nexus event ledger.\n"
        "- Inventory lifecycle history retains stage changes, endpoint connection, replacement and disposal evidence.\n"
        "- Connected history is a read-only join over attributable PO, quote, contract, invoice, ticket, remote-session and endpoint-event records.\n"
        "- Replacement guidance retains its evidence boundary: missing cost or quote data remains Not assessed.",
        at_a_glance="- **Expected time:** 5-10 minutes to connect a known asset; 15-30 minutes to reconcile an incomplete commercial history\n"
        "- **Risk:** Low for review; medium when creating or linking the canonical record\n"
        "- **Required access:** Managed Assets view; lifecycle management permission to create or confirm a connection\n"
        "- **Evidence location:** Managed endpoint > Asset Story, Inventory Asset history, source PO/quote/invoice/contract/ticket, and Audit Trail",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| No inventory record is connected | Device ID, serial number, client and existing Inventory Assets | Search before creating; connect the correct record or create one from verified evidence |\n"
        "| Serial match needs confirmation | Serial, client and whether the asset is already linked elsewhere | Confirm only after checking the physical or vendor record |\n"
        "| Purchase order or invoice is missing | Direct asset/device/serial link, destination ticket and client ownership | Add the relationship to the source line; do not include every client invoice |\n"
        "| Replacement says Not assessed | Purchase date, useful life, warranty and endpoint evidence | Add verified lifecycle values or continue monitoring without an invented date |\n"
        "| Historical cost differs from a replacement quote | Original purchase record and current accepted quote | Keep both; never overwrite historical cost with a future replacement option |\n"
        "| Evidence coverage is unexpectedly low | Identity, ownership, procurement, warranty, commercial and operations checks | Correct each missing category at its owning source and refresh Asset Story |",
        rollback="If the wrong inventory record was linked, stop any procurement or disposal work, record the mistake in the related ticket, remove or correct the `device_id` relationship through Inventory Assets, reconnect the correct record, verify the serial/client/user/location, and retain the correction in the audit trail. Do not delete commercial or lifecycle history to hide the earlier relationship.",
        screenshots=[],
    ),
])

CURATED_ARTICLES.extend([
    _workspace_guide(
        "nexus-confidence",
        "Use Nexus Confidence before making a change",
        "Platform setup",
        "🔎",
        36,
        "Understand how much a client, endpoint or document can be trusted by reviewing completeness, freshness, attribution and conflicting source evidence before acting.",
        "1. Open a **Client** profile or a managed endpoint's **Asset Story**.\n"
        "2. Locate **Nexus Confidence**. Keep the operational health score separate: health describes the current condition; Confidence describes the reliability of the evidence behind the record.\n"
        "3. Select the Confidence meter or **Inspect evidence**.\n"
        "4. Review the overall state: **Verified** is 90-100%, **Strong** is 75-89%, **Review** is 50-74%, and **Low confidence** is below 50%. **Unavailable** means Nexus has no attributable source evidence.\n"
        "5. Review every dimension. Each one shows its source records, evidence count, completeness, freshness and last observation.\n"
        "6. Read **Evidence gaps** and **Conflicting records** before making a commercial, security, identity, remote-access or lifecycle change.\n"
        "7. Follow a gap to its owning workspace and correct the source record. Do not type a guessed value into the review note merely to raise confidence.\n"
        "8. Select **Refresh sources** after correcting the evidence. The score is recalculated from the current source records.\n"
        "9. When a technician has checked the evidence against the live environment, select **Record review**, describe what was checked, choose the review validity, and save.\n"
        "10. Confirm the human review appears separately from the calculated score. A review never raises the score or hides an unresolved source gap.\n"
        "11. For documentation, use the same Confidence API and review pattern for content quality, freshness, relationships and operational use before following a procedure.\n"
        "12. Link a high-impact change to the appropriate ticket, change record or approval even when Confidence is Verified.",
        "The technician can explain every Confidence score from its dimensions and source records, material gaps and conflicts are corrected at their owning source, human review is attributable and time-bound, and no attestation conceals missing evidence.",
        related="[Open Clients](/clients), [Open Managed Assets](/devices), [Build an Asset Story](/help/asset-story), [Review Knowledge & Docs](/documentation-hub?tab=library), and [Open the Audit Trail](/audit-trail).",
        before="- Confirm the correct client or endpoint before relying on the profile.\n"
        "- Treat Confidence as a decision aid, not an approval to perform a destructive action.\n"
        "- Restore disconnected providers or stale agent telemetry before making a current-state claim.\n"
        "- Use the owning source workspace to correct data; review notes are not a replacement for inventory, billing, contact, backup or documentation records.\n"
        "- Never store passwords, recovery keys or secret values in a Confidence review.",
        audit="- Every profile reports its schema version, assessed time, evidence count, source dimensions, gaps, conflicts and calculation method.\n"
        "- Human reviews retain the entity, score at review, open-gap count, technician, note, validity, time and correlation ID.\n"
        "- `confidence.assessment.verified` is published to the durable Nexus event ledger.\n"
        "- Human review never modifies source records, changes the calculated score or deletes a gap.\n"
        "- Subsequent source evidence can lower or raise the calculated score before a review expires.",
        at_a_glance="- **Expected time:** 2-5 minutes for review; longer when source evidence must be reconciled\n"
        "- **Risk:** Low for inspection; the resulting operational action retains its normal risk and approval requirements\n"
        "- **Required access:** Source record visibility; Confidence verification permission to record a review\n"
        "- **Evidence location:** Client or device Confidence Lens, source workspace, confidence verification history, event ledger and Audit Trail",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| Confidence says Unavailable | Entity ID, client scope, provider mapping and source records | Restore attributable evidence; do not substitute a manual score |\n"
        "| Score is lower than health | Missing ownership, lifecycle, commercial, backup or documentation evidence | Review the dimensions; health and evidence reliability answer different questions |\n"
        "| Freshness is low | Last agent, provider, document or billing observation | Repair the source connection or complete a current review at the source |\n"
        "| Duplicate conflict appears | Serial numbers, contact emails or client ownership | Reconcile the duplicate before using the affected identity |\n"
        "| Review button is denied | `confidence.verify` permission and client scope | Ask an administrator to grant the action deliberately |\n"
        "| Review does not raise the score | Expected behaviour | Correct source evidence, refresh, and keep the review as a separate attestation |",
        rollback="A Confidence review does not change client systems or source records. If a review note or validity was wrong, retain the original attestation, complete a corrected review, and record the reason on the linked ticket or change. If an operational action was taken from unreliable evidence, stop further work, preserve the profile and correlation ID, follow that workflow's rollback, and correct the source data.",
        screenshots=[],
    ),
])

CURATED_ARTICLES.extend([
    _workspace_guide(
        "nexus-change-guardian",
        "Review a change with Nexus Change Guardian",
        "Infrastructure & security",
        "🛡️",
        37,
        "Trace the current people, tickets, sessions, backups, alerts, clients and maintenance records that may be affected before approving a managed-asset change.",
        "1. Open **Managed Assets** and select the endpoints that belong to the planned change.\n"
        "2. Choose **Patches**, **Reboot**, **Tag**, or **Message** from the fleet action bar.\n"
        "3. Wait for **Nexus Change Guardian** to load the current attributable relationships. The preview does not execute or emulate the action.\n"
        "4. Review the risk score and level. The score is derived from the action type, servers, active remote work, high-priority tickets, running backup or recovery work, client boundaries, target availability, and fleet size.\n"
        "5. Confirm **Targets** and **Eligible** match your intent. Remove offline, unenrolled, missing, or out-of-scope assets instead of assuming Nexus can reach them.\n"
        "6. Review every **Change gate**. A review state is not silently treated as approval.\n"
        "7. Open the linked service, remote, backup, client, or alert records from **Live dependency engine** when the blast radius needs investigation.\n"
        "8. Read the expected outcome and recovery boundary. A reboot or delivered user message cannot be undone, and a patch rollback remains vendor-specific.\n"
        "9. Follow the Guardian recommendations and split cross-client work unless one approved change record intentionally covers every customer.\n"
        "10. Refresh evidence if a remote session ends, a backup finishes, a ticket changes priority, or the target list changes.\n"
        "11. Select the final action only when the preview still matches the scope. Nexus links the executed fleet command to that exact, time-limited preview.\n"
        "12. Confirm command results, next agent heartbeats, linked service records, and recovery evidence after execution.",
        "The reviewed target set matches the executed target set, material dependencies were either cleared or deliberately accepted, the preview remains linked to the resulting commands, and post-change evidence confirms the intended outcome.",
        related="[Open Managed Assets](/devices), [Review Change Management](/change-management), [Open Nexus Confidence](/help/nexus-confidence), [Review Remote Access](/remote-access), and [Open Backups](/backup-center).",
        before="- Confirm the correct clients and endpoints before selecting an action.\n"
        "- Link disruptive or multi-client work to an approved ticket or change record.\n"
        "- Treat a missing relationship as unknown, not proof that nothing depends on the target.\n"
        "- End or coordinate active remote work before rebooting, shutting down, or patching an endpoint.\n"
        "- Do not interrupt a backup, restore, or verification job without an approved recovery decision.",
        audit="- Each preview retains the technician, action, exact target IDs, client boundaries, assessed time, expiry, risk, gates and correlation ID.\n"
        "- `change.guardian.previewed` is published to the durable Nexus event ledger without executing the action.\n"
        "- The fleet action submits the preview ID with the exact reviewed action and target set.\n"
        "- `change.guardian.execution.linked` records the resulting queued, completed, failed and skipped totals.\n"
        "- Used, expired, mismatched, or technician-owned previews cannot be silently reused by the guarded workflow.",
        at_a_glance="- **Expected time:** 1-3 minutes for review; longer when a dependency needs coordination\n"
        "- **Risk:** Determined from current evidence and action type; the normal approval boundary still applies\n"
        "- **Required access:** Managed Assets, selected client scope, and the permission required by the final endpoint action\n"
        "- **Evidence location:** Change Guardian preview, target asset records, linked ticket/change, command history, platform event ledger and Audit Trail",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| Selected target is unavailable | Asset ID, technician client scope, deleted records and current search selection | Return to Managed Assets and rebuild the exact target set |\n"
        "| Eligible count is lower than selected | Nexus Agent identity, online state and action requirements | Repair or remove the ineligible endpoint before approval |\n"
        "| Risk is higher than expected | Server count, active sessions, critical tickets, running backups and multiple clients | Open the related records and reduce the blast radius |\n"
        "| Maintenance context needs review | Active or scheduled maintenance windows and linked change record | Schedule or link the approved window; do not invent one in a note |\n"
        "| Preview expired | More than ten minutes elapsed or evidence changed | Refresh the preview and review it again |\n"
        "| Preview does not match | Target selection or action changed after review | Generate a new preview for the final action and scope |\n"
        "| No dependencies are shown | Source mappings, client/device links and provider telemetry | Treat the blast radius as unknown and verify through the owning systems |",
        rollback="Closing a preview makes no endpoint change. If the executed action causes an issue, use the recovery boundary shown in the retained preview, stop further fleet execution, link the incident, preserve command results and correlation ID, and confirm recovery from a later trusted source. Never delete the preview or failed command evidence.",
        screenshots=[],
    ),
])

CURATED_ARTICLES.extend([
    _workspace_guide(
        "nexus-time-machine",
        "Compare endpoint history with Nexus Time Machine",
        "Infrastructure & security",
        "⏱️",
        34,
        "Compare two trusted Nexus Agent observations to identify software, network, security, update, hardware, service, or configuration changes without inventing evidence from before collection began.",
        "1. Open **Managed Assets**, search for the endpoint, and open its device profile.\n"
        "2. Select **Time Machine**.\n"
        "3. Read the history boundary and collection-coverage panel before drawing a conclusion. **Awaiting** means the agent has not supplied that evidence category; it does not mean healthy or unchanged.\n"
        "4. Choose an earlier state under **Before** and a later state under **After**.\n"
        "5. Review every changed category. Added, removed, and modified evidence is kept separate so a technician can identify the direction of change.\n"
        "6. Cross-check the relevant ticket, remote session, patch deployment, automation run, client timeline, or security alert at the same time.\n"
        "7. If the change was approved, link the evidence to the owning ticket or change record. If it was unexpected, create or update an incident before taking a disruptive action.\n"
        "8. Refresh history after remediation and verify that a later Nexus Agent observation records the intended state.",
        "The selected states belong to the same endpoint, the collection coverage supports the conclusion, the identified change is corroborated by its owning operational record, and the final result is retained on the ticket or client timeline.",
        related="[Open Managed Assets](/devices), [Review Change Management](/change-management), [Open Security Graph](/security-graph), and [Investigate Nexus Shield](/nexus-shield).",
        before="- Confirm the device, owning client, assigned user, and Nexus Agent identity.\n"
        "- Obtain approval before reversing software, security, network, registry, service, driver, or Group Policy changes.\n"
        "- Nexus Time Machine starts at the first persisted agent observation after the feature is enabled. It cannot reconstruct an earlier state.\n"
        "- Volatile CPU and memory readings are monitored elsewhere and are deliberately excluded from configuration-state comparisons.",
        audit="- Each changed endpoint state is stored with device, client, agent, capture time, evidence coverage, content hash, and previous-snapshot reference.\n"
        "- Identical heartbeats extend the observation period instead of creating noisy duplicate states.\n"
        "- Time Machine is read-only. Remediation remains in the owning device, ticket, automation, security, or change workflow.\n"
        "- Missing evidence is always shown as uncollected rather than passed or healthy.",
        at_a_glance="- **Expected time:** 5-20 minutes\n"
        "- **Risk:** Low for comparison; remediation risk depends on the source change\n"
        "- **Required access:** Managed Assets and the owning ticket or change record\n"
        "- **Evidence location:** Device Time Machine, device audit, linked ticket, client timeline, and Change Management",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| No history appears | Nexus Agent link, online state, last heartbeat, and agent version | Restore agent check-in; do not create a manual fake baseline |\n"
        "| Only one state appears | Whether the endpoint has produced a real configuration change | Keep the baseline; duplicate heartbeats are intentionally deduplicated |\n"
        "| A category says Awaiting | Installed agent collector and reported capabilities | Update or repair the collector before relying on that category |\n"
        "| A change has no matching ticket | Remote sessions, automation runs, patch history, and client timeline | Open an incident and preserve the snapshot IDs before remediation |\n"
        "| The comparison looks reversed | Before and After timestamps | Re-select the states; Nexus normalises the result chronologically |",
        rollback="Time Machine does not change an endpoint. If a technician reverses the wrong source change, stop further actions, preserve both snapshot IDs, follow the owning workflow's rollback, verify the device with a fresh agent observation, and document the correction in the linked ticket and change.",
        screenshots=[{"url": "/uploads/help/guides/managed-assets.png", "caption": "Managed Assets device profile — open the Time Machine tab on an agent-linked endpoint."}],
    ),
])

CURATED_ARTICLES.extend([
    _guide(
        "nexus-dns-setup",
        "Set up and stage Nexus DNS",
        "Infrastructure & security",
        "🌐",
        3,
        "Configure multi-tenant protective DNS through the existing Nexus Agent without risking client connectivity or overstating resolver readiness.",
        "Nexus DNS is configured with a client-aware policy hierarchy, Australian privacy settings, a tested rollback path, and a staged endpoint deployment. Blocking is enabled only after a trusted resolver edge and canary ring are verified.",
        "- Confirm the client endpoints are enrolled in the current Nexus Agent and appear under **Managed Assets**.\n"
        "- Decide who owns resolver operations, threat-feed maintenance, incident response, privacy review, and emergency disable.\n"
        "- Obtain at least two regional DoH or DoT resolver endpoints. A saved URL alone is not health evidence.\n"
        "- Document the client's approved content categories, required exceptions, data-retention period, and fail-open or fail-closed decision.\n"
        "- Choose the logging profile, client block-page wording, temporary-access approval path, service tier and billing unit.\n"
        "- Identify the client's monitored domains and brands for lookalike detection, plus private zones that must remain tenant isolated.\n"
        "- Use fail-open for the initial pilot unless an approved security requirement explicitly mandates fail-closed.",
        "1. Open **Nexus DNS > Safety & privacy**.\n"
        "2. Select DoH or DoT and enter the regional resolver endpoints, one per line.\n"
        "3. Choose Australian storage, query-retention, redaction, consent, bypass-detection, local-cache and fail-behaviour settings.\n"
        "4. Select **Validate configuration**. Treat `validation required` as pending until a trusted regional probe attests reachability, DNSSEC and policy service health.\n"
        "5. Open **Policies** and create a client or site policy. Start high-confidence malware, phishing, command-and-control and cryptomining controls in **Audit** mode.\n"
        "6. Select **Simulate** and test approved domains and categories. Simulation does not send a DNS query or change an endpoint.\n"
        "7. Open **Coverage** and confirm the intended endpoints are online, client-linked and eligible.\n"
        "8. Select **Deploy protection**, choose **Visibility** and the **Canary** ring, preview the exact endpoints and rollback steps, then queue the configuration.\n"
        "9. Verify endpoint check-in, resolver health, ordinary business browsing, VPN behaviour, local cache and restoration of the previous DNS settings.\n"
        "10. Move the canary ring to **Audit** only after visibility evidence is complete. Enable blocking only after resolver attestation and a successful audit period.\n"
        "11. Open **Intelligence**, analyse an approved and a suspicious domain, read every scored signal, then scan the client's protected domain for active lookalike candidates. Use the **Nexus Domain Timeline** to follow DNS, endpoint, access-request and incident evidence in order.\n"
        "12. Open **Discovery**. Assign an owner to observed SaaS applications, then choose approve, block or review. Add approved services to the client application inventory when appropriate. Network-mode and tunnelling results appear only when query telemetry supports them.\n"
        "13. Open **Incidents** and preview the containment plan for a clustered campaign. Resolve every configuration gap before requesting approval; a preview never runs a resolver, endpoint or identity action.\n"
        "14. Open **Toolkit** to compare resolvers, trace CNAMEs, inspect DNSSEC evidence and explain policy results. Use the response-code guide to distinguish policy blocking from NXDOMAIN, timeout and DNSSEC failure; EDE 15 means the resolver reports an operator policy block.\n"
        "15. In **Safety & privacy**, select the logging profile, zero-trust conditions, lookalike monitoring, client block page, MFA-backed access request, service tier and billing model. Save these controls before broad rollout.\n"
        "16. Use **Forecast 7 days** on each candidate policy. Review would-block domains, affected endpoints and clients, then expand from canary to pilot and broad rings only after each stage is approved.",
        "- Resolver status is backed by trusted health evidence rather than a saved endpoint string.\n"
        "- Canary endpoints resolve expected business services and can restore their previous DNS configuration.\n"
        "- Query events identify the client, endpoint, policy and decision reason; `verified block` counts only resolver-attested events.\n"
        "- Privacy settings, simulations, policy versions, deployments, exceptions and emergency actions appear in the Nexus DNS audit trail.\n"
        "- Domain scores show their exact evidence and do not silently treat unavailable RDAP, certificate, DNSSEC or threat data as a safe result.\n"
        "- Shadow IT decisions have an owner and reason; incident playbooks show approval gates and configuration gaps before execution.\n"
        "- Resolver diagnostics distinguish REFUSED/EDE 15 policy blocks from NXDOMAIN, SERVFAIL, timeout and DNSSEC errors.\n"
        "- Endpoint removal restores captured DNS settings and a failed rollout can be returned to Visibility through break-glass control.",
        "- Retain the policy ID and version, scope, category decisions, allow/block overrides, schedule, technician and approval.\n"
        "- Retain resolver probe evidence, deployment ring, endpoint list, before/after DNS configuration, agent acknowledgements and rollback result.\n"
        "- Retain every temporary allow with domain, device, reason, technician, creation and expiry.\n"
        "- Retain domain-risk signals, lookalike checks, SaaS approval decisions, policy forecasts and playbook previews.\n"
        "- Retain the selected privacy profile, block-page version, MFA result, request approver, resolver response and Extended DNS Error where available.\n"
        "- Link incident tickets to the originating DNS event and preserve the resolver evidence in the ticket audit context.",
        related="[Open Nexus DNS](/dns-monitor), [Review Managed Assets](/devices), [Generate a Nexus Agent installer](/nexus-agent-center), and [Open Tickets](/tickets).",
        at_a_glance="- **Expected time:** 30-60 minutes for setup plus a monitored pilot\n"
        "- **Risk:** High if DNS is changed broadly without a healthy redundant edge and tested rollback\n"
        "- **Required access:** Nexus DNS policy and settings access, Managed Assets access, and resolver-operations ownership\n"
        "- **Evidence location:** Nexus DNS audit, resolver probe evidence, endpoint deployment history, query activity and linked ticket",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| Blocking is locked | Resolver endpoints, emergency-disable state and health attestation | Stay in visibility or audit; do not bypass the gate |\n"
        "| Endpoint does not appear | Client-bound installer, operating system, agent check-in and active registration | Re-enrol or repair the agent before changing DNS |\n"
        "| Ordinary sites fail | Resolver health, DNSSEC, VPN split-DNS, allow rules and fail behaviour | Return the canary to visibility and restore previous DNS |\n"
        "| Event lacks a client or user | Agent ownership, signed-in user context and authenticated resolver identity | Correct the source mapping; do not guess attribution |\n"
        "| A block looks wrong | Feed, category, policy precedence, schedule and exact domain | Create an expiring temporary allow with a reason, then investigate |\n"
        "| Page says blocked but the user reports an outage | RCODE, Extended DNS Error, resolver comparison and CNAME chain | Use Toolkit before changing policy; EDE 15 supports a policy block while NXDOMAIN or SERVFAIL indicates a different fault |\n"
        "| Risk score has unavailable signals | RDAP reachability, certificate handshake and DNS record responses | Treat the score as incomplete; verify manually and keep the domain in audit |\n"
        "| Shadow app list is empty | Authenticated query events and the selected logging profile | Do not infer usage; confirm resolver or agent telemetry first |\n"
        "| Incident action is unavailable | Resolver edge, Nexus Shield, Microsoft 365 connection and identity context | Fix the configuration gap, regenerate the preview and request approval |\n"
        "| Users bypass protection | Adapter changes, browser secure DNS, VPN and local administrator access | Record the bypass event and remediate through the approved endpoint policy |",
        rollback="Select **Safety & privacy > Emergency disable**, enter the incident or change reason, and queue the return to Visibility. Restore the DNS servers captured before deployment, remove the Nexus DNS endpoint policy and local certificate material, flush the DNS cache, verify resolution through the previous resolver, and retain the technician, endpoints, timestamps and validation result. Do not delete failed deployment or query evidence.",
        screenshots=[],
    ),
])

CURATED_ARTICLES.extend([
    _guide(
        "nexus-suite-product-map",
        "Navigate the Nexus product suite",
        "Start here",
        "🧭",
        2,
        "Use the Nexus Suite product map to move between specialised workspaces while keeping client context, audit history, and provider boundaries clear.",
        outcome="Technicians can identify the owning Nexus product, open it safely, and route external systems through the governed Integrations workspace.",
        steps="1. Open **Platform > Nexus Suite**.\n"
        "2. Review the four summary tiles to confirm the number of products, Nexus-native workspaces, Store collections, and product families.\n"
        "3. Search for an outcome such as `remote`, `billing`, `identity`, `backup`, or `automation` rather than memorising a menu path.\n"
        "4. Filter by product family when you need a security, infrastructure, business, or intelligence workspace.\n"
        "5. Select **Open** to enter the owning Nexus workspace.\n"
        "6. Use **Nexus Store** for governed connectors, automation packs, technician script packs, and commercial catalogue items.\n"
        "7. Configure Keeper, Hudu, Microsoft, and other external authorities through **Integrations** rather than treating them as duplicate Nexus products.\n"
        "8. Validate every provider connection in Settings or Integrations before relying on its health or evidence.",
        verify="Each product opens its owning workspace, every Store collection opens its governed catalogue, and the Suite page shows source-backed evidence without labelling an unverified provider healthy.",
        related="[Open Nexus Suite](/nexus-suite), [Open Nexus Store](/nexus-suite?view=store), [Review integrations](/integrations), and [Open Nexus Control](/control-plane).",
        before="- Use your normal NexusMSP role; destination permissions still apply.\n"
        "- Confirm the correct client before performing an action in a product workspace.\n"
        "- Keep passwords in Keeper, controlled client documentation in Hudu, and MFA or identity authority in Microsoft.\n"
        "- A product being available does not mean its external provider is configured or healthy.",
        audit="- Existing routes remain valid for backwards compatibility.\n"
        "- Password and documentation authority remains with Keeper or Hudu; NexusMSP does not expose a duplicate Vault product.\n"
        "- MFA and identity authority remains with Microsoft; NexusMSP does not expose a duplicate MFA product.\n"
        "- Actions remain auditable in their owning workspace, linked ticket, client timeline, and provider history.",
        at_a_glance="- **Expected time:** 2-5 minutes\n"
        "- **Risk:** Low for navigation; destination workflow risk still applies\n"
        "- **Required access:** NexusMSP plus the selected product permission\n"
        "- **Evidence location:** Product workspace, linked client timeline, Audit Trail, and provider history",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| A product opens but has no data | Provider connection, selected client, permissions, and last sync | Validate the owning integration before making a health claim |\n"
        "| A product is not found in search | Search the outcome, capability, or product family | Clear the family filter and search again |\n"
        "| A Keeper, Hudu, or Microsoft connection is missing | Integration is not configured or verified | Open Integrations, select the provider, and complete its validation workflow |\n"
        "| An old bookmark uses a previous name | Compatibility route and destination workspace | Continue with the destination and update internal documentation when convenient |\n"
        "| A Store entry cannot run | Installation, connector configuration, approval, and client scope | Simulate and validate the connection before enabling execution |",
        rollback="The Suite product map is navigational and does not change client systems. Close an incorrect destination before submitting an action. If a product workflow was already approved and run against the wrong scope, use that workspace's rollback process and preserve its audit record.",
        screenshots=[],
    ),
])

# A practical coverage layer for the day-to-day workspaces. These complement
# the deeper core procedures above, so a technician can search for the task
# in front of them rather than needing to know the product navigation first.
CURATED_ARTICLES.extend([
    _workspace_guide(
        "nexus-control-plane",
        "Operate Nexus Control Plane",
        "Platform setup",
        "🧭",
        14,
        "Search and operate Microsoft 365 and the connected NexusMSP provider fabric while understanding the shared identity, event, audit, permission and automation contracts underneath it.",
        "1. Open **Nexus Control Plane** from the Platform section.\n"
        "2. Review **Provider health** before trusting a tenant, asset, backup, voice, or billing result. A configured provider is not the same as verified evidence.\n"
        "3. Use the global search for a client, user, hostname, serial number, ticket, invoice, PBX, backup job, product, or knowledge record.\n"
        "4. Open **Microsoft 365 > Connections**. For a CSP estate, save the MSP partner tenant ID, dedicated App ID and secret once, test Partner Center, then choose **Discover customers** to import the eligible customer tenant list.\n"
        "5. Map every discovered Microsoft tenant to the correct NexusMSP client. Partner Center discovery identifies the customer but does not by itself grant Microsoft Graph access.\n"
        "6. Establish least-privilege **GDAP** for partner-managed customers, or use the individual customer-admin consent path for a tenant outside the CSP relationship. Confirm Nexus reports Graph access as verified before attempting an action.\n"
        "7. Open **Microsoft 365 > Tenant operations** for user lifecycle and licence work. Use **Security & guardrails** for provider-verified posture, GDAP, Conditional Access references, and detection drafts.\n"
        "8. Open **Microsoft 365 > Action centre** for a governed identity or licence change. Select an action-ready tenant, complete the action-specific fields, link the ticket or change for critical work, and create a safe preview before requesting approval.\n"
        "9. Review the preview's client mapping, connection source, option summary, before-and-after narrative, rollback plan, readiness checks, and expiry time. Nexus revalidates all of these before accepting a request; a preview never executes Microsoft changes.\n"
        "10. Open **Foundation** and review the **Nexus event backbone**. Confirm its status, queue depth, retry count, dead-letter count, delivery success rate and latest retained event before relying on a downstream automation.\n"
        "11. To connect a consumer, choose **Subscriber**, name the owner and purpose, enter only the required dotted subject patterns, and use an HTTPS endpoint. Store the generated HMAC signing secret immediately; NexusMSP will not display it again.\n"
        "12. A receiver must verify `X-Nexus-Signature`, deduplicate with the supplied `Idempotency-Key`, and return a 2xx response only after it has safely accepted the event. Pause the subscriber before maintenance or when its ownership is unclear.\n"
        "13. Use **Process queue** for an operator-requested delivery pass. Investigate a retry or dead-letter record before selecting retry; do not repeatedly retry an unavailable or incorrectly configured consumer.\n"
        "14. Use **Replay** only for retained events that a named subscriber genuinely missed. Enter the exact subject and optional time window, select **Preview only**, review the event and delivery counts, then add an audit reason before creating the replay.\n"
        "15. Inspect the **Nexus Core relationship model**. Its canonical path is Client > Site > Contact/User > Device > Service > Contract > Ticket > Invoice > Integration.\n"
        "16. Administrators can choose **Rebuild relationships** after an import or major mapping change. The rebuild does not alter source records; it refreshes stable Nexus references, relationship evidence, client-link coverage, and integrity anomalies.\n"
        "17. Investigate every high-severity missing-client or dangling-relationship result before relying on cross-module automation. Never invent a mapping solely to make the integrity indicator green.\n"
        "18. Treat **Operational**, **Partial**, and **Planned** as evidence states. A target such as NATS JetStream, PostgreSQL, ClickHouse, Vault, or OpenTelemetry is not deployed merely because it appears on the roadmap.\n"
        "19. Move to the owning provider workspace when a result needs detailed remediation, billing, automation, or documentation.\n"
        "20. Review **Activity** after a material action and link the outcome to the relevant client or ticket. Use the returned `X-Correlation-ID` when tracing a failed cross-service request.",
        "The expected provider is healthy or explicitly marked unverified, search results open the correct operational record, the Microsoft tenant is linked to the right client, action previews are scoped and explicitly non-mutating, the Foundation tab accurately describes current readiness, and the activity history records the technician action.",
        related="[Open Microsoft tenant connections](/control-plane?module=microsoft365&view=connections), [Manage a network integration](/help/networking-unifi), and [Connect a client Yeastar PBX](/help/voice-yeastar-pbx-onboarding).",
        before="- Confirm you have access to Nexus Control Plane and the selected client or provider workspace.\n"
        "- Obtain approval before running identity, licensing, offboarding, security, or billing actions.\n"
        "- Verify the Microsoft tenant, client, and target user or device. Similar names across tenants are not sufficient evidence.\n"
        "- For a hosted Microsoft tenant adapter, confirm the dedicated Azure Function host key is stored in Settings and the connection test succeeds.\n"
        "- Do not interpret a target technology in the Foundation transition map as production readiness. Verify the capability evidence and owning deployment runbook first.",
        audit="- Retain the provider, tenant, client mapping, target record, action, technician, timestamp, provider result, and linked ticket or change.\n"
        "- Record failed, rejected, or partially completed provider actions instead of rerunning them without review.\n"
        "- For identity lifecycle work, capture licence changes, sign-in state, mailbox handling, forwarding, and the approving technician.\n"
        "- Action Centre previews retain `will_execute:false`, the connection source, client mapping, structured options, readiness blocks, rollback plan, approval reference, and expiry time. Submission revalidates tenant access and does not silently bypass a failed readiness check.\n"
        "- Platform events retain a dotted subject, tenant context, actor, schema version, payload, timestamp, correlation ID, partition sequence and retention boundary. Subscriber attempts, responses, retries, dead-letter state and replay IDs remain separate from the immutable event.\n"
        "- Webhook secrets are shown once, encrypted at rest, and rotated through an audited protected action. Every committed replay records the requesting technician, reason, filter, event count and delivery count.\n"
        "- A Core rebuild retains the technician, correlation ID, entity and relationship totals, coverage, anomalies, and the `core.relationships.rebuilt` platform event.",
        screenshots=[],
    ),
    _workspace_guide("ticket-blueprints", "Use ticket blueprints", "Service desk", "🧩", 15, "Create repeatable tickets from a proven parent-and-child task design.", "1. Open **Ticket Blueprints** from Tickets.\n2. Search for the blueprint that matches the work.\n3. Review included child tasks, policies, owners, and client fields.\n4. Apply the blueprint and complete the ticket-specific details.\n5. Confirm the parent and child tickets are linked before assigning work.", "Every generated task has the correct client, owner, and dependency. The parent ticket shows the implementation progress."),
    _workspace_guide("service-catalog-request", "Create work from the service catalogue", "Service desk", "🧰", 16, "Turn an approved service offering into a correctly scoped service record.", "1. Open **Service Catalog** from the Tickets workspace.\n2. Select the service and review its scope, policy, expected effort, and inclusions.\n3. Choose the client and requester.\n4. Confirm the required approval or commercial reference.\n5. Create the ticket and assign the appropriate queue.", "The ticket carries the selected service, policy, and client context without duplicated manual notes."),
    _workspace_guide("dispatch-board", "Use the dispatch board", "Service desk", "🗺️", 17, "Assign and sequence field work with live technician and client context.", "1. Open **Dispatch** from Tickets.\n2. Filter by date, technician, client, or unassigned work.\n3. Open a ticket card to review scope and location.\n4. Drag or schedule only after checking calendar and travel conflicts.\n5. Record any override reason and send the client confirmation when required.", "The booking is visible on the technician schedule and recorded on the linked ticket timeline."),
    _workspace_guide("live-client-chat", "Start a client asset chat", "Service desk", "💬", 18, "Contact the person at an endpoint while preserving the technician and device context.", "1. Open the managed asset or linked ticket.\n2. Choose **Start device chat**.\n3. Confirm the target user and write the purpose of the conversation.\n4. Wait for the client session to connect before requesting action.\n5. Add material outcomes to the ticket when the chat is complete.", "The conversation is linked to the correct asset and any service action is documented on the ticket."),
    _workspace_guide("team-chat-guide", "Use Team Chat for internal coordination", "Service desk", "💭", 19, "Coordinate technicians without losing the separation between internal chat and client audit records.", "1. Choose the relevant channel or create one for the incident or project.\n2. Mention the technician or team needed for the next action.\n3. Link the client, ticket, asset, or war room where context is required.\n4. Keep client-specific decisions in the ticket timeline.\n5. Archive or close temporary coordination channels after handover.", "The team has the needed context and the client record contains the auditable customer-impacting decisions."),
    _workspace_guide("client-documents", "Manage client documents", "Client operations", "📁", 25, "Store and retrieve client documentation without losing ownership or audit context.", "1. Open the client profile and select **Documents**.\n2. Search before uploading to avoid duplicates.\n3. Add a clear title, document type, visibility, and review date.\n4. Upload the approved document or link the source record.\n5. Record a ticket note when the document changes an active service task.", "The document is discoverable from the client profile with an owner, current version, and appropriate visibility."),
    _workspace_guide("client-subscriptions", "Review client subscriptions", "Client operations", "🔁", 26, "Confirm linked subscriptions, source quantities, and billing relationships for a client.", "1. Open the client profile and select **Subscriptions**.\n2. Review the provider source, quantity, product mapping, and sync state.\n3. Investigate a pending or failed change before approving billing.\n4. Follow the linked agreement or recurring invoice for commercial context.\n5. Create a ticket for any provider data that needs correction.", "Each subscription has a known source, product mapping, and commercial owner; exceptions are visible and owned."),
    _workspace_guide("client-portal-admin", "Manage the client portal", "Client operations", "🌐", 27, "Control client-facing portal access, content, and request visibility safely.", "1. Open the client profile and select **Client Portal**.\n2. Review active contacts and their role.\n3. Enable only the requested client-facing modules.\n4. Preview or test the visible experience with an approved account.\n5. Record material access changes in the client history.", "The intended contacts have only the approved portal access and the client can see the correct content."),
    _workspace_guide("asset-discovery", "Discover managed assets", "Infrastructure & security", "📡", 50, "Bring newly discovered endpoints into the managed asset workflow with correct ownership.", "1. Open **Managed Assets** and choose **Discover**.\n2. Select the client or site scope.\n3. Review discovered devices and remove duplicates or excluded hardware.\n4. Assign the client, site, and management policy.\n5. Enrol or link the Nexus Agent where appropriate.\n6. Confirm the first health check-in.", "The asset appears once, under the correct client, with a current management and health state."),
    _workspace_guide("patch-management", "Manage patching", "Infrastructure & security", "🩹", 51, "Review patch state, approve a controlled deployment, and verify endpoint recovery.", "1. Open **Managed Assets** and select the patch view or target device.\n2. Review missing updates, reboot impact, maintenance window, and client exceptions.\n3. Approve or schedule the patch action.\n4. Monitor completion and required reboot.\n5. Verify device check-in and patch result.\n6. Raise a ticket for failed or risky updates.", "Patch evidence shows the target, action, completion result, and any unresolved exception."),
    _workspace_guide("scripting-library", "Run a script safely", "Automation & intelligence", "⌨️", 52, "Find a vetted script, target the right endpoint, and retain the execution result.", "1. Open **Scripting** and search the library by outcome.\n2. Review the script description, safety notes, parameters, and target scope.\n3. Test on one approved endpoint when the impact is uncertain.\n4. Run the script and monitor live output.\n5. Link the run to the related ticket and review the execution history.", "The execution record shows the exact script, target, technician, output, and final status."),
    _workspace_guide("runbooks", "Create and run an automation runbook", "Automation & intelligence", "📜", 53, "Use repeatable automation without bypassing approvals or evidence.", "1. Open **Runbooks** from Automation.\n2. Choose a template or create a runbook with an explicit trigger and owner.\n3. Add steps, approvals, target criteria, and rollback notes.\n4. Run a controlled test.\n5. Publish only after a reviewer approves it.\n6. Monitor runs and resolve exceptions from their linked records.", "The runbook has an owner, tested steps, approval path, and retained execution history."),
    _workspace_guide(
        "alert-rules",
        "Configure an alert rule",
        "Automation & intelligence",
        "🔔",
        54,
        "Turn a useful signal into owned, low-noise service work with explicit thresholds, suppression, actions, and proof.",
        "1. Open **Alert Rules** from Automation and choose **New alert rule**. Give the rule an outcome-based name, such as `Device offline for 10 minutes`, rather than a vague source name.\n"
        "2. Select the **signal and condition**. Define the operator, threshold, and duration. Use a sustained duration for fluctuating signals so a single transient sample does not create work.\n"
        "3. Set the **scope** to the smallest safe client, site, asset group, or policy target. Review the matched target count before continuing; never assume a global scope.\n"
        "4. Choose the **severity and ownership**. Map the event to the correct ticket priority, service queue, initial assignee, and service policy so it enters an owned workflow.\n"
        "5. Configure **noise controls**: cooldown, deduplication key, maintenance-window suppression, auto-recovery behaviour, and the number of repeated observations required.\n"
        "6. Add the required **actions**. Select ticket creation or update, technician notification, approved runbook, and escalation. Client communication should only be automatic when the wording and recipient rules have been approved.\n"
        "7. Use **Test rule** with one approved endpoint or a safe sample event. Review the previewed target, ticket fields, message, runbook, and suppression decision before allowing execution.\n"
        "8. Enable the rule for the pilot scope. Observe at least one alert and one recovery cycle, then review volume and false positives before expanding the scope.",
        "- The test event creates or updates exactly one record in the intended queue with the correct client, asset, priority, service policy, and owner.\n"
        "- A repeated event inside the cooldown window is deduplicated, while a genuine new occurrence after recovery can create fresh work.\n"
        "- Recovery closes or updates only the intended alert state and leaves the ticket history intact.\n"
        "- The activity log shows the rule version, matched condition, selected actions, technician, and timestamps.",
        related="[Open Alert Rules](/alert-rules) to create or review a rule. Continue with [Create an incident ticket from an alert](/help/ticket-triage) when the signal needs a human-led response.",
        before="- Choose one operational condition with a clear owner and an action the service desk can perform. A metric without an actionable response should remain a dashboard signal, not a ticket-generating alert.\n"
        "- Confirm access to **Alert Rules**, the target clients or assets, the destination queue, notification channel, and any runbook referenced by the action.\n"
        "- Check maintenance windows, existing rules, and provider alerts to avoid duplicate coverage.\n"
        "- Record the present event volume or false-positive baseline so the pilot can be measured.",
        audit="- Retain the rule name and version, creator, approver, scope, condition, severity, cooldown, deduplication key, actions, and enablement time.\n"
        "- Link the test event and resulting ticket or execution record. Record whether notification, suppression, recovery, and escalation behaved as expected.\n"
        "- Record pilot volume, false positives, tuning decisions, and the named owner for the next review.",
        at_a_glance="- **Expected time:** 20-30 minutes plus a monitored pilot\n"
        "- **Risk:** Medium; poor scope or suppression can create ticket storms\n"
        "- **Required access:** Alert-rule management plus access to the target assets, queue, notifications, and runbook\n"
        "- **Evidence location:** Rule activity, test event, linked ticket, execution history, and client audit trail",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| No target assets appear | Client/site scope, agent check-in, signal source, and permissions | Do not widen globally; validate one known endpoint first |\n"
        "| Test passes but no ticket is created | Action enablement, queue access, required ticket fields, and service-policy mapping | Correct the mapping and repeat the safe test |\n"
        "| Duplicate tickets are created | Deduplication key, cooldown, recovery state, and overlapping provider rules | Disable the newest rule and compare event fingerprints |\n"
        "| Rule never recovers | Recovery condition, polling interval, stale telemetry, and endpoint status | Verify live telemetry before manually clearing the event |\n"
        "| Runbook action fails | Approval requirement, target support, parameters, timeout, and execution history | Leave the ticket open and escalate with the run output |",
        rollback="Disable the rule immediately if it targets the wrong scope, creates duplicate work, sends an incorrect client communication, or starts an unsafe action. "
        "Do not delete it: keep the disabled version and its activity history as evidence. Stop pending runbook executions where safe, reassign or merge duplicate tickets, "
        "and restore the previous rule version only after its scope and suppression settings are revalidated. Escalate any customer impact or security action through the linked incident.",
        screenshots=[],
    ),
    _workspace_guide("networking-unifi", "Manage a network integration", "Infrastructure & security", "📶", 55, "Review network client and site data through the configured UniFi integration.", "1. Open **Network** and select the client site.\n2. Review integration health and last synchronisation.\n3. Confirm the device, VLAN, or alert context.\n4. Use the linked device or ticket action for service work.\n5. Return to Settings if the integration test or credential needs review.", "The network view shows current site data and any configuration or alert work is linked to a ticket."),
    _workspace_guide("dns-dmarc", "Monitor DNS and DMARC", "Infrastructure & security", "🛰️", 56, "Investigate DNS or email-authentication posture with a clear remediation trail.", "1. Open **DNS Monitor** or **DMARC Compliance**.\n2. Select the client domain and review the current finding.\n3. Validate the record against the authorised DNS source.\n4. Create a change or ticket before modifying production DNS.\n5. Recheck the domain after propagation and record the result.", "The finding is either resolved with current DNS evidence or has an owned, documented exception."),
    _workspace_guide("shadow-it-review", "Review Shadow IT findings", "Infrastructure & security", "👁️", 57, "Assess unapproved software or access indicators without overreacting to incomplete evidence.", "1. Open **Shadow IT** and filter by client or risk.\n2. Review source, confidence, device count, and business owner.\n3. Validate the finding with the client or relevant technician.\n4. Create a security ticket or exception record.\n5. Track the remediation or approved exception to closure.", "Every material finding has an owner, decision, and evidence; false positives are documented rather than silently removed."),
    _workspace_guide("backup-restore", "Verify and document a backup restore", "Infrastructure & security", "♻️", 58, "Turn backup status into demonstrated recovery evidence.", "1. Open **Backups** and select the client workload.\n2. Review the last successful backup and any verification finding.\n3. Start an approved test restore to the correct isolated destination.\n4. Validate the restored data, application, or system objective.\n5. Record duration, result, limitations, and next test date.\n6. Link the evidence to the client and compliance record.", "The restore test has a timestamp, target, result, owner, and documented recovery evidence."),
    _workspace_guide("calendar-dispatch", "Connect and use Microsoft calendars", "Platform setup", "🗓️", 55, "Connect the approved calendar and use availability to prevent avoidable scheduling conflicts.", "1. Open **Settings > Integrations** and select Calendar.\n2. Choose **Connect Microsoft Calendar**.\n3. Complete Microsoft consent using the approved mailbox.\n4. Save and test the connection.\n5. Open Dispatch and confirm technician availability is visible.\n6. Resolve a conflict with a documented override rather than double-booking.", "The calendar connection reports healthy and dispatch shows current commitments for the selected technician."),
    _workspace_guide("mailbox-routing", "Configure operational mailbox routing", "Platform setup", "📬", 56, "Map Microsoft 365 mailboxes to tickets, replies, billing, and leads without losing auditability.", "1. Open **Settings > Mailboxes**.\n2. Add or select the mailbox using Microsoft sign-in.\n3. Assign permitted purposes such as ticket replies, billing, or lead intake.\n4. Save the routing choices.\n5. Send a controlled test message.\n6. Confirm the resulting ticket, lead, or correspondence appears in history.", "The mailbox displays the expected purpose, connection status, and a successful end-to-end test result."),
    _workspace_guide("ai-copilot-guide", "Use AI Copilot safely", "Automation & intelligence", "✨", 57, "Use AI assistance to accelerate work while retaining technician judgement and verification.", "1. Open **AI Copilot** from the workspace you are working in.\n2. Provide only the necessary client-safe operational context.\n3. Ask for a draft, summary, or next diagnostic step.\n4. Review every recommendation before acting.\n5. Validate the actual outcome in NexusMSP or the source system.\n6. Put customer-impacting decisions in the ticket, not only the Copilot conversation.", "The final action is supported by verified source evidence and the ticket records technician judgement."),
    _workspace_guide("notification-preferences", "Configure notifications", "Platform setup", "🔕", 58, "Set personal notification preferences without suppressing organisation-critical service alerts.", "1. Open **My Workspace > Notifications**.\n2. Review the default critical, ticket, chat, and schedule notification types.\n3. Adjust personal delivery preferences within policy.\n4. Test a non-critical notification where available.\n5. Keep incident and security escalation channels enabled unless an authorised policy changes them.", "Your preferences are saved after refresh and critical operational notifications remain covered."),
    _workspace_guide("team-roles", "Create and manage access roles", "Platform setup", "🪪", 59, "Give technicians the least access needed for their role and keep named roles maintainable.", "1. Open **Team > Permissions** and review the module heatmap.\n2. In **Access role catalogue**, create or rename a role with a clear business purpose; the stable role ID remains unchanged for automation and audit history.\n3. In **Protected action policy**, select that role and grant only the exact actions it needs.\n4. Pay particular attention to critical actions such as payment recording, invoice voiding, DNS emergency disable, identity offboarding, workflow execution and security containment.\n5. Open **Team > Directory**, edit the technician and set **Client & site scope**. Choose all clients only for staff with an organisation-wide remit; otherwise select the permitted clients and optionally narrow them to named managed sites.\n6. Save the technician, then test one allowed client and one client outside their scope with an approved non-admin account.\n7. Confirm the denied attempt records the required permission or client scope, technician and correlation ID without changing client data.", "The role name, exact action grants and client/site boundary are visible; allowed actions succeed and a denied protected or cross-client action returns a stable access reason without changing data."),
    _workspace_guide(
        "agent-installer",
        "Generate, trust and repair the Nexus Agent",
        "Infrastructure & security",
        "🧬",
        59,
        "Create a client-scoped package, verify its endpoint identity and understand the evidence technicians should expect after first check-in.",
        "1. Open **Managed Assets → Nexus Agent** and choose **Generate Installer**.\n"
        "2. Select the correct client. The package is client-bound and includes Nexus Shield, Canary, DNS visibility, Client Chat, Nexus Elevate, policy caching and signed-update verification.\n"
        "3. Deploy the package through an authorised endpoint-management method. On first start, the endpoint creates its own private key locally and sends only a certificate signing request to NexusMSP.\n"
        "4. Confirm **Certificates issued** increases in **Endpoint trust & resilience**. The issued client certificate is valid for 90 days and is renewed automatically before expiry.\n"
        "5. Confirm **Policy current** and **Self-repair healthy** after the following heartbeat. These prove that the expected policy was cached and the identity/configuration files passed local checks.\n"
        "6. For production mTLS, configure the reverse proxy to validate the Nexus Agent CA, forward the verified SHA-256 fingerprint in `X-Client-Cert-Fingerprint`, and set `NEXUS_TRUST_MTLS_PROXY_HEADER=true` only on the protected API origin. Direct local development remains token-compatible and must not be described as mTLS-verified.\n"
        "7. If an online endpoint needs attention, choose **Repair**. Nexus queues an auditable repair for identity files, policy cache, configuration permissions and companion evidence.\n"
        "8. Before releasing an agent update, check the version card. The agent rejects a changed version, hash or size unless the Ed25519 manifest signature also verifies.",
        "The endpoint appears once under the intended client, reports a current policy and healthy repair evidence, and shows certificate-issued or mTLS-verified trust without exposing its private key.",
    ),
    _workspace_guide("products-catalog", "Manage products and product images", "Billing & commercial", "🏷️", 60, "Maintain billable products with clear pricing, mappings, and a recognisable product identity.", "1. Open **Products & Inventory**.\n2. Search before creating a duplicate product.\n3. Enter the name, code, pricing, tax, and billing behaviour.\n4. Upload the approved product image when it helps recognition.\n5. Link provider or recurring mappings where required.\n6. Save and test the product from an invoice draft.", "The product appears once in search, has correct pricing, and can be added to a billable document."),
    _workspace_guide("contract-billing", "Link a contract to recurring billing", "Billing & commercial", "📃", 61, "Connect service agreements, inclusions, usage sources, and recurring invoices without manual workarounds.", "1. Open **Contracts** and select the client agreement.\n2. Review service type, included quantity, pricing, and renewal details.\n3. Link the recurring invoice and product mappings.\n4. Add approved usage or source-sync rules.\n5. Use billing health to identify missing readiness items.\n6. Review the first generated billing preview before activation.", "The agreement shows a ready billing state, linked invoice, source quantities, and an auditable approval history."),
    _workspace_guide("record-payment", "Record an invoice payment", "Billing & commercial", "💰", 62, "Record a Xero, EFTPOS, cash, or other approved payment against the right invoice allocation.", "1. Open the issued invoice.\n2. Choose **Record payment**.\n3. Confirm payer, amount, date, method, and reference.\n4. Apply the payment to the right invoice or split-billing allocation.\n5. Save and review the remaining balance.\n6. Reconcile through the approved finance workflow when required.", "The invoice balance, payment method, payer allocation, and audit history are correct after refresh."),
    _workspace_guide("scheduled-reports", "Schedule a recurring report", "Reporting & evidence", "⏱️", 63, "Deliver consistent, branded reports from the central reporting workspace.", "1. Open **Reports > Delivery**.\n2. Choose a report template and scope.\n3. Set frequency, recipients, timezone, and delivery method.\n4. Preview the output and confirm branding.\n5. Save the schedule.\n6. Review the first delivery and retained report history.", "The schedule has the expected scope, next run, recipient list, and professional PDF output."),
    _workspace_guide("incident-postmortem", "Generate an incident postmortem", "Reporting & evidence", "🧯", 64, "Convert a resolved incident into a factual improvement record and professional evidence document.", "1. Open the resolved incident or **Reports** postmortem workflow.\n2. Confirm timeline, impact, contributing factors, and customer communications.\n3. Generate the draft.\n4. Replace placeholders with verified context and assigned actions.\n5. Review with the incident owner.\n6. Export the branded document and link improvement actions to tickets or changes.", "The postmortem has a factual timeline, clear actions, owners, and retained final output."),
    _workspace_guide("document-template-studio", "Use Invoice Studio document templates", "Billing & commercial", "🖼️", 63, "Choose or refine a professional branded template before it is used for client documents.", "1. Open **Invoice Studio** from Settings or Billing.\n2. Preview designs before selecting one.\n3. Confirm logo, colours, payment language, and document blocks.\n4. Apply the design to the intended document type.\n5. Generate a controlled preview with real-looking test data.\n6. Review the PDF before publishing it for client delivery.", "The selected template renders the correct branding and document information in preview and PDF."),
    _workspace_guide("knowledge-base-authoring", "Create a technician knowledge article", "Knowledge & Docs", "📚", 70, "Create rich, maintainable technician documentation with a clear audience, review cycle, images, and related work.", "1. Open **Knowledge & Docs > Knowledge Base**.\n2. Search for an existing article first.\n3. Choose **New article** and write a clear title and technician summary.\n4. Add rich content, tables, links, HTML where appropriate, and annotated screenshots.\n5. Set category, owner, visibility, and review date.\n6. Preview and publish only after the procedure is verified.", "The article is searchable, owned, readable, visually supported, and linked to the relevant client or operational workflow."),
    _workspace_guide("auto-documentation", "Generate and review auto-documentation", "Knowledge & Docs", "🪄", 71, "Turn a supported NexusMSP data source into a polished document that a technician reviews before publishing.", "1. Open **Knowledge & Docs > Auto-Docs**.\n2. Select the document type, client, and data scope.\n3. Generate the draft.\n4. Review every section, visual, and placeholder against the source data.\n5. Edit the narrative and add missing context.\n6. Publish or attach the reviewed document to the client record.", "The result is professionally formatted, client-correct, and marked as reviewed rather than an unverified automated output."),
    _workspace_guide("it-documentation", "Maintain structured IT documentation", "Knowledge & Docs", "🗃️", 72, "Maintain asset, network, process, and client information as accessible operational documentation.", "1. Open **Knowledge & Docs > IT Docs**.\n2. Select the client and document type.\n3. Update the structured fields and linked assets.\n4. Add screenshots or diagrams when they reduce ambiguity.\n5. Set an owner and review cadence.\n6. Link implementation work back to its ticket or change.", "A technician can find current, owned documentation without relying on historical tickets or chat."),
    _workspace_guide("projects-workspace", "Manage a project workspace", "Client operations", "📈", 28, "Plan delivery work with milestones, owners, linked tickets, and client context.", "1. Open **Projects** and select or create the client project.\n2. Define scope, milestones, owner, dates, and commercial reference.\n3. Link delivery tickets and dependencies.\n4. Update progress from verified work, not assumptions.\n5. Record blockers and client decisions.\n6. Close with handover evidence and any support transition ticket.", "The project has a current owner, milestone status, linked work, and a clear completion or escalation state."),
    _workspace_guide("leads-campaigns", "Work a lead through the pipeline", "Client operations", "🎯", 29, "Convert a qualified lead into tracked commercial work without losing mailbox and communication history.", "1. Open **Leads** and search for the contact or organisation.\n2. Review inbound mailbox history and duplicate matches.\n3. Set stage, owner, source, next action, and expected value.\n4. Add notes and communications from the lead record.\n5. Create a client onboarding or service opportunity only after qualification.\n6. Record the outcome when won, lost, or deferred.", "The lead has an owner, next action, complete communication history, and a traceable conversion path."),
    _workspace_guide("onboarding-blueprints", "Build an onboarding blueprint", "Client operations", "🏗️", 30, "Create reusable parent-and-child delivery templates for consistent client onboarding.", "1. Open **Client Onboarding** and choose the blueprint manager.\n2. Define the parent outcome and required client fields.\n3. Add child ticket templates, dependencies, owners, and validation criteria.\n4. Test the blueprint with a non-production client record.\n5. Review the generated tickets and fix duplication or missing handover work.\n6. Publish the blueprint with a named owner and review date.", "The blueprint consistently creates the required linked work without manual reconstruction."),
])

CURATED_ARTICLES.extend([
    _workspace_guide(
        "mission-control-and-nexus-command",
        "Use Mission Control and Nexus Command",
        "Getting started",
        "⌨️",
        2,
        "Start the day from one live operating picture, find any Nexus record, and open approval-aware workflows without hunting through modules.",
        "1. Open the NexusMSP home page to load **Nexus Mission Control**.\n"
        "2. Review Client Health, Security, Infrastructure, Billing, Automation, and AI Insights.\n"
        "3. Open an item in **Needs attention** to work from its source record.\n"
        "4. Press **Ctrl+K** on Windows or **Cmd+K** on macOS from anywhere in NexusMSP.\n"
        "5. Search a client, asset, ticket, invoice, PBX, backup, product, person, or knowledge article.\n"
        "6. Or describe an outcome such as `Reset John's MFA`, `Remote into Reception PC`, or `Restart the failed backup`.\n"
        "7. Review the workspace, target, permissions, and approval before running a change.\n"
        "8. Return to Mission Control and confirm the source status and audit evidence.",
        "Mission Control shows source-backed counts, Ctrl/Cmd+K opens one global command surface, and protected requests open a scoped review workflow before a change is performed.",
        related="[Open Mission Control](/), [Open Nexus Control Plane](/control-plane), [Open AI Operations](/auto-ops), and [Review the client timeline](/client-insights?tab=client-timeline).",
        before="- Confirm the correct client and that your role has access to the destination workspace.\n"
        "- Treat each panel count as a route into source evidence.\n"
        "- Protected actions still require configured approval when started through Nexus Command.",
        audit="- Mission Control is read-only and does not create synthetic incidents or claim fixes without matching execution records.\n"
        "- Slash commands use the audited team-command handler.\n"
        "- Intent requests route to the owning workspace, where approval and execution evidence remain authoritative.",
        at_a_glance="- **Expected time:** 2-5 minutes\n"
        "- **Risk:** Low for search and review; varies by selected workflow\n"
        "- **Required access:** Normal NexusMSP access plus destination permissions\n"
        "- **Evidence location:** Source workspace, linked ticket or client timeline, and execution history",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| Ctrl/Cmd+K does not open | Browser focus or an operating-system shortcut conflict | Use the **Nexus Command** header button |\n"
        "| A record is not found | Spelling, permissions, ownership, and source synchronisation | Verify the owning workspace before widening scope |\n"
        "| A panel count looks stale | Provider sync, agent check-in, and last refresh | Refresh once, then investigate the owning workspace |\n"
        "| Nexus understood the wrong intent | Action words and target name | Close the review workflow; no change has run |\n"
        "| A protected action is blocked | Role, approval policy, client scope, and source connection | Request approval or escalate through the linked ticket |",
        rollback="Search and navigation do not change operational state. Close an incorrect workflow before submission. If a later approved action targets the wrong record, use the owning workspace's rollback and incident process and retain the audit history.",
        screenshots=[],
    ),
])

CURATED_ARTICLES.extend([
    _workspace_guide(
        "nexus-second-brain",
        "Use Nexus Second Brain",
        "Automation & intelligence",
        "🧠",
        2,
        "Search institutional memory, review recurring operational patterns, identify documentation gaps, and capture team expertise without turning inference into fact.",
        "1. Open **Insights Hub > Second Brain**.\n"
        "2. Read the privacy statement and confirm the view is using only this NexusMSP tenant.\n"
        "3. Review the evidence, pattern, knowledge-gap, expertise, and recommendation tiles.\n"
        "4. Use **Ask Nexus memory** for a client, technician, ticket phrase, device, runbook, or historical question.\n"
        "5. Open a result and validate the direct ticket, knowledge, runbook, client, or audit record.\n"
        "6. Expand a pattern to review every linked ticket before accepting its significance.\n"
        "7. Read **Why Nexus suggested this**, the confidence label, and the evidence count on each recommendation.\n"
        "8. Choose the owning workspace action only when the evidence supports it. Second Brain itself never executes the proposed work.\n"
        "9. Select **Useful** to record that the recommendation helped, or **Snooze** or **Dismiss** with a clear reason.\n"
        "10. Review Memory Coverage and improve missing client, asset, ownership, resolution, documentation, or runbook evidence at its source.",
        "Every surfaced pattern has at least two matching ticket records, every search result opens a direct Nexus record, recommendations explain their evidence and confidence, and technician review decisions are retained without executing an external change.",
        related="[Open Nexus Second Brain](/insights), [Review ticket pattern discovery](/blueprints?tab=patterns), [Open Knowledge & Docs](/documentation-hub?tab=library), [Open Automation Studio](/workflow-automation), and [Review Audit Trail](/audit-trail).",
        before="- Keep ticket client, asset, category, owner, resolution, and closure evidence current.\n"
        "- Treat an emerging pattern as a prompt to investigate, not a proven root cause.\n"
        "- Confirm the source record before routing work, publishing documentation, or creating automation.\n"
        "- Do not use outcome evidence as an employee performance score.",
        audit="- Memory search is read-only and returns direct records ranked by matching evidence.\n"
        "- Pattern detection requires corroborating tickets and explicitly states that Nexus has not inferred causation.\n"
        "- Recommendation reviews record technician, decision, reason, timestamp, correlation ID, and `external_changes: false`.\n"
        "- Snooze and dismiss decisions require a reason and are retained in Audit Trail and the tamper-evident event ledger.\n"
        "- Cross-MSP intelligence sharing is disabled; no client data is contributed to a shared telemetry network.",
        at_a_glance="- **Expected time:** 2-10 minutes for a memory search or recommendation review\n"
        "- **Risk:** Read-only until the technician opens an owning operational workflow\n"
        "- **Required access:** Insights Hub plus permission to open the linked source record\n"
        "- **Evidence location:** Source ticket, runbook, knowledge article, client record, Audit Trail, and Black Box",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| Search returns no result | Spelling, client name, source workspace, and recorded wording | Search a distinctive ticket phrase or open the source workspace; Nexus will not fabricate a match |\n"
        "| No pattern appears | Matching ticket count and ticket descriptions | Record consistent categories and symptoms; Nexus requires at least two records |\n"
        "| A knowledge gap looks wrong | Published runbook and article title, tags, summary, and content | Update the owning knowledge record, then refresh Second Brain |\n"
        "| Expertise evidence is sparse | Resolved ticket owner and closure status | Correct the ticket record; do not manually inflate a profile |\n"
        "| A recommendation is not applicable | Linked evidence and current client context | Dismiss it with a reason so the decision remains auditable |\n"
        "| Memory coverage is low | Client, asset, ownership, resolution, documentation, and runbook fields | Improve the authoritative source record rather than editing the score |",
        rollback="Second Brain does not execute operational changes. Reset an incorrect review decision from the recommendation card. If a technician followed a linked workflow in error, use that workspace's change, rollback, and incident process while preserving the Second Brain review evidence.",
        screenshots=[],
    ),
    _workspace_guide(
        "automation-studio-simulation",
        "Build and simulate an automation",
        "Automation & intelligence",
        "⚙️",
        3,
        "Create a governed no-code or JSON workflow, preview every proposed change, and submit material work for independent approval without touching a client system.",
        "1. Open **Automation > Automation Studio**.\n"
        "2. Create a disabled draft or open **Automation Marketplace** and preview a Nexus-verified operational pack.\n"
        "3. Review every included component, required connection, declared permission, trust boundary, estimated setup time, and lifecycle stage before installation.\n"
        "4. Choose **All clients** for a reusable baseline or **One client** for a dedicated scoped copy. A client-scoped installation cannot proceed until a client is selected.\n"
        "5. Install the pack. Nexus creates its workflow, inactive ticket blueprint, editable documentation templates, disabled policy drafts and disabled exception rule together without making an external change.\n"
        "6. Open **Configure installed pack**, choose the observed trigger, and add conditions that constrain the client, user, asset, severity, or schedule.\n"
        "7. Add AI, approval, action, notification, and documentation steps in the required order.\n"
        "8. Complete every required connector and target field, then save the draft.\n"
        "9. Choose an optional client context and target, then select **Simulate**.\n"
        "10. Review the predicted before/after state, systems touched, risk, configuration gaps, and step-by-step rollback plan.\n"
        "11. Correct any configuration gaps and simulate again.\n"
        "12. For a material workflow, record a justification and select **Submit to Change Management**.\n"
        "13. Have an independent reviewer approve the linked change before enabling the workflow.\n"
        "14. Open **Runtime** to watch the durable run, including queued, running, waiting, approval, completed, or failed state.\n"
        "15. At an approval boundary, select the run, record the decision reason, then approve and resume or reject it.\n"
        "16. If a step fails, read the exact connector or configuration error. Retry only after correcting the cause.\n"
        "17. When reversible checkpoints are available, record a recovery reason and choose **Compensate safely**. Nexus restores a value only when it still matches the value written by that run.\n"
        "18. Review the final workflow log, client timeline, ticket evidence, runtime correlation ID, and connector response.",
        "The workflow remains disabled until its configuration is complete; Simulation Mode shows zero executed actions; the linked change contains the simulation ID, risk, before/after plan, rollback, requester, and approval history; and every live run retains restart-safe step checkpoints.",
        related="[Open Automation Studio](/workflow-automation), [Open durable runtime](/workflow-automation?tab=runtime), [Browse Automation Marketplace](/workflow-automation?tab=marketplace), [Review simulations](/workflow-automation?tab=simulations), and [Open Change Management](/change-management).",
        before="- Confirm the workflow owner, business outcome, client scope, and authorised connector.\n"
        "- Use a non-production client or narrowly scoped target for the first simulation.\n"
        "- Verify that destructive, identity, licensing, voice, scripting, and external-message steps have a tested rollback.\n"
        "- Do not place secrets in workflow fields or JSON.",
        audit="- Installing a pack records its ID, semantic version, technician, client scope, workflow ID, component manifest and `external_changes: false` in both Audit Trail and the tamper-evident Black Box.\n"
        "- The workflow, ticket blueprint, document templates, policies, security or recovery baselines and alert rule share one installation ID so the pack can be traced as a unit.\n"
        "- Removing a pack requires a deliberate hold, is blocked while its workflow is active, disables every managed component and preserves installation, removal and execution evidence.\n"
        "- Every simulation records who ran it, the workflow version, context, predicted steps, missing fields, risk, rollback, and `will_execute: false`.\n"
        "- Approval submission creates a linked Change Management record and does not execute the workflow.\n"
        "- Live dispatch accepts only enabled workflows with an approved or no-approval-required state.\n"
        "- Platform events deduplicate runs by workflow and source event. Each run snapshots its workflow version, trigger context, step order, correlation ID, attempts, waits, approvals, and before/after checkpoints.\n"
        "- Unavailable connectors stop the run with an explicit failure; Nexus never invents a provider response or marks a skipped external change successful.\n"
        "- Compensation records completed, manual-review, and conflict outcomes. A later technician change is never overwritten silently.",
        at_a_glance="- **Expected time:** 10-30 minutes for configuration and simulation\n"
        "- **Risk:** None during simulation; execution risk is calculated from the configured steps\n"
        "- **Required access:** Automation Studio plus the destination workspace and Change Management for material actions\n"
        "- **Evidence location:** Simulation history, Change Management, workflow execution logs, source ticket or client timeline, and Audit Trail",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| Workflow cannot be enabled | Last simulation, configuration gaps, and approval state | Resolve gaps, simulate again, and complete approval |\n"
        "| Simulation is blocked | Missing fields shown against each step | Configure only the approved target and rerun Simulation Mode |\n"
        "| A pack shows Configuration Required | Pack lifecycle, component list and workflow source-pack badge | Choose **Review & configure** and complete each disabled draft; do not install a duplicate |\n"
        "| A pack cannot be removed | Enabled workflow or active queued, waiting, approval or running execution | Pause the workflow and let active runs finish or cancel them through the governed runtime |\n"
        "| Approval cannot be submitted | Justification length, simulation ID, client scope, and existing open change | Use the existing linked change or record a complete rationale |\n"
        "| Run is waiting | Wake time and persisted current step in Runtime | Leave it queued; restarting Nexus does not lose the continuation |\n"
        "| Run needs approval | Approval group, protected step, client scope, and decision rationale | Approve or reject from Runtime; do not bypass the boundary |\n"
        "| Connector action failed | Integration health, credentials, endpoint enrolment, and permissions | Fix the connection, then retry the failed step with a reason |\n"
        "| Compensation reports conflict | Current source value compared with the run's recorded after-state | Review manually; Nexus preserved the later change instead of overwriting it |\n"
        "| JSON will not apply | JSON syntax and the trigger/conditions/actions structure | Restore the last saved draft and correct the JSON offline |",
        rollback="Pause the workflow immediately if its scope, target, or connector response is unexpected. Do not delete its simulations or execution logs. Follow the generated rollback steps in reverse order, validate each source system, record the outcome in the linked change and ticket, and keep the workflow disabled until a new simulation and approval are complete.",
        screenshots=[],
    ),
])

CURATED_ARTICLES.extend([
    _workspace_guide(
        "security-graph-investigation",
        "Investigate an exposure in Security Graph",
        "Infrastructure & security",
        "🕸️",
        4,
        "Trace attributable identity, endpoint, control, detection, and client relationships, then act from the source record without treating missing evidence as a pass.",
        "1. Open **SOC Dashboard > Workspace > Security graph**, or choose **Security Graph** from Mission Control.\n"
        "2. Filter to the client and severity you are investigating.\n"
        "3. Read the path from left to right and inspect the evidence shown for every relationship.\n"
        "4. Select **Open evidence** to validate the source endpoint, SOC alert, vulnerability, or Nexus Canary record.\n"
        "5. Confirm the affected identity and client scope before containing or changing anything.\n"
        "6. Create or update the incident ticket and record ownership, impact, and the containment decision.\n"
        "7. Remediate the highest-impact verified control gap.\n"
        "8. Refresh the source connector, rerun the agent assessment, and confirm the path changes or clears.\n"
        "9. Preserve accepted-risk decisions through the owning vulnerability, ticket, or change workflow.",
        "Every displayed node and edge can be traced to a persisted NexusMSP record, the technician has validated the source record, and remediation or accepted risk has a named owner and retained evidence.",
        related="[Open Security Graph](/security-graph), [Open the SOC Dashboard](/security-dashboard), [Review Nexus Shield](/nexus-shield), and [Open Change Management](/change-management).",
        before="- Confirm the client and the source connector's last successful sync.\n"
        "- Treat an empty graph as no matching recorded evidence, not proof that the client is secure.\n"
        "- Use the source record as the authority for isolation, remediation, and closure.\n"
        "- Require approval before any client-impacting containment or broad security change.",
        audit="- The graph is read-only and does not create synthetic alerts, identities, privileges, or services.\n"
        "- Endpoint relationships come from Nexus Agent inventory; detection paths come from persisted SOC, vulnerability, and Canary records.\n"
        "- Source actions remain in their owning audited workflows.\n"
        "- Accepted risk must retain its rationale, owner, review date, and source finding.",
        at_a_glance="- **Expected time:** 5-20 minutes for initial scope validation\n"
        "- **Risk:** Low for graph review; containment and remediation vary by source action\n"
        "- **Required access:** Security Graph plus access to the owning evidence workspace\n"
        "- **Evidence location:** Source endpoint or detection record, incident ticket, Change Management, and Audit Trail",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| The graph is empty | Client filter, agent check-in, connector health, and source data | Validate one known source record; do not treat empty as compliant |\n"
        "| An identity is missing | Assigned user and last signed-in user in endpoint inventory | Correct the source association, then refresh the graph |\n"
        "| A path looks stale | Source timestamp and connector sync | Refresh the owning connector before closing work |\n"
        "| A relationship looks wrong | Client ID, endpoint ownership, and alert association | Correct the source record rather than editing the graph |\n"
        "| Open evidence is unavailable | Permissions and legacy source route | Escalate through the incident ticket and retain the path ID |",
        rollback="Security Graph itself is read-only. If a source remediation or containment action was incorrect, stop further work, use the owning workspace's rollback or release control, validate endpoint and identity state, and record the correction in the linked incident and change.",
        screenshots=[],
    ),
])
