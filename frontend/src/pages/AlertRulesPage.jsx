import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { toast } from "sonner";
import { AlertTriangle, Bell, Check, ChevronsUpDown, Clock, Edit3, GitBranch, Loader2, Play, Plus, RefreshCw, Shield, Trash2, Zap } from "lucide-react";

const SEV_STYLES = {
  critical: "border-red-500/20 bg-red-500/10 text-red-400",
  high: "border-orange-500/20 bg-orange-500/10 text-orange-400",
  medium: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  low: "border-blue-500/20 bg-blue-500/10 text-blue-400",
};

const DEVICE_TYPES = [
  { value: "server", label: "Servers" },
  { value: "workstation", label: "Workstations" },
  { value: "network", label: "Network devices" },
  { value: "other", label: "Other devices" },
];

function blankForm() {
  return {
    name: "",
    description: "",
    metric: "cpu_usage",
    operator: "greater_than",
    threshold: "90",
    duration_minutes: "5",
    severity: "high",
    cooldown_minutes: "30",
    scope: "all",
    scope_filter: {},
    create_ticket: true,
    ticket_priority: "high",
    ticket_category: "monitoring",
  };
}

function formFromRule(rule) {
  const ticketAction = (rule.actions || []).find((action) => action.type === "create_ticket");
  const ticketConfig = ticketAction?.config || {};
  return {
    ...blankForm(),
    ...rule,
    threshold: String(rule.threshold ?? ""),
    duration_minutes: String(rule.duration_minutes ?? 0),
    cooldown_minutes: String(rule.cooldown_minutes ?? 0),
    scope_filter: rule.scope_filter || {},
    create_ticket: Boolean(ticketAction),
    ticket_priority: ticketConfig.priority || rule.severity || "high",
    ticket_category: ticketConfig.category || "monitoring",
  };
}

