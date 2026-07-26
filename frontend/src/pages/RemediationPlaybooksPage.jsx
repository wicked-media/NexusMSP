import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileWarning, Loader2, Play, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const severityVariant = { critical: "destructive", high: "warning", medium: "secondary", low: "secondary" };
const emptyRunbook = () => ({ name: "", description: "", trigger: "manual", severity: "medium", steps: [{ action: "review", description: "" }] });

export default function RemediationPlaybooksPage() {
  const { token } = useAuth();
  const [playbooks, setPlaybooks] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [runbookForm, setRunbookForm] = useState(emptyRunbook);
  const [blockedStep, setBlockedStep] = useState(null);
  const [blockedNote, setBlockedNote] = useState("");
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const [playbookResponse, sessionResponse] = await Promise.all([
        axios.get(`${API}/remediation-playbooks/list`, { headers }),
        axios.get(`${API}/remediation-playbooks/executions`, { headers }),
      ]);
      setPlaybooks(playbookResponse.data || []);
      setSessions(sessionResponse.data || []);
      setActiveSession((current) => current || (sessionResponse.data || []).find((session) => session.status === "in_progress") || null);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not load response runbooks");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const start = async (playbook) => {
    setSaving(true);
    try {
      const response = await axios.post(`${API}/remediation-playbooks/${playbook.id}/start`, {}, { headers });
      setActiveSession(response.data);
      setSessions((current) => [response.data, ...current]);
      toast.success("Guided response session started and audited");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not start the response session");
    } finally { setSaving(false); }
  };

  const recordStep = async (step, outcome, note = "") => {
    if (!activeSession) return;
    setSaving(true);
    try {
      const response = await axios.post(`${API}/remediation-playbooks/executions/${activeSession.id}/steps/${step.order}`, { outcome, note }, { headers });
      setActiveSession(response.data);
      setSessions((current) => current.map((session) => session.id === response.data.id ? response.data : session));
      toast.success(`Step marked ${outcome.replace("_", " ")}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not record that response step");
    } finally { setSaving(false); }
  };

  const submitBlockedStep = async () => {
    if (!blockedStep || blockedNote.trim().length < 8) return;
    await recordStep(blockedStep, "blocked", blockedNote.trim());
    setBlockedStep(null);
    setBlockedNote("");
  };

  const updateRunbookStep = (index, field, value) => setRunbookForm((current) => ({
    ...current,
    steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, [field]: value } : step),
  }));

  const createRunbook = async () => {
    const payload = {
      ...runbookForm,
      name: runbookForm.name.trim(),
      description: runbookForm.description.trim(),
      trigger: runbookForm.trigger.trim() || "manual",
      steps: runbookForm.steps.map((step) => ({ action: step.action.trim() || "review", description: step.description.trim() })),
    };
    if (!payload.name || !payload.description || payload.steps.some((step) => !step.description)) {
      toast.error("Add a name, purpose, and description for every response step.");
      return;
    }
    setSaving(true);
    try {
      const response = await axios.post(`${API}/remediation-playbooks/create`, payload, { headers });
      setPlaybooks((current) => [...current, response.data]);
      setCreateOpen(false);
      setRunbookForm(emptyRunbook());
      toast.success("Team response runbook created and audited");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not create the team response runbook");
    } finally { setSaving(false); }
  };

  const closeSession = async () => {
    if (!activeSession) return;
    setSaving(true);
    try {
      const response = await axios.post(`${API}/remediation-playbooks/executions/${activeSession.id}/close`, { note: closeNote }, { headers });
      setSessions((current) => current.map((session) => session.id === response.data.id ? response.data : session));
      setActiveSession(null);
      setCloseNote("");
      toast.success("Response session closed and recorded in the audit trail");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Record every response step before closing");
    } finally { setSaving(false); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  const addressed = activeSession?.steps?.every((step) => step.outcome !== "pending");

  return (
    <div className="space-y-6" data-testid="remediation-playbooks-page">
      <OperationalPageHeader
        eyebrow="Nexus Shield | security operations"
        title="Guided response runbooks"
        description="Technician-confirmed containment checklists with durable audit evidence. Runbooks guide work; they never perform disruptive containment automatically."
        icon={ShieldCheck}
        tone="rose"
        actions={<>
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing || saving}><RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh</Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={saving}><Plus className="mr-1.5 h-4 w-4" />New team runbook</Button>
        </>}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <HeroTile label="Available runbooks" value={playbooks.length} icon={ClipboardCheck} glow="sky" subtitle="Nexus templates and team guidance" animated={false} />
        <HeroTile label="Active response" value={activeSession ? "Live" : "Clear"} icon={Play} glow={activeSession ? "amber" : "zinc"} subtitle={activeSession ? activeSession.playbook_name : "No guided response in progress"} animated={Boolean(activeSession)} />
        <HeroTile label="Closed with evidence" value={sessions.filter((session) => session.status === "closed").length} icon={CheckCircle2} glow="emerald" subtitle={`${sessions.length} total recorded sessions`} animated={false} />
      </div>

      {activeSession && <Card className="border-primary/40" data-testid="active-response-session"><CardContent className="space-y-5 pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" /><h2 className="font-semibold">Guided response in progress</h2></div><p className="mt-1 text-sm text-muted-foreground">{activeSession.playbook_name}. Confirm each action only after completing it in the authoritative provider or incident workflow.</p></div><Badge variant="warning">In progress</Badge></div>
        <div className="space-y-3">{activeSession.steps?.map((step) => <div key={step.order} className="rounded-xl border border-border/70 bg-muted/20 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{step.order}</span><div><p className="text-sm font-medium">{step.description}</p>{step.recorded_at && <p className="mt-1 text-xs text-muted-foreground">{step.outcome.replace("_", " ")} by {step.recorded_by}</p>}{step.note && <p className="mt-2 rounded-md border border-amber-500/15 bg-amber-500/[0.05] px-2 py-1.5 text-xs text-muted-foreground">Recorded note: {step.note}</p>}</div></div>{step.outcome === "pending" ? <div className="flex flex-wrap gap-2"><Button size="sm" disabled={saving} onClick={() => recordStep(step, "completed")}>Complete</Button><Button size="sm" variant="outline" disabled={saving} onClick={() => recordStep(step, "not_applicable")}>N/A</Button><Button size="sm" variant="outline" disabled={saving} onClick={() => { setBlockedStep(step); setBlockedNote(""); }}>Blocked</Button></div> : <Badge variant={step.outcome === "completed" ? "default" : "secondary"}>{step.outcome.replace("_", " ")}</Badge>}</div></div>)}</div>
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row"><Textarea value={closeNote} onChange={(event) => setCloseNote(event.target.value)} placeholder="Optional closure note for the audit record" className="min-h-[76px]" /><Button disabled={!addressed || saving} onClick={closeSession} className="sm:self-end">Close response</Button></div>
      </CardContent></Card>}

      <section className="space-y-3"><div><h2 className="text-lg font-semibold">Response library</h2><p className="text-sm text-muted-foreground">Templates are operational guidance, not proof that a containment action has occurred.</p></div><div className="space-y-4">{playbooks.map((playbook) => <Card key={playbook.id} data-testid={`playbook-${playbook.id}`}><CardContent className="pt-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{playbook.name}</h3><Badge variant={severityVariant[playbook.severity] || "secondary"}>{playbook.severity}</Badge><Badge variant="outline">{playbook.source === "nexus_template" ? "Nexus template" : "Team runbook"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{playbook.description}</p><p className="mt-2 text-xs text-muted-foreground">Trigger: <code className="rounded bg-muted px-1 py-0.5">{playbook.trigger}</code> · {playbook.steps?.length || 0} documented steps</p><ol className="mt-4 space-y-2">{playbook.steps?.map((step) => <li key={step.order} className="flex gap-2 text-sm"><span className="font-medium text-primary">{step.order}.</span><span>{step.description}</span></li>)}</ol></div><Button disabled={saving || !!activeSession || !playbook.enabled} onClick={() => start(playbook)}><Play className="mr-1.5 h-4 w-4" />Start guided response</Button></div></CardContent></Card>)}</div></section>
      {!sessions.length ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground"><FileWarning className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />No response sessions have been recorded yet.</CardContent></Card> : <p className="text-xs text-muted-foreground">Session history contains only technician-recorded guided response work.</p>}

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setRunbookForm(emptyRunbook()); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-sky-300" />Create team response runbook</DialogTitle></DialogHeader>
          <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
            <p className="text-sm text-muted-foreground">Build technician-led guidance for an agreed response. Every recorded action is attributed to the acting technician and retained in the audit trail.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="runbook-name">Runbook name</Label><Input id="runbook-name" className="mt-1" value={runbookForm.name} onChange={(event) => setRunbookForm((current) => ({ ...current, name: event.target.value }))} placeholder="Example: Lost device response" /></div>
              <div><Label htmlFor="runbook-severity">Severity</Label><Select value={runbookForm.severity} onValueChange={(severity) => setRunbookForm((current) => ({ ...current, severity }))}><SelectTrigger id="runbook-severity" className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select></div>
            </div>
            <div><Label htmlFor="runbook-purpose">Purpose and scope</Label><Textarea id="runbook-purpose" className="mt-1" rows={3} value={runbookForm.description} onChange={(event) => setRunbookForm((current) => ({ ...current, description: event.target.value }))} placeholder="Describe when technicians should use this runbook and what it protects." /></div>
            <div><Label htmlFor="runbook-trigger">Trigger or signal</Label><Input id="runbook-trigger" className="mt-1" value={runbookForm.trigger} onChange={(event) => setRunbookForm((current) => ({ ...current, trigger: event.target.value }))} placeholder="Example: lost_or_stolen_device" /></div>
            <div className="space-y-3"><div className="flex items-center justify-between"><div><Label>Response steps</Label><p className="mt-1 text-xs text-muted-foreground">Write specific, technician-verifiable actions. Steps are never executed automatically.</p></div><Button size="sm" variant="outline" type="button" onClick={() => setRunbookForm((current) => ({ ...current, steps: [...current.steps, { action: "review", description: "" }] }))}><Plus className="mr-1 h-3.5 w-3.5" />Add step</Button></div>{runbookForm.steps.map((step, index) => <div key={`step-${index}`} className="grid gap-2 rounded-xl border border-border/70 bg-muted/20 p-3 sm:grid-cols-[11rem_1fr_auto]"><Input value={step.action} onChange={(event) => updateRunbookStep(index, "action", event.target.value)} aria-label={`Action for step ${index + 1}`} placeholder="Action key" /><Input value={step.description} onChange={(event) => updateRunbookStep(index, "description", event.target.value)} aria-label={`Description for step ${index + 1}`} placeholder={`Step ${index + 1} description`} /><Button type="button" size="sm" variant="ghost" disabled={runbookForm.steps.length === 1} onClick={() => setRunbookForm((current) => ({ ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index) }))}>Remove</Button></div>)}</div>
          </div>
          <div className="flex justify-end gap-2 border-t pt-4"><Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button><Button onClick={createRunbook} disabled={saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Create audited runbook</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(blockedStep)} onOpenChange={(open) => { if (!open) { setBlockedStep(null); setBlockedNote(""); } }}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Record blocked response step</DialogTitle></DialogHeader><div className="space-y-4"><p className="text-sm text-muted-foreground">Explain what prevented the action and who owns the next step. This note becomes part of the immutable response record.</p><Textarea value={blockedNote} onChange={(event) => setBlockedNote(event.target.value)} rows={4} placeholder="Example: Endpoint was powered off; client contact requested a scheduled onsite visit. Assigned to Jordan for 09:00 tomorrow." /><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setBlockedStep(null); setBlockedNote(""); }} disabled={saving}>Cancel</Button><Button variant="destructive" onClick={submitBlockedStep} disabled={saving || blockedNote.trim().length < 8}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Record blocked step</Button></div></div></DialogContent>
      </Dialog>
    </div>
  );
}
