import {
  ObservationError,
  ObservationHeader,
  ObservationLoading,
  ObservationNote,
  ObservationUnbound,
  Observed,
  ObservedEmpty,
  ObservedRows,
  statusDot,
  useStudioObservation,
} from "./StudioObservationKit";

const RISK_TONES = {
  high: "bg-rose-500",
  medium: "bg-amber-500",
  low: "bg-emerald-500",
};

/** A contract-record view, intentionally not a renewal forecast. */
export default function ClientRenewalWatchPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) return <ObservationUnbound spec={spec} />;
  const rows = Array.isArray(data?.at_risk) ? data.at_risk : [];

  return (
    <div className="space-y-3" data-testid="studio-client-renewal-watch">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />
      {loading && !data && <ObservationLoading label="Reading recorded contract renewals…" />}
      {!loading && error && <ObservationError error={error} onRetry={reload} />}
      {!loading && !error && data && (
        <>
          {rows.length === 0 ? (
            <ObservedEmpty
              title="No active contract renewal is recorded in the next 90 days"
              note="This only reflects active contracts carrying a recorded renewal or end date. It is not evidence that no agreement, renewal risk or commercial review exists."
            />
          ) : (
            <ObservedRows
              label={`${rows.length} recorded renewal${rows.length === 1 ? "" : "s"} requiring review`}
              rows={rows.map((renewal) => ({
                key: renewal.contract_id || `${renewal.client_id}-${renewal.renewal_date}`,
                label: renewal.client_name || "Client name not reported",
                meta: [
                  <Observed key="date" value={renewal.renewal_date} what="renewal date" />,
                  <Observed key="days" value={renewal.days_to_renewal} what="days to renewal" />,
                  renewal.risk_signals?.length ? renewal.risk_signals.join(" · ") : "No recorded risk signal",
                ],
                status: renewal.risk_level,
                dotClass: statusDot(renewal.risk_level, RISK_TONES),
                action: renewal.client_id ? <a className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-muted" href={`/clients?client=${encodeURIComponent(renewal.client_id)}`}>Open client</a> : null,
              }))}
            />
          )}
          <ObservationNote>
            This tab lists only the contracts already recorded as active with a renewal or end date in the
            next 90 days. Risk labels reflect the listed evidence signals and date window; they are not a
            prediction of churn, renewal probability, contract value or revenue.
          </ObservationNote>
        </>
      )}
    </div>
  );
}
