import {
  Activity,
  ArrowRight,
  BadgeDollarSign,
  Bot,
  BrainCircuit,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Flame,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const PANEL_ICONS = {
  "client-health": Building2,
  security: ShieldCheck,
  infrastructure: Network,
  billing: CircleDollarSign,
  automation: Workflow,
  "ai-insights": Bot,
};

const PANEL_TONES = {
  healthy: {
    border: "border-emerald-400/18 hover:border-emerald-300/35",
    icon: "border-emerald-300/20 bg-emerald-400/10 text-emerald-200",
    count: "text-emerald-200",
    dot: "bg-emerald-400",
    label: "Healthy",
  },
  warning: {
    border: "border-amber-400/18 hover:border-amber-300/35",
    icon: "border-amber-300/20 bg-amber-400/10 text-amber-200",
    count: "text-amber-200",
    dot: "bg-amber-400",
    label: "Review",
  },
  critical: {
    border: "border-rose-400/20 hover:border-rose-300/40",
    icon: "border-rose-300/20 bg-rose-400/10 text-rose-200",
    count: "text-rose-200",
    dot: "bg-rose-400",
    label: "Attention",
  },
};

const WORKSTREAMS = {
  critical: {
    icon: Flame,
    iconClass: "border-rose-300/20 bg-rose-400/10 text-rose-200",
    countClass: "border-rose-400/20 bg-rose-400/[0.08] text-rose-200",
    accent: "from-rose-500/20",
    emptyTitle: "No critical exceptions",
    emptyText: "Nothing currently requires immediate ownership.",
  },
  attention: {
    icon: TriangleAlert,
    iconClass: "border-amber-300/20 bg-amber-400/10 text-amber-200",
    countClass: "border-amber-400/20 bg-amber-400/[0.08] text-amber-200",
    accent: "from-amber-500/20",
    emptyTitle: "Attention queue is clear",
    emptyText: "No preventable risk is waiting to be scheduled.",
  },
  suggestions: {
    icon: BrainCircuit,
    iconClass: "border-cyan-300/20 bg-cyan-400/10 text-cyan-200",
    countClass: "border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-200",
    accent: "from-cyan-500/20",
    emptyTitle: "No new AI recommendation",
    emptyText: "Nexus will surface one when current evidence supports it.",
  },
  revenue: {
    icon: BadgeDollarSign,
    iconClass: "border-emerald-300/20 bg-emerald-400/10 text-emerald-200",
    countClass: "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200",
    accent: "from-emerald-500/20",
    emptyTitle: "Revenue checks are clear",
    emptyText: "No unbilled work or finance exception is visible.",
  },
};

function healthTone(score) {
  if (score >= 90) return {
    ring: "border-emerald-300/30 bg-emerald-400/[0.08] text-emerald-100",
    bar: "bg-emerald-400",
  };
  if (score >= 75) return {
    ring: "border-cyan-300/30 bg-cyan-400/[0.08] text-cyan-100",
    bar: "bg-cyan-400",
  };
  if (score >= 50) return {
    ring: "border-amber-300/30 bg-amber-400/[0.08] text-amber-100",
    bar: "bg-amber-400",
  };
  return {
    ring: "border-rose-300/30 bg-rose-400/[0.08] text-rose-100",
    bar: "bg-rose-400",
  };
}

function WorkItem({ item, navigate }) {
  return (
    <article className="rounded-xl border border-white/[0.065] bg-black/15 p-3 transition hover:border-cyan-300/15" data-testid={`mission-item-${item.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-zinc-100">{item.title}</p>
          <p className="mt-0.5 truncate text-[10px] text-zinc-500">{item.source} · {item.detail}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 px-2 text-[10px] text-cyan-200 hover:bg-cyan-400/10"
          onClick={() => navigate(item.route)}
          data-testid={`mission-open-${item.id}`}
        >
          Open <ArrowRight className="ml-1 h-3 w-3" />
        </Button>
      </div>
      <div className="mt-2 rounded-lg border border-white/[0.045] bg-white/[0.025] px-2.5 py-2">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Why Nexus surfaced this</p>
        <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">{item.why}</p>
      </div>
      <div className="mt-2 flex items-start gap-2">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-cyan-300" />
        <p className="text-[10px] leading-relaxed text-zinc-300">{item.recommendation}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px] text-zinc-500">
        <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] px-1.5 py-0.5">
          <Clock3 className="h-2.5 w-2.5" />~{item.estimated_minutes || 5} min
        </span>
        {item.confidence && (
          <span className="rounded-md border border-white/[0.06] px-1.5 py-0.5">{item.confidence} confidence</span>
        )}
      </div>
    </article>
  );
}

export default function MissionControlOverview({ data, navigate, onOpenCommand, detailOnly = false }) {
  if (!data) {
    return (
      <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-4" data-testid="mission-control-unavailable">
        <p className="text-sm font-medium text-amber-100">Mission Control evidence is temporarily unavailable</p>
        <p className="mt-1 text-xs text-muted-foreground">The rest of the operational dashboard remains available below.</p>
      </section>
    );
  }

  const score = Number(data.summary?.health_score ?? 0);
  const health = healthTone(score);
  const focus = data.focus;

  return (
    <section className="space-y-4" data-testid="mission-control-overview">
      {!detailOnly && (
      <>
      <div className="grid gap-3 xl:grid-cols-[0.82fr_2.18fr]">
        <div className="rounded-2xl border border-white/[0.07] bg-[#111318] p-4 shadow-[0_18px_44px_rgba(0,0,0,0.18)]" data-testid="mission-health-score">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300/80">Live health</p>
              <h2 className="mt-1 text-sm font-semibold text-zinc-100">MSP operating health</h2>
            </div>
            <span className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border ${health.ring}`}>
              <span className="text-xl font-semibold leading-none">{score}</span>
              <span className="mt-1 text-[8px] uppercase tracking-[0.14em] opacity-70">of 100</span>
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className={`h-full rounded-full transition-all ${health.bar}`} style={{ width: `${Math.max(2, score)}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <Badge variant="outline" className="border-white/[0.08] bg-white/[0.03] text-[9px] text-zinc-300">
              {data.summary?.health_label || "Not assessed"}
            </Badge>
            <span className="text-[9px] text-zinc-600">Explainable · live evidence</span>
          </div>
          <div className="mt-3 space-y-1">
            {(data.summary?.health_factors || []).map(factor => (
              <div key={factor} className="flex items-start gap-2 text-[10px] text-zinc-400">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                <span>{factor}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#111318] p-4 shadow-[0_18px_44px_rgba(0,0,0,0.18)]" data-testid="mission-next-action">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-500/[0.09] via-transparent to-violet-500/[0.05]" />
          <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300/80">Nexus Focus</p>
                <h2 className="mt-1 text-base font-semibold text-zinc-100">What should I do next?</h2>
              </div>
              <Button size="sm" variant="outline" className="h-8 border-cyan-300/20 bg-cyan-400/[0.06] text-xs text-cyan-100" onClick={onOpenCommand}>
                <Search className="mr-1.5 h-3.5 w-3.5" />Search everything <kbd className="ml-1 rounded bg-black/25 px-1 text-[8px]">Ctrl K</kbd>
              </Button>
            </div>
            {focus && (
              <div className="mt-4 grid gap-3 lg:grid-cols-[1.35fr_1fr]">
                <div className="rounded-xl border border-white/[0.07] bg-black/15 p-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-400/10">
                      <Sparkles className="h-4 w-4 text-cyan-200" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-100">{focus.title}</p>
                      <p className="mt-1 text-[11px] text-zinc-500">{focus.source} · {focus.detail}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-cyan-300/15 bg-cyan-400/[0.04] text-[9px] text-cyan-200">
                      ~{focus.estimated_minutes || 5} minutes
                    </Badge>
                    {focus.confidence && (
                      <Badge variant="outline" className="border-white/[0.08] bg-white/[0.025] text-[9px] text-zinc-400">
                        {focus.confidence} confidence
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-black/15 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Recommended next action</p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-300">{focus.recommendation}</p>
                  <Button size="sm" className="mt-3 h-8 w-full bg-cyan-500 text-xs text-slate-950 hover:bg-cyan-400" onClick={() => navigate(focus.route)}>
                    Start with this <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(data.panels || []).map(panel => {
          const Icon = PANEL_ICONS[panel.id] || Activity;
          const tone = PANEL_TONES[panel.tone] || PANEL_TONES.healthy;
          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => navigate(panel.route)}
              className={`nx-ambient-surface group rounded-2xl border bg-[#111318] p-4 text-left shadow-[0_16px_38px_rgba(0,0,0,0.16)] transition duration-200 hover:-translate-y-0.5 ${tone.border}`}
              data-nx-signal={panel.tone === "warning" ? "attention" : panel.tone}
              data-testid={`mission-panel-${panel.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl border ${tone.icon}`}><Icon className="h-4.5 w-4.5" /></span>
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  <span className={`h-1.5 w-1.5 rounded-full ${tone.dot} ${panel.tone === "critical" ? "animate-pulse" : ""}`} />
                  {tone.label}
                </span>
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{panel.label}</p>
                  <p className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-relaxed text-zinc-500">{panel.summary}</p>
                </div>
                <span className={`text-3xl font-semibold tracking-tight ${tone.count}`}>{panel.count}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-white/[0.06] pt-3">
                {(panel.metrics || []).slice(0, 3).map(metric => (
                  <span key={metric.label} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.025] px-2 py-1.5">
                    <span className="truncate text-[9px] text-zinc-500">{metric.label}</span>
                    <span className="text-[10px] font-semibold text-zinc-300">{metric.value}</span>
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
      </>
      )}

      <div className="grid gap-3 xl:grid-cols-2" data-testid="mission-workstreams">
        {(data.workstreams || []).map(stream => {
          const style = WORKSTREAMS[stream.id] || WORKSTREAMS.attention;
          const Icon = style.icon;
          return (
            <section key={stream.id} className="nx-ambient-surface relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111318] p-4" data-nx-signal={stream.id === "critical" && stream.count ? "critical" : stream.id === "attention" && stream.count ? "attention" : stream.id === "suggestions" && stream.count ? "recommendation" : stream.id === "revenue" && stream.count ? "success" : "calm"}>
              <div className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${style.accent} to-transparent opacity-40`} />
              <div className="relative flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${style.iconClass}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">{stream.label}</h2>
                    <p className="mt-0.5 text-[10px] text-zinc-500">{stream.description}</p>
                  </div>
                </div>
                <Badge variant="outline" className={style.countClass}>{stream.count || 0}</Badge>
              </div>
              <div className="relative mt-3 space-y-2">
                {(stream.items || []).map(item => <WorkItem key={item.id} item={item} navigate={navigate} />)}
                {!stream.items?.length && (
                  <div className="rounded-xl border border-emerald-400/12 bg-emerald-400/[0.025] px-3 py-5 text-center">
                    <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-300" />
                    <p className="mt-1.5 text-xs font-medium text-emerald-100">{style.emptyTitle}</p>
                    <p className="mt-0.5 text-[10px] text-zinc-500">{style.emptyText}</p>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[10px] text-zinc-500">
        <span className="inline-flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-cyan-300" />{data.summary?.evidence_note}</span>
        <span>{data.summary?.attention_count || 0} live signals · {data.summary?.automated_actions_24h || 0} automated actions in 24h</span>
      </div>
    </section>
  );
}
