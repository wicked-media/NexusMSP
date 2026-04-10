import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Calculator, DollarSign } from "lucide-react";

export default function PricingCalcPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ devices: 20, users: 40, labor_hours_month: 10, labor_rate: 125, target_margin_pct: 45 });
  const [result, setResult] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/pricing-calc/overview`, { headers }).then(r => setData(r.data)); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const calculate = async () => {
    const res = await axios.post(`${API}/pricing-calc/calculate`, form, { headers });
    setResult(res.data);
  };

  return (
    <div className="space-y-6" data-testid="pricing-calc-page">
      <div><h1 className="text-2xl font-bold">Dynamic Pricing Calculator</h1><p className="text-muted-foreground text-sm">Calculate optimal pricing with cost analysis and margin targets</p></div>
      <div className="grid grid-cols-2 gap-6">
        <Card><CardHeader><CardTitle className="text-base">Calculate Pricing</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(form).map(([key, val]) => (
                <div key={key}><label className="text-xs text-muted-foreground capitalize">{key.replace(/_/g, " ")}</label>
                <Input type="number" value={val} onChange={e => setForm(p => ({ ...p, [key]: Number(e.target.value) }))} /></div>
              ))}
            </div>
            <Button onClick={calculate} className="w-full" data-testid="calc-btn"><Calculator className="w-4 h-4 mr-1" />Calculate</Button>
            {result && (
              <div className="mt-4 p-4 rounded-lg border space-y-3">
                <div className="text-center"><div className="text-sm text-muted-foreground">Suggested MRR</div><div className="text-4xl font-bold text-green-500">${result.suggested_mrr.toLocaleString()}</div></div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Per Device:</span> ${result.per_device}</div>
                  <div><span className="text-muted-foreground">Per User:</span> ${result.per_user}</div>
                  <div><span className="text-muted-foreground">Margin:</span> {result.margin_pct}%</div>
                  <div><span className="text-muted-foreground">Profit:</span> <span className="text-green-500">${result.profit.toLocaleString()}</span></div>
                </div>
                <div className="text-xs text-muted-foreground border-t pt-2">Cost: Labor ${result.cost_breakdown.labor} + Tools ${result.cost_breakdown.tooling.toFixed(0)} + OH ${result.cost_breakdown.overhead.toFixed(0)} = ${result.cost_breakdown.total_cost.toFixed(0)}</div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">Client Pricing Comparisons</CardTitle></CardHeader>
          <CardContent><div className="space-y-3">
            {data?.calculations?.map(c => (
              <div key={c.id} className="p-3 rounded-lg border">
                <div className="flex items-center justify-between"><span className="font-medium">{c.client_name}</span><Badge variant={c.margin_pct >= 40 ? "default" : "secondary"}>{c.margin_pct}% margin</Badge></div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground mt-2">
                  <div>Cost: ${c.total_cost}</div><div>Suggested: ${c.suggested_mrr}</div><div>Actual: ${c.actual_mrr}</div>
                </div>
              </div>
            ))}
          </div></CardContent>
        </Card>
      </div>
    </div>
  );
}
