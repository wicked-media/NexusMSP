import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Users, Plus, Trash2, Phone, Mail, MessageSquare, Bell, Edit2, Loader2, Radio } from "lucide-react";

const TIER_CLS = {
  1: "text-rose-400 border-rose-500/40 bg-rose-500/10",
  2: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  3: "text-sky-400 border-sky-500/40 bg-sky-500/10",
};

const CHANNELS = [
  { key: "slack", label: "Slack", icon: MessageSquare },
  { key: "teams", label: "Teams", icon: MessageSquare },
  { key: "sms", label: "SMS", icon: Phone },
  { key: "email", label: "Email", icon: Mail },
  { key: "push", label: "In-app", icon: Bell },
];

const EMPTY = {
  name: "", email: "", mobile: "", role: "", slack_handle: "", teams_email: "",
  escalation_tier: 2, on_call: false, active: true, preferred_channels: ["email", "push"],
};

export default function TechRosterPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [techs, setTechs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/tech-roster`, { headers });
      setTechs(res.data || []);
    } catch (e) { toast.error("Load failed"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (t) => { setEditing(t); setForm({ ...EMPTY, ...t }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    setSaving(true);
    try {
      if (editing) {
        await axios.put(`${API}/tech-roster/${editing.id}`, form, { headers });
        toast.success("Tech updated");
      } else {
        await axios.post(`${API}/tech-roster`, form, { headers });
        toast.success("Tech added");
      }
      setOpen(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  const remove = async (tech) => {
    if (!window.confirm(`Remove ${tech.name} from roster?`)) return;
    try {
      await axios.delete(`${API}/tech-roster/${tech.id}`, { headers });
      toast.success("Removed"); load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const toggleChannel = (k) => {
    setForm((f) => {
      const has = f.preferred_channels?.includes(k);
      return { ...f, preferred_channels: has ? f.preferred_channels.filter((c) => c !== k) : [...(f.preferred_channels || []), k] };
    });
  };

  const tiers = { 1: [], 2: [], 3: [] };
  techs.forEach((t) => { tiers[t.escalation_tier || 2]?.push(t); });

  return (
    <div className="p-6 space-y-5" data-testid="tech-roster-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-light tracking-tight flex items-center gap-3">
            <Radio className="w-7 h-7 text-rose-500" />
            On-Call Roster
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Technicians available for War Room paging. Tiered escalation fires Tier 1 → 2 → 3 with ack tracking.
          </p>
        </div>
        <Button onClick={openCreate} variant="outline" className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10" data-testid="tech-roster-add-btn">
          <Plus className="w-4 h-4 mr-1" /> Add Technician
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map((tier) => (
          <Card key={tier} className="border-zinc-800">
            <CardContent className="p-4">
              <div className={`text-[10px] uppercase tracking-widest font-semibold mb-3 flex items-center gap-2 ${tier === 1 ? "text-rose-400" : tier === 2 ? "text-amber-400" : "text-sky-400"}`}>
                <Users className="w-3 h-3" /> Tier {tier} · {tiers[tier].length}
              </div>
              {tiers[tier].length === 0 ? (
                <div className="text-xs text-zinc-500 py-6 text-center">No techs in this tier</div>
              ) : tiers[tier].map((t) => (
                <div key={t.id} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2">
                      {t.name}
                      {t.on_call && <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-500/30">ON-CALL</Badge>}
                      {!t.active && <Badge variant="outline" className="text-[9px] text-zinc-500">inactive</Badge>}
                    </div>
                    <div className="text-[10px] text-zinc-500 truncate">{t.role || t.email || t.mobile || "—"}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(t)} data-testid={`tech-edit-${t.id}`}><Edit2 className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-400" onClick={() => remove(t)} data-testid={`tech-delete-${t.id}`}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading…</div>
          ) : techs.length === 0 ? (
            <div className="p-16 text-center text-sm text-muted-foreground">
              No technicians yet. Add your first one to enable War Room paging.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Channels</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>On-Call</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {techs.map((t) => (
                  <TableRow key={t.id} data-testid={`tech-row-${t.id}`}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.role || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className={TIER_CLS[t.escalation_tier || 2]}>T{t.escalation_tier || 2}</Badge></TableCell>
                    <TableCell className="text-[10px] font-mono">{(t.preferred_channels || []).join(" · ")}</TableCell>
                    <TableCell className="text-xs font-mono">{t.mobile || "—"}</TableCell>
                    <TableCell>{t.on_call ? <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 text-[9px]">ON-CALL</Badge> : <span className="text-zinc-500 text-xs">—</span>}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(t)}><Edit2 className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-400" onClick={() => remove(t)}><Trash2 className="w-3 h-3" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl" data-testid="tech-roster-dialog">
          <DialogHeader><DialogTitle>{editing ? "Edit Technician" : "Add Technician"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="tech-form-name" />
              </div>
              <div>
                <Label>Role</Label>
                <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="L2 Engineer" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="tech@msp.com" />
              </div>
              <div>
                <Label>Mobile</Label>
                <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="+61 4…" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Slack handle</Label>
                <Input value={form.slack_handle} onChange={(e) => setForm({ ...form, slack_handle: e.target.value })} placeholder="U012ABC" />
              </div>
              <div>
                <Label>Teams email</Label>
                <Input value={form.teams_email} onChange={(e) => setForm({ ...form, teams_email: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Escalation tier</Label>
                <Select value={String(form.escalation_tier || 2)} onValueChange={(v) => setForm({ ...form, escalation_tier: parseInt(v) })}>
                  <SelectTrigger data-testid="tech-form-tier"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Tier 1 — first responders</SelectItem>
                    <SelectItem value="2">Tier 2 — backup</SelectItem>
                    <SelectItem value="3">Tier 3 — last resort</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-6 pb-1">
                <div className="flex items-center gap-2">
                  <Switch checked={form.on_call} onCheckedChange={(v) => setForm({ ...form, on_call: v })} data-testid="tech-form-oncall" />
                  <Label className="text-xs">On-call</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.active !== false} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                  <Label className="text-xs">Active</Label>
                </div>
              </div>
            </div>
            <div>
              <Label>Preferred channels</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {CHANNELS.map(({ key, label, icon: Icon }) => {
                  const on = form.preferred_channels?.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleChannel(key)}
                      className={`px-3 py-1.5 rounded-md border text-xs flex items-center gap-1.5 transition-colors ${on ? "bg-sky-500/10 border-sky-500/40 text-sky-300" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"}`}
                      data-testid={`tech-channel-${key}`}
                    >
                      <Icon className="w-3 h-3" /> {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.name.trim()} variant="outline" className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10" data-testid="tech-form-save">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              {editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
