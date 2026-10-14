import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, ShieldAlert, UserRoundX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SIGNAL_STYLE = {
  sla_breach: {
    icon: ShieldAlert,
    accent: "text-rose-200",
    border: "border-rose-400/20 hover:border-rose-300/45",
    surface: "from-rose-400/[0.11] to-transparent",
    badge: "border-rose-300/20 bg-rose-400/[0.1] text-rose-100",
  },
  critical_high: {
    icon: AlertTriangle,
    accent: "text-orange-200",
    border: "border-orange-400/20 hover:border-orange-300/45",
    surface: "from-orange-400/[0.1] to-transparent",
    badge: "border-orange-300/20 bg-orange-400/[0.1] text-orange-100",
  },
  unassigned: {
    icon: UserRoundX,
    accent: "text-violet-200",
    border: "border-violet-400/20 hover:border-violet-300/45",
    surface: "from-violet-400/[0.1] to-transparent",
    badge: "border-violet-300/20 bg-violet-400/[0.1] text-violet-100",
  },
  no_response: {
    icon: Clock3,
    accent: "text-amber-200",
    border: "border-amber-400/20 hover:border-amber-300/45",
    surface: "from-amber-400/[0.1] to-transparent",
    badge: "border-amber-300/20 bg-amber-400/[0.1] text-amber-100",
  },
};

export default function TicketQueueRecovery({
  signals = [],
  activeAttention = "all",
  onFilterChange,
  onClear,
  onOpenTicket,
}) {
  const actionableSignals = signals.filter(signal => signal.count > 0);
  const nextTicket = actionableSignals[0]?.tickets?.[0];

  if (!actionableSignals.length) {
    return (
      <section className="rounded-xl border border-emerald-300/15 bg-[linear-gradient(115deg,rgba(16,185,129,0.09),rgba(34,211,238,0.035))] px-4 py-3 shadow-[0_12px_32px_rgba(0,0,0,0.1)]" data-testid="ticket-queue-recovery-empty" aria-label="Queue recovery">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-300/20 bg-emerald-400/[0.1] text-emerald-200"><CheckCircle2 className="h-4 w-4" /></div>
          <div>
            <p className="text-sm font-semibold text-zinc-100">Queue recovery is clear</p>
            <p className="mt-0.5 text-xs text-muted-foreground">No active ticket is breached, unassigned, high priority, or inactive for four hours.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-cyan-300/15 bg-[linear-gradient(115deg,rgba(34,211,238,0.09),rgba(99,102,241,0.06),rgba(0,0,0,0.1))] shadow-[0_12px_32px_rgba(0,0,0,0.12)]" data-testid="ticket-queue-recovery" aria-labelledby="ticket-queue-recovery-title">
      <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.85)]" />
            <p id="ticket-queue-recovery-title" className="text-sm font-semibold text-zinc-100">Needs attention</p>
            <Badge variant="outline" className="border-cyan-300/20 bg-cyan-400/[0.08] text-[9px] text-cyan-100">evidence-led</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose a focus or open the next priority ticket.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activeAttention !== "all" && <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-zinc-100" onClick={onClear} data-testid="ticket-recovery-clear">Clear recovery view</Button>}
          {nextTicket && <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => onOpenTicket?.(nextTicket)} data-testid="ticket-recovery-open-next">Open next <ArrowRight className="h-3.5 w-3.5" /></Button>}
        </div>
      </div>
      <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">
        {actionableSignals.map(signal => {
          const style = SIGNAL_STYLE[signal.attention] || SIGNAL_STYLE.no_response;
          const Icon = style.icon;
          const isActive = activeAttention === signal.attention;
          return (
            <button
              key={signal.attention}
              type="button"
              onClick={() => onFilterChange?.(signal.attention)}
              className={`group min-w-0 rounded-lg border bg-gradient-to-br ${style.surface} px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${style.border} ${isActive ? "ring-1 ring-cyan-300/50 bg-white/[0.045]" : ""}`}
              aria-pressed={isActive}
              data-testid={`ticket-recovery-${signal.attention}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-black/[0.16] ${style.accent}`}><Icon className="h-3.5 w-3.5" /></span>
                <Badge variant="outline" className={`h-5 min-w-5 justify-center px-1.5 text-[10px] ${style.badge}`}>{signal.count}</Badge>
              </div>
              <p className="mt-2 text-xs font-semibold text-zinc-100">{signal.label}</p>
              <span className={`mt-1 inline-flex items-center gap-1 text-[10px] font-medium opacity-80 transition-opacity group-hover:opacity-100 ${style.accent}`}>View queue <ArrowRight className="h-3 w-3" /></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
