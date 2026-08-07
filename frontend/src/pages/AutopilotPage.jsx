import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Clock3,
  Eye,
  FileCheck2,
  Gauge,
  History,
  Loader2,
  LockKeyhole,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Workflow,
  XCircle,
  Zap,
} from "lucide-react";

import { API, useAuth } from "@/App";
import HeroTile from "@/components/HeroTile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";


const LEVEL_TONES = {
  0: "border-zinc-500/25 bg-zinc-500/[0.05] text-zinc-400",
  1: "border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-500 dark:text-cyan-300",
  2: "border-blue-500/25 bg-blue-500/[0.06] text-blue-500 dark:text-blue-300",
  3: "border-violet-500/25 bg-violet-500/[0.06] text-violet-500 dark:text-violet-300",
  4: "border-amber-500/25 bg-amber-500/[0.06] text-amber-600 dark:text-amber-300",
};

const CONFIDENCE_TONES = {
  emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  cyan: "border-cyan-500/25 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300",
  amber: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  red: "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-300",
};

const STATUS_TONES = {
  ready: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  attention: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  locked: "border-border bg-muted/50 text-muted-foreground",
};

const copyPolicy = (policy) => ({
  enabled: Boolean(policy?.enabled),
  configured_level: Number(policy?.configured_level || 0),
  confidence_threshold: Number(policy?.confidence_threshold || 0.9),
  allowed_client_ids: [...(policy?.allowed_client_ids || [])],
  allowed_action_ids: [...(policy?.allowed_action_ids || [])],
  overnight_enabled: Boolean(policy?.overnight_enabled),
  max_actions_per_run: Number(policy?.max_actions_per_run || 3),
});

const formatWhen = (value) => {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(date);
};


function LevelBadge({ level, children }) {
  return (
    <Badge variant="outline" className={LEVEL_TONES[level] || LEVEL_TONES[0]}>
      {children || `Level ${level}`}
    </Badge>
  );
}


