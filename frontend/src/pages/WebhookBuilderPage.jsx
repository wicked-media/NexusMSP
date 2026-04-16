import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Webhook, Plus, Play, Pause, Trash2, Edit, Search, RefreshCw, Loader2,
  Code, Zap, Send, Check, X, Copy, Settings, FileText, Clock,
  AlertTriangle, ChevronDown, ChevronUp, ExternalLink, ToggleLeft, ToggleRight
} from "lucide-react";

const METHODS = ["POST", "PUT", "PATCH", "GET", "DELETE"];
const METHOD_COLORS = { POST: "bg-emerald-500/20 text-emerald-400", PUT: "bg-amber-500/20 text-amber-400", PATCH: "bg-blue-500/20 text-blue-400", GET: "bg-cyan-500/20 text-cyan-400", DELETE: "bg-red-500/20 text-red-400" };
const TRIGGER_CAT_COLORS = { tickets: "bg-blue-500/20 text-blue-400", monitoring: "bg-cyan-500/20 text-cyan-400", backup: "bg-purple-500/20 text-purple-400", billing: "bg-emerald-500/20 text-emerald-400", clients: "bg-amber-500/20 text-amber-400", security: "bg-red-500/20 text-red-400", sla: "bg-orange-500/20 text-orange-400", patching: "bg-violet-500/20 text-violet-400", auth: "bg-gray-500/20 text-gray-400" };

