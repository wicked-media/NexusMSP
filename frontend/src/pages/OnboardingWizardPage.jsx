import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Shield, ArrowRight, ArrowLeft, CheckCircle, Building, Users, Monitor,
  FileText, Settings, Loader2, Zap, Plus, Trash2, Wifi
} from "lucide-react";

const STEPS = [
  { num: 1, title: "Client Info", icon: Building, desc: "Basic client details" },
  { num: 2, title: "Contacts", icon: Users, desc: "Key contacts" },
  { num: 3, title: "Devices", icon: Monitor, desc: "Register devices" },
  { num: 4, title: "Contract", icon: FileText, desc: "Service agreement" },
  { num: 5, title: "Monitoring", icon: Wifi, desc: "Configure alerts" },
  { num: 6, title: "Go Live", icon: Zap, desc: "Final review" },
];

export default function OnboardingWizardPage() {
  const { token } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stepData, setStepData] = useState({});
  const headers = { Authorization: `Bearer ${token}` };

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/onboarding/sessions`, { headers });
      setSessions(res.data);
    } catch { toast.error("Failed to fetch sessions"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const startNew = async () => {
    try {
      const res = await axios.post(`${API}/onboarding/start`, {}, { headers });
      setActiveSession(res.data);
      setStepData({});
      fetchSessions();
    } catch { toast.error("Failed to start onboarding"); }
  };

  const loadSession = async (id) => {
    try {
      const res = await axios.get(`${API}/onboarding/${id}`, { headers });
      setActiveSession(res.data);
      setStepData({});
    } catch { toast.error("Failed to load session"); }
  };

  const completeStep = async () => {
    if (!activeSession) return;
    setSaving(true);
    try {
      const res = await axios.put(`${API}/onboarding/${activeSession.id}/step/${activeSession.current_step}`, { step_data: stepData }, { headers });
      setActiveSession(res.data);
      setStepData({});
      if (res.data.status === "completed") {
        toast.success("Client onboarded successfully!");
      } else {
        toast.success("Step completed");
      }
      fetchSessions();
    } catch { toast.error("Failed to complete step"); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // WIZARD VIEW
  if (activeSession && activeSession.status !== "completed") {
    const step = activeSession.current_step;
    const progress = ((step - 1) / 6) * 100;

    return (
      <div className="max-w-3xl mx-auto space-y-6" data-testid="onboarding-wizard">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setActiveSession(null)} data-testid="wizard-back"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <div>
            <h1 className="text-2xl font-bold">Client Onboarding</h1>
            <p className="text-sm text-muted-foreground">Session {activeSession.id} &middot; Step {step} of 6</p>
          </div>
        </div>

        {/* Progress */}
        <div className="space-y-3">
          <Progress value={progress} className="h-2" />
          <div className="grid grid-cols-6 gap-2">
            {STEPS.map(s => {
              const stepKey = Object.keys(activeSession.steps || {})[s.num - 1];
              const stepStatus = activeSession.steps?.[stepKey]?.status;
              const isCurrent = s.num === step;
              return (
                <div key={s.num} className={`text-center p-2 rounded-lg border transition-all ${isCurrent ? "border-primary bg-primary/5" : stepStatus === "completed" ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/30 opacity-50"}`}>
                  <s.icon className={`w-4 h-4 mx-auto mb-1 ${isCurrent ? "text-primary" : stepStatus === "completed" ? "text-emerald-400" : "text-muted-foreground"}`} />
                  <p className="text-[10px] font-bold">{s.title}</p>
                  {stepStatus === "completed" && <CheckCircle className="w-3 h-3 text-emerald-400 mx-auto mt-0.5" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step Content */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {(() => { const Icon = STEPS[step - 1]?.icon || Building; return <Icon className="w-5 h-5 text-primary" />; })()}
              Step {step}: {STEPS[step - 1]?.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === 1 && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Company Name *</Label><Input value={stepData.name || ""} onChange={e => setStepData(d => ({ ...d, name: e.target.value }))} placeholder="Acme Corp" data-testid="ob-name" /></div>
                <div><Label>Email *</Label><Input type="email" value={stepData.email || ""} onChange={e => setStepData(d => ({ ...d, email: e.target.value }))} placeholder="info@acme.com" data-testid="ob-email" /></div>
                <div><Label>Phone</Label><Input value={stepData.phone || ""} onChange={e => setStepData(d => ({ ...d, phone: e.target.value }))} placeholder="+1 555-0100" /></div>
                <div><Label>Industry</Label>
                  <Select value={stepData.industry || "__none"} onValueChange={v => setStepData(d => ({ ...d, industry: v === "__none" ? "" : v }))}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {["Technology", "Healthcare", "Finance", "Education", "Manufacturing", "Retail", "Legal", "Other"].map(i => <SelectItem key={i} value={i.toLowerCase()}>{i}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2"><Label>Address</Label><Input value={stepData.address || ""} onChange={e => setStepData(d => ({ ...d, address: e.target.value }))} placeholder="123 Business Rd" /></div>
                <div><Label>Tier</Label>
                  <Select value={stepData.tier || "standard"} onValueChange={v => setStepData(d => ({ ...d, tier: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="basic">Basic</SelectItem><SelectItem value="standard">Standard</SelectItem><SelectItem value="premium">Premium</SelectItem><SelectItem value="enterprise">Enterprise</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Add key contacts for this client.</p>
                {(stepData.contacts || [{ name: "", email: "", phone: "", role: "primary" }]).map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_120px_100px_32px] gap-2 items-end">
                    <Input placeholder="Name" value={c.name} onChange={e => { const cs = [...(stepData.contacts || [{ name: "", email: "", phone: "", role: "primary" }])]; cs[i] = { ...cs[i], name: e.target.value }; setStepData(d => ({ ...d, contacts: cs })); }} data-testid={`contact-name-${i}`} />
                    <Input placeholder="Email" value={c.email} onChange={e => { const cs = [...(stepData.contacts || [{ name: "", email: "", phone: "", role: "primary" }])]; cs[i] = { ...cs[i], email: e.target.value }; setStepData(d => ({ ...d, contacts: cs })); }} />
                    <Input placeholder="Phone" value={c.phone} onChange={e => { const cs = [...(stepData.contacts || [{ name: "", email: "", phone: "", role: "primary" }])]; cs[i] = { ...cs[i], phone: e.target.value }; setStepData(d => ({ ...d, contacts: cs })); }} />
                    <Select value={c.role} onValueChange={v => { const cs = [...(stepData.contacts || [{ name: "", email: "", phone: "", role: "primary" }])]; cs[i] = { ...cs[i], role: v }; setStepData(d => ({ ...d, contacts: cs })); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="primary">Primary</SelectItem><SelectItem value="billing">Billing</SelectItem><SelectItem value="technical">Technical</SelectItem></SelectContent>
                    </Select>
                    {i > 0 && <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-red-400" onClick={() => { const cs = (stepData.contacts || []).filter((_, j) => j !== i); setStepData(d => ({ ...d, contacts: cs })); }}><Trash2 className="w-3 h-3" /></Button>}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setStepData(d => ({ ...d, contacts: [...(d.contacts || [{ name: "", email: "", phone: "", role: "primary" }]), { name: "", email: "", phone: "", role: "technical" }] }))}><Plus className="w-3 h-3 mr-1" />Add Contact</Button>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Register initial devices for RMM monitoring.</p>
                {(stepData.devices || [{ hostname: "", type: "workstation", os: "", ip: "" }]).map((d, i) => (
                  <div key={i} className="grid grid-cols-[1fr_120px_120px_120px_32px] gap-2 items-end">
                    <Input placeholder="Hostname" value={d.hostname} onChange={e => { const ds = [...(stepData.devices || [{ hostname: "", type: "workstation", os: "", ip: "" }])]; ds[i] = { ...ds[i], hostname: e.target.value }; setStepData(s => ({ ...s, devices: ds })); }} data-testid={`device-hostname-${i}`} />
                    <Select value={d.type} onValueChange={v => { const ds = [...(stepData.devices || [{ hostname: "", type: "workstation", os: "", ip: "" }])]; ds[i] = { ...ds[i], type: v }; setStepData(s => ({ ...s, devices: ds })); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="workstation">Workstation</SelectItem><SelectItem value="server">Server</SelectItem><SelectItem value="laptop">Laptop</SelectItem><SelectItem value="router">Router</SelectItem><SelectItem value="switch">Switch</SelectItem></SelectContent>
                    </Select>
                    <Input placeholder="OS" value={d.os} onChange={e => { const ds = [...(stepData.devices || [{ hostname: "", type: "workstation", os: "", ip: "" }])]; ds[i] = { ...ds[i], os: e.target.value }; setStepData(s => ({ ...s, devices: ds })); }} />
                    <Input placeholder="IP" value={d.ip} onChange={e => { const ds = [...(stepData.devices || [{ hostname: "", type: "workstation", os: "", ip: "" }])]; ds[i] = { ...ds[i], ip: e.target.value }; setStepData(s => ({ ...s, devices: ds })); }} />
                    {i > 0 && <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-red-400" onClick={() => { const ds = (stepData.devices || []).filter((_, j) => j !== i); setStepData(s => ({ ...s, devices: ds })); }}><Trash2 className="w-3 h-3" /></Button>}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setStepData(d => ({ ...d, devices: [...(d.devices || [{ hostname: "", type: "workstation", os: "", ip: "" }]), { hostname: "", type: "workstation", os: "", ip: "" }] }))}><Plus className="w-3 h-3 mr-1" />Add Device</Button>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2"><input type="checkbox" checked={stepData.create_contract || false} onChange={e => setStepData(d => ({ ...d, create_contract: e.target.checked }))} /><Label>Create service contract</Label></div>
                {stepData.create_contract && (
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Contract Name</Label><Input value={stepData.contract_name || ""} onChange={e => setStepData(d => ({ ...d, contract_name: e.target.value }))} placeholder="Managed IT Services" /></div>
                    <div><Label>Type</Label>
                      <Select value={stepData.contract_type || "managed"} onValueChange={v => setStepData(d => ({ ...d, contract_type: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="managed">Managed</SelectItem><SelectItem value="break_fix">Break/Fix</SelectItem><SelectItem value="project">Project</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div><Label>Monthly Value ($)</Label><Input type="number" value={stepData.monthly_value || ""} onChange={e => setStepData(d => ({ ...d, monthly_value: parseFloat(e.target.value) || 0 }))} placeholder="500" /></div>
                    <div><Label>Billing Cycle</Label>
                      <Select value={stepData.billing_cycle || "monthly"} onValueChange={v => setStepData(d => ({ ...d, billing_cycle: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="annual">Annual</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Configure monitoring thresholds for this client's devices.</p>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>CPU Alert (%)</Label><Input type="number" value={stepData.cpu_threshold || 85} onChange={e => setStepData(d => ({ ...d, cpu_threshold: parseInt(e.target.value) || 85 }))} /></div>
                  <div><Label>Memory Alert (%)</Label><Input type="number" value={stepData.memory_threshold || 90} onChange={e => setStepData(d => ({ ...d, memory_threshold: parseInt(e.target.value) || 90 }))} /></div>
                  <div><Label>Disk Alert (%)</Label><Input type="number" value={stepData.disk_threshold || 80} onChange={e => setStepData(d => ({ ...d, disk_threshold: parseInt(e.target.value) || 80 }))} /></div>
                </div>
                <div className="flex items-center gap-2"><input type="checkbox" checked={stepData.enable_predictive !== false} onChange={e => setStepData(d => ({ ...d, enable_predictive: e.target.checked }))} /><Label>Enable predictive maintenance alerts</Label></div>
                <div className="flex items-center gap-2"><input type="checkbox" checked={stepData.enable_auto_ticket !== false} onChange={e => setStepData(d => ({ ...d, enable_auto_ticket: e.target.checked }))} /><Label>Auto-create tickets for critical alerts</Label></div>
              </div>
            )}

            {step === 6 && (
              <div className="space-y-4 text-center">
                <Zap className="w-12 h-12 text-amber-400 mx-auto" />
                <h3 className="text-xl font-bold">Ready to Go Live!</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">Review the onboarding steps above. Click "Complete" to finalize the client onboarding and activate all services.</p>
                <div className="grid grid-cols-3 gap-3 max-w-md mx-auto text-left">
                  {STEPS.slice(0, 5).map(s => {
                    const stepKey = Object.keys(activeSession.steps || {})[s.num - 1];
                    const done = activeSession.steps?.[stepKey]?.status === "completed";
                    return (
                      <div key={s.num} className={`p-2 rounded border text-center ${done ? "border-emerald-500/30" : "border-amber-500/30"}`}>
                        <p className="text-[10px] font-bold">{s.title}</p>
                        {done ? <CheckCircle className="w-4 h-4 text-emerald-400 mx-auto" /> : <Badge className="text-[9px] bg-amber-500/20 text-amber-400 mt-1">Skipped</Badge>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button variant="outline" disabled={step <= 1} onClick={() => setActiveSession(s => ({ ...s, current_step: Math.max(1, s.current_step - 1) }))}><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <div className="flex gap-2">
            {step < 6 && <Button variant="outline" onClick={() => setActiveSession(s => ({ ...s, current_step: Math.min(6, s.current_step + 1) }))}>Skip</Button>}
            <Button onClick={completeStep} disabled={saving} data-testid="complete-step-btn">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : step === 6 ? <Zap className="w-4 h-4 mr-1" /> : <ArrowRight className="w-4 h-4 mr-1" />}
              {step === 6 ? "Complete Onboarding" : "Next Step"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // SESSION LIST
  return (
    <div className="space-y-5" data-testid="onboarding-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Shield className="w-8 h-8 text-primary" />Client Onboarding</h1>
          <p className="text-muted-foreground">{sessions.length} onboarding sessions</p>
        </div>
        <Button onClick={startNew} data-testid="start-onboarding-btn"><Plus className="w-4 h-4 mr-1" />New Onboarding</Button>
      </div>

      {sessions.length === 0 ? (
        <Card className="border-dashed"><CardContent className="py-12 text-center">
          <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-30" />
          <p className="text-lg font-bold mb-1">No Onboarding Sessions</p>
          <p className="text-sm text-muted-foreground mb-4">Start a new client onboarding to provision everything in one flow.</p>
          <Button onClick={startNew}><Plus className="w-4 h-4 mr-1" />Start Onboarding</Button>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {sessions.map(s => {
            const completedSteps = Object.values(s.steps || {}).filter(v => v.status === "completed").length;
            return (
              <Card key={s.id} className={`cursor-pointer hover:border-primary/30 transition-all ${s.status === "completed" ? "border-emerald-500/20" : ""}`}
                onClick={() => s.status === "completed" ? null : loadSession(s.id)} data-testid={`session-${s.id}`}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm font-bold">{s.id}</span>
                    <Badge className={s.status === "completed" ? "bg-emerald-500/20 text-emerald-400" : "bg-blue-500/20 text-blue-400"}>{s.status}</Badge>
                  </div>
                  <Progress value={(completedSteps / 6) * 100} className="h-1.5 mb-2" />
                  <p className="text-xs text-muted-foreground">{completedSteps}/6 steps completed</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Started {s.created_at?.slice(0, 10)} by {s.created_by}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
