import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * The rendering rules for the fleet-baseline projection, in one place.
 *
 * Two surfaces show this evidence — `/fleet-baseline` and the Diagnostics tab of
 * the studios admitted against it (docs/NEXUS_INVENT_BATCH_5.md) — and they must
 * not be able to disagree about it, because a studio that read a deviation
 * differently from the page a technician opens next would be two answers to one
 * question. The rules themselves come from the API
 * (`backend/app/services/fleet_baseline.py`), which enforces them:
 *
 * 1. A metric nobody reported renders as *not reported* with its reason. Never
 *    `0%`, never healthy.
 * 2. A cohort below the minimum measured size has no baseline, so it renders
 *    `cohort_not_established` — not `within_baseline`, and not green.
 * 3. A deviation is a difference from the estate's median, not a fault; the
 *    boundary sentence the API returns is shown verbatim by both surfaces.
 */

const VERDICT = {
  strong: { label: "Well outside the cohort", className: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  notable: { label: "Outside the cohort band", className: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  within_baseline: { label: "Within the cohort band", className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  cohort_not_established: { label: "No cohort baseline yet", className: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  not_measured: { label: "Nothing measured", className: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
};

export function verdictStyle(verdict) {
  return VERDICT[verdict] || VERDICT.not_measured;
}

/** A reported number, or the disclosure that there is no number. Never zero. */
export function reported(value, unit) {
  return value === null || value === undefined ? null : `${value}${unit || ""}`;
}

export function MetricRow({ metricKey, metric }) {
  const median = reported(metric.median, metric.unit);
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 py-2 last:border-b-0" data-testid={`baseline-metric-${metricKey}`}>
      <div>
        <p className="text-xs font-medium">{metric.label}</p>
        <p className="text-[11px] text-muted-foreground">
          {metric.measured_count} measured endpoint{metric.measured_count === 1 ? "" : "s"}
          {metric.spread === null || metric.spread === undefined ? "" : ` · spread ${metric.spread}${metric.unit || ""}`}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums" data-testid={`baseline-median-${metricKey}`}>
          {median === null ? "Not reported" : median}
        </p>
        {metric.established === false && metric.reason && (
          <p className="text-[11px] text-muted-foreground max-w-[16rem]" data-testid={`baseline-reason-${metricKey}`}>{metric.reason}</p>
        )}
      </div>
    </div>
  );
}

/** The cohort itself: what its measured endpoints say a device looks like. */
export function CohortCard({ cohort, testId = "baseline-cohort" }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="pt-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">{cohort.label} cohort</p>
          <Badge variant="outline" className={`text-[10px] ${cohort.baseline_established ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-violet-500/10 text-violet-400 border-violet-500/20"}`}>
            {cohort.baseline_established ? "Baseline established" : "No baseline yet"}
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {cohort.measured_device_count} of {cohort.device_count} endpoints in this cohort reported a metric.
        </p>
        {!cohort.baseline_established && cohort.unestablished_reason && (
          <p className="text-xs text-violet-400" data-testid="baseline-unestablished">{cohort.unestablished_reason}</p>
        )}
        <div>
          {Object.entries(cohort.metrics || {}).map(([key, metric]) => (
            <MetricRow key={key} metricKey={key} metric={metric} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** The thresholds a verdict can be reproduced from, disclosed rather than implied. */
export function CohortThresholds({ contract, testId = "fleet-baseline-thresholds" }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="pt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-[11px] text-muted-foreground">Endpoints in scope</p>
          <p className="text-lg font-semibold tabular-nums">{contract?.device_count ?? 0}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Measured endpoints a baseline needs</p>
          <p className="text-lg font-semibold tabular-nums">{contract?.minimum_cohort_devices ?? "—"}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Endpoints a shape needs</p>
          <p className="text-lg font-semibold tabular-nums">{contract?.minimum_recurring_devices ?? "—"}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Deviation thresholds</p>
          <p className="text-lg font-semibold tabular-nums">
            {contract?.notable_deviation_ratio === undefined ? "—" : `±${Math.round(contract.notable_deviation_ratio * 100)}% / ±${Math.round((contract.strong_deviation_ratio ?? 0) * 100)}%`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function DeviceRow({ device }) {
  const style = verdictStyle(device.verdict);
  return (
    <TableRow data-testid={`baseline-device-${device.device_id}`}>
      <TableCell className="align-top">
        <p className="font-medium text-sm">{device.name}</p>
        <p className="text-[11px] text-muted-foreground">{device.hostname || "hostname not reported"}</p>
        <p className="text-[11px] text-muted-foreground">
          Agent band: {device.band === "unknown" ? "not assessed" : device.band}
          {device.samples === null || device.samples === undefined ? "" : ` · ${device.samples} samples`}
        </p>
      </TableCell>
      <TableCell className="align-top">
        <Badge variant="outline" className={`text-[10px] whitespace-nowrap ${style.className}`}>{style.label}</Badge>
      </TableCell>
      <TableCell className="align-top space-y-2">
        {device.deviations.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No metric was reported by this endpoint, so nothing is compared and nothing is claimed.
          </p>
        )}
        {device.deviations.map((row) => (
          <div key={row.metric} data-testid={`baseline-deviation-${device.device_id}-${row.metric}`}>
            <p className="text-xs">
              <span className="font-medium">{row.label}</span>
              {" "}{reported(row.value, row.unit) ?? "not reported"}
              {row.cohort_median === null || row.cohort_median === undefined
                ? " · no cohort median"
                : ` · cohort median ${row.cohort_median}${row.unit || ""}`}
              {row.delta === null || row.delta === undefined ? "" : ` · ${row.delta > 0 ? "+" : ""}${row.delta}`}
              <span className={`ml-2 rounded border px-1.5 py-0.5 text-[10px] ${verdictStyle(row.verdict).className}`}>
                {verdictStyle(row.verdict).label}
              </span>
            </p>
            <p className="text-[11px] text-muted-foreground">{row.basis}</p>
          </div>
        ))}
        {device.unmeasured.length > 0 && (
          <div data-testid={`baseline-unmeasured-${device.device_id}`}>
            <p className="text-[11px] font-medium">Not reported by this endpoint</p>
            <ul className="text-[11px] text-muted-foreground">
              {device.unmeasured.map((row) => (
                <li key={row.metric}>{row.label}: {row.reason}</li>
              ))}
            </ul>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

/** Every endpoint in the cohort against its baseline, worst verdict first. */
export function DevicesTable({ devices, testId = "baseline-devices" }) {
  return (
    <Table data-testid={testId}>
      <TableHeader>
        <TableRow>
          <TableHead>Endpoint</TableHead>
          <TableHead>Worst verdict</TableHead>
          <TableHead>Against the cohort baseline</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(devices || []).map((device) => (
          <DeviceRow key={device.device_id} device={device} />
        ))}
      </TableBody>
    </Table>
  );
}

function ShapeRow({ shape, index }) {
  return (
    <Card data-testid={`baseline-shape-${index}`}>
      <CardContent className="pt-4 space-y-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-[10px] ${verdictStyle(shape.verdict).className}`}>{verdictStyle(shape.verdict).label}</Badge>
          <p className="text-sm font-medium">
            {shape.device_count} endpoint{shape.device_count === 1 ? "" : "s"} {shape.direction} the median for {shape.label}
          </p>
        </div>
        <p className="text-xs text-muted-foreground" data-testid={`baseline-shape-basis-${index}`}>{shape.basis}</p>
        <p className="text-[11px] text-muted-foreground">
          {shape.direction === "above" ? "Above" : "Below"} a cohort median of {reported(shape.cohort_median, shape.unit) ?? "no measured median"}
          {" · "}{shape.device_names.join(", ")}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * The shapes more than one endpoint shares. One machine's bad day is not a
 * recurring problem, so an empty list is stated rather than shown as a clean
 * panel.
 */
export function ShapesList({ report, testId = "baseline-shapes" }) {
  return (
    <div className="space-y-3" data-testid={testId}>
      {(report?.shapes || []).length === 0 && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              No shape is shared by {report?.minimum_devices} or more endpoints in this cohort, so Nexus reports none —
              one machine's bad day is not a recurring problem.
            </p>
          </CardContent>
        </Card>
      )}
      {(report?.shapes || []).map((shape, index) => (
        <ShapeRow key={shape.id} shape={shape} index={index} />
      ))}
    </div>
  );
}

function ProposalRow({ row, index }) {
  const verdict = verdictStyle(row.verdict);
  return (
    <Card data-testid={`baseline-proposal-${index}`}>
      <CardContent className="pt-4 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={`text-[10px] ${verdict.className}`}>{verdict.label}</Badge>
          <p className="text-sm font-medium">
            {row.device_count} endpoint{row.device_count === 1 ? "" : "s"} {row.direction} the median for {row.label}
          </p>
          <Badge
            variant="outline"
            className={`text-[10px] ${row.proposed ? "bg-sky-500/10 text-sky-400 border-sky-500/20" : "text-muted-foreground"}`}
            data-testid={`baseline-proposal-state-${index}`}
          >
            {row.proposed ? "Raisable now" : row.reason === "already_open" ? "Already raised" : "Cannot be raised"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground" data-testid={`baseline-proposal-basis-${index}`}>{row.basis}</p>
        {row.proposed ? (
          <div className="text-[11px] text-muted-foreground space-y-1">
            <p data-testid={`baseline-proposal-title-${index}`}>{row.change?.title}</p>
            <p>Verification: {row.change?.verification}</p>
            <p>Rollback: {row.change?.rollback_plan}</p>
            <p>
              A {row.change?.category} change at {row.change?.risk_level} risk, raised through Change Management —
              nothing is executed on any endpoint.
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground" data-testid={`baseline-proposal-reason-${index}`}>{row.detail}</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Each recurring shape and the change request it would raise.
 *
 * Nothing here changes a device. A row says which shape is raisable now, which
 * one is already raised — naming the change rather than proposing a second — and
 * which one Nexus refuses to act on with the reason it was refused. The request
 * itself is created and approved through Change Management, where the technician
 * who raises it cannot also approve it.
 */
export function ProposalsList({ report, testId = "baseline-proposals" }) {
  const rows = report?.shapes || [];
  return (
    <div className="space-y-3" data-testid={testId}>
      {rows.length === 0 && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              No shape in this cohort can raise a change. A shape the recurrence view does not report has no row at
              all, because a proposal may only cite evidence the deviation view already returns.
            </p>
          </CardContent>
        </Card>
      )}
      {rows.map((row, index) => (
        <ProposalRow key={row.shape_id} row={row} index={index} />
      ))}
    </div>
  );
}
