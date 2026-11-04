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

const CLOSED = new Set(["closed", "resolved", "remediated", "dismissed"]);
const SEVERITY = { critical: "border-rose-500/30 bg-rose-500/10 text-rose-500", high: "border-amber-500/30 bg-amber-500/10 text-amber-600", medium: "border-yellow-500/30 bg-yellow-500/10 text-yellow-700" };

function row(alert) {
  const severity = String(alert.severity || "not_reported").toLowerCase();
  return {
    key: alert.id,
    label: <div className="flex flex-wrap items-center gap-2"><span><Observed value={alert.title || alert.name || alert.id} what="alert title" /></span><Badge variant="outline" className={SEVERITY[severity] || "border-border/70 text-muted-foreground"}>{severity.replaceAll("_", " ")}</Badge></div>,
    meta: [
      <Observed key="client" value={alert.client_name || alert.client_id} what="client" />,
      <Observed key="device" value={alert.hostname || alert.device_name || alert.device_id} what="endpoint" />,
      <Observed key="source" value={alert.source} what="detection source" />,
      <Observed key="ticket" value={alert.ticket_number} what="linked ticket" />,
    ],
    status: alert.status,
    dotClass: severity === "critical" ? "bg-rose-500" : severity === "high" ? "bg-amber-500" : "bg-yellow-500",
    observedAt: alert.updated_at || alert.created_at,
  };
}

/** A read-only SOC queue; lifecycle controls remain in the dedicated SOC workspace. */
export default function SocAlertsPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);
  if (unresolved) return <ObservationUnbound spec={spec} />;
  const alerts = Array.isArray(data) ? data : [];
  const open = alerts.filter((alert) => !CLOSED.has(String(alert.status || "").toLowerCase()));
  const critical = open.filter((alert) => String(alert.severity).toLowerCase() === "critical").length;

  return <div className="space-y-4" data-testid="studio-soc-alerts"><ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />
    {loading && <ObservationLoading label="Reading scoped SOC alert evidence…" />}
    {!loading && error && <ObservationError error={error} onRetry={reload} />}
    {!loading && !error && <>
      <ObservedTotals totals={[
        { label: "Recorded alerts", value: alerts.length, detail: "Only source records retained in the caller's scope." },
        { label: "Open cases", value: open.length, detail: "Open and investigating records, not an estimate of all threats." },
        { label: "Critical open", value: critical, detail: "Requires technician review; it does not trigger containment from this view." },
      ]} />
      {alerts.length ? <ObservedRows label="Recorded security cases" rows={alerts.map(row)} /> : <ObservedEmpty title="No SOC alert evidence is in scope" note="This means no retained alert record matched the caller's scope; it is not a claim that the estate has no threats or that every connected provider is reporting." />}
      <div className="flex flex-wrap gap-2"><Button asChild size="sm"><a href="/security-dashboard">Open Security Operations <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></a></Button></div>
      <ObservationNote><ShieldAlert className="mr-1 inline h-3.5 w-3.5" />Acknowledgement, ticketing, remediation evidence and closure remain in the Security Operations workspace, where Nexus enforces permission, client scope and the required audit record. This Studio tab does not perform containment.</ObservationNote>
    </>}
  </div>;
}
