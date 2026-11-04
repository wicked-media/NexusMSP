import { useMemo } from "react";
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { buildClientAttentionQueue, CLIENT_ATTENTION_TONES } from "@/lib/clientPortfolioAttention";

const readableCount = (value, singular, plural = `${singular}s`) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const count = Math.max(0, Math.round(numeric));
  return `${count} ${count === 1 ? singular : plural}`;
};

function ClientPortfolioAttentionPanel({
  attentionClients = [],
  onOpenClient,
  onCreateClient,
  maxItems = 5,
  className,
}) {
  const queue = useMemo(
    () => buildClientAttentionQueue(attentionClients, { limit: maxItems }),
    [attentionClients, maxItems],
  );
  const totalAttentionCount = Array.isArray(attentionClients) ? attentionClients.length : 0;
  const hiddenCount = Math.max(0, totalAttentionCount - queue.length);
  const primarySignal = queue[0]?.severity || "recommendation";
  const primaryTone = CLIENT_ATTENTION_TONES[primarySignal] || CLIENT_ATTENTION_TONES.recommendation;

  return (
    <Card
      signal={primarySignal}
      className={cn("overflow-hidden border-border/70 bg-[linear-gradient(135deg,hsl(var(--nx-surface-raised)/0.96),hsl(var(--nx-surface)/0.94))]", className)}
      data-testid="client-portfolio-attention-panel"
    >
      <CardHeader className="border-b border-border/60 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border", primaryTone.icon)}>
              {queue.length ? <AlertTriangle className="h-4.5 w-4.5" /> : <CheckCircle2 className="h-4.5 w-4.5" />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Portfolio queue</p>
                {queue.length > 0 && <Badge variant="outline" className={cn("h-5 px-1.5 text-[9px] uppercase tracking-[0.12em]", primaryTone.badge)}>{queue.length} to review</Badge>}
              </div>
              <CardTitle className="mt-1 text-base">{queue.length ? "Clients that need a clear next action" : "Your client portfolio is clear"}</CardTitle>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{queue.length ? "Ranked from current client evidence — open an account to resolve the work in context." : "No evidence-backed client risks are waiting in this view."}</p>
            </div>
          </div>
          {onCreateClient && <Button type="button" size="sm" onClick={onCreateClient} className="shrink-0" data-testid="create-client-from-attention"><Plus className="h-3.5 w-3.5" />New client</Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-3 sm:p-4">
        {queue.length > 0 ? queue.map((entry) => {
          const tone = CLIENT_ATTENTION_TONES[entry.severity] || CLIENT_ATTENTION_TONES.recommendation;
          const client = entry.client || {};
          const summary = [
            readableCount(client.open_tickets ?? client.openTickets, "open ticket"),
            readableCount(client.asset_count ?? client.assets ?? client.device_count, "managed asset"),
          ].filter(Boolean).join(" · ");

          return (
            <article
              key={client.id || client.name}
              className="group rounded-xl border border-border/70 bg-background/[0.42] p-3.5 transition-colors hover:border-primary/25 hover:bg-muted/20"
              data-testid={`client-portfolio-attention-${client.id || "unknown"}`}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/25 text-muted-foreground"><Building2 className="h-3.5 w-3.5" /></span>
                    <p className="truncate text-sm font-semibold text-foreground">{client.name || "Unnamed client"}</p>
                    <Badge variant="outline" className={cn("h-5 px-1.5 text-[9px] uppercase tracking-[0.1em]", tone.badge)}>{tone.label}</Badge>
                    {client.lifecycle && <span className="text-[10px] capitalize text-muted-foreground">{String(client.lifecycle).replaceAll("_", " ")}</span>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5" aria-label={`${client.name || "Client"} operational reasons`}>
                    {entry.reasons.slice(0, 3).map((reason) => (
                      <span key={reason.id} className="rounded-lg border border-border/65 bg-muted/20 px-2 py-1 text-[10px] leading-4 text-muted-foreground">
                        <strong className="font-semibold text-foreground">{reason.label}</strong><span className="mx-1 text-border">/</span>{reason.detail}
                      </span>
                    ))}
                  </div>
                  {summary && <p className="mt-2 text-[11px] text-muted-foreground">{summary}</p>}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-primary/25 bg-primary/[0.06] text-primary hover:bg-primary/[0.12]"
                  onClick={() => onOpenClient?.(client.id, client)}
                  disabled={!client.id || !onOpenClient}
                  data-testid={`open-attention-client-${client.id || "unknown"}`}
                >
                  Open client<ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </article>
          );
        }) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/[0.12] px-5 py-8 text-center">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            <p className="mt-2 text-sm font-medium text-foreground">Nothing needs triage here</p>
            <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">Nexus will place clients here only when current health, patch, service or coverage evidence needs an owner.</p>
          </div>
        )}
        {hiddenCount > 0 && <p className="px-1 pt-1 text-[11px] text-muted-foreground">Showing the top {queue.length} of {totalAttentionCount} clients in this queue.</p>}
      </CardContent>
    </Card>
  );
}

export default ClientPortfolioAttentionPanel;
