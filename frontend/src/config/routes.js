import { lazy } from "react";

// Lazy-loaded page components
const page = (name) => lazy(() => import(`@/pages/${name}`));
// Keep this direct import explicit.  Deployment Hub can be introduced after a
// local dev server has already started; a direct lazy chunk avoids the generic
// dynamic-import context falling through to the application catch-all route.
const DeploymentHubPage = lazy(() => import("@/pages/DeploymentHubPage"));

// Route configuration
// layout: true = wrapped in MainLayout, auth: true = requires authentication
export const routeConfig = [
  // Core
  { path: "/", component: page("DashboardPage"), auth: true, layout: true },
  { path: "/nexus-suite", component: page("NexusSuitePage"), auth: true, layout: true },
  { path: "/deployment-hub", component: DeploymentHubPage, auth: true, layout: true },
  { path: "/shadow-it", component: page("ShadowITPage"), auth: true, layout: true },
  { path: "/nexus-elevate", component: page("NexusElevatePage"), auth: true, layout: true },
  { path: "/hudu", component: page("HuduCommandCenterPage"), auth: true, layout: true },
  { path: "/control-plane", component: page("NexusControlPlanePage"), auth: true, layout: true },
  { path: "/production-readiness", component: page("ProductionReadinessPage"), auth: true, layout: true },
  { path: "/diagnostics", component: page("DiagnosticsWorkspacePage"), auth: true, layout: true },
  { path: "/executive", component: page("ExecutivePage"), auth: true, layout: true },
  // Preserve historic bookmarks while keeping Microsoft tenant operations in
  // one provider-agnostic Nexus Control Plane workspace.
  { path: "/cipp", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/control-plane?module=microsoft365&view=tenant-operations" },
  { path: "/m365", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/control-plane?module=microsoft365&view=security" },
  { path: "/unifi", component: page("UnifiCommandCenterPage"), auth: true, layout: true },
  { path: "/nexus-agent", component: page("NexusAgentCenterPage"), auth: true, layout: true },
  { path: "/warroom", component: page("WarRoomPage"), auth: true, layout: true },
  { path: "/warroom/:id", component: page("WarRoomPage"), auth: true, layout: false },
  { path: "/warroom/public/:slug", component: page("WarRoomPublicPage"), auth: false, layout: false },
  // Roster is managed inside Team Hub; keep legacy links functional.
  { path: "/tech-roster", component: page("TechRosterRedirectPage"), auth: true, layout: true },
  { path: "/blueprints", component: page("BlueprintsPage"), auth: true, layout: true },
  { path: "/qbr", component: page("QBRPage"), auth: true, layout: true },
  { path: "/invoice-templates", component: page("InvoiceTemplatesPage"), auth: true, layout: true },
  { path: "/billing-pro", component: page("BillingProPage"), auth: true, layout: true },
  { path: "/kiosk/:kioskToken", component: page("KioskPage"), auth: false, layout: false },
  { path: "/growth", component: page("GrowthPage"), auth: true, layout: true },
  { path: "/suped", component: page("SupedCommandCenterPage"), auth: true, layout: true },
  { path: "/integrations", component: page("IntegrationsOverviewPage"), auth: true, layout: true },
  // Morning Checks is now the audited Daily NOC sign-off inside Dashboard.
  // Preserve historic bookmarks without exposing a duplicate workspace.
  { path: "/morning-checks", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/" },
  { path: "/workspace", component: page("WorkspacePage"), auth: true, layout: true },
  { path: "/tickets", component: page("TicketsPage"), auth: true, layout: true },
  { path: "/devices", component: page("DevicesPage"), auth: true, layout: true },
  { path: "/devices/compare", component: page("DeviceComparePage"), auth: true, layout: true },
  { path: "/devices/:deviceId", component: page("DeviceDetailPage"), auth: true, layout: true },
  { path: "/devices/:deviceId/chat", component: page("DeviceChatPage"), auth: true, layout: true },
  { path: "/assets", component: page("AssetsPage"), auth: true, layout: true },
  { path: "/assets/:assetId", component: page("AssetsPage"), auth: true, layout: true },
  { path: "/clients", component: page("ClientsPage"), auth: true, layout: true },
  { path: "/contracts", component: page("ContractsPage"), auth: true, layout: true },
  { path: "/invoices", component: page("InvoicesPage"), auth: true, layout: true },
  { path: "/time-tracking", component: page("TimeTrackingPage"), auth: true, layout: true },
  { path: "/knowledge-base", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/documentation-hub?tab=library" },
  { path: "/insights", component: page("InsightsHubPage"), auth: true, layout: true },
  // The original cross-domain Command Center duplicated the Dashboard, Team,
  // Finance and AI workspaces. Keep existing bookmarks working without a
  // second operational cockpit.
  { path: "/command-center", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/" },
  { path: "/me", component: page("TechProfilePage"), auth: true, layout: true },
  { path: "/team/:id", component: page("TechProfilePage"), auth: true, layout: true },
  { path: "/help", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/documentation-hub?tab=help" },
  { path: "/help/:slug", component: page("HelpCenterPage"), auth: true, layout: true },
  // Atmosphere duplicated the live wallboard, asset lifecycle, security, client and
  // team workspaces. Preserve inbound links while sending users to the operational view.
  { path: "/atmosphere", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/wallboard" },
  { path: "/change-freezes", component: page("ChangeFreezePage"), auth: true, layout: true },
  { path: "/finance-intel", component: page("FinanceIntelPage"), auth: true, layout: true },
  // Tactical RMM reliability was replaced by the Nexus Agent. Keep historic
  // links working, but return technicians to the one Managed Assets workspace.
  { path: "/device-reliability", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/devices" },

  // Integrations
  { path: "/pax8", component: page("Pax8CommandCenterPage"), auth: true, layout: true },
  { path: "/domotz", component: page("DomotzPage"), auth: true, layout: true },
  { path: "/remote-access", component: page("RemoteAccessPage"), auth: true, layout: true },
  { path: "/acronis", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/backup-center?tab=tenants" },
  { path: "/proxmox", component: page("ProxmoxPage"), auth: true, layout: true },
  { path: "/splynx-dashboard", component: page("SplynxDashboardPage"), auth: true, layout: true },
  { path: "/xero", component: page("XeroDashboardPage"), auth: true, layout: true },

  // Reports & Analytics
  { path: "/reports", component: page("ReportsHubPage"), auth: true, layout: true },
  { path: "/financial-reports", component: page("FinancialRouteRedirectPage"), auth: true, layout: true, redirectTo: "/reports?tab=financial" },
  { path: "/roi-reports", component: page("FinancialRouteRedirectPage"), auth: true, layout: true, redirectTo: "/reports?tab=roi" },
  { path: "/benchmarking", component: page("BenchmarkingPage"), auth: true, layout: true },
  { path: "/profitability-heatmap", component: page("ProfitabilityHeatmapPage"), auth: true, layout: true },
  { path: "/incident-heatmap", component: page("IncidentHeatmapPage"), auth: true, layout: true },
  { path: "/cost-per-ticket", component: page("CostPerTicketPage"), auth: true, layout: true },
  { path: "/revenue-forecast", component: page("RevenueCommandCenterPage"), auth: true, layout: true },
  { path: "/rpe-dashboard", component: page("RpeDashboardPage"), auth: true, layout: true },
  { path: "/client-reports", component: page("FinancialRouteRedirectPage"), auth: true, layout: true, redirectTo: "/reports?tab=clients" },

  // Service Management
  { path: "/sla-timer", component: page("SlaManagerPage"), auth: true, layout: true },
  { path: "/sla-penalties", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/sla-timer?tab=penalties" },
  { path: "/dispatch-board", component: page("DispatchCenterPage"), auth: true, layout: true },
  { path: "/escalation-matrix", component: page("EscalationMatrixPage"), auth: true, layout: true },
  { path: "/change-management", component: page("ChangeManagementPage"), auth: true, layout: true },
  { path: "/postmortem", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/reports?tab=postmortems" },
  { path: "/live-chat", component: page("LiveChatPage"), auth: true, layout: true },
  // Bulk actions are now part of Managed Assets, where the selected-device
  // toolbar can show actual Nexus Agent eligibility and command results.
  { path: "/bulk-actions", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/devices" },

  // Infrastructure
  { path: "/topology", component: page("TopologyPage"), auth: true, layout: true },
  { path: "/networking", component: page("NetworkingPage"), auth: true, layout: true },
  { path: "/dmarc-compliance", component: page("DmarcCompliancePage"), auth: true, layout: true },
  { path: "/qr-assets", component: page("QrAssetsPage"), auth: true, layout: true },
  { path: "/asset-lifecycle", component: page("AssetLifecyclePage"), auth: true, layout: true },
  { path: "/asset-depreciation", component: page("AssetDepreciationPage"), auth: true, layout: true },
  // Warranty evidence belongs to the canonical inventory record. Preserve
  // historic links without keeping a second, conflicting warranty register.
  { path: "/warranty-tracker", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/asset-lifecycle" },
  { path: "/backup-compliance", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/backup-center" },
  { path: "/procurement-planner", component: page("ProcurementPlannerPage"), auth: true, layout: true },
  { path: "/predictive-maintenance", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/predictive-failure" },
  { path: "/doc-scanner", component: page("DocScannerPage"), auth: true, layout: true },
  // NexusMSP does not manage credentials or MFA. Legacy links point to the external credential workspace.
  { path: "/vault", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/hudu" },
  { path: "/runbooks", component: page("RunbooksPage"), auth: true, layout: true },
  { path: "/scripting", component: page("ScriptingPage"), auth: true, layout: true },

  // People & Scheduling — Team Command is the single workspace; retain old URLs as redirects.
  { path: "/tech-command", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/team-hub?tab=command&view=directory" },
  { path: "/technicians", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/team-hub?tab=command&view=directory" },
  { path: "/skills-matrix", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/team-hub?tab=command&view=skills" },
  { path: "/tech-utilization", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/team-hub?tab=command&view=capacity" },
  { path: "/leaderboard", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/team-hub?tab=command&view=leaderboard" },
  { path: "/scheduling", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/dispatch-board?tab=calendar" },
  { path: "/smart-scheduling", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/dispatch-board?tab=availability" },

  // Client Management
  { path: "/client-health", component: page("ClientInsightsTabRedirectPage"), auth: true, layout: true, redirectTab: "client-health" },
  { path: "/client-timeline", component: page("ClientInsightsTabRedirectPage"), auth: true, layout: true, redirectTab: "client-timeline" },
  { path: "/client-compare", component: page("ClientComparePage"), auth: true, layout: true },
  { path: "/client-risk", component: page("ClientInsightsTabRedirectPage"), auth: true, layout: true, redirectTab: "client-risk" },
  { path: "/csat-surveys", component: page("CsatSurveysPage"), auth: true, layout: true },
  { path: "/onboarding", component: page("OnboardingWizardPage"), auth: true, layout: true },
  { path: "/sentiment", component: page("ClientInsightsTabRedirectPage"), auth: true, layout: true, redirectTab: "sentiment" },
  // Legacy Upsell Detector links now resolve to the richer Revenue Growth pipeline.
  { path: "/upsell", component: page("UpsellRedirectPage"), auth: true, layout: true },
  { path: "/contract-profit", component: page("ContractProfitPage"), auth: true, layout: true },
  { path: "/vendor-scorecard", component: page("VendorScorecardPage"), auth: true, layout: true },
  { path: "/compliance", component: page("ComplianceHubPage"), auth: true, layout: true },

  // Business Operations
  { path: "/leads", component: page("LeadsPage"), auth: true, layout: true },
  { path: "/loyalty", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/leads?tab=renewals" },
  { path: "/campaigns", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/leads?tab=campaigns" },
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
  { path: "/documentation", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/documentation-hub?tab=it-docs" },
  { path: "/settings", component: page("SettingsPage"), auth: true, layout: true },
  { path: "/expiry-tracker", component: page("ExpiryTrackerPage"), auth: true, layout: true },
  { path: "/white-label", component: page("WhiteLabelPage"), auth: true, layout: true },
  { path: "/ticket-settings", component: page("TicketSettingsPage"), auth: true, layout: true },
  { path: "/ticket-ping-settings", component: page("TicketPingSettingsPage"), auth: true, layout: true },
  { path: "/health-radar", component: page("HealthRadarPage"), auth: true, layout: true },

  // Phase C new features
  { path: "/dns-monitor", component: page("DnsMonitorPage"), auth: true, layout: true },
  { path: "/patch-compliance", component: page("PatchCompliancePage"), auth: true, layout: true },
  { path: "/client-portal-admin", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/client-portal?view=access" },
  { path: "/backup-dashboard", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/backup-center" },
  { path: "/backup-command-center", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/backup-center" },
  { path: "/mfa-management", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/control-plane?module=microsoft365&view=security" },
  // The former suppression screen only stored display rules; it never took part
  // in alert evaluation. Keep old links working, but route technicians to the
  // enforced Alert Rules Engine instead.
  { path: "/alert-suppression", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/alert-rules" },
  { path: "/services-subscriptions", component: page("LicenseManagementPage"), auth: true, layout: true },
  // Licences are one recurring-service category, not a second billing workspace.
  // Keep old bookmarks valid while consolidating the register under Billing & Finance.
  { path: "/license-management", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/services-subscriptions?view=licences" },
  { path: "/maintenance-scheduler", component: page("MaintenanceSchedulerPage"), auth: true, layout: true },
  { path: "/bandwidth-monitor", component: page("BandwidthMonitorPage"), auth: true, layout: true },

  // Phase D: Security Operations + Huntress-killers
  { path: "/security-dashboard", component: page("SecurityDashboardPage"), auth: true, layout: true },
  { path: "/security-graph", component: page("SecurityGraphPage"), auth: true, layout: true },
  { path: "/nexus-shield", component: page("NexusShieldPage"), auth: true, layout: true },
  { path: "/mail-shield", component: page("NexusMailShieldPage"), auth: true, layout: true },
  { path: "/endpoint-security", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/nexus-shield?tab=endpoints" },
  { path: "/threat-timeline", component: page("ThreatTimelinePage"), auth: true, layout: true },
  { path: "/identity-threats", component: page("IdentityThreatPage"), auth: true, layout: true },
  { path: "/ransomware-canary", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/nexus-shield?tab=canary" },
  { path: "/remediation-playbooks", component: page("RemediationPlaybooksPage"), auth: true, layout: true },
  { path: "/soc-feed", component: page("SocFeedPage"), auth: true, layout: true },
  { path: "/vulnerability-scanner", component: page("VulnerabilityScannerPage"), auth: true, layout: true },
  { path: "/third-party-patching", component: page("ThirdPartyPatchingPage"), auth: true, layout: true },
  { path: "/compliance-report-gen", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/compliance?tab=reports" },
  { path: "/audit-trail", component: page("AuditTrailPage"), auth: true, layout: true },

  // Phase D: Operations & Business
  { path: "/script-ticket", component: page("ScriptTicketPage"), auth: true, layout: true },
  { path: "/custom-monitors", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/nexus-agent" },
  { path: "/recurring-invoices", component: page("RecurringInvoicesPage"), auth: true, layout: true },
  { path: "/password-rotation", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/hudu" },
  { path: "/sla-report-gen", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/sla-timer?tab=reports" },
  { path: "/capacity-planner", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/documentation-hub?tab=capacity" },
  { path: "/auto-documentation", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/documentation-hub?tab=automation" },

  // Phase E: Deep Patching
  { path: "/patch-hub", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/maintenance-scheduler" },

  // Phase E: AI & Autonomous
  // Conversational AI is available globally from the sidebar; retain old deep links for operations.
  { path: "/nlp-query", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/auto-ops" },
  { path: "/ai-resolution", component: page("AIResolutionPage"), auth: true, layout: true },

  // Phase F: AI Self-Healing + Advanced Ops
  { path: "/self-healing", component: page("SelfHealingPage"), auth: true, layout: true },
  { path: "/predictive-failure", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/auto-ops?tab=predictive" },
  { path: "/usage-billing", component: page("UsageBillingPage"), auth: true, layout: true },
  { path: "/pricing-calc", component: page("PricingCalcPage"), auth: true, layout: true },
  // The standalone communications page was consolidated into Client Insights.
  // Preserve existing bookmarks while keeping one authoritative client timeline.
  { path: "/comms-timeline", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/client-insights?tab=client-timeline" },
  // Legacy QBR generator bookmarks resolve to the unified QBR workspace.
  { path: "/qbr-generator", component: page("QBRRedirectPage"), auth: true, layout: true },
  { path: "/zero-trust", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/control-plane?module=microsoft365&view=security" },
  { path: "/webhook-builder", component: page("WebhookBuilderPage"), auth: true, layout: true },
  { path: "/git-scripts", component: page("GitScriptsPage"), auth: true, layout: true },
  { path: "/late-payment", component: page("LatePaymentPage"), auth: true, layout: true },
  { path: "/ransomware-tabletop", component: page("RansomwareTabletopPage"), auth: true, layout: true },

  // Dashboard Builder was a duplicate cockpit. Preserve old bookmarks without exposing it.
  { path: "/dashboard-builder", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/" },
  { path: "/channel-mode", component: page("ChannelModePage"), auth: true, layout: true },
  { path: "/soc-realtime", component: page("SocRealtimePage"), auth: true, layout: true },
  { path: "/revenue-tracker", component: page("FinancialRouteRedirectPage"), auth: true, layout: true, redirectTo: "/revenue-forecast" },

  { path: "/billing-dashboard", component: page("BillingDashboardPage"), auth: true, layout: true },

  // Phase E: Revenue & Billing
  { path: "/client-budget", component: page("ClientBudgetPage"), auth: true, layout: true },
  { path: "/executive-reports", component: page("FinancialRouteRedirectPage"), auth: true, layout: true, redirectTo: "/reports?tab=clients" },
  { path: "/nps-tracker", component: page("NPSTrackerPage"), auth: true, layout: true },

  // Phase E: Security
  { path: "/dark-web-monitor", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/security-dashboard" },
  { path: "/phishing-sim", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/security-dashboard" },
  { path: "/backup-center", component: page("BackupCenterPage"), auth: true, layout: true },
  { path: "/backup-verify", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/backup-center" },
  { path: "/compliance-frameworks", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/compliance?tab=overview" },

  // Phase E: Operations
  // The old refresh planner generated artificial ages and budgets. Procurement
  // Planner is the evidence-based replacement.
  { path: "/hardware-refresh", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/procurement-planner" },
  // NexusMSP has no verified GPS telemetry; do not present seeded locations as live data.
  { path: "/geo-map", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/dispatch-board?tab=availability" },

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
  { path: "/revenue-tracking", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/revenue-forecast" },
  // Voice Ticket is retired; preserve direct bookmarks without exposing a second intake workflow.
  { path: "/voice-ticket", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/tickets" },

  // P1/P2 New Features
  { path: "/workflow-automation", component: page("WorkflowAutomationPage"), auth: true, layout: true },
  { path: "/device-terminal", component: page("DeviceTerminalPage"), auth: true, layout: true },
  { path: "/scheduled-reports", component: page("ScheduledReportsPage"), auth: true, layout: true },
  { path: "/billing-portal", component: page("StripeBillingPortalPage"), auth: true, layout: true },
  { path: "/proposals", component: page("ProposalBuilderPage"), auth: true, layout: true },
  { path: "/alert-rules", component: page("AlertRulesPage"), auth: true, layout: true },

  // Pro-Pack pages (P0 + P1 + P2 from IA audit)
  { path: "/triage-queue", component: page("TriageQueuePage"), auth: true, layout: true },
  { path: "/service-catalog", component: page("ServiceCatalogPage"), auth: true, layout: true },
  { path: "/customer-health", component: page("ClientInsightsTabRedirectPage"), auth: true, layout: true, redirectTab: "customer-health" },
  { path: "/quote-to-cash", component: page("QuoteToCashPage"), auth: true, layout: true },
  { path: "/notify-channels", component: page("NotifyChannelsPage"), auth: true, layout: true },
  { path: "/patch-tuesday", component: page("PatchTuesdayPage"), auth: true, layout: true },
  { path: "/team-chat", component: page("TeamChatPage"), auth: true, layout: true },
  { path: "/settings-api-tokens", component: page("ApiTokensPage"), auth: true, layout: true },
  { path: "/security-2fa", component: page("Security2FAPage"), auth: true, layout: true },
  { path: "/saas-spend", component: page("SaasSpendPage"), auth: true, layout: true },
  // Defender posture is represented in the unified Endpoint Security workspace.
  { path: "/defender-health", component: page("DefenderHealthRedirectPage"), auth: true, layout: true },
  { path: "/stocktake-mobile", component: page("StocktakeMobilePage"), auth: true, layout: true },
  { path: "/crm-pipeline", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/leads?tab=pipeline" },
  { path: "/dr-plans", component: page("DRPlansPage"), auth: true, layout: true },
  // Consolidated into Compliance. Preserve existing bookmarks without retaining
  // the previous placeholder export workspace.
  { path: "/cyber-insurance", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/compliance?tab=insurance" },
  { path: "/asset-print-batch", component: page("AssetPrintBatchPage"), auth: true, layout: true },
  { path: "/automation-hub", component: page("AutomationHubPage"), auth: true, layout: true },
  { path: "/documentation-hub", component: page("DocumentationHubPage"), auth: true, layout: true },
  { path: "/financial-analytics", component: page("FinancialAnalyticsHubPage"), auth: true, layout: true },
  { path: "/sla-hub", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/sla-timer" },
  // Voice is provider-agnostic; the legacy route remains for bookmarks and integrations.
  { path: "/voice", component: page("VoiceWorkspacePage"), auth: true, layout: true },
  { path: "/voice/wallboard", component: page("VoiceWallboardPage"), auth: true, layout: true },
  { path: "/phone-integration", component: page("VoiceWorkspacePage"), auth: true, layout: true },

  // Auth callback (no auth, no layout)
  { path: "/auth/callback", component: page("AuthCallbackPage"), auth: false, layout: false },
  { path: "/notifications", component: page("NotificationsPage"), auth: true, layout: true },
  { path: "/workshop-bench", component: page("WorkshopBenchPage"), auth: true, layout: true },

  // Consolidation hubs (Feb 2026 dedup)
  { path: "/client-insights", component: page("ClientInsightsHubPage"), auth: true, layout: true },
  { path: "/nexus-verify", component: page("NexusVerifyPage"), auth: true, layout: true },
  { path: "/work-session", component: page("WorkSessionPage"), auth: true, layout: true },
  { path: "/expected-state", component: page("ExpectedStatePage"), auth: true, layout: true },
  { path: "/auto-ops", component: page("AutoOpsHubPage"), auth: true, layout: true },
  { path: "/credentials", component: page("LegacyRouteRedirectPage"), auth: true, layout: true, redirectTo: "/hudu" },
  { path: "/team-hub", component: page("TeamHubPage"), auth: true, layout: true },

  // Public routes (no auth, no layout)
  { path: "/pay/:token", component: page("PublicPaymentPage"), auth: false, layout: false },
  { path: "/portal-app", component: page("PortalLoginPage"), auth: false, layout: false },
  { path: "/status-board/:clientId", component: page("StatusBoardPage"), auth: false, layout: false },
];
