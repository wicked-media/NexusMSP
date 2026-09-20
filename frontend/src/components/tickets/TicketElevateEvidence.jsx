import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const STATUS_TONE = {
  pending: "border-amber-500/30 bg-amber-500/[0.10] text-amber-200",
  approved: "border-cyan-500/30 bg-cyan-500/[0.10] text-cyan-200",
  executed: "border-emerald-500/30 bg-emerald-500/[0.10] text-emerald-200",
  failed: "border-rose-500/30 bg-rose-500/[0.10] text-rose-200",
  expired: "border-amber-500/30 bg-amber-500/[0.10] text-amber-200",
  denied: "border-rose-500/30 bg-rose-500/[0.10] text-rose-200",
  cancelled: "border-zinc-500/30 bg-zinc-500/[0.10] text-zinc-300",
  revoked: "border-zinc-500/30 bg-zinc-500/[0.10] text-zinc-300",
};

export default function TicketElevateEvidence({ ticket, headers }) {
  const navigate = useNavigate();
  const [data, setData] = useState({ requests: [], linked_agents: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!ticket?.id) return;
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(`${API}/tickets/${ticket.id}/nexus-elevate`, { headers });
      setData(response.data || { requests: [], linked_agents: [] });
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Elevation evidence is unavailable");
    } finally {
      setLoading(false);
    }
  }, [headers, ticket?.id]);
  useEffect(() => { load(); }, [load]);

  const openElevate = (requestId = "", agentId = "") => {
    const params = new URLSearchParams({ ticket: ticket.id });
    if (requestId) params.set("request", requestId);
    if (agentId) params.set("device", agentId);
    navigate(`/nexus-elevate?${params.toString()}`);
  };
  const attention = data.requests.filter((request) => ["pending", "approved", "failed", "expired"].includes(request.status));

  return <Card className="overflow-hidden border-cyan-400/18 bg-[linear-gradient(120deg,rgba(14,165,233,0.075),rgba(15,23,42,0.02)_48%,rgba(16,185,129,0.045))]" data-testid="ticket-elevate-evidence">
    <CardContent className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-cyan-400/25 bg-cyan-400/[0.10] text-cyan-200"><ShieldCheck className="h-4 w-4" /></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">Privileged work evidence</p><p className="mt-0.5 text-sm font-semibold text-zinc-100">Nexus Elevate</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Approval and execution stay in Elevate; this ticket holds the service context and handover evidence.</p></div></div>
        <div className="flex shrink-0 gap-2"><Button variant="outline" size="sm" className="h-8 border-cyan-400/25 bg-cyan-400/[0.04] text-xs text-cyan-100" onClick={load} disabled={loading}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button><Button size="sm" className="h-8 text-xs" onClick={() => openElevate("", data.linked_agents[0]?.id)}><ArrowUpRight className="mr-1.5 h-3.5 w-3.5" />Open Elevate</Button></div>
      </div>
      {loading ? <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading governed privilege evidence…</div> : error ? <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/[0.05] p-3 text-xs text-rose-200">{error}</div> : <>
        <div className="mt-4 flex flex-wrap gap-2">{data.linked_agents.length ? data.linked_agents.map((agent) => <Badge key={agent.id} variant="outline" className={agent.elevate_state === "active" ? "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-200" : "border-zinc-500/25 text-zinc-400"}>{agent.hostname} · {agent.elevate_state === "active" ? "Elevate ready" : "Companion not ready"}</Badge>) : <Badge variant="outline" className="border-zinc-500/25 text-zinc-400">No enrolled Elevate endpoint linked</Badge>}</div>
        {attention.length > 0 && <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-3 text-xs text-amber-100"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" /><span>{attention.length} elevation item{attention.length === 1 ? "" : "s"} needs attention or handover. Ticket subscribers receive alerts when an approval window starts, expires, or execution fails.</span></div>}
        <div className="mt-4 space-y-2">{data.requests.slice(0, 4).map((request) => <button type="button" key={request.id} onClick={() => openElevate(request.id, request.device_id)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-black/[0.10] px-3 py-2.5 text-left transition-colors hover:border-cyan-400/25 hover:bg-cyan-400/[0.045]"><span className="min-w-0"><span className="block truncate text-xs font-medium text-zinc-100">{request.program_name || "Elevation request"}</span><span className="mt-0.5 block truncate text-[11px] text-zinc-500">{request.hostname || "Managed endpoint"} · {request.requested_at ? formatDistanceToNow(new Date(request.requested_at), { addSuffix: true }) : "time not recorded"}</span></span><Badge variant="outline" className={`shrink-0 text-[10px] ${STATUS_TONE[request.status] || "border-zinc-500/25 text-zinc-300"}`}>{String(request.status || "unknown").replace(/_/g, " ")}</Badge></button>)}{!data.requests.length && <p className="rounded-lg border border-dashed border-white/[0.09] px-3 py-4 text-xs text-muted-foreground">No Elevate requests are linked yet. Start from the endpoint companion so Nexus can validate the exact executable path and SHA-256 before it enters the approval queue.</p>}</div>
      </>}
    </CardContent>
  </Card>;
}
