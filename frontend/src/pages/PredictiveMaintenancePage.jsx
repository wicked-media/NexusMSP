import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, Shield, AlertTriangle, CheckCircle, Cpu,
  HardDrive, Clock, Zap, ChevronRight, Activity
} from "lucide-react";

const riskConfig = {
  critical: { label: "Critical", color: "bg-red-500", text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" },
  high: { label: "High", color: "bg-orange-500", text: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" },
  medium: { label: "Medium", color: "bg-amber-500", text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  low: { label: "Low", color: "bg-emerald-500", text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
};

export default function PredictiveMaintenancePage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [deviceDetail, setDeviceDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/predictive-maintenance/dashboard`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to fetch predictive data"); }
    finally { setLoading(false); }
  };

  const fetchDeviceDetail = async (deviceId) => {
    setDetailLoading(true);
    try {
      const res = await axios.get(`${API}/predictive-maintenance/device/${deviceId}`, { headers });
      setDeviceDetail(res.data);
      setSelectedDevice(deviceId);
    } catch { toast.error("Failed to fetch device details"); }
    finally { setDetailLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  if (selectedDevice && deviceDetail) {
    const pred = deviceDetail.prediction;
    const rc = riskConfig[pred.risk_level] || riskConfig.low;
    return (
      <div className="space-y-6" data-testid="device-prediction-detail">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => { setSelectedDevice(null); setDeviceDetail(null); }}>Back</Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{deviceDetail.device.name}</h1>
            <p className="text-muted-foreground text-sm">{deviceDetail.device.client_name} &middot; {deviceDetail.device.device_type} &middot; {deviceDetail.device.os}</p>
          </div>
          <Badge className={`${rc.bg} ${rc.text} ${rc.border} text-sm px-3 py-1`}>{rc.label} Risk</Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className={`${rc.border} border`}>
            <CardContent className="pt-4 text-center">
              <div className="relative w-24 h-24 mx-auto mb-3">
                <svg className="w-24 h-24 -rotate-90" viewBox="0 0 36 36">
                  <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted/30" />
                  <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${pred.risk_score}, 100`} className={rc.text} />
                </svg>
                <span className={`absolute inset-0 flex items-center justify-center text-2xl font-black ${rc.text}`}>{pred.risk_score}</span>
              </div>
              <p className="text-sm font-semibold">Risk Score</p>
              <p className="text-xs text-muted-foreground">Confidence: {pred.confidence}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <Clock className="w-5 h-5 text-amber-400 mb-2" />
              <p className="text-lg font-bold">{pred.predicted_failure_window}</p>
              <p className="text-xs text-muted-foreground">Predicted failure window</p>
              <p className="text-xs text-muted-foreground mt-1">Est. date: {pred.predicted_failure_date}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <AlertTriangle className="w-5 h-5 text-orange-400 mb-2" />
              <p className="text-lg font-bold">{deviceDetail.recent_alerts}</p>
              <p className="text-xs text-muted-foreground">Recent alerts</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <Activity className="w-5 h-5 text-blue-400 mb-2" />
              <p className="text-lg font-bold">{deviceDetail.recent_tickets}</p>
              <p className="text-xs text-muted-foreground">Recent tickets</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-400" />Risk Factors</CardTitle></CardHeader>
            <CardContent>
              {pred.risk_factors.length > 0 ? (
                <div className="space-y-2">
                  {pred.risk_factors.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded bg-orange-500/5 border border-orange-500/10">
                      <AlertTriangle className="w-3.5 h-3.5 text-orange-400 mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{f}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-center py-4 text-muted-foreground text-sm">No risk factors identified</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-emerald-400" />Recommendations</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {pred.recommendations.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded bg-emerald-500/5 border border-emerald-500/10">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                    <span className="text-sm">{r}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="predictive-maintenance-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Predictive Maintenance</h1>
          <p className="text-muted-foreground">AI-powered hardware failure prediction across your fleet</p>
        </div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Re-Analyze</Button>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-muted/50 flex items-center justify-center"><Cpu className="w-5 h-5" /></div><div><p className="text-2xl font-bold">{data.total_devices}</p><p className="text-xs text-muted-foreground">Total Devices</p></div></div></CardContent></Card>
            {Object.entries(riskConfig).map(([key, cfg]) => (
              <Card key={key} className={`${cfg.border} border`}>
                <CardContent className="pt-4"><div className="flex items-center gap-3"><div className={`w-10 h-10 rounded-lg ${cfg.bg} flex items-center justify-center`}><Shield className={`w-5 h-5 ${cfg.text}`} /></div><div><p className={`text-2xl font-bold ${cfg.text}`}>{data.risk_summary[key]}</p><p className="text-xs text-muted-foreground">{cfg.label} Risk</p></div></div></CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Device Risk Assessment</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                <div className="space-y-1 p-4">
                  {data.devices.map(device => {
                    const rc = riskConfig[device.risk_level] || riskConfig.low;
                    return (
                      <div key={device.device_id} className={`flex items-center gap-4 p-3 rounded-lg border ${rc.border} hover:bg-muted/30 cursor-pointer transition-all`}
                        onClick={() => fetchDeviceDetail(device.device_id)} data-testid={`device-risk-${device.device_id}`}>
                        <div className="relative w-12 h-12 flex-shrink-0">
                          <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                            <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/20" />
                            <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${device.risk_score}, 100`} className={rc.text} />
                          </svg>
                          <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${rc.text}`}>{device.risk_score}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm truncate">{device.device_name}</p>
                            <Badge className={`${rc.bg} ${rc.text} text-[9px]`}>{rc.label}</Badge>
                            {device.status === "offline" && <Badge className="bg-red-500/20 text-red-400 text-[9px]">Offline</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">{device.client_name} &middot; {device.device_type}</p>
                          {device.risk_factors.length > 0 && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{device.risk_factors[0]}</p>}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-muted-foreground">{device.predicted_failure_window}</p>
                          <p className="text-[10px] text-muted-foreground">failure window</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
