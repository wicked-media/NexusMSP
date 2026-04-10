import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BarChart3, TrendingUp, TrendingDown, Loader2, RefreshCw, Award, Clock, Users, Shield } from "lucide-react";

function ComparisonBar({ label, yours, industry, unit = "h" }) {
  const better = yours < industry;
  const max = Math.max(yours, industry, 1);
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground capitalize">{label}</span>
        <span className={`font-bold ${better ? "text-emerald-400" : "text-red-400"}`}>
          {better ? <TrendingUp className="w-3 h-3 inline mr-1" /> : <TrendingDown className="w-3 h-3 inline mr-1" />}
          {yours.toFixed(1)}{unit} vs {industry}{unit}
        </span>
      </div>
      <div className="flex gap-1 h-4">
        <div className="relative flex-1 bg-muted/20 rounded overflow-hidden">
          <div className={`h-full rounded ${better ? "bg-emerald-500/60" : "bg-red-500/60"}`} style={{ width: `${(yours / max) * 100}%` }} />
          <span className="absolute inset-0 flex items-center pl-2 text-[10px] font-bold">You: {yours.toFixed(1)}{unit}</span>
        </div>
        <div className="relative flex-1 bg-muted/20 rounded overflow-hidden">
          <div className="h-full rounded bg-zinc-500/40" style={{ width: `${(industry / max) * 100}%` }} />
          <span className="absolute inset-0 flex items-center pl-2 text-[10px] font-bold text-muted-foreground">Industry: {industry}{unit}</span>
        </div>
      </div>
    </div>
  );
}

export default function BenchmarkingPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/benchmarking/overview`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to load benchmarks"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const rt = data?.resolution_times || {};
  const overall = data?.overall || {};
  const techPerf = data?.tech_performance || [];

  return (
    <div className="space-y-5" data-testid="benchmarking-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><BarChart3 className="w-8 h-8 text-indigo-400" />Benchmarking</h1>
          <p className="text-muted-foreground">Compare your MSP against industry averages</p>
        </div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      {/* Overall stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Resolved", value: overall.total_resolved || 0, icon: Award, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "SLA Compliance", value: `${overall.sla_compliance || 0}%`, icon: Shield, color: overall.sla_vs_industry >= 0 ? "text-emerald-400" : "text-red-400", bg: "bg-blue-500/10", sub: `${overall.sla_vs_industry > 0 ? "+" : ""}${overall.sla_vs_industry || 0}% vs industry` },
          { label: "Total Tickets", value: overall.total_tickets || 0, icon: Clock, color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "Technicians", value: techPerf.length, icon: Users, color: "text-violet-400", bg: "bg-violet-500/10" },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={`k-${i}`}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center`}><Icon className={`w-5 h-5 ${s.color}`} /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
                    {s.sub && <p className="text-[10px] text-muted-foreground">{s.sub}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Resolution time comparison */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-indigo-400" />Resolution Time vs Industry</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {["critical", "high", "medium", "low"].map(p => {
            const m = rt[p] || {};
            return (
              <ComparisonBar key={p} label={p} yours={m.your_avg_hours || 0} industry={m.industry_avg_hours || 0} />
            );
          })}
        </CardContent>
      </Card>

      {/* Tech performance */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-violet-400" />Technician Performance</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {techPerf.map(t => (
            <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20">
              <div className="flex-1">
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.resolved} resolved &middot; {t.active} active</p>
              </div>
              <Badge className={t.vs_avg >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}>
                {t.vs_avg > 0 ? "+" : ""}{t.vs_avg}% vs avg
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
