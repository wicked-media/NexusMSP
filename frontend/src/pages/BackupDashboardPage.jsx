import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  HardDrive, CheckCircle, XCircle, Clock, AlertTriangle, Search,
  RefreshCw, Loader2, Shield, Database, Server, Filter, BarChart3, Activity
} from "lucide-react";

const STATUS_ICON = { success: CheckCircle, failed: XCircle, running: Clock, warning: AlertTriangle };
const STATUS_COLOR = { success: "text-emerald-400 bg-emerald-500/10", failed: "text-red-400 bg-red-500/10", running: "text-blue-400 bg-blue-500/10", warning: "text-amber-400 bg-amber-500/10" };
const PROVIDER_COLOR = { Acronis: "bg-blue-500/20 text-blue-400", Veeam: "bg-emerald-500/20 text-emerald-400", Datto: "bg-cyan-500/20 text-cyan-400" };

export default function BackupDashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [clientData, setClientData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [search, setSearch] = useState("");
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
      } catch { toast.error("Failed to load backup data"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const { summary: s, jobs } = data;
  const providers = [...new Set(jobs.map(j => j.provider))];
  const filteredJobs = jobs.filter(j => {
    if (statusFilter !== "all" && j.status !== statusFilter) return false;
    if (providerFilter !== "all" && j.provider !== providerFilter) return false;
    if (search && !j.device_name.toLowerCase().includes(search.toLowerCase()) && !j.client_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const failedClients = clientData.filter(c => c.success_rate < 80);

  return (
    <div className="space-y-5" data-testid="backup-dashboard-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center"><Database className="w-5 h-5 text-white" /></div>
            Backup Monitoring Aggregator
          </h1>
          <p className="text-muted-foreground mt-1">Unified backup status across Veeam, Datto, Acronis — all clients in one view</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-6 gap-3">
        {[
          { label: "Success Rate", value: `${s.success_rate}%`, icon: CheckCircle, color: s.success_rate >= 95 ? "text-emerald-400" : "text-amber-400" },
          { label: "Successful", value: s.successful, icon: CheckCircle, color: "text-emerald-400" },
          { label: "Failed", value: s.failed, icon: XCircle, color: "text-red-400" },
          { label: "Running", value: s.running, icon: Clock, color: "text-blue-400" },
          { label: "Total Size", value: `${s.total_size_gb} GB`, icon: HardDrive, color: "text-cyan-400" },
          { label: "Total Jobs", value: s.total_jobs, icon: Database, color: "text-foreground" },
        ].map(st => (
          <Card key={st.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`text-2xl font-bold ${st.color}`}>{st.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Success gauge */}
      <Card className="border-border/40">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Backup Health (Target: 95%)</span>
            <span className={`text-sm font-bold ${s.success_rate >= 95 ? "text-emerald-400" : "text-amber-400"}`}>{s.success_rate}%</span>
          </div>
          <div className="relative"><Progress value={s.success_rate} className={`h-3 ${s.success_rate < 95 ? "[&>div]:bg-amber-500" : ""}`} /><div className="absolute top-0 left-[95%] h-3 w-0.5 bg-white/50" /></div>
          <div className="flex gap-3 mt-2">
            {providers.map(p => {
              const pJobs = jobs.filter(j => j.provider === p);
              const pSuccess = pJobs.filter(j => j.status === "success").length;
              const pRate = pJobs.length ? Math.round(pSuccess / pJobs.length * 100) : 0;
              return (
                <div key={p} className="flex items-center gap-1.5 text-xs">
                  <Badge className={`text-[10px] ${PROVIDER_COLOR[p] || ""}`}>{p}</Badge>
                  <span className={pRate >= 95 ? "text-emerald-400" : "text-amber-400"}>{pRate}%</span>
                  <span className="text-muted-foreground">({pJobs.length} jobs)</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="clients">
        <TabsList>
          <TabsTrigger value="clients">By Client ({clientData.length})</TabsTrigger>
          <TabsTrigger value="jobs">All Jobs ({jobs.length})</TabsTrigger>
          <TabsTrigger value="failures">Failures ({s.failed})</TabsTrigger>
        </TabsList>

        <TabsContent value="clients" className="mt-4">
          <Card className="border-border/40"><CardContent className="pt-4 space-y-2">
            {clientData.sort((a, b) => a.success_rate - b.success_rate).map(c => (
              <div key={c.client_name} className={`flex items-center gap-4 p-3 rounded-lg border transition-all ${c.success_rate < 80 ? "border-red-500/20 bg-red-500/5" : "border-border/30"}`} data-testid={`backup-client-${c.client_name}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.success_rate >= 95 ? "bg-emerald-500/10" : c.success_rate >= 80 ? "bg-amber-500/10" : "bg-red-500/10"}`}>
                  {c.success_rate >= 95 ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : c.success_rate >= 80 ? <AlertTriangle className="w-4 h-4 text-amber-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
                </div>
                <div className="flex-1"><p className="font-semibold text-sm">{c.client_name}</p><p className="text-xs text-muted-foreground">{c.total} jobs | {c.total_size_gb} GB</p></div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-emerald-400">{c.success} ok</span>
                  {c.failed > 0 && <span className="text-red-400">{c.failed} fail</span>}
                </div>
                <div className="w-32"><Progress value={c.success_rate} className={c.success_rate < 80 ? "[&>div]:bg-red-500" : c.success_rate < 95 ? "[&>div]:bg-amber-500" : ""} /><p className="text-[10px] text-right text-muted-foreground mt-0.5">{c.success_rate}%</p></div>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="jobs" className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
            <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="success">Success</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="running">Running</SelectItem><SelectItem value="warning">Warning</SelectItem></SelectContent></Select>
            <Select value={providerFilter} onValueChange={setProviderFilter}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Providers</SelectItem>{providers.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
          </div>
          <Card className="border-border/40"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-muted-foreground text-xs"><th className="p-3">Device</th><th className="p-3">Client</th><th className="p-3">Provider</th><th className="p-3">Type</th><th className="p-3">Status</th><th className="p-3">Size</th><th className="p-3">Duration</th><th className="p-3">Last Run</th></tr></thead>
              <tbody>{filteredJobs.map(j => {
                const StatusIcon = STATUS_ICON[j.status] || Clock;
                return (
                  <tr key={j.id} className="border-b border-border/30 hover:bg-muted/30">
                    <td className="p-3 font-medium">{j.device_name}</td>
                    <td className="p-3 text-muted-foreground">{j.client_name}</td>
                    <td className="p-3"><Badge className={`text-[10px] ${PROVIDER_COLOR[j.provider] || ""}`}>{j.provider}</Badge></td>
                    <td className="p-3 capitalize text-xs">{j.job_type}</td>
                    <td className="p-3"><Badge className={`text-[10px] ${STATUS_COLOR[j.status]}`}><StatusIcon className="w-3 h-3 mr-1" />{j.status}</Badge></td>
                    <td className="p-3">{j.size_gb} GB</td>
                    <td className="p-3">{j.duration_minutes}m</td>
                    <td className="p-3 text-xs text-muted-foreground">{new Date(j.last_run).toLocaleString()}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="failures" className="mt-4">
          <Card className="border-red-500/20"><CardHeader><CardTitle className="text-sm text-red-400 flex items-center gap-2"><XCircle className="w-4 h-4" />Failed Backup Jobs</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {jobs.filter(j => j.status === "failed").map(j => (
                <div key={j.id} className="flex items-center gap-3 p-3 rounded-lg border border-red-500/10 bg-red-500/5">
                  <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                  <div className="flex-1"><p className="font-semibold text-sm">{j.device_name}</p><p className="text-xs text-muted-foreground">{j.client_name} | {j.provider} | {j.job_type}</p></div>
                  <span className="text-xs text-muted-foreground">{new Date(j.last_run).toLocaleString()}</span>
                </div>
              ))}
              {jobs.filter(j => j.status === "failed").length === 0 && <p className="text-sm text-center py-8 text-emerald-400">No failed backups!</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
