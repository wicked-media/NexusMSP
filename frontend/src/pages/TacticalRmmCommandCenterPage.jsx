import { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Server, RefreshCw, Loader2, ExternalLink, Search, Settings,
  Power, RotateCw, MonitorSmartphone, Terminal, ShieldCheck, Activity,
  AlertTriangle, CheckCircle2, Cpu, HardDrive, Wifi, Download, Play,
  Users, FileCode, Eye, Link2, Sparkles,
} from "lucide-react";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";

function timeAgo(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  } catch { return "—"; }
}

const SHELLS = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "bash", label: "Bash" },
  { value: "python", label: "Python" },
];

export default function TacticalRmmCommandCenterPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [summary, setSummary] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("agents");

  const [actionAgent, setActionAgent] = useState(null);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [scriptForm, setScriptForm] = useState({ command: "", shell: "powershell", timeout: 60 });
  const [scriptBusy, setScriptBusy] = useState(false);
  const [scriptResult, setScriptResult] = useState(null);

  const [actionsLog, setActionsLog] = useState([]);
  const [linkedDevices, setLinkedDevices] = useState([]);

  const [autoLinkOpen, setAutoLinkOpen] = useState(false);
  const [autoLinkPreview, setAutoLinkPreview] = useState(null);
  const [autoLinkBusy, setAutoLinkBusy] = useState(false);
  const [autoLinkOverwrite, setAutoLinkOverwrite] = useState(false);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const [sumRes, logRes, linkRes] = await Promise.all([
        axios.get(`${API}/trmm/summary`, { headers }).catch((e) => ({ data: null, _err: e })),
        axios.get(`${API}/trmm/actions/log`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/trmm/linked-devices`, { headers }).catch(() => ({ data: [] })),
      ]);
      if (sumRes.data) {
        setSummary(sumRes.data);
        setAgents(sumRes.data.agents || []);
        if (sumRes.data.error) setError(sumRes.data.error);
      } else if (sumRes._err) {
        setError(sumRes._err.response?.data?.detail || "Failed to reach Tactical RMM");
      }
      setActionsLog(logRes.data || []);
      setLinkedDevices(linkRes.data || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => { load(true); /* eslint-disable-next-line */ }, []);

  const stats = summary?.stats || { agents: 0, online: 0, offline: 0, alerts: 0, patches_pending: 0, needs_reboot: 0, linked_devices: 0 };
  const configured = summary?.configured;

  const filtered = useMemo(() => {
    let arr = agents;
    if (statusFilter !== "all") arr = arr.filter(a => a.status === statusFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      arr = arr.filter(a => [a.hostname, a.client, a.site, a.operating_system, a.public_ip].some(v => (v || "").toLowerCase().includes(q)));
    }
    return arr;
  }, [agents, statusFilter, query]);

  const actOnAgent = async (action, agent) => {
    setActionAgent({ ...agent, _action: action });
    try {
      let res;
      if (action === "reboot") res = await axios.post(`${API}/trmm/agents/${agent.agent_id || agent.id}/reboot`, {}, { headers });
      else if (action === "shutdown") res = await axios.post(`${API}/trmm/agents/${agent.agent_id || agent.id}/shutdown`, {}, { headers });
      else if (action === "run-checks") res = await axios.post(`${API}/trmm/agents/${agent.agent_id || agent.id}/run-checks`, {}, { headers });
      else if (action === "install-patches") res = await axios.post(`${API}/trmm/agents/${agent.agent_id || agent.id}/install-patches`, {}, { headers });
      else if (action === "remote") {
        res = await axios.get(`${API}/trmm/agents/${agent.agent_id || agent.id}/remote-url`, { headers });
        if (res.data?.success && res.data?.urls) {
          const url = res.data.urls.control || res.data.urls.terminal || res.data.urls.file || Object.values(res.data.urls).find(v => typeof v === "string");
          if (url) {
            window.open(url, "_blank", "noopener,noreferrer");
            toast.success("Opening MeshCentral remote session…");
          } else {
            toast.error("No remote URL returned");
          }
        } else {
          toast.error(res.data?.message || "Could not start remote session");
        }
        setActionAgent(null);
        return;
      }
      if (res?.data?.success === false) {
        toast.error(res.data.message || "Action failed");
      } else {
        toast.success(res?.data?.message || "Action queued");
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setActionAgent(null);
      load(false);
    }
  };

  const submitScript = async () => {
    if (!scriptForm.command || !scriptOpen) return;
    setScriptBusy(true);
    setScriptResult(null);
    try {
      const res = await axios.post(`${API}/trmm/agents/${scriptOpen.agent_id || scriptOpen.id}/run-script`, {
        command: scriptForm.command,
        shell: scriptForm.shell,
        timeout: Number(scriptForm.timeout) || 60,
      }, { headers });
      setScriptResult(res.data);
      if (res.data?.success !== false) toast.success("Script dispatched");
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setScriptBusy(false);
      load(false);
    }
  };

  const runAutoLink = async (commit) => {
    setAutoLinkBusy(true);
    try {
      const res = await axios.post(`${API}/trmm/auto-link`, {
        dry_run: !commit,
        overwrite: autoLinkOverwrite,
      }, { headers });
      setAutoLinkPreview(res.data);
      if (commit) {
        const s = res.data.stats;
        toast.success(`Linked ${s.matched} device(s) · ${s.skipped} skipped · ${s.unmatched} unmatched`);
        load(false);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setAutoLinkBusy(false);
    }
  };

  if (!loading && !configured) {
    return (
      <PageShell className="p-6">
        <div className="max-w-2xl mx-auto mt-12">
          <Card>
            <CardContent className="p-8 space-y-4">
              <div className="flex items-center gap-3">
                <Server className="w-7 h-7 text-emerald-500" />
                <div>
                  <h1 className="text-2xl font-light tracking-tight">Tactical RMM · Not Configured</h1>
                  <p className="text-sm text-muted-foreground">Connect your self-hosted Tactical RMM instance to bring agents, patches, scripts, and remote control into NexusOps.</p>
                </div>
              </div>
              <div className="bg-muted/40 border border-border rounded-md p-4 space-y-2 text-sm">
                <p className="font-medium">Setup steps</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>In TRMM: <span className="text-foreground">Settings → Global Settings → API Keys</span> → generate a key tied to an Admin user.</li>
                  <li>Copy your TRMM API base URL (typically <code className="text-foreground">https://api.&lt;your-domain&gt;</code>).</li>
                  <li>Open NexusOps Settings → Integrations → <span className="text-foreground">Tactical RMM</span> and paste both values.</li>
                  <li>Click <span className="text-foreground">Test connection</span>. Once green, refresh this page.</li>
                </ol>
              </div>
              <div className="flex gap-2">
                <Link to="/settings?tab=integrations#trmm-settings-card">
                  <Button variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" data-testid="trmm-cc-open-settings-btn">
                    <Settings className="w-4 h-4 mr-1" /> Open Settings
                  </Button>
                </Link>
                <Button variant="outline" onClick={() => load(true)} data-testid="trmm-cc-retry-btn">
                  <RefreshCw className="w-4 h-4 mr-1" /> Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Server className="w-6 h-6 text-emerald-500" />
          <div>
            <h1 className="text-xl font-light tracking-tight" data-testid="trmm-cc-title">Tactical RMM · Command Center</h1>
            <p className="text-[11px] text-muted-foreground">
              {summary?.last_synced_at ? `Last sync ${timeAgo(summary.last_synced_at)}` : "Live agents from your self-hosted TRMM"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
            onClick={() => { setAutoLinkOpen(true); setAutoLinkPreview(null); runAutoLink(false); }}
            disabled={autoLinkBusy}
            data-testid="trmm-auto-link-btn"
            title="Auto-link TRMM agents to NexusOps devices by hostname / IP"
          >
            {autoLinkBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
            Auto-link agents
          </Button>
          <Button variant="outline" size="sm" onClick={() => load(false)} disabled={refreshing} data-testid="trmm-cc-refresh-btn">
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Refresh
          </Button>
          <Link to="/settings?tab=integrations#trmm-settings-card">
            <Button variant="outline" size="sm" data-testid="trmm-cc-settings-btn">
              <Settings className="w-4 h-4 mr-1" /> Settings
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 border border-rose-500/30 bg-rose-500/5 text-rose-400 rounded-md px-4 py-2 text-sm">
          <AlertTriangle className="w-4 h-4 inline mr-1" /> {error}
        </div>
      )}

      <MetricStrip columns={6}>
        <MetricTile label="Agents" value={loading ? "…" : stats.agents} accent="indigo" icon={<Server className="w-3 h-3" />} testid="trmm-metric-agents" />
        <MetricTile label="Online" value={loading ? "…" : stats.online} accent="emerald" icon={<CheckCircle2 className="w-3 h-3" />} testid="trmm-metric-online" />
        <MetricTile label="Offline" value={loading ? "…" : stats.offline} accent="rose" icon={<AlertTriangle className="w-3 h-3" />} testid="trmm-metric-offline" />
        <MetricTile label="Failing checks" value={loading ? "…" : stats.alerts} accent="amber" icon={<Activity className="w-3 h-3" />} testid="trmm-metric-checks" />
        <MetricTile label="Patches pending" value={loading ? "…" : stats.patches_pending} accent="violet" icon={<Download className="w-3 h-3" />} testid="trmm-metric-patches" />
        <MetricTile label="Needs reboot" value={loading ? "…" : stats.needs_reboot} accent="cyan" icon={<RotateCw className="w-3 h-3" />} testid="trmm-metric-reboot" />
      </MetricStrip>

      <div className="px-6 py-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-muted/40 border border-border">
            <TabsTrigger value="agents" data-testid="trmm-tab-agents">Agents</TabsTrigger>
            <TabsTrigger value="linked" data-testid="trmm-tab-linked">Linked Devices ({linkedDevices.length})</TabsTrigger>
            <TabsTrigger value="audit" data-testid="trmm-tab-audit">Action Log</TabsTrigger>
          </TabsList>

          {/* Agents */}
          <TabsContent value="agents" className="mt-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search hostname, client, OS, IP…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-8 w-72"
                  data-testid="trmm-agents-search"
                />
              </div>
              <div className="flex items-center gap-1">
                {["all", "online", "offline"].map(s => (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    className={statusFilter === s
                      ? (s === "online" ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
                        : s === "offline" ? "text-rose-400 border-rose-500/40 bg-rose-500/10"
                        : "text-indigo-400 border-indigo-500/40 bg-indigo-500/10")
                      : ""}
                    onClick={() => setStatusFilter(s)}
                    data-testid={`trmm-filter-${s}`}
                  >
                    {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                  </Button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground ml-auto">{filtered.length} of {agents.length}</span>
            </div>

            <Card>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading agents…</div>
                ) : filtered.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground text-sm">No agents match.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Hostname</TableHead>
                        <TableHead>Client / Site</TableHead>
                        <TableHead>OS</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Checks</TableHead>
                        <TableHead>Patches</TableHead>
                        <TableHead>Last Seen</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.slice(0, 200).map((a) => (
                        <TableRow key={a.id || a.agent_id} data-testid={`trmm-agent-row-${a.agent_id || a.id}`}>
                          <TableCell>
                            <div className="font-medium">{a.hostname || "—"}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">{a.public_ip || a.local_ips || ""}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{a.client || "—"}</div>
                            <div className="text-[10px] text-muted-foreground">{a.site}</div>
                          </TableCell>
                          <TableCell className="text-xs">{a.operating_system || a.plat || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={a.status === "online" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" : "text-rose-400 border-rose-500/30 bg-rose-500/5"}>
                              {a.status}
                            </Badge>
                            {a.needs_reboot && <Badge variant="outline" className="ml-1 text-amber-400 border-amber-500/30 bg-amber-500/5">reboot</Badge>}
                          </TableCell>
                          <TableCell>
                            {a.checks_failing > 0
                              ? <Badge variant="outline" className="text-rose-400 border-rose-500/30 bg-rose-500/5">{a.checks_failing} failing</Badge>
                              : <span className="text-emerald-500 text-xs">OK</span>}
                          </TableCell>
                          <TableCell className="text-xs">{a.patches_pending || 0}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{timeAgo(a.last_seen)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center gap-1 justify-end flex-wrap">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10"
                                disabled={a.status !== "online" || (actionAgent && actionAgent._action === "remote" && (actionAgent.id === a.id))}
                                onClick={() => actOnAgent("remote", a)}
                                data-testid={`trmm-remote-btn-${a.agent_id || a.id}`}
                                title="Open remote (MeshCentral)"
                              >
                                <MonitorSmartphone className="w-3.5 h-3.5 mr-1" /> Remote
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
                                disabled={a.status !== "online"}
                                onClick={() => { setScriptOpen(a); setScriptResult(null); setScriptForm({ command: "", shell: a.plat === "linux" ? "bash" : "powershell", timeout: 60 }); }}
                                data-testid={`trmm-script-btn-${a.agent_id || a.id}`}
                              >
                                <Terminal className="w-3.5 h-3.5 mr-1" /> Script
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/10"
                                disabled={a.status !== "online"}
                                onClick={() => actOnAgent("run-checks", a)}
                                data-testid={`trmm-checks-btn-${a.agent_id || a.id}`}
                              >
                                <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Checks
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                                disabled={a.status !== "online"}
                                onClick={() => actOnAgent("reboot", a)}
                                data-testid={`trmm-reboot-btn-${a.agent_id || a.id}`}
                              >
                                <RotateCw className="w-3.5 h-3.5 mr-1" /> Reboot
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Linked Devices */}
          <TabsContent value="linked" className="mt-4">
            <Card>
              <CardContent className="p-0">
                {linkedDevices.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground text-sm">
                    No NexusOps devices linked to TRMM agents yet.
                    <div className="mt-2 text-xs">Open a device's detail page and click "Link TRMM agent".</div>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Device</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>TRMM hostname</TableHead>
                        <TableHead>Linked</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linkedDevices.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell>{d.name}</TableCell>
                          <TableCell>{d.client_name || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{d.trmm_hostname || d.trmm_agent_id}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{timeAgo(d.trmm_linked_at)}</TableCell>
                          <TableCell className="text-right">
                            <Link to={`/devices/${d.id}`}>
                              <Button size="sm" variant="outline">
                                <Eye className="w-3.5 h-3.5 mr-1" /> Open
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Audit */}
          <TabsContent value="audit" className="mt-4">
            <Card>
              <CardContent className="p-0">
                {actionsLog.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground text-sm">No actions recorded yet.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>By</TableHead>
                        <TableHead>Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {actionsLog.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">{timeAgo(row.timestamp)}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{row.action}</Badge></TableCell>
                          <TableCell className="font-mono text-xs">{row.agent_id}</TableCell>
                          <TableCell className="text-xs">{row.by || "—"}</TableCell>
                          <TableCell className="text-[10px] text-muted-foreground truncate max-w-[400px]">{row.result_preview}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Auto-Link Dialog */}
      <Dialog open={autoLinkOpen} onOpenChange={(v) => { if (!v) { setAutoLinkOpen(false); setAutoLinkPreview(null); } }}>
        <DialogContent className="max-w-3xl" data-testid="trmm-auto-link-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-500" /> Auto-link TRMM agents</DialogTitle>
            <DialogDescription>
              Matches agents to NexusOps devices by hostname (case-insensitive) and falls back to public/local IP. Ambiguous matches are skipped for review.
            </DialogDescription>
          </DialogHeader>

          {autoLinkBusy && !autoLinkPreview && (
            <div className="py-12 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Analysing…</div>
          )}

          {autoLinkPreview && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div className="border border-border rounded-md p-2"><div className="text-[10px] uppercase text-muted-foreground tracking-widest">Agents</div><div className="text-xl">{autoLinkPreview.stats.agents_total}</div></div>
                <div className="border border-emerald-500/30 bg-emerald-500/5 rounded-md p-2"><div className="text-[10px] uppercase text-emerald-400 tracking-widest">Will match</div><div className="text-xl text-emerald-400" data-testid="trmm-autolink-matched">{autoLinkPreview.stats.matched}</div></div>
                <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-2"><div className="text-[10px] uppercase text-amber-400 tracking-widest">Skipped</div><div className="text-xl text-amber-400">{autoLinkPreview.stats.skipped}</div></div>
                <div className="border border-rose-500/30 bg-rose-500/5 rounded-md p-2"><div className="text-[10px] uppercase text-rose-400 tracking-widest">Ambiguous</div><div className="text-xl text-rose-400">{autoLinkPreview.stats.ambiguous}</div></div>
                <div className="border border-border rounded-md p-2"><div className="text-[10px] uppercase text-muted-foreground tracking-widest">Unmatched</div><div className="text-xl text-muted-foreground">{autoLinkPreview.stats.unmatched}</div></div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="trmm-autolink-overwrite"
                  checked={autoLinkOverwrite}
                  onChange={(e) => setAutoLinkOverwrite(e.target.checked)}
                  data-testid="trmm-autolink-overwrite"
                />
                <Label htmlFor="trmm-autolink-overwrite" className="text-xs">Overwrite existing TRMM links (re-pair devices already matched)</Label>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => runAutoLink(false)}
                  disabled={autoLinkBusy}
                  data-testid="trmm-autolink-recompute"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Recompute
                </Button>
              </div>

              <div className="border border-border rounded-md max-h-72 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Device</TableHead>
                      <TableHead>Agent (TRMM hostname)</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Match</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {autoLinkPreview.matched.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-6">No new matches found.</TableCell></TableRow>
                    )}
                    {autoLinkPreview.matched.map((m, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{m.device_name}</TableCell>
                        <TableCell className="font-mono text-xs">{m.agent_hostname}</TableCell>
                        <TableCell className="text-xs">{m.client || "—"}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">{m.match_type}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {(autoLinkPreview.ambiguous?.length || 0) > 0 && (
                <div className="border border-rose-500/20 rounded-md p-3 bg-rose-500/5 text-xs">
                  <div className="font-medium text-rose-400 mb-1">{autoLinkPreview.ambiguous.length} ambiguous · resolve manually</div>
                  <div className="space-y-1 max-h-32 overflow-auto">
                    {autoLinkPreview.ambiguous.slice(0, 25).map((a, i) => (
                      <div key={i} className="text-muted-foreground">
                        <span className="font-mono">{a.hostname}</span> → {a.candidates.map(c => c.name).join(", ")}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setAutoLinkOpen(false); setAutoLinkPreview(null); }}>Close</Button>
            <Button
              variant="outline"
              className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
              onClick={() => runAutoLink(true)}
              disabled={autoLinkBusy || !autoLinkPreview || (autoLinkPreview?.stats?.matched || 0) === 0}
              data-testid="trmm-autolink-commit-btn"
            >
              {autoLinkBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Link2 className="w-4 h-4 mr-1" />}
              Link {autoLinkPreview?.stats?.matched || 0} device(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Script Dialog */}
      <Dialog open={!!scriptOpen} onOpenChange={(v) => { if (!v) { setScriptOpen(false); setScriptResult(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Terminal className="w-4 h-4 text-violet-500" /> Run Script · {scriptOpen?.hostname}</DialogTitle>
            <DialogDescription>Executes via Tactical RMM. Output is captured in the action log.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label>Shell</Label>
                <Select value={scriptForm.shell} onValueChange={(v) => setScriptForm({ ...scriptForm, shell: v })}>
                  <SelectTrigger data-testid="trmm-script-shell"><SelectValue /></SelectTrigger>
                  <SelectContent>{SHELLS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Timeout (s)</Label>
                <Input type="number" value={scriptForm.timeout} onChange={(e) => setScriptForm({ ...scriptForm, timeout: e.target.value })} data-testid="trmm-script-timeout" />
              </div>
            </div>
            <div>
              <Label>Command</Label>
              <Textarea
                rows={6}
                value={scriptForm.command}
                onChange={(e) => setScriptForm({ ...scriptForm, command: e.target.value })}
                placeholder="Get-Service Spooler"
                className="font-mono text-xs"
                data-testid="trmm-script-command"
              />
            </div>
            {scriptResult && (
              <div className="bg-muted/40 border border-border rounded-md p-3 max-h-60 overflow-auto">
                <div className="text-[10px] uppercase text-muted-foreground tracking-widest mb-1">Result</div>
                <pre className="text-[11px] font-mono whitespace-pre-wrap">{JSON.stringify(scriptResult.result || scriptResult, null, 2)}</pre>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setScriptOpen(false); setScriptResult(null); }}>Close</Button>
            <Button
              onClick={submitScript}
              disabled={scriptBusy || !scriptForm.command}
              className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
              variant="outline"
              data-testid="trmm-script-run-btn"
            >
              {scriptBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Play className="w-4 h-4 mr-1" />}
              Execute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
