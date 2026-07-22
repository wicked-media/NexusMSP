import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Tags } from "lucide-react";
import { toast } from "sonner";

const empty = { name: "", code: "", description: "", color: "blue", default_billing_frequency: "monthly", default_sla_tier: "standard", is_active: true };
const colors = {
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  slate: "border-slate-500/30 bg-slate-500/10 text-slate-300",
};
const codeFromName = value => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export default function ContractTypesSettings() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [types, setTypes] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [codeTouched, setCodeTouched] = useState(false);
  const [form, setForm] = useState(empty);

  const load = () => axios.get(`${API}/contract-types?include_inactive=true`, { headers }).then(r => setTypes(r.data)).catch(() => toast.error("Could not load contract types"));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    try {
      if (editing) await axios.put(`${API}/contract-types/${editing.id}`, form, { headers });
      else await axios.post(`${API}/contract-types`, form, { headers });
      toast.success(editing ? "Contract type updated" : "Contract type added");
      setOpen(false);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not save contract type"); }
  };
  const edit = item => { setEditing(item); setCodeTouched(true); setForm({ ...empty, ...item }); setOpen(true); };
  const create = () => { setEditing(null); setCodeTouched(false); setForm(empty); setOpen(true); };
  const updateName = name => setForm(current => ({ ...current, name, code: !editing && !codeTouched ? codeFromName(name) : current.code }));

  return <Card id="contract-types-card" data-testid="contract-types-settings">
    <CardHeader className="flex flex-row items-start justify-between gap-3">
      <div><CardTitle className="flex items-center gap-2"><Tags className="h-4 w-4 text-violet-300" />Contract types</CardTitle><CardDescription>Set the agreement labels, billing defaults, SLA, and visual identity used by your contracts.</CardDescription></div>
      <Button size="sm" onClick={create}><Plus className="mr-1 h-3.5 w-3.5" />Add type</Button>
    </CardHeader>
    <CardContent className="space-y-2">
      {types.map(item => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={colors[item.color] || colors.blue}>{item.name}</Badge><span className="font-mono text-[10px] text-muted-foreground">{item.code}</span>{!item.is_active && <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>}</div><p className="mt-1.5 text-xs text-muted-foreground">{item.description || "No description"} · Defaults to {item.default_billing_frequency} · {item.default_sla_tier} SLA</p></div>
        <Button size="icon" variant="ghost" onClick={() => edit(item)} aria-label={`Edit ${item.name}`}><Pencil className="h-4 w-4" /></Button>
      </div>)}
    </CardContent>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? "Edit contract type" : "Add contract type"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3"><div><Label>Name</Label><Input value={form.name} onChange={e => updateName(e.target.value)} placeholder="e.g. Hardware finance" /></div><div><Label>Stable code</Label><Input disabled={!!editing} value={form.code} onChange={e => { setCodeTouched(true); setForm({ ...form, code: codeFromName(e.target.value) }); }} placeholder="hardware_finance" /><p className="mt-1 text-[10px] text-muted-foreground">Generated from the name; it cannot change after saving.</p></div></div>
          <div><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="How this agreement is used" /></div>
          <div className="grid grid-cols-3 gap-3"><div><Label>Colour</Label><Select value={form.color} onValueChange={v => setForm({ ...form, color: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.keys(colors).map(color => <SelectItem key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</SelectItem>)}</SelectContent></Select></div><div><Label>Default billing</Label><Select value={form.default_billing_frequency} onValueChange={v => setForm({ ...form, default_billing_frequency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="annually">Annually</SelectItem></SelectContent></Select></div><div><Label>Default SLA</Label><Select value={form.default_sla_tier} onValueChange={v => setForm({ ...form, default_sla_tier: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="standard">Standard</SelectItem><SelectItem value="silver">Silver</SelectItem><SelectItem value="gold">Gold</SelectItem><SelectItem value="platinum">Platinum</SelectItem></SelectContent></Select></div></div>
          <div className="flex items-center justify-between rounded-lg border p-3"><div><Label>Available for new contracts</Label><p className="text-xs text-muted-foreground">Deactivate a type rather than deleting history.</p></div><Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={!form.name || !form.code}>Save type</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>;
}
