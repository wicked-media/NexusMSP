import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield } from "lucide-react";
import { toast } from "sonner";

export default function EndpointSecurityPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try { const res = await axios.get(`${API}/endpoint-security/scores`, { headers }); setData(res.data); } catch (e) { toast.error("Failed to load scores"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const gradeColor = { A: "bg-emerald-500/10 text-emerald-500", B: "bg-blue-500/10 text-blue-500", C: "bg-amber-500/10 text-amber-500", D: "bg-orange-500/10 text-orange-500", F: "bg-red-500/10 text-red-500" };

  return (
    <div className="space-y-6" data-testid="endpoint-security-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Endpoint Security Scores</h1><p className="text-muted-foreground text-sm mt-1">Per-device security posture scoring</p></div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card><CardContent className="pt-5 text-center"><p className="text-3xl font-bold">{data.summary.avg_score}</p><p className="text-xs text-muted-foreground">Avg Score</p></CardContent></Card>
        {["A", "B", "C", "D", "F"].map(g => (
          <Card key={g}><CardContent className="pt-5 text-center"><Badge className={`${gradeColor[g]} text-lg px-3 py-1`}>{g}</Badge><p className="text-lg font-bold mt-2">{data.summary[`${g.toLowerCase()}_count`]}</p></CardContent></Card>
        ))}
      </div>

      <Card><CardHeader><CardTitle className="text-lg">All Endpoints</CardTitle></CardHeader>
        <CardContent><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-3 font-medium">Device</th><th className="pb-3 font-medium">Client</th><th className="pb-3 font-medium">Type</th><th className="pb-3 font-medium">Grade</th><th className="pb-3 font-medium">Overall</th><th className="pb-3 font-medium">Patches</th><th className="pb-3 font-medium">AV</th><th className="pb-3 font-medium">Encrypt</th><th className="pb-3 font-medium">Firewall</th><th className="pb-3 font-medium">MFA</th></tr></thead>
          <tbody>{data.scores.slice(0, 40).map(s => (
            <tr key={s.device_id} className="border-b border-border/50 hover:bg-muted/30" data-testid={`score-${s.device_id}`}>
              <td className="py-2 font-medium">{s.device_name}</td>
              <td className="py-2 text-muted-foreground">{s.client_name}</td>
              <td className="py-2 text-xs capitalize">{s.type}</td>
              <td className="py-2"><Badge className={gradeColor[s.grade]}>{s.grade}</Badge></td>
              <td className="py-2"><div className="w-16"><Progress value={s.overall_score} className={s.overall_score < 60 ? "[&>div]:bg-red-500" : s.overall_score < 75 ? "[&>div]:bg-amber-500" : ""} /></div></td>
              <td className="py-2 text-xs">{s.patch_score}</td><td className="py-2 text-xs">{s.av_score}</td><td className="py-2 text-xs">{s.encryption_score}</td><td className="py-2 text-xs">{s.firewall_score}</td><td className="py-2 text-xs">{s.mfa_score}</td>
            </tr>
          ))}</tbody>
        </table></div></CardContent>
      </Card>
    </div>
  );
}
