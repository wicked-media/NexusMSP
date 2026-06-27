// Cleaned-up navigation: bugs fixed, duplicates removed, mergers applied.
import {
  LayoutDashboard, Ticket, Monitor, Package, Users, FileText,
  Receipt, Clock, BookOpen, Cloud, Network, Laptop, BarChart3,
  Settings, Zap, UserPlus, Shield, Mail, Terminal, Key,
  FolderKanban, Server, CalendarClock, UserCog, CalendarDays,
  ShoppingCart, Wifi, Trophy, Phone, Building2, Tags, ShieldCheck,
  Activity, CreditCard, Bell, Cpu, Heart, Wrench, Radar,
  Paintbrush, Gift, Volume2, DollarSign, Wallet, Navigation, Bot,
  KeyRound, QrCode, Workflow, Timer, ScanLine, TrendingUp,
  FileBarChart, History, ShieldAlert, Target, MapPin, Map, Award,
  CheckSquare, RefreshCw, FileSearch, Star, BarChart, Calculator,
  TrendingDown, GitBranch, Flame, MessageSquare, HardDrive,
  ShoppingBag, Globe, Lock, BellOff, Layers,
  Gauge, Eye, Bug, FileWarning, ClipboardList, Kanban,
  Search, BrainCircuit, TestTube, Crosshair, ThumbsUp, MapPinned,
  HeartPulse, AlertTriangle, Banknote, MessageCircle,
  FileSpreadsheet, Fingerprint, Webhook, GitMerge, BadgeDollarSign, Swords,
  LayoutGrid, Building, Smartphone, Radio, Coins, Brain, Mic, ChevronDown, Siren, Sparkles, Bookmark,
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
          { path: "/tickets", label: "All Tickets" },
          { path: "/triage-queue", label: "Triage Queue" },
          { path: "/kanban-tickets", label: "Kanban Board" },
          { path: "/sla-hub", label: "SLA Hub" },
          { path: "/blueprints", label: "Blueprints" },
          { path: "/service-catalog", label: "Service Catalog" },
        ]
      },
      {
        path: "/dispatch-board", icon: MapPin, label: "Dispatch & Escalation",
        children: [
          { path: "/dispatch-board", label: "Dispatch Board" },
          { path: "/workshop-bench", label: "Workshop Bench" },
          { path: "/escalation-matrix", label: "Escalation Matrix" },
          { path: "/intelligent-routing", label: "Smart Routing" },
        ]
      },
      {
        path: "/change-management", icon: GitBranch, label: "Change & Incidents",
        children: [
          { path: "/change-management", label: "Change Management" },
          { path: "/change-freezes", label: "Freeze Calendar" },
          { path: "/postmortem", label: "Post-Mortems" },
          { path: "/alert-suppression", label: "Alert Suppression" },
        ]
      },
      {
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
      },
      {
        path: "/scheduling", icon: CalendarDays, label: "Scheduling",
        children: [
          { path: "/scheduling", label: "Calendar" },
          { path: "/smart-scheduling", label: "Auto-Scheduler" },
        ]
      },
      {
        path: "/live-chat", icon: MessageSquare, label: "Live Support",
        children: [
          { path: "/team-chat", label: "Team Chat 💬" },
          { path: "/live-chat", label: "Live Chat (Customers)" },
          { path: "/voice-ticket", label: "Voice to Ticket" },
          { path: "/script-ticket", label: "Script-to-Ticket" },
          { path: "/phone-integration", label: "Phone System (PBX)" },
        ]
      },
      { path: "/onboarding", icon: ClipboardList, label: "Client Onboarding" },
      { path: "/approvals", icon: CheckSquare, label: "Approvals" },
      { path: "/wallboard", icon: Monitor, label: "NOC Wallboard" },
      { path: "/mobile-tech", icon: Smartphone, label: "Mobile Tech" },
    ]
  },
  {
    id: "infrastructure",
    title: "Infrastructure",
    items: [
      {
        path: "/devices", icon: Monitor, label: "Devices",
        children: [
          { path: "/devices", label: "All Devices" },
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
          { path: "/networking", label: "Overview" },
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
          { path: "/assets", label: "All Assets" },
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
          { path: "/automation-hub", label: "Overview" },
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
          { path: "/credentials?tab=vault", label: "Password Vault" },
          { path: "/credentials?tab=password-rotation", label: "Rotation" },
          { path: "/credentials?tab=mfa-management", label: "MFA Management" },
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
          { path: "/clients", label: "All Clients" },
          { path: "/client-insights", label: "Client Insights Hub" },
          { path: "/client-insights?tab=customer-health", label: "Customer Health" },
          { path: "/client-insights?tab=client-health", label: "RMM Health" },
          { path: "/client-insights?tab=client-timeline", label: "Timeline" },
          { path: "/comms-timeline", label: "Comms Timeline" },
          { path: "/client-compare", label: "Compare" },
          { path: "/client-insights?tab=client-risk", label: "Risk" },
          { path: "/client-insights?tab=sentiment", label: "Sentiment" },
        ]
      },
      {
        path: "/client-portal-admin", icon: Globe, label: "Client Portal",
        children: [
          { path: "/client-portal-admin", label: "Portal Admin" },
          { path: "/client-portal", label: "Self-Service" },
        ]
      },
      {
        path: "/leads", icon: UserPlus, label: "CRM",
        children: [
          { path: "/leads", label: "Leads" },
          { path: "/crm-pipeline", label: "Pipeline" },
          { path: "/campaigns", label: "Campaigns" },
          { path: "/loyalty", label: "Loyalty & Renewals" },
          { path: "/upsell", label: "Upsell Detector" },
        ]
      },
      {
        path: "/billing-pro", icon: Receipt, label: "Billing & Finance",
        children: [
          { path: "/billing-pro", label: "Billing Pro Hub" },
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
          { path: "/financial-analytics", label: "Hub" },
          { path: "/financial-reports", label: "Financial Reports" },
          { path: "/revenue-forecast", label: "Revenue Forecast" },
          { path: "/rpe-dashboard", label: "Revenue / Endpoint" },
          { path: "/contract-profit", label: "Contract Profit" },
          { path: "/profitability-heatmap", label: "Profitability Map" },
          { path: "/cost-per-ticket", label: "Cost / Ticket" },
          { path: "/roi-reports", label: "ROI Reports" },
          { path: "/revenue-tracker", label: "Revenue Tracker" },
          { path: "/saas-spend", label: "SaaS Spend" },
        ]
      },
      {
        path: "/products", icon: Package, label: "Products & Inventory",
        children: [
          { path: "/products", label: "Products" },
          { path: "/stocktake", label: "Stocktake (Desktop)" },
          { path: "/stocktake-mobile", label: "Stocktake (Mobile)" },
          { path: "/rentals", label: "Phone Rentals" },
        ]
      },
      {
        path: "/purchase-orders", icon: ShoppingCart, label: "POs & Vendors",
        children: [
          { path: "/purchase-orders", label: "Purchase Orders" },
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
          { path: "/security-dashboard", label: "Overview" },
          { path: "/soc-feed", label: "SOC Feed" },
          { path: "/soc-realtime", label: "Smart Automation" },
          { path: "/threat-timeline", label: "Threat Timeline" },
          { path: "/identity-threats", label: "Identity Threats" },
          { path: "/defender-health", label: "Defender / AV Health" },
        ]
      },
      {
        path: "/endpoint-security", icon: ShieldCheck, label: "Endpoint Security",
        children: [
          { path: "/endpoint-security", label: "Scores" },
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
          { path: "/ransomware-canary", label: "Canary" },
          { path: "/ransomware-tabletop", label: "Tabletop" },
          { path: "/remediation-playbooks", label: "Remediation" },
          { path: "/dr-plans", label: "DR Plans" },
        ]
      },
      {
        path: "/compliance", icon: ShieldAlert, label: "Compliance",
        children: [
          { path: "/compliance", label: "Compliance Center" },
          { path: "/cyber-insurance", label: "Cyber Insurance Export" },
          { path: "/credentials?tab=mfa-management", label: "MFA Management" },
          { path: "/credentials?tab=password-rotation", label: "Password Rotation" },
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
        path: "/nlp-query", icon: BrainCircuit, label: "AI Copilot",
        children: [
          { path: "/nlp-query", label: "NLP Search" },
          { path: "/auto-ops", label: "Auto-Ops Hub" },
          { path: "/auto-ops?tab=ai-resolution", label: "Auto-Resolve" },
          { path: "/auto-ops?tab=self-healing", label: "Self-Healing" },
          { path: "/auto-ops?tab=triage-queue", label: "Triage Queue" },
          { path: "/auto-ops?tab=intelligent-routing", label: "Smart Routing" },
          { path: "/predictive-failure", label: "Predictive Intelligence" },
        ]
      },
      { path: "/dashboard-builder", icon: LayoutGrid, label: "Dashboard Builder" },
      {
        path: "/documentation-hub", icon: BookOpen, label: "Knowledge & Docs",
        children: [
          { path: "/documentation-hub", label: "Docs Hub" },
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
          { path: "/reports", label: "Reports" },
          { path: "/executive-reports", label: "Executive" },
          { path: "/client-reports", label: "Client Reports" },
          { path: "/qbr-generator", label: "QBR Generator" },
          { path: "/it-roadmap", label: "IT Roadmap" },
          { path: "/incident-heatmap", label: "Incident Heatmap" },
          { path: "/scheduled-reports", label: "Scheduled Emails" },
        ]
      },
      {
        path: "/email", icon: Mail, label: "Communications",
        children: [
          { path: "/email", label: "Email" },
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
      {
        path: "/settings", icon: Settings, label: "Settings",
        children: [
          { path: "/settings", label: "General" },
          { path: "/settings?tab=branding", label: "Platform Branding" },
          { path: "/settings?tab=tiers", label: "Service Tiers" },
          { path: "/settings?tab=auth", label: "Authentication" },
          { path: "/settings?tab=mailbox", label: "Mailbox & Email" },
          { path: "/settings?tab=integrations", label: "Integrations" },
          { path: "/settings?tab=ai", label: "AI & Automation" },
          { path: "/settings?tab=notifications", label: "Notifications" },
          { path: "/settings?tab=tickets", label: "Ticket Defaults" },
          { path: "/settings?tab=ping", label: "Ping & Escalation" },
          { path: "/settings?tab=white-label", label: "White Label" },
          { path: "/settings?tab=channel", label: "Channel / MSP Mode" },
          { path: "/settings?tab=tokens", label: "API Tokens" },
          { path: "/settings?tab=twofa", label: "2FA / Security" },
          { path: "/settings?tab=comms", label: "Notify Channels" },
          { path: "/settings?tab=my-settings", label: "My Workspace" },
        ]
      },
      {
        path: "/health-radar", icon: Radar, label: "System Health",
        children: [
          { path: "/health-radar", label: "Health Radar" },
          { path: "/benchmarking", label: "Benchmarking" },
          { path: "/expiry-tracker", label: "Expiry Tracker" },
          { path: "/geo-map", label: "Geo Map" },
          { path: "/hardware-refresh", label: "HW Refresh" },
          { path: "/client-budget", label: "Client Budgets" },
        ]
      },
      {
        path: "/integrations", icon: Server, label: "Integrations",
        children: [
          { path: "/integrations", label: "Overview & Marketplace" },
          { path: "/proxmox", label: "Proxmox" },
          { path: "/domotz", label: "Domotz" },
          { path: "/acronis", label: "Acronis" },
          { path: "/pax8", label: "Pax8" },
          { path: "/hudu", label: "Hudu" },
          { path: "/cipp", label: "CIPP" },
          { path: "/m365", label: "M365 Center" },
          { path: "/unifi", label: "UniFi" },
          { path: "/suped", label: "Suped" },
          { path: "/webhook-builder", label: "Webhook Builder" },
        ]
      },
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
