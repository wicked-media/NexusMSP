/**
 * Team Command Center — native, format-consistent rebuild.
 * Matches the Devices Command Center / Clients module aesthetic.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import TechRosterPage from "./TechRosterPage";
import SkillsMatrixPage from "./SkillsMatrixPage";
import LeaderboardPage from "./LeaderboardPage";
import { MetricStrip, MetricTile } from "@/components/design-system";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HoldToConfirmButton } from "@/components/ui/hold-to-confirm-button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Sparkles, Search, Loader2, Users, Shield, AlertTriangle, Zap, Activity,
  Crown, Lock, Unlock, History, Target, RefreshCw,
  TrendingUp, ArrowUpRight, ArrowDownRight, ShieldAlert, Flame, UserPlus,
  Mail, Trash2, Edit, Archive, RotateCcw, Send, Calendar, Trophy,
  CheckCircle2, XCircle, Clock, Upload, Building2, MapPin,
} from "lucide-react";

// ---------- Constants ----------
const SKILL_AXES = ["networking", "cloud", "security", "endpoints", "backup", "m365", "voip", "hardware"];

const STATE_COLORS = {
  idle:       "text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  active:     "text-cyan-700 dark:text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  busy:       "text-amber-700 dark:text-amber-300 border-amber-500/30 bg-amber-500/10",
  overloaded: "text-rose-700 dark:text-rose-300 border-rose-500/30 bg-rose-500/10",
};

const PERM_COLORS = {
  none:  "bg-zinc-900 text-zinc-700",
  read:  "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30",
  write: "bg-violet-500/20 text-violet-300 border border-violet-500/40",
  admin: "bg-rose-500/20 text-rose-300 border border-rose-500/40",
};
const PERM_INITIAL = { none: "·", read: "R", write: "W", admin: "A" };

const cleanDisplayText = (value) => String(value || "")
  .replaceAll("â€”", "—")
  .replaceAll("â€“", "–")
  .replaceAll("â€™", "’")
  .replaceAll("Â·", "·");

const ROLE_OPTIONS = [
  { value: "technician", label: "Technician", description: "Works assigned service requests and client systems." },
  { value: "service_desk_manager", label: "Service Desk Manager", description: "Leads service-desk operations and technician workflows." },
  { value: "dispatcher", label: "Dispatcher", description: "Coordinates queues, scheduling and client communication." },
  { value: "admin", label: "Administrator", description: "Full platform and team access.", protected: true },
];
const COMMAND_TAB_IDS = new Set(["directory", "invites", "find", "capacity", "matrix", "drift", "jit", "audit", "roster", "skills", "leaderboard"]);
const OPERATIONAL_TAB_IDS = new Set(["directory", "invites", "find", "capacity", "matrix", "drift", "jit", "audit"]);
const COMMAND_TAB_GROUPS = [
  {
    label: "People",
    tabs: [
      { v: "directory", l: "Directory", Icon: Users },
      { v: "invites", l: "Invites", Icon: Mail },
      { v: "roster", l: "On-call Roster", Icon: Calendar },
      { v: "skills", l: "Skills", Icon: Target },
      { v: "leaderboard", l: "Leaderboard", Icon: Trophy },
    ],
  },
  {
    label: "Operations",
    tabs: [
      { v: "find", l: "Smart Finder", Icon: Sparkles },
      { v: "capacity", l: "Capacity", Icon: Activity },
      { v: "jit", l: "JIT", Icon: Zap },
    ],
  },
  {
    label: "Governance",
    tabs: [
      { v: "matrix", l: "Permissions", Icon: Shield },
      { v: "drift", l: "Role Drift", Icon: Target },
      { v: "audit", l: "Audit", Icon: History },
    ],
  },
];

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
function DirectoryTab({ headers, capacity, presets, roleOptions, onChanged }) {
  const [search, setSearch] = useState("");
  const [filterTitle, setFilterTitle] = useState("all");
  const [filterStatus, setFilterStatus] = useState("active");
  const [editing, setEditing] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const [deleting, setDeleting] = useState(null);
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

  const restore = async tech => {
    try {
      await axios.post(`${API}/technicians/${tech.id}/restore`, {}, { headers });
      toast.success(`${tech.name} restored and able to sign in`);
      onChanged?.();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not restore technician"); }
  };

  return (
    <div className="space-y-4" data-testid="directory-tab">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input aria-label="Search team members" className="pl-9" placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} data-testid="directory-search" />
        </div>
        <Select value={filterTitle} onValueChange={setFilterTitle}>
          <SelectTrigger aria-label="Filter team members by role" className="w-[180px]" data-testid="directory-title-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {titles.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger aria-label="Filter team members by status" className="w-[140px]" data-testid="directory-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tech grid — same style as Devices grid */}
      {filtered.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center py-12 text-center"><Search className="h-6 w-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium text-foreground">No team members match</p><p className="mt-1 text-xs text-muted-foreground">Clear the search and filters to return to the complete directory.</p><Button variant="outline" size="sm" className="mt-4" onClick={() => { setSearch(""); setFilterTitle("all"); setFilterStatus("active"); }}>Clear filters</Button></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(t => (
            <TechCard
              key={t.id}
              tech={t}
              onEdit={() => setEditing(t)}
              onArchive={() => setArchiving(t)}
              onRestore={() => restore(t)}
              onDelete={() => setDeleting(t)}
            />
          ))}
        </div>
      )}

      <EditTechDialog tech={editing} onClose={() => setEditing(null)} headers={headers} presets={presets} roleOptions={roleOptions} onChanged={onChanged} />
      <ArchiveTechnicianDialog tech={archiving} onClose={() => setArchiving(null)} headers={headers} onCompleted={onChanged} />
      <DeleteArchivedTechnicianDialog tech={deleting} onClose={() => setDeleting(null)} headers={headers} onCompleted={onChanged} />
    </div>
  );
}

function TechCard({ tech, onEdit, onArchive, onRestore, onDelete }) {
  const wl = tech.workload || {};
  const stateClass = STATE_COLORS[wl.state] || STATE_COLORS.active;
  const archived = !!tech.archived;

  return (
    <Card className={`border-border/80 bg-card/80 transition-colors ${archived ? "border-amber-500/25 opacity-85" : "hover:border-violet-500/40"}`} data-testid={`tech-card-${tech.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <Avatar className="h-12 w-12 rounded-md border border-violet-400/25 bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 text-white shadow-sm shadow-violet-500/20">
              <AvatarImage src={tech.avatar} alt={`${tech.name || "Technician"} profile photo`} className="object-cover" />
              <AvatarFallback className="rounded-md bg-transparent text-sm font-bold text-white">{(tech.name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            {tech.on_call_status && <span className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full bg-emerald-500 ring-2 ring-background" aria-label="Currently on call" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-foreground">{tech.name}</span>
              {tech.is_admin && <Crown className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-label="Administrator" />}
              {archived && <Badge variant="outline" className="border-amber-500/35 bg-amber-500/10 text-[9px] uppercase text-amber-700 dark:text-amber-200">Archived</Badge>}
            </div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">{tech.job_title || "Technician"}</div>
            <div className="truncate text-[10px] text-muted-foreground">{tech.email}</div>
            <div className="flex flex-wrap gap-1 mt-1">
              <Badge variant="outline" className={`text-[9px] uppercase ${stateClass}`}>{wl.state || "idle"} · {wl.utilization_pct ?? 0}%</Badge>
            </div>
          </div>
          <SkillRadar skills={tech.skills} size={64} />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/70 pt-3 text-center">
          <div><div className="font-mono text-base font-bold text-cyan-700 dark:text-cyan-300">{wl.open_tickets ?? 0}</div><div className="text-[9px] uppercase tracking-widest text-muted-foreground">open</div></div>
          <div><div className={`font-mono text-base font-bold ${wl.overdue ? "text-rose-700 dark:text-rose-300" : "text-muted-foreground"}`}>{wl.overdue ?? 0}</div><div className="text-[9px] uppercase tracking-widest text-muted-foreground">overdue</div></div>
          <div><div className="font-mono text-base font-bold text-emerald-700 dark:text-emerald-300">{tech.on_call_status ? "ON" : "—"}</div><div className="text-[9px] uppercase tracking-widest text-muted-foreground">on-call</div></div>
        </div>

        {archived ? (
          <div className="mt-3 flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 flex-1 text-[10px] text-emerald-300 hover:bg-emerald-500/10" onClick={onRestore} data-testid={`tech-restore-${tech.id}`}><RotateCcw className="mr-1 h-3 w-3" />Restore</Button>
            <Button size="sm" variant="ghost" className="h-7 text-[10px] text-rose-300 hover:bg-rose-500/10" onClick={onDelete} data-testid={`tech-delete-${tech.id}`}><Trash2 className="mr-1 h-3 w-3" />Delete</Button>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 flex-1 text-[10px]" aria-label={`Manage ${tech.name}`} onClick={onEdit} data-testid={`tech-edit-${tech.id}`}><Edit className="mr-1 h-3 w-3" />Manage</Button>
            <Button size="sm" variant="ghost" className="h-7 text-[10px] text-amber-700 hover:bg-amber-500/10 dark:text-amber-300" aria-label={`Archive ${tech.name}`} onClick={onArchive} data-testid={`tech-archive-${tech.id}`}><Archive className="mr-1 h-3 w-3" />Archive</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ArchiveTechnicianDialog({ tech, onClose, headers, onCompleted }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setReason(""); setBusy(false); }, [tech]);
  if (!tech) return null;

  const archive = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/technicians/${tech.id}/archive`, { reason: reason.trim() }, { headers });
      toast.success(`${tech.name} archived. Their records remain available for audit.`);
      onCompleted?.();
      onClose();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not archive technician"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!tech} onOpenChange={open => !open && onClose()}>
      <NexusWorkflowDialog eyebrow="Safe offboarding" title={`Archive ${tech.name}?`} description="Archive is the safe offboarding action. It immediately blocks sign-in without removing the technician's history, ticket activity or audit records." icon={Archive} tone="amber" className="max-w-xl" contentClassName="space-y-4" data-testid="archive-tech-dialog" footer={<><Button variant="ghost" onClick={onClose}>Keep active</Button><Button variant="warning" onClick={archive} disabled={busy} data-testid="archive-tech-submit">{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Archive className="mr-1.5 h-4 w-4" />}Archive account</Button></>}>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"><Lock className="mb-2 h-4 w-4 text-rose-300" /><p className="text-xs font-medium text-zinc-100">Access stopped</p><p className="mt-1 text-[11px] leading-relaxed text-zinc-500">The account can no longer sign in.</p></div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"><History className="mb-2 h-4 w-4 text-cyan-300" /><p className="text-xs font-medium text-zinc-100">Records retained</p><p className="mt-1 text-[11px] leading-relaxed text-zinc-500">Existing work stays visible and attributable.</p></div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"><RotateCcw className="mb-2 h-4 w-4 text-emerald-300" /><p className="text-xs font-medium text-zinc-100">Reversible</p><p className="mt-1 text-[11px] leading-relaxed text-zinc-500">Restore from the archived directory at any time.</p></div>
          </div>
          <div>
            <Label className="text-xs">Offboarding note <span className="text-zinc-500">(optional, retained in audit history)</span></Label>
            <Textarea className="mt-1.5 min-h-20" value={reason} onChange={event => setReason(event.target.value)} placeholder="e.g. Left the organisation on 19 July; active work reassigned to Service Desk." data-testid="archive-tech-reason" />
          </div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}

function DeleteArchivedTechnicianDialog({ tech, onClose, headers, onCompleted }) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setConfirmation(""); setBusy(false); }, [tech]);
  if (!tech) return null;
  const confirmationPhrase = `DELETE ${tech.email}`;

  const remove = async () => {
    setBusy(true);
    try {
      await axios.delete(`${API}/technicians/${tech.id}`, { headers });
      toast.success(`${tech.name}'s archived account was permanently deleted`);
      onCompleted?.();
      onClose();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not delete technician"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!tech} onOpenChange={open => !open && onClose()}>
      <NexusWorkflowDialog eyebrow="Irreversible account action" title="Permanently delete archived account?" description="This removes the account record. Archive is the preferred option for departures because it preserves the full staff history." icon={Trash2} tone="amber" className="max-w-lg" data-testid="delete-archived-tech-dialog" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><HoldToConfirmButton disabled={busy || confirmation !== confirmationPhrase} onComplete={remove} data-testid="delete-tech-submit">{busy ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Deleting account</> : "Hold to delete account"}</HoldToConfirmButton></>}>
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] p-3 text-xs leading-relaxed text-rose-100/90">
          Ticket and audit events remain attributed to the historic technician name, but this person can no longer be restored as an account.
        </div>
        <div>
          <Label className="text-xs">Type <span className="font-mono text-rose-200">{confirmationPhrase}</span> to confirm</Label>
          <Input className="mt-1.5 font-mono text-xs" value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={confirmationPhrase} data-testid="delete-tech-confirmation" />
        </div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}

