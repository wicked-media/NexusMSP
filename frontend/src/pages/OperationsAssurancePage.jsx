import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, CheckCircle2, Loader2, RefreshCw, ShieldAlert, ShieldQuestion, Scale } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import {
  allGaps,
  commitmentHeadline,
  commitmentStateLabel,
  commitmentStateTone,
  formatCount,
  reportedTotal,
  stateCounts,
  unmeasuredCommitments,
} from "@/lib/operationsAssurance";

/**
 * `/operations-assurance` — Nexus Operations Assurance Studio.
 *
 * Monitoring answers "did the job run?". This page answers the question the
 * customer actually bought: *was the promised operational outcome achieved?*
 * Every row shows the promise and the evidence behind it, and a promise Nexus
 * could not measure is promoted rather than hidden — an unmeasured obligation is
 * the most important thing on the screen.
 */

const STATE_STYLE = {
  emerald: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  rose: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  violet: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  slate: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

function stateStyle(state) {
  return STATE_STYLE[commitmentStateTone(state)] || STATE_STYLE.slate;
}

export default function OperationsAssurancePage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [contract, setContract] = useState(null);
  const [report, setReport] = useState(null);
  const [serviceGap, setServiceGap] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [contractRes, reportRes, serviceGapRes] = await Promise.all([
        axios.get(`${API}/operations-assurance/contract`, { headers }),
        axios.get(`${API}/operations-assurance/commitments`, { headers }),
        axios.get(`${API}/operations-assurance/service-gap`, { headers }),
      ]);
      setContract(contractRes.data);
      setReport(reportRes.data);
      setServiceGap(serviceGapRes.data);
    } catch (err) {
      setError(apiErrorMessage(err, "The assurance report could not be loaded. Nothing is being claimed."));
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const commitments = useMemo(() => {
    if (report && Array.isArray(report.commitments) && report.commitments.length > 0) return report.commitments;
    if (contract && Array.isArray(contract.commitments)) {
      return contract.commitments.map((item) => ({ ...item, state: "", gaps: [] }));
    }
    return [];
  }, [report, contract]);

  const counts = useMemo(() => stateCounts(report?.summary), [report]);
  const total = useMemo(() => reportedTotal(report?.summary), [report]);
  const unmeasured = useMemo(() => unmeasuredCommitments(commitments), [commitments]);
  const gaps = useMemo(
    () => commitments.flatMap((commitment) => allGaps(commitment)),
    [commitments],
  );
  const boundary = report?.boundary || contract?.boundary || "";

  if (error) {
    return (
      <div className="space-y-4" data-testid="assurance-error">
        <OperationalPageHeader eyebrow="Platform" title="Operations Assurance" description={error} icon={ShieldAlert} tone="amber" />
        <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Retry</Button>
      </div>
    );
  }

  if (!report && !contract) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-10">
        <Loader2 className="w-4 h-4 animate-spin" /> Evaluating promised outcomes…
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="operations-assurance">
      <OperationalPageHeader
        eyebrow="Platform · verified outcomes"
        title="Operations Assurance"
        description="Each promise is evaluated against recorded evidence. A promise Nexus could not measure is stated as not measured — never as met."
        icon={Activity}
        tone="cyan"
        actions={<Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>}
      />

      <div className="grid gap-3 grid-cols-2 md:grid-cols-5" data-testid="assurance-summary">
        {counts.map((row) => (
          <Card key={row.state} data-testid={`assurance-count-${row.state}`}>
            <CardContent className="pt-4">
              <Badge variant="outline" className={`text-[10px] ${STATE_STYLE[row.tone]}`}>{row.label}</Badge>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{formatCount(row.count)}</p>
            </CardContent>
          </Card>
        ))}
        <Card data-testid="assurance-count-total">
          <CardContent className="pt-4">
            <Badge variant="outline" className="text-[10px]">Promises evaluated</Badge>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{formatCount(total)}</p>
          </CardContent>
        </Card>
      </div>

      {serviceGap && (
        <Card className="border-cyan-500/20" data-testid="service-gap">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <Scale className="w-4 h-4 mt-0.5 text-cyan-500" />
                <div>
                  <p className="text-sm font-semibold">Service Gap</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Contracted, observed and billed quantities reconcile only where an explicit service identifier exists.
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {serviceGap.summary?.services_evaluated || 0} services evaluated
              </Badge>
            </div>

            <div className="grid gap-2 grid-cols-2 md:grid-cols-5 text-xs">
              {[
                ["Under-delivery", serviceGap.summary?.under_delivery || 0, "text-rose-400"],
                ["Under-billing", serviceGap.summary?.under_billing || 0, "text-amber-500"],
                ["Over-billing", serviceGap.summary?.over_billing || 0, "text-rose-400"],
                ["Unverified", serviceGap.summary?.unverified_delivery || 0, "text-violet-400"],
                ["Unmapped", serviceGap.summary?.unmapped_records || 0, "text-slate-400"],
              ].map(([label, count, tone]) => (
                <div key={label} className="rounded border border-border/60 px-2.5 py-2">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className={`mt-0.5 font-semibold tabular-nums ${tone}`}>{count}</p>
                </div>
              ))}
            </div>

            {serviceGap.findings?.length > 0 ? (
              <ul className="space-y-2" data-testid="service-gap-findings">
                {serviceGap.findings.slice(0, 8).map((finding) => (
                  <li key={`${finding.client_id}:${finding.service_key}`} className="rounded border border-border/60 p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium font-mono">{finding.service_key}</p>
                      <Badge variant="outline" className={`text-[10px] ${stateStyle(finding.state)}`}>
                        {String(finding.state || "").replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">{finding.reason}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Contracted: {finding.contracted ?? "unverified"} · Provisioned: {finding.provisioned ?? "unverified"} · Billed: {finding.billed ?? "unverified"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                No verified service discrepancy is currently recorded for this scope.
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">{serviceGap.boundary}</p>
          </CardContent>
        </Card>
      )}

      {unmeasured.length > 0 && (
        <Card className="border-violet-500/30 bg-violet-500/5" data-testid="assurance-unmeasured">
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center gap-2">
              <ShieldQuestion className="w-4 h-4 text-violet-400" />
              <p className="text-sm font-semibold">Unmeasured obligations ({unmeasured.length})</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Nexus holds no evidence for these promises, so it does not report them as achieved.
              Each one names the evidence it would need.
            </p>
            <ul className="space-y-1.5">
              {unmeasured.map((commitment) => (
                <li key={commitment.id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{commitment.title || commitment.id}</span>
                  {" — "}{commitment.reason || "No reason was recorded."}
                  {commitment.evidence_source && <span className="block text-[11px]">Evidence needed: {commitment.evidence_source}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {commitments.length === 0 ? (
        <Card data-testid="assurance-empty">
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              No operational promise is registered for this scope, so there is nothing to assure yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {commitments.map((commitment) => {
            const commitmentGaps = allGaps(commitment);
            return (
              <Card key={commitment.id} data-testid={`assurance-commitment-${commitment.id}`}>
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-sm">{commitment.title || commitment.id}</p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{commitmentHeadline(commitment)}</p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] whitespace-nowrap ${stateStyle(commitment.state)}`}>
                      {commitmentStateLabel(commitment.state)}
                    </Badge>
                  </div>

                  {commitment.reason && <p className="text-xs text-muted-foreground">{commitment.reason}</p>}

                  <p className="text-[11px] text-muted-foreground">
                    Evidence: <span className="font-mono">{commitment.evidence_source || "not recorded"}</span>
                  </p>

                  {commitmentGaps.length > 0 && (
                    <ul className="space-y-2" data-testid={`assurance-gaps-${commitment.id}`}>
                      {commitmentGaps.map((gap) => (
                        <li key={gap.key} className="rounded border border-border/60 p-2">
                          <p className="text-xs font-medium">{gap.identifier}</p>
                          <p className="text-[11px] text-muted-foreground">{gap.reason}</p>
                          {gap.fields.length > 0 && (
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {gap.fields.map((field) => `${field.label}: ${field.value}`).join(" · ")}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {gaps.length > 0 && (
        <Card data-testid="assurance-actionable">
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm font-semibold">Gaps to close ({gaps.length})</p>
            </div>
            <ul className="space-y-1.5">
              {gaps.map((gap) => (
                <li key={gap.key} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{gap.commitmentTitle}</span>
                  {" · "}{gap.identifier} — {gap.reason}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {boundary && (
        <p className="text-[11px] text-muted-foreground" data-testid="assurance-boundary">{boundary}</p>
      )}
    </div>
  );
}
