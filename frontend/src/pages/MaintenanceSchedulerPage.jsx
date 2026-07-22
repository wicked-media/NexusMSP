import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricStrip, MetricTile, EmptyState } from "@/components/design-system";
import { CalendarClock, CheckCircle2, Clock3, ExternalLink, History, Loader2, MonitorCog, RefreshCw, ShieldCheck, Wrench, XCircle } from "lucide-react";
import { toast } from "sonner";

const ACTION_LABELS = {
  "install-patches": "Windows Update",
  "install-winget": "Approved apps",
  "run-checks": "Health checks",
  "run-script": "Run script",
  reboot: "Reboot",
};

const STATUS_STYLES = {
  scheduled: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  dispatching: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  running: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  awaiting_results: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  failed: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  cancelled: "border-border bg-muted text-muted-foreground",
};

function formatWhen(value) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid schedule" : date.toLocaleString();
}

function resultSummary(window) {
  const counts = window.summary_counts || {};
  const values = [
    counts.ok ? `${counts.ok} successful` : null,
    counts.failed ? `${counts.failed} failed` : null,
    counts.queued ? `${counts.queued} awaiting agent` : null,
    counts.skipped ? `${counts.skipped} skipped` : null,
  ].filter(Boolean);
  return values.length ? values.join(" · ") : "Awaiting dispatch";
}

export default function MaintenanceSchedulerPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [windows, setWindows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const response = await axios.get(`${API}/maintenance-windows`, { headers });
      setWindows(response.data || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not load maintenance windows");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => windows.reduce((acc, window) => {
    acc[window.status] = (acc[window.status] || 0) + 1;
    return acc;
  }, {}), [windows]);
  const active = windows.filter((window) => ["scheduled", "dispatching", "running", "awaiting_results"].includes(window.status));
  const recent = windows.filter((window) => ["completed", "failed", "cancelled"].includes(window.status)).slice(0, 8);

  return (
    <div className="space-y-6" data-testid="maintenance-scheduler-page">
      <OperationalPageHeader
        eyebrow="Managed assets"
        title="Maintenance"
        description="Schedule approved work from selected Nexus Agent assets. Commands, results, cancellations, and linked ticket updates remain auditable end to end."
        icon={Wrench}
        tone="amber"
        actions={<>
          <Button variant="outline" onClick={() => load({ silent: true })} disabled={refreshing} data-testid="maintenance-refresh">
            <RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button onClick={() => navigate("/devices?tab=directory&maintenance=1")} data-testid="maintenance-open-assets">
            <CalendarClock className="mr-1.5 h-4 w-4" />Schedule from assets
          </Button>
        </>}
      />

      <MetricStrip columns={4}>
        <MetricTile label="Scheduled" value={counts.scheduled || 0} accent="sky" icon={<CalendarClock className="h-3 w-3 text-sky-400" />} testid="maintenance-metric-scheduled" />
        <MetricTile label="In progress" value={(counts.dispatching || 0) + (counts.running || 0)} accent="amber" icon={<Clock3 className="h-3 w-3 text-amber-400" />} testid="maintenance-metric-running" />
        <MetricTile label="Awaiting results" value={counts.awaiting_results || 0} accent="violet" icon={<MonitorCog className="h-3 w-3 text-violet-400" />} testid="maintenance-metric-awaiting" />
        <MetricTile label="Completed" value={counts.completed || 0} accent="emerald" icon={<CheckCircle2 className="h-3 w-3 text-emerald-400" />} testid="maintenance-metric-completed" />
      </MetricStrip>

      <Card className="border-amber-500/20" data-testid="maintenance-active-windows">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="h-4 w-4 text-amber-300" />Active maintenance windows</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Only enrolled, online Nexus Agent assets are dispatched. A window stays open until the endpoint returns every command result.</p>
          </div>
          <Badge variant="outline" className="shrink-0">{active.length} active</Badge>
        </CardHeader>
        <CardContent>
          {loading ? <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : active.length === 0 ? (
            <EmptyState icon={<CalendarClock className="h-8 w-8" />} title="No active maintenance windows" description="Select one or more enrolled assets to create a real, agent-backed maintenance window." action={<Button size="sm" onClick={() => navigate("/devices?tab=directory&maintenance=1")}>Select managed assets</Button>} />
          ) : (
            <div className="space-y-2">
              {active.map((window) => <WindowRow key={window.id} window={window} navigate={navigate} />)}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="maintenance-recent-history">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><History className="h-4 w-4 text-muted-foreground" />Recent maintenance history</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Completed and cancelled windows will appear here. NexusMSP does not manufacture maintenance history.</p>
          ) : <div className="space-y-2">{recent.map((window) => <WindowRow key={window.id} window={window} navigate={navigate} />)}</div>}
        </CardContent>
      </Card>
    </div>
  );
}

function WindowRow({ window, navigate }) {
  const status = window.status || "scheduled";
  const ticketLink = window.parent_ticket_id ? `/tickets?ticket=${encodeURIComponent(window.parent_ticket_id)}` : null;
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card/50 p-3.5 lg:flex-row lg:items-center lg:justify-between" data-testid={`maintenance-window-${window.id}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold">{window.name}</p>
          <Badge variant="outline" className={`capitalize ${STATUS_STYLES[status] || STATUS_STYLES.scheduled}`}>{status.replaceAll("_", " ")}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{formatWhen(window.scheduled_at)} · {(window.device_ids || []).length} assets · {(window.actions || []).map((action) => ACTION_LABELS[action] || action).join(", ")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{resultSummary(window)}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {ticketLink && <Button size="sm" variant="outline" onClick={() => navigate(ticketLink)}><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Ticket</Button>}
        <Button size="sm" variant="outline" onClick={() => navigate(`/devices?maintenanceWindow=${encodeURIComponent(window.id)}`)}>View assets</Button>
        {status === "failed" && <XCircle className="h-4 w-4 text-rose-400" aria-label="Maintenance failed" />}
      </div>
    </article>
  );
}
