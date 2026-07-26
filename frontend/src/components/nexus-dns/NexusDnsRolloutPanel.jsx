import { useState } from "react";
import axios from "axios";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  History,
  Laptop2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TimerOff,
  WifiOff,
} from "lucide-react";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const tones = {
  acknowledged: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  rollback_acknowledged: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  partial: "border-sky-500/25 bg-sky-500/10 text-sky-300",
  pending: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  offline: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  rollback_queued: "border-violet-500/25 bg-violet-500/10 text-violet-300",
  superseded: "border-white/10 bg-white/[0.04] text-muted-foreground",
  missing: "border-rose-500/25 bg-rose-500/10 text-rose-300",
  active: "border-sky-500/25 bg-sky-500/10 text-sky-300",
  expired: "border-white/10 bg-white/[0.04] text-muted-foreground",
};

function formatDate(value) {
  if (!value) return "Not yet";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function label(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

function EvidenceTile({ icon: Icon, label: title, value, detail, tone = "sky" }) {
  const iconTone = {
    sky: "border-sky-400/20 bg-sky-400/10 text-sky-300",
    emerald: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    amber: "border-amber-400/20 bg-amber-400/10 text-amber-300",
    violet: "border-violet-400/20 bg-violet-400/10 text-violet-300",
  }[tone];
  return (
    <Card className="border-white/[0.08] bg-white/[0.018]">
      <CardContent className="flex items-center gap-3 p-4">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${iconTone}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          <p className="truncate text-[11px] text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EndpointStatusIcon({ status }) {
  if (status === "acknowledged") return <CheckCircle2 className="h-4 w-4 text-emerald-300" />;
  if (status === "offline") return <WifiOff className="h-4 w-4 text-amber-300" />;
  if (status === "missing") return <AlertTriangle className="h-4 w-4 text-rose-300" />;
  return <Clock3 className="h-4 w-4 text-sky-300" />;
}

export default function NexusDnsRolloutPanel({
  rolloutData,
  exceptionData,
  headers,
  onRefresh,
  onDeploy,
}) {
  const deployments = rolloutData?.deployments || [];
  const summary = rolloutData?.summary || {};
  const exceptions = exceptionData?.exceptions || [];
  const exceptionSummary = exceptionData?.summary || {};
  const [expanded, setExpanded] = useState({});
  const [rollbackTarget, setRollbackTarget] = useState(null);
  const [rollbackReason, setRollbackReason] = useState("");
  const [saving, setSaving] = useState(false);

  const queueRollback = async () => {
    if (!rollbackTarget || rollbackReason.trim().length < 8) return;
    setSaving(true);
    try {
      const response = await axios.post(
        `${API}/nexus-dns/deployments/${rollbackTarget.id}/rollback`,
        { reason: rollbackReason.trim() },
        { headers },
      );
      toast.success(`Safe rollback queued for ${response.data.device_count} endpoint(s)`);
      setRollbackTarget(null);
      setRollbackReason("");
      await onRefresh?.(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to queue the DNS rollback");
    } finally {
      setSaving(false);
    }
  };

  return (
    <TabsContent value="rollouts" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">
            <History className="h-3.5 w-3.5" /> Deployment evidence
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Rollout control and endpoint acknowledgement</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            See what NexusMSP queued, which agents actually acknowledged it, what is still pending or offline, and every temporary exception.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => onRefresh?.()}>
            <RefreshCw className="mr-2 h-4 w-4" />Refresh evidence
          </Button>
          <Button onClick={onDeploy}>
            <ShieldCheck className="mr-2 h-4 w-4" />Stage rollout
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <EvidenceTile icon={History} label="Deployment records" value={summary.total || 0} detail="Immutable control-plane ledger" />
        <EvidenceTile icon={CheckCircle2} label="Acknowledged" value={summary.acknowledged_endpoints || 0} detail="Agent-reported evidence" tone="emerald" />
        <EvidenceTile icon={Clock3} label="Pending / offline" value={summary.pending_endpoints || 0} detail="Needs check-in or review" tone="amber" />
        <EvidenceTile icon={TimerOff} label="Active exceptions" value={exceptionSummary.active || 0} detail="Automatically expiring access" tone="violet" />
      </div>

      <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.045] p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
          <div>
            <p className="font-medium">Queued is not the same as applied</p>
            <p className="mt-1 text-sm text-muted-foreground">
              NexusMSP marks a device acknowledged only when that Nexus Agent reports the matching deployment ID. Offline endpoints stay visibly pending, and rollback completion requires the same evidence.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {deployments.map(deployment => {
          const isExpanded = Boolean(expanded[deployment.id]);
          const evidence = deployment.evidence || {};
          const canRollback = Boolean(
            deployment.rollback_available
            && deployment.endpoints?.length
            && !deployment.rollback_of
            && ["acknowledged", "partial", "pending"].includes(deployment.status),
          );
          return (
            <Card key={deployment.id} className="overflow-hidden border-white/[0.08]">
              <CardContent className="p-0">
                <div className="p-4 sm:p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/10 text-sky-300">
                      {deployment.rollback_of ? <RotateCcw className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{deployment.rollback_of ? "Safe rollback" : deployment.policy_name || "Endpoint protection rollout"}</p>
                        <Badge variant="outline" className={tones[deployment.status] || ""}>{label(deployment.status)}</Badge>
                        <Badge variant="outline">{label(deployment.mode)}</Badge>
                        <Badge variant="outline">{label(deployment.ring)} ring</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{deployment.reason || "No technician reason recorded"}</p>
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                        <span>{deployment.created_by || "Unknown technician"}</span>
                        <span>{formatDate(deployment.created_at)}</span>
                        <span className="font-mono">{deployment.id}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {deployment.endpoints?.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setExpanded(current => ({ ...current, [deployment.id]: !current[deployment.id] }))}
                        >
                          {isExpanded ? <ChevronUp className="mr-1.5 h-4 w-4" /> : <ChevronDown className="mr-1.5 h-4 w-4" />}
                          {deployment.endpoints.length} endpoints
                        </Button>
                      )}
                      {canRollback && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-violet-500/25 text-violet-200 hover:bg-violet-500/10"
                          onClick={() => {
                            setRollbackTarget(deployment);
                            setRollbackReason("");
                          }}
                        >
                          <RotateCcw className="mr-1.5 h-4 w-4" />Safe rollback
                        </Button>
                      )}
                    </div>
                  </div>

                  {deployment.endpoints?.length > 0 && (
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {[
                        ["Acknowledged", evidence.acknowledged, "text-emerald-300"],
                        ["Pending", evidence.pending, "text-sky-300"],
                        ["Offline", evidence.offline, "text-amber-300"],
                        ["Superseded", evidence.superseded, "text-muted-foreground"],
                        ["Missing", evidence.missing, "text-rose-300"],
                      ].map(([name, count, className]) => (
                        <div key={name} className="rounded-lg border border-white/[0.06] bg-white/[0.018] px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{name}</p>
                          <p className={`mt-0.5 text-lg font-semibold ${className}`}>{count || 0}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {isExpanded && deployment.endpoints?.length > 0 && (
                  <div className="border-t border-white/[0.07] bg-black/10 px-4 py-2 sm:px-5">
                    {deployment.endpoints.map(endpoint => (
                      <div key={endpoint.device_id} className="flex flex-col gap-2 border-b border-white/[0.05] py-3 last:border-0 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <EndpointStatusIcon status={endpoint.status} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{endpoint.hostname}</p>
                            <p className="truncate text-xs text-muted-foreground">{endpoint.client_name || "Unlinked client"} · {endpoint.device_id}</p>
                          </div>
                        </div>
                        <Badge variant="outline" className={tones[endpoint.status] || ""}>{label(endpoint.status)}</Badge>
                        <span className="text-xs text-muted-foreground">Last seen {formatDate(endpoint.last_seen)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {!deployments.length && (
          <Card className="border-dashed">
            <CardContent className="px-6 py-10 text-center">
              <History className="mx-auto h-7 w-7 text-sky-300" />
              <p className="mt-3 font-medium">No DNS rollouts have been staged</p>
              <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
                Begin in visibility mode. NexusMSP will preserve the technician, reason, endpoint set and every acknowledgement.
              </p>
              <Button className="mt-4" onClick={onDeploy}><ShieldCheck className="mr-2 h-4 w-4" />Stage the first rollout</Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <TimerOff className="h-5 w-5 text-violet-300" />Expiring access exceptions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {exceptions.length ? exceptions.map(exception => (
            <div key={exception.id} className="flex flex-col gap-2 border-b border-white/[0.06] py-3 first:pt-0 last:border-0 last:pb-0 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-mono text-sm">{exception.domain}</span>
                  <Badge variant="outline" className={tones[exception.status] || ""}>{exception.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {exception.client_name || "Unlinked client"} · {exception.device_name || exception.scope_id || "No endpoint"} · {exception.reason}
                </p>
              </div>
              <div className="text-xs text-muted-foreground sm:text-right">
                <p>Expires {formatDate(exception.expires_at)}</p>
                <p>Created by {exception.created_by || "Unknown technician"}</p>
              </div>
            </div>
          )) : (
            <div className="py-6 text-center">
              <TimerOff className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No access exceptions</p>
              <p className="mt-1 text-xs text-muted-foreground">Temporary allows created from verified query evidence will appear here.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(rollbackTarget)} onOpenChange={open => { if (!open) setRollbackTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-violet-300" />Queue a safe visibility rollback
            </DialogTitle>
            <DialogDescription>
              This queues visibility mode only for endpoints still assigned to {rollbackTarget?.id}. It does not claim success until each agent acknowledges the rollback.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.045] p-3 text-sm text-amber-100/80">
              The original deployment stays in the audit ledger. Endpoints already superseded by a later rollout are not changed.
            </div>
            <div className="space-y-2">
              <Label>Required rollback reason</Label>
              <Textarea
                rows={4}
                value={rollbackReason}
                onChange={event => setRollbackReason(event.target.value)}
                placeholder="What was observed, why rollback is required, and who approved it"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollbackTarget(null)}>Cancel</Button>
            <Button onClick={queueRollback} disabled={saving || rollbackReason.trim().length < 8}>
              <RotateCcw className="mr-2 h-4 w-4" />Queue safe rollback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
}
