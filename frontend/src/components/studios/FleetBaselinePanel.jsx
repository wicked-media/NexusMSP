import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Gauge, Loader2, RefreshCw } from "lucide-react";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import {
  CohortCard,
  CohortThresholds,
  DevicesTable,
  ProposalsList,
  ShapesList,
} from "@/components/fleet/FleetBaselineKit";

/**
 * The fleet-baseline evidence, rendered inside a Studio's Diagnostics tab.
 *
 * Windows Studio and Endpoint Performance Studio were admitted because the
 * projection exists (docs/NEXUS_INVENT_BATCH_5.md), and a studio's Diagnostics
 * tab is where a technician asks "why does this one differ". So the tab renders
 * the deviation view itself rather than the raw JSON of a generic endpoint tab:
 * the cohort baseline it was graded against, each endpoint's deviation with its
 * basis, and the metrics nobody reported. The rules are the API's and the
 * rendering is `@/components/fleet/FleetBaselineKit`, the same one `/fleet-baseline`
 * uses — one set of disclosures, two ways in.
 *
 * Two things this panel is careful about:
 *
 * 1. **The cohort comes from the registry, not from the browser.** A tab whose
 *    endpoint carries `{platform}` binds it in `params`, and `_tab` refuses a
 *    wired tab that leaves a placeholder unbound, so the studio cannot silently
 *    grade a Windows endpoint against whichever cohort happened to be largest.
 * 2. **It says which cohort it read.** The label shown is the API's own
 *    (`cohort.label`), next to the cohort the registry bound.
 */

/** Substitute the values the registry declared for a tab's endpoint. */
export function resolveTabEndpoint(endpoint, params) {
  let path = String(endpoint || "");
  for (const [key, value] of Object.entries(params || {})) {
    path = path.split(`{${key}}`).join(encodeURIComponent(value));
  }
  return path;
}

/** Which fleet-baseline question an endpoint answers, or null if it is not one. */
export function fleetBaselineView(endpoint) {
  const path = String(endpoint || "");
  if (/\/cohorts\/[^/]+\/proposed-changes$/.test(path)) return "proposals";
  if (/\/cohorts\/[^/]+\/recurrence$/.test(path)) return "recurrence";
  if (/\/cohorts\/[^/]+\/deviations$/.test(path)) return "deviations";
  if (/\/contract$/.test(path)) return "contract";
  return null;
}

function PanelError({ error, onRetry }) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/5" data-testid="studio-baseline-error">
      <CardContent className="pt-4 flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onRetry}>Retry</Button>
      </CardContent>
    </Card>
  );
}

function CohortReadLine({ label, bound }) {
  return (
    <p className="text-[11px] text-muted-foreground" data-testid="studio-baseline-cohort-read">
      Cohort read: <span className="font-medium text-foreground">{label}</span>
      {bound ? ` — bound by this studio's registry contract (platform ${bound})` : ""}.
    </p>
  );
}

