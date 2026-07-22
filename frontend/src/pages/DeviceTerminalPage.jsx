import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { CheckCircle2, Clock3, Loader2, MonitorCog, RefreshCw, Send, Square, Terminal } from "lucide-react";
import { toast } from "sonner";

const COMMAND_STATUS_STYLE = {
  queued: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  completed: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  failed: "text-rose-300 border-rose-500/30 bg-rose-500/10",
  timeout: "text-rose-300 border-rose-500/30 bg-rose-500/10",
};

export default function DeviceTerminalPage() {
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

  const commands = activeSession?.commands || [];
  const completed = commands.filter((item) => item.status === "completed").length;
  const pending = commands.filter((item) => item.status === "queued").length;
  const prompt = activeSession?.session_type === "cmd" ? `${activeSession.device_name}>` : `PS ${activeSession?.device_name}>`;

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
        <Card><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /><span className="font-medium">{activeSession.device_name}</span><Badge variant="outline" className="text-[10px]">{activeSession.session_type}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{activeSession.ip_address || "No IP recorded"} | {activeSession.os || "Unknown OS"} | Result polling every 2 seconds</p></div><Button size="sm" variant="outline" onClick={endSession} data-testid="end-session-btn"><Square className="mr-1.5 h-3.5 w-3.5" />Close console</Button></CardContent></Card>

        <Card className="overflow-hidden border-zinc-800 bg-[#0d1117]"><div ref={transcriptRef} className="max-h-[50vh] min-h-[340px] overflow-y-auto p-4 font-mono text-sm" data-testid="terminal-output">
          {commands.length === 0 ? <div className="py-24 text-center text-sm text-zinc-500"><Terminal className="mx-auto mb-3 h-10 w-10 opacity-40" /><p>Console ready. Commands will be queued to the selected Nexus Agent.</p></div> : commands.map((item) => <div key={item.id} className="mb-4"><div className="flex flex-wrap items-center gap-2 text-emerald-300"><span>{prompt}</span><span className="text-zinc-100">{item.command}</span><Badge variant="outline" className={`font-sans text-[9px] ${COMMAND_STATUS_STYLE[item.status] || COMMAND_STATUS_STYLE.queued}`}>{item.status}</Badge></div>{item.status === "queued" ? <p className="mt-1 pl-2 text-xs text-amber-300">Waiting for the endpoint to return a result...</p> : <pre className={`mt-2 whitespace-pre-wrap border-l-2 pl-3 text-xs ${item.status === "completed" ? "border-emerald-500/40 text-zinc-200" : "border-rose-500/50 text-rose-200"}`}>{item.output || item.stderr || "Command returned no output."}{item.exit_code != null && <span className="mt-2 block text-[10px] text-zinc-500">Exit code {item.exit_code}{item.duration_ms != null ? ` | ${item.duration_ms} ms` : ""}</span>}</pre>}</div>)}
        </div><form onSubmit={executeCommand} className="flex items-center gap-2 border-t border-zinc-800 p-3"><span className="shrink-0 font-mono text-sm text-emerald-300">{prompt}</span><Input ref={inputRef} value={command} onChange={(event) => setCommand(event.target.value)} disabled={executing} className="border-0 bg-transparent font-mono text-white shadow-none focus-visible:ring-0" placeholder="Enter a command to queue..." data-testid="command-input" /><Button type="submit" size="sm" disabled={executing || !command.trim()}>{executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}</Button></form></Card>
      </>}

      {!activeSession && sessions.length > 0 && <Card><CardHeader><CardTitle className="text-base">Recent command sessions</CardTitle></CardHeader><CardContent className="space-y-2">{sessions.slice(0, 8).map((session) => <div key={session.id} className="flex items-center justify-between rounded-lg border border-border/70 p-3"><div><p className="text-sm font-medium">{session.device_name}</p><p className="mt-1 text-xs text-muted-foreground">{session.session_type} | {new Date(session.started_at).toLocaleString()}</p></div><Badge variant="outline" className="capitalize">{session.status}</Badge></div>)}</CardContent></Card>}
    </div>
  );
}
