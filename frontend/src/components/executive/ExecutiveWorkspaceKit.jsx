/**
 * Presentation kit for the Executive workspace (CEO Mode).
 *
 * Every component here is presentation-only. Figures, levels and states come
 * from `GET /api/executive/overview` and are labelled through
 * `@/lib/executiveBriefing`, so an evidence gap can never be rendered as a
 * healthy zero by a component that decided to guess.
 *
 * The kit is deliberately one module: these surfaces share the same "owner
 * briefing" visual language (quiet borders, tabular numbers, a single accent
 * per card) and are never used outside the executive cockpit.
 */

import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  Command,
  Flag,
  Info,
  Minus,
  Percent,
  PieChart,
  Search,
  Star,
  Target,
  TrendingUp,
  WalletCards,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  agingTone,
  concentrationLabel,
  concentrationTone,
  groupSearchResults,
  mrrTargetBarPct,
  mrrTargetGrowth,
  mrrTargetStatus,
  qualityTone,
  renewalLabel,
  renewalTone,
  trendBars,
  trendDelta,
} from "@/lib/executiveBriefing";

const money = (value, digits = 0) => (
  value == null
    ? "Not assessed"
    : new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
      maximumFractionDigits: digits,
    }).format(Number(value) || 0)
);

const TONE_ACCENT = {
  emerald: "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300",
  cyan: "border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-700 dark:text-cyan-300",
  sky: "border-sky-500/25 bg-sky-500/[0.06] text-sky-700 dark:text-sky-300",
  violet: "border-violet-500/25 bg-violet-500/[0.06] text-violet-700 dark:text-violet-300",
  amber: "border-amber-500/25 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300",
  orange: "border-orange-500/25 bg-orange-500/[0.06] text-orange-700 dark:text-orange-300",
  rose: "border-rose-500/25 bg-rose-500/[0.06] text-rose-700 dark:text-rose-300",
  zinc: "border-border bg-muted/40 text-muted-foreground",
};

const TONE_BAR = {
  emerald: "bg-emerald-500",
  cyan: "bg-cyan-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  rose: "bg-rose-500",
  zinc: "bg-zinc-400",
};

