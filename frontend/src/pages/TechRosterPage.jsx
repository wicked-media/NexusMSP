import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import WorkspaceActionMenu, { WorkspaceActionMenuItem } from "@/components/WorkspaceActionMenu";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowRight, ArrowRightLeft, Bell, BellRing, CalendarClock, CheckCircle2,
  Edit2, Loader2, Mail, MessageSquare, Phone, Plus, Radio, RefreshCw, Search,
  ShieldCheck, Siren, Trash2, UserRoundCheck, Users, XCircle,
} from "lucide-react";

const TIERS = [
  { key: "primary", number: 1, name: "Primary responder", trigger: "Page immediately", objective: "Acknowledge within 5 min", cls: "border-rose-500/35 bg-rose-500/[0.07] text-rose-300", surface: "border-rose-500/35 bg-rose-500/[0.035]", dot: "bg-rose-400" },
  { key: "secondary", number: 2, name: "Backup responder", trigger: "Escalate after 10 min", objective: "Take over or assist", cls: "border-amber-500/35 bg-amber-500/[0.07] text-amber-300", surface: "border-amber-500/35 bg-amber-500/[0.035]", dot: "bg-amber-400" },
  { key: "lead", number: 3, name: "Incident lead", trigger: "Escalate after 20 min", objective: "Coordinate and own impact", cls: "border-sky-500/35 bg-sky-500/[0.07] text-sky-300", surface: "border-sky-500/35 bg-sky-500/[0.035]", dot: "bg-sky-400" },
];
const TIER_BY_KEY = Object.fromEntries(TIERS.map((tier) => [tier.key, tier]));
const TIER_BY_NUMBER = Object.fromEntries(TIERS.map((tier) => [tier.number, tier]));
const CATEGORIES = [
  { value: "general", label: "General support" }, { value: "sla", label: "SLA response" },
  { value: "security", label: "Security" }, { value: "network", label: "Network" },
  { value: "wisp", label: "WISP" }, { value: "workshop", label: "Workshop" },
  { value: "cabling", label: "Cabling" }, { value: "emergency", label: "Emergency" },
];
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((item) => [item.value, item.label]));
const CHANNELS = [
  { key: "slack", label: "Slack", icon: MessageSquare }, { key: "teams", label: "Teams", icon: MessageSquare },
  { key: "sms", label: "SMS", icon: Phone }, { key: "email", label: "Email", icon: Mail },
  { key: "push", label: "In-app", icon: Bell },
];
const EMPTY_CONTACT = { name: "", email: "", mobile: "", role: "", slack_handle: "", teams_email: "", escalation_tier: 2, active: true, preferred_channels: ["email", "push"] };

