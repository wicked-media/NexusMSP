const ROLE_LENSES = {
  finance: {
    label: "Finance desk",
    summary: "Revenue protection, approvals and billing exceptions come first.",
    order: ["finance", "customers", "operations", "security"],
  },
  security: {
    label: "Security operations",
    summary: "Exposure, endpoint risk and protected actions come first.",
    order: ["security", "operations", "customers", "finance"],
  },
  leadership: {
    label: "Leadership view",
    summary: "Client impact, delivery risk and commercial health come first.",
    order: ["customers", "operations", "finance", "security"],
  },
  technician: {
    label: "Technician focus",
    summary: "Client-impacting work and the next safe action come first.",
    order: ["operations", "security", "customers", "finance"],
  },
};

function normaliseRole(user) {
  return String(user?.role || user?.job_title || "technician").trim().toLowerCase();
}

export function getDailyRoleLens(user) {
  const role = normaliseRole(user);
  if (/(finance|account|billing|bookkeep)/.test(role)) return ROLE_LENSES.finance;
  if (/(security|soc|cyber|compliance)/.test(role)) return ROLE_LENSES.security;
  if (user?.is_admin || /(owner|admin|manager|director|lead)/.test(role)) return ROLE_LENSES.leadership;
  return ROLE_LENSES.technician;
}

function panelById(missionControl, id) {
  return (missionControl?.panels || []).find(panel => panel.id === id) || {};
}

function metricValue(panel, label) {
  const metric = (panel?.metrics || []).find(item => item.label === label);
  return Number(metric?.value || 0);
}

function workstreamById(missionControl, id) {
  return (missionControl?.workstreams || []).find(stream => stream.id === id) || {};
}

export function buildNexusDailyBriefing({ missionControl, nexusBrain, user }) {
  const lens = getDailyRoleLens(user);
  const summary = missionControl?.summary || {};
  const brainMetrics = nexusBrain?.briefing?.metrics || {};
  const operationsPanel = panelById(missionControl, "infrastructure");
  const billingPanel = panelById(missionControl, "billing");
  const securityPanel = panelById(missionControl, "security");
  const clientPanel = panelById(missionControl, "client-health");
  const critical = workstreamById(missionControl, "critical");
  const attention = workstreamById(missionControl, "attention");

  const sections = {
    operations: {
      id: "operations",
      label: "Operations",
      count: Number(critical.count || 0) + Number(attention.count || 0),
      route: "/devices",
      tone: Number(critical.count || 0) > 0 ? "critical" : Number(attention.count || 0) > 0 ? "warning" : "healthy",
      headline: Number(critical.count || 0) > 0
        ? `${critical.count} critical item${Number(critical.count) === 1 ? " needs" : "s need"} ownership.`
        : Number(attention.count || 0) > 0
          ? `${attention.count} item${Number(attention.count) === 1 ? "" : "s"} should be scheduled.`
          : "Connected operations are currently clear.",
      detail: `${metricValue(operationsPanel, "Offline assets")} offline · ${metricValue(operationsPanel, "Failed backups")} backup failures`,
    },
    finance: {
      id: "finance",
      label: "Finance",
      count: Number(billingPanel.count || 0),
      route: billingPanel.route || "/billing-recon",
      tone: Number(billingPanel.count || 0) > 0 ? "warning" : "healthy",
      headline: Number(brainMetrics.revenue_found || 0) > 0
        ? `$${Number(brainMetrics.revenue_found).toLocaleString(undefined, { maximumFractionDigits: 0 })} is ready for billing review.`
        : "No unbilled work is visible in connected records.",
      detail: `${metricValue(billingPanel, "Overdue invoices")} overdue · ${Number(brainMetrics.pending_approvals || 0)} approvals waiting`,
    },
    security: {
      id: "security",
      label: "Security",
      count: Number(securityPanel.count || 0),
      route: securityPanel.route || "/security-dashboard",
      tone: Number(securityPanel.count || 0) > 0 ? "critical" : "healthy",
      headline: Number(securityPanel.count || 0) > 0
        ? `${securityPanel.count} security finding${Number(securityPanel.count) === 1 ? "" : "s"} need review.`
        : "No critical security exception is visible.",
      detail: `${metricValue(securityPanel, "Critical alerts")} critical · ${metricValue(securityPanel, "Open vulnerabilities")} vulnerabilities`,
    },
    customers: {
      id: "customers",
      label: "Customers",
      count: Number(clientPanel.count || 0),
      route: clientPanel.route || "/clients",
      tone: Number(clientPanel.count || 0) > 0 ? "warning" : "healthy",
      headline: Number(clientPanel.count || 0) > 0
        ? `${clientPanel.count} client-impact signal${Number(clientPanel.count) === 1 ? "" : "s"} need attention.`
        : "The client portfolio is stable.",
      detail: `${metricValue(clientPanel, "Active clients")} active clients · ${metricValue(clientPanel, "Active tickets")} active tickets`,
    },
  };

  const attentionCount = Number(summary.attention_count || 0);
  const automatedActions = Number(summary.automated_actions_24h || 0);

  return {
    lens,
    healthScore: Number(summary.health_score || 0),
    healthLabel: summary.health_label || "Not assessed",
    attentionCount,
    automatedActions,
    headline: attentionCount > 0
      ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need your attention. Nexus has already completed ${automatedActions} evidenced action${automatedActions === 1 ? "" : "s"} in the last 24 hours.`
      : `Everything connected to Nexus is stable. ${automatedActions} evidenced action${automatedActions === 1 ? "" : "s"} completed in the last 24 hours.`,
    focus: missionControl?.focus || null,
    sections: lens.order.map(id => sections[id]),
    evidenceNote: summary.evidence_note || nexusBrain?.evidence_note || "",
  };
}
