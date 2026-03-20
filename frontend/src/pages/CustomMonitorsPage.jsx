import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Activity, AlertTriangle, Bell, Cpu } from "lucide-react";
import { toast } from "sonner";

export default function CustomMonitorsPage() {
  const { token } = useAuth();
  const [monitors, setMonitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try { const res = await axios.get(`${API}/custom-monitors/list`, { headers }); setMonitors(res.data); } catch (e) { toast.error("Failed"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  const toggleMonitor = async (id, enabled) => {
    try { await axios.put(`${API}/custom-monitors/${id}`, { enabled }, { headers }); setMonitors(prev => prev.map(m => m.id === id ? { ...m, enabled } : m)); toast.success(enabled ? "Enabled" : "Disabled"); } catch (e) { toast.error("Failed"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const typeIcon = { threshold: <Cpu className="w-4 h-4" />, event_log: <Bell className="w-4 h-4" />, service: <Activity className="w-4 h-4" />, certificate: <AlertTriangle className="w-4 h-4" /> };
  const sevColor = { critical: "destructive", high: "warning", warning: "secondary", medium: "secondary" };

  return (
    <div className="space-y-6" data-testid="custom-monitors-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Custom Monitor Builder</h1><p className="text-muted-foreground text-sm mt-1">Create custom monitoring checks with auto-ticket creation</p></div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="pt-5 flex items-center gap-3"><Activity className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{monitors.length}</p><p className="text-xs text-muted-foreground">Total Monitors</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Bell className="w-6 h-6 text-amber-500" /><div><p className="text-2xl font-bold">{monitors.reduce((a, m) => a + (m.alert_count || 0), 0)}</p><p className="text-xs text-muted-foreground">Total Alerts</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Activity className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{monitors.filter(m => m.enabled).length}</p><p className="text-xs text-muted-foreground">Active</p></div></CardContent></Card>
      </div>

      <div className="space-y-3">
        {monitors.map(m => (
          <Card key={m.id} data-testid={`monitor-${m.id}`}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">{typeIcon[m.type]}<h3 className="font-semibold text-sm">{m.name}</h3><Badge variant={sevColor[m.alert_severity]}>{m.alert_severity}</Badge><Badge variant="outline" className="text-[10px]">{m.type}</Badge>{m.auto_ticket && <Badge className="bg-blue-500/10 text-blue-500 text-[10px]">Auto-Ticket</Badge>}</div>
                  <p className="text-xs text-muted-foreground mt-1">{m.description}</p>
                  <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                    <span>Scope: {m.scope}</span><span>Alerts: {m.alert_count}</span>
                    {m.last_triggered && <span>Last: {new Date(m.last_triggered).toLocaleString()}</span>}
                  </div>
                </div>
                <Switch checked={m.enabled} onCheckedChange={(v) => toggleMonitor(m.id, v)} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
