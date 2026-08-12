import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
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
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleting, setDeleting] = useState(false);

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
    setDeleting(true);
    try {
      await axios.delete(`${API}/tech-roster/${tech.id}`, { headers });
      toast.success(`${tech.name} removed from on-call coverage`);
      setDeleteCandidate(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setDeleting(false); }
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
    <div className="space-y-4" data-testid="tech-roster-page">
      <div className="flex flex-col gap-4 rounded-xl border border-rose-500/20 bg-gradient-to-r from-rose-500/[0.08] via-background to-background p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/25 bg-rose-500/10"><Radio className="h-5 w-5 text-rose-300" /></div>
          <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">On-call coverage and escalation</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Technicians available for War Room paging. Tiered escalation fires Tier 1 → 2 → 3 with ack tracking.
          </p>
          </div>
        </div>
        <Button onClick={openCreate} size="sm" className="bg-rose-500 text-white hover:bg-rose-400" data-testid="tech-roster-add-btn">
          <Plus className="mr-1.5 h-4 w-4" /> Add roster contact
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {[1, 2, 3].map((tier) => (
          <Card key={tier} className={`overflow-hidden border-border bg-card/70 shadow-sm ${tier === 1 ? "border-t-2 border-t-rose-400" : tier === 2 ? "border-t-2 border-t-amber-400" : "border-t-2 border-t-cyan-400"}`}>
            <CardContent className="p-4">
              <div className={`text-[10px] uppercase tracking-widest font-semibold mb-3 flex items-center gap-2 ${tier === 1 ? "text-rose-400" : tier === 2 ? "text-amber-400" : "text-sky-400"}`}>
                <Users className="w-3 h-3" /> Tier {tier} · {tiers[tier].length}
              </div>
              {tiers[tier].length === 0 ? (
                <div className="text-xs text-zinc-500 py-6 text-center">No techs in this tier</div>
              ) : tiers[tier].map((t) => (
                <div key={t.id} className="flex items-center justify-between border-b border-border py-2 last:border-0">
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
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-400" onClick={() => setDeleteCandidate(t)} data-testid={`tech-delete-${t.id}`}><Trash2 className="w-3 h-3" /></Button>
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
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-400" onClick={() => setDeleteCandidate(t)}><Trash2 className="w-3 h-3" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <NexusWorkflowDialog eyebrow="Team operations" title={editing ? "Edit roster contact" : "Add roster contact"} description="Configure escalation position, active on-call status and the notification channels used for paging. This controls on-call coverage, not the technician’s NexusMSP account access." icon={Radio} tone="amber" className="max-w-2xl" contentClassName="space-y-4" data-testid="tech-roster-dialog" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={saving || !form.name.trim()} data-testid="tech-form-save">{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}{editing ? "Save contact" : "Add to roster"}</Button></>}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="roster-name">Name *</Label>
                <Input id="roster-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="tech-form-name" />
              </div>
              <div>
                <Label htmlFor="roster-role">Role</Label>
                <Input id="roster-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="L2 Engineer" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="roster-email">Email</Label>
                <Input id="roster-email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="tech@msp.com" />
              </div>
              <div>
                <Label htmlFor="roster-mobile">Mobile</Label>
                <Input id="roster-mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="+61 4…" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="roster-slack">Slack handle</Label>
                <Input id="roster-slack" value={form.slack_handle} onChange={(e) => setForm({ ...form, slack_handle: e.target.value })} placeholder="U012ABC" />
              </div>
              <div>
                <Label htmlFor="roster-teams">Teams email</Label>
                <Input id="roster-teams" value={form.teams_email} onChange={(e) => setForm({ ...form, teams_email: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="roster-tier">Escalation tier</Label>
                <Select value={String(form.escalation_tier || 2)} onValueChange={(v) => setForm({ ...form, escalation_tier: parseInt(v) })}>
                  <SelectTrigger id="roster-tier" aria-label="Escalation tier" data-testid="tech-form-tier"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Tier 1 — first responders</SelectItem>
                    <SelectItem value="2">Tier 2 — backup</SelectItem>
                    <SelectItem value="3">Tier 3 — last resort</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-6 pb-1">
                <div className="flex items-center gap-2">
                  <Switch id="roster-on-call" aria-label="On-call" checked={form.on_call} onCheckedChange={(v) => setForm({ ...form, on_call: v })} data-testid="tech-form-oncall" />
                  <Label htmlFor="roster-on-call" className="text-xs">On-call</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="roster-active" aria-label="Active" checked={form.active !== false} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                  <Label htmlFor="roster-active" className="text-xs">Active</Label>
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
                      className={`px-3 py-1.5 rounded-md border text-xs flex items-center gap-1.5 transition-colors ${on ? "bg-sky-500/10 border-sky-500/40 text-sky-700 dark:text-sky-300" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"}`}
                      data-testid={`tech-channel-${key}`}
                    >
                      <Icon className="w-3 h-3" /> {label}
                    </button>
                  );
                })}
              </div>
            </div>
        </NexusWorkflowDialog>
      </Dialog>
      <Dialog open={!!deleteCandidate} onOpenChange={(isOpen) => !isOpen && setDeleteCandidate(null)}>
        <DialogContent className="max-w-md border-rose-500/25 bg-background" data-testid="delete-roster-contact-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Trash2 className="h-5 w-5 text-rose-300" />Remove roster contact?</DialogTitle>
            <DialogDescription><span className="font-medium text-foreground">{deleteCandidate?.name}</span> will no longer be selected for War Room paging. This does not delete their NexusMSP team account or historic activity.</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.06] p-3 text-xs leading-relaxed text-rose-100/85">Use this only when the contact should no longer be part of the escalation chain. The removal is retained in the organisation audit history.</div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteCandidate(null)}>Keep contact</Button>
            <Button variant="destructive" disabled={deleting} onClick={() => remove(deleteCandidate)} data-testid="delete-roster-contact-submit">{deleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Remove from roster</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
