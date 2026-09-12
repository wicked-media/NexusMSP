import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { API } from "@/App";
import { ClipboardCheck, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

const makeKey = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `app-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const scopeKey = (installation) => `${installation.client_id || ""}::${installation.site_id || ""}`;

export default function ApplicationActionPlanDialog({ open, onOpenChange, application, headers, onSaved }) {
  const installations = useMemo(() => Array.isArray(application?.installations) ? application.installations : [], [application]);
  const scopes = useMemo(() => {
    const seen = new Map();
    installations.forEach((item) => {
      if (!item?.client_id || !item?.site_id) return;
      const key = scopeKey(item);
      if (!seen.has(key)) seen.set(key, { key, clientName: item.client_name || "Scoped client", siteId: item.site_id || "", count: 0 });
      seen.get(key).count += 1;
    });
    return [...seen.values()];
  }, [installations]);
  const [selectedScope, setSelectedScope] = useState("");
  const [targetIds, setTargetIds] = useState([]);
  const [actionType, setActionType] = useState("update");
  const [reason, setReason] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const scopedInstallations = installations.filter((item) => scopeKey(item) === selectedScope);

  useEffect(() => {
    if (!open) return;
    const initialScope = scopes[0]?.key || "";
    const initialTargets = installations.filter((item) => scopeKey(item) === initialScope).slice(0, 50).map((item) => item.device_id);
    setSelectedScope(initialScope);
    setTargetIds(initialTargets);
    setActionType("update");
    setReason("");
    setTicketId("");
  }, [application, installations, open, scopes]);

  const setScope = (nextScope) => {
    setSelectedScope(nextScope);
    setTargetIds(installations.filter((item) => scopeKey(item) === nextScope).slice(0, 50).map((item) => item.device_id));
  };

  const toggleTarget = (deviceId, checked) => setTargetIds((current) => checked ? [...new Set([...current, deviceId])].slice(0, 50) : current.filter((id) => id !== deviceId));
  const selectAll = () => setTargetIds(scopedInstallations.slice(0, 50).map((item) => item.device_id));

  const save = async () => {
    setSubmitting(true);
    try {
      const response = await axios.post(`${API}/application-manager/action-plans`, {
        action_type: actionType,
        application_name: application?.app_name || "",
        publisher: application?.publisher || "",
        device_ids: targetIds,
        reason,
        ticket_id: ticketId || null,
        idempotency_key: makeKey(),
      }, { headers });
      toast.success(response.data?.idempotent ? "The governed plan already exists." : "Governed plan saved. No endpoint command was sent.");
      onSaved?.(response.data?.plan);
      onOpenChange(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus could not save the governed plan.");
    } finally {
      setSubmitting(false);
    }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <NexusWorkflowDialog eyebrow="Application change planning" title={`Stage ${application?.app_name || "application"} work`} description="Choose one client and site, document the reason, then retain a governed plan. This release never dispatches a package command." icon={ClipboardCheck} tone="violet" className="max-w-4xl" contentClassName="space-y-4" footer={<><p className="hidden text-xs text-muted-foreground sm:block">The plan remains not requested for approval and not configured for execution until a verified provider and approval path are connected.</p><div className="flex gap-2"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button><Button onClick={save} disabled={submitting || !targetIds.length || reason.trim().length < 3}>{submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-1.5 h-4 w-4" />}Save governed plan</Button></div></>}>
      {!scopes.length ? <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No application installations have both a recorded client and site. Link the endpoint to a site before staging a governed plan.</div> : <><div className="grid gap-4 sm:grid-cols-3"><div className="grid gap-2"><Label>Intent</Label><Select value={actionType} onValueChange={setActionType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="update">Update application</SelectItem><SelectItem value="uninstall">Remove application</SelectItem></SelectContent></Select></div><div className="grid gap-2 sm:col-span-2"><Label>Client and site scope</Label><Select value={selectedScope} onValueChange={setScope}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{scopes.map((scope) => <SelectItem key={scope.key} value={scope.key}>{scope.clientName} · site {scope.siteId} ({scope.count})</SelectItem>)}</SelectContent></Select></div></div>
        <section className="rounded-xl border border-border/70 bg-muted/[0.08] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">Target endpoints</p><p className="mt-1 text-xs text-muted-foreground">A plan can target up to 50 endpoints at one client/site boundary. This evidence-led release plans updates or removal only; installation awaits a verified software catalogue and provider.</p></div><Button size="sm" variant="outline" onClick={selectAll}>Select scope ({Math.min(scopedInstallations.length, 50)})</Button></div><div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">{scopedInstallations.map((item) => <label key={item.device_id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm"><Checkbox checked={targetIds.includes(item.device_id)} onCheckedChange={(checked) => toggleTarget(item.device_id, checked === true)} /><span className="min-w-0 flex-1 truncate font-medium">{item.device_name}</span><span className="shrink-0 font-mono text-xs text-muted-foreground">{item.version || "version not reported"}</span></label>)}</div></section>
        <div className="grid gap-4 sm:grid-cols-3"><div className="grid gap-2 sm:col-span-2"><Label htmlFor="application-plan-reason">Reason and expected outcome</Label><Textarea id="application-plan-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this work is needed, the change window/approval context, and how the result must be verified." /></div><div className="grid gap-2"><Label htmlFor="application-plan-ticket">Linked ticket (optional)</Label><Input id="application-plan-ticket" value={ticketId} onChange={(event) => setTicketId(event.target.value)} placeholder="Ticket number or ID" /><p className="text-xs text-muted-foreground">Nexus resolves the displayed ticket number or stable ID inside the same client scope.</p></div></div>
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-3 text-xs text-amber-100"><ShieldAlert className="mr-1 inline h-3.5 w-3.5" />Saving records an auditable plan only. Nexus has no verified application execution provider configured here, so it will not queue, install, update, remove or report completion.</div>
      </>}
    </NexusWorkflowDialog>
  </Dialog>;
}
