import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, BarChart3, DollarSign, FileWarning, Loader2, RefreshCw, Ticket, TrendingUp } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";

const money = (value) => value == null ? "—" : `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function RevenueCommandCenterPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState("current");
  const [forecast, setForecast] = useState(null);
  const [tracker, setTracker] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const requestHeaders = { Authorization: `Bearer ${token}` };
      const [forecastResponse, trackerResponse, trackingResponse] = await Promise.all([
        axios.get(`${API}/revenue-forecast/dashboard`, { headers: requestHeaders }),
        axios.get(`${API}/revenue-tracker/overview`, { headers: requestHeaders }),
        axios.get(`${API}/revenue-tracking/dashboard`, { headers: requestHeaders }),
      ]);
      setForecast(forecastResponse.data);
      setTracker(trackerResponse.data);
      setTracking(trackingResponse.data);
    } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (loading || !forecast || !tracker || !tracking) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  const summary = forecast.summary || {};
  const hasContracts = summary.evidence_state === "evidence_available";
  const contractRows = tracker.clients || [];
  const ticketRows = tracking.tickets || [];
  const reviewRows = forecast.churn_risks || [];

  return <div className="space-y-5" data-testid="revenue-command-center">
    <OperationalPageHeader eyebrow="Billing and finance" title="Revenue command centre" description="Current contract MRR and recorded ticket economics. Forecasts, retention and churn are withheld until NexusMSP has approved assumptions and historical billing evidence." icon={DollarSign} tone="emerald" actions={<Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-1 h-4 w-4" />Refresh evidence</Button>} />
    {!hasContracts && <Card className="border-dashed border-amber-500/30 bg-amber-500/5"><CardContent className="py-8 text-center"><FileWarning className="mx-auto mb-2 h-7 w-7 text-amber-300" /><p className="font-semibold">No active contract billing evidence</p><p className="mt-1 text-sm text-muted-foreground">Add or synchronise active contract values before relying on MRR or ARR. NexusMSP will not estimate a financial baseline.</p></CardContent></Card>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Current MRR" value={money(summary.current_mrr)} icon={DollarSign} tone="emerald" />
      <Metric label="Current ARR" value={money(summary.current_arr)} icon={BarChart3} tone="sky" />
      <Metric label="12-month forecast" value="—" icon={TrendingUp} tone="amber" hint="Needs history + assumptions" />
      <Metric label="Accounts to review" value={reviewRows.length} icon={AlertTriangle} tone="rose" hint="Operational attention, not churn prediction" />
    </div>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="h-auto flex-wrap gap-1"><TabsTrigger value="current"><BarChart3 className="mr-1 h-3.5 w-3.5" />Contract MRR</TabsTrigger><TabsTrigger value="tickets"><Ticket className="mr-1 h-3.5 w-3.5" />Ticket economics</TabsTrigger><TabsTrigger value="attention"><AlertTriangle className="mr-1 h-3.5 w-3.5" />Account review</TabsTrigger></TabsList>
      <TabsContent value="current" className="space-y-4"><Card><CardHeader className="pb-2"><CardTitle className="text-base">Current MRR by client</CardTitle></CardHeader><CardContent>{contractRows.length ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={contractRows.slice(0, 15)}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="client_name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={55} /><YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value) => `$${Math.round(value / 1000)}k`} /><Tooltip formatter={(value) => money(value)} /><Bar dataKey="mrr" fill="#34d399" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div> : <Empty message="No active contract values are available." />}</CardContent></Card>{contractRows.length > 0 && <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-center">Active contracts</TableHead><TableHead className="text-right">MRR</TableHead><TableHead className="text-right">ARR</TableHead><TableHead>Evidence</TableHead></TableRow></TableHeader><TableBody>{contractRows.map(row => <TableRow key={row.client_id}><TableCell className="font-medium">{row.client_name}</TableCell><TableCell className="text-center">{row.contracts}</TableCell><TableCell className="text-right font-mono">{money(row.mrr)}</TableCell><TableCell className="text-right font-mono">{money(row.mrr * 12)}</TableCell><TableCell><Badge variant="outline" className="text-[10px]">Active contracts</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}</TabsContent>
      <TabsContent value="tickets" className="space-y-4"><Card><CardHeader className="pb-2"><CardTitle className="text-base">Recorded ticket economics</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Revenue and cost are calculated only from recorded time rates and ticket product prices. Missing rates remain zero and are flagged for review; no default labour rate is applied.</CardContent></Card>{ticketRows.length ? <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Client</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Margin</TableHead><TableHead>Pricing evidence</TableHead></TableRow></TableHeader><TableBody>{ticketRows.slice(0, 100).map(row => <TableRow key={row.id}><TableCell className="font-medium">{row.title}</TableCell><TableCell>{row.client_name}</TableCell><TableCell className="text-right font-mono">{money(row.total_revenue)}</TableCell><TableCell className="text-right font-mono">{money(row.total_cost)}</TableCell><TableCell className="text-right font-mono">{row.margin_pct == null ? "—" : `${row.margin_pct}%`}</TableCell><TableCell><Badge variant={row.pricing_evidence ? "outline" : "secondary"} className="text-[10px]">{row.pricing_evidence ? "Recorded" : "Missing rate"}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card> : <Empty message="No ticket revenue evidence has been recorded." />}</TabsContent>
      <TabsContent value="attention">{reviewRows.length ? <Card><CardHeader className="pb-2"><CardTitle className="text-base">Accounts needing service review</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">Current MRR</TableHead><TableHead className="text-center">Open tickets</TableHead><TableHead>Why shown</TableHead></TableRow></TableHeader><TableBody>{reviewRows.map(row => <TableRow key={row.client_id}><TableCell className="font-medium">{row.client_name}</TableCell><TableCell className="text-right font-mono">{money(row.mrr)}</TableCell><TableCell className="text-center">{row.open_tickets}</TableCell><TableCell><Badge variant="secondary" className="text-[10px]">Review service workload</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card> : <Empty message="No accounts currently meet the workload review threshold. This is not a churn forecast." />}</TabsContent>
    </Tabs>
  </div>;
}

function Metric({ label, value, icon: Icon, tone, hint }) { const colours = { emerald: "text-emerald-400", sky: "text-sky-400", amber: "text-amber-400", rose: "text-rose-400" }; return <Card><CardContent className="pt-4"><Icon className={`mb-2 h-4 w-4 ${colours[tone]}`} /><p className={`text-2xl font-bold ${colours[tone]}`}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p>{hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}</CardContent></Card>; }
function Empty({ message }) { return <div className="py-10 text-center text-sm text-muted-foreground">{message}</div>; }
