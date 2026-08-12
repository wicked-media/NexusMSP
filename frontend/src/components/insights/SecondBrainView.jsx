import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  BookOpenCheck,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleAlert,
  Database,
  FileSearch,
  History,
  Lightbulb,
  Link2,
  Loader2,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";

import HeroTile from "@/components/HeroTile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";


const PRIORITY = {
  high: "border-rose-500/30 bg-rose-500/[0.045] text-rose-300",
  medium: "border-amber-500/30 bg-amber-500/[0.045] text-amber-300",
  low: "border-sky-500/30 bg-sky-500/[0.045] text-sky-300",
};

const SOURCE = {
  ticket: { label: "Ticket", icon: CircleAlert, tone: "text-sky-300 bg-sky-500/10 border-sky-500/25" },
  runbook: { label: "Runbook", icon: BookOpenCheck, tone: "text-violet-300 bg-violet-500/10 border-violet-500/25" },
  knowledge: { label: "Knowledge", icon: FileSearch, tone: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25" },
  client: { label: "Client", icon: Network, tone: "text-cyan-300 bg-cyan-500/10 border-cyan-500/25" },
  audit: { label: "Audit", icon: History, tone: "text-amber-300 bg-amber-500/10 border-amber-500/25" },
  decision: { label: "Decision", icon: Check, tone: "text-rose-300 bg-rose-500/10 border-rose-500/25" },
};

function ConfidenceBadge({ confidence }) {
  const score = Number(confidence?.score || 0);
  const tone = score >= 80
    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
    : score >= 60
      ? "border-sky-500/25 bg-sky-500/10 text-sky-300"
      : "border-amber-500/25 bg-amber-500/10 text-amber-300";
  return (
    <Badge variant="outline" className={tone}>
      {confidence?.label || "Emerging"} · {score}% · {confidence?.evidence_count || 0} records
    </Badge>
  );
}

function EmptyState({ icon: Icon = Sparkles, title, body }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-muted/[0.12] px-5 py-10 text-center">
      <Icon className="mx-auto h-7 w-7 text-muted-foreground" />
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted-foreground">{body}</p>
    </div>
  );
}

