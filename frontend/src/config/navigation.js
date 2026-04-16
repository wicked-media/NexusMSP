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
  ShoppingBag, Globe, PatchCheck, Lock, BellOff, Layers,
  Gauge, WifiIcon, Eye, Bug, FileWarning, ClipboardList, Kanban,
  Search, BrainCircuit, TestTube, Crosshair, ThumbsUp, MapPinned,
  HeartPulse, AlertTriangle, Banknote, MessageCircle,
  FileSpreadsheet, Fingerprint, Webhook, GitMerge, BadgeDollarSign, Swords,
  LayoutGrid, Building, Smartphone, Radio, Coins, Brain, Mic, ChevronDown
} from "lucide-react";

/*
 * CONSOLIDATED NAVIGATION
 * ~35 top-level items (down from 130+)
 * Items with `children` expand on click to reveal sub-pages
 * Items without `children` navigate directly
 */
export const navGroups = [
  {
    id: "service_desk",
    title: "Service Desk",
    items: [
      { path: "/", icon: LayoutDashboard, label: "Dashboard" },
      { path: "/morning-checks", icon: Activity, label: "Morning Checks" },
      {
        path: "/tickets", icon: Ticket, label: "Tickets",
        children: [
          { path: "/tickets", label: "All Tickets" },
          { path: "/kanban-tickets", label: "Kanban Board" },
          { path: "/sla-timer", label: "SLA Center" },
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
          { path: "/incident-heatmap", label: "Incident Heatmap" },
          { path: "/postmortem", label: "Post-Mortems" },
          { path: "/alert-suppression", label: "Alert Suppression" },
        ]
      },
      {
        path: "/technicians", icon: UserCog, label: "Team Management",
        children: [
          { path: "/technicians", label: "Technicians" },
          { path: "/skills-matrix", label: "Skills Matrix" },
          { path: "/tech-utilization", label: "Utilization" },
          { path: "/leaderboard", label: "Leaderboard" },
        ]
      },
      {
        path: "/scheduling", icon: CalendarDays, label: "Scheduling",
        children: [
          { path: "/scheduling", label: "Calendar" },
          { path: "/smart-scheduling", label: "Smart Routing" },
          { path: "/maintenance-scheduler", label: "Maintenance" },
        ]
      },
      {
        path: "/live-chat", icon: MessageSquare, label: "Live Support",
        children: [
          { path: "/live-chat", label: "Live Chat" },
          { path: "/voice-ticket", label: "Voice to Ticket" },
          { path: "/script-ticket", label: "Script-to-Ticket" },
        ]
      },
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
          { path: "/bulk-actions", label: "Bulk Actions" },
          { path: "/remote-access", label: "Remote Access" },
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
          { path: "/asset-lifecycle", label: "Lifecycle" },
          { path: "/asset-depreciation", label: "Depreciation" },
          { path: "/warranty-tracker", label: "Warranty" },
          { path: "/procurement-planner", label: "Procurement" },
        ]
      },
      {
        path: "/backup-dashboard", icon: HardDrive, label: "Backup Center",
        children: [
          { path: "/backup-dashboard", label: "Backup Center" },
        ]
      },
      {
        path: "/patch-hub", icon: Layers, label: "Patch Management",
        children: [
          { path: "/patch-hub", label: "Patch Hub" },
          { path: "/patch-compliance", label: "Compliance" },
          { path: "/third-party-patching", label: "3rd Party" },
        ]
      },
      {
        path: "/vault", icon: KeyRound, label: "Security Tools",
        children: [
          { path: "/vault", label: "Password Vault" },
          { path: "/runbooks", label: "Runbook Automation" },
          { path: "/scripting", label: "Scripting" },
          { path: "/doc-scanner", label: "Document Scanner" },
          { path: "/workflow-automation", label: "Workflow Builder" },
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
          { path: "/client-health", label: "Health" },
          { path: "/client-timeline", label: "Timeline" },
          { path: "/client-compare", label: "Compare" },
          { path: "/client-risk", label: "Risk" },
          { path: "/sentiment", label: "Sentiment" },
          { path: "/csat-surveys", label: "CSAT Surveys" },
          { path: "/onboarding", label: "Onboarding" },
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
        path: "/leads", icon: UserPlus, label: "Leads & CRM",
        children: [
          { path: "/leads", label: "Leads" },
          { path: "/campaigns", label: "Campaigns" },
          { path: "/loyalty", label: "Loyalty & Renewals" },
          { path: "/upsell", label: "Upsell Detector" },
        ]
      },
      {
        path: "/xero", icon: Receipt, label: "Finance Center",
        children: [
          { path: "/xero", label: "Overview" },
          { path: "/invoices", label: "Invoices" },
          { path: "/estimates", label: "Estimates" },
          { path: "/recurring-invoices", label: "Recurring" },
          { path: "/billing-dashboard", label: "Billing Command" },
          { path: "/billing-recon", label: "Reconciliation" },
          { path: "/usage-billing", label: "Usage Billing" },
          { path: "/billing-portal", label: "Billing Portal" },
          { path: "/proposals", label: "Proposals & Quotes" },
          { path: "/late-payment", label: "Late Payment AI" },
          { path: "/pricing-calc", label: "Pricing Calculator" },
        ]
      },
      {
        path: "/financial-reports", icon: DollarSign, label: "Financial Analytics",
        children: [
          { path: "/financial-reports", label: "Financial Reports" },
          { path: "/revenue-forecast", label: "Revenue Forecast" },
          { path: "/rpe-dashboard", label: "Revenue/Endpoint" },
          { path: "/contract-profit", label: "Contract Profit" },
          { path: "/profitability-heatmap", label: "Profitability Map" },
          { path: "/cost-per-ticket", label: "Cost/Ticket" },
          { path: "/roi-reports", label: "ROI Reports" },
          { path: "/revenue-tracker", label: "Revenue Analytics" },
        ]
      },
      {
        path: "/products", icon: Package, label: "Products & Inventory",
        children: [
          { path: "/products", label: "Products" },
          { path: "/stocktake", label: "Stocktake" },
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
        ]
      },
      {
        path: "/endpoint-security", icon: ShieldCheck, label: "Endpoint Security",
        children: [
          { path: "/endpoint-security", label: "Scores" },
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
        ]
      },
      {
        path: "/compliance", icon: ShieldAlert, label: "Compliance Center",
        children: [
          { path: "/compliance", label: "Compliance Center" },
          { path: "/mfa-management", label: "MFA Management" },
          { path: "/password-rotation", label: "Password Rotation" },
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
          { path: "/ai-resolution", label: "Auto-Resolve" },
          { path: "/self-healing", label: "Self-Healing" },
          { path: "/predictive-failure", label: "Predictive Intelligence" },
          { path: "/predictive-failure", label: "Predictive Intelligence" },
        ]
      },
      { path: "/dashboard-builder", icon: LayoutGrid, label: "Dashboard Builder" },
      {
        path: "/knowledge-base", icon: BookOpen, label: "Knowledge & Docs",
        children: [
          { path: "/knowledge-base", label: "Knowledge Base" },
          { path: "/documentation", label: "IT Docs" },
          { path: "/auto-documentation", label: "Auto-Docs" },
          { path: "/capacity-planner", label: "Capacity Planner" },
        ]
      },
    ]
  },
  {
    id: "reports",
    title: "Reports & Comms",
    items: [
      {
        path: "/reports", icon: BarChart3, label: "Reports",
        children: [
          { path: "/reports", label: "Reports" },
          { path: "/executive-reports", label: "Executive" },
          { path: "/client-reports", label: "Client Reports" },
          { path: "/sla-report-gen", label: "SLA Center" },
          { path: "/qbr-generator", label: "QBR Generator" },
          { path: "/it-roadmap", label: "IT Roadmap" },
          { path: "/scheduled-reports", label: "Scheduled Emails" },
        ]
      },
      {
        path: "/email", icon: Mail, label: "Communications",
        children: [
          { path: "/email", label: "Email" },
          { path: "/o365-setup", label: "O365 Mailbox" },
          { path: "/comms-timeline", label: "Timeline" },
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
          { path: "/ticket-settings", label: "Ticket Settings" },
          { path: "/ticket-ping-settings", label: "Ping & Escalation" },
          { path: "/white-label", label: "White Label" },
          { path: "/channel-mode", label: "Channel / MSP Mode" },
        ]
      },
      {
        path: "/health-radar", icon: Radar, label: "System Health",
        children: [
          { path: "/health-radar", label: "Health Radar" },
          { path: "/benchmarking", label: "Benchmarking" },
          { path: "/nps-tracker", label: "NPS Tracker" },
          { path: "/expiry-tracker", label: "Expiry Tracker" },
          { path: "/geo-map", label: "Geo Map" },
          { path: "/hardware-refresh", label: "HW Refresh" },
          { path: "/client-budget", label: "Client Budgets" },
        ]
      },
      {
        path: "/proxmox", icon: Server, label: "Integrations",
        children: [
          { path: "/proxmox", label: "Proxmox" },
          { path: "/domotz", label: "Domotz" },
          { path: "/acronis", label: "Acronis" },
          { path: "/pax8", label: "Pax8" },
          { path: "/webhook-builder", label: "Webhook Builder" },
          { path: "/git-scripts", label: "Git Scripts Sync" },
        ]
      },
    ]
  },
];

// Flat list of all items for search/routing
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

// Module group IDs for toggle (what admins can enable/disable per tech)
export const MODULE_GROUPS = [
  { id: "service_desk", label: "Service Desk", description: "Tickets, dispatch, scheduling, live support" },
  { id: "infrastructure", label: "Infrastructure", description: "Devices, network, assets, backups, patching" },
  { id: "business", label: "Business", description: "Clients, invoicing, billing, financials" },
  { id: "security", label: "Security", description: "SOC, endpoint security, compliance" },
  { id: "intelligence", label: "AI & Intelligence", description: "AI copilot, predictions, knowledge base" },
  { id: "reports", label: "Reports & Comms", description: "Reports, email, communications" },
  { id: "platform", label: "Platform", description: "Settings, integrations, system health" },
];
