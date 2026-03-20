import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, AlertTriangle, Shield, Globe } from "lucide-react";

export default function DarkWebMonitorPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/dark-web-monitor/overview`, { headers }).then(r => setData(r.data)); }, []);

  const resolve = async (id) => {
    await axios.post(`${API}/dark-web-monitor/${id}/resolve`, {}, { headers });
    const res = await axios.get(`${API}/dark-web-monitor/overview`, { headers });
    setData(res.data);
  };

  if (!data) return <div className="p-6 text-muted-foreground">Loading...</div>;
  const s = data.summary;
  return (
    <div className="space-y-6" data-testid="dark-web-monitor-page">
      <div><h1 className="text-2xl font-bold">Dark Web Monitor</h1><p className="text-muted-foreground text-sm">Monitor client credentials on dark web breach databases</p></div>
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Total Exposures</div><div className="text-3xl font-bold text-red-500 mt-1">{s.total_exposures}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Critical</div><div className="text-3xl font-bold mt-1">{s.critical}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Domains Monitored</div><div className="text-3xl font-bold mt-1">{s.domains_monitored}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Resolved</div><div className="text-3xl font-bold text-green-500 mt-1">{s.resolved}</div></CardContent></Card>
      </div>
      <div className="space-y-3">
        {data.alerts.map(a => (
          <Card key={a.id} className={a.severity === "critical" ? "border-red-500/30" : a.severity === "high" ? "border-orange-500/30" : "border-yellow-500/30"}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${a.severity === "critical" ? "bg-red-500/20" : "bg-orange-500/20"}`}>
                  {a.status === "resolved" ? <EyeOff className="w-5 h-5 text-muted-foreground" /> : <Eye className="w-5 h-5 text-red-500" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2"><span className="font-medium font-mono">{a.email}</span><Badge variant={a.severity === "critical" ? "destructive" : "secondary"}>{a.severity}</Badge><Badge variant="outline" className="text-xs">{a.source_type.replace("_", " ")}</Badge></div>
                  <div className="text-sm text-muted-foreground">{a.client_name} | {a.description}</div>
                  <div className="text-xs text-muted-foreground mt-1">Password: {a.password_type} | Found: {new Date(a.found_at).toLocaleDateString()}</div>
                </div>
                {a.status !== "resolved" && <Button size="sm" onClick={() => resolve(a.id)}>Mark Resolved</Button>}
                {a.status === "resolved" && <Badge variant="outline">Resolved</Badge>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
