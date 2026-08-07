import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  GitCompareArrows,
  History,
  Minus,
  Plus,
  RefreshCw,
  ScanSearch,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const EXPECTED_COVERAGE = [
  ["system", "System"],
  ["hardware", "Hardware"],
  ["security", "Security"],
  ["network", "Network & DNS"],
  ["storage", "Storage"],
  ["software", "Software"],
  ["updates", "Updates"],
  ["drivers", "Drivers"],
  ["services", "Services"],
  ["scheduled_tasks", "Scheduled tasks"],
  ["users", "Local users"],
  ["group_policy", "Group Policy"],
  ["registry", "Registry"],
  ["certificates", "Certificates"],
  ["firewall_rules", "Firewall rules"],
  ["shares", "Shares"],
];

const CATEGORY_LABELS = Object.fromEntries(EXPECTED_COVERAGE);
CATEGORY_LABELS.agent = "Nexus Agent";

function dateLabel(value, withTime = true) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return format(parsed, withTime ? "dd MMM yyyy, HH:mm:ss" : "dd MMM yyyy");
}

function valueLabel(value) {
  if (value === null || value === undefined || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  if (typeof value === "object") {
    const name = value.name || value.title || value.device || value.path;
    if (name) return String(name);
    return JSON.stringify(value);
  }
  return String(value);
}

function ChangeRow({ change, kind }) {
  const Icon = kind === "added" ? Plus : kind === "removed" ? Minus : ArrowRight;
  const tone = kind === "added"
    ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300"
    : kind === "removed"
      ? "border-rose-500/20 bg-rose-500/[0.06] text-rose-300"
      : "border-cyan-500/20 bg-cyan-500/[0.06] text-cyan-300";
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{change.label || change.key}</p>
          {kind === "changed" ? (
            <p className="mt-1 break-words text-[11px] text-muted-foreground">
              <span className="text-rose-300/80">{valueLabel(change.before)}</span>
              <ArrowRight className="mx-1 inline h-3 w-3" />
              <span className="text-emerald-300/80">{valueLabel(change.after)}</span>
            </p>
          ) : (
            <p className="mt-1 break-words text-[11px] text-muted-foreground">
              {valueLabel(kind === "added" ? change.after : change.before)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DeviceTimeMachine({ deviceId, headers, API }) {
  const [history, setHistory] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(`${API}/devices/${deviceId}/time-machine`, { headers });
      const next = response.data;
      setHistory(next);
      const rows = next.snapshots || [];
      if (rows.length >= 2) {
        setFromId((current) => rows.some((row) => row.id === current) ? current : rows[1].id);
        setToId((current) => rows.some((row) => row.id === current) ? current : rows[0].id);
      } else {
        setFromId("");
        setToId(rows[0]?.id || "");
        setComparison(null);
      }
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "Time Machine history could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [API, deviceId, headers]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  useEffect(() => {
    if (!fromId || !toId || fromId === toId) {
      setComparison(null);
      return undefined;
    }
    let active = true;
    setComparing(true);
    axios.get(`${API}/devices/${deviceId}/time-machine/compare`, {
      headers,
      params: { from_snapshot: fromId, to_snapshot: toId },
    }).then((response) => {
      if (active) setComparison(response.data);
    }).catch((requestError) => {
      if (active) {
        setComparison(null);
        setError(requestError?.response?.data?.detail || "The selected states could not be compared.");
      }
    }).finally(() => {
      if (active) setComparing(false);
    });
    return () => { active = false; };
  }, [API, deviceId, fromId, headers, toId]);

  const snapshots = history?.snapshots || [];
  const currentCoverage = new Set(history?.latest_coverage || []);
  const collectedCount = EXPECTED_COVERAGE.filter(([key]) => currentCoverage.has(key)).length;
  const changeSummary = comparison?.comparison;
  const changedCategories = changeSummary?.changed_categories || [];
  const latest = snapshots[0];
  const categoryEntries = useMemo(
    () => Object.entries(changeSummary?.categories || {}),
    [changeSummary],
  );

  if (loading) {
    return (
      <Card className="border-cyan-500/15">
        <CardContent className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin text-cyan-300" /> Loading endpoint history…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="device-time-machine">
      <Card className="overflow-hidden border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.08] via-card to-violet-500/[0.05]">
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-300">
                <History className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">Nexus Time Machine</h2>
                  <Badge variant="outline" className="border-cyan-400/20 bg-cyan-500/10 text-cyan-200">Agent evidence</Badge>
                </div>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Reconstruct what changed on this endpoint, compare two observed states, and retain the evidence with the device and client record.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={fetchHistory} className="shrink-0 border-cyan-500/25" data-testid="refresh-time-machine">
              <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh history
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Preserved states", value: history?.total || 0, detail: "Changed states only", icon: Database },
          { label: "Current coverage", value: `${collectedCount}/${EXPECTED_COVERAGE.length}`, detail: "Evidence categories", icon: ScanSearch },
          { label: "Changes selected", value: changeSummary?.total_changes ?? "—", detail: changedCategories.length ? `${changedCategories.length} categories` : "Choose two states", icon: GitCompareArrows },
          { label: "History boundary", value: history?.history_started_at ? dateLabel(history.history_started_at, false) : "Awaiting agent", detail: "First trusted observation", icon: Clock3 },
        ].map((tile) => (
          <Card key={tile.label} className="border-white/[0.08] bg-card/80">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/15 bg-cyan-500/[0.08] text-cyan-300">
                <tile.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold">{tile.value}</p>
                <p className="truncate text-xs font-medium">{tile.label}</p>
                <p className="truncate text-[10px] text-muted-foreground">{tile.detail}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!snapshots.length ? (
        <Card className="border-dashed border-cyan-500/20">
          <CardContent className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
            <History className="mb-3 h-10 w-10 text-cyan-300/60" />
            <h3 className="font-semibold">Waiting for the first endpoint state</h3>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              {history?.device?.agent_linked
                ? "The Nexus Agent is linked. Its next trusted heartbeat will establish the baseline automatically."
                : "Link and enrol the Nexus Agent to begin recording real endpoint state."}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">{history?.boundary_note}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-white/[0.08]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm"><GitCompareArrows className="h-4 w-4 text-cyan-300" />Compare observed states</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-end">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Before</p>
                  <Select value={fromId} onValueChange={setFromId} disabled={snapshots.length < 2}>
                    <SelectTrigger data-testid="time-machine-from"><SelectValue placeholder="Choose an earlier state" /></SelectTrigger>
                    <SelectContent>
                      {snapshots.map((row) => <SelectItem key={row.id} value={row.id} disabled={row.id === toId}>{dateLabel(row.captured_at)} · {row.change_count} changes</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <ArrowRight className="mx-auto hidden h-4 w-4 text-muted-foreground md:block" />
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">After</p>
                  <Select value={toId} onValueChange={setToId} disabled={snapshots.length < 2}>
                    <SelectTrigger data-testid="time-machine-to"><SelectValue placeholder="Choose a later state" /></SelectTrigger>
                    <SelectContent>
                      {snapshots.map((row) => <SelectItem key={row.id} value={row.id} disabled={row.id === fromId}>{dateLabel(row.captured_at)} · {row.change_count} changes</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {snapshots.length === 1 && (
                <p className="mt-3 rounded-md border border-amber-500/15 bg-amber-500/[0.05] px-3 py-2 text-xs text-amber-200">
                  Baseline captured {dateLabel(latest.captured_at)}. A comparison becomes available after the agent reports a real state change.
                </p>
              )}
            </CardContent>
          </Card>

          {snapshots.length >= 2 && (
            <Card className="border-white/[0.08]">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-sm"><ScanSearch className="h-4 w-4 text-cyan-300" />Change evidence</CardTitle>
                  {comparing ? <Badge variant="outline"><RefreshCw className="mr-1 h-3 w-3 animate-spin" />Comparing</Badge> : (
                    <Badge variant="outline" className={changeSummary?.total_changes ? "border-amber-500/25 text-amber-200" : "border-emerald-500/25 text-emerald-200"}>
                      {changeSummary?.total_changes ? `${changeSummary.total_changes} changes` : "No differences"}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!comparing && changeSummary && categoryEntries.length === 0 && (
                  <div className="flex min-h-32 flex-col items-center justify-center text-center">
                    <CheckCircle2 className="mb-2 h-7 w-7 text-emerald-300" />
                    <p className="text-sm font-medium">The selected endpoint states match.</p>
                    <p className="text-xs text-muted-foreground">No collected field changed between these observations.</p>
                  </div>
                )}
                <div className="space-y-3">
                  {categoryEntries.map(([category, detail]) => {
                    const rows = [
                      ...(detail.added || []).map((change) => ({ change, kind: "added" })),
                      ...(detail.removed || []).map((change) => ({ change, kind: "removed" })),
                      ...(detail.changed || []).map((change) => ({ change, kind: "changed" })),
                    ];
                    return (
                      <div key={category} className="rounded-xl border border-white/[0.08] bg-black/10 p-3">
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-sm font-semibold">{CATEGORY_LABELS[category] || category.replaceAll("_", " ")}</p>
                          <Badge variant="secondary" className="text-[10px]">{detail.count}</Badge>
                        </div>
                        <div className="grid gap-2 lg:grid-cols-2">
                          {rows.slice(0, 12).map(({ change, kind }, index) => <ChangeRow key={`${kind}-${change.key}-${index}`} change={change} kind={kind} />)}
                        </div>
                        {rows.length > 12 && <p className="mt-2 text-[10px] text-muted-foreground">Showing 12 of {rows.length} changes in this category.</p>}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Card className="border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Collection coverage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {EXPECTED_COVERAGE.map(([key, label]) => {
              const collected = currentCoverage.has(key);
              return (
                <div key={key} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${collected ? "border-emerald-500/15 bg-emerald-500/[0.05] text-emerald-200" : "border-white/[0.06] bg-black/10 text-muted-foreground"}`}>
                  {collected ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <Clock3 className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate">{label}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            “Awaiting” means the installed agent has not supplied that evidence category. It is not a healthy or compliant result.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
