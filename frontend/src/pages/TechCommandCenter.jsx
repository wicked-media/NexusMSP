/**
 * Team Command Center — native, format-consistent rebuild.
 * Matches the Devices Command Center / Clients module aesthetic.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Sparkles, Search, Loader2, Users, Shield, AlertTriangle, Zap, Activity,
  Crown, Lock, Unlock, History, Target, ChevronRight, RefreshCw,
  TrendingUp, ArrowUpRight, ArrowDownRight, ShieldAlert, Flame, UserPlus,
  Mail, Trash2, Edit, Archive, RotateCcw, Send, Calendar, Network, Trophy, BarChart3,
  CheckCircle2, XCircle, Clock,
} from "lucide-react";

// ---------- Constants ----------
const SKILL_AXES = ["networking", "cloud", "security", "endpoints", "backup", "m365", "voip", "hardware"];

const STATE_COLORS = {
  idle:       "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  active:     "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  busy:       "text-amber-300 border-amber-500/30 bg-amber-500/10",
  overloaded: "text-rose-300 border-rose-500/30 bg-rose-500/10",
};

const PERM_COLORS = {
  none:  "bg-zinc-900 text-zinc-700",
  read:  "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30",
  write: "bg-violet-500/20 text-violet-300 border border-violet-500/40",
  admin: "bg-rose-500/20 text-rose-300 border border-rose-500/40",
};
const PERM_INITIAL = { none: "·", read: "R", write: "W", admin: "A" };

const ROLE_OPTIONS = [
  { value: "technician", label: "Technician" },
  { value: "service_desk_manager", label: "Service Desk Manager" },
  { value: "dispatcher", label: "Dispatcher" },
  { value: "admin", label: "Admin" },
];
const COMMAND_TAB_IDS = new Set(["directory", "invites", "find", "capacity", "matrix", "drift", "jit", "audit"]);

// ---------- Skill radar (CSS-only) ----------
function SkillRadar({ skills, size = 84, color = "#a78bfa" }) {
  const cx = size / 2, cy = size / 2;
  const radius = size / 2 - 12;
  const n = SKILL_AXES.length;
  const points = SKILL_AXES.map((axis, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const v = (skills?.[axis] || 0) / 100;
    return [cx + Math.cos(angle) * radius * v, cy + Math.sin(angle) * radius * v];
  });
  const poly = points.map(p => p.join(",")).join(" ");
  const grid = [0.25, 0.5, 0.75, 1].map(scale => SKILL_AXES.map((_, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(angle) * radius * scale, cy + Math.sin(angle) * radius * scale];
  }).map(p => p.join(",")).join(" "));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {grid.map((g, i) => <polygon key={i} points={g} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />)}
      <polygon points={poly} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1.4} />
    </svg>
  );
}

// ---------- DIRECTORY TAB ----------
function DirectoryTab({ headers, capacity, presets, onChanged }) {
  const [search, setSearch] = useState("");
  const [filterTitle, setFilterTitle] = useState("all");
  const [filterStatus, setFilterStatus] = useState("active");
  const [editing, setEditing] = useState(null);
  const techs = useMemo(() => capacity?.techs || [], [capacity?.techs]);

  const titles = useMemo(() => Array.from(new Set(techs.map(t => t.job_title).filter(Boolean))), [techs]);

  const filtered = useMemo(() => {
    return techs.filter(t => {
      if (filterTitle !== "all" && t.job_title !== filterTitle) return false;
      if (filterStatus === "active" && t.archived) return false;
      if (filterStatus === "archived" && !t.archived) return false;
      if (search) {
        const q = search.toLowerCase();
        return (t.name || "").toLowerCase().includes(q) || (t.email || "").toLowerCase().includes(q);
      }
      return true;
    });
  }, [techs, filterTitle, filterStatus, search]);

  return (
    <div className="space-y-4" data-testid="directory-tab">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input className="pl-9" placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} data-testid="directory-search" />
        </div>
        <Select value={filterTitle} onValueChange={setFilterTitle}>
          <SelectTrigger className="w-[180px]" data-testid="directory-title-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {titles.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]" data-testid="directory-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tech grid — same style as Devices grid */}
      {filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-zinc-500">No technicians match those filters.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(t => (
            <TechCard key={t.id} tech={t} onEdit={() => setEditing(t)} headers={headers} onChanged={onChanged} />
          ))}
        </div>
      )}

      <EditTechDialog tech={editing} onClose={() => setEditing(null)} headers={headers} presets={presets} onChanged={onChanged} />
    </div>
  );
}

