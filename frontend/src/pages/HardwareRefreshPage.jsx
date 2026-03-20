import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { HardDrive, AlertTriangle, Clock, DollarSign } from "lucide-react";

export default function HardwareRefreshPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/hardware-refresh/overview`, { headers }).then(r => setData(r.data)); }, []);

  if (!data) return <div className="p-6 text-muted-foreground">Loading...</div>;
  const s = data.summary;
  return (
    <div className="space-y-6" data-testid="hardware-refresh-page">
      <div><h1 className="text-2xl font-bold">Hardware Refresh Planner</h1><p className="text-muted-foreground text-sm">EOL tracking, replacement timelines, and budget planning</p></div>
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Devices Tracked</div><div className="text-3xl font-bold mt-1">{s.total_tracked}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">EOL Approaching</div><div className="text-3xl font-bold text-yellow-500 mt-1">{s.eol_approaching}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">EOL Passed</div><div className="text-3xl font-bold text-red-500 mt-1">{s.eol_passed}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Budget Needed</div><div className="text-3xl font-bold mt-1">${(s.replacement_budget_needed / 1000).toFixed(0)}k</div></CardContent></Card>
      </div>
      <Card><CardContent className="pt-4">
        <div className="space-y-2">
          {data.devices.map(d => (
            <div key={d.id} className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/50">
              <HardDrive className={`w-5 h-5 ${d.status === "eol_passed" ? "text-red-500" : d.status === "eol_approaching" ? "text-yellow-500" : "text-green-500"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2"><span className="font-medium text-sm">{d.device_name}</span><Badge variant="outline" className="text-xs">{d.type}</Badge></div>
                <div className="text-xs text-muted-foreground">{d.client_name} | {d.manufacturer} {d.model} | Age: {d.age_years}yr | Purchased: {d.purchase_date}</div>
              </div>
              <div className="text-right text-sm">
                <div className="text-xs text-muted-foreground">Warranty: {d.warranty_end}</div>
                {d.replacement_cost > 0 && <div className="font-medium">${d.replacement_cost.toLocaleString()}</div>}
              </div>
              <Badge variant={d.status === "eol_passed" ? "destructive" : d.status === "eol_approaching" ? "secondary" : "default"} className="text-xs w-28 justify-center">{d.status.replace("_", " ")}</Badge>
            </div>
          ))}
        </div>
      </CardContent></Card>
    </div>
  );
}
