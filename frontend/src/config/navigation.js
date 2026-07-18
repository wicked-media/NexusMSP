// Cleaned-up navigation: bugs fixed, duplicates removed, mergers applied.
import {
  LayoutDashboard, Ticket, Monitor, Package, Users, FileText,
  Receipt, Clock, BookOpen, Cloud, Network, Laptop, BarChart3,
  Settings, Zap, UserPlus, Shield, Mail, Terminal, Key,
  FolderKanban, Server, CalendarClock, UserCog,
  ShoppingCart, Wifi, Trophy, Phone, Building2, Tags, ShieldCheck,
  Activity, CreditCard, Bell, Cpu, Heart, Wrench, Radar,
  Paintbrush, Gift, Volume2, DollarSign, Wallet, Navigation, Bot,
  KeyRound, QrCode, Workflow, Timer, ScanLine, TrendingUp,
  FileBarChart, History, ShieldAlert, Target, MapPin, Map, Award,
  RefreshCw, FileSearch, Star, BarChart, Calculator,
  TrendingDown, GitBranch, Flame, MessageSquare, HardDrive,
  ShoppingBag, Globe, Lock, BellOff, Layers,
  Gauge, Eye, Bug, FileWarning, ClipboardList,
  Search, BrainCircuit, TestTube, Crosshair, ThumbsUp, MapPinned,
  HeartPulse, AlertTriangle, Banknote, MessageCircle,
  FileSpreadsheet, Fingerprint, Webhook, GitMerge, BadgeDollarSign, Swords,
  LayoutGrid, Building, Radio, Coins, Brain, Mic, ChevronDown, Siren, Sparkles, Bookmark,
  Inbox, Briefcase, ShieldOff, KeySquare, BellRing
} from "lucide-react";

