import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ShieldCheck, AlertTriangle, XCircle, Monitor } from "lucide-react";
import { toast } from "sonner";

export default function PatchCompliancePage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [rings, setRings] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [oRes, rRes] = await Promise.all([
          axios.get(`${API}/patch-compliance/overview`, { headers }),
          axios.get(`${API}/patch-compliance/rings`, { headers }),
        ]);
        setData(oRes.data);
        setRings(rRes.data);
      } catch (e) { toast.error("Failed to load patch data"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const { summary, policies, devices } = data;
  const statusColor = { current: "bg-emerald-500/10 text-emerald-500", needs_attention: "bg-amber-500/10 text-amber-500", critical: "bg-red-500/10 text-red-500" };

  return (
    <div className="space-y-6" data-testid="patch-compliance-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Patch Compliance</h1><p className="text-muted-foreground text-sm mt-1">Automated patch management and compliance tracking</p></div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5"><div className="flex items-center justify-between"><div><p className="text-3xl font-bold">{summary.compliance_pct}%</p><p className="text-xs text-muted-foreground">Overall Compliance</p></div><ShieldCheck className="w-8 h-8 text-emerald-500" /></div><Progress value={summary.compliance_pct} className="mt-3" /></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><div className="p-2 rounded-lg bg-emerald-500/10"><Monitor className="w-5 h-5 text-emerald-500" /></div><div><p className="text-2xl font-bold">{summary.compliant}</p><p className="text-xs text-muted-foreground">Fully Patched</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><div className="p-2 rounded-lg bg-amber-500/10"><AlertTriangle className="w-5 h-5 text-amber-500" /></div><div><p className="text-2xl font-bold">{summary.needs_attention}</p><p className="text-xs text-muted-foreground">Needs Attention</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><div className="p-2 rounded-lg bg-red-500/10"><XCircle className="w-5 h-5 text-red-500" /></div><div><p className="text-2xl font-bold">{summary.critical}</p><p className="text-xs text-muted-foreground">Critical</p></div></CardContent></Card>
      </div>

      {/* Patch Rings */}
      <Card><CardHeader><CardTitle className="text-lg">Patch Deployment Rings</CardTitle></CardHeader>
        <CardContent><div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {rings.map(r => (
            <div key={r.id} className="p-4 rounded-lg border bg-muted/30" data-testid={`ring-${r.id}`}>
              <h3 className="font-semibold text-sm">{r.name}</h3>
              <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs">{r.device_count} devices</span>
                <Badge variant={r.auto_approve ? "default" : "outline"}>{r.auto_approve ? "Auto" : "Manual"}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{r.delay_days}d delay</p>
            </div>
          ))}
        </div></CardContent>
      </Card>

      {/* Policies */}
      <Card><CardHeader><CardTitle className="text-lg">Patch Policies</CardTitle></CardHeader>
        <CardContent><div className="space-y-2">
          {policies.map(p => (
            <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border" data-testid={`policy-${p.id}`}>
              <div><p className="font-medium text-sm">{p.name}</p><p className="text-xs text-muted-foreground">OS: {p.os_filter} | Severity: {p.severity_filter}</p></div>
              <div className="flex items-center gap-2">
                <Badge variant={p.auto_approve ? "default" : "outline"}>{p.auto_approve ? "Auto-Approve" : "Manual"}</Badge>
                <Badge variant={p.enabled ? "default" : "secondary"}>{p.enabled ? "Enabled" : "Disabled"}</Badge>
              </div>
            </div>
          ))}
        </div></CardContent>
      </Card>

      {/* Devices */}
      <Card><CardHeader><CardTitle className="text-lg">Device Patch Status</CardTitle></CardHeader>
        <CardContent><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-3 font-medium">Device</th><th className="pb-3 font-medium">Client</th><th className="pb-3 font-medium">OS</th><th className="pb-3 font-medium">Status</th><th className="pb-3 font-medium">Pending</th></tr></thead>
          <tbody>{devices.slice(0, 30).map(d => (
            <tr key={d.id} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-2 font-medium">{d.name}</td>
              <td className="py-2 text-muted-foreground">{d.client_name}</td>
              <td className="py-2 text-xs">{d.os}</td>
              <td className="py-2"><Badge className={statusColor[d.patch_status] || ""}>{d.patch_status || "unknown"}</Badge></td>
              <td className="py-2">{d.pending_patches || 0}</td>
            </tr>
          ))}</tbody>
        </table></div></CardContent>
      </Card>
    </div>
  );
}