// ---------- ADD USER (direct create) DIALOG ----------
function AddUserDialog({ open, onClose, onCreated, onManageRoles, headers, presets, roleOptions = ROLE_OPTIONS }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", job_title: "L1 Technician", role: "technician", hourly_rate: 75, password: "", is_admin: false });
  const [busy, setBusy] = useState(false);
  const [adminConfirmOpen, setAdminConfirmOpen] = useState(false);
  const [adminAcknowledged, setAdminAcknowledged] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ name: "", email: "", phone: "", job_title: "L1 Technician", role: "technician", hourly_rate: 75, password: "", is_admin: false });
      setAdminConfirmOpen(false);
      setAdminAcknowledged(false);
    }
  }, [open]);

  const grantAdministratorAccess = () => {
    setForm({ ...form, role: "admin", is_admin: true });
    setAdminConfirmOpen(false);
    setAdminAcknowledged(false);
  };
  const changeAccessRole = value => {
    if (value === "admin") { setAdminAcknowledged(false); setAdminConfirmOpen(true); return; }
    setForm({ ...form, role: value, is_admin: false });
  };

  const selectedRole = roleOptions.find(role => role.value === form.role) || ROLE_OPTIONS[0];
  const emailLocalPart = form.email.split("@", 1)[0].trim().toLowerCase();
  const passwordChecks = [
    { label: "12 or more characters", complete: form.password.length >= 12 },
    { label: "Uses three character types", complete: [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(pattern => pattern.test(form.password)).length >= 3 },
    { label: "Does not include the email name", complete: !!form.password && (!emailLocalPart || emailLocalPart.length < 3 || !form.password.toLowerCase().includes(emailLocalPart)) },
  ];
  const passwordChecksPassed = passwordChecks.filter(check => check.complete).length;
  const passwordReady = passwordChecksPassed === passwordChecks.length;

  const submit = async () => {
    if (!form.name.trim() || !form.email.trim() || !passwordReady) {
      toast.error("Complete the required member details and all password policy checks");
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
      <NexusWorkflowDialog eyebrow="Team operations" title="Provision team member" description="Create a secure, auditable NexusMSP account. Access is applied from the selected role and permission preset as soon as the account is created." icon={UserPlus} tone="emerald" className="max-w-3xl" contentClassName="space-y-4" data-testid="add-user-dialog" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={busy} data-testid="add-user-submit">{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}Create team member</Button></>}>
        <section className="grid gap-2 rounded-xl border border-primary/20 bg-primary/[0.045] p-3 sm:grid-cols-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">1. Identity</p><p className="mt-1 text-[11px] text-muted-foreground">Who is joining the team.</p></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-500 dark:text-violet-300">2. Access</p><p className="mt-1 text-[11px] text-muted-foreground">Role, title and permissions.</p></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-600 dark:text-cyan-300">3. Secure sign-in</p><p className="mt-1 text-[11px] text-muted-foreground">Initial credentials meet policy.</p></div></section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="mb-3"><p className="text-sm font-semibold text-zinc-100">Member details</p><p className="mt-1 text-xs text-zinc-500">Use the address that will receive team notifications and be used for sign-in. A profile photo can be added from Manage after the account is created.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
            <div><Label className="text-xs">Full name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Jane Smith" data-testid="add-user-name" /></div>
            <div><Label className="text-xs">Email *</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="jane@nexusops.io" data-testid="add-user-email" /></div>
            </div>
          </section>
          <section className="rounded-xl border border-violet-500/20 bg-violet-500/[0.035] p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-semibold text-zinc-100">Access and work profile</p><p className="mt-1 text-xs text-zinc-500">Role describes the operational remit; job title applies the starting permission preset.</p></div><Button type="button" size="sm" variant="outline" className="h-8 border-violet-500/35 text-xs text-violet-200 hover:bg-violet-500/10" onClick={() => { onClose(); onManageRoles?.(); }}>Manage roles</Button></div>
            <div className="grid gap-3 sm:grid-cols-2">
            <div><Label className="text-xs">Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+64 21 …" data-testid="add-user-phone" /></div>
            <div>
              <Label className="text-xs">Access role</Label>
              <Select value={form.role} onValueChange={changeAccessRole}>
                <SelectTrigger data-testid="add-user-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roleOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.value === "admin" ? `${o.label} (protected)` : o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            </div>
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-zinc-950/45 px-3 py-2.5"><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium text-violet-100">{selectedRole.label}</p>{selectedRole.protected && <Badge variant="outline" className="border-rose-500/35 text-[9px] uppercase text-rose-200">Protected</Badge>}</div><p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{selectedRole.description || "Role details are configured in Team Command."}</p></div>
          </section>
          <section className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.035] p-4">
            <div className="mb-3"><p className="text-sm font-semibold text-zinc-100">Work profile and secure first sign-in</p><p className="mt-1 text-xs text-zinc-500">Choose the starting permission preset, set the billable rate, then create a unique temporary password.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Job title (drives permission preset)</Label>
              <Select value={form.job_title} onValueChange={v => setForm({ ...form, job_title: v })}>
                <SelectTrigger data-testid="add-user-title"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(presets || {}).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Billable rate (AUD / hr)</Label><Input type="number" min="0" value={form.hourly_rate} onChange={e => setForm({ ...form, hourly_rate: Number(e.target.value) })} data-testid="add-user-rate" /></div>
          </div>
          <div>
            <Label className="text-xs">Initial password *</Label>
            <Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="At least 12 characters" data-testid="add-user-password" />
            <div className="mt-3 grid gap-2 sm:grid-cols-3">{passwordChecks.map(check => <div key={check.label} className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-[10px] ${check.complete ? "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-100" : "border-zinc-800 bg-zinc-950/45 text-zinc-500"}`}><CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${check.complete ? "text-emerald-300" : "text-zinc-600"}`} />{check.label}</div>)}</div>
            <p className={`mt-3 text-[11px] ${passwordReady ? "text-emerald-300" : "text-zinc-500"}`}>{passwordReady ? "Password meets the current NexusMSP policy." : `${passwordChecksPassed} of ${passwordChecks.length} password policy checks complete.`}</p>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-violet-500/20 bg-violet-500/[0.05] p-3">
            <div><p className="text-xs font-semibold text-zinc-100">Administrator access</p><p className="mt-1 text-[11px] leading-relaxed text-zinc-400">Create standard technician accounts by default. Administrator access is permanent and should only be granted deliberately.</p></div>
            <Button size="sm" variant="outline" onClick={() => { setAdminAcknowledged(false); setAdminConfirmOpen(true); }} className={form.is_admin ? "border-rose-500/40 text-rose-300 hover:bg-rose-500/10" : "border-violet-500/40 text-violet-200 hover:bg-violet-500/10"}>{form.is_admin ? "Enabled" : "Grant"}</Button>
            </div>
          </section>
      </NexusWorkflowDialog>
      <Dialog open={adminConfirmOpen} onOpenChange={setAdminConfirmOpen}>
        <NexusWorkflowDialog eyebrow="Protected access change" title="Grant administrator access?" description="This new user will be able to manage platform and team access. The account will be recorded as an administrator when created." icon={ShieldAlert} tone="amber" className="max-w-md" data-testid="confirm-new-admin-dialog" footer={<><Button variant="ghost" onClick={() => setAdminConfirmOpen(false)}>Cancel</Button><Button disabled={!adminAcknowledged} onClick={grantAdministratorAccess} variant="outline" className="border-rose-500/40 text-rose-300 hover:bg-rose-500/10">Grant access</Button></>}><label className="flex items-start gap-2 rounded-md border border-zinc-800 p-3 text-xs text-zinc-300"><input className="mt-0.5" type="checkbox" checked={adminAcknowledged} onChange={e => setAdminAcknowledged(e.target.checked)} /><span>I understand this account will receive permanent administrator access.</span></label></NexusWorkflowDialog>
      </Dialog>
    </Dialog>
  );
}

