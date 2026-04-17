import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Shield, CheckCircle, AlertTriangle, XCircle, Loader2, RefreshCw, Monitor, Clock, Layers } from "lucide-react";

export default function PatchCompliancePage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [rings, setRings] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [res, ringRes] = await Promise.all([
        axios.get(`${API}/patch-compliance/overview`, { headers }),
        axios.get(`${API}/patch-compliance/rings`, { headers }),
      ]);
      setData(res.data);
      setRings(ringRes.data);
    } catch { toast.error("Failed to load patch data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const { summary, policies, devices } = data;
  const compColor = summary.compliance_pct >= 90 ? "text-emerald-400" : summary.compliance_pct >= 70 ? "text-amber-400" : "text-red-400";
  const patchColor = (s) => s === "current" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : s === "needs_attention" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-red-500/10 text-red-400 border-red-500/20";

  return (
    <div className="space-y-5" data-testid="patch-compliance-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Shield className="w-6 h-6 text-blue-400" />Patch Compliance</h1><p className="text-muted-foreground mt-1">Track patch status, policies, and deployment rings</p></div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        <Card className="col-span-1"><CardContent className="p-6 flex flex-col items-center justify-center">
          <p className={`text-5xl font-black ${compColor}`}>{summary.compliance_pct}%</p>
          <p className="text-xs text-muted-foreground mt-1">Compliance Rate</p>
        </CardContent></Card>
        {[
          { label: "Total Devices", value: summary.total_devices, icon: Monitor, color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "Compliant", value: summary.compliant, icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "Needs Attention", value: summary.needs_attention, icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "Critical", value: summary.critical, icon: XCircle, color: "text-red-400", bg: "bg-red-500/10" },
        ].map((s, i) => (
          <Card key={`s-${i}`}><CardContent className="p-3 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center`}><s.icon className={`w-4 h-4 ${s.color}`} /></div>
            <div><p className="text-lg font-bold">{s.value}</p><p className="text-[9px] text-muted-foreground uppercase tracking-wider">{s.label}</p></div>
          </CardContent></Card>
        ))}
      </div>

      {/* Deployment Rings */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Layers className="w-4 h-4" />Deployment Rings</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3">
            {rings.map(r => (
              <div key={r.id} className="p-3 rounded-xl border bg-card hover:border-primary/30 transition-colors" data-testid={`ring-${r.id}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm">{r.name}</span>
                  <Badge variant="outline" className="text-[9px]">{r.device_count} devices</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mb-2">{r.description}</p>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{r.delay_days}d delay</span>
                  <span className={r.auto_approve ? "text-emerald-400" : "text-amber-400"}>{r.auto_approve ? "Auto-approve" : "Manual"}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Policies */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Patch Policies</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Policy</TableHead><TableHead>OS Filter</TableHead><TableHead>Severity</TableHead><TableHead>Ring</TableHead><TableHead>Delay</TableHead><TableHead>Auto-Approve</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {policies.map((p, i) => (
                <TableRow key={`p-${i}`}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[9px]">{p.os_filter}</Badge></TableCell>
                  <TableCell className="capitalize text-xs">{p.severity_filter}</TableCell>
                  <TableCell className="text-xs">{p.ring}</TableCell>
                  <TableCell>{p.delay_days} days</TableCell>
                  <TableCell>{p.auto_approve ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-amber-400" />}</TableCell>
                  <TableCell><Badge className={p.enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-500/10 text-zinc-400"}>{p.enabled ? "Active" : "Disabled"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Device Patch Status */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Device Patch Status</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead>OS</TableHead><TableHead>Pending</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {devices.filter(d => d.patch_status).slice(0, 20).map((d, i) => (
                <TableRow key={`d-${i}`}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{d.client_name}</TableCell>
                  <TableCell className="text-xs">{d.os}</TableCell>
                  <TableCell className="font-mono">{d.pending_patches || 0}</TableCell>
                  <TableCell><Badge className={`${patchColor(d.patch_status)} text-[9px] border capitalize`}>{d.patch_status?.replace(/_/g, " ")}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
