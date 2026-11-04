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
 * Backup Studio's Inventory tab, rendered over the projection that already
 * exists (`GET /backup-dashboard/overview`).
 *
 * The studio does not re-count backups: it reads the protected-workload records
 * and the summary the endpoint already computed, so the studio and
 * `/backup-center` can never show different numbers. What this panel adds is the
 * honesty the fleet contract requires — a job whose run outcome was never
 * recorded reads as not reported rather than as a success, and a green row means
 * a recorded run outcome, never a verified restore. Recovery proof is a separate
 * capability (Backup Studio's own restore evidence) and this panel does not
 * imply it.
 *
 * It also discloses the endpoint's own fallback: when the caller's scope holds
 * no backup job record *and* the caller's scope is all clients, the endpoint
 * answers from Acronis-sourced rows. A client-restricted technician never
 * receives that fallback, so a short list here can mean "nothing recorded in
 * your scope", not "nothing is protected".
 */

const STATUS_DOTS = {
  success: "bg-emerald-500",
  failed: "bg-rose-500",
  running: "bg-sky-500",
};

/** Compose "<n> GB" only when the API reported the number. */
function gigabyteText(value) {
  return value === null || value === undefined || value === "" ? null : `${value} GB`;
}

function rowFor(job) {
  return {
    key: job.id,
    label: <Observed value={job.name} what="workload name" />,
    meta: [
      <Observed key="client" value={job.client_name} what="client" />,
      <Observed key="size" value={gigabyteText(job.size_gb)} what="recorded size" />,
    ],
    status: job.status,
    dotClass: statusDot(job.status, STATUS_DOTS),
    observedAt: job.last_run || job.updated_at,
  };
}

export default function BackupRecoveryPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) return <ObservationUnbound spec={spec} />;

  const summary = data?.summary || null;
  const jobs = Array.isArray(data?.jobs) ? data.jobs : null;

  const totals = [
    { label: "Protected workloads", value: summary?.total_jobs },
    {
      label: "Last run succeeded",
      value: summary?.successful,
    },
    {
      label: "Last run failed",
      value: summary?.failed,
      detail:
        Number(summary?.failed) > 0
          ? "A failed run is a recorded outcome for that job, not proof that the workload is unprotected — and not proof that a restore would work."
          : null,
    },
    { label: "Running now", value: summary?.running },
    {
      label: "Reported success rate",
      value:
        summary?.success_rate === null || summary?.success_rate === undefined
          ? null
          : `${summary.success_rate}%`,
    },
    {
      label: "Reported size",
      value: gigabyteText(summary?.total_size_gb),
    },
  ];

  return (
    <div className="space-y-3" data-testid="studio-backup-recovery">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />

      {loading && <ObservationLoading label="Reading protected-workload records…" />}

      {!loading && error && <ObservationError error={error} onRetry={reload} />}

      {!loading && !error && jobs && jobs.length > 0 && (
        <>
          <ObservedTotals totals={totals} testId="studio-backup-totals" />
          <ObservedRows
            rows={jobs.map(rowFor)}
            testId="studio-backup-workloads"
            label="Protected workloads recorded in your scope"
          />
        </>
      )}

      {!loading && !error && jobs && jobs.length === 0 && (
        <ObservedEmpty
          title="No backup job record exists in your scope"
          note="Nexus states that instead of rendering an empty panel that would read like a clean protection posture. It is not evidence that any workload is protected or unprotected."
          testId="studio-backup-empty"
        />
      )}

      <ObservationNote testId="studio-backup-boundary">
        This projection reads backup job records in your scope; when none exist and your scope is all
        clients it falls back to Acronis-sourced rows, and a client-restricted technician never
        receives that fallback. A job whose status was not reported is shown as not reported rather
        than as a success, and a green row is a recorded run outcome — never a verified restore.
      </ObservationNote>
    </div>
  );
}
