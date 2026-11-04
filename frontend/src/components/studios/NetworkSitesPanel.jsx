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
  statusDot,
  useStudioObservation,
} from "./StudioObservationKit";

/**
 * Network Studio's Inventory tab: the network site records the networking
 * integration owns, read through `GET /networking/sites` — the same projection
 * `/networking` reads, so the studio and the workspace cannot disagree about a
 * site.
 *
 * What this panel models, and nothing more: the site's client, its WAN address,
 * the ISP on record, the provider's own site identifier and its status. Two
 * deliberate omissions:
 *
 * 1. **No observation time.** A site record carries `created_at` (when the
 *    record was created), not when Nexus last saw the site, so the row shows
 *    the not-reported disclosure rather than dressing record creation up as
 *    provenance.
 * 2. **No credentials and no operator notes.** The endpoint already strips
 *    controller secrets server-side; operator notes are a human's working
 *    commentary, not this studio's evidence.
 */

const ONLINE_DOT = { online: "bg-emerald-500" };

export default function NetworkSitesPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) return <ObservationUnbound spec={spec} />;

  const sites = Array.isArray(data) ? data : [];
  const online = sites.filter((site) => site.status === "online").length;
  const withWan = sites.filter((site) => site.wan_ip).length;
  const withSpeed = sites.filter((site) => (
    Number(site.download_speed_mbps) > 0 || Number(site.upload_speed_mbps) > 0
  )).length;

  return (
    <div className="space-y-3" data-testid="studio-network-sites">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />

      {loading && <ObservationLoading label="Reading observed network sites…" />}
      {!loading && error && <ObservationError error={error} onRetry={reload} />}

      {!loading && !error && sites.length === 0 && (
        <ObservedEmpty
          title="No network site record is in your scope"
          note="A site must be linked to a controller before Nexus can observe it, so an empty read means nothing is linked or observed here — not that the network is healthy. Controller credentials are never part of this read."
        />
      )}

      {!loading && !error && sites.length > 0 && (
        <>
          <ObservedTotals
            totals={[
              { label: "Sites in scope", value: sites.length },
              { label: "Reporting online", value: online },
              {
                label: "With a reported WAN address",
                value: withWan,
                detail: `${sites.length - withWan} site(s) have not reported one.`,
              },
              {
                label: "With a reported link speed",
                value: withSpeed,
                detail: "Link speed is what the provider reported, not a measurement Nexus took.",
              },
            ]}
          />
          <ObservedRows
            label="Observed sites"
            rows={sites.map((site) => ({
              key: site.id,
              label: <Observed value={site.name} what="site name" />,
              meta: [
                <Observed value={site.client_name || site.client_id} what="client" />,
                <Observed value={site.wan_ip} what="WAN address" />,
                <Observed value={site.isp} what="ISP" />,
                <Observed value={site.site_id} what="provider site id" />,
              ],
              status: site.status,
              dotClass: statusDot(site.status, ONLINE_DOT),
              // A record has a creation time, not an observation time.
              observedAt: null,
            }))}
          />
        </>
      )}

      <ObservationNote>
        These are the network site records the networking integration owns, read with server-side
        client and site scope and with controller credentials stripped before they reach the
        browser. Link speed and ISP are reported values rather than measurements this studio took,
        nothing here is a substitute for topology evidence, and nothing on this tab changes a
        controller, a site or a policy.
      </ObservationNote>
    </div>
  );
}
