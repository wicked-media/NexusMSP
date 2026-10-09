import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { ArrowLeft, CheckCircle2, Clock3, Download, FolderOpen, Loader2, MonitorCog, RefreshCw, Send, Square, Terminal, Upload } from "lucide-react";
import { toast } from "sonner";

const COMMAND_STATUS_STYLE = {
  queued: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  completed: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  failed: "text-rose-300 border-rose-500/30 bg-rose-500/10",
  timeout: "text-rose-300 border-rose-500/30 bg-rose-500/10",
};

const TRANSFER_STATUS_STYLE = {
  queued: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  dispatched: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  staged: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  cancelled: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
};

const transferStatusHint = (transfer) => {
  const status = String(transfer?.status || "queued").toLowerCase();
  if (status === "staged") return "Ready for a private download.";
  if (status === "failed") return "The Agent could not complete this request. Check the endpoint connection, then submit a new request.";
  if (status === "queued" || status === "dispatched") return "Waiting for the endpoint Agent to report back.";
  if (status === "completed") return "Completed and recorded in the transfer audit trail.";
  return "Reported by the endpoint Agent.";
};

const formatElapsed = (seconds) => {
  const total = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(total / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = total % 60;
  if (hours) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
};

const parentDirectory = (directory) => {
  const value = String(directory || "").trim();
  if (!value || value === "/") return "";
  const normalized = value.replace(/[\\/]+$/, "");
  if (!normalized || /^[A-Za-z]:$/.test(normalized)) return "";
  const lastSeparator = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  if (lastSeparator < 0) return "";
  const parent = normalized.slice(0, lastSeparator);
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent || "/";
};

export default function DeviceTerminalPage() {
  const [searchParams] = useSearchParams();
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [devices, setDevices] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [shell, setShell] = useState("powershell");
  const [transferFile, setTransferFile] = useState(null);
  const [transferDestination, setTransferDestination] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [retrievalPath, setRetrievalPath] = useState("");
  const [retrieving, setRetrieving] = useState(false);
  const [transfers, setTransfers] = useState([]);
  const [browsePath, setBrowsePath] = useState("C:\\");
  const [browserEntries, setBrowserEntries] = useState([]);
  const [browsing, setBrowsing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const transcriptRef = useRef(null);
  const inputRef = useRef(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [deviceResponse, sessionResponse] = await Promise.all([
        axios.get(`${API}/devices?status=online`, { headers }),
        axios.get(`${API}/device-terminal/sessions`, { headers }),
      ]);
      setDevices((deviceResponse.data || []).filter((device) => device.nexus_agent_id));
      setSessions(sessionResponse.data || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not load command-console data");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const requestedDevice = searchParams.get("deviceId");
    if (requestedDevice && devices.some(device => device.id === requestedDevice)) setSelectedDevice(requestedDevice);
  }, [devices, searchParams]);

  useEffect(() => {
    if (!activeSession?.started_at) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeSession?.started_at]);

  const refreshActiveSession = useCallback(async () => {
    if (!activeSession?.id) return;
    try {
      const response = await axios.get(`${API}/device-terminal/sessions/${activeSession.id}`, { headers });
      setActiveSession(response.data);
      const { commands: _commands, ...sessionSummary } = response.data;
      setSessions((previous) => previous.map((session) => session.id === sessionSummary.id ? { ...session, ...sessionSummary } : session));
    } catch (error) {
      if (error.response?.status === 404) {
        toast.error("This command session is no longer available");
        setActiveSession(null);
      }
    }
  }, [activeSession?.id, headers]);

  useEffect(() => {
    if (!activeSession?.id) return undefined;
    refreshActiveSession();
    const interval = window.setInterval(refreshActiveSession, 2000);
    return () => window.clearInterval(interval);
  }, [activeSession?.id, refreshActiveSession]);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [activeSession?.commands]);

  const startSession = async () => {
    if (!selectedDevice) { toast.error("Select an online asset with Nexus Agent"); return; }
    try {
      const response = await axios.post(`${API}/device-terminal/sessions`, { device_id: selectedDevice, session_type: shell }, { headers });
      setActiveSession(response.data);
      toast.success(`Command console opened for ${response.data.device_name}`);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not open command console");
    }
  };

  const executeCommand = async (event) => {
    event.preventDefault();
    if (!command.trim() || !activeSession) return;
    const submitted = command.trim();
    setCommand("");
    setExecuting(true);
    try {
      const response = await axios.post(`${API}/device-terminal/sessions/${activeSession.id}/execute`, { command: submitted }, { headers });
      setActiveSession((session) => ({ ...session, commands: [...(session?.commands || []), { id: response.data.command_id, command: submitted, status: "queued", queued_at: new Date().toISOString() }] }));
      toast.success("Command queued for Nexus Agent");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Command was not queued");
    } finally {
      setExecuting(false);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const endSession = async () => {
    if (!activeSession) return;
    try {
      await axios.post(`${API}/device-terminal/sessions/${activeSession.id}/end`, {}, { headers });
      toast.success("Command console closed");
      setActiveSession(null);
      load({ silent: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not close command console");
    }
  };

  const resumeSession = async (sessionId) => {
    try {
      const response = await axios.get(`${API}/device-terminal/sessions/${sessionId}`, { headers });
      setActiveSession(response.data);
      setSelectedDevice(response.data.device_id);
      toast.success("Console session resumed", { description: "Command results are polling live." });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not resume command console");
    }
  };

  const stageTransfer = async (event) => {
    event.preventDefault();
    if (!selectedDevice || !transferFile || !transferDestination.trim()) {
      toast.error("Select an asset, file, and endpoint destination");
      return;
    }
    const form = new FormData();
    form.append("file", transferFile);
    form.append("destination", transferDestination.trim());
    setTransferring(true);
    try {
      const response = await axios.post(`${API}/devices/${selectedDevice}/file-transfers`, form, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(`Transfer queued: ${response.data.filename}`);
      setTransferFile(null);
      setTransferDestination("");
    } catch (error) {
      toast.error(error.response?.data?.detail || "File transfer was not queued");
    } finally {
      setTransferring(false);
    }
  };

  const loadTransfers = useCallback(async () => {
    if (!selectedDevice) { setTransfers([]); return; }
    try {
      const response = await axios.get(`${API}/devices/${selectedDevice}/file-transfers`, { headers });
      setTransfers(response.data || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not load transfer history");
    }
  }, [headers, selectedDevice]);

  useEffect(() => {
    loadTransfers();
    if (!selectedDevice) return undefined;
    const interval = window.setInterval(loadTransfers, 3000);
    return () => window.clearInterval(interval);
  }, [loadTransfers, selectedDevice]);

  const requestRetrieval = async (event) => {
    event.preventDefault();
    if (!selectedDevice || !retrievalPath.trim()) { toast.error("Select an asset and enter one endpoint file path"); return; }
    const form = new FormData();
    form.append("source_path", retrievalPath.trim());
    setRetrieving(true);
    try {
      const response = await axios.post(`${API}/devices/${selectedDevice}/file-retrievals`, form, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(`Retrieval queued: ${response.data.filename}`);
      setRetrievalPath("");
      loadTransfers();
    } catch (error) {
      toast.error(error.response?.data?.detail || "File retrieval was not queued");
    } finally { setRetrieving(false); }
  };

  const downloadTransfer = async (transfer) => {
    try {
      const response = await axios.get(`${API}/devices/${selectedDevice}/file-transfers/${transfer.id}/download`, { headers, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = transfer.filename || "retrieved-file"; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { toast.error(error.response?.data?.detail || "Retrieved file is unavailable"); }
  };

  const browseDirectory = async (directory = browsePath || "C:\\") => {
    const device = devices.find((item) => item.id === selectedDevice);
    if (!device) { toast.error("Select an online asset with Nexus Agent"); return; }
    setBrowsing(true);
    try {
      const queued = await axios.post(`${API}/devices/${selectedDevice}/file-browser/list`, { directory: directory.trim() }, { headers });
      const commandId = queued.data.command_id;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const commands = await axios.get(`${API}/nexus-agent/agents/${device.nexus_agent_id}/commands`, { headers });
        const commandResult = (commands.data || []).find((item) => item.id === commandId);
        if (commandResult?.status === "ok") {
          const listing = JSON.parse(commandResult.stdout || "{}");
          setBrowsePath(listing.directory || directory.trim());
          setBrowserEntries(listing.entries || []);
          return;
        }
        if (["error", "timeout"].includes(commandResult?.status)) throw new Error(commandResult.stderr || "Endpoint could not list this directory");
      }
      throw new Error("Directory listing is still waiting for the endpoint")
    } catch (error) { toast.error(error.response?.data?.detail || error.message || "Directory listing failed"); }
    finally { setBrowsing(false); }
  };

  const commands = activeSession?.commands || [];
  const completed = commands.filter((item) => item.status === "completed").length;
  const pending = commands.filter((item) => item.status === "queued").length;
  const prompt = activeSession?.session_type === "cmd" ? `${activeSession.device_name}>` : `PS ${activeSession?.device_name}>`;
  const sessionElapsed = activeSession?.started_at
    ? Math.floor((now - new Date(activeSession.started_at).getTime()) / 1000)
    : 0;
  const parentBrowsePath = parentDirectory(browsePath);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="device-terminal-page">
      <OperationalPageHeader
        eyebrow="Managed assets"
        title="Agent Command Console"
        description="Run PowerShell or CMD through Nexus Agent. This is an audited command queue, not a simulated shell: output appears only after the endpoint returns it."
        icon={Terminal}
        tone="emerald"
        actions={<Button variant="outline" onClick={() => load({ silent: true })}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh</Button>}
      />

      <MetricStrip columns={4}>
        <MetricTile label="Eligible assets" value={devices.length} accent="emerald" icon={<MonitorCog className="h-3 w-3 text-emerald-400" />} />
        <MetricTile label="My sessions" value={sessions.length} accent="sky" icon={<Terminal className="h-3 w-3 text-sky-400" />} />
        <MetricTile label="Queued commands" value={pending} accent="amber" icon={<Clock3 className="h-3 w-3 text-amber-400" />} />
        <MetricTile label="Returned results" value={completed} accent="emerald" icon={<CheckCircle2 className="h-3 w-3 text-emerald-400" />} />
      </MetricStrip>

      {!activeSession ? <Card data-testid="connect-bar"><CardHeader><CardTitle className="text-base">Open command console</CardTitle><p className="text-xs text-muted-foreground">Only online assets enrolled in Nexus Agent are listed.</p></CardHeader><CardContent className="flex flex-col gap-3 sm:flex-row">
        <Select value={selectedDevice} onValueChange={setSelectedDevice}><SelectTrigger className="sm:w-[360px]" data-testid="device-select"><SelectValue placeholder="Select managed asset" /></SelectTrigger><SelectContent>{devices.map((device) => <SelectItem key={device.id} value={device.id}>{device.name} {device.client_name ? `- ${device.client_name}` : ""}</SelectItem>)}</SelectContent></Select>
        <Select value={shell} onValueChange={setShell}><SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="powershell">PowerShell</SelectItem><SelectItem value="cmd">Command prompt</SelectItem></SelectContent></Select>
        <Button onClick={startSession} data-testid="start-session-btn"><Terminal className="mr-1.5 h-4 w-4" />Open console</Button>
      </CardContent></Card> : <>
        <Card className="border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.08] via-card to-card shadow-sm"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /><span className="font-medium">{activeSession.device_name}</span><Badge variant="outline" className="text-[10px]">{activeSession.session_type}</Badge><Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Live · {formatElapsed(sessionElapsed)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{activeSession.ip_address || "No IP recorded"} | {activeSession.os || "Unknown OS"} | Result polling every 2 seconds</p><p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Audited agent session — commands and results are retained in the activity record.</p></div><Button size="sm" variant="destructive" onClick={endSession} data-testid="end-session-btn"><Square className="mr-1.5 h-3.5 w-3.5" />End console</Button></CardContent></Card>

        <Card className="overflow-hidden border-zinc-800 bg-[#0d1117]"><div ref={transcriptRef} className="max-h-[50vh] min-h-[340px] overflow-y-auto p-4 font-mono text-sm" data-testid="terminal-output">
          {commands.length === 0 ? <div className="py-24 text-center text-sm text-zinc-500"><Terminal className="mx-auto mb-3 h-10 w-10 opacity-40" /><p>Console ready. Commands will be queued to the selected Nexus Agent.</p></div> : commands.map((item) => <div key={item.id} className="mb-4"><div className="flex flex-wrap items-center gap-2 text-emerald-300"><span>{prompt}</span><span className="text-zinc-100">{item.command}</span><Badge variant="outline" className={`font-sans text-[9px] ${COMMAND_STATUS_STYLE[item.status] || COMMAND_STATUS_STYLE.queued}`}>{item.status}</Badge></div>{item.status === "queued" ? <p className="mt-1 pl-2 text-xs text-amber-300">Waiting for the endpoint to return a result...</p> : <pre className={`mt-2 whitespace-pre-wrap border-l-2 pl-3 text-xs ${item.status === "completed" ? "border-emerald-500/40 text-zinc-200" : "border-rose-500/50 text-rose-200"}`}>{item.output || item.stderr || "Command returned no output."}{item.exit_code != null && <span className="mt-2 block text-[10px] text-zinc-500">Exit code {item.exit_code}{item.duration_ms != null ? ` | ${item.duration_ms} ms` : ""}</span>}</pre>}</div>)}
        </div><form onSubmit={executeCommand} className="border-t border-zinc-800 p-3"><div className="flex items-center gap-2"><span className="shrink-0 font-mono text-sm text-emerald-300">{prompt}</span><Input ref={inputRef} value={command} onChange={(event) => setCommand(event.target.value)} disabled={executing} className="border-0 bg-transparent font-mono text-white shadow-none focus-visible:ring-0" placeholder="Enter a command to queue..." data-testid="command-input" /><Button type="submit" size="sm" disabled={executing || !command.trim()}>{executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}</Button></div><p className="mt-2 pl-0 text-[11px] text-zinc-500">Commands run in the endpoint agent context and are permanently recorded for this session.</p></form></Card>
      </>}

      {!activeSession && sessions.length > 0 && <Card><CardHeader><CardTitle className="text-base">Recent command sessions</CardTitle></CardHeader><CardContent className="space-y-2">{sessions.slice(0, 8).map((session) => <div key={session.id} className="flex items-center justify-between rounded-lg border border-border/70 p-3"><div><p className="text-sm font-medium">{session.device_name}</p><p className="mt-1 text-xs text-muted-foreground">{session.session_type} | {new Date(session.started_at).toLocaleString()}</p></div><div className="flex items-center gap-2"><Badge variant="outline" className="capitalize">{session.status}</Badge>{session.status === "active" && <Button variant="outline" size="sm" onClick={() => resumeSession(session.id)}>Resume</Button>}</div></div>)}</CardContent></Card>}

      {selectedDevice && <Card><CardHeader><CardTitle className="text-base">Send a file to an endpoint</CardTitle><p className="text-xs text-muted-foreground">Scanned, hash-verified transfer. Nexus will not overwrite files or create missing folders on the endpoint.</p></CardHeader><CardContent><form onSubmit={stageTransfer} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"><label className="grid gap-1.5 text-xs font-medium">File<input type="file" className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-xs file:font-medium" onChange={(event) => setTransferFile(event.target.files?.[0] || null)} /></label><label className="grid gap-1.5 text-xs font-medium">Endpoint destination<Input value={transferDestination} onChange={(event) => setTransferDestination(event.target.value)} placeholder="C:\\Temp\\support-tool.zip" /></label><Button type="submit" disabled={transferring}><Upload className="mr-1.5 h-4 w-4" />{transferring ? "Staging…" : "Queue transfer"}</Button></form></CardContent></Card>}

      {selectedDevice && <Card><CardHeader><CardTitle className="text-base">Retrieve a file from an endpoint</CardTitle><p className="text-xs text-muted-foreground">Request one existing file. The Agent scans and privately stages it before download.</p></CardHeader><CardContent><form onSubmit={requestRetrieval} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"><label className="grid gap-1.5 text-xs font-medium">Endpoint source file<Input value={retrievalPath} onChange={(event) => setRetrievalPath(event.target.value)} placeholder="C:\\Logs\\application.log" /></label><Button type="submit" variant="outline" disabled={retrieving}><Download className="mr-1.5 h-4 w-4" />{retrieving ? "Requesting…" : "Retrieve file"}</Button></form></CardContent></Card>}

      {selectedDevice && <Card><CardHeader><CardTitle className="text-base">Browse endpoint folders</CardTitle><p className="text-xs text-muted-foreground">Read-only, bounded listings from the active Nexus Agent. Start at the system drive or open a folder to continue.</p></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => browseDirectory("C:\\")} disabled={browsing}><FolderOpen className="mr-1.5 h-3.5 w-3.5" />System drive (C:)</Button><Button type="button" size="sm" variant="outline" onClick={() => browseDirectory(parentBrowsePath)} disabled={browsing || !parentBrowsePath} title={parentBrowsePath ? `Back to ${parentBrowsePath}` : "Already at the endpoint root"}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />Up one folder</Button><span className="self-center text-xs text-muted-foreground">Uses the endpoint agent’s local read access.</span></div><form onSubmit={(event) => { event.preventDefault(); browseDirectory(); }} className="flex gap-2"><Input value={browsePath} onChange={(event) => setBrowsePath(event.target.value)} placeholder="C:\\Logs" /><Button type="submit" disabled={browsing}><FolderOpen className="mr-1.5 h-4 w-4" />{browsing ? "Listing…" : "Browse"}</Button></form>{browserEntries.length > 0 && <div className="overflow-hidden rounded-lg border border-border/70">{browserEntries.map((entry) => <button key={entry.path} type="button" className="flex w-full items-center gap-3 border-b border-border/60 p-3 text-left last:border-0 hover:bg-muted/50 disabled:cursor-default" disabled={!entry.directory} onClick={() => entry.directory && browseDirectory(entry.path)}><FolderOpen className={`h-4 w-4 ${entry.directory ? "text-sky-400" : "text-muted-foreground"}`} /><span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span><span className="text-xs text-muted-foreground">{entry.directory ? "Folder" : `${entry.size || 0} bytes`}</span></button>)}</div>}</CardContent></Card>}

      {selectedDevice && <Card><CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle className="text-base">Transfer history</CardTitle><p className="mt-1 text-xs text-muted-foreground">Agent-reported status only. Refreshing never resends a file request.</p></div><Button size="sm" variant="ghost" onClick={loadTransfers} aria-label="Refresh transfer history"><RefreshCw className="h-3.5 w-3.5" /></Button></CardHeader><CardContent className="space-y-2">{transfers.length === 0 ? <p className="py-3 text-sm text-muted-foreground">No file transfers for this asset.</p> : transfers.map((transfer) => { const status = String(transfer.status || "queued").toLowerCase(); return <div key={transfer.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 p-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="max-w-full truncate text-sm font-medium">{transfer.filename}</p><Badge variant="outline" className={`capitalize ${TRANSFER_STATUS_STYLE[status] || TRANSFER_STATUS_STYLE.queued}`}>{status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{transfer.direction === "endpoint_to_technician" ? "Endpoint → technician" : "Technician → endpoint"}{transfer.agent_detail ? ` · ${transfer.agent_detail}` : ""}</p><p className="mt-1 text-xs text-muted-foreground">{transferStatusHint(transfer)}</p></div>{transfer.direction === "endpoint_to_technician" && status === "staged" && <Button size="sm" variant="outline" onClick={() => downloadTransfer(transfer)}><Download className="mr-1.5 h-3.5 w-3.5" />Download</Button>}</div>; })}</CardContent></Card>}
    </div>
  );
}
