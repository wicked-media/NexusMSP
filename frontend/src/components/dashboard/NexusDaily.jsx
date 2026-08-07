import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  Monitor,
  MonitorCog,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Ticket,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildNexusDailyBriefing } from "@/lib/nexusDaily";

const SECTION_ICONS = {
  operations: MonitorCog,
  finance: CircleDollarSign,
  security: ShieldCheck,
  customers: Users,
};

const SECTION_TONES = {
  healthy: {
    dot: "bg-emerald-500",
    icon: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    count: "text-emerald-700 dark:text-emerald-200",
  },
  warning: {
    dot: "bg-amber-500",
    icon: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    count: "text-amber-700 dark:text-amber-200",
  },
  critical: {
    dot: "bg-rose-500",
    icon: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    count: "text-rose-700 dark:text-rose-200",
  },
};

function DailySection({ section, navigate }) {
  const Icon = SECTION_ICONS[section.id] || BriefcaseBusiness;
  const tone = SECTION_TONES[section.tone] || SECTION_TONES.healthy;

  return (
    <button
      type="button"
      onClick={() => navigate(section.route)}
      className="group relative min-h-44 overflow-hidden border-t border-border/80 px-4 py-4 text-left transition hover:bg-muted/35 lg:border-l lg:border-t-0 first:lg:border-l-0"
      data-testid={`nexus-daily-${section.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl border ${tone.icon}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className={`text-2xl font-semibold tracking-tight ${tone.count}`}>{section.count}</span>
      </div>
      <div className="mt-5 flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot} ${section.tone === "critical" ? "animate-pulse" : ""}`} />
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground">{section.label}</h3>
      </div>
      <p className="mt-2 text-sm font-medium leading-snug text-foreground">{section.headline}</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{section.detail}</p>
      <span className="absolute bottom-3 right-3 flex items-center gap-1 text-[10px] font-medium text-primary opacity-0 transition group-hover:opacity-100">
        Open workspace <ArrowRight className="h-3 w-3" />
      </span>
    </button>
  );
}

export default function NexusDaily({
  missionControl,
  nexusBrain,
  user,
  navigate,
  onOpenCommand,
  onOpenDailyReview,
  onRefresh,
}) {
  if (!missionControl) return null;

  const briefing = buildNexusDailyBriefing({ missionControl, nexusBrain, user });
  const healthStyle = briefing.healthScore >= 90
    ? "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-200"
    : briefing.healthScore >= 75
      ? "border-cyan-500/25 bg-cyan-500/[0.08] text-cyan-700 dark:text-cyan-200"
      : briefing.healthScore >= 50
        ? "border-amber-500/25 bg-amber-500/[0.08] text-amber-700 dark:text-amber-200"
        : "border-rose-500/25 bg-rose-500/[0.08] text-rose-700 dark:text-rose-200";
  const generatedAt = missionControl.generated_at ? new Date(missionControl.generated_at) : new Date();
  const dateLabel = generatedAt.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = String(user?.name || missionControl.operator || "Operator").split(" ")[0];

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-[0_22px_70px_rgba(15,23,42,0.09)] dark:shadow-[0_26px_72px_rgba(0,0,0,0.26)]"
      data-testid="nexus-daily"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary/[0.08] to-transparent" />
      <div className="relative border-b border-border/80 px-5 py-4 md:px-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.25em] text-primary">MSP operating system · Nexus Daily</p>
              <h1 className="mt-0.5 whitespace-nowrap text-xl font-semibold tracking-tight text-foreground md:text-2xl">Nexus Mission Control</h1>
              <p className="mt-0.5 text-[10px] text-muted-foreground">One live briefing, one priority view, one place to act.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 xl:items-end">
            <div className="text-left xl:text-right">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground xl:justify-end">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />{dateLabel}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Generated from live, access-scoped records</p>
            </div>
            <div className="flex flex-wrap gap-1.5 xl:justify-end" aria-label="Mission Control shortcuts">
              <Button type="button" size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={onOpenCommand} data-testid="bridge-search-btn">
                <Search className="mr-1.5 h-3.5 w-3.5" />Search <kbd className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[8px]">Ctrl K</kbd>
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => navigate("/tickets")} data-testid="bridge-tickets-btn">
                <Ticket className="mr-1.5 h-3.5 w-3.5" />Tickets
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => navigate("/leads")} data-testid="bridge-leads-btn">
                <Users className="mr-1.5 h-3.5 w-3.5" />Leads
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => navigate("/devices")} data-testid="bridge-devices-btn">
                <Monitor className="mr-1.5 h-3.5 w-3.5" />Assets
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => navigate("/invoices")} data-testid="bridge-invoices-btn">
                <FileText className="mr-1.5 h-3.5 w-3.5" />Invoices
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => navigate("/purchase-orders")} data-testid="bridge-purchase-orders-btn">
                <ShoppingCart className="mr-1.5 h-3.5 w-3.5" />Purchase Orders
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={onRefresh} data-testid="bridge-refresh-btn">
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="relative grid gap-5 px-5 py-6 md:px-7 xl:grid-cols-[1.45fr_0.55fr] xl:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/20 bg-primary/[0.06] text-[9px] text-primary">
              {briefing.lens.label}
            </Badge>
            <span className="text-[10px] text-muted-foreground">{briefing.lens.summary}</span>
          </div>
          <h3 className="mt-4 max-w-4xl text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
            {greeting}, {firstName}.
          </h3>
          <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">{briefing.headline}</p>
        </div>
        <div className="flex items-center gap-4 rounded-2xl border border-border/70 bg-background/55 p-4">
          <span className={`flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border ${healthStyle}`}>
            <span className="text-2xl font-semibold leading-none">{briefing.healthScore}</span>
            <span className="mt-1 text-[8px] font-semibold uppercase tracking-[0.14em]">of 100</span>
          </span>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Operating health</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{briefing.healthLabel}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              {briefing.attentionCount ? `${briefing.attentionCount} connected signal${briefing.attentionCount === 1 ? "" : "s"} are affecting the score.` : "No material exception is reducing the score."}
            </p>
          </div>
        </div>
      </div>

      <div className="grid border-y border-border/80 sm:grid-cols-2 lg:grid-cols-4">
        {briefing.sections.map(section => <DailySection key={section.id} section={section} navigate={navigate} />)}
      </div>

      <div className="grid gap-4 px-5 py-5 md:px-7 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
            {briefing.focus?.severity === "healthy" ? <CheckCircle2 className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">Today&apos;s recommendation</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{briefing.focus?.title || "Review connected operations"}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {briefing.focus?.recommendation || "Review connected operations and plan the highest-value proactive work."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button type="button" variant="outline" className="h-9" onClick={onOpenDailyReview} data-testid="nexus-daily-sign-off">
            <ClipboardCheck className="mr-2 h-4 w-4" />Daily sign-off
          </Button>
          <Button type="button" className="h-9" onClick={() => navigate(briefing.focus?.route || "/clients")} data-testid="nexus-daily-start">
            Start recommendation <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>

      {briefing.evidenceNote && (
        <p className="border-t border-border/70 px-5 py-2.5 text-[9px] leading-relaxed text-muted-foreground md:px-7">
          {briefing.evidenceNote}
        </p>
      )}
    </section>
  );
}
