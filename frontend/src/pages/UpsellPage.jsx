import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { TrendingUp, DollarSign, Loader2, RefreshCw, Zap, Shield, Monitor, ChevronRight } from "lucide-react";

export default function UpsellPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/upsell/opportunities`, { headers: { Authorization: `Bearer ${token}` } });
      setData(res.data);
    } catch { toast.error("Failed to scan for opportunities"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const d = data || {};
  const opps = d.opportunities || [];
  const byType = d.by_type || {};

  const typeConfig = {
    device_coverage: { icon: Monitor, color: "text-blue-400", bg: "bg-blue-500/10" },
    monitoring_gap: { icon: Shield, color: "text-violet-400", bg: "bg-violet-500/10" },
    backup_gap: { icon: Shield, color: "text-red-400", bg: "bg-red-500/10" },
    tier_upgrade: { icon: TrendingUp, color: "text-amber-400", bg: "bg-amber-500/10" },
    security_assessment: { icon: Zap, color: "text-red-400", bg: "bg-red-500/10" },
  };

  return (
    <div className="space-y-5" data-testid="upsell-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><TrendingUp className="w-8 h-8 text-amber-400" />Upsell Detector</h1>
          <p className="text-muted-foreground">{d.total_clients_with_opps || 0} clients with opportunities</p>
        </div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Re-Scan</Button>
      </div>

      {/* Pipeline value */}
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardContent className="py-4 flex items-center gap-4">
          <DollarSign className="w-8 h-8 text-amber-400" />
          <div>
            <p className="text-sm text-muted-foreground">Total Pipeline Value</p>
            <p className="text-3xl font-black text-amber-400">${(d.total_pipeline_value || 0).toLocaleString()}/mo</p>
          </div>
          <div className="ml-auto flex gap-3">
            {Object.entries(byType).map(([type, count]) => (
              <Badge key={type} variant="outline" className="text-[10px]">{type.replace("_", " ")}: {count}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Opportunities */}
      <div className="space-y-3">
        {opps.map(c => (
          <Card key={c.client_id} className="hover:border-amber-500/20 transition-all">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-bold text-lg">{c.client_name}</p>
                  <div className="flex gap-2">
                    <Badge variant="outline" className="text-[10px]">{c.tier}</Badge>
                    <span className="text-xs text-muted-foreground">{c.opportunities.length} opportunities</span>
                  </div>
                </div>
                <span className="text-xl font-black text-amber-400">${c.total_potential_value?.toLocaleString()}/mo</span>
              </div>
              <div className="space-y-2">
                {c.opportunities.map((o, i) => {
                  const cfg = typeConfig[o.type] || { icon: ChevronRight, color: "text-zinc-400", bg: "bg-zinc-500/10" };
                  const Icon = cfg.icon;
                  return (
                    <div key={`k-${i}`} className={`flex items-center gap-3 p-2.5 rounded-lg ${cfg.bg} border border-border/30`}>
                      <Icon className={`w-4 h-4 ${cfg.color} flex-shrink-0`} />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{o.title}</p>
                        <p className="text-xs text-muted-foreground">{o.description}</p>
                      </div>
                      <div className="text-right">
                        <Badge className={`${o.priority === "high" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"} text-[10px]`}>{o.priority}</Badge>
                        <p className="text-xs font-mono font-bold mt-0.5">${o.potential_value}/mo</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
        {opps.length === 0 && (
          <Card><CardContent className="py-12 text-center">
            <TrendingUp className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-30" />
            <p className="text-muted-foreground">No upsell opportunities found</p>
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}
