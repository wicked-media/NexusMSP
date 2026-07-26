import {
  Activity,
  ArrowUpRight,
  Bot,
  Building2,
  CircleDollarSign,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
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

export default function MissionControlOverview({ data, navigate, onOpenCommand }) {
  if (!data) {
    return (
      <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-4" data-testid="mission-control-unavailable">
        <p className="text-sm font-medium text-amber-100">Mission Control evidence is temporarily unavailable</p>
        <p className="mt-1 text-xs text-muted-foreground">The rest of the operational dashboard remains available below.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4" data-testid="mission-control-overview">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(data.panels || []).map(panel => {
          const Icon = PANEL_ICONS[panel.id] || Activity;
          const tone = PANEL_TONES[panel.tone] || PANEL_TONES.healthy;
          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => navigate(panel.route)}
              className={`group rounded-2xl border bg-[#111318] p-4 text-left shadow-[0_16px_38px_rgba(0,0,0,0.16)] transition duration-200 hover:-translate-y-0.5 ${tone.border}`}
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

      <div className="grid gap-3 xl:grid-cols-[1.1fr_1.9fr]">
        <div className="rounded-2xl border border-white/[0.07] bg-[#111318] p-4" data-testid="mission-attention-queue">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-300/80">Needs attention</p>
              <h2 className="mt-1 text-sm font-semibold text-zinc-100">Live operating queue</h2>
            </div>
            <Badge variant="outline" className="border-rose-400/20 bg-rose-400/[0.06] text-rose-200">
              {data.summary?.attention_count || 0}
            </Badge>
          </div>
          <div className="mt-3 space-y-1.5">
            {(data.attention || []).slice(0, 4).map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.route)}
                className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2 text-left transition hover:border-cyan-300/20 hover:bg-cyan-400/[0.04]"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${item.severity === "critical" ? "bg-rose-400" : "bg-amber-400"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-zinc-200">{item.title}</span>
                  <span className="block truncate text-[10px] text-zinc-500">{item.source} · {item.detail}</span>
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
              </button>
            ))}
            {!data.attention?.length && (
              <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] px-3 py-4 text-center">
                <ShieldCheck className="mx-auto h-5 w-5 text-emerald-300" />
                <p className="mt-1 text-xs font-medium text-emerald-100">No priority exceptions found</p>
                <p className="mt-0.5 text-[10px] text-zinc-500">Live Nexus records are currently clear.</p>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.07] bg-[#111318] p-4" data-testid="mission-capabilities">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300/80">Platform capabilities</p>
              <h2 className="mt-1 text-sm font-semibold text-zinc-100">One operating system, connected workspaces</h2>
            </div>
            <Button size="sm" variant="outline" className="h-8 border-cyan-300/20 bg-cyan-400/[0.06] text-xs text-cyan-100" onClick={onOpenCommand}>
              <Search className="mr-1.5 h-3.5 w-3.5" />Ask Nexus
            </Button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(data.capabilities || []).map(capability => (
              <button
                key={capability.id}
                type="button"
                onClick={() => navigate(capability.route)}
                className="group rounded-xl border border-white/[0.06] bg-black/10 p-3 text-left transition hover:border-cyan-300/20 hover:bg-cyan-400/[0.04]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-200">{capability.label}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-zinc-600 transition group-hover:text-cyan-300" />
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-zinc-500">{capability.description}</p>
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-white/[0.06] pt-3 text-[10px] text-zinc-500">
            <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
            {data.summary?.evidence_note}
          </div>
        </div>
      </div>
    </section>
  );
}
