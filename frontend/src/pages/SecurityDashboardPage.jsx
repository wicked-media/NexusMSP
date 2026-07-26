import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useNavigate, Link } from "react-router-dom";
import {
  Shield, ShieldAlert, ShieldCheck, WifiOff, Bug,
  AlertTriangle, Activity, RefreshCw, Loader2, ExternalLink, ChevronRight,
  Users, Eye, Zap, Flame, Monitor, Link2, CheckCircle, Lock, Unlock,
  MessageSquare, UserPlus, MoreHorizontal, ChevronDown, History, GitBranch,
} from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ResponseTimeline } from "@/components/security/ResponseTimeline";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

const SEV_BADGE = {
  critical: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-sky-500/20 text-sky-400 border-sky-500/30",
};

const QUICK_LINKS = [
  { to: "/nexus-shield?tab=endpoints", icon: Monitor, label: "Endpoint posture" },
  { to: "/shadow-it", icon: Eye, label: "Shadow IT" },
  { to: "/vulnerability-scanner", icon: Bug, label: "Vuln Scanner" },
  { to: "/identity-threats", icon: Users, label: "Identity" },
  { to: "/nexus-shield?tab=canary", icon: Flame, label: "Nexus Canary" },
];

const VULNERABILITY_SEVERITIES = [
  { key: "critical", label: "Critical", tone: "text-rose-400" },
  { key: "high", label: "High", tone: "text-orange-400" },
  { key: "medium", label: "Medium", tone: "text-amber-400" },
  { key: "low", label: "Low", tone: "text-sky-400" },
];

