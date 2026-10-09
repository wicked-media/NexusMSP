import {
  ArrowRight,
  CircleDollarSign,
  Clock3,
  Flame,
  Radar,
  Sparkles,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import InitialsAvatar from "./InitialsAvatar";
import { money, PIPELINE_STAGES, STATUS_CONFIG, timeAgo } from "./leadHelpers";

const NEXT_ACTION = {
  new: "Make first contact",
  contacted: "Confirm fit and book discovery",
  qualified: "Shape the recommended solution",
  proposal: "Review the proposal and blockers",
  negotiation: "Resolve the commercial blocker",
  won: "Prepare the client hand-off",
};

function ageInDays(lead) {
  const timestamp = lead.last_activity_at || lead.updated_at || lead.created_at;
  if (!timestamp) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - new Date(timestamp).getTime()) / 86400000);
}

export default function LeadStudioCommandDeck({ leads = [], scores = {}, summary, onOpen, onShowDirectory, onShowInsights }) {
  const active = leads.filter((lead) => !["won", "lost"].includes(lead.status));
  const stale = active.filter((lead) => ageInDays(lead) >= 14);
  const unassigned = active.filter((lead) => !lead.assigned_to && !lead.assigned_to_name);
  const withoutValue = active.filter((lead) => !Number(lead.estimated_value));
  const assignedCoverage = active.length
    ? Math.round(((active.length - unassigned.length) / active.length) * 100)
    : 100;

  const priorityLead = [...active].sort((left, right) => {
    const scoreDelta = (scores[right.id]?.overall || 0) - (scores[left.id]?.overall || 0);
    return scoreDelta || ageInDays(right) - ageInDays(left);
  })[0];

  const stageCounts = PIPELINE_STAGES.map((stage) => ({
    stage,
    count: leads.filter((lead) => lead.status === stage).length,
  }));
  const totalStageRecords = Math.max(1, stageCounts.reduce((total, item) => total + item.count, 0));

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-emerald-400/20 bg-[radial-gradient(circle_at_12%_0%,rgba(16,185,129,0.12),transparent_34%),linear-gradient(145deg,rgba(17,24,24,0.96),rgba(9,11,15,0.98))] shadow-[0_24px_70px_rgba(0,0,0,0.24)]"
      data-testid="lead-command-deck"
    >
      <div className="pointer-events-none absolute inset-x-16 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/70 to-transparent" />
      <div className="grid xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.55fr)]">
        <div className="space-y-5 p-5 lg:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-emerald-300" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300">Revenue command</p>
                <Badge variant="outline" className="border-emerald-400/25 bg-emerald-400/[0.07] text-[9px] uppercase tracking-[0.16em] text-emerald-200">
                  Live
                </Badge>
              </div>
              <h2 className="mt-2 text-lg font-semibold tracking-tight text-zinc-50">Pipeline pulse</h2>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-400">
                A single view of opportunity value, ownership coverage, and the next move most likely to keep revenue progressing.
              </p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 border-emerald-400/20 bg-emerald-400/[0.05]" onClick={onShowInsights}>
              Open forecast <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-white/[0.08] bg-black/20 lg:grid-cols-4">
            <MetricButton
              icon={UsersRound}
              label="Active opportunities"
              value={summary.open}
              testId="stat-open"
              onClick={() => onShowDirectory({ pipelineOnly: true })}
            />
            <MetricButton
              icon={CircleDollarSign}
              label="Pipeline value"
              value={money(summary.pipelineValue)}
              testId="stat-pipeline-value"
              onClick={onShowInsights}
            />
            <MetricButton
              icon={Flame}
              label="High intent"
              value={summary.hot}
              testId="stat-hot"
              onClick={() => onShowDirectory({ hotOnly: true })}
            />
            <MetricButton
              icon={UserRoundCheck}
              label="Owner coverage"
              value={`${assignedCoverage}%`}
              testId="stat-total"
              onClick={() => onShowDirectory({ mineOnly: true })}
              last
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Stage distribution</p>
              <button type="button" className="text-[11px] text-emerald-300 transition-colors hover:text-emerald-200" onClick={() => onShowDirectory({})}>
                View all {leads.length} leads
              </button>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.05]" aria-label="Lead distribution across pipeline stages">
              {stageCounts.map(({ stage, count }) => (
                <span
                  key={stage}
                  className="motion-safe:transition-[width] motion-safe:duration-700"
                  title={`${STATUS_CONFIG[stage].label}: ${count}`}
                  style={{ width: `${(count / totalStageRecords) * 100}%`, backgroundColor: STATUS_CONFIG[stage].hex, minWidth: count ? 6 : 0 }}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {stageCounts.map(({ stage, count }) => (
                <button key={stage} type="button" className="inline-flex items-center gap-1.5 text-[10px] text-zinc-500 transition-colors hover:text-zinc-200" onClick={() => onShowDirectory({ status: stage })}>
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_CONFIG[stage].orb}`} />
                  {STATUS_CONFIG[stage].label} <span className="font-mono text-zinc-300">{count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <aside className="border-t border-white/[0.08] bg-black/15 p-5 xl:border-l xl:border-t-0 lg:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Next best move</p>
              <h3 className="mt-1 text-sm font-semibold text-zinc-100">Focus queue</h3>
            </div>
            <Sparkles className="h-4 w-4 text-violet-300" />
          </div>

          {priorityLead ? (
            <button
              type="button"
              className="group mt-4 w-full rounded-xl border border-violet-400/20 bg-violet-400/[0.06] p-3.5 text-left transition-all hover:border-violet-300/40 hover:bg-violet-400/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
              onClick={() => onOpen(priorityLead.id)}
              data-testid="lead-next-best-move"
            >
              <div className="flex items-start gap-3">
                <InitialsAvatar name={priorityLead.company_name} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-zinc-100">{priorityLead.company_name}</p>
                  <p className="mt-0.5 truncate text-[10px] text-zinc-500">{priorityLead.contact_name || "Contact not captured"}</p>
                </div>
                <span className="rounded-md border border-violet-400/25 bg-violet-400/10 px-1.5 py-0.5 font-mono text-[10px] text-violet-200">
                  {scores[priorityLead.id]?.overall || 0}
                </span>
              </div>
              <div className="mt-3 border-t border-white/[0.07] pt-3">
                <p className="text-xs font-medium text-violet-100">{NEXT_ACTION[priorityLead.status] || "Review this opportunity"}</p>
                <p className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <Clock3 className="h-3 w-3" /> Last touched {timeAgo(priorityLead.last_activity_at || priorityLead.updated_at)}
                </p>
              </div>
            </button>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] p-5 text-center">
              <UserRoundCheck className="mx-auto h-5 w-5 text-emerald-300" />
              <p className="mt-2 text-xs font-medium text-zinc-200">Pipeline is clear</p>
              <p className="mt-1 text-[10px] text-zinc-500">No active opportunity needs intervention.</p>
            </div>
          )}

          <div className="mt-3 space-y-1.5">
            <FocusRow label="Needs a touch" value={stale.length} detail="14+ days" onClick={() => onShowDirectory({ staleOnly: true })} tone="amber" />
            <FocusRow label="Needs an owner" value={unassigned.length} detail="Unassigned" onClick={() => onShowDirectory({ unassignedOnly: true })} tone="sky" />
            <FocusRow label="Needs a value" value={withoutValue.length} detail="Forecast gap" onClick={() => onShowDirectory({ withoutValueOnly: true })} tone="violet" />
          </div>
        </aside>
      </div>
    </section>
  );
}

function MetricButton({ icon: Icon, label, value, onClick, testId, last = false }) {
  return (
    <button
      type="button"
      className={`group min-w-0 p-3.5 text-left transition-colors hover:bg-white/[0.035] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${last ? "" : "border-r border-white/[0.07]"} border-b border-white/[0.07] lg:border-b-0`}
      onClick={onClick}
      data-testid={testId}
    >
      <div className="flex items-center gap-2 text-zinc-500">
        <Icon className="h-3.5 w-3.5 text-emerald-300/80" />
        <span className="truncate text-[9px] font-semibold uppercase tracking-[0.16em]">{label}</span>
      </div>
      <p className="mt-2 truncate text-xl font-semibold tracking-tight text-zinc-100">{value}</p>
    </button>
  );
}

function FocusRow({ label, value, detail, onClick, tone }) {
  const tones = {
    amber: "bg-amber-400",
    sky: "bg-sky-400",
    violet: "bg-violet-400",
  };
  return (
    <button type="button" className="flex w-full items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-white/[0.08] hover:bg-white/[0.035]" onClick={onClick}>
      <span className={`h-1.5 w-1.5 rounded-full ${tones[tone]}`} />
      <span className="min-w-0 flex-1 text-[11px] text-zinc-300">{label}</span>
      <span className="text-[10px] text-zinc-600">{detail}</span>
      <span className="min-w-5 text-right font-mono text-xs font-semibold text-zinc-100">{value}</span>
      <ArrowRight className="h-3 w-3 text-zinc-600" />
    </button>
  );
}