function TechCard({ tech, onEdit, headers, onChanged }) {
  const wl = tech.workload || {};
  const stateClass = STATE_COLORS[wl.state] || STATE_COLORS.active;

  const archive = async () => {
    if (!window.confirm(`Archive ${tech.name}?`)) return;
    try {
      await axios.post(`${API}/technicians/${tech.id}/archive`, {}, { headers });
      toast.success(`${tech.name} archived`);
      onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  return (
    <Card className="bg-zinc-950/60 border-zinc-800 hover:border-violet-500/40 transition-colors" data-testid={`tech-card-${tech.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <div className="w-12 h-12 rounded-md bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 flex items-center justify-center text-white font-bold">
              {(tech.name || "?").slice(0, 2).toUpperCase()}
            </div>
            {tech.on_call_status && <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-zinc-950 animate-pulse" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-zinc-100 truncate">{tech.name}</span>
              {tech.is_admin && <Crown className="w-3 h-3 text-amber-400" />}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono truncate">{tech.job_title || "Technician"}</div>
            <div className="text-[10px] text-zinc-500 truncate">{tech.email}</div>
            <div className="flex flex-wrap gap-1 mt-1">
              <Badge variant="outline" className={`text-[9px] uppercase ${stateClass}`}>{wl.state || "idle"} · {wl.utilization_pct ?? 0}%</Badge>
            </div>
          </div>
          <SkillRadar skills={tech.skills} size={64} />
        </div>

        <div className="mt-3 pt-3 border-t border-zinc-900 grid grid-cols-3 gap-2 text-center">
          <div><div className="text-base font-bold text-cyan-300 font-mono">{wl.open_tickets ?? 0}</div><div className="text-[9px] uppercase tracking-widest text-zinc-500">open</div></div>
          <div><div className={`text-base font-bold font-mono ${wl.overdue ? "text-rose-300" : "text-zinc-400"}`}>{wl.overdue ?? 0}</div><div className="text-[9px] uppercase tracking-widest text-zinc-500">overdue</div></div>
          <div><div className="text-base font-bold text-emerald-300 font-mono">{tech.on_call_status ? "ON" : "—"}</div><div className="text-[9px] uppercase tracking-widest text-zinc-500">on-call</div></div>
        </div>

        <div className="mt-3 flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-[10px] flex-1" onClick={onEdit} data-testid={`tech-edit-${tech.id}`}><Edit className="w-3 h-3 mr-1" />Edit</Button>
          <Button size="sm" variant="ghost" className="h-7 text-[10px] text-rose-400" onClick={archive} data-testid={`tech-archive-${tech.id}`}><Archive className="w-3 h-3" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- ADD USER (direct create) DIALOG ----------
function AddUserDialog({ open, onClose, onCreated, headers, presets }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", job_title: "L1 Technician", role: "technician", hourly_rate: 75, password: "", is_admin: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm({ name: "", email: "", phone: "", job_title: "L1 Technician", role: "technician", hourly_rate: 75, password: "", is_admin: false });
  }, [open]);

  const submit = async () => {
    if (!form.name.trim() || !form.email.trim() || form.password.length < 12) {
      toast.error("Name, email and an initial password of at least 12 characters are required");
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/technicians`, {
        ...form,
        password: form.password,
        permissions: presets[form.job_title] || undefined,
      }, { headers });
      toast.success(`${form.name} added`);
      onCreated?.();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Add failed"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" data-testid="add-user-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="w-5 h-5 text-emerald-400" />Add User</DialogTitle>
          <DialogDescription>Create a tech account immediately. They can sign in with the password you set.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Full name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Jane Smith" data-testid="add-user-name" /></div>
            <div><Label className="text-xs">Email *</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="jane@nexusops.io" data-testid="add-user-email" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+64 21 …" data-testid="add-user-phone" /></div>
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}>
                <SelectTrigger data-testid="add-user-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Job title (drives permission preset)</Label>
              <Select value={form.job_title} onValueChange={v => setForm({ ...form, job_title: v })}>
                <SelectTrigger data-testid="add-user-title"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(presets || {}).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Hourly rate ($)</Label><Input type="number" value={form.hourly_rate} onChange={e => setForm({ ...form, hourly_rate: Number(e.target.value) })} data-testid="add-user-rate" /></div>
          </div>
          <div>
            <Label className="text-xs">Initial password *</Label>
            <Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="At least 12 characters" data-testid="add-user-password" />
            <p className="mt-1 text-[10px] text-zinc-500">Set a unique temporary password, then have the technician change it after their first sign-in.</p>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={form.is_admin} onChange={e => setForm({ ...form, is_admin: e.target.checked })} data-testid="add-user-admin-cb" />
            Grant Admin (full access — overrides job title preset)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy} variant="outline" className="text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/10" data-testid="add-user-submit">
            {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}Create User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- INVITE USER DIALOG ----------
function InviteDialog({ open, onClose, onSent, headers, presets }) {
  const [form, setForm] = useState({ name: "", email: "", role: "technician", job_title: "L1 Technician", hourly_rate: 75, message: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm({ name: "", email: "", role: "technician", job_title: "L1 Technician", hourly_rate: 75, message: "" });
  }, [open]);

  const send = async () => {
    if (!form.name.trim() || !form.email.trim()) { toast.error("Name and email required"); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API}/technicians/invite`, form, { headers });
      const status = r.data?.email?.status;
      toast.success(status === "sent" ? `Invitation sent to ${form.email}` : `Invitation created (${status || "pending"})`);
      onSent?.();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Invite failed"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" data-testid="invite-user-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="w-5 h-5 text-cyan-400" />Invite via Email</DialogTitle>
          <DialogDescription>Send an email invite. The recipient sets their own password from the link.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Full name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Jane Smith" data-testid="invite-name" /></div>
            <div><Label className="text-xs">Email *</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="jane@nexusops.io" data-testid="invite-email" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}>
                <SelectTrigger data-testid="invite-role"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Job title</Label>
              <Select value={form.job_title} onValueChange={v => setForm({ ...form, job_title: v })}>
                <SelectTrigger data-testid="invite-title"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.keys(presets || {}).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label className="text-xs">Personal message (optional)</Label><Textarea rows={3} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="Welcome to the team!" data-testid="invite-message" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={busy} variant="outline" className="text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/10" data-testid="invite-submit">
            {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}Send Invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- EDIT TECH DIALOG ----------
function EditTechDialog({ tech, onClose, headers, presets, onChanged }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tech) setForm({
      name: tech.name || "", email: tech.email || "", phone: tech.phone || "",
      job_title: tech.job_title || "L1 Technician", role: tech.role || "technician",
      hourly_rate: tech.hourly_rate || 75, is_admin: !!tech.is_admin,
      categories: tech.categories || [], specialties: tech.specialties || [],
    });
    else setForm(null);
  }, [tech]);

  if (!tech || !form) return null;

  const save = async () => {
    setBusy(true);
    try {
      const payload = { ...form, permissions: presets[form.job_title] || undefined };
      await axios.put(`${API}/technicians/${tech.id}`, payload, { headers });
      toast.success("Saved");
      onChanged?.();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!tech} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" data-testid="edit-tech-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Edit className="w-5 h-5 text-violet-400" />Edit {tech.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Full name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label className="text-xs">Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ROLE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Job title</Label>
              <Select value={form.job_title} onValueChange={v => setForm({ ...form, job_title: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.keys(presets || {}).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Hourly rate</Label><Input type="number" value={form.hourly_rate} onChange={e => setForm({ ...form, hourly_rate: Number(e.target.value) })} /></div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={form.is_admin} onChange={e => setForm({ ...form, is_admin: e.target.checked })} />
            Grant Admin (full access)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy} variant="outline" className="text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/10">
            {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- INVITES TAB ----------
function InvitesTab({ headers }) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/technicians/invites`, { headers });
      setInvites(r.data?.invites || r.data || []);
    } catch { setInvites([]); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const cancel = async (id) => {
    if (!window.confirm("Cancel this invite?")) return;
    try {
      await axios.delete(`${API}/technicians/invites/${id}`, { headers });
      toast.success("Invite cancelled");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const resend = async (id) => {
    try {
      await axios.post(`${API}/technicians/invites/${id}/resend`, {}, { headers });
      toast.success("Invite resent");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>;

  return (
    <div className="space-y-2" data-testid="invites-tab">
      {invites.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-zinc-500">No pending invitations.</CardContent></Card>
      ) : invites.map(inv => (
        <Card key={inv.id} className="border-zinc-800" data-testid={`invite-${inv.id}`}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-cyan-500/20 flex items-center justify-center"><Mail className="w-5 h-5 text-cyan-400" /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{inv.name}</span>
                <Badge variant="outline" className="text-[9px] uppercase">{inv.role || "technician"}</Badge>
                <Badge variant="outline" className={`text-[9px] uppercase ${inv.status === "pending" ? "text-amber-300 border-amber-500/40" : "text-zinc-400"}`}>{inv.status}</Badge>
              </div>
              <div className="text-[10px] text-zinc-500 font-mono">
                {inv.email} · invited by {inv.invited_by} · expires {inv.expires_at ? formatDistanceToNow(new Date(inv.expires_at), { addSuffix: true }) : "—"}
              </div>
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => resend(inv.id)} data-testid={`invite-resend-${inv.id}`}><Send className="w-3 h-3 mr-1" />Resend</Button>
            <Button size="sm" variant="ghost" className="h-7 text-rose-400" onClick={() => cancel(inv.id)} data-testid={`invite-cancel-${inv.id}`}><XCircle className="w-3 h-3" /></Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------- SMART FINDER TAB ----------
function TechFinderTab({ headers, capacity }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [intent, setIntent] = useState(null);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!query.trim()) { setResults([]); setIntent(null); return; }
    setLoading(true);
    try {
      const r = await axios.post(`${API}/tech-intel/find`, { query }, { headers });
      setResults(r.data.results || []);
      setIntent(r.data.intent || null);
    } catch { toast.error("Search failed"); }
    finally { setLoading(false); }
  };

  const display = results.length ? results : (capacity?.techs?.slice(0, 6) || []);

  return (
    <div className="space-y-4" data-testid="tech-finder-tab">
      <form onSubmit={submit} className="relative">
        <Sparkles className="w-4 h-4 absolute left-3 top-3 text-violet-400" />
        <Input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder='Try: "L2 with VMware experience available now"'
          className="pl-10 pr-24 h-11 bg-zinc-950 border-violet-500/30 focus-visible:border-violet-400"
          data-testid="tech-finder-input"
        />
        <Button type="submit" size="sm" className="absolute right-1.5 top-1.5 h-8" variant="outline" disabled={loading} data-testid="tech-finder-submit">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Search className="w-3 h-3 mr-1" />Find</>}
        </Button>
      </form>

      {intent && (
        <div className="text-[10px] font-mono text-zinc-500 flex flex-wrap gap-1.5">
          <span className="text-zinc-400 uppercase tracking-widest">parsed:</span>
          {(intent.skills || []).map(s => <Badge key={s} variant="outline" className="text-[10px] text-violet-300 border-violet-500/40">{s}</Badge>)}
          {intent.level && <Badge variant="outline" className="text-[10px] text-cyan-300 border-cyan-500/40">{intent.level}</Badge>}
          {intent.needs_available && <Badge variant="outline" className="text-[10px] text-emerald-300 border-emerald-500/40">available now</Badge>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {display.map(t => <TechCard key={t.id} tech={t} onEdit={() => {}} headers={headers} onChanged={() => {}} />)}
      </div>
    </div>
  );
}

// ---------- CAPACITY TAB ----------
function CapacityTab({ capacity }) {
  if (!capacity) return null;
  return (
    <div className="space-y-4" data-testid="capacity-tab">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" />Live Workload</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {capacity.techs.map(t => {
              const w = t.workload || {};
              const fill = w.state === "overloaded" ? "from-rose-500 to-red-500" :
                           w.state === "busy" ? "from-amber-500 to-orange-500" :
                           w.state === "active" ? "from-cyan-500 to-blue-500" :
                           "from-emerald-500 to-green-500";
              return (
                <div key={t.id} className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-zinc-900/50">
                  <div className="w-32 truncate">
                    <div className="text-xs font-medium truncate">{t.name}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">{t.job_title}</div>
                  </div>
                  <div className="flex-1 h-2.5 rounded-full bg-zinc-900 overflow-hidden">
                    <div className={`h-full bg-gradient-to-r ${fill} transition-all`} style={{ width: `${Math.min(100, w.utilization_pct || 0)}%` }} />
                  </div>
                  <div className="w-12 text-right text-xs font-mono text-zinc-300">{w.utilization_pct ?? 0}%</div>
                  <Badge variant="outline" className={`text-[9px] uppercase ${STATE_COLORS[w.state]}`}>{w.state}</Badge>
                  <div className="w-24 text-right text-[10px] font-mono text-zinc-500">{w.open_tickets ?? 0} open · {w.overdue ?? 0} late</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- PERMISSION MATRIX TAB ----------
function PermissionMatrixTab({ headers, presets }) {
  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(true);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffData, setDiffData] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/tech-intel/permission-matrix`, { headers });
      setMatrix(r.data);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const openDiff = async (tid, preset) => {
    try {
      const r = await axios.post(`${API}/tech-intel/permission-diff`, { tech_id: tid, target_preset: preset }, { headers });
      setDiffData(r.data); setDiffOpen(true);
    } catch { toast.error("Diff failed"); }
  };

  const apply = async () => {
    if (!diffData) return;
    try {
      await axios.put(`${API}/technicians/${diffData.tech.id}/permissions`, {
        permissions: presets[diffData.target_preset], job_title: diffData.target_preset,
      }, { headers });
      toast.success(`Promoted ${diffData.tech.name} → ${diffData.target_preset}`);
      setDiffOpen(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Apply failed"); }
  };

  if (loading || !matrix) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>;

  return (
    <div className="space-y-4" data-testid="permission-matrix-tab">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Shield className="w-4 h-4" />Permission Heatmap</CardTitle>
          <div className="flex items-center gap-3 text-[10px] font-mono">
            {Object.entries(PERM_COLORS).map(([k]) => (
              <span key={k} className="flex items-center gap-1"><span className={`w-3 h-3 rounded ${PERM_COLORS[k]}`} />{k}</span>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-2 py-2 sticky left-0 bg-zinc-950 z-10 min-w-[160px]">Technician</th>
                  {matrix.modules.map(m => (
                    <th key={m} className="px-1 py-2 text-[9px] uppercase tracking-widest text-zinc-500 font-mono whitespace-nowrap" style={{ writingMode: "vertical-rl", textOrientation: "mixed", height: 100 }}>{m.replace(/_/g, " ")}</th>
                  ))}
                  <th className="px-2 py-2 text-[9px] uppercase tracking-widest text-zinc-500 font-mono">Promote to</th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map(row => (
                  <tr key={row.tech_id} className="border-t border-zinc-900 hover:bg-zinc-900/40">
                    <td className="px-2 py-1.5 sticky left-0 bg-zinc-950 z-10">
                      <div className="flex items-center gap-1.5">{row.is_admin && <Crown className="w-3 h-3 text-amber-400 shrink-0" />}<span className="font-medium truncate">{row.name}</span></div>
                      <div className="text-[10px] text-zinc-500 font-mono">{row.job_title}</div>
                    </td>
                    {matrix.modules.map(m => (
                      <td key={m} className="px-0.5 py-0.5 text-center">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-[9px] font-bold font-mono ${PERM_COLORS[row.cells[m]] || PERM_COLORS.none}`}>{PERM_INITIAL[row.cells[m]] || "·"}</span>
                      </td>
                    ))}
                    <td className="px-2 py-1.5">
                      <Select value="" onValueChange={(v) => v && openDiff(row.tech_id, v)}>
                        <SelectTrigger className="h-7 text-[10px] w-[140px]"><SelectValue placeholder="Preview…" /></SelectTrigger>
                        <SelectContent>{Object.keys(presets || {}).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Permission Diff Preview</DialogTitle>
            <DialogDescription>{diffData ? `Promote ${diffData.tech.name} → ${diffData.target_preset}` : ""}</DialogDescription>
          </DialogHeader>
          {diffData && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-bold mb-2 flex items-center gap-1"><ArrowUpRight className="w-3 h-3" />{diffData.grants.length} New</div>
                <ScrollArea className="h-[260px] pr-2">
                  <div className="space-y-1">
                    {diffData.grants.length === 0 && <p className="text-xs text-zinc-500">No new grants.</p>}
                    {diffData.grants.map((g, i) => <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded border border-emerald-500/20 bg-emerald-500/5"><span className="font-mono text-emerald-300">+ {g.module}</span><span className="text-zinc-400 ml-auto uppercase tracking-widest text-[9px]">{g.action}</span></div>)}
                  </div>
                </ScrollArea>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-rose-300 font-bold mb-2 flex items-center gap-1"><ArrowDownRight className="w-3 h-3" />{diffData.revokes.length} Removed</div>
                <ScrollArea className="h-[260px] pr-2">
                  <div className="space-y-1">
                    {diffData.revokes.length === 0 && <p className="text-xs text-zinc-500">No revokes.</p>}
                    {diffData.revokes.map((g, i) => <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded border border-rose-500/20 bg-rose-500/5"><span className="font-mono text-rose-300">− {g.module}</span><span className="text-zinc-400 ml-auto uppercase tracking-widest text-[9px]">{g.action}</span></div>)}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDiffOpen(false)}>Cancel</Button>
            <Button onClick={apply} variant="outline" className="text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/10">Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- ROLE DRIFT TAB ----------
function RoleDriftTab({ headers }) {
  const [drift, setDrift] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await axios.get(`${API}/tech-intel/role-drift`, { headers }); setDrift(r.data); }
    catch { /* */ }
    finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">Last 30 days: assigned role vs actual workload.</p>
        <Button size="sm" variant="ghost" onClick={load} className="h-7 text-[10px]"><RefreshCw className="w-3 h-3 mr-1" />Re-analyse</Button>
      </div>
      {(drift?.drift || []).length === 0 ? (
        <Card className="border-emerald-500/20 bg-emerald-500/5"><CardContent className="p-6 text-center"><Shield className="w-8 h-8 text-emerald-400 mx-auto mb-2" /><p className="text-sm text-emerald-300">All technicians correctly aligned.</p></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {drift.drift.map(d => (
            <Card key={d.tech_id} className={d.flag === "upgrade" ? "border-amber-500/30 bg-amber-500/5" : "border-zinc-700 bg-zinc-900/40"}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-md flex items-center justify-center ${d.flag === "upgrade" ? "bg-amber-500/20" : "bg-zinc-800"}`}>
                  {d.flag === "upgrade" ? <TrendingUp className="w-5 h-5 text-amber-400" /> : <ArrowDownRight className="w-5 h-5 text-zinc-400" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{d.name}</span>
                    <Badge variant="outline" className="text-[10px] text-zinc-400">{d.current_title}</Badge>
                    <Badge variant="outline" className={`text-[10px] uppercase ${d.flag === "upgrade" ? "text-amber-300 border-amber-500/40" : "text-zinc-300 border-zinc-500/40"}`}>{d.flag}</Badge>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">{d.rationale}</p>
                </div>
                <div className="text-right text-[10px] font-mono text-zinc-500">
                  <div>{d.crit_30d} critical · {d.total_30d} total</div>
                  <div>last 30 days</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- JIT TAB ----------
function JITTab({ headers, capacity, presets, onChanged }) {
  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(true);
  const [grantOpen, setGrantOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [grant, setGrant] = useState({ tech_id: "", preset: "Senior Engineer", duration_minutes: 240, reason: "" });
  const [bg, setBg] = useState({ duration_minutes: 15, reason: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await axios.get(`${API}/permission-elevation/active`, { headers }); setActive(r.data.active || []); }
    catch { /* */ }
    finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, [load]);

  const doGrant = async () => {
    if (!grant.tech_id || !grant.reason) { toast.error("Tech and reason required"); return; }
    try {
      await axios.post(`${API}/permission-elevation/grant`, grant, { headers });
      toast.success("Elevation granted"); setGrantOpen(false);
      setGrant({ tech_id: "", preset: "Senior Engineer", duration_minutes: 240, reason: "" });
      load(); onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  const revoke = async (id) => {
    try { await axios.delete(`${API}/permission-elevation/${id}`, { headers }); toast.success("Revoked"); load(); }
    catch { toast.error("Failed"); }
  };
  const doBg = async () => {
    if (!bg.reason || bg.reason.length < 10) { toast.error("Detailed reason required (10+ chars)"); return; }
    try { await axios.post(`${API}/permission-elevation/break-glass`, bg, { headers }); toast.success("BREAK GLASS active"); setBgOpen(false); setBg({ duration_minutes: 15, reason: "" }); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-zinc-500">Grant elevated permissions for a fixed window. Auto-revert on expiry. Audited.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs text-violet-300 border-violet-500/40 hover:bg-violet-500/10" onClick={() => setGrantOpen(true)}><Unlock className="w-3 h-3 mr-1" />Grant</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs text-rose-300 border-rose-500/40 hover:bg-rose-500/10" onClick={() => setBgOpen(true)}><ShieldAlert className="w-3 h-3 mr-1" />Break Glass</Button>
        </div>
      </div>

      {loading ? <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div> :
       active.length === 0 ? <Card><CardContent className="p-6 text-center text-sm text-zinc-500">No active elevations.</CardContent></Card> :
       <div className="space-y-2">
         {active.map(e => (
           <Card key={e.id} className={e.break_glass ? "border-rose-500/40 bg-rose-500/5" : "border-violet-500/30 bg-violet-500/5"}>
             <CardContent className="p-4 flex items-center gap-3">
               <div className={`w-10 h-10 rounded-md flex items-center justify-center ${e.break_glass ? "bg-rose-500/20" : "bg-violet-500/20"}`}>
                 {e.break_glass ? <ShieldAlert className="w-5 h-5 text-rose-400" /> : <Unlock className="w-5 h-5 text-violet-400" />}
               </div>
               <div className="flex-1">
                 <div className="flex items-center gap-2">
                   <span className="font-medium">{e.tech_name}</span>
                   <Badge variant="outline" className={`text-[10px] ${e.break_glass ? "text-rose-300 border-rose-500/40" : "text-violet-300 border-violet-500/40"}`}>{e.preset}</Badge>
                   {e.break_glass && <Badge variant="outline" className="text-[10px] text-rose-300 border-rose-500/40 animate-pulse">BREAK GLASS</Badge>}
                 </div>
                 <div className="text-[10px] text-zinc-500 mt-0.5">granted by {e.granted_by_name} · expires in {e.expires_in_minutes}m · {e.reason}</div>
               </div>
               <Button size="sm" variant="ghost" className="text-rose-400 h-7 text-[10px]" onClick={() => revoke(e.id)}><Lock className="w-3 h-3 mr-1" />Revoke</Button>
             </CardContent>
           </Card>
         ))}
       </div>}

      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Grant Just-in-Time Elevation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={grant.tech_id} onValueChange={v => setGrant({ ...grant, tech_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select technician" /></SelectTrigger>
              <SelectContent>{(capacity?.techs || []).map(t => <SelectItem key={t.id} value={t.id}>{t.name} · {t.job_title}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={grant.preset} onValueChange={v => setGrant({ ...grant, preset: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.keys(presets || {}).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
            <Input type="number" min={5} max={1440} value={grant.duration_minutes} onChange={e => setGrant({ ...grant, duration_minutes: Number(e.target.value) })} placeholder="Duration (min)" />
            <Textarea value={grant.reason} onChange={e => setGrant({ ...grant, reason: e.target.value })} placeholder="Reason (audited)" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGrantOpen(false)}>Cancel</Button>
            <Button onClick={doGrant} variant="outline" className="text-violet-300 border-violet-500/40 hover:bg-violet-500/10"><Zap className="w-3 h-3 mr-1" />Grant</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bgOpen} onOpenChange={setBgOpen}>
        <DialogContent className="border-rose-500/40 bg-zinc-950">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-300"><ShieldAlert className="w-5 h-5" />BREAK GLASS</DialogTitle>
            <DialogDescription>Self-grant full admin. Audited. Use only for emergencies.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input type="number" min={5} max={60} value={bg.duration_minutes} onChange={e => setBg({ ...bg, duration_minutes: Number(e.target.value) })} placeholder="Duration (max 60 min)" />
            <Textarea value={bg.reason} onChange={e => setBg({ ...bg, reason: e.target.value })} placeholder="Detailed reason (10+ chars, audited)" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBgOpen(false)}>Cancel</Button>
            <Button onClick={doBg} variant="outline" className="text-rose-300 border-rose-500/40 hover:bg-rose-500/10"><ShieldAlert className="w-3 h-3 mr-1" />Activate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- AUDIT TAB ----------
function AuditTab({ headers }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await axios.get(`${API}/tech-intel/audit-timeline`, { headers }); setEvents(r.data.events || []); }
    catch { /* */ }
    finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const out = {};
    for (const e of events) {
      const key = (e.timestamp || "").slice(0, 10) || "—";
      out[key] = out[key] || []; out[key].push(e);
    }
    return out;
  }, [events]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">Permission/role/elevation events. Newest first.</p>
        <Button size="sm" variant="ghost" onClick={load} className="h-7 text-[10px]"><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
      </div>
      {events.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-zinc-500">No audit events.</CardContent></Card>
      ) : (
        <div className="relative pl-8">
          <div className="absolute left-3 top-0 bottom-0 w-px bg-zinc-800" />
          {Object.entries(groups).map(([day, evs]) => (
            <div key={day} className="mb-6">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono mb-2">{day}</div>
              {evs.map(e => {
                const isBG = e.action === "break_glass_activated";
                const isGrant = e.action === "elevation_granted";
                const dot = isBG ? "bg-rose-400" : isGrant ? "bg-violet-400" : "bg-cyan-400";
                return (
                  <div key={e.id} className="relative mb-2 ml-2 group">
                    <div className={`absolute -left-7 top-2 w-3 h-3 rounded-full ${dot} ring-4 ring-zinc-950`} />
                    <div className="px-3 py-2 rounded-md bg-zinc-900/40 border border-zinc-800 group-hover:border-zinc-600">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={`text-[9px] uppercase ${isBG ? "text-rose-300 border-rose-500/40" : "text-cyan-300 border-cyan-500/40"}`}>{(e.action || "").replace(/_/g, " ")}</Badge>
                        <span className="text-xs">{e.actor_name} → {e.target_name}</span>
                        <span className="text-[10px] text-zinc-500 font-mono ml-auto">{e.timestamp ? formatDistanceToNow(new Date(e.timestamp), { addSuffix: true }) : "—"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- MAIN ----------
export default function TechCommandCenter() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const requested = searchParams.get("view");
    return COMMAND_TAB_IDS.has(requested) ? requested : "directory";
  });
  const [capacity, setCapacity] = useState(null);
  const [presets, setPresets] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const loadCapacity = useCallback(async () => {
    try { const r = await axios.get(`${API}/tech-intel/capacity`, { headers }); setCapacity(r.data); }
    catch { /* */ }
  }, [headers]);

  const loadPresets = useCallback(async () => {
    try { const r = await axios.get(`${API}/technicians/permission-presets`, { headers }); setPresets(r.data || {}); }
    catch { /* */ }
  }, [headers]);

  useEffect(() => { loadCapacity(); loadPresets(); }, [loadCapacity, loadPresets]);

  useEffect(() => {
    const requested = searchParams.get("view");
    if (COMMAND_TAB_IDS.has(requested) && requested !== tab) setTab(requested);
  }, [searchParams, tab]);

  const selectTab = value => {
    setTab(value);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("view", value);
    setSearchParams(nextParams);
  };

  const summary = capacity?.summary || { total: 0, idle: 0, active: 0, busy: 0, overloaded: 0, on_call: 0, avg_util: 0 };

  return (
    <div className="space-y-5 p-6" data-testid="tech-command-center">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-violet-400" />Team Command Center
          </h1>
          <p className="text-sm text-zinc-500">Directory · Invites · Capacity · Permissions · Drift · JIT · Audit</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/10" onClick={() => setInviteOpen(true)} data-testid="header-invite-btn">
            <Mail className="w-3 h-3 mr-1" />Invite
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/10" onClick={() => setAddOpen(true)} data-testid="header-add-btn">
            <UserPlus className="w-3 h-3 mr-1" />Add User
          </Button>
          <Button size="sm" variant="ghost" onClick={loadCapacity} className="h-8 text-xs"><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
        </div>
      </div>

      {/* HeroTile metric strip — same shape as Devices */}
      <MetricStrip columns={6}>
        <MetricTile label="Total techs" value={summary.total} accent="violet" icon={<Users className="w-2.5 h-2.5 text-violet-400" />} testid="tcc-tile-total" />
        <MetricTile label="Idle" value={summary.idle || 0} accent="emerald" icon={<Activity className="w-2.5 h-2.5 text-emerald-400" />} testid="tcc-tile-idle" />
        <MetricTile label="Active" value={summary.active || 0} accent="cyan" icon={<Activity className="w-2.5 h-2.5 text-cyan-400" />} testid="tcc-tile-active" />
        <MetricTile label="Busy" value={summary.busy || 0} accent="amber" icon={<Flame className="w-2.5 h-2.5 text-amber-400" />} testid="tcc-tile-busy" />
        <MetricTile label="Overloaded" value={summary.overloaded || 0} accent={summary.overloaded ? "rose" : "zinc"} icon={<AlertTriangle className={`w-2.5 h-2.5 ${summary.overloaded ? "text-rose-400" : "text-zinc-400"}`} />} testid="tcc-tile-overloaded" />
        <MetricTile label="Avg utilisation" value={`${summary.avg_util}%`} accent="violet" icon={<TrendingUp className="w-2.5 h-2.5 text-violet-400" />} testid="tcc-tile-util" />
      </MetricStrip>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="bg-transparent border-b border-zinc-800 rounded-none w-full justify-start gap-1 p-0 h-auto overflow-x-auto">
          {[
            { v: "directory", l: "Directory",   Icon: Users },
            { v: "invites",   l: "Invites",     Icon: Mail },
            { v: "find",      l: "Smart Finder", Icon: Sparkles },
            { v: "capacity",  l: "Capacity",    Icon: Activity },
            { v: "matrix",    l: "Permissions", Icon: Shield },
            { v: "drift",     l: "Role Drift",  Icon: Target },
            { v: "jit",       l: "JIT",         Icon: Zap },
            { v: "audit",     l: "Audit",       Icon: History },
          ].map(t => (
            <TabsTrigger key={t.v} value={t.v}
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-violet-500 data-[state=active]:text-zinc-100 text-zinc-500 rounded-none py-2 px-3 text-xs uppercase tracking-wider whitespace-nowrap"
              data-testid={`tcc-tab-${t.v}`}>
              <t.Icon className="w-3 h-3 mr-1" />{t.l}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="directory" className="mt-4"><DirectoryTab headers={headers} capacity={capacity} presets={presets} onChanged={loadCapacity} /></TabsContent>
        <TabsContent value="invites" className="mt-4"><InvitesTab headers={headers} /></TabsContent>
        <TabsContent value="find" className="mt-4"><TechFinderTab headers={headers} capacity={capacity} /></TabsContent>
        <TabsContent value="capacity" className="mt-4"><CapacityTab capacity={capacity} /></TabsContent>
        <TabsContent value="matrix" className="mt-4"><PermissionMatrixTab headers={headers} presets={presets} /></TabsContent>
        <TabsContent value="drift" className="mt-4"><RoleDriftTab headers={headers} /></TabsContent>
        <TabsContent value="jit" className="mt-4"><JITTab headers={headers} capacity={capacity} presets={presets} onChanged={loadCapacity} /></TabsContent>
        <TabsContent value="audit" className="mt-4"><AuditTab headers={headers} /></TabsContent>
      </Tabs>

      {/* Deep links to legacy pages — preserved for power users */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-900">
        <span className="text-[10px] uppercase tracking-widest font-mono text-zinc-600 self-center">Open as full page:</span>
        <Link to="/tech-roster"><Button size="sm" variant="ghost" className="h-7 text-[10px]"><Calendar className="w-3 h-3 mr-1" />On-Call Roster</Button></Link>
        <Link to="/skills-matrix"><Button size="sm" variant="ghost" className="h-7 text-[10px]"><Network className="w-3 h-3 mr-1" />Skills Matrix</Button></Link>
        <Link to="/tech-utilization"><Button size="sm" variant="ghost" className="h-7 text-[10px]"><BarChart3 className="w-3 h-3 mr-1" />Utilisation</Button></Link>
        <Link to="/leaderboard"><Button size="sm" variant="ghost" className="h-7 text-[10px]"><Trophy className="w-3 h-3 mr-1" />Leaderboard</Button></Link>
        <Link to="/technicians"><Button size="sm" variant="ghost" className="h-7 text-[10px]"><Users className="w-3 h-3 mr-1" />Legacy Directory</Button></Link>
      </div>

      <AddUserDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={loadCapacity} headers={headers} presets={presets} />
      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} onSent={loadCapacity} headers={headers} presets={presets} />
    </div>
  );
}
