import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, ShieldAlert, Wifi, WifiOff, AlertTriangle, RefreshCw, Loader2, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

const SEV = {
  critical: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-sky-500/20 text-sky-400 border-sky-500/30",
};

/**
 * Live Huntress summary panel.
 * If not configured, shows a call-to-action linking to Settings → Integrations.
 */
export function HuntressSummaryCard({ compact = false }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/huntress/summary`, { headers });
      setData(res.data);
    } catch {
      setData({ configured: false, message: "Huntress unavailable", stats: {} });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (loading) {
    return (
      <Card data-testid="huntress-summary-card"><CardContent className="py-6 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading Huntress…
      </CardContent></Card>
    );
  }

  if (!data?.configured) {
    return (
      <Card className="border-orange-500/30 bg-orange-500/5" data-testid="huntress-summary-card">
        <CardContent className="py-4 px-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <div className="text-sm font-semibold">Huntress (Security / MDR)</div>
              <div className="text-xs text-muted-foreground">{data?.message || "Not configured — add API key & secret to pull live data"}</div>
            </div>
          </div>
          <Button size="sm" variant="outline" asChild data-testid="huntress-configure-btn">
            <Link to="/settings?tab=integrations&anchor=huntress-settings-card">
              Configure <ExternalLink className="w-3 h-3 ml-1" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const s = data.stats || {};
  const recent = data.recent_incidents || [];

  return (
    <Card data-testid="huntress-summary-card" className="border-orange-500/30">
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-orange-500/5">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-orange-400" />
            <span className="text-sm font-semibold">Huntress MDR · Live</span>
            {data.last_synced_at && <span className="text-[10px] text-muted-foreground font-mono">synced {new Date(data.last_synced_at).toLocaleTimeString()}</span>}
          </div>
          <Button size="sm" variant="ghost" onClick={load} data-testid="huntress-refresh-btn"><RefreshCw className="w-3 h-3" /></Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-0 divide-x divide-border">
          <Stat icon={<Shield className="w-3.5 h-3.5 text-sky-400" />} label="Orgs" value={s.organizations_count} />
          <Stat icon={<Wifi className="w-3.5 h-3.5 text-emerald-400" />} label="Agents" value={`${s.agents_online || 0}/${s.agents_total || 0}`} subtle="online" />
          <Stat icon={<WifiOff className="w-3.5 h-3.5 text-rose-400" />} label="Offline" value={s.agents_offline || 0} tone={s.agents_offline > 0 ? "rose" : "muted"} />
          <Stat icon={<ShieldAlert className="w-3.5 h-3.5 text-rose-400" />} label="Critical" value={s.incidents_critical || 0} tone={s.incidents_critical > 0 ? "rose" : "muted"} />
          <Stat icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-400" />} label="Open" value={s.incidents_open || 0} tone={s.incidents_open > 0 ? "amber" : "muted"} />
          <Stat icon={<Shield className="w-3.5 h-3.5 text-violet-400" />} label="Signals" value={s.signals_count || 0} />
        </div>

        {!compact && recent.length > 0 && (
          <div className="border-t border-border px-5 py-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Recent incidents</div>
            <div className="space-y-1">
              {recent.map((i) => (
                <div key={i.id} className="flex items-center justify-between text-xs py-1" data-testid={`huntress-recent-${i.id}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge className={`${SEV[(i.severity || "").toLowerCase()] || SEV.low} text-[10px]`}>{i.severity}</Badge>
                    <span className="truncate">{i.summary || "(no summary)"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                    <span>{i.organization}</span>
                    {i.detected_at && <span>{new Date(i.detected_at).toLocaleDateString()}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ icon, label, value, tone = "default", subtle }) {
  const toneClass = {
    rose: "text-rose-400",
    amber: "text-amber-400",
    muted: "text-foreground",
    default: "text-foreground",
  }[tone];
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">{icon}{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${toneClass}`}>{value ?? "—"}</div>
      {subtle && <div className="text-[10px] text-muted-foreground">{subtle}</div>}
    </div>
  );
}
