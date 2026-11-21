import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Database, Download, Loader2, Play, RefreshCw, Scale, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ACTIVE_STATUSES = new Set(["queued", "running"]);

function statusTone(status) {
  if (status === "completed") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (status === "failed") return "bg-red-500/15 text-red-300 border-red-500/30";
  if (status === "cancelled") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-sky-500/15 text-sky-300 border-sky-500/30";
}

function countLabel(value) {
  return Number(value || 0).toLocaleString();
}

function moneyLabel(value) {
  const amount = Number(value || 0);
  return `${amount < 0 ? "-" : ""}$${Math.abs(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const RECONCILIATION_ISSUE_LABELS = {
  missing_invoice: "Missing invoice",
  duplicate_nexus_invoice: "Duplicate invoice",
  invoice_total_mismatch: "Invoice total",
  amount_paid_mismatch: "Paid total",
  payment_count_mismatch: "Payment count",
  payment_sum_mismatch: "Payment sum",
  missing_payment: "Missing payment",
  extra_nexus_payment: "Extra payment",
  wrong_invoice_payment: "Wrong invoice",
  duplicate_payment: "Duplicate payment",
  payment_amount_mismatch: "Payment amount",
  currency_mismatch: "Currency",
};

function currencyLabel(code) {
  return !code || code === "UNSPECIFIED" ? "Unspecified" : code;
}

function ReconciliationTotals({ source, nexus, difference }) {
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-3">
      {[
        ["Invoice totals", source?.invoice_total, nexus?.invoice_total, difference?.invoice_total],
        ["Amount paid", source?.amount_paid, nexus?.amount_paid, difference?.amount_paid],
        ["Payments", source?.payment_total, nexus?.payment_total, difference?.payment_total],
      ].map(([label, sourceValue, nexusValue, delta]) => (
        <div key={label} className="rounded-md bg-muted/30 px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="font-mono text-[11px]">
            {moneyLabel(sourceValue)} → {moneyLabel(nexusValue)}
          </div>
          <div className={`text-[10px] ${Math.abs(Number(delta || 0)) < 0.005 ? "text-emerald-300" : "text-amber-300"}`}>
            Delta {moneyLabel(delta)}
          </div>
        </div>
      ))}
    </div>
  );
}

function reconciliationExceptionCount(report) {
  return [
    "orphan_source_payments",
    "unexpected_nexus_invoices",
    "duplicate_nexus_invoices",
    "unexpected_nexus_payments",
    "duplicate_nexus_payments",
  ].reduce((total, key) => total + Number(report?.payment_exceptions?.[key]?.count || 0), 0);
}

function jobOptionLabel(job) {
  const mode = job?.mode === "dry_run" ? "Dry run" : "Applied";
  const parsed = job?.created_at ? new Date(job.created_at) : null;
  const created = parsed && !Number.isNaN(parsed.getTime())
    ? parsed.toLocaleString()
    : "Unknown time";
  return `${mode} · ${job?.status || "unknown"} · ${created}`;
}

export default function SyncroMigrationPanel({ apiBase, headers }) {
  const [capabilities, setCapabilities] = useState(null);
  const [selected, setSelected] = useState([]);
  const [job, setJob] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [failures, setFailures] = useState([]);
  const [reconciliation, setReconciliation] = useState(null);
  const [reconciliationLoading, setReconciliationLoading] = useState(false);
  const [reconciliationError, setReconciliationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadFailures = useCallback(async (jobId) => {
    if (!jobId) {
      setFailures([]);
      return;
    }
    try {
      const response = await axios.get(`${apiBase}/syncro/migration/jobs/${jobId}/failures?limit=25`, { headers });
      setFailures(response.data?.failures || []);
    } catch {
      setFailures([]);
    }
  }, [apiBase, headers]);

  const refreshJob = useCallback(async (jobId) => {
    if (!jobId) return null;
    try {
      const response = await axios.get(`${apiBase}/syncro/migration/jobs/${jobId}`, { headers });
      setJob(response.data);
      setJobs((current) => current.map((item) => (
        item.id === response.data?.id ? response.data : item
      )));
      if (Number(response.data?.totals?.failed || 0) > 0) {
        await loadFailures(jobId);
      }
      return response.data;
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not refresh the migration job");
      return null;
    }
  }, [apiBase, headers, loadFailures]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [capabilityResponse, jobsResponse] = await Promise.all([
          axios.get(`${apiBase}/syncro/migration/capabilities`, { headers }),
          axios.get(`${apiBase}/syncro/migration/jobs?limit=10`, { headers }),
        ]);
        if (cancelled) return;
        const nextCapabilities = capabilityResponse.data || {};
        setCapabilities(nextCapabilities);
        const defaults = nextCapabilities.default_entities || [];
        setSelected((current) => (current.length ? current : defaults));
        const nextJobs = jobsResponse.data?.jobs || [];
        setJobs(nextJobs);
        const latest = nextJobs[0] || null;
        setJob(latest);
        if (latest?.id) await refreshJob(latest.id);
      } catch (error) {
        if (!cancelled) {
          toast.error(error.response?.data?.detail || "Could not load Syncro migration capabilities");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [apiBase, headers, refreshJob]);

  useEffect(() => {
    if (!job?.id || !ACTIVE_STATUSES.has(job.status)) return undefined;
    const timer = window.setInterval(() => { refreshJob(job.id); }, 2500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status, refreshJob]);

  useEffect(() => {
    if (!job?.id || job.mode !== "apply" || job.status !== "completed") {
      setReconciliation(null);
      setReconciliationError("");
      return undefined;
    }
    let cancelled = false;
    setReconciliationLoading(true);
    setReconciliationError("");
    axios.get(
      `${apiBase}/syncro/migration/jobs/${job.id}/reconciliation?issues_only=true&limit=25`,
      { headers },
    ).then((response) => {
      if (!cancelled) setReconciliation(response.data || null);
    }).catch((error) => {
      if (!cancelled) {
        setReconciliation(null);
        setReconciliationError(error.response?.data?.detail || "Could not load the reconciliation report");
      }
    }).finally(() => {
      if (!cancelled) setReconciliationLoading(false);
    });
    return () => { cancelled = true; };
  }, [apiBase, headers, job?.id, job?.mode, job?.status]);

  const entityMap = useMemo(() => {
    const map = new Map();
    for (const entity of capabilities?.entities || []) map.set(entity.key, entity);
    return map;
  }, [capabilities]);

  const toggleEntity = (key) => {
    setSelected((current) => (
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    ));
  };

  const selectJob = async (jobId) => {
    const selectedJob = jobs.find((item) => item.id === jobId);
    if (!selectedJob) return;
    setBusy(true);
    setJob(selectedJob);
    setFailures([]);
    setReconciliation(null);
    setReconciliationError("");
    try {
      await refreshJob(selectedJob.id);
    } finally {
      setBusy(false);
    }
  };

  const start = async (mode) => {
    if (!selected.length) {
      toast.error("Select at least one record type");
      return;
    }
    if (mode === "apply" && !window.confirm(
      "Start the one-time migration? Existing Syncro-linked records will be updated in place. Nexus will not delete anything."
    )) return;
    setBusy(true);
    setFailures([]);
    try {
      const response = await axios.post(
        `${apiBase}/syncro/migration/jobs`,
        { mode, entities: selected },
        { headers },
      );
      setJob(response.data);
      setJobs((current) => [
        response.data,
        ...current.filter((item) => item.id !== response.data?.id),
      ].slice(0, 10));
      setReconciliation(null);
      setReconciliationError("");
      toast.success(mode === "dry_run" ? "Dry run started" : "Migration started");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not start the migration");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!job?.id) return;
    setBusy(true);
    try {
      const response = await axios.post(`${apiBase}/syncro/migration/jobs/${job.id}/cancel`, {}, { headers });
      setJob(response.data);
      toast.success("Cancellation requested. The current record will finish before the job stops.");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not cancel the migration");
    } finally {
      setBusy(false);
    }
  };

  const exportReconciliation = async () => {
    if (!job?.id) return;
    setBusy(true);
    try {
      const response = await axios.get(
        `${apiBase}/syncro/migration/jobs/${job.id}/reconciliation.csv`,
        { headers, responseType: "blob" },
      );
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `syncro-reconciliation-${job.id}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Reconciliation CSV exported");
    } catch {
      toast.error("Could not export the reconciliation CSV");
    } finally {
      setBusy(false);
    }
  };

  const active = job && ACTIVE_STATUSES.has(job.status);
  const total = job?.totals || {};
  const completedEntities = job?.completed_entities || 0;
  const totalEntities = job?.entities?.length || 0;

  return (
    <Card id="syncro-migration-panel" data-testid="syncro-migration-panel" className="border-orange-500/20 bg-orange-500/[0.03]">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4 text-orange-400" />
              One-time migration into Nexus
            </CardTitle>
            <CardDescription>
              Copy Syncro customers, contacts, assets, tickets, invoices, recurring invoices and more.
              Raw source records are archived before mapping, and re-running updates by immutable Syncro IDs.
            </CardDescription>
          </div>
          {job?.status && (
            <Badge className={statusTone(job.status)}>{job.status.replace("_", " ")}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-3 text-xs leading-5 text-amber-100/80">
          <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
          Run a dry run first. Nothing is deleted, and a failed record does not stop the rest of the migration.
          Review failures and reconciliation before switching off Syncro.
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading migration coverage…
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Record types</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(capabilities?.entities || []).map((entity) => (
                  <label key={entity.key} className="flex items-start gap-2 rounded-md border border-border/60 px-2.5 py-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-orange-500"
                      checked={selected.includes(entity.key)}
                      onChange={() => toggleEntity(entity.key)}
                      disabled={active || busy}
                    />
                    <span>
                      <span className="font-medium text-foreground">{entity.label}</span>
                      <span className="ml-1 text-muted-foreground">
                        {entity.mapped ? "mapped" : "raw archive"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => start("dry_run")} disabled={busy || active}>
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                Dry run
              </Button>
              <Button size="sm" onClick={() => start("apply")} disabled={busy || active}>
                <Database className="mr-1.5 h-3.5 w-3.5" />
                Start migration
              </Button>
              <Button size="sm" variant="ghost" onClick={() => job?.id && refreshJob(job.id)} disabled={busy || !job?.id}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Refresh
              </Button>
              {active && (
                <Button size="sm" variant="outline" onClick={cancel} disabled={busy}>
                  <XCircle className="mr-1.5 h-3.5 w-3.5" />
                  Cancel
                </Button>
              )}
            </div>

            {job && (
              <div className="space-y-3 rounded-lg border border-border/60 bg-background/40 p-3">
                {jobs.length > 1 && (
                  <label className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Migration job
                    <select
                      className="h-7 max-w-full rounded-md border border-border/60 bg-background px-2 text-[11px] normal-case tracking-normal text-foreground"
                      value={job.id}
                      onChange={(event) => selectJob(event.target.value)}
                      disabled={active || busy}
                      aria-label="Select migration job"
                    >
                      {jobs.map((item) => (
                        <option key={item.id} value={item.id}>{jobOptionLabel(item)}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">
                    {job.mode === "dry_run" ? "Dry run" : "Applied migration"} · {completedEntities}/{totalEntities} record types
                  </span>
                  <span className="text-muted-foreground">{Math.round(Number(job.percent || 0))}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-orange-500 transition-all"
                    style={{ width: `${Math.max(0, Math.min(100, Number(job.percent || 0)))}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  {[
                    ["Fetched", total.fetched],
                    ["Created", total.created],
                    ["Updated", total.updated],
                    ["Linked", total.linked],
                    ["Archived", total.archived],
                    ["Failed", total.failed],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md bg-muted/30 px-2 py-1.5">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
                      <div className="text-sm font-semibold">{countLabel(value)}</div>
                    </div>
                  ))}
                </div>
                {job.current_entity && (
                  <p className="text-xs text-muted-foreground">
                    Current: <span className="text-foreground">{entityMap.get(job.current_entity)?.label || job.current_entity}</span>
                  </p>
                )}
                {job.last_error && (
                  <p className="rounded-md border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-xs text-red-200">
                    {job.last_error}
                  </p>
                )}
                {job.status === "completed" && (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Job completed. Review the counts, failures and reconciliation before cutover.
                  </p>
                )}
                {job.status === "completed" && job.mode === "apply" && (
                  <div
                    data-testid="syncro-reconciliation-report"
                    className="space-y-2 rounded-md border border-border/60 bg-background/30 p-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-semibold">
                        <Scale className="h-3.5 w-3.5 text-sky-300" /> Reconciliation
                      </p>
                      <div className="flex items-center gap-1.5">
                        {reconciliation && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[10px]"
                            onClick={exportReconciliation}
                            disabled={busy || reconciliationLoading}
                          >
                            <Download className="mr-1 h-3 w-3" /> CSV
                          </Button>
                        )}
                        {reconciliation && (
                          <Badge
                            className={reconciliation.status === "reconciled"
                              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                              : reconciliation.status === "no_source_records"
                                ? "border-border/60 bg-muted/30 text-muted-foreground"
                                : "border-amber-500/30 bg-amber-500/15 text-amber-300"}
                          >
                            {reconciliation.status === "reconciled"
                              ? "Reconciled"
                              : reconciliation.status === "no_source_records"
                                ? "No data"
                                : "Needs review"}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {reconciliationLoading && (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Comparing archived Syncro records with Nexus…
                      </p>
                    )}
                    {reconciliationError && (
                      <p className="text-xs text-amber-200">{reconciliationError}</p>
                    )}
                    {reconciliation?.status === "no_source_records" && (
                      <p className="text-xs text-muted-foreground">
                        No archived Syncro invoice or payment records are available to compare yet.
                      </p>
                    )}
                    {reconciliation && reconciliation.status !== "no_source_records" && (
                      <>
                        {reconciliation.currency_status === "mixed" ? (
                          <div className="space-y-2">
                            <p className="text-[11px] text-amber-200/90">
                              Mixed currencies are reported separately; amounts are not converted between currencies.
                            </p>
                            <div className="grid gap-2 text-xs sm:grid-cols-2">
                              {Object.entries(reconciliation.by_currency || {}).map(([code, group]) => (
                                <div key={code} className="rounded-md border border-border/50 p-2">
                                  <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                                    <span className="font-semibold">{currencyLabel(code)}</span>
                                    <span className="text-[10px] text-muted-foreground">
                                      {countLabel(group?.source?.invoice_count)} invoices
                                    </span>
                                  </div>
                                  <ReconciliationTotals
                                    source={group?.source}
                                    nexus={group?.nexus}
                                    difference={group?.difference}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <>
                            <ReconciliationTotals
                              source={reconciliation.source}
                              nexus={reconciliation.nexus}
                              difference={reconciliation.difference}
                            />
                            {reconciliation.currency_status === "unspecified" && (
                              <p className="text-[11px] text-amber-200/90">
                                Some records have no currency code; their totals are grouped as Unspecified.
                              </p>
                            )}
                          </>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span>{countLabel(reconciliation.source?.invoice_count)} source invoices</span>
                          <span>·</span>
                          <span>{countLabel(reconciliation.source?.payment_count)} source payments</span>
                          <span>·</span>
                          <span>{countLabel(reconciliation.nexus?.payment_count)} Nexus payments</span>
                          {Array.isArray(reconciliation.currencies) && reconciliation.currencies.length > 0 && (
                            <>
                              <span>·</span>
                              <span>
                                {reconciliation.currency_status === "mixed"
                                  ? "Mixed currencies"
                                  : `Currency ${currencyLabel(reconciliation.currencies[0])}`}
                              </span>
                            </>
                          )}
                          {Number(reconciliation.invoice_total_count || 0) > 0 && (
                            <Badge variant="outline" className="border-amber-500/30 text-[10px] text-amber-300">
                              {countLabel(reconciliation.invoice_total_count)} invoice issues
                            </Badge>
                          )}
                          {reconciliationExceptionCount(reconciliation) > 0 && (
                            <Badge variant="outline" className="border-amber-500/30 text-[10px] text-amber-300">
                              {countLabel(reconciliationExceptionCount(reconciliation))} payment exceptions
                            </Badge>
                          )}
                        </div>
                        {(reconciliation.invoices || []).length > 0 && (
                          <div className="space-y-1">
                            {(reconciliation.invoices || []).slice(0, 5).map((row) => (
                              <div key={row.syncro_invoice_id} className="rounded border border-border/50 px-2 py-1.5 text-[11px]">
                                <div className="flex flex-wrap items-center justify-between gap-1">
                                  <span className="font-medium text-foreground">
                                    {row.invoice_number || `Syncro invoice ${row.syncro_invoice_id}`}
                                    {row.currency && (
                                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                                        {currencyLabel(row.currency)}
                                      </span>
                                    )}
                                  </span>
                                  <span className="font-mono text-muted-foreground">
                                    {moneyLabel(row.source_total)} → {moneyLabel(row.nexus_total)}
                                  </span>
                                </div>
                                <div className="mt-0.5 text-amber-200/90">
                                  {(row.issue_codes || []).map((code) => RECONCILIATION_ISSUE_LABELS[code] || code).join(" · ")}
                                </div>
                              </div>
                            ))}
                            {Number(reconciliation.invoice_total_count || 0) > 5 && (
                              <p className="text-[10px] text-muted-foreground">
                                Showing 5 of {countLabel(reconciliation.invoice_total_count)} invoice issues.
                              </p>
                            )}
                          </div>
                        )}
                        {(reconciliation.payment_exceptions?.orphan_source_payments?.items || []).length > 0 && (
                          <div className="space-y-0.5 text-[10px] text-amber-200/90">
                            {(reconciliation.payment_exceptions.orphan_source_payments.items || []).slice(0, 3).map((payment) => (
                              <p key={payment.syncro_payment_id}>
                                Orphan source payment #{payment.syncro_payment_id}
                                {payment.invoice_syncro_id ? ` on Syncro invoice #${payment.invoice_syncro_id}` : " without an invoice"}
                                {" · "}{moneyLabel(payment.amount)}
                                {" · "}{currencyLabel(payment.currency)}
                              </p>
                            ))}
                          </div>
                        )}
                        {reconciliation.matched && (
                          <p className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Synced invoice totals and payment history agree with the archived Syncro records
                            {reconciliation.currency_status === "mixed" ? " within each currency" : ""}.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
                {failures.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-red-200">Failed records ({failures.length})</p>
                    {failures.slice(0, 8).map((failure) => (
                      <p key={failure.id} className="truncate text-[11px] text-muted-foreground">
                        <span className="text-foreground">{failure.entity}</span> #{failure.syncro_id}: {failure.error}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
