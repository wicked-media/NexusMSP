// Cleaned-up navigation: bugs fixed, duplicates removed, mergers applied.
import {
  LayoutDashboard, Ticket, Monitor, Package, Users, FileText,
  Receipt, Clock, BookOpen, BarChart3, Settings, UserPlus, Shield,
  Mail, FolderKanban, Server, UserCog, ShoppingCart, Wifi, Phone,
  ShieldCheck, Radar, Workflow, TrendingUp, ShieldAlert, GitBranch,
  MessageSquare, HardDrive, Layers, ClipboardList, BrainCircuit,
  Siren, Sparkles, Bookmark, Briefcase, Boxes,
} from "lucide-react";

export const navGroups = [
  {
    id: "service_desk",
    title: "Service Desk",
    items: [
      { path: "/", icon: LayoutDashboard, label: "Dashboard" },
      { path: "/workspace", icon: Bookmark, label: "My Workspace" },
      {
        path: "/tickets", icon: Ticket, label: "Tickets",
        workspacePaths: ["/triage-queue", "/sla-timer", "/dispatch-board", "/workshop-bench", "/escalation-matrix", "/intelligent-routing", "/blueprints", "/service-catalog", "/nexus-verify", "/work-session"],
        children: [
          { path: "/triage-queue", label: "Triage queue" },
          { path: "/dispatch-board", label: "Dispatch board" },
          { path: "/workshop-bench", label: "Workshop bench" },
          { path: "/escalation-matrix", label: "Escalation management" },
          { path: "/blueprints", label: "Ticket blueprints" },
          { path: "/blueprints?tab=patterns", label: "Pattern discovery" },
          { path: "/service-catalog", label: "Service catalogue" },
          { path: "/nexus-verify", label: "Nexus Verify" },
          { path: "/work-session", label: "Nexus Work Session" },
        ],
      },
      {
        path: "/change-management", icon: GitBranch, label: "Change & Incidents",
        workspacePaths: ["/change-freezes"],
        children: [
          { path: "/change-management?view=approved", label: "Approved changes" },
          { path: "/change-management?view=implementing", label: "Implementing now" },
          { path: "/change-management?view=history", label: "Change history" },
          { path: "/change-freezes", label: "Change freezes" },
        ],
      },
      {
        path: "/team-hub", icon: UserCog, label: "Team",
        children: [
          { path: "/team-hub?view=directory", label: "Team directory" },
          { path: "/team-hub?view=roster", label: "On-call roster" },
          { path: "/team-hub?view=capacity", label: "Capacity" },
          { path: "/team-hub?view=skills", label: "Skills matrix" },
        ],
      },
      {
        path: "/team-chat", icon: MessageSquare, label: "Collaboration",
        workspacePaths: ["/live-chat", "/script-ticket"],
        children: [{ path: "/live-chat", label: "Live support chat" }, { path: "/script-ticket", label: "Ticket conversation" }],
      },
      { path: "/onboarding", icon: ClipboardList, label: "Client Onboarding" },
      { path: "/wallboard", icon: Monitor, label: "NOC Wallboard" },
    ]
  },
  {
    id: "infrastructure",
    title: "Infrastructure",
    items: [
      {
        path: "/devices", icon: Monitor, label: "Managed Assets",
        workspacePaths: [
          "/nexus-agent", "/bulk-actions", "/maintenance-scheduler", "/patch-tuesday", "/device-terminal",
        ],
        children: [
          { path: "/nexus-agent", label: "Nexus Agent" },
          { path: "/bulk-actions", label: "Bulk actions" },
          { path: "/patch-tuesday", label: "Patch management" },
          { path: "/maintenance-scheduler", label: "Maintenance" },
          { path: "/device-terminal", label: "Device terminal" },
        ],
      },
      {
        path: "/networking", icon: Wifi, label: "Network",
        workspacePaths: [
          "/topology", "/dns-monitor", "/bandwidth-monitor", "/dmarc-compliance", "/splynx-dashboard",
        ],
        children: [
          { path: "/topology", label: "Topology" },
          { path: "/dns-monitor", label: "DNS intelligence" },
          { path: "/bandwidth-monitor", label: "Bandwidth" },
          { path: "/dmarc-compliance", label: "DMARC" },
          { path: "/splynx-dashboard", label: "ISP operations" },
        ],
      },
      {
        path: "/voice", icon: Phone, label: "Voice",
        children: [
          { path: "/voice?tab=pbxs", label: "PBXs" },
          { path: "/voice?tab=extensions", label: "Extensions" },
          { path: "/voice?tab=billing", label: "Voice billing" },
          { path: "/voice?tab=diagnostics", label: "API diagnostics" },
        ],
      },
      {
        path: "/assets", icon: Package, label: "Inventory Assets",
        workspacePaths: [
          "/qr-assets", "/asset-print-batch", "/asset-lifecycle", "/asset-depreciation", "/procurement-planner",
        ],
        children: [
          { path: "/asset-lifecycle", label: "Asset lifecycle" },
          { path: "/qr-assets", label: "QR assets" },
          { path: "/asset-print-batch", label: "Print asset labels" },
          { path: "/asset-depreciation", label: "Asset depreciation" },
          { path: "/procurement-planner", label: "Procurement planning" },
        ],
      },
      {
        path: "/backup-center", icon: HardDrive, label: "Backups",
        children: [
          { path: "/backup-center?tab=live", label: "Live operations" },
          { path: "/backup-center?tab=verify", label: "Recovery verification" },
          { path: "/backup-center?tab=compliance", label: "Compliance" },
          { path: "/backup-center?tab=billing", label: "Billing" },
        ],
      },
      {
        path: "/automation-hub", icon: Workflow, label: "Automation",
        workspacePaths: [
          "/diagnostics", "/runbooks", "/scripting", "/git-scripts", "/workflow-automation", "/alert-rules",
        ],
        children: [
          { path: "/diagnostics", label: "Diagnostic workspace" },
          { path: "/workflow-automation", label: "Automation Studio" },
          { path: "/workflow-automation?tab=marketplace", label: "Automation marketplace" },
          { path: "/workflow-automation?tab=runtime", label: "Runtime health" },
          { path: "/workflow-automation?tab=simulations", label: "Simulation history" },
          { path: "/runbooks", label: "Runbooks" },
          { path: "/scripting", label: "Scripts & repair packs" },
          { path: "/git-scripts", label: "Git Scripts Sync" },
          { path: "/alert-rules", label: "Alert rules" },
        ],
      },
    ]
  },
  {
    id: "business",
    title: "Business",
    items: [
      {
        path: "/clients", icon: Users, label: "Clients",
        workspacePaths: ["/client-insights", "/client-compare", "/client-portal"],
        children: [
          { path: "/client-insights", label: "Client insights" },
          { path: "/client-insights?tab=what-changed", label: "What Changed" },
          { path: "/expected-state", label: "Expected State" },
          { path: "/client-compare", label: "Compare clients" },
          { path: "/client-portal", label: "Customer portal" },
        ],
      },
      {
        // Leads is the single customer-growth workspace. Pipeline, campaigns and
        // renewals live as tabs there instead of duplicating sidebar navigation.
        path: "/leads", icon: UserPlus, label: "Leads"
      },
      {
        path: "/billing-dashboard", icon: Receipt, label: "Billing & Finance",
        workspacePaths: [
          "/billing-pro", "/invoices", "/estimates", "/recurring-invoices", "/services-subscriptions", "/license-management", "/quote-to-cash", "/billing-recon", "/usage-billing", "/billing-portal", "/proposals", "/invoice-templates", "/finance-intel", "/late-payment", "/pricing-calc", "/xero",
        ],
        children: [
          { path: "/invoices", label: "Invoices" },
          { path: "/recurring-invoices", label: "Recurring billing" },
          { path: "/services-subscriptions", label: "Services & subscriptions" },
          { path: "/services-subscriptions?view=attention", label: "Coverage & renewal gaps" },
          { path: "/billing-recon", label: "Billing reconciliation" },
        ],
      },
      {
        // CEO Mode is the owner cockpit. Existing financial analysis remains
        // available as source workspaces without adding another sidebar entry.
        path: "/executive", icon: Briefcase, label: "Executive",
        workspacePaths: ["/financial-analytics", "/financial-reports", "/revenue-forecast", "/rpe-dashboard", "/contract-profit", "/profitability-heatmap", "/cost-per-ticket", "/saas-spend"],
        children: [
          { path: "/financial-analytics", label: "Financial analytics" },
          { path: "/revenue-forecast", label: "Revenue forecast" },
          { path: "/contract-profit", label: "Contract profitability" },
          { path: "/cost-per-ticket", label: "Cost per ticket" },
          { path: "/saas-spend", label: "SaaS spend" },
        ],
      },
      {
        path: "/products", icon: Package, label: "Products & Inventory",
        workspacePaths: ["/stocktake", "/stocktake-mobile", "/rentals"],
        children: [
          { path: "/stocktake", label: "Stocktake" },
          { path: "/stocktake-mobile", label: "Mobile stocktake" },
          { path: "/rentals", label: "Rentals" },
        ],
      },
      {
        path: "/purchase-orders", icon: ShoppingCart, label: "POs & Vendors",
        workspacePaths: ["/vendors", "/vendor-scorecard"],
        children: [{ path: "/vendors", label: "Vendors" }, { path: "/vendor-scorecard", label: "Vendor scorecard" }],
      },
      { path: "/projects", icon: FolderKanban, label: "Projects" },
      { path: "/contracts", icon: FileText, label: "Contracts" },
      { path: "/growth", icon: TrendingUp, label: "Revenue Growth" },
      { path: "/warroom", icon: Siren, label: "War Rooms" },
      { path: "/time-tracking", icon: Clock, label: "Time Tracking" },
    ]
  },
  {
    id: "security",
    title: "Security",
    items: [
      {
        path: "/security-dashboard", icon: Shield, label: "SOC Dashboard",
        workspacePaths: ["/soc-feed", "/soc-realtime", "/threat-timeline", "/identity-threats"],
        children: [{ path: "/soc-feed", label: "Security feed" }, { path: "/threat-timeline", label: "Threat timeline" }, { path: "/identity-threats", label: "Identity threats" }],
      },
      {
        path: "/nexus-shield", icon: ShieldCheck, label: "Nexus Shield",
        workspacePaths: [
          "/endpoint-security", "/shadow-it", "/vulnerability-scanner", "/nexus-elevate",
          "/ransomware-canary", "/ransomware-tabletop", "/remediation-playbooks", "/dr-plans", "/mail-shield",
        ],
        children: [
          { path: "/endpoint-security", label: "Endpoint protection" },
          { path: "/vulnerability-scanner", label: "Vulnerability scanner" },
          { path: "/ransomware-canary", label: "Nexus Canary" },
          { path: "/nexus-elevate", label: "Nexus Elevate" },
          { path: "/remediation-playbooks", label: "Response playbooks" },
          { path: "/dr-plans", label: "Recovery plans" },
          { path: "/mail-shield", label: "Mail Shield" },
        ],
      },
      {
        path: "/compliance", icon: ShieldAlert, label: "Compliance",
        workspacePaths: ["/audit-trail"],
        children: [
          { path: "/compliance?tab=controls", label: "Control library" },
          { path: "/compliance?tab=evidence", label: "Evidence" },
          { path: "/compliance?tab=reports", label: "Compliance reports" },
          { path: "/compliance?tab=insurance", label: "Insurance readiness" },
          { path: "/audit-trail", label: "Audit trail" },
        ],
      },
    ]
  },
  {
    id: "intelligence",
    title: "AI & Intelligence",
    items: [
      {
        path: "/auto-ops", icon: BrainCircuit, label: "AI Operations",
        children: [
          { path: "/auto-ops?tab=triage-queue", label: "AI triage queue" },
          { path: "/auto-ops?tab=ai-resolution", label: "Auto-resolve review" },
          { path: "/auto-ops?tab=self-healing", label: "Self-healing" },
          { path: "/auto-ops?tab=predictive", label: "Predictive risk" },
        ],
      },
    ]
  },
  {
    id: "reports",
    title: "Reports & Comms",
    items: [
      {
        path: "/insights", icon: Sparkles, label: "Insights Hub",
        children: [
          { path: "/insights?tab=overload", label: "Technician load" },
          { path: "/insights?tab=patches", label: "Patch anomalies" },
          { path: "/insights?tab=trajectory", label: "Device trajectory" },
          { path: "/insights?tab=runbooks", label: "Runbooks" },
        ],
      },
      {
        path: "/reports", icon: BarChart3, label: "Reports",
        workspacePaths: ["/incident-heatmap"],
        children: [
          { path: "/reports?tab=operations", label: "Service operations" },
          { path: "/reports?tab=security", label: "Security evidence" },
          { path: "/reports?tab=governance", label: "Audit & governance" },
          { path: "/reports?tab=commercial", label: "Commercial reporting" },
          { path: "/reports?tab=clients", label: "Client outcomes" },
          { path: "/incident-heatmap", label: "Incident heatmap" },
          { path: "/reports?tab=postmortems", label: "Post-mortems" },
          { path: "/reports?tab=delivery", label: "Scheduled delivery" },
        ],
      },
      {
        path: "/email", icon: Mail, label: "Communications",
        workspacePaths: ["/notify-channels", "/csat-surveys", "/nps-tracker"],
        children: [
          { path: "/email?view=inbox", label: "Inbox" },
          { path: "/email?view=sent", label: "Sent mail" },
          { path: "/email?view=drafts", label: "Drafts" },
          { path: "/email?view=attention", label: "Needs action" },
          { path: "/notify-channels", label: "Notification channels" },
          { path: "/csat-surveys", label: "CSAT surveys" },
          { path: "/nps-tracker", label: "NPS tracking" },
        ],
      },
    ]
  },
  {
    id: "platform",
    title: "Platform",
    items: [
      {
        path: "/nexus-suite", icon: Boxes, label: "Nexus Suite",
        children: [{ path: "/nexus-suite?view=store", label: "Nexus Store" }],
      },
      {
        path: "/deployment-hub", icon: Server, label: "Deployment Hub",
        children: [{ path: "/channel-mode", label: "Channel Mode" }],
      },
      {
        path: "/control-plane", icon: Layers, label: "Nexus Control Plane",
        workspacePaths: ["/cipp", "/m365"],
        children: [
          { path: "/control-plane?module=microsoft365&view=capabilities", label: "Microsoft 365" },
          { path: "/control-plane?module=microsoft365", label: "Tenant operations" },
          { path: "/control-plane?module=microsoft365&view=connections", label: "Microsoft connections" },
          { path: "/control-plane?module=microsoft365&view=actions", label: "Microsoft actions" },
          { path: "/control-plane?module=microsoft365&view=security", label: "Microsoft security posture" },
          { path: "/control-plane?module=foundation", label: "Nexus Foundation" },
        ],
      },
      { path: "/production-readiness", icon: ShieldCheck, label: "Production Readiness" },
      { path: "/settings", icon: Settings, label: "Settings" },
      {
        path: "/benchmarking", icon: Radar, label: "Planning & Lifecycle",
        workspacePaths: ["/expiry-tracker", "/client-budget"],
        children: [{ path: "/expiry-tracker", label: "Expiry tracker" }, { path: "/client-budget", label: "Client budget" }],
      },
      { path: "/integrations", icon: Server, label: "Integrations" },
    ]
  },
  {
    id: "help",
    title: "Help",
    items: [
      { path: "/documentation-hub", icon: BookOpen, label: "Knowledge & Docs", workspacePaths: ["/doc-scanner"], children: [{ path: "/doc-scanner", label: "Document scanner" }] },
    ]
  },
];

