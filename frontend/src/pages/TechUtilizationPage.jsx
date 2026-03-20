import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { UserCog, Clock, DollarSign, Ticket } from "lucide-react";

export default function TechUtilizationPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/tech-utilization/dashboard`, { headers }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-6" data-testid="tech-utilization-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Technician Utilization</h1>
        <p className="text-muted-foreground text-sm mt-1">Billable vs non-billable hours and idle time analysis</p></div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><UserCog className="w-4 h-4 mx-auto mb-1" /><p className="text-xl font-bold">{data.summary.total_techs}</p><p className="text-xs text-muted-foreground">Technicians</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><Clock className="w-4 h-4 mx-auto mb-1 text-blue-500" /><p className="text-xl font-bold">{data.summary.total_hours_logged}h</p><p className="text-xs text-muted-foreground">Total Hours</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><DollarSign className="w-4 h-4 mx-auto mb-1 text-green-500" /><p className="text-xl font-bold">{data.summary.total_billable_hours}h</p><p className="text-xs text-muted-foreground">Billable Hours</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold">{data.summary.avg_utilization}%</p><p className="text-xs text-muted-foreground">Avg Utilization</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><DollarSign className="w-4 h-4 mx-auto mb-1 text-green-500" /><p className="text-xl font-bold">${data.summary.total_revenue.toLocaleString()}</p><p className="text-xs text-muted-foreground">Revenue</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Utilization by Technician</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Technician</TableHead><TableHead>Total Hours</TableHead><TableHead>Billable</TableHead><TableHead>Non-Billable</TableHead><TableHead>Utilization</TableHead><TableHead>Revenue</TableHead><TableHead>Active Tickets</TableHead><TableHead>Resolved</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.technicians.map(t => (
                <TableRow key={t.user_id} data-testid={`util-row-${t.user_id}`}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{t.total_hours}h</TableCell>
                  <TableCell className="text-green-500">{t.billable_hours}h</TableCell>
                  <TableCell className="text-muted-foreground">{t.non_billable_hours}h</TableCell>
                  <TableCell><div className="flex items-center gap-2"><Progress value={t.utilization_pct} className="h-2 w-16" /><span className="text-xs font-bold">{t.utilization_pct}%</span></div></TableCell>
                  <TableCell className="font-mono">${t.revenue_generated.toLocaleString()}</TableCell>
                  <TableCell>{t.active_tickets}</TableCell>
                  <TableCell>{t.resolved_tickets}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
