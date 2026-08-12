import { BadgeCheck, CheckCircle2, CircleDashed, Clock3, HelpCircle, Radar, Sparkles } from "lucide-react";

const states = {
  known: { label: "Known", icon: CheckCircle2, className: "border-sky-400/30 bg-sky-400/10 text-sky-200" },
  verified: { label: "Verified", icon: BadgeCheck, className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" },
  inferred: { label: "Inferred", icon: CircleDashed, className: "border-violet-400/30 bg-violet-400/10 text-violet-200" },
  predicted: { label: "Predicted", icon: Sparkles, className: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200" },
  stale: { label: "Stale", icon: Clock3, className: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
  unknown: { label: "Unknown", icon: HelpCircle, className: "border-border bg-muted/40 text-muted-foreground" },
  observed: { label: "Observed", icon: Radar, className: "border-sky-400/30 bg-sky-400/10 text-sky-200" },
};

/** Shows how Nexus knows something, separate from whether that thing is healthy. */
export default function NexusConfidenceBadge({ state = "unknown", detail = "", className = "" }) {
  const config = states[state] || states.unknown;
  const Icon = config.icon;
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${config.className} ${className}`.trim()} title={detail || `${config.label} Nexus information`}>
    <Icon className="h-3 w-3" aria-hidden="true" />{config.label}
  </span>;
}
