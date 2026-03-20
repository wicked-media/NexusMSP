import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, AlertTriangle, DollarSign, RefreshCw } from "lucide-react";

const urgencyColors = { high: "destructive", medium: "secondary", low: "outline" };

export default function ProcurementPlannerPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/procurement-planner/recommendations`, { headers }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-6" data-testid="procurement-planner-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Hardware Procurement Planner</h1>
        <p className="text-muted-foreground text-sm mt-1">Auto-generated purchase recommendations based on warranty & depreciation</p></div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><ShoppingCart className="w-4 h-4 mx-auto mb-1" /><p className="text-xl font-bold">{data.stats.total_recommendations}</p><p className="text-xs text-muted-foreground">Recommendations</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><AlertTriangle className="w-4 h-4 mx-auto mb-1 text-amber-500" /><p className="text-xl font-bold">{data.stats.warranty_issues}</p><p className="text-xs text-muted-foreground">Warranty Issues</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><RefreshCw className="w-4 h-4 mx-auto mb-1 text-red-500" /><p className="text-xl font-bold">{data.stats.eol_devices}</p><p className="text-xs text-muted-foreground">End of Life</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold">{data.stats.high_utilization}</p><p className="text-xs text-muted-foreground">High Utilization</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><DollarSign className="w-4 h-4 mx-auto mb-1 text-green-500" /><p className="text-xl font-bold">${data.stats.estimated_budget.toLocaleString()}</p><p className="text-xs text-muted-foreground">Est. Budget</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Procurement Recommendations</CardTitle></CardHeader>
        <CardContent>
          {data.recommendations.length === 0 ? <p className="text-sm text-muted-foreground py-8 text-center">No procurement recommendations at this time</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead>Reason</TableHead><TableHead>Detail</TableHead><TableHead>Recommendation</TableHead><TableHead>Est. Cost</TableHead><TableHead>Urgency</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data.recommendations.map((r, i) => (
                  <TableRow key={i} data-testid={`proc-rec-${i}`}>
                    <TableCell className="font-medium">{r.device_name}</TableCell>
                    <TableCell className="text-sm">{r.client_name}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize text-xs">{r.reason?.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px]">{r.detail}</TableCell>
                    <TableCell className="text-sm">{r.recommendation}</TableCell>
                    <TableCell className="font-mono">${r.estimated_cost.toLocaleString()}</TableCell>
                    <TableCell><Badge variant={urgencyColors[r.urgency]} className="capitalize text-xs">{r.urgency}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
