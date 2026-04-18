import { useState, useEffect, lazy, Suspense } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, DollarSign, TrendingUp, TrendingDown, AlertTriangle, Users, BarChart3, PieChart, ArrowUpRight } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, PieChart as RePieChart, Pie, Cell, Legend } from "recharts";

const COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#06b6d4"];

export default function RevenueCommandCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("forecast");
  const [forecast, setForecast] = useState(null);
  const [tracker, setTracker] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/revenue-forecast/dashboard`, { headers }).catch(() => ({ data: null })),
      axios.get(`${API}/revenue-tracker/overview`, { headers }).catch(() => ({ data: null })),
      axios.get(`${API}/revenue-tracking/dashboard`, { headers }).catch(() => ({ data: null })),
    ]).then(([f, t, tk]) => {
      setForecast(f.data);
      setTracker(t.data);
      setTracking(tk.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const fs = forecast?.summary || {};
  const ts = tracker?.summary || tracking?.summary || {};

  return (
    <div className="space-y-5" data-testid="revenue-command-center">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Revenue Command Center</h1>
        <p className="text-sm text-muted-foreground">MRR/ARR projections, analytics, tracking, and churn prediction — unified view</p>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <Card><CardContent className="pt-4 pb-3"><DollarSign className="w-5 h-5 text-emerald-400 mb-1" /><p className="text-2xl font-bold">${(fs.current_mrr || ts.current_mrr || 0).toLocaleString()}</p><p className="text-[11px] text-muted-foreground">Current MRR</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><DollarSign className="w-5 h-5 text-blue-400 mb-1" /><p className="text-2xl font-bold">${(fs.current_arr || ts.current_arr || 0).toLocaleString()}</p><p className="text-[11px] text-muted-foreground">Current ARR</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><TrendingUp className="w-5 h-5 text-emerald-400 mb-1" /><p className="text-2xl font-bold">${(fs.projected_arr_12m || 0).toLocaleString()}</p><p className="text-[11px] text-muted-foreground">Projected ARR (12m)</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><Users className="w-5 h-5 text-primary mb-1" /><p className="text-2xl font-bold">{fs.total_clients || ts.total_clients || 0}</p><p className="text-[11px] text-muted-foreground">Clients</p></CardContent></Card>
        <Card className="border-red-500/20"><CardContent className="pt-4 pb-3"><AlertTriangle className="w-5 h-5 text-red-400 mb-1" /><p className="text-2xl font-bold text-red-400">{fs.churn_risks || 0}</p><p className="text-[11px] text-muted-foreground">Churn Risks</p></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="forecast"><TrendingUp className="w-3 h-3 mr-1" />12m Forecast</TabsTrigger>
          <TabsTrigger value="analytics"><BarChart3 className="w-3 h-3 mr-1" />Analytics</TabsTrigger>
          <TabsTrigger value="tracking"><DollarSign className="w-3 h-3 mr-1" />MRR Tracking</TabsTrigger>
          <TabsTrigger value="churn"><AlertTriangle className="w-3 h-3 mr-1" />Churn Risks</TabsTrigger>
        </TabsList>

        <TabsContent value="forecast" className="space-y-4">
          {forecast?.forecast && (
            <>
              <Card><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="w-4 h-4" />12-Month MRR Projection</CardTitle></CardHeader>
                <CardContent><div className="h-72"><ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                  <AreaChart data={forecast.forecast}><defs><linearGradient id="mrrG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} /><YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} /><Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }} formatter={v => [`$${v.toLocaleString()}`, "MRR"]} /><Area type="monotone" dataKey="mrr" stroke="#10b981" strokeWidth={2} fill="url(#mrrG)" />
                  </AreaChart></ResponsiveContainer></div></CardContent></Card>
              <Table><TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">MRR</TableHead><TableHead className="text-right">ARR</TableHead><TableHead className="text-right">Growth</TableHead></TableRow></TableHeader>
                <TableBody>{forecast.forecast.map((f, i) => (<TableRow key={i}><TableCell className="font-medium text-sm">{f.month}</TableCell><TableCell className="text-right font-mono text-sm">${f.mrr.toLocaleString()}</TableCell><TableCell className="text-right font-mono text-sm">${f.arr.toLocaleString()}</TableCell><TableCell className={`text-right text-sm ${f.growth_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{f.growth_pct > 0 ? "+" : ""}{f.growth_pct}%</TableCell></TableRow>))}</TableBody></Table>
            </>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          {tracker?.clients && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Revenue by Client</CardTitle></CardHeader><CardContent>
              <div className="h-64"><ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <BarChart data={(tracker.clients || []).slice(0, 10)}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" /><XAxis dataKey="client_name" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={50} /><YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} /><Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }} /><Bar dataKey="mrr" fill="#10b981" radius={[4, 4, 0, 0]} /></BarChart>
              </ResponsiveContainer></div></CardContent></Card>
          )}
          {tracking?.revenue_by_source && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Revenue by Source</CardTitle></CardHeader><CardContent>
              <div className="h-56"><ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <RePieChart><Pie data={tracking.revenue_by_source} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}>{(tracking.revenue_by_source || []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Legend /><Tooltip /></RePieChart>
              </ResponsiveContainer></div></CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="tracking" className="space-y-4">
          {tracker?.clients && (
            <Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">MRR</TableHead><TableHead className="text-right">ARR</TableHead><TableHead className="text-right">Growth</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>{(tracker.clients || []).map(c => (<TableRow key={c.client_id || c.id}><TableCell className="font-medium">{c.client_name || c.name}</TableCell><TableCell className="text-right font-mono">${(c.mrr || 0).toLocaleString()}</TableCell><TableCell className="text-right font-mono">${((c.mrr || 0) * 12).toLocaleString()}</TableCell><TableCell className={`text-right ${(c.growth_pct || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{(c.growth_pct || 0) > 0 ? "+" : ""}{(c.growth_pct || 0).toFixed(1)}%</TableCell><TableCell><Badge variant="outline" className="text-[10px] capitalize">{c.status || "active"}</Badge></TableCell></TableRow>))}</TableBody></Table>
          )}
        </TabsContent>

        <TabsContent value="churn" className="space-y-4">
          {(forecast?.churn_risks || []).length > 0 ? (
            <Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">MRR</TableHead><TableHead className="text-center">Open Tickets</TableHead><TableHead className="text-center">Sentiment</TableHead><TableHead>Risk</TableHead></TableRow></TableHeader>
              <TableBody>{forecast.churn_risks.map(c => (<TableRow key={c.client_id}><TableCell className="font-medium">{c.client_name}</TableCell><TableCell className="text-right font-mono">${c.mrr.toLocaleString()}</TableCell><TableCell className="text-center">{c.open_tickets}</TableCell><TableCell className="text-center"><span className={c.sentiment < 50 ? "text-red-400" : "text-amber-400"}>{c.sentiment}/100</span></TableCell><TableCell><Badge variant={c.risk === "high" ? "destructive" : "secondary"} className="text-[10px] capitalize">{c.risk}</Badge></TableCell></TableRow>))}</TableBody></Table>
          ) : <p className="text-center text-muted-foreground py-8">No churn risks detected</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
