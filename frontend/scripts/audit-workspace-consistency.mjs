import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const indexStylesPath = fileURLToPath(new URL("../src/index.css", import.meta.url));
const appStylesPath = fileURLToPath(new URL("../src/App.css", import.meta.url));
const routesPath = fileURLToPath(new URL("../src/config/routes.js", import.meta.url));
const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
};

const files = (await walk(root)).filter((path) => /\.(js|jsx)$/.test(path));
const source = await Promise.all(files.map(async (path) => [path, await readFile(path, "utf8")]));
const countFiles = (needle) => source.filter(([, text]) => text.includes(needle)).length;
const countOccurrences = (text, needle) => text.split(needle).length - 1;
const toSourcePath = (path) => `src/${relative(root, path).replaceAll("\\", "/")}`;
const directDialogs = source.filter(([, text]) => text.includes("<DialogContent")).map(([path]) => toSourcePath(path));
const legacyDirectDialogs = source
  .filter(([, text]) => text.includes("<DialogContent") && !text.includes("NexusWorkflowDialog"))
  .map(([path]) => toSourcePath(path));
const directDialogInstances = source.reduce((total, [, text]) => total + countOccurrences(text, "<DialogContent"), 0);
const legacyDirectDialogInstances = source
  .filter(([, text]) => !text.includes("NexusWorkflowDialog"))
  .reduce((total, [, text]) => total + countOccurrences(text, "<DialogContent"), 0);
const [indexStyles, appStyles] = await Promise.all([
  readFile(indexStylesPath, "utf8"),
  readFile(appStylesPath, "utf8"),
]);
const routes = await readFile(routesPath, "utf8");
const routedPageNames = [...new Set([...routes.matchAll(/component:\s*page\("([A-Za-z0-9_-]+)"\)/g)].map((match) => match[1]))];
const redirectPages = new Set([
  "AssetPrintBatchPage",
  "AuthCallbackPage",
  "BillingProPage",
  "LegacyRouteRedirectPage",
  "ClientInsightsTabRedirectPage",
  "FinancialRouteRedirectPage",
  "QBRRedirectPage",
  "ScheduledReportsPage",
  "TechRosterRedirectPage",
  "UpsellRedirectPage",
  "DefenderHealthRedirectPage",
]);
const delegatedHeaderPages = new Set([
  "ApiTokensPage",
  "AutomationHubPage",
  "DashboardPage",
  "DispatchCenterPage",
  "FinancialAnalyticsHubPage",
  "NotifyChannelsPage",
  "PatchTuesdayPage",
  "QuoteToCashPage",
  "SaasSpendPage",
  "Security2FAPage",
  "ServiceCatalogPage",
  "SmartAutomationPage",
  "TeamHubPage",
  "TicketsPage",
  "TriageQueuePage",
]);
const specialistHeaderPages = new Set([
  "AutoOpsHubPage",
  "ClientPortalViewPage",
  "DeviceChatPage",
  "DeviceDetailPage",
  "DevicesPage",
  "HelpCenterPage",
  "KioskPage",
  "LiveChatPage",
  "NotificationsPage",
  "PortalDashboardPage",
  "PortalLoginPage",
  "PublicPaymentPage",
  "ReportsHubPage",
  "StatusBoardPage",
  "StocktakeMobilePage",
  "StripeBillingPortalPage",
  "TeamChatPage",
  "TechProfilePage",
  "WarRoomPage",
  "WarRoomPublicPage",
  "WorkshopBenchPage",
  "WorkspacePage",
]);
const routedPageSource = routedPageNames
  .filter((name) => !redirectPages.has(name) && !delegatedHeaderPages.has(name) && !specialistHeaderPages.has(name))
  .map((name) => {
    const path = join(root, "pages", `${name}.jsx`);
    return source.find(([candidate]) => candidate.toLowerCase() === path.toLowerCase()) || [path, ""];
  });
const legacyWorkspaceHeaderPages = routedPageSource
  .filter(([, text]) => !text.includes("OperationalPageHeader") && !text.includes("NexusWorkspaceHeader"))
  .map(([path]) => toSourcePath(path));
const headerContractIssues = routedPageSource
  .filter(([, text]) => text.includes("OperationalPageHeader") || text.includes("NexusWorkspaceHeader"))
  .map(([path, text]) => {
    const missing = ["title", "description", "icon"].filter(
      (prop) => !new RegExp(`\\b${prop}\\s*=`).test(text),
    );
    return missing.length > 0 ? { path: toSourcePath(path), missing } : null;
  })
  .filter(Boolean);
const crowdedActionHeaders = routedPageSource.flatMap(([path, text]) => {
  const actionBlocks = text.match(/actions=\{<>[\s\S]*?<\/>\}/g) || [];
  return actionBlocks
    .filter((block) => {
      const buttonCount = countOccurrences(block, "<Button");
      const usesSharedOverflow = block.includes("<WorkspaceActionMenu") || block.includes("<WorkspaceToolsMenu");
      return buttonCount > 3 && !usesSharedOverflow;
    })
    .map(() => toSourcePath(path));
});
const motionSafety = {
  respectsSystemReducedMotion: indexStyles.includes("@media (prefers-reduced-motion: reduce)"),
  supportsMinimalMotion: indexStyles.includes('html[data-motion="minimal"]'),
  supportsMotionOff: indexStyles.includes('html[data-motion="none"]'),
  decorativeMotionRespectsMinimal: appStyles.includes('html[data-motion="minimal"] .animated-border'),
};

const report = {
  scannedFiles: files.length,
  operationalHeaders: countFiles("OperationalPageHeader"),
  canonicalWorkspaceHeaders: countFiles("NexusWorkspaceHeader"),
  routedWorkspacePagesChecked: routedPageSource.length,
  legacyWorkspaceHeaderPages,
  legacyWorkspaceHeaderCount: legacyWorkspaceHeaderPages.length,
  headerContractIssues,
  headerContractIssueCount: headerContractIssues.length,
  crowdedActionHeaders,
  crowdedActionHeaderCount: crowdedActionHeaders.length,
  delegatedHeaderPages: [...delegatedHeaderPages].sort(),
  specialistHeaderPages: [...specialistHeaderPages].sort(),
  sharedWorkflowDialogs: countFiles("NexusWorkflowDialog"),
  sharedWorkspaceActionMenus: countFiles("WorkspaceActionMenu"),
  dialogSurfaceFiles: directDialogs.length,
  unmigratedDialogOnlyFileCount: legacyDirectDialogs.length,
  dialogSurfaceInstances: directDialogInstances,
  unmigratedDialogOnlyInstances: legacyDirectDialogInstances,
  workflowMigrationProgress: `${countFiles("NexusWorkflowDialog")} shared workflow consumers`,
  motionSafety,
  directDialogFiles: directDialogs,
  legacyDirectDialogFiles: legacyDirectDialogs,
  expectation: "Routed workspaces use NexusWorkspaceHeader (normally through OperationalPageHeader), an explicitly delegated shared header, or a documented specialist canvas; new workflows use NexusWorkflowDialog unless a documented specialist canvas is required.",
};

console.log(JSON.stringify(report, null, 2));
if (legacyWorkspaceHeaderPages.length > 0 || headerContractIssues.length > 0 || crowdedActionHeaders.length > 0) process.exitCode = 1;
