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
  healthy: "bg-emerald-500",
  observed: "bg-sky-500",
  attention: "bg-amber-500",
  stale: "bg-amber-500",
  offline: "bg-rose-500",
  not_proven: "bg-slate-500",
};

function signalRow(signal) {
  return {
    key: signal.id,
    label: signal.label || "Unnamed monitoring signal",
    meta: [signal.detail || "No detail was retained."],
    status: String(signal.state || "not_proven").replaceAll("_", " "),
    dotClass: statusDot(signal.state, STATE_DOTS),
    observedAt: signal.observed_at || null,
  };
}

/**
 * Monitoring Studio's overview is deliberately a projection of Nexus Pulse.
 * It does not poll providers, infer availability, or create a second alert
 * store: the Pulse contract composes already-authoritative scoped evidence.
 */
export default function MonitoringPulsePanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) return <ObservationUnbound spec={spec} />;

  const signals = Array.isArray(data?.signals) ? data.signals : null;
  const summary = data?.summary || {};
  const attention = Array.isArray(data?.attention) ? data.attention : [];
  const totals = [
    { label: "Observed devices", value: summary.devices },
    { label: "Fresh device observations", value: summary.fresh_devices },
    { label: "Nexus Agents", value: summary.agents },
    { label: "Agents within window", value: summary.online_agents },
    { label: "Open service records", value: summary.open_tickets },
    { label: "Backup attention", value: summary.backup_attention },
  ];

  return (
    <div className="space-y-3" data-testid="studio-monitoring-pulse">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />
      {loading && <ObservationLoading label="Reading scoped operational evidence…" />}
      {!loading && error && <ObservationError error={error} onRetry={reload} />}
      {!loading && !error && signals && (
        <>
          <ObservedTotals totals={totals} testId="studio-monitoring-totals" />
          {signals.length > 0 ? (
            <ObservedRows
              rows={signals.map(signalRow)}
              testId="studio-monitoring-signals"
              label="Signals retained in your permitted scope"
            />
          ) : (
            <ObservedEmpty
              title="No monitoring signal is retained in this scope"
              note="Nexus does not translate an empty evidence set into a healthy estate. Check source coverage and collector state before relying on monitoring."
              testId="studio-monitoring-empty"
            />
          )}
          {attention.length > 0 && (
            <ObservedRows
              rows={attention.map((item) => ({
                key: item.id,
                label: item.label || "Monitoring attention",
                meta: [item.detail || "Needs review"],
                status: String(item.state || "attention").replaceAll("_", " "),
                dotClass: statusDot(item.state, STATE_DOTS),
                observedAt: item.observed_at || null,
              }))}
              testId="studio-monitoring-attention"
              label="Attention requiring source review"
            />
          )}
          <ObservationNote testId="studio-monitoring-boundary">
            {data?.boundary || "Monitoring Studio only reports evidence returned by the scoped Pulse contract. Missing, stale or unconfigured sources remain not proven; no availability or root-cause claim is inferred here."}
          </ObservationNote>
        </>
      )}
    </div>
  );
}
