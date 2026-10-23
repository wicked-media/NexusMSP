/**
 * The Studio context shown above an operational workspace.
 *
 * Studios describe the specialist product and its evidence/admission contract;
 * workspaces are the places technicians do the work.  This deliberately maps
 * only admitted Studio home routes, rather than guessing from a label or
 * turning every page into a Studio.  Query-specific routes stay query-specific
 * so, for example, the Foundation area of Control Plane is not labelled M365.
 */
const STUDIO_WORKSPACES = [
  { pathname: "/web-studio", studio: "Web Studio" },
  { pathname: "/clients", studio: "Client Studio" },
  { pathname: "/leads", studio: "Lead Studio" },
  { pathname: "/nexus-remote", studio: "Remote Studio" },
  { pathname: "/proxmox", studio: "Proxmox Studio" },
  { pathname: "/control-plane", search: { module: "microsoft365" }, studio: "Microsoft Studio" },
  { pathname: "/voice", studio: "Voice Studio" },
  { pathname: "/splynx-dashboard", studio: "Telecom Studio" },
  { pathname: "/devices", studio: "Devices Studio" },
  { pathname: "/networking", studio: "Network Studio" },
  { pathname: "/identity-threats", studio: "Identity Studio" },
  { pathname: "/security-dashboard", studio: "Security Studio" },
  { pathname: "/backup-center", studio: "Backup Studio" },
  { pathname: "/tickets", studio: "Service Desk Studio" },
  { pathname: "/billing-dashboard", studio: "Finance Studio" },
  { pathname: "/documentation-hub", studio: "Documentation Studio" },
  { pathname: "/automation-hub", studio: "Automation Studio" },
  { pathname: "/compliance", studio: "Compliance Studio" },
  { pathname: "/nexus-agent", studio: "Agent Studio" },
  { pathname: "/patch-tuesday", studio: "Patch Studio" },
  { pathname: "/dns-monitor", studio: "DNS Studio" },
  { pathname: "/nexus-pulse", studio: "Monitoring Studio" },
  { pathname: "/email", studio: "Communications Studio" },
  { pathname: "/customer-environment", studio: "Customer Environment Studio" },
  { pathname: "/operations-assurance", studio: "Operations Assurance Studio" },
  { pathname: "/extension-studio", studio: "Extension Studio" },
  { pathname: "/fleet-baseline", search: { platform: "windows" }, studio: "Windows Studio" },
  { pathname: "/fleet-baseline", search: { view: "recurrence" }, studio: "Endpoint Performance Studio" },
];

// Studio detail routes are catalogue records, not operational workspaces.  They
// still deserve their own clear breadcrumb, though: calling every one "Studio
// catalogue" makes a technician lose their place immediately after selecting a
// Studio.  Keep this small, explicit map aligned to the server-side registry.
const STUDIO_DETAIL_NAMES = {
  web: "Web Studio",
  client: "Client Studio",
  lead: "Lead Studio",
  remote: "Remote Studio",
  proxmox: "Proxmox Studio",
  m365: "Microsoft Studio",
  voice: "Voice Studio",
  telecom: "Telecom Studio",
  devices: "Devices Studio",
  network: "Network Studio",
  identity: "Identity Studio",
  security: "Security Studio",
  backup: "Backup Studio",
  cloud: "Cloud Studio",
  "service-desk": "Service Desk Studio",
  finance: "Finance Studio",
  documentation: "Documentation Studio",
  automation: "Automation Studio",
  compliance: "Compliance Studio",
  agent: "Agent Studio",
  patch: "Patch Studio",
  dns: "DNS Studio",
  monitoring: "Monitoring Studio",
  communications: "Communications Studio",
  "customer-environment": "Customer Environment Studio",
  "operations-assurance": "Operations Assurance Studio",
  extension: "Extension Studio",
  windows: "Windows Studio",
  "endpoint-performance": "Endpoint Performance Studio",
};

const normalisePath = (value) => {
  const raw = String(value || "/").split("?")[0].split("#")[0];
  return raw.replace(/\/+$/, "") || "/";
};

const matchesSearch = (required, search) => Object.entries(required || {}).every(
  ([key, value]) => search.get(key) === value,
);

/** Returns the admitted Studio that owns this precise workspace context. */
export function resolveStudioWorkspaceContext(pathname = "/", search = "") {
  const target = normalisePath(pathname);
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const match = STUDIO_WORKSPACES.find((entry) => (
    entry.pathname === target && matchesSearch(entry.search, params)
  ));
  if (match) return { studio: match.studio };

  const detailId = target.match(/^\/studios\/([^/]+)$/)?.[1];
  const studio = detailId ? STUDIO_DETAIL_NAMES[detailId] : null;
  return studio ? { studio, label: "Studio overview" } : null;
}

export { STUDIO_DETAIL_NAMES, STUDIO_WORKSPACES };
