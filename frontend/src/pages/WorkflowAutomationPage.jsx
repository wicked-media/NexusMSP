import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Workflow, Plus, Trash2, Play, Pause, Settings, Zap, ChevronRight,
  ArrowRight, ArrowDown, RefreshCw, Loader2, CheckCircle, XCircle,
  Clock, Mail, MessageSquare, Monitor, Shield, AlertTriangle, DollarSign,
  Terminal, Globe, Tag, RotateCcw, GitBranch, Eye, Copy, Search
} from "lucide-react";

const ACTION_ICONS = {
  assign_ticket: Zap, change_priority: ArrowRight, add_note: MessageSquare,
  send_email: Mail, send_slack: MessageSquare, send_teams: MessageSquare,
  create_ticket: Plus, escalate: AlertTriangle, run_script: Terminal,
  webhook: Globe, tag_device: Tag, reboot_device: RotateCcw,
  wait: Clock, condition: GitBranch,
};

const TRIGGER_ICONS = {
  ticket_created: Zap, ticket_updated: RefreshCw, ticket_sla_breach: Clock,
  device_offline: XCircle, device_warning: AlertTriangle, backup_failed: Shield,
  alert_triggered: AlertTriangle, client_health_change: Monitor,
  invoice_overdue: DollarSign, schedule: Clock, patch_available: Shield, new_client: Plus,
};

