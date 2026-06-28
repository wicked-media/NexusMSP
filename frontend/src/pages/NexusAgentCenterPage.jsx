/**
 * NexusOps Agent Center — fleet management for the in-house RMM agent.
 *
 * Sections:
 *  - Hero metrics strip (agents online/offline/pending commands)
 *  - Agent list (per-client filterable) with live CPU/RAM/disk%
 *  - Agent detail drawer (telemetry, command history, run-script panel)
 *  - "Generate Installer" dialog per client (ZIP with exe + config)
 *  - Settings card (heartbeat/poll intervals, server URL, Splashtop hooks)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Server, Activity, Cpu, HardDrive, Download, Plus, RefreshCw, Terminal,
  Power, Zap, FileDown, Settings as SettingsIcon, ShieldCheck, Loader2,
  ChevronRight, Wifi, WifiOff, Sparkles, Copy, CheckCircle2,
} from "lucide-react";
import HeroTile from "@/components/HeroTile";

const KIND_LABELS = {
  run_script: "Script", run_powershell: "PS", run_cmd: "CMD",
  reboot: "Reboot", shutdown: "Shutdown", kill_process: "Kill PID", ping: "Ping",
};

function pct(v) { return typeof v === "number" ? v.toFixed(1) : "—"; }
function ago(iso) { try { return iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "—"; } catch { return "—"; } }

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

function StatusDot({ online }) {
  return (
    <span className={`relative inline-flex w-2 h-2 rounded-full ${online ? "bg-emerald-400" : "bg-zinc-600"}`}>
      {online && <span className="absolute inset-0 rounded-full bg-emerald-400/60 animate-ping" />}
    </span>
  );
}

function AgentRow({ agent, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`agent-row-${agent.id}`}
      className={`w-full text-left flex items-center gap-3 px-3 py-2 border-b border-zinc-800/80 transition-colors
        ${selected ? "bg-zinc-900 border-l-2 border-l-cyan-500 pl-[10px]" : "hover:bg-zinc-900/50 border-l-2 border-l-transparent pl-[10px]"}`}
    >
      <StatusDot online={agent.online} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-zinc-100 truncate">{agent.hostname || "(unnamed)"}</span>
          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-500">{agent.os || "?"}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-zinc-500 font-mono">
          <span>cpu {pct(agent.cpu_percent)}%</span>
          <span>mem {pct(agent.mem_percent)}%</span>
          <span>v{agent.agent_version || "?"}</span>
        </div>
      </div>
      <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />
    </button>
  );
}

function AgentDetail({ deviceId, onClose }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("telemetry");
  const [scriptShell, setScriptShell] = useState("powershell");
  const [scriptBody, setScriptBody] = useState("Get-Date");
  const [running, setRunning] = useState(false);

  const reload = async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const r = await axios.get(`${API}/nexus-agent/agents/${deviceId}`, { headers });
      setData(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load agent");
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [deviceId]);
  useEffect(() => {
    if (!deviceId) return;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [deviceId]);

  const quickAction = async (kind, payload = {}) => {
    setRunning(true);
    try {
      await axios.post(`${API}/nexus-agent/agents/${deviceId}/command`, { kind, payload }, { headers });
      toast.success(`Queued: ${KIND_LABELS[kind] || kind}`);
      setTimeout(reload, 1200);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setRunning(false); }
  };

  const runScript = async () => {
    if (!scriptBody.trim()) return;
    await quickAction("run_script", { shell: scriptShell, script: scriptBody, timeout_sec: 120 });
  };

  if (!deviceId) return null;
  const agent = data?.agent || {};
  const commands = data?.commands || [];

  return (
    <Sheet open={!!deviceId} onOpenChange={(o) => !o && onClose?.()}>
      <SheetContent className="w-[640px] sm:max-w-[640px] bg-zinc-950 border-l border-zinc-800 overflow-y-auto" data-testid="agent-detail-pane">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <StatusDot online={agent.online} />
            <span>{agent.hostname || "—"}</span>
            <Badge variant="outline" className="text-[10px]">{agent.os || "?"}</Badge>
            <Badge variant="outline" className="text-[10px] font-mono">v{agent.agent_version || "?"}</Badge>
            <Button size="sm" variant="ghost" className="ml-auto h-6 w-6 p-0" onClick={reload} title="Refresh">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </Button>
          </SheetTitle>
        </SheetHeader>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-2 mt-4">
          <Button size="sm" variant="outline" className="h-9 text-xs" onClick={() => quickAction("ping")} disabled={running} data-testid="agent-action-ping">
            <Activity className="w-3 h-3 mr-1" />Ping
          </Button>
          <Button size="sm" variant="outline" className="h-9 text-xs text-amber-300 border-amber-500/30" onClick={() => quickAction("reboot", { delay_sec: 30 })} disabled={running} data-testid="agent-action-reboot">
            <Power className="w-3 h-3 mr-1" />Reboot (30s)
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="mt-5">
          <TabsList className="bg-zinc-900 border border-zinc-800">
            <TabsTrigger value="telemetry" data-testid="agent-tab-telemetry">Telemetry</TabsTrigger>
            <TabsTrigger value="script" data-testid="agent-tab-script">Run Script</TabsTrigger>
            <TabsTrigger value="commands" data-testid="agent-tab-commands">History</TabsTrigger>
            <TabsTrigger value="info" data-testid="agent-tab-info">Info</TabsTrigger>
          </TabsList>

          <TabsContent value="telemetry" className="mt-3 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="text-[9px] uppercase text-zinc-500 tracking-wider">CPU</div>
                <div className="text-2xl font-mono">{pct(agent.cpu_percent)}<span className="text-xs text-zinc-500">%</span></div>
                <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{agent.cpu_model || "—"}</div>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="text-[9px] uppercase text-zinc-500 tracking-wider">Memory</div>
                <div className="text-2xl font-mono">{pct(agent.mem_percent)}<span className="text-xs text-zinc-500">%</span></div>
                <div className="text-[10px] text-zinc-500 mt-0.5">{Math.round(agent.mem_used_mb || 0)} / {Math.round(agent.mem_total_mb || 0)} MB</div>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="text-[9px] uppercase text-zinc-500 tracking-wider">Uptime</div>
                <div className="text-2xl font-mono">{Math.round((agent.uptime_sec || 0) / 3600)}<span className="text-xs text-zinc-500">h</span></div>
                <div className="text-[10px] text-zinc-500 mt-0.5">last seen {ago(agent.last_seen)}</div>
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-zinc-500 tracking-wider mb-1">Disks</div>
              <div className="space-y-1">
                {(agent.disks || []).map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <HardDrive className="w-3 h-3 text-zinc-500 shrink-0" />
                    <span className="font-mono text-zinc-400 w-28 truncate" title={d.mount}>{d.mount}</span>
                    <div className="flex-1 h-1.5 bg-zinc-800 rounded overflow-hidden">
                      <div className={`h-full ${d.percent >= 90 ? "bg-rose-500" : d.percent >= 75 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, d.percent || 0)}%` }} />
                    </div>
                    <span className="text-[10px] text-zinc-500 font-mono w-20 text-right">{d.used_gb}/{d.total_gb} GB</span>
                  </div>
                ))}
                {(agent.disks || []).length === 0 && <div className="text-xs text-zinc-600">No disk data yet</div>}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-zinc-500 tracking-wider mb-1">Network</div>
              <div className="space-y-0.5 text-xs">
                {(agent.nics || []).map((n, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Wifi className="w-3 h-3 text-zinc-500 shrink-0" />
                    <span className="font-mono text-zinc-400 w-32 truncate">{n.name}</span>
                    <span className="text-[10px] text-zinc-500">{(n.ipv4 || []).join(", ")}</span>
                  </div>
                ))}
                {(agent.nics || []).length === 0 && <div className="text-xs text-zinc-600">No NIC data yet</div>}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="script" className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <Select value={scriptShell} onValueChange={setScriptShell}>
                <SelectTrigger className="w-40 h-8 text-xs" data-testid="agent-script-shell">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="powershell">PowerShell</SelectItem>
                  <SelectItem value="cmd">CMD</SelectItem>
                  <SelectItem value="bash">Bash</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={runScript} disabled={running || !scriptBody.trim()} className="ml-auto" data-testid="agent-script-run">
                <Zap className="w-3 h-3 mr-1" />Run
              </Button>
            </div>
            <Textarea
              value={scriptBody}
              onChange={(e) => setScriptBody(e.target.value)}
              rows={10}
              placeholder="Get-Date"
              className="font-mono text-xs bg-zinc-950 border-zinc-800"
              data-testid="agent-script-body"
            />
            <div className="text-[10px] text-zinc-500">Output appears in the History tab.</div>
          </TabsContent>

          <TabsContent value="commands" className="mt-3 space-y-2">
            {commands.length === 0 && <div className="text-xs text-zinc-600 text-center py-6">No commands yet</div>}
            {commands.map((c) => (
              <div key={c.id} className="border border-zinc-800 rounded p-2 text-xs space-y-1" data-testid={`agent-cmd-${c.id}`}>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{KIND_LABELS[c.kind] || c.kind}</Badge>
                  <span className={`text-[10px] uppercase tracking-wider ${c.status === "ok" ? "text-emerald-400" : c.status === "timeout" ? "text-amber-400" : c.status === "error" ? "text-rose-400" : "text-zinc-500"}`}>{c.status}</span>
                  <span className="text-[10px] text-zinc-500 ml-auto font-mono">{ago(c.created_at)}</span>
                </div>
                {c.payload?.script && (
                  <div className="font-mono text-[10px] text-zinc-400 bg-zinc-950/60 border border-zinc-900 rounded px-2 py-1 truncate" title={c.payload.script}>
                    $ {c.payload.script}
                  </div>
                )}
                {c.stdout && <pre className="text-[10px] text-emerald-200 bg-zinc-950/60 border border-zinc-900 rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap">{c.stdout}</pre>}
                {c.stderr && <pre className="text-[10px] text-rose-300 bg-zinc-950/60 border border-zinc-900 rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap">{c.stderr}</pre>}
              </div>
            ))}
          </TabsContent>

          <TabsContent value="info" className="mt-3 space-y-1.5 text-xs">
            {[
              ["Device ID", agent.id],
              ["Client ID", agent.client_id],
              ["Hostname", agent.hostname],
              ["OS / Arch", `${agent.os || "?"} / ${agent.arch || "?"}`],
              ["OS Version", agent.os_version],
              ["Primary MAC", agent.primary_mac],
              ["Agent Version", agent.agent_version],
              ["Enrolled", ago(agent.enrolled_at)],
              ["Last Seen", ago(agent.last_seen)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-zinc-900 py-1">
                <span className="text-zinc-500">{k}</span>
                <span className="font-mono text-zinc-300 truncate max-w-[60%] text-right" title={String(v || "")}>{v || "—"}</span>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function InstallerBuilder({ open, onClose }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    axios.get(`${API}/clients-enriched`, { headers })
      .then(r => setClients(r.data?.clients || []))
      .catch(() => setClients([]));
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
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose?.(); setResult(null); } }}>
      <DialogContent className="max-w-lg" data-testid="installer-builder-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Download className="w-4 h-4" />Generate Agent Installer</DialogTitle>
          <DialogDescription>Builds a Windows ZIP containing nexus-agent.exe + a per-client enrollment token. Run install.bat as Administrator on the endpoint.</DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">Client</label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger data-testid="installer-client-select"><SelectValue placeholder="Pick a client…" /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Input placeholder="Note (optional — e.g. 'pilot deploy')" value={note} onChange={e => setNote(e.target.value)} />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
              <div className="flex items-center gap-2 text-emerald-300 mb-2"><CheckCircle2 className="w-4 h-4" />Installer ready · {(result.size_bytes / 1024 / 1024).toFixed(1)} MB</div>
              <a
                href={result.download_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 underline"
                data-testid="installer-download-link"
              >
                <FileDown className="w-3 h-3" />{result.filename}
              </a>
            </div>
            <div className="text-[10px] text-zinc-500 space-y-1">
              <div>Enrollment token (one-line PowerShell):</div>
              <pre className="bg-zinc-950 border border-zinc-800 rounded p-2 font-mono text-[10px] text-zinc-300 whitespace-pre-wrap break-all">{`Invoke-WebRequest "${result.download_url}" -OutFile $env:TEMP\\NexusOpsAgent.zip; Expand-Archive $env:TEMP\\NexusOpsAgent.zip -DestinationPath $env:TEMP\\NexusOpsAgent -Force; & "$env:TEMP\\NexusOpsAgent\\install.bat"`}</pre>
              <CopyChip value={`Invoke-WebRequest "${result.download_url}" -OutFile $env:TEMP\\NexusOpsAgent.zip; Expand-Archive $env:TEMP\\NexusOpsAgent.zip -DestinationPath $env:TEMP\\NexusOpsAgent -Force; & "$env:TEMP\\NexusOpsAgent\\install.bat"`} label="copy install command" testId="installer-copy-cmd" />
            </div>
          </div>
        )}

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

function SettingsCard() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [s, setS] = useState({ heartbeat_secs: 60, poll_secs: 10, server_url: "", splashtop_enabled: false, splashtop_deploy_code_default: "", auto_update_enabled: true });
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState({ agent_version: "", agent_binary_exists: false, agent_binary_sha256: "", agent_binary_size: 0 });

  useEffect(() => {
    axios.get(`${API}/nexus-agent/settings`, { headers })
      .then(r => { setS({ ...s, ...r.data }); setMeta({ agent_version: r.data.agent_version, agent_binary_exists: r.data.agent_binary_exists, agent_binary_sha256: r.data.agent_binary_sha256 || "", agent_binary_size: r.data.agent_binary_size || 0 }); })
      .catch(() => {});
    // eslint-disable-next-line
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await axios.put(`${API}/nexus-agent/settings`, s, { headers });
      toast.success("Settings saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <Card className="bg-zinc-950 border-zinc-800" data-testid="agent-settings-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SettingsIcon className="w-4 h-4" />NexusOps Agent Settings
          <Badge variant="outline" className="ml-auto text-[10px] font-mono">v{meta.agent_version}</Badge>
          {meta.agent_binary_exists ? (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">Binary OK</Badge>
          ) : (
            <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-[10px]">Binary missing</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Heartbeat interval (seconds)</label>
            <Input type="number" value={s.heartbeat_secs} onChange={e => setS({ ...s, heartbeat_secs: Number(e.target.value) || 60 })} data-testid="agent-setting-heartbeat" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Command poll interval (seconds)</label>
            <Input type="number" value={s.poll_secs} onChange={e => setS({ ...s, poll_secs: Number(e.target.value) || 10 })} data-testid="agent-setting-poll" />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500">Server URL (the agent calls this on heartbeat)</label>
          <Input value={s.server_url} onChange={e => setS({ ...s, server_url: e.target.value })} placeholder="https://your-domain.com" data-testid="agent-setting-server-url" />
        </div>
        <div className="border-t border-zinc-800 pt-3">
          <div className="flex items-start gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={s.auto_update_enabled}
              onClick={() => setS({ ...s, auto_update_enabled: !s.auto_update_enabled })}
              data-testid="agent-setting-auto-update"
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-transparent transition-colors mt-0.5 ${s.auto_update_enabled ? "bg-cyan-500" : "bg-zinc-700"}`}
            >
              <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${s.auto_update_enabled ? "translate-x-4" : "translate-x-0.5"} mt-0.5`} />
            </button>
            <div className="flex-1">
              <div className="text-sm font-medium flex items-center gap-2">Auto-update on heartbeat
                <Badge variant="outline" className="text-[10px]">{s.auto_update_enabled ? "ENABLED" : "DISABLED"}</Badge>
              </div>
              <p className="text-[11px] text-zinc-500 mt-0.5">Agents check their version on each heartbeat. Mismatched agents auto-download the latest binary (SHA256-verified) and self-restart.</p>
              {meta.agent_binary_sha256 && (
                <p className="text-[10px] font-mono text-zinc-600 mt-1 truncate" title={meta.agent_binary_sha256}>sha256: {meta.agent_binary_sha256.slice(0, 32)}… · {Math.round((meta.agent_binary_size || 0) / 1024 / 1024 * 10) / 10} MB</p>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-zinc-800 pt-3">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-4 h-4 text-violet-300" />
            <span className="text-sm font-medium">Splashtop (Phase 4 — coming soon)</span>
            <Badge variant="outline" className="text-[10px] text-zinc-500">Pending wiring</Badge>
          </div>
          <Input value={s.splashtop_deploy_code_default} onChange={e => setS({ ...s, splashtop_deploy_code_default: e.target.value })} placeholder="Default deployment code (optional)" />
        </div>
        <div className="pt-2">
          <Button onClick={save} disabled={busy} data-testid="agent-settings-save">{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Save settings</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function NexusAgentCenterPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [stats, setStats] = useState({});
  const [agents, setAgents] = useState([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(null);
  const [installerOpen, setInstallerOpen] = useState(false);
  const pollRef = useRef(null);

  const reload = async () => {
    try {
      const [a, s] = await Promise.all([
        axios.get(`${API}/nexus-agent/agents`, { headers }),
        axios.get(`${API}/nexus-agent/stats`, { headers }),
      ]);
      setAgents(a.data || []);
      setStats(s.data || {});
    } catch (e) {
      // silent — admin may have no agents yet
    }
  };

  useEffect(() => {
    reload();
    pollRef.current = setInterval(reload, 5000);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line
  }, []);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    if (!q) return agents;
    return agents.filter(a => (a.hostname || "").toLowerCase().includes(q) || (a.os || "").toLowerCase().includes(q));
  }, [agents, filter]);

  return (
    <div className="min-h-[calc(100vh-64px)] bg-zinc-950 text-zinc-100 p-6 space-y-5" data-testid="nexus-agent-center">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-400" />NexusOps Agent · Command Center
          </h1>
          <p className="text-xs text-zinc-500">In-house RMM agent — Windows-first. Splashtop bundling coming in Phase 4.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={reload}><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
          <Button size="sm" onClick={() => setInstallerOpen(true)} className="bg-cyan-500 text-zinc-950 hover:bg-cyan-400" data-testid="open-installer-builder">
            <Plus className="w-3 h-3 mr-1" />Generate Installer
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="agent-hero-tiles">
        <HeroTile label="Agents Online" value={stats.online_agents || 0} icon={Activity} glow="emerald" testId="hero-agents-online" />
        <HeroTile label="Agents Offline" value={stats.offline_agents || 0} icon={WifiOff} glow={stats.offline_agents ? "rose" : "zinc"} testId="hero-agents-offline" />
        <HeroTile label="Total Agents" value={stats.total_agents || 0} icon={Server} glow="cyan" testId="hero-agents-total" />
        <HeroTile label="Commands Queued" value={stats.pending_commands || 0} icon={Terminal} glow={stats.pending_commands ? "amber" : "violet"} testId="hero-agents-pending" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">Fleet</CardTitle>
              <Badge variant="outline" className="text-[10px]">{filtered.length}</Badge>
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter hostname/OS…"
                className="h-7 text-xs max-w-xs ml-auto"
                data-testid="agent-filter-input"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <div className="text-center text-sm text-zinc-500 py-12">
                <Server className="w-10 h-10 mx-auto mb-3 opacity-30" />
                No agents enrolled yet.<br />
                <button onClick={() => setInstallerOpen(true)} className="text-cyan-400 hover:underline mt-2 inline-flex items-center gap-1">
                  <Plus className="w-3 h-3" />Generate your first installer
                </button>
              </div>
            ) : (
              filtered.map(a => <AgentRow key={a.id} agent={a} selected={selected === a.id} onClick={() => setSelected(a.id)} />)
            )}
          </CardContent>
        </Card>

        <SettingsCard />
      </div>

      <AgentDetail deviceId={selected} onClose={() => setSelected(null)} />
      <InstallerBuilder open={installerOpen} onClose={() => setInstallerOpen(false)} />
    </div>
  );
}
