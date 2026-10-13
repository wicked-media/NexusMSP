/**
 * Presentation helpers for the Executive workspace (CEO Mode).
 *
 * Everything here is pure and mirrors what the API in
 * `backend/app/routers/executive_intelligence.py` already decided. The page
 * never derives a figure the server did not send, and an evidence gap is
 * always rendered as an evidence gap rather than as a flattering zero.
 *
 * Two rules this module exists to enforce in one place:
 *   1. An unassessed number is never shown as 0, "healthy", or "$0".
 *   2. Anything labelled a risk level states the arithmetic that produced it.
 */

/** The periods the API accepts. Kept in sync with `WINDOW_OPTIONS` server-side. */
export const EXECUTIVE_PERIODS = Object.freeze([
  Object.freeze({ days: 30, label: "30 days" }),
  Object.freeze({ days: 90, label: "90 days" }),
  Object.freeze({ days: 365, label: "12 months" }),
]);

export function executivePeriodLabel(days) {
  const match = EXECUTIVE_PERIODS.find((period) => period.days === Number(days));
  return match ? match.label : `${Number(days) || 30} days`;
}

/**
 * Tone for one receivables ageing bucket. Overdue severity is the whole point
 * of the card, so the tone escalates with age rather than with value.
 */
const AGING_TONES = {
  not_due: "emerald",
  overdue_1_30: "sky",
  overdue_31_60: "amber",
  overdue_61_90: "orange",
  overdue_90_plus: "rose",
  undated: "zinc",
};

export function agingTone(bucket) {
  if (!bucket) return "zinc";
  return AGING_TONES[bucket.key] || (bucket.overdue ? "amber" : "zinc");
}

const CONCENTRATION_TONES = {
  dependency: "rose",
  concentrated: "amber",
  spread: "emerald",
  insufficient_evidence: "zinc",
};

export function concentrationTone(level) {
  return CONCENTRATION_TONES[String(level || "")] || "zinc";
}

const CONCENTRATION_LABELS = {
  dependency: "Single-client dependency",
  concentrated: "Concentrated",
  spread: "Spread across accounts",
  insufficient_evidence: "Not measurable",
};

export function concentrationLabel(level) {
  const key = String(level || "");
  return CONCENTRATION_LABELS[key] || "Not measurable";
}

const URGENCY_TONES = { immediate: "rose", soon: "amber", planned: "sky" };

export function renewalTone(urgency) {
  return URGENCY_TONES[String(urgency || "")] || "zinc";
}

const URGENCY_LABELS = {
  immediate: "Act now",
  soon: "This quarter",
  planned: "Planned",
};

export function renewalLabel(urgency) {
  const key = String(urgency || "");
  return URGENCY_LABELS[key] || "Scheduled";
}

/** `used` tones for the evidence-confidence chips. */
const QUALITY_TONES = { verified: "emerald", partial: "amber", missing: "zinc" };

export function qualityTone(state) {
  return QUALITY_TONES[String(state || "")] || "zinc";
}

/**
 * Bar heights for the monthly invoiced/collected chart. A month with no
 * invoice records is returned with `recorded: false` so the chart can draw an
 * explicit gap instead of a zero-height bar that reads as "no revenue".
 */
export function trendBars(trend) {
  const months = Array.isArray(trend?.months) ? trend.months : [];
  const peak = months.reduce(
    (highest, month) => Math.max(highest, Number(month.invoiced) || 0, Number(month.collected) || 0),
    0,
  );
  return months.map((month) => {
    const invoiced = Number(month.invoiced) || 0;
    const collected = Number(month.collected) || 0;
    return {
      ...month,
      recorded: (Number(month.count) || 0) > 0,
      invoicedPct: peak > 0 ? Math.round((invoiced / peak) * 100) : 0,
      collectedPct: peak > 0 ? Math.round((collected / peak) * 100) : 0,
    };
  });
}

