/*
 * Fleet Pulse is intentionally evidence-led: it never manufactures a trend or
 * turns a missing report into a reassuring 0%. Each tile separates reported
 * device state from telemetry that has actually been observed.
 */
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import Sparkline from "./Sparkline";
import StatusOrb from "./StatusOrb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, ArrowUpRight, CircleAlert, Clock3, Loader2, RefreshCw } from "lucide-react";

function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : null;
}

function hasTrend(data) {
  return Array.isArray(data) && data.length >= 2;
}

function observationTimestamp(tile) {
  return tile.observed_at || tile.telemetry_observed_at || tile.last_seen;
}

function observationLabel(value) {
  if (!value) return "No check-in recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Check-in timestamp unavailable";
  return `Observed ${formatDistanceToNow(date, { addSuffix: true })}`;
}

function observationState(tile) {
  const explicit = String(tile.observation_state || "").toLowerCase();
  if (explicit === "stale") return "stale";
  if (explicit === "observed") return hasTrend(tile.cpu_spark) || hasTrend(tile.ram_spark) || hasTrend(tile.disk_spark) ? "trended" : "observed";
  if (["not_collected", "unobserved", "unknown", "unavailable"].includes(explicit)) return "unobserved";
  if (hasTrend(tile.cpu_spark) || hasTrend(tile.ram_spark) || hasTrend(tile.disk_spark)) return "trended";
  if (observationTimestamp(tile) || [tile.cpu, tile.ram, tile.disk].some((value) => numericValue(value) !== null)) return "snapshot";
  return "unobserved";
}

function tileTone(status, evidence) {
  if (evidence === "unobserved") return "border-zinc-700/80 from-zinc-900/80 to-zinc-950/80";
  if (evidence === "stale") return "border-amber-500/35 from-amber-500/[0.1] to-zinc-950/80";
  if (status === "offline" || status === "critical" || status === "error") return "border-rose-500/35 from-rose-500/[0.14] to-zinc-950/80";
  if (status === "warning" || status === "degraded" || status === "needs_attention") return "border-amber-500/35 from-amber-500/[0.12] to-zinc-950/80";
  if (status === "online") return "border-emerald-500/25 from-emerald-500/[0.08] to-zinc-950/80";
  return "border-zinc-700/80 from-zinc-900/80 to-zinc-950/80";
}

function metricColor(value, thresholds = [60, 80], accent = "#22d3ee") {
  if (value === null) return "#71717a";
  if (value > thresholds[1]) return "#ef4444";
  if (value > thresholds[0]) return "#fbbf24";
  return accent;
}

function MetricLine({ label, value, trend, accent, thresholds }) {
  const percentage = numericValue(value);
  const trendAvailable = hasTrend(trend);
  const color = metricColor(percentage, thresholds, accent);

  return (
    <div className="flex min-w-0 items-center gap-2 text-[10px]">
      <span className="w-6 font-mono uppercase tracking-[0.08em] text-zinc-500">{label}</span>
      {trendAvailable ? (
        <Sparkline data={trend} width={42} height={14} color={color} />
      ) : (
        <span className="h-px w-[42px] bg-zinc-700/80" aria-label={`${label} trend has not been collected`} />
      )}
      <span className={percentage === null ? "font-mono text-zinc-500" : "font-mono text-zinc-200"}>{percentage === null ? "—" : `${Math.round(percentage)}%`}</span>
      {!trendAvailable && percentage !== null && <span className="ml-auto text-[9px] text-zinc-500">snapshot</span>}
    </div>
  );
}

