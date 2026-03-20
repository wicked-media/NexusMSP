import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Calculator } from "lucide-react";
import { Input } from "@/components/ui/input";

export default function UsageBillingPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/usage-billing/overview`, { headers }).then(r => setData(r.data)); }, []);

  if (!data) return <div className="p-6 text-muted-foreground">Loading...</div>;
  const s = data.summary;
  return (
    <div className="space-y-6" data-testid="usage-billing-page">
      <div><h1 className="text-2xl font-bold">Usage-Based Billing</h1><p className="text-muted-foreground text-sm">Auto-calculate invoices from device counts, user seats, and storage</p></div>
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Total MRR</div><div className="text-3xl font-bold text-green-500 mt-1">${s.total_mrr.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Clients</div><div className="text-3xl font-bold mt-1">{s.total_clients}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Avg/Device</div><div className="text-3xl font-bold mt-1">${s.avg_per_device}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Overages</div><div className="text-3xl font-bold text-orange-500 mt-1">${s.overages_this_month.toLocaleString()}</div></CardContent></Card>
      </div>
      <div className="space-y-3">
        {data.plans.map(p => (
          <Card key={p.id}><CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{p.client_name}</h3>
                <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                  <span>{p.device_count} devices</span><span>{p.user_count} users</span><span>{p.storage_gb}GB storage</span>
                  <span>Base: ${p.base_fee}</span><span>Rate: ${p.per_device_rate}/device</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-green-500">${p.current_mrr.toLocaleString()}/mo</div>
                {p.overage_amount > 0 && <div className="text-xs text-orange-500">+${p.overage_amount} overage</div>}
                <Badge variant="outline" className="text-xs mt-1">{p.plan_type.replace("_", " ")}</Badge>
              </div>
            </div>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}
