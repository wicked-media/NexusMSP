import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Activity, FileSearch, Loader2, Pencil, Plus, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";

const EMPTY_FORM = {
  name: "",
  description: "",
  mode: "monitor",
  action: "approval",
  enabled: true,
  priority: "100",
  clientId: "all",
  deviceId: "all",
  programPath: "",
  sha256: "",
  argumentsContains: "",
  maxDuration: "15",
  requireTicket: false,
  requireJustification: true,
};

const ACTION_META = {
  allow: { label: "Allow automatically", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" },
  approval: { label: "Require approval", className: "border-amber-500/30 bg-amber-500/10 text-amber-200" },
  deny: { label: "Deny request", className: "border-rose-500/30 bg-rose-500/10 text-rose-200" },
};

const actionDescription = (action) => ({
  allow: "Queue a precise, hash-pinned launch automatically.",
  approval: "Put a matching request into the technician approval queue.",
  deny: "Block a matching request and record the policy decision.",
}[action] || "");

const normaliseLines = (value) => String(value || "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean);

const policyToForm = (policy) => ({
  name: policy?.name || "",
  description: policy?.description || "",
  mode: policy?.mode || "monitor",
  action: policy?.action || "approval",
  enabled: policy?.enabled !== false,
  priority: String(policy?.priority || 100),
  clientId: policy?.scope?.client_ids?.[0] || "all",
  deviceId: policy?.scope?.device_ids?.[0] || "all",
  programPath: policy?.match?.program_path || "",
  sha256: policy?.match?.sha256 || "",
  argumentsContains: (policy?.match?.arguments_contains || []).join("\n"),
  maxDuration: String(policy?.constraints?.max_duration_minutes || 15),
  requireTicket: Boolean(policy?.constraints?.require_ticket),
  requireJustification: policy?.constraints?.require_justification !== false,
});

function ScopeLabel({ policy, catalog }) {
  const clientIds = policy.scope?.client_ids || [];
  const deviceIds = policy.scope?.device_ids || [];
  const clients = (catalog.clients || []).filter((client) => clientIds.includes(client.id)).map((client) => client.name);
  const devices = (catalog.agents || []).filter((agent) => deviceIds.includes(agent.id)).map((agent) => agent.hostname || agent.id);
  if (!clients.length && !devices.length) return <span className="text-muted-foreground">All enrolled endpoints</span>;
  return <span>{[...clients, ...devices].join(" · ")}</span>;
}

function FieldSet({ form, setForm, catalog, prefix = "policy" }) {
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="space-y-4">
    <div className="grid gap-3 md:grid-cols-2">
      <div><Label htmlFor={`${prefix}-name`}>Policy name</Label><Input id={`${prefix}-name`} className="mt-1" value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Example: Approved Dell Command Update" /></div>
      <div><Label htmlFor={`${prefix}-priority`}>Priority</Label><Input id={`${prefix}-priority`} className="mt-1" type="number" min="1" max="1000" value={form.priority} onChange={(event) => update("priority", event.target.value)} /></div>
    </div>
    <div><Label htmlFor={`${prefix}-description`}>Purpose and change context</Label><Textarea id={`${prefix}-description`} className="mt-1" rows={2} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Explain the approved business purpose so the policy remains reviewable." /></div>
    <div className="grid gap-3 md:grid-cols-2">
      <div><Label>Operating mode</Label><Select value={form.mode} onValueChange={(value) => update("mode", value)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monitor">Monitor only (no workflow change)</SelectItem><SelectItem value="enforce">Enforce the policy decision</SelectItem></SelectContent></Select></div>
      <div><Label>Matching action</Label><Select value={form.action} onValueChange={(value) => update("action", value)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="approval">Require technician approval</SelectItem><SelectItem value="allow">Allow automatically</SelectItem><SelectItem value="deny">Deny request</SelectItem></SelectContent></Select><p className="mt-1 text-[11px] text-muted-foreground">{actionDescription(form.action)}</p></div>
    </div>
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-sm font-medium">MSP scope</p><p className="text-[11px] text-muted-foreground">Target a customer, a single enrolled endpoint, or every enrolled Nexus Agent.</p></div><Switch checked={form.enabled} onCheckedChange={(checked) => update("enabled", checked)} aria-label="Policy enabled" /></div>
      <div className="grid gap-3 md:grid-cols-2">
        <div><Label>Customer</Label><Select value={form.clientId} onValueChange={(value) => update("clientId", value)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All customers</SelectItem>{(catalog.clients || []).map((client) => <SelectItem key={client.id} value={client.id}>{client.name || client.id}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Endpoint</Label><Select value={form.deviceId} onValueChange={(value) => update("deviceId", value)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All enrolled endpoints</SelectItem>{(catalog.agents || []).map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.hostname || agent.id}</SelectItem>)}</SelectContent></Select></div>
      </div>
    </div>
    <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.025] p-3">
      <p className="mb-3 text-sm font-medium text-emerald-100">Exact application identity</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div><Label htmlFor={`${prefix}-path`}>Absolute Windows executable path</Label><Input id={`${prefix}-path`} className="mt-1 font-mono text-xs" value={form.programPath} onChange={(event) => update("programPath", event.target.value)} placeholder="C:\\Program Files\\Vendor\\app.exe" /></div>
        <div><Label htmlFor={`${prefix}-hash`}>SHA-256 fingerprint</Label><Input id={`${prefix}-hash`} className="mt-1 font-mono text-xs" value={form.sha256} onChange={(event) => update("sha256", event.target.value)} placeholder="64-character SHA-256" /></div>
      </div>
      <div className="mt-3"><Label htmlFor={`${prefix}-arguments`}>Required argument fragments (optional, one per line)</Label><Textarea id={`${prefix}-arguments`} className="mt-1 font-mono text-xs" rows={2} value={form.argumentsContains} onChange={(event) => update("argumentsContains", event.target.value)} placeholder="/silent\n/repair" /></div>
    </div>
    <div className="grid gap-3 md:grid-cols-3">
      <div><Label htmlFor={`${prefix}-duration`}>Maximum launch duration</Label><Select value={String(form.maxDuration)} onValueChange={(value) => update("maxDuration", value)}><SelectTrigger id={`${prefix}-duration`} className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{[5, 10, 15, 30, 45, 60].map((value) => <SelectItem key={value} value={String(value)}>{value} minutes</SelectItem>)}</SelectContent></Select></div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"><div><p className="text-sm">Require ticket</p><p className="text-[10px] text-muted-foreground">For enforced handling</p></div><Switch checked={form.requireTicket} onCheckedChange={(checked) => update("requireTicket", checked)} /></div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"><div><p className="text-sm">Require reason</p><p className="text-[10px] text-muted-foreground">Before evaluation</p></div><Switch checked={form.requireJustification} onCheckedChange={(checked) => update("requireJustification", checked)} /></div>
    </div>
    {form.mode === "enforce" && form.action === "allow" && (!form.programPath || !form.sha256) && <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />Automatic approval is unavailable until both the exact executable path and SHA-256 are pinned.</div>}
  </div>;
}

export default function ElevatePolicyWorkspace({ api, headers, onPolicyCountChange }) {
  const [policies, setPolicies] = useState([]);
  const [catalog, setCatalog] = useState({ clients: [], agents: [] });
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("all");
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [simulation, setSimulation] = useState({ ...EMPTY_FORM, name: "Simulation" });
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await axios.get(`${api}/nexus-elevate/policies`, { headers });
      const nextPolicies = response.data?.policies || [];
      setPolicies(nextPolicies);
      setCatalog(response.data?.catalog || { clients: [], agents: [] });
      setCanManage(Boolean(response.data?.permissions?.can_manage));
      onPolicyCountChange?.(nextPolicies);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus Elevate policies could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [api, headers, onPolicyCountChange]);

  useEffect(() => { load(); }, [load]);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };
  const startEdit = (policy) => {
    setEditing(policy);
    setForm(policyToForm(policy));
    setDialogOpen(true);
  };
  const payloadFor = (value) => ({
    name: value.name,
    description: value.description,
    action: value.action,
    mode: value.mode,
    enabled: value.enabled,
    priority: Number(value.priority),
    scope: { client_ids: value.clientId === "all" ? [] : [value.clientId], device_ids: value.deviceId === "all" ? [] : [value.deviceId] },
    match: { program_path: value.programPath, sha256: value.sha256, arguments_contains: normaliseLines(value.argumentsContains) },
    constraints: { max_duration_minutes: Number(value.maxDuration), require_ticket: value.requireTicket, require_justification: value.requireJustification },
  });
  const save = async () => {
    if (!form.name.trim() || (!form.programPath.trim() && !form.sha256.trim())) {
      toast.error("Give the policy a name and exact application identity");
      return;
    }
    setSaving(true);
    try {
      const response = editing
        ? await axios.put(`${api}/nexus-elevate/policies/${encodeURIComponent(editing.id)}`, payloadFor(form), { headers })
        : await axios.post(`${api}/nexus-elevate/policies`, payloadFor(form), { headers });
      toast.success(editing ? "Nexus Elevate policy updated and versioned" : "Nexus Elevate policy created");
      setDialogOpen(false);
      const policy = response.data?.policy;
      if (policy) setPolicies((current) => editing ? current.map((item) => item.id === policy.id ? policy : item) : [policy, ...current]);
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Policy could not be saved");
    } finally {
      setSaving(false);
    }
  };
  const archive = async (policy) => {
    if (!window.confirm(`Archive “${policy.name}”? It will stop matching new elevation requests and remain in the audit history.`)) return;
    try {
      await axios.post(`${api}/nexus-elevate/policies/${encodeURIComponent(policy.id)}/archive`, {}, { headers });
      setPolicies((current) => current.filter((item) => item.id !== policy.id));
      toast.success("Policy archived and retained for audit");
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Policy could not be archived");
    }
  };
  const runSimulation = async () => {
    if (!simulation.programPath.trim() || !simulation.sha256.trim()) {
      toast.error("Simulation needs an executable path and SHA-256 fingerprint");
      return;
    }
    setSimulating(true);
    setSimulationResult(null);
    try {
      const response = await axios.post(`${api}/nexus-elevate/policies/simulate`, {
        client_id: simulation.clientId === "all" ? "" : simulation.clientId,
        device_id: simulation.deviceId === "all" ? "" : simulation.deviceId,
        program_path: simulation.programPath,
        sha256: simulation.sha256,
        arguments: normaliseLines(simulation.argumentsContains),
        ticket_id: simulation.requireTicket ? "SIM-0001" : "",
        justification: simulation.requireJustification ? "Testing the policy decision before rollout" : "",
      }, { headers });
      setSimulationResult(response.data?.evaluation || null);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Policy simulation could not be completed");
    } finally {
      setSimulating(false);
    }
  };

  const visiblePolicies = useMemo(() => policies.filter((policy) => filter === "all" || policy.mode === filter), [filter, policies]);
  const active = policies.filter((policy) => policy.enabled).length;
  const enforced = policies.filter((policy) => policy.enabled && policy.mode === "enforce").length;

  return <section id="nexus-elevate-policies" className="scroll-mt-6 space-y-4" data-testid="nexus-elevate-policies">
    <Card className="overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.065] via-background to-background">
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl"><div className="flex items-center gap-2"><div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-2 text-emerald-200"><ShieldCheck className="h-5 w-5" /></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">Least privilege control plane</p><h2 className="text-xl font-semibold">Nexus Elevate Policies</h2></div></div><p className="mt-3 text-sm text-muted-foreground">Build customer-aware, exact-application controls for every Nexus Agent. Start in monitor mode, simulate the outcome, then enforce only the decisions you are comfortable auditing.</p></div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => { setSimulation(policyToForm(policies[0])); setSimulationResult(null); setSimulateOpen(true); }}><FileSearch className="mr-1.5 h-4 w-4" />Simulate a request</Button><Button size="sm" onClick={startCreate} disabled={!canManage}><Plus className="mr-1.5 h-4 w-4" />New policy</Button></div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border/80 bg-background/55 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Active policies</p><p className="mt-1 text-2xl font-semibold">{loading ? "-" : active}</p><p className="text-xs text-muted-foreground">Enabled rules in the control plane</p></div>
          <div className="rounded-xl border border-border/80 bg-background/55 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Enforcement live</p><p className="mt-1 text-2xl font-semibold text-emerald-200">{loading ? "-" : enforced}</p><p className="text-xs text-muted-foreground">Precise decisions can change workflow</p></div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.045] p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200">Safety boundary</p><p className="mt-1 text-sm font-semibold">No local-admin removal yet</p><p className="text-xs text-muted-foreground">Recovery controls are required before that capability can be enabled.</p></div>
        </div>
      </CardContent>
    </Card>

    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1 rounded-lg border border-border bg-muted/25 p-1">{[["all", "All"], ["enforce", "Enforced"], ["monitor", "Monitor"]].map(([value, label]) => <Button key={value} size="sm" variant={filter === value ? "default" : "ghost"} onClick={() => setFilter(value)}>{label}</Button>)}</div><span className="text-xs text-muted-foreground">{visiblePolicies.length} {visiblePolicies.length === 1 ? "policy" : "policies"}</span></div>
    {loading ? <Card><CardContent className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card> : visiblePolicies.length === 0 ? <Card><CardContent className="p-8 text-center"><ShieldCheck className="mx-auto h-6 w-6 text-emerald-300" /><p className="mt-3 font-medium">No policies in this view</p><p className="mt-1 text-sm text-muted-foreground">Create a monitor-only policy from a known good elevation request, then review the audit evidence before enforcing it.</p><Button className="mt-4" size="sm" onClick={startCreate} disabled={!canManage}>Create first policy</Button>{!canManage && <p className="mt-2 text-xs text-muted-foreground">An administrator can create and change elevation policies.</p>}</CardContent></Card> : <div className="grid gap-3 xl:grid-cols-2">{visiblePolicies.map((policy) => <Card key={policy.id} className="border-border/80" data-testid={`nexus-elevate-policy-${policy.id}`}><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{policy.name}</p><Badge variant="outline" className={`text-[10px] ${ACTION_META[policy.action]?.className}`}>{ACTION_META[policy.action]?.label}</Badge><Badge variant="outline" className={policy.mode === "enforce" ? "border-emerald-500/30 text-emerald-200" : "border-sky-500/30 text-sky-200"}>{policy.mode === "enforce" ? "Enforced" : "Monitor"}</Badge>{policy.enabled ? null : <Badge variant="outline" className="text-muted-foreground">Paused</Badge>}</div><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{policy.description || "No policy purpose recorded."}</p></div><div className="flex shrink-0 gap-1"><Button size="icon" variant="ghost" aria-label={`Edit ${policy.name}`} onClick={() => startEdit(policy)} disabled={!canManage}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="text-muted-foreground hover:text-rose-200" aria-label={`Archive ${policy.name}`} onClick={() => archive(policy)} disabled={!canManage}><Trash2 className="h-4 w-4" /></Button></div></div><div className="mt-4 grid gap-2 text-xs sm:grid-cols-2"><div className="rounded-lg border border-border/70 bg-muted/15 p-2"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Scope</p><p className="mt-1 truncate" title="Customer and endpoint scope"><ScopeLabel policy={policy} catalog={catalog} /></p></div><div className="rounded-lg border border-border/70 bg-muted/15 p-2"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Application identity</p><p className="mt-1 truncate font-mono text-[10px]" title={policy.match?.program_path || policy.match?.sha256}>{policy.match?.program_path || policy.match?.sha256 || "Not configured"}</p></div></div><div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground"><span>Version {policy.version || 1} · Priority {policy.priority || 100}</span><span>{policy.constraints?.max_duration_minutes || 15} min cap</span></div></CardContent></Card>)}</div>}

    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto" data-testid="nexus-elevate-policy-dialog"><DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-300" />{editing ? "Edit Nexus Elevate policy" : "Create Nexus Elevate policy"}</DialogTitle></DialogHeader><FieldSet form={form} setForm={setForm} catalog={catalog} /><div className="flex justify-end gap-2 border-t border-border pt-4"><Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{editing ? "Save new version" : "Create policy"}</Button></div></DialogContent></Dialog>

    <Dialog open={simulateOpen} onOpenChange={setSimulateOpen}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto" data-testid="nexus-elevate-policy-simulation"><DialogHeader><DialogTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-sky-300" />Simulate elevation policy outcome</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">This does not contact an endpoint, queue a process, or change a policy. It records an audit event showing the proposed evaluation.</p><FieldSet form={simulation} setForm={setSimulation} catalog={catalog} prefix="simulation" />{simulationResult && <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.05] p-4"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">Proposed outcome</p><Badge variant="outline" className={ACTION_META[simulationResult.decision]?.className}>{ACTION_META[simulationResult.decision]?.label || simulationResult.decision}</Badge></div>{simulationResult.matched ? <div className="mt-3 text-sm"><p><span className="text-muted-foreground">Matched policy: </span><span className="font-medium">{simulationResult.matched.name}</span></p><p className="mt-1 text-xs text-muted-foreground">Matched by {simulationResult.matched.reasons?.join(", ") || "configured conditions"}{simulationResult.matched.downgraded_reason ? ` — ${simulationResult.matched.downgraded_reason}` : ""}</p></div> : <p className="mt-2 text-sm text-muted-foreground">No enforced policy matches. The request would enter the standard approval queue.</p>}{simulationResult.monitor_matches?.length > 0 && <p className="mt-3 text-xs text-sky-200">Monitor evidence: {simulationResult.monitor_matches.map((item) => item.name).join(", ")}</p>}</div>}<div className="flex justify-end gap-2 border-t border-border pt-4"><Button variant="outline" onClick={() => setSimulateOpen(false)} disabled={simulating}>Close</Button><Button onClick={runSimulation} disabled={simulating}>{simulating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Run simulation</Button></div></DialogContent></Dialog>
  </section>;
}
