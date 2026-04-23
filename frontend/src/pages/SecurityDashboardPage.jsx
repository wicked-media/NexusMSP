import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Loader2, Shield, ShieldAlert, ShieldCheck, Monitor, Wifi, WifiOff,
  AlertTriangle, Activity, Eye, Bug, Globe, Users, Lock, ChevronRight,
  TrendingUp, Server, Zap, Target, BarChart3, Skull
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { HuntressSummaryCard } from "@/components/security/HuntressSummaryCard";

const SEV_BADGE = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

export default function SecurityDashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/soc/dashboard`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to load security data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const h = data.huntress || {};
  const threatLevel = h.critical_incidents > 0 ? "CRITICAL" : h.open_incidents > 3 ? "HIGH" : h.open_incidents > 0 ? "MEDIUM" : "LOW";
  const threatColor = { CRITICAL: "text-red-400", HIGH: "text-orange-400", MEDIUM: "text-amber-400", LOW: "text-green-400" }[threatLevel];
  const threatBg = { CRITICAL: "bg-red-500/10 border-red-500/30", HIGH: "bg-orange-500/10 border-orange-500/30", MEDIUM: "bg-amber-500/10 border-amber-500/30", LOW: "bg-green-500/10 border-green-500/30" }[threatLevel];

  return (
    <div className="space-y-6" data-testid="security-dashboard">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Security Operations Center</h1><p className="text-muted-foreground">Unified threat monitoring & response</p></div>
        {data.mock_data && <Badge variant="outline" className="text-amber-400 border-amber-500/30">Demo Data</Badge>}
      </div>

      {/* Threat Level Banner */}
      <Card className={`${threatBg} overflow-hidden`} data-testid="threat-level-banner">
        <CardContent className="py-4 px-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center ${threatLevel === "CRITICAL" ? "bg-red-500/20 animate-pulse" : threatLevel === "HIGH" ? "bg-orange-500/20" : "bg-green-500/20"}`}>
              <ShieldAlert className={`w-7 h-7 ${threatColor}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Current Threat Level</p>
              <p className={`text-2xl font-bold ${threatColor}`}>{threatLevel}</p>
            </div>
          </div>
          <div className="flex gap-6 text-center">
            <div><p className="text-2xl font-bold text-red-400">{h.critical_incidents}</p><p className="text-[10px] text-muted-foreground">Critical</p></div>
            <div><p className="text-2xl font-bold text-amber-400">{h.open_incidents}</p><p className="text-[10px] text-muted-foreground">Open Alerts</p></div>
            <div><p className="text-2xl font-bold">{h.avg_response_time_min}m</p><p className="text-[10px] text-muted-foreground">Avg Response</p></div>
            <div><p className="text-2xl font-bold text-green-400">{h.threats_blocked_30d}</p><p className="text-[10px] text-muted-foreground">Blocked (30d)</p></div>
          </div>
        </CardContent>
      </Card>

      {/* Huntress Live Summary */}
      <HuntressSummaryCard />

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card className="cursor-pointer hover:bg-muted/30" onClick={() => navigate("/endpoint-security")} data-testid="stat-agents">
          <CardContent className="pt-4"><div className="flex items-center gap-2"><Monitor className="w-5 h-5 text-blue-400" /><div><p className="text-[10px] text-muted-foreground">Endpoints</p><p className="text-lg font-bold">{h.total_agents}</p></div></div></CardContent>
        </Card>
        <Card data-testid="stat-online"><CardContent className="pt-4"><div className="flex items-center gap-2"><Wifi className="w-5 h-5 text-green-400" /><div><p className="text-[10px] text-muted-foreground">Online</p><p className="text-lg font-bold text-green-400">{h.online}</p></div></div></CardContent></Card>
        <Card data-testid="stat-offline"><CardContent className="pt-4"><div className="flex items-center gap-2"><WifiOff className="w-5 h-5 text-red-400" /><div><p className="text-[10px] text-muted-foreground">Offline</p><p className="text-lg font-bold text-red-400">{h.offline}</p></div></div></CardContent></Card>
        <Card data-testid="stat-isolated"><CardContent className="pt-4"><div className="flex items-center gap-2"><Lock className="w-5 h-5 text-purple-400" /><div><p className="text-[10px] text-muted-foreground">Isolated</p><p className="text-lg font-bold text-purple-400">{h.isolated}</p></div></div></CardContent></Card>
        <Card data-testid="stat-compliance"><CardContent className="pt-4"><div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-400" /><div><p className="text-[10px] text-muted-foreground">Compliance</p><p className="text-lg font-bold text-emerald-400">{data.compliance_score}%</p></div></div></CardContent></Card>
        <Card data-testid="stat-vulns"><CardContent className="pt-4"><div className="flex items-center gap-2"><Bug className="w-5 h-5 text-amber-400" /><div><p className="text-[10px] text-muted-foreground">Critical Vulns</p><p className="text-lg font-bold text-amber-400">{data.vulnerability_summary?.critical || 0}</p></div></div></CardContent></Card>
      </div>

      {/* Endpoint Health Bar */}
      <Card data-testid="endpoint-health"><CardContent className="py-3 px-5">
        <div className="flex items-center justify-between mb-1"><span className="text-xs font-semibold text-muted-foreground uppercase">Endpoint Health</span><span className="text-xs font-mono">{h.health_pct}%</span></div>
        <Progress value={h.health_pct} className="h-2" />
      </CardContent></Card>

      <div className="grid grid-cols-12 gap-4">
        {/* Recent Incidents */}
        <Card className="col-span-7" data-testid="recent-incidents">
          <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-red-400" />Active Incidents</CardTitle><Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate("/soc-feed")}>View All<ChevronRight className="w-3 h-3 ml-1" /></Button></div></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Incident</TableHead><TableHead>Host</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {(data.incidents || []).slice(0, 6).map(inc => (
                  <TableRow key={inc.id} className="cursor-pointer hover:bg-muted/30" onClick={() => navigate("/soc-feed")}>
                    <TableCell className="text-sm max-w-xs truncate">{inc.title}</TableCell>
                    <TableCell className="text-xs font-mono">{inc.hostname}</TableCell>
                    <TableCell><Badge className={SEV_BADGE[inc.severity] + " text-[10px]"}>{inc.severity}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] capitalize">{inc.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Quick Links */}
        <div className="col-span-5 space-y-3">
          <Card data-testid="dark-web-summary">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Skull className="w-4 h-4 text-purple-400" />Dark Web Alerts</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div><p className="text-2xl font-bold text-purple-400">{(data.dark_web_alerts || []).length}</p><p className="text-xs text-muted-foreground">Findings</p></div>
                <Button variant="outline" size="sm" onClick={() => navigate("/dark-web-monitor")} data-testid="go-dark-web">View Details<ChevronRight className="w-3 h-3 ml-1" /></Button>
              </div>
            </CardContent>
          </Card>
          <Card data-testid="vuln-summary">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Bug className="w-4 h-4 text-amber-400" />Vulnerabilities</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-3">
                {Object.entries(data.vulnerability_summary || {}).filter(([k]) => k !== "last_scan").map(([sev, cnt]) => (
                  <div key={sev} className="text-center"><p className={`text-lg font-bold ${sev === "critical" ? "text-red-400" : sev === "high" ? "text-orange-400" : sev === "medium" ? "text-amber-400" : "text-blue-400"}`}>{cnt}</p><p className="text-[10px] text-muted-foreground capitalize">{sev}</p></div>
                ))}
              </div>
              <Button variant="outline" size="sm" className="w-full mt-2" onClick={() => navigate("/vulnerability-scanner")}>Full Scanner<ChevronRight className="w-3 h-3 ml-1" /></Button>
            </CardContent>
          </Card>
          <Card data-testid="identity-summary">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-cyan-400" />Identity Threats</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <p className="text-2xl font-bold text-cyan-400">{data.identity_threats}</p>
                <Button variant="outline" size="sm" onClick={() => navigate("/identity-threat")}>View<ChevronRight className="w-3 h-3 ml-1" /></Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
