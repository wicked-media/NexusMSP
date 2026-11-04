import { ArrowUpRight, Server, ShieldCheck } from "lucide-react";
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

const HEALTH_STYLE = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  unconfigured: "border-amber-500/30 bg-amber-500/10 text-amber-600",
};

function guestRow(guest) {
  const state = String(guest.status || "not_reported").toLowerCase();
  return {
    key: guest.id || guest.vmid,
    label: <Observed value={guest.name || guest.vmid} what="guest name" />,
    meta: [
      <Observed key="type" value={guest.type} what="guest type" />,
      <Observed key="node" value={guest.node_name || guest.node} what="host node" />,
      <Observed key="client" value={guest.client_name || guest.client_id} what="client" />,
      <Observed key="ip" value={guest.ip_address} what="guest address" />,
    ],
    status: state,
    dotClass: state === "running" ? "bg-emerald-500" : state === "stopped" ? "bg-slate-400" : "bg-amber-500",
    observedAt: guest.observed_at,
  };
}

/**
 * Proxmox Studio is an evidence surface over the existing operating workspace.
 * It never creates a second action path: technicians open the guest workspace
 * for descriptor, approval, provider-task verification and action history.
 */
export default function ProxmoxOperationsPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);
  if (unresolved) return <ObservationUnbound spec={spec} />;

  const isConnection = endpoint === "/proxmox/connection";
  const connections = Array.isArray(data?.connections) ? data.connections : [];
  const guests = Array.isArray(data) ? data : [];
  const running = guests.filter((guest) => String(guest.status).toLowerCase() === "running").length;

  return (
    <div className="space-y-4" data-testid="studio-proxmox-operations">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />
      {loading && <ObservationLoading label="Reading scoped Proxmox evidence…" />}
      {!loading && error && <ObservationError error={error} onRetry={reload} />}
      {!loading && !error && isConnection && (
        <>
          <ObservedTotals totals={[
            { label: "Configured connections", value: connections.filter((connection) => connection.configured).length, detail: "Credentials remain server-side and are never returned to this Studio." },
            { label: "Connection mode", value: data?.mode, detail: "Unconfigured connections fail closed; this is not a provider execution claim." },
            { label: "Inventory reconciliation", value: data?.reconciliation?.enabled ? "Enabled" : "Not reported", detail: data?.reconciliation?.interval_minutes ? `Recorded cadence: ${data.reconciliation.interval_minutes} minutes.` : "Cadence was not reported." },
          ]} />
          {connections.length ? <div className="grid gap-3 lg:grid-cols-2" data-testid="studio-proxmox-connections">{connections.map((connection) => (
            <section key={connection.server_id || connection.name} className="rounded-xl border border-border/70 bg-card p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold"><Observed value={connection.name || connection.server_id} what="connection name" /></p><p className="mt-1 text-xs text-muted-foreground">Client <Observed value={connection.client_id} what="scope" /></p></div><Badge variant="outline" className={HEALTH_STYLE[connection.health] || "border-border/70 text-muted-foreground"}>{String(connection.health || "not reported").replaceAll("_", " ")}</Badge></div>
              <p className="mt-3 text-xs text-muted-foreground">Provider version: <Observed value={connection.provider_version} what="provider version" /></p>
              {connection.error && <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-2 text-xs text-amber-700 dark:text-amber-200">{connection.error}</p>}
            </section>
          ))}</div> : <ObservedEmpty title="No Proxmox connection is in scope" note="Nexus cannot observe a cluster or offer provider actions until an authorised connection is configured." />}
        </>
      )}
      {!loading && !error && !isConnection && (
        <>
          <ObservedTotals totals={[
            { label: "Observed guests", value: guests.length, detail: "Provider-bound inventory, not a second virtual-machine registry." },
            { label: "Running", value: running, detail: "State from the most recent provider observation." },
            { label: "Not running", value: guests.length - running, detail: "Review the guest record before treating this as an incident." },
          ]} />
          {guests.length ? <ObservedRows label="Scoped Proxmox guests" rows={guests.map(guestRow)} /> : <ObservedEmpty title="No Proxmox guests are recorded in this scope" note="This can mean that no authorised connection has reported inventory yet; it is not a claim that the client has no virtual estate." />}
        </>
      )}
      {!loading && !error && <>
        <div className="flex flex-wrap gap-2"><Button asChild size="sm"><a href="/proxmox">Open Proxmox operations <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></a></Button></div>
        <div className="flex items-start gap-2 rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-3 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" /><p>Guest power operations remain in the Proxmox workspace, where Nexus validates the action descriptor, permission, client scope, approval requirement and provider task outcome.</p></div>
        <ObservationNote><Server className="mr-1 inline h-3.5 w-3.5" />{spec?.summary}</ObservationNote>
      </>}
    </div>
  );
}
