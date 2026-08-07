import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DollarSign, AlertTriangle, RefreshCw, CheckCircle } from "lucide-react";

const statusColors = { active: "default", refresh_soon: "secondary", end_of_life: "destructive" };

export default function AssetDepreciationPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    axios.get(`${API}/asset-depreciation`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  const { stats, assets } = data;

  return (
    <div className="space-y-6" data-testid="asset-depreciation-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Asset Depreciation & Refresh Planner</h1>
        <p className="text-muted-foreground text-sm mt-1">Track asset value and plan hardware refreshes</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-xl font-bold">{stats.total}</p>
          <p className="text-xs text-muted-foreground">Total Assets</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <CheckCircle className="w-4 h-4 mx-auto mb-1 text-green-500" />
          <p className="text-xl font-bold text-green-500">{stats.active}</p>
          <p className="text-xs text-muted-foreground">Active</p>
        </CardContent></Card>
        <Card className="border-amber-500/30"><CardContent className="pt-4 pb-3 text-center">
          <RefreshCw className="w-4 h-4 mx-auto mb-1 text-amber-500" />
          <p className="text-xl font-bold text-amber-500">{stats.refresh_soon}</p>
          <p className="text-xs text-muted-foreground">Refresh Soon</p>
        </CardContent></Card>
        <Card className="border-red-500/30"><CardContent className="pt-4 pb-3 text-center">
          <AlertTriangle className="w-4 h-4 mx-auto mb-1 text-red-500" />
          <p className="text-xl font-bold text-red-500">{stats.end_of_life}</p>
          <p className="text-xs text-muted-foreground">End of Life</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <DollarSign className="w-4 h-4 mx-auto mb-1 text-green-500" />
          <p className="text-xl font-bold">${stats.total_current_value.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Current Value</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <DollarSign className="w-4 h-4 mx-auto mb-1 text-slate-400" />
          <p className="text-xl font-bold">${stats.total_original_value.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Original Value</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Asset Depreciation Schedule</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Hostname</TableHead><TableHead>Type</TableHead><TableHead>Client</TableHead>
              <TableHead className="text-right">Original</TableHead><TableHead className="text-right">Current</TableHead>
              <TableHead>Depreciation</TableHead><TableHead className="text-right">Age</TableHead>
              <TableHead className="text-right">Useful Life</TableHead><TableHead className="text-right">Refresh In</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {assets.map(a => (
                <TableRow key={a.id} data-testid={`depreciation-row-${a.id}`}>
                  <TableCell className="font-medium">{a.hostname}</TableCell>
                  <TableCell className="capitalize text-xs">{a.type}</TableCell>
                  <TableCell className="text-sm">{a.client_name}</TableCell>
                  <TableCell className="text-right font-mono">{a.purchase_price > 0 ? `$${a.purchase_price.toLocaleString()}` : "-"}</TableCell>
                  <TableCell className="text-right font-mono">{a.current_value > 0 ? `$${a.current_value.toLocaleString()}` : "-"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={a.depreciation_pct} className="h-2 w-16" />
                      <span className="text-xs">{a.depreciation_pct}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm">{a.age_years}y</TableCell>
                  <TableCell className="text-right text-sm">{a.useful_life}y</TableCell>
                  <TableCell className={`text-right text-sm ${a.refresh_in_years <= 0 ? "text-red-500 font-bold" : a.refresh_in_years < 1 ? "text-amber-500" : ""}`}>
                    {a.refresh_in_years <= 0 ? "Now" : `${a.refresh_in_years}y`}
                  </TableCell>
                  <TableCell><Badge variant={statusColors[a.status]} className="text-xs capitalize">{a.status?.replace("_"," ")}</Badge></TableCell>
                </TableRow>
              ))}
              {assets.length === 0 && <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No asset data available</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
