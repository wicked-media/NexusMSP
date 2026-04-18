// Ticket page shared configuration constants
export const priorityConfig = {
  critical: { label: "Critical", class: "bg-red-500 text-white" },
  high: { label: "High", class: "bg-orange-500 text-white" },
  medium: { label: "Medium", class: "bg-yellow-500 text-white" },
  low: { label: "Low", class: "bg-green-600 text-white" }
};

export const statusConfig = {
  open: { label: "Open", class: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  in_progress: { label: "In Progress", class: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
  on_hold: { label: "On Hold", class: "bg-orange-500/10 text-orange-500 border-orange-500/20" },
  resolved: { label: "Resolved", class: "bg-green-500/10 text-green-500 border-green-500/20" },
  closed: { label: "Closed", class: "bg-gray-500/10 text-gray-500 border-gray-500/20" }
};

export const WS_STATUSES = {
  checked_in: { label: "Checked In", class: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  diagnosing: { label: "Diagnosing", class: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  parts_ordered: { label: "Parts Ordered", class: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" },
  repairing: { label: "Repairing", class: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  ready_for_pickup: { label: "Ready for Pickup", class: "bg-green-500/15 text-green-400 border-green-500/30" },
  collected: { label: "Collected", class: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
  cancelled: { label: "Cancelled", class: "bg-red-500/15 text-red-400 border-red-500/30" },
};

export const FIELD_STATUSES = {
  scheduled: { label: "Scheduled", class: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  dispatched: { label: "Dispatched", class: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" },
  en_route: { label: "En Route", class: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  on_site: { label: "On Site", class: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  in_progress: { label: "In Progress", class: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  completed: { label: "Completed", class: "bg-green-500/15 text-green-400 border-green-500/30" },
  cancelled: { label: "Cancelled", class: "bg-red-500/15 text-red-400 border-red-500/30" },
};

export const wsStages = [
  { key: "checked_in", label: "Checked In", color: "from-blue-500 to-blue-600", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30" },
  { key: "diagnosing", label: "Diagnosing", color: "from-purple-500 to-purple-600", bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30" },
  { key: "parts_ordered", label: "Parts Ordered", color: "from-cyan-500 to-cyan-600", bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30" },
  { key: "repairing", label: "Repairing", color: "from-amber-500 to-amber-600", bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30" },
  { key: "ready_for_pickup", label: "Ready", color: "from-green-500 to-green-600", bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30" },
  { key: "collected", label: "Collected", color: "from-slate-500 to-slate-600", bg: "bg-slate-500/10", text: "text-slate-400", border: "border-slate-500/30" },
];

export const fieldStages = [
  { key: "scheduled", label: "Scheduled", color: "from-blue-500 to-blue-600", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30" },
  { key: "dispatched", label: "Dispatched", color: "from-cyan-500 to-cyan-600", bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30" },
  { key: "en_route", label: "En Route", color: "from-purple-500 to-purple-600", bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30" },
  { key: "on_site", label: "On Site", color: "from-amber-500 to-amber-600", bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30" },
  { key: "in_progress", label: "In Progress", color: "from-yellow-500 to-yellow-600", bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/30" },
  { key: "completed", label: "Completed", color: "from-green-500 to-green-600", bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30" },
];
