import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, TrendingUp, AlertTriangle, Target } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid } from "recharts";

export default function CapacityPlannerPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try { const res = await axios.get(`${API}/capacity-planner/overview`, { headers }); setData(res.data); } catch (e) { toast.error("Failed"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="capacity-planner-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Resource Capacity Planner</h1><p className="text-muted-foreground text-sm mt-1">Forecast technician headcount based on ticket trends</p></div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-5 flex items-center gap-3"><Users className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{data.current.technicians}</p><p className="text-xs text-muted-foreground">Technicians</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Target className="w-6 h-6 text-blue-500" /><div><p className="text-2xl font-bold">{data.current.tickets_per_tech}</p><p className="text-xs text-muted-foreground">Tickets/Tech</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><TrendingUp className="w-6 h-6 text-amber-500" /><div><p className="text-2xl font-bold">{data.current.devices_per_tech}</p><p className="text-xs text-muted-foreground">Devices/Tech</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Users className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{data.current.utilization_pct}%</p><p className="text-xs text-muted-foreground">Utilization</p></div></CardContent></Card>
        <Card className={data.forecast.hiring_needed ? "border-amber-500" : ""}><CardContent className="pt-5"><p className="text-2xl font-bold">{data.forecast.recommended_techs}</p><p className="text-xs text-muted-foreground">Recommended Headcount</p>{data.forecast.hiring_needed && <Badge variant="warning" className="mt-1">Hiring Needed</Badge>}</CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle className="text-lg">Capacity Trend (6 months)</CardTitle></CardHeader>
        <CardContent><div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="tech_hours_used" name="Hours Used" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="tech_hours_available" name="Hours Available" fill="hsl(var(--muted))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div></CardContent>
      </Card>
    </div>
  );
}
