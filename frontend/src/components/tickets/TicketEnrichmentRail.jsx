import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

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
    <Card className="overflow-hidden border-violet-500/15 bg-[linear-gradient(145deg,rgba(139,92,246,0.07),rgba(17,19,24,0.82)_46%,rgba(34,211,238,0.04))]" data-testid="ticket-enrichment-rail">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-violet-400/20 bg-violet-400/[0.08]"><Sparkles className="h-3.5 w-3.5 text-violet-200" /></span>
          <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200">Nexus context</p><p className="text-[11px] text-muted-foreground">Signals that matter for this ticket</p></div>
        </div>

        <section className="rounded-lg border border-white/[0.07] bg-black/10 p-3" data-testid="ttr-card">
          <div className="flex items-baseline justify-between gap-2"><span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Expected resolution</span><span className="text-[10px] text-muted-foreground">{Math.round((ttr.confidence || 0) * 100)}% confidence</span></div>
          <div className="mt-1 flex items-baseline gap-2"><span className="text-xl font-semibold text-primary">{ttrLabel}</span><span className="text-[10px] text-muted-foreground">estimated</span></div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted/50"><div className="h-full rounded-full bg-primary/60" style={{ width: `${(ttr.confidence || 0) * 100}%` }} /></div>
          {ttr.based_on && <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{ttr.based_on}</p>}
        </section>

        {blast.affected_users > 0 && (
          <section className={`rounded-lg border border-orange-500/15 bg-orange-500/[0.045] p-3 ${blast.affected_users > 10 ? "pulse-warning" : ""}`} data-testid="blast-radius-card">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange-500/15 text-sm font-bold text-orange-300">{blast.affected_users}</span>
              <div className="min-w-0"><p className="text-xs font-medium">Users affected</p>{blast.device_name && <p className="truncate text-[10px] text-muted-foreground">{blast.device_name} · {blast.device_type}</p>}</div>
            </div>
            {blast.affected_services?.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{blast.affected_services.map((service, index) => <span key={`${service}-${index}`} className="rounded border border-orange-500/20 bg-orange-500/10 px-1.5 py-0.5 text-[10px] text-orange-300">{service}</span>)}</div>}
          </section>
        )}

        <section className="border-t border-white/[0.07] pt-3" data-testid="client-context-card">
          <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Client health</span><span className="text-[10px] text-muted-foreground">Live service context</span></div>
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
        </section>
      </CardContent>
    </Card>
  );
}

export default TicketEnrichmentRail;
