import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield, AlertTriangle, Monitor, Eye, Activity, Lock } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid } from "recharts";

export default function SecurityDashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [oRes, tRes] = await Promise.all([
          axios.get(`${API}/security-dashboard/overview`, { headers }),
          axios.get(`${API}/security-dashboard/score-trend`, { headers }),
        ]);
        setData(oRes.data);
        setTrend(tRes.data);
      } catch (e) { toast.error("Failed to load security data"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const { summary } = data;
  const scoreColor = summary.security_score >= 80 ? "text-emerald-500" : summary.security_score >= 60 ? "text-amber-500" : "text-red-500";

  return (
    <div className="space-y-6" data-testid="security-dashboard-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Security Operations Center</h1><p className="text-muted-foreground text-sm mt-1">Unified security posture across all clients</p></div>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        <Card><CardContent className="pt-5 text-center"><p className={`text-4xl font-bold ${scoreColor}`}>{summary.security_score}</p><p className="text-xs text-muted-foreground mt-1">Security Score</p></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Monitor className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{summary.total_endpoints}</p><p className="text-xs text-muted-foreground">Endpoints</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Shield className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{summary.patch_compliance_pct}%</p><p className="text-xs text-muted-foreground">Patch Compliance</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><AlertTriangle className="w-6 h-6 text-red-500" /><div><p className="text-2xl font-bold">{summary.active_threats}</p><p className="text-xs text-muted-foreground">Active Threats</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Eye className="w-6 h-6 text-amber-500" /><div><p className="text-2xl font-bold">{summary.identity_alerts}</p><p className="text-xs text-muted-foreground">Identity Alerts</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Lock className="w-6 h-6 text-purple-500" /><div><p className="text-2xl font-bold">{summary.canary_triggers}</p><p className="text-xs text-muted-foreground">Canary Triggers</p></div></CardContent></Card>
      </div>

      {/* Score Trend */}
      <Card><CardHeader><CardTitle className="text-lg">Security Score Trend (30 days)</CardTitle></CardHeader>
        <CardContent><div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={5} />
              <YAxis domain={[60, 100]} tick={{ fontSize: 10 }} />
              <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="score" name="Score" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div></CardContent>
      </Card>

      {/* Recent Incidents */}
      <Card><CardHeader><CardTitle className="text-lg">Recent Incidents</CardTitle></CardHeader>
        <CardContent><div className="space-y-2">
          {(data.recent_incidents || []).map(i => (
            <div key={i.id} className="flex items-center justify-between p-3 rounded-lg border" data-testid={`incident-${i.id}`}>
              <div className="flex items-center gap-3">
                <Badge variant={i.severity === "critical" ? "destructive" : i.severity === "high" ? "warning" : "secondary"}>{i.severity}</Badge>
                <div><p className="text-sm font-medium">{i.title}</p><p className="text-xs text-muted-foreground">{i.client_name} | {i.device_name}</p></div>
              </div>
              <Badge variant={i.resolved ? "outline" : "default"}>{i.resolved ? "Resolved" : "Active"}</Badge>
            </div>
          ))}
        </div></CardContent>
      </Card>

      {/* Devices at Risk */}
      <Card><CardHeader><CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-500" />Devices at Risk</CardTitle></CardHeader>
        <CardContent><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-3 font-medium">Device</th><th className="pb-3 font-medium">Client</th><th className="pb-3 font-medium">Status</th><th className="pb-3 font-medium">Patch Status</th></tr></thead>
          <tbody>{(data.devices_at_risk || []).map(d => (
            <tr key={d.id} className="border-b border-border/50"><td className="py-2 font-medium">{d.name}</td><td className="py-2 text-muted-foreground">{d.client_name}</td><td className="py-2"><Badge className={d.status === "online" ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}>{d.status}</Badge></td><td className="py-2"><Badge variant="destructive">{d.patch_status}</Badge></td></tr>
          ))}</tbody>
        </table></div></CardContent>
      </Card>
    </div>
  );
}
