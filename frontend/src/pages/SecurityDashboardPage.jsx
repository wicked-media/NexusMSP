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
  Shield, ShieldAlert, ShieldCheck, Wifi, WifiOff, Bug, Skull, Radar,
  AlertTriangle, Activity, RefreshCw, Loader2, ExternalLink, ChevronRight,
  Users, Eye, Zap, KeyRound, Flame, Monitor, Link2, CheckCircle, Lock, Unlock,
  MessageSquare, UserPlus, MoreHorizontal,
} from "lucide-react";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

const SEV_BADGE = {
  critical: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-sky-500/20 text-sky-400 border-sky-500/30",
};

const QUICK_LINKS = [
  { to: "/endpoint-security", icon: Monitor, label: "Endpoint Scores" },
  { to: "/shadow-it", icon: Eye, label: "Shadow IT" },
  { to: "/vulnerability-scanner", icon: Bug, label: "Vuln Scanner" },
  { to: "/dark-web-monitor", icon: Skull, label: "Dark Web" },
  { to: "/phishing-sim", icon: Radar, label: "Phishing Sim" },
  { to: "/identity-threats", icon: Users, label: "Identity" },
  { to: "/ransomware-canary", icon: Flame, label: "Ransomware" },
  { to: "/mfa-management", icon: KeyRound, label: "MFA" },
];