export default function WebhookBuilderPage() {
  const { token } = useAuth();
  const [hooks, setHooks] = useState([]);
  const [triggers, setTriggers] = useState([]);
  const [samplePayloads, setSamplePayloads] = useState({});
  const [loading, setLoading] = useState(true);
  const [createDialog, setCreateDialog] = useState(false);
  const [editHook, setEditHook] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", trigger: "ticket.created", method: "POST", url: "", headers: '{"Content-Type": "application/json"}', payload_template: "", retry_count: 3, retry_delay: 30 });
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [hRes, tRes] = await Promise.all([
        axios.get(`${API}/webhook-builder/list`, { headers }),
        axios.get(`${API}/webhook-builder/triggers`, { headers }),
      ]);
      setHooks(hRes.data);
      setTriggers(tRes.data.triggers || []);
      setSamplePayloads(tRes.data.sample_payloads || {});
    } catch { toast.error("Failed to load webhooks"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    if (!form.name.trim() || !form.url.trim()) { toast.error("Name and URL are required"); return; }
    let parsedHeaders = {};
    try { parsedHeaders = JSON.parse(form.headers || "{}"); } catch { toast.error("Invalid JSON in headers"); return; }
    const payload = { ...form, headers: parsedHeaders };
    try {
      if (editHook) {
        await axios.put(`${API}/webhook-builder/${editHook.id}`, payload, { headers });
        toast.success("Webhook updated");
      } else {
        await axios.post(`${API}/webhook-builder/create`, payload, { headers });
        toast.success("Webhook created");
      }
      setCreateDialog(false); setEditHook(null); fetchData();
    } catch { toast.error("Failed to save"); }
  };

  const handleToggle = async (id) => {
    try { const r = await axios.post(`${API}/webhook-builder/${id}/toggle`, {}, { headers }); toast.success(`Webhook ${r.data.status}`); fetchData(); }
    catch { toast.error("Failed"); }
  };

  const handleDelete = async (id) => {
    try { await axios.delete(`${API}/webhook-builder/${id}`, { headers }); toast.success("Deleted"); fetchData(); }
    catch { toast.error("Failed"); }
  };

  const handleTest = async (id) => {
    setTestingId(id);
    try { const r = await axios.post(`${API}/webhook-builder/${id}/test`, {}, { headers }); toast.success(`Test: ${r.data.message} (${r.data.response_time_ms}ms)`); fetchData(); }
    catch { toast.error("Test failed"); }
    finally { setTestingId(null); }
  };

  const openEdit = (hook) => {
    setEditHook(hook);
    setForm({ name: hook.name, trigger: hook.trigger, method: hook.method, url: hook.url, headers: JSON.stringify(hook.headers || {}, null, 2), payload_template: hook.payload_template || "", retry_count: hook.retry_count || 3, retry_delay: hook.retry_delay || 30 });
    setCreateDialog(true);
  };

  const openCreate = () => {
    setEditHook(null);
    setForm({ name: "", trigger: "ticket.created", method: "POST", url: "", headers: '{"Content-Type": "application/json"}', payload_template: samplePayloads["ticket.created"] || "{}", retry_count: 3, retry_delay: 30 });
    setCreateDialog(true);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const active = hooks.filter(h => h.status === "active").length;
  const totalTriggers = hooks.reduce((s, h) => s + (h.trigger_count || 0), 0);
  const filtered = hooks.filter(h => !search || h.name.toLowerCase().includes(search.toLowerCase()) || h.trigger.toLowerCase().includes(search.toLowerCase()));

  // Group triggers by category
  const triggersByCategory = {};
  triggers.forEach(t => { if (!triggersByCategory[t.category]) triggersByCategory[t.category] = []; triggersByCategory[t.category].push(t); });

  return (
    <div className="space-y-5" data-testid="webhook-builder-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-cyan-500 flex items-center justify-center"><Webhook className="w-5 h-5 text-white" /></div>
            Webhook Builder
          </h1>
          <p className="text-muted-foreground mt-1">Create custom webhook integrations with any external service</p>
        </div>
        <Button onClick={openCreate} data-testid="new-webhook-btn" className="bg-cyan-600"><Plus className="w-4 h-4 mr-1" />New Webhook</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Webhooks", value: hooks.length, icon: Webhook, color: "text-blue-400" },
          { label: "Active", value: active, icon: Play, color: "text-emerald-400" },
          { label: "Paused", value: hooks.length - active, icon: Pause, color: "text-amber-400" },
          { label: "Total Triggers", value: totalTriggers.toLocaleString(), icon: Zap, color: "text-cyan-400" },
        ].map(s => (
          <Card key={s.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p><s.icon className={`w-4 h-4 ${s.color}`} /></div>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search webhooks..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>

      {/* Webhook Cards */}
      {filtered.length === 0 ? (
        <Card className="border-dashed"><CardContent className="py-16 text-center">
          <Webhook className="w-14 h-14 mx-auto text-muted-foreground/20 mb-4" />
          <p className="text-lg font-semibold mb-1">No Webhooks</p>
          <p className="text-sm text-muted-foreground mb-5">Create your first webhook to start integrating</p>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Create Webhook</Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(h => {
            const isExpanded = expandedId === h.id;
            const triggerInfo = triggers.find(t => t.value === h.trigger);
            return (
              <Card key={h.id} className={`border-border/40 transition-all ${h.status === "active" ? "border-l-2 border-l-emerald-500" : "border-l-2 border-l-amber-500/50 opacity-80"}`} data-testid={`webhook-${h.id}`}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center border border-cyan-500/20">
                      <Webhook className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm">{h.name}</span>
                        <Badge className={h.status === "active" ? "bg-emerald-500/20 text-emerald-400 text-[10px]" : "bg-amber-500/20 text-amber-400 text-[10px]"}>{h.status}</Badge>
                        <Badge className={`text-[10px] ${METHOD_COLORS[h.method] || ""}`}>{h.method}</Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <Badge variant="outline" className={`text-[10px] ${TRIGGER_CAT_COLORS[triggerInfo?.category] || ""}`}>{triggerInfo?.label || h.trigger}</Badge>
                        <code className="bg-muted/30 px-1.5 py-0.5 rounded text-[10px] truncate max-w-[300px]">{h.url}</code>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">{h.trigger_count || 0}</p>
                      <p className="text-[10px] text-muted-foreground">triggers</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => handleTest(h.id)} disabled={testingId === h.id} data-testid={`test-${h.id}`}>
                        {testingId === h.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}Test
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleToggle(h.id)}>
                        {h.status === "active" ? <Pause className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(h)}><Edit className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400" onClick={() => handleDelete(h.id)}><Trash2 className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpandedId(isExpanded ? null : h.id)}>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 space-y-3 border-t border-border/30 pt-3">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Payload Template</p>
                          <pre className="bg-muted/20 border border-border/30 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap max-h-[150px] overflow-auto">{h.payload_template || "{}"}</pre>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Headers</p>
                          <pre className="bg-muted/20 border border-border/30 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap">{JSON.stringify(h.headers || {}, null, 2)}</pre>
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            <span>Retries: {h.retry_count}</span>
                            <span>Delay: {h.retry_delay}s</span>
                            <span>Last triggered: {h.last_triggered?.slice(0, 16) || "Never"}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="max-w-2xl" aria-describedby="webhook-dialog-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Webhook className="w-5 h-5 text-cyan-400" />{editHook ? "Edit Webhook" : "Create Webhook"}</DialogTitle>
            <DialogDescription id="webhook-dialog-desc">{editHook ? "Update webhook configuration" : "Configure a new webhook integration"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Slack - Critical Alerts" data-testid="webhook-name" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Event Trigger</Label>
                <Select value={form.trigger} onValueChange={v => { setForm({ ...form, trigger: v, payload_template: samplePayloads[v] || form.payload_template }); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(triggersByCategory).map(([cat, trigs]) => (
                      <div key={cat}>
                        <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{cat}</p>
                        {trigs.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">HTTP Method</Label>
                <Select value={form.method} onValueChange={v => setForm({ ...form, method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{METHODS.map(m => <SelectItem key={m} value={m}><Badge className={`text-[10px] ${METHOD_COLORS[m]}`}>{m}</Badge></SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">Destination URL *</Label><Input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://hooks.slack.com/services/..." data-testid="webhook-url" /></div>
            <div><Label className="text-xs">Headers (JSON)</Label>
              <Textarea value={form.headers} onChange={e => setForm({ ...form, headers: e.target.value })} rows={2} className="font-mono text-xs" placeholder='{"Content-Type": "application/json"}' />
            </div>
            <div><Label className="text-xs">Payload Template (JSON) — Use {"{{variable}}"} for dynamic values</Label>
              <Textarea value={form.payload_template} onChange={e => setForm({ ...form, payload_template: e.target.value })} rows={4} className="font-mono text-xs" placeholder='{"text": "{{title}}"}' />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Retry Count</Label><Input type="number" value={form.retry_count} onChange={e => setForm({ ...form, retry_count: parseInt(e.target.value) || 0 })} /></div>
              <div><Label className="text-xs">Retry Delay (seconds)</Label><Input type="number" value={form.retry_delay} onChange={e => setForm({ ...form, retry_delay: parseInt(e.target.value) || 0 })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} data-testid="save-webhook-btn">{editHook ? "Update" : "Create Webhook"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
