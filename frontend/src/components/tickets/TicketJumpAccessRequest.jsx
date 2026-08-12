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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  KeyRound,
  Loader2,
  Network,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";

export default function TicketJumpAccessRequest({ ticket, headers }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState("");
  const [edges, setEdges] = useState([]);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({
    deployment_id: "",
    target_host: "",
    target_port: "443",
    protocol: "https",
    duration_minutes: "30",
    reason: "",
  });
  const eligible = useMemo(
    () => edges.filter((edge) => edge.activation_used_at),
    [edges],
  );

  const load = async () => {
    if (!ticket?.id) return;
    setLoading(true);
    try {
      const [edgeResponse, requestResponse] = await Promise.all([
        axios.get(`${API}/deployment-hub/jump-edges/${ticket.id}`, { headers }),
        axios.get(`${API}/deployment-hub/jump-access-requests/${ticket.id}`, {
          headers,
        }),
      ]);
      const records = edgeResponse.data?.edges || [];
      setEdges(records);
      setRequests(requestResponse.data?.requests || []);
      const first = records.find((edge) => edge.activation_used_at);
      if (first)
        setForm((current) => ({
          ...current,
          deployment_id: current.deployment_id || first.id,
        }));
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Nexus Jump access could not be loaded",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [ticket?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!form.deployment_id || !form.target_host.trim() || !form.reason.trim())
      return toast.error("Choose an Edge, target and business reason");
    setSubmitting(true);
    try {
      await axios.post(
        `${API}/deployment-hub/jump-access-requests`,
        {
          ...form,
          ticket_id: ticket.id,
          target_port: Number(form.target_port),
          duration_minutes: Number(form.duration_minutes),
        },
        { headers },
      );
      toast.success("Nexus Jump access scope recorded");
      setOpen(false);
      setForm((current) => ({ ...current, target_host: "", reason: "" }));
      await load();
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Could not record Nexus Jump scope",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async (request) => {
    setRevokingId(request.id);
    try {
      const response = await axios.post(
        `${API}/deployment-hub/jump-access-requests/${request.id}/revoke`,
        {},
        { headers },
      );
      toast.success(response.data?.message || "Nexus Jump scope revoked");
      await load();
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Could not revoke Nexus Jump scope",
      );
    } finally {
      setRevokingId("");
    }
  };

  if (!ticket?.client_id) return null;
  return (
    <>
      <Card
        className="border-violet-500/20 bg-[linear-gradient(135deg,rgba(109,40,217,0.10),rgba(15,23,42,0.32))]"
        data-testid="ticket-jump-access"
      >
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-violet-500/25 bg-violet-500/10">
              <KeyRound className="h-4 w-4 text-violet-500" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-700 dark:text-violet-300">
                Nexus Jump
              </p>
              <p className="mt-1 text-sm font-semibold">
                Plan a ticket-bound local-resource access session.
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Access is scoped to one protocol, host and port. No VPN, tunnel
                or credential is created until the reviewed transport controller
                is live.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
            disabled={loading || !eligible.length}
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
            )}
            Request scope
          </Button>
        </CardContent>
        {!loading && !eligible.length && (
          <CardContent className="border-t border-violet-500/15 pt-3 text-xs text-muted-foreground">
            No activated customer Edge with the Nexus Jump Gateway role is
            available. Prepare the role in Deployment Hub first.
          </CardContent>
        )}
        {requests.slice(0, 3).map((request) => (
          <CardContent
            key={request.id}
            className="border-t border-border/60 py-3"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono font-medium">
                {request.protocol}://{request.target_host}:{request.target_port}
              </span>
              <Badge
                variant="outline"
                className={
                  request.status === "awaiting_transport"
                    ? "border-amber-500/25 bg-amber-500/[0.06] text-[9px] text-amber-700 dark:text-amber-200"
                    : request.status === "revoked"
                      ? "border-rose-500/25 bg-rose-500/[0.06] text-[9px] text-rose-700 dark:text-rose-200"
                      : "text-[9px] text-muted-foreground"
                }
              >
                {request.status?.replaceAll("_", " ")}
              </Badge>
              <span className="text-muted-foreground">
                {request.duration_minutes} min
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {request.requested_at}
              </span>
              {request.status === "awaiting_transport" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[10px] text-rose-700 hover:text-rose-600 dark:text-rose-200"
                  onClick={() => revoke(request)}
                  disabled={revokingId === request.id}
                >
                  {revokingId === request.id ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <XCircle className="mr-1 h-3 w-3" />
                  )}
                  Revoke
                </Button>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {request.reason}
            </p>
          </CardContent>
        ))}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <NexusWorkflowDialog
          eyebrow="Privileged local access"
          title="Request Nexus Jump scope"
          description="Create an auditable, time-bound scope for a future Nexus Jump session. Nexus will not expose the customer network or issue access while the transport controller is unavailable."
          icon={Network}
          tone="violet"
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={submitting || !eligible.length}
              >
                {submitting ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-1.5 h-4 w-4" />
                )}
                Record access scope
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>Nexus Jump Edge</Label>
              <Select
                value={form.deployment_id}
                onValueChange={(deployment_id) =>
                  setForm((current) => ({ ...current, deployment_id }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose customer Edge" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((edge) => (
                    <SelectItem key={edge.id} value={edge.id}>
                      {edge.name}
                      {edge.hostname ? ` · ${edge.hostname}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-[9rem_1fr_6rem]">
              <div className="grid gap-2">
                <Label>Protocol</Label>
                <Select
                  value={form.protocol}
                  onValueChange={(protocol) =>
                    setForm((current) => ({ ...current, protocol }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["https", "ssh", "rdp", "vnc", "winrm", "ipmi"].map(
                      (protocol) => (
                        <SelectItem key={protocol} value={protocol}>
                          {protocol.toUpperCase()}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Hostname or IP</Label>
                <Input
                  value={form.target_host}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      target_host: event.target.value,
                    }))
                  }
                  placeholder="e.g. nas01.internal.example"
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label>Port</Label>
                <Input
                  type="number"
                  min="1"
                  max="65535"
                  value={form.target_port}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      target_port: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Maximum duration</Label>
              <Select
                value={form.duration_minutes}
                onValueChange={(duration_minutes) =>
                  setForm((current) => ({ ...current, duration_minutes }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[15, 30, 60, 120, 240].map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {minutes} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Business reason</Label>
              <Textarea
                rows={3}
                value={form.reason}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                placeholder="Explain the ticket work requiring this specific resource."
              />
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.045] p-3 text-xs leading-5 text-muted-foreground">
              <ShieldAlert className="mr-1 inline h-3.5 w-3.5 text-amber-500" />
              This records policy intent only. It will remain{" "}
              <strong>awaiting transport</strong> until Nexus Jump can enforce
              the scope and automatic expiry at the Edge boundary.
            </div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>
    </>
  );
}
