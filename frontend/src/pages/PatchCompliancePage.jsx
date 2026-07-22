import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Clock3, Layers3, Loader2, Monitor, Plus, RefreshCw, ShieldCheck, Trash2, XCircle } from "lucide-react";

const blankPolicy = { name: "", os_filter: "All operating systems", severity_filter: "security", ring: "", delay_days: 7, auto_approve: false, enabled: true, notes: "" };
const statusTone = (status) => ({ current: "border-emerald-500/30 text-emerald-200", needs_attention: "border-amber-500/30 text-amber-200", not_assessed: "border-slate-500/30 text-slate-200" }[status] || "border-slate-500/30 text-slate-200");
const statusLabel = (status) => ({ current: "Current", needs_attention: "Needs attention", not_assessed: "Not assessed" }[status] || "Not assessed");

function MetricTile({ icon: Icon, label, value, tone = "sky" }) {
  const tones = { sky: "bg-sky-500/10 text-sky-300", emerald: "bg-emerald-500/10 text-emerald-300", amber: "bg-amber-500/10 text-amber-300", red: "bg-red-500/10 text-red-300" };
  return <Card className="border-border/60 bg-card/80 shadow-sm"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-medium uppercase tracking-[0.13em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p></div><div className={`rounded-xl p-2 ${tones[tone]}`}><Icon className="h-4 w-4" /></div></div></CardContent></Card>;
}

export default function PatchCompliancePage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [rings, setRings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [policy, setPolicy] = useState(blankPolicy);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const [overview, rolloutGroups] = await Promise.all([
        axios.get(`${API}/patch-compliance/overview`, { headers }),
        axios.get(`${API}/patch-compliance/rings`, { headers }),
      ]);
      setData(overview.data);
      setRings(rolloutGroups.data || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Patch Compliance could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const createPolicy = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/patch-compliance/policies`, policy, { headers });
      toast.success("Patch policy record saved. It is not deployed until an execution provider is connected.");
      setPolicy(blankPolicy);
      setFormOpen(false);
      await load(true);
    } catch (error) {
      toast.error(error.response?.data?.detail || "The policy record could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const removePolicy = async (id) => {
    if (!window.confirm("Remove this confirmed policy record? This does not alter any external patch tool.")) return;
    setRemovingId(id);
    try {
      await axios.delete(`${API}/patch-compliance/policies/${id}`, { headers });
      toast.success("Policy record removed.");
      await load(true);
    } catch (error) {
      toast.error(error.response?.data?.detail || "The policy record could not be removed.");
    } finally {
      setRemovingId("");
    }
  };

  if (loading || !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>;

  const { summary = {}, policies = [], devices = [], message } = data;
  const compliance = Number.isFinite(summary.compliance_pct) ? `${summary.compliance_pct}%` : "—";

  return <div className="space-y-5" data-testid="patch-compliance-page">
    <OperationalPageHeader eyebrow="Managed assets - patch evidence" title="Patch Compliance" description="Review trusted agent patch observations and maintain an auditable policy register. Policy records are not a patch deployment engine until an execution provider is connected." icon={ShieldCheck} tone="sky" actions={<><Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}><RefreshCw className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh evidence</Button><Button size="sm" onClick={() => { setPolicy(blankPolicy); setFormOpen(true); }}><Plus className="mr-1 h-4 w-4" />Add policy record</Button></>} />

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><MetricTile icon={ShieldCheck} label="Verified current" value={compliance} tone="emerald" /><MetricTile icon={Monitor} label="Assessed endpoints" value={summary.assessed_devices || 0} /><MetricTile icon={CheckCircle2} label="Current" value={summary.compliant || 0} tone="emerald" /><MetricTile icon={AlertTriangle} label="Needs attention" value={summary.needs_attention || 0} tone="amber" /><MetricTile icon={Layers3} label="Policy records" value={policies.length} /></div>

    <Card className="border-sky-500/20 bg-sky-500/[0.035]"><CardContent className="flex gap-2 p-4 text-sm text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" /><span>{message || "Patch evidence is not available yet."} {summary.legacy_unverified_policies ? `${summary.legacy_unverified_policies} historical unverified policy record(s) are intentionally excluded from the active register.` : ""}</span></CardContent></Card>

    <Card className="border-border/60"><CardHeader className="flex-row items-start justify-between gap-3 space-y-0"><div><CardTitle className="flex items-center gap-2 text-base"><Layers3 className="h-4 w-4 text-sky-300" />Rollout groups</CardTitle><p className="mt-1 text-sm text-muted-foreground">Groups are derived from confirmed policy records. Device membership is shown only when the asset reports a matching ring.</p></div><Badge variant="outline">{rings.length} configured</Badge></CardHeader><CardContent>{!rings.length ? <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No rollout groups are configured. Add a confirmed policy record with a ring name to create one; NexusMSP will not invent a sample deployment structure.</div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rings.map((ring) => <div key={ring.id} className="rounded-xl border border-border/60 bg-muted/15 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{ring.name}</p><p className="mt-1 text-xs text-muted-foreground">{ring.description}</p></div><Badge variant="outline">{ring.device_count} endpoints</Badge></div><div className="mt-3 flex items-center justify-between text-xs"><span className="flex items-center gap-1 text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />{ring.delay_days} day delay</span><span>{ring.auto_approve ? "Approval rule recorded" : "Manual approval"}</span></div></div>)}</div>}</CardContent></Card>

    <Card className="border-border/60"><CardHeader className="flex-row items-start justify-between gap-3 space-y-0"><div><CardTitle className="text-base">Patch policy register</CardTitle><p className="mt-1 text-sm text-muted-foreground">These records capture intended rules and approval boundaries. They are not marked as enforced until a patch execution provider is connected.</p></div><Badge variant="outline">{policies.length} confirmed</Badge></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Policy</TableHead><TableHead>Scope</TableHead><TableHead>Rollout group</TableHead><TableHead>Delay</TableHead><TableHead>Approval</TableHead><TableHead>State</TableHead><TableHead className="text-right" /></TableRow></TableHeader><TableBody>{!policies.length ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No confirmed patch policy records. Add one when you are ready to document the intended rollout rule.</TableCell></TableRow> : policies.map((item) => <TableRow key={item.id}><TableCell><p className="font-medium">{item.name}</p>{item.notes && <p className="mt-1 max-w-sm truncate text-xs text-muted-foreground">{item.notes}</p>}</TableCell><TableCell><p>{item.os_filter}</p><p className="text-xs text-muted-foreground">{item.severity_filter}</p></TableCell><TableCell>{item.ring || "Unassigned"}</TableCell><TableCell>{item.delay_days} days</TableCell><TableCell>{item.auto_approve ? "Rule recorded" : "Manual"}</TableCell><TableCell><Badge variant="outline" className="border-amber-500/30 text-amber-200">Not deployed</Badge></TableCell><TableCell className="text-right"><Button variant="ghost" size="icon" aria-label={`Remove ${item.name}`} onClick={() => removePolicy(item.id)} disabled={removingId === item.id}>{removingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-muted-foreground" />}</Button></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>

    <Card className="border-border/60"><CardHeader><CardTitle className="text-base">Agent-reported patch state</CardTitle><p className="mt-1 text-sm text-muted-foreground">“Current” is only shown after a trusted agent reports a zero pending-patch count. Endpoints without patch evidence remain not assessed.</p></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Endpoint</TableHead><TableHead>Customer</TableHead><TableHead>Operating system</TableHead><TableHead>Pending updates</TableHead><TableHead>Evidence state</TableHead><TableHead>Patch state</TableHead></TableRow></TableHeader><TableBody>{!devices.length ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No agent-enrolled endpoints are reporting patch evidence.</TableCell></TableRow> : devices.slice(0, 100).map((device) => <TableRow key={device.id}><TableCell><p className="font-medium">{device.name}</p><p className="mt-1 text-xs text-muted-foreground">{device.source}</p></TableCell><TableCell>{device.client_name || "—"}</TableCell><TableCell className="max-w-48 truncate">{device.os || "—"}</TableCell><TableCell className="font-mono">{device.pending_patches == null ? "—" : device.pending_patches}</TableCell><TableCell><Badge variant="outline" className={device.assessment_state === "assessed" ? "border-sky-500/30 text-sky-200" : "border-slate-500/30 text-slate-200"}>{device.assessment_state === "assessed" ? "Agent assessed" : "Not assessed"}</Badge></TableCell><TableCell><Badge variant="outline" className={statusTone(device.patch_status)}>{statusLabel(device.patch_status)}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>

    <Dialog open={formOpen} onOpenChange={setFormOpen}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-sky-300" />Add patch policy record</DialogTitle><DialogDescription>Record the intended patch rule and approval boundary. NexusMSP will retain it for audit, but will not deploy updates without a connected execution provider.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><div className="grid gap-2"><Label htmlFor="patch-policy-name">Policy name</Label><Input id="patch-policy-name" value={policy.name} onChange={(event) => setPolicy((current) => ({ ...current, name: event.target.value }))} placeholder="Windows security updates" /></div><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label>Operating-system scope</Label><Select value={policy.os_filter} onValueChange={(value) => setPolicy((current) => ({ ...current, os_filter: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All operating systems">All operating systems</SelectItem><SelectItem value="Windows">Windows</SelectItem><SelectItem value="Windows Server">Windows Server</SelectItem><SelectItem value="macOS">macOS</SelectItem><SelectItem value="Linux">Linux</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label>Update scope</Label><Select value={policy.severity_filter} onValueChange={(value) => setPolicy((current) => ({ ...current, severity_filter: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="security">Security updates</SelectItem><SelectItem value="critical">Critical updates</SelectItem><SelectItem value="all">All updates</SelectItem></SelectContent></Select></div></div><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="patch-ring">Rollout group (optional)</Label><Input id="patch-ring" value={policy.ring} onChange={(event) => setPolicy((current) => ({ ...current, ring: event.target.value }))} placeholder="Pilot" /></div><div className="grid gap-2"><Label htmlFor="patch-delay">Delay (days)</Label><Input id="patch-delay" type="number" min="0" max="365" value={policy.delay_days} onChange={(event) => setPolicy((current) => ({ ...current, delay_days: Number(event.target.value) }))} /></div></div><div className="grid gap-2"><Label htmlFor="patch-notes">Implementation notes</Label><Textarea id="patch-notes" value={policy.notes} onChange={(event) => setPolicy((current) => ({ ...current, notes: event.target.value }))} placeholder="Approval boundary, provider mapping, change window, or exception process." /></div><div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs text-amber-100"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Saving this policy does not enable native patch deployment. Connect and verify the chosen execution provider before relying on this rule operationally.</div></div><DialogFooter><Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button><Button onClick={createPolicy} disabled={saving || !policy.name.trim()}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save policy record</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