// Plain-language entry points used by My Workspace and navigation search.
// These describe the job a technician is trying to complete rather than
// requiring them to know which Nexus module owns it.
export const taskShortcuts = [
  { id: "support-client", label: "Help a client", description: "Open the client 360, contacts, services, history and linked systems.", path: "/clients", icon: Users, accent: "emerald", keywords: ["customer", "contact", "account", "organisation", "history", "service"] },
  { id: "work-ticket", label: "Work a ticket", description: "Create, triage, assign, communicate, schedule or resolve service work.", path: "/tickets", icon: Ticket, accent: "amber", keywords: ["job", "case", "issue", "request", "dispatch", "sla", "note", "email customer"] },
  { id: "manage-endpoint", label: "Manage an endpoint", description: "Find a device, inspect health, run tools or start a remote session.", path: "/devices", icon: Monitor, accent: "cyan", keywords: ["remote", "computer", "server", "asset", "agent", "patch", "script", "restart"] },
  { id: "protect-client", label: "Protect a client", description: "Investigate risk, endpoint protection, canaries and response actions.", path: "/nexus-shield", icon: ShieldCheck, accent: "rose", keywords: ["security", "threat", "incident", "ransomware", "xdr", "isolate", "malware"] },
  { id: "bill-work", label: "Bill and reconcile", description: "Create invoices, review subscriptions, payments and billing exceptions.", path: "/billing-dashboard", icon: Receipt, accent: "violet", keywords: ["invoice", "payment", "xero", "revenue", "subscription", "charge", "reconcile"] },
  { id: "automate-work", label: "Automate repeated work", description: "Build, approve and audit workflows, scripts and operational runbooks.", path: "/automation-hub", icon: Workflow, accent: "blue", keywords: ["workflow", "runbook", "script", "trigger", "approval", "deploy", "repeat"] },
  { id: "diagnose", label: "Diagnose an issue", description: "Open evidence-led diagnostic plans and source workspaces without a guessed fix.", path: "/diagnostics", icon: BrainCircuit, accent: "cyan", keywords: ["troubleshoot", "slow", "offline", "backup", "error", "investigate", "diagnostic"] },
];

export function getAllNavItems() {
  const items = [];
  for (const group of navGroups) {
    for (const item of group.items) {
      items.push({ ...item, group: group.title, groupId: group.id });
      if (item.children) {
        for (const child of item.children) {
          items.push({ ...child, icon: item.icon, group: group.title, groupId: group.id, parentLabel: item.label });
        }
      }
    }
  }
  return items;
}

export const MODULE_GROUPS = [
  { id: "service_desk", label: "Service Desk", description: "Tickets, dispatch, scheduling, live support" },
  { id: "infrastructure", label: "Infrastructure", description: "Devices, network, assets, backups, automation" },
  { id: "business", label: "Business", description: "Clients, billing, finance, products, projects" },
  { id: "security", label: "Security", description: "SOC, endpoint, compliance, DR" },
  { id: "intelligence", label: "AI & Intelligence", description: "AI copilot, predictions, knowledge base" },
  { id: "reports", label: "Reports & Comms", description: "Reports, email, comms" },
  { id: "platform", label: "Platform", description: "Settings, integrations, system health" },
  { id: "help", label: "Help", description: "Knowledge base, technician documentation, guides, and planning" },
];
