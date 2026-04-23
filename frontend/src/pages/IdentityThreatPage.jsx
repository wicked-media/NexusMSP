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

const IDENTITY_CATEGORIES = [
  "identity", "credential", "account_compromise", "impossible_travel", "brute_force",
  "mfa_fatigue", "mfa_bypass", "token_theft", "password_spray", "privilege_escalation",
  "suspicious_login", "session_hijack", "azure_identity", "entra_id", "o365_identity",
];

function _isHuntressIdentity(inc) {
  const blobs = [
    inc.category, inc.incident_type, inc.type, inc.title, inc.summary, inc.description,
  ].map((v) => (v || "").toString().toLowerCase()).join(" ");
  return IDENTITY_CATEGORIES.some((c) => blobs.includes(c));
}

function _normaliseHuntressIdentity(inc) {
  // Map Huntress fields into the existing identity-threat row shape
  const sev = (inc.severity || "low").toLowerCase();
  const blob = [inc.category, inc.incident_type, inc.summary, inc.title].map((v) => (v || "").toLowerCase()).join(" ");
  let type = "suspicious_login";
  if (blob.includes("impossible")) type = "impossible_travel";
  else if (blob.includes("brute")) type = "brute_force";
  else if (blob.includes("mfa fatigue") || blob.includes("mfa_fatigue")) type = "mfa_fatigue";
  else if (blob.includes("token")) type = "token_theft";
  else if (blob.includes("privilege") || blob.includes("escalation")) type = "privilege_escalation";
  else if (blob.includes("spray")) type = "password_spray";
  return {
    id: `hunt-${inc.id}`,
    type,
    user: inc.user_principal_name || inc.user || inc.affected_user || inc.hostname || "—",
    details: inc.summary || inc.title || "Huntress identity incident",
    source_ip: inc.source_ip || inc.ip || "—",
    location: inc.source_location || inc.location || "—",
    mfa_status: inc.mfa_status || (blob.includes("bypass") ? "bypassed" : blob.includes("challenged") ? "challenged" : "not_configured"),
    severity: ["critical", "high", "medium", "low"].includes(sev) ? sev : "low",
    status: (inc.status || "new").toLowerCase(),
    detected_at: inc.detected_at || inc.created_at,
    _source: "huntress",
    _raw_id: inc.id,
  };
}

export default function IdentityThreatPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("all");
  const [huntressActive, setHuntressActive] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [socRes, huntRes, huntStatusRes] = await Promise.all([
        axios.get(`${API}/soc/identity-threats`, { headers }),
        axios.get(`${API}/huntress/incident-reports?limit=500`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/huntress/status`, { headers }).catch(() => ({ data: { configured: false } })),
      ]);
      let payload = socRes.data;
      if (huntStatusRes.data?.configured && Array.isArray(huntRes.data) && huntRes.data.length > 0) {
        const huntIdentity = huntRes.data.filter(_isHuntressIdentity).map(_normaliseHuntressIdentity);
        if (huntIdentity.length > 0) {
          const merged = [...huntIdentity, ...(payload?.threats || [])];
          const s = payload?.summary || { total: 0, critical: 0, mfa_gaps: 0, compromised_accounts: 0 };
          payload = {
            ...payload,
            threats: merged,
            summary: {
              total: merged.length,
              critical: merged.filter((t) => t.severity === "critical").length,
              mfa_gaps: merged.filter((t) => ["bypassed", "not_configured"].includes(t.mfa_status)).length,
              compromised_accounts: merged.filter((t) => t.status === "compromised" || t.status === "compromise").length || s.compromised_accounts,
            },
            mock_data: false,
          };
          setHuntressActive(true);
        }
      }
      setData(payload);
    }
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
          {huntressActive && <Badge variant="outline" className="text-orange-400 border-orange-500/30">Huntress Live</Badge>}
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
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="text-[10px]">{TYPE_LABELS[t.type] || t.type}</Badge>
                    {t._source === "huntress" && <Badge className="text-[9px] bg-orange-500/20 text-orange-400 border-orange-500/30">HNT</Badge>}
                  </div>
                </TableCell>
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
