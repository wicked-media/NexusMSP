import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Activity, Clock3, Globe2, Loader2, Network, ShieldCheck } from "lucide-react";

const stateTone = {
  healthy: "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-200",
  attention: "border-rose-500/25 bg-rose-500/[0.08] text-rose-700 dark:text-rose-200",
  not_run: "border-border/70 text-muted-foreground",
};

function CheckEvidence({ check }) {
  const result = check.result;
  if (!result) return <p className="mt-2 text-xs text-muted-foreground">{check.status === "expired" ? "Expired before an Edge result was received." : "Awaiting the next authenticated Edge heartbeat."}</p>;
  return <div className="mt-2 flex flex-wrap gap-1.5">{[["DNS", result.dns], ["TCP", result.tcp], ["TLS", result.tls]].map(([label, status]) => <Badge key={label} variant="outline" className={`text-[9px] ${stateTone[status] || stateTone.not_run}`}>{label} · {status?.replace("_", " ")}</Badge>)}{result.latency_ms != null && <Badge variant="outline" className="text-[9px]">{result.latency_ms} ms</Badge>}</div>;
}

export default function TicketConnectivityVerification({ ticket, headers }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [edges, setEdges] = useState([]);
  const [checks, setChecks] = useState([]);
  const [form, setForm] = useState({ deployment_id: "", target_host: "", target_port: "443", require_tls: true });
  const eligible = useMemo(() => edges.filter((edge) => edge.kind === "edge" && edge.client_id === ticket?.client_id && edge.activation_used_at && (edge.edge_roles || []).includes("network_monitor")), [edges, ticket?.client_id]);

  const load = async () => {
    if (!ticket?.id) return;
    setLoading(true);
    try {
      const [edgeResponse, result] = await Promise.all([
        axios.get(`${API}/deployment-hub/connectivity-edges/${ticket.id}`, { headers }),
        axios.get(`${API}/deployment-hub/connectivity-checks/${ticket.id}`, { headers }),
      ]);
      const deployments = edgeResponse.data?.edges || [];
      setEdges(deployments);
      setChecks(result.data?.checks || []);
      const first = deployments.find((edge) => edge.kind === "edge" && edge.client_id === ticket.client_id && edge.activation_used_at && (edge.edge_roles || []).includes("network_monitor"));
      if (first) setForm((current) => ({ ...current, deployment_id: current.deployment_id || first.id }));
    } catch (error) {
      toast.error(error.response?.data?.detail || "Connectivity verification could not be loaded");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [ticket?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!form.deployment_id || !form.target_host.trim()) return toast.error("Choose an eligible Edge and enter a host");
    setSubmitting(true);
    try {
      await axios.post(`${API}/deployment-hub/connectivity-checks`, { ...form, ticket_id: ticket.id, target_port: Number(form.target_port) }, { headers });
      toast.success("Connectivity verification queued for the customer Edge");
      setOpen(false);
      setForm((current) => ({ ...current, target_host: "" }));
      await load();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not queue connectivity verification"); }
    finally { setSubmitting(false); }
  };

  if (!ticket?.client_id) return null;
  return <>
    <Card className="border-sky-500/20 bg-[linear-gradient(135deg,rgba(14,116,144,0.10),rgba(15,23,42,0.32))]" data-testid="ticket-connectivity-verification">
      <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center"><div className="flex min-w-0 flex-1 items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-sky-500/25 bg-sky-500/10"><Network className="h-4 w-4 text-sky-500" /></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">Nexus Edge verification</p><p className="mt-1 text-sm font-semibold">Verify a specific connection from this customer site.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Ticket-bound DNS, TCP and optional TLS evidence. This does not grant network access or create a tunnel.</p></div></div><Button size="sm" onClick={() => setOpen(true)} disabled={loading || !eligible.length}>{loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Activity className="mr-1.5 h-3.5 w-3.5" />}Verify connectivity</Button></CardContent>
      {!loading && !eligible.length && <CardContent className="border-t border-sky-500/15 pt-3 text-xs text-muted-foreground">No active customer Edge with the Network Monitor role is available yet. Prepare and activate one in Deployment Hub before using this ticket workflow.</CardContent>}
      {checks.slice(0, 3).map((check) => <CardContent key={check.id} className="border-t border-border/60 py-3"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-mono font-medium">{check.target_host}:{check.target_port}</span><Badge variant="outline" className="text-[9px] uppercase">{check.status}</Badge>{check.require_tls && <Badge variant="outline" className="text-[9px]">TLS required</Badge>}<span className="ml-auto text-[10px] text-muted-foreground">{check.completed_at || check.requested_at}</span></div><CheckEvidence check={check} /></CardContent>)}
    </Card>

    <Dialog open={open} onOpenChange={setOpen}><NexusWorkflowDialog eyebrow="Ticket diagnostics" title="Verify connectivity from Nexus Edge" description="Queue one short-lived probe against this ticket's customer Edge. Nexus checks only the requested hostname and port, records the evidence, and grants no remote network access." icon={Globe2} tone="sky" footer={<><Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button><Button onClick={submit} disabled={submitting || !eligible.length}>{submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}Queue verification</Button></>}><div className="space-y-4"><div className="grid gap-2"><Label>Customer Edge</Label><Select value={form.deployment_id} onValueChange={(deployment_id) => setForm((current) => ({ ...current, deployment_id }))}><SelectTrigger><SelectValue placeholder="Choose active customer Edge" /></SelectTrigger><SelectContent>{eligible.map((edge) => <SelectItem key={edge.id} value={edge.id}>{edge.name}{edge.hostname ? ` · ${edge.hostname}` : ""}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-3 sm:grid-cols-[1fr_8rem]"><div className="grid gap-2"><Label>Hostname or IP address</Label><Input value={form.target_host} onChange={(event) => setForm((current) => ({ ...current, target_host: event.target.value }))} placeholder="e.g. sql01.internal.example" autoFocus /></div><div className="grid gap-2"><Label>Port</Label><Input type="number" min="1" max="65535" value={form.target_port} onChange={(event) => setForm((current) => ({ ...current, target_port: event.target.value }))} /></div></div><div className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/[0.16] p-3"><div><p className="text-sm font-medium">Require TLS handshake</p><p className="mt-1 text-xs text-muted-foreground">Use for HTTPS or other TLS services. Certificate verification remains enabled.</p></div><Switch checked={form.require_tls} onCheckedChange={(require_tls) => setForm((current) => ({ ...current, require_tls }))} /></div><div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.045] p-3 text-xs leading-5 text-muted-foreground"><Clock3 className="mr-1 inline h-3.5 w-3.5 text-amber-500" />The request expires after 15 minutes. It is delivered on the Edge's next authenticated heartbeat and is retained locally until Nexus confirms receipt.</div></div></NexusWorkflowDialog></Dialog>
  </>;
}
