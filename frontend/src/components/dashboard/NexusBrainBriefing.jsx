import {
  Activity,
  ArrowRight,
  BadgeDollarSign,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Gauge,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const OUTCOMES = {
  reduce_effort: { label: "Reduces effort", className: "border-cyan-300/15 bg-cyan-400/[0.05] text-cyan-200" },
  reduce_risk: { label: "Reduces risk", className: "border-amber-300/15 bg-amber-400/[0.05] text-amber-200" },
  increase_revenue: { label: "Protects revenue", className: "border-emerald-300/15 bg-emerald-400/[0.05] text-emerald-200" },
};

function Metric({ icon: Icon, label, value, detail, tone = "cyan", state = "evidenced" }) {
  const tones = {
    cyan: "border-cyan-300/15 bg-cyan-400/[0.045] text-cyan-200",
    amber: "border-amber-300/15 bg-amber-400/[0.045] text-amber-200",
    emerald: "border-emerald-300/15 bg-emerald-400/[0.045] text-emerald-200",
    violet: "border-violet-300/15 bg-violet-400/[0.045] text-violet-200",
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <Icon className="h-3.5 w-3.5 opacity-80" />
        <span className="text-lg font-semibold tracking-tight">{value}</span>
      </div>
      <p className="mt-2 text-[10px] font-semibold text-zinc-200">{label}</p>
      <p className="mt-0.5 text-[9px] text-zinc-500">{detail}</p>
      <p className="mt-2 text-[8px] font-semibold uppercase tracking-[0.13em] text-zinc-600">
        {state === "evidenced" ? "Retained evidence" : state === "review_required" ? "Review required" : "Not yet measured"}
      </p>
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="rounded-xl border border-emerald-400/12 bg-emerald-400/[0.025] px-3 py-5 text-center">
      <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-300" />
      <p className="mt-1.5 text-xs font-medium text-emerald-100">{title}</p>
      <p className="mt-0.5 text-[10px] text-zinc-500">{detail}</p>
    </div>
  );
}

export default function NexusBrainBriefing({ data, navigate }) {
  if (!data) return null;

  const metrics = data.briefing?.metrics || {};
  const valueProof = data.value_proof || {};
  const proofMetrics = Object.fromEntries((valueProof.metrics || []).map(metric => [metric.id, metric]));
  const completed = data.briefing?.completed || [];
  const approvals = data.briefing?.approvals || [];
  const insights = data.insights || [];
  const activity = data.activity || [];

  return (
    <section className="relative overflow-hidden rounded-2xl border border-violet-300/15 bg-[#101217] p-4 shadow-[0_20px_54px_rgba(0,0,0,0.20)] md:p-5" data-testid="nexus-brain-briefing">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.11),transparent_34%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.08),transparent_30%)]" />
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-300/20 bg-violet-400/10">
              <BrainCircuit className="h-5 w-5 text-violet-200" />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/80">Nexus Value Proof · {data.window_hours || 12}-hour evidence window</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-zinc-100">Show the outcome, then show the evidence</h2>
              <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-zinc-400">{data.briefing?.headline}</p>
            </div>
          </div>
          <Badge variant="outline" className="border-cyan-300/15 bg-cyan-400/[0.05] text-[9px] text-cyan-200">
            Evidence correlation · no silent actions
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
          <Metric icon={Zap} label={proofMetrics.actions_completed?.label || "Evidenced actions"} value={proofMetrics.actions_completed?.value ?? metrics.automated_actions ?? 0} detail={proofMetrics.actions_completed?.detail || "Completed inside the evidence window"} state={proofMetrics.actions_completed?.state} />
          <Metric icon={Clock3} label={proofMetrics.time_returned?.label || "Documented time returned"} value={`${Math.round(proofMetrics.time_returned?.value ?? metrics.documented_minutes_saved ?? 0)}m`} detail={proofMetrics.time_returned?.detail || "Only retained execution records"} tone="violet" state={proofMetrics.time_returned?.state} />
          <Metric icon={BadgeDollarSign} label={proofMetrics.revenue_identified?.label || "Revenue identified"} value={`$${Number(proofMetrics.revenue_identified?.value ?? metrics.revenue_found ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} detail={proofMetrics.revenue_identified?.detail || "Requires finance review"} tone="emerald" state={proofMetrics.revenue_identified?.state || "review_required"} />
          <Metric icon={ShieldCheck} label="Self-healing score" value={`${metrics.self_healing_score || 0}%`} detail={`${metrics.self_healing_healed_30d || 0}/${metrics.self_healing_detected_30d || 0} healed in 30 days`} tone="emerald" />
          <Metric icon={Gauge} label={proofMetrics.tickets_prevented?.label || "Tickets prevented"} value={proofMetrics.tickets_prevented?.value ?? "—"} detail={proofMetrics.tickets_prevented?.detail || "Causal baseline required"} tone="amber" state={proofMetrics.tickets_prevented?.state || "not_measured"} />
        </div>

        {valueProof.truth_standard && <p className="mt-2 text-[9px] leading-relaxed text-zinc-600">{valueProof.truth_standard}</p>}

        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          <div className="rounded-xl border border-white/[0.065] bg-black/15 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-emerald-300/80">Already handled</p>
                <p className="mt-0.5 text-xs font-semibold text-zinc-200">Work completed from retained evidence</p>
              </div>
              <Badge variant="outline" className="border-emerald-300/15 bg-emerald-400/[0.04] text-[9px] text-emerald-200">{completed.length}</Badge>
            </div>
            <div className="mt-3 space-y-1.5">
              {completed.map(item => (
                <button key={item.id} type="button" onClick={() => navigate(item.route)} className="flex w-full items-center gap-2.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2 text-left transition hover:border-emerald-300/15 hover:bg-emerald-400/[0.035]">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] font-medium text-zinc-200">{item.label}</span>
                    <span className="block truncate text-[9px] text-zinc-500">{item.detail}</span>
                  </span>
                  <span className="text-xs font-semibold text-emerald-200">{item.value}</span>
                </button>
              ))}
              {!completed.length && <EmptyState title="No overnight automation claims" detail="Nexus will only show actions backed by completed execution records." />}
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.065] bg-black/15 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-amber-300/80">Your decisions</p>
                <p className="mt-0.5 text-xs font-semibold text-zinc-200">Protected work awaiting approval</p>
              </div>
              <Badge variant="outline" className="border-amber-300/15 bg-amber-400/[0.04] text-[9px] text-amber-200">{metrics.pending_approvals || 0}</Badge>
            </div>
            <div className="mt-3 space-y-1.5">
              {approvals.map(item => (
                <button key={`${item.source}-${item.id}`} type="button" onClick={() => navigate(item.route)} className="flex w-full items-center gap-2.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2 text-left transition hover:border-amber-300/15 hover:bg-amber-400/[0.035]">
                  <Clock3 className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] font-medium text-zinc-200">{item.title}</span>
                    <span className="block truncate text-[9px] text-zinc-500">{item.source} · {item.detail}</span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-zinc-600" />
                </button>
              ))}
              {!approvals.length && <EmptyState title="No decision is waiting" detail="Protected changes remain paused until a matching approval is required." />}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-cyan-300/80">Correlated intelligence</p>
              <h3 className="mt-0.5 text-sm font-semibold text-zinc-100">Connected evidence across client operations</h3>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(data.outcome_counts || {}).map(([key, value]) => {
                const outcome = OUTCOMES[key];
                return outcome && value ? <Badge key={key} variant="outline" className={outcome.className}>{value} {outcome.label.toLowerCase()}</Badge> : null;
              })}
            </div>
          </div>
          <div className="mt-3 grid gap-2 xl:grid-cols-2">
            {insights.map(insight => (
              <article key={insight.id} className="rounded-xl border border-white/[0.065] bg-black/15 p-3" data-testid={`brain-insight-${insight.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-violet-300/80">{insight.client_name}</p>
                    <h4 className="mt-1 text-xs font-semibold text-zinc-100">{insight.title}</h4>
                  </div>
                  <span className="shrink-0 text-right">
                    <span className="block text-lg font-semibold leading-none text-cyan-200">{insight.confidence}%</span>
                    <span className="mt-1 block text-[8px] uppercase tracking-[0.12em] text-zinc-600">confidence</span>
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-300" style={{ width: `${insight.confidence}%` }} />
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-400">{insight.summary}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(insight.evidence || []).map(item => (
                    <span key={item.label} className="rounded-md border border-white/[0.06] bg-white/[0.025] px-1.5 py-1 text-[9px] text-zinc-400">
                      {item.label} <strong className="ml-1 text-zinc-200">{item.value}</strong>
                    </span>
                  ))}
                </div>
                <div className="mt-2 rounded-lg border border-cyan-300/10 bg-cyan-400/[0.025] px-2.5 py-2">
                  <div className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-cyan-300" />
                    <p className="text-[10px] leading-relaxed text-zinc-300">{insight.recommendation}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1">
                    {(insight.outcomes || []).map(key => {
                      const outcome = OUTCOMES[key];
                      return outcome ? <Badge key={key} variant="outline" className={`text-[8px] ${outcome.className}`}>{outcome.label}</Badge> : null;
                    })}
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[9px] text-cyan-200" onClick={() => navigate(insight.route)}>
                    Review evidence <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </div>
                <p className="mt-1 text-[8px] text-zinc-600">Confidence basis: {insight.confidence_basis}</p>
              </article>
            ))}
            {!insights.length && (
              <div className="xl:col-span-2">
                <EmptyState title="No multi-signal correlation found" detail="Current records do not support combining separate alerts into one client insight." />
              </div>
            )}
          </div>
        </div>

        {!!activity.length && (
          <details className="group mt-4 rounded-xl border border-white/[0.06] bg-black/10">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
              <span className="flex items-center gap-2 text-[10px] font-medium text-zinc-300"><Activity className="h-3.5 w-3.5 text-cyan-300" />Universal activity · {activity.length} recent platform events</span>
              <ChevronDown className="h-3.5 w-3.5 text-zinc-600 transition group-open:rotate-180" />
            </summary>
            <div className="grid gap-1.5 border-t border-white/[0.05] p-3 md:grid-cols-2">
              {activity.map(event => (
                <div key={event.id} className="flex items-center gap-2 rounded-lg border border-white/[0.045] bg-white/[0.018] px-2.5 py-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] text-zinc-300">{event.label}</span>
                    <span className="block truncate text-[8px] text-zinc-600">{event.source} · {event.actor}</span>
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}

        <p className="mt-3 text-[9px] leading-relaxed text-zinc-600">{data.evidence_note}</p>
      </div>
    </section>
  );
}
