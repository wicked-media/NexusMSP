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

function newestSample(samples) {
  return samples.reduce((latest, sample) => {
    const candidate = sample?.timestamp || sample?.observed_at || sample?.created_at;
    if (!candidate) return latest;
    return !latest || String(candidate) > String(latest) ? candidate : latest;
  }, null);
}

function Connection({ data }) {
  const configured = Boolean(data?.configured);
  const migrationRequired = Boolean(data?.migration_required);
  return <>
    <ObservedTotals totals={[
      { label: "Connection", value: configured ? "Configured" : "Not configured", detail: "Credential presence only; it is not a successful controller read." },
      { label: "Migration", value: migrationRequired ? "Required" : "Not required", detail: "Legacy configuration must be tenant-bound before it can be used safely." },
      { label: "Last connection test", value: data?.last_test_status, detail: "Recorded result of the most recent explicit test." },
      { label: "Last sync", value: data?.last_synced_at, detail: "Provider-reported sync time, when available." },
    ]} />
    <ObservationNote>
      Connection details remain server-side. Nexus does not render controller credentials, API keys or token previews in this Studio.
    </ObservationNote>
  </>;
}

function Bandwidth({ data }) {
  const sites = Array.isArray(data?.sites) ? data.sites : [];
  const samples = Array.isArray(data?.bandwidth_data) ? data.bandwidth_data : [];
  const source = data?.meta?.source;
  const freshest = newestSample(samples);
  const siteNames = new Map(sites.map((site) => [String(site?.id || ""), site?.name]));
  return <>
    <ObservedTotals totals={[
      { label: "Sites in scope", value: sites.length, detail: "Scoped network site records, not an availability claim." },
      { label: "Telemetry samples", value: samples.length, detail: "Retained controller observations only." },
      { label: "Freshest sample", value: freshest, detail: "The newest timestamp supplied by the collector." },
      { label: "Source", value: source, detail: "A source label, not a live-throughput certification." },
    ]} />
    {samples.length ? <ObservedRows label="Recent retained controller observations" rows={samples.slice(0, 12).map((sample, index) => ({
      key: sample?.id || `${sample?.site_id || "site"}-${sample?.timestamp || index}`,
      label: <Observed value={siteNames.get(String(sample?.site_id || "")) || sample?.site_id} what="network site" />,
      meta: [
        <Observed key="source" value={sample?.source || source} what="collector source" />,
        <Observed key="state" value={sample?.status} what="sample status" />,
      ],
      status: sample?.status,
      observedAt: sample?.timestamp || sample?.observed_at || sample?.created_at,
    }))} /> : <ObservedEmpty title="No retained bandwidth observation is in scope" note="This does not certify WAN performance. It means the current authorised collector has not supplied a retained sample for the scoped sites." />}
    <ObservationNote>
      Current Nexus retains source-labelled controller samples. It does not present this evidence as a universal SNMP poller, continuous packet capture or live Mbps feed.
    </ObservationNote>
  </>;
}

function Actions({ data }) {
  const actions = Array.isArray(data) ? data : [];
  return <>
    <ObservedTotals totals={[
      { label: "Recorded actions", value: actions.length, detail: "Latest permission-scoped provider action records." },
      { label: "Succeeded", value: actions.filter((action) => action?.success === true).length, detail: "Only explicit success records." },
      { label: "Failed", value: actions.filter((action) => action?.success === false).length, detail: "Only explicit failure records." },
    ]} />
    {actions.length ? <ObservedRows label="UniFi provider action history" rows={actions.map((action, index) => ({
      key: action?.id || `${action?.device_id || "device"}-${action?.timestamp || index}`,
      label: <Observed value={action?.action} what="action" />,
      meta: [
        <Observed key="device" value={action?.device_id} what="device" />,
        <Observed key="actor" value={action?.by} what="technician" />,
      ],
      status: action?.success === true ? "succeeded" : action?.success === false ? "failed" : "recorded",
      dotClass: action?.success === true ? "bg-emerald-500" : action?.success === false ? "bg-rose-500" : "bg-slate-500",
      observedAt: action?.timestamp,
    }))} /> : <ObservedEmpty title="No UniFi provider action is recorded in scope" note="This is an empty action-history window, not proof that no configuration changed elsewhere." />}
    <ObservationNote>
      Provider response bodies and secrets are removed server-side. This is an audited outcome record, not a replay control.
    </ObservationNote>
  </>;
}

/** The focused evidence views for Network Studio's connected provider tabs. */
export default function NetworkEvidencePanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);
  if (unresolved) return <ObservationUnbound spec={spec} />;
  const connection = endpoint === "/unifi/status";
  const bandwidth = endpoint === "/bandwidth-monitor/overview";
  const actions = endpoint === "/unifi/actions/log";
  return <div className="space-y-4" data-testid="studio-network-evidence">
    <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />
    {loading && <ObservationLoading label="Reading scoped network provider evidence…" />}
    {!loading && error && <ObservationError error={error} onRetry={reload} />}
    {!loading && !error && connection && <Connection data={data} />}
    {!loading && !error && bandwidth && <Bandwidth data={data} />}
    {!loading && !error && actions && <Actions data={data} />}
    {!loading && !error && !connection && !bandwidth && !actions && <ObservedEmpty title="This network evidence projection is not modelled" note="Nexus has not assigned a technician-safe view to this endpoint, so it does not reinterpret the payload." />}
  </div>;
}
