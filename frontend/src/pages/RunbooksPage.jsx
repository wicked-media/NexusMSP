import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Workflow, Play, Plus, Trash2, Power, PowerOff, Loader2, RefreshCw,
  Zap, Clock, Settings, ChevronRight, Copy, ToggleLeft, ToggleRight
} from "lucide-react";

export default function RunbooksPage() {
  const { token } = useAuth();
  const [runbooks, setRunbooks] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", trigger: {}, conditions: [], actions: [] });
  const [tab, setTab] = useState("runbooks");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, tRes, lRes] = await Promise.all([
        axios.get(`${API}/automation`, { headers }),
        axios.get(`${API}/automation/templates`, { headers }),
        axios.get(`${API}/automation/logs`, { headers }),
      ]);
      setRunbooks(rRes.data);
      setTemplates(tRes.data);
      setLogs(lRes.data);
    } catch { toast.error("Failed to load runbooks"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const createRunbook = async () => {
    try {
      await axios.post(`${API}/automation`, form, { headers });
      toast.success("Runbook created");
      setShowCreate(false);
      setForm({ name: "", description: "", trigger: {}, conditions: [], actions: [] });
      fetchAll();
    } catch { toast.error("Failed to create"); }
  };

  const applyTemplate = (tmpl) => {
    setForm({ ...tmpl, name: tmpl.name, description: tmpl.description });
    setShowCreate(true);
  };

  const testRunbook = async (id) => {
    try {
      const res = await axios.post(`${API}/automation/${id}/test`, {}, { headers });
      toast.success("Runbook test completed");
      fetchAll();
    } catch { toast.error("Test failed"); }
  };

  const toggleRunbook = async (id, enabled) => {
    try {
      await axios.put(`${API}/automation/${id}`, { enabled: !enabled }, { headers });
      toast.success(enabled ? "Disabled" : "Enabled");
      fetchAll();
    } catch { toast.error("Failed to toggle"); }
  };

  const deleteRunbook = async (id) => {
    try { await axios.delete(`${API}/automation/${id}`, { headers }); toast.success("Deleted"); fetchAll(); }
    catch { toast.error("Failed to delete"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="runbooks-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Workflow className="w-8 h-8 text-violet-400" />Runbook Automation</h1>
          <p className="text-muted-foreground">{runbooks.length} runbooks &middot; {runbooks.filter(r => r.enabled).length} active</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchAll}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={() => setShowCreate(true)} data-testid="create-runbook-btn"><Plus className="w-4 h-4 mr-1" />New Runbook</Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {["runbooks", "templates", "logs"].map(t => (
          <Button key={t} variant={tab === t ? "default" : "outline"} size="sm" onClick={() => setTab(t)} className="capitalize">{t}</Button>
        ))}
      </div>

      {tab === "runbooks" && (
        <div className="grid grid-cols-2 gap-3">
          {runbooks.map(rb => (
            <Card key={rb.id} className={`${rb.enabled ? "border-violet-500/20" : "opacity-60"}`}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-bold flex items-center gap-2">
                      {rb.enabled ? <Power className="w-4 h-4 text-emerald-400" /> : <PowerOff className="w-4 h-4 text-zinc-500" />}
                      {rb.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{rb.description}</p>
                  </div>
                  <Badge className={rb.enabled ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-500/20 text-zinc-400"}>{rb.enabled ? "Active" : "Disabled"}</Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                  <Zap className="w-3 h-3" />Trigger: {rb.trigger?.type || "manual"}
                  <span>&middot;</span>
                  <span>{(rb.actions || []).length} actions</span>
                  <span>&middot;</span>
                  <span>Run {rb.run_count || 0}x</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => testRunbook(rb.id)} data-testid={`test-rb-${rb.id}`}><Play className="w-3 h-3 mr-1" />Test</Button>
                  <Button variant="outline" size="sm" onClick={() => toggleRunbook(rb.id, rb.enabled)}>{rb.enabled ? "Disable" : "Enable"}</Button>
                  <Button variant="outline" size="sm" className="text-red-400 hover:text-red-300" onClick={() => deleteRunbook(rb.id)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {runbooks.length === 0 && (
            <Card className="col-span-2"><CardContent className="py-12 text-center">
              <Workflow className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-30" />
              <p className="text-muted-foreground">No runbooks yet. Create one or use a template.</p>
            </CardContent></Card>
          )}
        </div>
      )}

      {tab === "templates" && (
        <div className="grid grid-cols-2 gap-3">
          {templates.map((t, i) => (
            <Card key={i} className="hover:border-violet-500/20 transition-all">
              <CardContent className="pt-4">
                <p className="font-bold">{t.name}</p>
                <p className="text-xs text-muted-foreground mb-3">{t.description}</p>
                <div className="space-y-1 mb-3">
                  <p className="text-[10px] text-muted-foreground">Trigger: {t.trigger?.type}</p>
                  {(t.actions || []).map((a, j) => (
                    <div key={j} className="text-[10px] flex items-center gap-1"><ChevronRight className="w-3 h-3 text-violet-400" />{a.type}</div>
                  ))}
                </div>
                <Button size="sm" onClick={() => applyTemplate(t)} data-testid={`use-template-${i}`}><Copy className="w-3 h-3 mr-1" />Use Template</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "logs" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Runbook</TableHead><TableHead>Status</TableHead><TableHead>Results</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
              <TableBody>
                {logs.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.runbook_name}</TableCell>
                    <TableCell><Badge className="bg-blue-500/20 text-blue-400 text-[10px]">{l.status}</Badge></TableCell>
                    <TableCell className="text-xs">{(l.results || []).length} actions executed</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.executed_at?.slice(0, 16)}</TableCell>
                  </TableRow>
                ))}
                {logs.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No executions yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create Runbook</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="rb-name" /></div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
            <div>
              <Label>Trigger Type</Label>
              <Select value={form.trigger?.type || ""} onValueChange={v => setForm({ ...form, trigger: { ...form.trigger, type: v } })}>
                <SelectTrigger><SelectValue placeholder="Select trigger" /></SelectTrigger>
                <SelectContent>
                  {["device_metric", "sla_countdown", "device_created", "device_offline", "ticket_created", "onboarding_completed"].map(t => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createRunbook} data-testid="save-runbook-btn">Create Runbook</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
