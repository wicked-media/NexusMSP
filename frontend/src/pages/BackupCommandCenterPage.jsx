import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Loader2, HardDrive, Shield, CheckCircle, XCircle, AlertTriangle, Clock, Database } from "lucide-react";

export default function BackupCommandCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("dashboard");
  const [dashboard, setDashboard] = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [verify, setVerify] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/backup-dashboard/overview`, { headers }).catch(() => ({ data: null })),
      axios.get(`${API}/backup-compliance/dashboard`, { headers }).catch(() => ({ data: null })),
      axios.get(`${API}/backup-verify/overview`, { headers }).catch(() => ({ data: null })),
    ]).then(([d, c, v]) => { setDashboard(d.data); setCompliance(c.data); setVerify(v.data); }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const ds = dashboard?.summary || dashboard || {};
  const cs = compliance?.summary || compliance || {};
  const vs = verify?.summary || verify || {};

  return (
    <div className="space-y-5" data-testid="backup-command-center">
      <div><h1 className="text-3xl font-bold tracking-tight">Backup Command Center</h1><p className="text-sm text-muted-foreground">Backup status, compliance scoring, and verification across all clients</p></div>
      <div className="grid grid-cols-5 gap-3">
        <Card><CardContent className="pt-4 pb-3"><Database className="w-5 h-5 text-blue-400 mb-1" /><p className="text-2xl font-bold">{ds.total_jobs || ds.total_backups || 0}</p><p className="text-[11px] text-muted-foreground">Total Backup Jobs</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><CheckCircle className="w-5 h-5 text-emerald-400 mb-1" /><p className="text-2xl font-bold text-emerald-400">{ds.successful || ds.success_count || 0}</p><p className="text-[11px] text-muted-foreground">Successful</p></CardContent></Card>
        <Card className="border-red-500/20"><CardContent className="pt-4 pb-3"><XCircle className="w-5 h-5 text-red-400 mb-1" /><p className="text-2xl font-bold text-red-400">{ds.failed || ds.fail_count || 0}</p><p className="text-[11px] text-muted-foreground">Failed</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><Shield className="w-5 h-5 text-violet-400 mb-1" /><p className="text-2xl font-bold">{cs.avg_score || cs.compliance_score || 0}%</p><p className="text-[11px] text-muted-foreground">Compliance Score</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><Clock className="w-5 h-5 text-amber-400 mb-1" /><p className="text-2xl font-bold">{vs.verified_count || vs.total_verified || 0}</p><p className="text-[11px] text-muted-foreground">Verified Restores</p></CardContent></Card>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="dashboard"><HardDrive className="w-3 h-3 mr-1" />Dashboard</TabsTrigger>
          <TabsTrigger value="compliance"><Shield className="w-3 h-3 mr-1" />Compliance</TabsTrigger>
          <TabsTrigger value="verification"><CheckCircle className="w-3 h-3 mr-1" />Verification</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard">
          {(dashboard?.clients || dashboard?.jobs || []).length > 0 ? (
            <Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Last Backup</TableHead><TableHead>Status</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Size</TableHead></TableRow></TableHeader>
              <TableBody>{(dashboard?.clients || dashboard?.jobs || []).map((b, i) => (<TableRow key={i}><TableCell className="font-medium">{b.client_name || b.name}</TableCell><TableCell className="text-sm">{(b.last_backup || b.timestamp || "").slice(0, 16)}</TableCell><TableCell><Badge variant={b.status === "success" ? "default" : "destructive"} className="text-[10px] capitalize">{b.status}</Badge></TableCell><TableCell className="text-sm">{b.backup_type || b.type || "Full"}</TableCell><TableCell className="text-right text-sm">{b.size_gb ? `${b.size_gb}GB` : "N/A"}</TableCell></TableRow>))}</TableBody></Table>
          ) : <p className="text-center text-muted-foreground py-8">No backup data available</p>}
        </TabsContent>
        <TabsContent value="compliance">
          {(compliance?.clients || compliance?.scores || []).length > 0 ? (
            <div className="grid grid-cols-2 gap-3">{(compliance?.clients || compliance?.scores || []).map((c, i) => (
              <Card key={i}><CardContent className="py-3"><div className="flex items-center justify-between mb-2"><span className="font-medium text-sm">{c.client_name || c.name}</span><Badge variant={c.score >= 80 ? "default" : c.score >= 50 ? "secondary" : "destructive"} className="text-[10px]">{c.score}%</Badge></div><Progress value={c.score} className="h-2" /><div className="flex gap-2 mt-1 text-[10px] text-muted-foreground">{c.has_offsite && <span className="text-emerald-400">Offsite</span>}{c.has_encryption && <span className="text-blue-400">Encrypted</span>}{c.has_testing && <span className="text-violet-400">Tested</span>}</div></CardContent></Card>
            ))}</div>
          ) : <p className="text-center text-muted-foreground py-8">No compliance data</p>}
        </TabsContent>
        <TabsContent value="verification">
          {(verify?.tests || verify?.verifications || []).length > 0 ? (
            <Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Test Date</TableHead><TableHead>Restore Type</TableHead><TableHead>Duration</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
              <TableBody>{(verify?.tests || verify?.verifications || []).map((v, i) => (<TableRow key={i}><TableCell className="font-medium">{v.client_name || v.name}</TableCell><TableCell className="text-sm">{(v.test_date || v.date || "").slice(0, 10)}</TableCell><TableCell className="text-sm">{v.restore_type || v.type || "Full"}</TableCell><TableCell className="text-sm">{v.duration || "N/A"}</TableCell><TableCell><Badge variant={v.result === "success" || v.status === "passed" ? "default" : "destructive"} className="text-[10px] capitalize">{v.result || v.status}</Badge></TableCell></TableRow>))}</TableBody></Table>
          ) : <p className="text-center text-muted-foreground py-8">No verification tests</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
