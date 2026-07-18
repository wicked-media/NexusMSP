import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { AlertTriangle, Plus, Trash2, Zap, Loader2, Bell, Shield, Clock, Play, Pause, Edit } from "lucide-react";

const SEV_STYLES = {
  critical: "bg-red-500/10 text-red-400 border-red-500/20",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  low: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

export default function AlertRulesPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [rules, setRules] = useState([]);
  const [options, setOptions] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [healthCheck, setHealthCheck] = useState(null);
  const emptyForm = { name: "", description: "", metric: "cpu_usage", operator: "greater_than", threshold: "90", duration_minutes: "5", severity: "high", cooldown_minutes: "30", scope: "all", actions: [{ type: "create_ticket", config: { priority: "high" } }] };
  const [form, setForm] = useState(emptyForm);

  const fetchData = useCallback(async () => {
    try {
      const [rRes, oRes, sRes] = await Promise.all([
        axios.get(`${API}/alert-rules`, { headers }),
        axios.get(`${API}/alert-rules/options`, { headers }),
        axios.get(`${API}/alert-rules/stats`, { headers }),
      ]);
      setRules(rRes.data);
      setOptions(oRes.data);
      setStats(sRes.data);
    } catch { toast.error("Failed to load alert rules"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const createRule = async () => {
    if (!form.name) { toast.error("Name required"); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/alert-rules`, { ...form, threshold: parseFloat(form.threshold), duration_minutes: parseInt(form.duration_minutes), cooldown_minutes: parseInt(form.cooldown_minutes) }, { headers });
      toast.success("Alert rule created");
      setShowCreate(false);
      setForm(emptyForm);
      fetchData();
    } catch { toast.error("Failed"); }
    finally { setSaving(false); }
  };

  const toggleRule = async (id) => {
    try { const res = await axios.post(`${API}/alert-rules/${id}/toggle`, {}, { headers }); toast.success(res.data.enabled ? "Rule enabled" : "Rule disabled"); fetchData(); }
    catch { toast.error("Failed"); }
  };

  const deleteRule = async (id) => {
    if (!window.confirm("Delete this rule?")) return;
    try { await axios.delete(`${API}/alert-rules/${id}`, { headers }); toast.success("Deleted"); fetchData(); }
    catch { toast.error("Failed"); }
  };

  const evaluateRules = async () => {
    setEvaluating(true);
    try {
      const res = await axios.post(`${API}/alert-rules/evaluate?dry_run=true`, {}, { headers });
      const matches = (res.data?.matches || []).filter(m => m.status === "would_trigger").length;
      setHealthCheck(res.data || null);
      toast.success(`Health check complete: ${matches} rule${matches === 1 ? "" : "s"} would trigger.`);
    } catch { toast.error("Unable to evaluate alert rules"); }
    finally { setEvaluating(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="alert-rules-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Bell className="w-6 h-6 text-amber-400" />Alert Rules Engine</h1><p className="text-muted-foreground mt-1">Define threshold-based alerts with automated actions</p></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={evaluateRules} disabled={evaluating} data-testid="evaluate-rules-btn">
            {evaluating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}Run health check
          </Button>
          <Button onClick={() => { setShowCreate(true); setForm(emptyForm); }} data-testid="create-rule-btn"><Plus className="w-4 h-4 mr-1" />New Rule</Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Rules", value: stats.total, icon: Shield, color: "text-blue-400", bg: "bg-blue-500/10" },
            { label: "Active", value: stats.active, icon: Zap, color: "text-emerald-400", bg: "bg-emerald-500/10" },
            { label: "Total Triggered", value: stats.total_triggered, icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10" },
          ].map((s, i) => (
            <Card key={`s-${i}`}><CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}><s.icon className={`w-5 h-5 ${s.color}`} /></div>
              <div><p className="text-2xl font-bold">{s.value}</p><p className="text-[10px] text-muted-foreground uppercase">{s.label}</p></div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {healthCheck && (() => {
        const results = healthCheck.matches || [];
        const wouldTrigger = results.filter(result => result.status === "would_trigger");
        const waiting = results.filter(result => result.status === "waiting_for_duration");
        const suppressed = results.filter(result => ["cooldown", "suppressed_by_maintenance"].includes(result.status));
        return <Card className={wouldTrigger.length ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-emerald-500/20 bg-emerald-500/[0.03]"} data-testid="alert-health-check-results">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><div><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4 text-cyan-400" />Latest health check</CardTitle><p className="mt-1 text-xs text-muted-foreground">Checked {healthCheck.checked_devices || 0} devices against {healthCheck.checked_rules || 0} active rules. This preview does not create alerts or tickets.</p></div><Badge className={wouldTrigger.length ? SEV_STYLES.high : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"}>{wouldTrigger.length ? `${wouldTrigger.length} would trigger` : "No immediate triggers"}</Badge></CardHeader>
          <CardContent><div className="mb-3 flex flex-wrap gap-2 text-xs"><Badge variant="outline">{waiting.length} waiting for duration</Badge><Badge variant="outline">{suppressed.length} suppressed / cooling down</Badge></div>{results.length === 0 ? <p className="py-3 text-center text-sm text-muted-foreground">All monitored values are within their configured thresholds.</p> : <div className="divide-y rounded-lg border">{results.slice(0, 12).map((result, index) => <div key={`${result.rule_id}-${result.device_id}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"><div><span className="font-medium">{result.device_name}</span><span className="mx-1.5 text-muted-foreground">/</span><span>{result.rule_name}</span>{result.value != null && <span className="ml-2 font-mono text-muted-foreground">value {result.value}</span>}</div><Badge variant="outline" className="text-[10px] capitalize">{result.status.replace(/_/g, " ")}</Badge></div>)}</div>}</CardContent>
        </Card>;
      })()}

      {/* Rules Cards */}
      <div className="space-y-3">
        {rules.map(r => {
          const metricLabel = options?.metrics?.find(m => m.id === r.metric)?.label || r.metric;
          const opLabel = r.operator?.replace(/_/g, " ");
          return (
            <Card key={r.id} className={`${!r.enabled ? "opacity-50" : ""}`} data-testid={`rule-${r.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Switch checked={r.enabled} onCheckedChange={() => toggleRule(r.id)} />
                    <div>
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`${SEV_STYLES[r.severity]} text-[9px] border capitalize`}>{r.severity}</Badge>
                    <Badge variant="outline" className="text-[9px] font-mono">{r.trigger_count}x triggered</Badge>
                    <Button size="sm" variant="ghost" className="text-red-400" onClick={() => deleteRule(r.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <Badge variant="outline" className="text-xs">IF {metricLabel} {opLabel} {r.threshold}{options?.metrics?.find(m => m.id === r.metric)?.unit || ""}</Badge>
                  {r.duration_minutes > 0 && <Badge variant="outline" className="text-xs">FOR {r.duration_minutes} min</Badge>}
                  <span className="text-xs text-muted-foreground">THEN</span>
                  {(r.actions || []).map((a, i) => <Badge key={`a-${i}`} className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{a.type?.replace(/_/g, " ")}</Badge>)}
                  {r.cooldown_minutes > 0 && <Badge variant="outline" className="text-[9px]"><Clock className="w-3 h-3 mr-1" />{r.cooldown_minutes}m cooldown</Badge>}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {rules.length === 0 && <Card><CardContent className="py-12 text-center text-muted-foreground">No alert rules configured</CardContent></Card>}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg" aria-describedby="create-rule-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bell className="w-5 h-5 text-amber-400" />New Alert Rule</DialogTitle>
            <DialogDescription id="create-rule-desc">Define a condition and automated response</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Rule Name</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g., CPU Critical - Servers" data-testid="rule-name" /></div>
            <div><Label>Description</Label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What does this rule monitor?" /></div>
            <Separator />
            <Label className="text-xs text-muted-foreground uppercase">Condition: IF...</Label>
            <div className="grid grid-cols-3 gap-2">
              <Select value={form.metric} onValueChange={v => setForm(p => ({ ...p, metric: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{options?.metrics?.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={form.operator} onValueChange={v => setForm(p => ({ ...p, operator: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{options?.operators?.map(o => <SelectItem key={o} value={o}>{o.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" value={form.threshold} onChange={e => setForm(p => ({ ...p, threshold: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Duration (min, 0=instant)</Label><Input type="number" value={form.duration_minutes} onChange={e => setForm(p => ({ ...p, duration_minutes: e.target.value }))} /></div>
              <div><Label className="text-xs">Cooldown (min)</Label><Input type="number" value={form.cooldown_minutes} onChange={e => setForm(p => ({ ...p, cooldown_minutes: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Severity</Label>
              <Select value={form.severity} onValueChange={v => setForm(p => ({ ...p, severity: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createRule} disabled={saving} data-testid="rule-submit">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Rule"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
