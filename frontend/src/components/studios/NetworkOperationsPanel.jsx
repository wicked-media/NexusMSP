import { ArrowUpRight, CircleAlert, Network, Radio, Router, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ObservationError,
  ObservationHeader,
  ObservationLoading,
  ObservationNote,
  ObservationUnbound,
  Observed,
  ObservedEmpty,
  ObservedRows,
  ObservedTotals,
  useStudioObservation,
} from "./StudioObservationKit";

const number = (value) => (value === null || value === undefined ? null : Number(value));

function siteRow(site) {
  const state = String(site.status || "not_reported").toLowerCase();
  return {
    key: site.site_id,
    label: <Observed value={site.name} what="network site name" />,
    meta: [
      <Observed key="client" value={site.client_name} what="client" />,
      <Observed key="isp" value={site.isp} what="ISP" />,
      <Observed key="devices" value={number(site.device_count) === null ? null : `${site.device_count} recorded devices`} what="device count" />,
      <Observed key="clients" value={number(site.client_count) === null ? null : `${site.client_count} recorded network clients`} what="network client count" />,
      <Observed key="link" value={number(site.download_mbps) || number(site.upload_mbps) ? `${site.download_mbps || "?"}↓ / ${site.upload_mbps || "?"}↑ Mbps reported` : null} what="reported link speed" />,
    ],
    status: state,
    dotClass: state === "online" ? "bg-emerald-500" : state === "offline" ? "bg-rose-500" : "bg-amber-500",
    observedAt: null,
  };
}

/**
 * Network Studio's NOC projection. It deliberately composes the existing
 * server-scoped networking dashboard rather than inventing a second network
 * inventory, collector or alert register. Transfer values are retained counter
 * totals, not a claim of live throughput; freshness is disclosed by the source
 * records and absent metrics remain absent.
 */
export default function NetworkOperationsPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);
  if (unresolved) return <ObservationUnbound spec={spec} />;

  const summary = data?.summary || {};
  const sites = Array.isArray(data?.site_bandwidth) ? data.site_bandwidth : [];
  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  const offline = Array.isArray(data?.offline_devices) ? data.offline_devices : [];
  const types = data?.device_types || {};

  return (
    <div className="space-y-4" data-testid="studio-network-operations">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />
      {loading && <ObservationLoading label="Reading server-scoped network evidence…" />}
      {!loading && error && <ObservationError error={error} onRetry={reload} />}
      {!loading && !error && (
        <>
          <ObservedTotals totals={[
            { label: "Network sites", value: summary.total_sites, detail: `${summary.online_sites ?? 0} reported online · ${summary.offline_sites ?? 0} not online.` },
            { label: "Recorded devices", value: summary.total_devices, detail: `${summary.online_devices ?? 0} reported online.` },
            { label: "Recorded network clients", value: summary.total_clients, detail: "Inventory count, not a reachability claim." },
            { label: "Attention signals", value: alerts.length, detail: "Derived from current recorded site and device states; review source evidence before action." },
          ]} />

          <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
            <section className="rounded-xl border border-border/70 bg-card p-4" data-testid="network-capability-coverage">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Observed infrastructure coverage</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Current inventory counts come from authorised Nexus network site records. Unsupported or uncollected telemetry is not treated as healthy.</p>
                </div>
                <Network className="h-5 w-5 shrink-0 text-cyan-500" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  ["Gateways", types.gateway, Router],
                  ["Switches", types.switch, Radio],
                  ["Access points", types.ap, Wifi],
                ].map(([label, count, Icon]) => (
                  <div key={label} className="rounded-lg border border-border/60 bg-background/40 p-3">
                    <Icon className="h-4 w-4 text-sky-500" />
                    <p className="mt-2 text-lg font-semibold"><Observed value={count} what="not reported" /></p>
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-lg border border-border/60 bg-background/35 p-3 text-xs text-muted-foreground">
                Retained transfer counters: <span className="font-medium text-foreground"><Observed value={number(summary.total_rx_gb) === null ? null : `${summary.total_rx_gb} GB received`} what="not reported" /></span>{" · "}<span className="font-medium text-foreground"><Observed value={number(summary.total_tx_gb) === null ? null : `${summary.total_tx_gb} GB sent`} what="not reported" /></span>. These are not live Mbps measurements.
              </div>
            </section>

            <section className="rounded-xl border border-border/70 bg-card p-4" data-testid="network-attention-queue">
              <div className="flex items-center gap-2"><CircleAlert className="h-4 w-4 text-amber-500" /><p className="text-sm font-semibold">Attention queue</p></div>
              <p className="mt-1 text-xs text-muted-foreground">Evidence that merits investigation, not an automatically confirmed incident.</p>
              <div className="mt-3 space-y-2">
                {alerts.length === 0 ? <ObservedEmpty title="No current derived attention signals" note="This only means the scoped site and device records did not currently produce an offline signal; it is not availability proof." /> : alerts.slice(0, 5).map((alert, index) => (
                  <div key={`${alert.type}-${index}`} className="flex items-start gap-2 rounded-lg border border-border/60 px-3 py-2">
                    <Badge variant="outline" className={alert.severity === "critical" ? "border-rose-500/30 bg-rose-500/10 text-rose-500 text-[9px]" : "border-amber-500/30 bg-amber-500/10 text-amber-600 text-[9px]"}>{alert.severity || "review"}</Badge>
                    <span className="text-xs leading-5">{alert.message || "Network attention signal"}</span>
                  </div>
                ))}
              </div>
              {offline.length > 0 && <p className="mt-3 text-[11px] text-muted-foreground">{offline.length} recorded device(s) are not online. Open Network Operations for per-site source records.</p>}
            </section>
          </div>

          {sites.length ? <ObservedRows label="Managed network sites" rows={sites.map(siteRow)} /> : <ObservedEmpty title="No managed network site is in scope" note="Link an authorised controller or create a scoped network site before Nexus can present network inventory. No absence here means a healthy or empty customer network." />}

          <div className="flex flex-wrap gap-2" data-testid="network-studio-actions">
            <Button asChild size="sm"><a href="/networking">Open Network Operations <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></a></Button>
            <Button asChild size="sm" variant="outline"><a href="/unifi">UniFi command centre <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></a></Button>
            <Button asChild size="sm" variant="outline"><a href="/topology">Topology evidence <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></a></Button>
            <Button asChild size="sm" variant="outline"><a href="/bandwidth-monitor">Bandwidth evidence <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></a></Button>
            <Button asChild size="sm" variant="outline"><a href="/dns-monitor">DNS operations <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></a></Button>
          </div>

          <ObservationNote>
            This NOC is a read-only projection over the existing `network_sites`, `network_devices` and `network_clients` records. Current Nexus has no admitted universal SNMP collector, push stream or verified topology reconciler, so those capabilities remain intentionally undisclosed rather than simulated.
          </ObservationNote>
        </>
      )}
    </div>
  );
}
