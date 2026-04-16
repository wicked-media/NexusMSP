import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  HardDrive, CheckCircle, XCircle, Clock, AlertTriangle, Search,
  RefreshCw, Loader2, Shield, Database, Server, Play, Activity
} from "lucide-react";

const STATUS_ICON = { success: CheckCircle, failed: XCircle, running: Clock, warning: AlertTriangle };
const STATUS_COLOR = { success: "text-emerald-400 bg-emerald-500/10", failed: "text-red-400 bg-red-500/10", running: "text-blue-400 bg-blue-500/10", warning: "text-amber-400 bg-amber-500/10" };
const complianceColors = { compliant: "default", non_compliant: "destructive", no_backup: "outline" };

export default function BackupCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("dashboard");
  const [dashData, setDashData] = useState(null);
  const [clientData, setClientData] = useState([]);
  const [compData, setCompData] = useState(null);
  const [verifyData, setVerifyData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, clients, comp, verify] = await Promise.allSettled([
        axios.get(`${API}/backups`, { headers }),
        axios.get(`${API}/backups/by-client`, { headers }),
        axios.get(`${API}/backup-compliance/dashboard`, { headers }),
        axios.get(`${API}/backup-verify/overview`, { headers }),
      ]);
      if (dash.status === "fulfilled") setDashData(dash.value.data);
      if (clients.status === "fulfilled") setClientData(clients.value.data);
      if (comp.status === "fulfilled") setCompData(comp.value.data);
      if (verify.status === "fulfilled") setVerifyData(verify.value.data);
    } catch { toast.error("Failed to load backup data"); }
    finally { setLoading(false); }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const ds = dashData?.summary || {};
  const cs = compData?.stats || {};
  const vs = verifyData?.summary || {};

  return (
    <div className="space-y-5" data-testid="backup-center-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-cyan-500 flex items-center justify-center"><HardDrive className="w-5 h-5 text-white" /></div>
            Backup Center
          </h1>
          <p className="text-muted-foreground mt-1">Backup monitoring, compliance tracking, and restore verification</p>
        </div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="compliance" data-testid="tab-compliance">Compliance</TabsTrigger>
          <TabsTrigger value="verify" data-testid="tab-verify">Verification</TabsTrigger>
        </TabsList>

        {/* DASHBOARD */}
        <TabsContent value="dashboard" className="mt-4 space-y-4">
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Total Backups", value: ds.total || 0, icon: Database, color: "text-blue-400" },
              { label: "Successful", value: ds.successful || 0, icon: CheckCircle, color: "text-emerald-400" },
              { label: "Failed", value: ds.failed || 0, icon: XCircle, color: "text-red-400" },
              { label: "Running", value: ds.running || 0, icon: Activity, color: "text-cyan-400" },
              { label: "Success Rate", value: `${ds.success_rate || 0}%`, icon: Shield, color: "text-purple-400" },
            ].map(st => (
              <Card key={st.label}><CardContent className="pt-4 pb-3"><div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div><p className={`text-2xl font-bold ${st.color}`}>{st.value}</p></CardContent></Card>
            ))}
          </div>

          <div className="flex gap-3">
            <div className="flex-1 relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search backups..." value={search} onChange={e => setSearch(e.target.value)} /></div>
            <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="success">Success</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="running">Running</SelectItem></SelectContent></Select>
          </div>

          <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Device</TableHead><TableHead>Provider</TableHead><TableHead>Type</TableHead><TableHead>Size</TableHead><TableHead>Duration</TableHead><TableHead>Status</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
            <TableBody>{(dashData?.backups || []).filter(b => (statusFilter === "all" || b.status === statusFilter) && (!search || b.client_name?.toLowerCase().includes(search.toLowerCase()) || b.device_name?.toLowerCase().includes(search.toLowerCase()))).map((b, i) => {
              const Ico = STATUS_ICON[b.status] || Clock;
              return (
                <TableRow key={`k-${i}`}><TableCell className="font-medium">{b.client_name}</TableCell><TableCell className="text-sm">{b.device_name}</TableCell><TableCell><Badge variant="outline" className="text-[10px]">{b.provider}</Badge></TableCell><TableCell className="text-xs">{b.type}</TableCell><TableCell className="text-xs font-mono">{b.size_gb}GB</TableCell><TableCell className="text-xs">{b.duration_min}min</TableCell><TableCell><Badge className={`text-[10px] ${STATUS_COLOR[b.status] || ""}`}><Ico className="w-3 h-3 mr-1" />{b.status}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{new Date(b.completed_at || b.started_at).toLocaleString()}</TableCell></TableRow>
              );
            })}</TableBody></Table></CardContent></Card>
        </TabsContent>

        {/* COMPLIANCE */}
        <TabsContent value="compliance" className="mt-4 space-y-4">
          {!compData ? <p className="text-muted-foreground text-center py-12">No compliance data</p> : <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card><CardContent className="pt-4 pb-3 text-center"><HardDrive className="w-4 h-4 mx-auto mb-1" /><p className="text-xl font-bold">{cs.total_devices}</p><p className="text-xs text-muted-foreground">Total Devices</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 text-center"><CheckCircle className="w-4 h-4 mx-auto mb-1 text-green-500" /><p className="text-xl font-bold text-green-500">{cs.compliant}</p><p className="text-xs text-muted-foreground">Compliant</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 text-center"><XCircle className="w-4 h-4 mx-auto mb-1 text-red-500" /><p className="text-xl font-bold text-red-500">{cs.non_compliant}</p><p className="text-xs text-muted-foreground">Non-Compliant</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 text-center"><AlertTriangle className="w-4 h-4 mx-auto mb-1 text-amber-500" /><p className="text-xl font-bold text-amber-500">{cs.no_backup}</p><p className="text-xs text-muted-foreground">No Backup</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 text-center"><Shield className="w-4 h-4 mx-auto mb-1 text-primary" /><p className="text-xl font-bold">{cs.compliance_pct}%</p><p className="text-xs text-muted-foreground">Compliance Rate</p></CardContent></Card>
            </div>
            <Card><CardHeader><CardTitle className="text-base">Device Backup Status</CardTitle></CardHeader>
              <CardContent><Table><TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead>Type</TableHead><TableHead>Last Backup</TableHead><TableHead>RPO</TableHead><TableHead>RTO</TableHead><TableHead>Size</TableHead><TableHead>Compliance</TableHead></TableRow></TableHeader>
                <TableBody>{(compData.devices || []).map(d => (
                  <TableRow key={d.device_id}><TableCell className="font-medium">{d.device_name}</TableCell><TableCell className="text-sm">{d.client_name}</TableCell><TableCell className="capitalize text-xs">{d.device_type}</TableCell><TableCell className="text-xs">{d.last_backup ? new Date(d.last_backup).toLocaleString() : "Never"}</TableCell><TableCell>{d.rpo_hours ? `${d.rpo_hours}h` : "-"}</TableCell><TableCell>{d.rto_hours ? `${d.rto_hours}h` : "-"}</TableCell><TableCell>{d.size_gb ? `${d.size_gb}GB` : "-"}</TableCell><TableCell><Badge variant={complianceColors[d.compliance]} className="capitalize text-xs">{d.compliance?.replace("_", " ")}</Badge></TableCell></TableRow>
                ))}</TableBody></Table></CardContent></Card>
          </>}
        </TabsContent>

        {/* VERIFICATION */}
        <TabsContent value="verify" className="mt-4 space-y-4">
          {!verifyData ? <p className="text-muted-foreground text-center py-12">No verification data</p> : <>
            <div className="flex items-center justify-between"><div /><Button><Play className="w-4 h-4 mr-1" />Run Test</Button></div>
            <div className="grid grid-cols-4 gap-4">
              <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Total Tests</div><div className="text-3xl font-bold mt-1">{vs.total_tests}</div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Pass Rate</div><div className="text-3xl font-bold text-green-500 mt-1">{vs.pass_rate_pct}%</div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Failed</div><div className="text-3xl font-bold text-red-500 mt-1">{vs.failed}</div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Avg Restore</div><div className="text-3xl font-bold mt-1">{vs.avg_restore_time_min}m</div></CardContent></Card>
            </div>
            <div className="space-y-2">{(verifyData.tests || []).map(t => (
              <Card key={t.id}><CardContent className="pt-3 pb-3"><div className="flex items-center gap-4">
                {t.result === "pass" ? <CheckCircle className="w-5 h-5 text-green-500" /> : <XCircle className="w-5 h-5 text-red-500" />}
                <div className="flex-1"><div className="flex items-center gap-2"><span className="font-medium text-sm">{t.client_name}</span><Badge variant="outline" className="text-xs">{t.backup_type}</Badge><Badge variant="secondary" className="text-xs">{t.backup_solution}</Badge></div><div className="text-xs text-muted-foreground">Restore: {t.restore_time_minutes}min | Integrity: {t.data_integrity_check} {t.notes && `| ${t.notes}`}</div></div>
                <Badge variant={t.result === "pass" ? "default" : "destructive"}>{t.result}</Badge>
                <span className="text-xs text-muted-foreground">{new Date(t.tested_at).toLocaleDateString()}</span>
              </div></CardContent></Card>
            ))}</div>
          </>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
