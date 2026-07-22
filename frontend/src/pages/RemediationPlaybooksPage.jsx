import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileWarning, Play, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const severityVariant = { critical: "destructive", high: "warning", medium: "secondary", low: "secondary" };

export default function RemediationPlaybooksPage() {
  const { token } = useAuth();
  const [playbooks, setPlaybooks] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closeNote, setCloseNote] = useState("");
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

  const recordStep = async (step, outcome) => {
    if (!activeSession) return;
    setSaving(true);
    try {
      const response = await axios.post(`${API}/remediation-playbooks/executions/${activeSession.id}/steps/${step.order}`, { outcome, note: outcome === "blocked" ? "Requires follow-up before this response can be closed." : "" }, { headers });
      setActiveSession(response.data);
      setSessions((current) => current.map((session) => session.id === response.data.id ? response.data : session));
      toast.success(`Step marked ${outcome.replace("_", " ")}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not record that response step");
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
      <section className="surface-header-panel">
        <div className="surface-header-content">
          <div className="surface-icon"><ShieldCheck className="h-5 w-5" /></div>
          <div><p className="surface-eyebrow">Security operations</p><h1 className="surface-title">Guided response runbooks</h1><p className="surface-description">Technician-confirmed response checklists with durable audit evidence. Starting a runbook never performs external containment automatically.</p></div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 pt-5"><ClipboardCheck className="h-6 w-6 text-primary" /><div><p className="text-2xl font-bold">{playbooks.length}</p><p className="text-xs text-muted-foreground">Available runbooks</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 pt-5"><Play className="h-6 w-6 text-sky-500" /><div><p className="text-2xl font-bold">{sessions.length}</p><p className="text-xs text-muted-foreground">Recorded sessions</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 pt-5"><CheckCircle2 className="h-6 w-6 text-emerald-500" /><div><p className="text-2xl font-bold">{sessions.filter((session) => session.status === "closed").length}</p><p className="text-xs text-muted-foreground">Closed with evidence</p></div></CardContent></Card>
      </div>

      {activeSession && <Card className="border-primary/40" data-testid="active-response-session"><CardContent className="space-y-5 pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" /><h2 className="font-semibold">Guided response in progress</h2></div><p className="mt-1 text-sm text-muted-foreground">{activeSession.playbook_name}. Confirm each action only after completing it in the authoritative provider or incident workflow.</p></div><Badge variant="warning">In progress</Badge></div>
        <div className="space-y-3">{activeSession.steps?.map((step) => <div key={step.order} className="rounded-xl border border-border/70 bg-muted/20 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{step.order}</span><div><p className="text-sm font-medium">{step.description}</p>{step.recorded_at && <p className="mt-1 text-xs text-muted-foreground">{step.outcome.replace("_", " ")} by {step.recorded_by}</p>}</div></div>{step.outcome === "pending" ? <div className="flex gap-2"><Button size="sm" disabled={saving} onClick={() => recordStep(step, "completed")}>Complete</Button><Button size="sm" variant="outline" disabled={saving} onClick={() => recordStep(step, "blocked")}>Blocked</Button></div> : <Badge variant={step.outcome === "completed" ? "default" : "secondary"}>{step.outcome.replace("_", " ")}</Badge>}</div></div>)}</div>
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row"><Textarea value={closeNote} onChange={(event) => setCloseNote(event.target.value)} placeholder="Optional closure note for the audit record" className="min-h-[76px]" /><Button disabled={!addressed || saving} onClick={closeSession} className="sm:self-end">Close response</Button></div>
      </CardContent></Card>}

      <section className="space-y-3"><div><h2 className="text-lg font-semibold">Response library</h2><p className="text-sm text-muted-foreground">Templates are operational guidance, not proof that a containment action has occurred.</p></div><div className="space-y-4">{playbooks.map((playbook) => <Card key={playbook.id} data-testid={`playbook-${playbook.id}`}><CardContent className="pt-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{playbook.name}</h3><Badge variant={severityVariant[playbook.severity] || "secondary"}>{playbook.severity}</Badge><Badge variant="outline">{playbook.source === "nexus_template" ? "Nexus template" : "Team runbook"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{playbook.description}</p><p className="mt-2 text-xs text-muted-foreground">Trigger: <code className="rounded bg-muted px-1 py-0.5">{playbook.trigger}</code> · {playbook.steps?.length || 0} documented steps</p><ol className="mt-4 space-y-2">{playbook.steps?.map((step) => <li key={step.order} className="flex gap-2 text-sm"><span className="font-medium text-primary">{step.order}.</span><span>{step.description}</span></li>)}</ol></div><Button disabled={saving || !!activeSession || !playbook.enabled} onClick={() => start(playbook)}><Play className="mr-1.5 h-4 w-4" />Start guided response</Button></div></CardContent></Card>)}</div></section>
      {!sessions.length ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground"><FileWarning className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />No response sessions have been recorded yet.</CardContent></Card> : <p className="text-xs text-muted-foreground">Session history contains only technician-recorded guided response work.</p>}
    </div>
  );
}
