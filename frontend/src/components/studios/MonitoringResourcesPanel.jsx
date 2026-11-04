import {
  ObservationError,
  ObservationHeader,
  ObservationLoading,
  ObservationNote,
  ObservationUnbound,
  ObservedEmpty,
  ObservedRows,
  ObservedTotals,
  statusDot,
  useStudioObservation,
} from "./StudioObservationKit";

const STATE_DOTS = {
  observed: "bg-emerald-500",
  stale: "bg-amber-500",
  not_monitored: "bg-slate-500",
};

/** A coverage register, intentionally not an availability or health dashboard. */
export default function MonitoringResourcesPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) return <ObservationUnbound spec={spec} />;

  const resources = Array.isArray(data?.resources) ? data.resources : null;
  const summary = data?.summary || {};
  const rows = (resources || []).map((resource) => ({
    key: resource.id || `${resource.kind}-${resource.label}`,
    label: resource.label || "Unnamed monitored resource",
    meta: [
      resource.kind || "resource",
      resource.client_name || "Client not reported",
      resource.source || "Source not reported",
    ],
    status: String(resource.state || "not_monitored").replaceAll("_", " "),
    dotClass: statusDot(resource.state, STATE_DOTS),
    observedAt: resource.observed_at || null,
  }));

  return (
    <div className="space-y-3" data-testid="studio-monitoring-resources">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />
      {loading && <ObservationLoading label="Reading monitoring coverage…" />}
      {!loading && error && <ObservationError error={error} onRetry={reload} />}
      {!loading && !error && resources && (
        <>
          <ObservedTotals
            testId="studio-monitoring-resource-totals"
            totals={[
              { label: "Resources in scope", value: summary.resources },
              { label: "Fresh observations", value: summary.observed },
              { label: "Stale observations", value: summary.stale },
              { label: "Without retained coverage", value: summary.not_monitored },
            ]}
          />
          {rows.length > 0 ? (
            <ObservedRows
              rows={rows}
              testId="studio-monitoring-resources-list"
              label="Monitoring coverage by retained resource evidence"
            />
          ) : (
            <ObservedEmpty
              title="No endpoint resource is retained in this scope"
              note="This does not prove the estate has no endpoints. Check asset scope and agent enrolment before treating it as monitoring coverage."
              testId="studio-monitoring-resources-empty"
            />
          )}
          <ObservationNote testId="studio-monitoring-resources-boundary">
            {data?.boundary || "Coverage is based on retained endpoint observations only. A fresh observation is not an availability, health or root-cause claim."}
          </ObservationNote>
        </>
      )}
    </div>
  );
}