function toLocalInput(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function newShiftForm() {
  const start = new Date(); start.setSeconds(0, 0);
  return { tech_id: "", shift_type: "primary", category: "general", start_time: toLocalInput(start), end_time: toLocalInput(new Date(start.getTime() + 24 * 60 * 60 * 1000)), notes: "" };
}
function dateValue(value) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; }
function formatDateTime(value) {
  const date = dateValue(value); if (!date) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
}
function formatWindow(start, end) {
  const startDate = dateValue(start); const endDate = dateValue(end); if (!startDate || !endDate) return "Schedule window unavailable";
  const sameDay = startDate.toDateString() === endDate.toDateString();
  const startLabel = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(startDate);
  const endLabel = new Intl.DateTimeFormat(undefined, sameDay ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(endDate);
  return `${startLabel} – ${endLabel}`;
}
function timeUntil(value, now) {
  const date = dateValue(value); if (!date) return "Not scheduled";
  const minutes = Math.max(0, Math.round((date.getTime() - now) / 60_000));
  if (minutes < 60) return `${minutes}m`; const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`; return `${Math.floor(hours / 24)}d`;
}
function hasReadyContactPath(tech) {
  return (tech.preferred_channels || []).some((channel) => channel === "push" || (channel === "email" && tech.email) || (channel === "sms" && tech.mobile) || (channel === "teams" && tech.teams_email) || (channel === "slack" && tech.slack_handle));
}
function isActiveShift(shift, now) {
  const start = dateValue(shift.start_time)?.getTime(); const end = dateValue(shift.end_time)?.getTime();
  return shift.status !== "cancelled" && start <= now && end >= now;
}

export default function TechRosterPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [techs, setTechs] = useState([]); const [shifts, setShifts] = useState([]); const [canManage, setCanManage] = useState(false); const [loading, setLoading] = useState(true); const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState(""); const [coverageFilter, setCoverageFilter] = useState("all"); const [horizon, setHorizon] = useState("7"); const [categoryFilter, setCategoryFilter] = useState("all");
  const [contactOpen, setContactOpen] = useState(false); const [editing, setEditing] = useState(null); const [contactForm, setContactForm] = useState(EMPTY_CONTACT); const [savingContact, setSavingContact] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false); const [shiftForm, setShiftForm] = useState(newShiftForm); const [savingShift, setSavingShift] = useState(false);
  const [overrideShift, setOverrideShift] = useState(null); const [overrideTechId, setOverrideTechId] = useState(""); const [savingOverride, setSavingOverride] = useState(false);
  const [cancelShift, setCancelShift] = useState(null); const [deleteCandidate, setDeleteCandidate] = useState(null); const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [contactsResponse, shiftsResponse, permissionsResponse] = await Promise.all([axios.get(`${API}/tech-roster`, { headers }), axios.get(`${API}/on-call/roster`, { headers }), axios.get(`${API}/permissions/me`, { headers }).catch(() => ({ data: { allowed: [] } }))]);
      setTechs(contactsResponse.data || []); setShifts(shiftsResponse.data || []); setCanManage((permissionsResponse.data?.allowed || []).includes("platform.configuration.manage")); setNow(Date.now());
    } catch (error) { toast.error(error.response?.data?.detail || "Could not load on-call coverage"); }
    finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);

  const activeTechs = useMemo(() => techs.filter((tech) => tech.active !== false), [techs]);
  const activeShifts = useMemo(() => shifts.filter((shift) => isActiveShift(shift, now)), [now, shifts]);
  const activeByTier = useMemo(() => Object.fromEntries(TIERS.map((tier) => [tier.key, activeShifts.filter((shift) => shift.shift_type === tier.key)])), [activeShifts]);
  const upcomingShifts = useMemo(() => shifts.filter((shift) => shift.status !== "cancelled" && (dateValue(shift.end_time)?.getTime() || 0) >= now).sort((a, b) => (dateValue(a.start_time)?.getTime() || 0) - (dateValue(b.start_time)?.getTime() || 0)), [now, shifts]);
  const nextHandoff = useMemo(() => {
    const endings = activeShifts.map((shift) => ({ at: dateValue(shift.end_time)?.getTime(), label: `${shift.tech_name} ends ${TIER_BY_KEY[shift.shift_type]?.name.toLowerCase() || "coverage"}` })).filter((item) => item.at >= now).sort((a, b) => a.at - b.at);
    if (endings.length) return endings[0]; const next = upcomingShifts.find((shift) => (dateValue(shift.start_time)?.getTime() || 0) > now);
    return next ? { at: dateValue(next.start_time)?.getTime(), label: `${next.tech_name} starts ${TIER_BY_KEY[next.shift_type]?.name.toLowerCase() || "coverage"}` } : null;
  }, [activeShifts, now, upcomingShifts]);
  const readyContacts = useMemo(() => activeTechs.filter(hasReadyContactPath), [activeTechs]);
  const missingTiers = TIERS.filter((tier) => !activeByTier[tier.key]?.length); const overlaps = TIERS.filter((tier) => activeByTier[tier.key]?.length > 1);
  const visibleShifts = useMemo(() => { const end = now + Number(horizon) * 86_400_000; return upcomingShifts.filter((shift) => (dateValue(shift.start_time)?.getTime() || 0) <= end && (categoryFilter === "all" || shift.category === categoryFilter)); }, [categoryFilter, horizon, now, upcomingShifts]);
  const fairness = useMemo(() => {
    const end = now + 56 * 86_400_000;
    return activeTechs.map((tech) => { const assigned = upcomingShifts.filter((shift) => shift.tech_id === tech.id && (dateValue(shift.start_time)?.getTime() || 0) <= end); const points = assigned.reduce((sum, shift) => { const day = dateValue(shift.start_time)?.getDay(); return sum + (day === 0 || day === 6 ? 2 : 1); }, 0); return { ...tech, assignmentCount: assigned.length, points }; }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  }, [activeTechs, now, upcomingShifts]);
  const maxFairnessPoints = Math.max(1, ...fairness.map((tech) => tech.points));
  const filteredTechs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return techs.filter((tech) => {
      const activeNow = activeShifts.some((shift) => shift.tech_id === tech.id);
      if (coverageFilter === "active" && tech.active === false) return false; if (coverageFilter === "on_call" && !activeNow) return false;
      if (coverageFilter === "needs_contact" && (tech.active === false || hasReadyContactPath(tech))) return false;
      if (coverageFilter.startsWith("tier_") && (tech.escalation_tier || 2) !== Number(coverageFilter.slice(-1))) return false;
      return !query || [tech.name, tech.role, tech.email, tech.mobile, tech.slack_handle, tech.teams_email, ...(tech.preferred_channels || [])].some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [activeShifts, coverageFilter, search, techs]);

  const openCreateContact = () => { setEditing(null); setContactForm(EMPTY_CONTACT); setContactOpen(true); };
  const openEditContact = (tech) => { setEditing(tech); setContactForm({ ...EMPTY_CONTACT, ...tech }); setContactOpen(true); };
  const openSchedule = (tier = "primary") => { setShiftForm({ ...newShiftForm(), shift_type: tier }); setScheduleOpen(true); };
  const saveContact = async () => {
    if (!contactForm.name.trim()) return toast.error("Name required"); setSavingContact(true);
    try { if (editing) await axios.put(`${API}/tech-roster/${editing.id}`, contactForm, { headers }); else await axios.post(`${API}/tech-roster`, contactForm, { headers }); toast.success(editing ? "Roster contact updated" : "Roster contact added"); setContactOpen(false); await load(); }
    catch (error) { toast.error(error.response?.data?.detail || "Could not save roster contact"); } finally { setSavingContact(false); }
  };
  const createShift = async () => {
    if (!shiftForm.tech_id || !shiftForm.start_time || !shiftForm.end_time) return toast.error("Contact, start and end are required");
    const start = dateValue(shiftForm.start_time); const end = dateValue(shiftForm.end_time); if (!start || !end || end <= start) return toast.error("Shift end must be after its start");
    setSavingShift(true);
    try { const tech = activeTechs.find((item) => item.id === shiftForm.tech_id); await axios.post(`${API}/on-call/roster`, { ...shiftForm, tech_name: tech?.name || "", start_time: start.toISOString(), end_time: end.toISOString() }, { headers }); toast.success(`${TIER_BY_KEY[shiftForm.shift_type]?.name || "On-call"} shift scheduled and contact notified`); setScheduleOpen(false); await load(); }
    catch (error) { toast.error(error.response?.data?.detail || "Could not schedule shift"); } finally { setSavingShift(false); }
  };
  const applyOverride = async () => {
    if (!overrideShift || !overrideTechId) return; setSavingOverride(true);
    try { const tech = activeTechs.find((item) => item.id === overrideTechId); await axios.post(`${API}/on-call/roster/${overrideShift.id}/swap`, { new_tech_id: overrideTechId, new_tech_name: tech?.name || "" }, { headers }); toast.success(`Coverage reassigned to ${tech?.name}`); setOverrideShift(null); setOverrideTechId(""); await load(); }
    catch (error) { toast.error(error.response?.data?.detail || "Could not reassign coverage"); } finally { setSavingOverride(false); }
  };
  const cancelScheduledShift = async () => {
    if (!cancelShift) return;
    try { await axios.put(`${API}/on-call/roster/${cancelShift.id}`, { status: "cancelled" }, { headers }); toast.success("Shift cancelled; history retained"); setCancelShift(null); await load(); }
    catch (error) { toast.error(error.response?.data?.detail || "Could not cancel shift"); }
  };
  const pingActive = async () => { try { const response = await axios.post(`${API}/on-call/ping-active`, {}, { headers }); toast.success(response.data?.message || "Active contacts pinged"); } catch (error) { toast.error(error.response?.data?.detail || "Could not ping active coverage"); } };
  const removeContact = async () => {
    if (!deleteCandidate) return; setDeleting(true);
    try { await axios.delete(`${API}/tech-roster/${deleteCandidate.id}`, { headers }); toast.success(`${deleteCandidate.name} removed from the roster`); setDeleteCandidate(null); await load(); }
    catch (error) { toast.error(error.response?.data?.detail || "Could not remove roster contact"); } finally { setDeleting(false); }
  };
  const toggleChannel = (key) => setContactForm((current) => { const selected = current.preferred_channels || []; return { ...current, preferred_channels: selected.includes(key) ? selected.filter((channel) => channel !== key) : [...selected, key] }; });

  return <div className="space-y-4" data-testid="tech-roster-page">
    <OperationalPageHeader eyebrow="Team operations" title="On-call roster" description="Run a three-stage escalation policy, see live coverage and schedule accountable handoffs without passing around a physical phone." icon={Radio} tone="amber" signal={missingTiers.length ? "attention" : "healthy"} signalLabel={missingTiers.length ? `${missingTiers.length} live coverage gap${missingTiers.length === 1 ? "" : "s"}` : "All escalation tiers covered"} signalDescription={missingTiers.length ? "Fill every tier before the next critical page." : "Primary, backup and incident-lead coverage are active."} actions={<><WorkspaceActionMenu testId="roster-more-actions"><WorkspaceActionMenuItem icon={RefreshCw} onSelect={load} disabled={loading} testId="tech-roster-refresh-btn">Refresh coverage</WorkspaceActionMenuItem><WorkspaceActionMenuItem icon={BellRing} onSelect={pingActive} disabled={!canManage || !activeShifts.length} testId="ping-active-roster">Ping active contacts</WorkspaceActionMenuItem></WorkspaceActionMenu><Button size="sm" variant="outline" onClick={openCreateContact} disabled={!canManage} title={canManage ? "Add an eligible responder" : "Organisation configuration permission required"} data-testid="tech-roster-add-btn"><UserRoundCheck className="mr-1.5 h-4 w-4" />Add contact</Button><Button size="sm" onClick={() => openSchedule()} disabled={!canManage} title={canManage ? "Schedule on-call coverage" : "Organisation configuration permission required"} data-testid="schedule-shift-btn"><Plus className="mr-1.5 h-4 w-4" />Schedule shift</Button></>} />

    <MetricStrip columns={4}>
      <MetricTile label="Coverage now" value={`${TIERS.length - missingTiers.length}/3`} trend={missingTiers.length ? "tiers staffed" : "full escalation path"} accent={missingTiers.length ? "amber" : "emerald"} icon={<ShieldCheck className="h-3 w-3" />} testid="roster-tile-coverage" />
      <MetricTile label="Active shifts" value={activeShifts.length} trend={activeShifts.length ? "time-bound assignments" : "none running"} accent="cyan" icon={<Radio className="h-3 w-3 text-cyan-400" />} testid="roster-tile-active" />
      <MetricTile label="Next handoff" value={nextHandoff ? timeUntil(nextHandoff.at, now) : "None"} trend={nextHandoff?.label || "no future shifts"} accent="violet" icon={<CalendarClock className="h-3 w-3 text-violet-400" />} testid="roster-tile-handoff" />
      <MetricTile label="Contact readiness" value={`${readyContacts.length}/${activeTechs.length}`} trend={readyContacts.length === activeTechs.length ? "page paths ready" : "active contacts reachable"} accent={readyContacts.length === activeTechs.length ? "emerald" : "rose"} icon={<Bell className="h-3 w-3" />} testid="roster-tile-readiness" />
    </MetricStrip>

    <section aria-labelledby="live-escalation-title"><div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="live-escalation-title" className="text-sm font-semibold">Live escalation path</h2><p className="text-xs text-muted-foreground">Each tier has one job and one trigger. Coverage is derived from scheduled shifts.</p></div><p className="text-[11px] text-muted-foreground">Policy: T1 now → T2 at 10m → T3 at 20m</p></div><div className="grid gap-3 xl:grid-cols-3">
      {TIERS.map((tier, index) => { const current = activeByTier[tier.key]?.[0]; const next = upcomingShifts.find((shift) => shift.shift_type === tier.key && !isActiveShift(shift, now)); const contact = activeTechs.find((tech) => tech.id === current?.tech_id); return <div key={tier.key} className="relative"><Card className={`h-full overflow-hidden border ${current ? tier.surface : "border-dashed border-rose-500/30 bg-rose-500/[0.035]"}`} data-testid={`live-tier-${tier.key}`}><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-xl border text-sm font-bold ${tier.cls}`}>T{tier.number}</span><div><p className="text-sm font-semibold">{tier.name}</p><p className="text-[11px] text-muted-foreground">{tier.trigger}</p></div></div><Badge variant="outline" className={current ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}>{current ? "Covered" : "Gap now"}</Badge></div>
        {current ? <div className="mt-4 rounded-xl border border-border/60 bg-background/45 p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{current.tech_name}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{CATEGORY_LABELS[current.category] || current.category} · ends in {timeUntil(current.end_time, now)}</p></div><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tier.dot} animate-pulse`} /></div><div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>{tier.objective}</span><span>{contact && hasReadyContactPath(contact) ? "Contact path ready" : "Check contact path"}</span></div></div> : <div className="mt-4 rounded-xl border border-dashed border-rose-500/25 bg-background/25 p-3"><p className="text-sm font-medium text-rose-200">No {tier.name.toLowerCase()} is on call</p><p className="mt-1 text-xs text-muted-foreground">{next ? `Next: ${next.tech_name}, ${formatDateTime(next.start_time)}` : "No future shift is scheduled for this tier."}</p></div>}
        <Button variant="ghost" size="sm" className="mt-3 h-8 w-full text-xs" disabled={!canManage} onClick={() => current ? (setOverrideShift(current), setOverrideTechId("")) : openSchedule(tier.key)}>{current ? <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}{current ? "Override coverage" : `Schedule tier ${tier.number}`}</Button>
      </CardContent></Card>{index < TIERS.length - 1 && <ArrowRight className="absolute -right-[18px] top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-muted-foreground/45 xl:block" aria-hidden="true" />}</div>; })}
    </div></section>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]">
      <Card className="overflow-hidden border-border/70 bg-card/70"><div className="flex flex-col gap-3 border-b border-border/70 bg-muted/[0.14] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Schedule timeline</p><p className="mt-0.5 text-xs text-muted-foreground">Upcoming coverage, handoffs and recorded overrides.</p></div><div className="flex gap-2"><Select value={categoryFilter} onValueChange={setCategoryFilter}><SelectTrigger aria-label="Filter schedule category" className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{CATEGORIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><Select value={horizon} onValueChange={setHorizon}><SelectTrigger aria-label="Schedule horizon" className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7">7 days</SelectItem><SelectItem value="30">30 days</SelectItem><SelectItem value="56">8 weeks</SelectItem></SelectContent></Select></div></div><CardContent className="p-0">
        {loading ? <div className="p-12 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading schedule…</div> : visibleShifts.length ? <div className="divide-y divide-border/60">{visibleShifts.slice(0, 14).map((shift) => { const tier = TIER_BY_KEY[shift.shift_type] || TIERS[0]; const active = isActiveShift(shift, now); return <div key={shift.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center" data-testid={`schedule-row-${shift.id}`}><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-xs font-bold ${tier.cls}`}>T{tier.number}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{shift.tech_name}</p>{active && <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[9px] text-emerald-300">Live now</Badge>}{shift.swapped_from && <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[9px] text-amber-300">Overridden</Badge>}</div><p className="mt-0.5 truncate text-xs text-muted-foreground">{formatWindow(shift.start_time, shift.end_time)} · {CATEGORY_LABELS[shift.category] || shift.category}</p></div><div className="flex shrink-0 gap-1"><Button variant="ghost" size="sm" className="h-8 text-xs" disabled={!canManage} onClick={() => { setOverrideShift(shift); setOverrideTechId(""); }}><ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />Override</Button><Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-rose-300" disabled={!canManage} onClick={() => setCancelShift(shift)}><XCircle className="mr-1.5 h-3.5 w-3.5" />Cancel</Button></div></div>; })}</div> : <div className="p-12 text-center"><CalendarClock className="mx-auto h-7 w-7 text-muted-foreground/45" /><p className="mt-3 text-sm font-medium">No shifts in this window</p><p className="mt-1 text-xs text-muted-foreground">Schedule all three tiers before the next after-hours period.</p><Button size="sm" className="mt-4" disabled={!canManage} onClick={() => openSchedule()}><Plus className="mr-1.5 h-4 w-4" />Schedule shift</Button></div>}
      </CardContent></Card>
      <div className="space-y-4"><Card className="border-border/70 bg-card/70"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">Coverage health</p><p className="mt-0.5 text-xs text-muted-foreground">Problems to resolve before the next page.</p></div>{missingTiers.length || overlaps.length || readyContacts.length < activeTechs.length ? <AlertTriangle className="h-4 w-4 text-amber-300" /> : <CheckCircle2 className="h-4 w-4 text-emerald-300" />}</div><div className="mt-4 space-y-2"><HealthRow label="Live tier gaps" value={missingTiers.length ? missingTiers.map((tier) => `T${tier.number}`).join(", ") : "None"} tone={missingTiers.length ? "rose" : "emerald"} /><HealthRow label="Overlapping tiers" value={overlaps.length ? overlaps.map((tier) => `T${tier.number}`).join(", ") : "None"} tone={overlaps.length ? "amber" : "emerald"} /><HealthRow label="Missing contact paths" value={String(activeTechs.length - readyContacts.length)} tone={activeTechs.length === readyContacts.length ? "emerald" : "rose"} /><HealthRow label="Future shifts" value={String(upcomingShifts.length)} tone={upcomingShifts.length ? "neutral" : "amber"} /></div></CardContent></Card>
        <Card className="border-border/70 bg-card/70"><CardContent className="p-4"><div><p className="text-sm font-semibold">Rotation load</p><p className="mt-0.5 text-xs text-muted-foreground">Next 8 weeks · weekday 1 point, weekend 2.</p></div><div className="mt-4 space-y-3">{fairness.length ? fairness.slice(0, 6).map((tech) => <div key={tech.id}><div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="truncate font-medium">{tech.name}</span><span className="shrink-0 text-muted-foreground">{tech.assignmentCount} shifts · {tech.points} pts</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-violet-400/70" style={{ width: `${Math.max(tech.points ? 8 : 0, (tech.points / maxFairnessPoints) * 100)}%` }} /></div></div>) : <p className="py-4 text-center text-xs text-muted-foreground">Add roster contacts to compare planned load.</p>}</div><p className="mt-4 border-t border-border/60 pt-3 text-[11px] leading-5 text-muted-foreground">This is a planning signal, not payroll. Holiday weighting and compensation policy remain an MSP decision.</p></CardContent></Card>
      </div>
    </div>

    <Card className="overflow-hidden border-border/70 bg-card/70"><div className="flex flex-col gap-3 border-b border-border/70 bg-muted/[0.14] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Responder directory</p><p className="mt-0.5 text-xs text-muted-foreground">Eligible people, default escalation tier and verified paging paths.</p></div><div className="flex flex-col gap-2 sm:flex-row"><div className="relative"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search roster contacts" className="h-8 w-full pl-8 text-xs sm:w-[230px]" placeholder="Search contacts…" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="tech-roster-search" /></div><Select value={coverageFilter} onValueChange={setCoverageFilter}><SelectTrigger aria-label="Filter roster contacts" className="h-8 w-full text-xs sm:w-[170px]" data-testid="tech-roster-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All contacts</SelectItem><SelectItem value="active">Active contacts</SelectItem><SelectItem value="on_call">On call now</SelectItem><SelectItem value="needs_contact">Contact path missing</SelectItem><SelectItem value="tier_1">T1 primary pool</SelectItem><SelectItem value="tier_2">T2 backup pool</SelectItem><SelectItem value="tier_3">T3 incident leads</SelectItem></SelectContent></Select></div></div><CardContent className="p-0">
      {loading ? <div className="p-12 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading responders…</div> : filteredTechs.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Responder</TableHead><TableHead>Default tier</TableHead><TableHead>Paging paths</TableHead><TableHead>Coverage now</TableHead><TableHead>Readiness</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{filteredTechs.map((tech) => { const tier = TIER_BY_NUMBER[tech.escalation_tier || 2]; const currentShift = activeShifts.find((shift) => shift.tech_id === tech.id); return <TableRow key={tech.id} data-testid={`tech-row-${tech.id}`}><TableCell><p className="font-medium">{tech.name}</p><p className="text-[11px] text-muted-foreground">{tech.role || tech.email || "No role recorded"}</p></TableCell><TableCell><Badge variant="outline" className={tier.cls}>T{tier.number} · {tier.name}</Badge></TableCell><TableCell><div className="flex flex-wrap gap-1">{(tech.preferred_channels || []).map((channel) => <Badge key={channel} variant="outline" className="text-[9px] capitalize">{channel}</Badge>)}</div></TableCell><TableCell>{currentShift ? <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">T{TIER_BY_KEY[currentShift.shift_type]?.number} until {timeUntil(currentShift.end_time, now)}</Badge> : <span className="text-xs text-muted-foreground">Off call</span>}</TableCell><TableCell>{hasReadyContactPath(tech) ? <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Ready</span> : <span className="inline-flex items-center gap-1.5 text-xs text-rose-300"><AlertTriangle className="h-3.5 w-3.5" />Needs contact path</span>}</TableCell><TableCell className="text-right">{canManage ? <WorkspaceActionMenu label="Actions" testId={`tech-actions-${tech.id}`}><WorkspaceActionMenuItem icon={Edit2} onSelect={() => openEditContact(tech)}>Edit contact</WorkspaceActionMenuItem><WorkspaceActionMenuItem icon={Trash2} onSelect={() => setDeleteCandidate(tech)}>Remove from roster</WorkspaceActionMenuItem></WorkspaceActionMenu> : <Badge variant="outline" className="text-[9px] text-muted-foreground">Read only</Badge>}</TableCell></TableRow>; })}</TableBody></Table></div> : <div className="p-12 text-center"><Users className="mx-auto h-7 w-7 text-muted-foreground/45" /><p className="mt-3 text-sm font-medium">{techs.length ? "No contacts match these filters" : "No responders in the roster"}</p><p className="mt-1 text-xs text-muted-foreground">Add an eligible responder before scheduling coverage.</p></div>}
    </CardContent></Card>

    <Dialog open={contactOpen} onOpenChange={setContactOpen}><NexusWorkflowDialog eyebrow="Team operations" title={editing ? "Edit roster contact" : "Add roster contact"} description="Set the responder’s normal position in the escalation pool and at least one reliable paging path. Live on-call state comes from scheduled shifts." icon={UserRoundCheck} tone="amber" className="max-w-2xl" contentClassName="space-y-4" data-testid="tech-roster-dialog" footer={<><Button variant="outline" onClick={() => setContactOpen(false)}>Cancel</Button><Button onClick={saveContact} disabled={savingContact || !contactForm.name.trim()} data-testid="tech-form-save">{savingContact && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{editing ? "Save contact" : "Add to roster"}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="roster-name">Name *</Label><Input id="roster-name" value={contactForm.name} onChange={(event) => setContactForm({ ...contactForm, name: event.target.value })} data-testid="tech-form-name" /></div><div><Label htmlFor="roster-role">Role</Label><Input id="roster-role" value={contactForm.role} onChange={(event) => setContactForm({ ...contactForm, role: event.target.value })} placeholder="Senior systems engineer" /></div></div>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="roster-email">Email</Label><Input id="roster-email" type="email" value={contactForm.email} onChange={(event) => setContactForm({ ...contactForm, email: event.target.value })} placeholder="tech@msp.com" /></div><div><Label htmlFor="roster-mobile">Mobile</Label><Input id="roster-mobile" value={contactForm.mobile} onChange={(event) => setContactForm({ ...contactForm, mobile: event.target.value })} placeholder="+61 4…" /></div></div>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="roster-slack">Slack handle</Label><Input id="roster-slack" value={contactForm.slack_handle} onChange={(event) => setContactForm({ ...contactForm, slack_handle: event.target.value })} placeholder="U012ABC" /></div><div><Label htmlFor="roster-teams">Teams email</Label><Input id="roster-teams" type="email" value={contactForm.teams_email} onChange={(event) => setContactForm({ ...contactForm, teams_email: event.target.value })} /></div></div>
      <div><Label>Default escalation pool</Label><div className="mt-2 grid gap-2 sm:grid-cols-3">{TIERS.map((tier) => <button key={tier.number} type="button" onClick={() => setContactForm({ ...contactForm, escalation_tier: tier.number })} className={`rounded-xl border p-3 text-left transition ${contactForm.escalation_tier === tier.number ? tier.cls : "border-border/70 hover:border-foreground/25"}`} data-testid={`tech-form-tier-${tier.number}`}><span className="text-xs font-bold">Tier {tier.number}</span><span className="mt-1 block text-xs font-medium text-foreground">{tier.name}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{tier.trigger}</span></button>)}</div></div>
      <div><Label>Preferred paging paths</Label><div className="mt-2 flex flex-wrap gap-2">{CHANNELS.map(({ key, label, icon: Icon }) => { const selected = contactForm.preferred_channels?.includes(key); return <button key={key} type="button" onClick={() => toggleChannel(key)} className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors ${selected ? "border-sky-500/40 bg-sky-500/10 text-sky-300" : "border-border text-muted-foreground hover:text-foreground"}`} data-testid={`tech-channel-${key}`}><Icon className="h-3 w-3" />{label}</button>; })}</div></div>
      <div className="flex items-center justify-between rounded-xl border border-border/70 p-3"><div><Label htmlFor="roster-active">Eligible for on-call</Label><p className="mt-0.5 text-[11px] text-muted-foreground">Inactive contacts cannot receive new shifts or overrides.</p></div><Switch id="roster-active" checked={contactForm.active !== false} onCheckedChange={(value) => setContactForm({ ...contactForm, active: value })} /></div>
    </NexusWorkflowDialog></Dialog>

    <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}><NexusWorkflowDialog eyebrow="Coverage planning" title="Schedule on-call shift" description="Create one time-bound tier assignment. Nexus validates the roster contact and notifies them when the shift is saved." icon={CalendarClock} tone="amber" className="max-w-xl" contentClassName="space-y-4" data-testid="schedule-shift-dialog" footer={<><Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button><Button onClick={createShift} disabled={savingShift || !shiftForm.tech_id} data-testid="schedule-shift-submit">{savingShift && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Schedule and notify</Button></>}>
      <div><Label>Responder *</Label><Select value={shiftForm.tech_id} onValueChange={(value) => setShiftForm({ ...shiftForm, tech_id: value })}><SelectTrigger data-testid="schedule-tech-select"><SelectValue placeholder="Choose an active roster contact" /></SelectTrigger><SelectContent>{activeTechs.map((tech) => <SelectItem key={tech.id} value={tech.id}>{tech.name} · T{tech.escalation_tier || 2} pool</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Escalation tier *</Label><div className="mt-2 grid gap-2 sm:grid-cols-3">{TIERS.map((tier) => <button key={tier.key} type="button" onClick={() => setShiftForm({ ...shiftForm, shift_type: tier.key })} className={`rounded-xl border p-3 text-left ${shiftForm.shift_type === tier.key ? tier.cls : "border-border/70"}`}><span className="text-xs font-bold">T{tier.number}</span><span className="mt-1 block text-[11px] font-medium text-foreground">{tier.name}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{tier.trigger}</span></button>)}</div></div>
      <div><Label>Coverage category</Label><Select value={shiftForm.category} onValueChange={(value) => setShiftForm({ ...shiftForm, category: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="shift-start">Starts *</Label><Input id="shift-start" type="datetime-local" value={shiftForm.start_time} onChange={(event) => setShiftForm({ ...shiftForm, start_time: event.target.value })} /></div><div><Label htmlFor="shift-end">Ends *</Label><Input id="shift-end" type="datetime-local" value={shiftForm.end_time} onChange={(event) => setShiftForm({ ...shiftForm, end_time: event.target.value })} /></div></div>
      <div><Label htmlFor="shift-notes">Handoff note</Label><Textarea id="shift-notes" rows={3} value={shiftForm.notes} onChange={(event) => setShiftForm({ ...shiftForm, notes: event.target.value })} placeholder="Known risks, open incidents or client-specific context…" /></div>
    </NexusWorkflowDialog></Dialog>

    <Dialog open={!!overrideShift} onOpenChange={(open) => !open && setOverrideShift(null)}><DialogContent className="max-w-md" data-testid="override-shift-dialog"><DialogHeader><DialogTitle className="flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-amber-300" />Override scheduled coverage</DialogTitle><DialogDescription>Reassign {overrideShift?.tech_name}’s {TIER_BY_KEY[overrideShift?.shift_type]?.name.toLowerCase()} shift. Both responders will be notified and the change is audited.</DialogDescription></DialogHeader><div className="space-y-3"><div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs"><p className="font-medium">{formatWindow(overrideShift?.start_time, overrideShift?.end_time)}</p><p className="mt-1 text-muted-foreground">{CATEGORY_LABELS[overrideShift?.category] || overrideShift?.category}</p></div><div><Label>Replacement responder</Label><Select value={overrideTechId} onValueChange={setOverrideTechId}><SelectTrigger data-testid="override-tech-select"><SelectValue placeholder="Choose replacement" /></SelectTrigger><SelectContent>{activeTechs.filter((tech) => tech.id !== overrideShift?.tech_id).map((tech) => <SelectItem key={tech.id} value={tech.id}>{tech.name} · T{tech.escalation_tier || 2} pool</SelectItem>)}</SelectContent></Select></div></div><DialogFooter><Button variant="outline" onClick={() => setOverrideShift(null)}>Keep assignment</Button><Button onClick={applyOverride} disabled={!overrideTechId || savingOverride}>{savingOverride && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Apply override</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!cancelShift} onOpenChange={(open) => !open && setCancelShift(null)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><Siren className="h-5 w-5 text-rose-300" />Cancel scheduled shift?</DialogTitle><DialogDescription>This removes {cancelShift?.tech_name} from the live schedule but retains the shift and audit history as cancelled.</DialogDescription></DialogHeader><div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.06] p-3 text-xs text-rose-100/85">{formatWindow(cancelShift?.start_time, cancelShift?.end_time)}. Check the live escalation path after cancellation and fill any resulting gap.</div><DialogFooter><Button variant="ghost" onClick={() => setCancelShift(null)}>Keep shift</Button><Button variant="destructive" onClick={cancelScheduledShift}>Cancel shift</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!deleteCandidate} onOpenChange={(open) => !open && setDeleteCandidate(null)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><Trash2 className="h-5 w-5 text-rose-300" />Remove roster contact?</DialogTitle><DialogDescription>{deleteCandidate?.name} will no longer be eligible for new coverage. This does not delete their Nexus account or historic shifts.</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" onClick={() => setDeleteCandidate(null)}>Keep contact</Button><Button variant="destructive" disabled={deleting} onClick={removeContact}>{deleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Remove from roster</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function HealthRow({ label, value, tone }) {
  const toneClass = tone === "rose" ? "text-rose-300" : tone === "amber" ? "text-amber-300" : tone === "emerald" ? "text-emerald-300" : "text-foreground";
  return <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/35 px-3 py-2 text-xs"><span className="text-muted-foreground">{label}</span><span className={`font-medium ${toneClass}`}>{value}</span></div>;
}
