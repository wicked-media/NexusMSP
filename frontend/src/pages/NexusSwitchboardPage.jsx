import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowRightLeft,
  BadgeCheck,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  FileCheck2,
  FileSearch,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusVerifiedSequence from "@/components/NexusVerifiedSequence";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const SURFACE = "overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]";
const STAGES = [
  { id: "source", label: "Source evidence" },
  { id: "mapping", label: "Dry-run map" },
  { id: "exceptions", label: "Resolve exceptions" },
  { id: "reconciliation", label: "Reconcile" },
  { id: "cutover", label: "Cutover gate" },
  { id: "proof", label: "Export proof" },
];

const emptyPlanForm = (scope = []) => ({
  name: "",
  provider: "syncro",
  scope,
  notes: "",
});

const safeList = (value) => Array.isArray(value) ? value : [];
const safeText = (value, fallback = "Not recorded") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const stageIndex = (stage) => Math.max(0, STAGES.findIndex((item) => item.id === stage));
const displayDate = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
};

function StatusBadge({ status }) {
  const value = String(status || "planning").replaceAll("_", " ");
  const lower = value.toLowerCase();
  const className = lower.includes("ready") || lower.includes("verified") || lower.includes("resolved")
    ? "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200"
    : lower.includes("blocked") || lower.includes("attention")
      ? "border-amber-400/30 bg-amber-400/[0.08] text-amber-200"
      : "border-violet-400/30 bg-violet-400/[0.08] text-violet-200";
  return <Badge variant="outline" className={`text-[10px] ${className}`}>{value}</Badge>;
}

function Metric({ label, value, detail, tone = "zinc" }) {
  const tones = {
    cyan: "border-cyan-400/25 bg-cyan-400/[0.045] text-cyan-100",
    violet: "border-violet-400/25 bg-violet-400/[0.045] text-violet-100",
    amber: "border-amber-400/25 bg-amber-400/[0.045] text-amber-100",
    zinc: "border-border/70 bg-card/90 text-foreground",
  };
  return <Card className={`${SURFACE} h-full ${tones[tone] || tones.zinc}`}><CardContent className="p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></CardContent></Card>;
}

