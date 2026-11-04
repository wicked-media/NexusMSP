/**
 * Pending application updates for one managed endpoint.
 *
 * The list is what the enrolled Nexus Agent actually observed with Windows
 * Package Manager (winget) and reported on its heartbeat. Nexus never invents a
 * pending package: until an agent has reported a scan, the dialog says so rather
 * than showing an empty list that reads like "nothing to update".
 *
 * Applying an update queues an audited `winget_upgrade` agent command. The dialog
 * therefore reports that the command was queued — never that the software was
 * updated — because only the endpoint's own returned evidence can prove that.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, Clock3, Download, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const EVIDENCE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const observedLabel = (value) => {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "an unrecorded time";
  return formatDistanceToNow(date, { addSuffix: true });
};

const isStaleEvidence = (observedAt, staleFlag) => {
  if (staleFlag === true) return true;
  if (!observedAt) return true;
  const observed = new Date(observedAt).getTime();
  if (!Number.isFinite(observed)) return true;
  return Date.now() - observed > EVIDENCE_STALE_AFTER_MS;
};

export default function AppUpdatesDialog({ device, open, onOpenChange, canExecute = false }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  // The agent routes in this router address the enrolled agent record, which is
  // what the device row already carries as `nexus_agent_id`.
  const agentId = device?.nexus_agent_id || device?.id || "";
  const deviceName = device?.name || "this device";
  // The row's status vocabulary is owned by the devices workspace, so an endpoint
  // is treated as reachable unless the row says otherwise. The API is the
  // authority: queuing for an offline agent is refused by the server (409), and
  // that refusal is reported honestly below. A UI hint must never become a false
  // block on work an operator is entitled to queue.
  const statusValue = String(device?.status || device?.online_status || "").toLowerCase();
  const online = !["offline", "unreachable", "disabled", "decommissioned"].includes(statusValue);

  const [state, setState] = useState({ status: "idle", observedAt: "", stale: false, packages: [], count: 0, message: "" });
  const [selected, setSelected] = useState([]);
  const [queuing, setQueuing] = useState(false);
  const [queued, setQueued] = useState([]);

  const load = useCallback(async () => {
    if (!agentId) return;
    setState(prev => ({ ...prev, status: "loading", message: "" }));
    try {
      const response = await axios.get(`${API}/nexus-agent/agents/${agentId}/app-updates`, { headers, timeout: 15000 });
      const packages = Array.isArray(response.data?.packages) ? response.data.packages : [];
      setState({
        status: "ready",
        observedAt: response.data?.observed_at || "",
        stale: Boolean(response.data?.stale),
        packages,
        count: Number.isFinite(Number(response.data?.package_count)) ? Number(response.data.package_count) : packages.length,
        message: "",
      });
      setSelected([]);
      setQueued([]);
    } catch (error) {
      const status = error?.response?.status;
      setState({
        status: status === 404 ? "unreported" : status === 403 ? "forbidden" : "error",
        observedAt: "",
        stale: false,
        packages: [],
        count: 0,
        message: error?.response?.data?.detail || "",
      });
    }
  }, [agentId, headers]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const packages = state.packages;
  const allSelected = packages.length > 0 && selected.length === packages.length;
  const staleEvidence = state.status === "ready" && isStaleEvidence(state.observedAt, state.stale);
  const blockedReason = !canExecute
    ? "Agent command permission is required to install application updates on a managed endpoint."
    : !online
      ? "The device is offline. Nexus queues an application update only for an endpoint that can receive it, so nothing is queued from here until it checks in again."
      : "";

  const togglePackage = (id) => {
    setSelected(prev => (prev.includes(id) ? prev.filter(value => value !== id) : [...prev, id]));
  };

  const queue = async (payload, description) => {
    if (!agentId || !canExecute || !online) return;
    setQueuing(true);
    try {
      await axios.post(
        `${API}/nexus-agent/agents/${agentId}/command`,
        { kind: "winget_upgrade", payload, include_offline: false },
        { headers, timeout: 20000 },
      );
      const ids = payload.all ? packages.map(item => item.id) : payload.ids;
      setQueued(ids);
      toast.success(`Update command queued for ${deviceName}`, {
        description: `${description} The endpoint reports the result of each upgrade back to Nexus, so the pending list only clears on real evidence.`,
      });
    } catch (error) {
      toast.error(error?.response?.data?.detail || `Nexus could not queue the application update for ${deviceName}. Nothing has been changed.`);
    } finally {
      setQueuing(false);
    }
  };

  const queuedSet = new Set(queued);

  return (
    <Dialog open={Boolean(open)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" data-testid="app-updates-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4 text-cyan-300" />
            Application updates · {deviceName}
          </DialogTitle>
          <DialogDescription>
            Pending application upgrades the enrolled Nexus Agent observed through Windows Package Manager (winget).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-200 text-[10px]">
              {state.status === "ready" ? `${state.count} pending` : "Pending count unavailable"}
            </Badge>
            {state.status === "ready" && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock3 className="h-3 w-3" />Last scanned {observedLabel(state.observedAt)}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto h-7 text-[10px]"
              onClick={load}
              disabled={state.status === "loading"}
              data-testid="app-updates-refresh"
            >
              {state.status === "loading" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
              Rescan evidence
            </Button>
          </div>

          {staleEvidence && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5" role="status" data-testid="app-updates-stale">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
              <p className="text-[11px] leading-5 text-amber-100">
                This scan is {observedLabel(state.observedAt)}. The endpoint may have installed updates since, so the list below is the last reported evidence rather than a live reading.
              </p>
            </div>
          )}

          {queued.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2.5" role="status" data-testid="app-updates-queued">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
              <p className="text-[11px] leading-5 text-emerald-100">
                Upgrade queued for {queued.length} package{queued.length === 1 ? "" : "s"}. Nexus will treat these as installed only when the endpoint's next scan no longer reports them.
              </p>
            </div>
          )}

          {blockedReason && (
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5" role="status" data-testid="app-updates-blocked">
              <p className="flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />{blockedReason}
              </p>
            </div>
          )}

          {state.status === "loading" && packages.length === 0 ? (
            <div className="flex min-h-32 items-center justify-center gap-2 rounded-xl border border-border/70 bg-muted/[0.12] text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />Reading the endpoint's last reported scan…
            </div>
          ) : state.status === "unreported" ? (
            <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/[0.12] px-5 py-7 text-center" data-testid="app-updates-unreported">
              <Clock3 className="h-5 w-5 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium text-foreground">No application scan recorded yet</p>
              <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                This agent has not reported pending application updates. It scans on its heartbeat once Windows Package Manager is available on the endpoint, so the first reading appears after its next check-in.
              </p>
            </div>
          ) : state.status === "forbidden" ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.045] px-4 py-4" role="alert" data-testid="app-updates-forbidden">
              <p className="text-sm font-medium text-foreground">Not permitted for this device</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Your account cannot read this endpoint's application evidence. Nothing has been changed.</p>
            </div>
          ) : state.status === "error" ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.045] px-4 py-4" role="alert" data-testid="app-updates-error">
              <p className="text-sm font-medium text-foreground">Pending updates could not be loaded</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{state.message || "Nothing has been changed. Retry when Nexus can reach the agent evidence service."}</p>
              <Button type="button" size="sm" variant="outline" className="mt-3" onClick={load}>
                <RefreshCw className="h-3.5 w-3.5" />Retry
              </Button>
            </div>
          ) : packages.length === 0 ? (
            <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/[0.12] px-5 py-7 text-center" data-testid="app-updates-empty">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <p className="mt-2 text-sm font-medium text-foreground">No pending application updates reported</p>
              <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">The last scan found every observed package current. Nexus refreshes this from the endpoint's next check-in.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/70">
              <div className="flex items-center gap-2 border-b border-border/60 bg-muted/20 px-3 py-2">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? [] : packages.map(item => item.id))}
                  disabled={!canExecute || !online}
                  aria-label="Select every pending application update"
                  data-testid="app-updates-select-all"
                />
                <span className="text-[11px] font-medium text-muted-foreground">
                  {selected.length === 0 ? "Select the applications to update" : `${selected.length} of ${packages.length} selected`}
                </span>
              </div>
              <div className="max-h-[320px] overflow-y-auto" data-testid="app-updates-list">
                {packages.map(item => {
                  const checked = selected.includes(item.id);
                  const alreadyQueued = queuedSet.has(item.id);
                  return (
                    <label
                      key={item.id}
                      className={`flex cursor-pointer items-start gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0 ${checked ? "bg-cyan-500/[0.05]" : "hover:bg-muted/20"}`}
                      data-testid={`app-update-row-${item.id}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 rounded"
                        checked={checked}
                        onChange={() => togglePackage(item.id)}
                        disabled={!canExecute || !online}
                        aria-label={`Select ${item.name || item.id}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{item.name || item.id}</span>
                          {alreadyQueued && <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-[9px] uppercase tracking-wider">Queued</Badge>}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span className="font-mono">{item.current || "unknown"}</span>
                          <span aria-hidden="true">→</span>
                          <span className="font-mono text-foreground">{item.available || "unknown"}</span>
                          <span className="truncate font-mono text-[10px] text-muted-foreground/80">{item.id}</span>
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Close</Button>
          <Button
            variant="outline"
            onClick={() => queue({ ids: selected }, `Queued an upgrade for ${selected.length} selected package${selected.length === 1 ? "" : "s"}.`)}
            disabled={!canExecute || !online || queuing || selected.length === 0}
            data-testid="app-updates-apply-selected"
          >
            {queuing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
            Update selected{selected.length ? ` (${selected.length})` : ""}
          </Button>
          <Button
            onClick={() => queue({ all: true }, `Queued an upgrade for every pending package (${packages.length}).`)}
            disabled={!canExecute || !online || queuing || packages.length === 0}
            data-testid="app-updates-apply-all"
          >
            {queuing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
            Update all pending
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
