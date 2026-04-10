import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Activity, Shield, AlertTriangle, CheckCircle, HardDrive, Cpu, MemoryStick,
  Thermometer, RefreshCw, Loader2, ArrowLeft, Zap, Clock, Server
} from "lucide-react";

function HealthGauge({ score }) {
  const color = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";
  return (
    <div className="text-center">
      <div className="relative w-24 h-24 mx-auto">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="8" />
          <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" className={color} strokeWidth="8"
            strokeDasharray={`${score * 2.83} ${283 - score * 2.83}`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-2xl font-black ${color}`}>{score}</span>
        </div>
      </div>
      <Badge className={`mt-2 ${score >= 70 ? "bg-emerald-500/20 text-emerald-400" : score >= 40 ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>
        {score >= 70 ? "Healthy" : score >= 40 ? "Warning" : "Critical"}
      </Badge>
    </div>
  );
}

export default function PredictiveMaintenancePage() {
  const { token } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [deviceData, setDeviceData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/predictive/dashboard`, { headers });
      setDashboard(res.data);
    } catch { toast.error("Failed to fetch dashboard"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const analyzeDevice = async (deviceId) => {
    setAnalyzing(true);
    try {
      const res = await axios.post(`${API}/predictive/analyze/${deviceId}`, {}, { headers });
      setDeviceData(res.data);
      setSelectedDevice(deviceId);
      fetchDashboard();
    } catch { toast.error("Analysis failed"); }
    finally { setAnalyzing(false); }
  };

  const analyzeAll = async () => {
    setAnalyzing(true);
    try {
      const res = await axios.post(`${API}/predictive/analyze-all`, {}, { headers });
      toast.success(`Analyzed ${res.data.analyzed} devices`);
      fetchDashboard();
    } catch { toast.error("Batch analysis failed"); }
    finally { setAnalyzing(false); }
  };

  const resolveAlert = async (alertId) => {
    try {
      await axios.put(`${API}/predictive/alert/${alertId}/resolve`, {}, { headers });
      toast.success("Alert resolved");
      fetchDashboard();
    } catch { toast.error("Failed"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // DEVICE DETAIL
  if (selectedDevice && deviceData) {
    const t = deviceData.telemetry || {};
    return (
      <div className="space-y-5" data-testid="device-prediction-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedDevice(null); setDeviceData(null); }} data-testid="pred-back"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <Server className="w-5 h-5 text-blue-400" />
          <div>
            <h2 className="text-xl font-bold">{deviceData.device_name || "Device"}</h2>
            <p className="text-sm text-muted-foreground">{deviceData.client_name}</p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <Card className="col-span-1"><CardContent className="pt-6"><HealthGauge score={deviceData.health_score || 0} /></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><Cpu className="w-6 h-6 mx-auto text-blue-400 mb-1" /><p className="text-2xl font-black">{t.cpu_usage || 0}%</p><p className="text-[10px] text-muted-foreground">CPU Usage</p><Progress value={t.cpu_usage || 0} className="h-1 mt-2" /></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><MemoryStick className="w-6 h-6 mx-auto text-purple-400 mb-1" /><p className="text-2xl font-black">{t.memory_usage || 0}%</p><p className="text-[10px] text-muted-foreground">Memory</p><Progress value={t.memory_usage || 0} className="h-1 mt-2" /></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><HardDrive className="w-6 h-6 mx-auto text-amber-400 mb-1" /><p className="text-2xl font-black">{t.disk_usage || 0}%</p><p className="text-[10px] text-muted-foreground">Disk</p><Progress value={t.disk_usage || 0} className="h-1 mt-2" /></CardContent></Card>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Card><CardContent className="pt-4 text-center"><Thermometer className="w-6 h-6 mx-auto text-red-400 mb-1" /><p className="text-2xl font-black">{t.temperature || 0}°C</p><p className="text-[10px] text-muted-foreground">Temperature</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><Clock className="w-6 h-6 mx-auto text-cyan-400 mb-1" /><p className="text-2xl font-black">{t.uptime_days || 0}</p><p className="text-[10px] text-muted-foreground">Uptime (days)</p></CardContent></Card>
        </div>

        {(deviceData.predictions || []).length > 0 && (
          <Card className="border-amber-500/20">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Predicted Issues ({deviceData.predictions.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {deviceData.predictions.map((p, i) => (
                <div key={`k-${i}`} className={`p-3 rounded-lg border ${p.severity === "critical" ? "bg-red-500/5 border-red-500/20" : p.severity === "high" ? "bg-amber-500/5 border-amber-500/20" : "bg-muted/20 border-border/30"}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm">{p.component}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                      <p className="text-xs mt-1"><span className="text-muted-foreground">Recommendation: </span>{p.recommendation}</p>
                    </div>
                    <Badge className={`${p.severity === "critical" ? "bg-red-500/20 text-red-400" : p.severity === "high" ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"} text-[10px]`}>{p.severity}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // DASHBOARD
  const d = dashboard || {};
  return (
    <div className="space-y-5" data-testid="predictive-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Activity className="w-8 h-8 text-cyan-400" />Predictive Maintenance</h1>
          <p className="text-muted-foreground">{d.total_monitored || 0} devices monitored &middot; Avg health: {d.avg_health || 0}%</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchDashboard}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={analyzeAll} disabled={analyzing} data-testid="analyze-all-btn">
            {analyzing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}
            Analyze All Devices
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-red-400" /></div><div><p className="text-xs text-muted-foreground">Active Alerts</p><p className="text-xl font-bold text-red-400">{d.active_alerts || 0}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center"><Shield className="w-5 h-5 text-amber-400" /></div><div><p className="text-xs text-muted-foreground">Critical Devices</p><p className="text-xl font-bold text-amber-400">{d.critical_devices || 0}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center"><CheckCircle className="w-5 h-5 text-emerald-400" /></div><div><p className="text-xs text-muted-foreground">Resolved</p><p className="text-xl font-bold">{d.resolved_alerts || 0}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><Server className="w-5 h-5 text-blue-400" /></div><div><p className="text-xs text-muted-foreground">Monitored</p><p className="text-xl font-bold">{d.total_monitored || 0}</p></div></div></CardContent></Card>
      </div>

      <Card className="border-red-500/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Active Alerts</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead>Issue</TableHead><TableHead>Severity</TableHead><TableHead>Recommendation</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {(d.alerts || []).length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8"><CheckCircle className="w-8 h-8 mx-auto text-emerald-400 mb-2" /><p className="text-muted-foreground">No active alerts. All devices healthy!</p></TableCell></TableRow>
              ) : (d.alerts || []).map(a => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.device_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.client_name}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">{a.description}</TableCell>
                  <TableCell><Badge className={`${a.severity === "critical" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"} text-[10px]`}>{a.severity}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{a.recommendation}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => analyzeDevice(a.device_id)}>View</Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-emerald-400" onClick={() => resolveAlert(a.id)}>Resolve</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(d.at_risk_devices || []).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4 text-amber-400" />At-Risk Devices</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.at_risk_devices.map(dev => (
              <div key={dev.device_id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/30 cursor-pointer hover:bg-muted/30"
                onClick={() => analyzeDevice(dev.device_id)}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${dev.health_score < 30 ? "bg-red-500/10" : "bg-amber-500/10"}`}>
                    <span className={`text-lg font-black ${dev.health_score < 30 ? "text-red-400" : "text-amber-400"}`}>{dev.health_score}</span>
                  </div>
                  <div>
                    <p className="font-medium text-sm">{dev.device_name}</p>
                    <p className="text-xs text-muted-foreground">{dev.client_name}</p>
                  </div>
                </div>
                <Badge className={dev.health_score < 30 ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}>{dev.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
