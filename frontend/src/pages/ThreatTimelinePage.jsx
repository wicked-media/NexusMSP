import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Activity, AlertTriangle, CheckCircle, Clock, Shield, Zap, ArrowRight } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const SEV = { critical: "border-red-500/40 bg-red-500/5", high: "border-orange-500/30 bg-orange-500/5", medium: "border-amber-500/20", low: "border-blue-500/20" };
const SEV_DOT = { critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-500", low: "bg-blue-500" };

export default function ThreatTimelinePage() {
  const { token } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { const res = await axios.get(`${API}/soc/alerts`, { headers }); setAlerts(res.data.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))); }
    catch { toast.error("Failed"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="threat-timeline">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Threat Timeline</h1><p className="text-muted-foreground">Chronological view of all security events</p></div>
      </div>

      <div className="relative">
        <div className="absolute left-[19px] top-0 bottom-0 w-0.5 bg-muted/20" />
        <div className="space-y-4">
          {alerts.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No events recorded</CardContent></Card>
          ) : alerts.map((alert, i) => (
            <div key={alert.id || i} className="flex gap-4 relative" data-testid={`timeline-${i}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${alert.severity === "critical" ? "bg-red-500/20" : alert.severity === "high" ? "bg-orange-500/20" : "bg-muted/30"}`}>
                <div className={`w-3 h-3 rounded-full ${SEV_DOT[alert.severity] || "bg-gray-500"} ${alert.status === "new" ? "animate-pulse" : ""}`} />
              </div>
              <Card className={`flex-1 ${SEV[alert.severity] || ""}`}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{alert.title}</span>
                        <Badge className={`text-[10px] ${alert.severity === "critical" ? "bg-red-500/20 text-red-400" : alert.severity === "high" ? "bg-orange-500/20 text-orange-400" : "bg-amber-500/20 text-amber-400"}`}>{alert.severity}</Badge>
                        <Badge variant="outline" className="text-[10px] capitalize">{alert.status}</Badge>
                        {alert.mitre_attack && <Badge variant="outline" className="text-[10px] font-mono">{alert.mitre_attack}</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                        <span className="font-mono">{alert.hostname}</span>
                        <span>{alert.organization}</span>
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">{alert.created_at ? formatDistanceToNow(new Date(alert.created_at), { addSuffix: true }) : ""}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
