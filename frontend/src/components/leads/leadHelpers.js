/* leadHelpers.js — shared lead-page helpers */

export const STATUS_CONFIG = {
  new:         { label: "New",         pill: "bg-blue-500/15 text-blue-300 border-blue-500/30",         orb: "bg-blue-400",         hex: "#60a5fa", probability: 0.05 },
  contacted:   { label: "Contacted",   pill: "bg-purple-500/15 text-purple-300 border-purple-500/30",   orb: "bg-purple-400",       hex: "#c084fc", probability: 0.15 },
  qualified:   { label: "Qualified",   pill: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",         orb: "bg-cyan-400",         hex: "#22d3ee", probability: 0.35 },
  proposal:    { label: "Proposal",    pill: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",   orb: "bg-yellow-400",       hex: "#facc15", probability: 0.55 },
  negotiation: { label: "Negotiation", pill: "bg-orange-500/15 text-orange-300 border-orange-500/30",   orb: "bg-orange-400",       hex: "#fb923c", probability: 0.75 },
  won:         { label: "Won",         pill: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", orb: "bg-emerald-400",     hex: "#34d399", probability: 1.0 },
  lost:        { label: "Lost",        pill: "bg-red-500/15 text-red-300 border-red-500/30",            orb: "bg-red-400",          hex: "#f87171", probability: 0.0 },
};

export const PIPELINE_STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won"];

export function initialsOf(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join("");
}

export function avatarColor(seed = "") {
  const hash = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);
  const colors = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-cyan-500", "bg-fuchsia-500", "bg-lime-500"];
  return colors[hash % colors.length];
}

export function timeAgo(ts) {
  if (!ts) return "—";
  try {
    const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  } catch { return "—"; }
}

export function money(v) {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
