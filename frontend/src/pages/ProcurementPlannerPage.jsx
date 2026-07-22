import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { AlertTriangle, ArrowUpRight, CircleDollarSign, RefreshCw, ShoppingCart, Wrench } from "lucide-react";
import { toast } from "sonner";

const urgencyColors = { high: "destructive", medium: "secondary", low: "outline" };
const currency = (value) => value == null ? "TBD" : `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function ProcurementPlannerPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async (showToast = false) => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/procurement-planner/recommendations`, { headers });
      setData(response.data);
      if (showToast) toast.success("Procurement evidence refreshed");
    } catch (error) {
      setData(null);
      toast.error(error.response?.data?.detail || "Procurement recommendations could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const stats = data?.stats || { total_recommendations: 0, warranty_issues: 0, eol_devices: 0, high_utilization: 0, estimated_budget: 0, unknown_cost_count: 0 };
  return (
    <div className="space-y-5" data-testid="procurement-planner-page">
      <OperationalPageHeader
        eyebrow="Inventory planning"
        title="Procurement Planner"
        description="Evidence-based refresh recommendations from tracked asset warranty, lifecycle, recorded cost, and linked managed-asset telemetry. No estimated cost is invented."
        icon={ShoppingCart}
        tone="sky"
        actions={<><Button variant="outline" size="sm" onClick={() => navigate("/assets")}><ArrowUpRight className="mr-1 h-4 w-4" />Open inventory</Button><Button size="sm" onClick={() => load(true)} disabled={loading}><RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh evidence</Button></>}
      />

      <MetricStrip columns={6}>
        <MetricTile label="Recommendations" value={stats.total_recommendations} accent="sky" icon={<ShoppingCart />} testid="procurement-total" />
        <MetricTile label="Warranty reviews" value={stats.warranty_issues} accent="amber" icon={<AlertTriangle />} testid="procurement-warranty" />
        <MetricTile label="End of life" value={stats.eol_devices} accent="rose" icon={<Wrench />} testid="procurement-eol" />
        <MetricTile label="Capacity signals" value={stats.high_utilization} accent="violet" icon={<RefreshCw />} testid="procurement-capacity" />
        <MetricTile label="Known budget" value={currency(stats.estimated_budget)} accent="emerald" icon={<CircleDollarSign />} testid="procurement-budget" />
        <MetricTile label="Cost to confirm" value={stats.unknown_cost_count} accent="zinc" icon={<CircleDollarSign />} testid="procurement-unknown-cost" />
      </MetricStrip>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Recommended actions</CardTitle><p className="text-sm text-muted-foreground">A cost marked <span className="font-medium text-foreground">TBD</span> needs a recorded inventory cost before it can contribute to the planning budget.</p></CardHeader>
        <CardContent className="p-0">
          {!data ? <div className="px-6 py-12 text-center text-sm text-muted-foreground">The planning feed is unavailable. Refresh to retry.</div> : data.recommendations.length === 0 ? <div className="px-6 py-12 text-center text-sm text-muted-foreground">No procurement recommendations at this time.</div> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Asset</TableHead><TableHead>Client</TableHead><TableHead>Evidence</TableHead><TableHead>Detail</TableHead><TableHead>Recommended action</TableHead><TableHead>Planning cost</TableHead><TableHead>Urgency</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data.recommendations.map((recommendation) => (
                  <TableRow key={recommendation.asset_id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/assets/${recommendation.asset_id}`)} data-testid={`proc-rec-${recommendation.asset_id}`}>
                    <TableCell><div className="font-medium">{recommendation.device_name || "Unnamed asset"}</div><div className="font-mono text-[11px] text-muted-foreground">{recommendation.asset_tag || "No asset tag"}</div></TableCell>
                    <TableCell className="text-sm">{recommendation.client_name || "Unassigned"}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize text-xs">{recommendation.reason?.replaceAll("_", " ")}</Badge></TableCell>
                    <TableCell className="max-w-[250px] text-xs text-muted-foreground">{recommendation.detail}</TableCell>
                    <TableCell className="text-sm">{recommendation.recommendation}</TableCell>
                    <TableCell className="font-mono text-sm">{currency(recommendation.estimated_cost)}</TableCell>
                    <TableCell><Badge variant={urgencyColors[recommendation.urgency] || "outline"} className="capitalize text-xs">{recommendation.urgency}</Badge></TableCell>
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
