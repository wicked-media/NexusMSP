import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { HardDrive, CheckCircle, XCircle, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function BackupDashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [clientData, setClientData] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [oRes, cRes] = await Promise.all([
          axios.get(`${API}/backup-dashboard/overview`, { headers }),
          axios.get(`${API}/backup-dashboard/clients`, { headers }),
        ]);
        setData(oRes.data);
        setClientData(cRes.data);
      } catch (e) { toast.error("Failed to load backup data"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const { summary, jobs } = data;
  const statusIcon = { success: <CheckCircle className="w-4 h-4 text-emerald-500" />, failed: <XCircle className="w-4 h-4 text-red-500" />, running: <Clock className="w-4 h-4 text-blue-500 animate-spin" />, warning: <AlertTriangle className="w-4 h-4 text-amber-500" /> };
  const statusColor = { success: "bg-emerald-500/10 text-emerald-500", failed: "bg-red-500/10 text-red-500", running: "bg-blue-500/10 text-blue-500", warning: "bg-amber-500/10 text-amber-500" };

  return (
    <div className="space-y-6" data-testid="backup-dashboard-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Backup Dashboard</h1><p className="text-muted-foreground text-sm mt-1">Unified backup status across all clients and providers</p></div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-5"><p className="text-3xl font-bold">{summary.success_rate}%</p><p className="text-xs text-muted-foreground">Success Rate</p><Progress value={summary.success_rate} className="mt-2" /></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><CheckCircle className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{summary.successful}</p><p className="text-xs text-muted-foreground">Successful</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><XCircle className="w-6 h-6 text-red-500" /><div><p className="text-2xl font-bold">{summary.failed}</p><p className="text-xs text-muted-foreground">Failed</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Clock className="w-6 h-6 text-blue-500" /><div><p className="text-2xl font-bold">{summary.running}</p><p className="text-xs text-muted-foreground">Running</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><HardDrive className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{summary.total_size_gb} GB</p><p className="text-xs text-muted-foreground">Total Size</p></div></CardContent></Card>
      </div>

      {/* By Client */}
      <Card><CardHeader><CardTitle className="text-lg">Backup Status by Client</CardTitle></CardHeader>
        <CardContent><div className="space-y-3">
          {clientData.map(c => (
            <div key={c.client_name} className="flex items-center gap-4 p-3 rounded-lg border" data-testid={`backup-client-${c.client_name}`}>
              <div className="flex-1"><p className="font-medium text-sm">{c.client_name}</p><p className="text-xs text-muted-foreground">{c.total} jobs | {c.total_size_gb} GB</p></div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-emerald-500">{c.success} ok</span>
                <span className="text-red-500">{c.failed} fail</span>
              </div>
              <div className="w-32"><Progress value={c.success_rate} className={c.success_rate < 80 ? "[&>div]:bg-red-500" : ""} /><p className="text-[10px] text-right text-muted-foreground mt-0.5">{c.success_rate}%</p></div>
            </div>
          ))}
        </div></CardContent>
      </Card>

      {/* All Jobs */}
      <Card><CardHeader><CardTitle className="text-lg">All Backup Jobs</CardTitle></CardHeader>
        <CardContent><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-3 font-medium">Device</th><th className="pb-3 font-medium">Client</th><th className="pb-3 font-medium">Provider</th><th className="pb-3 font-medium">Type</th><th className="pb-3 font-medium">Status</th><th className="pb-3 font-medium">Size</th><th className="pb-3 font-medium">Duration</th><th className="pb-3 font-medium">Last Run</th></tr></thead>
          <tbody>{jobs.map(j => (
            <tr key={j.id} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-2 font-medium">{j.device_name}</td>
              <td className="py-2 text-muted-foreground">{j.client_name}</td>
              <td className="py-2"><Badge variant="outline">{j.provider}</Badge></td>
              <td className="py-2 capitalize text-xs">{j.job_type}</td>
              <td className="py-2"><Badge className={statusColor[j.status]}>{j.status}</Badge></td>
              <td className="py-2">{j.size_gb} GB</td>
              <td className="py-2">{j.duration_minutes}m</td>
              <td className="py-2 text-xs text-muted-foreground">{new Date(j.last_run).toLocaleString()}</td>
            </tr>
          ))}</tbody>
        </table></div></CardContent>
      </Card>
    </div>
  );
}
