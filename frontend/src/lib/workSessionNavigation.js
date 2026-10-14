const TERMINAL_TICKET_STATUSES = new Set([
  "resolved",
  "closed",
  "completed",
  "cancelled",
  "canceled",
]);

function normaliseTicketStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * Work Sessions are deliberately ticket-scoped. Keep every entry point on the
 * canonical ticket ID rather than a display reference such as TKT-123.
 */
export function workSessionTicketId(ticketOrId) {
  const candidate = typeof ticketOrId === "object"
    ? ticketOrId?.id || ticketOrId?.ticket_id
    : ticketOrId;
  const ticketId = String(candidate || "").trim();
  return ticketId || null;
}

export function canStartWorkSession(ticket) {
  const ticketId = workSessionTicketId(ticket);
  return Boolean(ticketId) && !TERMINAL_TICKET_STATUSES.has(normaliseTicketStatus(ticket?.status));
}

export function workSessionPath(ticketOrId) {
  const ticketId = workSessionTicketId(ticketOrId);
  return ticketId ? `/work-session?ticket=${encodeURIComponent(ticketId)}` : "/work-session";
}
