import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Loader2, Monitor, Shield, ShieldCheck, ShieldAlert, Wifi, WifiOff,
  Lock, Search, RefreshCw, AlertTriangle, Eye, Bug,
  MoreHorizontal, ChevronDown
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

const STATUS_COLORS = {
  online: "text-green-400", offline: "text-red-400", isolated: "text-purple-400", needs_attention: "text-amber-400",
};
const AV_COLORS = { active: "text-green-400", inactive: "text-red-400", not_assessed: "text-muted-foreground" };
const PATCH_COLORS = { up_to_date: "text-green-400", pending: "text-amber-400", critical_missing: "text-red-400", not_assessed: "text-muted-foreground" };
const EVIDENCE_STYLES = {
  agent_verified: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  agent_enrolled: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  inventory_only: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
};
const EVIDENCE_LABELS = { agent_verified: "Agent verified", agent_enrolled: "Awaiting first check", inventory_only: "Inventory only" };
const humanize = (value, fallback = "Not assessed") => value ? String(value).replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()) : fallback;

export function EndpointSecurityPanel({ embedded = false }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [postureFilter, setPostureFilter] = useState("all");
  const [loadError, setLoadError] = useState("");
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchEndpoints = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await axios.get(`${API}/endpoint-security/scores`, { headers });
      setEndpoints(response.data?.scores || []);
    }
    catch (error) {
      setEndpoints([]);
      setLoadError(error.response?.data?.detail || "Endpoint security data could not be loaded. Try again after checking the Nexus Agent connection.");
      toast.error("Failed to load endpoints");
    }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchEndpoints(); }, [fetchEndpoints]);

  const filtered = endpoints
    .filter(e => statusFilter === "all" || e.status === statusFilter)
    .filter(e => postureFilter === "all" || (postureFilter === "agent_verified" && e.evidence_state === "agent_verified") || (postureFilter === "av_issue" && e.assessed && e.av_status !== "active") || (postureFilter === "critical_patch" && e.patch_status === "critical_missing") || (postureFilter === "high_risk" && e.risk_score > 70))
    .filter(e => !search || e.hostname?.toLowerCase().includes(search.toLowerCase()) || e.organization?.toLowerCase().includes(search.toLowerCase()));

  const stats = {
    total: endpoints.length, agent_enrolled: endpoints.filter(e => e.agent_enrolled).length, agent_verified: endpoints.filter(e => e.evidence_state === "agent_verified").length,
    online: endpoints.filter(e => e.agent_enrolled && e.status === "online").length,
    offline: endpoints.filter(e => e.status === "offline").length, isolated: endpoints.filter(e => e.status === "isolated").length,
    av_issues: endpoints.filter(e => e.assessed && e.av_status !== "active").length,
    patch_critical: endpoints.filter(e => e.assessed && e.patch_status === "critical_missing").length,
    high_risk: endpoints.filter(e => e.assessed && e.risk_score > 70).length,
  };

  if (loading && endpoints.length === 0 && !loadError) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  if (loadError) return (
    <div className="space-y-6" data-testid="endpoint-security-error">
      {!embedded && <OperationalPageHeader eyebrow="Nexus Shield | endpoint posture" title="Endpoint protection" description="Evidence-based endpoint posture from Nexus Agent telemetry." icon={Shield} tone="amber" actions={<Button size="sm" onClick={fetchEndpoints}><RefreshCw className="mr-1 h-4 w-4" />Try again</Button>} />}
      <Card className="border-red-500/30 bg-red-500/5"><CardContent className="flex items-center gap-3 py-5 text-sm text-red-200"><AlertTriangle className="h-5 w-5 text-red-400" />{loadError}</CardContent></Card>
    </div>
  );

  return (
    <div className="space-y-6" data-testid="endpoint-security">
      {!embedded && <OperationalPageHeader
        eyebrow="Nexus Shield | endpoint posture"
        title="Endpoint protection"
        description={`Security posture across ${endpoints.length} inventory assets. Nexus Agent evidence is clearly separated from inventory-only records.`}
        icon={Shield}
        tone="amber"
        actions={(
          <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid="endpoint-security-workspace-tools">
                <MoreHorizontal className="w-3.5 h-3.5" />
                Workspace
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => navigate("/shadow-it")}><Eye className="mr-2 h-4 w-4" />Shadow IT</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/vulnerability-scanner")}><Bug className="mr-2 h-4 w-4" />Vulnerability scanner</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/nexus-elevate")}><ShieldCheck className="mr-2 h-4 w-4" />Nexus Elevate</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={fetchEndpoints} disabled={loading}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          </>
        )}
      />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeroTile label="Managed assets" value={stats.total} icon={Monitor} glow="sky" subtitle="Asset inventory coverage" onClick={() => { setStatusFilter("all"); setPostureFilter("all"); }} active={statusFilter === "all" && postureFilter === "all"} testId="endpoint-total" />
        <HeroTile label="Nexus Agent enrolled" value={stats.agent_enrolled} icon={ShieldCheck} glow={stats.agent_enrolled ? "emerald" : "zinc"} subtitle={`${stats.agent_verified} with verified security evidence`} onClick={() => { setStatusFilter("all"); setPostureFilter("agent_verified"); }} active={postureFilter === "agent_verified"} testId="endpoint-agent-coverage" />
        <HeroTile label="Online agents" value={stats.online} icon={Wifi} glow="emerald" subtitle="Reporting live telemetry" onClick={() => { setStatusFilter("online"); setPostureFilter("all"); }} active={statusFilter === "online" && postureFilter === "all"} testId="endpoint-online" />
        <HeroTile label="Offline agents" value={stats.offline} icon={WifiOff} glow={stats.offline > 0 ? "rose" : "zinc"} subtitle="Needs a connectivity check" onClick={() => { setStatusFilter("offline"); setPostureFilter("all"); }} active={statusFilter === "offline" && postureFilter === "all"} testId="endpoint-offline" />
        <HeroTile label="Isolated" value={stats.isolated} icon={Lock} glow={stats.isolated > 0 ? "violet" : "zinc"} subtitle="Network containment active" onClick={() => { setStatusFilter("isolated"); setPostureFilter("all"); }} active={statusFilter === "isolated" && postureFilter === "all"} testId="endpoint-isolated" />
        <HeroTile label="AV issues" value={stats.av_issues} icon={ShieldAlert} glow={stats.av_issues > 0 ? "amber" : "zinc"} subtitle="Protection needs review" onClick={() => { setStatusFilter("all"); setPostureFilter("av_issue"); }} active={postureFilter === "av_issue"} testId="endpoint-av-issues" />
        <HeroTile label="Critical patches" value={stats.patch_critical} icon={AlertTriangle} glow={stats.patch_critical > 0 ? "rose" : "zinc"} subtitle="Security updates missing" onClick={() => { setStatusFilter("all"); setPostureFilter("critical_patch"); }} active={postureFilter === "critical_patch"} testId="endpoint-patch-critical" />
        <HeroTile label="High risk" value={stats.high_risk} icon={Shield} glow={stats.high_risk > 0 ? "rose" : "zinc"} subtitle="Risk score over 70" onClick={() => { setStatusFilter("all"); setPostureFilter("high_risk"); }} active={postureFilter === "high_risk"} testId="endpoint-high-risk" />
      </div>

      {stats.total > stats.agent_verified && (
        <Card className="border-amber-500/25 bg-amber-500/5" data-testid="endpoint-evidence-disclosure">
          <CardContent className="flex items-start gap-3 py-3 text-sm text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span><strong className="font-medium text-foreground">Coverage disclosure:</strong> {stats.total - stats.agent_verified} asset{stats.total - stats.agent_verified === 1 ? " has" : "s have"} not returned a verified Nexus Agent security assessment. These assets remain visible for coverage planning, but do not receive a security score or an “up to date” control status.</span>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search hostname, org..." value={search} onChange={e => setSearch(e.target.value)} data-testid="endpoint-search" /></div>
        <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="online">Online</SelectItem><SelectItem value="offline">Offline</SelectItem><SelectItem value="isolated">Isolated</SelectItem><SelectItem value="needs_attention">Needs Attention</SelectItem><SelectItem value="inventory_only">Inventory only</SelectItem></SelectContent></Select>
        <Select value={postureFilter} onValueChange={setPostureFilter}><SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All posture</SelectItem><SelectItem value="agent_verified">Agent verified</SelectItem><SelectItem value="av_issue">AV issue</SelectItem><SelectItem value="critical_patch">Critical patches</SelectItem><SelectItem value="high_risk">High risk</SelectItem></SelectContent></Select>
        <div className="flex items-center text-xs text-muted-foreground">{filtered.length} shown</div>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Hostname</TableHead><TableHead>OS</TableHead><TableHead>Client</TableHead><TableHead>Evidence</TableHead><TableHead>Status</TableHead><TableHead>Defender</TableHead><TableHead>Firewall</TableHead><TableHead>Encryption</TableHead><TableHead>Patches</TableHead><TableHead>Risk</TableHead><TableHead>Last Seen</TableHead><TableHead></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">No endpoints match</TableCell></TableRow> :
            filtered.map(ep => (
              <TableRow key={ep.id} className={ep.risk_score > 70 ? "bg-red-500/5" : ""} data-testid={`endpoint-${ep.id}`}>
                <TableCell className="font-mono text-sm font-medium">{ep.hostname}</TableCell>
                <TableCell className="text-xs">{ep.os}</TableCell>
                <TableCell className="text-xs">
                  {ep.client_id
                    ? <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate(`/clients?client=${ep.client_id}`)}>{ep.organization}</Button>
                    : ep.organization}
                </TableCell>
                <TableCell><Badge variant="outline" className={`whitespace-nowrap text-[10px] ${EVIDENCE_STYLES[ep.evidence_state] || EVIDENCE_STYLES.inventory_only}`}>{EVIDENCE_LABELS[ep.evidence_state] || EVIDENCE_LABELS.inventory_only}</Badge></TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {ep.status === "online" ? <Wifi className="w-3 h-3 text-green-400" /> : ep.status === "isolated" ? <Lock className="w-3 h-3 text-purple-400" /> : ep.status === "inventory_only" ? <Monitor className="w-3 h-3 text-muted-foreground" /> : <WifiOff className="w-3 h-3 text-red-400" />}
                    <span className={`text-xs ${STATUS_COLORS[ep.status] || "text-muted-foreground"}`}>{humanize(ep.status, "Unknown")}</span>
                  </div>
                </TableCell>
                <TableCell><Badge variant="outline" className={`text-[10px] ${AV_COLORS[ep.av_status]}`}>{ep.av_status === "active" ? <ShieldCheck className="w-3 h-3 mr-1" /> : <ShieldAlert className="w-3 h-3 mr-1" />}{humanize(ep.av_status)}</Badge></TableCell>
                <TableCell><span className={`text-xs ${ep.firewall === "enabled" ? "text-green-400" : ep.firewall === "not_assessed" ? "text-muted-foreground" : "text-red-400"}`}>{humanize(ep.firewall)}</span></TableCell>
                <TableCell><span className={`text-xs ${ep.encryption === "encrypted" ? "text-green-400" : ep.encryption === "not_assessed" ? "text-muted-foreground" : "text-red-400"}`}>{humanize(ep.encryption)}</span></TableCell>
                <TableCell><Badge variant="outline" className={`text-[10px] ${PATCH_COLORS[ep.patch_status]}`}>{humanize(ep.patch_status)}</Badge></TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <div className={`w-8 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${ep.risk_score == null ? "bg-muted text-muted-foreground" : ep.risk_score > 70 ? "bg-red-500/20 text-red-400" : ep.risk_score > 40 ? "bg-amber-500/20 text-amber-400" : "bg-green-500/20 text-green-400"}`}>{ep.risk_score ?? "-"}</div>
                  </div>
                </TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{ep.last_seen ? formatDistanceToNow(new Date(ep.last_seen), { addSuffix: true }) : "-"}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" title="Open managed asset" onClick={() => navigate(`/devices/${ep.device_id || ep.id}`)}><Eye className="w-3 h-3 mr-1" />Open asset</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

export default function EndpointSecurityPage() {
  return <EndpointSecurityPanel />;
}
