import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, ArrowDown, BellRing, Blocks, Bot, Box, Building2,
  CheckCircle2, ChevronRight, ClipboardCheck, Clock3, Code2, Copy,
  DatabaseBackup, FileClock, FileText, GitBranch, History, Layers3, Loader2,
  LockKeyhole, PackageCheck, Play, Plus, RefreshCw, Save, Search, Settings2,
  ShieldCheck, Sparkles, Trash2, Workflow, XCircle, Zap,
} from "lucide-react";

import { API, useAuth } from "@/App";
import HeroTile from "@/components/HeroTile";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoldToConfirmButton } from "@/components/ui/hold-to-confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const PAGE_TABS = ["studio", "marketplace", "runtime", "simulations"];
const EMPTY_CREATE = { name: "", description: "", category: "Custom" };
const RISK_STYLE = {
  low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200",
  high: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200",
};
const STATUS_STYLE = {
  ready_for_approval: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200",
  safe_to_run: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
  blocked: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200",
};
const CATEGORY_ICON = {
  Flow: GitBranch,
  AI: Bot,
  Governance: ShieldCheck,
  Tickets: ClipboardCheck,
  Communications: Activity,
  "Managed assets": Settings2,
  "Microsoft 365": Layers3,
  Voice: Zap,
  Documentation: FileClock,
  Integrations: Blocks,
};
const PACK_KIND = {
  workflow: { label: "Automation", icon: Workflow, tone: "text-cyan-300 bg-cyan-500/10 border-cyan-500/20" },
  ticket_blueprint: { label: "Ticket blueprint", icon: ClipboardCheck, tone: "text-sky-300 bg-sky-500/10 border-sky-500/20" },
  documentation_template: { label: "Document template", icon: FileText, tone: "text-violet-300 bg-violet-500/10 border-violet-500/20" },
  policy: { label: "Monitoring policy", icon: Settings2, tone: "text-amber-300 bg-amber-500/10 border-amber-500/20" },
  security_baseline: { label: "Security baseline", icon: ShieldCheck, tone: "text-rose-300 bg-rose-500/10 border-rose-500/20" },
  backup_policy: { label: "Recovery policy", icon: DatabaseBackup, tone: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20" },
  alert_rule: { label: "Alert rule", icon: BellRing, tone: "text-orange-300 bg-orange-500/10 border-orange-500/20" },
};
const PACK_LIFECYCLE = ["Discover", "Install", "Configure", "Simulate", "Approve", "Active"];
const titleCase = (value) => String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const readableDate = (value) => value ? new Date(value).toLocaleString() : "Not yet";

function packLifecycleIndex(pack) {
  if (!pack?.installed) return 0;
  const status = pack.status || "configuration_required";
  if (status === "active") return 5;
  if (status === "approved") return 4;
  if (status === "simulation_complete" || status === "pending_review") return 3;
  return 2;
}

function StepCard({ action, index, definition, onRemove, onConfig }) {
  const Icon = CATEGORY_ICON[definition?.category] || Zap;
  return (
    <div className="relative rounded-xl border border-border/80 bg-card/80 p-4" data-testid={`automation-step-${index + 1}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
            <Icon className="h-4 w-4 text-emerald-300" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{definition?.label || titleCase(action.type)}</p>
              <Badge variant="outline" className="text-[10px]">Step {index + 1}</Badge>
              <Badge variant="outline" className={RISK_STYLE[(definition?.risk || 0) >= 4 ? "high" : (definition?.risk || 0) >= 2 ? "medium" : "low"]}>
                {(definition?.risk || 0) >= 4 ? "High" : (definition?.risk || 0) >= 2 ? "Medium" : "Low"} risk
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{definition?.category || "Automation"} · rollback captured automatically</p>
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onRemove(action.id)} aria-label={`Remove ${definition?.label || action.type}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {!!definition?.fields?.length && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {definition.fields.map((field) => (
            <div key={field}>
              <Label className="text-[11px] text-muted-foreground">{titleCase(field)}</Label>
              <Input
                className="mt-1 h-9 text-xs"
                value={action.config?.[field] || ""}
                onChange={(event) => onConfig(action.id, field, event.target.value)}
                placeholder={`Set ${titleCase(field).toLowerCase()}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SimulationDialog({ simulation, open, onOpenChange, onSubmit, submitting }) {
  const [justification, setJustification] = useState("");
  useEffect(() => { if (open) setJustification(""); }, [open, simulation?.id]);
  if (!simulation) return null;
  const gaps = simulation.summary?.configuration_gaps || 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0" data-testid="simulation-results-dialog">
        <div className="border-b border-border/80 bg-gradient-to-br from-slate-950 via-slate-950 to-cyan-950/40 px-6 py-5">
          <DialogHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Safe execution preview · no changes made</p>
                <DialogTitle className="mt-2 flex items-center gap-2 text-xl"><Sparkles className="h-5 w-5 text-cyan-300" />Simulation Mode</DialogTitle>
                <DialogDescription className="mt-2">{simulation.workflow_name} · {simulation.id}</DialogDescription>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline" className={RISK_STYLE[simulation.risk_level]}>{titleCase(simulation.risk_level)} risk</Badge>
                <Badge variant="outline" className={STATUS_STYLE[simulation.status]}>{titleCase(simulation.status)}</Badge>
              </div>
            </div>
          </DialogHeader>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Proposed steps", simulation.summary?.steps || 0],
              ["Systems touched", simulation.summary?.systems || 0],
              ["Config gaps", gaps],
              ["Executed", "No"],
            ].map(([label, value]) => <div key={label} className="rounded-lg border border-white/10 bg-white/[0.035] p-3"><p className="text-lg font-semibold">{value}</p><p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p></div>)}
          </div>
        </div>
        <ScrollArea className="max-h-[55vh]">
          <div className="space-y-5 p-6">
            {gaps > 0 && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
                <p className="flex items-center gap-2 font-medium text-amber-100"><AlertTriangle className="h-4 w-4" />Configuration required before approval</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {simulation.missing_configuration?.flatMap((item) => item.fields.map((field) => <Badge key={`${item.step}-${field}`} variant="outline" className="border-amber-500/25 text-amber-200">Step {item.step}: {titleCase(field)}</Badge>))}
                </div>
              </div>
            )}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Predicted change plan</p>
              <div className="mt-3 space-y-3">
                {simulation.steps?.map((step) => (
                  <div key={step.step} className="rounded-xl border border-border/80 bg-muted/[0.08] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{step.step}. {step.label}</p>
                      <Badge variant="outline" className={RISK_STYLE[step.risk]}>{titleCase(step.risk)} risk</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Target: {String(step.target)}</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <div className="rounded-lg border border-border/70 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Before</p><p className="mt-1 text-xs text-muted-foreground">{step.before}</p></div>
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">After</p><p className="mt-1 text-xs text-muted-foreground">{step.after}</p></div>
                      <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/[0.04] p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Rollback</p><p className="mt-1 text-xs text-muted-foreground">{step.rollback}</p></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {simulation.requires_approval && !gaps && (
              <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.05] p-4">
                <Label>Approval justification or CAB reference</Label>
                <Textarea className="mt-2" rows={3} value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="Explain why this automation should proceed and the validation expected after execution." />
                <p className="mt-2 text-xs text-muted-foreground">Submitting creates a linked Change Management record. It does not execute the workflow.</p>
              </div>
            )}
          </div>
        </ScrollArea>
        <DialogFooter className="border-t border-border/80 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close preview</Button>
          {simulation.requires_approval && !gaps && <Button onClick={() => onSubmit(justification)} disabled={submitting || justification.trim().length < 8}>{submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Submit to Change Management</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PackPreviewDialog({
  pack,
  open,
  onOpenChange,
  clients,
  scope,
  setScope,
  clientId,
  setClientId,
  installing,
  removing,
  onInstall,
  onRemove,
  onConfigure,
}) {
  if (!pack) return null;
  const lifecycleIndex = packLifecycleIndex(pack);
  const installedRefs = pack.installation?.artifact_refs || [];
  const artifacts = installedRefs.length ? installedRefs : (pack.artifacts || []);
  const canInstall = scope !== "client" || !!clientId;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-hidden p-0" data-testid="workflow-pack-preview-dialog">
        <div className="border-b border-border/80 bg-gradient-to-br from-violet-950/85 via-slate-950 to-cyan-950/55 px-6 py-5">
          <DialogHeader>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-violet-400/25 bg-violet-400/10 shadow-[0_0_32px_-12px_rgba(167,139,250,0.9)]">
                  {pack.industry ? <Building2 className="h-6 w-6 text-violet-200" /> : <Box className="h-6 w-6 text-violet-200" />}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">Nexus verified · v{pack.version}</p>
                  <DialogTitle className="mt-1 text-2xl">{pack.name}</DialogTitle>
                  <DialogDescription className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{pack.outcome}</DialogDescription>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {pack.industry && <Badge variant="outline" className="border-violet-400/30 bg-violet-400/10 text-violet-100">{pack.industry}</Badge>}
                <Badge variant="outline" className={pack.installed ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"}>
                  {pack.installed ? <><CheckCircle2 className="mr-1 h-3 w-3" />{titleCase(pack.status)}</> : "Available"}
                </Badge>
              </div>
            </div>
          </DialogHeader>

          <div className="mt-5 grid grid-cols-6 gap-1.5" aria-label="Pack lifecycle">
            {PACK_LIFECYCLE.map((label, index) => {
              const complete = index <= lifecycleIndex;
              return (
                <div key={label} className={`rounded-lg border px-2 py-2 text-center ${complete ? "border-cyan-400/25 bg-cyan-400/[0.10]" : "border-white/[0.07] bg-white/[0.025]"}`}>
                  <div className={`mx-auto mb-1 h-1.5 w-1.5 rounded-full ${complete ? "bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.9)]" : "bg-slate-700"}`} />
                  <p className={`text-[9px] font-semibold uppercase tracking-wider ${complete ? "text-cyan-100" : "text-slate-500"}`}>{label}</p>
                </div>
              );
            })}
          </div>
        </div>

        <ScrollArea className="max-h-[60vh]">
          <div className="grid gap-5 p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-5">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">Everything included</p>
                    <p className="mt-1 text-xs text-muted-foreground">{pack.component_total} connected components install together; none are activated automatically.</p>
                  </div>
                  <Badge variant="outline">{pack.steps} automation steps</Badge>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {artifacts.map((artifact, index) => {
                    const meta = PACK_KIND[artifact.kind] || PACK_KIND.workflow;
                    const Icon = meta.icon;
                    return (
                      <div key={`${artifact.kind}-${artifact.id || artifact.name}-${index}`} className="flex gap-3 rounded-xl border border-border/75 bg-muted/[0.055] p-3">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${meta.tone}`}><Icon className="h-4 w-4" /></div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-xs font-semibold">{artifact.name}</p>
                            {artifact.state && <Badge variant="outline" className="text-[8px]">{titleCase(artifact.state)}</Badge>}
                          </div>
                          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{artifact.description || meta.label}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold">Automation sequence</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {(pack.actions || []).map((action, index) => (
                    <div key={`${action.type}-${index}`} className="flex items-center gap-1.5">
                      <span className="rounded-lg border border-border/70 bg-card px-2.5 py-1.5 text-[10px] font-medium">{index + 1}. {titleCase(action.type)}</span>
                      {index < pack.actions.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
                    </div>
                  ))}
                </div>
              </div>

              {!pack.installed && (
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.035] p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-cyan-100"><LockKeyhole className="h-4 w-4" />Choose the installation scope</p>
                  <p className="mt-1 text-xs text-muted-foreground">Scope is written into every generated draft and the Black Box event. It can be narrowed again before approval.</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Applies to</Label>
                      <Select value={scope} onValueChange={(value) => { setScope(value); if (value !== "client") setClientId(""); }}>
                        <SelectTrigger className="mt-1" data-testid="workflow-pack-scope"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="all_clients">All clients · reusable baseline</SelectItem><SelectItem value="client">One client · dedicated copy</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Client</Label>
                      <Select value={clientId || "__none"} onValueChange={(value) => setClientId(value === "__none" ? "" : value)} disabled={scope !== "client"}>
                        <SelectTrigger className="mt-1" data-testid="workflow-pack-client"><SelectValue placeholder="Choose a client" /></SelectTrigger>
                        <SelectContent><SelectItem value="__none">Choose a client…</SelectItem>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <Card className="border-emerald-500/20 bg-emerald-500/[0.035]">
                <CardContent className="space-y-3 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-emerald-100"><ShieldCheck className="h-4 w-4" />Trust contract</p>
                  {[
                    ["External changes on install", "None"],
                    ["Initial state", "Disabled drafts"],
                    ["Simulation", "Required"],
                    ["Independent approval", "Required"],
                    ["Rollback", "Declared per step"],
                  ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 border-t border-emerald-500/10 pt-2 text-[11px]"><span className="text-muted-foreground">{label}</span><span className="font-medium text-emerald-100">{value}</span></div>)}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-3 p-4">
                  <div><p className="text-xs font-semibold">Connections to verify</p><div className="mt-2 flex flex-wrap gap-1.5">{pack.required_connections?.map((item) => <Badge key={item} variant="outline" className="text-[9px]">{item}</Badge>)}</div></div>
                  <Separator />
                  <div><p className="text-xs font-semibold">Declared permissions</p><div className="mt-2 space-y-1.5">{pack.permissions?.map((item) => <p key={item} className="flex items-start gap-2 text-[10px] text-muted-foreground"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-cyan-300" />{item}</p>)}</div></div>
                  <Separator />
                  <p className="text-[10px] leading-4 text-muted-foreground">Estimated configuration: {pack.estimated_setup_minutes} minutes. Provider credentials remain in Settings and are never copied into marketplace metadata.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="border-t border-border/80 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {pack.installed ? (
            <>
              <HoldToConfirmButton
                variant="destructive"
                size="sm"
                duration={1100}
                onComplete={() => onRemove(pack)}
                disabled={removing === pack.id}
                holdingLabel="Keep holding to remove"
                completeLabel="Removal confirmed"
                data-testid="workflow-pack-remove"
              >{removing === pack.id ? "Removing…" : "Hold to remove pack"}</HoldToConfirmButton>
              <Button onClick={() => onConfigure(pack)}><Settings2 className="mr-1.5 h-4 w-4" />Configure installed pack</Button>
            </>
          ) : (
            <Button onClick={() => onInstall(pack)} disabled={!canInstall || installing === pack.id} data-testid="workflow-pack-install">
              {installing === pack.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}
              Install {pack.component_total} disabled drafts
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function WorkflowAutomationPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState(PAGE_TABS.includes(requestedTab) ? requestedTab : "studio");
  const [workflows, setWorkflows] = useState([]);
  const [triggers, setTriggers] = useState([]);
  const [actions, setActions] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [simulations, setSimulations] = useState([]);
  const [runs, setRuns] = useState([]);
  const [runtimeHealth, setRuntimeHealth] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const [runReason, setRunReason] = useState("");
  const [runtimeBusy, setRuntimeBusy] = useState("");
  const [clients, setClients] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [packSearch, setPackSearch] = useState("");
  const [packFilter, setPackFilter] = useState("All packs");
  const [packPreview, setPackPreview] = useState(null);
  const [packScope, setPackScope] = useState("all_clients");
  const [packClientId, setPackClientId] = useState("");
  const [editWf, setEditWf] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteWorkflowOpen, setDeleteWorkflowOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState("");
  const [removing, setRemoving] = useState("");
  const [simulation, setSimulation] = useState(null);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [simulationClientId, setSimulationClientId] = useState("");
  const [simulationTarget, setSimulationTarget] = useState("");
  const [editorMode, setEditorMode] = useState("visual");
  const [codeDraft, setCodeDraft] = useState("");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [wfResult, triggerResult, actionResult, statsResult, templateResult, simulationResult, clientResult, runResult, runtimeResult] = await Promise.all([
        axios.get(`${API}/workflows`, { headers }),
        axios.get(`${API}/workflows/triggers`, { headers }),
        axios.get(`${API}/workflows/actions`, { headers }),
        axios.get(`${API}/workflows/stats/overview`, { headers }),
        axios.get(`${API}/workflows/templates`, { headers }),
        axios.get(`${API}/workflows/simulations/recent`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/workflows/runs?limit=150`, { headers }),
        axios.get(`${API}/workflows/runtime/health`, { headers }),
      ]);
      setWorkflows(wfResult.data || []);
      setTriggers(triggerResult.data || []);
      setActions(actionResult.data || []);
      setStats(statsResult.data || null);
      setTemplates(templateResult.data || []);
      setSimulations(simulationResult.data || []);
      setClients(clientResult.data || []);
      setRuns(runResult.data || []);
      setRuntimeHealth(runtimeResult.data || null);
      setSelectedRun((current) => current ? (runResult.data || []).find((item) => item.id === current.id) || current : null);
      setEditWf((current) => {
        if (!current) return wfResult.data?.[0] || null;
        return wfResult.data?.find((item) => item.id === current.id) || current;
      });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Automation Studio could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const next = PAGE_TABS.includes(requestedTab) ? requestedTab : "studio";
    setTab(next);
  }, [requestedTab]);
  useEffect(() => {
    if (!editWf) { setCodeDraft(""); return; }
    setCodeDraft(JSON.stringify({ trigger: editWf.trigger || {}, conditions: editWf.conditions || [], actions: editWf.actions || [] }, null, 2));
  }, [editWf?.id, editorMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectTab = (next) => {
    setTab(next);
    navigate(next === "studio" ? "/workflow-automation" : `/workflow-automation?tab=${next}`, { replace: true });
  };
  const chooseWorkflow = (workflow) => {
    setEditWf(workflow);
    setEditorMode("visual");
    setSimulation(null);
  };
  const createWorkflow = async () => {
    if (createForm.name.trim().length < 3) { toast.error("Enter a clear workflow name"); return; }
    setSaving(true);
    try {
      const response = await axios.post(`${API}/workflows`, createForm, { headers });
      toast.success("Draft workflow created");
      setShowCreate(false);
      setCreateForm(EMPTY_CREATE);
      await load({ quiet: true });
      setEditWf(response.data);
      selectTab("studio");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Workflow could not be created");
    } finally { setSaving(false); }
  };
  const saveWorkflow = async ({ quiet = false } = {}) => {
    if (!editWf) return false;
    setSaving(true);
    try {
      await axios.put(`${API}/workflows/${editWf.id}`, editWf, { headers });
      if (!quiet) toast.success("Workflow draft saved");
      await load({ quiet: true });
      return true;
    } catch (error) {
      toast.error(error.response?.data?.detail || "Workflow could not be saved");
      return false;
    } finally { setSaving(false); }
  };
  const applyCodeDraft = () => {
    try {
      const parsed = JSON.parse(codeDraft);
      setEditWf((current) => ({ ...current, trigger: parsed.trigger || {}, conditions: parsed.conditions || [], actions: parsed.actions || [] }));
      toast.success("JSON contract applied to the draft");
      setEditorMode("visual");
    } catch {
      toast.error("The JSON contract is not valid");
    }
  };
  const addAction = (type) => {
    setEditWf((current) => ({ ...current, actions: [...(current.actions || []), { id: `act-${Date.now()}`, type, config: {} }] }));
  };
  const removeAction = (id) => setEditWf((current) => ({ ...current, actions: (current.actions || []).filter((item) => item.id !== id) }));
  const updateActionConfig = (id, field, value) => setEditWf((current) => ({
    ...current,
    actions: (current.actions || []).map((item) => item.id === id ? { ...item, config: { ...(item.config || {}), [field]: value } } : item),
  }));
  const addCondition = () => setEditWf((current) => ({ ...current, conditions: [...(current.conditions || []), { field: "", operator: "equals", value: "" }] }));
  const updateCondition = (index, field, value) => setEditWf((current) => ({ ...current, conditions: (current.conditions || []).map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }));
  const removeCondition = (index) => setEditWf((current) => ({ ...current, conditions: (current.conditions || []).filter((_, itemIndex) => itemIndex !== index) }));
  const installPack = async (pack) => {
    setInstalling(pack.id);
    try {
      const response = await axios.post(`${API}/workflows/templates/${pack.id}/install`, {
        scope: packScope,
        client_id: packScope === "client" ? packClientId : null,
      }, { headers });
      const installedCount = response.data?.installation?.component_total || pack.component_total || 1;
      toast.success(`${pack.name} installed`, {
        description: `${installedCount} governed components are disabled and ready to configure.`,
      });
      await load({ quiet: true });
      setEditWf(response.data?.workflow || response.data);
      setPackPreview(null);
      selectTab("studio");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Automation pack could not be installed");
    } finally { setInstalling(""); }
  };
  const removePack = async (pack) => {
    setRemoving(pack.id);
    try {
      const response = await axios.delete(`${API}/workflows/templates/${pack.id}/install`, { headers });
      toast.success(`${pack.name} removed`, {
        description: `${response.data?.removed_components || pack.component_total || 0} components disabled; Black Box evidence preserved.`,
      });
      if (editWf?.source_pack_id === pack.id) setEditWf(null);
      setPackPreview(null);
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Automation pack could not be removed");
    } finally { setRemoving(""); }
  };
  const configurePack = (pack) => {
    const workflow = workflows.find((item) => item.id === pack.workflow_id || item.source_pack_id === pack.id);
    if (!workflow) {
      toast.error("The installed workflow could not be found. Refresh the marketplace and try again.");
      return;
    }
    setEditWf(workflow);
    setPackPreview(null);
    selectTab("studio");
  };
  const previewPack = (pack) => {
    setPackPreview(pack);
    setPackScope(pack.installation?.scope?.type || "all_clients");
    setPackClientId(pack.installation?.scope?.client_id || "");
  };
  const runSimulation = async () => {
    if (!editWf) return;
    setSimulating(true);
    try {
      const saved = await saveWorkflow({ quiet: true });
      if (!saved) return;
      const client = clients.find((item) => item.id === simulationClientId);
      const response = await axios.post(`${API}/workflows/${editWf.id}/simulate`, {
        context: { client_id: simulationClientId, client_name: client?.name || "", target_name: simulationTarget },
      }, { headers });
      setSimulation(response.data);
      setSimulationOpen(true);
      toast.success("Simulation complete — no changes were made");
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Simulation could not be completed");
    } finally { setSimulating(false); }
  };
  const submitApproval = async (justification) => {
    if (!editWf || !simulation) return;
    setSubmitting(true);
    try {
      const response = await axios.post(`${API}/workflows/${editWf.id}/submit-approval`, {
        simulation_id: simulation.id,
        justification,
        client_id: simulationClientId,
      }, { headers });
      toast.success(`${response.data.id} submitted to Change Management`);
      setSimulationOpen(false);
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Approval request could not be submitted");
    } finally { setSubmitting(false); }
  };
  const toggleWorkflow = async (workflow) => {
    try {
      const response = await axios.post(`${API}/workflows/${workflow.id}/toggle`, {}, { headers });
      toast.success(response.data.enabled ? "Workflow enabled" : "Workflow paused");
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Workflow state could not be changed");
    }
  };
  const deleteWorkflow = async (confirmed = false) => {
    if (!editWf) return;
    if (!confirmed) {
      setDeleteWorkflowOpen(true);
      return;
    }
    try {
      await axios.delete(`${API}/workflows/${editWf.id}`, { headers });
      toast.success("Workflow deleted");
      setDeleteWorkflowOpen(false);
      setEditWf(null);
      await load({ quiet: true });
    } catch (error) { toast.error(error.response?.data?.detail || "Workflow could not be deleted"); }
  };
  const copyWorkflow = async (workflow) => {
    try {
      const response = await axios.post(`${API}/workflows`, { ...workflow, name: `${workflow.name} copy`, enabled: false }, { headers });
      toast.success("Workflow copied as a disabled draft");
      await load({ quiet: true });
      setEditWf(response.data);
    } catch (error) { toast.error(error.response?.data?.detail || "Workflow could not be copied"); }
  };
  const queueWorkflow = async () => {
    if (!editWf) return;
    setRuntimeBusy("queue");
    try {
      const client = clients.find((item) => item.id === simulationClientId);
      const response = await axios.post(`${API}/workflows/${editWf.id}/run`, {
        context: { client_id: simulationClientId, client_name: client?.name || "", target_name: simulationTarget },
      }, { headers });
      toast.success(`${response.data.id} durably queued`);
      await load({ quiet: true });
      setSelectedRun(response.data);
      selectTab("runtime");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Workflow could not be queued");
    } finally { setRuntimeBusy(""); }
  };
  const runControl = async (action) => {
    if (!selectedRun) return;
    if (runReason.trim().length < 8) { toast.error("Record a clear reason of at least 8 characters"); return; }
    setRuntimeBusy(action);
    try {
      const response = await axios.post(`${API}/workflows/runs/${selectedRun.id}/${action}`, { reason: runReason }, { headers });
      toast.success(action === "approve" ? "Run approved and resumed" : action === "reject" ? "Run rejected" : action === "retry" ? "Run queued for retry" : "Compensation completed");
      setRunReason("");
      await load({ quiet: true });
      if (action === "compensate") setSelectedRun((current) => ({ ...current, compensation_status: response.data.status, compensation: response.data }));
    } catch (error) {
      toast.error(error.response?.data?.detail || `Run could not ${action}`);
    } finally { setRuntimeBusy(""); }
  };

  const filteredWorkflows = workflows.filter((item) => [item.name, item.description, item.category].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()));
  const packFilters = ["All packs", "Installed", "Industry blueprints", ...new Set(templates.filter((item) => !item.industry).map((item) => item.category))];
  const filteredPacks = templates.filter((item) => {
    const text = [item.name, item.description, item.outcome, item.category, item.industry, ...(item.required_connections || [])].filter(Boolean).join(" ").toLowerCase();
    const filterMatch = packFilter === "All packs"
      || (packFilter === "Installed" && item.installed)
      || (packFilter === "Industry blueprints" && item.industry)
      || item.category === packFilter;
    return filterMatch && text.includes(packSearch.toLowerCase());
  });

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-cyan-300" /></div>;

  return (
    <div className="space-y-6" data-testid="automation-studio-page">
      <OperationalPageHeader
        eyebrow="Automation workspace · governed orchestration"
        title="Automation Studio"
        description="Build no-code or JSON workflows, install verified packs, preview every outcome, and hand material changes into an independent approval trail."
        icon={Workflow}
        tone="cyan"
        actions={<>
          <Button variant="outline" size="sm" onClick={() => navigate("/change-management")}><ShieldCheck className="mr-1.5 h-4 w-4" />Change Management</Button>
          <Button variant="outline" size="sm" onClick={() => load()}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh</Button>
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="mr-1.5 h-4 w-4" />New workflow</Button>
        </>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <HeroTile label="Workflows" value={stats?.total || 0} icon={Workflow} glow="cyan" subtitle="Governed definitions" onClick={() => selectTab("studio")} active={tab === "studio"} />
        <HeroTile label="Enabled" value={stats?.active || 0} icon={Zap} glow="emerald" subtitle="Approved and active" />
        <HeroTile label="Installed packs" value={stats?.installed_packs || 0} icon={PackageCheck} glow="violet" subtitle="Nexus verified" onClick={() => selectTab("marketplace")} active={tab === "marketplace"} />
        <HeroTile label="Simulations" value={stats?.simulations || 0} icon={Sparkles} glow="sky" subtitle="Zero-change previews" onClick={() => selectTab("simulations")} active={tab === "simulations"} />
        <HeroTile label="Awaiting approval" value={stats?.pending_approvals || 0} icon={ClipboardCheck} glow={(stats?.pending_approvals || 0) ? "amber" : "zinc"} subtitle="Change review queue" onClick={() => navigate("/change-management")} />
        <HeroTile label="Runtime" value={runtimeHealth?.active || 0} icon={Activity} glow={(runtimeHealth?.failed || 0) ? "rose" : "indigo"} subtitle={`${runtimeHealth?.failed || 0} failed · ${runtimeHealth?.completed || 0} completed`} onClick={() => selectTab("runtime")} active={tab === "runtime"} />
      </div>

      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="grid w-full grid-cols-4 lg:w-[820px]">
          <TabsTrigger value="studio"><Workflow className="mr-1.5 h-4 w-4" />Studio</TabsTrigger>
          <TabsTrigger value="marketplace"><Box className="mr-1.5 h-4 w-4" />Automation Marketplace</TabsTrigger>
          <TabsTrigger value="runtime"><Activity className="mr-1.5 h-4 w-4" />Runtime</TabsTrigger>
          <TabsTrigger value="simulations"><History className="mr-1.5 h-4 w-4" />Simulation history</TabsTrigger>
        </TabsList>

        <TabsContent value="studio" className="mt-5">
          <div className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-border/70 pb-3">
                <div className="flex items-center justify-between gap-3"><CardTitle className="text-base">Workflow library</CardTitle><Badge variant="outline">{filteredWorkflows.length}</Badge></div>
                <div className="relative mt-2"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search workflows" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
              </CardHeader>
              <ScrollArea className="h-[680px]">
                <CardContent className="space-y-2 p-3">
                  {filteredWorkflows.map((workflow) => (
                    <button key={workflow.id} type="button" onClick={() => chooseWorkflow(workflow)} className={`w-full rounded-xl border p-3 text-left transition-all ${editWf?.id === workflow.id ? "border-cyan-500/40 bg-cyan-500/[0.07] shadow-sm shadow-cyan-500/10" : "border-border/70 hover:border-cyan-500/25 hover:bg-muted/20"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{workflow.name}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{workflow.description || "No description recorded"}</p></div>
                        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${workflow.enabled ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.65)]" : "bg-slate-600"}`} />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[9px]">{titleCase(workflow.trigger?.type || "No trigger")}</Badge>
                        <Badge variant="outline" className="text-[9px]">{workflow.actions?.length || 0} steps</Badge>
                        {workflow.source_pack_id && <Badge variant="outline" className="border-violet-500/25 text-[9px] text-violet-200">Pack</Badge>}
                      </div>
                    </button>
                  ))}
                  {!filteredWorkflows.length && <div className="py-12 text-center"><Workflow className="mx-auto h-8 w-8 text-muted-foreground/40" /><p className="mt-3 text-sm text-muted-foreground">No matching workflows</p></div>}
                </CardContent>
              </ScrollArea>
            </Card>

            {editWf ? (
              <Card className="overflow-hidden" data-testid="workflow-editor">
                <div className="border-b border-border/80 bg-gradient-to-r from-slate-950/80 to-cyan-950/20 p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <Input value={editWf.name || ""} onChange={(event) => setEditWf((current) => ({ ...current, name: event.target.value }))} className="h-auto border-0 bg-transparent p-0 text-xl font-semibold shadow-none focus-visible:ring-0" />
                      <Input value={editWf.description || ""} onChange={(event) => setEditWf((current) => ({ ...current, description: event.target.value }))} className="mt-2 h-auto border-0 bg-transparent p-0 text-sm text-muted-foreground shadow-none focus-visible:ring-0" placeholder="Explain the business outcome and intended scope" />
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{editWf.category || "Custom"}</Badge>
                        <Badge variant="outline" className={editWf.approval_status === "approved" ? RISK_STYLE.low : editWf.approval_status === "pending_review" ? RISK_STYLE.medium : ""}>{titleCase(editWf.approval_status || "Draft")}</Badge>
                        <span className="text-xs text-muted-foreground">Last simulated {readableDate(editWf.last_simulated_at)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => copyWorkflow(editWf)}><Copy className="mr-1.5 h-3.5 w-3.5" />Copy</Button>
                      <Button variant="outline" size="sm" onClick={() => saveWorkflow()} disabled={saving}><Save className="mr-1.5 h-3.5 w-3.5" />Save draft</Button>
                      <Button size="sm" onClick={runSimulation} disabled={saving || simulating}><Sparkles className="mr-1.5 h-3.5 w-3.5" />{simulating ? "Simulating…" : "Simulate"}</Button>
                      <Button size="sm" variant="outline" onClick={queueWorkflow} disabled={runtimeBusy === "queue" || !editWf.enabled || !["approved", "not_required"].includes(editWf.approval_status)}>
                        {runtimeBusy === "queue" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}Run now
                      </Button>
                    </div>
                  </div>
                </div>

                <CardContent className="space-y-5 p-5">
                  <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/[0.06] p-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="grid flex-1 gap-3 sm:grid-cols-2">
                      <div>
                        <Label>Simulation client context</Label>
                        <Select value={simulationClientId || "none"} onValueChange={(value) => setSimulationClientId(value === "none" ? "" : value)}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Internal or choose client" /></SelectTrigger>
                          <SelectContent><SelectItem value="none">Internal / no client</SelectItem>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div><Label>Target or person</Label><Input className="mt-1" value={simulationTarget} onChange={(event) => setSimulationTarget(event.target.value)} placeholder="Optional user, asset, site, or request" /></div>
                    </div>
                    <div className="flex items-center gap-2"><Switch checked={!!editWf.enabled} onCheckedChange={() => toggleWorkflow(editWf)} /><div><p className="text-sm font-medium">Enabled</p><p className="text-[10px] text-muted-foreground">Requires simulation and approval</p></div></div>
                  </div>

                  <Tabs value={editorMode} onValueChange={setEditorMode}>
                    <TabsList><TabsTrigger value="visual"><Blocks className="mr-1.5 h-4 w-4" />Visual builder</TabsTrigger><TabsTrigger value="code"><Code2 className="mr-1.5 h-4 w-4" />JSON contract</TabsTrigger></TabsList>
                    <TabsContent value="visual" className="mt-5 space-y-4">
                      <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.05] p-4">
                        <div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10"><Zap className="h-4 w-4 text-cyan-300" /></div><div><p className="font-medium">Trigger</p><p className="text-xs text-muted-foreground">The observed event that starts this workflow</p></div></div>
                        <Select value={editWf.trigger?.type || "none"} onValueChange={(value) => setEditWf((current) => ({ ...current, trigger: value === "none" ? {} : { ...(current.trigger || {}), type: value } }))}>
                          <SelectTrigger className="mt-3" data-testid="automation-trigger-select"><SelectValue placeholder="Choose a trigger" /></SelectTrigger>
                          <SelectContent><SelectItem value="none">Choose a trigger</SelectItem>{triggers.map((trigger) => <SelectItem key={trigger.id} value={trigger.id}>{trigger.label} · {trigger.category}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>

                      <div className="flex justify-center"><ArrowDown className="h-5 w-5 text-cyan-400/60" /></div>

                      <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.035] p-4">
                        <div className="flex items-center justify-between gap-3"><div><p className="font-medium">Conditions</p><p className="text-xs text-muted-foreground">Only continue when observed evidence matches</p></div><Button variant="outline" size="sm" onClick={addCondition}><Plus className="mr-1 h-3.5 w-3.5" />Condition</Button></div>
                        <div className="mt-3 space-y-2">
                          {(editWf.conditions || []).map((condition, index) => (
                            <div key={`condition-${index}`} className="grid gap-2 rounded-lg border border-border/70 bg-background/40 p-3 sm:grid-cols-[1fr_160px_1fr_36px]">
                              <Input value={condition.field || ""} onChange={(event) => updateCondition(index, "field", event.target.value)} placeholder="Event field" />
                              <Select value={condition.operator || "equals"} onValueChange={(value) => updateCondition(index, "operator", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["equals", "not_equals", "contains", "greater_than", "less_than", "is_empty", "is_not_empty"].map((operator) => <SelectItem key={operator} value={operator}>{titleCase(operator)}</SelectItem>)}</SelectContent></Select>
                              <Input value={condition.value || ""} onChange={(event) => updateCondition(index, "value", event.target.value)} placeholder="Expected value" />
                              <Button variant="ghost" size="icon" onClick={() => removeCondition(index)}><XCircle className="h-4 w-4" /></Button>
                            </div>
                          ))}
                          {!(editWf.conditions || []).length && <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No conditions — every matching trigger will proceed to simulation or execution.</p>}
                        </div>
                      </div>

                      <div className="flex justify-center"><ArrowDown className="h-5 w-5 text-emerald-400/60" /></div>

                      <div>
                        <div className="flex items-center justify-between gap-3"><div><p className="font-medium">Actions</p><p className="text-xs text-muted-foreground">Ordered, independently auditable steps with rollback metadata</p></div><Badge variant="outline">{editWf.actions?.length || 0} steps</Badge></div>
                        <div className="mt-3 space-y-3">
                          {(editWf.actions || []).map((action, index) => <StepCard key={action.id || index} action={action} index={index} definition={actions.find((item) => item.id === action.type)} onRemove={removeAction} onConfig={updateActionConfig} />)}
                        </div>
                        <Select onValueChange={addAction}>
                          <SelectTrigger className="mt-3 border-dashed border-emerald-500/30 text-emerald-200" data-testid="automation-add-action"><SelectValue placeholder="+ Add AI, approval, action, notification, or documentation step" /></SelectTrigger>
                          <SelectContent>{[...new Set(actions.map((item) => item.category))].map((category) => <div key={category}><p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{category}</p>{actions.filter((item) => item.category === category).map((action) => <SelectItem key={action.id} value={action.id}>{action.label}</SelectItem>)}</div>)}</SelectContent>
                        </Select>
                      </div>
                    </TabsContent>
                    <TabsContent value="code" className="mt-5">
                      <div className="rounded-xl border border-border/80 bg-slate-950/80 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">Versionable workflow contract</p><p className="mt-1 text-xs text-muted-foreground">Edit trigger, conditions, and actions as JSON for review or source control.</p></div><Button size="sm" onClick={applyCodeDraft}><Code2 className="mr-1.5 h-4 w-4" />Apply JSON</Button></div>
                        <Textarea value={codeDraft} onChange={(event) => setCodeDraft(event.target.value)} className="mt-4 min-h-[480px] resize-y border-slate-700 bg-slate-950 font-mono text-xs leading-6 text-cyan-50" spellCheck={false} />
                      </div>
                    </TabsContent>
                  </Tabs>

                  <Separator />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="h-4 w-4 text-cyan-300" />Simulation never performs an external action. Material changes require independent approval.</div>
                    <Button variant="destructive" size="sm" onClick={deleteWorkflow}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete workflow</Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="flex min-h-[680px] items-center justify-center"><CardContent className="text-center"><Workflow className="mx-auto h-14 w-14 text-muted-foreground/25" /><p className="mt-4 font-medium">Choose or create a workflow</p><p className="mt-1 text-sm text-muted-foreground">Start with a verified pack or compose a governed flow.</p><Button className="mt-4" onClick={() => setShowCreate(true)}><Plus className="mr-1.5 h-4 w-4" />New workflow</Button></CardContent></Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="marketplace" className="mt-5 space-y-4">
          <Card className="overflow-hidden border-violet-500/20 bg-gradient-to-br from-violet-500/[0.075] via-card to-cyan-500/[0.035]">
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="max-w-3xl">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Connected operational packs</p>
                  <p className="mt-1 text-xl font-semibold">Nexus Workflow Marketplace</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Install the complete operating system for an outcome—not just a script. Every pack brings its workflow, ticket blueprint, technician and client documentation, policies and exception alerting into one governed lifecycle.</p>
                </div>
                <div className="relative w-full xl:w-96">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="h-10 border-violet-500/20 bg-background/60 pl-9" value={packSearch} onChange={(event) => setPackSearch(event.target.value)} placeholder="Search outcomes, industries and connections" data-testid="workflow-marketplace-search" />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 border-t border-border/60 pt-4">
                {packFilters.map((item) => (
                  <Button key={item} size="sm" variant={packFilter === item ? "default" : "outline"} onClick={() => setPackFilter(item)} aria-pressed={packFilter === item} className="h-8 text-[11px]">
                    {item === "Industry blueprints" && <Building2 className="mr-1.5 h-3.5 w-3.5" />}{item}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Verified packs", templates.length, PackageCheck, "Nexus signed catalogue", "border-violet-500/20 bg-violet-500/[0.035]"],
              ["Industry blueprints", templates.filter((item) => item.industry).length, Building2, "Vertical-ready baselines", "border-cyan-500/20 bg-cyan-500/[0.035]"],
              ["Installed", templates.filter((item) => item.installed).length, CheckCircle2, "Audited lifecycle records", "border-emerald-500/20 bg-emerald-500/[0.035]"],
              ["Draft components", templates.filter((item) => item.installed).reduce((sum, item) => sum + (item.installation?.component_total || 1), 0), Layers3, "Nothing auto-activated", "border-amber-500/20 bg-amber-500/[0.035]"],
            ].map(([label, value, Icon, helper, tone]) => (
              <Card key={label} className={tone}><CardContent className="p-4"><Icon className="h-4 w-4 text-muted-foreground" /><p className="mt-3 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs font-medium">{label}</p><p className="mt-1 text-[10px] text-muted-foreground">{helper}</p></CardContent></Card>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredPacks.map((pack) => (
              <Card key={pack.id} className={`group overflow-hidden border-border/80 transition-all hover:-translate-y-0.5 hover:border-violet-500/35 hover:shadow-lg hover:shadow-violet-500/5 ${pack.installed ? "border-emerald-500/25 bg-emerald-500/[0.025]" : ""}`} data-testid={`workflow-pack-${pack.id}`}>
                <div className="h-1 bg-gradient-to-r from-violet-500 via-cyan-400 to-emerald-400" />
                <CardContent className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-violet-500/20 bg-violet-500/10">{pack.industry ? <Building2 className="h-5 w-5 text-violet-300" /> : <Box className="h-5 w-5 text-violet-300" />}</div>
                    {pack.installed
                      ? <Badge variant="outline" className={RISK_STYLE.low}><CheckCircle2 className="mr-1 h-3 w-3" />{titleCase(pack.status)}</Badge>
                      : <Badge variant="outline"><ShieldCheck className="mr-1 h-3 w-3" />{pack.publisher}</Badge>}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2"><p className="font-semibold">{pack.name}</p>{pack.industry && <Badge variant="outline" className="border-violet-500/25 text-[9px] text-violet-200">{pack.industry}</Badge>}</div>
                  <p className="mt-2 min-h-16 text-sm leading-5 text-muted-foreground">{pack.outcome}</p>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-lg border border-border/70 bg-muted/[0.04] p-2 text-center"><p className="text-sm font-semibold">{pack.component_total}</p><p className="text-[9px] text-muted-foreground">Components</p></div>
                    <div className="rounded-lg border border-border/70 bg-muted/[0.04] p-2 text-center"><p className="text-sm font-semibold">{pack.steps}</p><p className="text-[9px] text-muted-foreground">Actions</p></div>
                    <div className="rounded-lg border border-border/70 bg-muted/[0.04] p-2 text-center"><p className="text-sm font-semibold">{pack.estimated_setup_minutes}m</p><p className="text-[9px] text-muted-foreground">Configure</p></div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {Object.entries(pack.component_counts || {}).slice(0, 4).map(([kind, count]) => <span key={kind} className="rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[9px] text-muted-foreground">{count} {PACK_KIND[kind]?.label || titleCase(kind)}</span>)}
                    {Object.keys(pack.component_counts || {}).length > 4 && <span className="rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[9px] text-muted-foreground">+{Object.keys(pack.component_counts).length - 4} types</span>}
                  </div>
                  <div className="mt-auto flex gap-2 pt-5">
                    <Button className="flex-1" variant={pack.installed ? "outline" : "default"} onClick={() => previewPack(pack)}>
                      {pack.installed ? <Settings2 className="mr-1.5 h-4 w-4" /> : <Sparkles className="mr-1.5 h-4 w-4" />}{pack.installed ? "Review & configure" : "Preview & install"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {!filteredPacks.length && <Card><CardContent className="py-16 text-center"><Search className="mx-auto h-9 w-9 text-muted-foreground/30" /><p className="mt-4 font-medium">No matching workflow packs</p><p className="mt-1 text-sm text-muted-foreground">Try another industry, outcome, provider or lifecycle filter.</p><Button className="mt-4" variant="outline" onClick={() => { setPackSearch(""); setPackFilter("All packs"); }}>Reset marketplace</Button></CardContent></Card>}
        </TabsContent>

        <TabsContent value="runtime" className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Active", runtimeHealth?.active || 0, "Queued, running, waiting or approval", "border-cyan-500/20 bg-cyan-500/[0.04]"],
              ["Waiting", runtimeHealth?.waiting || 0, "Persisted timed continuations", "border-violet-500/20 bg-violet-500/[0.04]"],
              ["Approvals", runtimeHealth?.awaiting_approval || 0, "Protected execution boundaries", "border-amber-500/20 bg-amber-500/[0.04]"],
              ["Failed", runtimeHealth?.failed || 0, "Stopped without fabricated success", "border-rose-500/20 bg-rose-500/[0.04]"],
            ].map(([label, value, helper, style]) => (
              <Card key={label} className={style}><CardContent className="p-4"><p className="text-2xl font-semibold">{value}</p><p className="mt-1 text-sm font-medium">{label}</p><p className="mt-1 text-[11px] text-muted-foreground">{helper}</p></CardContent></Card>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div><CardTitle className="text-base">Durable execution ledger</CardTitle><p className="mt-1 text-sm text-muted-foreground">Every wait, approval, mutation, failure and recovery survives a service restart.</p></div>
                <Button variant="outline" size="sm" onClick={() => load({ quiet: true })}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh</Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {runs.map((run) => (
                  <button key={run.id} type="button" onClick={() => { setSelectedRun(run); setRunReason(""); }} className={`flex w-full flex-col gap-3 rounded-xl border p-4 text-left transition-all lg:flex-row lg:items-center ${selectedRun?.id === run.id ? "border-cyan-500/35 bg-cyan-500/[0.05]" : "border-border/80 hover:border-cyan-500/25 hover:bg-muted/10"}`}>
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${run.status === "failed" ? "border-rose-500/25 bg-rose-500/10" : run.status === "completed" ? "border-emerald-500/25 bg-emerald-500/10" : "border-cyan-500/25 bg-cyan-500/10"}`}>
                      {run.status === "failed" ? <XCircle className="h-5 w-5 text-rose-300" /> : run.status === "completed" ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <Activity className="h-5 w-5 text-cyan-300" />}
                    </div>
                    <div className="min-w-0 flex-1"><p className="truncate font-medium">{run.workflow_name}</p><p className="mt-1 text-xs text-muted-foreground">{run.id} · {titleCase(run.trigger_subject)} · {readableDate(run.created_at)}</p></div>
                    <div className="flex flex-wrap gap-2"><Badge variant="outline">{titleCase(run.status)}</Badge><Badge variant="outline">Step {Math.min((run.current_step || 0) + 1, run.steps?.length || 0)} / {run.steps?.length || 0}</Badge><Badge variant="outline">{run.attempts || 0} attempt{run.attempts === 1 ? "" : "s"}</Badge></div>
                  </button>
                ))}
                {!runs.length && <div className="py-16 text-center"><Activity className="mx-auto h-10 w-10 text-muted-foreground/30" /><p className="mt-4 font-medium">No execution runs yet</p><p className="mt-1 text-sm text-muted-foreground">Enable an approved workflow, then let an event trigger it or choose Run now.</p></div>}
              </CardContent>
            </Card>

            <Card className="h-fit xl:sticky xl:top-4">
              {selectedRun ? <CardContent className="space-y-5 p-5">
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Runtime evidence</p><p className="mt-2 text-lg font-semibold">{selectedRun.workflow_name}</p><p className="mt-1 text-xs text-muted-foreground">{selectedRun.id} · correlation {selectedRun.correlation_id}</p></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-border/70 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</p><p className="mt-1 text-sm font-medium">{titleCase(selectedRun.status)}</p></div>
                  <div className="rounded-lg border border-border/70 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Checkpoint</p><p className="mt-1 text-sm font-medium">{selectedRun.current_step || 0} of {selectedRun.steps?.length || 0}</p></div>
                </div>
                {selectedRun.failure && <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.05] p-4"><p className="flex items-center gap-2 text-sm font-medium text-rose-100"><AlertTriangle className="h-4 w-4" />Execution stopped safely</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{selectedRun.failure.message}</p></div>}
                <ScrollArea className="max-h-[360px] pr-3">
                  <div className="space-y-2">
                    {(selectedRun.step_results || []).map((step, index) => <div key={`${step.step_id}-${index}`} className="rounded-lg border border-border/70 p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{step.step_index + 1}. {titleCase(step.type)}</p><Badge variant="outline" className="text-[9px]">{titleCase(step.status)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{step.message}</p></div>)}
                    {!(selectedRun.step_results || []).length && <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">The worker has not committed a step yet.</p>}
                  </div>
                </ScrollArea>
                {["awaiting_approval", "failed", "completed", "cancelled"].includes(selectedRun.status) && <div className="space-y-3 border-t border-border/70 pt-4">
                  <div><Label>Decision or recovery reason</Label><Textarea className="mt-1" rows={3} value={runReason} onChange={(event) => setRunReason(event.target.value)} placeholder="Record why this governed action is appropriate." /></div>
                  <div className="flex flex-wrap gap-2">
                    {selectedRun.status === "awaiting_approval" && <><Button size="sm" onClick={() => runControl("approve")} disabled={!!runtimeBusy}><CheckCircle2 className="mr-1.5 h-4 w-4" />Approve & resume</Button><Button size="sm" variant="destructive" onClick={() => runControl("reject")} disabled={!!runtimeBusy}><XCircle className="mr-1.5 h-4 w-4" />Reject</Button></>}
                    {selectedRun.status === "failed" && <Button size="sm" variant="outline" onClick={() => runControl("retry")} disabled={!!runtimeBusy}><RefreshCw className="mr-1.5 h-4 w-4" />Retry failed step</Button>}
                    {["failed", "completed", "cancelled"].includes(selectedRun.status) && selectedRun.compensation_status === "available" && <Button size="sm" variant="outline" onClick={() => runControl("compensate")} disabled={!!runtimeBusy}><History className="mr-1.5 h-4 w-4" />Compensate safely</Button>}
                  </div>
                  <p className="text-[10px] leading-4 text-muted-foreground">Compensation restores only values that still match this run's after-state. Later technician changes are preserved as conflicts.</p>
                </div>}
              </CardContent> : <CardContent className="py-20 text-center"><Clock3 className="mx-auto h-10 w-10 text-muted-foreground/30" /><p className="mt-4 font-medium">Select a run</p><p className="mt-1 text-sm text-muted-foreground">Inspect committed steps, approval evidence, failures and recovery controls.</p></CardContent>}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="simulations" className="mt-5">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle className="text-base">Simulation and approval evidence</CardTitle><p className="mt-1 text-sm text-muted-foreground">Every preview proves that no action ran and records the proposed before/after, risk, rollback, and technician.</p></div><Button variant="outline" size="sm" onClick={() => navigate("/change-management")}><ChevronRight className="mr-1 h-4 w-4" />Approval queue</Button></CardHeader>
            <CardContent className="space-y-3">
              {simulations.map((item) => (
                <button type="button" key={item.id} onClick={() => { setSimulation(item); setSimulationOpen(true); }} className="flex w-full flex-col gap-3 rounded-xl border border-border/80 p-4 text-left transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/[0.025] lg:flex-row lg:items-center">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10"><Sparkles className="h-5 w-5 text-cyan-300" /></div>
                  <div className="min-w-0 flex-1"><p className="font-medium">{item.workflow_name}</p><p className="mt-1 text-xs text-muted-foreground">{item.id} · {item.simulated_by} · {readableDate(item.simulated_at)}</p></div>
                  <div className="flex flex-wrap gap-2"><Badge variant="outline" className={RISK_STYLE[item.risk_level]}>{titleCase(item.risk_level)} risk</Badge><Badge variant="outline" className={STATUS_STYLE[item.status]}>{titleCase(item.status)}</Badge><Badge variant="outline">{item.summary?.steps || 0} steps</Badge><Badge variant="outline" className="border-emerald-500/25 text-emerald-200">0 executed</Badge></div>
                </button>
              ))}
              {!simulations.length && <div className="py-16 text-center"><Sparkles className="mx-auto h-10 w-10 text-muted-foreground/30" /><p className="mt-4 font-medium">No simulations recorded</p><p className="mt-1 text-sm text-muted-foreground">Choose a workflow in Studio and run its first zero-change preview.</p><Button className="mt-4" onClick={() => selectTab("studio")}>Open Studio</Button></div>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Automation Studio</p><DialogTitle className="mt-1 flex items-center gap-2"><Workflow className="h-5 w-5 text-cyan-300" />Create a governed workflow</DialogTitle><DialogDescription>Begin with a disabled draft. Nothing can run until it has been configured and simulated.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label>Workflow name</Label><Input className="mt-1" value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Approved new employee onboarding" /></div>
            <div className="sm:col-span-2"><Label>Business outcome</Label><Textarea className="mt-1" rows={4} value={createForm.description} onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))} placeholder="Describe the intended result, owner, and safe operating scope." /></div>
            <div><Label>Category</Label><Input className="mt-1" value={createForm.category} onChange={(event) => setCreateForm((current) => ({ ...current, category: event.target.value }))} /></div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3"><p className="flex items-center gap-2 text-sm font-medium text-emerald-100"><LockKeyhole className="h-4 w-4" />Safe by default</p><p className="mt-1 text-xs text-muted-foreground">Created disabled with an empty action plan.</p></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={createWorkflow} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create draft</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteWorkflowOpen} onOpenChange={setDeleteWorkflowOpen}>
        <NexusWorkflowDialog
          eyebrow="Automation lifecycle"
          title="Delete this workflow?"
          description="The workflow will stop immediately. Its audit trail and simulation evidence remain available for governance."
          icon={Trash2}
          tone="amber"
          footer={
            <>
              <Button variant="outline" onClick={() => setDeleteWorkflowOpen(false)}>Keep workflow</Button>
              <Button variant="destructive" onClick={() => deleteWorkflow(true)}>Delete workflow</Button>
            </>
          }
        >
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
            <p className="text-sm font-semibold">{editWf?.name || "Selected workflow"}</p>
            <p className="mt-1 text-sm text-muted-foreground">Use this only when the automation is no longer needed. Deleting does not erase the governed operational history.</p>
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      <PackPreviewDialog
        pack={packPreview}
        open={!!packPreview}
        onOpenChange={(next) => { if (!next) setPackPreview(null); }}
        clients={clients}
        scope={packScope}
        setScope={setPackScope}
        clientId={packClientId}
        setClientId={setPackClientId}
        installing={installing}
        removing={removing}
        onInstall={installPack}
        onRemove={removePack}
        onConfigure={configurePack}
      />
      <SimulationDialog simulation={simulation} open={simulationOpen} onOpenChange={setSimulationOpen} onSubmit={submitApproval} submitting={submitting} />
    </div>
  );
}
