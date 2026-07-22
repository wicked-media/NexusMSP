"""Modern help center seed.

This is the canonical seed for help articles after the great dedup audit.
The `STALE_SLUGS` list contains old article slugs that should be removed from
the DB during a reseed because they reference modules that have been merged
or removed.

The reseed endpoint in `chat_help.py` will:
  1. Delete every doc whose slug is in `STALE_SLUGS`.
  2. Upsert every doc in `MODERN_ARTICLES` (overwrites existing).
  3. Leave admin-authored custom articles alone.
"""

# Stale slugs that referenced merged / deleted modules. Safe to remove.
HELP_CATALOG_VERSION = "2026-07-21-security-evidence-v4"

STALE_SLUGS = [
    # The "*-audit" articles were one-off audits, not user docs
    "qbr-page-audit",
    "scheduling-audit",
    "reports-hub-audit",
    "insights-hub-audit",
    "hudu-audit",
    "soc-audit",
    "unifi-audit",
    "cipp-audit",
    "pax8-audit",
    "devices-page-audit",
    "invoice-detail-audit",
    "backup-page-audit",
    # These referenced standalone pages that have been merged into hubs
    "tickets-toolbar-reference",  # superseded by tactical-ticket-console-v2
    "stale-agent-radar",          # rolled into device-smart-bar
    "outage-detective",           # rolled into auto-ops-hub
    "trmm-reliability",           # Tactical RMM workspace retired for Nexus Agent
    "bulk-trmm-actions",          # replaced by Managed Assets bulk actions
    "huntress-soc",               # replaced by provider-backed security guidance
]


