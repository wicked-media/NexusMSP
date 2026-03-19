import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Timer, AlertTriangle, Clock, Loader2, RefreshCw, Zap,
  TrendingUp, CheckCircle, Shield
} from "lucide-react";

function formatTime(seconds) {
  if (seconds <= 0) return "BREACHED";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function SlaBar({ pct, breached }) {
  const color = breached ? "bg-red-500" : pct > 80 ? "bg-amber-500" : pct > 60 ? "bg-blue-500" : "bg-emerald-500";
  return (
    <div className="w-full h-1.5 bg-muted/30 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export default function SlaTimerPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("active");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, pRes] = await Promise.all([
        axios.get(`${API}/sla-timer/active`, { headers }),
        axios.get(`${API}/sla-timer/predictions`, { headers }),
      ]);
      setData(tRes.data);
      setPredictions(pRes.data);
    } catch { toast.error("Failed to load SLA data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); const iv = setInterval(fetchData, 30000); return () => clearInterval(iv); }, [fetchData]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const stats = data?.stats || {};
  const tickets = data?.tickets || [];

  return (
    <div className="space-y-5" data-testid="sla-timer-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Timer className="w-8 h-8 text-orange-400" />SLA Timer</h1>
          <p className="text-muted-foreground">{stats.total_active || 0} active tickets &middot; Auto-refreshes every 30s</p>
        </div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "On Track", value: stats.on_track || 0, icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "At Risk", value: stats.at_risk || 0, icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "Breached", value: stats.breached || 0, icon: Timer, color: "text-red-400", bg: "bg-red-500/10" },
          { label: "Predictions", value: predictions.length, icon: TrendingUp, color: "text-violet-400", bg: "bg-violet-500/10" },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={i}>
              <CardContent className="pt-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center`}><Icon className={`w-5 h-5 ${s.color}`} /></div>
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex gap-2">
        {["active", "predictions"].map(t => (
          <Button key={t} variant={tab === t ? "default" : "outline"} size="sm" onClick={() => setTab(t)} className="capitalize">
            {t === "active" ? "Active SLAs" : "Breach Predictions"}
          </Button>
        ))}
      </div>

      {tab === "active" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Priority</TableHead><TableHead>Client</TableHead><TableHead>Assigned</TableHead><TableHead>SLA Progress</TableHead><TableHead>Time Left</TableHead></TableRow></TableHeader>
              <TableBody>
                {tickets.map(t => (
                  <TableRow key={t.id} className={t.sla_breached ? "bg-red-500/5" : t.sla_at_risk ? "bg-amber-500/5" : ""}>
                    <TableCell>
                      <p className="font-medium text-sm">{t.ticket_number ? `#${t.ticket_number}` : ""} {t.title}</p>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${
                        t.priority === "critical" ? "bg-red-500/20 text-red-400" :
                        t.priority === "high" ? "bg-amber-500/20 text-amber-400" :
                        t.priority === "medium" ? "bg-blue-500/20 text-blue-400" : "bg-zinc-500/20 text-zinc-400"}`}>{t.priority}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{t.client_name}</TableCell>
                    <TableCell className="text-sm">{t.assigned_to_name || "Unassigned"}</TableCell>
                    <TableCell>
                      <div className="w-32 space-y-1">
                        <SlaBar pct={t.sla_pct_elapsed || 0} breached={t.sla_breached} />
                        <p className="text-[10px] text-muted-foreground">{t.sla_pct_elapsed}% of {t.sla_hours}h</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`text-sm font-mono font-bold ${
                        t.sla_breached ? "text-red-400" : t.sla_at_risk ? "text-amber-400" : "text-emerald-400"}`}>
                        <Clock className="w-3 h-3 inline mr-1" />{formatTime(t.sla_remaining_seconds || 0)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === "predictions" && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-violet-400 flex items-center gap-2"><TrendingUp className="w-4 h-4" />Breach Probability Predictions</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Priority</TableHead><TableHead>Breach %</TableHead><TableHead>Time Left</TableHead><TableHead>Recommendation</TableHead></TableRow></TableHeader>
              <TableBody>
                {predictions.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-sm">{p.ticket_number ? `#${p.ticket_number}` : ""} {p.title}</TableCell>
                    <TableCell><Badge className="text-[10px]">{p.priority}</Badge></TableCell>
                    <TableCell><span className={`font-mono font-bold ${p.breach_probability > 80 ? "text-red-400" : "text-amber-400"}`}>{p.breach_probability}%</span></TableCell>
                    <TableCell className="text-sm font-mono">{formatTime(p.remaining_seconds || 0)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{p.recommendation}</Badge></TableCell>
                  </TableRow>
                ))}
                {predictions.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No breach predictions</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
