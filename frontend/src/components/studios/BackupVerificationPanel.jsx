import { ArrowUpRight, ShieldCheck } from "lucide-react";
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

const RESULT_STYLE = { pass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500", fail: "border-rose-500/30 bg-rose-500/10 text-rose-500", failed: "border-rose-500/30 bg-rose-500/10 text-rose-500", pending: "border-amber-500/30 bg-amber-500/10 text-amber-600", scheduled: "border-sky-500/30 bg-sky-500/10 text-sky-600" };

function verificationRow(test) {
  const result = String(test.result || test.status || "not_reported").toLowerCase();
  const minutes = Number(test.restore_time_minutes);
  return {
    key: test.id,
    label: <div className="flex flex-wrap items-center gap-2"><span><Observed value={test.client_name || test.id} what="verification subject" /></span><Badge variant="outline" className={RESULT_STYLE[result] || "border-border/70 text-muted-foreground"}>{result.replaceAll("_", " ")}</Badge></div>,
    meta: [
      <Observed key="type" value={test.backup_type} what="backup type" />,
      <Observed key="provider" value={test.backup_solution} what="backup provider" />,
      <Observed key="time" value={Number.isFinite(minutes) ? `${minutes} minute restore` : null} what="measured restore time" />,
      <Observed key="integrity" value={test.data_integrity_check} what="integrity check" />,
    ],
    status: result,
    dotClass: result === "pass" ? "bg-emerald-500" : ["fail", "failed"].includes(result) ? "bg-rose-500" : "bg-amber-500",
    observedAt: test.completed_at || test.tested_at || test.requested_at,
  };
}

/** Restore evidence is deliberately modelled separately from backup job health. */
export default function BackupVerificationPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);
  if (unresolved) return <ObservationUnbound spec={spec} />;
  const summary = data?.summary || {};
  const tests = Array.isArray(data?.tests) ? data.tests : [];

  return <div className="space-y-4" data-testid="studio-backup-verification"><div data-testid="backup-verification-panel"><ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />
    {loading && <ObservationLoading label="Reading retained restore-verification evidence…" />}
    {!loading && error && <ObservationError error={error} onRetry={reload} />}
    {!loading && !error && <>
      <ObservedTotals totals={[
        { label: "Verification records", value: summary.total_tests, detail: "Requested and completed restore-verification records in scope." },
        { label: "Passed", value: summary.passed, detail: "Completed tests that recorded a pass." },
        { label: "Failed", value: summary.failed, detail: "Completed tests that recorded a failure and require follow-up." },
        { label: "Scheduled or pending", value: summary.pending, detail: "Intent is not recovery proof until a measured outcome is recorded." },
        { label: "Measured restore time", value: Number.isFinite(Number(summary.avg_restore_time_min)) ? `${summary.avg_restore_time_min} min` : null, detail: "Average only across completed tests with a recorded restore time." },
        { label: "Latest test", value: summary.last_test_run, detail: "Not reported when no verification evidence is retained." },
      ]} />
      {tests.length ? <ObservedRows label="Restore verification evidence" rows={tests.map(verificationRow)} /> : <ObservedEmpty testId="backup-verification-empty" title="No restore verification is recorded in this scope" note="A successful backup job is not proof that data can be restored. Schedule a governed verification in Backup Centre to create evidence." />}
      <div className="flex flex-wrap gap-2"><Button asChild size="sm"><a href="/backup-center?tab=verify">Open Backup Centre <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></a></Button></div>
      <ObservationNote><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />Nexus records verification intent and measured outcomes. It does not treat a scheduled test, a provider job outcome or a successful API response as a proven recovery until the completed verification record says so.</ObservationNote>
    </>}</div>
  </div>;
}
