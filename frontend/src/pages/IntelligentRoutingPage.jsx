import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Brain, Users, Zap, Target, ArrowRight, RefreshCw, Loader2, Plus, Trash2,
  Shield, AlertCircle, CheckCircle, TrendingUp, BarChart3, Gauge, Edit
} from "lucide-react";

const methodLabels = { highest_skill: "Highest Skill", skill_match: "Skill Match", least_loaded: "Least Loaded", round_robin: "Round Robin" };

export default function IntelligentRoutingPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [routing, setRouting] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [ruleForm, setRuleForm] = useState({ name: "", priority: "", category: "", route_to: "skill_match", enabled: true });

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/intelligent-routing/dashboard`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to load routing data"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const bulkRoute = async () => {
    setRouting(true);
    try {
      const res = await axios.post(`${API}/intelligent-routing/bulk-route`, {}, { headers });
      toast.success(`Routed ${res.data.routed} tickets (${res.data.failed} failed)`);
      fetchData();
    } catch { toast.error("Bulk routing failed"); }
    finally { setRouting(false); }
  };

  const addRule = async () => {
    try {
      await axios.post(`${API}/intelligent-routing/rules`, ruleForm, { headers });
      toast.success("Rule created");
      setShowAddRule(false);
      setRuleForm({ name: "", priority: "", category: "", route_to: "skill_match", enabled: true });
      fetchData();
    } catch { toast.error("Failed"); }
  };

  const deleteRule = async (id) => {
    try {
      await axios.delete(`${API}/intelligent-routing/rules/${id}`, { headers });
      toast.success("Rule deleted");
      fetchData();
    } catch { toast.error("Failed"); }
  };

  const toggleRule = async (rule) => {
    try {
      await axios.put(`${API}/intelligent-routing/rules/${rule.id}`, { enabled: !rule.enabled }, { headers });
      fetchData();
    } catch { toast.error("Failed"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  if (!data) return null;

  const { technicians, routing_rules, stats } = data;

  return (
    <div className="space-y-5" data-testid="intelligent-routing-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Intelligent Routing</h1>
          <p className="text-sm text-muted-foreground">AI-powered ticket assignment based on skills, workload, and availability</p>
        </div>
        <Button onClick={bulkRoute} disabled={routing} data-testid="bulk-route-btn">
          {routing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Brain className="w-4 h-4 mr-1" />}
          Route {stats.unassigned} Unassigned
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Open Tickets</p><p className="text-2xl font-bold">{stats.total_open}</p></CardContent></Card>
        <Card className={stats.unassigned > 0 ? "border-amber-500/30" : ""}><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Unassigned</p><p className="text-2xl font-bold text-amber-500">{stats.unassigned}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Auto-Routed Today</p><p className="text-2xl font-bold text-blue-500">{stats.auto_routed_today}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Assignment</p><p className="text-2xl font-bold">{stats.avg_assignment_time_sec}s</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Routing Accuracy</p><p className="text-2xl font-bold text-emerald-500">{stats.routing_accuracy_pct}%</p></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Technician Workload */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wider">Technician Workload & Capacity</h2>
          <div className="space-y-2">
            {technicians.map(tech => (
              <Card key={tech.id} className={`border-l-4 ${tech.capacity > 4 ? "border-l-emerald-500" : tech.capacity > 1 ? "border-l-amber-500" : "border-l-red-500"}`} data-testid={`tech-${tech.id}`}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${tech.is_available ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}>
                      {tech.name?.split(" ").map(n => n[0]).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{tech.name}</p>
                        {tech.on_call && <Badge className="bg-purple-500/10 text-purple-400 text-[9px] border-purple-500/30">ON CALL</Badge>}
                        {!tech.is_available && <Badge className="bg-red-500/10 text-red-400 text-[9px]">UNAVAILABLE</Badge>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span>{tech.open_tickets} open</span>
                        <span className="text-muted-foreground/30">|</span>
                        <span>{tech.resolved_today} resolved today</span>
                        <span className="text-muted-foreground/30">|</span>
                        <span>SLA: {tech.sla_compliance}%</span>
                        <span className="text-muted-foreground/30">|</span>
                        <span>CSAT: {tech.csat_score}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {/* Skills mini badges */}
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {Object.entries(tech.skills || {}).slice(0, 4).map(([skill, level]) => (
                          <Badge key={skill} variant="outline" className={`text-[8px] h-4 ${level >= 4 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : level >= 3 ? "bg-blue-500/10 text-blue-400 border-blue-500/30" : "text-muted-foreground"}`}>
                            {skill.slice(0, 4)} {level}
                          </Badge>
                        ))}
                      </div>
                      {/* Capacity bar */}
                      <div className="w-16 text-center">
                        <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                          <div className={`h-full rounded-full ${tech.utilization_pct > 80 ? "bg-red-500" : tech.utilization_pct > 50 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${tech.utilization_pct}%` }} />
                        </div>
                        <p className="text-[9px] text-muted-foreground mt-0.5">{tech.capacity} slots</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Routing Rules */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wider">Routing Rules</h2>
            <Button size="sm" onClick={() => setShowAddRule(true)} data-testid="add-rule-btn"><Plus className="w-3 h-3 mr-1" />Add Rule</Button>
          </div>
          <div className="space-y-2">
            {routing_rules.map(rule => (
              <Card key={rule.id} className={`${rule.enabled ? "" : "opacity-50"}`} data-testid={`rule-${rule.id}`}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch checked={rule.enabled} onCheckedChange={() => toggleRule(rule)} />
                      <div>
                        <p className="text-sm font-medium">{rule.name}</p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <Badge variant="outline" className="text-[9px] h-4">{methodLabels[rule.route_to] || rule.route_to}</Badge>
                          <span>{rule.matches} matches</span>
                        </div>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteRule(rule.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Add Rule Dialog */}
      <Dialog open={showAddRule} onOpenChange={setShowAddRule}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Routing Rule</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Rule Name</Label><Input value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="e.g., Critical → Senior Tech" data-testid="rule-name" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Priority Filter</Label>
                <Select value={ruleForm.priority || "any"} onValueChange={v => setRuleForm({ ...ruleForm, priority: v === "any" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="any">Any Priority</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Category Filter</Label><Input value={ruleForm.category} onChange={e => setRuleForm({ ...ruleForm, category: e.target.value })} placeholder="e.g., networking" /></div>
            </div>
            <div><Label>Routing Method</Label>
              <Select value={ruleForm.route_to} onValueChange={v => setRuleForm({ ...ruleForm, route_to: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="skill_match">Skill Match</SelectItem><SelectItem value="highest_skill">Highest Skill</SelectItem><SelectItem value="least_loaded">Least Loaded</SelectItem><SelectItem value="round_robin">Round Robin</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={addRule} data-testid="save-rule-btn">Create Rule</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
