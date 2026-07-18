import { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { CalendarClock, CheckCircle, XCircle, Play, ShieldCheck, Monitor } from "lucide-react";
import { toast } from "sonner";

export default function MaintenanceSchedulerPage() {
  const { token } = useAuth();
  const [schedules, setSchedules] = useState([]);
  const [history, setHistory] = useState([]);
  const [liveWindows, setLiveWindows] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sRes, hRes, wRes] = await Promise.all([
          axios.get(`${API}/maintenance-scheduler/schedules`, { headers }),
          axios.get(`${API}/maintenance-scheduler/history`, { headers }),
          axios.get(`${API}/maintenance-windows`, { headers }),
        ]);
        setSchedules(sRes.data);
        setHistory(hRes.data);
        setLiveWindows(wRes.data || []);
      } catch (e) { toast.error("Failed to load schedules"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const recurrenceColor = { daily: "bg-blue-500/10 text-blue-500", weekly: "bg-emerald-500/10 text-emerald-500", monthly: "bg-purple-500/10 text-purple-500", quarterly: "bg-amber-500/10 text-amber-500" };
  const liveCounts = liveWindows.reduce((counts, window) => ({ ...counts, [window.status]: (counts[window.status] || 0) + 1 }), {});
  const actionLabel = { "install-patches": "Windows Updates", "install-winget": "Approved apps", "run-checks": "Health checks", "run-script": "Script", reboot: "Reboot" };

  return (
    <div className="space-y-6" data-testid="maintenance-scheduler-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Maintenance Scheduler</h1><p className="text-muted-foreground text-sm mt-1">Recurring policy catalogue and live agent-backed maintenance windows</p></div>
        <Button onClick={() => navigate("/devices")} data-testid="create-live-maintenance-window"><CalendarClock className="w-4 h-4 mr-1" />Create live window</Button>
      </div>

      <Card className="border-cyan-500/25 bg-cyan-500/[0.03]" data-testid="live-maintenance-windows">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><div><CardTitle className="text-lg flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-cyan-400" />Live Maintenance Windows</CardTitle><p className="mt-1 text-xs text-muted-foreground">Agent-backed work only: every action is recorded against its target device.</p></div><div className="flex items-center gap-2"><Badge variant="outline" className="text-[10px]">{liveCounts.running || 0} running</Badge><Badge variant="outline" className="text-[10px]">{liveCounts.scheduled || 0} scheduled</Badge></div></CardHeader>
        <CardContent>
          {liveWindows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No live windows. Create one from selected devices to queue real Nexus Agent checks, scripts, or reboots. Matching monitoring alerts are suppressed only while a window is running.</p>
          ) : (
            <div className="space-y-2">{liveWindows.slice(0, 8).map(w => (
              <div key={w.id} className="flex flex-col gap-3 rounded-lg border border-border/70 bg-background/40 p-3 text-sm lg:flex-row lg:items-center lg:justify-between">
                <div><p className="font-medium">{w.name}</p><p className="text-xs text-muted-foreground">{(w.device_ids || []).length} devices · {(w.actions || []).join(", ")}</p></div>
                <div className="flex items-center gap-3"><span className="text-[10px] text-muted-foreground">{w.summary_counts ? `${w.summary_counts.ok || 0} ok / ${w.summary_counts.failed || 0} failed` : "Awaiting execution"}</span><Badge variant={w.status === "running" ? "default" : "outline"} className="capitalize">{w.status}</Badge></div>
              </div>
            ))}</div>
          )}
        </CardContent>
      </Card>

      <MetricStrip columns={4}>
        <MetricTile label="Active schedules" value={schedules.length} accent="violet" icon={<CalendarClock className="w-2.5 h-2.5 text-violet-400" />} testid="maintenance-metric-schedules" />
        <MetricTile label="Total runs" value={schedules.reduce((a, s) => a + (s.run_count || 0), 0)} accent="sky" icon={<Play className="w-2.5 h-2.5 text-sky-400" />} testid="maintenance-metric-runs" />
        <MetricTile label="Successful (recent)" value={history.filter(h => h.status === "completed").length} accent="emerald" icon={<CheckCircle className="w-2.5 h-2.5 text-emerald-400" />} testid="maintenance-metric-success" />
        <MetricTile label="Failed (recent)" value={history.filter(h => h.status === "failed").length} accent="rose" icon={<XCircle className="w-2.5 h-2.5 text-rose-400" />} testid="maintenance-metric-failed" />
      </MetricStrip>

      {/* Schedules */}
      <Card><CardHeader><CardTitle className="text-lg">Maintenance Schedules</CardTitle></CardHeader>
        <CardContent><div className="space-y-3">
          {schedules.map(s => (
            <div key={s.id} className="p-4 rounded-lg border bg-muted/30" data-testid={`schedule-${s.id}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2"><h3 className="font-semibold text-sm">{s.name}</h3><Badge className={recurrenceColor[s.recurrence] || ""}>{s.recurrence}</Badge></div>
                  <p className="text-xs text-muted-foreground mt-1">{s.client_name} | {(s.target_devices || []).length} devices | ~{s.duration_estimate_minutes}min</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span>Time: {s.time}{s.day_of_week ? ` (${s.day_of_week})` : ""}</span>
                    <span>Runs: {s.run_count || 0}</span>
                    {s.last_run && <span>Last: {new Date(s.last_run).toLocaleDateString()}</span>}
                  </div>
                  {(s.pre_script || s.post_script) && (
                    <div className="flex gap-2 mt-2">
                      {s.pre_script && <Badge variant="outline" className="text-[10px]">Pre: {s.pre_script}</Badge>}
                      {s.post_script && <Badge variant="outline" className="text-[10px]">Post: {s.post_script}</Badge>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div></CardContent>
      </Card>

      {/* History */}
      <Card><CardHeader><CardTitle className="text-lg">Execution History</CardTitle></CardHeader>
        <CardContent><div className="space-y-2">
          {history.map(h => (
            <div key={h.id} className="flex items-center justify-between p-3 rounded-lg border" data-testid={`history-${h.id}`}>
              <div className="flex items-center gap-3">
                {h.status === "completed" ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                <div><p className="text-sm font-medium">{h.name}</p><p className="text-xs text-muted-foreground">{h.client_name} | {h.devices_affected} devices | {h.duration_minutes}min</p></div>
              </div>
              <div className="text-right">
                <Badge variant={h.status === "completed" ? "default" : "destructive"}>{h.status}</Badge>
                <p className="text-xs text-muted-foreground mt-1">{new Date(h.executed_at).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div></CardContent>
      </Card>
    </div>
  );
}
