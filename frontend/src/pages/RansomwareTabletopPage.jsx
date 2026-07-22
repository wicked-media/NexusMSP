import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, CheckCircle2, ClipboardList, Play, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export default function RansomwareTabletopPage() {
  const { token } = useAuth();
  const [scenarios, setScenarios] = useState([]);
  const [drills, setDrills] = useState([]);
  const [activeDrill, setActiveDrill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const [scenarioResponse, drillResponse] = await Promise.all([
        axios.get(`${API}/ransomware-tabletop/scenarios`, { headers }),
        axios.get(`${API}/ransomware-tabletop/drills`, { headers }),
      ]);
      setScenarios(scenarioResponse.data || []);
      setDrills(drillResponse.data || []);
      setActiveDrill((current) => current || (drillResponse.data || []).find((drill) => drill.status === "in_progress") || null);
    } catch (error) { toast.error(error.response?.data?.detail || "Could not load tabletop exercises"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const startDrill = async (scenario) => {
    setSaving(true);
    try {
      const response = await axios.post(`${API}/ransomware-tabletop/start/${scenario.id}`, {}, { headers });
      setActiveDrill(response.data);
      setDrills((current) => [response.data, ...current]);
      toast.success("Tabletop exercise started and logged");
    } catch (error) { toast.error(error.response?.data?.detail || "Could not start the tabletop exercise"); }
    finally { setSaving(false); }
  };

  const respond = async (decision) => {
    if (!activeDrill) return;
    setSaving(true);
    try {
      const response = await axios.post(`${API}/ransomware-tabletop/drills/${activeDrill.id}/respond`, { decision }, { headers });
      setActiveDrill(response.data);
      setDrills((current) => current.map((drill) => drill.id === response.data.id ? response.data : drill));
      toast.success(response.data.status === "completed" ? "All tabletop decisions recorded" : "Decision recorded in the exercise audit");
    } catch (error) { toast.error(error.response?.data?.detail || "Could not record that decision"); }
    finally { setSaving(false); }
  };

  const close = async () => {
    if (!activeDrill) return;
    setSaving(true);
    try {
      const response = await axios.post(`${API}/ransomware-tabletop/drills/${activeDrill.id}/close`, { note: closeNote }, { headers });
      setDrills((current) => current.map((drill) => drill.id === response.data.id ? response.data : drill));
      setActiveDrill(null);
      setCloseNote("");
      toast.success("Tabletop exercise closed and retained for audit");
    } catch (error) { toast.error(error.response?.data?.detail || "Could not close the tabletop exercise"); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  const phase = activeDrill?.phases?.find((item) => item.phase === activeDrill.current_phase);

  return <div className="space-y-6" data-testid="ransomware-tabletop-page">
    <section className="surface-header-panel"><div className="surface-header-content"><div className="surface-icon"><ShieldAlert className="h-5 w-5" /></div><div><p className="surface-eyebrow">Security readiness</p><h1 className="surface-title">Ransomware tabletop exercises</h1><p className="surface-description">Run guided decision exercises. Every choice is persisted with the responding technician and time; templates do not contain invented scores or history.</p></div></div></section>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3"><Card><CardContent className="flex items-center gap-3 pt-5"><ClipboardList className="h-6 w-6 text-primary" /><div><p className="text-2xl font-bold">{scenarios.length}</p><p className="text-xs text-muted-foreground">Exercise templates</p></div></CardContent></Card><Card><CardContent className="flex items-center gap-3 pt-5"><Play className="h-6 w-6 text-sky-500" /><div><p className="text-2xl font-bold">{drills.length}</p><p className="text-xs text-muted-foreground">Recorded drills</p></div></CardContent></Card><Card><CardContent className="flex items-center gap-3 pt-5"><CheckCircle2 className="h-6 w-6 text-emerald-500" /><div><p className="text-2xl font-bold">{drills.filter((drill) => drill.status === "closed").length}</p><p className="text-xs text-muted-foreground">Closed exercises</p></div></CardContent></Card></div>
    {activeDrill ? <Card className="border-red-500/30" data-testid="active-tabletop-drill"><CardContent className="space-y-5 pt-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-5 w-5 text-red-500" /><div><h2 className="font-semibold">Exercise in progress: {activeDrill.scenario_name}</h2><p className="text-sm text-muted-foreground">The exercise records decisions only; complete any live response in its designated operational workspace.</p></div></div><Badge variant={activeDrill.status === "completed" ? "default" : "destructive"}>{activeDrill.status === "completed" ? "All phases recorded" : `Phase ${activeDrill.current_phase}`}</Badge></div>{activeDrill.responses?.length > 0 && <div className="rounded-xl border bg-muted/20 p-4"><p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recorded decisions</p><div className="space-y-2">{activeDrill.responses.map((response) => <p key={response.phase} className="text-sm"><span className="font-medium">Phase {response.phase}:</span> {response.decision}<span className="text-muted-foreground"> - {response.recorded_by}</span></p>)}</div></div>}{activeDrill.status === "in_progress" && phase && <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5"><p className="text-xs font-medium uppercase tracking-wide text-red-600">Current phase {phase.phase}</p><h3 className="mt-1 font-semibold">{phase.title}</h3><p className="mt-2 text-sm text-muted-foreground">{phase.description}</p><div className="mt-4 flex flex-col gap-2">{phase.decisions.map((decision) => <Button key={decision} variant="outline" className="h-auto justify-start whitespace-normal py-3 text-left" disabled={saving} onClick={() => respond(decision)}>{decision}</Button>)}</div></div>}<div className="flex flex-col gap-3 border-t pt-4 sm:flex-row"><Textarea value={closeNote} onChange={(event) => setCloseNote(event.target.value)} placeholder="Optional close-out observations for the exercise record" className="min-h-[76px]" /><Button disabled={saving} onClick={close} className="sm:self-end">Close exercise</Button></div></CardContent></Card> : <section className="space-y-4"><div><h2 className="text-lg font-semibold">Exercise library</h2><p className="text-sm text-muted-foreground">Use these standard templates to document your team’s actual tabletop decisions.</p></div>{scenarios.map((scenario) => <Card key={scenario.id}><CardContent className="pt-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center"><ShieldAlert className="h-10 w-10 shrink-0 text-red-500" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{scenario.name}</h3><Badge variant={scenario.difficulty === "high" ? "destructive" : "secondary"}>{scenario.difficulty}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{scenario.description}</p><p className="mt-2 text-xs text-muted-foreground">{scenario.phases.length} phases · approximately {scenario.est_duration_min} minutes · {scenario.recorded_drills} recorded drills ({scenario.completed_drills} closed)</p></div><Button disabled={saving} onClick={() => startDrill(scenario)}><Play className="mr-1.5 h-4 w-4" />Start exercise</Button></div></CardContent></Card>)}</section>}
  </div>;
}
