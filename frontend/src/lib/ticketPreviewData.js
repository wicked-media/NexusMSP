const now = Date.now();
const minutes = (value) => value * 60 * 1000;
const hours = (value) => minutes(value * 60);
const isoAgo = (value) => new Date(now - hours(value)).toISOString();
const isoInMinutes = (value) => new Date(now + minutes(value)).toISOString();

export function isLocalTicketPreview() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

export function localPreviewCollection(items, fallback) {
  if (Array.isArray(items) && items.length > 0) return items;
  return isLocalTicketPreview() ? fallback : (Array.isArray(items) ? items : []);
}

export function localPreviewRecord(value, fallback) {
  const usable = value && !Array.isArray(value) && typeof value === "object" && Object.keys(value).length > 0;
  return usable ? value : (isLocalTicketPreview() ? fallback : {});
}

export const LOCAL_PREVIEW_CLIENTS = [
  { id: "client-acme", name: "Acme Manufacturing", email: "it@acme.example", phone: "+61 2 5550 0140", mobile: "+61 411 555 140" },
  { id: "client-harbour", name: "Harbour Legal", email: "support@harbourlegal.example", phone: "+61 2 5550 0260" },
  { id: "client-northstar", name: "Northstar Health", email: "service@northstar.example", phone: "+61 2 5550 0380" },
  { id: "client-riverbank", name: "Riverbank Shire", email: "helpdesk@riverbank.example", phone: "+61 2 5550 0410" },
];

export const LOCAL_PREVIEW_USERS = [
  { id: "tech-aaron", name: "Aaron Thompson", email: "aaron@nexusops.example", role: "admin" },
  { id: "tech-priya", name: "Priya Shah", email: "priya@nexusops.example", role: "technician" },
  { id: "tech-marcus", name: "Marcus Lee", email: "marcus@nexusops.example", role: "technician" },
];

export const LOCAL_PREVIEW_DEVICES = [
  { id: "device-acme-dc01", client_id: "client-acme", name: "ACME-DC01", hostname: "ACME-DC01", status: "online", os: "Windows Server 2022" },
  { id: "device-hl-lt22", client_id: "client-harbour", name: "HL-LT22", hostname: "HL-LT22", status: "online", os: "Windows 11 Pro" },
  { id: "device-nh-fw01", client_id: "client-northstar", name: "NH-FW01", hostname: "NH-FW01", status: "degraded", os: "FortiOS" },
];

export const LOCAL_PREVIEW_SCRIPTS = [
  { id: "script-diagnostics", name: "Collect diagnostics", description: "Gather event logs, services, and system health." },
  { id: "script-dns", name: "Repair DNS cache", description: "Flush and re-register the endpoint DNS cache." },
  { id: "script-storage", name: "Storage health check", description: "Check disk space and SMART health." },
];

export const LOCAL_PREVIEW_PRODUCTS = [
  { id: "product-labour", name: "Remote support labour", description: "Remote engineering time", unit_price: 165 },
  { id: "product-ssd", name: "1 TB NVMe SSD", description: "Business-grade replacement storage", unit_price: 189 },
];

export const LOCAL_PREVIEW_SERVICES = [
  { id: "service-managed", name: "Managed Workplace", code: "MWP", is_active: true },
  { id: "service-security", name: "Managed Security", code: "MSEC", is_active: true },
];

