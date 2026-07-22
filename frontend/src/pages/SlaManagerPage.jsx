import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TicketModuleHeader } from "@/components/tickets/TicketWorkspaceShell";
import HeroTile from "@/components/HeroTile";
import { Loader2, AlertTriangle, FileText, DollarSign, Timer, ShieldCheck } from "lucide-react";

const SLA_TABS = ["timers", "predictions", "penalties", "reports"];

export default function SlaManagerPage() {
  const { token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState(SLA_TABS.includes(requestedTab) ? requestedTab : "timers");
  const [timers, setTimers] = useState(null);
  const [predictions, setPredictions] = useState(null);
  const [penalties, setPenalties] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (SLA_TABS.includes(requestedTab)) setTab(requestedTab);
  }, [requestedTab]);

  const selectTab = (nextTab) => {
    setTab(nextTab);
    const url = new URL(window.location.href);
    if (nextTab === "timers") url.searchParams.delete("tab");
    else url.searchParams.set("tab", nextTab);
    window.history.replaceState({}, "", url);
  };

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/sla-timer/active`, { headers }).catch(() => ({ data: [] })),
      axios.get(`${API}/sla-timer/predictions`, { headers }).catch(() => ({ data: [] })),
      axios.get(`${API}/sla-penalties/dashboard`, { headers }).catch(() => ({ data: null })),
      axios.get(`${API}/sla-report-gen/reports`, { headers }).catch(() => ({ data: [] })),
    ]).then(([t, p, pen, r]) => {
      setTimers(Array.isArray(t.data) ? t.data : t.data?.active || []);
      setPredictions(Array.isArray(p.data) ? p.data : p.data?.predictions || []);
      setPenalties(pen.data || null);
      setReports(Array.isArray(r.data) ? r.data : r.data?.reports || []);
    }).finally(() => setLoading(false));
  }, [headers]);

  if (loading) return <div className="space-y-5"><TicketModuleHeader title="SLA manager" subtitle="Loading timers, predictions, penalties, and reports…" /><div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div></div>;

  const timerList = Array.isArray(timers) ? timers : timers?.active || [];
  const predList = Array.isArray(predictions) ? predictions : predictions?.predictions || [];
  const penSummary = penalties?.summary || {};
  const penContracts = penalties?.contracts || [];
  const openTicket = (reference) => reference && navigate(`/tickets?ticket=${encodeURIComponent(reference)}`);

  return (
    <div className="space-y-6" data-testid="sla-manager">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center"><ShieldCheck className="w-4 h-4 text-cyan-300" /></span>
          <div><h1 className="text-2xl font-bold tracking-tight">SLA Manager</h1><p className="text-sm text-muted-foreground">Live commitments, breach risk, commercial exposure, and reporting.</p></div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <HeroTile label="Live timers" value={timerList.length} icon={Timer} glow="cyan" active={tab === "timers"} onClick={() => selectTab("timers")} testId="sla-metric-active" />
        <HeroTile label="High breach risk" value={predList.filter(p => p.breach_risk === "high" || p.risk === "high").length} icon={AlertTriangle} glow="rose" active={tab === "predictions"} onClick={() => selectTab("predictions")} testId="sla-metric-risk" />
        <HeroTile label="Penalties YTD" value={`$${(penSummary.total_penalties || 0).toLocaleString()}`} icon={DollarSign} glow="amber" animated={false} active={tab === "penalties"} onClick={() => selectTab("penalties")} testId="sla-metric-penalties" />
        <HeroTile label="SLA reports" value={reports.length} icon={FileText} glow="violet" active={tab === "reports"} onClick={() => selectTab("reports")} testId="sla-metric-reports" />
      </div>
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="timers"><Timer className="w-3 h-3 mr-1" />Live Timers ({timerList.length})</TabsTrigger>
          <TabsTrigger value="predictions"><AlertTriangle className="w-3 h-3 mr-1" />Breach Predictions ({predList.length})</TabsTrigger>
          <TabsTrigger value="penalties"><DollarSign className="w-3 h-3 mr-1" />Penalties</TabsTrigger>
          <TabsTrigger value="reports"><FileText className="w-3 h-3 mr-1" />Reports ({reports.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="timers" className="space-y-3">
          {timerList.length > 0 && <Card className="overflow-hidden"><CardContent className="p-3 space-y-2">{timerList.map((t, i) => {
            const remaining = t.remaining_minutes;
            const urgent = t.status === "breached" || t.is_breached || (remaining != null && remaining < 30);
            const displayTime = remaining != null ? `${Math.floor(remaining / 60)}h ${Math.max(0, remaining % 60)}m` : t.time_remaining || "N/A";
            return <button key={t.ticket_id || t.id || i} className={`w-full text-left rounded-xl border p-3 transition-colors ${urgent ? "border-red-500/30 bg-red-500/[0.045] hover:bg-red-500/[0.075]" : "border-border/70 hover:border-blue-500/30 hover:bg-blue-500/[0.025]"}`} onClick={() => openTicket(t.ticket_id || t.id)}><div className="flex items-center gap-3"><div className={`w-11 rounded-lg py-1.5 text-center shrink-0 ${urgent ? "bg-red-500/15 text-red-300" : "bg-blue-500/10 text-blue-300"}`}><p className="text-[9px] uppercase tracking-wide">Remaining</p><p className="font-mono text-xs font-semibold mt-0.5">{displayTime}</p></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-xs text-muted-foreground">{t.ticket_number || t.ticket_id || t.id}</span><Badge variant="outline" className="text-[9px] capitalize">{t.sla_tier || t.tier || "Standard"}</Badge></div><p className="text-sm font-semibold truncate mt-1">{t.title || t.client_name || "SLA commitment"}</p><p className="text-xs text-muted-foreground mt-0.5">{t.client_name || "Client pending"}</p></div><Badge variant={(t.status === "breached" || t.is_breached) ? "destructive" : "outline"} className={`text-[10px] capitalize shrink-0 ${urgent && !(t.status === "breached" || t.is_breached) ? "border-red-500/30 text-red-300" : ""}`}>{t.status || (t.is_breached ? "breached" : "active")}</Badge></div></button>;
          })}</CardContent></Card>}
          {timerList.length === 0 && <p className="text-center text-muted-foreground py-8">No active SLA timers</p>}
        </TabsContent>
        <TabsContent value="predictions" className="space-y-2">
          {predList.map((p, i) => { const risk = p.breach_risk || p.risk || "medium"; const high = risk === "high"; return <Card key={i} className={high ? "border-red-500/30 bg-red-500/[0.035]" : "border-amber-500/20"}><CardContent className="py-3"><div className="flex items-start gap-3"><div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${high ? "bg-red-500/15" : "bg-amber-500/15"}`}><AlertTriangle className={`w-4 h-4 ${high ? "text-red-300" : "text-amber-300"}`} /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><div><span className="font-mono text-xs text-muted-foreground">{p.ticket_id || p.id}</span><p className="font-semibold text-sm mt-0.5">{p.client_name || "Client pending"}</p></div><Badge variant={high ? "destructive" : "outline"} className={`text-[10px] capitalize ${!high ? "border-amber-500/25 text-amber-300" : ""}`}>{risk} risk</Badge></div><p className="text-xs text-muted-foreground mt-2">{p.reason || `${p.probability_pct || 0}% breach probability`}</p></div></div></CardContent></Card>; })}
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