export default function FleetPulseWall({ filterStatus = "all", search = "", onCount }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError(false);
    axios.get(`${API}/devices/pulse`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => { if (live) setTiles(response.data?.tiles || []); })
      .catch(() => {
        if (!live) return;
        setTiles([]);
        setLoadError(true);
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [refreshKey, token]);

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return tiles.filter((tile) => {
      const status = String(tile.status || "unknown").toLowerCase();
      if (filterStatus !== "all" && status !== filterStatus) return false;
      if (normalizedSearch && !(tile.name || "").toLowerCase().includes(normalizedSearch) && !(tile.client_name || "").toLowerCase().includes(normalizedSearch)) return false;
      return true;
    });
  }, [tiles, search, filterStatus]);

  const coverage = useMemo(() => {
    const observed = tiles.filter((tile) => ["observed", "trended"].includes(observationState(tile))).length;
    const trended = tiles.filter((tile) => observationState(tile) === "trended").length;
    const stale = tiles.filter((tile) => observationState(tile) === "stale").length;
    return { observed, trended, stale, unobserved: Math.max(0, tiles.length - observed - stale) };
  }, [tiles]);

  useEffect(() => { if (onCount) onCount(filtered.length); }, [filtered.length, onCount]);

  if (loading) {
    return <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/30 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking recorded fleet state…</div>;
  }

  if (loadError) {
    return (
      <Card className="border-amber-500/25 bg-amber-500/[0.04]" data-testid="fleet-pulse-error">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium text-amber-100">Fleet pulse is unavailable</p>
            <p className="mt-1 text-xs text-muted-foreground">The asset register remains available. Retry when the fleet observation service is reachable.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry pulse</Button>
        </CardContent>
      </Card>
    );
  }

  if (filtered.length === 0) {
    const hasFilter = Boolean(search.trim()) || filterStatus !== "all";
    return (
      <Card className="border-zinc-800/80 bg-zinc-950/30" data-testid="fleet-pulse-empty">
        <CardContent className="py-12 text-center">
          <Activity className="mx-auto h-5 w-5 text-zinc-500" />
          <p className="mt-3 text-sm font-medium text-zinc-200">{hasFilter ? "No assets match this fleet view" : "No endpoint observations yet"}</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">{hasFilter ? "Adjust the search or status filter to widen the operational view." : "Add an asset or enrol the Nexus Agent to begin building an evidence-led fleet picture."}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-3" data-testid="fleet-pulse-wall">
      <Card className="border-zinc-800/80 bg-zinc-950/35" data-testid="fleet-pulse-evidence">
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/[0.07]"><Activity className="h-3.5 w-3.5 text-cyan-300" /></div>
            <div>
              <p className="text-xs font-medium text-zinc-100">Endpoint evidence</p>
              <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">Fresh, stale and missing evidence stay distinct. A snapshot is not a trend, and a missing check-in is never shown as healthy.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-[10px]">
            <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200">{coverage.observed} current</Badge>
            <Badge variant="outline" className="border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-200">{coverage.trended} trended</Badge>
            {coverage.stale > 0 && <Badge variant="outline" className="border-amber-500/25 bg-amber-500/[0.06] text-amber-200">{coverage.stale} stale</Badge>}
            {coverage.unobserved > 0 && <Badge variant="outline" className="border-amber-500/25 bg-amber-500/[0.06] text-amber-200">{coverage.unobserved} no check-in</Badge>}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(205px,1fr))] gap-3">
        {filtered.map((tile) => {
          const status = String(tile.status || "unknown").toLowerCase();
          const evidence = observationState(tile);
          const tone = tileTone(status, evidence);
          const metrics = [
            { label: "CPU", value: tile.cpu, trend: tile.cpu_spark, accent: "#a78bfa", thresholds: [60, 80] },
            { label: "RAM", value: tile.ram, trend: tile.ram_spark, accent: "#34d399", thresholds: [60, 80] },
            { label: "DSK", value: tile.disk, trend: tile.disk_spark, accent: "#22d3ee", thresholds: [70, 85] },
          ];
          const hasResourceReading = metrics.some((metric) => numericValue(metric.value) !== null);
          const observed = observationTimestamp(tile);
          const stale = evidence === "stale";

          return (
            <button
              key={tile.id}
              onClick={() => navigate(`/devices/${tile.id}`)}
              data-testid={`pulse-tile-${tile.id}`}
              aria-label={`Open ${tile.name} device record`}
              className={`group relative min-h-[176px] rounded-xl border bg-gradient-to-br p-3 text-left transition duration-200 hover:-translate-y-0.5 hover:border-cyan-400/45 hover:shadow-[0_12px_32px_rgba(8,47,73,0.24)] focus:outline-none focus:ring-2 focus:ring-cyan-400/60 ${tone}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <StatusOrb status={stale ? "warning" : status} size={8} />
                  <p className="truncate text-xs font-semibold text-zinc-100">{tile.name || "Unnamed asset"}</p>
                </div>
                <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium capitalize ${stale ? "border-amber-500/30 bg-amber-500/[0.08] text-amber-200" : "border-white/[0.08] bg-black/10 text-zinc-300"}`}>{stale ? "stale" : status}</span>
              </div>
              <p className="mt-1 truncate text-[10px] text-zinc-400">{tile.client_name || "Unassigned client"} · {tile.type || "endpoint"}</p>

              <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/10 p-2.5">
                {hasResourceReading ? (
                  <div className="space-y-2">
                    {metrics.map((metric) => <MetricLine key={metric.label} {...metric} />)}
                  </div>
                ) : (
                  <div className="flex min-h-12 items-center gap-2 text-[10px] text-zinc-500"><CircleAlert className="h-3.5 w-3.5 shrink-0 text-amber-300/75" />No resource readings have been observed.</div>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                <span className="flex min-w-0 items-center gap-1.5 truncate" title={observationLabel(observed)}><Clock3 className="h-3 w-3 shrink-0" />{stale ? `Stale · ${observationLabel(observed).replace("Observed ", "")}` : observationLabel(observed)}</span>
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-zinc-500 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-cyan-200" aria-hidden="true" />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
