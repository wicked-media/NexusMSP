import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  FileBarChart, DollarSign, Shield, Monitor, Clock, TrendingUp,
  Loader2, RefreshCw, Eye, Download, ChevronRight, Star
} from "lucide-react";

function ValueBar({ value, max }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="w-20 h-1.5 bg-muted/30 rounded-full overflow-hidden">
      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function RoiReportsPage() {
  const { token } = useAuth();
  const [summaries, setSummaries] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/roi-reports`, { headers });
      setSummaries(res.data);
    } catch { toast.error("Failed to load ROI data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const viewReport = async (clientId) => {
    try {
      const res = await axios.get(`${API}/roi-reports/${clientId}`, { headers });
      setSelectedReport(res.data);
    } catch { toast.error("Failed to generate report"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // Detail view
  if (selectedReport) {
    const r = selectedReport;
    const v = r.value_delivered || {};
    const inv = r.investment || {};
    return (
      <div className="space-y-5" data-testid="roi-report-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedReport(null)}>Back</Button>
          <FileBarChart className="w-6 h-6 text-emerald-400" />
          <div>
            <h2 className="text-xl font-bold">{r.client?.name} - ROI Report</h2>
            <p className="text-xs text-muted-foreground">{r.period} &middot; Generated {r.generated_at?.slice(0, 10)}</p>
          </div>
        </div>

        {/* ROI Headline */}
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="py-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Value Delivered</p>
              <p className="text-4xl font-black text-emerald-400">${v.total_value_delivered?.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">ROI</p>
              <p className={`text-4xl font-black ${r.roi?.roi_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{r.roi?.roi_pct}%</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Value Ratio</p>
              <p className="text-4xl font-black text-blue-400">{r.roi?.value_vs_investment_ratio}x</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-4">
          {/* Ticket Metrics */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-blue-400" />Ticket Metrics</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Total Tickets", value: r.ticket_metrics?.total_tickets },
                { label: "Resolved", value: r.ticket_metrics?.resolved },
                { label: "Critical Resolved", value: r.ticket_metrics?.critical_resolved },
                { label: "Avg Resolution", value: `${r.ticket_metrics?.avg_resolution_hours}h` },
                { label: "Resolution Rate", value: `${r.ticket_metrics?.resolution_rate}%` },
              ].map((m, i) => (
                <div key={`k-${i}`} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{m.label}</span>
                  <span className="font-bold">{m.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Value Delivered */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-emerald-400" />Value Delivered</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Downtime Prevented</span><span className="font-bold">{v.downtime_prevented_hours}h</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Downtime Savings</span><span className="font-bold text-emerald-400">${v.cost_savings_downtime?.toLocaleString()}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Predictive Issues Caught</span><span className="font-bold">{v.predictive_issues_caught}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Predictive Savings</span><span className="font-bold text-emerald-400">${v.predictive_savings?.toLocaleString()}</span></div>
            </CardContent>
          </Card>

          {/* Infrastructure */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Monitor className="w-4 h-4 text-cyan-400" />Infrastructure</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Devices Managed</span><span className="font-bold">{r.infrastructure?.total_devices}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Online</span><span className="font-bold text-emerald-400">{r.infrastructure?.online_devices}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Uptime</span><span className="font-bold">{r.infrastructure?.uptime_pct}%</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Monthly Investment</span><span className="font-bold">${inv.monthly?.toLocaleString()}</span></div>
            </CardContent>
          </Card>
        </div>

        {/* Highlights */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Star className="w-4 h-4 text-amber-400" />Key Highlights</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {(r.highlights || []).map((h, i) => (
                <li key={`k-${i}`} className="flex items-start gap-2 text-sm"><ChevronRight className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />{h}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Summary list
  const maxValue = Math.max(1, ...summaries.map(s => s.estimated_value));
  return (
    <div className="space-y-5" data-testid="roi-reports-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><FileBarChart className="w-8 h-8 text-emerald-400" />Client ROI Reports</h1>
          <p className="text-muted-foreground">{summaries.length} clients &middot; Demonstrate value delivered</p>
        </div>
        <Button variant="outline" onClick={fetchAll}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Tier</TableHead><TableHead>Tickets</TableHead><TableHead>Resolved</TableHead><TableHead>Devices</TableHead><TableHead>Est. Value</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {summaries.map(s => (
                <TableRow key={s.client_id} className="cursor-pointer hover:bg-muted/30" onClick={() => viewReport(s.client_id)}>
                  <TableCell className="font-medium">{s.client_name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{s.tier || "standard"}</Badge></TableCell>
                  <TableCell className="text-sm">{s.total_tickets}</TableCell>
                  <TableCell className="text-sm">{s.resolved}</TableCell>
                  <TableCell className="text-sm">{s.devices}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ValueBar value={s.estimated_value} max={maxValue} />
                      <span className="text-sm font-mono font-bold text-emerald-400">${s.estimated_value?.toLocaleString()}</span>
                    </div>
                  </TableCell>
                  <TableCell><Button variant="ghost" size="sm" className="h-7 text-xs"><Eye className="w-3 h-3 mr-1" />View</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