// ---------- INVITE USER DIALOG ----------
function InviteDialog({ open, onClose, onSent, onManageRoles, headers, presets, roleOptions = ROLE_OPTIONS }) {
  const [form, setForm] = useState({ name: "", email: "", role: "technician", job_title: "L1 Technician", hourly_rate: 75, message: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm({ name: "", email: "", role: "technician", job_title: "L1 Technician", hourly_rate: 75, message: "" });
  }, [open]);

  const send = async () => {
    if (!form.name.trim() || !/^\S+@\S+\.\S+$/.test(form.email.trim())) { toast.error("Enter a full name and valid work email address"); return; }
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

  const selectedRole = roleOptions.find(role => role.value === form.role) || ROLE_OPTIONS[0];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <NexusWorkflowDialog eyebrow="Secure team invitation" title="Invite team member" description="Send a secure, time-limited invitation. The recipient creates their own password, while the selected role and work profile are recorded before access is activated." icon={Mail} tone="cyan" className="max-h-[92vh] max-w-3xl" contentClassName="space-y-4 overflow-y-auto" data-testid="invite-user-dialog" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="info" onClick={send} disabled={busy} data-testid="invite-submit">{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}Send secure invitation</Button></>}>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/45 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300">1. Identity</p><p className="mt-1 text-[11px] text-zinc-400">Verify who the invitation is for.</p></div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/45 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-300">2. Access</p><p className="mt-1 text-[11px] text-zinc-400">Apply the right starting role.</p></div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/45 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">3. Acceptance</p><p className="mt-1 text-[11px] text-zinc-400">Recipient chooses their password.</p></div>
          </div>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="mb-3"><p className="text-sm font-semibold text-zinc-100">Recipient details</p><p className="mt-1 text-xs text-zinc-500">Use their business email. The invitation is addressed to this identity and its delivery status is retained for audit.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label className="text-xs">Full name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Jane Smith" data-testid="invite-name" /></div>
              <div><Label className="text-xs">Email *</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="jane@nexusops.io" data-testid="invite-email" /></div>
            </div>
          </section>
          <section className="rounded-xl border border-violet-500/20 bg-violet-500/[0.035] p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-zinc-100">Access and work profile</p><p className="mt-1 text-xs text-zinc-500">Invitations cannot grant administrator access. Use direct provisioning when elevation must be acknowledged.</p></div><Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-violet-200 hover:bg-violet-500/10" onClick={() => { onClose(); onManageRoles?.(); }}><Shield className="mr-1.5 h-3.5 w-3.5" />Manage roles</Button></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label className="text-xs">Access role</Label><Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}><SelectTrigger data-testid="invite-role"><SelectValue /></SelectTrigger><SelectContent>{roleOptions.filter(o => o.value !== "admin").map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-xs">Job title</Label><Select value={form.job_title} onValueChange={v => setForm({ ...form, job_title: v })}><SelectTrigger data-testid="invite-title"><SelectValue /></SelectTrigger><SelectContent>{Object.keys(presets || {}).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-xs">Billable rate (AUD / hr)</Label><Input type="number" min="0" value={form.hourly_rate} onChange={e => setForm({ ...form, hourly_rate: Number(e.target.value) })} data-testid="invite-rate" /></div>
            </div>
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-zinc-950/45 px-3 py-2.5"><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium text-violet-100">{selectedRole.label}</p>{selectedRole.protected && <Badge variant="outline" className="border-rose-500/35 text-[9px] uppercase text-rose-200">Protected</Badge>}</div><p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{selectedRole.description || "Role details are configured in Team Command."}</p></div>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/20 p-4"><Label className="text-sm font-semibold text-zinc-100">Welcome message <span className="text-xs font-normal text-zinc-500">(optional)</span></Label><p className="mt-1 text-xs text-zinc-500">Add a concise note the technician will see alongside their secure sign-in link.</p><Textarea rows={4} className="mt-3" value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="Welcome to the team. Please complete your profile and review the service desk handover before your first shift." data-testid="invite-message" /></section>
          <div className="flex items-start gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.05] px-3 py-3 text-xs leading-relaxed text-cyan-50/85"><History className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />The invitation, delivery outcome, acceptance, and any cancellation are retained in the team audit history.</div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}

// ---------- EDIT TECH DIALOG ----------
function EditTechDialog({ tech, onClose, headers, presets, roleOptions = ROLE_OPTIONS, onChanged }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [adminConfirmOpen, setAdminConfirmOpen] = useState(false);
  const [adminAcknowledged, setAdminAcknowledged] = useState(false);
  const [adminAction, setAdminAction] = useState(null);
  const [pendingRole, setPendingRole] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [scopeCatalog, setScopeCatalog] = useState({ clients: [], sites: [] });
  const [scopeSearch, setScopeSearch] = useState("");
  const [scopeLoading, setScopeLoading] = useState(false);
  const avatarInputRef = useRef(null);

  useEffect(() => {
    if (tech) setForm({
      name: tech.name || "", email: tech.email || "", phone: tech.phone || "",
      job_title: tech.job_title || "L1 Technician", role: tech.role || "technician",
      hourly_rate: tech.hourly_rate || 75, is_admin: !!tech.is_admin,
      categories: tech.categories || [], specialties: tech.specialties || [],
      client_scope_mode: tech.client_scope_mode || "all",
      client_scope_ids: tech.client_scope_ids || [],
      site_scope_ids: tech.site_scope_ids || [],
    });
    else setForm(null);
    setAdminConfirmOpen(false);
    setAdminAcknowledged(false);
    setAdminAction(null);
    setPendingRole(null);
    setAvatarUrl(tech?.avatar || "");
    setAvatarUploading(false);
    setScopeSearch("");
  }, [tech]);

  useEffect(() => {
    if (!tech) return;
    let active = true;
    setScopeLoading(true);
    axios.get(`${API}/technicians/scope-catalog`, { headers })
      .then(response => {
        if (active) setScopeCatalog({
          clients: response.data?.clients || [],
          sites: response.data?.sites || [],
        });
      })
      .catch(() => {
        if (active) setScopeCatalog({ clients: [], sites: [] });
      })
      .finally(() => { if (active) setScopeLoading(false); });
    return () => { active = false; };
  }, [tech, headers]);

  if (!tech || !form) return null;

  const save = async () => {
    if (!form.name.trim() || !form.email.trim()) { toast.error("Name and email are required"); return; }
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

  const hasAdministratorAccess = form.is_admin || form.role === "admin";
  const requestAdministratorChange = (action, nextRole = null) => {
    setAdminAction(action); setPendingRole(nextRole); setAdminAcknowledged(false); setAdminConfirmOpen(true);
  };
  const confirmAdministratorChange = () => {
    if (adminAction === "grant") setForm({ ...form, role: "admin", is_admin: true });
    else setForm({ ...form, role: pendingRole || (form.role === "admin" ? "technician" : form.role), is_admin: false });
    setAdminConfirmOpen(false); setAdminAcknowledged(false); setAdminAction(null); setPendingRole(null);
  };
  const changeAccessRole = value => {
    if (value === "admin" && !hasAdministratorAccess) return requestAdministratorChange("grant");
    if (value !== "admin" && hasAdministratorAccess) return requestAdministratorChange("revoke", value);
    setForm({ ...form, role: value });
  };
  const uploadAvatar = async event => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose a PNG, JPG, WebP, or GIF image");
      input.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Choose an image smaller than 10 MB");
      input.value = "";
      return;
    }
    setAvatarUploading(true);
    try {
      const payload = new FormData();
      payload.append("file", file);
      const response = await axios.post(`${API}/technicians/${tech.id}/avatar`, payload, {
        headers: { ...headers, "Content-Type": "multipart/form-data" },
      });
      setAvatarUrl(response.data?.avatar_url || "");
      toast.success(`${tech.name}'s profile photo updated`);
      onChanged?.();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not upload profile photo"); }
    finally { setAvatarUploading(false); input.value = ""; }
  };
  const workload = tech.workload || {};
  const selectedClientIds = new Set(form.client_scope_ids || []);
  const selectedSiteIds = new Set(form.site_scope_ids || []);
  const availableSites = scopeCatalog.sites.filter(site => selectedClientIds.has(site.client_id));
  const filteredClients = scopeCatalog.clients.filter(client => {
    const query = scopeSearch.trim().toLowerCase();
    return !query || `${client.name || ""} ${client.id || ""}`.toLowerCase().includes(query);
  });
  const toggleScopedClient = clientId => {
    const nextClients = new Set(form.client_scope_ids || []);
    if (nextClients.has(clientId)) nextClients.delete(clientId); else nextClients.add(clientId);
    const nextSites = (form.site_scope_ids || []).filter(siteId => {
      const site = scopeCatalog.sites.find(item => item.id === siteId);
      return site && nextClients.has(site.client_id);
    });
    setForm({ ...form, client_scope_ids: [...nextClients], site_scope_ids: nextSites });
  };
  const toggleScopedSite = siteId => {
    const next = new Set(form.site_scope_ids || []);
    if (next.has(siteId)) next.delete(siteId); else next.add(siteId);
    setForm({ ...form, site_scope_ids: [...next] });
  };
  const utilisation = workload.utilization_pct ?? workload.utilisation_pct ?? workload.utilisation ?? workload.utilization ?? 0;
  const statusLabel = workload.state ? `${workload.state} · ${utilisation}% utilised` : "No live workload signal";

  return (
    <Dialog open={!!tech} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="edit-tech-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Edit className="w-5 h-5 text-violet-400" />Manage {tech.name}</DialogTitle>
          <DialogDescription>Update team profile and work access. Personal preferences, signatures and notifications stay in My Workspace.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 rounded-xl border border-violet-500/20 bg-gradient-to-r from-violet-500/[0.08] to-card p-4 sm:flex-row sm:items-center">
          <Avatar className="h-16 w-16 shrink-0 rounded-2xl border-2 border-violet-400/30 bg-violet-500/10 shadow-lg shadow-violet-500/10"><AvatarImage src={avatarUrl} alt={`${tech.name} profile photo`} className="object-cover" /><AvatarFallback className="rounded-2xl bg-violet-500/10 text-lg font-bold text-violet-700 dark:text-violet-100">{tech.name?.split(" ").map(part => part[0]).join("") || "T"}</AvatarFallback></Avatar>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-foreground">Profile photo</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Shown on Team Command, ticket activity, comments, chat presence, and other technician work records.</p><div className="mt-3 flex flex-wrap items-center gap-2"><input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={uploadAvatar} data-testid="team-avatar-file" /><Button type="button" size="sm" variant="outline" className="border-violet-500/40 text-violet-700 hover:bg-violet-500/10 dark:text-violet-100" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading} data-testid="team-avatar-upload-btn">{avatarUploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}{avatarUploading ? "Uploading…" : avatarUrl ? "Replace photo" : "Upload photo"}</Button><span className="text-[11px] text-muted-foreground">PNG, JPG, WebP, or GIF · up to 10 MB</span></div></div>
        </div>
        <div className="grid grid-cols-1 gap-2 rounded-lg border border-border/80 bg-muted/25 p-3 text-xs sm:grid-cols-3">
          <div><p className="text-muted-foreground">Live workload</p><p className="mt-1 font-medium capitalize text-foreground">{statusLabel}</p></div>
          <div><p className="text-muted-foreground">Open tickets</p><p className="mt-1 font-medium text-foreground">{workload.open_tickets ?? workload.open ?? 0}</p></div>
          <div><p className="text-muted-foreground">On-call</p><p className="mt-1 font-medium text-foreground">{tech.on_call_status || workload.on_call ? "Currently rostered" : "Not rostered"}</p></div>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Full name <span className="text-rose-300">*</span></Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label className="text-xs">Email <span className="text-rose-300">*</span></Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Optional contact number" /></div>
            <div>
              <Label className="text-xs">Access role</Label>
              <Select value={form.role} onValueChange={changeAccessRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{roleOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.value === "admin" ? `${o.label} (protected)` : o.label}</SelectItem>)}</SelectContent>
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
            <div><Label className="text-xs">Billable rate (AUD / hr)</Label><Input type="number" min="0" value={form.hourly_rate} onChange={e => setForm({ ...form, hourly_rate: Number(e.target.value) })} /></div>
          </div>
          <section className="rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.06] to-card p-4" data-testid="technician-client-scope">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
                  <p className="text-xs font-semibold text-foreground">Client &amp; site scope</p>
                  <Badge variant="outline" className={form.client_scope_mode === "all" ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "border-cyan-500/30 text-cyan-700 dark:text-cyan-300"}>
                    {hasAdministratorAccess ? "All via administrator" : form.client_scope_mode === "all" ? "All clients" : `${form.client_scope_ids.length} selected`}
                  </Badge>
                </div>
                <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">Limit which customer environments this technician can operate on. The API checks this boundary for remote, billing, identity, DNS, and automation actions.</p>
              </div>
              <Select value={form.client_scope_mode} onValueChange={value => setForm({ ...form, client_scope_mode: value, client_scope_ids: value === "all" ? [] : form.client_scope_ids, site_scope_ids: value === "all" ? [] : form.site_scope_ids })} disabled={hasAdministratorAccess}>
                <SelectTrigger className="w-full sm:w-44" data-testid="client-scope-mode"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All clients</SelectItem><SelectItem value="restricted">Selected clients</SelectItem></SelectContent>
              </Select>
            </div>
            {hasAdministratorAccess && <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/[0.05] px-3 py-2 text-[11px] text-rose-100/80">Administrators always span every client and site. Remove administrator access before applying a narrower operational boundary.</div>}
            {!hasAdministratorAccess && form.client_scope_mode === "restricted" && (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/35 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2"><Label className="text-[11px] font-semibold text-zinc-200">Allowed clients</Label><span className="text-[10px] text-zinc-500">{form.client_scope_ids.length} selected</span></div>
                  <div className="relative mb-2"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-600" /><Input className="h-8 pl-8 text-xs" value={scopeSearch} onChange={event => setScopeSearch(event.target.value)} placeholder="Search clients…" data-testid="client-scope-search" /></div>
                  <ScrollArea className="h-40 pr-2">
                    <div className="space-y-1.5">
                      {scopeLoading ? <div className="flex items-center gap-2 px-2 py-4 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading clients…</div> : filteredClients.map(client => {
                        const selected = selectedClientIds.has(client.id);
                        return <button key={client.id} type="button" onClick={() => toggleScopedClient(client.id)} className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition ${selected ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-50" : "border-zinc-800 bg-zinc-950/20 text-zinc-300 hover:border-zinc-700"}`}><span className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? "border-cyan-400 bg-cyan-400 text-zinc-950" : "border-zinc-700"}`}>{selected && <CheckCircle2 className="h-3 w-3" />}</span><span className="min-w-0 flex-1 truncate">{client.name}</span></button>;
                      })}
                      {!scopeLoading && !filteredClients.length && <p className="px-2 py-4 text-xs text-zinc-500">No matching clients.</p>}
                    </div>
                  </ScrollArea>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/35 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2"><Label className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-200"><MapPin className="h-3.5 w-3.5 text-cyan-300" />Optional site boundary</Label><span className="text-[10px] text-zinc-500">{form.site_scope_ids.length || "All"} sites</span></div>
                  <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">Select sites to narrow access further. Leave every site clear to allow all sites belonging to the selected clients.</p>
                  <ScrollArea className="h-40 pr-2">
                    <div className="space-y-1.5">
                      {availableSites.map(site => {
                        const selected = selectedSiteIds.has(site.id);
                        return <button key={site.id} type="button" onClick={() => toggleScopedSite(site.id)} className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition ${selected ? "border-violet-500/35 bg-violet-500/10 text-violet-50" : "border-zinc-800 bg-zinc-950/20 text-zinc-300 hover:border-zinc-700"}`}><span className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border ${selected ? "border-violet-400 bg-violet-400 text-zinc-950" : "border-zinc-700"}`}>{selected && <CheckCircle2 className="h-3 w-3" />}</span><span className="min-w-0 flex-1"><span className="block truncate">{site.name}</span><span className="block truncate text-[10px] text-zinc-500">{site.client_name}</span></span></button>;
                      })}
                      {!availableSites.length && <p className="px-2 py-4 text-xs leading-relaxed text-zinc-500">{form.client_scope_ids.length ? "No managed sites are recorded for the selected clients. Client-level access will apply." : "Select a client to view its managed sites."}</p>}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            )}
          </section>
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.05] p-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2"><Shield className="h-4 w-4 text-violet-300" /><p className="text-xs font-semibold text-zinc-100">Administrator access</p><Badge variant="outline" className={hasAdministratorAccess ? "border-rose-500/40 text-rose-300" : "border-zinc-700 text-zinc-400"}>{hasAdministratorAccess ? "Enabled" : "Standard"}</Badge></div>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">Administrators can change team access and platform settings. Use JIT for temporary elevated access instead.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => requestAdministratorChange(hasAdministratorAccess ? "revoke" : "grant")} className={hasAdministratorAccess ? "border-rose-500/40 text-rose-300 hover:bg-rose-500/10" : "border-violet-500/40 text-violet-200 hover:bg-violet-500/10"}>{hasAdministratorAccess ? "Remove" : "Grant"}</Button>
            </div>
            <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-[11px] text-zinc-400">Effective permission preset: <span className="font-medium text-zinc-200">{form.job_title}</span>. Fine-grained permissions are managed from the Permissions tab.</div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy} variant="outline" className="text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/10">
            {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
      <Dialog open={adminConfirmOpen} onOpenChange={setAdminConfirmOpen}>
        <DialogContent className="max-w-md" data-testid="confirm-admin-access-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-rose-400" />{adminAction === "grant" ? "Grant administrator access?" : "Remove administrator access?"}</DialogTitle>
            <DialogDescription>{adminAction === "grant" ? `${tech.name} will be able to manage platform and team access. This permanent change will be recorded in the Team audit log.` : `${tech.name} will lose administrator access immediately. Use JIT instead when elevated access only needs to be temporary.`}</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 rounded-md border border-zinc-800 p-3 text-xs text-zinc-300"><input className="mt-0.5" type="checkbox" checked={adminAcknowledged} onChange={e => setAdminAcknowledged(e.target.checked)} /><span>I understand the impact of this access change.</span></label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdminConfirmOpen(false)}>Cancel</Button>
            <Button disabled={!adminAcknowledged} onClick={confirmAdministratorChange} variant="outline" className="border-rose-500/40 text-rose-300 hover:bg-rose-500/10">{adminAction === "grant" ? "Grant access" : "Remove access"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

// ---------- INVITES TAB ----------
function InvitesTab({ headers }) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(null);
  const [actionId, setActionId] = useState(null);

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
    setActionId(id);
    try {
      await axios.delete(`${API}/technicians/invites/${id}`, { headers });
      toast.success("Invite cancelled");
      setCancelling(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setActionId(null); }
  };

  const resend = async (id) => {
    setActionId(id);
    try {
      await axios.post(`${API}/technicians/invites/${id}/resend`, {}, { headers });
      toast.success("Invite resent");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setActionId(null); }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>;

  return (
    <div className="space-y-3" data-testid="invites-tab">
      {invites.length === 0 ? (
        <Card className="border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.06] via-zinc-950 to-zinc-950"><CardContent className="flex flex-col items-center py-10 text-center"><div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-500/25 bg-cyan-500/10"><Mail className="h-5 w-5 text-cyan-300" /></div><p className="mt-3 text-sm font-semibold text-zinc-100">No active invitations</p><p className="mt-1 max-w-md text-xs leading-relaxed text-zinc-500">When you invite a technician, delivery, acceptance and expiry are tracked here for a complete access record.</p></CardContent></Card>
      ) : invites.map(inv => (
        <Card key={inv.id} className="border-zinc-800 bg-zinc-950/55 transition-colors hover:border-cyan-500/30" data-testid={`invite-${inv.id}`}>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10"><Mail className="h-4 w-4 text-cyan-300" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{inv.name}</span>
                <Badge variant="outline" className="border-violet-500/35 text-[9px] uppercase text-violet-200">{inv.role || "technician"}</Badge>
                <Badge variant="outline" className={`text-[9px] uppercase ${inv.status === "pending" ? "border-amber-500/40 bg-amber-500/[0.08] text-amber-200" : "border-zinc-700 text-zinc-400"}`}>{inv.status}</Badge>
              </div>
              <div className="text-[10px] text-zinc-500 font-mono">
                {inv.email} · invited by {inv.invited_by} · expires {inv.expires_at ? formatDistanceToNow(new Date(inv.expires_at), { addSuffix: true }) : "—"}
              </div>
            </div>
            {inv.status === "pending" && <div className="flex shrink-0 items-center gap-1"><Button size="sm" variant="outline" className="h-8 border-cyan-500/35 text-xs text-cyan-100 hover:bg-cyan-500/10" disabled={actionId === inv.id} onClick={() => resend(inv.id)} data-testid={`invite-resend-${inv.id}`}>{actionId === inv.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}Resend</Button><Button size="sm" variant="ghost" className="h-8 text-xs text-rose-300 hover:bg-rose-500/10" disabled={actionId === inv.id} onClick={() => setCancelling(inv)} data-testid={`invite-cancel-${inv.id}`}><XCircle className="mr-1.5 h-3.5 w-3.5" />Cancel</Button></div>}
          </CardContent>
        </Card>
      ))}
      <Dialog open={!!cancelling} onOpenChange={open => !open && setCancelling(null)}>
        <NexusWorkflowDialog eyebrow="Invitation lifecycle" title="Cancel this invitation?" description={`The sign-in link for ${cancelling?.email || "this recipient"} will immediately stop working. This action is retained in the team audit history.`} icon={XCircle} tone="amber" className="max-w-md" data-testid="cancel-invite-dialog" footer={<><Button variant="ghost" onClick={() => setCancelling(null)}>Keep invitation</Button><Button variant="destructive" disabled={actionId === cancelling?.id} onClick={() => cancel(cancelling.id)} data-testid="cancel-invite-submit">{actionId === cancelling?.id && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Cancel invitation</Button></>}><div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.06] p-3 text-xs leading-relaxed text-rose-100/85">You can send a new invitation later if the technician still needs access.</div></NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}

// ---------- SMART FINDER TAB ----------
function TechFinderTab({ headers, capacity }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [intent, setIntent] = useState(null);

  const searchFor = async (value) => {
    if (!value.trim()) { setResults([]); setIntent(null); return; }
    setLoading(true);
    try {
      const r = await axios.post(`${API}/tech-intel/find`, { query: value }, { headers });
      setResults(r.data.results || []);
      setIntent(r.data.intent || null);
    } catch { toast.error("Search failed"); }
    finally { setLoading(false); }
  };
  const submit = async (e) => { e?.preventDefault?.(); await searchFor(query); };

  const display = results.length ? results : (capacity?.techs?.slice(0, 6) || []);

  return (
    <div className="space-y-4" data-testid="tech-finder-tab">
      <section className="overflow-hidden rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_86%_0%,hsl(var(--primary)/0.2),transparent_38%),linear-gradient(120deg,hsl(var(--card)),hsl(var(--background)))] p-5 shadow-[0_16px_42px_-30px_hsl(var(--primary)/0.7)]">
        <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary"><Sparkles className="h-5 w-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Smart dispatch</p><h2 className="text-xl font-bold tracking-tight">Find the right technician</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Describe the work, required capability, or availability. Nexus turns the request into a ranked operational match.</p></div></div>
        <div className="mt-4 flex flex-wrap gap-2">{["L2 with Microsoft 365 experience available now", "Network specialist for a firewall incident", "Technician with backup and recovery expertise"].map(example => <Button key={example} type="button" size="sm" variant="outline" className="h-auto whitespace-normal border-primary/20 text-left text-xs" onClick={() => { setQuery(example); searchFor(example); }}>{example}</Button>)}</div>
      </section>
      <form onSubmit={submit} className="relative rounded-xl border border-primary/20 bg-card/65 p-2 shadow-sm">
        <Sparkles className="absolute left-5 top-5 h-4 w-4 text-primary" />
        <Input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder='Try: "L2 with VMware experience available now"'
          className="h-11 border-border/70 bg-background/70 pl-10 pr-24 focus-visible:border-primary"
          data-testid="tech-finder-input"
        />
        <Button type="submit" size="sm" className="absolute right-1.5 top-1.5 h-8" variant="outline" disabled={loading} data-testid="tech-finder-submit">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Search className="w-3 h-3 mr-1" />Find</>}
        </Button>
      </form>

      {intent && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/15 bg-primary/[0.035] px-3 py-2.5 text-[10px]">
          <span className="mr-1 font-semibold uppercase tracking-widest text-primary/80">Nexus understood</span>
          {(intent.skills || []).map(s => <Badge key={s} variant="outline" className="border-violet-500/30 text-[10px] text-violet-700 dark:text-violet-300">{s}</Badge>)}
          {intent.level && <Badge variant="outline" className="border-cyan-500/30 text-[10px] text-cyan-700 dark:text-cyan-300">{intent.level}</Badge>}
          {intent.needs_available && <Badge variant="outline" className="border-emerald-500/30 text-[10px] text-emerald-700 dark:text-emerald-300">available now</Badge>}
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
  const summary = capacity.summary || {};
  const techs = capacity.techs || [];
  return (
    <div className="space-y-4" data-testid="capacity-tab">
      <section className="flex flex-col gap-4 overflow-hidden rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_86%_0%,hsl(var(--primary)/0.2),transparent_38%),linear-gradient(120deg,hsl(var(--card)),hsl(var(--background)))] p-5 shadow-[0_16px_42px_-30px_hsl(var(--primary)/0.7)] lg:flex-row lg:items-center lg:justify-between">
        <div><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary"><Activity className="h-5 w-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Live staffing signal</p><h2 className="text-xl font-bold tracking-tight">Capacity decision board</h2></div></div><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Use the current workload mix to route the next ticket to the right person before a queue or SLA becomes a problem.</p></div>
        <div className="grid grid-cols-4 gap-2"><div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-center"><p className="text-lg font-bold text-emerald-500">{summary.idle || 0}</p><p className="text-[10px] text-muted-foreground">ready</p></div><div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-center"><p className="text-lg font-bold text-cyan-500">{summary.active || 0}</p><p className="text-[10px] text-muted-foreground">active</p></div><div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-center"><p className="text-lg font-bold text-amber-500">{summary.busy || 0}</p><p className="text-[10px] text-muted-foreground">busy</p></div><div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.05] px-3 py-2 text-center"><p className="text-lg font-bold text-rose-400">{summary.overloaded || 0}</p><p className="text-[10px] text-muted-foreground">at risk</p></div></div>
      </section>
      <Card className="overflow-hidden border-border/70 bg-card/70">
        <CardHeader className="border-b border-border/70 bg-muted/[0.14] pb-4"><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-primary" />Technician workload</CardTitle><p className="mt-1 text-xs text-muted-foreground">Open work and overdue items are shown alongside utilisation. Assign new work to a ready technician where possible.</p></CardHeader>
        <CardContent className="p-3 sm:p-4">
          <div className="space-y-1.5">
            {techs.map(t => {
              const w = t.workload || {};
              const state = w.state || "idle";
              const fill = state === "overloaded" ? "from-rose-500 to-red-500" :
                           state === "busy" ? "from-amber-500 to-orange-500" :
                           state === "active" ? "from-cyan-500 to-blue-500" :
                           "from-emerald-500 to-green-500";
              return (
                <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-transparent px-3 py-3 transition-colors hover:border-primary/15 hover:bg-muted/30 sm:flex-nowrap">
                  <div className="w-32 truncate">
                    <div className="text-xs font-medium truncate">{t.name}</div>
                    <div className="text-[10px] text-muted-foreground">{t.job_title || "Technician"}</div>
                  </div>
                  <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full bg-gradient-to-r ${fill} transition-all`} style={{ width: `${Math.min(100, w.utilization_pct || 0)}%` }} />
                  </div>
                  <div className="w-12 text-right text-xs font-semibold tabular-nums">{w.utilization_pct ?? 0}%</div>
                  <Badge variant="outline" className={`text-[9px] uppercase ${STATE_COLORS[state]}`}>{state}</Badge>
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
function AccessRoleSettings({ headers, roleOptions, onSaved }) {
  const [roles, setRoles] = useState(roleOptions);
  const [busy, setBusy] = useState(false);
  const [newRole, setNewRole] = useState({ label: "", description: "" });
  const [actionCatalog, setActionCatalog] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState("technician");

  useEffect(() => { setRoles(roleOptions); }, [roleOptions]);
  useEffect(() => {
    axios.get(`${API}/permissions/catalog`, { headers })
      .then(response => setActionCatalog(response.data?.categories || []))
      .catch(() => setActionCatalog([]));
  }, [headers]);
  useEffect(() => {
    if (!roles.some(role => role.value === selectedRoleId) && roles.length) setSelectedRoleId(roles[0].value);
  }, [roles, selectedRoleId]);

  const update = (value, field, nextValue) => setRoles(current => current.map(role => role.value === value ? { ...role, [field]: nextValue } : role));
  const toggleAction = (roleId, permissionId) => {
    if (roleId === "admin") return;
    setRoles(current => current.map(role => {
      if (role.value !== roleId) return role;
      const permissions = new Set(role.action_permissions || []);
      if (permissions.has(permissionId)) permissions.delete(permissionId);
      else permissions.add(permissionId);
      return { ...role, action_permissions: [...permissions].sort(), action_permissions_explicit: true };
    }));
  };
  const addRole = () => {
    const label = newRole.label.trim();
    const description = newRole.description.trim();
    if (label.length < 2) { toast.error("Give the new role a name of at least 2 characters"); return; }
    if (description.length > 180) { toast.error("Keep the role description to 180 characters or fewer"); return; }
    if (roles.some(role => role.label.trim().toLowerCase() === label.toLowerCase())) { toast.error("Each access role needs a unique name"); return; }
    const stem = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "team_role";
    let value = `custom_${stem}`;
    let suffix = 2;
    while (roles.some(role => role.value === value)) { value = `custom_${stem.slice(0, 37)}_${suffix}`; suffix += 1; }
    const startingPermissions = roles.find(role => role.value === "technician")?.action_permissions || [];
    setRoles(current => [...current, { value, id: value, label, description, custom: true, protected: false, action_permissions: [...startingPermissions], action_permissions_explicit: true }]);
    setSelectedRoleId(value);
    setNewRole({ label: "", description: "" });
  };
  const retireRole = value => {
    const role = roles.find(item => item.value === value);
    if (!role?.custom) return;
    setRoles(current => current.filter(item => item.value !== value));
  };
  const save = async () => {
    setBusy(true);
    try {
      const response = await axios.put(`${API}/technicians/access-roles`, {
        roles: roles.map(({ value, label, description, action_permissions, action_permissions_explicit }) => ({
          id: value,
          label,
          description,
          ...(action_permissions_explicit ? { action_permissions } : {}),
        })),
      }, { headers });
      const next = (response.data?.roles || []).map(role => ({ value: role.id, ...role }));
      setRoles(next);
      onSaved?.(next);
      toast.success("Access role catalogue saved");
    } catch (error) { toast.error(error.response?.data?.detail || "Could not save access roles"); }
    finally { setBusy(false); }
  };
  const selectedRole = roles.find(role => role.value === selectedRoleId) || roles[0];
  const selectedPermissions = new Set(selectedRole?.action_permissions || []);
  const selectedCount = selectedRole?.value === "admin"
    ? actionCatalog.reduce((total, category) => total + category.actions.length, 0)
    : selectedPermissions.size;

  return (
    <div className="space-y-4">
      <Card className="border-violet-500/20 bg-violet-500/[0.03]">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
          <div><CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4 w-4 text-violet-300" />Access role catalogue</CardTitle><p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-500">Rename standard roles or add your own operational roles. Role IDs stay stable for automation and auditing; only the protected administrator role can grant platform-wide administrator access.</p></div>
          <Button size="sm" onClick={save} disabled={busy} className="shrink-0">{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}Save roles & access</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-2">
            {roles.map(role => (
              <div key={role.value} className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2"><span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">{role.value}</span><div className="flex items-center gap-1">{role.custom && <Badge variant="outline" className="border-cyan-500/35 text-[9px] text-cyan-200">Custom</Badge>}{role.value === "admin" && <Badge variant="outline" className="border-rose-500/35 text-[9px] text-rose-300">Protected</Badge>}</div></div>
                <Label className="text-xs">Display name</Label>
                <Input className="mt-1 h-8 text-sm" value={role.label} onChange={event => update(role.value, "label", event.target.value)} />
                <Label className="mt-2 block text-xs">Purpose</Label>
                <Input className="mt-1 h-8 text-xs" value={role.description || ""} onChange={event => update(role.value, "description", event.target.value)} placeholder="What this role is for" />
                {role.custom && <div className="mt-3 flex justify-end"><Button type="button" size="sm" variant="ghost" className="h-7 text-[10px] text-rose-300 hover:bg-rose-500/10" onClick={() => retireRole(role.value)}><Trash2 className="mr-1 h-3 w-3" />Remove custom role</Button></div>}
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-dashed border-violet-500/35 bg-zinc-950/45 p-4">
            <div className="mb-3"><p className="text-sm font-semibold text-zinc-100">Add organisation role</p><p className="mt-1 text-xs text-zinc-500">Use this for operational labels such as Project Delivery Lead, Account Manager or Field Engineer. New roles start from the Technician action policy and can be refined below.</p></div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] md:items-end"><div><Label className="text-xs">Role name</Label><Input className="mt-1" value={newRole.label} onChange={event => setNewRole(current => ({ ...current, label: event.target.value }))} placeholder="Field Engineer" data-testid="new-access-role-name" /></div><div><Label className="text-xs">Purpose <span className="text-zinc-500">(optional)</span></Label><Input className="mt-1" value={newRole.description} onChange={event => setNewRole(current => ({ ...current, description: event.target.value }))} placeholder="Owns onsite delivery and site handover work." data-testid="new-access-role-description" /></div><Button type="button" onClick={addRole} variant="outline" className="border-violet-500/40 text-violet-200 hover:bg-violet-500/10" data-testid="add-access-role"><UserPlus className="mr-1.5 h-4 w-4" />Add role</Button></div>
            </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-cyan-500/20 bg-cyan-500/[0.025]" data-testid="action-permission-policy">
        <CardHeader className="border-b border-zinc-800 bg-gradient-to-r from-cyan-500/[0.07] to-transparent pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Lock className="h-4 w-4 text-cyan-300" />Protected action policy</CardTitle>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-zinc-500">Control the exact actions each role may perform. These stable subjects are enforced by the API for DNS, remote access, Microsoft identity, billing and automation—not just hidden in the interface.</p>
            </div>
            <Badge variant="outline" className="border-cyan-500/30 text-cyan-200">{selectedCount} actions granted</Badge>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {roles.map(role => (
              <Button
                key={role.value}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSelectedRoleId(role.value)}
                className={selectedRoleId === role.value ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100" : "border-zinc-800 bg-zinc-950/60 text-zinc-400"}
              >
                {role.label}
                {role.value === "admin" && <Crown className="ml-1.5 h-3 w-3 text-amber-300" />}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-4">
          {selectedRole?.value === "admin" && (
            <div className="mb-4 rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-200">Administrator access is protected and always includes every registered action. Assign this role sparingly; changes remain auditable.</div>
          )}
          {!actionCatalog.length ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Loading action catalogue…</div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {actionCatalog.map(category => (
                <div key={category.name} className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">{category.name}</p><span className="text-[10px] text-zinc-600">{category.actions.filter(action => selectedRole?.value === "admin" || selectedPermissions.has(action.id)).length}/{category.actions.length}</span></div>
                  <div className="space-y-2">
                    {category.actions.map(action => {
                      const enabled = selectedRole?.value === "admin" || selectedPermissions.has(action.id);
                      const impactClass = action.impact === "critical" ? "border-rose-500/30 text-rose-300" : action.impact === "high" ? "border-amber-500/30 text-amber-300" : action.impact === "medium" ? "border-violet-500/30 text-violet-300" : "border-cyan-500/30 text-cyan-300";
                      return (
                        <button
                          type="button"
                          key={action.id}
                          disabled={selectedRole?.value === "admin"}
                          onClick={() => toggleAction(selectedRole.value, action.id)}
                          className={`w-full rounded-lg border p-3 text-left transition ${enabled ? "border-cyan-500/30 bg-cyan-500/[0.06]" : "border-zinc-800 bg-zinc-950/30 opacity-70"} ${selectedRole?.value === "admin" ? "cursor-default" : "hover:border-cyan-500/45"}`}
                          data-testid={`action-permission-${action.id}`}
                        >
                          <div className="flex items-start gap-3">
                            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${enabled ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-200" : "border-zinc-700 text-zinc-600"}`}>{enabled ? "✓" : "—"}</span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5"><span className="text-xs font-medium text-zinc-100">{action.label}</span><Badge variant="outline" className={`h-4 px-1.5 text-[8px] uppercase ${impactClass}`}>{action.impact}</Badge>{action.approval_required && <Badge variant="outline" className="h-4 border-rose-500/30 px-1.5 text-[8px] uppercase text-rose-200">Approval boundary</Badge>}</span>
                              <span className="mt-1 block text-[10px] leading-relaxed text-zinc-500">{action.description}</span>
                              <span className="mt-1.5 block font-mono text-[9px] text-zinc-600">{action.id}</span>
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const MODULE_SHORT_LABELS = {
  tickets: "Tickets", clients: "Clients", invoices: "Invoices", products: "Products", devices: "Devices", networking: "Network",
  assets: "Assets", reports: "Reports", knowledge_base: "Knowledge", it_docs: "Docs", contracts: "Contracts", projects: "Projects",
  time_tracking: "Time", purchase_orders: "POs", scheduling: "Schedule", settings: "Settings",
};

function PermissionMatrixTab({ headers, presets, roleOptions, onRolesChanged }) {
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

  const coverage = useMemo(() => {
    if (!matrix) return { admins: 0, editable: 0, readOnly: 0, gaps: 0 };
    return matrix.rows.reduce((summary, row) => {
      if (row.is_admin) summary.admins += 1;
      Object.values(row.cells || {}).forEach(level => {
        if (level === "write") summary.editable += 1;
        else if (level === "read") summary.readOnly += 1;
        else if (level === "none") summary.gaps += 1;
      });
      return summary;
    }, { admins: 0, editable: 0, readOnly: 0, gaps: 0 });
  }, [matrix]);

  const roleLabel = value => roleOptions.find(role => role.value === value)?.label || value?.replace(/_/g, " ") || "Technician";

  if (loading || !matrix) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>;

  return (
    <div className="space-y-4" data-testid="permission-matrix-tab">
      <AccessRoleSettings headers={headers} roleOptions={roleOptions} onSaved={onRolesChanged} />
      <MetricStrip columns={4}>
        <MetricTile label="Administrators" value={coverage.admins} accent="rose" icon={<Crown className="h-2.5 w-2.5 text-rose-300" />} />
        <MetricTile label="Editable grants" value={coverage.editable} accent="violet" icon={<Edit className="h-2.5 w-2.5 text-violet-300" />} />
        <MetricTile label="Read-only grants" value={coverage.readOnly} accent="cyan" icon={<Shield className="h-2.5 w-2.5 text-cyan-300" />} />
        <MetricTile label="No access cells" value={coverage.gaps} accent={coverage.gaps ? "amber" : "zinc"} icon={<Lock className="h-2.5 w-2.5 text-amber-300" />} />
      </MetricStrip>
      <Card className="overflow-hidden border-zinc-800 bg-zinc-950/60">
        <CardHeader className="border-b border-zinc-800 bg-gradient-to-r from-violet-500/[0.07] to-transparent pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><CardTitle className="text-base flex items-center gap-2"><Shield className="w-4 h-4 text-violet-300" />Access coverage</CardTitle><p className="mt-1 text-xs text-zinc-500">A quick visual read of access by technician and module. Select a preset to preview changes before applying them.</p></div>
            <Button size="sm" variant="ghost" onClick={load} className="h-8 text-xs"><RefreshCw className="mr-1 h-3 w-3" />Refresh</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-medium">
            {["admin", "write", "read", "none"].map(level => <span key={level} className={`rounded-full border px-2 py-1 uppercase tracking-wider ${PERM_COLORS[level]}`}><span className="mr-1 font-mono">{PERM_INITIAL[level]}</span>{level === "write" ? "edit" : level === "read" ? "view" : level === "none" ? "no access" : "full access"}</span>)}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full min-w-[1120px] text-xs border-collapse">
              <thead>
                <tr className="bg-zinc-900/60">
                  <th className="text-left px-4 py-3 sticky left-0 bg-zinc-900 z-10 min-w-[220px] text-[10px] uppercase tracking-widest text-zinc-500">Technician</th>
                  {matrix.modules.map(m => (
                    <th key={m} title={m.replace(/_/g, " ")} className="min-w-[48px] px-1 py-3 text-center text-[9px] uppercase tracking-wide text-zinc-500 font-mono whitespace-nowrap">{MODULE_SHORT_LABELS[m] || m}</th>
                  ))}
                  <th className="px-3 py-3 text-[9px] uppercase tracking-widest text-zinc-500 font-mono">Apply preset</th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map(row => (
                  <tr key={row.tech_id} className="border-t border-zinc-900 hover:bg-violet-500/[0.035] transition-colors">
                    <td className="px-4 py-3 sticky left-0 bg-zinc-950 z-10">
                      <div className="flex items-center gap-2"><div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${row.is_admin ? "bg-rose-500/15 text-rose-200" : "bg-violet-500/15 text-violet-200"}`}>{(row.name || "?").split(" ").map(part => part[0]).join("").slice(0, 2)}</div><div className="min-w-0"><div className="flex items-center gap-1.5">{row.is_admin && <Crown className="h-3 w-3 text-amber-400 shrink-0" />}<span className="font-medium truncate">{row.name}</span></div><div className="mt-0.5 flex items-center gap-1.5"><Badge variant="outline" className="h-4 border-zinc-700 px-1.5 text-[8px] text-zinc-400">{roleLabel(row.role)}</Badge><span className="truncate text-[10px] text-zinc-600">{row.job_title}</span></div></div></div>
                    </td>
                    {matrix.modules.map(m => (
                      <td key={m} className="px-1 py-2 text-center">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-[9px] font-bold font-mono ${PERM_COLORS[row.cells[m]] || PERM_COLORS.none}`}>{PERM_INITIAL[row.cells[m]] || "·"}</span>
                      </td>
                    ))}
                    <td className="px-3 py-2">
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
            <Button onClick={apply} variant="success">Apply</Button>
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
                  <p className="mt-1 text-xs text-muted-foreground">{cleanDisplayText(d.rationale)}</p>
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
  const [bgAcknowledged, setBgAcknowledged] = useState(false);

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
    if (!bgAcknowledged) { toast.error("Acknowledge the emergency access conditions"); return; }
    try { await axios.post(`${API}/permission-elevation/break-glass`, bg, { headers }); toast.success("BREAK GLASS active"); setBgOpen(false); setBg({ duration_minutes: 15, reason: "" }); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const closeBreakGlass = (open) => {
    setBgOpen(open);
    if (!open) setBgAcknowledged(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Temporary access control</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Grant only the access required, for a fixed window, with automatic rollback and a permanent audit record.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-9 text-xs text-violet-700 border-violet-500/40 hover:bg-violet-500/10 dark:text-violet-300" onClick={() => setGrantOpen(true)}><Unlock className="w-3.5 h-3.5 mr-1.5" />Grant access</Button>
          <Button size="sm" variant="outline" className="h-9 text-xs text-rose-700 border-rose-500/40 hover:bg-rose-500/10 dark:text-rose-300" onClick={() => closeBreakGlass(true)}><ShieldAlert className="w-3.5 h-3.5 mr-1.5" />Break glass</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { Icon: Target, title: "Bounded scope", body: "Permission presets keep elevated access deliberate and reviewable.", tone: "text-cyan-700 bg-cyan-500/10 dark:text-cyan-300" },
          { Icon: Clock, title: "Automatic expiry", body: "Access reverts automatically at the end of the approved window.", tone: "text-violet-700 bg-violet-500/10 dark:text-violet-300" },
          { Icon: History, title: "Evidence retained", body: "Requester, approver, reason, duration and revocation remain auditable.", tone: "text-emerald-700 bg-emerald-500/10 dark:text-emerald-300" },
        ].map(({ Icon, title, body, tone }) => (
          <Card key={title} className="border-border/70 bg-card/70 shadow-sm">
            <CardContent className="flex gap-3 p-4">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" /></div>
              <div><p className="text-xs font-semibold text-foreground">{title}</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{body}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading ? <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div> :
       active.length === 0 ? <Card className="border-dashed border-border bg-muted/20"><CardContent className="flex flex-col items-center p-8 text-center"><div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5" /></div><p className="text-sm font-semibold text-foreground">No elevated access is active</p><p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">The team is operating at standard privilege. Start a time-bound grant only when a technician needs additional access to complete approved work.</p><Button size="sm" variant="outline" className="mt-4 h-9 border-violet-500/40 text-violet-700 hover:bg-violet-500/10 dark:text-violet-300" onClick={() => setGrantOpen(true)}><Unlock className="mr-1.5 h-3.5 w-3.5" />Grant temporary access</Button></CardContent></Card> :
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
        <NexusWorkflowDialog eyebrow="Time-bound access" title="Grant just-in-time access" description="Give one technician a defined permission preset for a limited, fully audited window." icon={Zap} tone="violet" className="max-w-2xl" contentClassName="space-y-5" data-testid="jit-access-workflow" footer={<><Button variant="ghost" onClick={() => setGrantOpen(false)}>Cancel</Button><Button onClick={doGrant} disabled={!grant.tech_id || !grant.reason.trim()}><Zap className="mr-1.5 h-4 w-4" />Grant temporary access</Button></>}>
            <div className="grid grid-cols-3 gap-2" aria-label="Elevation workflow">
              {["1  Technician", "2  Permission", "3  Expiry & evidence"].map((step, index) => <div key={step} className={`rounded-lg border px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider ${index === 0 ? "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300" : "border-border bg-muted/30 text-muted-foreground"}`}>{step}</div>)}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="jit-technician">Technician <span className="text-rose-500">*</span></Label><Select value={grant.tech_id} onValueChange={v => setGrant({ ...grant, tech_id: v })}>
              <SelectTrigger id="jit-technician" aria-label="Technician"><SelectValue placeholder="Select technician" /></SelectTrigger>
              <SelectContent>{(capacity?.techs || []).map(t => <SelectItem key={t.id} value={t.id}>{t.name} · {t.job_title}</SelectItem>)}</SelectContent>
            </Select><p className="text-[11px] text-muted-foreground">Only the selected team member receives the temporary grant.</p></div>
              <div className="space-y-2"><Label htmlFor="jit-preset">Permission preset</Label><Select value={grant.preset} onValueChange={v => setGrant({ ...grant, preset: v })}>
              <SelectTrigger id="jit-preset" aria-label="Permission preset"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.keys(presets || {}).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select><p className="text-[11px] text-muted-foreground">Uses the governed role permissions already defined for your team.</p></div>
            </div>
            <div className="space-y-2"><Label htmlFor="jit-duration">Access window (minutes)</Label><Input id="jit-duration" aria-label="Access window in minutes" type="number" min={5} max={1440} value={grant.duration_minutes} onChange={e => setGrant({ ...grant, duration_minutes: Number(e.target.value) })} /><p className="text-[11px] text-muted-foreground">Between 5 minutes and 24 hours. Nexus automatically removes the grant at expiry.</p></div>
            <div className="space-y-2"><Label htmlFor="jit-reason">Business reason <span className="text-rose-500">*</span></Label><Textarea id="jit-reason" aria-label="Business reason" rows={4} value={grant.reason} onChange={e => setGrant({ ...grant, reason: e.target.value })} placeholder="Example: Temporary tenant administration required for approved Microsoft 365 remediation on INC-1042." /><p className="text-[11px] text-muted-foreground">Recorded permanently with the technician, preset, grantor and expiry.</p></div>
            <div className="grid gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 sm:grid-cols-3">{[[Lock,"Least privilege"],[Clock,`${grant.duration_minutes || 0} min expiry`],[History,"Audit retained"]].map(([Icon,label]) => <div key={label} className="flex items-center gap-2 text-xs font-medium text-emerald-800 dark:text-emerald-200"><Icon className="h-3.5 w-3.5" />{label}</div>)}</div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={bgOpen} onOpenChange={closeBreakGlass}>
        <NexusWorkflowDialog eyebrow="Emergency elevation" title="Emergency break-glass access" description="Self-grant full administrator privileges only when normal approval cannot protect service continuity." icon={ShieldAlert} tone="amber" className="max-w-xl" contentClassName="space-y-5" data-testid="break-glass-workflow" footer={<><Button variant="ghost" onClick={() => closeBreakGlass(false)}>Cancel</Button><Button variant="destructive" onClick={doBg} disabled={bg.reason.trim().length < 10 || !bgAcknowledged}><ShieldAlert className="mr-1.5 h-4 w-4" />Activate emergency access</Button></>}>
            <div className="grid gap-2 sm:grid-cols-3">{[[Crown,"Full admin","All protected actions"],[Clock,"Auto-expiring",`Maximum ${bg.duration_minutes || 0} minutes`],[History,"Permanently audited","Reason and activity retained"]].map(([Icon,title,body]) => <div key={title} className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3"><Icon className="mb-2 h-4 w-4 text-rose-700 dark:text-rose-300" /><p className="text-xs font-semibold text-foreground">{title}</p><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{body}</p></div>)}</div>
            <div className="space-y-2"><Label htmlFor="break-glass-duration">Emergency access window (minutes)</Label><Input id="break-glass-duration" aria-label="Emergency access window in minutes" type="number" min={5} max={60} value={bg.duration_minutes} onChange={e => setBg({ ...bg, duration_minutes: Number(e.target.value) })} /><p className="text-[11px] text-muted-foreground">Keep this as short as possible. Access is revoked automatically.</p></div>
            <div className="space-y-2"><Label htmlFor="break-glass-reason">Detailed emergency reason <span className="text-rose-500">*</span></Label><Textarea id="break-glass-reason" aria-label="Detailed emergency reason" rows={4} value={bg.reason} onChange={e => setBg({ ...bg, reason: e.target.value })} placeholder="Describe the outage or security incident, why normal approval is unavailable, and the actions you expect to take." /><div className="flex justify-between text-[10px] text-muted-foreground"><span>Minimum 10 characters; include a ticket or incident reference where possible.</span><span>{bg.reason.length}/10</span></div></div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border accent-rose-600" checked={bgAcknowledged} onChange={e => setBgAcknowledged(e.target.checked)} />
              <span className="text-xs leading-relaxed text-foreground"><span className="font-semibold">I understand this grants full administrator access.</span><span className="mt-1 block text-muted-foreground">My identity, reason, activity and automatic expiry will be recorded in the immutable audit history.</span></span>
            </label>
        </NexusWorkflowDialog>
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
  const breakGlassCount = events.filter(event => event.action === "break_glass_activated").length;
  const elevationCount = events.filter(event => event.action === "elevation_granted").length;

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>;

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-4 overflow-hidden rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_86%_0%,hsl(var(--primary)/0.2),transparent_38%),linear-gradient(120deg,hsl(var(--card)),hsl(var(--background)))] p-5 shadow-[0_16px_42px_-30px_hsl(var(--primary)/0.7)] sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary"><History className="h-5 w-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Accountability trail</p><h2 className="text-xl font-bold tracking-tight">Team access audit</h2></div></div><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">A chronological record of roles, elevation, and emergency access. Every privileged change remains visible for review.</p></div>
        <div className="flex items-center gap-2"><div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-center"><p className="text-lg font-bold">{events.length}</p><p className="text-[10px] text-muted-foreground">events</p></div><div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.05] px-3 py-2 text-center"><p className="text-lg font-bold text-violet-700 dark:text-violet-300">{elevationCount}</p><p className="text-[10px] text-muted-foreground">elevations</p></div><div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.05] px-3 py-2 text-center"><p className="text-lg font-bold text-rose-500">{breakGlassCount}</p><p className="text-[10px] text-muted-foreground">emergency</p></div><Button size="sm" variant="outline" onClick={load}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button></div>
      </section>
      {events.length === 0 ? (
        <Card className="border-dashed border-border bg-muted/20"><CardContent className="p-10 text-center"><CheckCircle2 className="mx-auto mb-3 h-6 w-6 text-emerald-500" /><p className="text-sm font-semibold">No access events recorded</p><p className="mt-1 text-xs text-muted-foreground">Role, permission, elevation, and emergency changes will appear here as they occur.</p></CardContent></Card>
      ) : (
        <div className="relative pl-8">
          <div className="absolute bottom-0 left-3 top-0 w-px bg-border" />
          {Object.entries(groups).map(([day, evs]) => (
            <div key={day} className="mb-6">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{day}</div>
              {evs.map(e => {
                const isBG = e.action === "break_glass_activated";
                const isGrant = e.action === "elevation_granted";
                const dot = isBG ? "bg-rose-400" : isGrant ? "bg-violet-400" : "bg-cyan-400";
                return (
                  <div key={e.id} className="relative mb-2 ml-2 group">
                    <div className={`absolute -left-7 top-2 h-3 w-3 rounded-full ${dot} ring-4 ring-background`} />
                    <div className="rounded-xl border border-border/70 bg-card/70 px-3 py-2.5 transition-colors group-hover:border-primary/25 group-hover:bg-muted/30">
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
  const [roleOptions, setRoleOptions] = useState(ROLE_OPTIONS);
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

  const loadRoles = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/technicians/access-roles`, { headers });
      const roles = response.data?.roles;
      if (Array.isArray(roles) && roles.length) setRoleOptions(roles.map(role => ({ value: role.id, ...role })));
    } catch { /* retain safe defaults while the role catalogue loads */ }
  }, [headers]);

  useEffect(() => { loadCapacity(); loadPresets(); loadRoles(); }, [loadCapacity, loadPresets, loadRoles]);

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

  const isOperationalView = OPERATIONAL_TAB_IDS.has(tab);

  const summary = capacity?.summary || { total: 0, idle: 0, active: 0, busy: 0, overloaded: 0, on_call: 0, avg_util: 0 };

  return (
    <div className="space-y-5 p-6" data-testid="tech-command-center">
      {isOperationalView && <>
      {/* Header */}
      <OperationalPageHeader
        eyebrow="Team operations"
        title="Team Command Center"
        description="Directory, invitations, capacity, permissions, access drift, just-in-time elevation, and audit controls."
        icon={Sparkles}
        tone="violet"
        actions={<><Button size="sm" variant="outline" onClick={() => setInviteOpen(true)} data-testid="header-invite-btn"><Mail className="mr-1.5 h-4 w-4" />Invite</Button><Button size="sm" onClick={() => setAddOpen(true)} data-testid="header-add-btn"><UserPlus className="mr-1.5 h-4 w-4" />Add user</Button><Button size="sm" variant="outline" onClick={loadCapacity}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh</Button></>}
      />
      {/* HeroTile metric strip — same shape as Devices */}
      <MetricStrip columns={6}>
        <MetricTile label="Total techs" value={summary.total} accent="violet" icon={<Users className="w-2.5 h-2.5 text-violet-400" />} testid="tcc-tile-total" />
        <MetricTile label="Idle" value={summary.idle || 0} accent="emerald" icon={<Activity className="w-2.5 h-2.5 text-emerald-400" />} testid="tcc-tile-idle" />
        <MetricTile label="Active" value={summary.active || 0} accent="cyan" icon={<Activity className="w-2.5 h-2.5 text-cyan-400" />} testid="tcc-tile-active" />
        <MetricTile label="Busy" value={summary.busy || 0} accent="amber" icon={<Flame className="w-2.5 h-2.5 text-amber-400" />} testid="tcc-tile-busy" />
        <MetricTile label="Overloaded" value={summary.overloaded || 0} accent={summary.overloaded ? "rose" : "zinc"} icon={<AlertTriangle className={`w-2.5 h-2.5 ${summary.overloaded ? "text-rose-400" : "text-zinc-400"}`} />} testid="tcc-tile-overloaded" />
        <MetricTile label="Avg utilisation" value={`${summary.avg_util}%`} accent="violet" icon={<TrendingUp className="w-2.5 h-2.5 text-violet-400" />} testid="tcc-tile-util" />
      </MetricStrip>
      </>}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-x-4 gap-y-1 rounded-none border-b border-zinc-800 bg-transparent p-0 shadow-none">
          {COMMAND_TAB_GROUPS.map((group, groupIndex) => (
            <div key={group.label} className={`flex items-center gap-1 shrink-0 ${groupIndex ? "border-l border-zinc-800 pl-4" : ""}`}>
              <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-600 px-1">{group.label}</span>
              {group.tabs.map(t => (
                <TabsTrigger key={t.v} value={t.v}
                  className="rounded-none border-b-2 border-transparent px-3 py-2 text-xs uppercase tracking-wider text-zinc-500 shadow-none transition-colors hover:bg-white/[0.035] hover:text-zinc-200 data-[state=active]:border-violet-500 data-[state=active]:bg-transparent data-[state=active]:text-zinc-100 data-[state=active]:shadow-none"
                  data-testid={`tcc-tab-${t.v}`}>
                  <t.Icon className="w-3 h-3 mr-1" />{t.l}
                </TabsTrigger>
              ))}
            </div>
          ))}
        </TabsList>

        <TabsContent value="directory" className="mt-4"><DirectoryTab headers={headers} capacity={capacity} presets={presets} roleOptions={roleOptions} onChanged={loadCapacity} /></TabsContent>
        <TabsContent value="invites" className="mt-4"><InvitesTab headers={headers} /></TabsContent>
        <TabsContent value="find" className="mt-4"><TechFinderTab headers={headers} capacity={capacity} /></TabsContent>
        <TabsContent value="capacity" className="mt-4"><CapacityTab capacity={capacity} /></TabsContent>
        <TabsContent value="matrix" className="mt-4"><PermissionMatrixTab headers={headers} presets={presets} roleOptions={roleOptions} onRolesChanged={setRoleOptions} /></TabsContent>
        <TabsContent value="drift" className="mt-4"><RoleDriftTab headers={headers} /></TabsContent>
        <TabsContent value="jit" className="mt-4"><JITTab headers={headers} capacity={capacity} presets={presets} onChanged={loadCapacity} /></TabsContent>
        <TabsContent value="audit" className="mt-4"><AuditTab headers={headers} /></TabsContent>
        <TabsContent value="roster" className="mt-4"><TechRosterPage /></TabsContent>
        <TabsContent value="skills" className="mt-4"><SkillsMatrixPage /></TabsContent>
        <TabsContent value="leaderboard" className="mt-4"><LeaderboardPage /></TabsContent>
      </Tabs>

      <AddUserDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={loadCapacity} onManageRoles={() => selectTab("matrix")} headers={headers} presets={presets} roleOptions={roleOptions} />
      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} onSent={loadCapacity} onManageRoles={() => selectTab("matrix")} headers={headers} presets={presets} roleOptions={roleOptions} />
    </div>
  );
}
