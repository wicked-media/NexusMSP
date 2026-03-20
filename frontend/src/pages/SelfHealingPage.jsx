import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, CheckCircle, XCircle, Clock, Zap, Play, AlertTriangle, ArrowUpRight, Terminal, Shield, RotateCcw, Activity, ChevronDown, ChevronRight } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const StatusIcon = ({ status }) => {
  const map = { healed: <CheckCircle className="w-5 h-5 text-green-500" />, executing: <Activity className="w-5 h-5 text-blue-500 animate-pulse" />, detected: <AlertTriangle className="w-5 h-5 text-yellow-500" />, matched: <Bot className="w-5 h-5 text-purple-500" />, failed: <XCircle className="w-5 h-5 text-red-500" />, escalated: <ArrowUpRight className="w-5 h-5 text-orange-500" /> };
  return map[status] || <Clock className="w-5 h-5 text-muted-foreground" />;
};

const ExecutionLog = ({ logs, isLive }) => {
  if (!logs || logs.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg bg-[#0d1117] border border-[#30363d] overflow-hidden" data-testid="execution-log">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d] bg-[#161b22]">
        <Terminal className="w-4 h-4 text-green-400" />
        <span className="text-xs font-mono text-green-400">Execution Log</span>
        {isLive && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse ml-auto" />}
      </div>
      <div className="p-3 font-mono text-xs space-y-1.5 max-h-48 overflow-y-auto">
        {logs.map((log, i) => (
          <div key={i} className={`flex gap-2 ${log.status === "completed" ? "text-green-400" : log.status === "running" ? "text-yellow-300" : "text-red-400"}`}>
            <span className="text-[#8b949e] w-16 flex-shrink-0">[Step {log.step}]</span>
            <span className="text-[#58a6ff] flex-shrink-0">{log.duration_ms}ms</span>
            <span className="flex-1 break-all">{log.action}</span>
            <span className={`flex-shrink-0 ${log.status === "completed" ? "text-green-400" : "text-yellow-300"}`}>{log.status === "completed" ? "OK" : "..."}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function SelfHealingPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState(null);
  const [runbooks, setRunbooks] = useState([]);
  const [expandedEvent, setExpandedEvent] = useState(null);
  const [executing, setExecuting] = useState({});
  const [liveLog, setLiveLog] = useState({});
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    try {
      const [dRes, rRes] = await Promise.all([
        axios.get(`${API}/self-healing/dashboard`, { headers }),
        axios.get(`${API}/self-healing/runbooks`, { headers }),
      ]);
      setData(dRes.data);
      setRunbooks(rRes.data);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const executeHealing = async (eventId, steps) => {
    setExecuting(prev => ({ ...prev, [eventId]: true }));
    setExpandedEvent(eventId);

    // Simulate step-by-step execution with live log updates
    const logs = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      logs.push({ step: i + 1, action: step.action, status: "running", output: "...", duration_ms: 0, timestamp: new Date().toISOString() });
      setLiveLog(prev => ({ ...prev, [eventId]: [...logs] }));
      await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
      logs[i] = { ...logs[i], status: "completed", output: step.expected_output, duration_ms: Math.floor(200 + Math.random() * 4800) };
      setLiveLog(prev => ({ ...prev, [eventId]: [...logs] }));
    }

    // Actually call the backend to persist
    try {
      await axios.post(`${API}/self-healing/execute/${eventId}`, {}, { headers });
    } catch (e) { console.error(e); }

    setExecuting(prev => ({ ...prev, [eventId]: false }));
    fetchData();
  };

  const simulateIssue = async () => {
    try {
      const res = await axios.post(`${API}/self-healing/simulate`, { issue_type: "disk_space_low", description: "Simulated disk space issue for testing", severity: "medium" }, { headers });
      if (res.data.status === "executing" && res.data.runbook_steps) {
        executeHealing(res.data.id, res.data.runbook_steps);
      }
      fetchData();
    } catch (e) { console.error(e); }
  };

  if (!data) return <div className="p-6 text-muted-foreground">Loading Self-Healing Engine...</div>;
  const s = data.summary;

  return (
    <div className="space-y-6" data-testid="self-healing-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bot className="w-7 h-7 text-green-500" />Self-Healing AI Engine</h1>
          <p className="text-muted-foreground text-sm">Autonomous issue detection, runbook matching, and execution — zero human intervention</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}><RotateCcw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={simulateIssue} data-testid="simulate-btn"><Zap className="w-4 h-4 mr-1" />Simulate Issue</Button>
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid grid-cols-5 gap-4">
        <Card className="border-green-500/30 bg-green-500/5"><CardContent className="pt-4 text-center">
          <div className="text-3xl font-bold text-green-500">{s.healed}</div>
          <div className="text-xs text-muted-foreground mt-1">Auto-Healed</div>
          <div className="text-xs text-green-500 font-medium">{s.heal_rate_pct}% success</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-3xl font-bold text-blue-500">{s.active}</div>
          <div className="text-xs text-muted-foreground mt-1">Active Now</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-3xl font-bold">{s.total_time_saved_hours}h</div>
          <div className="text-xs text-muted-foreground mt-1">Time Saved</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-3xl font-bold">{s.avg_heal_time_seconds}s</div>
          <div className="text-xs text-muted-foreground mt-1">Avg Heal Time</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-3xl font-bold text-purple-500">{s.tickets_prevented}</div>
          <div className="text-xs text-muted-foreground mt-1">Tickets Prevented</div>
        </CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="dashboard">Live Feed</TabsTrigger>
          <TabsTrigger value="runbooks">Runbooks</TabsTrigger>
          <TabsTrigger value="timeline">24h Timeline</TabsTrigger>
          <TabsTrigger value="stats">Runbook Stats</TabsTrigger>
        </TabsList>

        {/* ─── LIVE FEED ─── */}
        <TabsContent value="dashboard" className="space-y-3">
          {data.events.map(event => (
            <Card key={event.id} className={`transition-all ${event.status === "executing" ? "border-blue-500/50 shadow-lg shadow-blue-500/10" : event.status === "healed" ? "border-green-500/20" : event.status === "failed" ? "border-red-500/20" : ""}`}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-4 cursor-pointer" onClick={() => setExpandedEvent(expandedEvent === event.id ? null : event.id)}>
                  <StatusIcon status={event.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{event.issue_description}</span>
                      <Badge variant={event.severity === "critical" ? "destructive" : event.severity === "high" ? "secondary" : "outline"} className="text-xs">{event.severity}</Badge>
                      <Badge variant="outline" className="text-xs">{event.detection_source?.replace("_", " ")}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{event.device_name} - {event.client_name}</div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-muted-foreground">Runbook: <span className="text-foreground">{event.matched_runbook}</span></span>
                      <span className="text-xs text-muted-foreground">Confidence: <span className="text-foreground">{event.confidence_pct}%</span></span>
                      {event.execution_time_seconds > 0 && <span className="text-xs text-muted-foreground">Executed in: <span className="text-green-500">{event.execution_time_seconds}s</span></span>}
                      {event.time_saved_minutes > 0 && <span className="text-xs text-green-500 font-medium">Saved {event.time_saved_minutes}min</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={event.status === "healed" ? "default" : event.status === "executing" ? "secondary" : event.status === "failed" ? "destructive" : "outline"} className={`text-xs ${event.status === "executing" ? "animate-pulse" : ""}`}>{event.status}</Badge>
                    {(event.status === "detected" || event.status === "matched") && (
                      <Button size="sm" variant="default" onClick={(e) => { e.stopPropagation(); executeHealing(event.id, event.runbook_steps); }} disabled={executing[event.id]}>
                        {executing[event.id] ? <Activity className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
                        {executing[event.id] ? "Healing..." : "Execute"}
                      </Button>
                    )}
                    {expandedEvent === event.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </div>
                </div>

                {/* Expanded: Show execution log */}
                {expandedEvent === event.id && (
                  <ExecutionLog
                    logs={liveLog[event.id] || event.execution_log}
                    isLive={executing[event.id]}
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ─── RUNBOOKS ─── */}
        <TabsContent value="runbooks" className="space-y-3">
          {runbooks.map(rb => (
            <Card key={rb.id}><CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold flex items-center gap-2">{rb.name}<Badge variant="outline" className="text-xs">{rb.category}</Badge></h3>
                  <div className="text-xs text-muted-foreground">Trigger: <code className="bg-muted px-1 rounded">{rb.trigger}</code></div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-medium text-green-500">{rb.success_rate_pct}% success</div>
                  <div className="text-xs text-muted-foreground">Avg: {rb.avg_execution_seconds}s</div>
                </div>
              </div>
              <div className="space-y-1">
                {rb.steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded bg-muted/30">
                    <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</div>
                    <div className="flex-1">
                      <code className="text-xs font-mono break-all">{step.action}</code>
                      <div className="text-xs text-green-500 mt-0.5">Expected: {step.expected_output}</div>
                    </div>
                    <span className="text-xs text-muted-foreground">{step.timeout_seconds}s timeout</span>
                  </div>
                ))}
              </div>
            </CardContent></Card>
          ))}
        </TabsContent>

        {/* ─── 24H TIMELINE ─── */}
        <TabsContent value="timeline">
          <Card><CardHeader className="pb-2"><CardTitle className="text-base">24-Hour Healing Activity</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={data.timeline_24h}>
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--card-foreground))' }} />
                  <Area type="monotone" dataKey="detected" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} name="Detected" />
                  <Area type="monotone" dataKey="healed" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} name="Healed" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── RUNBOOK STATS ─── */}
        <TabsContent value="stats" className="space-y-3">
          {data.runbook_stats.map(rb => (
            <Card key={rb.name}><CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{rb.name}</h3>
                  <div className="text-sm text-muted-foreground">{rb.total} total executions</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-center"><div className="text-lg font-bold text-green-500">{rb.healed}</div><div className="text-xs text-muted-foreground">Healed</div></div>
                  <div className="text-center"><div className="text-lg font-bold text-red-500">{rb.failed}</div><div className="text-xs text-muted-foreground">Failed</div></div>
                  <div className="w-20"><Progress value={rb.total > 0 ? (rb.healed / rb.total) * 100 : 0} className="h-2" /></div>
                  <span className="text-sm font-medium">{rb.total > 0 ? Math.round((rb.healed / rb.total) * 100) : 0}%</span>
                </div>
              </div>
            </CardContent></Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