export default function SecurityDashboardPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const navigate = useNavigate();

  const [hunt, setHunt] = useState(null);
  const [soc, setSoc] = useState(null);
  const [endpointSecurity, setEndpointSecurity] = useState(null);
  const [vulnerabilityData, setVulnerabilityData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Incident response state
  const [actionDialog, setActionDialog] = useState(null); // { incident, action }
  const [actionNote, setActionNote] = useState("");
  const [actionAssignee, setActionAssignee] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const runIncidentAction = async () => {
    if (!actionDialog) return;
    const { incident, action } = actionDialog;
    const noteRequired = ["acknowledge", "comment", "close", "isolate", "release"].includes(action);
    if (noteRequired && actionNote.trim().length < 8) {
      toast.error("Record an audit note of at least 8 characters before continuing.");
      return;
    }
    if (action === "assign" && !actionAssignee.trim()) {
      toast.error("Choose who owns this incident before continuing.");
      return;
    }
    setActionBusy(true);
    try {
      const isAgentAction = action === "isolate" || action === "release";
      if (isAgentAction && !incident.agent_id) {
        toast.error("No Huntress agent is linked to this incident, so no endpoint action was sent.");
        return;
      }
      const body = { action, note: actionNote };
      if (action === "assign") body.assignee = actionAssignee;
      const res = isAgentAction
        ? await axios.post(`${API}/huntress/agents/${incident.agent_id}/${action}`, { note: actionNote }, { headers })
        : await axios.post(`${API}/huntress/incident-reports/${incident.id}/action`, body, { headers });
      if (res.data?.success) {
        toast.success(isAgentAction ? `Agent ${action} request accepted by Huntress` : `Incident ${action} accepted by Huntress`);
      } else {
        toast.error(`Huntress rejected: ${res.data?.message || "action not supported by your plan"}`, { duration: 6000 });
      }
      setActionDialog(null); setActionNote(""); setActionAssignee("");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally { setActionBusy(false); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [huntRes, socRes, endpointRes, vulnerabilityRes] = await Promise.all([
        axios.get(`${API}/huntress/summary`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/soc/dashboard`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/endpoint-security/scores`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/vulnerability-scanner/overview`, { headers }).catch(() => ({ data: null })),
      ]);
      setHunt(huntRes.data);
      setSoc(socRes.data);
      setEndpointSecurity(endpointRes.data);
      setVulnerabilityData(vulnerabilityRes.data);
    } catch {
      toast.error("Failed to load security data");
    } finally { setLoading(false); }
  }, [token]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  if (loading && !hunt && !soc) {
    return (
      <div className="flex h-96 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" />Loading Security Operations Center...
      </div>
    );
  }

  const configured = !!hunt?.configured;
  const s = hunt?.stats || {};
  const socH = soc?.huntress || {};
  const vulns = vulnerabilityData?.summary || {};
  const endpointScores = endpointSecurity?.scores || [];
  const endpointSummary = endpointSecurity?.summary || {};
  const enrolledAgents = endpointSummary.agent_enrolled || endpointScores.filter((endpoint) => endpoint.agent_enrolled).length;
  const verifiedAgentEvidence = endpointSummary.assessed || endpointScores.filter((endpoint) => endpoint.evidence_state === "agent_verified").length;
  const liveOnline = endpointScores.filter((endpoint) => endpoint.status === "online").length;
  const liveOffline = endpointScores.filter((endpoint) => endpoint.status === "offline").length;
  const identity = soc?.identity_threats;
  const identitySourceConfigured = soc?.identity_source_configured === true;
  const hasSocEvidence = soc !== null;
  const hasVulnerabilityEvidence = vulnerabilityData !== null;

  // Threat level driven by LIVE Huntress data when configured, else fall back to SOC mock
  const critIncidents = configured ? (s.incidents_critical || 0) : (socH.critical_incidents || 0);
  const openIncidents = configured ? (s.incidents_open || 0) : (socH.open_incidents || 0);
  const threatLevel = critIncidents > 0
    ? "CRITICAL"
    : openIncidents > 3
      ? "HIGH"
      : openIncidents > 0
        ? "MEDIUM"
        : configured
          ? "LOW"
          : hasSocEvidence
            ? "LIMITED"
            : "NOT ASSESSED";
  const levelTone = {
    CRITICAL: { text: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/30", pulse: "animate-pulse" },
    HIGH: { text: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30", pulse: "" },
    MEDIUM: { text: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", pulse: "" },
    LOW: { text: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", pulse: "" },
    LIMITED: { text: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", pulse: "" },
    "NOT ASSESSED": { text: "text-muted-foreground", bg: "bg-muted/40 border-border", pulse: "" },
  }[threatLevel];

  const agentHealthPct = configured && (s.agents_total || 0) > 0
    ? Math.round(((s.agents_online || 0) / s.agents_total) * 100)
    : enrolledAgents > 0 ? Math.round((liveOnline / enrolledAgents) * 100) : null;
  const protectedEndpointValue = configured
    ? `${s.agents_online || 0}/${s.agents_total || 0}`
    : enrolledAgents > 0 ? `${verifiedAgentEvidence}/${enrolledAgents}` : "—";
  const offlineEndpointValue = configured
    ? (s.agents_offline || 0)
    : enrolledAgents > 0 ? liveOffline : "—";
  const vulnerabilityValue = hasVulnerabilityEvidence ? (vulns.total || 0) : "—";
  const assessmentValue = configured
    ? (s.organizations_count || 0)
    : enrolledAgents > 0 ? `${verifiedAgentEvidence}/${enrolledAgents}` : "—";
  const unclassifiedVulnerabilities = Number(vulns.unclassified || 0);
  const affectedVulnerabilityHosts = Number(vulns.total_hosts_affected || 0);
  const vulnerabilityCoverage = `${Number(vulns.agent_coverage || 0)}/${Number(vulns.managed_endpoints || 0)}`;

  return (
    <div className="space-y-6" data-testid="security-dashboard">
      <OperationalPageHeader
        eyebrow="Security workspace · verified telemetry and response"
        title="Security operations center"
        description={configured
          ? `Unified threat monitoring and response. Huntress last synced ${hunt?.last_synced_at ? new Date(hunt.last_synced_at).toLocaleTimeString() : "recently"}.`
          : "Nexus Agent posture and recorded security alerts are shown below. Connect Huntress to add live MDR endpoint and incident telemetry."}
        icon={Shield}
        tone="amber"
        actions={(
          <>
            {!configured && (
              <Button variant="outline" size="sm" asChild data-testid="sec-configure-huntress">
                <Link to="/settings?tab=integrations&anchor=huntress-settings-card"><ExternalLink className="w-3 h-3 mr-1" />Configure Huntress</Link>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5" data-testid="sec-workspace-tools">
                  <MoreHorizontal className="w-3.5 h-3.5" />
                  Workspace
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild><Link to="/soc-feed"><Activity className="mr-2 h-4 w-4" />SOC feed</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/security-graph"><GitBranch className="mr-2 h-4 w-4" />Security graph</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/soc-realtime"><Zap className="mr-2 h-4 w-4" />Smart automation</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/threat-timeline"><History className="mr-2 h-4 w-4" />Threat timeline</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/identity-threats"><Users className="mr-2 h-4 w-4" />Identity threats</Link></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={load} disabled={loading} data-testid="sec-refresh-btn">
              {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Refresh
            </Button>
          </>
        )}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        <HeroTile label={configured ? "Protected endpoints" : "Agent assessments"} value={protectedEndpointValue} animated={false} icon={Monitor} glow="sky" subtitle={configured ? "Live Huntress agents" : "Verified / enrolled Nexus Agents"} testId="sec-metric-agents" />
        <HeroTile label="Offline endpoints" value={offlineEndpointValue} icon={WifiOff} glow={typeof offlineEndpointValue === "number" && offlineEndpointValue > 0 ? "rose" : "zinc"} subtitle={enrolledAgents > 0 || configured ? "Needs a connectivity check" : "No endpoint evidence yet"} testId="sec-metric-offline" />
        <HeroTile label="Critical incidents" value={critIncidents} icon={ShieldAlert} glow={critIncidents > 0 ? "rose" : "zinc"} subtitle="Immediate response required" testId="sec-metric-critical" />
        <HeroTile label="Open incidents" value={openIncidents} icon={AlertTriangle} glow={openIncidents > 0 ? "amber" : "zinc"} subtitle="Awaiting resolution" testId="sec-metric-open" />
        <HeroTile label="Patch exposure" value={vulnerabilityValue} icon={Zap} glow={typeof vulnerabilityValue === "number" && vulnerabilityValue > 0 ? "violet" : "zinc"} subtitle={hasVulnerabilityEvidence ? "Verified vulnerability findings" : "Not assessed"} testId="sec-metric-signals" />
        <HeroTile label={configured ? "Assessed organisations" : "Verified posture"} value={assessmentValue} animated={false} icon={Shield} glow="indigo" subtitle={configured ? "Huntress organisations" : "Verified / enrolled endpoints"} testId="sec-metric-orgs" />
      </div>

        {/* Threat Level Banner */}
        <Card className={`${levelTone.bg} overflow-hidden`} data-testid="threat-level-banner">
          <CardContent className="py-4 px-5 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center ${levelTone.bg} ${levelTone.pulse}`}>
                <ShieldAlert className={`w-7 h-7 ${levelTone.text}`} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{configured ? "Current MDR threat level" : "Nexus security signal"}</p>
                <p className={`text-2xl font-bold ${levelTone.text}`}>{threatLevel}</p>
              </div>
            </div>
            <div className="flex gap-6 text-center">
              <div><p className="text-2xl font-bold text-rose-400">{critIncidents}</p><p className="text-[10px] text-muted-foreground">Critical</p></div>
              <div><p className="text-2xl font-bold text-amber-400">{openIncidents}</p><p className="text-[10px] text-muted-foreground">Open</p></div>
              <div><p className="text-2xl font-bold">{configured ? (s.incidents_total || 0) : (hasSocEvidence ? (socH.total_incidents || 0) : "—")}</p><p className="text-[10px] text-muted-foreground">{configured ? "Total" : "Recorded"}</p></div>
              <div><p className="text-2xl font-bold text-emerald-400">{configured ? (s.incidents_resolved || 0) : (hasSocEvidence ? (socH.resolved_last_24h || 0) : "—")}</p><p className="text-[10px] text-muted-foreground">{configured ? "Resolved" : "Resolved 24h"}</p></div>
            </div>
          </CardContent>
        </Card>

        {/* Endpoint Health */}
        <Card>
          <CardContent className="py-3 px-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Endpoint Health</span>
              <span className="text-xs font-mono">{agentHealthPct === null ? "Not assessed" : `${agentHealthPct}%`} |
                <span className="text-muted-foreground ml-1">{configured ? `${s.agents_online || 0} online / ${s.agents_offline || 0} offline` : enrolledAgents > 0 ? `${liveOnline} online / ${liveOffline} offline` : "No enrolled Nexus Agents"}</span>
              </span>
            </div>
            <Progress value={agentHealthPct ?? 0} className="h-2" />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Recent Huntress Incidents */}
          <Card className="lg:col-span-8" data-testid="recent-incidents">
            <CardContent className="p-0">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Activity className="w-4 h-4 text-rose-400" />
                  {configured ? "Huntress Incident Reports" : "Persisted Security Alerts"}
                </div>
                {configured && (
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate("/soc-feed")} data-testid="sec-view-feed">
                    View SOC Feed <ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                )}
              </div>
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] uppercase tracking-widest">Incident</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-widest">Host / Org</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-widest">Severity</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-widest">Status</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-widest">Detected</TableHead>
                      {configured && <TableHead className="text-[10px] uppercase tracking-widest">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {configured
                      ? (hunt.recent_incidents || []).map((i) => (
                          <TableRow key={i.id} data-testid={`sec-incident-${i.id}`}>
                            <TableCell className="text-sm max-w-xs truncate">{i.summary || "(no summary)"}</TableCell>
                            <TableCell className="text-xs font-mono">
                              <div className="truncate">{i.hostname || "—"}</div>
                              <div className="text-[10px] text-muted-foreground truncate">{i.organization || "—"}</div>
                            </TableCell>
                            <TableCell><Badge className={`${SEV_BADGE[(i.severity || "").toLowerCase()] || SEV_BADGE.low} text-[10px]`}>{i.severity}</Badge></TableCell>
                            <TableCell><Badge variant="outline" className="text-[10px] capitalize">{i.status}</Badge></TableCell>
                            <TableCell className="text-[10px] font-mono text-muted-foreground">{i.detected_at ? new Date(i.detected_at).toLocaleDateString() : "—"}</TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" data-testid={`sec-incident-actions-${i.id}`}>
                                    <MoreHorizontal className="w-3 h-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => { setActionDialog({ incident: i, action: "acknowledge" }); }} data-testid={`sec-incident-ack-${i.id}`}>
                                    <CheckCircle className="w-3 h-3 mr-2 text-sky-400" />Acknowledge
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setActionDialog({ incident: i, action: "comment" }); }}>
                                    <MessageSquare className="w-3 h-3 mr-2 text-violet-400" />Add comment
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setActionDialog({ incident: i, action: "assign" }); }}>
                                    <UserPlus className="w-3 h-3 mr-2 text-indigo-400" />Assign
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => { setActionDialog({ incident: i, action: "isolate" }); }} data-testid={`sec-incident-isolate-${i.id}`}>
                                    <Lock className="w-3 h-3 mr-2 text-rose-400" />Isolate agent
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setActionDialog({ incident: i, action: "release" }); }} data-testid={`sec-incident-release-${i.id}`}>
                                    <Unlock className="w-3 h-3 mr-2 text-emerald-400" />Release agent
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => { setActionDialog({ incident: i, action: "close" }); }} data-testid={`sec-incident-close-${i.id}`}>
                                    <CheckCircle className="w-3 h-3 mr-2 text-emerald-400" />Close incident
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))
                      : (soc?.incidents || []).slice(0, 8).map((inc) => (
                          <TableRow key={inc.id} className="cursor-pointer hover:bg-muted/30" onClick={() => navigate("/soc-feed")}>
                            <TableCell className="text-sm max-w-xs truncate">{inc.title}</TableCell>
                            <TableCell className="text-xs font-mono">{inc.hostname}</TableCell>
                            <TableCell><Badge className={`${SEV_BADGE[inc.severity] || SEV_BADGE.low} text-[10px]`}>{inc.severity}</Badge></TableCell>
                            <TableCell><Badge variant="outline" className="text-[10px] capitalize">{inc.status}</Badge></TableCell>
                            <TableCell className="text-[10px] font-mono text-muted-foreground">{inc.created_at || inc.detected_at ? new Date(inc.created_at || inc.detected_at).toLocaleDateString() : "—"}</TableCell>
                          </TableRow>
                        ))
                    }
                    {configured && (hunt.recent_incidents || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-xs">
                          No recent incidents. All quiet from Huntress.
                        </TableCell>
                      </TableRow>
                    )}
                    {!configured && (soc?.incidents || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground text-xs">
                          No persisted security alerts. Connect Huntress to add managed detection and response telemetry.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Side panel: severity mix + per-org top list (when configured) */}
          <div className="lg:col-span-4 space-y-4">
            {configured ? (
              <>
                <Card data-testid="severity-mix">
                  <CardContent className="p-4">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">Severity Mix</div>
                    <div className="space-y-2">
                      {["critical", "high", "medium", "low"].map((k) => {
                        const v = hunt.severity_mix?.[k] || 0;
                        const pct = s.incidents_total ? Math.round((v / s.incidents_total) * 100) : 0;
                        return (
                          <div key={k}>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="capitalize text-muted-foreground">{k}</span>
                              <span className="font-mono">{v}</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className={`h-full ${k === "critical" ? "bg-rose-500" : k === "high" ? "bg-orange-500" : k === "medium" ? "bg-amber-500" : "bg-sky-500"}`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                <Card data-testid="per-org-breakdown">
                  <CardContent className="p-0">
                    <div className="px-4 py-3 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      Top Organizations
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {(hunt.per_org || []).slice(0, 8).map((o) => (
                        <div key={o.id} className="px-4 py-2 border-b border-border last:border-0" data-testid={`per-org-${o.id}`}>
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium truncate">{o.name}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{o.agents_online}/{o.agents_total}</span>
                          </div>
                          <div className="flex gap-1 mt-1">
                            {o.incidents_critical > 0 && <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-[9px]">{o.incidents_critical} CRIT</Badge>}
                            {o.incidents_open > 0 && <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px]">{o.incidents_open} OPEN</Badge>}
                            {o.agents_offline > 0 && <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-[9px]">{o.agents_offline} OFF</Badge>}
                            {o.incidents_critical === 0 && o.incidents_open === 0 && o.agents_offline === 0 && <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px]">healthy</Badge>}
                          </div>
                        </div>
                      ))}
                      {(hunt.per_org || []).length === 0 && (
                        <div className="text-center py-6 text-muted-foreground text-xs">No organization breakdown yet</div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {(hunt.recent_signals || []).length > 0 && (
                  <Card data-testid="recent-signals">
                    <CardContent className="p-0">
                      <div className="px-4 py-3 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                        Recent Signals
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {hunt.recent_signals.map((sig) => (
                          <div key={sig.id} className="px-4 py-2 border-b border-border last:border-0 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate">{sig.summary || "(signal)"}</span>
                              <Badge className={`${SEV_BADGE[(sig.severity || "").toLowerCase()] || SEV_BADGE.low} text-[9px]`}>{sig.severity || "low"}</Badge>
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{sig.kind || "signal"} · {sig.detected_at ? new Date(sig.detected_at).toLocaleString() : ""}</div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              /* Not configured — big CTA */
              <Card className="border-orange-500/30 bg-orange-500/5">
                <CardContent className="p-5 text-center space-y-3">
                  <Shield className="w-10 h-10 text-orange-400 mx-auto" />
                  <div className="text-sm font-semibold">Connect Huntress to light up this cockpit</div>
                  <div className="text-xs text-muted-foreground">
                    Pull live agents, incidents, signals and per-org telemetry from your Huntress account.
                  </div>
                  <Button asChild size="sm" className="w-full" data-testid="sec-configure-huntress-cta">
                    <Link to="/settings?tab=integrations&anchor=huntress-settings-card"><ExternalLink className="w-3 h-3 mr-1" />Configure Huntress</Link>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Non-Huntress secondary telemetry */}
            <Card data-testid="vuln-summary">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1">
                    <Bug className="w-3 h-3" />Vulnerabilities
                  </div>
                  <Button variant="ghost" size="sm" className="text-[10px] h-6" onClick={() => navigate("/vulnerability-scanner")}>Scanner <ChevronRight className="w-3 h-3 ml-0.5" /></Button>
                </div>
                {hasVulnerabilityEvidence ? <>
                  <div className="grid grid-cols-4 gap-2">
                    {VULNERABILITY_SEVERITIES.map(({ key, label, tone }) => (
                      <div key={key} className="rounded-lg border border-white/[0.07] bg-black/[0.12] px-2 py-2 text-center">
                        <p className={`text-lg font-bold ${tone}`}>{Number(vulns[key] || 0)}</p>
                        <p className="text-[10px] text-muted-foreground">{label}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {Number(vulns.total || 0)} verified findings across {affectedVulnerabilityHosts} endpoint{affectedVulnerabilityHosts === 1 ? "" : "s"} · {vulnerabilityCoverage} agents reporting
                    {unclassifiedVulnerabilities > 0 ? ` · ${unclassifiedVulnerabilities} awaiting classification` : ""}
                  </p>
                </> : <div className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">No verified vulnerability evidence has been reported yet.</div>}
              </CardContent>
            </Card>

            <Card data-testid="extra-threats">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs"><Users className="w-3.5 h-3.5 text-cyan-400" />Identity threats</div>
                  <Link to="/identity-threats" className="text-xs font-mono text-cyan-400 hover:underline">{identitySourceConfigured ? (identity ?? 0) : "Set up"} →</Link>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />Compliance score</div>
                  <span className="text-xs font-mono text-emerald-400">{typeof soc?.compliance_score === "number" ? `${soc.compliance_score}%` : "Not assessed"}</span>
                </div>
              </CardContent>
            </Card>

            {/* Response Timeline — shown to everyone; empty state guides them */}
            <ResponseTimeline limit={10} />
          </div>
        </div>

        {/* Quick nav chips to other security surfaces */}
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2 flex items-center gap-1">
              <Link2 className="w-3 h-3" />Jump to
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_LINKS.map((q) => (
                <Button key={q.to} variant="outline" size="sm" asChild className="text-xs" data-testid={`sec-quick-${q.to.slice(1)}`}>
                  <Link to={q.to}><q.icon className="w-3 h-3 mr-1" />{q.label}</Link>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

      {/* Incident response dialog */}
      <Dialog open={!!actionDialog} onOpenChange={(v) => { if (!v) { setActionDialog(null); setActionNote(""); setActionAssignee(""); } }}>
        <DialogContent className="max-w-md" data-testid="sec-incident-action-dialog">
          <DialogHeader>
            <DialogTitle className="capitalize flex items-center gap-2">
              {actionDialog?.action === "isolate" && <Lock className="w-4 h-4 text-rose-400" />}
              {actionDialog?.action === "release" && <Unlock className="w-4 h-4 text-emerald-400" />}
              {actionDialog?.action === "close" && <CheckCircle className="w-4 h-4 text-emerald-400" />}
              {actionDialog?.action === "comment" && <MessageSquare className="w-4 h-4 text-violet-400" />}
              {actionDialog?.action === "assign" && <UserPlus className="w-4 h-4 text-indigo-400" />}
              {actionDialog?.action === "acknowledge" && <CheckCircle className="w-4 h-4 text-sky-400" />}
              {actionDialog?.action} {actionDialog?.action === "isolate" || actionDialog?.action === "release" ? "endpoint" : "incident"}
            </DialogTitle>
          </DialogHeader>
          {actionDialog && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                {actionDialog.incident.summary || "(no summary)"}
              </div>
              {actionDialog.action === "assign" && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Assignee</div>
                  <Input placeholder="name or email" value={actionAssignee} onChange={(e) => setActionAssignee(e.target.value)} data-testid="sec-action-assignee" />
                </div>
              )}
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Response note {["acknowledge", "comment", "close", "isolate", "release"].includes(actionDialog.action) ? "(required)" : "(optional)"}</div>
                <Textarea rows={3} placeholder="Record the decision, evidence, or handover context…" value={actionNote} onChange={(e) => setActionNote(e.target.value)} data-testid="sec-action-note" />
              </div>
              <div className="text-[10px] text-muted-foreground border-t border-border pt-2">
                Huntress response APIs may vary by plan. Each attempted action is retained in the response timeline and the central audit trail; an unsupported action is never shown as completed.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setActionDialog(null)}>Cancel</Button>
            <Button onClick={runIncidentAction} disabled={actionBusy} data-testid="sec-action-confirm">
              {actionBusy ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Sending…</> : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
