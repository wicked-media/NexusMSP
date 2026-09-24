export const TICKET_MODULES = [
  { id: "queue", label: "Queue", description: "Prioritise and resolve", path: "/tickets" },
  { id: "triage", label: "Triage", description: "Classify incoming work", path: "/triage-queue" },
  { id: "sla", label: "SLA", description: "Protect commitments", path: "/sla-timer" },
  { id: "dispatch", label: "Dispatch", description: "Plan field capacity", path: "/dispatch-board" },
];

// These are ticket-delivery tools, not separate top-level workspaces. They
// intentionally live in the Tickets header so the sidebar remains focused.
export const TICKET_WORKSPACE_TOOLS = [
  // This is a retained record board only. New repair work begins as a Service
  // Desk ticket with a Workshop Repair Kit so technicians do not mistake it
  // for a second active ticket queue.
  { id: "workshop", label: "Historical workshop records", path: "/workshop-bench", group: "Historical records", description: "Find earlier repair records; start new repairs with a ticket kit." },
  { id: "escalations", label: "Escalation Matrix", path: "/escalation-matrix", group: "Assignment & escalation", description: "Define who takes over when a ticket needs specialist help." },
  { id: "routing", label: "Smart Routing", path: "/intelligent-routing", group: "Assignment & escalation", description: "Review how incoming work reaches the right technician." },
  { id: "blueprints", label: "Blueprints", path: "/blueprints", group: "Repeatable work", description: "Reuse proven ticket plans and task checklists." },
  { id: "catalog", label: "Service Catalog", path: "/service-catalog", group: "Repeatable work", description: "Browse standard services and request workflows." },
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

const TERMINAL_TICKET_STATUSES = new Set(["closed", "resolved"]);
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

function timestampFor(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function ticketIsTerminal(ticket = {}) {
  return TERMINAL_TICKET_STATUSES.has(String(ticket.status || "").toLowerCase());
}

export function ticketSlaDueAt(ticket = {}) {
  return ticket.sla_due || ticket.sla_due_at || null;
}

export function ticketLastActivityAt(ticket = {}) {
  return ticket.last_activity_at || ticket.updated_at || ticket.created_at || null;
}

export function ticketHasBreachedSla(ticket = {}, now = new Date()) {
  if (ticketIsTerminal(ticket)) return false;
  const dueAt = timestampFor(ticketSlaDueAt(ticket));
  return dueAt !== null && dueAt < now.getTime();
}

export function ticketHasStaleActivity(ticket = {}, now = new Date(), staleAfterMs = FOUR_HOURS_MS) {
  if (ticketIsTerminal(ticket)) return false;
  const lastActivity = timestampFor(ticketLastActivityAt(ticket));
  return lastActivity !== null && now.getTime() - lastActivity > staleAfterMs;
}

function sortByOldestSignal(tickets, timestamp) {
  return [...tickets].sort((left, right) => {
    const leftTime = timestamp(left) ?? Number.MAX_SAFE_INTEGER;
    const rightTime = timestamp(right) ?? Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  });
}

/**
 * Builds a technician-facing recovery view from ticket facts already present
 * in the queue. It deliberately avoids inferring a customer reply from a
 * missing field: no activity is shown as no activity, not as customer silence.
 */
export function buildTicketQueueSignals(tickets = [], now = new Date()) {
  const active = tickets.filter(ticket => !ticketIsTerminal(ticket));
  const breached = active.filter(ticket => ticketHasBreachedSla(ticket, now));
  const criticalHigh = active.filter(ticket => ["critical", "high"].includes(String(ticket.priority || "").toLowerCase()));
  const unassigned = active.filter(ticket => !ticket.assigned_to && !ticket.assignee_id);
  const stale = active.filter(ticket => ticketHasStaleActivity(ticket, now));

  return [
    {
      attention: "sla_breach",
      label: "SLA breached",
      description: "The documented SLA due time has passed.",
      tickets: sortByOldestSignal(breached, ticket => timestampFor(ticketSlaDueAt(ticket))),
    },
    {
      attention: "critical_high",
      label: "Critical & high",
      description: "Priority requires an explicit technician decision.",
      tickets: [...criticalHigh].sort((left, right) => {
        const rank = { critical: 0, high: 1 };
        return (rank[String(left.priority || "").toLowerCase()] ?? 2) - (rank[String(right.priority || "").toLowerCase()] ?? 2);
      }),
    },
    {
      attention: "unassigned",
      label: "Unassigned",
      description: "No accountable technician is recorded yet.",
      tickets: sortByOldestSignal(unassigned, ticket => timestampFor(ticket.created_at)),
    },
    {
      // Keep the existing query value stable for saved links while presenting
      // accurate wording in the UI.
      attention: "no_response",
      label: "No verified activity",
      description: "No ticket activity has been recorded for four hours.",
      tickets: sortByOldestSignal(stale, ticket => timestampFor(ticketLastActivityAt(ticket))),
    },
  ].map(signal => ({ ...signal, count: signal.tickets.length }));
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