export const navGroups = [
  {
    id: "service_desk",
    title: "Service Desk",
    items: [
      { path: "/", icon: LayoutDashboard, label: "Dashboard" },
      { path: "/workspace", icon: Bookmark, label: "My Workspace" },
      { path: "/morning-checks", icon: Activity, label: "Morning Checks" },
      {
        path: "/tickets", icon: Ticket, label: "Tickets",
        children: [
          { path: "/triage-queue", label: "Triage Queue" },
          { path: "/sla-timer", label: "SLA Manager" },
          { path: "/blueprints", label: "Blueprints" },
          { path: "/service-catalog", label: "Service Catalog" },
        ]
      },
      {
        path: "/dispatch-board", icon: MapPin, label: "Dispatch & Escalation",
        children: [
          { path: "/workshop-bench", label: "Workshop Bench" },
          { path: "/escalation-matrix", label: "Escalation Matrix" },
          { path: "/intelligent-routing", label: "Smart Routing" },
        ]
      },
      {
        path: "/change-management", icon: GitBranch, label: "Change & Incidents",
        children: [
          { path: "/change-freezes", label: "Freeze Calendar" },
          { path: "/postmortem", label: "Post-Mortems" },
          { path: "/alert-suppression", label: "Alert Suppression" },
        ]
      },
      /* Legacy Team Hub tab links are intentionally hidden from the sidebar.
        path: "/tech-command", icon: UserCog, label: "Team",
        children: [
          { path: "/team-hub", label: "Team Hub" },
          { path: "/team-hub?tab=command", label: "Command Center ⚡" },
          { path: "/team-hub?tab=technicians", label: "Technicians" },
          { path: "/team-hub?tab=roster", label: "Roster" },
          { path: "/team-hub?tab=utilization", label: "Utilization" },
          { path: "/team-hub?tab=skills", label: "Skills Matrix" },
          { path: "/team-hub?tab=leaderboard", label: "Leaderboard" },
        ]
      }, */
      { path: "/team-hub", icon: UserCog, label: "Team" },
      {
        path: "/team-chat", icon: MessageSquare, label: "Collaboration",
        children: [
          { path: "/live-chat", label: "Client Live Chat" },
          { path: "/script-ticket", label: "Script-to-Ticket" },
          { path: "/phone-integration", label: "Phone System (PBX)" },
        ]
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
        path: "/devices", icon: Monitor, label: "Devices",
        children: [
          { path: "/nexus-agent", label: "NexusOps Agent" },
          { path: "/bulk-actions", label: "Bulk Actions" },
          { path: "/maintenance-scheduler", label: "Maintenance" },
          { path: "/patch-tuesday", label: "Patch Tuesday" },
          { path: "/custom-monitors", label: "Custom Monitors" },
        ]
      },
      {
        path: "/networking", icon: Wifi, label: "Network",
        children: [
          { path: "/topology", label: "Topology" },
          { path: "/dns-monitor", label: "DNS Monitor" },
          { path: "/bandwidth-monitor", label: "Bandwidth" },
          { path: "/dmarc-compliance", label: "Email Security" },
          { path: "/splynx-dashboard", label: "ISP Health" },
        ]
      },
      {
        path: "/assets", icon: Package, label: "Assets",
        children: [
          { path: "/qr-assets", label: "QR Asset Tags" },
          { path: "/asset-print-batch", label: "Print Batch" },
          { path: "/asset-lifecycle", label: "Lifecycle & Warranty" },
          { path: "/asset-depreciation", label: "Depreciation" },
          { path: "/procurement-planner", label: "Procurement" },
        ]
      },
      { path: "/backup-center", icon: HardDrive, label: "Backup Command Center" },
      {
        path: "/automation-hub", icon: Workflow, label: "Automation",
        children: [
          { path: "/runbooks", label: "Runbooks" },
          { path: "/scripting", label: "Scripts Library" },
          { path: "/git-scripts", label: "Git Scripts Sync" },
          { path: "/workflow-automation", label: "Workflow Builder" },
          { path: "/alert-rules", label: "Alert Rules Engine" },
        ]
      },
      {
        path: "/vault", icon: KeyRound, label: "Vault & Credentials",
        children: [
          { path: "/credentials", label: "Credentials Hub" },
          { path: "/doc-scanner", label: "Document Scanner" },
          { path: "/device-terminal", label: "Live Terminal" },
        ]
      },
    ]
  },
  {
    id: "business",
    title: "Business",
    items: [
      {
        path: "/clients", icon: Users, label: "Clients",
        children: [
          { path: "/client-insights", label: "Client Insights Hub" },
          { path: "/comms-timeline", label: "Comms Timeline" },
          { path: "/client-compare", label: "Compare" },
        ]
      },
      {
        path: "/client-portal-admin", icon: Globe, label: "Client Portal",
        children: [
          { path: "/client-portal", label: "Self-Service" },
        ]
      },
      {
        path: "/leads", icon: UserPlus, label: "CRM",
        children: [
          { path: "/crm-pipeline", label: "Pipeline" },
          { path: "/campaigns", label: "Campaigns" },
          { path: "/loyalty", label: "Loyalty & Renewals" },
        ]
      },
      {
        path: "/billing-pro", icon: Receipt, label: "Billing & Finance",
        children: [
          { path: "/invoices", label: "Invoices" },
          { path: "/estimates", label: "Estimates" },
          { path: "/recurring-invoices", label: "Recurring" },
          { path: "/quote-to-cash", label: "Quote → Cash" },
          { path: "/billing-dashboard", label: "Billing Command" },
          { path: "/billing-recon", label: "Reconciliation" },
          { path: "/usage-billing", label: "Usage Billing" },
          { path: "/billing-portal", label: "Stripe Portal" },
          { path: "/proposals", label: "Proposals & Quotes" },
          { path: "/invoice-templates", label: "PDF Templates" },
          { path: "/finance-intel", label: "Finance Intelligence" },
          { path: "/late-payment", label: "Late Payment AI" },
          { path: "/pricing-calc", label: "Pricing Calculator" },
          { path: "/xero", label: "Xero Sync" },
        ]
      },
      {
        path: "/financial-analytics", icon: DollarSign, label: "Financial Analytics",
        children: [
          { path: "/financial-reports", label: "Financial Reports" },
          { path: "/revenue-forecast", label: "Revenue Forecast" },
          { path: "/rpe-dashboard", label: "Revenue / Endpoint" },
          { path: "/contract-profit", label: "Contract Profit" },
          { path: "/profitability-heatmap", label: "Profitability Map" },
          { path: "/cost-per-ticket", label: "Cost / Ticket" },
          { path: "/saas-spend", label: "SaaS Spend" },
        ]
      },
      {
        path: "/products", icon: Package, label: "Products & Inventory",
        children: [
          { path: "/products?new=1", label: "Add Product" },
          { path: "/stocktake", label: "Stocktake (Desktop)" },
          { path: "/stocktake-mobile", label: "Stocktake (Mobile)" },
          { path: "/rentals", label: "Phone Rentals" },
        ]
      },
      {
        path: "/purchase-orders", icon: ShoppingCart, label: "POs & Vendors",
        children: [
          { path: "/vendors", label: "Vendors" },
          { path: "/vendor-scorecard", label: "Vendor Scorecard" },
        ]
      },
      { path: "/projects", icon: FolderKanban, label: "Projects" },
      { path: "/contracts", icon: FileText, label: "Contracts" },
      { path: "/growth", icon: TrendingUp, label: "Revenue Growth" },
      { path: "/qbr", icon: FileBarChart, label: "QBRs" },
      { path: "/warroom", icon: Siren, label: "War Rooms" },
      { path: "/time-tracking", icon: Clock, label: "Time Tracking" },
      { path: "/license-management", icon: Layers, label: "License Mgmt" },
    ]
  },
  {
    id: "security",
    title: "Security",
    items: [
      {
        path: "/security-dashboard", icon: Shield, label: "SOC Dashboard",
        children: [
          { path: "/soc-feed", label: "SOC Feed" },
          { path: "/soc-realtime", label: "Smart Automation" },
          { path: "/threat-timeline", label: "Threat Timeline" },
          { path: "/identity-threats", label: "Identity Threats" },
        ]
      },
      {
        path: "/endpoint-security", icon: ShieldCheck, label: "Endpoint Security",
        children: [
          { path: "/shadow-it", label: "Shadow IT" },
          { path: "/vulnerability-scanner", label: "Vuln Scanner" },
          { path: "/zero-trust", label: "Zero Trust" },
          { path: "/dark-web-monitor", label: "Dark Web Monitor" },
          { path: "/phishing-sim", label: "Phishing Sim" },
        ]
      },
      {
        path: "/ransomware-canary", icon: Flame, label: "Ransomware Defense",
        children: [
          { path: "/ransomware-tabletop", label: "Tabletop" },
          { path: "/remediation-playbooks", label: "Remediation" },
          { path: "/dr-plans", label: "DR Plans" },
        ]
      },
      {
        path: "/compliance", icon: ShieldAlert, label: "Compliance",
        children: [
          { path: "/cyber-insurance", label: "Cyber Insurance Export" },
          { path: "/audit-trail", label: "Audit Trail" },
        ]
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
          { path: "/predictive-failure", label: "Predictive Intelligence" },
        ]
      },
      { path: "/dashboard-builder", icon: LayoutGrid, label: "Dashboard Builder" },
      {
        path: "/documentation-hub", icon: BookOpen, label: "Knowledge & Docs",
        children: [
          { path: "/knowledge-base", label: "Knowledge Base" },
          { path: "/documentation", label: "IT Docs" },
          { path: "/auto-documentation", label: "Auto-Docs" },
          { path: "/help", label: "Help Center" },
          { path: "/capacity-planner", label: "Capacity Planner" },
        ]
      },
    ]
  },
  {
    id: "reports",
    title: "Reports & Comms",
    items: [
      { path: "/command-center", icon: Siren, label: "Command Center" },
      { path: "/insights", icon: Sparkles, label: "Insights Hub" },
      { path: "/atmosphere", icon: Sparkles, label: "Atmosphere" },
      {
        path: "/reports", icon: BarChart3, label: "Reports",
        children: [
          { path: "/it-roadmap", label: "IT Roadmap" },
          { path: "/incident-heatmap", label: "Incident Heatmap" },
          { path: "/scheduled-reports", label: "Scheduled Emails" },
        ]
      },
      {
        path: "/email", icon: Mail, label: "Communications",
        children: [
          { path: "/o365-setup", label: "O365 Mailbox" },
          { path: "/notify-channels", label: "Slack/Teams Webhooks" },
          { path: "/csat-surveys", label: "CSAT Surveys" },
          { path: "/nps-tracker", label: "NPS Tracker" },
        ]
      },
    ]
  },
  {
    id: "platform",
    title: "Platform",
    items: [
      { path: "/settings", icon: Settings, label: "Settings" },
      {
        path: "/benchmarking", icon: Radar, label: "Planning & Lifecycle",
        children: [
          { path: "/expiry-tracker", label: "Expiry Tracker" },
          { path: "/geo-map", label: "Geo Map" },
          { path: "/hardware-refresh", label: "HW Refresh" },
          { path: "/client-budget", label: "Client Budgets" },
        ]
      },
      { path: "/integrations", icon: Server, label: "Integrations" },
    ]
  },
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
];
