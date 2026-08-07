import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  Filter,
  Flag,
  FlaskConical,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  UserRoundCheck,
  XCircle,
} from "lucide-react";

import { API, useAuth } from "@/App";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const STATUS_OPTIONS = [
  ["not_started", "Not started"],
  ["in_progress", "In progress"],
  ["blocked", "Blocked"],
  ["ready", "Ready"],
  ["passed", "Passed"],
  ["failed", "Failed"],
  ["not_applicable", "Not applicable"],
];

const TEST_OPTIONS = [
  ["not_run", "Not run"],
  ["pass", "Pass"],
  ["fail", "Fail"],
  ["partial", "Partial"],
  ["not_applicable", "Not applicable"],
];

const SEVERITY_OPTIONS = [
  ["critical", "Critical"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
];

const STATUS_STYLES = {
  not_started: "border-zinc-700 bg-zinc-800/60 text-zinc-200",
  in_progress: "border-cyan-500/30 bg-cyan-500/10 text-cyan-100",
  blocked: "border-rose-500/30 bg-rose-500/10 text-rose-100",
  ready: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
  passed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
  failed: "border-rose-500/30 bg-rose-500/10 text-rose-100",
  not_applicable: "border-zinc-700 bg-zinc-800/60 text-zinc-300",
};

const SEVERITY_STYLES = {
  critical: "border-rose-500/30 bg-rose-500/10 text-rose-100",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-100",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-100",
  low: "border-sky-500/30 bg-sky-500/10 text-sky-100",
};

const EMPTY_FORM = {
  section: "",
  title: "",
  owner: "",
  severity: "high",
  evidence_required: "",
  status: "not_started",
  target_release: "NexusMSP v1.0",
  test_result: "not_run",
  production_blocker: true,
  evidence_reference: "",
  review_note: "",
};

function humanise(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  if (!value) return "Not reviewed";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not reviewed" : date.toLocaleString();
}

function DecisionBanner({ decision, blockers }) {
  const candidate = decision === "candidate";
  const pilot = decision === "pilot_only";
  const Icon = candidate ? CheckCircle2 : pilot ? FlaskConical : LockKeyhole;
  const style = candidate
    ? "border-emerald-500/25 from-emerald-500/[0.10]"
    : pilot
      ? "border-amber-500/25 from-amber-500/[0.10]"
      : "border-rose-500/25 from-rose-500/[0.10]";
  const title = candidate ? "Candidate for production approval" : pilot ? "Controlled pilot only" : "Public launch is on hold";
  const detail = candidate
    ? "Every defined gate has passed. A named release owner must still record the final launch decision."
    : pilot
      ? "No explicit blockers remain, but launch evidence is incomplete. Limit access to an observed pilot."
      : `${blockers} production blocker${blockers === 1 ? "" : "s"} remain open. NexusMSP must not be presented as production-ready.`;

  return (
    <Card className={`overflow-hidden border bg-gradient-to-r ${style} via-card to-card`} data-testid="readiness-decision">
      <CardContent className="flex items-start gap-4 p-5">
        <span className="rounded-xl border border-current/20 bg-background/60 p-2.5"><Icon className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ReadinessDialog({ open, item, sections, saving, onOpenChange, onSave }) {
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (!open) return;
    setForm(item
      ? {
          ...EMPTY_FORM,
          ...item,
          review_note: "",
        }
      : {
          ...EMPTY_FORM,
          section: sections[0]?.id || "",
        });
  }, [item, open, sections]);

  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-cyan-500/20 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border/70 bg-gradient-to-r from-cyan-500/[0.08] via-background to-emerald-500/[0.05] px-6 py-5 text-left">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Governed launch evidence</p>
          <DialogTitle className="mt-1 flex items-center gap-2 text-xl">
            <ClipboardCheck className="h-5 w-5 text-cyan-300" />
            {item ? "Review readiness item" : "Create readiness item"}
          </DialogTitle>
          <DialogDescription>
            Record the owner, test outcome, evidence and release impact. Every save is added to the audit ledger.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 px-6 py-5 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="readiness-title">Readiness item</Label>
            <Input id="readiness-title" value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="What must be proved before release?" />
          </div>

          <div className="space-y-2">
            <Label>Control section</Label>
            <Select value={form.section} onValueChange={(value) => set("section", value)}>
              <SelectTrigger data-testid="readiness-section-select"><SelectValue placeholder="Select a section" /></SelectTrigger>
              <SelectContent>{sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="readiness-owner">Owner</Label>
            <Input id="readiness-owner" value={form.owner} onChange={(event) => set("owner", event.target.value)} placeholder="Named person or team" />
          </div>

          <div className="space-y-2">
            <Label>Severity</Label>
            <Select value={form.severity} onValueChange={(value) => set("severity", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITY_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(value) => set("status", value)}>
              <SelectTrigger data-testid="readiness-status-select"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUS_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Test result</Label>
            <Select value={form.test_result} onValueChange={(value) => set("test_result", value)}>
              <SelectTrigger data-testid="readiness-test-select"><SelectValue /></SelectTrigger>
              <SelectContent>{TEST_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="readiness-target">Target release</Label>
            <Input id="readiness-target" value={form.target_release} onChange={(event) => set("target_release", event.target.value)} placeholder="Controlled pilot or release name" />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="readiness-evidence-required">Evidence required</Label>
            <Textarea id="readiness-evidence-required" rows={3} value={form.evidence_required} onChange={(event) => set("evidence_required", event.target.value)} placeholder="Define objective acceptance evidence before running the test." />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="readiness-evidence-reference">Evidence reference</Label>
            <Input id="readiness-evidence-reference" value={form.evidence_reference} onChange={(event) => set("evidence_reference", event.target.value)} placeholder="Report, ticket, commit, build, test run or immutable evidence link" />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="readiness-review-note">Review note</Label>
            <Textarea id="readiness-review-note" rows={3} value={form.review_note} onChange={(event) => set("review_note", event.target.value)} placeholder="What was reviewed, what changed, and what remains?" />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-4 md:col-span-2">
            <div>
              <Label htmlFor="readiness-blocker" className="text-sm">Production blocker</Label>
              <p className="mt-1 text-xs text-muted-foreground">When enabled, this item prevents the public-production decision until it passes or is formally marked not applicable.</p>
            </div>
            <Switch id="readiness-blocker" checked={Boolean(form.production_blocker)} onCheckedChange={(value) => set("production_blocker", value)} />
          </div>

          {item && (
            <div className="rounded-xl border border-border/70 bg-muted/20 p-4 text-xs text-muted-foreground md:col-span-2">
              Last reviewed {formatDate(item.last_reviewed)} by {item.last_reviewed_by || "no recorded reviewer"}.
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border/70 bg-muted/10 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={saving} data-testid="save-readiness-item">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}
            {item ? "Save review" : "Create control"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductionReadinessPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("all");
  const [status, setStatus] = useState("all");
  const [blockersOnly, setBlockersOnly] = useState(false);
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await axios.get(`${API}/production-readiness/overview`, { headers });
      setData(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Production readiness could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [headers, token]);

  useEffect(() => {
    load();
  }, [load]);

  const sectionById = useMemo(
    () => Object.fromEntries((data?.sections || []).map((entry) => [entry.id, entry])),
    [data?.sections],
  );

  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (data?.items || []).filter((item) => {
      if (section !== "all" && item.section !== section) return false;
      if (status !== "all" && item.status !== status) return false;
      if (blockersOnly && !item.production_blocker) return false;
      if (!term) return true;
      return [item.title, item.owner, item.evidence_required, item.evidence_reference, sectionById[item.section]?.label]
        .some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [blockersOnly, data?.items, query, section, sectionById, status]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openReview = (item) => {
    setEditing(item);
    setDialogOpen(true);
  };

  const save = async (form) => {
    if (form.title.trim().length < 5 || !form.owner.trim() || !form.evidence_required.trim()) {
      toast.error("Add a clear title, owner and evidence requirement before saving");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await axios.put(`${API}/production-readiness/items/${editing.id}`, form, { headers });
        toast.success("Readiness review recorded in the audit ledger");
      } else {
        await axios.post(`${API}/production-readiness/items`, form, { headers });
        toast.success("Production-readiness control created");
      }
      setDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Readiness evidence could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const summary = data?.summary || {};
  const launchDecision = summary.launch_decision || "hold";

  return (
    <div className="space-y-5 p-6" data-testid="production-readiness-page">
      <OperationalPageHeader
        eyebrow="Internal launch control"
        title="Production Readiness"
        description="A governed, evidence-led register for security, recovery, reliability, billing accuracy and controlled release. Green dashboards are context—not proof."
        icon={ShieldCheck}
        tone="emerald"
        actions={<>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh evidence
          </Button>
          <Button size="sm" onClick={openCreate} data-testid="new-readiness-item">
            <Plus className="mr-1.5 h-3.5 w-3.5" />New control
          </Button>
        </>}
      />

      <DecisionBanner decision={launchDecision} blockers={summary.open_blockers || 0} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <HeroTile label="Open blockers" value={summary.open_blockers || 0} icon={LockKeyhole} glow={(summary.open_blockers || 0) ? "rose" : "emerald"} subtitle="Must be resolved or waived" testId="readiness-blockers-tile" />
        <HeroTile label="Gates passed" value={summary.passed_gates || 0} suffix={`/${summary.total_gates || 0}`} icon={CheckCircle2} glow="emerald" subtitle="Objective release gates" testId="readiness-gates-tile" />
        <HeroTile label="Failed tests" value={summary.failed_tests || 0} icon={XCircle} glow={(summary.failed_tests || 0) ? "rose" : "zinc"} subtitle="Evidence requires action" testId="readiness-tests-tile" />
        <HeroTile label="Launch decision" value={humanise(launchDecision)} animated={false} icon={Flag} glow={launchDecision === "candidate" ? "emerald" : launchDecision === "pilot_only" ? "amber" : "rose"} subtitle="Derived—not manually promoted" testId="readiness-decision-tile" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-cyan-500/15">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Target className="h-4 w-4 text-cyan-300" />Launch gates</CardTitle>
            <CardDescription>Every gate requires retained test evidence. Live service counters do not auto-pass controls.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {(data?.gates || []).map((gate) => (
              <div key={gate.id} className="rounded-xl border border-border/70 bg-muted/[0.08] p-3" data-testid={`gate-${gate.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{gate.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{gate.passed}/{gate.total} controls passed · {gate.open_blockers} open blockers</p>
                  </div>
                  <Badge variant="outline" className={STATUS_STYLES[gate.status] || STATUS_STYLES.not_started}>{humanise(gate.status)}</Badge>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div className={`h-full rounded-full ${gate.status === "passed" ? "bg-emerald-400" : gate.status === "failed" ? "bg-rose-400" : "bg-cyan-400"}`} style={{ width: `${gate.total ? Math.max(5, (gate.passed / gate.total) * 100) : 5}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-emerald-500/15">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ChevronRight className="h-4 w-4 text-emerald-300" />Mandatory order of work</CardTitle>
            <CardDescription>Do not advance to the next phase until the earlier safety boundary has credible evidence.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.priority_order || []).map((priority, index) => (
              <div key={priority} className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/[0.06] px-3 py-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-xs font-semibold text-emerald-200">{index + 1}</span>
                <span className="text-sm">{priority}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70">
        <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_220px_190px_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Search controls, owners or evidence…" aria-label="Search readiness controls" />
          </div>
          <Select value={section} onValueChange={setSection}>
            <SelectTrigger><Filter className="mr-2 h-4 w-4 text-muted-foreground" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All control sections</SelectItem>
              {(data?.sections || []).map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3">
            <Label htmlFor="blockers-filter" className="whitespace-nowrap text-xs">Blockers only</Label>
            <Switch id="blockers-filter" checked={blockersOnly} onCheckedChange={setBlockersOnly} />
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="register-title">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 id="register-title" className="text-lg font-semibold">Readiness register</h2>
            <p className="text-sm text-muted-foreground">{filteredItems.length} of {data?.items?.length || 0} controls shown</p>
          </div>
        </div>

        {loading && !data ? (
          <div className="flex min-h-56 items-center justify-center rounded-2xl border border-border/70"><Loader2 className="h-6 w-6 animate-spin text-emerald-300" /></div>
        ) : filteredItems.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {filteredItems.map((item) => {
              const sectionMeta = sectionById[item.section] || {};
              return (
                <Card key={item.id} className={`group border-border/70 transition-colors hover:border-cyan-500/25 ${item.production_blocker && !["passed", "ready", "not_applicable"].includes(item.status) ? "border-l-2 border-l-rose-400" : ""}`} data-testid={`readiness-item-${item.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={SEVERITY_STYLES[item.severity] || SEVERITY_STYLES.medium}>{humanise(item.severity)}</Badge>
                      <Badge variant="outline" className={STATUS_STYLES[item.status] || STATUS_STYLES.not_started}>{humanise(item.status)}</Badge>
                      <Badge variant="outline" className={item.test_result === "pass" ? STATUS_STYLES.passed : item.test_result === "fail" ? STATUS_STYLES.failed : STATUS_STYLES.not_started}>Test: {humanise(item.test_result)}</Badge>
                      {item.production_blocker && <Badge variant="outline" className="border-rose-500/25 bg-rose-500/[0.08] text-rose-100"><LockKeyhole className="mr-1 h-3 w-3" />Blocker</Badge>}
                    </div>
                    <CardTitle className="pt-2 text-base leading-snug">{item.title}</CardTitle>
                    <CardDescription>{sectionMeta.label || humanise(item.section)} · Target {item.target_release || "not set"}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 rounded-xl border border-border/60 bg-muted/[0.06] p-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">Owner</p>
                        <p className="mt-1 flex items-center gap-1.5 font-medium"><UserRoundCheck className="h-3.5 w-3.5 text-cyan-300" />{item.owner || "Unassigned"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Last reviewed</p>
                        <p className="mt-1 font-medium">{formatDate(item.last_reviewed)}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Required evidence</p>
                      <p className="mt-1 text-sm leading-relaxed text-foreground/85">{item.evidence_required || "No objective evidence requirement has been recorded."}</p>
                    </div>
                    {item.evidence_reference && (
                      <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] px-3 py-2 text-xs">
                        <span className="text-muted-foreground">Evidence:</span> {item.evidence_reference}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
                      <p className="truncate text-xs text-muted-foreground">Reviewed by {item.last_reviewed_by || "nobody yet"}</p>
                      <Button variant="outline" size="sm" onClick={() => openReview(item)} data-testid={`review-readiness-${item.id}`}>
                        <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />Review
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center">
            <Search className="h-6 w-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No readiness controls match these filters</p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => { setQuery(""); setSection("all"); setStatus("all"); setBlockersOnly(false); }}>Clear filters</Button>
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.7fr]">
        <Card className="border-sky-500/15">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-sky-300" />Live system evidence</CardTitle>
            <CardDescription>Operational signals that guide investigation. These counters deliberately cannot promote a readiness control.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {(data?.system_evidence || []).map((evidence) => (
              <div key={evidence.id} className="rounded-xl border border-border/70 bg-muted/[0.06] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{evidence.label}</p>
                  <span className={`h-2.5 w-2.5 rounded-full ${evidence.status === "healthy" ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.7)]" : "bg-amber-400"}`} />
                </div>
                <p className="mt-2 text-xl font-semibold">{String(evidence.value)}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{evidence.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-violet-500/15 bg-gradient-to-br from-violet-500/[0.05] via-card to-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="h-4 w-4 text-violet-300" />NexusOS boundary</CardTitle>
            <CardDescription>Keep experimental operating-system work out of the NexusMSP public-launch claim.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-violet-100">Developer preview</Badge>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{data?.nexusos?.message || "NexusOS remains a separate developer preview."}</p>
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-3 text-xs text-amber-100/85">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Preview status does not reduce, bypass or inherit any NexusMSP production gate.
            </div>
          </CardContent>
        </Card>
      </div>

      <ReadinessDialog
        open={dialogOpen}
        item={editing}
        sections={data?.sections || []}
        saving={saving}
        onOpenChange={setDialogOpen}
        onSave={save}
      />
    </div>
  );
}
