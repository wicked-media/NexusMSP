import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, AlertTriangle, CheckCircle, FileWarning } from "lucide-react";
import { toast } from "sonner";

export default function RansomwareCanaryPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try { const res = await axios.get(`${API}/ransomware-canary/status`, { headers }); setData(res.data); } catch (e) { toast.error("Failed"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="ransomware-canary-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Ransomware Canary System</h1><p className="text-muted-foreground text-sm mt-1">Deploy decoy files to detect encryption activity instantly</p></div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5 flex items-center gap-3"><Shield className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{data.summary.deployed}</p><p className="text-xs text-muted-foreground">Canaries Deployed</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><CheckCircle className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">{data.summary.active}</p><p className="text-xs text-muted-foreground">Active</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><AlertTriangle className="w-6 h-6 text-red-500" /><div><p className="text-2xl font-bold">{data.summary.triggered}</p><p className="text-xs text-muted-foreground">Triggered</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><FileWarning className="w-6 h-6 text-red-500" /><div><p className="text-2xl font-bold">{data.summary.unresolved}</p><p className="text-xs text-muted-foreground">Unresolved</p></div></CardContent></Card>
      </div>

      {(data.triggers || []).length > 0 && (
        <Card className="border-l-4 border-l-red-500"><CardHeader><CardTitle className="text-lg flex items-center gap-2 text-red-500"><AlertTriangle className="w-5 h-5" />Active Triggers</CardTitle></CardHeader>
          <CardContent><div className="space-y-3">{data.triggers.map(t => (
            <div key={t.id} className="p-3 rounded-lg border bg-red-500/5" data-testid={`trigger-${t.id}`}>
              <div className="flex items-center gap-2"><Badge variant="destructive">{t.trigger_type}</Badge><span className="font-semibold text-sm">{t.device_name}</span><span className="text-xs text-muted-foreground">({t.client_name})</span>{t.auto_isolated && <Badge className="bg-purple-500/10 text-purple-500">Auto-Isolated</Badge>}</div>
              <p className="text-xs text-muted-foreground mt-1">File: {t.file_path} | Triggered: {new Date(t.triggered_at).toLocaleString()}</p>
            </div>
          ))}</div></CardContent>
        </Card>
      )}

      <Card><CardHeader><CardTitle className="text-lg">Deployed Canaries</CardTitle></CardHeader>
        <CardContent><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-3 font-medium">Device</th><th className="pb-3 font-medium">Client</th><th className="pb-3 font-medium">File Path</th><th className="pb-3 font-medium">Status</th><th className="pb-3 font-medium">Deployed</th></tr></thead>
          <tbody>{data.canaries.map(c => (
            <tr key={c.id} className="border-b border-border/50"><td className="py-2 font-medium">{c.device_name}</td><td className="py-2 text-muted-foreground">{c.client_name}</td><td className="py-2 font-mono text-xs">{c.file_path}</td><td className="py-2"><Badge className={c.status === "active" ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}>{c.status}</Badge></td><td className="py-2 text-xs text-muted-foreground">{new Date(c.deployed_at).toLocaleDateString()}</td></tr>
          ))}</tbody>
        </table></div></CardContent>
      </Card>
    </div>
  );
}
