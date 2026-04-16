import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  BellOff, Plus, Clock, Shield, Trash2, RefreshCw, Loader2,
  Zap, Search, Filter, BarChart3, Activity, Settings, Power
} from "lucide-react";

export default function AlertSuppressionPage() {
  const { token } = useAuth();
  const [rules, setRules] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("rules");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", match_type: "message_contains", match_value: "", scope: "all" });
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, sRes] = await Promise.all([
        axios.get(`${API}/alert-suppression/rules`, { headers }),
        axios.get(`${API}/alert-suppression/stats`, { headers }),
      ]);
      setRules(rRes.data);
      setStats(sRes.data);
    } catch { toast.error("Failed to load rules"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleRule = async (ruleId, enabled) => {
    try {
      await axios.put(`${API}/alert-suppression/rules/${ruleId}`, { enabled }, { headers });
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled } : r));
      toast.success(enabled ? "Rule enabled" : "Rule disabled");
    } catch { toast.error("Failed to update"); }
  };

  const deleteRule = async (ruleId) => {
    if (!confirm("Delete this suppression rule?")) return;
    try {
      await axios.delete(`${API}/alert-suppression/rules/${ruleId}`, { headers });
      setRules(prev => prev.filter(r => r.id !== ruleId));
      toast.success("Rule deleted");
    } catch { toast.error("Failed to delete"); }
  };

  const createRule = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API}/alert-suppression/rules`, form, { headers });
      setRules(prev => [...prev, res.data]);
      toast.success("Rule created");
      setShowCreate(false);
      setForm({ name: "", description: "", match_type: "message_contains", match_value: "", scope: "all" });
      fetchData();
    } catch { toast.error("Failed to create rule"); }
  };

  if (loading || !stats) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const filtered = rules.filter(r => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase()) && !r.description?.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter === "active" && !r.enabled) return false;
    if (statusFilter === "disabled" && r.enabled) return false;
    return true;
  });

  const totalSuppressed = rules.reduce((s, r) => s + (r.suppressed_count || 0), 0);
  const matchTypes = { alert_type: "Alert Type", message_contains: "Message Contains", schedule: "Schedule", threshold: "Threshold", dedup_window: "Dedup Window" };

  return (
    <div className="space-y-5" data-testid="alert-suppression-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center"><BellOff className="w-5 h-5 text-white" /></div>
            Alert Suppression Engine
          </h1>
          <p className="text-muted-foreground mt-1">Reduce noise with intelligent alert suppression rules</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
          <Button onClick={() => setShowCreate(true)} data-testid="create-rule-btn"><Plus className="w-4 h-4 mr-2" />New Rule</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Rules", value: stats.total_rules, icon: Settings, color: "text-blue-400" },
          { label: "Active Rules", value: stats.active_rules, icon: Shield, color: "text-emerald-400" },
          { label: "Alerts Suppressed", value: totalSuppressed.toLocaleString(), icon: BellOff, color: "text-amber-400" },
          { label: "Time Saved", value: `${stats.estimated_time_saved_hours}h`, icon: Clock, color: "text-cyan-400" },
        ].map(st => (
          <Card key={st.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`text-2xl font-bold ${st.color}`}>{st.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Effectiveness Bar */}
      <Card className="border-border/40">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Noise Reduction Impact</span>
            <span className="text-sm font-bold text-emerald-400">{totalSuppressed.toLocaleString()} alerts silenced</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {rules.filter(r => r.enabled).sort((a, b) => (b.suppressed_count || 0) - (a.suppressed_count || 0)).slice(0, 5).map(r => (
              <div key={r.id} className="p-2 rounded-lg bg-muted/30 border border-border/20 text-center">
                <p className="text-sm font-bold text-amber-400">{(r.suppressed_count || 0).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground truncate">{r.name}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rules">Rules ({rules.length})</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search rules..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="rule-search" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><BellOff className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" /><p className="text-muted-foreground">No rules match your filters</p></CardContent></Card>
          ) : filtered.map(r => (
            <Card key={r.id} className={`border transition-all hover:shadow-md ${r.enabled ? "border-border/40" : "border-border/20 opacity-60"}`} data-testid={`rule-${r.id}`}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${r.enabled ? "bg-emerald-500/10" : "bg-muted"}`}>
                    <BellOff className={`w-5 h-5 ${r.enabled ? "text-emerald-400" : "text-muted-foreground"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-sm">{r.name}</h3>
                      <Badge variant={r.enabled ? "default" : "secondary"} className="text-[10px]">{r.enabled ? "Active" : "Disabled"}</Badge>
                      <Badge variant="outline" className="text-[10px]">{matchTypes[r.match_type] || r.match_type}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{r.description}</p>
                    <div className="flex items-center gap-4 mt-2">
                      <span className="text-xs text-muted-foreground">Match: <code className="bg-muted px-1.5 py-0.5 rounded text-[10px]">{r.match_value}</code></span>
                      <span className="text-xs text-muted-foreground">Scope: <strong className="text-foreground">{r.scope}</strong></span>
                      <span className="text-xs text-muted-foreground">Suppressed: <strong className="text-amber-400">{(r.suppressed_count || 0).toLocaleString()}</strong></span>
                      {r.created_by && <span className="text-xs text-muted-foreground">By: {r.created_by}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={r.enabled} onCheckedChange={(v) => toggleRule(r.id, v)} data-testid={`toggle-${r.id}`} />
                    <Button variant="ghost" size="icon" onClick={() => deleteRule(r.id)} className="text-red-500 hover:text-red-600 hover:bg-red-500/10" data-testid={`delete-${r.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Card className="border-border/40">
              <CardHeader className="pb-2"><CardTitle className="text-sm">By Match Type</CardTitle></CardHeader>
              <CardContent>
                {Object.entries(matchTypes).map(([key, label]) => {
                  const count = rules.filter(r => r.match_type === key).length;
                  const suppressed = rules.filter(r => r.match_type === key).reduce((s, r) => s + (r.suppressed_count || 0), 0);
                  if (count === 0) return null;
                  return (
                    <div key={key} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
                      <div><p className="text-sm font-medium">{label}</p><p className="text-[10px] text-muted-foreground">{count} rules</p></div>
                      <Badge variant="outline" className="text-amber-400">{suppressed.toLocaleString()}</Badge>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <Card className="border-border/40">
              <CardHeader className="pb-2"><CardTitle className="text-sm">By Scope</CardTitle></CardHeader>
              <CardContent>
                {[...new Set(rules.map(r => r.scope))].map(scope => {
                  const count = rules.filter(r => r.scope === scope).length;
                  const suppressed = rules.filter(r => r.scope === scope).reduce((s, r) => s + (r.suppressed_count || 0), 0);
                  return (
                    <div key={scope} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
                      <div><p className="text-sm font-medium capitalize">{scope}</p><p className="text-[10px] text-muted-foreground">{count} rules</p></div>
                      <Badge variant="outline" className="text-amber-400">{suppressed.toLocaleString()}</Badge>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <Card className="border-border/40">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Top Suppressors</CardTitle></CardHeader>
              <CardContent>
                {[...rules].sort((a, b) => (b.suppressed_count || 0) - (a.suppressed_count || 0)).slice(0, 5).map(r => (
                  <div key={r.id} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
                    <p className="text-sm truncate flex-1 mr-2">{r.name}</p>
                    <span className="font-mono text-sm font-bold text-amber-400">{(r.suppressed_count || 0).toLocaleString()}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Create Rule Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md" aria-describedby="create-rule-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="w-5 h-5 text-blue-400" />Create Suppression Rule</DialogTitle>
            <DialogDescription id="create-rule-desc">Define a new alert suppression rule</DialogDescription>
          </DialogHeader>
          <form onSubmit={createRule} className="space-y-4">
            <div className="space-y-2"><Label>Rule Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Suppress agent heartbeat noise" required data-testid="rule-name-input" /></div>
            <div className="space-y-2"><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Why this rule exists..." /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Match Type</Label>
                <Select value={form.match_type} onValueChange={v => setForm({ ...form, match_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(matchTypes).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Scope</Label>
                <Select value={form.scope} onValueChange={v => setForm({ ...form, scope: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="servers">Servers</SelectItem>
                    <SelectItem value="workstations">Workstations</SelectItem>
                    <SelectItem value="network">Network</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Match Value *</Label><Input value={form.match_value} onChange={e => setForm({ ...form, match_value: e.target.value })} placeholder="e.g., agent_check_in or Sunday 02:00-06:00" required /></div>
            <DialogFooter><Button type="submit" data-testid="save-rule-btn">Create Rule</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
