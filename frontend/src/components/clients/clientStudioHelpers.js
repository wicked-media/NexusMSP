/* helpers for the Client Studio frontend */
export const TIER_META = {
  diamond:  { label: "Diamond",  color: "from-cyan-400 to-indigo-500",       chip: "bg-cyan-500/15 text-cyan-200 border-cyan-500/40",       icon: "💎" },
  platinum: { label: "Platinum", color: "from-fuchsia-500 to-indigo-500",    chip: "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-500/40", icon: "🥇" },
  gold:     { label: "Gold",     color: "from-amber-400 to-orange-500",      chip: "bg-amber-500/15 text-amber-200 border-amber-500/40",     icon: "🏆" },
  silver:   { label: "Silver",   color: "from-zinc-300 to-zinc-500",         chip: "bg-zinc-500/15 text-zinc-200 border-zinc-500/40",        icon: "🥈" },
  bronze:   { label: "Bronze",   color: "from-orange-700 to-amber-800",      chip: "bg-orange-500/10 text-orange-200 border-orange-500/30",  icon: "🥉" },
};

export function tierMeta(t) { return TIER_META[(t || "bronze").toLowerCase()] || TIER_META.bronze; }

export function healthColor(h) {
  if (h >= 80) return "#34d399";
  if (h >= 60) return "#fbbf24";
  return "#f87171";
}

export function moneyShort(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
