import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Skull, Globe, Search, AlertTriangle, Eye, CheckCircle, XCircle, Shield, Users, RefreshCw, Mail } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const TYPE_LABELS = { credential_leak: "Credential Leak", domain_mention: "Domain Mention", data_breach: "Data Breach", executive_impersonation: "Exec Impersonation", brand_abuse: "Brand Abuse" };
const SEV = { critical: "bg-red-500/20 text-red-400", high: "bg-orange-500/20 text-orange-400", medium: "bg-amber-500/20 text-amber-400", low: "bg-blue-500/20 text-blue-400" };
const STATUS_LABELS = { new: "New", reviewed: "Reviewed", actioned: "Actioned", dismissed: "Dismissed" };

export default function DarkWebMonitorPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("all");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { const res = await axios.get(`${API}/soc/dark-web`, { headers }); setData(res.data); }
    catch { toast.error("Failed to load dark web data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const filtered = (data.alerts || []).filter(a => sevFilter === "all" || a.severity === sevFilter)
    .filter(a => !search || a.details?.toLowerCase().includes(search.toLowerCase()) || a.domain?.toLowerCase().includes(search.toLowerCase()));
  const critical = data.alerts.filter(a => a.severity === "critical").length;
  const credLeaks = data.alerts.filter(a => a.type === "credential_leak").length;

  return (
    <div className="space-y-6" data-testid="dark-web-monitor">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Dark Web Monitor</h1><p className="text-muted-foreground">Monitoring {data.monitored_domains?.length || 0} domains</p></div>
        <div className="flex gap-2">
          {data.mock_data && <Badge variant="outline" className="text-amber-400 border-amber-500/30">Demo Data</Badge>}
          <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Scan Now</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Total Findings</p><p className="text-lg font-bold">{data.total_findings}</p></CardContent></Card>
        <Card className="border-red-500/20"><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Critical</p><p className="text-lg font-bold text-red-400">{critical}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Credential Leaks</p><p className="text-lg font-bold text-purple-400">{credLeaks}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Domains Monitored</p><p className="text-lg font-bold text-blue-400">{data.monitored_domains?.length || 0}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Users Affected</p><p className="text-lg font-bold text-amber-400">{data.alerts.reduce((s, a) => s + (a.affected_users || 0), 0)}</p></CardContent></Card>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search findings..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <Select value={sevFilter} onValueChange={setSevFilter}><SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Severity</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Details</TableHead><TableHead>Domain</TableHead><TableHead>Source</TableHead><TableHead>Severity</TableHead><TableHead>Users</TableHead><TableHead>Found</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No findings match</TableCell></TableRow> :
            filtered.map(alert => (
              <TableRow key={alert.id} className={alert.severity === "critical" ? "bg-red-500/5" : ""} data-testid={`dw-alert-${alert.id}`}>
                <TableCell><Badge variant="outline" className="text-[10px]">{TYPE_LABELS[alert.type] || alert.type}</Badge></TableCell>
                <TableCell className="text-sm max-w-xs truncate">{alert.details}</TableCell>
                <TableCell className="text-xs font-mono text-blue-400">{alert.domain}</TableCell>
                <TableCell className="text-xs">{alert.source}</TableCell>
                <TableCell><Badge className={SEV[alert.severity] + " text-[10px]"}>{alert.severity}</Badge></TableCell>
                <TableCell className="text-center">{alert.affected_users}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{alert.found_at ? formatDistanceToNow(new Date(alert.found_at), { addSuffix: true }) : "-"}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px] capitalize">{STATUS_LABELS[alert.status] || alert.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Globe className="w-4 h-4 text-blue-400" />Monitored Domains</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">{(data.monitored_domains || []).map(d => <Badge key={d} variant="outline" className="text-sm font-mono">{d}</Badge>)}</div>
        </CardContent>
      </Card>
    </div>
  );
}