function MemorySearch({ api }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const search = async (event) => {
    event?.preventDefault();
    if (query.trim().length < 2) return;
    setLoading(true);
    try {
      setResult(await api.post("/second-brain/search", { query: query.trim() }));
    } catch (error) {
      toast.error(error.response?.data?.detail || "Operational memory search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="overflow-hidden border-violet-500/25 bg-gradient-to-br from-violet-500/[0.07] via-card to-cyan-500/[0.04]" data-testid="second-brain-search">
      <CardContent className="p-0">
        <div className="border-b border-violet-500/15 px-5 py-5 md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">
                <BrainCircuit className="h-4 w-4" />Ask Nexus memory
              </div>
              <h2 className="mt-2 text-xl font-semibold">Find what the MSP already knows</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Search tickets, runbooks, knowledge, approved operational decisions, clients and audit evidence in one place. Results are direct records, not generated answers.
              </p>
            </div>
            <Badge variant="outline" className="w-fit border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Tenant private
            </Badge>
          </div>
          <form onSubmit={search} className="mt-5 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-11 border-violet-500/20 bg-background/70 pl-10"
                placeholder='Try "the broken printer from last week" or "when did we stop using Veeam?"'
                data-testid="second-brain-search-input"
              />
            </div>
            <Button type="submit" className="h-11 min-w-32" disabled={loading || query.trim().length < 2} data-testid="second-brain-search-button">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Search memory
            </Button>
          </form>
        </div>

        {result && (
          <div className="px-5 py-4 md:px-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{result.count} evidence result{result.count === 1 ? "" : "s"}</p>
                <p className="text-xs text-muted-foreground">{result.statement}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {(result.searched_sources || []).map((source) => (
                  <Badge key={source} variant="secondary" className="capitalize">{source}</Badge>
                ))}
              </div>
            </div>
            {result.results?.length ? (
              <div className="grid gap-2 lg:grid-cols-2" data-testid="second-brain-search-results">
                {result.results.map((item) => {
                  const source = SOURCE[item.source] || SOURCE.audit;
                  const Icon = source.icon;
                  return (
                    <Link
                      key={`${item.source}-${item.id}`}
                      to={item.route}
                      className="group rounded-xl border border-border/70 bg-background/60 p-3 transition hover:border-violet-500/35 hover:bg-violet-500/[0.035]"
                    >
                      <div className="flex items-start gap-3">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${source.tone}`}><Icon className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold">{item.title}</p>
                            <Badge variant="outline" className="shrink-0 text-[10px]">{source.label}</Badge>
                          </div>
                          {item.subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.subtitle}</p>}
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.excerpt}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {(item.matched_terms || []).map((term) => <Badge key={term} variant="secondary" className="text-[10px]">{term}</Badge>)}
                            <span className="ml-auto inline-flex items-center text-[11px] font-medium text-violet-300">Open evidence<ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={FileSearch} title="No direct evidence matched" body="Try a client name, ticket subject, device, category, technician or phrase from the original record. Nexus will not fabricate a result." />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecommendationCard({ item, onDecision }) {
  const decision = item.decision;
  return (
    <div className={`rounded-2xl border p-4 ${PRIORITY[item.priority] || PRIORITY.low}`} data-testid={`second-brain-recommendation-${item.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-background/45">
            <Lightbulb className="h-4 w-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">{item.title}</p>
              <Badge variant="outline" className="capitalize">{item.type.replace(/_/g, " ")}</Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.summary}</p>
          </div>
        </div>
        <ConfidenceBadge confidence={item.confidence} />
      </div>
      <div className="mt-3 rounded-xl border border-border/60 bg-background/45 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Why Nexus suggested this</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.why}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <Link to={item.route}>{item.action_label}<ChevronRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
        {!decision ? (
          <>
            <Button size="sm" variant="outline" onClick={() => onDecision(item, "accepted")}><Check className="mr-1.5 h-3.5 w-3.5" />Useful</Button>
            <Button size="sm" variant="ghost" onClick={() => onDecision(item, "snoozed")}><History className="mr-1.5 h-3.5 w-3.5" />Snooze</Button>
            <Button size="sm" variant="ghost" onClick={() => onDecision(item, "dismissed")}><X className="mr-1.5 h-3.5 w-3.5" />Dismiss</Button>
          </>
        ) : (
          <>
            <Badge className="capitalize" variant="secondary">{decision.status} by {decision.user_name || "technician"}</Badge>
            <Button size="sm" variant="ghost" onClick={() => onDecision(item, "reset")}>Reset review</Button>
          </>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">{item.evidence_ids?.length || 0} linked evidence records · no automatic action</span>
      </div>
    </div>
  );
}

function PatternsPanel({ signals }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Network className="h-4 w-4 text-cyan-300" />Patterns Nexus can explain</CardTitle>
        <p className="text-xs leading-5 text-muted-foreground">Repeated demand is grouped from matching ticket evidence. Nexus does not claim causation.</p>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {signals.length ? signals.slice(0, 6).map((signal) => (
          <details key={signal.id} className="group rounded-xl border border-border/70 bg-muted/[0.12] p-3">
            <summary className="cursor-pointer list-none">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{signal.finding}</p>
                    {signal.knowledge_gap && <Badge variant="outline" className="border-amber-500/25 bg-amber-500/10 text-amber-300">Knowledge gap</Badge>}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{signal.reason}</p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-90" />
              </div>
            </summary>
            <div className="mt-3 border-t border-border/60 pt-3">
              <div className="mb-2 flex flex-wrap gap-1.5">
                <ConfidenceBadge confidence={signal.confidence} />
                <Badge variant="secondary">{signal.client_count} client{signal.client_count === 1 ? "" : "s"}</Badge>
                <Badge variant="secondary">{signal.open_count} active</Badge>
                <Badge variant="secondary">{signal.resolved_count} resolved</Badge>
              </div>
              <div className="space-y-1">
                {(signal.evidence || []).map((evidence) => (
                  <Link key={evidence.ticket_id} to={evidence.route} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition hover:bg-muted/50">
                    <CircleAlert className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                    <span className="font-mono text-[10px] text-muted-foreground">{evidence.ticket_number}</span>
                    <span className="min-w-0 flex-1 truncate">{evidence.title}</span>
                    <span className="hidden text-muted-foreground sm:inline">{evidence.client_name}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </div>
          </details>
        )) : (
          <EmptyState title="No repeated pattern meets the evidence threshold" body="Nexus needs at least two matching ticket records before it surfaces a pattern. Keep categorisation and resolutions current." />
        )}
      </CardContent>
    </Card>
  );
}

function ExpertisePanel({ profiles }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><UserRoundCheck className="h-4 w-4 text-emerald-300" />Recorded team expertise</CardTitle>
        <p className="text-xs leading-5 text-muted-foreground">Outcome evidence for routing and knowledge capture. It is not a performance leaderboard.</p>
      </CardHeader>
      <CardContent>
        {profiles.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {profiles.slice(0, 9).map((profile) => (
              <div key={profile.id} className="rounded-2xl border border-border/70 bg-muted/[0.12] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{profile.name}</p>
                    <p className="mt-0.5 text-xs capitalize text-muted-foreground">Strongest recorded area: {profile.top_category}</p>
                  </div>
                  <span className="flex h-9 min-w-9 items-center justify-center rounded-xl bg-emerald-500/10 px-2 font-mono text-sm font-bold text-emerald-300">{profile.resolved_count}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {profile.categories.map((category) => <Badge key={category.name} variant="secondary" className="capitalize">{category.name} · {category.count}</Badge>)}
                </div>
                <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{profile.explanation}</p>
                <div className="mt-3 border-t border-border/50 pt-2">
                  {profile.recent_evidence.slice(0, 3).map((evidence) => (
                    <Link key={evidence.ticket_id} to={evidence.route} className="flex items-center gap-2 py-1 text-xs hover:text-primary">
                      <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{evidence.title}</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={UserRoundCheck} title="Expertise evidence is still forming" body="Resolved or closed tickets with a recorded technician owner will build explainable team expertise profiles." />
        )}
      </CardContent>
    </Card>
  );
}

function CoveragePanel({ coverage, sourceCounts }) {
  const rows = [
    { label: "Ticket context", value: coverage.ticket_context_pct, help: "Client plus device or description recorded" },
    { label: "Technician ownership", value: coverage.ownership_pct, help: "Tickets with a recorded owner" },
    { label: "Resolution evidence", value: coverage.resolution_evidence_pct, help: "Resolved work with closure evidence" },
  ];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4 text-violet-300" />Memory coverage</CardTitle>
        <p className="text-xs leading-5 text-muted-foreground">{coverage.explanation}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <div><p className="text-xs font-semibold">{row.label}</p><p className="text-[10px] text-muted-foreground">{row.help}</p></div>
              <span className="font-mono text-sm font-semibold">{row.value}%</span>
            </div>
            <Progress value={row.value} className="h-2" />
          </div>
        ))}
        <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-4">
          {[
            ["Tickets", sourceCounts.tickets],
            ["Runbooks", sourceCounts.runbooks],
            ["Knowledge", sourceCounts.knowledge_articles],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border/60 bg-muted/[0.12] px-2 py-3 text-center">
              <p className="font-mono text-lg font-semibold">{value}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SecondBrainView({ api }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get("/second-brain/overview"));
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus operational memory could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const metrics = data?.metrics || {};
  const recommendations = useMemo(
    () => (data?.recommendations || []).filter((item) => item.decision?.status !== "dismissed"),
    [data],
  );

  const chooseDecision = async (item, status) => {
    if (status === "accepted" || status === "reset") {
      setSaving(true);
      try {
        await api.post(`/second-brain/recommendations/${item.id}/decision`, { status, reason: "" });
        toast.success(status === "accepted" ? "Review recorded - no action was executed" : "Recommendation review reset");
        await load();
      } catch (error) {
        toast.error(error.response?.data?.detail || "Review could not be recorded");
      } finally {
        setSaving(false);
      }
      return;
    }
    setReason("");
    setDecision({ item, status });
  };

  const saveDecision = async () => {
    if (!decision) return;
    setSaving(true);
    try {
      await api.post(`/second-brain/recommendations/${decision.item.id}/decision`, {
        status: decision.status,
        reason: reason.trim(),
      });
      toast.success(`${decision.status === "snoozed" ? "Snooze" : "Dismissal"} recorded with audit evidence`);
      setDecision(null);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Review could not be recorded");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) {
    return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Building the operational memory graph...</div>;
  }

  return (
    <div className="mt-4 space-y-4" data-testid="second-brain-view">
      <section className="overflow-hidden rounded-2xl border border-violet-500/25 bg-gradient-to-r from-violet-500/[0.08] via-card to-cyan-500/[0.06]">
        <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-violet-400/25 bg-violet-500/10 text-violet-300 shadow-[0_0_30px_rgba(139,92,246,0.14)]">
              <BrainCircuit className="h-6 w-6" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold">Nexus Second Brain</h2>
                <Badge className="border border-violet-400/25 bg-violet-500/10 text-violet-300">Evidence mode</Badge>
              </div>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                Institutional memory that connects recurring demand, technician outcomes, documentation and audit history. Every conclusion explains why it exists.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />{data?.privacy?.statement}
            </Badge>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}Refresh evidence
            </Button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <HeroTile label="Evidence records" value={metrics.evidence_records || 0} icon={Database} glow="violet" subtitle="Direct Nexus records" animated={false} />
        <HeroTile label="Patterns" value={metrics.patterns || 0} icon={Network} glow="cyan" subtitle="Meeting evidence threshold" animated={false} />
        <HeroTile label="Knowledge gaps" value={metrics.knowledge_gaps || 0} icon={BookOpenCheck} glow="amber" subtitle="Repeat work without guidance" animated={false} />
        <HeroTile label="Team profiles" value={metrics.expertise_profiles || 0} icon={UserRoundCheck} glow="emerald" subtitle="Recorded outcome evidence" animated={false} />
        <HeroTile label="Suggestions" value={metrics.recommendations || 0} icon={Lightbulb} glow="sky" subtitle={`${metrics.operational_decisions || 0} recorded decisions`} animated={false} />
      </div>

      <MemorySearch api={api} />

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-violet-300" />Recommended next knowledge moves</CardTitle>
            <p className="text-xs leading-5 text-muted-foreground">Recommendations are read-only until you deliberately open the owning workflow. Reviews are auditable.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {recommendations.length ? recommendations.slice(0, 8).map((item) => (
              <RecommendationCard key={item.id} item={item} onDecision={chooseDecision} />
            )) : (
              <EmptyState icon={Check} title="No open recommendations" body="Either the current evidence does not support a recommendation or this technician has reviewed the available items." />
            )}
          </CardContent>
        </Card>
        <PatternsPanel signals={data?.signals || []} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.42fr]">
        <ExpertisePanel profiles={data?.expertise || []} />
        <CoveragePanel coverage={data?.coverage || {}} sourceCounts={data?.source_counts || {}} />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/[0.12] px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-center gap-2"><Activity className="h-4 w-4 text-emerald-300" />Generated from live Nexus records at {data?.generated_at ? new Date(data.generated_at).toLocaleString() : "this session"}.</span>
        <span>Suggestions never execute scripts, send messages, assign tickets or change client systems.</span>
      </div>

      <Dialog open={Boolean(decision)} onOpenChange={(open) => !open && setDecision(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {decision?.status === "snoozed" ? <History className="h-5 w-5 text-amber-300" /> : <X className="h-5 w-5 text-rose-300" />}
              {decision?.status === "snoozed" ? "Snooze recommendation" : "Dismiss recommendation"}
            </DialogTitle>
            <DialogDescription>
              Record why this evidence-backed suggestion is not useful right now. The decision is preserved in Audit Trail and Black Box.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="second-brain-decision-reason">Review reason</Label>
            <Textarea
              id="second-brain-decision-reason"
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={decision?.status === "snoozed" ? "What needs to happen before this should return?" : "Why is this recommendation not applicable?"}
              data-testid="second-brain-decision-reason"
            />
            <p className="text-[11px] text-muted-foreground">No operational state changes when this review is saved.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button>
            <Button onClick={saveDecision} disabled={saving || reason.trim().length < 5}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