export default function SecurityDashboardPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const navigate = useNavigate();

  const [hunt, setHunt] = useState(null);
  const [soc, setSoc] = useState(null);
  const [loading, setLoading] = useState(true);

  // Incident response state
  const [actionDialog, setActionDialog] = useState(null); // { incident, action }
  const [actionNote, setActionNote] = useState("");
  const [actionAssignee, setActionAssignee] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const runIncidentAction = async () => {
    if (!actionDialog) return;
    setActionBusy(true);
    try {
      const { incident, action } = actionDialog;
      const body = { action, note: actionNote };
      if (action === "assign") body.assignee = actionAssignee;
      const res = await axios.post(`${API}/huntress/incident-reports/${incident.id}/action`, body, { headers });
      if (res.data?.success) {
        toast.success(`Incident ${action} — Huntress accepted`);
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
      const [huntRes, socRes] = await Promise.all([
        axios.get(`${API}/huntress/summary`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/soc/dashboard`, { headers }).catch(() => ({ data: null })),
      ]);
      setHunt(huntRes.data);
      setSoc(socRes.data);
    } catch {
      toast.error("Failed to load security data");
    } finally { setLoading(false); }
  }, [token]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  if (loading && !hunt && !soc) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-96 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading Security Operations Center…
        </div>
      </PageShell>
    );
  }

  const configured = !!hunt?.configured;
  const s = hunt?.stats || {};
  const socH = soc?.huntress || {};
  const vulns = soc?.vulnerability_summary || {};
  const darkWeb = (soc?.dark_web_alerts || []).length;
  const identity = soc?.identity_threats || 0;

  // Threat level driven by LIVE Huntress data when configured, else fall back to SOC mock
  const critIncidents = configured ? (s.incidents_critical || 0) : (socH.critical_incidents || 0);
  const openIncidents = configured ? (s.incidents_open || 0) : (socH.open_incidents || 0);
  const threatLevel = critIncidents > 0 ? "CRITICAL" : openIncidents > 3 ? "HIGH" : openIncidents > 0 ? "MEDIUM" : "LOW";
  const levelTone = {
    CRITICAL: { text: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/30", pulse: "animate-pulse" },
    HIGH: { text: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30", pulse: "" },
    MEDIUM: { text: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", pulse: "" },
    LOW: { text: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", pulse: "" },
  }[threatLevel];

  const agentHealthPct = (s.agents_total || 0) > 0
    ? Math.round(((s.agents_online || 0) / s.agents_total) * 100)
    : (socH.health_pct || 0);

  return (
    <PageShell data-testid="security-dashboard">
      {/* Top metric strip — all Huntress-driven when configured */}
      <MetricStrip columns={6}>
        <MetricTile label="Agents" value={configured ? `${s.agents_online || 0}/${s.agents_total || 0}` : (socH.total_agents || 0)} accent="sky" icon={<Monitor className="w-2.5 h-2.5 text-sky-400" />} testid="sec-metric-agents" />
        <MetricTile label="Offline" value={configured ? (s.agents_offline || 0) : (socH.offline || 0)} accent="rose" icon={<WifiOff className="w-2.5 h-2.5 text-rose-400" />} testid="sec-metric-offline" />
        <MetricTile label="Critical" value={critIncidents} accent="rose" icon={<ShieldAlert className="w-2.5 h-2.5 text-rose-400" />} testid="sec-metric-critical" />
        <MetricTile label="Open" value={openIncidents} accent="amber" icon={<AlertTriangle className="w-2.5 h-2.5 text-amber-400" />} testid="sec-metric-open" />
        <MetricTile label="Signals" value={configured ? (s.signals_count || 0) : "—"} accent="violet" icon={<Zap className="w-2.5 h-2.5 text-violet-400" />} testid="sec-metric-signals" />
        <MetricTile label="Orgs" value={configured ? (s.organizations_count || 0) : "—"} accent="indigo" icon={<Shield className="w-2.5 h-2.5 text-indigo-400" />} testid="sec-metric-orgs" />
      </MetricStrip>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Shield className="w-6 h-6 text-orange-400" />SOC — Huntress Command Center
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Unified threat monitoring & response ·
              {configured ? (
                <span className="text-emerald-400"> Huntress live {hunt?.last_synced_at ? `(synced ${new Date(hunt.last_synced_at).toLocaleTimeString()})` : ""}</span>
              ) : (
                <span className="text-orange-400"> Huntress not configured — showing demo data</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!configured && (
              <Button variant="outline" size="sm" asChild data-testid="sec-configure-huntress">
                <Link to="/settings?tab=integrations&anchor=huntress-settings-card"><ExternalLink className="w-3 h-3 mr-1" />Configure Huntress</Link>
              </Button>
            )}
            <Button size="sm" onClick={load} disabled={loading} data-testid="sec-refresh-btn">
              {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Refresh
            </Button>
          </div>
        </div>

        {/* Threat Level Banner */}
        <Card className={`${levelTone.bg} overflow-hidden`} data-testid="threat-level-banner">
          <CardContent className="py-4 px-5 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center ${levelTone.bg} ${levelTone.pulse}`}>
                <ShieldAlert className={`w-7 h-7 ${levelTone.text}`} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Current Threat Level</p>
                <p className={`text-2xl font-bold ${levelTone.text}`}>{threatLevel}</p>
              </div>
            </div>
            <div className="flex gap-6 text-center">
              <div><p className="text-2xl font-bold text-rose-400">{critIncidents}</p><p className="text-[10px] text-muted-foreground">Critical</p></div>
              <div><p className="text-2xl font-bold text-amber-400">{openIncidents}</p><p className="text-[10px] text-muted-foreground">Open</p></div>
              <div><p className="text-2xl font-bold">{configured ? (s.incidents_total || 0) : (socH.avg_response_time_min ? `${socH.avg_response_time_min}m` : 0)}</p><p className="text-[10px] text-muted-foreground">{configured ? "Total" : "Avg MTTR"}</p></div>
              <div><p className="text-2xl font-bold text-emerald-400">{configured ? (s.incidents_resolved || 0) : (socH.threats_blocked_30d || 0)}</p><p className="text-[10px] text-muted-foreground">{configured ? "Resolved" : "Blocked 30d"}</p></div>
            </div>
          </CardContent>
        </Card>

        {/* Endpoint Health */}
        <Card>
          <CardContent className="py-3 px-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Endpoint Health</span>
              <span className="text-xs font-mono">{agentHealthPct}% ·
                {configured ? <span className="text-muted-foreground ml-1">{s.agents_online || 0} online / {s.agents_offline || 0} offline</span> : null}
              </span>
            </div>
            <Progress value={agentHealthPct} className="h-2" />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Recent Huntress Incidents */}
          <Card className="lg:col-span-8" data-testid="recent-incidents">
            <CardContent className="p-0">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Activity className="w-4 h-4 text-rose-400" />
                  {configured ? "Huntress Incident Reports" : "Active Incidents (demo)"}
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
                                  <DropdownMenuItem onClick={async () => {
                                    if (!i.hostname) { toast.error("No agent linked"); return; }
                                    const res = await axios.post(`${API}/huntress/agents/${i.hostname}/isolate`, {}, { headers }).catch((err) => ({ data: { success: false, message: err.message } }));
                                    if (res.data?.success) toast.success("Isolation requested");
                                    else toast.error(`Huntress rejected: ${res.data?.message || "not supported"}`, { duration: 6000 });
                                  }} data-testid={`sec-incident-isolate-${i.id}`}>
                                    <Lock className="w-3 h-3 mr-2 text-rose-400" />Isolate agent
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={async () => {
                                    if (!i.hostname) { toast.error("No agent linked"); return; }
                                    const res = await axios.post(`${API}/huntress/agents/${i.hostname}/release`, {}, { headers }).catch((err) => ({ data: { success: false, message: err.message } }));
                                    if (res.data?.success) toast.success("Agent released");
                                    else toast.error(`Huntress rejected: ${res.data?.message || "not supported"}`, { duration: 6000 });
                                  }}>
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
                            <TableCell className="text-[10px] font-mono text-muted-foreground">—</TableCell>
                          </TableRow>
                        ))
                    }
                    {configured && (hunt.recent_incidents || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground text-xs">
                          No recent incidents — all quiet from Huntress
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
                <div className="flex gap-3 justify-around">
                  {Object.entries(vulns).filter(([k]) => k !== "last_scan").map(([sev, cnt]) => (
                    <div key={sev} className="text-center">
                      <p className={`text-lg font-bold ${sev === "critical" ? "text-rose-400" : sev === "high" ? "text-orange-400" : sev === "medium" ? "text-amber-400" : "text-sky-400"}`}>{cnt}</p>
                      <p className="text-[10px] text-muted-foreground capitalize">{sev}</p>
                    </div>
                  ))}
                  {Object.keys(vulns).length === 0 && <div className="text-xs text-muted-foreground">No scan data</div>}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="extra-threats">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs"><Skull className="w-3.5 h-3.5 text-purple-400" />Dark Web findings</div>
                  <Link to="/dark-web-monitor" className="text-xs font-mono text-purple-400 hover:underline">{darkWeb} →</Link>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs"><Users className="w-3.5 h-3.5 text-cyan-400" />Identity threats</div>
                  <Link to="/identity-threats" className="text-xs font-mono text-cyan-400 hover:underline">{identity} →</Link>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />Compliance score</div>
                  <span className="text-xs font-mono text-emerald-400">{soc?.compliance_score || 0}%</span>
                </div>
              </CardContent>
            </Card>
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
      </div>

      {/* Incident response dialog */}
      <Dialog open={!!actionDialog} onOpenChange={(v) => { if (!v) { setActionDialog(null); setActionNote(""); setActionAssignee(""); } }}>
        <DialogContent className="max-w-md" data-testid="sec-incident-action-dialog">
          <DialogHeader>
            <DialogTitle className="capitalize flex items-center gap-2">
              {actionDialog?.action === "isolate" && <Lock className="w-4 h-4 text-rose-400" />}
              {actionDialog?.action === "close" && <CheckCircle className="w-4 h-4 text-emerald-400" />}
              {actionDialog?.action === "comment" && <MessageSquare className="w-4 h-4 text-violet-400" />}
              {actionDialog?.action === "assign" && <UserPlus className="w-4 h-4 text-indigo-400" />}
              {actionDialog?.action === "acknowledge" && <CheckCircle className="w-4 h-4 text-sky-400" />}
              {actionDialog?.action} incident
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
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Note (optional)</div>
                <Textarea rows={3} placeholder="Context for the response log…" value={actionNote} onChange={(e) => setActionNote(e.target.value)} data-testid="sec-action-note" />
              </div>
              <div className="text-[10px] text-muted-foreground border-t border-border pt-2">
                ⚠ Huntress response APIs are in public beta. If your account plan doesn't expose this action, the attempt is logged locally and a "not supported" toast is shown — no data is lost.
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
    </PageShell>
  );
}
