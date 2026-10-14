import { useEffect, useState } from "react";
import axios from "axios";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { API } from "@/App";
import { Layers3, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const blankPolicy = { application_name: "", publisher: "", approval_state: "review", target_version: "", rollout_ring: "", notes: "" };

export default function ApplicationPolicyDialog({ open, onOpenChange, application, headers, onSaved }) {
  const [policy, setPolicy] = useState(blankPolicy);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const matched = application?.policy?.record;
    setPolicy({
      application_name: application?.app_name || matched?.application_name || "",
      publisher: application?.publisher || matched?.publisher || "",
      approval_state: matched?.approval_state || "review",
      target_version: matched?.target_version || "",
      rollout_ring: matched?.rollout_ring || "",
      notes: matched?.notes || "",
    });
  }, [application, open]);

  const save = async () => {
    setSaving(true);
    try {
      const matched = application?.policy?.record;
      const response = matched?.id
        ? await axios.put(`${API}/application-manager/policies/${matched.id}`, policy, { headers })
        : await axios.post(`${API}/application-manager/policies`, policy, { headers });
      toast.success(matched?.id ? "Application approval record updated. No deployment was started." : "Application approval record saved. No deployment was started.");
      onSaved?.(response.data?.policy);
      onOpenChange(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus could not save the approval record.");
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <NexusWorkflowDialog eyebrow="Application governance" title={application?.policy?.record?.id ? "Update approval and rollout intent" : "Record approval and rollout intent"} description="This is a global policy record—not proof that software is deployed, current or enforced." icon={ShieldCheck} tone="emerald" className="max-w-3xl" contentClassName="space-y-4" footer={<><p className="hidden text-xs text-muted-foreground sm:block">Policies are retained for audit. A verified provider and approvals are still needed before endpoint work.</p><div className="flex gap-2"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving || !policy.application_name.trim()}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Layers3 className="mr-1.5 h-4 w-4" />}{application?.policy?.record?.id ? "Update approval record" : "Save approval record"}</Button></div></>}>
      <div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="application-policy-name">Application</Label><Input id="application-policy-name" value={policy.application_name} onChange={(event) => setPolicy((current) => ({ ...current, application_name: event.target.value }))} placeholder="Google Chrome" /></div><div className="grid gap-2"><Label htmlFor="application-policy-publisher">Publisher (optional)</Label><Input id="application-policy-publisher" value={policy.publisher} onChange={(event) => setPolicy((current) => ({ ...current, publisher: event.target.value }))} placeholder="Google LLC" /></div></div>
      <div className="grid gap-4 sm:grid-cols-3"><div className="grid gap-2"><Label>Approval state</Label><Select value={policy.approval_state} onValueChange={(value) => setPolicy((current) => ({ ...current, approval_state: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="approved">Approved</SelectItem><SelectItem value="restricted">Restricted</SelectItem><SelectItem value="review">Review required</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label htmlFor="application-policy-version">Target version</Label><Input id="application-policy-version" value={policy.target_version} onChange={(event) => setPolicy((current) => ({ ...current, target_version: event.target.value }))} placeholder="Optional evidence target" /></div><div className="grid gap-2"><Label htmlFor="application-policy-ring">Rollout ring</Label><Input id="application-policy-ring" value={policy.rollout_ring} onChange={(event) => setPolicy((current) => ({ ...current, rollout_ring: event.target.value }))} placeholder="Pilot / Standard" /></div></div>
      <div className="grid gap-2"><Label htmlFor="application-policy-notes">Decision notes</Label><Textarea id="application-policy-notes" value={policy.notes} onChange={(event) => setPolicy((current) => ({ ...current, notes: event.target.value }))} placeholder="Approval boundary, exception process, owner, or rollout rationale." /></div>
      <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-3 text-xs text-amber-100">Nexus will retain this decision and show it against observed inventory. It will not install, update, remove, block or classify software as compliant from this record alone.</div>
    </NexusWorkflowDialog>
  </Dialog>;
}
