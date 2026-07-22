/**
 * NexusOps Agent · Fleet Control Room
 *
 * Differentiated MSP features:
 *  - Version-distribution donut (canary visibility)
 *  - Live activity ticker (Bloomberg-style fleet feed)
 *  - Multi-device parallel script runner with live result streaming
 *  - Per-client installer builder
 *  - Recent enrollments timeline
 *  - Settings: heartbeat/poll intervals, auto-update toggle, server URL, Splashtop
 *
 * Per-device telemetry/management lives on the Devices page (single source of truth).
 */
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { batchIsComplete, canExecuteAgentCommands, updateFilteredSelection } from "@/lib/nexusAgentHelpers";
import {
  Server, Activity, Download, Plus, Terminal, Zap, FileDown,
  Settings as SettingsIcon, ShieldCheck, Loader2, Sparkles, Copy,
  CheckCircle2, WifiOff, Users, TrendingUp, AlertCircle, XCircle, ExternalLink, RefreshCw,
} from "lucide-react";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";

function pct(v) { return typeof v === "number" ? v.toFixed(1) : "—"; }
function ago(iso) { try { return iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "—"; } catch { return "—"; } }

const TONE_CLASSES = {
  emerald: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
  cyan:    "text-cyan-300    border-cyan-500/30    bg-cyan-500/5",
  amber:   "text-amber-300   border-amber-500/30   bg-amber-500/5",
  rose:    "text-rose-300    border-rose-500/30    bg-rose-500/5",
  violet:  "text-violet-300  border-violet-500/30  bg-violet-500/5",
  zinc:    "text-zinc-400    border-zinc-700       bg-zinc-800/40",
};

const VERSION_DONUT_COLORS = ["#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#818cf8", "#f97316"];

const STATUS_DOT_CLASSES = {
  emerald: "bg-emerald-400",
  cyan: "bg-cyan-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  zinc: "bg-zinc-400",
};

function InlineError({ children }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs text-rose-300 bg-rose-500/5 border-t border-rose-500/20">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />{children}
    </div>
  );
}

function CopyChip({ value, label = "copy", testId }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* noop */ }
      }}
      className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-cyan-300 font-mono"
    >
      {done ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {done ? "copied" : label}
    </button>
  );
}

// ───────── Version Distribution Donut ─────────