MODERN_ARTICLES = [
    # â”€â”€ What's New (auto-updated mirror of /api/changelog) â”€â”€
    {
        "slug": "whats-new",
        "title": "What's New in NexusMSP",
        "category": "Release Notes",
        "icon": "ðŸ†•",
        "order": -1,
        "summary": "Latest features, merges and fixes â€” newest first.",
        "body_md": """## Latest Releases

> Tip: the dashboard tile **What's New** shows the most recent 3 entries with a "new since you visited" counter. Click any entry to jump to the corresponding module.

### 2026-06-25 â€” Big Cleanup (modules merged & dedup'd)
- Deleted 27 orphan files (25 unused frontend pages, 2 empty backend stubs).
- 12 backend routers merged into 6 canonical ones â€” endpoint paths unchanged.
- Settings now has 16 tabs (was 8). Deep-links work via `?tab=<id>`.
- Four new conceptual hubs introduced:
  - **Client Insights** â€” `/client-insights` â€” Customer Health Â· RMM Health Â· Risk Â· Sentiment Â· Timeline.
  - **Auto-Ops Hub** â€” `/auto-ops` â€” Triage Queue Â· Smart Routing Â· Auto-Resolve Â· Self-Healing.
  - **Credential systems** â€” Keeper holds credentials, Hudu holds controlled documentation, and Microsoft manages MFA.
  - **Team Hub** â€” `/team-hub` â€” Command Center Â· Technicians Â· Roster Â· Utilization Â· Skills Â· Leaderboard.

### 2026-06-24 â€” Tactical Ticket Console v2
- New `TicketConsoleHeader.jsx` is a single-row header that fits all status + SLA + owner + actions in 64px.
- **Change Customer** button reassigns a ticket to a different client in 2 clicks (POST `/api/tickets/{id}/change-customer`).
- The legacy header is still available â€” toggle it in the widget layout settings.

### 2026-06-23 â€” M365 Command Center (CIPP-killer)
- Multi-tenant lens for M365: tenants, users, standards, GDAP, security & alerts.
- 15 seeded standards, 8 Conditional Access templates, 5 scripted alerts.
- Currently using **mock data** â€” wire up MS Partner Center credentials in Settings â†’ Integrations to switch live.

### 2026-06-22 â€” Autonomous Maintenance Windows
- Schedule cron-style fan-out maintenance: reboot, install patches, run scripts.
- Per-device success/failure with a Nexus AI-generated summary.
- Schedule one from the Devices page.

### 2026-06-21 â€” Syncro-killer Device Smart Bar
- Inline action strip on every device row (diagnose Â· restart agent Â· push script Â· live metrics).
- AI Diagnose for one-click "why is this device sad?" answer.

### 2026-06-20 â€” Invoice Studio + Smart Billing Engine
- Drag-and-drop invoice template builder.
- AI drafts invoices from ticket time + parts.
- Aged AR insights, renewal risk, smart recurring billing.
""",
    },

    # â”€â”€ Getting Started (refreshed) â”€â”€
    {
        "slug": "getting-started",
        "title": "Getting Started with NexusMSP",
        "category": "Basics",
        "icon": "ðŸš€",
        "order": 0,
        "summary": "Your first 10 minutes inside the platform.",
        "body_md": """## Welcome
NexusMSP is your MSP command-and-control hub. Here's what to do in your first session:

1. **Sign in** at the login screen with the credentials your admin provided.
2. **Open the Dashboard** â€” your default landing page. The **What's New** tile (top-right) keeps you in the loop as features land.
3. **Press Cmd/Ctrl+K** anywhere to open the command palette and jump to any module.
4. **Open Tickets** to see queued work assigned to you.
5. **Set your status** â€” click the LED dot beside your name (bottom-right). ðŸŸ¢ Active Â· ðŸŸ  DND Â· ðŸ”µ Break.

## Sidebar layout
- **Service Desk** â€” Dashboard Â· Workspace Â· Tickets Â· Dispatch Â· Change Â· Team Â· Scheduling Â· Live Support.
- **Infrastructure** â€” Devices Â· Network Â· Assets Â· Backup Â· Automation.
- **Business** â€” Clients Â· Client Portal Â· CRM Â· Billing Â· Financial Analytics Â· Products Â· POs Â· Projects Â· Contracts.
- **Security** â€” SOC Â· Endpoint Â· Ransomware Â· Compliance.
- **AI & Intelligence** â€” Copilot Â· Auto-Ops Â· Knowledge & Docs.
- **Reports & Comms** â€” Command Center Â· Insights Â· Reports Â· Communications.
- **Platform** â€” Settings Â· System Health Â· Integrations.
""",
    },

    # â”€â”€ Hubs â”€â”€
    {
        "slug": "client-insights-hub",
        "title": "Client Insights Hub",
        "category": "Business",
        "icon": "ðŸ‘¥",
        "order": 10,
        "summary": "All client lenses in one tabbed view.",
        "body_md": """## Where
`/client-insights` (Sidebar â†’ Business â†’ Clients â†’ Client Insights Hub)

## Tabs
- **Customer Health** â€” NPS, CSAT, churn signal.
- **RMM Health** â€” uptime, agent status, alert volume.
- **Risk** â€” composite churn-risk score per client.
- **Sentiment** â€” AI-derived sentiment from ticket threads.
- **Timeline** â€” chronological feed of every touchpoint.

Deep-link directly to a tab: `/client-insights?tab=customer-health`.
""",
    },
    {
        "slug": "auto-ops-hub",
        "title": "Auto-Ops Hub",
        "category": "AI & Intelligence",
        "icon": "ðŸ¤–",
        "order": 11,
        "summary": "Triage, route, resolve and self-heal â€” all automation surfaces in one place.",
        "body_md": """## Where
`/auto-ops` (Sidebar â†’ AI & Intelligence â†’ AI Copilot â†’ Auto-Ops Hub)

## Tabs
- **Triage Queue** â€” unassigned tickets ordered by AI-scored urgency.
- **Smart Routing** â€” rules that auto-assign tickets based on tech skills, load and availability.
- **Auto-Resolve** â€” tickets that Nexus AI can close end-to-end (with audit trail).
- **Self-Healing** â€” devices that recovered on their own thanks to runbooks.

Deep-link: `/auto-ops?tab=ai-resolution`.
""",
    },
    {
        "slug": "credentials-hub",
        "title": "Credential systems: Keeper, Hudu, and Microsoft",
        "category": "Security",
        "icon": "ðŸ”",
        "order": 12,
        "summary": "Where password records, client documentation, and MFA controls are managed outside NexusMSP.",
        "body_md": """## System ownership
- **Keeper** is the password and secret source of truth.
- **Hudu** is the controlled client documentation and credential-reference workspace.
- **Microsoft 365 / Entra** manages Microsoft MFA policy, enrolment, and enforcement.

## Credential boundary
NexusMSP does not store, reveal, rotate, or enforce passwords or MFA. Keep secrets out of tickets, chat, client notes, screenshots, and documentation.

## Where to work
- Open **Hudu** from the sidebar for client documentation and linked credential references.
- Use **Keeper** to create, retrieve, approve, and rotate passwords.
- Use the **Microsoft 365** workspace or Microsoft Entra for MFA posture and enforcement.

Legacy NexusMSP credential links redirect safely to Hudu or Microsoft 365.
""",
    },
    {
        "slug": "team-hub",
        "title": "Team Hub",
        "category": "Service Desk",
        "icon": "ðŸ§‘â€ðŸ’¼",
        "order": 13,
        "summary": "Six team lenses, one tabbed surface.",
        "body_md": """## Where
`/team-hub` (Sidebar â†’ Service Desk â†’ Team â†’ Team Hub)

## Tabs
- **Command Center** â€” live who-is-on-what.
- **Technicians** â€” roster and contact details.
- **Roster** â€” shift planning calendar.
- **Utilization** â€” billable vs non-billable per tech.
- **Skills Matrix** â€” competency grid.
- **Leaderboard** â€” gamified perf board.

Deep-link: `/team-hub?tab=utilization`.
""",
    },

    # â”€â”€ Settings hub â”€â”€
    {
        "slug": "settings-hub",
        "title": "Settings (16-tab hub)",
        "category": "Platform",
        "icon": "âš™ï¸",
        "order": 20,
        "summary": "Everything you used to chase across 10 pages is now one tabbed Settings page.",
        "body_md": """## Where
`/settings` (Sidebar â†’ Platform â†’ Settings)

## Tabs (in order)
| Tab | Purpose |
|---|---|
| Platform Branding | Logo, colours, favicon, invoice header/footer |
| General | Profile, job numbering, escalation thresholds, canned responses |
| Service Tiers | Bronze/Silver/Gold/Platinum/Diamond SLA tiers |
| Authentication | Microsoft SSO, JWT settings |
| Mailbox & Email | O365 inbox, email signatures |
| Integrations | Xero, Stripe, Microsoft 365 Email, SMS, Acronis, Pax8, Huntress, SupED, CIPP, UniFi, TRMM, Splynx, Hudu, Syncro |
| AI & Automation | Provider, model, OpenAI API key |
| Notifications | Email/SMS alert preferences |
| Ticket Defaults | Numbering, SLA, workflows |
| Ping & Escalation | Live alerts, sounds, notification rules |
| White Label | Brand the customer-facing portal |
| Channel / MSP Mode | Channel-partner vs direct-MSP mode toggles |
| API Tokens | Issue/revoke API tokens for scripts/integrations |
| 2FA / Security | 2FA enrolment and recovery |
| Notify Channels | Slack/Teams webhooks |
| My Workspace | Per-tech UI density, views, personal toggles |

Deep-link any tab: `/settings?tab=integrations` or `/settings?tab=tickets`.
""",
    },

    # â”€â”€ Marquee features â”€â”€
    {
        "slug": "tactical-ticket-console-v2",
        "title": "Tactical Ticket Console v2",
        "category": "Service Desk",
        "icon": "ðŸŽ«",
        "order": 30,
        "summary": "Cleaner ticket detail header, Change Customer flow, legacy toggle.",
        "body_md": """## What changed
The old ticket detail view stacked four header panels and felt cluttered. v2 collapses everything into a single-row `TicketConsoleHeader` with status, SLA pill, priority, owner, client and quick actions.

## Change Customer
Click the client name in the console header â†’ search â†’ confirm. The ticket reassigns instantly. Thread history, time entries and devices stay attached.

## Where the old header went
Power users can restore the old multi-panel header via the layout settings (`legacyHeader` toggle). Nothing was deleted â€” just tucked away.

## Endpoints
- `POST /api/tickets/{ticket_id}/change-customer` â€” body `{ "client_id": "..." }`.
""",
    },
    # Retained only as source history. The replacement article below is the
    # shipped help entry; do not seed the former mock-first documentation.
    *([] if True else [{
        "slug": "m365-command-center",
        "title": "M365 Command Center",
        "category": "Integrations",
        "icon": "ðŸŸ¦",
        "order": 31,
        "summary": "CIPP-style multi-tenant lens for Microsoft 365.",
        "body_md": """## Where
`/m365` (Sidebar â†’ Platform â†’ Integrations â†’ M365 Center)

## Tabs
- **Tenants** â€” list/search, secure score, MFA %, deep links to Entra/Exchange/Intune/SharePoint/Defender.
- **Users** â€” search across tenants, license assignment, sign-in status.
- **Standards** â€” 15 baseline standards; toggle, schedule, run and auto-remediate.
- **GDAP** â€” relationship health, expiry alerts, +1y extend, 4 role templates.
- **Security** â€” MFA analytics by method, 30-day Secure Score trend, 8 Conditional Access templates, 5 scripted alerts.
- **Alerts** â€” impossible travel, new admin, mass delete, inbox forward external, guest admin.
- **Connection** â€” paste app_id / tenant_id / app_secret / refresh_token to go live.

## Currently
Mock data. The MOCK badge in the top-right will disappear once Connection credentials are saved.
""",
    }]),
    {
        "slug": "m365-command-center",
        "title": "Microsoft 365 evidence workspace",
        "category": "Integrations",
        "icon": "cloud",
        "order": 31,
        "summary": "Evidence-first Microsoft 365 connection readiness, guardrail planning and verified provider telemetry.",
        "body_md": """## Where
`/m365` (Sidebar > Platform > Integrations > Microsoft 365)

## What the workspace shows
- **Tenants** only shows tenant, user, MFA, Secure Score and GDAP evidence received from a verified Microsoft Graph or Partner Center provider.
- **Guardrails** is a reference library for MSP policy planning. Turning a guardrail on stores a plan; it does not run a check or change Microsoft configuration.
- **GDAP** provides least-privilege role templates and provider-confirmed relationship evidence when a synchronisation provider is installed.
- **Security** shows verified MFA and Secure Score evidence when available, Conditional Access references, and a manual sign-in-warning snippet.
- **Detection drafts** are auditable designs only. They do not read audit logs, raise alerts, create tickets or trigger webhooks without an evaluated provider.
- **Connection** records the Entra app details required by a Microsoft Graph synchronisation provider.

## Setup path
1. Create a dedicated Entra app registration for the MSP integration.
2. Grant only the Graph application permissions the synchronisation provider requires, then obtain tenant admin consent.
3. Save the App (client) ID, Directory (tenant) ID and client secret in **Connection**.
4. Install and verify the Nexus Microsoft Graph synchronisation provider.

Saving credentials is not a successful connection test. Until the provider authenticates and records evidence, metrics stay blank. NexusMSP never creates demo tenants, posture scores, alert counts or remediation results.
""",
    },
    {
        "slug": "maintenance-windows",
        "title": "Maintenance Windows",
        "category": "Infrastructure",
        "icon": "ðŸ› ï¸",
        "order": 32,
        "summary": "Schedule fan-out maintenance: reboot, patch, scripts â€” across many devices.",
        "body_md": """## Schedule one
1. Open **Devices**.
2. Select target devices (multi-select).
3. Click **Schedule Maintenance Window**.
4. Pick the start time, cadence (one-off, weekly, monthly) and the action (reboot, run script, install patch).
5. Confirm.

The backend scheduler executes the actions at the scheduled time and writes a per-device audit trail. Each run gets a Nexus AI-generated summary (e.g. "23/25 succeeded, 2 timed out â€” both are Windows 7 boxes scheduled for retirement").

## Endpoints
- `POST /api/maintenance/windows` â€” create.
- `GET /api/maintenance/windows` â€” list.
- `GET /api/maintenance/windows/{id}/runs` â€” execution history.
""",
    },
    {
        "slug": "device-smart-bar",
        "title": "Device Smart Bar",
        "category": "Infrastructure",
        "icon": "ðŸ–¥ï¸",
        "order": 33,
        "summary": "Inline action strip on every device row.",
        "body_md": """## What you get on every row
- **Diagnose** â€” AI summary of CPU/RAM/Disk/temperature/recent tickets.
- **Restart agent** â€” bounces the RMM agent without opening the remote tools.
- **Push script** â€” drop into the script picker pre-targeted to this device.
- **Live metrics** â€” opens a drawer streaming CPU/RAM/Disk.
- **Remote** â€” launch RustDesk/Mesh/Splashtop instantly.

## Bulk
Select multiple rows â†’ the Smart Bar appears at the top with bulk actions.
""",
    },
    {
        "slug": "invoice-studio",
        "title": "Invoice Studio + Smart Billing",
        "category": "Business",
        "icon": "ðŸ’¸",
        "order": 34,
        "summary": "Drag-and-drop invoice templates plus AI-powered billing intelligence.",
        "body_md": """## Invoice Studio
`/invoice-templates` (Sidebar â†’ Business â†’ Billing & Finance â†’ PDF Templates)

Block-based template editor:
- Drag blocks (logo, address, line items, totals, signature, notes) into a page.
- Pick a preset from the **Gallery** if you don't want to start from scratch.
- Save as the active template â€” every invoice PDF uses it.

## Smart Billing
- **AI Invoice Draft** (`/api/invoices/smart/draft`) â€” pulls ticket time + parts and drafts the invoice.
- **Aged AR Insights** â€” AI summary of who owes what and why.
- **Renewal Risk** â€” contracts at risk of churn.
- **Smart Recurring** â€” generates and dispatches recurring invoices on a schedule.
""",
    },

    # â”€â”€ Help center itself â”€â”€
    {
        "slug": "using-help-center",
        "title": "Using the Help Center",
        "category": "Basics",
        "icon": "ðŸ“˜",
        "order": 99,
        "summary": "How to find docs, use setup guidance, ask the AI co-pilot, and contribute.",
        "body_md": """## Browse
Use the left rail to jump between categories. Articles are ordered by importance within each category.

## In-product setup guidance
When a technician opens a credential-based setup form, NexusMSP shows a **Before you connect** guide beside the fields. It explains where credentials come from, required permissions, a safe validation path, and how to handle the secret. Use this contextual guide first, then open the linked article if more detail is needed.

Start with [Set up integrations safely](/help/secure-integration-setup) for the standard workflow, or open the provider-specific guide such as [Connect a Yeastar PBX to Voice](/help/voice-yeastar-pbx-onboarding).

## Search
Type into the search box at the top â€” title, summary and body all match.

## AI co-pilot
Press the **Ask Co-Pilot** button. It answers using only the article corpus, with citations.

## Contribute (admins)
Hit **+ New Article**. Markdown is supported; screenshots can be uploaded inline.

## Reseed
Admins can hit **Reseed** to refresh the default articles. This also prunes stale articles (e.g. `*-audit` slugs from the old documentation pass).
""",
    },
    {
        "slug": "device-operations",
        "title": "Device Operations: inventory, health and assignment",
        "category": "Infrastructure",
        "icon": "Device",
        "order": 35,
        "summary": "Use the device workspace to verify agent data, ownership, health and recent activity.",
        "body_md": """## Start with the device header
Open **Devices**, then select a device. The header shows its name, online ping state, operating system, client and compliance posture. Use the edit action to correct the device name or assign it to the right client or contact.

## What to check
- **Overview**: CPU, memory, disk, uptime and recent health signals.
- **Software**: the inventory reported by the Nexus agent.
- **Network**: adapters, IP addresses and recent connectivity data.
- **Security**: Defender and compliance evidence reported by the device.
- **Patching**: available, approved and installed updates.
- **Audit log**: enrolment, commands, patch activity and device changes.

## If data is missing
Confirm the agent is online, then wait for its next inventory heartbeat or request a refresh. The audit log records the enrolment and collection activity so you can distinguish an agent issue from an empty data set.
""",
    },
    {
        "slug": "patching-with-winget",
        "title": "Patching and Winget",
        "category": "Infrastructure",
        "icon": "Patch",
        "order": 36,
        "summary": "Review, approve and schedule Windows and application updates safely.",
        "body_md": """## Patch workflow
1. Open a device and select **Patching**.
2. Review outstanding Windows and application updates.
3. Approve the updates that are safe for the device and its service window.
4. Schedule the approved patch action from the device or linked ticket.
5. Review the execution result and reboot state in the device audit log.

## Winget
For supported Windows endpoints, NexusMSP can use Winget to discover and update installed applications. Treat Winget packages as application patches: approve them first, schedule them in a maintenance window, then review the result. Do not use a forced update for line-of-business software without a tested rollback plan.

## Ticket-led patching
When a ticket identifies an update, link the affected device, approve the required patch and schedule it from the ticket workflow. The resulting device activity provides the evidence for the ticket resolution.
""",
    },
    {
        "slug": "ticket-workspace-and-email",
        "title": "Tickets: triage, service tiers and customer email",
        "category": "Service Desk",
        "icon": "Ticket",
        "order": 37,
        "summary": "A practical guide to creating, working and communicating from a ticket.",
        "body_md": """## Create and triage
Choose the client before saving a new ticket. NexusMSP applies that client's service tier and SLA rules automatically. Set the contact, impact, urgency, owner and linked device as needed.

## Work the ticket
Use the workspace tabs for conversation, tasks, files, time, related devices and audit history. Keep customer-facing replies in the conversation and use internal notes for technician-only context.

## Email signatures
Emails sent from a ticket use the rich signature set in **My Settings > Signature** for the signed-in technician. The composer shows the signature as a preview, while the server applies it when the email is sent so it remains consistent across ticket, workshop, field, purchase-order and invoice emails.

## Service tier changes
The service tier comes from the client account. Update the client's tier if the agreement changes; do not override it ticket-by-ticket unless an authorised exception is required.
""",
    },
    {
        "slug": "consolidated-workspaces",
        "title": "Finding consolidated workspaces",
        "category": "Basics",
        "icon": "🧭",
        "order": 38,
        "summary": "Where related tools now live after the sidebar simplification.",
        "body_md": """## One capability, one home
NexusMSP reduces duplicate navigation by grouping related views into a single page with tabs. Use the page tabs instead of looking for separate sidebar links.

| Need | Open |
|---|---|
| Technician roster, utilisation or skills | **Team Hub** |
| Connected services and their setup | **Integrations** |
| Client health, risk, sentiment or timeline | **Client Insights** |
| Triage, routing and self-healing | **Auto-Ops** |
| Passwords, client documentation, or MFA controls | **Keeper, Hudu, or Microsoft 365** |
| Dispatch board, calendar and availability | **Dispatch** |
| SLA timers, penalties and reports | **SLA Manager** |

The command palette is the quickest way to open a workspace when you know its name.
""",
    },
    {
        "slug": "nexus-agent-enrolment",
        "title": "Nexus Agent enrolment and remote access",
        "category": "Infrastructure",
        "icon": "Agent",
        "order": 39,
        "summary": "Generate a client-specific installer and validate the first device check-in.",
        "body_md": """## Generate an installer
Open **Nexus Agent**, select the target client and generate the installer or deployment command. The generated enrolment token links the endpoint to that client when the agent first checks in.

## Validate enrolment
After installation, find the device in **Devices**. Confirm its online ping, inventory, network information and audit entry. If it appears without details, allow the next inventory heartbeat and then refresh the device page.

## Remote access
Configure your approved provider in **Integrations** or **Remote Access**. NexusMSP keeps the remote action in the device control bar; credentials and server configuration remain in the integration settings. Never place server API tokens in ticket notes or customer-facing emails.
""",
    },
    {
        "slug": "products-inventory-and-ticket-billing",
        "title": "Products & Inventory: catalogue to ticket billing",
        "category": "Business",
        "icon": "Package",
        "order": 40,
        "summary": "Create products, track stock and instances, use quantity pricing, and bill the right amount from tickets.",
        "body_md": """## What this module manages
Use **Products & Inventory** for catalogue items, stock, asset-level instances, labels, bundles and quantity-break pricing. Products can then be added to tickets and invoiced with the price locked at the time of sale.

## Create a product
1. Open **Products & Inventory** and choose **Add Product**.
2. Enter a clear name, SKU, category, vendor, cost, retail price, tax rate and reorder level.
3. Set the opening quantity only when you are recording stock already on hand.
4. Leave **Active** enabled for items technicians can add to tickets.
5. Save the product. A SKU is also used as the default barcode when one is available.

## Quantity-break pricing
Use **Add Tier** to set a minimum quantity and unit price, for example `1+ = $100`, `10+ = $90`.

- The product detail page shows every saved tier under **Pricing**.
- When a technician adds the product to a ticket, NexusMSP applies the best eligible tier automatically.
- The resulting ticket and invoice line retain that price even if the catalogue price changes later.

## Stock and tracked instances
- Use **Stock Movement** for receiving, issuing or correcting quantity. Enter a reason so Stock History remains useful at audit time.
- Use **Inventory > Add Instances** for individually tracked assets such as laptops, switches or serialised hardware. NexusMSP generates a unique serial and barcode when none is supplied.
- Creating instances also creates a matching Stock History entry. Review **Stock History** to see before/after quantities, source and technician.
- Use **Barcodes & Labels** to print the master product label or an instance label.

## Bundles
Open a product, select **Bundle**, and add its component products with quantities. The bundle tab shows the component stock, cost and retail total. Remove components from the same tab when the package changes.

## Ticket and invoice workflow
1. Open the ticket for the approved work.
2. Add the product and quantity from the ticket items area. Physical inventory items cannot exceed the available on-hand stock; services, software, licences and cloud items remain billable without stock allocation.
3. Confirm the applied unit price and quantity before billing.
4. Use the ticket's invoice action to create a draft invoice or add items to an existing invoice.

The ticket keeps the sale price as an audit record; the invoice inherits that same captured price.

## Safe deletion
Deleting a product requires confirmation. It removes the catalogue product, tracked instances, stock movements and bundle references. Existing ticket and invoice line items remain as historical financial records. Prefer setting a product inactive when you want to stop new use but preserve the catalogue history.

## Quick troubleshooting
- **No product in a picker:** confirm it is active, then refresh the ticket or product page.
- **Stock does not look right:** review Stock History before making an adjustment; use a reason for every correction.
- **Tier price did not save:** reopen the product and review the tier values. Each minimum quantity must be at least 1 and prices cannot be negative.
- **Missing barcode:** open the product and choose **Generate Barcode** or use the SKU as the barcode value.
""",
    },
    {
        "slug": "chat-presence",
        "title": "Chat & Presence",
        "category": "Collaboration",
        "icon": "💬",
        "order": 4,
        "summary": "Internal chat, live presence and linked service work.",
        "body_md": """## Opening Team Chat
Open **Team Chat** from the sidebar to work in channels or direct messages. Presence lights show whether a technician is active, away, busy in service work or offline.

## Link service work in a conversation
Start a message with a slash command to add a structured work-item card to the channel. The reference must already exist in NexusMSP.

| Command | Result |
|---|---|
| `/ticket TKT-###` | Links the ticket into the conversation. |
| `/invoice INV-###` | Links the invoice into the conversation. |
| `/po PO-####` | Links the purchase order into the conversation. |
| `/ticket TKT-### status <value>` | Updates a ticket status. |
| `/ticket TKT-### priority <value>` | Updates a ticket priority. |

The linked card gives the channel shared context without pasting sensitive detail into chat. It also makes the ticket, invoice or purchase order easy to open from the conversation.

## Other useful commands
- `/assign @user TKT-###` assigns a ticket.
- `/close TKT-###` closes a ticket.
- `/sla TKT-###` displays SLA timing.
- `/page <severity>` alerts the team.
- `/help` lists the available commands in chat.

## Mentions and audit trail
Use `@name` or `@email-prefix` to notify a technician. Channel messages, linked work items and command results remain in the channel history so the service team can see the context behind a decision.
""",
    },
    {
        "slug": "email-intake-and-leads",
        "title": "Email Intake: multiple inboxes and new leads",
        "category": "Sales & CRM",
        "icon": "Mail",
        "order": 41,
        "summary": "Connect lead inboxes, test the email-to-lead workflow, and know how each enquiry is handled.",
        "body_md": """## What Email Intake does
Email Intake turns a new enquiry into a lead in **Lead Studio**. It also records the original email as lead activity and creates a team notification, so a new request is visible without manually re-keying it.

## Add one or more inboxes
1. Open **Lead Studio** and select **Email Intake**, or open **Settings > Office 365 Mailbox**.
2. Enter the Azure app details and mailbox address for the inbox you want to connect.
3. Select **Connect Mailbox**. The inbox appears under **Connected Inboxes**.
4. Use **Add Inbox** to connect another sales, web-enquiries or regional mailbox. Each inbox remains listed separately and can be removed without affecting the others.

Keep routing consistent: enable **Email to lead** for enquiry mailboxes. Enable **Email to ticket** only where known customer support email should create tickets instead of leads.

## Test the workflow safely
Before using a live mailbox, select **Create demo email lead** on the Email Intake page. NexusMSP creates a unique test enquiry and opens it in **Lead Studio**. Confirm that:

- a new lead is visible with **Email** as its source;
- the initial email is present in the lead activity history; and
- the notification bell shows the new enquiry.

Use the test lead to validate assignment, pipeline movement and follow-up rules, then archive or delete it when your test is complete.

## Incoming-email behaviour
| Sender and routing | Result |
|---|---|
| New sender with Email to lead enabled | Creates a new lead and initial email activity. |
| Existing lead | Adds the email as activity and refreshes the last-contact time. |
| Known client contact with Email to ticket enabled | Creates a support ticket for that client. |
| Email to lead disabled | Records no lead from the incoming message. |

## Current connection status
The current Email Intake page stores and manages mailbox configuration, supports multiple inboxes, and provides a safe demo lead. Live Microsoft Graph mailbox synchronisation requires the Microsoft OAuth/Graph connection to be completed for your Azure app before production mail is pulled automatically. Do not treat a successful configuration test as proof that live mailbox polling is enabled.

## Troubleshooting
- **No new lead:** confirm Email to lead is enabled, then run the demo lead test to verify the Lead Studio path.
- **Wrong result for a customer email:** check the known contact email and whether Email to ticket is enabled.
- **Cannot add or remove inboxes:** Email Intake settings require an administrator.
- **Duplicate inbox:** connect the same mailbox only once; reconnecting it refreshes its saved configuration.
""",
    },
    {
        "slug": "voice-yeastar-pbx-onboarding",
        "title": "Connect a Yeastar PBX to Voice",
        "category": "Integrations",
        "icon": "Phone",
        "order": 34,
        "summary": "Link a Yeastar P-Series PBX to the right client, validate the API connection, and prepare extension billing safely.",
        "body_md": """# Connect a Yeastar PBX to Voice

Use **Voice → Add PBX** to create one managed PBX record for each customer. Selecting the customer is important: it makes the PBX visible as a linked **PBX** service on the client profile and keeps its billing and audit history in the correct account.

## Before you start

- Confirm the customer uses **Yeastar P-Series** with OpenAPI access available.
- Ensure the technician has permission to manage integrations on the PBX.
- Use the customer PBX Cloud URL or FQDN, including `https://`; do not enter the `/openapi/...` path.

## Get the Yeastar credentials

1. Sign in to the customer’s Yeastar P-Series PBX web portal.
2. Go to **Integrations → API**.
3. Enable the API feature and save the setting.
4. Copy the **Client ID** and **Client Secret** displayed there.
5. Record the Client Secret in Keeper, then enter it directly into the PBX configuration. Do not add it to a ticket, client note, chat message, or general documentation.

For P-Series Cloud Edition, NexusMSP requests an access token from `POST /openapi/v1.0/get_token`, using the Client ID as the API username and the Client Secret as the API password. Yeastar requires a User-Agent header. NexusMSP caches the short-lived access token and uses it for extension, system, and call queries. Yeastar limits a third-party application to eight simultaneous valid access tokens, so avoid repeatedly testing the same credentials from several tools.

## Add the PBX in NexusMSP

1. Open **Voice** and select **Add PBX**.
2. Choose the correct **Client**.
3. Enter a meaningful PBX name, such as `Head Office P-Series`.
4. Enter the Yeastar Cloud URL/FQDN, Client ID, and Client Secret.
5. Select a sync schedule and enter optional agreement/product mapping for recurring billing.
6. Select **Link PBX**.
7. Use **Test connection**, then **Sync now**. A successful sync records timing, extension count, and outcome in Sync history.

## Billing controls

By default, every enabled extension is billable. Switch the billing policy to **Registered extensions only** only when that matches the customer agreement. Use the Extensions tab to exclude a specific extension with an auditable manual override. Run **Recalculate billing** to create a billing snapshot before changing a recurring invoice or contract inclusion.

## Troubleshooting

- **Authentication failed:** confirm API is enabled, the URL is the PBX base URL, and the Client ID/Secret are from Integrations → API.
- **TLS error:** leave TLS validation enabled unless the customer PBX has a trusted, correctly configured certificate. Escalate certificate problems rather than disabling validation permanently.
- **No extensions after sync:** confirm the API account has access to extension data and retry after Yeastar token expiry if its token limit has been reached.
- **PBX missing on client:** verify the PBX was linked to the intended client when added; the PBX chip lights up only for that linked client.

## References

- [Enable the Yeastar P-Series Cloud Edition API](https://help.yeastar.com/en/p-series-cloud-edition/developer-guide/enable-yeastar-p-series-pbx-api.html)
- [Yeastar: get an access token](https://help.yeastar.com/en/p-series-cloud-edition/developer-guide/get-access-token.html)
""",
    },
    {
        "slug": "secure-integration-setup",
        "title": "Set up integrations safely",
        "category": "Platform Setup",
        "icon": "Key",
        "order": 18,
        "summary": "A technician checklist for connecting external services, testing access, and protecting credentials in NexusMSP.",
        "body_md": """# Set up integrations safely

NexusMSP now shows an in-product setup guide beside credential-based configuration. Use it before saving a connection for Voice, Microsoft 365, RustDesk, Xero, Stripe, Acronis, Pax8, Huntress, UniFi, CIPP, Hudu, Splynx, SMS, and related providers.

## The standard workflow

1. **Confirm ownership:** verify the customer, MSP tenant, organisation, data centre, or provider account before creating a credential.
2. **Create a dedicated credential:** use a service account, application registration, or named API key for NexusMSP rather than a personal technician credential.
3. **Use least privilege:** grant only the permissions required by the intended workflow. Do not enable billing, write, or administration scopes for a read-only integration.
4. **Record it in Keeper first:** enter a secret directly into its NexusMSP integration setting only when required; NexusMSP is not a password vault. Never paste API keys, Client Secrets, function keys, or passwords into tickets, chat, contracts, client notes, screenshots, or documentation.
5. **Save and test:** use the connection test before enabling sync, alerting, billing automation, or customer communications.
6. **Verify the result:** confirm the expected customer/site/tenant data appears. A successful login to the wrong tenant is still a configuration failure.
7. **Record operational ownership:** capture who owns renewal, rotation, and supplier escalation in your normal credential-management process.

## What the setup guide tells you

Each callout answers four questions:

- **Where do I get this credential?** The provider portal and relevant menu path.
- **What must be configured first?** Redirect URIs, API enablement, sender approval, consent, or tenant selection.
- **How do I validate it?** The expected test or safe first synchronisation.
- **What is the risk?** A short reminder about what the credential can access and how to respond to exposure.

## If a credential may be exposed

1. Disable or revoke it in the provider portal immediately.
2. Create a replacement credential with the same minimum permissions.
3. Update NexusMSP and run the provider test.
4. Review the integration audit/sync history for unexpected activity.
5. Record the security event using your normal incident process.

## Provider-specific guides

- [Connect a Yeastar PBX to Voice](/help/voice-yeastar-pbx-onboarding)
- [Email intake and leads](/help/email-intake-and-leads)
- [Nexus Elevate: approve endpoint administrator access](/help/nexus-elevate-setup)

For a provider-specific exception, follow the guide embedded in that provider’s settings card; it takes precedence over this general checklist.
""",
    },
    {
        "slug": "nexus-elevate-setup",
        "title": "Nexus Elevate: approve an exact endpoint service launch",
        "category": "Security",
        "icon": "ShieldCheck",
        "order": 36,
        "summary": "Set up universal, agent-backed, hash-pinned service-launch approvals without requiring Keeper EPM for the customer.",
        "body_md": """# Nexus Elevate technician setup

**Nexus Elevate** is the native, agent-backed approval workflow for NexusMSP. It is available to **every customer with an enrolled Windows NexusOps Agent**. A customer does not need Keeper, Hudu, or a separate endpoint privilege product to submit a controlled request.

## What Nexus Elevate approves

Nexus Elevate approves one precise, unattended executable launch through the Nexus Agent service. Each request is tied to:

- the enrolled endpoint and customer;
- the exact absolute Windows `.exe` path;
- the executable SHA-256 fingerprint;
- the program arguments;
- the requester, justification, and optional ticket; and
- an expiry selected by the approving technician.

The agent verifies the SHA-256 again immediately before it launches the process. A changed executable, expired approval, different path, or malformed argument is rejected and audited. An approval that expires before the agent reports a successful launch is automatically marked **Expired** and retained in the audit timeline.

> **Current boundary:** this is a controlled service-context launch for unattended installers, repairs, and other non-interactive executable tasks. It does not elevate the signed-in Windows user, display a desktop installer, bypass UAC, or create permanent local-administrator rights. Use a technician-assisted remote session for interactive work.

## Enable it once for the organisation

1. Open **Settings -> Integrations -> Nexus Elevate**.
2. Leave **Enable native service-launch approvals** turned on. This is the switch that makes the feature available to every enrolled Windows NexusOps Agent.
3. Keep **Require request justification** enabled.
4. Set the shortest practical **maximum approval duration**. Fifteen minutes is a sensible normal default; the hard product limit is sixty minutes.
5. Select **Save elevation policy**.

Use **Nexus Elevate** from the Endpoint Security workspace to review the queue and audit history.

## Build a policy safely

Use **Nexus Elevate -> Policies** when a customer has a repeatable elevation need such as a verified hardware utility or a known vendor updater.

1. Start with a **Monitor only** policy and scope it to the intended customer or endpoint.
2. Pin the exact Windows executable path and, where possible, the SHA-256 fingerprint. An enforced automatic approval requires both values.
3. Use **Simulate a request** before enforcement. Confirm whether the result is an allow, review, or deny decision and that the scope is correct.
4. Keep a ticket and a requester justification required for any workflow that needs stronger accountability.
5. Move the policy to **Enforce** only after the monitor evidence is expected. Every policy version, simulation, match, automatic approval, and denial is retained for audit.

Policies do not create a general administrator account and do not disable UAC. The first release intentionally does **not** remove local administrator memberships or enforce system-wide application control. Those capabilities require tested endpoint recovery and break-glass controls before they can be enabled safely.

## Day-to-day technician workflow

1. On the customer endpoint, open **Nexus Client Chat** from the Windows Start Menu under **NexusMSP**, then select **Request admin access**. Use this only for an unattended executable task; the companion fingerprints the selected executable locally before it submits the request.
2. The endpoint companion submits the requested program, its hash, arguments, user/session information, and why the work is required. It never exposes the agent token to the browser window.
3. In **Nexus Elevate**, filter to **Awaiting review** and open the request.
4. Confirm the customer, endpoint, ticket, program path, publisher, SHA-256 fingerprint, and arguments all make sense together.
5. Choose **Approve controlled launch** only when the request is expected. Record a specific approval rationale and use the shortest available time bound.
6. The agent receives only the approved executable launch and runs it in its service context. The resulting exit code, output, timestamp, approver, and decision reason are retained in the audit timeline.

If the request is unclear, choose **Deny request** and say what evidence or safer process is needed. A denial is just as valuable as an approval because it closes the accountability loop.

## Companion deployment

New NexusOps Agent installer packs include **Nexus Client Chat** alongside the Windows service. The installer and managed rollout add it to the Windows Start Menu under **NexusMSP**; it does not need local administrator rights just to submit a request.

The companion is a user-session window, while the NexusOps Agent remains a background service. This split is intentional: the service retains the protected server connection and the companion gives the signed-in user a safe, visible request experience.

## Important security boundaries

- Do not approve an unfamiliar path, unsigned or unexpected publisher, changed hash, or generic justification such as "need admin".
- Nexus Elevate does **not** open a general command shell and does not give the endpoint user an administrator account, interactive UAC elevation, or a desktop-visible installer session.
- Native approvals are Windows-first. The current launch contract supports a precise `.exe`; use the standard controlled script library for PowerShell or command work.
- If an agent is offline, its request stays visible but must be revalidated by the endpoint when it returns. Do not treat an old approval as permission to substitute a newer file.
- The first deployment scope is a controlled request-and-approved-launch workflow. A full replacement for operating-system-wide UAC interception needs the separate signed user-session companion, tamper protection, and Windows service hardening rollout.

## Optional Keeper EPM bridge

Keeper EPM is optional. If your organisation also uses it, enable **Optional Keeper EPM bridge** in the same Settings card and enter only the approved deployment-secret reference for the connector. Do not paste Keeper credentials into NexusMSP, tickets, chat, documentation, or notes.

The bridge is for reconciling external Keeper approval events. It never removes native Nexus Elevate coverage from a customer that does not have Keeper.

## Troubleshooting

- **No request arrives:** confirm the device is enrolled and online in **Managed Assets**, then confirm Native approvals are enabled in Settings.
- **Request is rejected before review:** check that the companion supplied an absolute `.exe` path, a 64-character SHA-256 fingerprint, clean arguments, and a sufficiently detailed justification.
- **Approved launch fails:** compare the fingerprint and path in the audit entry with the endpoint file. A mismatch is expected to fail safely; investigate why the executable changed.
- **A technician cannot approve:** an administrator must grant the technician the Agent command execution permission or perform the approval themselves.
""",
    },
]
