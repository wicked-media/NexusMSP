import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileBarChart, CheckCircle, Clock, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export default function SlaReportGenPage() {
  const { token } = useAuth();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try { const res = await axios.get(`${API}/sla-report-gen/reports`, { headers }); setReports(res.data); } catch (e) { toast.error("Failed"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="sla-report-gen-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Client SLA Reports</h1><p className="text-muted-foreground text-sm mt-1">Branded SLA performance reports for client meetings</p></div>

      <div className="space-y-4">{reports.map(r => (
        <Card key={r.id} data-testid={`sla-report-${r.id}`}>
          <CardContent className="pt-4">
            <div className="flex items-start justify-between">
              <div><h3 className="font-semibold">{r.client_name} — {r.period}</h3><p className="text-xs text-muted-foreground">Generated {new Date(r.generated_at).toLocaleDateString()} by {r.generated_by}</p></div>
              <Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-4">
              <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-xl font-bold text-emerald-500">{r.metrics.uptime_pct}%</p><p className="text-[10px] text-muted-foreground">Uptime</p></div>
              <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-xl font-bold">{r.metrics.avg_response_time_min}m</p><p className="text-[10px] text-muted-foreground">Avg Response</p></div>
              <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-xl font-bold">{r.metrics.avg_resolution_time_hours}h</p><p className="text-[10px] text-muted-foreground">Avg Resolution</p></div>
              <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-xl font-bold">{r.metrics.tickets_resolved}</p><p className="text-[10px] text-muted-foreground">Tickets Resolved</p></div>
              <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-xl font-bold text-blue-500">{r.metrics.sla_met_pct}%</p><p className="text-[10px] text-muted-foreground">SLA Met</p></div>
              <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-xl font-bold text-amber-500">{r.metrics.csat_avg}</p><p className="text-[10px] text-muted-foreground">CSAT</p></div>
            </div>
          </CardContent>
        </Card>
      ))}</div>
    </div>
  );
}