function VersionDonut() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState({ rows: [], total_agents: 0, latest_version: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => axios.get(`${API}/nexus-agent/fleet/version-distribution`, { headers })
      .then(r => { setData(r.data); setError(""); })
      .catch(() => setError("Version data is unavailable."));
    load();
    const i = setInterval(load, 10000);
    return () => clearInterval(i);
  }, [headers]);

  const total = data.total_agents || 0;
  const size = 200, stroke = 28, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let acc = 0;
  const latestPct = data.rows.find(r => r.is_latest)?.pct || 0;

  return (
    <Card className="bg-zinc-950 border-zinc-800" data-testid="version-donut-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-violet-400" />Version Distribution
          <Badge variant="outline" className="ml-auto text-[10px] font-mono">latest v{data.latest_version || "?"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="text-center text-xs text-zinc-500 py-8">No agents enrolled yet.</div>
        ) : (
          <div className="flex items-center gap-5">
            <div className="relative shrink-0">
              <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={stroke} />
                {data.rows.map((row, i) => {
                  const frac = (row.count || 0) / total;
                  const dash = c * frac;
                  const gap  = c - dash;
                  const offset = c * (acc / total) * -1;
                  acc += row.count || 0;
                  return (
                    <circle key={row.version} cx={size / 2} cy={size / 2} r={r}
                      fill="none"
                      stroke={row.is_latest ? "#22d3ee" : VERSION_DONUT_COLORS[(i + 1) % VERSION_DONUT_COLORS.length]}
                      strokeWidth={stroke}
                      strokeDasharray={`${dash} ${gap}`}
                      strokeDashoffset={offset}
                      style={{ transition: "stroke-dasharray 600ms ease-out, stroke-dashoffset 600ms ease-out" }}
                    />
                  );
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-mono text-zinc-100">{latestPct.toFixed(0)}%</span>
                <span className="text-[9px] uppercase tracking-widest text-zinc-500">on latest</span>
              </div>
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              {data.rows.map((row, i) => (
                <div key={row.version} className="flex items-center gap-2 text-xs" data-testid={`version-row-${row.version}`}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: row.is_latest ? "#22d3ee" : VERSION_DONUT_COLORS[(i + 1) % VERSION_DONUT_COLORS.length] }} />
                  <span className="font-mono text-zinc-300 flex-1 truncate">v{row.version}</span>
                  {row.is_latest && <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30 text-[9px]">LATEST</Badge>}
                  <span className="text-zinc-500 font-mono">{row.count}</span>
                  <span className="text-zinc-600 font-mono w-12 text-right">{row.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      {error && <InlineError>{error}</InlineError>}
    </Card>
  );
}

// ───────── Activity Ticker ─────────

function ActivityTicker() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => axios.get(`${API}/nexus-agent/fleet/activity?limit=60`, { headers })
      .then(r => { setEvents(r.data?.events || []); setError(""); })
      .catch(() => setError("Fleet activity is unavailable."));
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, [headers]);

  return (
    <Card className="bg-zinc-950 border-zinc-800" data-testid="activity-ticker-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />Live Fleet Activity
          <Badge variant="outline" className="ml-auto text-[10px] font-mono">{events.length} events</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[420px] overflow-y-auto divide-y divide-zinc-900/60">
          {events.length === 0 && <div className="text-center text-xs text-zinc-500 py-8">Quiet so far.</div>}
          {events.map((e, i) => (
            <div key={`${e.kind}-${e.at}-${i}`} className="px-3 py-1.5 flex items-center gap-2 text-xs hover:bg-zinc-900/40" data-testid={`activity-event-${i}`}>
              <span className={`px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider ${TONE_CLASSES[e.tone] || TONE_CLASSES.zinc}`}>{e.label}</span>
              <span className="text-zinc-300 truncate">{e.hostname || e.device_id?.slice(0, 8)}</span>
              {e.kind === "heartbeat" && (e.cpu_percent != null) && (
                <span className="text-[10px] text-zinc-500 font-mono">cpu {pct(e.cpu_percent)}% · mem {pct(e.mem_percent)}%</span>
              )}
              {e.kind === "command" && e.by && <span className="text-[10px] text-zinc-500">by {e.by}</span>}
              <span className="text-[10px] text-zinc-600 font-mono ml-auto shrink-0">{ago(e.at)}</span>
            </div>
          ))}
        </div>
      </CardContent>
      {error && <InlineError>{error}</InlineError>}
    </Card>
  );
}

// ───────── Recent Enrollments ─────────

function RecentEnrollments() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    axios.get(`${API}/nexus-agent/fleet/recent-enrollments?limit=8`, { headers })
      .then(r => { setRows(r.data || []); setError(""); })
      .catch(() => setError("Recent enrollments are unavailable."));
  }, [headers]);

  return (
    <Card className="bg-zinc-950 border-zinc-800" data-testid="recent-enrollments-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="w-4 h-4 text-cyan-400" />Recent Enrollments
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="text-center text-xs text-zinc-500 py-6">No agents enrolled yet.</div>
        ) : (
          <div className="divide-y divide-zinc-900/60">
            {rows.map(r => (
              <Link key={r.id} to={r.device_record_id ? `/devices/${r.device_record_id}` : "/devices?source=nexus-agent"} className="block px-3 py-2 text-xs hover:bg-zinc-900/40">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${r.online ? "bg-emerald-400" : "bg-zinc-600"}`} />
                  <span className="font-medium text-zinc-200 truncate flex-1">{r.hostname || "(unnamed)"}</span>
                  <Badge variant="outline" className="text-[9px]">{r.os || "?"}</Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-500 font-mono">
                  <span>v{r.agent_version || "?"}</span>
                  <span>·</span>
                  <span>{ago(r.enrolled_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
      {error && <InlineError>{error}</InlineError>}
    </Card>
  );
}

// ───────── Multi-Device Script Runner ─────────

function FleetScriptRunner() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [agents, setAgents] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [shell, setShell] = useState("powershell");
  const [script, setScript] = useState("Get-Date\nGet-ComputerInfo | Select-Object CsName, OsName, OsVersion, CsTotalPhysicalMemory");
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState(null);
  const [batch, setBatch] = useState({ commands: [], counts: {} });
  const [filter, setFilter] = useState("");
  const [loadError, setLoadError] = useState("");
  const [batchError, setBatchError] = useState("");
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    axios.get(`${API}/nexus-agent/agents`, { headers })
      .then(r => { setAgents(r.data || []); setLoadError(""); })
      .catch(() => setLoadError("Unable to load agents."));
  }, [headers]);

  const onlineAgents = useMemo(() => agents.filter(a => a.online), [agents]);
  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    if (!q) return onlineAgents;
    return onlineAgents.filter(a => (a.hostname || "").toLowerCase().includes(q));
  }, [onlineAgents, filter]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(agent => selected.has(agent.id));

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(prev => updateFilteredSelection(prev, filtered.map(agent => agent.id)));
  };

  const launch = async () => {
    if (selected.size === 0 || !script.trim()) { toast.error("Pick devices and write a script"); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API}/nexus-agent/fleet/run-script`, {
        device_ids: Array.from(selected),
        shell,
        script,
        timeout_sec: 120,
      }, { headers });
      setBatchId(r.data.batch_id);
      setBatch({ commands: [], counts: {} });
      setBatchError("");
      const skipped = r.data.skipped_device_ids?.length || 0;
      toast.success(`Launched on ${r.data.targets.length} devices${skipped ? `; ${skipped} unavailable device${skipped === 1 ? "" : "s"} skipped` : ""}`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Launch failed"); }
    finally { setBusy(false); }
  };

  // Poll batch results
  useEffect(() => {
    if (!batchId) return;
    let stopped = false;
    let timer;
    const tick = async () => {
      try {
        const response = await axios.get(`${API}/nexus-agent/fleet/batch/${batchId}`, { headers });
        if (stopped) return;
        const nextBatch = response.data;
        setBatch(nextBatch);
        setBatchError("");
        const commands = nextBatch.commands || [];
        const complete = batchIsComplete(commands);
        if (!complete) timer = setTimeout(tick, 2500);
      } catch (error) {
        if (stopped) return;
        setBatchError(error?.response?.data?.detail || "Unable to refresh batch results.");
        if (error?.response?.status !== 403 && error?.response?.status !== 404) timer = setTimeout(tick, 5000);
      }
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [batchId, headers]);

  const cancelBatch = async () => {
    if (!batchId) return;
    setCancelling(true);
    try {
      const response = await axios.post(`${API}/nexus-agent/fleet/batch/${batchId}/cancel`, {}, { headers });
      toast.success(`Cancelled ${response.data.cancelled} pending command${response.data.cancelled === 1 ? "" : "s"}`);
      const refreshed = await axios.get(`${API}/nexus-agent/fleet/batch/${batchId}`, { headers });
      setBatch(refreshed.data);
      setBatchError("");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to cancel pending commands");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Card className="bg-zinc-950 border-zinc-800" data-testid="fleet-script-runner-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />Multi-Device Script Runner
          <Badge variant="outline" className="ml-auto text-[10px] font-mono">{selected.size} selected</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Device picker */}
        <div className="border border-zinc-800 rounded">
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-zinc-800">
            <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} className="accent-cyan-500" data-testid="select-all-agents" />
            <span className="text-[10px] uppercase text-zinc-500 tracking-wider">All online</span>
            {agents.length > onlineAgents.length && <span className="text-[10px] text-zinc-600">{agents.length - onlineAgents.length} offline excluded</span>}
            <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter…" className="h-6 text-xs max-w-[200px] ml-auto" />
          </div>
          <div className="max-h-32 overflow-y-auto divide-y divide-zinc-900/60">
            {filtered.length === 0 && <div className="text-center text-xs text-zinc-500 py-4">No agents</div>}
            {filtered.map(a => (
              <label key={a.id} className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-zinc-900/40 cursor-pointer">
                <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} className="accent-cyan-500" data-testid={`select-agent-${a.id}`} />
                <span className={`w-1.5 h-1.5 rounded-full ${a.online ? "bg-emerald-400" : "bg-zinc-600"}`} />
                <span className="text-zinc-200 truncate flex-1">{a.hostname || a.id.slice(0, 8)}</span>
                <Badge variant="outline" className="text-[9px]">{a.os || "?"}</Badge>
              </label>
            ))}
          </div>
        </div>

        {/* Shell + script */}
        <div className="flex items-center gap-2">
          <Select value={shell} onValueChange={setShell}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="powershell">PowerShell</SelectItem>
              <SelectItem value="cmd">CMD</SelectItem>
              <SelectItem value="bash">Bash</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={launch} disabled={busy || selected.size === 0 || !script.trim()} className="ml-auto bg-amber-500 hover:bg-amber-400 text-zinc-950" data-testid="fleet-script-launch">
            {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}
            Launch on {selected.size}
          </Button>
        </div>
        <Textarea
          value={script}
          onChange={e => setScript(e.target.value)}
          rows={6}
          className="font-mono text-xs bg-zinc-950 border-zinc-800"
          data-testid="fleet-script-body"
        />

        {/* Batch results */}
        {batchId && (
          <div className="border-t border-zinc-800 pt-3 space-y-2" data-testid="fleet-script-results">
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">{batch.counts?.ok || 0} OK</Badge>
              <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30">{batch.counts?.dispatched || 0} RUNNING</Badge>
              <Badge className="bg-zinc-700 text-zinc-300">{batch.counts?.pending || 0} PENDING</Badge>
              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">{batch.counts?.timeout || 0} TIMEOUT</Badge>
              <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/30">{batch.counts?.error || 0} ERROR</Badge>
              <Badge className="bg-zinc-700 text-zinc-300">{batch.counts?.cancelled || 0} CANCELLED</Badge>
              {(batch.counts?.pending || 0) > 0 && (
                <Button variant="outline" size="sm" className="h-6 text-[10px] text-rose-300 border-rose-500/30" onClick={cancelBatch} disabled={cancelling} data-testid="fleet-script-cancel">
                  {cancelling ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <XCircle className="w-3 h-3 mr-1" />}Cancel pending
                </Button>
              )}
              <span className="ml-auto text-zinc-500">batch {batchId.slice(0, 8)}…</span>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {(batch.commands || []).map(c => {
                const tone = c.status === "ok" ? "emerald" : c.status === "error" ? "rose" : c.status === "timeout" ? "amber" : c.status === "dispatched" ? "cyan" : "zinc";
                return (
                  <div key={c.id} className="border border-zinc-800 rounded text-xs" data-testid={`batch-cmd-${c.id}`}>
                    <div className="px-2 py-1 flex items-center gap-2 border-b border-zinc-900">
                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT_CLASSES[tone] || STATUS_DOT_CLASSES.zinc}`} />
                      <span className="text-zinc-200 truncate flex-1">{c.hostname || c.device_id.slice(0, 8)}</span>
                      <span className={`text-[9px] uppercase tracking-wider ${TONE_CLASSES[tone]} border-0 bg-transparent px-1`}>{c.status}</span>
                      {c.duration_ms != null && c.status !== "pending" && c.status !== "dispatched" && (
                        <span className="text-[9px] font-mono text-zinc-500">{c.duration_ms}ms</span>
                      )}
                    </div>
                    {(c.stdout || c.stderr) && (
                      <pre className={`text-[10px] p-2 max-h-32 overflow-auto whitespace-pre-wrap bg-zinc-950/60 ${c.status === "error" ? "text-rose-300" : "text-emerald-200"}`}>
                        {c.stdout || c.stderr}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {loadError && <InlineError>{loadError}</InlineError>}
        {batchError && <InlineError>{batchError}</InlineError>}
      </CardContent>
    </Card>
  );
}

// ───────── Installer Builder (kept) ─────────

function InstallerBuilder({ open, onClose }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [loadError, setLoadError] = useState("");
  const isLocalInstaller = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(result?.server_url || result?.download_url || "");

  useEffect(() => {
    if (!open) return;
    axios.get(`${API}/clients-enriched`, { headers })
      .then(r => { setClients(r.data?.clients || []); setLoadError(""); })
      .catch(() => { setClients([]); setLoadError("Unable to load clients."); });
  }, [open, headers]);

  const submit = async () => {
    if (!clientId) { toast.error("Pick a client"); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API}/nexus-agent/installers/build`, { client_id: clientId, note }, { headers });
      setResult(r.data);
      toast.success("Installer ready");
    } catch (e) { toast.error(e?.response?.data?.detail || "Build failed"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { onClose?.(); setResult(null); } }}>
      <DialogContent className="max-w-lg" data-testid="installer-builder-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Download className="w-4 h-4" />Generate Agent Installer</DialogTitle>
          <DialogDescription>Build a client-bound Windows package with a unique enrolment token, Nexus Shield posture telemetry, automatic Nexus Canary provisioning, secure Client Chat, and Nexus Elevate support.</DialogDescription>
        </DialogHeader>
        {!result ? (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">Client / organisation</label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger data-testid="installer-client-select"><SelectValue placeholder="Pick a client…" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Input placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
              <div className="flex items-center gap-2 text-emerald-300 mb-2"><CheckCircle2 className="w-4 h-4" />Ready · {(result.size_bytes / 1024 / 1024).toFixed(1)} MB</div>
              <a href={result.download_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 underline" data-testid="installer-download-link">
                <FileDown className="w-3 h-3" />{result.filename}
              </a>
              <p className="mt-2 text-[10px] text-zinc-400">Package cadence: heartbeat every {result.heartbeat_secs || 60}s; command poll every {result.poll_secs || 10}s.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded border border-cyan-400/20 bg-cyan-400/[0.04] p-3 text-xs text-cyan-50"><div className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-3.5 w-3.5 text-cyan-300" />Nexus Agent service</div><p className="mt-1 leading-relaxed text-cyan-100/70">Enrolment, telemetry, approved commands, and automatic updates.</p></div>
              <div className={`rounded border p-3 text-xs ${result.includes_nexus_shield ? "border-violet-500/25 bg-violet-500/[0.05] text-violet-50" : "border-amber-500/25 bg-amber-500/[0.05] text-amber-50"}`}><div className="flex items-center gap-1.5 font-medium">{result.includes_nexus_shield ? <ShieldCheck className="h-3.5 w-3.5 text-violet-300" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-300" />}{result.includes_nexus_shield ? "Nexus Shield + Canary" : "Nexus Shield unavailable"}</div><p className="mt-1 leading-relaxed opacity-75">{result.includes_nexus_shield ? "Posture telemetry starts at first check-in; one Canary sensor is automatically queued for each Windows endpoint." : "This installer predates the Nexus Shield deployment profile."}</p></div>
              <div className={`rounded border p-3 text-xs ${result.includes_nexus_elevate ? "border-emerald-500/25 bg-emerald-500/[0.05] text-emerald-50" : "border-amber-500/25 bg-amber-500/[0.05] text-amber-50"}`}><div className="flex items-center gap-1.5 font-medium">{result.includes_nexus_elevate ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-300" />}{result.includes_nexus_elevate ? "Client Chat + Nexus Elevate" : "Client companion unavailable"}</div><p className="mt-1 leading-relaxed opacity-75">{result.includes_nexus_elevate ? "Client chat and the auditable administrator-access request flow are bundled." : "Build the Nexus Client Chat companion before generating a deployment package."}</p></div>
            </div>
            {isLocalInstaller && (
              <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
                This package is linked to your local NexusMSP server and will work only on this computer for now. Set a public HTTPS server URL before deploying it to a client machine.
              </div>
            )}
            <div className="text-[10px] text-zinc-500 space-y-1">
              <div>One-line PowerShell deploy:</div>
              <pre className="bg-zinc-950 border border-zinc-800 rounded p-2 font-mono text-[10px] text-zinc-300 whitespace-pre-wrap break-all">{`Invoke-WebRequest "${result.download_url}" -OutFile $env:TEMP\\NexusOpsAgent.zip; Expand-Archive $env:TEMP\\NexusOpsAgent.zip -DestinationPath $env:TEMP\\NexusOpsAgent -Force; & "$env:TEMP\\NexusOpsAgent\\install.bat"`}</pre>
              <CopyChip value={`Invoke-WebRequest "${result.download_url}" -OutFile $env:TEMP\\NexusOpsAgent.zip; Expand-Archive $env:TEMP\\NexusOpsAgent.zip -DestinationPath $env:TEMP\\NexusOpsAgent -Force; & "$env:TEMP\\NexusOpsAgent\\install.bat"`} label="copy install command" testId="installer-copy-cmd" />
            </div>
          </div>
        )}
        {loadError && <InlineError>{loadError}</InlineError>}
        <DialogFooter>
          {!result ? (
            <>
              <Button variant="ghost" onClick={() => onClose?.()}>Cancel</Button>
              <Button onClick={submit} disabled={busy || !clientId} data-testid="installer-build-btn">
                {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                Build installer
              </Button>
            </>
          ) : (
            <Button onClick={() => { setResult(null); onClose?.(); }} variant="outline">Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────── Settings (kept) ─────────

function SettingsCard({ canEdit }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [s, setS] = useState({ heartbeat_secs: 60, poll_secs: 10, server_url: "", splashtop_enabled: false, splashtop_deploy_code_default: "", auto_update_enabled: true, winget_enabled: false, winget_allowed_ids: [] });
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState({ agent_version: "", agent_binary_exists: false, agent_binary_sha256: "", agent_binary_size: 0 });
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    axios.get(`${API}/nexus-agent/settings`, { headers })
      .then(r => { setS(prev => ({ ...prev, ...r.data })); setMeta({ agent_version: r.data.agent_version, agent_binary_exists: r.data.agent_binary_exists, agent_binary_sha256: r.data.agent_binary_sha256 || "", agent_binary_size: r.data.agent_binary_size || 0 }); setLoadError(""); })
      .catch(() => setLoadError("Agent settings are unavailable."));
  }, [headers]);

  const save = async () => {
    if (!canEdit) return;
    setBusy(true);
    try {
      await axios.put(`${API}/nexus-agent/settings`, s, { headers });
      toast.success("Settings saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <Card className="bg-zinc-950 border-zinc-800" data-testid="agent-settings-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <SettingsIcon className="w-4 h-4" />Agent Settings
          <Badge variant="outline" className="ml-auto text-[10px] font-mono">v{meta.agent_version}</Badge>
          {meta.agent_binary_exists ? (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">Binary OK</Badge>
          ) : (
            <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-[10px]">Missing</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Heartbeat (sec)</label>
            <Input type="number" value={s.heartbeat_secs} onChange={e => setS({ ...s, heartbeat_secs: Number(e.target.value) || 60 })} disabled={!canEdit} data-testid="agent-setting-heartbeat" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Poll (sec)</label>
            <Input type="number" value={s.poll_secs} onChange={e => setS({ ...s, poll_secs: Number(e.target.value) || 10 })} disabled={!canEdit} data-testid="agent-setting-poll" />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500">Server URL</label>
          <Input value={s.server_url} onChange={e => setS({ ...s, server_url: e.target.value })} placeholder="https://your-domain.com" disabled={!canEdit} data-testid="agent-setting-server-url" />
        </div>
        <div className="border-t border-zinc-800 pt-3">
          <div className="flex items-start gap-3 mb-2">
            <button type="button" role="switch" aria-checked={s.winget_enabled}
              onClick={() => setS({ ...s, winget_enabled: !s.winget_enabled })} disabled={!canEdit}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-transparent transition-colors mt-0.5 ${s.winget_enabled ? "bg-cyan-500" : "bg-zinc-700"}`}>
              <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${s.winget_enabled ? "translate-x-4" : "translate-x-0.5"} mt-0.5`} />
            </button>
            <div><div className="text-sm font-medium">Winget approved-app updates</div><p className="text-[11px] text-zinc-500">Only packages in this allow-list can run in a maintenance window.</p></div>
          </div>
          <Textarea value={(s.winget_allowed_ids || []).join("\n")} onChange={e => setS({ ...s, winget_allowed_ids: e.target.value.split(/[\n,]/).map(x => x.trim()).filter(Boolean) })} placeholder={"Microsoft.Edge\nGoogle.Chrome\n7zip.7zip"} rows={3} disabled={!canEdit} />
        </div>
        <div className="border-t border-zinc-800 pt-3">
          <div className="flex items-start gap-3">
            <button type="button" role="switch" aria-checked={s.auto_update_enabled}
              onClick={() => setS({ ...s, auto_update_enabled: !s.auto_update_enabled })}
              disabled={!canEdit}
              data-testid="agent-setting-auto-update"
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-transparent transition-colors mt-0.5 ${s.auto_update_enabled ? "bg-cyan-500" : "bg-zinc-700"}`}>
              <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${s.auto_update_enabled ? "translate-x-4" : "translate-x-0.5"} mt-0.5`} />
            </button>
            <div className="flex-1">
              <div className="text-sm font-medium flex items-center gap-2">Auto-update on heartbeat
                <Badge variant="outline" className="text-[10px]">{s.auto_update_enabled ? "ON" : "OFF"}</Badge>
              </div>
              <p className="text-[11px] text-zinc-500 mt-0.5">SHA256-verified self-restart when versions mismatch.</p>
              {meta.agent_binary_sha256 && (
                <p className="text-[10px] font-mono text-zinc-600 mt-1 truncate" title={meta.agent_binary_sha256}>sha256: {meta.agent_binary_sha256.slice(0, 24)}…</p>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-zinc-800 pt-3">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-4 h-4 text-violet-300" />
            <span className="text-sm font-medium">Splashtop</span>
            <Badge variant="outline" className="text-[10px] text-zinc-500">Phase 4</Badge>
          </div>
          <Input value={s.splashtop_deploy_code_default} onChange={e => setS({ ...s, splashtop_deploy_code_default: e.target.value })} placeholder="Default deployment code" disabled={!canEdit} />
        </div>
        <div className="pt-1">
          {canEdit ? (
            <Button onClick={save} disabled={busy} data-testid="agent-settings-save">{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Save</Button>
          ) : (
            <p className="text-[11px] text-zinc-500">Read-only. Agent command permission is required to change settings.</p>
          )}
        </div>
      </CardContent>
      {loadError && <InlineError>{loadError}</InlineError>}
    </Card>
  );
}

// ───────── Page ─────────

export default function NexusAgentCenterPage() {
  const { token, user } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [stats, setStats] = useState({});
  const [installerOpen, setInstallerOpen] = useState(false);
  const [statsError, setStatsError] = useState("");
  const navigate = useNavigate();
  const canOperate = canExecuteAgentCommands(user);
  const role = String(user?.role || "").toLowerCase();
  const canManageSettings = Boolean(user?.is_admin || role === "admin" || role === "owner");

  useEffect(() => {
    const load = () => axios.get(`${API}/nexus-agent/stats`, { headers })
      .then(r => { setStats(r.data || {}); setStatsError(""); })
      .catch(() => setStatsError("Fleet summary is unavailable."));
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, [headers]);

  return (
    <div className="min-h-[calc(100vh-64px)] bg-zinc-950 text-zinc-100 p-6 space-y-5" data-testid="nexus-agent-center">
      <OperationalPageHeader
        eyebrow="Managed assets"
        title="Nexus Agent"
        description="Monitor agent-backed endpoints, create audited installers, and run approved fleet actions from one operational control room."
        icon={Server}
        tone="emerald"
        actions={<>
          <Button variant="outline" size="sm" onClick={() => navigate("/devices?source=nexus-agent")} data-testid="goto-devices-btn">
            <Server className="w-3 h-3 mr-1" />Open in Devices
          </Button>
          {canOperate && (
            <Button size="sm" onClick={() => setInstallerOpen(true)} data-testid="open-installer-builder">
              <Plus className="w-3 h-3 mr-1" />Generate Installer
            </Button>
          )}
        </>}
      />
      <div className="hidden">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-400" />NexusOps Agent · Fleet Control Room
          </h1>
          <p className="text-xs text-zinc-500 flex items-center gap-1.5">
            In-house RMM agent · per-device views live on
            <Link to="/devices" className="text-cyan-400 hover:underline inline-flex items-center gap-0.5">Devices<ExternalLink className="w-3 h-3" /></Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/devices?source=nexus-agent")} data-testid="goto-devices-btn">
            <Server className="w-3 h-3 mr-1" />Open in Devices
          </Button>
          {canOperate && (
            <Button size="sm" onClick={() => setInstallerOpen(true)} className="bg-cyan-500 text-zinc-950 hover:bg-cyan-400" data-testid="open-installer-builder">
              <Plus className="w-3 h-3 mr-1" />Generate Installer
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" data-testid="agent-hero-tiles">
        <HeroTile label="Agents Online" value={stats.online_agents || 0} icon={Activity} glow="emerald" testId="hero-agents-online" />
        <HeroTile label="Agents Offline" value={stats.offline_agents || 0} icon={WifiOff} glow={stats.offline_agents ? "rose" : "zinc"} testId="hero-agents-offline" />
        <HeroTile label="Enrolled Agents" value={stats.total_agents || 0} icon={Server} glow="cyan" testId="hero-agents-total" />
        <HeroTile label="Security Assessed" value={stats.assessed_devices || 0} subtitle={`of ${stats.agent_devices || 0} agent-linked`} icon={ShieldCheck} glow="violet" testId="hero-endpoints-assessed" />
        <HeroTile label="Pending Updates" value={stats.pending_updates || 0} icon={RefreshCw} glow={stats.pending_updates ? "amber" : "zinc"} testId="hero-updates-pending" />
        <HeroTile label="Commands Queued" value={stats.pending_commands || 0} icon={Terminal} glow={stats.pending_commands ? "amber" : "violet"} testId="hero-agents-pending" />
      </div>
      {statsError && <InlineError>{statsError}</InlineError>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VersionDonut />
        <ActivityTicker />
      </div>

      {canOperate ? (
        <FleetScriptRunner />
      ) : (
        <Card className="bg-zinc-950 border-zinc-800" data-testid="fleet-script-restricted">
          <CardContent className="py-6 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <p className="text-sm font-medium">Remote commands are restricted</p>
              <p className="text-xs text-zinc-500 mt-1">An administrator must grant the Execute Agent Commands permission before you can run fleet scripts, generate installers, or change agent settings.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RecentEnrollments />
        {canManageSettings && <SettingsCard canEdit />}
      </div>

      {canOperate && <InstallerBuilder open={installerOpen} onClose={() => setInstallerOpen(false)} />}
    </div>
  );
}
