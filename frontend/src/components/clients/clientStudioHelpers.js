/* Shared client workspace display helpers. */
export const TIER_META = {
  diamond: { label: "Diamond", color: "from-cyan-400 to-indigo-500", chip: "bg-cyan-500/15 text-cyan-200 border-cyan-500/40", icon: "\u{1F48E}" },
  platinum: { label: "Platinum", color: "from-fuchsia-500 to-indigo-500", chip: "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-500/40", icon: "\u{1F3C5}" },
  gold: { label: "Gold", color: "from-amber-400 to-orange-500", chip: "bg-amber-500/15 text-amber-200 border-amber-500/40", icon: "\u{1F3C6}" },
  silver: { label: "Silver", color: "from-zinc-300 to-zinc-500", chip: "bg-zinc-500/15 text-zinc-200 border-zinc-500/40", icon: "\u{1F948}" },
  bronze: { label: "Bronze", color: "from-orange-700 to-amber-800", chip: "bg-orange-500/10 text-orange-200 border-orange-500/30", icon: "\u{1F949}" },
};

export function tierMeta(tier) {
  return TIER_META[(tier || "bronze").toLowerCase()] || TIER_META.bronze;
}

export function healthColor(health) {
  if (!Number.isFinite(health)) return "#94a3b8";
  if (health >= 80) return "#34d399";
  if (health >= 60) return "#fbbf24";
  return "#f87171";
}

export function moneyShort(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const numeric = Number(value);
  if (numeric >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000) return `$${(numeric / 1_000).toFixed(1)}K`;
  return `$${numeric.toFixed(0)}`;
}