export default function FleetBaselinePanel({ studio, spec }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const endpoint = resolveTabEndpoint(spec?.endpoint, spec?.params);
  const view = fleetBaselineView(endpoint);
  const boundPlatform = spec?.params?.platform || "";
  // The registry refuses an unbound placeholder at import, so this should be
  // unreachable through the API. It is checked anyway: the failure mode being
  // fixed here was a request to a path no route answers, and a panel that
  // repeats it on a stale contract would be the same bug in a new place.
  const unresolved = /\{[a-z_]+\}/.test(endpoint);
  const [state, setState] = useState({ loading: true, data: null, error: null });

  const load = useCallback(async () => {
    if (!endpoint || unresolved) {
      setState({ loading: false, data: null, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await axios.get(`${API}${endpoint}`, { headers });
      setState({ loading: false, data: res.data, error: null });
    } catch (err) {
      setState({
        loading: false,
        data: null,
        error: apiErrorMessage(err, "This comparison did not answer; Nexus is not grading any endpoint against it."),
      });
    }
  }, [endpoint, unresolved, headers]);

  useEffect(() => { load(); }, [load]);

  const report = state.data;
  const cohort = report?.cohort || null;

  return (
    <div className="space-y-3" data-testid="studio-fleet-baseline" data-view={view || "unknown"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5" />
            Reads <span className="font-mono">{endpoint}</span> — this estate's own measured endpoints, scoped server-side.
          </p>
          {view !== "contract" && (
            <CohortReadLine label={cohort?.label || boundPlatform || "not reported by the API"} bound={boundPlatform} />
          )}
        </div>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={load} data-testid="studio-baseline-refresh">
          <RefreshCw className="w-3 h-3 mr-1" />Refresh
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">{spec?.summary}</p>

      {unresolved && (
        <Card className="border-dashed" data-testid="studio-baseline-unbound">
          <CardContent className="pt-5 max-w-2xl">
            <p className="text-sm font-medium mb-1">This tab's contract does not name the cohort it reads</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The endpoint <span className="font-mono">{spec?.endpoint}</span> carries a value the registry never
              declared, so Nexus has nothing to compare and requests nothing. A cohort is named in the contract
              rather than guessed from whichever one is largest.
            </p>
          </CardContent>
        </Card>
      )}

      {state.loading && !report && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6" data-testid="studio-baseline-loading">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading this cohort…
        </div>
      )}

      {!state.loading && state.error && <PanelError error={state.error} onRetry={load} />}

      {!state.loading && !state.error && view === "contract" && report && (
        <div className="space-y-3">
          <CohortThresholds contract={report} testId="studio-baseline-thresholds" />
          {(report.cohorts || []).length === 0 ? (
            <Card data-testid="studio-baseline-no-cohorts">
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">
                  No endpoint in your scope reported an operating system, so there is no cohort to compare against.
                  Nexus states that rather than showing an empty, clean estate.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card data-testid="studio-baseline-cohorts">
              <CardContent className="pt-4 space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cohorts this estate can compare</p>
                <div className="flex flex-wrap gap-1.5">
                  {(report.cohorts || []).map((row) => (
                    <Badge
                      key={row.platform}
                      variant="outline"
                      className={`text-[10px] ${row.platform === boundPlatform ? "" : "text-muted-foreground"}`}
                      data-testid={`studio-cohort-${row.platform}`}
                    >
                      {row.label} · {row.measured_device_count}/{row.device_count} measured
                      {row.baseline_established ? "" : " · no baseline yet"}
                    </Badge>
                  ))}
                </div>
                {report.metrics && (
                  <p className="text-[11px] text-muted-foreground">
                    Metrics compared: {report.metrics.map((metric) => metric.label).join(", ")}.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {!state.loading && !state.error && view !== "contract" && report && cohort === null && (
        <Card data-testid="studio-baseline-unknown-cohort">
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{report.note}</p>
          </CardContent>
        </Card>
      )}

      {!state.loading && !state.error && cohort && (
        <CohortCard cohort={cohort} testId="studio-baseline-cohort" />
      )}

      {!state.loading && !state.error && cohort && view === "deviations" && (
        <DevicesTable devices={report.devices} testId="studio-baseline-devices" />
      )}

      {!state.loading && !state.error && cohort && view === "recurrence" && (
        <ShapesList report={report} testId="studio-baseline-shapes" />
      )}

      {!state.loading && !state.error && cohort && view === "proposals" && (
        <ProposalsList report={report} testId="studio-baseline-proposals" />
      )}

      {!state.loading && report?.note && cohort && (
        <p className="text-[11px] text-muted-foreground" data-testid="studio-baseline-note">{report.note}</p>
      )}

      {!state.loading && report?.boundary && (
        <p className="text-[11px] text-muted-foreground" data-testid="studio-baseline-boundary">{report.boundary}</p>
      )}

      <p className="text-[11px] text-muted-foreground">
        {studio?.name} reads this evidence; nothing on this panel changes a device. A recurring shape can be raised as a
        change request — that tab names the request, what would verify the repair and what would undo it — but choosing
        and applying a repair is still not registered for this studio, so a deviation here stays a measurement.
      </p>
    </div>
  );
}
