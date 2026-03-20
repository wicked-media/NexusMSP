import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, AlertTriangle, Clock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LatePaymentPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/late-payment/predictions`, { headers }).then(r => setData(r.data)); }, []);

  if (!data) return <div className="p-6 text-muted-foreground">Loading...</div>;
  const s = data.summary;
  return (
    <div className="space-y-6" data-testid="late-payment-page">
      <div><h1 className="text-2xl font-bold">Late Payment Predictor</h1><p className="text-muted-foreground text-sm">AI flags clients likely to pay late based on history</p></div>
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Clients Tracked</div><div className="text-3xl font-bold mt-1">{s.total_clients}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">High Risk</div><div className="text-3xl font-bold text-red-500 mt-1">{s.high_risk}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">At Risk Amount</div><div className="text-3xl font-bold text-orange-500 mt-1">${s.total_at_risk.toLocaleString()}</div></CardContent></Card>
      </div>
      {data.predictions.map(p => (
        <Card key={p.id} className={p.risk === "high" ? "border-red-500/30" : p.risk === "medium" ? "border-orange-500/30" : ""}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${p.risk === "high" ? "bg-red-500/20" : p.risk === "medium" ? "bg-orange-500/20" : "bg-green-500/20"}`}>
                <DollarSign className={`w-5 h-5 ${p.risk === "high" ? "text-red-500" : p.risk === "medium" ? "text-orange-500" : "text-green-500"}`} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2"><span className="font-semibold">{p.client_name}</span><Badge variant={p.risk === "high" ? "destructive" : p.risk === "medium" ? "secondary" : "default"}>{p.risk} risk</Badge></div>
                <div className="text-sm text-muted-foreground">Outstanding: ${p.outstanding_amount.toLocaleString()} | Probability: {p.probability_pct}% | Late history: {p.late_history_count}x | Avg {p.avg_days_late}d late</div>
                <div className="text-xs text-muted-foreground mt-1">{p.recommended_action} | Next invoice: {p.next_invoice_date}</div>
              </div>
              {p.risk === "high" && <Button size="sm"><Send className="w-3 h-3 mr-1" />Send Reminder</Button>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