function SearchScopePicker({ items, value, onChange, allLabel, placeholder, emptyLabel, itemLabel, itemSearchText, testId }) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="h-10 w-full justify-between font-normal" data-testid={testId}>
          <span className="truncate">{selected ? itemLabel(selected) : allLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup heading="Available">
              {items.map((item) => (
                <CommandItem key={item.id} value={itemSearchText(item)} onSelect={() => { onChange(item.id); setOpen(false); }}>
                  <Check className={`mr-2 h-4 w-4 ${value === item.id ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{itemLabel(item)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function scopeSummary(rule, clients, devices) {
  const filter = rule.scope_filter || {};
  if (rule.scope === "client") return clients.find((client) => client.id === filter.client_id)?.name || "Selected client";
  if (rule.scope === "device") {
    const device = devices.find((item) => item.id === filter.device_id);
    return device?.name || device?.hostname || "Selected asset";
  }
  if (rule.scope === "device_type") return DEVICE_TYPES.find((type) => type.value === filter.device_type)?.label || "Selected asset type";
  return "All managed assets";
}

function formatDateTime(value) {
  if (!value) return "Not triggered yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not triggered yet" : date.toLocaleString();
}

function RuleEditor({ open, form, setForm, options, clients, devices, editingRule, saving, onClose, onSave }) {
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setScopeFilter = (key, value) => setForm((current) => ({ ...current, scope_filter: { [key]: value } }));
  const metricUnit = options?.metrics?.find((metric) => metric.id === form.metric)?.unit || "";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto border-amber-400/20 bg-background p-0" aria-describedby="alert-rule-editor-description" data-testid="alert-rule-editor">
        <DialogHeader className="border-b border-amber-400/15 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),rgba(15,23,42,0.94))] px-6 py-5 pr-14">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Monitoring policy</p>
          <DialogTitle className="mt-1 flex items-center gap-2 text-xl"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-400/10"><Bell className="h-4 w-4 text-amber-300" /></span>{editingRule ? "Edit alert rule" : "Create alert rule"}</DialogTitle>
          <DialogDescription id="alert-rule-editor-description" className="mt-2">Define what to watch, who it applies to, and whether a matching signal should open a linked service ticket.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 px-6 py-5">
          <section className="space-y-3">
            <div><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Rule name</Label><Input className="mt-1" value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="e.g. CPU critical - servers" data-testid="rule-name" /></div>
            <div><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Technician guidance</Label><Input className="mt-1" value={form.description} onChange={(event) => set("description", event.target.value)} placeholder="Explain the condition and first response." /></div>
          </section>
          <Separator />
          <section className="space-y-3">
            <div><p className="text-sm font-semibold">Trigger condition</p><p className="text-xs text-muted-foreground">The policy is evaluated against telemetry received from the Nexus Agent.</p></div>
            <div className="grid gap-3 md:grid-cols-[1.45fr_1.2fr_0.75fr]">
              <div><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Metric</Label><Select value={form.metric} onValueChange={(value) => set("metric", value)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{options?.metrics?.map((metric) => <SelectItem key={metric.id} value={metric.id}>{metric.label}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Operator</Label><Select value={form.operator} onValueChange={(value) => set("operator", value)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{options?.operators?.map((operator) => <SelectItem key={operator} value={operator}>{operator.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Threshold {metricUnit && `(${metricUnit})`}</Label><Input className="mt-1" type="number" value={form.threshold} onChange={(event) => set("threshold", event.target.value)} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Sustained for (minutes)</Label><Input className="mt-1" type="number" min="0" value={form.duration_minutes} onChange={(event) => set("duration_minutes", event.target.value)} /><p className="mt-1 text-[11px] text-muted-foreground">Use 0 for an immediate response.</p></div>
              <div><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Cooldown (minutes)</Label><Input className="mt-1" type="number" min="0" value={form.cooldown_minutes} onChange={(event) => set("cooldown_minutes", event.target.value)} /><p className="mt-1 text-[11px] text-muted-foreground">Prevents duplicate alerts while the condition persists.</p></div>
            </div>
            <div><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Severity</Label><Select value={form.severity} onValueChange={(value) => set("severity", value)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select></div>
          </section>
          <Separator />
          <section className="space-y-3">
            <div><p className="text-sm font-semibold">Applies to</p><p className="text-xs text-muted-foreground">Keep the policy broad or target an asset group, client, or individual managed asset.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Scope</Label><Select value={form.scope} onValueChange={(value) => setForm((current) => ({ ...current, scope: value, scope_filter: {} }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All managed assets</SelectItem><SelectItem value="device_type">Asset type</SelectItem><SelectItem value="client">Client</SelectItem><SelectItem value="device">Individual asset</SelectItem></SelectContent></Select></div>
              <div>
                {form.scope === "device_type" && <><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Asset type</Label><Select value={form.scope_filter?.device_type || ""} onValueChange={(value) => setScopeFilter("device_type", value)}><SelectTrigger className="mt-1"><SelectValue placeholder="Choose asset type" /></SelectTrigger><SelectContent>{DEVICE_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select></>}
                {form.scope === "client" && <><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Client</Label><div className="mt-1"><SearchScopePicker items={clients} value={form.scope_filter?.client_id || ""} onChange={(value) => setScopeFilter("client_id", value)} allLabel="Choose a client" placeholder="Search clients..." emptyLabel="No client found." itemLabel={(client) => client.name || "Unnamed client"} itemSearchText={(client) => `${client.name || ""} ${client.email || ""}`} testId="alert-rule-client-scope" /></div></>}
                {form.scope === "device" && <><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Managed asset</Label><div className="mt-1"><SearchScopePicker items={devices} value={form.scope_filter?.device_id || ""} onChange={(value) => setScopeFilter("device_id", value)} allLabel="Choose a managed asset" placeholder="Search managed assets..." emptyLabel="No managed asset found." itemLabel={(device) => device.name || device.hostname || device.id} itemSearchText={(device) => `${device.name || ""} ${device.hostname || ""} ${device.client_name || ""}`} testId="alert-rule-device-scope" /></div></>}
                {form.scope === "all" && <div className="flex h-full items-end"><p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">This rule evaluates every Nexus Agent-managed asset.</p></div>}
              </div>
            </div>
          </section>
          <Separator />
          <section className="space-y-3">
            <div className="flex items-start justify-between gap-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.045] p-4"><div><p className="text-sm font-semibold">Create linked ticket</p><p className="mt-1 text-xs text-muted-foreground">Creates one auditable ticket for the matching asset, and links it back to the alert.</p></div><Switch checked={form.create_ticket} onCheckedChange={(checked) => set("create_ticket", checked)} /></div>
            {form.create_ticket && <div className="grid gap-3 sm:grid-cols-2"><div><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Ticket priority</Label><Select value={form.ticket_priority} onValueChange={(value) => set("ticket_priority", value)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select></div><div><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Ticket category</Label><Input className="mt-1" value={form.ticket_category} onChange={(event) => set("ticket_category", event.target.value)} placeholder="monitoring" /></div></div>}
          </section>
        </div>
        <DialogFooter className="border-t bg-muted/20 px-6 py-4"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={onSave} disabled={saving} data-testid="rule-submit">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{editingRule ? "Save rule" : "Create rule"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AlertRulesPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [rules, setRules] = useState([]);
  const [options, setOptions] = useState(null);
  const [stats, setStats] = useState(null);
  const [clients, setClients] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [healthCheck, setHealthCheck] = useState(null);
  const [ruleFilter, setRuleFilter] = useState("all");
  const [form, setForm] = useState(() => blankForm());

  const fetchData = useCallback(async () => {
    try {
      const [rulesResponse, optionsResponse, statsResponse] = await Promise.all([
        axios.get(`${API}/alert-rules`, { headers }),
        axios.get(`${API}/alert-rules/options`, { headers }),
        axios.get(`${API}/alert-rules/stats`, { headers }),
      ]);
      setRules(Array.isArray(rulesResponse.data) ? rulesResponse.data : []);
      setOptions(optionsResponse.data || null);
      setStats(statsResponse.data || null);
    } catch {
      toast.error("Failed to load alert rules");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    let active = true;
    Promise.all([
      axios.get(`${API}/clients`, { headers }).catch(() => ({ data: [] })),
      axios.get(`${API}/devices`, { headers }).catch(() => ({ data: [] })),
    ]).then(([clientsResponse, devicesResponse]) => {
      if (!active) return;
      setClients(Array.isArray(clientsResponse.data) ? clientsResponse.data : []);
      setDevices(Array.isArray(devicesResponse.data) ? devicesResponse.data : []);
    });
    return () => { active = false; };
  }, [headers]);

  const closeEditor = () => { setShowEditor(false); setEditingRule(null); setForm(blankForm()); };
  const openCreate = () => { setEditingRule(null); setForm(blankForm()); setShowEditor(true); };
  const openEdit = (rule) => { setEditingRule(rule); setForm(formFromRule(rule)); setShowEditor(true); };

  const saveRule = async () => {
    if (!form.name.trim()) return toast.error("A rule name is required");
    if (form.scope === "client" && !form.scope_filter?.client_id) return toast.error("Choose the client this rule applies to");
    if (form.scope === "device" && !form.scope_filter?.device_id) return toast.error("Choose the managed asset this rule applies to");
    if (form.scope === "device_type" && !form.scope_filter?.device_type) return toast.error("Choose the asset type this rule applies to");
    const threshold = Number(form.threshold);
    if (form.threshold.trim() === "" || !Number.isFinite(threshold)) return toast.error("Enter a valid threshold");
    const { create_ticket, ticket_priority, ticket_category, ...rule } = form;
    const payload = { ...rule, threshold, duration_minutes: Math.max(0, Number.parseInt(form.duration_minutes, 10) || 0), cooldown_minutes: Math.max(0, Number.parseInt(form.cooldown_minutes, 10) || 0), scope_filter: form.scope === "all" ? {} : form.scope_filter, actions: create_ticket ? [{ type: "create_ticket", config: { priority: ticket_priority, category: ticket_category.trim() || "monitoring" } }] : [] };
    setSaving(true);
    try {
      if (editingRule) { await axios.put(`${API}/alert-rules/${editingRule.id}`, payload, { headers }); toast.success("Alert rule updated"); }
      else { await axios.post(`${API}/alert-rules`, payload, { headers }); toast.success("Alert rule created"); }
      closeEditor();
      fetchData();
    } catch { toast.error(editingRule ? "Could not update the alert rule" : "Could not create the alert rule"); }
    finally { setSaving(false); }
  };

  const toggleRule = async (id) => {
    try { const response = await axios.post(`${API}/alert-rules/${id}/toggle`, {}, { headers }); toast.success(response.data.enabled ? "Rule enabled" : "Rule paused"); fetchData(); }
    catch { toast.error("Could not update rule status"); }
  };
  const deleteRule = async () => {
    if (!deleteTarget) return;
    try { await axios.delete(`${API}/alert-rules/${deleteTarget.id}`, { headers }); toast.success("Alert rule deleted"); setDeleteTarget(null); fetchData(); }
    catch { toast.error("Could not delete the alert rule"); }
  };
  const evaluateRules = async () => {
    setEvaluating(true);
    try { const response = await axios.post(`${API}/alert-rules/evaluate?dry_run=true`, {}, { headers }); const matches = (response.data?.matches || []).filter((match) => match.status === "would_trigger").length; setHealthCheck(response.data || null); toast.success(`Health check complete: ${matches} rule${matches === 1 ? "" : "s"} would trigger.`); }
    catch { toast.error("Unable to evaluate alert rules"); }
    finally { setEvaluating(false); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  const filteredRules = rules.filter((rule) => (ruleFilter === "active" ? rule.enabled : ruleFilter === "critical" ? rule.enabled && rule.severity === "critical" : ruleFilter === "paused" ? !rule.enabled : true));
  const activeRules = rules.filter((rule) => rule.enabled).length;
  const criticalRules = rules.filter((rule) => rule.enabled && rule.severity === "critical").length;
  const pausedRules = rules.filter((rule) => !rule.enabled).length;

  return (
    <div className="space-y-5" data-testid="alert-rules-page">
      <OperationalPageHeader eyebrow="Monitoring policy" title="Alert Rules Engine" description="Evaluate Nexus Agent telemetry, route an auditable response, and validate coverage before a signal reaches the service desk." icon={Bell} tone="amber" actions={<><Button variant="outline" onClick={() => navigate("/change-management")}><GitBranch className="mr-1.5 h-4 w-4" />Change control</Button><Button variant="outline" onClick={fetchData} data-testid="refresh-alert-rules-btn"><RefreshCw className="mr-1.5 h-4 w-4" />Refresh</Button><Button variant="outline" onClick={evaluateRules} disabled={evaluating} data-testid="evaluate-rules-btn">{evaluating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}Run health check</Button><Button onClick={openCreate} data-testid="create-rule-btn"><Plus className="mr-1.5 h-4 w-4" />New rule</Button></>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><HeroTile label="All rules" value={stats?.total ?? rules.length} subtitle="Configured policies" icon={Shield} glow="violet" animated={false} active={ruleFilter === "all"} onClick={() => setRuleFilter("all")} testId="alert-rules-total-tile" /><HeroTile label="Active" value={stats?.active ?? activeRules} subtitle="Watching managed assets" icon={Zap} glow="emerald" animated={false} active={ruleFilter === "active"} onClick={() => setRuleFilter("active")} testId="alert-rules-active-tile" /><HeroTile label="Critical" value={criticalRules} subtitle="Priority coverage" icon={AlertTriangle} glow="rose" animated={false} active={ruleFilter === "critical"} onClick={() => setRuleFilter("critical")} testId="alert-rules-critical-tile" /><HeroTile label="Paused" value={pausedRules} subtitle={`${stats?.total_triggered ?? 0} total triggers`} icon={Clock} glow="amber" animated={false} active={ruleFilter === "paused"} onClick={() => setRuleFilter("paused")} testId="alert-rules-paused-tile" /></div>

      {healthCheck && (() => {
        const results = healthCheck.matches || [];
        const wouldTrigger = results.filter((result) => result.status === "would_trigger");
        const waiting = results.filter((result) => result.status === "waiting_for_duration");
        const suppressed = results.filter((result) => ["cooldown", "suppressed_by_maintenance"].includes(result.status));
        return <Card className={wouldTrigger.length ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-emerald-500/20 bg-emerald-500/[0.03]"} data-testid="alert-health-check-results"><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><div><CardTitle className="flex items-center gap-2 text-sm"><Shield className="h-4 w-4 text-cyan-400" />Latest health check</CardTitle><p className="mt-1 text-xs text-muted-foreground">Checked {healthCheck.checked_devices || 0} assets against {healthCheck.checked_rules || 0} active rules. This preview never creates alerts or tickets.</p></div><Badge className={wouldTrigger.length ? SEV_STYLES.high : "border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"}>{wouldTrigger.length ? `${wouldTrigger.length} would trigger` : "No immediate triggers"}</Badge></CardHeader><CardContent><div className="mb-3 flex flex-wrap gap-2 text-xs"><Badge variant="outline">{waiting.length} waiting for duration</Badge><Badge variant="outline">{suppressed.length} suppressed / cooling down</Badge></div>{results.length === 0 ? <p className="py-3 text-center text-sm text-muted-foreground">All monitored values are within their configured thresholds.</p> : <div className="divide-y rounded-lg border">{results.slice(0, 12).map((result, index) => <div key={`${result.rule_id}-${result.device_id}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"><div><span className="font-medium">{result.device_name}</span><span className="mx-1.5 text-muted-foreground">/</span><span>{result.rule_name}</span>{result.value != null && <span className="ml-2 font-mono text-muted-foreground">value {result.value}</span>}</div><Badge variant="outline" className="text-[10px] capitalize">{result.status.replace(/_/g, " ")}</Badge></div>)}</div>}</CardContent></Card>;
      })()}

      <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2 px-1"><div><h2 className="text-sm font-semibold">Policy coverage</h2><p className="text-xs text-muted-foreground">{filteredRules.length} of {rules.length} rules shown</p></div>{ruleFilter !== "all" && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setRuleFilter("all")}>Clear filter</Button>}</div>{filteredRules.map((rule) => { const metric = options?.metrics?.find((item) => item.id === rule.metric); const actions = rule.actions || []; return <Card key={rule.id} className={!rule.enabled ? "opacity-60" : ""} data-testid={`rule-${rule.id}`}><CardContent className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 items-start gap-3"><Switch checked={Boolean(rule.enabled)} onCheckedChange={() => toggleRule(rule.id)} aria-label={`Toggle ${rule.name}`} /><div className="min-w-0"><p className="font-medium">{rule.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{rule.description || "No technician guidance provided."}</p></div></div><div className="flex items-center gap-1.5 self-end sm:self-auto"><Badge className={`${SEV_STYLES[rule.severity] || SEV_STYLES.high} border text-[9px] capitalize`}>{rule.severity}</Badge><Button size="sm" variant="ghost" onClick={() => openEdit(rule)} data-testid={`edit-rule-${rule.id}`}><Edit3 className="mr-1 h-3.5 w-3.5" />Edit</Button><Button size="icon" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => setDeleteTarget(rule)} aria-label={`Delete ${rule.name}`}><Trash2 className="h-3.5 w-3.5" /></Button></div></div><div className="mt-3 flex flex-wrap items-center gap-2"><Badge variant="outline" className="text-xs">IF {metric?.label || rule.metric} {rule.operator?.replace(/_/g, " ")} {rule.threshold}{metric?.unit || ""}</Badge>{Number(rule.duration_minutes) > 0 && <Badge variant="outline" className="text-xs">FOR {rule.duration_minutes} min</Badge>}<Badge variant="outline" className="text-xs">SCOPE: {scopeSummary(rule, clients, devices)}</Badge>{actions.length > 0 ? <><span className="text-xs text-muted-foreground">THEN</span>{actions.map((action, index) => <Badge key={`${action.type}-${index}`} className="border border-emerald-500/20 bg-emerald-500/10 text-[9px] text-emerald-400">{action.type?.replace(/_/g, " ")}</Badge>)}</> : <Badge variant="outline" className="text-xs">Record alert only</Badge>}{Number(rule.cooldown_minutes) > 0 && <Badge variant="outline" className="text-[9px]"><Clock className="mr-1 h-3 w-3" />{rule.cooldown_minutes}m cooldown</Badge>}</div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-[11px] text-muted-foreground"><span>{rule.trigger_count || 0} total trigger{Number(rule.trigger_count || 0) === 1 ? "" : "s"}</span><span>Last triggered: {formatDateTime(rule.last_triggered)}</span>{rule.created_by && <span>Owner: {rule.created_by}</span>}</div></CardContent></Card>; })}{filteredRules.length === 0 && <Card className="border-dashed"><CardContent className="py-12 text-center text-muted-foreground">{rules.length === 0 ? "No alert rules configured. Create a policy only when the operational response is agreed." : "No rules match this filter."}</CardContent></Card>}</section>
      <RuleEditor open={showEditor} form={form} setForm={setForm} options={options} clients={clients} devices={devices} editingRule={editingRule} saving={saving} onClose={closeEditor} onSave={saveRule} />
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(isOpen) => !isOpen && setDeleteTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete alert rule?</AlertDialogTitle><AlertDialogDescription>This permanently removes “{deleteTarget?.name}”. Existing alerts and tickets remain in their audit history.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep rule</AlertDialogCancel><AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={deleteRule}>Delete rule</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}
