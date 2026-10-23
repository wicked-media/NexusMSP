import { ArrowUpRight, ShieldAlert } from "lucide-react";
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

function tenantRow(tenant) {
  return {
    key: tenant.id || tenant.tenant_id,
    label: tenant.name || tenant.tenant_id || "Microsoft tenant",
    meta: [
      <Observed key="domain" value={tenant.default_domain} what="default domain" />,
      <Observed key="users" value={tenant.users_count === null || tenant.users_count === undefined ? null : `${tenant.users_count} reported users`} what="reported users" />,
      <Observed key="mfa" value={tenant.mfa_enrolled_pct === null || tenant.mfa_enrolled_pct === undefined ? null : `${tenant.mfa_enrolled_pct}% MFA`} what="MFA coverage" />,
      <Observed key="score" value={tenant.secure_score === null || tenant.secure_score === undefined ? null : `Secure Score ${tenant.secure_score}`} what="Secure Score" />,
    ],
    observedAt: tenant.observed_at,
  };
}

function streamTone(state) {
  return state === "observed" ? "secondary" : "outline";
}

export default function MicrosoftStudioPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);
  if (unresolved) return <ObservationUnbound spec={spec} />;

  const summary = data?.summary || {};
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  const tenants = Array.isArray(data?.tenants) ? data.tenants : [];
  const attention = Array.isArray(data?.attention) ? data.attention : [];

  return (
    <div className="space-y-4" data-testid="studio-microsoft-overview">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />
      {loading && <ObservationLoading label="Reading verified Microsoft evidence…" />}
      {!loading && error && <ObservationError error={error} onRetry={reload} />}
      {!loading && !error && (
        <>
          <ObservedTotals totals={[
            { label: "Mapped tenants", value: summary.tenants, detail: "Verified Microsoft tenant records in your server-authorised scope." },
            { label: "Reported users", value: summary.reported_users, detail: `${summary.tenants_reporting_users ?? 0} tenant record(s) supplied a user count.` },
            { label: "MFA coverage", value: summary.average_mfa_pct === null || summary.average_mfa_pct === undefined ? null : `${summary.average_mfa_pct}%`, detail: `${summary.tenants_reporting_mfa ?? 0} tenant record(s) supplied MFA evidence.` },
            { label: "Secure Score", value: summary.average_secure_score, detail: `${summary.tenants_reporting_secure_score ?? 0} tenant record(s) supplied a score.` },
          ]} />

          <div className="rounded-xl border border-border/70 bg-card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Evidence coverage</p>
                <p className="text-xs text-muted-foreground">Each service area is shown only when the verified collector has recorded evidence.</p>
              </div>
              <span className="text-[11px] text-muted-foreground">Last projection: <Observed value={data?.generated_at} what="not reported" /></span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {streams.map((stream) => (
                <div key={stream.id} className="rounded-lg border border-border/60 px-3 py-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{stream.label}</span><Badge variant={streamTone(stream.evidence_state)} className="text-[10px]">{stream.evidence_state === "observed" ? "Observed" : "Not reported"}</Badge></div>
                  <p className="text-[11px] text-muted-foreground"><Observed value={stream.records} what="record count" /> record(s)</p>
                  <p className="text-[10px] text-muted-foreground">Latest: <Observed value={stream.latest_observed_at} what="not reported" /></p>
                </div>
              ))}
            </div>
          </div>

          {attention.length > 0 && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-2">
              <div className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-amber-600" /><p className="text-sm font-medium">Evidence requiring review</p></div>
              {attention.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-2 text-xs border-t border-amber-500/15 pt-2 first:border-0 first:pt-0">
                  <Badge variant="outline" className="uppercase text-[9px]">{item.severity}</Badge>
                  <span className="font-medium">{item.subject}</span><span className="text-muted-foreground">{item.detail}</span>
                </div>
              ))}
            </div>
          )}

          {tenants.length ? <ObservedRows label="Microsoft tenants in scope" rows={tenants.map(tenantRow)} /> : (
            <ObservedEmpty title="No verified Microsoft tenant is in scope" note="Nothing is mapped or synchronised for this technician scope yet. This is a coverage state, not a statement that there are no Microsoft tenants to manage." />
          )}

          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline"><a href="/control-plane?module=microsoft365">Open Microsoft Control Plane <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></a></Button>
            <Button asChild size="sm" variant="outline"><a href="/control-plane?module=microsoft365&view=connections">Review connection readiness <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></a></Button>
          </div>
          <ObservationNote>{data?.boundary}</ObservationNote>
        </>
      )}
    </div>
  );
}
