import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Activity, TrendingUp, TrendingDown, Users, Shield, RefreshCw,
  Loader2, Heart, AlertTriangle, DollarSign, Monitor, ChevronRight
} from "lucide-react";

const STATUS_CONFIG = {
  thriving: { color: "bg-emerald-500/20 text-emerald-400", bar: "bg-emerald-500" },
  healthy: { color: "bg-blue-500/20 text-blue-400", bar: "bg-blue-500" },
  needs_attention: { color: "bg-amber-500/20 text-amber-400", bar: "bg-amber-500" },
  at_risk: { color: "bg-orange-500/20 text-orange-400", bar: "bg-orange-500" },
  critical: { color: "bg-red-500/20 text-red-400", bar: "bg-red-500" },
};

function HealthBar({ score, size = "md" }) {
  const color = score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-blue-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  const h = size === "sm" ? "h-1.5" : "h-2.5";
  return (
    <div className={`w-full ${h} bg-muted/30 rounded-full overflow-hidden`}>
      <div className={`${h} rounded-full ${color} transition-all`} style={{ width: `${score}%` }} />
    </div>
  );
}

function MetricDonut({ label, value, max = 100 }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-blue-400" : pct >= 40 ? "text-amber-400" : "text-red-400";
  return (
    <div className="text-center">
      <div className="relative w-16 h-16 mx-auto">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="8" />
          <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" className={color} strokeWidth="8"
            strokeDasharray={`${pct * 2.51} ${251 - pct * 2.51}`} strokeLinecap="round" />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center text-sm font-black ${color}`}>{value}</span>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

export default function ClientHealthPage() {
  const { token } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [allScores, setAllScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, sRes] = await Promise.all([
        axios.get(`${API}/client-health/dashboard`, { headers }),
        axios.get(`${API}/client-health/scores`, { headers }),
      ]);
      setDashboard(dRes.data);
      setAllScores(sRes.data);
    } catch { toast.error("Failed to load health data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const d = dashboard || {};
  const dist = d.distribution || {};

  return (
    <div className="space-y-5" data-testid="client-health-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Activity className="w-8 h-8 text-emerald-400" />Client Health</h1>
          <p className="text-muted-foreground">{d.total || 0} clients &middot; Avg: {d.avg_health || 0}/100</p>
        </div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-5 gap-3">
        {["thriving", "healthy", "needs_attention", "at_risk", "critical"].map(s => {
          const cfg = STATUS_CONFIG[s];
          return (
            <Card key={s}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg ${cfg.color.split(" ")[0]} flex items-center justify-center`}>
                    <span className={`text-xl font-black ${cfg.color.split(" ")[1]}`}>{dist[s] || 0}</span>
                  </div>
                  <p className="text-xs text-muted-foreground capitalize">{s.replace("_", " ")}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Revenue alert */}
      {d.at_risk_revenue > 0 && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="py-3 flex items-center gap-3">
            <DollarSign className="w-5 h-5 text-red-400" />
            <div>
              <p className="text-sm font-bold text-red-400">${d.at_risk_revenue?.toLocaleString()} Monthly Revenue at Risk</p>
              <p className="text-xs text-muted-foreground">{d.at_risk?.length || 0} clients scoring below 50 represent this revenue</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        {/* At-risk clients */}
        <Card className="col-span-1">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />At-Risk ({(d.at_risk || []).length})</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[400px] overflow-y-auto">
            {(d.at_risk || []).map(c => (
              <div key={c.client_id} className="p-2.5 rounded-lg bg-muted/20 border border-border/30 cursor-pointer hover:bg-muted/30 transition-all"
                onClick={() => setSelectedClient(c)} data-testid={`health-client-${c.client_id}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-sm font-medium truncate">{c.client_name}</p>
                  <span className={`text-sm font-black ${c.health_score < 30 ? "text-red-400" : "text-amber-400"}`}>{c.health_score}</span>
                </div>
                <HealthBar score={c.health_score} size="sm" />
              </div>
            ))}
            {(d.at_risk || []).length === 0 && <p className="text-xs text-muted-foreground text-center py-4">All clients healthy!</p>}
          </CardContent>
        </Card>

        {/* Full client table */}
        <Card className="col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-blue-400" />All Clients</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Client</TableHead><TableHead>Health</TableHead><TableHead>Status</TableHead><TableHead>Tickets</TableHead><TableHead>Devices</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {allScores.map(c => {
                  const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.needs_attention;
                  return (
                    <TableRow key={c.client_id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelectedClient(c)}>
                      <TableCell className="font-medium text-sm">{c.client_name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 w-24">
                          <HealthBar score={c.health_score} size="sm" />
                          <span className="text-xs font-mono font-bold">{c.health_score}</span>
                        </div>
                      </TableCell>
                      <TableCell><Badge className={`${cfg.color} text-[10px]`}>{c.status?.replace("_", " ")}</Badge></TableCell>
                      <TableCell className="text-xs">{c.details?.open_tickets || 0} open</TableCell>
                      <TableCell className="text-xs">{c.details?.online_devices || 0}/{c.details?.devices || 0}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Client detail modal */}
      {selectedClient && (
        <Card className="border-primary/20">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{selectedClient.client_name} - Health Breakdown</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setSelectedClient(null)}>Close</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-8">
              <MetricDonut label="Overall" value={selectedClient.health_score} />
              <MetricDonut label="Sentiment" value={selectedClient.metrics?.sentiment || 0} />
              <MetricDonut label="Tickets" value={selectedClient.metrics?.ticket_health || 0} />
              <MetricDonut label="Payments" value={selectedClient.metrics?.payment_health || 0} />
              <MetricDonut label="Devices" value={selectedClient.metrics?.device_health || 0} />
              <MetricDonut label="Engagement" value={selectedClient.metrics?.engagement || 0} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