function ReadinessLadder({ readiness }) {
  return (
    <Card className="overflow-hidden border-border/60 bg-card/70 shadow-sm" data-testid="autopilot-readiness">
      <CardHeader className="border-b border-border/60 bg-muted/20 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-500">Permission-based autonomy</p>
            <CardTitle className="mt-1 text-lg">Autonomy ladder</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Configured intent is always capped by live readiness evidence.</p>
          </div>
          <Badge variant="outline" className="border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-300">
            Effective Level {readiness.effective_level}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border/60">
          {readiness.levels.map((level) => {
            const active = readiness.effective_level === level.level;
            const configured = readiness.configured_level === level.level;
            return (
              <div
                key={level.level}
                className={`grid gap-4 px-4 py-4 transition-colors md:grid-cols-[180px_1fr_auto] ${active ? "bg-violet-500/[0.06]" : "hover:bg-muted/20"}`}
              >
                <div className="flex items-start gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border font-semibold ${LEVEL_TONES[level.level]}`}>
                    {level.level}
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{level.name}</p>
                      {active && <Badge className="bg-violet-600 text-white hover:bg-violet-600">Effective</Badge>}
                      {configured && !active && <Badge variant="outline">Configured</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{level.short_name}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-foreground/90">{level.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {level.gates.map((gate) => (
                      <span
                        key={gate.id}
                        title={gate.detail}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium ${gate.passed ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-300" : "border-border bg-muted/40 text-muted-foreground"}`}
                      >
                        {gate.passed ? <Check className="h-3 w-3" /> : <LockKeyhole className="h-3 w-3" />}
                        {gate.id.replaceAll("_", " ")}
                      </span>
                    ))}
                  </div>
                </div>
                <Badge variant="outline" className={`h-fit capitalize ${STATUS_TONES[level.status]}`}>
                  {level.status}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}


function CandidateCard({ candidate, onSimulate, simulating }) {
  const confidence = Math.round((candidate.confidence || 0) * 100);
  return (
    <Card className="group border-border/60 bg-card/70 transition hover:-translate-y-0.5 hover:border-violet-500/30 hover:shadow-lg" data-testid={`autopilot-candidate-${candidate.source_id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10">
            <Sparkles className="h-4 w-4 text-violet-500" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={CONFIDENCE_TONES[candidate.confidence_tier?.tone] || CONFIDENCE_TONES.amber}>
                {confidence}% · {candidate.confidence_tier?.label}
              </Badge>
              <LevelBadge level={candidate.minimum_level}>Level {candidate.minimum_level}+</LevelBadge>
              <Badge variant="outline" className="capitalize">{candidate.severity}</Badge>
              {candidate.simulated_source && <Badge variant="outline">Simulation evidence</Badge>}
            </div>
            <h3 className="mt-2 text-sm font-semibold leading-5 text-foreground">{candidate.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {candidate.client_name} · {candidate.device_name || "No endpoint mapped"} · {candidate.source_label}
            </p>
            <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Proposed outcome</p>
              <p className="mt-1 text-xs leading-5 text-foreground/80">{candidate.proposed_action}</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Workflow className="h-3 w-3" />{candidate.runbook || "Runbook not mapped"}</span>
                <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{formatWhen(candidate.detected_at)}</span>
              </div>
              <Button size="sm" onClick={() => onSimulate(candidate)} disabled={simulating}>
                {simulating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1.5 h-3.5 w-3.5" />}
                Simulate plan
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}


function PolicyDialog({ open, onOpenChange, data, onSaved }) {
  const { token } = useAuth();
  const [draft, setDraft] = useState(() => copyPolicy(data.policy));
  const [saving, setSaving] = useState(false);
  const [clientSearch, setClientSearch] = useState("");

  useEffect(() => {
    if (open) setDraft(copyPolicy(data.policy));
  }, [data.policy, open]);

  const headers = { Authorization: `Bearer ${token}` };
  const visibleClients = useMemo(() => {
    const needle = clientSearch.trim().toLowerCase();
    const matches = needle
      ? data.clients.filter((client) => client.name.toLowerCase().includes(needle))
      : data.clients;
    const selected = data.clients.filter((client) => draft.allowed_client_ids.includes(client.id));
    return [...new Map([...selected, ...matches].map((client) => [client.id, client])).values()].slice(0, 8);
  }, [clientSearch, data.clients, draft.allowed_client_ids]);

  const toggleValue = (key, value) => {
    setDraft((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await axios.put(`${API}/autopilot/policy`, draft, { headers });
      toast.success(`Autopilot policy saved · effective Level ${response.data.readiness.effective_level}`);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not save Autopilot policy");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-muted/20 px-6 py-5 pr-14">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-500/25 bg-violet-500/10">
              <Settings2 className="h-5 w-5 text-violet-500" />
            </span>
            <div>
              <DialogTitle>Autopilot policy</DialogTitle>
              <DialogDescription className="mt-1">
                Set the maximum boundary. Live readiness can only lower this level, never raise it.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="max-h-[calc(92vh-156px)] overflow-x-hidden overflow-y-auto px-6 py-5">
          <div className="grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
            <div className="space-y-5">
              <section className="rounded-xl border border-border/60 bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="text-sm font-semibold">Enable governed autonomy</Label>
                    <p className="mt-1 text-xs text-muted-foreground">Disabled keeps Nexus in Observe, regardless of the configured level.</p>
                  </div>
                  <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} />
                </div>
              </section>

              <section>
                <div className="mb-3">
                  <Label className="text-sm font-semibold">Maximum autonomy level</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Choose intent; prerequisites shown in the ladder still apply.</p>
                </div>
                <div className="grid gap-2">
                  {data.readiness.levels.map((level) => (
                    <button
                      key={level.level}
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, configured_level: level.level }))}
                      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${draft.configured_level === level.level ? "border-violet-500/40 bg-violet-500/10 ring-1 ring-violet-500/20" : "border-border/60 bg-card hover:bg-muted/30"}`}
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-semibold ${LEVEL_TONES[level.level]}`}>{level.level}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{level.name} · {level.short_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{level.capability}</span>
                      </span>
                      {draft.configured_level === level.level && <CheckCircle2 className="h-4 w-4 text-violet-500" />}
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-border/60 bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-semibold">Confidence gate</Label>
                    <p className="mt-1 text-xs text-muted-foreground">Below this threshold, a candidate stays with a technician.</p>
                  </div>
                  <Badge variant="outline">{Math.round(draft.confidence_threshold * 100)}%</Badge>
                </div>
                <Slider
                  className="mt-4"
                  min={70}
                  max={99}
                  step={1}
                  value={[Math.round(draft.confidence_threshold * 100)]}
                  onValueChange={([value]) => setDraft((current) => ({ ...current, confidence_threshold: value / 100 }))}
                />
                <div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>70% · human review</span><span>99% · very strict</span></div>
              </section>
            </div>

            <div className="space-y-5">
              <section>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <Label className="text-sm font-semibold">Explicit client scope</Label>
                    <p className="mt-1 text-xs text-muted-foreground">No client is included implicitly.</p>
                  </div>
                  <Badge variant="outline">{draft.allowed_client_ids.length} selected</Badge>
                </div>
                <Input placeholder="Search clients…" value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} />
                <div className="mt-2 grid gap-1 rounded-xl border border-border/60 bg-card p-2">
                  {visibleClients.length ? visibleClients.map((client) => (
                    <label key={client.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted/40">
                      <Checkbox
                        checked={draft.allowed_client_ids.includes(client.id)}
                        onCheckedChange={() => toggleValue("allowed_client_ids", client.id)}
                      />
                      <span className="truncate">{client.name}</span>
                    </label>
                  )) : <p className="p-3 text-center text-xs text-muted-foreground">No matching clients</p>}
                </div>
                {!clientSearch && data.clients.length > visibleClients.length && (
                  <p className="mt-2 text-[11px] text-muted-foreground">Search by name to find {data.clients.length - visibleClients.length} more clients.</p>
                )}
              </section>

              <section>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <Label className="text-sm font-semibold">Action allow-list</Label>
                    <p className="mt-1 text-xs text-muted-foreground">Actions above the effective level remain locked.</p>
                  </div>
                  <Badge variant="outline">{draft.allowed_action_ids.length} selected</Badge>
                </div>
                <div className="grid gap-1 rounded-xl border border-border/60 bg-card p-2">
                  {data.actions.map((action) => (
                    <label key={action.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted/40">
                      <Checkbox
                        checked={draft.allowed_action_ids.includes(action.id)}
                        onCheckedChange={() => toggleValue("allowed_action_ids", action.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{action.label}</span>
                        <span className="block text-[10px] capitalize text-muted-foreground">Level {action.minimum_level}+ · {action.risk} risk</span>
                      </span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-border/60 bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="text-sm font-semibold">Overnight orchestration</Label>
                    <p className="mt-1 text-xs text-muted-foreground">Only pre-approved work inside recorded maintenance controls.</p>
                  </div>
                  <Switch checked={draft.overnight_enabled} onCheckedChange={(overnight_enabled) => setDraft((current) => ({ ...current, overnight_enabled }))} />
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="max-actions" className="text-xs">Maximum actions per run</Label>
                    <Badge variant="outline">{draft.max_actions_per_run}</Badge>
                  </div>
                  <Slider
                    id="max-actions"
                    className="mt-3"
                    min={1}
                    max={10}
                    step={1}
                    value={[draft.max_actions_per_run]}
                    onValueChange={([value]) => setDraft((current) => ({ ...current, max_actions_per_run: value }))}
                  />
                </div>
              </section>
            </div>
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4 text-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
            <p className="text-foreground/80">
              Ticket linkage, maintenance-window controls, simulation, and human approval for protected security, identity, billing, certificate, and containment work are mandatory and cannot be disabled here.
            </p>
          </div>
        </div>
        <DialogFooter className="border-t border-border bg-muted/20 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}
            Save governed policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function SimulationDialog({ simulation, open, onOpenChange }) {
  if (!simulation) return null;
  const ready = simulation.status !== "blocked";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-muted/20 px-6 py-5 pr-14">
          <div className="flex items-start gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${ready ? "border-emerald-500/25 bg-emerald-500/10" : "border-amber-500/25 bg-amber-500/10"}`}>
              {ready ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <AlertTriangle className="h-5 w-5 text-amber-500" />}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>Autopilot simulation</DialogTitle>
                <Badge variant="outline" className="border-cyan-500/25 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">No changes executed</Badge>
              </div>
              <DialogDescription className="mt-1">{simulation.candidate.title}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="max-h-[calc(92vh-150px)] overflow-x-hidden overflow-y-auto px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Result", simulation.status.replaceAll("_", " "), ready ? CheckCircle2 : XCircle],
              ["Boundary", `Level ${simulation.effective_level} effective`, Gauge],
              ["Confidence", `${Math.round(simulation.confidence * 100)}%`, Activity],
              ["Approval", simulation.requires_human_approval ? "Human required" : "Policy governed", ShieldCheck],
            ].map(([label, value, Icon]) => (
              <div key={label} className="rounded-xl border border-border/60 bg-card p-3">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
                <p className="mt-2 text-sm font-semibold capitalize">{value}</p>
              </div>
            ))}
          </div>

          {simulation.blockers.length > 0 && (
            <section className="mt-5 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
                <CircleStop className="h-4 w-4" />Operational handoff blocked
              </div>
              <div className="mt-3 grid gap-2">
                {simulation.blockers.map((blocker) => (
                  <div key={blocker} className="flex items-start gap-2 text-xs leading-5 text-foreground/80">
                    <XCircle className="mt-1 h-3 w-3 shrink-0 text-amber-500" />{blocker}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-5">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-500">Explainable plan</p>
                <h3 className="mt-1 text-base font-semibold">What Nexus would do</h3>
              </div>
              <Badge variant="outline">{simulation.steps.length} steps · {simulation.systems.length} systems</Badge>
            </div>
            <div className="grid gap-3">
              {simulation.steps.map((step, index) => (
                <div key={step.step} className="grid gap-3 rounded-xl border border-border/60 bg-card p-4 md:grid-cols-[42px_1fr]">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10 text-xs font-semibold text-violet-500">{step.step}</span>
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{step.label}</p>
                      <Badge variant="outline">{step.system}</Badge>
                    </div>
                    <div className="mt-3 grid gap-3 text-xs md:grid-cols-[1fr_auto_1fr]">
                      <div className="rounded-lg bg-muted/35 p-3"><p className="mb-1 font-semibold text-muted-foreground">Before</p><p className="leading-5">{step.before}</p></div>
                      <ArrowRight className="hidden h-4 w-4 self-center text-muted-foreground md:block" />
                      <div className="rounded-lg bg-violet-500/[0.06] p-3"><p className="mb-1 font-semibold text-violet-500">Expected after</p><p className="leading-5">{step.after}</p></div>
                    </div>
                    <p className="mt-2 text-[11px] leading-5 text-muted-foreground"><span className="font-semibold text-foreground/70">Recovery:</span> {step.rollback}</p>
                    {index < simulation.steps.length - 1 && <div className="mt-3 h-px bg-border/50" />}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-5 rounded-xl border border-border/60 bg-muted/20 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Approval path</p>
            <p className="mt-2 text-sm font-medium">{simulation.approval_path}</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              This simulation is retained in the Nexus Black Box with its candidate, policy snapshot, technician, correlation ID, blockers, and explicit <code>will_execute: false</code> marker.
            </p>
          </section>
        </div>
        <DialogFooter className="border-t border-border bg-muted/20 px-6 py-4">
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function PauseDialog({ open, onOpenChange, paused, onComplete }) {
  const { token } = useAuth();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const submit = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/autopilot/${paused ? "resume" : "pause"}`, { reason }, { headers });
      toast.success(paused ? "Autopilot resumed inside its readiness boundary" : "Autopilot paused · effective Level 0");
      onOpenChange(false);
      onComplete();
    } catch (error) {
      toast.error(error.response?.data?.detail || `Could not ${paused ? "resume" : "pause"} Autopilot`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{paused ? "Resume Nexus Autopilot" : "Activate the kill switch"}</DialogTitle>
          <DialogDescription>
            {paused
              ? "Autopilot will resume only at the lower of its configured level and current readiness."
              : "Effective autonomy returns to Level 0 immediately. Queued evidence and audit history are preserved."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="autopilot-decision-reason">Decision reason</Label>
          <Textarea
            id="autopilot-decision-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={paused ? "Readiness reviewed and approved operations may resume…" : "Unexpected scope, connector behaviour, incident response…"}
          />
          <p className="text-[11px] text-muted-foreground">Recorded with technician identity, timestamp, and correlation evidence.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={paused ? "default" : "destructive"} onClick={submit} disabled={saving || reason.trim().length < (paused ? 12 : 8)}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : paused ? <PlayCircle className="mr-2 h-4 w-4" /> : <PauseCircle className="mr-2 h-4 w-4" />}
            {paused ? "Resume safely" : "Pause Autopilot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


export default function AutopilotPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [simulation, setSimulation] = useState(null);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [simulatingId, setSimulatingId] = useState("");
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/autopilot/overview`, { headers });
      setData(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not load Nexus Autopilot");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    load();
  }, [load]);

  const simulate = async (candidate) => {
    setSimulatingId(candidate.id);
    try {
      const response = await axios.post(`${API}/autopilot/simulate`, { candidate_id: candidate.id }, { headers });
      setSimulation(response.data);
      setSimulationOpen(true);
      toast.success("Simulation complete · no changes executed");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not simulate this Autopilot plan");
    } finally {
      setSimulatingId("");
    }
  };

  if (loading && !data) {
    return <div className="flex min-h-80 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading governed autonomy…</div>;
  }
  if (!data) return null;

  const activeDefinition = data.levels.find((level) => level.level === data.readiness.effective_level) || data.levels[0];
  const paused = Boolean(data.policy.paused);

  return (
    <div className="space-y-5" data-testid="autopilot-page">
      <section className="overflow-hidden rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.10] via-card to-cyan-500/[0.06] shadow-sm">
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex items-start gap-4">
            <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-violet-500/25 bg-violet-500/10">
              <Bot className="h-6 w-6 text-violet-500" />
              <span className={`absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-background ${paused ? "bg-amber-500" : data.readiness.effective_level > 0 ? "animate-pulse bg-emerald-500" : "bg-zinc-400"}`} />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-500">Nexus Autopilot</p>
                <Badge variant="outline" className="border-cyan-500/20 bg-cyan-500/[0.08] text-cyan-600 dark:text-cyan-300">Simulation first</Badge>
                <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-600 dark:text-emerald-300">Black Box audited</Badge>
              </div>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
                {paused ? "Paused by technician" : `Level ${data.readiness.effective_level} · ${activeDefinition.name}`}
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                Nexus can recommend broadly, but it may only act inside explicit client, action, confidence, approval, maintenance, and volume boundaries.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh evidence</Button>
            <Button variant="outline" size="sm" onClick={() => setPolicyOpen(true)}><Settings2 className="mr-1.5 h-3.5 w-3.5" />Policy</Button>
            <Button variant={paused ? "default" : "destructive"} size="sm" onClick={() => setDecisionOpen(true)}>
              {paused ? <PlayCircle className="mr-1.5 h-3.5 w-3.5" /> : <PauseCircle className="mr-1.5 h-3.5 w-3.5" />}
              {paused ? "Resume" : "Kill switch"}
            </Button>
          </div>
        </div>
        <div className="grid border-t border-border/60 bg-background/30 sm:grid-cols-3">
          {[
            ["Governance", "No direct execution", ShieldCheck],
            ["Protected work", "Human approval always", LockKeyhole],
            ["Live handoff", "Approved automation runtime", Workflow],
          ].map(([label, value, Icon]) => (
            <div key={label} className="flex items-center gap-3 border-b border-border/50 px-5 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
              <Icon className="h-4 w-4 text-violet-500" />
              <div><p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p><p className="text-xs font-medium">{value}</p></div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <HeroTile label="Effective level" value={data.summary.effective_level} icon={Gauge} glow="violet" subtitle={activeDefinition.short_name} testId="autopilot-effective-level" />
        <HeroTile label="Readiness" value={data.readiness.highest_ready_level} icon={ShieldCheck} glow="emerald" subtitle="Highest gated level" testId="autopilot-ready-level" />
        <HeroTile label="Candidates" value={data.summary.candidate_count} icon={Target} glow="cyan" subtitle="Evidence-backed reviews" testId="autopilot-candidates" />
        <HeroTile label="Eligible" value={data.summary.eligible_count} icon={Zap} glow="amber" subtitle="Inside current policy" testId="autopilot-eligible" />
        <HeroTile label="Approvals" value={data.summary.pending_approvals} icon={FileCheck2} glow="rose" subtitle="Awaiting decision" testId="autopilot-approvals" />
        <HeroTile label="Trusted agents" value={data.summary.trusted_agents} icon={Activity} glow="zinc" subtitle={`${data.facts.active_agents} active`} testId="autopilot-trusted-agents" />
      </div>

      <ReadinessLadder readiness={data.readiness} />

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-500">Operational candidates</p>
              <h2 className="mt-1 text-lg font-semibold">Explain first, act only when governed</h2>
              <p className="mt-1 text-sm text-muted-foreground">Every plan is built from retained Nexus evidence and starts as a simulation.</p>
            </div>
            <Badge variant="outline">{data.candidates.length} requiring review</Badge>
          </div>
          <div className="grid gap-3">
            {data.candidates.length ? data.candidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                onSimulate={simulate}
                simulating={simulatingId === candidate.id}
              />
            )) : (
              <Card className="border-dashed border-border/60 bg-card/50">
                <CardContent className="py-12 text-center">
                  <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-500/70" />
                  <p className="mt-3 text-sm font-semibold">No candidates require Autopilot review</p>
                  <p className="mt-1 text-xs text-muted-foreground">Nexus is not fabricating work to fill this queue.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <Card className="border-border/60 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-violet-500" />Recent decisions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {data.history.length ? data.history.map((item) => (
                  <div key={item.id} className="relative border-l border-border pl-4">
                    <span className="absolute -left-1 top-1.5 h-2 w-2 rounded-full bg-violet-500" />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold capitalize">{item.type.replaceAll("_", " ")}</p>
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.summary}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{item.actor} · {formatWhen(item.occurred_at)}</p>
                  </div>
                )) : (
                  <div className="rounded-xl border border-dashed border-border p-5 text-center">
                    <History className="mx-auto h-6 w-6 text-muted-foreground/40" />
                    <p className="mt-2 text-xs text-muted-foreground">Policy changes and simulations will appear here.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-violet-500/20 bg-violet-500/[0.05]">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-violet-500" />What Level 4 means</div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Overnight operations coordinate pre-approved workflows during recorded windows. It does not grant AI unrestricted endpoint, identity, security, or billing access.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>

      <PolicyDialog open={policyOpen} onOpenChange={setPolicyOpen} data={data} onSaved={load} />
      <SimulationDialog simulation={simulation} open={simulationOpen} onOpenChange={setSimulationOpen} />
      <PauseDialog open={decisionOpen} onOpenChange={setDecisionOpen} paused={paused} onComplete={load} />
    </div>
  );
}
