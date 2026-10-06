import { healthBand } from "./clientHealthBands";

const numberFrom = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const countFrom = (client, keys) => {
  for (const key of keys) {
    const value = numberFrom(client?.[key]);
    if (value !== null) return Math.max(0, Math.round(value));
  }
  return 0;
};

const plural = (value, singular, pluralLabel = `${singular}s`) => (
  `${value} ${value === 1 ? singular : pluralLabel}`
);

const riskReason = (riskLevel) => {
  const risk = String(riskLevel || "").trim().toLowerCase();
  if (risk === "critical") {
    return {
      id: "critical-risk",
      label: "Critical risk",
      detail: "Immediate account review is needed",
      severity: "critical",
      weight: 100,
    };
  }
  if (risk === "at_risk" || risk === "at-risk") {
    return {
      id: "at-risk",
      label: "Account at risk",
      detail: "Service risk needs an owner",
      severity: "attention",
      weight: 70,
    };
  }
  if (risk === "attention" || risk === "needs_attention" || risk === "needs-attention") {
    return {
      id: "attention-risk",
      label: "Needs attention",
      detail: "A portfolio review has been requested",
      severity: "attention",
      weight: 52,
    };
  }
  return null;
};

/**
 * Produces only evidence-backed reasons for showing a client in the portfolio
 * attention queue. This is deliberately presentation-safe: missing data is
 * omitted rather than represented as a problem.
 */
export function getClientAttentionReasons(client) {
  if (!client || typeof client !== "object") return [];

  const reasons = [];
  const risk = riskReason(client.risk_level ?? client.riskLevel);
  if (risk) reasons.push(risk);

  // Health reasons follow the bands the health engine serves, so this queue can
  // never disagree with the account banner and directory about the same score.
  const healthScore = numberFrom(client.health_score ?? client.healthScore);
  const scoreBand = healthScore === null ? null : healthBand(healthScore);
  if (scoreBand?.key === "critical") {
    reasons.push({
      id: "health-critical",
      label: `Health ${Math.round(healthScore)}/100`,
      detail: "Below the safe operating level",
      severity: "critical",
      weight: 88,
    });
  } else if (scoreBand?.key === "at_risk") {
    reasons.push({
      id: "health-at-risk",
      label: `Health ${Math.round(healthScore)}/100`,
      detail: "Scored commitments are failing",
      severity: "critical",
      weight: 74,
    });
  } else if (scoreBand?.key === "attention") {
    reasons.push({
      id: "health-attention",
      label: `Health ${Math.round(healthScore)}/100`,
      detail: "Health recovery should be planned",
      severity: "attention",
      weight: 58,
    });
  }

  const patches = countFrom(client, ["patch_pending", "pending_patches", "patches_pending"]);
  if (patches > 0) {
    reasons.push({
      id: "patch-exposure",
      label: "Patch exposure",
      detail: `${plural(patches, "update")} waiting for review`,
      severity: patches >= 10 ? "critical" : "attention",
      weight: Math.min(78, 34 + (patches * 4)),
    });
  }

  const tickets = countFrom(client, ["open_tickets", "openTickets", "ticket_count"]);
  if (tickets >= 10) {
    reasons.push({
      id: "service-volume",
      label: "Service volume",
      detail: `${plural(tickets, "open ticket")} needs review`,
      severity: tickets >= 20 ? "critical" : "attention",
      weight: Math.min(72, 30 + (tickets * 2)),
    });
  } else if (tickets > 0) {
    reasons.push({
      id: "open-work",
      label: "Open work",
      detail: `${plural(tickets, "open ticket")}`,
      severity: "recommendation",
      weight: 12,
    });
  }

  const overdue = countFrom(client, ["overdue_count", "overdue_invoices", "invoices_overdue"]);
  if (overdue > 0) {
    reasons.push({
      id: "commercial-follow-up",
      label: "Commercial follow-up",
      detail: `${plural(overdue, "overdue item")} needs an owner`,
      severity: overdue >= 3 ? "critical" : "attention",
      weight: Math.min(76, 38 + (overdue * 8)),
    });
  }

  const assets = countFrom(client, ["asset_count", "assets", "device_count"]);
  const assessed = countFrom(client, ["assets_assessed", "assessed_assets", "assessed_endpoints"]);
  if (assets > 0 && assessed === 0) {
    reasons.push({
      id: "missing-agent-evidence",
      label: "No agent evidence",
      detail: `${plural(assets, "managed asset")} without current assessment`,
      severity: "recommendation",
      weight: 22,
    });
  }

  return reasons.sort((left, right) => right.weight - left.weight || left.label.localeCompare(right.label));
}

/**
 * Ranks a collection of client summaries without changing the source objects.
 * Each entry keeps the original client for callers that need to open it.
 */
export function buildClientAttentionQueue(clients, { limit } = {}) {
  const queue = (Array.isArray(clients) ? clients : [])
    .map((client) => {
      const reasons = getClientAttentionReasons(client);
      return {
        client,
        reasons,
        severity: reasons.some((reason) => reason.severity === "critical")
          ? "critical"
          : reasons.some((reason) => reason.severity === "attention")
            ? "attention"
            : "recommendation",
        score: reasons.reduce((total, reason) => total + reason.weight, 0),
      };
    })
    .filter((entry) => entry.reasons.length > 0)
    .sort((left, right) => right.score - left.score || String(left.client?.name || "").localeCompare(String(right.client?.name || "")));

  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : null;
  return safeLimit === null ? queue : queue.slice(0, safeLimit);
}

export const CLIENT_ATTENTION_TONES = {
  critical: {
    badge: "border-rose-400/30 bg-rose-500/[0.10] text-rose-100",
    icon: "border-rose-400/30 bg-rose-500/[0.10] text-rose-200",
    label: "Critical",
  },
  attention: {
    badge: "border-amber-400/30 bg-amber-500/[0.10] text-amber-100",
    icon: "border-amber-400/30 bg-amber-500/[0.10] text-amber-200",
    label: "Attention",
  },
  recommendation: {
    badge: "border-sky-400/25 bg-sky-500/[0.08] text-sky-100",
    icon: "border-sky-400/25 bg-sky-500/[0.08] text-sky-200",
    label: "Review",
  },
};
