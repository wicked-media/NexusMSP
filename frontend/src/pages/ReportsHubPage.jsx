import { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, BarChart3, FileText, Users, DollarSign, TrendingUp, Briefcase, Download } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const REPORT_TABS = ["operational", "executive", "client", "financial", "roi"];

export default function ReportsHubPage() {
  const { token } = useAuth();
  const location = useLocation();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState(REPORT_TABS.includes(requestedTab) ? requestedTab : "operational");
  const [opData, setOpData] = useState(null);
  const [execReports, setExecReports] = useState([]);
  const [clientReports, setClientReports] = useState([]);
  const [financialData, setFinancialData] = useState(null);
  const [roiData, setRoiData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/reports/ticket-analytics`, { headers }).catch(() => ({ data: null })),
      axios.get(`${API}/executive-reports/list`, { headers }).catch(() => ({ data: [] })),
      axios.get(`${API}/client-reports/history`, { headers }).catch(() => ({ data: [] })),
      axios.get(`${API}/reports/financial/revenue-summary`, { headers }).catch(() => ({ data: null })),
      axios.get(`${API}/roi-reports`, { headers }).catch(() => ({ data: [] })),
    ]).then(([op, ex, cl, fin, roi]) => {
      setOpData(op.data);
      setExecReports(Array.isArray(ex.data) ? ex.data : ex.data?.reports || []);
      setClientReports(Array.isArray(cl.data) ? cl.data : cl.data?.history || []);
      setFinancialData(fin.data);
      setRoiData(Array.isArray(roi.data) ? roi.data : roi.data?.reports || []);
    }).finally(() => setLoading(false));
  }, [headers]);

  useEffect(() => {
    if (REPORT_TABS.includes(requestedTab)) setTab(requestedTab);
  }, [requestedTab]);

  const selectTab = (nextTab) => {
    setTab(nextTab);
    const url = new URL(window.location.href);
    if (nextTab === "operational") url.searchParams.delete("tab");
    else url.searchParams.set("tab", nextTab);
    window.history.replaceState({}, "", url);
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="reports-hub">
      <div><h1 className="text-3xl font-bold tracking-tight">Reports Hub</h1><p className="text-sm text-muted-foreground">Operational, executive, client, financial, and ROI reporting — all in one place</p></div>

      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="operational"><BarChart3 className="w-3 h-3 mr-1" />Operational</TabsTrigger>
          <TabsTrigger value="executive"><Briefcase className="w-3 h-3 mr-1" />Executive ({execReports.length})</TabsTrigger>
          <TabsTrigger value="client"><Users className="w-3 h-3 mr-1" />Client ({clientReports.length})</TabsTrigger>
          <TabsTrigger value="financial"><DollarSign className="w-3 h-3 mr-1" />Financial</TabsTrigger>
          <TabsTrigger value="roi"><TrendingUp className="w-3 h-3 mr-1" />ROI ({roiData.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="operational" className="space-y-4">
          {opData && (
            <>
              <div className="grid grid-cols-4 gap-3">
                <Card><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold">{opData.total_tickets || opData.total || 0}</p><p className="text-[11px] text-muted-foreground">Total Tickets</p></CardContent></Card>
                <Card><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold text-emerald-400">{opData.resolved || 0}</p><p className="text-[11px] text-muted-foreground">Resolved</p></CardContent></Card>
                <Card><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold">{opData.avg_resolution_hours ? `${opData.avg_resolution_hours}h` : "N/A"}</p><p className="text-[11px] text-muted-foreground">Avg Resolution</p></CardContent></Card>
                <Card><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold">{opData.sla_compliance || 0}%</p><p className="text-[11px] text-muted-foreground">SLA Compliance</p></CardContent></Card>
              </div>
              {opData.by_category && (<Card><CardHeader className="pb-2"><CardTitle className="text-sm">Tickets by Category</CardTitle></CardHeader><CardContent><div className="h-56"><ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}><BarChart data={Object.entries(opData.by_category || {}).map(([k, v]) => ({ name: k, count: v }))}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 11 }} /><YAxis tick={{ fill: "#64748b", fontSize: 11 }} /><Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }} /><Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></CardContent></Card>)}
            </>
          )}
          {!opData && <p className="text-center text-muted-foreground py-8">No operational data</p>}
        </TabsContent>

        <TabsContent value="executive">
          {execReports.length > 0 ? (
            <Table><TableHeader><TableRow><TableHead>Report</TableHead><TableHead>Client</TableHead><TableHead>Period</TableHead><TableHead>Generated</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>{execReports.map((r, i) => (<TableRow key={i}><TableCell className="font-medium">{r.title || r.name || r.report_type}</TableCell><TableCell>{r.client_name || "All"}</TableCell><TableCell className="text-sm">{r.period}</TableCell><TableCell className="text-sm">{(r.generated_at || r.created_at || "").slice(0, 10)}</TableCell><TableCell><Badge variant="outline" className="text-[10px] capitalize">{r.status || "complete"}</Badge></TableCell></TableRow>))}</TableBody></Table>
          ) : <p className="text-center text-muted-foreground py-8">No executive reports</p>}
        </TabsContent>

        <TabsContent value="client">
          {clientReports.length > 0 ? (
            <Table><TableHeader><TableRow><TableHead>Report</TableHead><TableHead>Client</TableHead><TableHead>Type</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
              <TableBody>{clientReports.map((r, i) => (<TableRow key={i}><TableCell className="font-medium">{r.name || r.title}</TableCell><TableCell>{r.client_name || "Multiple"}</TableCell><TableCell className="text-sm">{r.report_type || r.type || "Standard"}</TableCell><TableCell className="text-sm">{(r.created_at || "").slice(0, 10)}</TableCell></TableRow>))}</TableBody></Table>
          ) : <p className="text-center text-muted-foreground py-8">No client reports</p>}
        </TabsContent>

        <TabsContent value="financial" className="space-y-4">
          {financialData ? (
            <div className="grid grid-cols-3 gap-3">
              <Card><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold">${(financialData.total_revenue || 0).toLocaleString()}</p><p className="text-[11px] text-muted-foreground">Total Revenue</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold text-emerald-400">${(financialData.collected || 0).toLocaleString()}</p><p className="text-[11px] text-muted-foreground">Collected</p></CardContent></Card>
              <Card className="border-amber-500/20"><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold text-amber-400">${(financialData.outstanding || 0).toLocaleString()}</p><p className="text-[11px] text-muted-foreground">Outstanding</p></CardContent></Card>
            </div>
          ) : <p className="text-center text-muted-foreground py-8">No financial data</p>}
        </TabsContent>

        <TabsContent value="roi">
          {roiData.length > 0 ? (
            <Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">Investment</TableHead><TableHead className="text-right">Returns</TableHead><TableHead className="text-right">ROI %</TableHead><TableHead>Period</TableHead></TableRow></TableHeader>
              <TableBody>{roiData.map((r, i) => (<TableRow key={i}><TableCell className="font-medium">{r.client_name || r.name}</TableCell><TableCell className="text-right font-mono">${(r.investment || 0).toLocaleString()}</TableCell><TableCell className="text-right font-mono text-emerald-400">${(r.returns || r.value || 0).toLocaleString()}</TableCell><TableCell className="text-right font-mono">{(r.roi_pct || 0).toFixed(1)}%</TableCell><TableCell className="text-sm">{r.period || "YTD"}</TableCell></TableRow>))}</TableBody></Table>
          ) : <p className="text-center text-muted-foreground py-8">No ROI data</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
