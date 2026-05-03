import { Card, CardContent } from "@/components/ui/card";

const STAGES = [
  { key: "open", label: "Open", color: "from-blue-500 to-blue-600", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30", icon: "1" },
  { key: "in_progress", label: "In Progress", color: "from-yellow-500 to-amber-500", bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/30", icon: "2" },
  { key: "on_hold", label: "On Hold", color: "from-orange-500 to-orange-600", bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/30", icon: "3" },
  { key: "resolved", label: "Resolved", color: "from-emerald-500 to-green-600", bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30", icon: "4" },
  { key: "closed", label: "Closed", color: "from-slate-500 to-slate-600", bg: "bg-slate-500/10", text: "text-slate-400", border: "border-slate-500/30", icon: "5" },
];

/**
 * 5-stage ticket progress visualization. Click a stage to advance.
 *
 * Props:
 *   status: current ticket status string (open / in_progress / on_hold / resolved / closed)
 *   onChange: (newStatus) => void — invoked when user clicks a stage
 */
export default function TicketProgressTracker({ status, onChange }) {
  const currentIdx = STAGES.findIndex((s) => s.key === status);
  const activeIdx = currentIdx >= 0 ? currentIdx : 0;
  const progressPercent = Math.round((activeIdx / (STAGES.length - 1)) * 100);

  return (
    <Card className="overflow-hidden" data-testid="ticket-progress-bar">
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ticket Progress</span>
          <span className="text-xs font-mono text-muted-foreground">{progressPercent}% complete</span>
        </div>
        {/* Bar */}
        <div className="h-2 rounded-full bg-muted/50 mb-4 overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${STAGES[activeIdx].color} transition-all duration-700 ease-out`}
            style={{ width: `${Math.max(5, progressPercent)}%` }}
          />
        </div>
        {/* Stage cards */}
        <div className="grid grid-cols-5 gap-2">
          {STAGES.map((stage, i) => {
            const isActive = i === activeIdx;
            const isPast = i < activeIdx;
            return (
              <button
                key={stage.key}
                onClick={() => onChange?.(stage.key)}
                className={`relative rounded-lg p-2.5 text-center transition-all duration-300 border ${
                  isActive
                    ? `${stage.bg} ${stage.border} ring-1 ring-offset-1 ring-offset-background ${stage.border} shadow-lg`
                    : isPast
                    ? "bg-emerald-500/5 border-emerald-500/20"
                    : "bg-muted/20 border-border/50 hover:bg-muted/40"
                }`}
                data-testid={`progress-stage-${stage.key}`}
              >
                <div className={`w-6 h-6 rounded-full mx-auto mb-1.5 flex items-center justify-center text-[10px] font-bold ${
                  isActive ? `bg-gradient-to-br ${stage.color} text-white shadow-md` : isPast ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                }`}>
                  {isPast ? (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : stage.icon}
                </div>
                <span className={`text-[10px] font-semibold block ${
                  isActive ? stage.text : isPast ? "text-emerald-400" : "text-muted-foreground/60"
                }`}>
                  {stage.label}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
