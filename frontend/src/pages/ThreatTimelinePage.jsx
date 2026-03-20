import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, AlertTriangle, GitBranch, CheckCircle } from "lucide-react";
import { toast } from "sonner";

export default function ThreatTimelinePage() {
  const { token } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try { const res = await axios.get(`${API}/threat-timeline/events`, { headers }); setEvents(res.data); } catch (e) { toast.error("Failed to load threats"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  const handleResolve = async (id) => {
    try { await axios.post(`${API}/threat-timeline/events/${id}/resolve`, { notes: "Resolved via dashboard" }, { headers }); setEvents(prev => prev.map(e => e.id === id ? { ...e, resolved: true } : e)); toast.success("Threat resolved"); } catch (e) { toast.error("Failed"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const severityColor = { critical: "destructive", high: "warning", medium: "secondary", low: "outline" };
  const typeIcon = { persistence: "PERSIST", lateral_movement: "LATERAL", malware: "MALWARE", credential_access: "CREDS", exfiltration: "EXFIL" };

  return (
    <div className="space-y-6" data-testid="threat-timeline-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Threat Detection Timeline</h1><p className="text-muted-foreground text-sm mt-1">Kill chain view of detected threats across endpoints</p></div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5 flex items-center gap-3"><AlertTriangle className="w-6 h-6 text-red-500" /><div><p className="text-2xl font-bold">{events.filter(e => !e.resolved).length}</p><p className="text-xs text-muted-foreground">Active Threats</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Shield className="w-6 h-6 text-red-500" /><div><p className="text-2xl font-bold">{events.filter(e => e.severity === "critical" && !e.resolved).length}</p><p className="text-xs text-muted-foreground">Critical</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><GitBranch className="w-6 h-6 text-blue-500" /><div><p className="text-2xl font-bold">{events.filter(e => e.auto_isolated).length}</p><p className="text-xs text-muted-foreground">Auto-Isolated</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><CheckCircle className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{events.filter(e => e.resolved).length}</p><p className="text-xs text-muted-foreground">Resolved</p></div></CardContent></Card>
      </div>

      <div className="space-y-4">
        {events.map(e => (
          <Card key={e.id} className={!e.resolved ? "border-l-4 border-l-red-500" : ""} data-testid={`threat-${e.id}`}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={severityColor[e.severity]}>{e.severity}</Badge>
                    <Badge variant="outline" className="text-[10px] font-mono">{typeIcon[e.type] || e.type}</Badge>
                    <Badge variant="outline" className="text-[10px]">{e.mitre_tactic}</Badge>
                    {e.auto_isolated && <Badge className="bg-purple-500/10 text-purple-500">Auto-Isolated</Badge>}
                  </div>
                  <h3 className="font-semibold mt-2">{e.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{e.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span>{e.device_name}</span><span>{e.client_name}</span><span>{new Date(e.detected_at).toLocaleString()}</span>
                  </div>
                  {e.process_chain && <div className="mt-2"><p className="text-xs text-muted-foreground">Process Chain:</p><code className="text-xs bg-muted p-1 rounded">{e.process_chain.join(" → ")}</code></div>}
                  {e.mitre_technique && <p className="text-xs text-muted-foreground mt-1">MITRE: {e.mitre_technique}</p>}
                </div>
                {!e.resolved && <Button variant="outline" size="sm" onClick={() => handleResolve(e.id)}>Resolve</Button>}
                {e.resolved && <Badge variant="outline">Resolved by {e.resolved_by}</Badge>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
