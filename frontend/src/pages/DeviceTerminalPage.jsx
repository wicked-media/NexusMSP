import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Terminal, Monitor, Play, Square, Loader2, Copy, Trash2, Clock, ChevronRight } from "lucide-react";

export default function DeviceTerminalPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [devices, setDevices] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [sessionType, setSessionType] = useState("powershell");
  const outputRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [devRes, sessRes] = await Promise.all([
          axios.get(`${API}/devices?status=online`, { headers }),
          axios.get(`${API}/device-terminal/sessions`, { headers }),
        ]);
        setDevices(devRes.data);
        setSessions(sessRes.data);
      } catch {}
      finally { setLoading(false); }
    };
    fetchData();
  }, [token]);

  const startSession = async () => {
    if (!selectedDevice) { toast.error("Select a device"); return; }
    try {
      const res = await axios.post(`${API}/device-terminal/sessions`, { device_id: selectedDevice, session_type: sessionType }, { headers });
      setActiveSession(res.data);
      setOutput([{ type: "system", text: `Connected to ${res.data.device_name} (${res.data.os}) via ${sessionType}`, time: new Date().toLocaleTimeString() }]);
      toast.success(`Terminal session started on ${res.data.device_name}`);
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to start session"); }
  };

  const executeCommand = async (e) => {
    e.preventDefault();
    if (!command.trim() || !activeSession) return;
    const cmd = command.trim();
    setCommand("");
    setOutput(prev => [...prev, { type: "input", text: cmd, time: new Date().toLocaleTimeString() }]);
    setExecuting(true);
    try {
      const res = await axios.post(`${API}/device-terminal/sessions/${activeSession.id}/execute`, { command: cmd }, { headers });
      setOutput(prev => [...prev, { type: "output", text: res.data.output, exitCode: res.data.exit_code, time: new Date().toLocaleTimeString() }]);
    } catch (e) {
      setOutput(prev => [...prev, { type: "error", text: e.response?.data?.detail || "Command failed", time: new Date().toLocaleTimeString() }]);
    }
    finally { setExecuting(false); }
    setTimeout(() => { outputRef.current?.scrollTo(0, outputRef.current.scrollHeight); inputRef.current?.focus(); }, 50);
  };

  const endSession = async () => {
    if (!activeSession) return;
    try {
      await axios.post(`${API}/device-terminal/sessions/${activeSession.id}/end`, {}, { headers });
      setOutput(prev => [...prev, { type: "system", text: "Session ended.", time: new Date().toLocaleTimeString() }]);
      setActiveSession(null);
      toast.success("Terminal session ended");
    } catch { toast.error("Failed to end session"); }
  };

  const prompt = activeSession?.session_type === "bash" ? `${activeSession.device_name}:~$` : `PS ${activeSession?.device_name}>`;

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="device-terminal-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Terminal className="w-6 h-6 text-emerald-400" />Live Device Terminal</h1>
          <p className="text-muted-foreground mt-1">Execute commands on remote devices in real-time</p>
        </div>
      </div>

      {/* Connection Bar */}
      {!activeSession && (
        <Card data-testid="connect-bar">
          <CardContent className="p-4 flex items-center gap-3">
            <Select value={selectedDevice} onValueChange={setSelectedDevice}>
              <SelectTrigger className="w-[300px]" data-testid="device-select"><SelectValue placeholder="Select device..." /></SelectTrigger>
              <SelectContent>{devices.map(d => <SelectItem key={d.id} value={d.id}>{d.name} ({d.ip_address})</SelectItem>)}</SelectContent>
            </Select>
            <Select value={sessionType} onValueChange={setSessionType}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="powershell">PowerShell</SelectItem>
                <SelectItem value="bash">Bash / SSH</SelectItem>
                <SelectItem value="cmd">CMD</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={startSession} className="bg-emerald-600 hover:bg-emerald-700" data-testid="start-session-btn">
              <Play className="w-4 h-4 mr-1" />Connect
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Active Session Header */}
      {activeSession && (
        <Card>
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm font-medium">{activeSession.device_name}</span>
              <Badge variant="outline" className="text-[9px]">{activeSession.session_type}</Badge>
              <span className="text-xs text-muted-foreground">{activeSession.ip_address} | {activeSession.os}</span>
            </div>
            <Button size="sm" variant="destructive" onClick={endSession} data-testid="end-session-btn"><Square className="w-3 h-3 mr-1" />Disconnect</Button>
          </CardContent>
        </Card>
      )}

      {/* Terminal Output */}
      <Card className="bg-[#0d1117] border-zinc-800">
        <div ref={outputRef} className="h-[calc(100vh-350px)] overflow-y-auto p-4 font-mono text-sm" data-testid="terminal-output">
          {output.length === 0 && !activeSession && (
            <div className="text-zinc-600 text-center py-20">
              <Terminal className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Select a device and connect to start a terminal session</p>
            </div>
          )}
          {output.map((line, i) => (
            <div key={`l-${i}`} className="mb-1">
              {line.type === "system" && <span className="text-cyan-400">[{line.time}] {line.text}</span>}
              {line.type === "input" && <span className="text-emerald-400">{prompt} <span className="text-white">{line.text}</span></span>}
              {line.type === "output" && <pre className="text-zinc-300 whitespace-pre-wrap pl-2 border-l-2 border-zinc-700 ml-1">{line.text}</pre>}
              {line.type === "error" && <span className="text-red-400">{line.text}</span>}
            </div>
          ))}
          {executing && <span className="text-zinc-500 animate-pulse">Executing...</span>}
        </div>

        {/* Command Input */}
        {activeSession && (
          <form onSubmit={executeCommand} className="border-t border-zinc-800 p-3 flex items-center gap-2">
            <span className="text-emerald-400 text-sm font-mono shrink-0">{prompt}</span>
            <Input ref={inputRef} value={command} onChange={e => setCommand(e.target.value)}
              className="bg-transparent border-0 shadow-none focus-visible:ring-0 text-white font-mono"
              placeholder="Type a command..." autoFocus disabled={executing} data-testid="command-input" />
          </form>
        )}
      </Card>

      {/* Recent Sessions */}
      {sessions.length > 0 && !activeSession && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4" />Recent Sessions</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {sessions.slice(0, 5).map(s => (
                <div key={s.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{s.device_name}</span>
                    <Badge variant="outline" className="text-[9px]">{s.session_type}</Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{s.user_name}</span>
                    <Badge className={s.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-500/10 text-zinc-400"}>{s.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
