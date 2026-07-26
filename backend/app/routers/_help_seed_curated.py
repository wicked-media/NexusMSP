"""Task-first NexusMSP Help Centre catalogue.

Every shipped article follows the same technician-friendly structure:
outcome, prerequisites, workflow, verification, and audit evidence.  This is
intentionally separate from the old feature-notes catalogue so the Help Centre
can stay useful in the moment of work rather than becoming an implementation
archive.
"""

HELP_CATALOG_VERSION = "2026-07-25-guide-system-v10.0-durable-automation-runtime"


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
        "1. Open **My Workspace** and confirm your profile, notification preferences, and working hours.\n2. Open **Morning Checks** to review priority alerts, backups, and handover items.\n3. Open **Tickets** and use the queue filters to identify your assigned and unassigned urgent work.\n4. Set your availability in **Team** if you are starting, pausing, or finishing a shift.",
        "Your dashboard should show current data, your ticket queue should be visible, and your availability should be correct for dispatch.",
        "Use ticket notes for customer work. Use Team Chat or the handover workflow for internal operational context; never place credentials in either.",
        "[Ticket triage](/help/ticket-triage) and [Morning checks](/help/morning-checks).",
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
        "1. Open **Backups** and review the live ticker, failures, and overdue verification items.\n2. Filter to the affected client or asset.\n3. Review the last successful job and failure reason.\n4. Escalate or remediate the failure using the linked ticket.\n5. Schedule or record a restore verification.\n6. Confirm the client mapping and billable usage before the recurring billing run.",
        "The latest job state is current, failed protection has an owner, and a completed restore has evidence of what was recovered and when.",
        "Use the linked ticket for customer impact. Keep restore evidence in the backup record and client documentation.",
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
    _reference_guide("morning-checks", "Run the morning service checks", "Start here", "☀️", 4, "Start the day from a prioritised operational check list and turn exceptions into owned work."),
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
        outcome="Technicians can identify the owning Nexus product, open it safely, and understand whether the workflow is Nexus-native or provider-backed.",
        steps="1. Open **Platform > Nexus Suite**.\n"
        "2. Review the four summary tiles to confirm the number of products, Nexus-native workspaces, provider-backed products, and product families.\n"
        "3. Search for an outcome such as `remote`, `billing`, `identity`, `backup`, or `automation` rather than memorising a menu path.\n"
        "4. Filter by product family when you need a security, infrastructure, business, or intelligence workspace.\n"
        "5. Read the delivery badge before opening a product. **Nexus native** means the workflow is built into NexusMSP. **Provider-backed** means NexusMSP preserves the approved external authority.\n"
        "6. Select **Open** to enter the owning workspace.\n"
        "7. Use **Nexus Store** for governed connectors, automation packs, technician script packs, and commercial catalogue items.\n"
        "8. Validate every provider connection in Settings or Integrations before relying on its health or evidence.",
        verify="Each product opens its owning workspace, provider-backed products clearly state their security boundary, and the Suite page shows source-backed evidence counts without labelling an unverified provider healthy.",
        related="[Open Nexus Suite](/nexus-suite), [Open Nexus Store](/nexus-suite?view=store), [Review integrations](/integrations), and [Open Nexus Control](/control-plane).",
        before="- Use your normal NexusMSP role; destination permissions still apply.\n"
        "- Confirm the correct client before performing an action in a product workspace.\n"
        "- Keep passwords in Keeper, controlled client documentation in Hudu, and MFA or identity authority in Microsoft.\n"
        "- A product being available does not mean its external provider is configured or healthy.",
        audit="- Existing routes remain valid for backwards compatibility.\n"
        "- Nexus Vault routes to approved Keeper/Hudu context and does not store a duplicate password vault.\n"
        "- Nexus Verify routes to Microsoft-backed identity evidence and does not store MFA seeds.\n"
        "- Actions remain auditable in their owning workspace, linked ticket, client timeline, and provider history.",
        at_a_glance="- **Expected time:** 2-5 minutes\n"
        "- **Risk:** Low for navigation; destination workflow risk still applies\n"
        "- **Required access:** NexusMSP plus the selected product permission\n"
        "- **Evidence location:** Product workspace, linked client timeline, Audit Trail, and provider history",
        troubleshooting="| Symptom | Check | Safe response |\n"
        "|---|---|---|\n"
        "| A product opens but has no data | Provider connection, selected client, permissions, and last sync | Validate the owning integration before making a health claim |\n"
        "| A product is not found in search | Search the outcome, capability, or product family | Clear the family filter and search again |\n"
        "| Vault or Verify does not expose a secret | This is intentional provider-backed behaviour | Open the approved Keeper, Hudu, or Microsoft record through the linked workflow |\n"
        "| An old bookmark uses a previous name | Compatibility route and destination workspace | Continue with the destination and update internal documentation when convenient |\n"
        "| A Store entry cannot run | Installation, connector configuration, approval, and client scope | Simulate and validate the connection before enabling execution |",
        rollback="The Suite product map is navigational and does not change client systems. Close an incorrect destination before submitting an action. If a product workflow was already approved and run against the wrong scope, use that workspace's rollback process and preserve its audit record.",
        screenshots=[],
    ),
])

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
        "automation-studio-simulation",
        "Build and simulate an automation",
        "Automation & intelligence",
        "⚙️",
        3,
        "Create a governed no-code or JSON workflow, preview every proposed change, and submit material work for independent approval without touching a client system.",
        "1. Open **Automation > Automation Studio**.\n"
        "2. Create a disabled draft or install a Nexus-verified pack from **Automation Marketplace**.\n"
        "3. Choose the observed trigger and add conditions that constrain the client, user, asset, severity, or schedule.\n"
        "4. Add AI, approval, action, notification, and documentation steps in the required order.\n"
        "5. Complete every required connector and target field, then save the draft.\n"
        "6. Choose an optional client context and target, then select **Simulate**.\n"
        "7. Review the predicted before/after state, systems touched, risk, configuration gaps, and step-by-step rollback plan.\n"
        "8. Correct any configuration gaps and simulate again.\n"
        "9. For a material workflow, record a justification and select **Submit to Change Management**.\n"
        "10. Have an independent reviewer approve the linked change before enabling the workflow.\n"
        "11. Open **Runtime** to watch the durable run, including queued, running, waiting, approval, completed, or failed state.\n"
        "12. At an approval boundary, select the run, record the decision reason, then approve and resume or reject it.\n"
        "13. If a step fails, read the exact connector or configuration error. Retry only after correcting the cause.\n"
        "14. When reversible checkpoints are available, record a recovery reason and choose **Compensate safely**. Nexus restores a value only when it still matches the value written by that run.\n"
        "15. Review the final workflow log, client timeline, ticket evidence, runtime correlation ID, and connector response.",
        "The workflow remains disabled until its configuration is complete; Simulation Mode shows zero executed actions; the linked change contains the simulation ID, risk, before/after plan, rollback, requester, and approval history; and every live run retains restart-safe step checkpoints.",
        related="[Open Automation Studio](/workflow-automation), [Open durable runtime](/workflow-automation?tab=runtime), [Browse Automation Marketplace](/workflow-automation?tab=marketplace), [Review simulations](/workflow-automation?tab=simulations), and [Open Change Management](/change-management).",
        before="- Confirm the workflow owner, business outcome, client scope, and authorised connector.\n"
        "- Use a non-production client or narrowly scoped target for the first simulation.\n"
        "- Verify that destructive, identity, licensing, voice, scripting, and external-message steps have a tested rollback.\n"
        "- Do not place secrets in workflow fields or JSON.",
        audit="- Installing a pack records the pack ID and technician and creates a disabled draft.\n"
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
        "| A pack shows Installed | Workflow library and source-pack badge | Open the existing draft instead of installing a duplicate |\n"
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
