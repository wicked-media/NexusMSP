import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, AlertTriangle, Shield, Lock } from "lucide-react";
import { toast } from "sonner";

export default function IdentityThreatPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try { const res = await axios.get(`${API}/identity-threats/overview`, { headers }); setData(res.data); } catch (e) { toast.error("Failed to load"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  const handleResolve = async (id) => {
    try { await axios.post(`${API}/identity-threats/${id}/resolve`, {}, { headers }); setData(prev => ({ ...prev, threats: prev.threats.map(t => t.id === id ? { ...t, resolved: true } : t) })); toast.success("Resolved"); } catch (e) { toast.error("Failed"); }
  };

  if (loading || !data) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const typeIcon = { impossible_travel: "TRAVEL", rogue_oauth: "OAUTH", bec: "BEC", session_hijack: "SESSION", brute_force: "BRUTE" };
  const typeColor = { impossible_travel: "bg-amber-500/10 text-amber-500", rogue_oauth: "bg-red-500/10 text-red-500", bec: "bg-red-500/10 text-red-500", session_hijack: "bg-purple-500/10 text-purple-500", brute_force: "bg-orange-500/10 text-orange-500" };

  return (
    <div className="space-y-6" data-testid="identity-threat-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Identity Threat Monitor</h1><p className="text-muted-foreground text-sm mt-1">M365, Azure AD, Google Workspace identity threat detection</p></div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5 flex items-center gap-3"><Eye className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{data.summary.total_alerts}</p><p className="text-xs text-muted-foreground">Total Alerts</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><AlertTriangle className="w-6 h-6 text-red-500" /><div><p className="text-2xl font-bold">{data.summary.active}</p><p className="text-xs text-muted-foreground">Active</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Shield className="w-6 h-6 text-red-500" /><div><p className="text-2xl font-bold">{data.summary.critical}</p><p className="text-xs text-muted-foreground">Critical</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Lock className="w-6 h-6 text-amber-500" /><div><p className="text-2xl font-bold">{data.summary.high}</p><p className="text-xs text-muted-foreground">High</p></div></CardContent></Card>
      </div>

      <div className="space-y-4">
        {data.threats.map(t => (
          <Card key={t.id} className={!t.resolved ? "border-l-4 border-l-red-500" : ""} data-testid={`idt-${t.id}`}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={t.severity === "critical" ? "destructive" : "warning"}>{t.severity}</Badge>
                    <Badge className={typeColor[t.type]}>{typeIcon[t.type]}</Badge>
                    <Badge variant="outline">{t.provider}</Badge>
                    <span className="text-xs text-muted-foreground">{t.tenant}</span>
                  </div>
                  <h3 className="font-semibold mt-2">{t.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">User: {t.user_email} | {new Date(t.detected_at).toLocaleString()}</p>
                  {t.source_ips && <p className="text-xs mt-1">IPs: <code className="bg-muted px-1 rounded">{t.source_ips.join(", ")}</code></p>}
                  {t.permissions_requested && <p className="text-xs mt-1">Permissions: {t.permissions_requested.join(", ")}</p>}
                  {t.rule_details && <p className="text-xs mt-1 text-red-400">Rule: {t.rule_details}</p>}
                </div>
                {!t.resolved ? <Button variant="outline" size="sm" onClick={() => handleResolve(t.id)}>Resolve</Button> : <Badge variant="outline">Resolved</Badge>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