export const LOCAL_PREVIEW_TICKETS = [
  {
    id: "ticket-preview-1048", ticket_number: "INC-1048", title: "Domain controller authentication failures",
    description: "Users in the warehouse cannot authenticate and several line-of-business services are falling back to cached credentials.",
    client_id: "client-acme", client_name: "Acme Manufacturing", contact_name: "Jordan Miles", contact_email: "jordan@acme.example",
    status: "open", priority: "critical", category: "security", source: "monitoring", assigned_to: null, assigned_to_name: null, assignee_name: null,
    device_id: "device-acme-dc01", device_ids: ["device-acme-dc01"], tags: ["identity", "production"], escalated: true,
    created_at: isoAgo(3.4), updated_at: isoAgo(0.3), sla_due: isoInMinutes(-42), sla_status: "breached", sla_overdue_hours: 0.7,
  },
  {
    id: "ticket-preview-1047", ticket_number: "INC-1047", title: "Outlook repeatedly asks for credentials",
    description: "Credential prompts started after this morning's Microsoft 365 sign-in policy change.",
    client_id: "client-harbour", client_name: "Harbour Legal", contact_name: "Elise Ward", contact_email: "elise@harbourlegal.example",
    status: "in_progress", priority: "high", category: "support", source: "email", assigned_to: "tech-aaron", assigned_to_name: "Aaron Thompson", assignee_name: "Aaron Thompson",
    device_id: "device-hl-lt22", device_ids: ["device-hl-lt22"], tags: ["m365", "outlook"],
    created_at: isoAgo(2.2), updated_at: isoAgo(0.2), sla_due: isoInMinutes(78), sla_status: "at_risk",
  },
  {
    id: "ticket-preview-1046", ticket_number: "REQ-1046", title: "Prepare laptop for new starter on Monday",
    description: "Build, secure, and deliver a laptop with Microsoft 365, line-of-business apps, and the standard security baseline.",
    client_id: "client-northstar", client_name: "Northstar Health", contact_name: "Maya Chen", contact_email: "maya@northstar.example",
    status: "open", priority: "high", category: "support", source: "portal", assigned_to: null, assigned_to_name: null, assignee_name: null,
    tags: ["onboarding", "deadline"], created_at: isoAgo(5.6), updated_at: isoAgo(1.1), sla_due: isoInMinutes(190), sla_status: "due_soon",
  },
  {
    id: "ticket-preview-1045", ticket_number: "INC-1045", title: "Internet failover link is flapping",
    description: "The backup WAN circuit has dropped six times today. Primary connectivity remains available.",
    client_id: "client-northstar", client_name: "Northstar Health", contact_name: "Sam Okafor", contact_email: "sam@northstar.example",
    status: "on_hold", priority: "medium", category: "network", source: "monitoring", assigned_to: "tech-priya", assigned_to_name: "Priya Shah", assignee_name: "Priya Shah",
    device_id: "device-nh-fw01", device_ids: ["device-nh-fw01"], tags: ["network", "carrier"],
    created_at: isoAgo(18), updated_at: isoAgo(2), sla_due: isoInMinutes(620), sla_status: "paused",
  },
  {
    id: "ticket-preview-1044", ticket_number: "INC-1044", title: "Finance share permissions need review",
    description: "Review access after the finance team restructure and remove two former group memberships.",
    client_id: "client-riverbank", client_name: "Riverbank Shire", contact_name: "Ava Brooks", contact_email: "ava@riverbank.example",
    status: "in_progress", priority: "medium", category: "security", source: "phone", assigned_to: "tech-marcus", assigned_to_name: "Marcus Lee", assignee_name: "Marcus Lee",
    tags: ["access", "audit"], created_at: isoAgo(9.5), updated_at: isoAgo(0.8), sla_due: isoInMinutes(410), sla_status: "healthy",
  },
  {
    id: "ticket-preview-1043", ticket_number: "FLD-1043", title: "Replace reception wireless access point",
    description: "On-site replacement required; the existing AP is intermittently rebooting under load.",
    client_id: "client-harbour", client_name: "Harbour Legal", contact_name: "Elise Ward", contact_email: "elise@harbourlegal.example",
    status: "open", priority: "medium", category: "field", source: "email", assigned_to: "tech-priya", assigned_to_name: "Priya Shah", assignee_name: "Priya Shah",
    tags: ["onsite", "wifi"], created_at: isoAgo(21), updated_at: isoAgo(6), sla_due: isoInMinutes(960), sla_status: "healthy",
  },
  {
    id: "ticket-preview-1042", ticket_number: "WRK-1042", title: "Laptop SSD replacement and data migration",
    description: "Workshop repair: replace failing SSD, migrate the user profile, and complete a full hardware test.",
    client_id: "client-acme", client_name: "Acme Manufacturing", contact_name: "Jordan Miles", contact_email: "jordan@acme.example",
    status: "in_progress", priority: "low", category: "workshop", source: "walk_in", assigned_to: "tech-marcus", assigned_to_name: "Marcus Lee", assignee_name: "Marcus Lee",
    tags: ["repair", "storage"], created_at: isoAgo(28), updated_at: isoAgo(4), sla_due: isoInMinutes(1440), sla_status: "healthy",
  },
  {
    id: "ticket-preview-1041", ticket_number: "INC-1041", title: "Teams calling audio issue resolved",
    description: "Updated the headset firmware and reset the Teams audio device profile.",
    client_id: "client-riverbank", client_name: "Riverbank Shire", contact_name: "Ava Brooks", contact_email: "ava@riverbank.example",
    status: "resolved", priority: "low", category: "support", source: "portal", assigned_to: "tech-aaron", assigned_to_name: "Aaron Thompson", assignee_name: "Aaron Thompson",
    tags: ["teams", "audio"], created_at: isoAgo(32), updated_at: isoAgo(7), resolved_at: isoAgo(7), sla_due: isoInMinutes(600), sla_status: "met",
  },
];

export const LOCAL_PREVIEW_NOTE_COUNTS = Object.fromEntries(LOCAL_PREVIEW_TICKETS.map((ticket, index) => [ticket.id, index % 4]));

export const LOCAL_PREVIEW_SLA_TIMERS = LOCAL_PREVIEW_TICKETS
  .filter(ticket => !["resolved", "closed"].includes(ticket.status) && ticket.sla_due)
  .map(ticket => ({
    id: ticket.id,
    ticket_id: ticket.id,
    ticket_number: ticket.ticket_number,
    client_name: ticket.client_name,
    sla_tier: ticket.priority === "critical" ? "Priority 1" : ticket.priority === "high" ? "Priority 2" : "Standard",
    remaining_minutes: Math.round((new Date(ticket.sla_due).getTime() - Date.now()) / 60000),
    status: ticket.sla_status === "breached" ? "breached" : ticket.sla_status === "at_risk" || ticket.sla_status === "due_soon" ? "at risk" : "active",
  }));

