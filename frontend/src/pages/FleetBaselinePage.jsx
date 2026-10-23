import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, Gauge, Loader2, RefreshCw, Repeat, ShieldAlert } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import {
  CohortCard,
  CohortThresholds,
  DevicesTable,
  ShapesList,
} from "@/components/fleet/FleetBaselineKit";

/**
 * `/fleet-baseline` — the estate as the reference for one endpoint.
 *
 * The Nexus Agent learns a performance baseline per endpoint. This surface is the
 * other half: every endpoint compared against the measured median of the caller's
 * own operating-system cohort. It is the operating surface Windows Studio and
 * Endpoint Performance Studio were admitted against, so it reads
 * `/fleet-baseline/contract`, `/fleet-baseline/cohorts/{platform}/deviations` and
 * `/fleet-baseline/cohorts/{platform}/recurrence` rather than keeping any numbers
 * of its own.
 *
 * This page is the *whole estate* view: every cohort the caller can see, with a
 * selector and both views. The same evidence is rendered inside a studio's
 * Diagnostics tab for that studio's cohort, through the shared kit in
 * `@/components/fleet/FleetBaselineKit` — so the two cannot disagree about what a
 * deviation means, how an unmeasured metric reads, or which cohort spoke.
 */

export default function FleetBaselinePage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [contract, setContract] = useState(null);
  const [report, setReport] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const view = searchParams.get("view") === "recurrence" ? "recurrence" : "deviations";
  const requestedPlatform = searchParams.get("platform") || "";
  const cohorts = useMemo(() => (Array.isArray(contract?.cohorts) ? contract.cohorts : []), [contract]);
  const platform = requestedPlatform || cohorts[0]?.platform || "";

  const loadContract = useCallback(async () => {
    setError(null);
    try {
      const response = await axios.get(`${API}/fleet-baseline/contract`, { headers });
      setContract(response.data);
    } catch (err) {
      setError(apiErrorMessage(err, "The estate comparison could not be loaded, so no endpoint is being compared right now."));
    }
  }, [headers]);

  // The cohort read is a separate request because it is a separate question: the
  // contract says what the estate measured, this says how one endpoint sits in it.
  const loadReport = useCallback(async () => {
    if (!platform) {
      setReport(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const suffix = view === "recurrence" ? "recurrence" : "deviations";
      const response = await axios.get(
        `${API}/fleet-baseline/cohorts/${encodeURIComponent(platform)}/${suffix}`,
        { headers },
      );
      setReport(response.data);
      setError(null);
    } catch (err) {
      setReport(null);
      setError(apiErrorMessage(err, "This cohort could not be read. Nexus is not grading any endpoint against it."));
    } finally {
      setLoading(false);
    }
  }, [headers, platform, view]);

  const loadHealth = useCallback(async () => {
    if (platform !== "windows") {
      setHealth(null);
      return;
    }
    try {
      const response = await axios.get(`${API}/windows-health/fleet`, { headers });
      setHealth(response.data);
    } catch {
      // The baseline remains useful when an older deployment has not yet
      // mounted this optional projection; never substitute a green placeholder.
      setHealth(null);
    }
  }, [headers, platform]);

  useEffect(() => { loadContract(); }, [loadContract]);
  useEffect(() => { loadReport(); }, [loadReport]);
  useEffect(() => { loadHealth(); }, [loadHealth]);

  const refresh = useCallback(() => {
    loadContract();
    loadReport();
    loadHealth();
  }, [loadContract, loadHealth, loadReport]);

  const params = useCallback((next) => {
    const nextPlatform = next.platform === undefined ? platform : next.platform;
    const nextView = next.view === undefined ? view : next.view;
    const merged = nextPlatform ? { platform: nextPlatform } : {};
    return nextView === "recurrence" ? { ...merged, view: "recurrence" } : merged;
  }, [platform, view]);

  const selectCohort = (nextPlatform) => setSearchParams(params({ platform: nextPlatform }));
  const selectView = (nextView) => setSearchParams(params({ view: nextView }));

  if (error && !contract) {
    return (
      <div className="space-y-4" data-testid="fleet-baseline-error">
        <OperationalPageHeader eyebrow="Nexus Endpoint · estate comparison" title="Fleet Baseline" description={error} icon={ShieldAlert} tone="amber" />
        <Button variant="outline" onClick={refresh}><RefreshCw className="w-4 h-4 mr-1" />Retry</Button>
      </div>
    );
  }

  if (!contract && loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-10" data-testid="fleet-baseline-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Comparing the estate against itself…
      </div>
    );
  }

  const cohort = report?.cohort || null;
  const boundary = report?.boundary || contract?.boundary || "";

  return (
    <div className="space-y-6" data-testid="fleet-baseline">
      <OperationalPageHeader
        eyebrow="Nexus Endpoint · estate comparison"
        title={platform === "windows" ? "Windows Studio" : "Fleet Baseline"}
        description={platform === "windows" ? "Evidence-first Windows fleet health and peer comparison. Symptoms, diagnoses and approved remediation remain distinct." : "Each endpoint against the measured median of your own operating-system cohort. A deviation is a difference from what your estate reported — not a fault, a cause or a prediction."}
        icon={Gauge}
        tone="cyan"
        actions={<Button variant="outline" onClick={refresh} data-testid="fleet-baseline-refresh"><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>}
      />

      {error && contract && (
        <Card className="border-amber-500/40 bg-amber-500/5" data-testid="fleet-baseline-stale">
          <CardContent className="pt-4 text-xs text-muted-foreground">{error}</CardContent>
        </Card>
      )}

      <CohortThresholds contract={contract} />

      {platform === "windows" && health && (
        <Card data-testid="windows-health-summary">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-500" /><p className="text-sm font-semibold">Windows Health Engine</p></div>
            <p className="text-xs text-muted-foreground">Correlates retained agent and endpoint evidence. It does not confirm root cause or run a repair.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
              {[["action_required", "Action required"], ["attention", "Attention"], ["insufficient_evidence", "Evidence gap"], ["healthy_observed", "Observed healthy"]].map(([key, label]) => (
                <div key={key} className="rounded-md border border-border/60 p-2"><p className="text-muted-foreground">{label}</p><p className="text-lg font-semibold tabular-nums">{health.summary?.[key] ?? 0}</p></div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{health.boundary}</p>
          </CardContent>
        </Card>
      )}

      {cohorts.length === 0 && (
        <Card data-testid="fleet-baseline-no-cohorts">
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              No endpoint in your scope reported an operating system, so Nexus has no cohort to compare anything against
              and states that rather than showing an empty, clean estate.
            </p>
          </CardContent>
        </Card>
      )}

      {cohorts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="fleet-baseline-cohorts">
          {cohorts.map((row) => (
            <Button
              key={row.platform}
              variant={row.platform === platform ? "default" : "outline"}
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => selectCohort(row.platform)}
              data-testid={`cohort-${row.platform}`}
            >
              {row.label} · {row.measured_device_count}/{row.device_count} measured
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant={view === "deviations" ? "default" : "outline"}
              size="sm"
              className="h-7 text-[11px] gap-1"
              onClick={() => selectView("deviations")}
              data-testid="baseline-view-deviations"
            >
              <Gauge className="w-3 h-3" />Endpoints
            </Button>
            <Button
              variant={view === "recurrence" ? "default" : "outline"}
              size="sm"
              className="h-7 text-[11px] gap-1"
              onClick={() => selectView("recurrence")}
              data-testid="baseline-view-recurrence"
            >
              <Repeat className="w-3 h-3" />Shared shapes
            </Button>
          </div>
        </div>
      )}

      {report && cohort === null && (
        <Card data-testid="fleet-baseline-unknown-cohort">
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{report.note}</p>
          </CardContent>
        </Card>
      )}

      {cohort && <CohortCard cohort={cohort} />}

      {loading && report === null && cohort === null && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="fleet-baseline-report-loading">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading this cohort…
        </div>
      )}

      {report && cohort && view === "deviations" && <DevicesTable devices={report.devices} />}

      {report && cohort && view === "recurrence" && <ShapesList report={report} />}

      {report?.note && (
        <p className="text-[11px] text-muted-foreground" data-testid="fleet-baseline-note">{report.note}</p>
      )}

      {boundary && (
        <p className="text-[11px] text-muted-foreground" data-testid="fleet-baseline-boundary">{boundary}</p>
      )}
    </div>
  );
}
