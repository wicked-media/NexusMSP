import { lazy } from "react";

// Lazy-loaded page components
const page = (name) => lazy(() => import(`@/pages/${name}`));

// Route configuration
// layout: true = wrapped in MainLayout, auth: true = requires authentication
export const routeConfig = [
  // Core
  { path: "/", component: page("DashboardPage"), auth: true, layout: true },
  { path: "/morning-checks", component: page("MorningChecksPage"), auth: true, layout: true },
  { path: "/tickets", component: page("TicketsPage"), auth: true, layout: true },
  { path: "/devices", component: page("DevicesPage"), auth: true, layout: true },
  { path: "/devices/:deviceId", component: page("DeviceDetailPage"), auth: true, layout: true },
  { path: "/devices/:deviceId/chat", component: page("DeviceChatPage"), auth: true, layout: true },
  { path: "/assets", component: page("AssetsPage"), auth: true, layout: true },
  { path: "/clients", component: page("ClientsPage"), auth: true, layout: true },
  { path: "/contracts", component: page("ContractsPage"), auth: true, layout: true },
  { path: "/invoices", component: page("InvoicesPage"), auth: true, layout: true },
  { path: "/time-tracking", component: page("TimeTrackingPage"), auth: true, layout: true },
  { path: "/knowledge-base", component: page("KnowledgeBasePage"), auth: true, layout: true },

  // Integrations
  { path: "/pax8", component: page("Pax8Page"), auth: true, layout: true },
  { path: "/domotz", component: page("DomotzPage"), auth: true, layout: true },
  { path: "/remote-access", component: page("RemoteAccessPage"), auth: true, layout: true },
  { path: "/acronis", component: page("AcronisPage"), auth: true, layout: true },
  { path: "/proxmox", component: page("ProxmoxPage"), auth: true, layout: true },
  { path: "/splynx-dashboard", component: page("SplynxDashboardPage"), auth: true, layout: true },
  { path: "/xero", component: page("XeroDashboardPage"), auth: true, layout: true },
  { path: "/o365-setup", component: page("O365SetupPage"), auth: true, layout: true },

  // Reports & Analytics
  { path: "/reports", component: page("ReportsHubPage"), auth: true, layout: true },
  { path: "/financial-reports", component: page("ReportsHubPage"), auth: true, layout: true },
  { path: "/roi-reports", component: page("ReportsHubPage"), auth: true, layout: true },
  { path: "/benchmarking", component: page("BenchmarkingPage"), auth: true, layout: true },
  { path: "/profitability-heatmap", component: page("ProfitabilityHeatmapPage"), auth: true, layout: true },
  { path: "/incident-heatmap", component: page("IncidentHeatmapPage"), auth: true, layout: true },
  { path: "/cost-per-ticket", component: page("CostPerTicketPage"), auth: true, layout: true },
  { path: "/revenue-forecast", component: page("RevenueCommandCenterPage"), auth: true, layout: true },
  { path: "/rpe-dashboard", component: page("RpeDashboardPage"), auth: true, layout: true },
  { path: "/client-reports", component: page("ReportsHubPage"), auth: true, layout: true },

  // Service Management
  { path: "/sla-timer", component: page("SlaManagerPage"), auth: true, layout: true },
  { path: "/sla-penalties", component: page("SlaManagerPage"), auth: true, layout: true },
  { path: "/dispatch-board", component: page("DispatchCenterPage"), auth: true, layout: true },
  { path: "/escalation-matrix", component: page("EscalationMatrixPage"), auth: true, layout: true },
  { path: "/change-management", component: page("ChangeManagementPage"), auth: true, layout: true },
  { path: "/postmortem", component: page("PostmortemPage"), auth: true, layout: true },
  { path: "/approvals", component: page("ApprovalWorkflowsPage"), auth: true, layout: true },
  { path: "/live-chat", component: page("LiveChatPage"), auth: true, layout: true },
  { path: "/bulk-actions", component: page("BulkActionsPage"), auth: true, layout: true },

  // Infrastructure
  { path: "/topology", component: page("TopologyPage"), auth: true, layout: true },
  { path: "/networking", component: page("NetworkingPage"), auth: true, layout: true },
  { path: "/dmarc-compliance", component: page("DmarcCompliancePage"), auth: true, layout: true },
  { path: "/qr-assets", component: page("QrAssetsPage"), auth: true, layout: true },
  { path: "/asset-lifecycle", component: page("AssetLifecyclePage"), auth: true, layout: true },
  { path: "/asset-depreciation", component: page("AssetDepreciationPage"), auth: true, layout: true },
  { path: "/warranty-tracker", component: page("WarrantyTrackerPage"), auth: true, layout: true },
  { path: "/backup-compliance", component: page("BackupCommandCenterPage"), auth: true, layout: true },
  { path: "/procurement-planner", component: page("ProcurementPlannerPage"), auth: true, layout: true },
  { path: "/predictive-maintenance", component: page("PredictiveIntelPage"), auth: true, layout: true },
  { path: "/doc-scanner", component: page("DocScannerPage"), auth: true, layout: true },
  { path: "/vault", component: page("VaultPage"), auth: true, layout: true },
  { path: "/runbooks", component: page("RunbooksPage"), auth: true, layout: true },
  { path: "/scripting", component: page("ScriptingPage"), auth: true, layout: true },

  // People & Scheduling
  { path: "/technicians", component: page("TechniciansPage"), auth: true, layout: true },
  { path: "/skills-matrix", component: page("SkillsMatrixPage"), auth: true, layout: true },
  { path: "/tech-utilization", component: page("TechUtilizationPage"), auth: true, layout: true },
  { path: "/leaderboard", component: page("LeaderboardPage"), auth: true, layout: true },
  { path: "/scheduling", component: page("DispatchCenterPage"), auth: true, layout: true },
  { path: "/smart-scheduling", component: page("DispatchCenterPage"), auth: true, layout: true },

  // Client Management
  { path: "/client-health", component: page("ClientHealthPage"), auth: true, layout: true },
  { path: "/client-timeline", component: page("ClientTimelinePage"), auth: true, layout: true },
  { path: "/client-compare", component: page("ClientComparePage"), auth: true, layout: true },
  { path: "/client-risk", component: page("ClientRiskPage"), auth: true, layout: true },
  { path: "/csat-surveys", component: page("CsatSurveysPage"), auth: true, layout: true },
  { path: "/onboarding", component: page("OnboardingWizardPage"), auth: true, layout: true },
  { path: "/sentiment", component: page("SentimentDashboardPage"), auth: true, layout: true },
  { path: "/it-roadmap", component: page("ItRoadmapPage"), auth: true, layout: true },
  { path: "/upsell", component: page("UpsellPage"), auth: true, layout: true },
  { path: "/contract-profit", component: page("ContractProfitPage"), auth: true, layout: true },
  { path: "/vendor-scorecard", component: page("VendorScorecardPage"), auth: true, layout: true },
  { path: "/compliance", component: page("ComplianceHubPage"), auth: true, layout: true },

  // Business Operations
  { path: "/leads", component: page("LeadsPage"), auth: true, layout: true },
  { path: "/loyalty", component: page("LoyaltyDashboardPage"), auth: true, layout: true },
  { path: "/campaigns", component: page("CampaignsPage"), auth: true, layout: true },
  { path: "/products", component: page("ProductsPage"), auth: true, layout: true },
  { path: "/purchase-orders", component: page("PurchaseOrdersPage"), auth: true, layout: true },
  { path: "/stocktake", component: page("StocktakePage"), auth: true, layout: true },
  { path: "/vendors", component: page("VendorsPage"), auth: true, layout: true },
  { path: "/rentals", component: page("RentalsPage"), auth: true, layout: true },
  { path: "/projects", component: page("ProjectsPage"), auth: true, layout: true },
  { path: "/estimates", component: page("EstimatesPage"), auth: true, layout: true },
  { path: "/billing-recon", component: page("BillingReconPage"), auth: true, layout: true },

  // Communication
  { path: "/email", component: page("EmailPage"), auth: true, layout: true },
  { path: "/documentation", component: page("ITDocumentationPage"), auth: true, layout: true },
  { path: "/settings", component: page("SettingsPage"), auth: true, layout: true },
  { path: "/expiry-tracker", component: page("ExpiryTrackerPage"), auth: true, layout: true },
  { path: "/white-label", component: page("WhiteLabelPage"), auth: true, layout: true },
  { path: "/ticket-settings", component: page("TicketSettingsPage"), auth: true, layout: true },
  { path: "/ticket-ping-settings", component: page("TicketPingSettingsPage"), auth: true, layout: true },
  { path: "/health-radar", component: page("HealthRadarPage"), auth: true, layout: true },

  // Phase C new features
  { path: "/dns-monitor", component: page("DnsMonitorPage"), auth: true, layout: true },
  { path: "/patch-compliance", component: page("PatchCompliancePage"), auth: true, layout: true },
  { path: "/client-portal-admin", component: page("ClientPortalAdminPage"), auth: true, layout: true },
  { path: "/backup-dashboard", component: page("BackupCommandCenterPage"), auth: true, layout: true },
  { path: "/mfa-management", component: page("MfaManagementPage"), auth: true, layout: true },
  { path: "/alert-suppression", component: page("AlertSuppressionPage"), auth: true, layout: true },
  { path: "/license-management", component: page("LicenseManagementPage"), auth: true, layout: true },
  { path: "/maintenance-scheduler", component: page("MaintenanceSchedulerPage"), auth: true, layout: true },
  { path: "/bandwidth-monitor", component: page("BandwidthMonitorPage"), auth: true, layout: true },

  // Phase D: Security Operations + Huntress-killers
  { path: "/security-dashboard", component: page("SecurityDashboardPage"), auth: true, layout: true },
  { path: "/endpoint-security", component: page("EndpointSecurityPage"), auth: true, layout: true },
  { path: "/threat-timeline", component: page("ThreatTimelinePage"), auth: true, layout: true },
  { path: "/identity-threats", component: page("IdentityThreatPage"), auth: true, layout: true },
  { path: "/ransomware-canary", component: page("RansomwareCanaryPage"), auth: true, layout: true },
  { path: "/remediation-playbooks", component: page("RemediationPlaybooksPage"), auth: true, layout: true },
  { path: "/soc-feed", component: page("SocFeedPage"), auth: true, layout: true },
  { path: "/vulnerability-scanner", component: page("VulnerabilityScannerPage"), auth: true, layout: true },
  { path: "/third-party-patching", component: page("ThirdPartyPatchingPage"), auth: true, layout: true },
  { path: "/compliance-report-gen", component: page("ComplianceHubPage"), auth: true, layout: true },
  { path: "/audit-trail", component: page("AuditTrailPage"), auth: true, layout: true },

  // Phase D: Operations & Business
  { path: "/script-ticket", component: page("ScriptTicketPage"), auth: true, layout: true },
  { path: "/custom-monitors", component: page("CustomMonitorsPage"), auth: true, layout: true },
  { path: "/recurring-invoices", component: page("RecurringInvoicesPage"), auth: true, layout: true },
  { path: "/kanban-tickets", component: page("KanbanTicketsPage"), auth: true, layout: true },
  { path: "/password-rotation", component: page("PasswordRotationPage"), auth: true, layout: true },
  { path: "/sla-report-gen", component: page("SlaManagerPage"), auth: true, layout: true },
  { path: "/capacity-planner", component: page("CapacityPlannerPage"), auth: true, layout: true },
  { path: "/auto-documentation", component: page("AutoDocumentationPage"), auth: true, layout: true },

  // Phase E: Deep Patching
  { path: "/patch-hub", component: page("PatchHubPage"), auth: true, layout: true },

  // Phase E: AI & Autonomous
  { path: "/nlp-query", component: page("NLPQueryPage"), auth: true, layout: true },
  { path: "/ai-resolution", component: page("AIResolutionPage"), auth: true, layout: true },

  // Phase F: AI Self-Healing + Advanced Ops
  { path: "/self-healing", component: page("SelfHealingPage"), auth: true, layout: true },
  { path: "/predictive-failure", component: page("PredictiveIntelPage"), auth: true, layout: true },
  { path: "/usage-billing", component: page("UsageBillingPage"), auth: true, layout: true },
  { path: "/pricing-calc", component: page("PricingCalcPage"), auth: true, layout: true },
  { path: "/comms-timeline", component: page("CommsTimelinePage"), auth: true, layout: true },
  { path: "/qbr-generator", component: page("QBRGeneratorPage"), auth: true, layout: true },
  { path: "/zero-trust", component: page("ZeroTrustPage"), auth: true, layout: true },
  { path: "/webhook-builder", component: page("WebhookBuilderPage"), auth: true, layout: true },
  { path: "/git-scripts", component: page("GitScriptsPage"), auth: true, layout: true },
  { path: "/late-payment", component: page("LatePaymentPage"), auth: true, layout: true },
  { path: "/ransomware-tabletop", component: page("RansomwareTabletopPage"), auth: true, layout: true },

  // Phase G: Dashboard Builder + Channel Mode + Real-time SOC + Revenue
  { path: "/dashboard-builder", component: page("DashboardBuilderPage"), auth: true, layout: true },
  { path: "/channel-mode", component: page("ChannelModePage"), auth: true, layout: true },
  { path: "/mobile-tech", component: page("MobileTechPage"), auth: true, layout: true },
  { path: "/soc-realtime", component: page("SocRealtimePage"), auth: true, layout: true },
  { path: "/revenue-tracker", component: page("RevenueCommandCenterPage"), auth: true, layout: true },

  { path: "/billing-dashboard", component: page("BillingDashboardPage"), auth: true, layout: true },

  // Phase E: Revenue & Billing
  { path: "/client-budget", component: page("ClientBudgetPage"), auth: true, layout: true },
  { path: "/executive-reports", component: page("ReportsHubPage"), auth: true, layout: true },
  { path: "/nps-tracker", component: page("NPSTrackerPage"), auth: true, layout: true },

  // Phase E: Security
  { path: "/dark-web-monitor", component: page("DarkWebMonitorPage"), auth: true, layout: true },
  { path: "/phishing-sim", component: page("PhishingSimPage"), auth: true, layout: true },
  { path: "/backup-verify", component: page("BackupCenterPage"), auth: true, layout: true },
  { path: "/compliance-frameworks", component: page("ComplianceCenterPage"), auth: true, layout: true },

  // Phase E: Operations
  { path: "/hardware-refresh", component: page("HardwareRefreshPage"), auth: true, layout: true },
  { path: "/geo-map", component: page("GeoMapPage"), auth: true, layout: true },

  // Special: Wallboard (no MainLayout)
  { path: "/wallboard", component: page("WallboardPage"), auth: true, layout: false },

  // Technician Settings
  { path: "/my-settings", component: page("TechSettingsPage"), auth: true, layout: true },

  // P1 Features
  { path: "/intelligent-routing", component: page("IntelligentRoutingPage"), auth: true, layout: true },
  { path: "/client-portal", component: page("ClientPortalPage"), auth: true, layout: true },
  { path: "/portal/:token", component: page("ClientPortalViewPage"), auth: false, layout: false },
  { path: "/portal-login", component: page("PortalLoginPage"), auth: false, layout: false },
  { path: "/portal-dashboard", component: page("PortalDashboardPage"), auth: false, layout: false },
  { path: "/revenue-tracking", component: page("RevenueCommandCenterPage"), auth: true, layout: true },
  { path: "/voice-ticket", component: page("VoiceTicketPage"), auth: true, layout: true },

  // P1/P2 New Features
  { path: "/workflow-automation", component: page("WorkflowAutomationPage"), auth: true, layout: true },
  { path: "/device-terminal", component: page("DeviceTerminalPage"), auth: true, layout: true },
  { path: "/scheduled-reports", component: page("ScheduledReportsPage"), auth: true, layout: true },
  { path: "/billing-portal", component: page("StripeBillingPortalPage"), auth: true, layout: true },
  { path: "/proposals", component: page("ProposalBuilderPage"), auth: true, layout: true },
  { path: "/alert-rules", component: page("AlertRulesPage"), auth: true, layout: true },

  // Auth callback (no auth, no layout)
  { path: "/auth/callback", component: page("AuthCallbackPage"), auth: false, layout: false },
  { path: "/notifications", component: page("NotificationsPage"), auth: true, layout: true },
  { path: "/workshop-bench", component: page("WorkshopBenchPage"), auth: true, layout: true },

  // Public routes (no auth, no layout)
  { path: "/pay/:token", component: page("PublicPaymentPage"), auth: false, layout: false },
  { path: "/portal/:token", component: page("MagicPortalPage"), auth: false, layout: false },
  { path: "/portal-app", component: page("TenantPortalApp"), auth: false, layout: false },
  { path: "/status-board/:clientId", component: page("StatusBoardPage"), auth: false, layout: false },
];
