import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Clock, AlertTriangle, Shield, FileText, TrendingDown, DollarSign, Timer } from "lucide-react";

export default function SlaManagerPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("timers");
  const [timers, setTimers] = useState(null);
  const [predictions, setPredictions] = useState(null);
  const [penalties, setPenalties] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/sla-timer/active`, { headers }).catch(() => ({ data: [] })),
      axios.get(`${API}/sla-timer/predictions`, { headers }).catch(() => ({ data: [] })),
      axios.get(`${API}/sla-penalties/dashboard`, { headers }).catch(() => ({ data: null })),
      axios.get(`${API}/sla-report-gen/reports`, { headers }).catch(() => ({ data: [] })),
    ]).then(([t, p, pen, r]) => { setTimers(t.data); setPredictions(p.data); setPenalties(pen.data); setReports(r.data || []); }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const timerList = Array.isArray(timers) ? timers : timers?.active || [];
  const predList = Array.isArray(predictions) ? predictions : predictions?.predictions || [];
  const penSummary = penalties?.summary || {};
  const penContracts = penalties?.contracts || [];

  return (
    <div className="space-y-5" data-testid="sla-manager">
      <div><h1 className="text-3xl font-bold tracking-tight">SLA Manager</h1><p className="text-sm text-muted-foreground">Live SLA timers, breach predictions, penalty tracking, and reporting</p></div>
      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3"><Timer className="w-5 h-5 text-blue-400 mb-1" /><p className="text-2xl font-bold">{timerList.length}</p><p className="text-[11px] text-muted-foreground">Active SLA Timers</p></CardContent></Card>
        <Card className="border-red-500/20"><CardContent className="pt-4 pb-3"><AlertTriangle className="w-5 h-5 text-red-400 mb-1" /><p className="text-2xl font-bold text-red-400">{predList.filter(p => p.breach_risk === "high" || p.risk === "high").length}</p><p className="text-[11px] text-muted-foreground">High Breach Risk</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><DollarSign className="w-5 h-5 text-amber-400 mb-1" /><p className="text-2xl font-bold">${(penSummary.total_penalties || 0).toLocaleString()}</p><p className="text-[11px] text-muted-foreground">Penalties YTD</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><FileText className="w-5 h-5 text-violet-400 mb-1" /><p className="text-2xl font-bold">{reports.length}</p><p className="text-[11px] text-muted-foreground">SLA Reports</p></CardContent></Card>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="timers"><Timer className="w-3 h-3 mr-1" />Live Timers ({timerList.length})</TabsTrigger>
          <TabsTrigger value="predictions"><AlertTriangle className="w-3 h-3 mr-1" />Breach Predictions ({predList.length})</TabsTrigger>
          <TabsTrigger value="penalties"><DollarSign className="w-3 h-3 mr-1" />Penalties</TabsTrigger>
          <TabsTrigger value="reports"><FileText className="w-3 h-3 mr-1" />Reports ({reports.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="timers">
          <Table><TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Client</TableHead><TableHead>SLA Tier</TableHead><TableHead>Time Remaining</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>{timerList.map((t, i) => (<TableRow key={i}><TableCell className="font-mono text-sm">{t.ticket_id || t.id}</TableCell><TableCell className="font-medium">{t.client_name}</TableCell><TableCell><Badge variant="outline" className="text-[10px] capitalize">{t.sla_tier || t.tier}</Badge></TableCell><TableCell className={`font-mono ${(t.remaining_minutes || 0) < 30 ? "text-red-400" : "text-emerald-400"}`}>{t.remaining_minutes != null ? `${Math.floor(t.remaining_minutes / 60)}h ${t.remaining_minutes % 60}m` : t.time_remaining || "N/A"}</TableCell><TableCell><Badge variant={(t.status === "breached" || t.is_breached) ? "destructive" : "default"} className="text-[10px] capitalize">{t.status || (t.is_breached ? "breached" : "active")}</Badge></TableCell></TableRow>))}</TableBody></Table>
          {timerList.length === 0 && <p className="text-center text-muted-foreground py-8">No active SLA timers</p>}
        </TabsContent>
        <TabsContent value="predictions">
          {predList.map((p, i) => (<Card key={i} className={`mb-2 ${(p.breach_risk || p.risk) === "high" ? "border-red-500/30" : ""}`}><CardContent className="py-3"><div className="flex items-center justify-between"><div><span className="font-medium">{p.ticket_id || p.id}</span><span className="text-sm text-muted-foreground ml-2">{p.client_name}</span></div><Badge variant={(p.breach_risk || p.risk) === "high" ? "destructive" : "secondary"} className="text-[10px] capitalize">{p.breach_risk || p.risk} risk</Badge></div><p className="text-xs text-muted-foreground mt-1">{p.reason || `${p.probability_pct || 0}% breach probability`}</p></CardContent></Card>))}
          {predList.length === 0 && <p className="text-center text-muted-foreground py-8">No breach predictions</p>}
        </TabsContent>
        <TabsContent value="penalties">
          {penContracts.length > 0 ? (
            <Table><TableHeader><TableRow><TableHead>Contract</TableHead><TableHead>Client</TableHead><TableHead>Breaches</TableHead><TableHead className="text-right">Penalty</TableHead><TableHead>Period</TableHead></TableRow></TableHeader>
              <TableBody>{penContracts.map((c, i) => (<TableRow key={i}><TableCell className="font-medium">{c.contract_name || c.name}</TableCell><TableCell>{c.client_name}</TableCell><TableCell><Badge variant="destructive" className="text-[10px]">{c.breach_count || c.breaches}</Badge></TableCell><TableCell className="text-right font-mono text-amber-400">${(c.penalty_amount || c.penalty || 0).toLocaleString()}</TableCell><TableCell className="text-sm">{c.period || "Current"}</TableCell></TableRow>))}</TableBody></Table>
          ) : <p className="text-center text-muted-foreground py-8">No SLA penalties recorded</p>}
        </TabsContent>
        <TabsContent value="reports">
          {reports.length > 0 ? (
            <Table><TableHeader><TableRow><TableHead>Report</TableHead><TableHead>Period</TableHead><TableHead>Generated</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>{reports.map((r, i) => (<TableRow key={i}><TableCell className="font-medium">{r.name || r.title}</TableCell><TableCell className="text-sm">{r.period}</TableCell><TableCell className="text-sm">{(r.generated_at || r.created_at || "").slice(0, 10)}</TableCell><TableCell><Badge variant="outline" className="text-[10px] capitalize">{r.status || "complete"}</Badge></TableCell></TableRow>))}</TableBody></Table>
          ) : <p className="text-center text-muted-foreground py-8">No SLA reports generated yet</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
