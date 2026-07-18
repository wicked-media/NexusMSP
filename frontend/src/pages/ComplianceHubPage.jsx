import { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Loader2, Shield, FileText, CheckCircle, AlertTriangle, ClipboardList } from "lucide-react";

const COMPLIANCE_TABS = ["dashboard", "clients", "reports"];

export default function ComplianceHubPage() {
  const { token } = useAuth();
  const location = useLocation();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState(COMPLIANCE_TABS.includes(requestedTab) ? requestedTab : "dashboard");
  const [frameworks, setFrameworks] = useState(null);
  const [clients, setClients] = useState([]);
  const [reports, setReports] = useState([]);
  const [genReports, setGenReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/compliance-frameworks/overview`, { headers }).catch(() => ({ data: null })),
      axios.get(`${API}/clients`, { headers }).catch(() => ({ data: [] })),
      axios.get(`${API}/compliance/reports`, { headers }).catch(() => ({ data: [] })),
      axios.get(`${API}/compliance-generator/reports`, { headers }).catch(() => ({ data: [] })),
    ]).then(([f, c, r, gr]) => { setFrameworks(f.data); setClients(c.data || []); setReports(r.data || []); setGenReports(gr.data || []); }).finally(() => setLoading(false));
  }, [headers]);

  useEffect(() => {
    if (COMPLIANCE_TABS.includes(requestedTab)) setTab(requestedTab);
  }, [requestedTab]);

  const selectTab = (nextTab) => {
    setTab(nextTab);
    const url = new URL(window.location.href);
    if (nextTab === "dashboard") url.searchParams.delete("tab");
    else url.searchParams.set("tab", nextTab);
    window.history.replaceState({}, "", url);
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const fw = frameworks || {};
  const fwList = fw.frameworks || [];
  const fwSummary = fw.summary || {};
  const allReports = [...(Array.isArray(reports) ? reports : []), ...(Array.isArray(genReports) ? genReports : [])];

  return (
    <div className="space-y-5" data-testid="compliance-hub">
      <div><h1 className="text-3xl font-bold tracking-tight">Compliance Hub</h1><p className="text-sm text-muted-foreground">Framework compliance, client audit status, and report generation</p></div>
      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3"><Shield className="w-5 h-5 text-blue-400 mb-1" /><p className="text-2xl font-bold">{fwList.length}</p><p className="text-[11px] text-muted-foreground">Active Frameworks</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><CheckCircle className="w-5 h-5 text-emerald-400 mb-1" /><p className="text-2xl font-bold text-emerald-400">{fwSummary.compliant_clients || 0}</p><p className="text-[11px] text-muted-foreground">Fully Compliant</p></CardContent></Card>
        <Card className="border-amber-500/20"><CardContent className="pt-4 pb-3"><AlertTriangle className="w-5 h-5 text-amber-400 mb-1" /><p className="text-2xl font-bold text-amber-400">{fwSummary.partially_compliant || 0}</p><p className="text-[11px] text-muted-foreground">Partially Compliant</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><FileText className="w-5 h-5 text-violet-400 mb-1" /><p className="text-2xl font-bold">{allReports.length}</p><p className="text-[11px] text-muted-foreground">Reports Generated</p></CardContent></Card>
      </div>
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="dashboard"><Shield className="w-3 h-3 mr-1" />Frameworks</TabsTrigger>
          <TabsTrigger value="clients"><ClipboardList className="w-3 h-3 mr-1" />Client Status</TabsTrigger>
          <TabsTrigger value="reports"><FileText className="w-3 h-3 mr-1" />Reports ({allReports.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard">
          <div className="grid grid-cols-2 gap-3">{fwList.map((f, i) => (
            <Card key={i}><CardContent className="py-3"><div className="flex items-center justify-between mb-2"><span className="font-semibold text-sm">{f.name}</span><Badge variant="outline" className="text-[10px]">{f.standard || f.type}</Badge></div><div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{f.controls_met || 0} / {f.total_controls || 0} controls</span><span>{f.compliance_pct || 0}%</span></div><Progress value={f.compliance_pct || 0} className="h-2" /><p className="text-[10px] text-muted-foreground mt-1">{f.description}</p></CardContent></Card>
          ))}</div>
          {fwList.length === 0 && <p className="text-center text-muted-foreground py-8">No compliance frameworks configured</p>}
        </TabsContent>
        <TabsContent value="clients">
          <Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Frameworks</TableHead><TableHead>Score</TableHead><TableHead>Status</TableHead><TableHead>Last Audit</TableHead></TableRow></TableHeader>
            <TableBody>{clients.slice(0, 20).map(c => (<TableRow key={c.id}><TableCell className="font-medium">{c.name}</TableCell><TableCell className="text-sm">{c.compliance_frameworks?.join(", ") || "None"}</TableCell><TableCell><span className={`font-mono text-sm ${(c.compliance_score || 0) >= 80 ? "text-emerald-400" : (c.compliance_score || 0) >= 50 ? "text-amber-400" : "text-red-400"}`}>{c.compliance_score || 0}%</span></TableCell><TableCell><Badge variant={(c.compliance_status || "unknown") === "compliant" ? "default" : "secondary"} className="text-[10px] capitalize">{c.compliance_status || "Unknown"}</Badge></TableCell><TableCell className="text-sm text-muted-foreground">{c.last_audit || "Never"}</TableCell></TableRow>))}</TableBody></Table>
        </TabsContent>
        <TabsContent value="reports">
          {allReports.length > 0 ? (
            <Table><TableHeader><TableRow><TableHead>Report</TableHead><TableHead>Framework</TableHead><TableHead>Client</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>{allReports.map((r, i) => (<TableRow key={i}><TableCell className="font-medium">{r.name || r.title || r.report_type}</TableCell><TableCell className="text-sm">{r.framework || "General"}</TableCell><TableCell className="text-sm">{r.client_name || "All"}</TableCell><TableCell className="text-sm">{(r.generated_at || r.created_at || "").slice(0, 10)}</TableCell><TableCell><Badge variant="outline" className="text-[10px] capitalize">{r.status || "complete"}</Badge></TableCell></TableRow>))}</TableBody></Table>
          ) : <p className="text-center text-muted-foreground py-8">No compliance reports generated</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