/**
 * Month-on-month movement using the two most recent months that actually have
 * records. Returns null when fewer than two recorded months exist: Nexus does
 * not report a trend from a single data point.
 */
export function trendDelta(trend) {
  const recorded = trendBars(trend).filter((month) => month.recorded);
  if (recorded.length < 2) return null;
  const previous = recorded[recorded.length - 2];
  const latest = recorded[recorded.length - 1];
  const change = Number(latest.invoiced) - Number(previous.invoiced);
  return {
    from: previous.label,
    to: latest.label,
    change,
    direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
    pct: Number(previous.invoiced) > 0
      ? Math.round((change / Number(previous.invoiced)) * 1000) / 10
      : null,
  };
}

/** The share of the ledger sitting in buckets that are past their due date. */
export function overdueShare(receivables) {
  const outstanding = Number(receivables?.outstanding_total) || 0;
  const overdue = Number(receivables?.overdue_total) || 0;
  if (outstanding <= 0) return null;
  return Math.round((overdue / outstanding) * 1000) / 10;
}

/**
 * The recorded revenue goal.
 *
 * The API decides the state and every figure; this layer only labels them. In
 * particular, an absent goal never becomes "0% of target": there is simply no
 * target, and the cockpit says so.
 */
const GOAL_STATUS = {
  not_recorded: { label: "No goal recorded", tone: "zinc" },
  in_progress: { label: "In progress", tone: "cyan" },
  achieved: { label: "Goal met", tone: "emerald" },
  overdue: { label: "Goal missed", tone: "rose" },
};

export function mrrTargetStatus(state) {
  return GOAL_STATUS[String(state || "")] || GOAL_STATUS.not_recorded;
}

/** Bar width for the progress track. Display only: the stated figure is uncapped. */
export function mrrTargetBarPct(goal) {
  if (!goal || goal.state === "not_recorded" || goal.progress_pct == null) return 0;
  return Math.max(0, Math.min(100, Number(goal.progress_pct) || 0));
}

/**
 * Movement since the run rate the goal was recorded against, as plain numbers.
 *
 * The starting line is a recorded snapshot captured by the API when the goal
 * was set. When a goal carries no starting line — a goal recorded before any
 * revenue evidence existed, or one recorded before this line shipped — nothing is
 * derived from zero: the helper returns null and callers say growth is not
 * stated rather than inventing a baseline.
 */
export function mrrTargetGrowth(goal) {
  if (!goal || goal.state === "not_recorded" || goal.starting_mrr == null || goal.growth == null) return null;
  const growth = Number(goal.growth) || 0;
  return {
    starting: Number(goal.starting_mrr) || 0,
    growth,
    pct: goal.growth_pct == null ? null : Number(goal.growth_pct),
    direction: growth > 0 ? "up" : growth < 0 ? "down" : "flat",
    recordedAt: goal.starting_recorded_at || goal.recorded_at || null,
  };
}

/**
 * One plain sentence describing the recorded goal and where the run rate sits
 * against it. Returns null when no goal is recorded, so callers can state the
 * absence in their own words rather than printing a hollow zero.
 */
export function mrrTargetSummary(goal) {
  if (!goal || goal.state === "not_recorded" || goal.target_mrr == null) return null;
  const byWhen = goal.target_month_label ? ` by ${goal.target_month_label}` : "";
  const parts = [`Recorded MRR goal: ${money(goal.target_mrr)}${byWhen}`];
  parts.push(`contract-backed MRR is ${goal.progress_pct}% of it`);
  // The clause mirrors the backend board brief word for word, so a printed pack
  // and a printed brief cannot describe the same recorded goal differently.
  parts.push(mrrTargetGrowthClause(goal) || "no starting run rate was recorded with the goal, so growth is not stated");
  if (goal.state === "achieved") {
    parts.push(`goal met, surplus ${money(Math.abs(Number(goal.gap) || 0))}`);
  } else {
    parts.push(`gap ${money(goal.gap)}`);
    if (goal.required_monthly_growth != null) {
      parts.push(`required step ${money(goal.required_monthly_growth)}/month over ${goal.months_remaining} months`);
    } else if (goal.months_remaining == null) {
      parts.push("no target month recorded, so no pace is stated");
    } else {
      parts.push("the target month has passed");
    }
  }
  return parts.join(" · ");
}

