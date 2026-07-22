export const TICKET_MODULES = [
  { id: "queue", label: "Queue", path: "/tickets" },
  { id: "triage", label: "Triage", path: "/triage-queue" },
  { id: "sla", label: "SLA", path: "/sla-timer" },
  { id: "dispatch", label: "Dispatch", path: "/dispatch-board" },
];

// These are ticket-delivery tools, not separate top-level workspaces. They
// intentionally live in the Tickets header so the sidebar remains focused.
export const TICKET_WORKSPACE_TOOLS = [
  { id: "workshop", label: "Workshop Bench", path: "/workshop-bench" },
  { id: "escalations", label: "Escalation Matrix", path: "/escalation-matrix" },
  { id: "routing", label: "Smart Routing", path: "/intelligent-routing" },
  { id: "blueprints", label: "Blueprints", path: "/blueprints" },
  { id: "catalog", label: "Service Catalog", path: "/service-catalog" },
];

export const TICKET_PRIORITY_STYLES = {
  critical: { badge: "bg-rose-500/20 text-rose-300 border-rose-500/30", dot: "bg-rose-500", border: "border-l-rose-500" },
  high: { badge: "bg-orange-500/20 text-orange-300 border-orange-500/30", dot: "bg-orange-500", border: "border-l-orange-500" },
  medium: { badge: "bg-amber-500/20 text-amber-300 border-amber-500/30", dot: "bg-amber-500", border: "border-l-amber-500" },
  low: { badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", dot: "bg-emerald-500", border: "border-l-emerald-500" },
};

export const TICKET_STATUS_STYLES = {
  open: "text-cyan-300 bg-cyan-950/60 border-cyan-800/50",
  pending: "text-amber-300 bg-amber-950/60 border-amber-800/50",
  in_progress: "text-amber-300 bg-amber-950/60 border-amber-800/50",
  on_hold: "text-violet-300 bg-violet-950/60 border-violet-800/50",
  resolved: "text-emerald-300 bg-emerald-950/60 border-emerald-800/50",
  closed: "text-zinc-500 bg-zinc-950/60 border-zinc-800/50",
  blocked: "text-rose-300 bg-rose-950/60 border-rose-800/50",
};

export function ticketModuleForPath(pathname = "") {
  if (["/sla-hub", "/sla-timer", "/sla-report-gen"].some(path => pathname === path || pathname.startsWith(`${path}/`))) return "sla";
  return TICKET_MODULES.find(module => pathname === module.path || pathname.startsWith(`${module.path}/`))?.id || "queue";
}

export function ticketWorkspaceToolForPath(pathname = "") {
  return TICKET_WORKSPACE_TOOLS.find(tool => pathname === tool.path || pathname.startsWith(`${tool.path}/`)) || null;
}

export function ticketToolAvailability(ticket = {}, scripts = []) {
  const hasDevice = Boolean(ticket.device_id || ticket.device_ids?.length);
  return {
    remote: hasDevice,
    scripts: hasDevice && scripts.length > 0,
    billing: Boolean(ticket.id),
    knowledge: Boolean(ticket.id),
  };
}

export function matchTicketByReference(tickets = [], reference = "") {
  const wanted = decodeURIComponent(reference).replace(/^#/, "").trim().toUpperCase();
  if (!wanted) return null;
  return tickets.find(ticket =>
    (ticket.ticket_number || "").toUpperCase() === wanted ||
    (ticket.id || "").toUpperCase() === wanted
  ) || null;
}

export function collectionFromResponse(data, keys = []) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];

  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key];
  }

  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.data)) return data.data;
  return [];
}
