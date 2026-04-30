import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Radio, Terminal, FileCode, Play, Loader2, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, ChevronDown, ChevronRight,
} from "lucide-react";

const SHELLS = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "bash", label: "Bash" },
  { value: "python", label: "Python" },
];

const STATUS_META = {
  queued:   { icon: Loader2, cls: "text-zinc-400", label: "Queued", spin: false },
  running:  { icon: Loader2, cls: "text-sky-400", label: "Running", spin: true },
  ok:       { icon: CheckCircle2, cls: "text-emerald-400", label: "Success", spin: false },
  failed:   { icon: XCircle, cls: "text-rose-400", label: "Failed", spin: false },
  error:    { icon: AlertTriangle, cls: "text-amber-400", label: "Error", spin: false },
};

function progressPct(d) {
  if (!d?.total) return 0;
  return Math.min(100, Math.round((d.completed / d.total) * 100));
}

/**
 * Multi-agent terminal broadcast dialog + live output grid.
 * Sends a single command or saved script to N agents concurrently via TRMM,
 * polls GET /trmm/broadcasts/{id} until complete, and renders per-agent cards
 * with expandable stdout/stderr.
 */
export default function TrmmBroadcastDialog({ open, onClose, selectedAgents }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [mode, setMode] = useState("command"); // command | script
  const [command, setCommand] = useState("");
  const [shell, setShell] = useState("powershell");
  const [timeout, setTimeout_] = useState(60);
  const [concurrency, setConcurrency] = useState(8);
  const [label, setLabel] = useState("");

  const [scripts, setScripts] = useState([]);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [scriptId, setScriptId] = useState("");
  const [scriptArgs, setScriptArgs] = useState("");
  const [scriptFilter, setScriptFilter] = useState("");

  const [broadcast, setBroadcast] = useState(null); // running state from backend
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState({}); // per-agent expand flags

  // reset when dialog opens
  useEffect(() => {
    if (open) {
      setBroadcast(null);
      setCommand("");
      setLabel("");
      setExpanded({});
      // Default shell based on first agent's platform
      const first = selectedAgents?.[0];
      setShell(first?.plat === "linux" || first?.plat === "darwin" ? "bash" : "powershell");
    }
  }, [open, selectedAgents]);

  // Fetch scripts once when switching to script mode
  useEffect(() => {
    if (!open || mode !== "script" || scripts.length > 0) return;
    (async () => {
      setScriptsLoading(true);
      try {
        const res = await axios.get(`${API}/trmm/scripts`, { headers });
        setScripts(res.data || []);
      } catch (e) {
        toast.error("Scripts load failed: " + (e.response?.data?.detail || e.message));
      } finally { setScriptsLoading(false); }
    })();
  }, [open, mode, scripts.length, headers]);

  // Poll broadcast progress every 1.5s while running
  useEffect(() => {
    if (!broadcast?.id || broadcast.status === "complete") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await axios.get(`${API}/trmm/broadcasts/${broadcast.id}`, { headers });
        if (!cancelled) setBroadcast(res.data);
      } catch {}
    };
    const iv = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(iv); };
  }, [broadcast?.id, broadcast?.status, headers]);

  const filteredScripts = useMemo(() => {
    if (!scriptFilter.trim()) return scripts;
    const q = scriptFilter.toLowerCase();
    return scripts.filter(s => [s.name, s.description, s.category].some(v => (v || "").toLowerCase().includes(q)));
  }, [scripts, scriptFilter]);

  const onlineSelected = useMemo(() => (selectedAgents || []).filter(a => a.status === "online"), [selectedAgents]);
  const offlineSelected = useMemo(() => (selectedAgents || []).filter(a => a.status !== "online"), [selectedAgents]);

  const startBroadcast = async () => {
    if (onlineSelected.length === 0) { toast.error("Select at least one ONLINE agent"); return; }
    if (mode === "command" && !command.trim()) { toast.error("Enter a command"); return; }
    if (mode === "script" && !scriptId) { toast.error("Pick a script"); return; }
    const args = scriptArgs.trim() ? scriptArgs.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(a => a.replace(/^"|"$/g, "")) || [] : [];
    setStarting(true);
    try {
      const payload = {
        agent_ids: onlineSelected.map(a => a.agent_id || a.id),
        shell,
        timeout: Number(timeout) || 60,
        concurrency: Number(concurrency) || 8,
        label: label || undefined,
      };
      if (mode === "command") payload.command = command;
      else { payload.script_id = Number(scriptId); payload.args = args; }
      const res = await axios.post(`${API}/trmm/broadcast`, payload, { headers });
      if (res.data?.success) {
        toast.success(`Broadcast queued to ${res.data.total} agents`);
        const bdoc = await axios.get(`${API}/trmm/broadcasts/${res.data.broadcast_id}`, { headers });
        setBroadcast(bdoc.data);
      } else {
        toast.error(res.data?.message || "Broadcast failed");
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally { setStarting(false); }
  };

  // Running view → render live grid
  const pct = progressPct(broadcast);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); } }}>
      <DialogContent className="max-w-[min(1400px,96vw)] h-[min(900px,92vh)] p-0 flex flex-col" data-testid="trmm-broadcast-dialog">
        <DialogHeader className="px-5 py-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Radio className="w-4 h-4 text-violet-500" />
            Broadcast {broadcast ? `· ${broadcast.label || "command"}` : `to ${selectedAgents?.length || 0} agents`}
            {broadcast && (
              <Badge variant="outline" className="ml-2 text-[10px]">
                {broadcast.completed}/{broadcast.total} · {pct}%
                {broadcast.status === "complete" ? " · done" : " · running"}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {broadcast
              ? `${broadcast.succeeded || 0} succeeded · ${broadcast.failed_count || 0} failed · concurrency ${broadcast.concurrency}`
              : `Runs one command or script across every selected ONLINE agent concurrently. Results captured to each agent's run history.`}
          </DialogDescription>
        </DialogHeader>

        {!broadcast ? (
          <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
            {offlineSelected.length > 0 && (
              <div className="border border-amber-500/20 bg-amber-500/5 rounded-md p-3 text-[11px] text-amber-300">
                {offlineSelected.length} offline agent(s) in selection will be skipped: {offlineSelected.slice(0, 6).map(a => a.hostname).join(", ")}{offlineSelected.length > 6 ? "…" : ""}
              </div>
            )}

            <Tabs value={mode} onValueChange={setMode}>
              <TabsList className="bg-muted/40">
                <TabsTrigger value="command" data-testid="bcast-tab-command"><Terminal className="w-3.5 h-3.5 mr-1" />Ad-hoc command</TabsTrigger>
                <TabsTrigger value="script" data-testid="bcast-tab-script"><FileCode className="w-3.5 h-3.5 mr-1" />Saved script</TabsTrigger>
              </TabsList>

              <TabsContent value="command" className="mt-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_120px] gap-3">
                  <div>
                    <Label className="text-xs">Command</Label>
                    <Textarea
                      rows={6}
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder={shell === "bash" ? "uptime && df -h" : "Get-Service | Where-Object {$_.Status -eq 'Running'}"}
                      className="font-mono text-xs"
                      data-testid="bcast-command"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Shell</Label>
                    <Select value={shell} onValueChange={setShell}>
                      <SelectTrigger data-testid="bcast-shell"><SelectValue /></SelectTrigger>
                      <SelectContent>{SHELLS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Timeout (s)</Label>
                    <Input type="number" value={timeout} onChange={(e) => setTimeout_(e.target.value)} data-testid="bcast-timeout" />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="script" className="mt-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-3">
                  <div>
                    <Label className="text-xs">Pick a script</Label>
                    <Input placeholder="Search scripts…" value={scriptFilter} onChange={(e) => setScriptFilter(e.target.value)} className="mb-2" data-testid="bcast-script-search" />
                    <div className="border border-border rounded-md max-h-56 overflow-auto divide-y divide-border" data-testid="bcast-script-list">
                      {scriptsLoading ? (
                        <div className="p-6 text-center text-muted-foreground text-xs"><Loader2 className="w-3 h-3 animate-spin inline mr-1" /> Loading…</div>
                      ) : filteredScripts.length === 0 ? (
                        <div className="p-6 text-center text-muted-foreground text-xs">No scripts {scripts.length === 0 ? "(TRMM not reachable?)" : "match filter"}.</div>
                      ) : filteredScripts.map(s => (
                        <button
                          key={s.id}
                          onClick={() => { setScriptId(String(s.id)); setShell(s.shell || shell); }}
                          className={`w-full text-left px-3 py-2 hover:bg-muted/50 ${String(scriptId) === String(s.id) ? "bg-violet-500/10 border-l-2 border-violet-500" : ""}`}
                          data-testid={`bcast-script-opt-${s.id}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium truncate">{s.name}</span>
                            <Badge variant="outline" className="text-[9px]">{s.shell}</Badge>
                            {s.category && <Badge variant="outline" className="text-[9px] text-indigo-400 border-indigo-500/30">{s.category}</Badge>}
                          </div>
                          {s.description && <div className="text-[10px] text-muted-foreground truncate">{s.description}</div>}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">Args</Label>
                      <Input placeholder='e.g. "C:\path" flag' value={scriptArgs} onChange={(e) => setScriptArgs(e.target.value)} className="font-mono text-xs" data-testid="bcast-script-args" />
                    </div>
                    <div>
                      <Label className="text-xs">Timeout (s)</Label>
                      <Input type="number" value={timeout} onChange={(e) => setTimeout_(e.target.value)} data-testid="bcast-timeout-2" />
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_200px_200px] gap-3 border-t border-border pt-3">
              <div>
                <Label className="text-xs">Label (optional)</Label>
                <Input placeholder="Incident #124 rollback" value={label} onChange={(e) => setLabel(e.target.value)} data-testid="bcast-label" />
              </div>
              <div>
                <Label className="text-xs">Concurrency</Label>
                <Input type="number" min={1} max={20} value={concurrency} onChange={(e) => setConcurrency(e.target.value)} data-testid="bcast-concurrency" />
              </div>
              <div className="flex items-end">
                <div className="text-[10px] text-muted-foreground leading-tight">
                  {onlineSelected.length} online / {selectedAgents?.length || 0} selected
                </div>
              </div>
            </div>

            <div className="border border-border rounded-md p-3 bg-muted/20">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Targets</div>
              <div className="flex flex-wrap gap-1 max-h-32 overflow-auto">
                {(selectedAgents || []).map(a => (
                  <Badge key={a.agent_id || a.id} variant="outline" className={`text-[10px] ${a.status === "online" ? "text-emerald-400 border-emerald-500/30" : "text-rose-400 border-rose-500/30 opacity-70"}`}>
                    {a.hostname}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <BroadcastLiveGrid broadcast={broadcast} expanded={expanded} setExpanded={setExpanded} />
        )}

        <DialogFooter className="px-5 py-3 border-t border-border">
          {!broadcast ? (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={startBroadcast}
                disabled={starting || onlineSelected.length === 0 || (mode === "command" && !command.trim()) || (mode === "script" && !scriptId)}
                variant="outline"
                className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
                data-testid="bcast-start-btn"
              >
                {starting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Play className="w-4 h-4 mr-1" />}
                Broadcast to {onlineSelected.length} agent{onlineSelected.length === 1 ? "" : "s"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setBroadcast(null)} data-testid="bcast-new-btn">
                New broadcast
              </Button>
              <Button variant="outline" onClick={onClose} data-testid="bcast-close-btn">Close</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BroadcastLiveGrid({ broadcast, expanded, setExpanded }) {
  const pct = progressPct(broadcast);
  const sorted = useMemo(() => {
    const order = { running: 0, queued: 1, error: 2, failed: 3, ok: 4 };
    return [...(broadcast.agents || [])].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [broadcast]);
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="px-5 py-2 border-b border-border flex items-center gap-3 bg-muted/20">
        <div className="flex-1 h-1.5 rounded-full bg-zinc-700 overflow-hidden">
          <div className="h-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[11px] text-muted-foreground">{pct}%</span>
      </div>
      <div className="flex-1 overflow-auto p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="bcast-live-grid">
        {sorted.map((a) => {
          const meta = STATUS_META[a.status] || STATUS_META.queued;
          const Icon = meta.icon;
          const exp = expanded[a.agent_id];
          return (
            <div key={a.agent_id} className="border border-border rounded-md bg-muted/20 overflow-hidden" data-testid={`bcast-card-${a.agent_id}`}>
              <button
                onClick={() => setExpanded(m => ({ ...m, [a.agent_id]: !exp }))}
                className="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted/30 text-left"
              >
                <Icon className={`w-3.5 h-3.5 ${meta.cls} ${meta.spin ? "animate-spin" : ""}`} />
                <span className="text-xs font-medium truncate flex-1 font-mono">{a.agent_id.slice(0, 18)}</span>
                <Badge variant="outline" className={`text-[9px] ${meta.cls}`}>{meta.label}</Badge>
                {a.retcode != null && <span className="text-[10px] text-muted-foreground">{a.duration_ms}ms · exit {a.retcode}</span>}
                {exp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              {exp && (
                <div className="bg-black/60 px-3 py-2 border-t border-border text-[10px] font-mono max-h-48 overflow-auto">
                  {a.stdout_preview && <pre className="text-emerald-200 whitespace-pre-wrap">{a.stdout_preview}</pre>}
                  {a.stderr_preview && <pre className="text-rose-400 whitespace-pre-wrap">{a.stderr_preview}</pre>}
                  {a.message && <pre className="text-amber-400 whitespace-pre-wrap">{a.message}</pre>}
                  {!a.stdout_preview && !a.stderr_preview && !a.message && <div className="text-zinc-500">(no output yet)</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