/**
 * One flat, scored search index over the records the owner already has on
 * screen. Nothing extra is fetched and no new permission is implied: the
 * palette can only surface what the briefing already returned.
 */
export const EXECUTIVE_SEARCH_KINDS = Object.freeze({
  client: "Client",
  watchlist: "Watchlist",
  decision: "Owner decision",
  renewal: "Renewal",
  workspace: "Workspace",
});

export function buildExecutiveSearchIndex({
  portfolio = [],
  watchlist = [],
  risks = [],
  renewals = [],
  workspaces = [],
} = {}) {
  const watched = new Set((watchlist || []).map((row) => String(row.client_id)));
  const index = [];

  (portfolio || []).forEach((client) => {
    index.push({
      id: `client:${client.client_id}`,
      kind: "client",
      label: client.client_name || "Unknown client",
      detail: client.health_score == null
        ? `${client.evidence_coverage_pct ?? 0}% evidence coverage · health not assessed`
        : `Health ${client.health_score} · ${client.tickets_30d ?? 0} tickets in period`,
      route: client.route || `/clients?client=${client.client_id}`,
      clientId: client.client_id,
      watched: watched.has(String(client.client_id)),
    });
  });

  (watchlist || []).forEach((row) => {
    index.push({
      id: `watchlist:${row.client_id}`,
      kind: "watchlist",
      label: row.client_name || "Unknown client",
      detail: row.note ? `Watched · ${row.note}` : "On your owner watchlist",
      route: `/clients?client=${row.client_id}`,
      clientId: row.client_id,
      watched: true,
    });
  });

  (risks || []).forEach((item) => {
    index.push({
      id: `decision:${item.id}`,
      kind: "decision",
      label: item.decision || item.title,
      detail: `${item.severity || "attention"} · ${item.title}`,
      route: item.route || "/executive",
    });
  });

  (renewals || []).forEach((row) => {
    index.push({
      id: `renewal:${row.contract_id || row.client_id}`,
      kind: "renewal",
      label: row.client_name || "Unknown client",
      detail: `Renewal in ${row.days_until} day${row.days_until === 1 ? "" : "s"} · ${row.end_date}`,
      route: row.route || "/contracts",
      clientId: row.client_id,
    });
  });

  (workspaces || []).forEach((workspace) => {
    index.push({
      id: `workspace:${workspace.route}`,
      kind: "workspace",
      label: workspace.label,
      detail: workspace.detail,
      route: workspace.route,
      keywords: workspace.keywords || "",
    });
  });

  return index;
}

/**
 * Ranked search. A label prefix match beats a mid-string match, which beats a
 * match found only in the supporting detail. An empty query returns nothing —
 * the palette is a lens on the current briefing, not a replacement for it.
 */
export function searchExecutiveRecords(index, query, { limit = 12 } = {}) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];
  const scored = [];
  (Array.isArray(index) ? index : []).forEach((entry, order) => {
    const label = String(entry.label || "").toLowerCase();
    const detail = String(entry.detail || "").toLowerCase();
    const keywords = String(entry.keywords || "").toLowerCase();
    let score = 0;
    if (label.startsWith(needle)) score = 100;
    else if (label.includes(needle)) score = 70;
    else if (keywords.includes(needle)) score = 50;
    else if (detail.includes(needle)) score = 30;
    if (score > 0) scored.push({ entry, score, order });
  });
  scored.sort((left, right) => right.score - left.score || left.order - right.order);
  return scored.slice(0, limit).map(({ entry }) => entry);
}