function ScopeChooser({ scopes, selected, onChange }) {
  return <div className="grid gap-2 sm:grid-cols-2">{scopes.map((scope) => <label key={scope.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border/70 bg-muted/[0.08] px-3 py-2.5 text-sm"><Checkbox checked={selected.includes(scope.id)} onCheckedChange={() => onChange(selected.includes(scope.id) ? selected.filter((item) => item !== scope.id) : [...selected, scope.id])} /><span>{scope.label}</span></label>)}</div>;
}

function PlanEvidenceDialog({ open, onOpenChange, plan, scopes, saving, onSave }) {
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (!open || !plan) return;
    setForm({
      name: plan.name || "",
      provider: plan.provider || "syncro",
      scope: safeList(plan.scope),
      notes: plan.notes || "",
      source_readiness: { state: plan.source_readiness?.state || "not_connected", evidence_reference: plan.source_readiness?.evidence_reference || "", note: plan.source_readiness?.note || "" },
      mappings: safeList(plan.mappings).map((item) => ({ ...item })),
      exceptions: safeList(plan.exceptions).map((item) => ({ ...item })),
      reconciliation: safeList(plan.reconciliation).map((item) => ({ ...item })),
      cutover: safeList(plan.cutover).map((item) => ({ ...item })),
    });
  }, [open, plan]);
  if (!form) return null;
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateMapping = (index, field, value) => set("mappings", form.mappings.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  const updateException = (index, field, value) => set("exceptions", form.exceptions.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  const updateChecklist = (key, index, field, value) => set(key, form[key].map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  const addException = () => set("exceptions", [...form.exceptions, { id: `exception-${Date.now()}`, object_type: form.scope[0] || scopes[0]?.id || "clients", title: "", detail: "", owner: "", resolution: "", status: "open" }]);

  return <Dialog open={open} onOpenChange={onOpenChange}><NexusWorkflowDialog eyebrow="Nexus Switchboard · evidence workbench" title="Maintain migration evidence" description="This form retains decisions only. It cannot query a provider, copy data, import an object or cut over a live customer." icon={ClipboardList} tone="violet" className="max-w-6xl" contentClassName="space-y-6" footer={<><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={() => onSave(form)} disabled={saving || !form.name.trim() || !form.scope.length}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-1.5 h-4 w-4" />}Save evidence</Button></>}>
    <section className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label htmlFor="switchboard-plan-name">Migration plan</Label><Input id="switchboard-plan-name" value={form.name} onChange={(event) => set("name", event.target.value)} /></div><div className="space-y-2"><Label>Source platform</Label><p className="rounded-xl border border-border/70 bg-muted/[0.08] px-3 py-2.5 text-sm">{plan.provider_label || form.provider}</p></div><div className="space-y-2 md:col-span-2"><Label htmlFor="switchboard-plan-notes">Decision context</Label><Textarea id="switchboard-plan-notes" rows={3} value={form.notes} onChange={(event) => set("notes", event.target.value)} placeholder="Scope, accountable owner, handling decisions and rollback expectations…" /></div></section>

    <section className="space-y-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.025] p-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">1 · source boundary</p><p className="mt-1 text-sm font-semibold">Record proof without putting provider credentials in Nexus</p></div><div className="grid gap-3 md:grid-cols-2"><div className="space-y-2"><Label>Readiness</Label><Select value={form.source_readiness.state} onValueChange={(value) => set("source_readiness", { ...form.source_readiness, state: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="not_connected">Not connected</SelectItem><SelectItem value="export_prepared">Export prepared</SelectItem><SelectItem value="fixture_verified">Fixture verified</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="switchboard-source-ref">Evidence reference</Label><Input id="switchboard-source-ref" value={form.source_readiness.evidence_reference} onChange={(event) => set("source_readiness", { ...form.source_readiness, evidence_reference: event.target.value })} placeholder="Approved export, fixture or change reference" /></div><div className="space-y-2 md:col-span-2"><Label htmlFor="switchboard-source-note">Boundary note</Label><Textarea id="switchboard-source-note" rows={2} value={form.source_readiness.note} onChange={(event) => set("source_readiness", { ...form.source_readiness, note: event.target.value })} /></div></div></section>

    <section className="space-y-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">2 · stable identity mapping</p><p className="mt-1 text-sm font-semibold">Every source object resolves through an immutable external ID to a stable Nexus ID</p></div><div className="space-y-3">{form.mappings.map((mapping, index) => <article key={mapping.object_type || mapping.id || index} className="rounded-2xl border border-border/70 bg-muted/[0.08] p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-sm font-semibold">{mapping.label || mapping.object_type}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{mapping.source_identity} <ArrowRight className="mx-1 inline h-3.5 w-3.5 text-violet-300" /> {mapping.nexus_identity}</p></div><Select value={mapping.status || "not_reviewed"} onValueChange={(value) => updateMapping(index, "status", value)}><SelectTrigger className="w-full lg:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="not_reviewed">Not reviewed</SelectItem><SelectItem value="reviewed">Reviewed</SelectItem><SelectItem value="blocked">Blocked</SelectItem></SelectContent></Select></div><div className="mt-3 grid gap-3 md:grid-cols-[1fr_9rem_9rem]"><div className="space-y-2"><Label htmlFor={`switchboard-map-note-${index}`}>Field-map decision</Label><Input id={`switchboard-map-note-${index}`} value={mapping.field_map_note || ""} onChange={(event) => updateMapping(index, "field_map_note", event.target.value)} placeholder="How fields and relationships will be handled" /></div><div className="space-y-2"><Label htmlFor={`switchboard-source-count-${index}`}>Source count</Label><Input id={`switchboard-source-count-${index}`} type="number" min="0" value={mapping.source_count ?? ""} onChange={(event) => updateMapping(index, "source_count", event.target.value === "" ? null : Number(event.target.value))} /></div><div className="space-y-2"><Label htmlFor={`switchboard-expected-count-${index}`}>Expected count</Label><Input id={`switchboard-expected-count-${index}`} type="number" min="0" value={mapping.expected_count ?? ""} onChange={(event) => updateMapping(index, "expected_count", event.target.value === "" ? null : Number(event.target.value))} /></div></div></article>)}</div></section>

    <section className="space-y-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.025] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">3 · exception ownership</p><p className="mt-1 text-sm font-semibold">Do not hide bad or ambiguous records—give every exception a decision and owner</p></div><Button size="sm" variant="outline" onClick={addException}>Add exception</Button></div>{form.exceptions.length ? <div className="space-y-3">{form.exceptions.map((exception, index) => <article key={exception.id || index} className="rounded-xl border border-border/70 bg-background/30 p-3"><div className="grid gap-3 md:grid-cols-[10rem_1fr_10rem]"><Select value={exception.object_type || form.scope[0] || "clients"} onValueChange={(value) => updateException(index, "object_type", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{scopes.map((scope) => <SelectItem key={scope.id} value={scope.id}>{scope.label}</SelectItem>)}</SelectContent></Select><Input value={exception.title || ""} onChange={(event) => updateException(index, "title", event.target.value)} placeholder="Exception title" /><Select value={exception.status || "open"} onValueChange={(value) => updateException(index, "status", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Open</SelectItem><SelectItem value="resolved">Resolved</SelectItem><SelectItem value="accepted">Accepted risk</SelectItem></SelectContent></Select></div><div className="mt-3 grid gap-3 md:grid-cols-2"><Textarea rows={2} value={exception.detail || ""} onChange={(event) => updateException(index, "detail", event.target.value)} placeholder="What is different or unsafe to infer?" /><Textarea rows={2} value={exception.resolution || ""} onChange={(event) => updateException(index, "resolution", event.target.value)} placeholder="Resolution / compensating action" /></div><Input className="mt-3" value={exception.owner || ""} onChange={(event) => updateException(index, "owner", event.target.value)} placeholder="Accountable owner" /></article>)}</div> : <p className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">No exception is recorded. That is not cutover permission—complete mapping and reconciliation evidence first.</p>}</section>

    {[{ key: "reconciliation", label: "4 · reconciliation", tone: "emerald", detail: "Counts, attachment handling and compensation must be evidenced." }, { key: "cutover", label: "5 · cutover gate", tone: "violet", detail: "A listed gate is not an automatic cutover approval." }].map((section) => <section key={section.key} className="space-y-3"><div><p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${section.tone === "emerald" ? "text-emerald-300" : "text-violet-300"}`}>{section.label}</p><p className="mt-1 text-sm font-semibold">{section.detail}</p></div><div className="space-y-2">{form[section.key].map((check, index) => <div key={check.id || index} className="rounded-xl border border-border/70 bg-muted/[0.08] p-3"><div className="flex gap-3"><Checkbox checked={Boolean(check.complete)} onCheckedChange={(value) => updateChecklist(section.key, index, "complete", Boolean(value))} /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{check.label}</p><Input className="mt-2" value={check.evidence || ""} onChange={(event) => updateChecklist(section.key, index, "evidence", event.target.value)} placeholder="Evidence reference or accountable decision" /></div></div></div>)}</div></section>)}

    <section className="space-y-3"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">In-scope record types</p><ScopeChooser scopes={scopes} selected={form.scope} onChange={(scope) => set("scope", scope)} /></section>
  </NexusWorkflowDialog></Dialog>;
}

function CreatePlanDialog({ open, onOpenChange, providers, scopes, saving, onSave }) {
  const [form, setForm] = useState(emptyPlanForm(scopes.slice(0, 3).map((item) => item.id)));
  useEffect(() => { if (open) setForm(emptyPlanForm(scopes.slice(0, 3).map((item) => item.id))); }, [open, scopes]);
  return <Dialog open={open} onOpenChange={onOpenChange}><NexusWorkflowDialog eyebrow="Nexus Switchboard" title="Create a migration plan" description="Define the estate, provider and ownership boundary before a source connection or import is even considered." icon={ArrowRightLeft} tone="violet" contentClassName="space-y-5" footer={<><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={() => onSave(form)} disabled={saving || !form.name.trim() || !form.scope.length}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}Retain plan</Button></>}>
    <div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label htmlFor="switchboard-create-name">Plan name</Label><Input id="switchboard-create-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Example: Acme Syncro pilot" /></div><div className="space-y-2"><Label>Source platform</Label><Select value={form.provider} onValueChange={(provider) => setForm((current) => ({ ...current, provider }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.label}</SelectItem>)}</SelectContent></Select></div></div><div className="space-y-2"><Label htmlFor="switchboard-create-notes">Why this move / who owns it</Label><Textarea id="switchboard-create-notes" rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Pilot scope, expected outcome, customer/technician impacts and accountable owner…" /></div><section className="space-y-3"><p className="text-xs font-semibold">In-scope record types</p><ScopeChooser scopes={scopes} selected={form.scope} onChange={(scope) => setForm((current) => ({ ...current, scope }))} /></section><div className="rounded-xl border border-violet-400/20 bg-violet-400/[0.04] p-4 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mr-2 inline h-4 w-4 text-violet-300" />Saving this plan records governance evidence only. It cannot authenticate to or query a source provider.</div>
  </NexusWorkflowDialog></Dialog>;
}

export default function NexusSwitchboardPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidence, setEvidence] = useState([]);
  const [saving, setSaving] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewDecision, setReviewDecision] = useState("reviewed");

  const load = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const response = await axios.get(`${API}/nexus-switchboard/overview`, { headers });
      const next = response.data || {};
      const plans = safeList(next.plans);
      setData(next);
      setSelectedId((current) => plans.some((plan) => plan.id === current) ? current : (plans[0]?.id || ""));
    } catch (loadError) {
      setError(loadError?.response?.data?.detail || "Nexus could not retrieve the migration workbench. No provider action was performed.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const providers = safeList(data?.providers);
  const scopes = safeList(data?.object_scopes);
  const plans = safeList(data?.plans);
  const plan = plans.find((item) => item.id === selectedId) || null;
  const summary = data?.summary || {};
  const planStage = plan?.stage === "proof" ? STAGES.length : stageIndex(plan?.stage);
  const mappings = safeList(plan?.mappings);
  const exceptions = safeList(plan?.exceptions);

  const createPlan = async (form) => {
    setSaving(true);
    try {
      const response = await axios.post(`${API}/nexus-switchboard/plans`, { ...form, name: form.name.trim(), notes: form.notes.trim() }, { headers });
      setCreateOpen(false);
      await load({ background: true });
      const created = response.data?.plan;
      if (created?.id) setSelectedId(created.id);
      toast.success("Migration plan retained. No provider was contacted.");
    } catch (requestError) { toast.error(requestError?.response?.data?.detail || "Nexus could not create the migration plan."); } finally { setSaving(false); }
  };

  const saveEvidence = async (form) => {
    if (!plan) return;
    setSaving(true);
    try {
      await axios.put(`${API}/nexus-switchboard/plans/${plan.id}`, { ...form, name: form.name.trim(), notes: form.notes.trim(), expected_version: plan.version }, { headers });
      setEditOpen(false);
      await load({ background: true });
      toast.success("Migration evidence retained. The source platform remains untouched.");
    } catch (requestError) { toast.error(requestError?.response?.data?.detail || "Nexus could not save this migration evidence."); } finally { setSaving(false); }
  };

  const submitReview = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      await axios.post(`${API}/nexus-switchboard/plans/${plan.id}/review`, { decision: reviewDecision, note: reviewNote.trim(), expected_version: plan.version }, { headers });
      setReviewOpen(false); setReviewNote("");
      await load({ background: true });
      toast.success("Migration-plan review retained.");
    } catch (requestError) { toast.error(requestError?.response?.data?.detail || "Nexus could not retain that review."); } finally { setSaving(false); }
  };

  const showEvidence = async () => {
    if (!plan) return;
    setEvidenceOpen(true); setEvidence([]);
    try {
      const response = await axios.get(`${API}/nexus-switchboard/plans/${plan.id}/evidence`, { headers });
      const payload = response.data || {};
      setEvidence([...safeList(payload.items), ...safeList(payload.events)]);
    } catch (requestError) { toast.error(requestError?.response?.data?.detail || "Nexus could not retrieve the retained evidence."); }
  };

  if (loading && !data) return <WorkspaceLoadingState className="mt-4" label="Assembling the Nexus Switchboard workbench…" />;
  if (!loading && error && !data) return <WorkspaceErrorState className="mt-4" title="Nexus Switchboard is unavailable" description={error} onRetry={load} retryLabel="Retry Switchboard" onSecondaryAction={() => navigate("/settings?tab=integrations")} secondaryLabel="Open integrations" />;

  return <div className="space-y-5 pb-10" data-testid="nexus-switchboard-page">
    <OperationalPageHeader eyebrow="Nexus Switchboard · migration governance" title="Nexus Switchboard" description="Move an MSP estate with stable identities, explicit data decisions and accountable evidence—before a real provider import is ever allowed." icon={ArrowRightLeft} tone="violet" signal={plan?.status === "review_ready" ? "healthy" : "attention"} actions={<><Button size="sm" variant="outline" className="rounded-xl" onClick={() => setCreateOpen(true)}><Sparkles className="mr-1.5 h-3.5 w-3.5" />New plan</Button><Button size="sm" className="rounded-xl" onClick={() => load({ background: true })} disabled={refreshing}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh</Button></>} />

    <Card className={`${SURFACE} border-violet-400/20 bg-violet-400/[0.035]`}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Release boundary</p><p className="mt-1 text-sm font-semibold">Planning and evidence are live. Provider reads, imports and live cutovers are deliberately not.</p><p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground">{safeText(data?.boundary, "Switchboard holds migration decisions only. It cannot connect to a source, transfer records or become an alternate source of truth.")}</p></div><Badge variant="outline" className="w-fit border-violet-400/25 bg-violet-400/[0.08] text-violet-200"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />No blind import</Badge></CardContent></Card>
    {error && <Card className={`${SURFACE} border-amber-400/25 bg-amber-400/[0.04]`}><CardContent className="flex items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium">The latest workbench refresh did not complete</p><p className="mt-1 text-xs text-muted-foreground">{error} Previously loaded plans are still shown; no source action was attempted.</p></div><Button variant="outline" size="sm" onClick={() => load({ background: true })}>Retry</Button></CardContent></Card>}

    <NexusVerifiedSequence stages={STAGES.map((item) => item.label)} complete={plan ? planStage : 0} label="Nexus migration evidence" />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Migration plans" value={summary.plans ?? plans.length} detail="Bounded migration programmes" tone="violet" /><Metric label="Providers planned" value={summary.providers ?? summary.providers_planned ?? 0} detail="No provider connection is active" tone="cyan" /><Metric label="Mappings reviewed" value={summary.mappings ?? 0} detail="Stable-ID decisions retained" tone="zinc" /><Metric label="Open exceptions" value={summary.exceptions ?? summary.open_exceptions ?? 0} detail="Must be resolved or accepted before cutover" tone={(summary.exceptions ?? summary.open_exceptions) ? "amber" : "zinc"} /></div>

    <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.45fr)]">
      <Card className={SURFACE}><CardHeader className="border-b border-border/70 pb-3"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Migration portfolio</p><CardTitle className="mt-1 text-base">Each move has one accountable plan</CardTitle><p className="text-xs leading-5 text-muted-foreground">Scope, mappings, exceptions, reconciliation and review stay together.</p></CardHeader><CardContent className="max-h-[44rem] space-y-2 overflow-y-auto p-4">{plans.length ? plans.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full rounded-xl border p-4 text-left transition ${item.id === selectedId ? "border-violet-400/45 bg-violet-400/[0.07]" : "border-border/70 bg-muted/[0.08] hover:border-violet-400/25"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{item.provider_label || item.provider} · {item.stage_label || item.stage}</p></div><StatusBadge status={item.status} /></div><div className="mt-3 flex flex-wrap gap-1.5">{safeList(item.scope).map((scope) => <Badge key={scope} variant="outline" className="text-[10px] text-muted-foreground">{scope}</Badge>)}</div></button>) : <div className="flex min-h-72 flex-col items-center justify-center px-5 text-center"><CircleDashed className="h-9 w-9 text-violet-300" /><p className="mt-3 text-sm font-semibold">No migration plan exists yet</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Create a bounded record before anyone handles exports, provider access or source data.</p><Button size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>Create first plan</Button></div>}</CardContent></Card>

      {plan ? <section className="space-y-5"><Card className={SURFACE}><CardContent className="p-0"><div className="flex flex-col gap-4 border-b border-border/70 p-5 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-violet-400/25 bg-violet-400/[0.07] text-violet-200">{plan.provider_label || plan.provider}</Badge><StatusBadge status={plan.status} /></div><h2 className="mt-3 text-xl font-semibold tracking-tight">{plan.name}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{safeText(plan.notes, "No decision context recorded yet. Add ownership, scope and rollback expectations before proceeding.")}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setEditOpen(true)}><ClipboardList className="mr-1.5 h-3.5 w-3.5" />Maintain evidence</Button><Button size="sm" variant="outline" onClick={showEvidence}><History className="mr-1.5 h-3.5 w-3.5" />Evidence</Button><Button size="sm" onClick={() => setReviewOpen(true)}><FileCheck2 className="mr-1.5 h-3.5 w-3.5" />Review gate</Button></div></div><div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">{STAGES.map((stage, index) => { const done = index < planStage; const current = index === planStage; return <div key={stage.id} className={`rounded-xl border p-3 ${done ? "border-emerald-400/25 bg-emerald-400/[0.05]" : current ? "border-violet-400/35 bg-violet-400/[0.07]" : "border-border/70 bg-muted/[0.08]"}`}><div className="flex items-center justify-between"><span className={done ? "text-emerald-300" : current ? "text-violet-200" : "text-muted-foreground"}>{done ? <CheckCircle2 className="h-4 w-4" /> : <CircleDashed className="h-4 w-4" />}</span><span className="text-[10px] font-semibold text-muted-foreground">{index + 1}</span></div><p className="mt-2 text-xs font-semibold">{stage.label}</p></div>; })}</div></CardContent></Card>
        <div className="grid gap-5 lg:grid-cols-2"><Card className={SURFACE}><CardHeader className="border-b border-border/70 pb-3"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Mapping ledger</p><CardTitle className="mt-1 text-base">Stable source-to-Nexus identity</CardTitle></CardHeader><CardContent className="max-h-[26rem] space-y-2 overflow-y-auto p-4">{mappings.map((mapping) => <article key={mapping.id || mapping.object_type} className="rounded-xl border border-border/70 bg-muted/[0.08] p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{mapping.label}</p><StatusBadge status={mapping.status} /></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{mapping.source_identity} <ArrowRight className="mx-1 inline h-3.5 w-3.5 text-cyan-300" /> {mapping.nexus_identity}</p><p className="mt-2 text-[11px] text-muted-foreground">{safeText(mapping.field_map_note, "No field-map decision recorded.")}</p></article>)}</CardContent></Card><Card className={SURFACE}><CardHeader className="border-b border-border/70 pb-3"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Exception queue</p><CardTitle className="mt-1 text-base">Every ambiguous record has an owner</CardTitle></CardHeader><CardContent className="max-h-[26rem] space-y-2 overflow-y-auto p-4">{exceptions.length ? exceptions.map((exception) => <article key={exception.id} className="rounded-xl border border-amber-400/20 bg-amber-400/[0.035] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{exception.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{safeText(exception.detail, "No detail recorded.")}</p></div><StatusBadge status={exception.status} /></div><p className="mt-2 text-[11px] text-muted-foreground">Owner · {safeText(exception.owner, "Unassigned")}</p></article>) : <div className="flex min-h-44 flex-col items-center justify-center text-center"><BadgeCheck className="h-7 w-7 text-emerald-300" /><p className="mt-3 text-sm font-medium">No exception is recorded</p><p className="mt-1 px-4 text-xs leading-5 text-muted-foreground">That does not bypass the remaining evidence gates.</p></div>}</CardContent></Card></div>
      </section> : <Card className={SURFACE}><CardContent className="flex min-h-96 flex-col items-center justify-center px-8 text-center"><FileSearch className="h-10 w-10 text-violet-300" /><p className="mt-4 text-base font-semibold">Select a migration plan</p><p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">Switchboard brings planning evidence into one workspace without allowing a source system to become ungoverned data input.</p></CardContent></Card>}
    </div>

    <Card className={`${SURFACE} border-sky-400/20 bg-sky-400/[0.025]`}><CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Operator guidance</p><p className="mt-1 text-base font-semibold">Connect source → Inventory → Dry-run map → Resolve → Reconcile → Cut over → Monitor</p><p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground">Current Switchboard capability stops at the governed planning boundary. A real importer requires a separately reviewed provider adapter, idempotent batches, reconciliation and explicit approval.</p></div><Button asChild variant="outline"><Link to="/documentation-hub?tab=help">Open migration guide<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button></CardContent></Card>

    <CreatePlanDialog open={createOpen} onOpenChange={setCreateOpen} providers={providers} scopes={scopes} saving={saving} onSave={createPlan} />
    <PlanEvidenceDialog open={editOpen} onOpenChange={setEditOpen} plan={plan} scopes={scopes} saving={saving} onSave={saveEvidence} />
    <Dialog open={reviewOpen} onOpenChange={setReviewOpen}><NexusWorkflowDialog eyebrow="Nexus Switchboard · accountable review" title="Retain a review decision" description="This records a governance decision. It does not approve an import, connect to a source or change a live cutover." icon={FileCheck2} tone="amber" className="max-w-2xl" contentClassName="space-y-4" footer={<><Button variant="outline" onClick={() => setReviewOpen(false)} disabled={saving}>Cancel</Button><Button onClick={submitReview} disabled={saving}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-1.5 h-4 w-4" />}Retain decision</Button></>}><div className="space-y-2"><Label>Decision</Label><Select value={reviewDecision} onValueChange={setReviewDecision}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="reviewed">Reviewed</SelectItem><SelectItem value="reopen">Reopen planning</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="switchboard-review-note">Reviewer note</Label><Textarea id="switchboard-review-note" rows={4} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Evidence assessed, outstanding condition or named next owner…" /></div><div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.035] p-4 text-xs leading-5 text-muted-foreground"><TriangleAlert className="mr-2 inline h-4 w-4 text-amber-300" />A review cannot override unresolved exceptions, missing reconciliation or a provider integration boundary.</div></NexusWorkflowDialog></Dialog>
    <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}><NexusWorkflowDialog eyebrow="Nexus Switchboard · retained evidence" title={`${plan?.name || "Migration plan"} evidence`} description="This is a planning record, not an import log. Source data is not copied into this panel." icon={History} tone="cyan" className="max-w-3xl" contentClassName="space-y-3" footer={<Button variant="outline" onClick={() => setEvidenceOpen(false)}>Close</Button>}>{evidence.length ? <div className="space-y-2">{evidence.map((item, index) => <article key={`${item.id || item.event_type || item.label}-${index}`} className="rounded-xl border border-border/70 bg-muted/[0.08] p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium">{safeText(item.label || item.event_type, "Migration evidence").replaceAll("_", " ")}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{safeText(item.detail, "No narrative recorded.")}</p></div><span className="text-[10px] text-muted-foreground">{displayDate(item.occurred_at || item.created_at)}</span></div></article>)}</div> : <div className="flex min-h-40 flex-col items-center justify-center text-center"><History className="h-7 w-7 text-cyan-300" /><p className="mt-3 text-sm font-medium">No evidence is retained yet</p><p className="mt-1 text-xs text-muted-foreground">Save the migration plan or its evidence to create an auditable record.</p></div>}</NexusWorkflowDialog></Dialog>
  </div>;
}