export const LOCAL_PREVIEW_SLA_PREDICTIONS = LOCAL_PREVIEW_TICKETS
  .filter(ticket => ["critical", "high"].includes(ticket.priority) && !["resolved", "closed"].includes(ticket.status))
  .map((ticket, index) => ({
    id: ticket.id,
    ticket_id: ticket.id,
    ticket_number: ticket.ticket_number,
    client_name: ticket.client_name,
    breach_risk: index === 0 ? "high" : "medium",
    probability_pct: index === 0 ? 96 : 64 - (index * 8),
    reason: index === 0 ? "Already outside the response commitment and still unassigned." : "Due soon with outstanding technician work.",
  }));

export const LOCAL_PREVIEW_SLA_PENALTIES = {
  summary: { total_penalties: 1850, current_month: 450, breach_count: 3 },
  contracts: [
    { contract_name: "Acme Managed Services", client_name: "Acme Manufacturing", breach_count: 2, penalty_amount: 1200, period: "Current quarter" },
    { contract_name: "Northstar Priority Support", client_name: "Northstar Health", breach_count: 1, penalty_amount: 650, period: "Current quarter" },
  ],
};

export const LOCAL_PREVIEW_SLA_REPORTS = [
  { id: "sla-report-june", name: "Monthly SLA performance", period: "June 2026", generated_at: "2026-07-01T08:00:00Z", status: "complete" },
  { id: "sla-report-q2", name: "Q2 client service review", period: "Q2 2026", generated_at: "2026-07-03T08:00:00Z", status: "complete" },
];

export const LOCAL_PREVIEW_TICKET_DETAILS = {
  "ticket-preview-1048": {
    comments: [
      { id: "note-1048-1", user_name: "Nexus Monitor", content: "Alert correlation detected repeated Kerberos failures and an elevated authentication error rate.", is_internal: true, created_at: isoAgo(3.3) },
      { id: "note-1048-2", user_name: "Aaron Thompson", content: "Confirmed DNS is healthy. Investigating time drift and replication state before making changes.", is_internal: true, created_at: isoAgo(0.7) },
    ],
    emails: [
      { id: "email-1048-1", subject: "INC-1048 acknowledged", to_addresses: ["jordan@acme.example"], body: "We have escalated this incident and are actively working on service restoration.", created_at: isoAgo(2.9) },
    ],
    time_entries: [
      { id: "time-1048-1", user_name: "Aaron Thompson", minutes: 42, description: "Initial diagnosis and replication checks", billable: true, created_at: isoAgo(0.5) },
    ],
    audit_log: [
      { id: "audit-1048-1", user_name: "Nexus Monitor", action: "created ticket", details: "Authentication failure threshold exceeded", created_at: isoAgo(3.4) },
      { id: "audit-1048-2", user_name: "Aaron Thompson", action: "raised priority", details: "Priority changed from high to critical", created_at: isoAgo(2.7) },
    ],
    worksheet: [
      { id: "work-1048-1", item: "Confirm DNS and time synchronisation", checked: true, checked_by_name: "Aaron Thompson", checked_at: isoAgo(0.8) },
      { id: "work-1048-2", item: "Validate domain controller replication", checked: false },
      { id: "work-1048-3", item: "Confirm user authentication recovery", checked: false },
    ],
    products: [{ id: "line-1048-1", product_name: "Remote support labour", quantity: 1, unit_price: 165, total: 165 }],
    sms: [], attachments: [], children: [],
  },
};

export function localPreviewTicketDetail(ticketId) {
  return LOCAL_PREVIEW_TICKET_DETAILS[ticketId] || {
    comments: [], emails: [], time_entries: [], audit_log: [], worksheet: [], products: [], sms: [], attachments: [], children: [],
  };
}

export function buildTriageQueue(tickets = []) {
  const items = tickets
    .filter(ticket => !ticket.assigned_to && !["resolved", "closed"].includes(ticket.status))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const byPriority = { critical: 0, high: 0, medium: 0, low: 0 };
  items.forEach(ticket => { byPriority[ticket.priority] = (byPriority[ticket.priority] || 0) + 1; });
  const oldest = items[0]?.created_at ? Math.max(0, Math.floor((Date.now() - new Date(items[0].created_at).getTime()) / 60000)) : 0;
  return { count: items.length, oldest_age_minutes: oldest, by_priority: byPriority, items };
}

export function normaliseTriageQueue(data, fallbackTickets = []) {
  if (data && !Array.isArray(data) && typeof data === "object") {
    const items = Array.isArray(data.items) ? data.items : [];
    return {
      count: Number.isFinite(data.count) ? data.count : items.length,
      oldest_age_minutes: Number.isFinite(data.oldest_age_minutes) ? data.oldest_age_minutes : 0,
      by_priority: data.by_priority && typeof data.by_priority === "object" ? data.by_priority : buildTriageQueue(items).by_priority,
      items,
    };
  }
  return buildTriageQueue(fallbackTickets);
}
