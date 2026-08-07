import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import {
  Brain, Users, Zap, RefreshCw, Loader2, Plus, Trash2, AlertCircle, CheckCircle, Gauge
} from "lucide-react";

const methodLabels = { highest_skill: "Highest Skill", skill_match: "Skill Match", least_loaded: "Least Loaded", round_robin: "Round Robin" };

export default function IntelligentRoutingPage({ embedded = false }) {
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

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bulkRoute = async () => {
    setRouting(true);
    try {
      const res = await axios.post(`${API}/intelligent-routing/bulk-route`, {}, { headers });
      toast.success(`Routed ${res.data.routed} ticket${res.data.routed === 1 ? "" : "s"}; ${res.data.manual_review || 0} require manual review.`);
      fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || "Bulk routing failed"); }
    finally { setRouting(false); }
  };

  const addRule = async () => {
    try {
      await axios.post(`${API}/intelligent-routing/rules`, ruleForm, { headers });
      toast.success("Rule created");
      setShowAddRule(false);
      setRuleForm({ name: "", priority: "", category: "", route_to: "skill_match", enabled: true });
      fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not create routing rule"); }
  };

  const deleteRule = async (id) => {
    try {
      await axios.delete(`${API}/intelligent-routing/rules/${id}`, { headers });
      toast.success("Rule deleted");
      fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not delete routing rule"); }
  };

  const toggleRule = async (rule) => {
    try {
      await axios.put(`${API}/intelligent-routing/rules/${rule.id}`, { enabled: !rule.enabled }, { headers });
      fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not update routing rule"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  if (!data) return null;

  const { technicians, routing_rules, stats } = data;

  return (
    <div className="space-y-5" data-testid="intelligent-routing-page">
      {!embedded && <OperationalPageHeader eyebrow="Ticket workspace - technician routing" title="Intelligent Routing" description="Rules-based assignment using confirmed technician skills, availability, and live workload. Tickets without a matching rule or eligible technician remain in manual review." icon={Brain} tone="sky" actions={<Button onClick={bulkRoute} disabled={routing} size="sm" data-testid="bulk-route-btn">{routing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Brain className="mr-1 h-4 w-4" />}Route {stats.unassigned} unassigned</Button>} />}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/60 px-3 py-2">
        <p className="text-xs text-muted-foreground">Only available, opted-in technicians with a confirmed matching rule are automatically assigned. All other tickets remain for review.</p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={fetchData}><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh</Button>
          <Button size="sm" variant="outline" onClick={() => setShowAddRule(true)} data-testid="add-rule-btn"><Plus className="mr-1 h-3.5 w-3.5" />New rule</Button>
          <Button size="sm" onClick={bulkRoute} disabled={routing} data-testid="bulk-route-btn">{routing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Brain className="mr-1 h-3.5 w-3.5" />}Route {stats.unassigned} unassigned</Button>
        </div>
      </div>

      {/* Routing signal tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <HeroTile label="Open" value={stats.total_open} icon={AlertCircle} glow="cyan" subtitle="Active service work" testId="routing-open" />
        <HeroTile label="Unassigned" value={stats.unassigned} icon={Users} glow={stats.unassigned > 0 ? "amber" : "emerald"} subtitle={stats.unassigned > 0 ? "Needs a route" : "Queue covered"} testId="routing-unassigned" />
        <HeroTile label="Auto-routed" value={stats.auto_routed_today} icon={Zap} glow="violet" subtitle="Today" testId="routing-auto-routed" />
        <HeroTile label="Assignment" value={stats.avg_assignment_time_sec ?? "—"} suffix={stats.avg_assignment_time_sec == null ? "" : "s"} icon={Gauge} glow="sky" subtitle="Historical timing not configured" testId="routing-assignment-time" />
        <HeroTile label="Validated accuracy" value={stats.routing_accuracy_pct ?? "—"} suffix={stats.routing_accuracy_pct == null ? "" : "%"} icon={CheckCircle} glow="emerald" subtitle="Outcome tracking not configured" testId="routing-accuracy" />
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
                        <span>SLA: {tech.sla_compliance == null ? "not measured" : `${tech.sla_compliance}%`}</span>
                        <span className="text-muted-foreground/30">|</span>
                        <span>CSAT: {tech.csat_score == null ? "not measured" : tech.csat_score}</span>
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
                        {!Object.keys(tech.skills || {}).length && <span className="text-[10px] text-amber-300">Skills not configured</span>}
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
            <Button size="sm" onClick={() => setShowAddRule(true)}><Plus className="w-3 h-3 mr-1" />Add Rule</Button>
          </div>
          <div className="space-y-2">
            {!routing_rules.length && <Card className="border-dashed"><CardContent className="p-4 text-sm text-muted-foreground">No confirmed routing rules yet. Add a rule before using automatic routing.</CardContent></Card>}
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
