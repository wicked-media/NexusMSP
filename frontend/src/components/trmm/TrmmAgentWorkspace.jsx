import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  Terminal, FileCode, Zap, Cpu, Package, RefreshCw,
  Play, Square, Loader2, Search, Star, StarOff, Trash2, CheckCircle2, XCircle, AlertTriangle, Copy, Download, Server, Clock, X,
} from "lucide-react";

const SHELLS = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "bash", label: "Bash" },
  { value: "python", label: "Python" },
];

const SHELL_PROMPTS = {
  powershell: "PS>",
  cmd: "C:\\>",
  bash: "$",
  python: ">>>",
};

function timeAgo(iso) {
  if (!iso) return "—";
  try {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  } catch { return "—"; }
}

/**
 * Feature-rich workspace drawer for a single TRMM agent.
 *
 * Tabs: Terminal · Scripts · Services · Processes · Software · Windows Updates
 */
export default function TrmmAgentWorkspace({ agent, open, onClose }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const agentId = agent?.agent_id || agent?.id;

  const [tab, setTab] = useState("terminal");

  // ─────────── Terminal state ───────────
  const [shell, setShell] = useState("powershell");
  const [cmd, setCmd] = useState("");
  const [lines, setLines] = useState([]); // [{id, kind:'cmd'|'out'|'err'|'info', text, ts}]
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]); // full commands typed
  const [histIdx, setHistIdx] = useState(-1);
  const [autoscroll, setAutoscroll] = useState(true);
  const outputRef = useRef(null);
  const inputRef = useRef(null);

  // ─────────── Scripts ───────────
  const [scripts, setScripts] = useState([]);
  const [scriptFilter, setScriptFilter] = useState("");
  const [shellFilter, setShellFilter] = useState("all");
  const [favorites, setFavorites] = useState([]);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [scriptRunning, setScriptRunning] = useState(null);
  const [scriptArgs, setScriptArgs] = useState({}); // {scriptId: "arg1 arg2"}
  const [scriptTimeout, setScriptTimeout] = useState(90);

  // Run history
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [expandedRun, setExpandedRun] = useState(null);

  // Services
  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [svcFilter, setSvcFilter] = useState("");
  const [svcBusy, setSvcBusy] = useState({});

  // Processes
  const [processes, setProcesses] = useState([]);
  const [procFilter, setProcFilter] = useState("");
  const [procSort, setProcSort] = useState("cpu_percent");
  const [procLoading, setProcLoading] = useState(false);

  // Software + Updates
  const [software, setSoftware] = useState([]);
  const [softLoading, setSoftLoading] = useState(false);
  const [swFilter, setSwFilter] = useState("");
  const [updates, setUpdates] = useState([]);
  const [updatesLoading, setUpdatesLoading] = useState(false);

  // Reset state when a new agent opens
  useEffect(() => {
    if (!open || !agentId) return;
    setLines([{ id: 0, kind: "info", text: `Connected to ${agent?.hostname || agentId} · ${agent?.operating_system || ""} · ${agent?.status || ""}`, ts: Date.now() }]);
    setHistIdx(-1);
    setTab("terminal");
    setCmd("");
    setShell(agent?.plat === "linux" || agent?.plat === "darwin" ? "bash" : "powershell");
    // Auto-load run history
    loadRuns();
    loadFavorites();
    // eslint-disable-next-line
  }, [agentId, open]);

  useEffect(() => {
    if (autoscroll && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [lines, autoscroll]);

  // ─────────── Terminal logic ───────────
  const appendLines = (newLines) => setLines(prev => [...prev, ...newLines.map((l, i) => ({ ...l, id: prev.length + i + Date.now() }))]);

  const executeCommand = useCallback(async (command, opts = {}) => {
    if (!command.trim() || !agentId) return;
    setBusy(true);
    const stamp = new Date().toLocaleTimeString();
    appendLines([
      { kind: "cmd", text: `${SHELL_PROMPTS[shell] || "$"} ${command}`, ts: Date.now(), stamp, shell },
    ]);
    setCmd("");
    if (!opts.skipHistory) {
      setHistory(prev => {
        const next = [...prev, command];
        return next.length > 200 ? next.slice(-200) : next;
      });
      setHistIdx(-1);
    }
    try {
      const res = await axios.post(`${API}/trmm/agents/${agentId}/run-script`, {
        command,
        shell,
        timeout: opts.timeout || 60,
        label: opts.label,
      }, { headers });
      const stdout = res.data?.stdout || "";
      const stderr = res.data?.stderr || "";
      const retcode = res.data?.retcode;
      const dur = res.data?.duration_ms;
      if (stdout) appendLines(stdout.split("\n").filter((l, i, a) => !(i === a.length - 1 && l === "")).map(l => ({ kind: "out", text: l, ts: Date.now() })));
      if (stderr) appendLines(stderr.split("\n").filter((l, i, a) => !(i === a.length - 1 && l === "")).map(l => ({ kind: "err", text: l, ts: Date.now() })));
      if (!stdout && !stderr) appendLines([{ kind: "info", text: `(no output · exit ${retcode ?? "—"} · ${dur ?? "?"}ms)`, ts: Date.now() }]);
      else appendLines([{ kind: "info", text: `── exit ${retcode ?? "—"} · ${dur ?? "?"}ms`, ts: Date.now() }]);
      if (res.data?.success === false) toast.error(res.data.message || "Command failed");
      loadRuns();
    } catch (e) {
      appendLines([{ kind: "err", text: e.response?.data?.detail || e.message, ts: Date.now() }]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [agentId, shell, headers]);

  const onTerminalKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (cmd.trim() && !busy) executeCommand(cmd);
    } else if (e.key === "ArrowUp") {
      if (history.length === 0) return;
      e.preventDefault();
      const next = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(next);
      setCmd(history[next] || "");
    } else if (e.key === "ArrowDown") {
      if (history.length === 0 || histIdx < 0) return;
      e.preventDefault();
      const next = histIdx + 1;
      if (next >= history.length) { setHistIdx(-1); setCmd(""); }
      else { setHistIdx(next); setCmd(history[next] || ""); }
    } else if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setLines([]);
    } else if (e.key === "c" && e.ctrlKey && !window.getSelection?.().toString()) {
      // Simulate Ctrl-C = abandon current draft
      e.preventDefault();
      setCmd("");
      appendLines([{ kind: "info", text: "^C", ts: Date.now() }]);
    }
  };

  // Common quick commands
  const quickCmds = useMemo(() => shell === "bash" ? [
    { label: "uptime", cmd: "uptime" },
    { label: "df -h", cmd: "df -h" },
    { label: "free -m", cmd: "free -m" },
    { label: "top -bn1 | head -20", cmd: "top -bn1 | head -20" },
    { label: "journalctl -xe --no-pager | tail -50", cmd: "journalctl -xe --no-pager | tail -50" },
  ] : shell === "cmd" ? [
    { label: "systeminfo", cmd: "systeminfo" },
    { label: "ipconfig /all", cmd: "ipconfig /all" },
    { label: "tasklist", cmd: "tasklist" },
    { label: "net user", cmd: "net user" },
  ] : [
    { label: "Get-ComputerInfo", cmd: "Get-ComputerInfo | Select WindowsProductName, OsVersion, CsManufacturer" },
    { label: "Get-Service | running", cmd: "Get-Service | Where-Object {$_.Status -eq 'Running'} | Format-Table Name, DisplayName" },
    { label: "Uptime", cmd: "(Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime" },
    { label: "Top CPU procs", cmd: "Get-Process | Sort-Object CPU -Descending | Select -First 10 Name, CPU, Id, @{N='MemMB';E={[math]::Round($_.WorkingSet/1MB,1)}}" },
    { label: "Event Log · Errors", cmd: "Get-EventLog -LogName System -EntryType Error -Newest 20 | Format-Table TimeGenerated, Source, Message -Wrap" },
    { label: "Restart-Computer -Force", cmd: "Restart-Computer -Force" },
  ], [shell]);

  // ─────────── Scripts loading ───────────
  const loadScripts = useCallback(async () => {
    setScriptsLoading(true);
    try {
      const res = await axios.get(`${API}/trmm/scripts`, { headers });
      setScripts(res.data || []);
    } catch (e) {
      toast.error("Scripts load failed: " + (e.response?.data?.detail || e.message));
    } finally { setScriptsLoading(false); }
  }, [headers]);

  const loadFavorites = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/trmm/scripts/favorites/mine`, { headers });
      setFavorites(res.data || []);
    } catch {}
  }, [headers]);

  const toggleFavorite = async (sid) => {
    const currentlyFav = favorites.includes(sid);
    try {
      await axios.post(`${API}/trmm/scripts/${sid}/favorite`, { favorite: !currentlyFav }, { headers });
      setFavorites(prev => currentlyFav ? prev.filter(x => x !== sid) : [...prev, sid]);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const runScriptById = async (script) => {
    if (!agentId) return;
    setScriptRunning(script.id);
    setTab("terminal");
    const argStr = scriptArgs[script.id] || "";
    const args = argStr.trim() ? argStr.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(a => a.replace(/^"|"$/g, "")) || [] : [];
    appendLines([{ kind: "info", text: `▶ Running script "${script.name}" (${script.shell}) ${args.length ? "args: " + args.join(" ") : ""}`, ts: Date.now() }]);
    try {
      const res = await axios.post(`${API}/trmm/agents/${agentId}/run-script`, {
        script_id: script.id,
        args,
        timeout: scriptTimeout,
        label: script.name,
      }, { headers });
      const stdout = res.data?.stdout || "";
      const stderr = res.data?.stderr || "";
      if (stdout) appendLines(stdout.split("\n").map(l => ({ kind: "out", text: l, ts: Date.now() })));
      if (stderr) appendLines(stderr.split("\n").map(l => ({ kind: "err", text: l, ts: Date.now() })));
      appendLines([{ kind: "info", text: `── "${script.name}" finished · exit ${res.data?.retcode ?? "—"} · ${res.data?.duration_ms ?? "?"}ms`, ts: Date.now() }]);
      toast.success(`${script.name} executed`);
      loadRuns();
    } catch (e) {
      appendLines([{ kind: "err", text: e.response?.data?.detail || e.message, ts: Date.now() }]);
      toast.error(e.response?.data?.detail || e.message);
    } finally { setScriptRunning(null); }
  };

  const loadRuns = useCallback(async () => {
    if (!agentId) return;
    setRunsLoading(true);
    try {
      const res = await axios.get(`${API}/trmm/agents/${agentId}/runs?limit=30`, { headers });
      setRuns(res.data || []);
    } catch {} finally { setRunsLoading(false); }
  }, [agentId, headers]);

  // ─────────── Services ───────────
  const loadServices = useCallback(async () => {
    if (!agentId) return;
    setServicesLoading(true);
    try {
      const res = await axios.get(`${API}/trmm/agents/${agentId}/services`, { headers });
      setServices(res.data?.services || []);
      if (res.data?.success === false) toast.error(res.data.message);
    } catch (e) { toast.error("Services load failed"); }
    finally { setServicesLoading(false); }
  }, [agentId, headers]);

  const svcAction = async (svc, action) => {
    const key = `${svc.name}:${action}`;
    setSvcBusy(m => ({ ...m, [key]: true }));
    try {
      const res = await axios.post(`${API}/trmm/agents/${agentId}/services/${encodeURIComponent(svc.name)}/${action}`, {}, { headers });
      if (res.data?.success === false) toast.error(res.data.message);
      else toast.success(`${action} queued for ${svc.display_name || svc.name}`);
      setTimeout(loadServices, 1500);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setSvcBusy(m => ({ ...m, [key]: false })); }
  };

  // ─────────── Processes ───────────
  const loadProcesses = useCallback(async () => {
    if (!agentId) return;
    setProcLoading(true);
    try {
      const res = await axios.get(`${API}/trmm/agents/${agentId}/processes`, { headers });
      setProcesses(res.data?.processes || []);
      if (res.data?.success === false) toast.error(res.data.message);
    } catch (e) { toast.error("Processes load failed"); }
    finally { setProcLoading(false); }
  }, [agentId, headers]);

  const killProcess = async (pid, name) => {
    if (!window.confirm(`Kill process ${name} (PID ${pid})?`)) return;
    try {
      const res = await axios.post(`${API}/trmm/agents/${agentId}/processes/${pid}/kill`, {}, { headers });
      if (res.data?.success === false) toast.error(res.data.message);
      else { toast.success(`Killed ${name}`); loadProcesses(); }
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  // ─────────── Software & Updates ───────────
  const loadSoftware = useCallback(async () => {
    if (!agentId) return;
    setSoftLoading(true);
    try {
      const res = await axios.get(`${API}/trmm/agents/${agentId}/software`, { headers });
      setSoftware(res.data?.software || []);
    } catch {} finally { setSoftLoading(false); }
  }, [agentId, headers]);

  const loadUpdates = useCallback(async () => {
    if (!agentId) return;
    setUpdatesLoading(true);
    try {
      const res = await axios.get(`${API}/trmm/agents/${agentId}/winupdates`, { headers });
      setUpdates(res.data?.updates || []);
    } catch {} finally { setUpdatesLoading(false); }
  }, [agentId, headers]);

  // Lazy load per-tab
  useEffect(() => {
    if (!open || !agentId) return;
    if (tab === "scripts" && scripts.length === 0) loadScripts();
    if (tab === "services" && services.length === 0) loadServices();
    if (tab === "processes" && processes.length === 0) loadProcesses();
    if (tab === "software" && software.length === 0) loadSoftware();
    if (tab === "updates" && updates.length === 0) loadUpdates();
    // eslint-disable-next-line
  }, [tab, open, agentId]);

  // ─────────── Filtered data ───────────
  const filteredScripts = useMemo(() => {
    let arr = scripts;
    if (shellFilter !== "all") arr = arr.filter(s => s.shell === shellFilter);
    if (scriptFilter.trim()) {
      const q = scriptFilter.toLowerCase();
      arr = arr.filter(s => [s.name, s.description, s.category].some(v => (v || "").toLowerCase().includes(q)));
    }
    // Favorites first
    return [...arr].sort((a, b) => {
      const af = favorites.includes(a.id), bf = favorites.includes(b.id);
      if (af !== bf) return af ? -1 : 1;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [scripts, scriptFilter, shellFilter, favorites]);

  const filteredServices = useMemo(() => {
    if (!svcFilter.trim()) return services;
    const q = svcFilter.toLowerCase();
    return services.filter(s => [s.name, s.display_name, s.description].some(v => (v || "").toLowerCase().includes(q)));
  }, [services, svcFilter]);

  const filteredProcs = useMemo(() => {
    let arr = processes;
    if (procFilter.trim()) {
      const q = procFilter.toLowerCase();
      arr = arr.filter(p => [p.name, p.username, String(p.pid)].some(v => (v || "").toLowerCase().includes(q)));
    }
    return [...arr].sort((a, b) => (b[procSort] || 0) - (a[procSort] || 0));
  }, [processes, procFilter, procSort]);

  const filteredSoftware = useMemo(() => {
    if (!swFilter.trim()) return software;
    const q = swFilter.toLowerCase();
    return software.filter(s => [s.name, s.publisher].some(v => (v || "").toLowerCase().includes(q)));
  }, [software, swFilter]);

  if (!agent) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-[min(1200px,95vw)] p-0 flex flex-col" data-testid="trmm-agent-workspace">
        <SheetHeader className="px-5 py-3 border-b border-border space-y-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <SheetTitle className="flex items-center gap-2 text-base">
                <Server className="w-4 h-4 text-emerald-500" />
                {agent.hostname || agentId}
                <Badge variant="outline" className={agent.status === "online" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" : "text-rose-400 border-rose-500/30 bg-rose-500/5"}>
                  {agent.status}
                </Badge>
                {agent.needs_reboot && <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/5">reboot pending</Badge>}
              </SheetTitle>
              <SheetDescription className="text-[11px]">
                {agent.operating_system || agent.plat} · {agent.client}{agent.site ? ` · ${agent.site}` : ""} · {agent.public_ip || agent.local_ips || "—"}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-5 mt-3 bg-muted/40 border border-border self-start">
            <TabsTrigger value="terminal" data-testid="trmm-ws-tab-terminal"><Terminal className="w-3.5 h-3.5 mr-1" />Terminal</TabsTrigger>
            <TabsTrigger value="scripts" data-testid="trmm-ws-tab-scripts"><FileCode className="w-3.5 h-3.5 mr-1" />Scripts</TabsTrigger>
            <TabsTrigger value="services" data-testid="trmm-ws-tab-services"><Zap className="w-3.5 h-3.5 mr-1" />Services</TabsTrigger>
            <TabsTrigger value="processes" data-testid="trmm-ws-tab-processes"><Cpu className="w-3.5 h-3.5 mr-1" />Processes</TabsTrigger>
            <TabsTrigger value="software" data-testid="trmm-ws-tab-software"><Package className="w-3.5 h-3.5 mr-1" />Software</TabsTrigger>
            <TabsTrigger value="updates" data-testid="trmm-ws-tab-updates"><Download className="w-3.5 h-3.5 mr-1" />Updates</TabsTrigger>
          </TabsList>

          {/* ─────────── TERMINAL ─────────── */}
          <TabsContent value="terminal" className="flex-1 flex flex-col overflow-hidden m-0 p-0">
            <div className="flex items-center gap-2 px-5 py-2 border-b border-border">
              <Select value={shell} onValueChange={setShell}>
                <SelectTrigger className="w-36 h-8 text-xs" data-testid="trmm-ws-shell-select"><SelectValue /></SelectTrigger>
                <SelectContent>{SHELLS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex items-center gap-1 flex-wrap">
                {quickCmds.map((q) => (
                  <Button key={q.label} size="sm" variant="outline" className="h-7 text-[11px] px-2" onClick={() => executeCommand(q.cmd)} disabled={busy} data-testid={`trmm-ws-quick-${q.label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`}>
                    {q.label}
                  </Button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} /> auto-scroll
                </label>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setLines([])} title="Clear (Ctrl+L)" data-testid="trmm-ws-clear">
                  <X className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => { navigator.clipboard.writeText(lines.map(l => l.text).join("\n")); toast.success("Output copied"); }} title="Copy output">
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div
              ref={outputRef}
              className="flex-1 overflow-y-auto bg-black/60 text-[12px] font-mono px-4 py-3 text-emerald-100"
              data-testid="trmm-ws-terminal-output"
              onClick={() => inputRef.current?.focus()}
            >
              {lines.map(line => (
                <div key={line.id} className={
                  line.kind === "cmd" ? "text-sky-300 whitespace-pre-wrap"
                  : line.kind === "err" ? "text-rose-400 whitespace-pre-wrap"
                  : line.kind === "info" ? "text-zinc-500 whitespace-pre-wrap"
                  : "text-emerald-200 whitespace-pre-wrap"
                }>{line.text}</div>
              ))}
              {busy && <div className="text-zinc-500 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> executing…</div>}
            </div>

            <div className="flex items-center gap-2 px-4 py-2 border-t border-border bg-black/40">
              <span className="text-sky-400 font-mono text-sm select-none">{SHELL_PROMPTS[shell] || "$"}</span>
              <input
                ref={inputRef}
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={onTerminalKey}
                disabled={busy || agent.status !== "online"}
                placeholder={agent.status !== "online" ? "Agent offline — commands will not run" : "Type a command, ↑/↓ for history, Ctrl-L to clear"}
                className="flex-1 bg-transparent border-0 outline-none text-emerald-100 font-mono text-[13px] placeholder:text-zinc-600"
                autoFocus
                data-testid="trmm-ws-terminal-input"
              />
              <Button
                size="sm"
                variant="outline"
                className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 h-7"
                onClick={() => executeCommand(cmd)}
                disabled={busy || !cmd.trim() || agent.status !== "online"}
                data-testid="trmm-ws-terminal-run"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </TabsContent>

          {/* ─────────── SCRIPTS ─────────── */}
          <TabsContent value="scripts" className="flex-1 overflow-hidden m-0 p-0 flex flex-col">
            <div className="flex items-center gap-2 px-5 py-2 border-b border-border flex-wrap">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-7 h-8 w-56 text-xs" placeholder="Search scripts…" value={scriptFilter} onChange={(e) => setScriptFilter(e.target.value)} data-testid="trmm-ws-scripts-search" />
              </div>
              <Select value={shellFilter} onValueChange={setShellFilter}>
                <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All shells</SelectItem>
                  {SHELLS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Label className="text-[10px] text-muted-foreground ml-2">Timeout</Label>
              <Input type="number" value={scriptTimeout} onChange={(e) => setScriptTimeout(Number(e.target.value) || 90)} className="h-8 w-20 text-xs" />
              <Button size="sm" variant="outline" className="h-8" onClick={loadScripts} disabled={scriptsLoading} data-testid="trmm-ws-scripts-reload">
                {scriptsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}Reload
              </Button>
              <span className="text-[10px] text-muted-foreground ml-auto">{filteredScripts.length} of {scripts.length}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-0 flex-1 overflow-hidden">
              {/* Library */}
              <div className="overflow-y-auto border-r border-border">
                {scriptsLoading ? (
                  <div className="p-12 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Loading scripts from TRMM…</div>
                ) : filteredScripts.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground text-sm">{scripts.length === 0 ? "No scripts available (or TRMM request failed)." : "No scripts match filter."}</div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredScripts.map(s => {
                      const fav = favorites.includes(s.id);
                      return (
                        <div key={s.id} className="px-5 py-3 hover:bg-muted/30" data-testid={`trmm-ws-script-row-${s.id}`}>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleFavorite(s.id)}
                              className={`flex-shrink-0 ${fav ? "text-amber-400" : "text-zinc-600 hover:text-amber-400"}`}
                              title={fav ? "Unfavorite" : "Favorite"}
                              data-testid={`trmm-ws-script-fav-${s.id}`}
                            >
                              {fav ? <Star className="w-3.5 h-3.5 fill-current" /> : <StarOff className="w-3.5 h-3.5" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium truncate">{s.name}</span>
                                <Badge variant="outline" className="text-[9px]">{s.shell}</Badge>
                                {s.category && <Badge variant="outline" className="text-[9px] text-indigo-400 border-indigo-500/30">{s.category}</Badge>}
                              </div>
                              {s.description && <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{s.description}</div>}
                              {s.args?.length > 0 && (
                                <Input
                                  className="h-7 text-[11px] font-mono mt-2"
                                  placeholder={`args (default: ${s.args.join(" ")})`}
                                  value={scriptArgs[s.id] || ""}
                                  onChange={(e) => setScriptArgs(a => ({ ...a, [s.id]: e.target.value }))}
                                  data-testid={`trmm-ws-script-args-${s.id}`}
                                />
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 h-7"
                              onClick={() => runScriptById(s)}
                              disabled={scriptRunning === s.id || agent.status !== "online"}
                              data-testid={`trmm-ws-script-run-${s.id}`}
                            >
                              {scriptRunning === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}Run
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Run history */}
              <div className="overflow-y-auto">
                <div className="px-4 py-2 border-b border-border flex items-center justify-between bg-muted/30">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Recent runs</span>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={loadRuns} disabled={runsLoading}>
                    {runsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  </Button>
                </div>
                {runs.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-xs">No runs on this agent yet.</div>
                ) : (
                  <div className="divide-y divide-border">
                    {runs.map(r => (
                      <div key={r.id} className="px-4 py-2">
                        <button
                          onClick={() => setExpandedRun(expandedRun === r.id ? null : r.id)}
                          className="w-full text-left"
                          data-testid={`trmm-ws-run-${r.id}`}
                        >
                          <div className="flex items-center gap-2 text-xs">
                            {r.status === "ok" ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> :
                             r.status === "running" ? <Loader2 className="w-3 h-3 animate-spin text-sky-500" /> :
                             r.status === "failed" ? <XCircle className="w-3 h-3 text-rose-500" /> :
                             <AlertTriangle className="w-3 h-3 text-amber-500" />}
                            <span className="font-medium truncate">{r.label || r.command?.slice(0, 40) || "—"}</span>
                            <Badge variant="outline" className="text-[9px] ml-auto flex-shrink-0">{r.shell}</Badge>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
                            <Clock className="w-2.5 h-2.5" />{timeAgo(r.started_at)}
                            {r.duration_ms != null && <span>· {r.duration_ms}ms</span>}
                            {r.retcode != null && <span>· exit {r.retcode}</span>}
                          </div>
                        </button>
                        {expandedRun === r.id && (
                          <div className="mt-2 bg-black/40 rounded p-2 text-[10px] font-mono max-h-40 overflow-auto">
                            {r.stdout && <pre className="text-emerald-200 whitespace-pre-wrap">{r.stdout.slice(0, 4000)}</pre>}
                            {r.stderr && <pre className="text-rose-400 whitespace-pre-wrap">{r.stderr.slice(0, 2000)}</pre>}
                            {!r.stdout && !r.stderr && <div className="text-zinc-500">(no output captured)</div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ─────────── SERVICES ─────────── */}
          <TabsContent value="services" className="flex-1 overflow-hidden m-0 p-0 flex flex-col">
            <div className="flex items-center gap-2 px-5 py-2 border-b border-border">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-7 h-8 w-64 text-xs" placeholder="Filter services…" value={svcFilter} onChange={(e) => setSvcFilter(e.target.value)} data-testid="trmm-ws-services-search" />
              </div>
              <Button size="sm" variant="outline" className="h-8" onClick={loadServices} disabled={servicesLoading}>
                {servicesLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}Reload
              </Button>
              <span className="text-[10px] text-muted-foreground ml-auto">{filteredServices.length} / {services.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {servicesLoading ? (
                <div className="p-12 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Loading services…</div>
              ) : filteredServices.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground text-sm">No services found (agent may be offline or endpoint not supported).</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredServices.map(s => (
                      <TableRow key={s.name} data-testid={`trmm-ws-svc-row-${s.name}`}>
                        <TableCell>
                          <div className="text-sm">{s.display_name || s.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{s.name}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            s.status === "running" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" :
                            s.status === "stopped" ? "text-rose-400 border-rose-500/30 bg-rose-500/5" :
                            "text-zinc-400"
                          }>{s.status || "—"}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{s.start_type || "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <Button size="sm" variant="outline" className="h-7 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => svcAction(s, "start")} disabled={svcBusy[`${s.name}:start`] || s.status === "running"} data-testid={`trmm-ws-svc-start-${s.name}`}><Play className="w-3 h-3" /></Button>
                            <Button size="sm" variant="outline" className="h-7 text-rose-400 border-rose-500/30 hover:bg-rose-500/10" onClick={() => svcAction(s, "stop")} disabled={svcBusy[`${s.name}:stop`] || s.status !== "running"} data-testid={`trmm-ws-svc-stop-${s.name}`}><Square className="w-3 h-3" /></Button>
                            <Button size="sm" variant="outline" className="h-7 text-amber-400 border-amber-500/30 hover:bg-amber-500/10" onClick={() => svcAction(s, "restart")} disabled={svcBusy[`${s.name}:restart`]} data-testid={`trmm-ws-svc-restart-${s.name}`}><RefreshCw className="w-3 h-3" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          {/* ─────────── PROCESSES ─────────── */}
          <TabsContent value="processes" className="flex-1 overflow-hidden m-0 p-0 flex flex-col">
            <div className="flex items-center gap-2 px-5 py-2 border-b border-border">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-7 h-8 w-64 text-xs" placeholder="Filter by name/user/pid…" value={procFilter} onChange={(e) => setProcFilter(e.target.value)} data-testid="trmm-ws-procs-search" />
              </div>
              <Select value={procSort} onValueChange={setProcSort}>
                <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cpu_percent">CPU %</SelectItem>
                  <SelectItem value="mem_mb">Memory</SelectItem>
                  <SelectItem value="pid">PID</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="h-8" onClick={loadProcesses} disabled={procLoading}>
                {procLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}Reload
              </Button>
              <span className="text-[10px] text-muted-foreground ml-auto">{filteredProcs.length} / {processes.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {procLoading ? (
                <div className="p-12 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Loading processes…</div>
              ) : filteredProcs.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground text-sm">No processes found.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead className="text-right">CPU %</TableHead>
                      <TableHead className="text-right">Memory</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProcs.slice(0, 300).map(p => (
                      <TableRow key={p.pid} data-testid={`trmm-ws-proc-${p.pid}`}>
                        <TableCell className="font-mono text-xs">{p.pid}</TableCell>
                        <TableCell className="text-sm">{p.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{p.username || "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{Math.round(p.cpu_percent || 0)}%</TableCell>
                        <TableCell className="text-right font-mono text-xs">{p.mem_mb ? `${Math.round(p.mem_mb)} MB` : "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" className="h-6 text-rose-400 hover:bg-rose-500/10" onClick={() => killProcess(p.pid, p.name)} data-testid={`trmm-ws-proc-kill-${p.pid}`}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          {/* ─────────── SOFTWARE ─────────── */}
          <TabsContent value="software" className="flex-1 overflow-hidden m-0 p-0 flex flex-col">
            <div className="flex items-center gap-2 px-5 py-2 border-b border-border">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-7 h-8 w-64 text-xs" placeholder="Filter software…" value={swFilter} onChange={(e) => setSwFilter(e.target.value)} data-testid="trmm-ws-sw-search" />
              </div>
              <Button size="sm" variant="outline" className="h-8" onClick={loadSoftware} disabled={softLoading}>
                {softLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}Reload
              </Button>
              <span className="text-[10px] text-muted-foreground ml-auto">{filteredSoftware.length} / {software.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {softLoading ? (
                <div className="p-12 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Loading inventory…</div>
              ) : filteredSoftware.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground text-sm">No software inventory available.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Publisher</TableHead>
                      <TableHead>Installed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSoftware.slice(0, 500).map((s, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{s.name}</TableCell>
                        <TableCell className="font-mono text-xs">{s.version || "—"}</TableCell>
                        <TableCell className="text-xs">{s.publisher || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.install_date || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          {/* ─────────── UPDATES ─────────── */}
          <TabsContent value="updates" className="flex-1 overflow-hidden m-0 p-0 flex flex-col">
            <div className="flex items-center gap-2 px-5 py-2 border-b border-border">
              <Button size="sm" variant="outline" className="h-8" onClick={loadUpdates} disabled={updatesLoading}>
                {updatesLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}Reload
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
                disabled={agent.status !== "online"}
                onClick={async () => {
                  try {
                    const res = await axios.post(`${API}/trmm/agents/${agentId}/install-patches`, {}, { headers });
                    toast.success(res.data?.message || "Patch install queued");
                  } catch (e) { toast.error(e.response?.data?.detail || e.message); }
                }}
                data-testid="trmm-ws-install-patches"
              >
                <Download className="w-3.5 h-3.5 mr-1" />Install pending
              </Button>
              <span className="text-[10px] text-muted-foreground ml-auto">{updates.length} updates</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {updatesLoading ? (
                <div className="p-12 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Loading Windows updates…</div>
              ) : updates.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground text-sm">No pending updates (or not Windows).</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>KB</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {updates.map(u => (
                      <TableRow key={u.guid || u.kb}>
                        <TableCell className="font-mono text-xs">{u.kb || "—"}</TableCell>
                        <TableCell className="text-sm">{u.title}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{u.severity || "—"}</Badge></TableCell>
                        <TableCell>
                          {u.installed ? <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 bg-emerald-500/5 text-[10px]">installed</Badge>
                          : u.downloaded ? <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/5 text-[10px]">downloaded</Badge>
                          : <Badge variant="outline" className="text-zinc-400 text-[10px]">pending</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
