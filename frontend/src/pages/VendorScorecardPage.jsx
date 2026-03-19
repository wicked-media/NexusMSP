import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Building2, DollarSign, Star, Package, Truck } from "lucide-react";

const ratingColors = { excellent: "text-green-500", good: "text-blue-500", average: "text-amber-500", poor: "text-red-500" };

export default function VendorScorecardPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/vendor-scorecard/overview`, { headers })
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  const { summary, vendors } = data;

  return (
    <div className="space-y-6" data-testid="vendor-scorecard-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Vendor Scorecard & Spend Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Track vendor performance, fulfillment rates, and spend</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <Building2 className="w-5 h-5 mx-auto mb-1 text-blue-500" />
          <p className="text-xl font-bold">{summary.total_vendors}</p>
          <p className="text-xs text-muted-foreground">Total Vendors</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <DollarSign className="w-5 h-5 mx-auto mb-1 text-green-500" />
          <p className="text-xl font-bold">${summary.total_spend.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Total Spend</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <Star className="w-5 h-5 mx-auto mb-1 text-amber-500" />
          <p className="text-xl font-bold">{summary.avg_score}</p>
          <p className="text-xs text-muted-foreground">Avg Score</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <Package className="w-5 h-5 mx-auto mb-1 text-primary" />
          <p className="text-xl font-bold">{summary.top_vendor}</p>
          <p className="text-xs text-muted-foreground">Top Vendor</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Vendor Performance</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Vendor</TableHead><TableHead>Category</TableHead><TableHead className="text-right">POs</TableHead>
              <TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Fulfillment</TableHead>
              <TableHead className="text-right">Avg Delivery</TableHead><TableHead>Score</TableHead><TableHead>Rating</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {vendors.map(v => (
                <TableRow key={v.vendor_id} data-testid={`vendor-row-${v.vendor_id}`}>
                  <TableCell className="font-medium">{v.vendor_name}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize text-xs">{v.category}</Badge></TableCell>
                  <TableCell className="text-right">{v.total_pos}</TableCell>
                  <TableCell className="text-right font-mono">${v.total_spend.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Progress value={v.fulfillment_rate} className="h-2 w-16" />
                      <span className="text-xs">{v.fulfillment_rate}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{v.avg_delivery_days}d</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={v.score} className="h-2 w-12" />
                      <span className="text-xs font-bold">{v.score}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`text-xs font-medium capitalize ${ratingColors[v.rating]}`}>{v.rating}</span>
                  </TableCell>
                </TableRow>
              ))}
              {vendors.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No vendors found</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