/** Group ranked results by kind, preserving the ranked order inside each group. */
export function groupSearchResults(results) {
  const groups = [];
  (Array.isArray(results) ? results : []).forEach((entry) => {
    let group = groups.find((candidate) => candidate.kind === entry.kind);
    if (!group) {
      group = { kind: entry.kind, label: EXECUTIVE_SEARCH_KINDS[entry.kind] || "Result", entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  });
  return groups;
}

/** A signed percentage, so a fall is never rendered as a rise. */
const signed = (value) => `${Number(value) > 0 ? "+" : Number(value) < 0 ? "-" : ""}${Math.abs(Number(value) || 0)}`;

/**
 * One self-contained clause for the movement since the goal's starting line.
 *
 * Mirrors `_goal_growth_phrase` in the API so the printed owner pack and the
 * board brief describe the same recorded goal identically. Returns null when the
 * goal carries no starting line, and never renders a flat run rate as
 * "growth of $0".
 */
export function mrrTargetGrowthClause(goal) {
  const growth = mrrTargetGrowth(goal);
  if (!growth) return null;
  const starting = `the ${money(growth.starting)} run rate recorded with the goal`;
  if (growth.direction === "flat") return `no change from ${starting}`;
  const pct = growth.pct == null ? "" : ` (${signed(growth.pct)}%)`;
  return `${growth.direction === "up" ? "growth of" : "a fall of"} ${money(Math.abs(growth.growth))}${pct} from ${starting}`;
}

const money = (value) => (
  value == null
    ? "not assessed"
    : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Number(value) || 0)
);

/**
 * The printable owner pack as plain lines. It is assembled only from the
 * briefing payload, and every section names the period and its evidence state
 * so a printed page cannot be mistaken for a forecast.
 */
export function briefingPack(data) {
  if (!data) return { title: "Executive briefing", lines: [] };
  const summary = data.summary || {};
  const period = data.period?.label || "Current period";
  const lines = [
    `${period} · generated ${data.generated_at || "unknown time"}`,
    "",
    "HEADLINE",
    data.board_brief?.headline || "No headline was produced.",
    "",
    "NUMBERS (recorded evidence only)",
    `Contract MRR: ${money(summary.mrr)} (ARR ${money(summary.arr)})`,
    `Service contribution: ${summary.service_contribution == null ? "not assessed — direct costs are not recorded" : money(summary.service_contribution)}`,
    `30-day net cash outlook: ${money(summary.net_cash_30d)}`,
    `Average assessed client health: ${summary.average_client_health == null ? "not assessed" : summary.average_client_health} (${summary.assessed_clients || 0}/${summary.total_clients || 0} assessed)`,
    `Team capacity: ${summary.staff_capacity_pct == null ? "not assessed" : `${summary.staff_capacity_pct}%`}`,
    `Revenue concentration: ${data.concentration?.detail || "not measurable"}`,
    `Oldest overdue invoice: ${data.receivables?.oldest_overdue_days ? `${data.receivables.oldest_overdue_days} days` : "none recorded"}`,
    "",
    "RECORDED GOAL",
    mrrTargetSummary(data.mrr_target) || "No revenue goal is recorded, so progress is not measured against one.",
    "",
    "OWNER DECISIONS",
    ...(data.risk_items?.length
      ? data.risk_items.map((item) => `- [${item.severity}] ${item.title} → ${item.decision}`)
      : ["- No owner risk is currently evidenced."]),
    "",
    "EVIDENCE CONFIDENCE",
    ...(data.data_quality || []).map((item) => `- ${item.label}: ${item.state} — ${item.detail}`),
    "",
    "METHOD",
    data.board_brief?.method || "Deterministic briefing from current Nexus records.",
  ];
  return { title: `Executive briefing · ${period}`, lines };
}
