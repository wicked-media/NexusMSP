import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function ThirdPartyPatchingPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [oRes, pRes] = await Promise.all([
          axios.get(`${API}/third-party-patching/overview`, { headers: { Authorization: `Bearer ${token}` } }),
          axios.get(`${API}/third-party-patching/policies`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        setData(oRes.data);
        setPolicies(pRes.data);
      } catch (e) { toast.error("Failed"); }
      setLoading(false);
    };
    fetchData();
  }, [token]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const sevColor = { critical: "destructive", high: "warning", medium: "secondary", low: "outline" };

  return (
    <div className="space-y-6" data-testid="third-party-patching-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Third-Party Patching</h1><p className="text-muted-foreground text-sm mt-1">Track and manage 100+ third-party applications</p></div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5"><p className="text-3xl font-bold">{data.summary.compliance_pct}%</p><p className="text-xs text-muted-foreground">Compliance</p><Progress value={data.summary.compliance_pct} className="mt-2" /></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><ShieldCheck className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{data.summary.current}</p><p className="text-xs text-muted-foreground">Current</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><AlertTriangle className="w-6 h-6 text-amber-500" /><div><p className="text-2xl font-bold">{data.summary.outdated}</p><p className="text-xs text-muted-foreground">Outdated</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><AlertTriangle className="w-6 h-6 text-red-500" /><div><p className="text-2xl font-bold">{data.summary.critical_updates}</p><p className="text-xs text-muted-foreground">Critical Updates</p></div></CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle className="text-lg">Update Policies</CardTitle></CardHeader>
        <CardContent><div className="space-y-2">{policies.map(p => (
          <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border">
            <span className="font-medium text-sm">{p.app_name}</span>
            <div className="flex items-center gap-2"><Badge variant={p.auto_update ? "default" : "outline"}>{p.auto_update ? "Auto" : "Manual"}</Badge><Badge variant="outline">{p.ring}</Badge></div>
          </div>
        ))}</div></CardContent>
      </Card>

      <Card><CardHeader><CardTitle className="text-lg">Outdated Applications</CardTitle></CardHeader>
        <CardContent><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-3 font-medium">Application</th><th className="pb-3 font-medium">Device</th><th className="pb-3 font-medium">Client</th><th className="pb-3 font-medium">Installed</th><th className="pb-3 font-medium">Latest</th><th className="pb-3 font-medium">Severity</th></tr></thead>
          <tbody>{data.apps.filter(a => a.status === "outdated").slice(0, 30).map(a => (
            <tr key={a.id} className="border-b border-border/50">
              <td className="py-2 font-medium">{a.app_name}</td><td className="py-2 text-xs">{a.device_name}</td><td className="py-2 text-xs text-muted-foreground">{a.client_name}</td>
              <td className="py-2 font-mono text-xs text-red-500">{a.installed_version}</td><td className="py-2 font-mono text-xs text-emerald-500">{a.latest_version}</td>
              <td className="py-2"><Badge variant={sevColor[a.update_severity]}>{a.update_severity}</Badge></td>
            </tr>
          ))}</tbody>
        </table></div></CardContent>
      </Card>
    </div>
  );
}
