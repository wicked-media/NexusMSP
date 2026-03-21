import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Loader2, Monitor, Shield, ShieldCheck, ShieldAlert, Wifi, WifiOff,
  Lock, Unlock, Search, Scan, RefreshCw, HardDrive, AlertTriangle,
  CheckCircle, Clock, XCircle, Eye, Bug
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const STATUS_COLORS = {
  online: "text-green-400", offline: "text-red-400", isolated: "text-purple-400", needs_attention: "text-amber-400",
};
const AV_COLORS = { active: "text-green-400", outdated: "text-amber-400", disabled: "text-red-400" };
const PATCH_COLORS = { up_to_date: "text-green-400", pending: "text-amber-400", critical_missing: "text-red-400" };

export default function EndpointSecurityPage() {
  const { token } = useAuth();
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [actionLoading, setActionLoading] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchEndpoints = useCallback(async () => {
    setLoading(true);
    try { const res = await axios.get(`${API}/soc/endpoints`, { headers }); setEndpoints(res.data); }
    catch { toast.error("Failed to load endpoints"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchEndpoints(); }, [fetchEndpoints]);

  const handleScan = async (agentId) => {
    setActionLoading(agentId);
    try { await axios.post(`${API}/soc/endpoints/${agentId}/scan`, {}, { headers }); toast.success("Scan initiated"); }
    catch { toast.error("Failed"); }
    finally { setActionLoading(null); }
  };

  const handleIsolate = async (agentId) => {
    setActionLoading(agentId);
    try { await axios.post(`${API}/soc/endpoints/${agentId}/isolate`, {}, { headers }); toast.success("Endpoint isolated"); fetchEndpoints(); }
    catch { toast.error("Failed"); }
    finally { setActionLoading(null); }
  };

  const handleUnisolate = async (agentId) => {
    setActionLoading(agentId);
    try { await axios.post(`${API}/soc/endpoints/${agentId}/unisolate`, {}, { headers }); toast.success("Endpoint restored"); fetchEndpoints(); }
    catch { toast.error("Failed"); }
    finally { setActionLoading(null); }
  };

  const filtered = endpoints
    .filter(e => statusFilter === "all" || e.status === statusFilter)
    .filter(e => !search || e.hostname?.toLowerCase().includes(search.toLowerCase()) || e.organization?.toLowerCase().includes(search.toLowerCase()));

  const stats = {
    total: endpoints.length, online: endpoints.filter(e => e.status === "online").length,
    offline: endpoints.filter(e => e.status === "offline").length, isolated: endpoints.filter(e => e.status === "isolated").length,
    av_issues: endpoints.filter(e => e.av_status !== "active").length,
    patch_critical: endpoints.filter(e => e.patch_status === "critical_missing").length,
    high_risk: endpoints.filter(e => e.risk_score > 70).length,
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="endpoint-security">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Endpoint Security</h1><p className="text-muted-foreground">{endpoints.length} managed endpoints</p></div>
        <Button variant="outline" onClick={fetchEndpoints}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Total</p><p className="text-lg font-bold">{stats.total}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Online</p><p className="text-lg font-bold text-green-400">{stats.online}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Offline</p><p className="text-lg font-bold text-red-400">{stats.offline}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Isolated</p><p className="text-lg font-bold text-purple-400">{stats.isolated}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">AV Issues</p><p className="text-lg font-bold text-amber-400">{stats.av_issues}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Patch Critical</p><p className="text-lg font-bold text-red-400">{stats.patch_critical}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">High Risk</p><p className="text-lg font-bold text-red-400">{stats.high_risk}</p></CardContent></Card>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search hostname, org..." value={search} onChange={e => setSearch(e.target.value)} data-testid="endpoint-search" /></div>
        <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="online">Online</SelectItem><SelectItem value="offline">Offline</SelectItem><SelectItem value="isolated">Isolated</SelectItem><SelectItem value="needs_attention">Needs Attention</SelectItem></SelectContent></Select>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Hostname</TableHead><TableHead>OS</TableHead><TableHead>Org</TableHead><TableHead>Status</TableHead><TableHead>AV</TableHead><TableHead>Firewall</TableHead><TableHead>Patches</TableHead><TableHead>Risk</TableHead><TableHead>Last Seen</TableHead><TableHead></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No endpoints match</TableCell></TableRow> :
            filtered.map(ep => (
              <TableRow key={ep.id} className={ep.risk_score > 70 ? "bg-red-500/5" : ""} data-testid={`endpoint-${ep.id}`}>
                <TableCell className="font-mono text-sm font-medium">{ep.hostname}</TableCell>
                <TableCell className="text-xs">{ep.os}</TableCell>
                <TableCell className="text-xs">{ep.organization}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {ep.status === "online" ? <Wifi className="w-3 h-3 text-green-400" /> : ep.status === "isolated" ? <Lock className="w-3 h-3 text-purple-400" /> : <WifiOff className="w-3 h-3 text-red-400" />}
                    <span className={`text-xs capitalize ${STATUS_COLORS[ep.status]}`}>{ep.status}</span>
                  </div>
                </TableCell>
                <TableCell><Badge variant="outline" className={`text-[10px] ${AV_COLORS[ep.av_status]}`}>{ep.av_status === "active" ? <ShieldCheck className="w-3 h-3 mr-1" /> : <ShieldAlert className="w-3 h-3 mr-1" />}{ep.av_status}</Badge></TableCell>
                <TableCell><span className={`text-xs ${ep.firewall === "enabled" ? "text-green-400" : "text-red-400"}`}>{ep.firewall}</span></TableCell>
                <TableCell><Badge variant="outline" className={`text-[10px] ${PATCH_COLORS[ep.patch_status]}`}>{ep.patch_status?.replace(/_/g, " ")}</Badge></TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${ep.risk_score > 70 ? "bg-red-500/20 text-red-400" : ep.risk_score > 40 ? "bg-amber-500/20 text-amber-400" : "bg-green-500/20 text-green-400"}`}>{ep.risk_score}</div>
                  </div>
                </TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{ep.last_seen ? formatDistanceToNow(new Date(ep.last_seen), { addSuffix: true }) : "-"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Scan" onClick={() => handleScan(ep.id)} disabled={actionLoading === ep.id}><Scan className="w-3 h-3" /></Button>
                    {ep.status !== "isolated" ? (
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-purple-400" title="Isolate" onClick={() => handleIsolate(ep.id)} disabled={actionLoading === ep.id}><Lock className="w-3 h-3" /></Button>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-green-400" title="Restore" onClick={() => handleUnisolate(ep.id)} disabled={actionLoading === ep.id}><Unlock className="w-3 h-3" /></Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
