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
 * Patch Studio's Inventory tab, rendered over the projection that already
 * exists (`GET /patch-compliance/overview`).
 *
 * The studio does not re-count patch state: it reads the endpoint's own summary
 * and its per-endpoint rows, so the studio and `/patch-tuesday` can never
 * disagree about a device. What this panel adds is the honesty the fleet
 * contract requires, and this projection needs two disclosures in particular:
 *
 * 1. **A percentage that is absent is not a percentage that is zero.**
 *    `compliance_pct` is `null` until something has actually been assessed, so
 *    the total prints the not-reported disclosure instead of "0%".
 * 2. **Severity was never measured.** The projection hardcodes `critical: 0`
 *    because the agent's compact payload carries no CVSS severity, so a zero
 *    there is not an all-clear. That total is deliberately not shown as a
 *    headline and the reason is stated in the boundary note instead.
 */

const PATCH_DOTS = {
  current: "bg-emerald-500",
  needs_attention: "bg-amber-500",
  stale: "bg-amber-500",
  not_assessed: "bg-slate-500",
};

/** Compose a sentence fragment only when the API reported the number. */
function countText(value, suffix) {
  return value === null || value === undefined || value === "" ? null : `${value} ${suffix}`;
}

function rowFor(device) {
  return {
    key: device.id,
    label: <Observed value={device.name} what="endpoint name" />,
    meta: [
      <Observed key="client" value={device.client_name} what="client" />,
      <Observed key="os" value={device.os} what="operating system" />,
      <Observed
        key="ring"
        value={device.patch_ring ? `ring ${device.patch_ring}` : null}
        what="patch ring"
      />,
      <Observed key="source" value={device.source} what="reporting source" />,
      <Observed
        key="pending"
        value={countText(device.pending_patches, "pending")}
        what="pending updates"
      />,
    ],
    status: device.patch_status,
    dotClass: statusDot(device.patch_status, PATCH_DOTS),
    observedAt: device.observed_at || device.last_seen,
  };
}

export default function PatchPosturePanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) return <ObservationUnbound spec={spec} />;

  const summary = data?.summary || null;
  const devices = Array.isArray(data?.devices) ? data.devices : null;

  const totals = [
    { label: "Endpoints reporting patch state", value: summary?.assessed_devices },
    {
      label: "Endpoints carrying the agent",
      value: summary?.total_devices,
      detail: "A device without the signed agent is not part of this projection at all.",
    },
    { label: "Reported current", value: summary?.compliant },
    { label: "Needs attention", value: summary?.needs_attention },
    {
      label: "Reported compliance",
      value:
        summary?.compliance_pct === null || summary?.compliance_pct === undefined
          ? null
          : `${summary.compliance_pct}%`,
      detail:
        "Not reported means nothing has been assessed yet — it does not mean zero compliance.",
    },
    { label: "Legacy unverified policies", value: summary?.legacy_unverified_policies },
  ];

  return (
    <div className="space-y-3" data-testid="studio-patch-posture">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />

      {loading && <ObservationLoading label="Reading observed patch state…" />}

      {!loading && error && <ObservationError error={error} onRetry={reload} />}

      {!loading && !error && devices && devices.length > 0 && (
        <>
          <ObservedTotals totals={totals} testId="studio-patch-totals" />
          <ObservedRows
            rows={devices.map(rowFor)}
            testId="studio-patch-endpoints"
            label="Endpoints whose patch state the agent reported"
          />
        </>
      )}

      {!loading && !error && devices && devices.length === 0 && (
        <ObservedEmpty
          title="No endpoint in your scope has reported patch state"
          note="A device appears here only once the signed agent has reported its own patch evidence. An empty read is an observed absence, not a compliant estate."
          testId="studio-patch-empty"
        />
      )}

      {!loading && !error && data?.message && (
        <ObservationNote testId="studio-patch-message">{data.message}</ObservationNote>
      )}

      <ObservationNote testId="studio-patch-boundary">
        Every figure here is the most recent trusted agent observation, carrying its own
        observation time; a stale observation is kept visible but is never counted as current, and a
        device the agent has never reported on is absent rather than compliant. Severity is not part
        of the reported payload, so this projection never labels a pending update critical and its
        critical count of zero is not a measured all-clear. Nothing on this tab installs an update.
      </ObservationNote>
    </div>
  );
}
