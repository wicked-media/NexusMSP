import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  FileText, Download, Plus, TrendingUp, Shield, CheckCircle, Target,
  BarChart3, Loader2, RefreshCw, ChevronDown, ChevronUp, Star,
  AlertTriangle, HardDrive, Clock, Users, Trash2, Zap, ArrowUp, ArrowDown, Search
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const chartStyle = { backgroundColor: "hsl(217, 33%, 17%)", border: "1px solid hsl(217, 33%, 25%)", borderRadius: "8px", color: "hsl(210, 40%, 98%)" };
const months = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function ExecutiveReportsPage() {
  const { token } = useAuth();
  const [reports, setReports] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [genClient, setGenClient] = useState("");
  const [genPeriod, setGenPeriod] = useState("February 2026");
  const [genType, setGenType] = useState("monthly");
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, cRes] = await Promise.all([
        axios.get(`${API}/executive-reports/list`, { headers }),
        axios.get(`${API}/clients`, { headers }).catch(() => ({ data: [] })),
      ]);
      setReports(rRes.data);
      setClients(Array.isArray(cRes.data) ? cRes.data : []);
    } catch { toast.error("Failed to load reports"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleGenerate = async () => {
    if (!genClient) { toast.error("Select a client"); return; }
    try {
      await axios.post(`${API}/executive-reports/generate`, { client_name: genClient, period: genPeriod, report_type: genType }, { headers });
      toast.success("Report generated");
      setShowGenerate(false); fetchData();
    } catch { toast.error("Failed"); }
  };

  const handleDelete = async (id) => {
    try { await axios.delete(`${API}/executive-reports/${id}`, { headers }); toast.success("Deleted"); fetchData(); }
    catch { toast.error("Failed"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const completed = reports.filter(r => r.status === "completed");
  const avgSecurity = completed.length ? Math.round(completed.reduce((s, r) => s + (r.sections?.security_score || 0), 0) / completed.length) : 0;
  const avgUptime = completed.length ? (completed.reduce((s, r) => s + (r.sections?.uptime_pct || 0), 0) / completed.length).toFixed(2) : 0;
  const avgSLA = completed.length ? (completed.reduce((s, r) => s + (r.sections?.sla_compliance_pct || 0), 0) / completed.length).toFixed(1) : 0;
  const uniqueClients = [...new Set(reports.map(r => r.client_name))];

  const filtered = reports.filter(r => {
    if (clientFilter !== "all" && r.client_name !== clientFilter) return false;
    if (search && !r.client_name.toLowerCase().includes(search.toLowerCase()) && !r.period.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-5" data-testid="executive-reports-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-indigo-500 flex items-center justify-center"><FileText className="w-5 h-5 text-white" /></div>
            Executive Reports
          </h1>
          <p className="text-muted-foreground mt-1">Automated client reports with security, uptime, SLA metrics & trend analysis</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={() => setShowGenerate(true)} data-testid="generate-report-btn" className="bg-indigo-600"><Plus className="w-4 h-4 mr-1" />Generate Report</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Total Reports", value: reports.length, icon: FileText, color: "text-foreground" },
          { label: "Avg Security", value: `${avgSecurity}/100`, icon: Shield, color: avgSecurity >= 80 ? "text-emerald-400" : "text-amber-400" },
          { label: "Avg Uptime", value: `${avgUptime}%`, icon: TrendingUp, color: "text-cyan-400" },
          { label: "Avg SLA Met", value: `${avgSLA}%`, icon: Target, color: "text-amber-400" },
          { label: "Clients Covered", value: uniqueClients.length, icon: Users, color: "text-purple-400" },
        ].map(st => (
          <Card key={st.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`text-2xl font-bold ${st.color}`}>{st.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
        <Select value={clientFilter} onValueChange={setClientFilter}><SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Clients</SelectItem>{uniqueClients.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
      </div>

      {/* Report Cards */}
      {filtered.length === 0 ? (
        <Card className="border-dashed"><CardContent className="py-16 text-center">
          <FileText className="w-14 h-14 mx-auto text-muted-foreground/20 mb-4" />
          <p className="text-lg font-semibold mb-1">No Reports</p>
          <Button onClick={() => setShowGenerate(true)} className="mt-4"><Plus className="w-4 h-4 mr-2" />Generate Report</Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => {
            const isExpanded = expandedId === r.id;
            const sec = r.sections || {};
            const trend = r.trend_data || {};
            const secTrend = trend.security || [];
            const uptimeTrend = trend.uptime || [];
            const trendData = months.map((m, i) => ({ month: m, security: secTrend[i] || 0, uptime: uptimeTrend[i] || 0, sla: (trend.sla || [])[i] || 0 }));

            return (
              <Card key={r.id} className="border-border/40 transition-all" data-testid={`exec-report-${r.id}`}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-4 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : r.id)}>
                    <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center border border-indigo-500/20"><FileText className="w-5 h-5 text-indigo-400" /></div>
                    <div className="flex-1">
                      <h3 className="font-bold">{r.client_name}</h3>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">{r.period}</Badge>
                        <span>Generated {new Date(r.generated_at).toLocaleDateString()}</span>
                        <span>by {r.generated_by}</span>
                      </div>
                    </div>
                    {/* Inline Metrics */}
                    <div className="flex items-center gap-4">
                      <div className="text-center"><p className={`text-lg font-bold ${sec.security_score >= 80 ? "text-emerald-400" : "text-amber-400"}`}>{sec.security_score}</p><p className="text-[9px] text-muted-foreground">Security</p></div>
                      <div className="text-center"><p className="text-lg font-bold text-cyan-400">{sec.uptime_pct}%</p><p className="text-[9px] text-muted-foreground">Uptime</p></div>
                      <div className="text-center"><p className="text-lg font-bold text-amber-400">{sec.sla_compliance_pct}%</p><p className="text-[9px] text-muted-foreground">SLA</p></div>
                      <div className="text-center"><p className="text-lg font-bold">{sec.tickets_resolved}</p><p className="text-[9px] text-muted-foreground">Resolved</p></div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400" onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}><Trash2 className="w-3 h-3" /></Button>
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 space-y-4 border-t border-border/30 pt-4">
                      {/* Detailed KPI Grid */}
                      <div className="grid grid-cols-6 gap-3">
                        {[
                          { label: "Security Score", value: sec.security_score, suffix: "/100", color: "text-emerald-400", change: sec.security_change },
                          { label: "Uptime", value: sec.uptime_pct, suffix: "%", color: "text-cyan-400", sub: `${sec.downtime_minutes}m down` },
                          { label: "Tickets Resolved", value: sec.tickets_resolved, color: "text-blue-400", sub: `${sec.avg_resolution_hours}h avg` },
                          { label: "SLA Compliance", value: sec.sla_compliance_pct, suffix: "%", color: "text-amber-400" },
                          { label: "Backup Success", value: sec.backup_success_rate, suffix: "%", color: "text-purple-400", sub: `${sec.backup_jobs} jobs` },
                          { label: "Devices Healthy", value: sec.devices_healthy, color: "text-foreground", sub: `of ${sec.devices_total}` },
                        ].map(kpi => (
                          <Card key={kpi.label} className="border-border/20 bg-muted/10">
                            <CardContent className="p-3 text-center">
                              <p className={`text-xl font-bold ${kpi.color}`}>{kpi.value}{kpi.suffix}</p>
                              <p className="text-[9px] text-muted-foreground mt-0.5">{kpi.label}</p>
                              {kpi.change && <Badge className="text-[8px] bg-emerald-500/20 text-emerald-400 mt-1">{kpi.change}</Badge>}
                              {kpi.sub && <p className="text-[9px] text-muted-foreground mt-0.5">{kpi.sub}</p>}
                            </CardContent>
                          </Card>
                        ))}
                      </div>

                      {/* Trend Chart */}
                      <Card className="border-border/20">
                        <CardHeader className="pb-1"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">6-Month Trend</CardTitle></CardHeader>
                        <CardContent>
                          <div className="h-[180px]"><ResponsiveContainer width="100%" height="100%">
                            <LineChart data={trendData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                              <Tooltip contentStyle={chartStyle} />
                              <Line type="monotone" dataKey="security" stroke="#22C55E" name="Security" strokeWidth={2} dot={false} />
                              <Line type="monotone" dataKey="sla" stroke="#EAB308" name="SLA %" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer></div>
                        </CardContent>
                      </Card>

                      <div className="grid grid-cols-2 gap-4">
                        {/* Top Issues */}
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Top Issues</p>
                          <div className="space-y-1.5">
                            {(sec.top_issues || []).map((issue, i) => (
                              <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border/20">
                                <span className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-[10px] font-bold text-amber-400">{i + 1}</span>
                                <span className="text-sm">{issue}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* Recommendations */}
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1"><Star className="w-3 h-3 text-amber-400" />Recommendations</p>
                          <div className="space-y-1.5">
                            {(sec.recommendations || []).map((rec, i) => (
                              <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-indigo-500/5 border border-indigo-500/10">
                                <Zap className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
                                <span className="text-sm">{rec}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Cost */}
                      <div className="p-3 rounded-lg bg-muted/20 border border-border/20 flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Monthly Service Cost</span>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold">${sec.monthly_cost?.toLocaleString()}</span>
                          <Badge className={sec.cost_trend?.startsWith("+") ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400"}>{sec.cost_trend}</Badge>
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

      {/* Generate Dialog */}
      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent aria-describedby="gen-exec-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-indigo-400" />Generate Executive Report</DialogTitle>
            <DialogDescription id="gen-exec-desc">Auto-generate a comprehensive client report with all KPIs</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Client *</Label>
              <Select value={genClient} onValueChange={setGenClient}>
                <SelectTrigger><SelectValue placeholder="Select client..." /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id || c.name} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Period</Label>
                <Select value={genPeriod} onValueChange={setGenPeriod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["February 2026", "January 2026", "December 2025", "Q4 2025", "Q3 2025"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Type</Label>
                <Select value={genType} onValueChange={setGenType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="annual">Annual</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerate(false)}>Cancel</Button>
            <Button onClick={handleGenerate} data-testid="confirm-generate-exec"><Zap className="w-4 h-4 mr-1" />Generate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