/** A small, consistent "evidence state" statement used across the cockpit. */
export function EvidenceNote({ state, children, className = "" }) {
  const tone = qualityTone(state);
  const Icon = state === "verified" ? CheckCircle2 : state === "missing" ? CircleHelp : AlertTriangle;
  return (
    <p className={`flex gap-2 text-[11px] leading-5 text-muted-foreground ${className}`}>
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone === "emerald" ? "text-emerald-500" : tone === "amber" ? "text-amber-500" : "text-muted-foreground"}`} />
      <span>{children}</span>
    </p>
  );
}

function MethodLine({ children }) {
  if (!children) return null;
  return (
    <div className="mt-3 flex gap-2 rounded-lg border border-border/60 bg-muted/20 p-2.5 text-[11px] leading-5 text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/**
 * The owner's command rail: one search box over everything already loaded, and
 * one click to any executive source workspace.
 */
export function ExecutiveCommandRail({ index, workspaces = [], query, onQueryChange, onNavigate, className = "" }) {
  const groups = useMemo(
    () => (query ? groupSearchResults(index) : []),
    [index, query],
  );

  return (
    <Card className={className} data-testid="executive-command-rail">
      <CardContent className="p-4 md:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
          <div className="relative">
            <label htmlFor="executive-command-search" className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
              <Command className="h-3.5 w-3.5" />At your fingertips
            </label>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="executive-command-search"
                data-testid="executive-command-search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search clients, decisions, renewals, workspaces…"
                className="pl-9"
                autoComplete="off"
              />
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              Searches only the evidence already in this briefing: {index.length} indexed record{index.length === 1 ? "" : "s"} across clients, watchlist, owner decisions, renewals and workspaces.
            </p>

            {query && (
              <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-border/60 bg-background/60 p-2" data-testid="executive-command-results">
                {groups.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                    Nothing in this briefing matches “{query}”. Try a client name, a decision, or a workspace.
                  </p>
                ) : groups.map((group) => (
                  <div key={group.kind} className="mb-2 last:mb-0">
                    <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{group.label}</p>
                    {group.entries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => onNavigate(entry.route)}
                        className="group flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-muted/50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{entry.label}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{entry.detail}</span>
                        </span>
                        {entry.watched && <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                        <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
              <BriefcaseBusiness className="h-3.5 w-3.5" />Owner workspaces
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {workspaces.map((workspace) => {
                const Icon = workspace.icon || ArrowRight;
                return (
                  <button
                    key={workspace.route}
                    type="button"
                    onClick={() => onNavigate(workspace.route)}
                    className="group flex h-full flex-col justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3 text-left transition hover:-translate-y-px hover:border-violet-500/30 hover:bg-violet-500/[0.04]"
                    data-testid={`executive-workspace-${workspace.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    <span className="flex items-center gap-2 text-xs font-semibold">
                      <Icon className="h-3.5 w-3.5 text-violet-500" />
                      {workspace.label}
                    </span>
                    <span className="text-[11px] leading-4 text-muted-foreground">{workspace.detail}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Invoice ageing straight from the ledger the owner already bills from. */
export function ReceivablesAgingCard({ receivables, onOpen }) {
  if (!receivables) return null;
  const buckets = receivables.buckets || [];
  const hasLedger = receivables.state === "verified";
  return (
    <Card data-testid="executive-receivables-aging">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">Cash exposure</p>
            <CardTitle className="mt-1 flex items-center gap-2 text-base"><WalletCards className="h-4 w-4 text-cyan-500" />Receivables ageing</CardTitle>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase text-muted-foreground">Overdue</p>
            <p className={`text-lg font-semibold ${Number(receivables.overdue_total) > 0 ? "text-rose-500" : "text-emerald-500"}`}>{money(receivables.overdue_total)}</p>
            <p className="text-[10px] text-muted-foreground">of {money(receivables.outstanding_total)} open</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-4">
        {hasLedger ? buckets.map((bucket) => {
          const tone = agingTone(bucket);
          return (
            <div key={bucket.key} className="rounded-xl border border-border/60 p-3" data-testid={`executive-aging-${bucket.key}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-xs font-semibold">
                  <span className={`h-2 w-2 rounded-full ${TONE_BAR[tone] || TONE_BAR.zinc}`} />
                  {bucket.label}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{bucket.count} invoice{bucket.count === 1 ? "" : "s"}</span>
                  <span className="text-sm font-semibold tabular-nums">{money(bucket.total)}</span>
                </div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${TONE_BAR[tone] || TONE_BAR.zinc}`} style={{ width: `${Math.min(Number(bucket.share_pct) || 0, 100)}%` }} />
              </div>
            </div>
          );
        }) : (
          <div className="flex flex-col items-center py-8 text-center">
            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
            <p className="mt-2 text-sm font-semibold">No open invoice balance is recorded</p>
            <p className="mt-1 text-xs text-muted-foreground">Ageing appears once invoices carry a balance and a due date.</p>
          </div>
        )}
        <MethodLine>{receivables.method}</MethodLine>
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => onOpen("/invoices")}>
          Open the invoice ledger<ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}

/** How much of the run rate rests on one relationship. */
export function RevenueConcentrationCard({ concentration, onOpen }) {
  if (!concentration) return null;
  const tone = concentrationTone(concentration.level);
  const top = concentration.top_client;
  return (
    <Card data-testid="executive-concentration">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-500">Relationship risk</p>
            <CardTitle className="mt-1 flex items-center gap-2 text-base"><PieChart className="h-4 w-4 text-rose-500" />Revenue concentration</CardTitle>
          </div>
          <Badge variant="outline" className={TONE_ACCENT[tone]}>{concentrationLabel(concentration.level)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {top ? (
          <>
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" title={top.name}>{top.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{money(top.mrr)} monthly</p>
              </div>
              <p className={`text-3xl font-semibold tabular-nums ${tone === "rose" ? "text-rose-500" : tone === "amber" ? "text-amber-500" : "text-emerald-500"}`}>{top.share_pct}%</p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Largest client is ${top.share_pct}% of recurring revenue`}>
              <div className={`h-full rounded-full ${TONE_BAR[tone]}`} style={{ width: `${Math.min(Number(top.share_pct) || 0, 100)}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Top three</p>
                <p className="mt-1 font-semibold tabular-nums">{concentration.top_three_share_pct}%</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Paying clients</p>
                <p className="mt-1 font-semibold tabular-nums">{concentration.client_count}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpen(`/clients?client=${top.client_id}`)}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80 transition hover:text-foreground"
            >
              Review this account<ArrowRight className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <EvidenceNote state={concentration.state}>{concentration.detail}</EvidenceNote>
        )}
        <MethodLine>{concentration.method}</MethodLine>
      </CardContent>
    </Card>
  );
}

/** Monthly invoiced and collected movement, with gaps drawn as gaps. */
export function RevenueTrendCard({ trend, onOpen }) {
  if (!trend) return null;
  const bars = trendBars(trend);
  const delta = trendDelta(trend);
  const DeltaIcon = !delta ? Minus : delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  const deltaTone = !delta || delta.direction === "flat"
    ? "text-muted-foreground"
    : delta.direction === "up" ? "text-emerald-500" : "text-rose-500";
  return (
    <Card data-testid="executive-revenue-trend">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-300">Billing movement</p>
            <CardTitle className="mt-1 flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4 text-emerald-500" />Invoiced vs collected</CardTitle>
          </div>
          {delta ? (
            <div className={`flex items-center gap-1.5 text-sm font-semibold ${deltaTone}`}>
              <DeltaIcon className="h-4 w-4" />
              {money(delta.change)}
              {delta.pct != null && <span className="text-xs font-medium text-muted-foreground">({delta.pct > 0 ? "+" : ""}{delta.pct}%)</span>}
            </div>
          ) : (
            <Badge variant="outline" className={TONE_ACCENT.zinc}>Needs two recorded months</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="flex items-end gap-3">
          {bars.map((month) => (
            <div key={month.key} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div className="flex h-28 w-full items-end justify-center gap-1">
                {month.recorded ? (
                  <>
                    <div className="w-1/3 rounded-t-md bg-emerald-500/70" style={{ height: `${Math.max(month.invoicedPct, 2)}%` }} title={`Invoiced ${money(month.invoiced)}`} />
                    <div className="w-1/3 rounded-t-md bg-cyan-500/70" style={{ height: `${Math.max(month.collectedPct, 2)}%` }} title={`Collected ${money(month.collected)}`} />
                  </>
                ) : (
                  <div className="h-full w-full rounded-md border border-dashed border-border/70" title="No invoice records in this month" />
                )}
              </div>
              <p className="truncate text-[10px] text-muted-foreground" title={month.label}>{month.label}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500/70" />Invoiced</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan-500/70" />Collected</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-md border border-dashed border-border" />No records</span>
          <span className="ml-auto">{trend.recorded_months} month{trend.recorded_months === 1 ? "" : "s"} with records</span>
        </div>
        <MethodLine>{trend.method}</MethodLine>
        <Button variant="ghost" size="sm" className="-ml-2 mt-1" onClick={() => onOpen("/reports?tab=commercial")}>
          Open commercial reports<ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}

/** The next renewals the owner chooses to act on. */
export function RenewalCalendarCard({ renewals, onOpen }) {
  if (!renewals) return null;
  const rows = renewals.rows || [];
  return (
    <Card data-testid="executive-renewals">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-300">Renewal rhythm</p>
            <CardTitle className="mt-1 flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4 text-amber-500" />Next renewals</CardTitle>
          </div>
          <Badge variant="outline">
            {rows.length} in {renewals.window_days} days · {money(renewals.total_value)}/mo
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-4">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
            <p className="mt-2 text-sm font-semibold">No contract records an end date in this window</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">Contracts without an end date are not assumed to be evergreen; add the date where it is known.</p>
          </div>
        ) : rows.map((row) => {
          const tone = renewalTone(row.urgency);
          return (
            <button
              key={`${row.contract_id}-${row.end_date}`}
              type="button"
              onClick={() => onOpen(row.route)}
              className="group flex w-full items-center gap-3 rounded-xl border border-border/60 bg-background/40 p-3 text-left transition hover:border-amber-500/30 hover:bg-amber-500/[0.03]"
            >
              <div className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg border ${TONE_ACCENT[tone]}`}>
                <span className="text-sm font-semibold leading-none tabular-nums">{row.days_until}</span>
                <span className="text-[9px] uppercase leading-none">days</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.client_name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{row.end_date} · {money(row.value)}/mo</p>
              </div>
              <Badge variant="outline" className={TONE_ACCENT[tone]}>{renewalLabel(row.urgency)}</Badge>
            </button>
          );
        })}
        <MethodLine>{renewals.method}</MethodLine>
      </CardContent>
    </Card>
  );
}

/** The owner's personal watchlist, with inline note capture. */
export function OwnerWatchlistPanel({ watchlist, onOpen, onRemove, busyClientId }) {
  const rows = watchlist || [];
  return (
    <Card data-testid="executive-watchlist">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-300">Your attention</p>
            <CardTitle className="mt-1 flex items-center gap-2 text-base"><Star className="h-4 w-4 text-amber-500" />Owner watchlist</CardTitle>
          </div>
          <Badge variant="outline">{rows.length} watched</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-4">
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
            Pin an account from the portfolio below to keep it in view. The watchlist is personal to you, grants no access, and never changes a client record.
          </p>
        ) : rows.map((row) => (
          <div key={row.client_id} className="flex items-start gap-2 rounded-xl border border-border/60 bg-background/40 p-3">
            <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
            <button type="button" onClick={() => onOpen(`/clients?client=${row.client_id}`)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-medium">{row.client_name}</p>
              {row.note ? <p className="mt-0.5 text-[11px] text-muted-foreground">{row.note}</p> : null}
            </button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground"
              disabled={busyClientId === row.client_id}
              onClick={() => onRemove(row)}
              data-testid={`executive-unwatch-${row.client_id}`}
            >
              Remove
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** The portfolio table, doubling as the watchlist control surface. */
export function ExecutivePortfolioTable({ portfolio, watchlist, onOpen, onToggleWatch, busyClientId, watchedOnly = false }) {
  const watched = useMemo(
    () => new Set((watchlist || []).map((row) => String(row.client_id))),
    [watchlist],
  );
  const rows = useMemo(() => {
    const list = Array.isArray(portfolio) ? portfolio : [];
    const filtered = watchedOnly ? list.filter((client) => watched.has(String(client.client_id))) : list;
    return [...filtered].sort((left, right) => {
      const leftWatch = watched.has(String(left.client_id)) ? 0 : 1;
      const rightWatch = watched.has(String(right.client_id)) ? 0 : 1;
      if (leftWatch !== rightWatch) return leftWatch - rightWatch;
      const leftHealth = left.health_score == null ? 101 : Number(left.health_score);
      const rightHealth = right.health_score == null ? 101 : Number(right.health_score);
      return leftHealth - rightHealth;
    });
  }, [portfolio, watched, watchedOnly]);

  return (
    <Card data-testid="executive-portfolio">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">Customer success</p>
            <CardTitle className="mt-1 text-base">{watchedOnly ? "Watched accounts" : "Portfolio resilience"}</CardTitle>
          </div>
          <Badge variant="outline">{rows.length} shown</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-muted-foreground">
            {watchedOnly ? "No account is on your watchlist yet." : "No client records are available in this tenant."}
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {rows.map((client) => {
              const isWatched = watched.has(String(client.client_id));
              return (
                <div key={client.client_id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-muted/25 sm:grid-cols-[auto_1fr_100px_100px_auto]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    disabled={busyClientId === client.client_id}
                    onClick={() => onToggleWatch(client, isWatched)}
                    aria-label={isWatched ? `Remove ${client.client_name} from the watchlist` : `Add ${client.client_name} to the watchlist`}
                    data-testid={`executive-watch-${client.client_id}`}
                  >
                    <Star className={`h-4 w-4 ${isWatched ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                  </Button>
                  <button type="button" onClick={() => onOpen(client.route)} className="min-w-0 text-left">
                    <p className="truncate text-sm font-medium">{client.client_name}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {client.evidence_coverage_pct ?? 0}% evidence coverage
                      {client.service_burden_share_pct != null ? ` · ${client.service_burden_share_pct}% of service burden` : ""}
                    </p>
                  </button>
                  <div className="hidden text-right sm:block">
                    <p className="text-[10px] uppercase text-muted-foreground">MRR</p>
                    <p className="text-sm font-semibold tabular-nums">{money(client.mrr)}</p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="text-[10px] uppercase text-muted-foreground">Health</p>
                    <p className={`text-sm font-semibold tabular-nums ${client.health_score == null ? "text-muted-foreground" : client.health_score < 50 ? "text-rose-500" : client.health_score < 70 ? "text-amber-500" : "text-emerald-500"}`}>
                      {client.health_score == null ? "Not assessed" : client.health_score}
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-xs text-muted-foreground">{client.tickets_30d} ticket{client.tickets_30d === 1 ? "" : "s"}</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GoalStat({ label, value, hint }) {
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * The recurring-revenue goal the owner recorded, the run rate's distance from it,
 * and the movement since the goal was recorded. The state, the percentage, the
 * pace and the starting line all come from the API: this card decides only how to
 * say them. With no goal recorded it states the absence and offers to record one
 * — it never shows 0% of a target nobody set, and it never measures growth from a
 * starting run rate nobody recorded.
 */
export function MrrTargetCard({ goal, onEdit, onClear, busy = false }) {
  if (!goal) return null;
  const status = mrrTargetStatus(goal.state);
  const recorded = goal.state !== "not_recorded";
  const lastRevision = (goal.revisions || [])[0];
  const growth = mrrTargetGrowth(goal);
  const GrowthIcon = growth?.direction === "down" ? ArrowDownRight : growth?.direction === "flat" ? Minus : ArrowUpRight;
  // A flat run rate is stated as unchanged, never as "growth of $0".
  const growthDelta = growth && growth.direction !== "flat"
    ? `${growth.direction === "down" ? "-" : "+"}${money(Math.abs(growth.growth))}`
      + (growth.pct == null ? "" : ` (${growth.direction === "down" ? "-" : "+"}${Math.abs(growth.pct)}%)`)
    : null;

  return (
    <Card data-testid="executive-mrr-target">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-300">Owner goal</p>
            <CardTitle className="mt-1 flex items-center gap-2 text-base"><Target className="h-4 w-4 text-amber-500" />Recurring revenue goal</CardTitle>
          </div>
          <Badge variant="outline" className={TONE_ACCENT[status.tone]} data-testid="executive-mrr-target-status">{status.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {recorded ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-3xl font-semibold tabular-nums" data-testid="executive-mrr-target-progress">{goal.progress_pct}%</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  of a {money(goal.target_mrr)} monthly goal{goal.target_month_label ? ` by ${goal.target_month_label}` : " with no target month"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase text-muted-foreground">Contract-backed MRR</p>
                <p className="text-sm font-semibold tabular-nums">{money(goal.current_mrr)}</p>
              </div>
            </div>
            <div
              className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`Contract-backed MRR is ${goal.progress_pct}% of the recorded ${money(goal.target_mrr)} goal`}
            >
              <div className={TONE_BAR[status.tone] || TONE_BAR.zinc} style={{ height: "100%", width: `${mrrTargetBarPct(goal)}%` }} />
            </div>
            {growth ? (
              <p
                className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground"
                data-testid="executive-mrr-target-growth"
              >
                <GrowthIcon
                  className={`h-3.5 w-3.5 ${growth.direction === "down" ? "text-rose-500" : growth.direction === "flat" ? "text-zinc-400" : "text-emerald-500"}`}
                />
                <span>Starting run rate</span>
                <span className="font-semibold tabular-nums text-foreground" data-testid="executive-mrr-target-starting">
                  {money(growth.starting)}
                </span>
                {growthDelta ? (
                  <>
                    <span aria-hidden="true">→</span>
                    <span className="font-semibold tabular-nums text-foreground">{money(goal.current_mrr)}</span>
                    <span className="font-semibold tabular-nums text-foreground">{growthDelta}</span>
                    <span>since the goal was recorded</span>
                  </>
                ) : (
                  <span>· unchanged since the goal was recorded</span>
                )}
              </p>
            ) : (
              <p className="mt-3 text-xs leading-5 text-muted-foreground" data-testid="executive-mrr-target-growth">
                No starting run rate was recorded with this goal, so growth since it was recorded is not stated. Clear it and record the goal
                again to capture today's run rate as its starting line.
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <GoalStat
                label={goal.state === "achieved" ? "Surplus" : "Gap to goal"}
                value={money(Math.abs(Number(goal.gap) || 0))}
                hint={goal.state === "achieved" ? "above the recorded goal" : "contract-backed MRR short"}
              />
              <GoalStat
                label="Months remaining"
                value={goal.months_remaining == null ? "Not stated" : Math.max(goal.months_remaining, 0)}
                hint={goal.target_month ? `to ${goal.target_month_label}` : "no target month recorded"}
              />
              <GoalStat
                label="Required step"
                value={goal.required_monthly_growth == null ? "Not stated" : `${money(goal.required_monthly_growth)}/mo`}
                hint={goal.required_growth_pct_per_month == null ? "an even monthly step, not a forecast" : `${goal.required_growth_pct_per_month}% of the current run rate`}
              />
              <GoalStat label="Recorded by" value={goal.recorded_by || "Not stated"} hint={goal.note || "no owner note"} />
            </div>
            <EvidenceNote
              state={goal.state === "in_progress" && goal.required_monthly_growth != null ? "verified" : goal.state === "overdue" ? "missing" : "partial"}
              className="mt-3"
            >
              {goal.state === "achieved"
                ? `The recorded goal is met. Contract-backed MRR is ${money(goal.current_mrr)} against the ${money(goal.target_mrr)} goal${goal.target_month_label ? ` set for ${goal.target_month_label}` : ""}.`
                : goal.state === "overdue"
                  ? `The goal month (${goal.target_month_label}) has passed with contract-backed MRR at ${money(goal.current_mrr)}. Nexus reports the miss rather than dropping the goal.`
                  : goal.required_monthly_growth != null
                    ? `${money(goal.gap)} to close in ${goal.months_remaining} month${goal.months_remaining === 1 ? "" : "s"}: an arithmetic step of ${money(goal.required_monthly_growth)} per month. It is not a forecast that the step will happen.`
                    : goal.months_remaining === 0
                      ? `The goal month has begun, so no whole months remain to pace the ${money(goal.gap)} gap into.`
                      : "No target month is recorded, so Nexus states the gap without inventing a pace to close it."
              }
            </EvidenceNote>
            {lastRevision ? (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Flag className="h-3 w-3 shrink-0" />
                {goal.revisions.length} earlier goal{goal.revisions.length === 1 ? "" : "s"} retained; most recently {money(lastRevision.target_mrr)}.
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col items-center py-6 text-center" data-testid="executive-mrr-target-empty">
            <Target className="h-7 w-7 text-amber-500" />
            <p className="mt-2 text-sm font-semibold">No revenue goal is recorded</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              Nexus will not assume one. Record the monthly recurring revenue you are steering toward and the cockpit measures
              this run rate against it, using the same contract-backed figure it already reports.
            </p>
          </div>
        )}
        <MethodLine>{goal.method}</MethodLine>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onEdit} data-testid="executive-mrr-target-update">
            <Target className="mr-1.5 h-3.5 w-3.5" />{recorded ? "Update goal" : "Record a goal"}
          </Button>
          {recorded && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onClear}
              data-testid="executive-mrr-target-clear"
            >
              Clear goal
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Shortcut for the "concentration vs contribution" pair on the cockpit floor. */
export function MarginReadout({ summary }) {
  const assessed = summary?.service_contribution != null;
  return (
    <div className="rounded-2xl border border-border/60 bg-background/50 p-4" data-testid="executive-margin-readout">
      <p className="flex items-center gap-2 text-xs font-semibold"><Percent className="h-3.5 w-3.5 text-cyan-500" />Contribution margin</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">
        {assessed ? `${summary.contribution_margin_pct}%` : "Not assessed"}
      </p>
      <EvidenceNote state={assessed ? "verified" : "missing"} className="mt-2">
        {assessed
          ? `Recorded direct costs of ${money(summary.recorded_direct_cost)} against contract-backed MRR.`
          : "Direct cost records are required before contribution can be stated. Nexus will not estimate it."}
      </EvidenceNote>
    </div>
  );
}