export default function WorkflowAutomationPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [workflows, setWorkflows] = useState([]);
  const [triggers, setTriggers] = useState([]);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState("");
  const [editWf, setEditWf] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [wfRes, trigRes, actRes, statsRes] = await Promise.all([
        axios.get(`${API}/workflows`, { headers }),
        axios.get(`${API}/workflows/triggers`, { headers }),
        axios.get(`${API}/workflows/actions`, { headers }),
        axios.get(`${API}/workflows/stats/overview`, { headers }),
      ]);
      setWorkflows(wfRes.data);
      setTriggers(trigRes.data);
      setActions(actRes.data);
      setStats(statsRes.data);
    } catch { toast.error("Failed to load workflows"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const createWorkflow = async () => {
    if (!createForm.name.trim()) { toast.error("Name required"); return; }
    setSaving(true);
    try {
      const res = await axios.post(`${API}/workflows`, createForm, { headers });
      toast.success("Workflow created");
      setShowCreate(false);
      setCreateForm({ name: "", description: "" });
      setEditWf(res.data);
      fetchData();
    } catch { toast.error("Failed to create workflow"); }
    finally { setSaving(false); }
  };

  const toggleWorkflow = async (wfId) => {
    try {
      const res = await axios.post(`${API}/workflows/${wfId}/toggle`, {}, { headers });
      toast.success(res.data.enabled ? "Workflow enabled" : "Workflow disabled");
      fetchData();
    } catch { toast.error("Failed to toggle"); }
  };

  const deleteWorkflow = async (wfId) => {
    if (!window.confirm("Delete this workflow?")) return;
    try {
      await axios.delete(`${API}/workflows/${wfId}`, { headers });
      toast.success("Workflow deleted");
      if (editWf?.id === wfId) setEditWf(null);
      fetchData();
    } catch { toast.error("Failed to delete"); }
  };

  const saveWorkflow = async () => {
    if (!editWf) return;
    setSaving(true);
    try {
      await axios.put(`${API}/workflows/${editWf.id}`, editWf, { headers });
      toast.success("Workflow saved");
      fetchData();
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  };

  const testWorkflow = async () => {
    if (!editWf) return;
    try {
      const res = await axios.post(`${API}/workflows/${editWf.id}/test`, {}, { headers });
      setTestResult(res.data);
      toast.success("Test completed");
      fetchData();
    } catch { toast.error("Test failed"); }
  };

  const addAction = (actionType) => {
    const newAction = { id: `act-${Date.now()}`, type: actionType, config: {} };
    setEditWf(prev => ({ ...prev, actions: [...(prev.actions || []), newAction] }));
  };

  const removeAction = (actionId) => {
    setEditWf(prev => ({ ...prev, actions: (prev.actions || []).filter(a => a.id !== actionId) }));
  };

  const updateActionConfig = (actionId, key, value) => {
    setEditWf(prev => ({
      ...prev,
      actions: (prev.actions || []).map(a => a.id === actionId ? { ...a, config: { ...a.config, [key]: value } } : a),
    }));
  };

  const filtered = workflows.filter(w => w.name?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="workflow-automation-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Workflow className="w-6 h-6 text-violet-400" />Workflow Automation</h1>
          <p className="text-muted-foreground mt-1">Build automated workflows with triggers, conditions, and actions</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-workflow-btn"><Plus className="w-4 h-4 mr-1" />New Workflow</Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total Workflows", value: stats.total, icon: Workflow, color: "text-violet-400", bg: "bg-violet-500/10" },
            { label: "Active", value: stats.active, icon: Play, color: "text-emerald-400", bg: "bg-emerald-500/10" },
            { label: "Inactive", value: stats.inactive, icon: Pause, color: "text-zinc-400", bg: "bg-zinc-500/10" },
            { label: "Total Executions", value: stats.total_executions, icon: Zap, color: "text-amber-400", bg: "bg-amber-500/10" },
          ].map((s, i) => (
            <Card key={`s-${i}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}><s.icon className={`w-5 h-5 ${s.color}`} /></div>
                <div><p className="text-2xl font-bold">{s.value}</p><p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p></div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        {/* Workflow List */}
        <div className="col-span-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search workflows..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <ScrollArea className="h-[calc(100vh-340px)]">
            <div className="space-y-2">
              {filtered.map(wf => (
                <Card key={wf.id}
                  className={`cursor-pointer transition-all hover:border-primary/30 ${editWf?.id === wf.id ? "border-primary ring-1 ring-primary" : ""}`}
                  onClick={() => { setEditWf(wf); setTestResult(null); }}
                  data-testid={`workflow-${wf.id}`}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm truncate">{wf.name}</span>
                      <Switch checked={wf.enabled} onCheckedChange={() => toggleWorkflow(wf.id)} onClick={e => e.stopPropagation()} />
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">{wf.description || "No description"}</p>
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                      <Badge variant="outline" className="text-[9px]">{wf.trigger?.type || "No trigger"}</Badge>
                      <span>{(wf.actions || []).length} actions</span>
                      <span className="ml-auto">{wf.execution_count || 0} runs</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {filtered.length === 0 && <p className="text-center text-muted-foreground py-8 text-sm">No workflows yet</p>}
            </div>
          </ScrollArea>
        </div>

        {/* Workflow Editor */}
        <div className="col-span-8">
          {editWf ? (
            <Card data-testid="workflow-editor">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <Input value={editWf.name} onChange={e => setEditWf(prev => ({ ...prev, name: e.target.value }))}
                    className="text-lg font-bold border-0 p-0 h-auto focus-visible:ring-0 shadow-none" data-testid="workflow-name-input" />
                  <Input value={editWf.description || ""} onChange={e => setEditWf(prev => ({ ...prev, description: e.target.value }))}
                    className="text-sm text-muted-foreground border-0 p-0 h-auto focus-visible:ring-0 shadow-none mt-1" placeholder="Add description..." />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={testWorkflow} data-testid="test-workflow-btn"><Play className="w-3 h-3 mr-1" />Test</Button>
                  <Button size="sm" onClick={saveWorkflow} disabled={saving} data-testid="save-workflow-btn">
                    {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle className="w-3 h-3 mr-1" />}Save
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteWorkflow(editWf.id)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Trigger */}
                <div className="p-4 rounded-xl border-2 border-dashed border-violet-500/30 bg-violet-500/5">
                  <Label className="text-xs text-violet-400 uppercase tracking-wider flex items-center gap-1"><Zap className="w-3 h-3" />When (Trigger)</Label>
                  <Select value={editWf.trigger?.type || ""} onValueChange={v => setEditWf(prev => ({ ...prev, trigger: { ...prev.trigger, type: v } }))}>
                    <SelectTrigger className="mt-2" data-testid="trigger-select"><SelectValue placeholder="Select trigger..." /></SelectTrigger>
                    <SelectContent>
                      {triggers.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {editWf.trigger?.type && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Category: {triggers.find(t => t.id === editWf.trigger.type)?.category}
                    </div>
                  )}
                </div>

                {/* Visual Flow Arrow */}
                <div className="flex justify-center"><ArrowDown className="w-5 h-5 text-muted-foreground" /></div>

                {/* Actions List */}
                <div className="space-y-2">
                  <Label className="text-xs text-emerald-400 uppercase tracking-wider flex items-center gap-1"><Play className="w-3 h-3" />Then (Actions)</Label>
                  {(editWf.actions || []).map((action, idx) => {
                    const ActIcon = ACTION_ICONS[action.type] || Zap;
                    const actionDef = actions.find(a => a.id === action.type);
                    return (
                      <div key={action.id} className="p-3 rounded-lg border bg-card hover:border-primary/30 transition-colors" data-testid={`action-${idx}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center"><ActIcon className="w-4 h-4 text-emerald-400" /></div>
                            <span className="text-sm font-medium">{actionDef?.label || action.type}</span>
                            <Badge variant="outline" className="text-[9px]">Step {idx + 1}</Badge>
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => removeAction(action.id)}><Trash2 className="w-3 h-3" /></Button>
                        </div>
                        {/* Config fields based on action type */}
                        <div className="grid grid-cols-2 gap-2">
                          {(actionDef?.fields || []).map(field => (
                            <div key={field}>
                              <Label className="text-[10px] text-muted-foreground capitalize">{field.replace(/_/g, " ")}</Label>
                              <Input size="sm" className="h-8 text-xs" value={action.config?.[field] || ""}
                                onChange={e => updateActionConfig(action.id, field, e.target.value)}
                                placeholder={field} />
                            </div>
                          ))}
                        </div>
                        {idx < (editWf.actions || []).length - 1 && (
                          <div className="flex justify-center mt-2"><ArrowDown className="w-4 h-4 text-muted-foreground/50" /></div>
                        )}
                      </div>
                    );
                  })}

                  {/* Add Action */}
                  <Select onValueChange={v => addAction(v)}>
                    <SelectTrigger className="border-dashed border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/5" data-testid="add-action-select">
                      <SelectValue placeholder="+ Add Action..." />
                    </SelectTrigger>
                    <SelectContent>
                      {actions.map(a => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {/* Test Results */}
                {testResult && (
                  <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20" data-testid="test-results">
                    <p className="text-sm font-medium text-emerald-400 mb-2">Test Results</p>
                    {testResult.results?.map((r, i) => (
                      <div key={`r-${i}`} className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                        <CheckCircle className="w-3 h-3 text-emerald-400" />
                        <span>{r.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="h-full flex items-center justify-center">
              <CardContent className="text-center py-20">
                <Workflow className="w-16 h-16 mx-auto text-muted-foreground/20 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">Select a workflow to edit</p>
                <p className="text-sm text-muted-foreground/60 mt-1">Or create a new one to get started</p>
                <Button className="mt-4" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-1" />Create Workflow</Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md" aria-describedby="create-wf-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Workflow className="w-5 h-5 text-violet-400" />New Workflow</DialogTitle>
            <DialogDescription id="create-wf-desc">Create a new automation workflow</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={createForm.name} onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Auto-escalate critical tickets" data-testid="create-wf-name" /></div>
            <div><Label>Description</Label><Textarea value={createForm.description} onChange={e => setCreateForm(p => ({ ...p, description: e.target.value }))} placeholder="What does this workflow do?" rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createWorkflow} disabled={saving} data-testid="create-wf-submit">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
