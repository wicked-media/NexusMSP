import { useMemo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  Activity, CheckCircle2, Clock3, MessageSquare, MonitorCheck, Timer, UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildTicketPulse, formatCheckpointTime, formatPulseDuration } from "@/lib/ticketCasePulse";

const STATE_LABEL = {
  complete: "Complete",
  overdue: "Overdue",
  critical: "Critical",
  attention: "Watch",
  healthy: "On track",
  untracked: "No target",
};

function PulseMetric({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.13em] text-zinc-500">
        <Icon className="h-2.5 w-2.5" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-sm font-semibold tabular-nums text-zinc-100" title={value}>{value}</p>
    </div>
  );
}

/**
 * A compact operational strip for one ticket: the SLA runway, the next
 * accountable move, and the evidence already attached to the case. It uses
 * only persisted ticket/comment/time/device facts.
 */
export default function TicketServicePulse({
  ticket,
  notes = [],
  emails = [],
  timeEntries = [],
  deviceCount,
  onClaim,
  onReply,
  onOpenDevices,
}) {
  const pulse = useMemo(
    () => buildTicketPulse(ticket, { notes, emails, timeEntries, deviceCount }),
    [ticket, notes, emails, timeEntries, deviceCount],
  );

  const terminalLabel = String(ticket?.status || "").toLowerCase() === "closed" ? "Closed" : "Resolved";
  const countdown = pulse.terminal
    ? terminalLabel
    : pulse.remainingMinutes == null
      ? "No target"
      : pulse.remainingMinutes < 0
        ? `${formatPulseDuration(pulse.remainingMinutes)} over`
        : `${formatPulseDuration(pulse.remainingMinutes)} left`;
  const countdownDetail = pulse.terminal
    ? "Resolution evidence retained"
    : pulse.due
      ? `Target ${format(pulse.due, "MMM d, HH:mm")}`
      : "No SLA target recorded";
  const targetLabel = pulse.due ? format(pulse.due, "MMM d, HH:mm") : "Not set";
  const createdLabel = pulse.created ? format(pulse.created, "MMM d, HH:mm") : "Not recorded";
  const lastTouch = pulse.lastTouch
    ? formatDistanceToNow(pulse.lastTouch, { addSuffix: true })
    : "No activity recorded";
  const next = pulse.nextMove;
  const action = next.action === "claim"
    ? onClaim
    : next.action === "reply"
      ? onReply
      : next.action === "devices"
        ? onOpenDevices
        : null;

  const actionTone = next.tone === "critical"
    ? "border-rose-300/35 bg-rose-400 text-rose-950 hover:bg-rose-300"
    : next.tone === "attention"
      ? "border-amber-300/30 bg-amber-300 text-amber-950 hover:bg-amber-200"
      : "border-cyan-300/30 bg-cyan-300 text-cyan-950 hover:bg-cyan-200";

  return (
    <section
      className="nx-case-pulse overflow-hidden rounded-2xl border border-white/[0.08]"
      data-tone={pulse.state}
      data-testid="ticket-service-pulse"
      aria-label="Ticket service pulse"
    >
      <div className="grid divide-y divide-white/[0.07] lg:grid-cols-[1.05fr_1.25fr_0.9fr] lg:divide-x lg:divide-y-0">
        <div className="min-w-0 px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">SLA runway</p>
            <span className="nx-case-pulse__state inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]">
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
              {STATE_LABEL[pulse.state] || "Untracked"}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="nx-case-pulse__value font-mono text-[26px] font-semibold leading-none tracking-[-0.04em] text-zinc-50" data-testid="ticket-pulse-countdown">
              {countdown}
            </span>
            <span className="text-[11px] text-zinc-500">{countdownDetail}</span>
          </div>
          <div
            className="nx-case-pulse__meter mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
            role="progressbar"
            aria-label="SLA window elapsed"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pulse.progressPct ?? 0}
          >
            <span className="block h-full rounded-full" style={{ width: pulse.progressPct == null ? "0%" : `${Math.max(pulse.progressPct, 3)}%` }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[9px] text-zinc-600">
            <span className="truncate" title={createdLabel}>Opened {createdLabel}</span>
            <span className="truncate" title={targetLabel}>Target {targetLabel}</span>
          </div>
        </div>

        <div className="min-w-0 px-4 py-4 sm:px-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Next move</p>
          <div className="mt-1.5 flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-5 text-zinc-100" data-testid="ticket-next-move">{next.title}</p>
              <p className="mt-1 max-w-[52ch] text-[11px] leading-5 text-zinc-400">{next.detail}</p>
            </div>
            {action && (
              <Button
                type="button"
                size="sm"
                onClick={action}
                className={`h-8 shrink-0 rounded-lg border px-3 text-[11px] font-semibold shadow-[0_8px_20px_-12px_rgba(0,0,0,0.8)] ${actionTone}`}
                data-testid="ticket-next-move-action"
              >
                {next.action === "claim" ? <UserPlus className="mr-1.5 h-3.5 w-3.5" /> : next.action === "devices" ? <MonitorCheck className="mr-1.5 h-3.5 w-3.5" /> : <MessageSquare className="mr-1.5 h-3.5 w-3.5" />}
                {next.cta}
              </Button>
            )}
            {pulse.terminal && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2.5 py-1 text-[10px] font-medium text-emerald-200">
                <CheckCircle2 className="h-3 w-3" />Retained
              </span>
            )}
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-2 content-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
          <PulseMetric icon={MessageSquare} label="Customer updates" value={String(pulse.metrics.customerUpdates)} />
          <PulseMetric icon={Timer} label="Recorded effort" value={formatPulseDuration(pulse.metrics.recordedMinutes)} />
          <PulseMetric icon={MonitorCheck} label="Endpoints" value={String(pulse.metrics.deviceCount)} />
          <PulseMetric icon={Clock3} label="Last touch" value={lastTouch} />
          {!pulse.terminal && pulse.nextCheckpoint && (
            <p
              className="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/[0.06] pt-2 text-[10px] text-zinc-500"
              data-testid="ticket-pulse-next-checkpoint"
            >
              <Timer className={`h-3 w-3 shrink-0 ${pulse.checkpointMinutes != null && pulse.checkpointMinutes < 0 ? "text-rose-300" : "text-cyan-300"}`} aria-hidden="true" />
              <span>Next update promised</span>
              <span className="font-mono font-semibold text-zinc-300">{formatCheckpointTime(pulse.nextCheckpoint)}</span>
              {pulse.checkpointMinutes != null && (
                <span className={pulse.checkpointMinutes < 0 ? "text-rose-300" : "text-zinc-500"}>
                  · {pulse.checkpointMinutes < 0 ? `${formatPulseDuration(pulse.checkpointMinutes)} ago` : `in ${formatPulseDuration(pulse.checkpointMinutes)}`}
                </span>
              )}
            </p>
          )}
          <p className="col-span-2 flex items-center gap-1.5 border-t border-white/[0.06] pt-2 text-[10px] text-zinc-500">
            <Activity className="h-3 w-3 shrink-0" aria-hidden="true" />
            Evidence is read from this ticket, not inferred.
          </p>
        </div>
      </div>
    </section>
  );
}
