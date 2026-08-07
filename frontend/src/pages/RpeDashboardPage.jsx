import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DollarSign, Monitor, TrendingDown, AlertTriangle, Target } from "lucide-react";

const statusColors = { above_target: "text-green-500", at_target: "text-blue-500", below_target: "text-red-500", no_devices: "text-slate-400" };
const statusLabels = { above_target: "Above Target", at_target: "At Target", below_target: "Below Target", no_devices: "No Devices" };

export default function RpeDashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    axios.get(`${API}/rpe/dashboard`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  const { summary, clients } = data;

  return (
    <div className="space-y-6" data-testid="rpe-dashboard-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Revenue Per Endpoint</h1>
        <p className="text-muted-foreground text-sm mt-1">Real-time RPE analysis across all clients</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <DollarSign className="w-5 h-5 mx-auto mb-1 text-green-500" />
          <p className="text-xl font-bold">${summary.total_revenue.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Monthly Revenue</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <Monitor className="w-5 h-5 mx-auto mb-1 text-blue-500" />
          <p className="text-xl font-bold">{summary.total_endpoints}</p>
          <p className="text-xs text-muted-foreground">Total Endpoints</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <Target className="w-5 h-5 mx-auto mb-1 text-primary" />
          <p className="text-xl font-bold">${summary.avg_rpe}</p>
          <p className="text-xs text-muted-foreground">Average RPE</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <Target className="w-5 h-5 mx-auto mb-1 text-amber-500" />
          <p className="text-xl font-bold">${summary.target_rpe}</p>
          <p className="text-xs text-muted-foreground">Target RPE</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <TrendingDown className="w-5 h-5 mx-auto mb-1 text-red-500" />
          <p className="text-xl font-bold">{summary.below_target}</p>
          <p className="text-xs text-muted-foreground">Below Target</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <AlertTriangle className="w-5 h-5 mx-auto mb-1 text-amber-500" />
          <p className="text-xl font-bold">${summary.revenue_gap.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Revenue Gap</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Client RPE Breakdown</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead>Tier</TableHead><TableHead className="text-right">Devices</TableHead>
              <TableHead className="text-right">Monthly Rev</TableHead><TableHead className="text-right">RPE</TableHead>
              <TableHead>vs Target</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {clients.map(c => (
                <TableRow key={c.client_id} data-testid={`rpe-row-${c.client_id}`}>
                  <TableCell className="font-medium">{c.client_name}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{c.tier}</Badge></TableCell>
                  <TableCell className="text-right">{c.devices}</TableCell>
                  <TableCell className="text-right font-mono">${c.monthly_revenue.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono font-bold">${c.rpe}</TableCell>
                  <TableCell>
                    {c.devices > 0 && (
                      <div className="flex items-center gap-2">
                        <Progress value={Math.min(100, (c.rpe / summary.target_rpe) * 100)} className="h-2 w-20" />
                        <span className="text-xs">{Math.round((c.rpe / summary.target_rpe) * 100)}%</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={`text-xs font-medium ${statusColors[c.status]}`}>{statusLabels[c.status]}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
