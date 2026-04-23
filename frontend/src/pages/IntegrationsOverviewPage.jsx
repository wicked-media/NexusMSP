import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Shield, BookOpen, Database, Cloud, DollarSign, Mail, MessageSquare,
  Activity, Gauge, CircleDot, AlertTriangle, CheckCircle2, ExternalLink,
  Settings as SettingsIcon, RefreshCw, Loader2, Plug, Search,
} from "lucide-react";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";

const ICON_BY_KEY = {
  huntress: Shield,
  hudu: BookOpen,
  acronis: Database,
  pax8: Cloud,
  domotz: Activity,
  stripe: DollarSign,
  xero: DollarSign,
  resend: Mail,
  sms: MessageSquare,
  splynx: Cloud,
  syncro: Cloud,
  suped: Shield,
};

const CATEGORY_TONE = {
  security: "text-orange-400 border-orange-500/30 bg-orange-500/5",
  documentation: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
  backup: "text-sky-400 border-sky-500/30 bg-sky-500/5",
  billing: "text-indigo-400 border-indigo-500/30 bg-indigo-500/5",
  payments: "text-violet-400 border-violet-500/30 bg-violet-500/5",
  accounting: "text-violet-400 border-violet-500/30 bg-violet-500/5",
  email: "text-cyan-400 border-cyan-500/30 bg-cyan-500/5",
  messaging: "text-cyan-400 border-cyan-500/30 bg-cyan-500/5",
  network: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
  "psa-sync": "text-zinc-400 border-border",
  isp: "text-amber-400 border-amber-500/30 bg-amber-500/5",
};

export default function IntegrationsOverviewPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/integrations-overview`, { headers });
      setData(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load integrations");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const tiles = (data?.tiles || []).filter((t) => {
    if (filter === "configured" && !t.configured) return false;
    if (filter === "unconfigured" && t.configured) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return t.name.toLowerCase().includes(s) || (t.description || "").toLowerCase().includes(s);
  });

  const configured = data?.configured_count || 0;
  const total = data?.total || 0;
  const unconfigured = total - configured;
  const coverage = data?.coverage_pct || 0;

  const stale = (t) => t.last_synced_at && (Date.now() - new Date(t.last_synced_at).getTime() > 24 * 3600 * 1000);
  const staleCount = (data?.tiles || []).filter((t) => t.configured && stale(t)).length;

  return (
    <PageShell data-testid="integrations-overview-page">
      <MetricStrip columns={4}>
        <MetricTile label="Total" value={total} accent="indigo" icon={<Plug className="w-2.5 h-2.5 text-indigo-400" />} testid="io-metric-total" />
        <MetricTile label="Connected" value={configured} accent="emerald" icon={<CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />} testid="io-metric-connected" />
        <MetricTile label="Unconfigured" value={unconfigured} accent="amber" icon={<AlertTriangle className="w-2.5 h-2.5 text-amber-400" />} testid="io-metric-unconfigured" />
        <MetricTile label="Coverage" value={`${coverage}%`} accent="sky" icon={<Gauge className="w-2.5 h-2.5 text-sky-400" />} testid="io-metric-coverage" />
      </MetricStrip>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Plug className="w-6 h-6 text-indigo-400" />Integrations
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Command deck for every 3rd-party service · {staleCount > 0 ? <span className="text-amber-400">{staleCount} integration{staleCount === 1 ? "" : "s"} last synced &gt; 24h ago</span> : "all fresh"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={load} disabled={loading} data-testid="io-refresh-btn">
              {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Refresh
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-3 flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input className="pl-8 h-9" placeholder="Search integrations…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="io-search" />
            </div>
            {["all", "configured", "unconfigured"].map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-[10px] uppercase tracking-wider px-3 py-1.5 rounded border font-mono ${filter === f ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300" : "border-border text-muted-foreground hover:bg-muted/50"}`}
                data-testid={`io-filter-${f}`}>{f}</button>
            ))}
          </CardContent>
        </Card>

        {/* Tile grid */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />Loading integrations…
          </div>
        ) : tiles.length === 0 ? (
          <Card><CardContent className="p-10 text-center text-xs text-muted-foreground">No integrations match your filter</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {tiles.map((t) => {
              const Icon = ICON_BY_KEY[t.key] || Plug;
              const tone = CATEGORY_TONE[t.category] || "text-zinc-400 border-border";
              const isStale = stale(t);
              return (
                <Card key={t.key} className={`${t.configured ? "border-emerald-500/30" : "border-dashed border-zinc-800"} transition-colors`} data-testid={`io-tile-${t.key}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${tone}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      {t.configured ? (
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]"><CircleDot className="w-2.5 h-2.5 mr-1" />Connected</Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-400 border-amber-500/30 text-[10px]">Not connected</Badge>
                      )}
                    </div>

                    <div>
                      <div className="text-sm font-semibold">{t.name}</div>
                      <div className="text-[11px] text-muted-foreground">{t.description}</div>
                    </div>

                    {t.configured && (
                      <div className="space-y-1 text-[10px] text-muted-foreground font-mono">
                        {t.last_synced_at ? (
                          <div className={isStale ? "text-amber-400" : ""}>
                            Synced {new Date(t.last_synced_at).toLocaleString()}
                            {isStale && <span className="ml-1">· stale</span>}
                          </div>
                        ) : null}
                        {t.last_test_status && (
                          <div className={String(t.last_test_status).toLowerCase().includes("success") ? "text-emerald-400" : "text-rose-400"}>
                            Last test: {String(t.last_test_status).slice(0, 40)}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2 pt-1 border-t border-border">
                      {t.command_center && t.configured && (
                        <Button size="sm" variant="outline" className="flex-1 text-xs" asChild data-testid={`io-open-${t.key}`}>
                          <Link to={t.command_center}><ExternalLink className="w-3 h-3 mr-1" />Open</Link>
                        </Button>
                      )}
                      <Button size="sm" variant={t.configured ? "ghost" : "default"} className={`${t.command_center && t.configured ? "" : "flex-1"} text-xs`} asChild data-testid={`io-settings-${t.key}`}>
                        <Link to={`/settings?tab=integrations&anchor=${t.settings_anchor || ""}`}>
                          <SettingsIcon className="w-3 h-3 mr-1" />{t.configured ? "" : "Configure"}
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
