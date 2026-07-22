import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, ClipboardCheck, Plus, ShieldOff } from "lucide-react";
import { toast } from "sonner";

const initialPlan = { client_id: "", name: "", rto_hours: 4, rpo_hours: 1, primary_contact: "", after_hours_contact: "", test_interval_days: 180 };

export default function DRPlansPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [plans, setPlans] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [clientQuery, setClientQuery] = useState("");
  const [planForm, setPlanForm] = useState(initialPlan);
  const [testForm, setTestForm] = useState({ test_type: "tabletop", outcome: "passed", notes: "" });

  const load = useCallback(async () => {
    try {
      const [planResponse, clientResponse] = await Promise.all([
        axios.get(`${API}/pro-pack/dr-plans`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setPlans(planResponse.data || []);
      setClients(clientResponse.data || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not load disaster recovery plans");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const chooseClient = (value) => {
    setClientQuery(value);
    const selected = clients.find((client) => client.name === value || client.id === value);
    setPlanForm((current) => ({ ...current, client_id: selected?.id || "" }));
  };

  const createPlan = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/pro-pack/dr-plans`, planForm, { headers });
      toast.success("Client-linked DR plan created");
      setPlanDialogOpen(false);
      setClientQuery("");
      setPlanForm(initialPlan);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not create the DR plan");
    } finally { setSaving(false); }
  };

  const openTest = (plan) => {
    setSelectedPlan(plan);
    setTestForm({ test_type: "tabletop", outcome: "passed", notes: "" });
    setTestDialogOpen(true);
  };

  const recordTest = async () => {
    if (!selectedPlan) return;
    setSaving(true);
    try {
      await axios.post(`${API}/pro-pack/dr-plans/${selectedPlan.id}/tests`, testForm, { headers });
      toast.success("DR test outcome recorded and audited");
      setTestDialogOpen(false);
      setSelectedPlan(null);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not record the DR test");
    } finally { setSaving(false); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return <div className="space-y-6" data-testid="dr-plans-page">
    <section className="surface-header-panel"><div className="surface-header-content"><div className="surface-icon"><ShieldOff className="h-5 w-5" /></div><div className="flex-1"><p className="surface-eyebrow">Recovery readiness</p><h1 className="surface-title">Disaster recovery plans</h1><p className="surface-description">Client-linked recovery objectives, contacts, and evidence-backed exercises. A plan is not marked tested until a technician records the result.</p></div><Button onClick={() => setPlanDialogOpen(true)}><Plus className="mr-1.5 h-4 w-4" />New plan</Button></div></section>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3"><Card><CardContent className="pt-5"><p className="text-2xl font-bold">{plans.length}</p><p className="text-xs text-muted-foreground">Client recovery plans</p></CardContent></Card><Card><CardContent className="pt-5"><p className="text-2xl font-bold">{plans.filter((plan) => plan.last_tested).length}</p><p className="text-xs text-muted-foreground">Plans with test evidence</p></CardContent></Card><Card><CardContent className="pt-5"><p className="text-2xl font-bold">{plans.reduce((total, plan) => total + Number(plan.test_count || 0), 0)}</p><p className="text-xs text-muted-foreground">Recorded test outcomes</p></CardContent></Card></div>
    {!plans.length ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No recovery plans yet. Create one against a client to establish recovery objectives, contacts, and testing cadence.</CardContent></Card> : <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{plans.map((plan) => <Card key={plan.id}><CardContent className="space-y-4 pt-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{plan.name}</h2><p className="mt-1 text-sm text-muted-foreground">{plan.client_name}</p></div><Badge variant={plan.last_tested ? "default" : "secondary"}>{plan.last_tested ? "Test evidence recorded" : "Not yet tested"}</Badge></div><div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-3 text-sm"><div><p className="text-xs text-muted-foreground">RTO</p><p className="font-semibold">{plan.rto_hours} hours</p></div><div><p className="text-xs text-muted-foreground">RPO</p><p className="font-semibold">{plan.rpo_hours} hours</p></div><div><p className="text-xs text-muted-foreground">Next test due</p><p className="font-medium">{plan.next_test_due || "Not scheduled"}</p></div><div><p className="text-xs text-muted-foreground">Recorded tests</p><p className="font-medium">{plan.test_count || 0}</p></div></div><div className="text-sm"><p><span className="text-muted-foreground">Primary:</span> {plan.primary_contact || "Not recorded"}</p><p className="mt-1"><span className="text-muted-foreground">After hours:</span> {plan.after_hours_contact || "Not recorded"}</p></div><div><p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recovery scenarios</p><div className="flex flex-wrap gap-2">{(plan.scenarios || []).map((scenario) => <Badge key={scenario.name} variant="outline">{scenario.name}</Badge>)}</div></div><Button onClick={() => openTest(plan)}><CheckCircle2 className="mr-1.5 h-4 w-4" />Record test outcome</Button></CardContent></Card>)}</div>}
    <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>New client recovery plan</DialogTitle><DialogDescription>Connect this plan to an existing client. The default scenarios are planning templates, not completed recovery work.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label>Client</Label><Input list="dr-plan-clients" value={clientQuery} onChange={(event) => chooseClient(event.target.value)} placeholder="Search or select a client" /><datalist id="dr-plan-clients">{clients.map((client) => <option key={client.id} value={client.name}>{client.id}</option>)}</datalist>{clientQuery && !planForm.client_id && <p className="mt-1 text-xs text-amber-600">Select a client from the suggested list to link this plan.</p>}</div><div><Label>Plan name</Label><Input value={planForm.name} onChange={(event) => setPlanForm({ ...planForm, name: event.target.value })} placeholder="e.g. Core services recovery plan" /></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><div><Label>RTO (hours)</Label><Input type="number" min="0.5" step="0.5" value={planForm.rto_hours} onChange={(event) => setPlanForm({ ...planForm, rto_hours: parseFloat(event.target.value) })} /></div><div><Label>RPO (hours)</Label><Input type="number" min="0.5" step="0.5" value={planForm.rpo_hours} onChange={(event) => setPlanForm({ ...planForm, rpo_hours: parseFloat(event.target.value) })} /></div><div><Label>Test interval (days)</Label><Input type="number" min="30" max="730" value={planForm.test_interval_days} onChange={(event) => setPlanForm({ ...planForm, test_interval_days: parseInt(event.target.value, 10) })} /></div></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><Label>Primary contact</Label><Input value={planForm.primary_contact} onChange={(event) => setPlanForm({ ...planForm, primary_contact: event.target.value })} placeholder="Name, role, and preferred contact" /></div><div><Label>After-hours contact</Label><Input value={planForm.after_hours_contact} onChange={(event) => setPlanForm({ ...planForm, after_hours_contact: event.target.value })} placeholder="Escalation contact details" /></div></div></div><DialogFooter><Button variant="ghost" onClick={() => setPlanDialogOpen(false)}>Cancel</Button><Button onClick={createPlan} disabled={saving || !planForm.client_id || !planForm.name}>Create plan</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Record DR test outcome</DialogTitle><DialogDescription>{selectedPlan?.name} - {selectedPlan?.client_name}. Record what was actually tested and the supporting observations.</DialogDescription></DialogHeader><div className="space-y-4"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><Label>Test type</Label><Select value={testForm.test_type} onValueChange={(value) => setTestForm({ ...testForm, test_type: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="tabletop">Tabletop exercise</SelectItem><SelectItem value="restore">Restore validation</SelectItem><SelectItem value="failover">Failover exercise</SelectItem><SelectItem value="documentation_review">Documentation review</SelectItem></SelectContent></Select></div><div><Label>Outcome</Label><Select value={testForm.outcome} onValueChange={(value) => setTestForm({ ...testForm, outcome: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="passed">Passed</SelectItem><SelectItem value="needs_follow_up">Needs follow-up</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent></Select></div></div><div><Label>Observations and evidence</Label><Textarea value={testForm.notes} onChange={(event) => setTestForm({ ...testForm, notes: event.target.value })} placeholder="What was tested, evidence location, gaps found, and the follow-up owner." className="min-h-[130px]" /></div></div><DialogFooter><Button variant="ghost" onClick={() => setTestDialogOpen(false)}>Cancel</Button><Button onClick={recordTest} disabled={saving || !testForm.notes.trim()}>Record outcome</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
