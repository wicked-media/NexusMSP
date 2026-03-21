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
import { Loader2, Users, Shield, ShieldAlert, AlertTriangle, Lock, Unlock, Globe, Eye, Search, RefreshCw, Key, MapPin } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const SEV = { critical: "bg-red-500/20 text-red-400", high: "bg-orange-500/20 text-orange-400", medium: "bg-amber-500/20 text-amber-400", low: "bg-blue-500/20 text-blue-400" };
const TYPE_LABELS = { impossible_travel: "Impossible Travel", brute_force: "Brute Force", mfa_fatigue: "MFA Fatigue", token_theft: "Token Theft", privilege_escalation: "Privilege Escalation", suspicious_login: "Suspicious Login", password_spray: "Password Spray" };
const MFA_COLORS = { bypassed: "text-red-400", challenged: "text-amber-400", not_configured: "text-red-400", passed: "text-green-400" };

export default function IdentityThreatPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("all");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { const res = await axios.get(`${API}/soc/identity-threats`, { headers }); setData(res.data); }
    catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const filtered = (data.threats || [])
    .filter(t => sevFilter === "all" || t.severity === sevFilter)
    .filter(t => !search || t.user?.toLowerCase().includes(search.toLowerCase()) || t.type?.toLowerCase().includes(search.toLowerCase()));
  const s = data.summary || {};

  return (
    <div className="space-y-6" data-testid="identity-threat">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Identity Threat Detection</h1><p className="text-muted-foreground">{s.total} identity threats detected</p></div>
        <div className="flex gap-2">
          {data.mock_data && <Badge variant="outline" className="text-amber-400 border-amber-500/30">Demo Data</Badge>}
          <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Total Threats</p><p className="text-2xl font-bold">{s.total}</p></CardContent></Card>
        <Card className="border-red-500/20"><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Critical</p><p className="text-2xl font-bold text-red-400">{s.critical}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">MFA Gaps</p><p className="text-2xl font-bold text-amber-400">{s.mfa_gaps}</p></CardContent></Card>
        <Card className="border-red-500/20"><CardContent className="pt-3 pb-2"><p className="text-[10px] text-muted-foreground">Compromised Accounts</p><p className="text-2xl font-bold text-red-400">{s.compromised_accounts}</p></CardContent></Card>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search user, type..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <Select value={sevFilter} onValueChange={setSevFilter}><SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Severity</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>User</TableHead><TableHead>Details</TableHead><TableHead>Source IP</TableHead><TableHead>Location</TableHead><TableHead>MFA</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead><TableHead>Detected</TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered.map(t => (
              <TableRow key={t.id} className={t.severity === "critical" ? "bg-red-500/5" : ""} data-testid={`idt-${t.id}`}>
                <TableCell><Badge variant="outline" className="text-[10px]">{TYPE_LABELS[t.type] || t.type}</Badge></TableCell>
                <TableCell className="text-sm font-mono">{t.user}</TableCell>
                <TableCell className="text-xs max-w-xs truncate">{t.details}</TableCell>
                <TableCell className="text-xs font-mono">{t.source_ip}</TableCell>
                <TableCell className="text-xs"><div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{t.location}</div></TableCell>
                <TableCell><Badge variant="outline" className={`text-[10px] ${MFA_COLORS[t.mfa_status]}`}><Key className="w-3 h-3 mr-1" />{t.mfa_status?.replace(/_/g, " ")}</Badge></TableCell>
                <TableCell><Badge className={SEV[t.severity] + " text-[10px]"}>{t.severity}</Badge></TableCell>
                <TableCell><Badge variant="outline" className="text-[10px] capitalize">{t.status?.replace(/_/g, " ")}</Badge></TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{t.detected_at ? formatDistanceToNow(new Date(t.detected_at), { addSuffix: true }) : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
