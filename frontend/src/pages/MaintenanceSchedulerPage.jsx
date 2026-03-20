import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarClock, CheckCircle, XCircle, Play, Clock, Plus } from "lucide-react";
import { toast } from "sonner";

export default function MaintenanceSchedulerPage() {
  const { token } = useAuth();
  const [schedules, setSchedules] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sRes, hRes] = await Promise.all([
          axios.get(`${API}/maintenance-scheduler/schedules`, { headers }),
          axios.get(`${API}/maintenance-scheduler/history`, { headers }),
        ]);
        setSchedules(sRes.data);
        setHistory(hRes.data);
      } catch (e) { toast.error("Failed to load schedules"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const recurrenceColor = { daily: "bg-blue-500/10 text-blue-500", weekly: "bg-emerald-500/10 text-emerald-500", monthly: "bg-purple-500/10 text-purple-500", quarterly: "bg-amber-500/10 text-amber-500" };

  return (
    <div className="space-y-6" data-testid="maintenance-scheduler-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Maintenance Scheduler</h1><p className="text-muted-foreground text-sm mt-1">Recurring maintenance windows with automated scripts</p></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5 flex items-center gap-3"><CalendarClock className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{schedules.length}</p><p className="text-xs text-muted-foreground">Active Schedules</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Play className="w-6 h-6 text-blue-500" /><div><p className="text-2xl font-bold">{schedules.reduce((a, s) => a + (s.run_count || 0), 0)}</p><p className="text-xs text-muted-foreground">Total Runs</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><CheckCircle className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{history.filter(h => h.status === "completed").length}</p><p className="text-xs text-muted-foreground">Successful (recent)</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><XCircle className="w-6 h-6 text-red-500" /><div><p className="text-2xl font-bold">{history.filter(h => h.status === "failed").length}</p><p className="text-xs text-muted-foreground">Failed (recent)</p></div></CardContent></Card>
      </div>

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
