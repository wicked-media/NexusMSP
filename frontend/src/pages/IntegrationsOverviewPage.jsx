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
  Activity, CircleDot, AlertTriangle, CheckCircle2, ExternalLink, Phone,
  Settings as SettingsIcon, RefreshCw, Loader2, Plug, Search,
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

const ICON_BY_KEY = {
  huntress: Shield,
  hudu: BookOpen,
  acronis: Database,
  pax8: Cloud,
  domotz: Activity,
  stripe: DollarSign,
  xero: DollarSign,
  microsoft365: Mail,
  sms: MessageSquare,
  splynx: Cloud,
  syncro: Cloud,
  suped: Shield,
  rustdesk: Activity,
  yeastar: Phone,
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
  "remote-access": "text-sky-400 border-sky-500/30 bg-sky-500/5",
  voice: "text-cyan-400 border-cyan-500/30 bg-cyan-500/5",
};

const CONNECTION_STYLE = {
  verified: { label: "Verified", className: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  configured_unverified: { label: "Needs verification", className: "border-sky-500/30 text-sky-300" },
  stale: { label: "Sync overdue", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  failed: { label: "Needs attention", className: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  not_configured: { label: "Not connected", className: "border-amber-500/30 text-amber-300" },
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
    if (filter === "attention" && !["failed", "stale"].includes(t.connection_state)) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return t.name.toLowerCase().includes(s) || (t.description || "").toLowerCase().includes(s);
  });

  const configured = data?.configured_count || 0;
  const total = data?.total || 0;
  const unconfigured = total - configured;
  const verified = data?.verified_count || 0;
  const attention = data?.attention_count || 0;
  const filterCounts = { all: total, configured, unconfigured, attention };

  return (
    <div className="p-6 space-y-5" data-testid="integrations-overview-page">
      <OperationalPageHeader
        eyebrow="Platform connections"
        title="Integrations"
        description="Separate saved configuration from a verified connection, identify failed or overdue synchronisation, and open the right configuration or operational workspace."
        icon={Plug}
        tone="violet"
        actions={<>
          <Badge variant="outline" className={attention > 0 ? "border-amber-500/30 text-amber-300" : "border-emerald-500/30 text-emerald-300"}>{attention > 0 ? `${attention} needs attention` : `${verified} verified`}</Badge>
          <Button size="sm" variant="outline" onClick={load} disabled={loading} data-testid="io-refresh-btn">
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Refresh
          </Button>
        </>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HeroTile label="Integrations" value={loading ? "—" : total} icon={Plug} glow="violet" subtitle="Available service connections" testId="io-metric-total" />
        <HeroTile label="Configured" value={loading ? "—" : configured} icon={SettingsIcon} glow="sky" subtitle="Credentials or connection saved" testId="io-metric-connected" />
        <HeroTile label="Verified" value={loading ? "—" : verified} icon={CheckCircle2} glow="emerald" subtitle="Tested or recently synced" testId="io-metric-verified" />
        <HeroTile label="Needs attention" value={loading ? "—" : attention} icon={AlertTriangle} glow="amber" subtitle="Failed or overdue synchronisation" testId="io-metric-attention" />
      </div>

      <div className="space-y-4">

        {attention > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs text-amber-100/90"><span className="font-semibold">Connection attention needed.</span> Review integrations with a failed test or overdue synchronisation.</p>
            </div>
            <button type="button" onClick={() => setFilter("attention")} className="shrink-0 text-[11px] font-medium text-amber-300 hover:text-amber-200">Review attention</button>
          </div>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="p-3 flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input className="pl-8 h-9" placeholder="Search integrations..." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="io-search" />
            </div>
            {["all", "configured", "unconfigured", "attention"].map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-[10px] uppercase tracking-wider px-3 py-1.5 rounded border font-mono ${filter === f ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300" : "border-border text-muted-foreground hover:bg-muted/50"}`}
                data-testid={`io-filter-${f}`}>{f} <span className="ml-1 opacity-70">{filterCounts[f]}</span></button>
            ))}
          </CardContent>
        </Card>

        {/* Tile grid */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />Loading integrations...
          </div>
        ) : tiles.length === 0 ? (
          <Card><CardContent className="p-10 text-center text-xs text-muted-foreground">No integrations match your filter</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {tiles.map((t) => {
              const Icon = ICON_BY_KEY[t.key] || Plug;
              const tone = CATEGORY_TONE[t.category] || "text-zinc-400 border-border";
              const connection = CONNECTION_STYLE[t.connection_state] || CONNECTION_STYLE.not_configured;
              return (
                <Card key={t.key} className={`${t.configured ? "border-emerald-500/30 hover:border-emerald-500/50" : "border-dashed border-zinc-800 hover:border-zinc-700"} min-h-[230px] transition-colors`} data-testid={`io-tile-${t.key}`}>
                  <CardContent className="p-4 h-full flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${tone}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <Badge variant={t.connection_state === "verified" ? "default" : "outline"} className={`${connection.className} text-[10px]`}><CircleDot className="w-2.5 h-2.5 mr-1" />{connection.label}</Badge>
                    </div>

                    <div className="min-h-[42px]">
                      <div className="text-sm font-semibold leading-5">{t.name}</div>
                      <div className="text-[11px] leading-4 text-muted-foreground">{t.description}</div>
                    </div>

                    {t.configured && (
                      <div className="space-y-1 text-[10px] text-muted-foreground font-mono">
                        {t.last_synced_at ? (
                          <div className={t.connection_state === "stale" ? "text-amber-400" : ""}>
                            Synced {new Date(t.last_synced_at).toLocaleString()}
                            {t.connection_state === "stale" && <span className="ml-1">| overdue</span>}
                          </div>
                        ) : null}
                        {t.last_test_status && (
                          <div className={String(t.last_test_status).toLowerCase().includes("success") ? "text-emerald-400" : "text-rose-400"}>
                            Last test: {String(t.last_test_status).slice(0, 40)}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2 pt-3 mt-auto border-t border-border">
                      {t.command_center && t.configured && (
                        <Button size="sm" variant="outline" className="flex-1 text-xs" asChild data-testid={`io-open-${t.key}`}>
                          <Link to={t.command_center}><ExternalLink className="w-3 h-3 mr-1" />Open</Link>
                        </Button>
                      )}
                      <Button size="sm" variant={t.configured ? "ghost" : "default"} className={`${t.command_center && t.configured ? "" : "flex-1"} text-xs`} asChild data-testid={`io-settings-${t.key}`}>
                        <Link to={`/settings?tab=integrations&anchor=${t.settings_anchor || ""}`}>
                          <SettingsIcon className="w-3 h-3 mr-1" />{t.configured ? "Manage" : "Configure"}
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
    </div>
  );
}
