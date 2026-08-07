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
        workspacePaths: ["/triage-queue", "/sla-timer", "/dispatch-board", "/workshop-bench", "/escalation-matrix", "/intelligent-routing", "/blueprints", "/service-catalog"],
      },
      {
        path: "/change-management", icon: GitBranch, label: "Change & Incidents",
        workspacePaths: ["/change-freezes"],
      },
      { path: "/team-hub", icon: UserCog, label: "Team" },
      {
        path: "/team-chat", icon: MessageSquare, label: "Collaboration",
        workspacePaths: ["/live-chat", "/script-ticket"],
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
      },
      {
        path: "/networking", icon: Wifi, label: "Network",
        workspacePaths: [
          "/topology", "/dns-monitor", "/bandwidth-monitor", "/dmarc-compliance", "/splynx-dashboard",
        ],
      },
      { path: "/voice", icon: Phone, label: "Voice" },
      {
        path: "/assets", icon: Package, label: "Inventory Assets",
        workspacePaths: [
          "/qr-assets", "/asset-print-batch", "/asset-lifecycle", "/asset-depreciation", "/procurement-planner",
        ],
      },
      { path: "/backup-center", icon: HardDrive, label: "Backups" },
      {
        path: "/automation-hub", icon: Workflow, label: "Automation",
        workspacePaths: [
          "/runbooks", "/scripting", "/git-scripts", "/workflow-automation", "/alert-rules",
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
      },
      {
        // CEO Mode is the owner cockpit. Existing financial analysis remains
        // available as source workspaces without adding another sidebar entry.
        path: "/executive", icon: Briefcase, label: "Executive",
        workspacePaths: ["/financial-analytics", "/financial-reports", "/revenue-forecast", "/rpe-dashboard", "/contract-profit", "/profitability-heatmap", "/cost-per-ticket", "/saas-spend"],
      },
      {
        path: "/products", icon: Package, label: "Products & Inventory",
        workspacePaths: ["/stocktake", "/stocktake-mobile", "/rentals"],
      },
      {
        path: "/purchase-orders", icon: ShoppingCart, label: "POs & Vendors",
        workspacePaths: ["/vendors", "/vendor-scorecard"],
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
      },
      {
        path: "/nexus-shield", icon: ShieldCheck, label: "Nexus Shield",
        workspacePaths: [
          "/endpoint-security", "/shadow-it", "/vulnerability-scanner", "/nexus-elevate",
          "/ransomware-canary", "/ransomware-tabletop", "/remediation-playbooks", "/dr-plans",
        ],
      },
      {
        path: "/compliance", icon: ShieldAlert, label: "Compliance",
        workspacePaths: ["/audit-trail"],
      },
    ]
  },
  {
    id: "intelligence",
    title: "AI & Intelligence",
    items: [
      {
        path: "/auto-ops", icon: BrainCircuit, label: "AI Operations",
      },
    ]
  },
  {
    id: "reports",
    title: "Reports & Comms",
    items: [
      { path: "/insights", icon: Sparkles, label: "Insights Hub" },
      {
        path: "/reports", icon: BarChart3, label: "Reports",
        workspacePaths: ["/incident-heatmap"],
      },
      {
        path: "/email", icon: Mail, label: "Communications",
        workspacePaths: ["/notify-channels", "/csat-surveys", "/nps-tracker"],
      },
    ]
  },
  {
    id: "platform",
    title: "Platform",
    items: [
      { path: "/nexus-suite", icon: Boxes, label: "Nexus Suite" },
      {
        path: "/control-plane", icon: Layers, label: "Nexus Control Plane",
        workspacePaths: ["/cipp", "/m365"],
      },
      { path: "/production-readiness", icon: ShieldCheck, label: "Production Readiness" },
      { path: "/settings", icon: Settings, label: "Settings" },
      {
        path: "/benchmarking", icon: Radar, label: "Planning & Lifecycle",
        workspacePaths: ["/expiry-tracker", "/client-budget"],
      },
      { path: "/integrations", icon: Server, label: "Integrations" },
    ]
  },
  {
    id: "help",
    title: "Help",
    items: [
      { path: "/documentation-hub", icon: BookOpen, label: "Knowledge & Docs", workspacePaths: ["/doc-scanner"] },
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
