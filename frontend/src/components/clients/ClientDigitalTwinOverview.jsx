import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import ClientActivityFeed from "./ClientActivityFeed";

export default function ClientDigitalTwinOverview({ client, activity, healthDetail, onNavigate }) {
  const integrations = client.integrations || {};
  const nextAction = client.overdue_count > 0
    ? {
        eyebrow: "Commercial exception",
        title: `Reconcile $${(client.overdue_amount || 0).toLocaleString()} overdue`,
        body: "Review the affected invoices, record correspondence, and keep the collection trail attributable.",
        action: "Open billing",
        tab: "billing",
        tone: "rose",
      }
    : client.open_tickets > 10
      ? {
          eyebrow: "Service pressure",
          title: `${client.open_tickets} open tickets need review`,
          body: "Inspect repeat demand, ownership, SLA exposure, and whether a coordinated response is required.",
          action: "Review service work",
          tab: "tickets",
          tone: "amber",
        }
      : client.health_score < 70
        ? {
            eyebrow: "Health intervention",
            title: `Restore the client health score from ${client.health_score}`,
            body: "Use the evidence breakdown to identify the weakest operational relationship before taking action.",
            action: "Open security posture",
            tab: "security",
            tone: "amber",
          }
        : !integrations.rmm || !integrations.m365 || !integrations.acronis
          ? {
              eyebrow: "Coverage gap",
              title: "Complete the client service map",
              body: "One or more core management, Microsoft, or backup relationships are not yet linked to this account.",
              action: "Review integrations",
              tab: "integrations",
              tone: "cyan",
            }
          : {
              eyebrow: "Account opportunity",
              title: "Prepare the next client review",
              body: "The account is stable. Review outcomes, renewal readiness, and the next evidence-backed improvement.",
              action: "Open growth studio",
              tab: "studio",
              tone: "emerald",
            };

  const toneClasses = {
    rose: "border-rose-500/25 from-rose-500/[0.11]",
    amber: "border-amber-500/25 from-amber-500/[0.11]",
    cyan: "border-cyan-500/25 from-cyan-500/[0.11]",
    emerald: "border-emerald-500/25 from-emerald-500/[0.11]",
  };

  const relationships = [
    { label: "People", value: client.contact_count || 0, detail: "contacts", healthy: (client.contact_count || 0) > 0, tab: "contacts" },
    { label: "Managed estate", value: client.asset_count || 0, detail: `${client.assets_online || 0} online`, healthy: (client.asset_count || 0) > 0, tab: "assets" },
    { label: "Agreements", value: client.active_contracts || 0, detail: "active", healthy: (client.active_contracts || 0) > 0, tab: "subscriptions" },
    { label: "Microsoft 365", value: integrations.m365 ? "Linked" : "Missing", detail: "tenant relationship", healthy: !!integrations.m365, tab: "cipp" },
    { label: "Voice", value: integrations.yeastar ? "Linked" : "Missing", detail: "PBX relationship", healthy: !!integrations.yeastar, tab: "integrations" },
    { label: "Backups", value: integrations.acronis ? "Linked" : "Missing", detail: "protection source", healthy: !!integrations.acronis, tab: "integrations" },
  ];

  const breakdown = healthDetail?.breakdown;
  const dimensions = breakdown ? [
    { key: "tickets", label: "Tickets", max: 30 },
    { key: "sla", label: "SLA", max: 20 },
    { key: "devices", label: "Devices", max: breakdown.m365_hygiene != null ? 15 : 20 },
    { key: "payments", label: "Payments", max: 20 },
    { key: "contracts", label: "Contracts", max: breakdown.m365_hygiene != null ? 5 : 10 },
    ...(breakdown.m365_hygiene != null ? [{ key: "m365_hygiene", label: "Microsoft 365", max: 10 }] : []),
  ] : [];

  return (
    <div className="space-y-4" data-testid="client-digital-twin-overview">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <section className={`rounded-2xl border bg-gradient-to-br ${toneClasses[nextAction.tone]} to-card/45 p-5 shadow-sm`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-primary">{nextAction.eyebrow}</p>
              <h3 className="mt-2 text-lg font-semibold tracking-tight text-foreground">{nextAction.title}</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{nextAction.body}</p>
            </div>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Sparkles className="h-4.5 w-4.5" />
            </span>
          </div>
          <Button type="button" size="sm" className="mt-5 gap-1.5" onClick={() => onNavigate(nextAction.tab)} data-testid="client-next-best-action">
            {nextAction.action}<ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </section>

        <section className="rounded-2xl border border-border/70 bg-card/35 p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-primary">Relationship coverage</p>
              <h3 className="mt-1 text-base font-semibold text-foreground">Client digital twin</h3>
            </div>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><CheckCircle2 className="h-3 w-3 text-emerald-400" />Live Nexus relationships</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
            {relationships.map((relationship) => (
              <button
                key={relationship.label}
                type="button"
                onClick={() => onNavigate(relationship.tab)}
                className="group rounded-xl border border-border/70 bg-background/35 p-3 text-left transition hover:border-primary/25 hover:bg-primary/[0.05]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground">{relationship.label}</span>
                  <span className={`h-1.5 w-1.5 rounded-full ${relationship.healthy ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]" : "bg-amber-400"}`} />
                </div>
                <p className={`mt-2 text-sm font-semibold ${relationship.healthy ? "text-foreground" : "text-amber-300"}`}>{relationship.value}</p>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{relationship.detail}</p>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-border/70 bg-card/35 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-primary">Evidence-backed health</p>
            <p className="mt-1 text-sm text-muted-foreground">A transparent score derived from operational records, never an unexplained estimate.</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/45 px-3 py-2">
            <span className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground">Current score</span>
            <span className="font-mono text-sm font-semibold text-foreground">{healthDetail?.health_score ?? client.health_score ?? "—"}/100</span>
          </div>
        </div>
        {dimensions.length ? (
          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {dimensions.map(({ key, label, max }) => {
              const value = breakdown[key] ?? 0;
              const percentage = Math.min(100, (value / max) * 100);
              const color = percentage >= 85 ? "bg-emerald-400" : percentage >= 60 ? "bg-amber-400" : "bg-rose-400";
              return (
                <div key={key} data-testid={`health-breakdown-${key}`}>
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
                    <span className="font-mono text-foreground">{value}/{max}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${percentage}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Health evidence is still being assembled for this account.</div>
        )}
      </section>

      <ClientActivityFeed
        activity={activity}
        limit={10}
        compact
        title="Operational timeline"
        description="The latest attributable tickets, correspondence, billing, asset, change, and audit events for this client."
      />
    </div>
  );
}
