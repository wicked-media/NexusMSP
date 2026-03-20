import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Search, Shield, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function AuditTrailPage() {
  const { token } = useAuth();
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [eRes, sRes] = await Promise.all([
          axios.get(`${API}/audit-trail/events`, { headers }),
          axios.get(`${API}/audit-trail/summary`, { headers }),
        ]);
        setEvents(eRes.data);
        setSummary(sRes.data);
      } catch (e) { toast.error("Failed"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const catColor = { auth: "bg-blue-500/10 text-blue-500", security: "bg-red-500/10 text-red-500", tickets: "bg-amber-500/10 text-amber-500", automation: "bg-purple-500/10 text-purple-500", clients: "bg-emerald-500/10 text-emerald-500", billing: "bg-green-500/10 text-green-500", monitoring: "bg-orange-500/10 text-orange-500" };
  const filtered = filter ? events.filter(e => e.user?.toLowerCase().includes(filter.toLowerCase()) || e.action?.toLowerCase().includes(filter.toLowerCase()) || e.description?.toLowerCase().includes(filter.toLowerCase())) : events;

  return (
    <div className="space-y-6" data-testid="audit-trail-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Audit Trail</h1><p className="text-muted-foreground text-sm mt-1">Complete audit log of all system activities</p></div>
        <div className="flex items-center gap-2"><Search className="w-4 h-4 text-muted-foreground" /><Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search audit log..." className="w-64" data-testid="audit-search" /></div>
      </div>

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card><CardContent className="pt-5 flex items-center gap-3"><ClipboardList className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{summary.total_events}</p><p className="text-xs text-muted-foreground">Total Events</p></div></CardContent></Card>
          <Card><CardContent className="pt-5"><p className="text-sm font-medium mb-2">By Category</p><div className="flex flex-wrap gap-1">{summary.by_category.map(c => <Badge key={c.category} className={catColor[c.category] || ""} variant="outline">{c.category}: {c.count}</Badge>)}</div></CardContent></Card>
          <Card><CardContent className="pt-5"><p className="text-sm font-medium mb-2">Top Users</p><div className="space-y-1">{summary.by_user.slice(0, 3).map(u => <div key={u.user} className="flex items-center justify-between text-sm"><span className="flex items-center gap-1"><User className="w-3 h-3" />{u.user}</span><span className="text-muted-foreground">{u.count}</span></div>)}</div></CardContent></Card>
        </div>
      )}

      <Card><CardHeader><CardTitle className="text-lg">Activity Log</CardTitle></CardHeader>
        <CardContent><div className="space-y-2">{filtered.map(e => (
          <div key={e.id} className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/30" data-testid={`audit-${e.id}`}>
            <Badge className={catColor[e.category] || ""} variant="outline">{e.category}</Badge>
            <div className="flex-1 min-w-0"><p className="text-sm"><strong>{e.user}</strong> {e.action.replace(/_/g, " ")}</p><p className="text-xs text-muted-foreground truncate">{e.description}</p></div>
            {e.target && <Badge variant="outline" className="text-[10px] font-mono">{e.target}</Badge>}
            <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(e.timestamp).toLocaleString()}</span>
          </div>
        ))}</div></CardContent>
      </Card>
    </div>
  );
}
