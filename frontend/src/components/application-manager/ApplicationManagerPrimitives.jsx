import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const STATE = {
  fresh: { label: "Inventory fresh", className: "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200" },
  stale: { label: "Inventory stale", className: "border-amber-400/30 bg-amber-400/[0.08] text-amber-200" },
  unverified: { label: "Timestamp missing", className: "border-amber-400/30 bg-amber-400/[0.08] text-amber-200" },
  not_collected: { label: "Not collected", className: "border-border/70 bg-muted/30 text-muted-foreground" },
  current: { label: "Update current", className: "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200" },
  outdated: { label: "Update available", className: "border-rose-400/30 bg-rose-400/[0.08] text-rose-200" },
  partially_observed: { label: "Partially observed", className: "border-sky-400/30 bg-sky-400/[0.08] text-sky-200" },
  not_assessed: { label: "Not assessed", className: "border-border/70 bg-muted/30 text-muted-foreground" },
  approved: { label: "Approved", className: "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200" },
  restricted: { label: "Restricted", className: "border-rose-400/30 bg-rose-400/[0.08] text-rose-200" },
  review: { label: "Review required", className: "border-amber-400/30 bg-amber-400/[0.08] text-amber-200" },
  conflict: { label: "Policy conflict", className: "border-rose-400/30 bg-rose-400/[0.08] text-rose-200" },
  not_reviewed: { label: "Not reviewed", className: "border-border/70 bg-muted/30 text-muted-foreground" },
  not_visible: { label: "Policy restricted", className: "border-border/70 bg-muted/30 text-muted-foreground" },
};

export function applicationStateMeta(state) {
  return STATE[state] || { label: state ? String(state).replaceAll("_", " ") : "Not assessed", className: "border-border/70 bg-muted/30 text-muted-foreground" };
}
export function ApplicationStateBadge({ state, compact = false, className = "" }) {
  const meta = applicationStateMeta(state);
  return <Badge variant="outline" className={`shrink-0 text-[10px] ${meta.className} ${className}`}>{compact ? meta.label.replace("Inventory ", "").replace("Update ", "") : meta.label}</Badge>;
}

export function ApplicationMetric({ icon: Icon, label, value, detail, tone = "sky", onClick, selected = false }) {
  const tones = {
    sky: "border-sky-400/25 bg-sky-400/[0.05] text-sky-200",
    emerald: "border-emerald-400/25 bg-emerald-400/[0.05] text-emerald-200",
    amber: "border-amber-400/25 bg-amber-400/[0.05] text-amber-200",
    rose: "border-rose-400/25 bg-rose-400/[0.05] text-rose-200",
    slate: "border-border/70 bg-card/90 text-foreground",
  };
  const body = <Card className={`h-full overflow-hidden rounded-2xl border shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)] transition-all ${tones[tone] || tones.slate} ${selected ? "ring-1 ring-primary/60" : ""}`}><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>{Icon && <span className="rounded-xl border border-current/15 bg-current/[0.06] p-2"><Icon className="h-4 w-4" /></span>}</div></CardContent></Card>;
  if (!onClick) return body;
  return <button type="button" onClick={onClick} aria-pressed={selected} className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70">{body}</button>;
}
