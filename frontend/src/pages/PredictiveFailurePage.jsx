import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, HardDrive, Thermometer, Cpu, Database } from "lucide-react";

export default function PredictiveFailurePage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/predictive-failure/overview`, { headers }).then(r => setData(r.data)); }, []);

  if (!data) return <div className="p-6 text-muted-foreground">Loading...</div>;
  const s = data.summary;
  const iconMap = { disk_failure: HardDrive, hardware_failure: Cpu, battery_failure: Activity, memory_failure: Database, psu_failure: Thermometer, ssd_wear: HardDrive, nic_failure: Activity, cooling_failure: Thermometer };
  return (
    <div className="space-y-6" data-testid="predictive-failure-page">
      <div><h1 className="text-2xl font-bold">Predictive Failure Detection</h1><p className="text-muted-foreground text-sm">ML-powered hardware failure predictions based on telemetry data</p></div>
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Predictions</div><div className="text-3xl font-bold mt-1">{s.total_predictions}</div></CardContent></Card>
        <Card className="border-red-500/30"><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Critical</div><div className="text-3xl font-bold text-red-500 mt-1">{s.critical}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Prevented This Month</div><div className="text-3xl font-bold text-green-500 mt-1">{s.prevented_this_month}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Model Accuracy</div><div className="text-3xl font-bold mt-1">{s.accuracy_pct}%</div></CardContent></Card>
      </div>
      <div className="space-y-3">
        {data.predictions.map(p => {
          const Icon = iconMap[p.failure_type] || AlertTriangle;
          return (
            <Card key={p.id} className={p.risk_level === "critical" ? "border-red-500/30" : p.risk_level === "high" ? "border-orange-500/30" : ""}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${p.risk_level === "critical" ? "bg-red-500/20" : p.risk_level === "high" ? "bg-orange-500/20" : "bg-yellow-500/20"}`}>
                    <Icon className={`w-6 h-6 ${p.risk_level === "critical" ? "text-red-500" : p.risk_level === "high" ? "text-orange-500" : "text-yellow-500"}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2"><span className="font-semibold">{p.prediction}</span><Badge variant={p.risk_level === "critical" ? "destructive" : p.risk_level === "high" ? "secondary" : "outline"}>{p.risk_level}</Badge></div>
                    <div className="text-sm text-muted-foreground">{p.device_name} - {p.client_name}</div>
                    <div className="text-xs text-muted-foreground mt-1">Confidence: {p.confidence_pct}% | Data points: {p.data_points_analyzed.toLocaleString()} | {p.recommended_action}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${p.days_until_failure <= 7 ? "text-red-500" : p.days_until_failure <= 14 ? "text-orange-500" : "text-yellow-500"}`}>{p.days_until_failure}d</div>
                    <div className="text-xs text-muted-foreground">until failure</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
