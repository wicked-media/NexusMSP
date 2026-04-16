import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Timer, AlertTriangle, Clock, Loader2, RefreshCw, Zap, DollarSign,
  TrendingUp, TrendingDown, CheckCircle, Shield, Calculator, FileText,
  CreditCard, BarChart3, XCircle, ChevronRight, FileBarChart
} from "lucide-react";

function formatTime(seconds) {
  if (seconds <= 0) return "BREACHED";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function SlaBar({ pct, breached }) {
  const color = breached ? "bg-red-500" : pct > 80 ? "bg-amber-500" : pct > 60 ? "bg-blue-500" : "bg-emerald-500";
  return <div className="w-full h-1.5 bg-muted/30 rounded-full overflow-hidden"><div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} /></div>;
}

export default function SlaCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("timer");
  const [timerData, setTimerData] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [penaltyData, setPenaltyData] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [timerTab, setTimerTab] = useState("active");
  const [penaltyTab, setPenaltyTab] = useState("dashboard");
  const [calculating, setCalculating] = useState(null);
  const [selectedPenalty, setSelectedPenalty] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [t, pred, pen, con, rep] = await Promise.allSettled([
        axios.get(`${API}/sla-timer/active`, { headers }),
        axios.get(`${API}/sla-timer/predictions`, { headers }),
        axios.get(`${API}/sla-penalties/dashboard`, { headers }),
        axios.get(`${API}/contracts`, { headers }),
        axios.get(`${API}/sla-report-gen/reports`, { headers }),
      ]);
      if (t.status === "fulfilled") setTimerData(t.value.data);
      if (pred.status === "fulfilled") setPredictions(pred.value.data);
      if (pen.status === "fulfilled") setPenaltyData(pen.value.data);
      if (con.status === "fulfilled") setContracts(con.value.data.filter(ct => ct.status === "active"));
      if (rep.status === "fulfilled") setReports(rep.value.data);
    } catch { toast.error("Failed to load SLA data"); }
    finally { setLoading(false); }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  const calculatePenalty = async (contractId) => {
    setCalculating(contractId);
    try {
      const res = await axios.post(`${API}/sla-penalties/calculate/${contractId}`, {}, { headers });
      toast.success(`Penalty calculated: $${res.data.total_penalty}`);
      fetchData();
    } catch { toast.error("Calculation failed"); }
    finally { setCalculating(null); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const ts = timerData?.summary || {};
  const ps = penaltyData?.summary || {};

  return (
    <div className="space-y-5" data-testid="sla-center-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-amber-500 flex items-center justify-center"><Timer className="w-5 h-5 text-white" /></div>
          SLA Center
        </h1>
        <p className="text-muted-foreground mt-1">Live SLA timers, penalty tracking, and client SLA reports</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="timer" data-testid="tab-timer">Live Timers</TabsTrigger>
          <TabsTrigger value="penalties" data-testid="tab-penalties">Penalties</TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-reports">Client Reports</TabsTrigger>
        </TabsList>

        {/* LIVE TIMERS */}
        <TabsContent value="timer" className="mt-4 space-y-4">
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Active Tickets", value: ts.active || 0, icon: Clock, color: "text-blue-400" },
              { label: "At Risk", value: ts.at_risk || 0, icon: AlertTriangle, color: "text-amber-400" },
              { label: "Breached", value: ts.breached || 0, icon: XCircle, color: "text-red-400" },
              { label: "Avg Response", value: ts.avg_response || "N/A", icon: Zap, color: "text-purple-400" },
              { label: "Met Rate", value: ts.met_rate ? `${ts.met_rate}%` : "N/A", icon: Shield, color: "text-emerald-400" },
            ].map(st => (
              <Card key={st.label}><CardContent className="pt-4 pb-3"><div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div><p className={`text-2xl font-bold ${st.color}`}>{st.value}</p></CardContent></Card>
            ))}
          </div>

          <div className="flex gap-1 mb-2">
            {["active", "predictions"].map(t => (
              <button key={t} onClick={() => setTimerTab(t)} className={`px-3 py-1.5 rounded-lg text-sm capitalize ${timerTab === t ? "text-white bg-primary" : "text-muted-foreground bg-muted/30"}`}>{t}</button>
            ))}
          </div>

          {timerTab === "active" && (
            <div className="space-y-2">
              {(timerData?.tickets || []).map(t => (
                <Card key={t.id} className={t.breached ? "border-red-500/30 bg-red-500/5" : t.pct_elapsed > 80 ? "border-amber-500/30 bg-amber-500/5" : ""}>
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center gap-4">
                      <div className={`text-center w-16 ${t.breached ? "text-red-400" : t.pct_elapsed > 80 ? "text-amber-400" : "text-blue-400"}`}>
                        <div className="text-lg font-black">{formatTime(t.remaining_seconds)}</div>
                        <div className="text-[10px]">remaining</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{t.title || t.subject}</p>
                        <p className="text-xs text-muted-foreground">{t.client_name} — {t.priority} priority</p>
                        <SlaBar pct={t.pct_elapsed} breached={t.breached} />
                      </div>
                      <Badge variant={t.breached ? "destructive" : "outline"} className="text-[10px]">{t.sla_type}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {(timerData?.tickets || []).length === 0 && <Card className="border-dashed"><CardContent className="py-12 text-center"><CheckCircle className="w-8 h-8 mx-auto text-emerald-400 mb-2" /><p className="text-muted-foreground">No active SLA timers</p></CardContent></Card>}
            </div>
          )}
          {timerTab === "predictions" && (
            <div className="space-y-2">
              {predictions.map((p, i) => (
                <Card key={`k-${i}`} className={p.risk === "high" ? "border-red-500/30 bg-red-500/5" : ""}>
                  <CardContent className="pt-3 pb-3 flex items-center gap-4">
                    <AlertTriangle className={`w-5 h-5 ${p.risk === "high" ? "text-red-400" : "text-amber-400"}`} />
                    <div className="flex-1"><p className="text-sm font-medium">{p.title}</p><p className="text-xs text-muted-foreground">{p.client_name}</p></div>
                    <Badge variant="outline" className="text-[10px]">{p.predicted_breach_in}</Badge>
                  </CardContent>
                </Card>
              ))}
              {predictions.length === 0 && <p className="text-muted-foreground text-center py-8">No breach predictions</p>}
            </div>
          )}
        </TabsContent>

        {/* PENALTIES */}
        <TabsContent value="penalties" className="mt-4 space-y-4">
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Total Penalties", value: `$${ps.total_penalties?.toLocaleString() || 0}`, icon: DollarSign, color: "text-red-400" },
              { label: "Active Contracts", value: ps.active_contracts || 0, icon: FileText, color: "text-blue-400" },
              { label: "SLA Breaches", value: ps.total_breaches || 0, icon: AlertTriangle, color: "text-amber-400" },
              { label: "Credits Issued", value: `$${ps.credits_issued?.toLocaleString() || 0}`, icon: CreditCard, color: "text-purple-400" },
              { label: "Avg SLA Met", value: `${ps.avg_sla_met || 0}%`, icon: Shield, color: "text-emerald-400" },
            ].map(st => (
              <Card key={st.label}><CardContent className="pt-4 pb-3"><div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div><p className={`text-2xl font-bold ${st.color}`}>{st.value}</p></CardContent></Card>
            ))}
          </div>

          {(penaltyData?.recent_penalties || []).length > 0 && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Recent Penalties</CardTitle></CardHeader>
              <CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Contract</TableHead><TableHead>Breaches</TableHead><TableHead className="text-right">Penalty</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>{penaltyData.recent_penalties.map((p, i) => (
                  <TableRow key={`k-${i}`} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedPenalty(p)}>
                    <TableCell className="font-medium">{p.client_name}</TableCell><TableCell className="text-sm">{p.contract_name}</TableCell>
                    <TableCell><Badge variant="destructive" className="text-[10px]">{p.breach_count}</Badge></TableCell>
                    <TableCell className="text-right font-mono font-bold text-red-400">${p.total_penalty?.toLocaleString()}</TableCell>
                    <TableCell><Badge variant={p.status === "applied" ? "default" : "outline"} className="text-[10px]">{p.status}</Badge></TableCell>
                  </TableRow>
                ))}</TableBody></Table></CardContent></Card>
          )}

          {contracts.length > 0 && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calculator className="w-4 h-4" />Calculate Penalties</CardTitle></CardHeader>
              <CardContent className="space-y-2">{contracts.map(c => (
                <div key={c.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/20 border border-border/30">
                  <div><p className="text-sm font-medium">{c.client_name || c.name}</p><p className="text-xs text-muted-foreground">${c.value?.toLocaleString()}/mo</p></div>
                  <Button size="sm" variant="outline" onClick={() => calculatePenalty(c.id)} disabled={calculating === c.id}>{calculating === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Calculator className="w-3 h-3 mr-1" />}Calculate</Button>
                </div>
              ))}</CardContent></Card>
          )}
        </TabsContent>

        {/* REPORTS */}
        <TabsContent value="reports" className="mt-4 space-y-4">
          <div className="space-y-4">{reports.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><FileBarChart className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" /><p className="text-muted-foreground">No SLA reports generated yet</p></CardContent></Card>
          ) : reports.map(r => (
            <Card key={r.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between"><div><h3 className="font-semibold">{r.client_name} — {r.period}</h3><p className="text-xs text-muted-foreground">Generated {new Date(r.generated_at).toLocaleDateString()} by {r.generated_by}</p></div><Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge></div>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-4">
                  <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-xl font-bold text-emerald-500">{r.metrics.uptime_pct}%</p><p className="text-[10px] text-muted-foreground">Uptime</p></div>
                  <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-xl font-bold">{r.metrics.avg_response_time_min}m</p><p className="text-[10px] text-muted-foreground">Avg Response</p></div>
                  <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-xl font-bold">{r.metrics.avg_resolution_time_hours}h</p><p className="text-[10px] text-muted-foreground">Avg Resolution</p></div>
                  <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-xl font-bold">{r.metrics.tickets_resolved}</p><p className="text-[10px] text-muted-foreground">Tickets Resolved</p></div>
                  <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-xl font-bold text-blue-500">{r.metrics.sla_met_pct}%</p><p className="text-[10px] text-muted-foreground">SLA Met</p></div>
                  <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-xl font-bold text-amber-500">{r.metrics.csat_avg}</p><p className="text-[10px] text-muted-foreground">CSAT</p></div>
                </div>
              </CardContent>
            </Card>
          ))}</div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
