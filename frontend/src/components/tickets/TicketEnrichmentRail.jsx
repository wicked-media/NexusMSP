import { Card, CardContent } from "@/components/ui/card";

/**
 * Right-rail AI enrichment cards for the Ticket Detail view.
 * Shows: TTR Prediction, Blast Radius, Client Health.
 * Renders nothing if enrichment is missing/errored.
 */
export function TicketEnrichmentRail({ enrichment }) {
  if (!enrichment || enrichment.error) return null;

  const ttr = enrichment.ttr_prediction || {};
  const blast = enrichment.blast_radius || {};
  const ctx = enrichment.client_context || {};
  const ttrLabel = ttr.predicted_minutes >= 60
    ? `${Math.round(ttr.predicted_minutes / 60)}h ${ttr.predicted_minutes % 60}m`
    : `${ttr.predicted_minutes ?? 0}m`;
  const healthColor = ctx.health_score >= 80 ? "#10b981" : ctx.health_score >= 60 ? "#f97316" : "#ef4444";

  return (
    <>
      {/* TTR Prediction */}
      <Card data-testid="ttr-card">
        <CardContent className="pt-4 pb-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-2">Resolution Prediction</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-primary">{ttrLabel}</span>
            <span className="text-[10px] text-muted-foreground">estimated</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="h-1 flex-1 rounded-full bg-muted/50 overflow-hidden">
              <div className="h-full rounded-full bg-primary/60" style={{ width: `${(ttr.confidence || 0) * 100}%` }} />
            </div>
            <span className="text-[10px] text-muted-foreground">{Math.round((ttr.confidence || 0) * 100)}% conf.</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{ttr.based_on}</p>
        </CardContent>
      </Card>

      {/* Blast Radius */}
      {blast.affected_users > 0 && (
        <Card data-testid="blast-radius-card" className={blast.affected_users > 10 ? "pulse-warning" : ""}>
          <CardContent className="pt-4 pb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-2">Impact Blast Radius</span>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-orange-500/15 flex items-center justify-center">
                <span className="text-sm font-bold text-orange-400">{blast.affected_users}</span>
              </div>
              <div>
                <p className="text-sm font-medium">Users Affected</p>
                {blast.device_name && (
                  <p className="text-[10px] text-muted-foreground">{blast.device_name} ({blast.device_type})</p>
                )}
              </div>
            </div>
            {blast.affected_services?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {blast.affected_services.map((s, i) => (
                  <span key={`k-${i}`} className="px-1.5 py-0.5 rounded text-[10px] bg-orange-500/10 text-orange-400 border border-orange-500/20">{s}</span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Client Health */}
      <Card data-testid="client-context-card">
        <CardContent className="pt-4 pb-3 space-y-2.5">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Client Health</span>
          <div className="flex items-center gap-3">
            <div className="relative w-11 h-11">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="hsl(var(--muted))" strokeWidth="2.5" opacity="0.3" />
                <circle cx="18" cy="18" r="15.9" fill="none"
                  stroke={healthColor}
                  strokeWidth="2.5" strokeDasharray={`${ctx.health_score} ${100 - (ctx.health_score || 0)}`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">{ctx.health_score}</span>
            </div>
            <div>
              <p className="text-sm font-medium">{ctx.name}</p>
              <p className="text-[10px] text-muted-foreground capitalize">{ctx.contract_status} &middot; ${ctx.contract_value?.toLocaleString()}/mo</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <div className="flex justify-between"><span className="text-muted-foreground">Open Tickets</span><span className="font-medium">{ctx.open_tickets}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Lifetime</span><span className="font-medium">{ctx.total_tickets_lifetime}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Devices</span><span className="font-medium">{ctx.total_devices}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Offline</span><span className="font-medium text-red-400">{ctx.offline_devices}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">NPS</span><span className="font-medium">{ctx.nps_score}/10</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">CSAT</span><span className="font-medium">{ctx.avg_satisfaction}/5</span></div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

export default TicketEnrichmentRail;
