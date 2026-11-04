/**
 * Web Studio fleet helpers — one definition for the fleet command centre.
 *
 * These mirror `backend/app/services/web_studio_fleet.py`. They exist so the UI
 * never re-derives a number differently from the API: the tiles, the attention
 * wording and the Safe Update Engine preflight copy all read from these
 * functions, and `webStudioFleet.test.js` pins them.
 *
 * A recurring theme: "not assessed" is not "clean". The backend reports an
 * `assessed` flag per dimension, and the tiles must show that plainly rather
 * than a reassuring zero.
 */

/** Update policies, safest first — matches the backend enum. */
export const UPDATE_POLICIES = Object.freeze(["manual", "assisted", "policy_driven"]);

const POLICY_LABELS = Object.freeze({
  manual: "Manual",
  assisted: "Assisted",
  policy_driven: "Policy-driven",
});

export function policyLabel(policy) {
  return POLICY_LABELS[policy] || "Manual";
}

/**
 * The four headline tiles. `unassessed` marks a dimension that has never been
 * checked, so the tile can render "Not assessed" instead of a false zero.
 */
export function fleetTiles(summary = {}) {
  const assessed = summary.assessed || {};
  return [
    {
      key: "managed",
      label: "Managed websites",
      value: summary.managed_websites || 0,
      glow: "sky",
      subtitle: "WordPress and other sites under Nexus",
      unassessed: false,
    },
    {
      key: "updates",
      label: "Plugin updates",
      value: summary.plugin_updates || 0,
      glow: "amber",
      subtitle: assessed.plugins ? "Available across the fleet" : "Inventory not synced yet",
      unassessed: !assessed.plugins,
    },
    {
      key: "security",
      label: "Security findings",
      value: summary.security_findings || 0,
      glow: "rose",
      subtitle: assessed.security ? "Recorded against managed sites" : "Security evidence not recorded yet",
      unassessed: !assessed.security,
    },
    {
      key: "backups",
      label: "Backup warnings",
      value: summary.backup_warnings || 0,
      glow: "violet",
      subtitle: assessed.backups ? "Sites without current backup evidence" : "Backup evidence not recorded yet",
      unassessed: !assessed.backups,
    },
  ];
}

const ATTENTION_TONE = Object.freeze({
  critical: { label: "Critical", className: "border-rose-500/30 bg-rose-500/[0.08] text-rose-200" },
  attention: { label: "Needs attention", className: "border-amber-500/30 bg-amber-500/[0.08] text-amber-200" },
  healthy: { label: "Healthy", className: "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-200" },
});

/** Class names and human label for a site or plan attention level. */
export function attentionTone(level) {
  return ATTENTION_TONE[level] || ATTENTION_TONE.healthy;
}

/**
 * Attention queue derived from the fleet summary, worth the technician's time
 * first: critical sites before attention sites, each with its named reasons.
 */
export function attentionQueue(summary = {}, sites = []) {
  const byId = new Map((sites || []).map((site) => [site.id, site]));
  return [...(summary.attention_sites || [])]
    .map((entry) => ({
      ...entry,
      site: byId.get(entry.site_id) || null,
      tone: attentionTone(entry.level),
    }))
    .sort((a, b) => {
      const rank = { critical: 0, attention: 1, healthy: 2 };
      return (rank[a.level] ?? 3) - (rank[b.level] ?? 3);
    });
}

/** Plugin intelligence rows, worst first, exactly as the API sorts them. */
export function pluginRows(plugins = []) {
  return [...plugins].sort((a, b) => {
    if (b.security_findings !== a.security_findings) return b.security_findings - a.security_findings;
    if (b.sites_with_updates !== a.sites_with_updates) return b.sites_with_updates - a.sites_with_updates;
    return String(a.name || a.plugin).localeCompare(String(b.name || b.plugin));
  });
}

/** How many sites run a plugin version that has a recorded security finding. */
export function vulnerableSiteCount(plugin = {}) {
  return plugin.security_findings > 0 ? plugin.sites_installed : 0;
}

/**
 * A short, honest summary of a Safe Update Engine preflight result. A plan that
 * did not pass can never be framed as ready.
 */
export function preflightSummary(preflight = {}) {
  const checks = preflight.checks || [];
  const blockers = checks.filter((check) => check.state === "block");
  if (!checks.length) {
    return { passed: false, headline: "Not evaluated", blockers: [], detail: "Preflight has not run for this plan." };
  }
  if (!preflight.allowed) {
    return {
      passed: false,
      headline: `${blockers.length} check${blockers.length === 1 ? "" : "s"} blocking`,
      blockers,
      detail: blockers.map((check) => check.detail).join(" "),
    };
  }
  return { passed: true, headline: "Preflight passed", blockers: [], detail: "Connection, inventory and backup evidence are all current." };
}

const PLAN_TONE = Object.freeze({
  preflight_failed: "border-rose-500/30 bg-rose-500/[0.08] text-rose-200",
  failed: "border-rose-500/30 bg-rose-500/[0.08] text-rose-200",
  rolled_back: "border-amber-500/30 bg-amber-500/[0.08] text-amber-200",
  preflight_passed: "border-sky-500/30 bg-sky-500/[0.08] text-sky-200",
  pending_approval: "border-amber-500/30 bg-amber-500/[0.08] text-amber-200",
  approved: "border-cyan-500/30 bg-cyan-500/[0.08] text-cyan-200",
  queued: "border-cyan-500/30 bg-cyan-500/[0.08] text-cyan-200",
  awaiting_worker: "border-cyan-500/30 bg-cyan-500/[0.08] text-cyan-200",
  completed: "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-200",
});

export function planStatusTone(status) {
  return PLAN_TONE[status] || "border-zinc-500/30 text-muted-foreground";
}

export function planStatusLabel(status) {
  if (status === "awaiting_worker") return "Awaiting control worker";
  return String(status || "draft").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Risk chip tone — high risk must never look routine. */
export function riskTone(risk) {
  if (risk === "high") return "border-rose-500/30 bg-rose-500/[0.08] text-rose-200";
  if (risk === "medium") return "border-amber-500/30 bg-amber-500/[0.08] text-amber-200";
  return "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-200";
}

/** Build the Safe Update Engine request body from an inventory row. */
export function updatePlanItem(plugin) {
  return {
    kind: "plugin",
    plugin: plugin.plugin,
    name: plugin.name || plugin.plugin,
    from_version: plugin.version || "",
    to_version: plugin.new_version || "",
    requires_php: plugin.requires_php || "",
    security_findings: plugin.security_findings || 0,
  };
}
