import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Clock, CheckCircle, Bot } from "lucide-react";
import { toast } from "sonner";

export default function SocFeedPage() {
  const { token } = useAuth();
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [eRes, sRes] = await Promise.all([
          axios.get(`${API}/soc-feed/events`, { headers }),
          axios.get(`${API}/soc-feed/stats`, { headers }),
        ]);
        setEvents(eRes.data);
        setStats(sRes.data);
      } catch (e) { toast.error("Failed to load"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const typeColor = { investigation: "bg-blue-500/10 text-blue-500", response: "bg-amber-500/10 text-amber-500", resolution: "bg-emerald-500/10 text-emerald-500" };
  const severityColor = { critical: "destructive", high: "warning", medium: "secondary", low: "outline", info: "outline" };

  return (
    <div className="space-y-6" data-testid="soc-feed-page">
      <div><h1 className="text-2xl font-bold tracking-tight">SOC Activity Feed</h1><p className="text-muted-foreground text-sm mt-1">Real-time transparency into security investigations and responses</p></div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card><CardContent className="pt-5 flex items-center gap-3"><Activity className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{stats.total_events}</p><p className="text-xs text-muted-foreground">Total Events</p></div></CardContent></Card>
          <Card><CardContent className="pt-5 flex items-center gap-3"><Bot className="w-6 h-6 text-blue-500" /><div><p className="text-2xl font-bold">{stats.investigations}</p><p className="text-xs text-muted-foreground">Investigations</p></div></CardContent></Card>
          <Card><CardContent className="pt-5 flex items-center gap-3"><Activity className="w-6 h-6 text-amber-500" /><div><p className="text-2xl font-bold">{stats.responses}</p><p className="text-xs text-muted-foreground">Responses</p></div></CardContent></Card>
          <Card><CardContent className="pt-5 flex items-center gap-3"><Clock className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{stats.avg_response_time_min}m</p><p className="text-xs text-muted-foreground">Avg Response</p></div></CardContent></Card>
          <Card><CardContent className="pt-5 flex items-center gap-3"><CheckCircle className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{stats.mttr_hours}h</p><p className="text-xs text-muted-foreground">MTTR</p></div></CardContent></Card>
        </div>
      )}

      <div className="relative pl-6 border-l-2 border-border space-y-6">
        {events.map(e => (
          <div key={e.id} className="relative" data-testid={`soc-event-${e.id}`}>
            <div className="absolute -left-[31px] w-4 h-4 rounded-full border-2 border-background bg-primary" />
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={typeColor[e.type]}>{e.type}</Badge>
                  <Badge variant={severityColor[e.severity]}>{e.severity}</Badge>
                  <span className="text-sm font-medium">{e.analyst}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{new Date(e.timestamp).toLocaleString()}</span>
                </div>
                <h3 className="font-semibold text-sm mt-2">{e.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{e.description}</p>
                <p className="text-xs text-muted-foreground mt-1">{e.client_name}</p>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
