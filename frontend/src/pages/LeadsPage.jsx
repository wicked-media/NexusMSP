import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus, Search, RefreshCw, Loader2, Sparkles, Flame, Filter as FilterIcon,
  Funnel, KanbanSquare, BarChart3, Table as TableIcon, Ticket, GitMerge, MoreVertical, Mail, Trophy,
  Building2, UserRound, BadgeDollarSign, NotebookPen, Check, ChevronsUpDown, ShieldCheck
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";

import InitialsAvatar from "../components/leads/InitialsAvatar";
import LeadScoreBadge from "../components/leads/LeadScoreBadge";
import HotLeadsStrip from "../components/leads/HotLeadsStrip";
import LeadActivityTicker from "../components/leads/LeadActivityTicker";
import PipelineFunnelCanvas from "../components/leads/PipelineFunnelCanvas";
import LeadsKanban from "../components/leads/LeadsKanban";
import LeadSavedViewsBar from "../components/leads/LeadSavedViewsBar";
import LeadDrawer from "../components/leads/LeadDrawer";
import QuickAddPasteDialog from "../components/leads/QuickAddPasteDialog";
import MergeLeadIntoTicketDialog from "../components/leads/MergeLeadIntoTicketDialog";
import CreateTicketFromLeadDialog from "../components/leads/CreateTicketFromLeadDialog";
import ForecastWidget from "../components/leads/ForecastWidget";
import { VelocityMeter, SourceAttributionPie } from "../components/leads/InsightsWidgets";
import { STATUS_CONFIG, PIPELINE_STAGES, money, timeAgo } from "../components/leads/leadHelpers";
import CampaignsPage from "./CampaignsPage";
import LoyaltyDashboardPage from "./LoyaltyDashboardPage";

const EMPTY_FORM = {
  company_name: "", contact_name: "", email: "", phone: "", website: "", title: "",
  source: "website", status: "new", estimated_value: 0, notes: "", assigned_to: "",
};

export default function LeadsPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get("tab") || "pipeline");
  const [leads, setLeads] = useState([]);
  const [users, setUsers] = useState([]);
  const [scores, setScores] = useState({});
  const [loading, setLoading] = useState(true);
  const [drawerLeadId, setDrawerLeadId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [mergeFor, setMergeFor] = useState(null);
  const [createTicketFor, setCreateTicketFor] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [filters, setFilters] = useState({});
  const [selected, setSelected] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, u, s] = await Promise.all([
        axios.get(`${API}/leads`, { headers }),
        axios.get(`${API}/users`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/lead-studio/score`, { headers }).catch(() => ({ data: { scores: [] } })),
      ]);
      setLeads(Array.isArray(l.data) ? l.data : (l.data?.items || []));
      setUsers(u.data || []);
      const m = {};
      (s.data?.scores || []).forEach(x => { m[x.id] = x; });
      setScores(m);
    } catch { toast.error("Failed to load leads"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const leadId = searchParams.get("lead");
    if (!leadId) return;
    setDrawerLeadId(leadId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("lead");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    const validTabs = ["pipeline", "kanban", "directory", "insights", "campaigns", "renewals"];
    if (requestedTab && validTabs.includes(requestedTab) && requestedTab !== tab) setTab(requestedTab);
  }, [searchParams, tab]);

  const selectTab = (nextTab) => {
    setTab(nextTab);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", nextTab);
    setSearchParams(nextParams, { replace: true });
  };

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter(l => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (filters.status && l.status !== filters.status) return false;
      if (filters.pipelineOnly && ["won", "lost"].includes(l.status)) return false;
      if (filters.hotOnly) {
        const sc = scores[l.id]?.overall || 0;
        if (sc < 80) return false;
      }
      if (filters.mineOnly && user?.id) {
        if (l.assigned_to !== user.id && l.assigned_to !== user.email) return false;
      }
      if (filters.staleOnly) {
        const last = l.last_activity_at || l.updated_at || l.created_at;
        if (!last || (Date.now() - new Date(last).getTime()) / 86400000 < 14) return false;
      }
      if (filters.monthWindow) {
        const d = new Date(l.closed_at || l.updated_at || l.created_at);
        const now = new Date();
        if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false;
      }
      if (q) {
        const hay = `${l.company_name} ${l.contact_name} ${l.email} ${l.source || ""} ${l.source_mailbox || ""} ${l.notes || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, statusFilter, filters, search, user, scores]);

  const summary = useMemo(() => {
    const open = filteredLeads.filter(l => !["won", "lost"].includes(l.status));
    const pipelineValue = open.reduce((s, l) => s + (Number(l.estimated_value) || 0), 0);
    const hot = filteredLeads.filter(l => (scores[l.id]?.overall || 0) >= 80).length;
    return { count: filteredLeads.length, pipelineValue, hot, open: open.length };
  }, [filteredLeads, scores]);

  const submit = async () => {
    try {
      if (editingLead) {
        await axios.put(`${API}/leads/${editingLead.id}`, form, { headers });
        toast.success("Lead updated");
      } else {
        await axios.post(`${API}/leads`, form, { headers });
        toast.success("Lead created");
      }
      setShowCreate(false);
      setEditingLead(null);
      setForm(EMPTY_FORM);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
  };

  const onPasteParsed = (parsed) => {
    setEditingLead(null);
    setForm({ ...EMPTY_FORM, ...parsed });
    setShowCreate(true);
  };

  const toggleSel = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const bulkAction = async (action, extra = {}) => {
    if (selected.length === 0) { toast.error("Select leads first"); return; }
    try {
      await axios.post(`${API}/lead-studio/bulk-action`, { lead_ids: selected, action, ...extra }, { headers });
      toast.success(`${action} · ${selected.length} leads`);
      setSelected([]);
      load();
    } catch { toast.error("Bulk action failed"); }
  };

  return (
    <div className="p-6 space-y-4" data-testid="leads-page">
      <OperationalPageHeader
        eyebrow="Revenue operations"
        title="Lead Studio"
        description="Capture, qualify, nurture, and convert opportunities with a shared pipeline, scoring, forecasts, proposals, and ticket hand-off."
        icon={Sparkles}
        tone="emerald"
        actions={<>
          <Button variant="outline" size="sm" onClick={() => navigate("/settings?tab=mailbox")} data-testid="leads-email-intake">
            <Funnel className="w-3.5 h-3.5 mr-1" />Email Intake
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPasteOpen(true)} data-testid="leads-quick-add">
            <Sparkles className="w-3.5 h-3.5 mr-1" />Quick Add by Paste
          </Button>
          <Button variant="outline" size="sm" onClick={load} data-testid="leads-refresh">
            <RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh
          </Button>
          <Button size="sm" onClick={() => { setEditingLead(null); setForm(EMPTY_FORM); setShowCreate(true); }} data-testid="leads-new-btn">
            <Plus className="w-3.5 h-3.5 mr-1" />New Lead
          </Button>
        </>}
      />

      {/* Hero stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <HeroTile label="All leads" value={leads.length} icon={Sparkles} glow="violet" onClick={() => { setSearch(""); setStatusFilter("all"); setFilters({}); setTab("directory"); }} testId="stat-total" />
        <HeroTile label="Open pipeline" value={summary.open} icon={Funnel} glow="sky" onClick={() => { setSearch(""); setStatusFilter("all"); setFilters({ pipelineOnly: true }); setTab("directory"); }} testId="stat-open" />
        <HeroTile label="Pipeline value" value={money(summary.pipelineValue)} icon={BarChart3} glow="emerald" animated={false} onClick={() => setTab("insights")} testId="stat-pipeline-value" />
        <HeroTile label="Hot leads" value={summary.hot} icon={Flame} glow="amber" onClick={() => { setSearch(""); setStatusFilter("all"); setFilters({ hotOnly: true }); setTab("directory"); }} testId="stat-hot" />
      </div>

      <LeadActivityTicker />

      <HotLeadsStrip onOpen={setDrawerLeadId} />

      {/* Tabs */}
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="bg-transparent border-b border-zinc-800 rounded-none w-full justify-start gap-1 p-0 h-auto">
          {[
            { v: "pipeline", l: "Pipeline", Icon: Funnel },
            { v: "kanban", l: "Kanban", Icon: KanbanSquare },
            { v: "directory", l: "Directory", Icon: TableIcon },
            { v: "insights", l: "Insights", Icon: BarChart3 },
            { v: "campaigns", l: "Campaigns", Icon: Mail },
            { v: "renewals", l: "Renewals", Icon: Trophy },
          ].map(t => (
            <TabsTrigger key={t.v} value={t.v}
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-violet-500 data-[state=active]:text-zinc-100 text-zinc-500 rounded-none py-2 px-3 text-xs uppercase tracking-wider"
              data-testid={`leads-tab-${t.v}`}>
              <t.Icon className="w-3.5 h-3.5 mr-1" />{t.l}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="pipeline" className="mt-4 space-y-4">
          <PipelineFunnelCanvas onStageClick={(s) => { setSearch(""); setFilters({}); setStatusFilter(s); setTab("directory"); }} />
          <ForecastWidget />
        </TabsContent>

        <TabsContent value="kanban" className="mt-4">
          <LeadsKanban
            leads={filteredLeads}
            scores={scores}
            onOpen={setDrawerLeadId}
            onMoved={(id, from, to) => {
              setLeads(prev => prev.map(l => l.id === id ? { ...l, status: to } : l));
            }}
          />
        </TabsContent>

        <TabsContent value="insights" className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ForecastWidget />
          <VelocityMeter />
          <SourceAttributionPie />
        </TabsContent>

        <TabsContent value="campaigns" className="mt-4">
          <CampaignsPage embedded />
        </TabsContent>

        <TabsContent value="renewals" className="mt-4">
          <LoyaltyDashboardPage embedded />
        </TabsContent>

        <TabsContent value="directory" className="mt-4 space-y-3">
          <LeadSavedViewsBar currentFilters={{ statusFilter, search, ...filters }} onApply={(f) => setFilters(f)} onPreset={(f) => setFilters(f)} />
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search company / contact / email…" value={search} onChange={e => setSearch(e.target.value)} data-testid="leads-search" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]" data-testid="leads-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stages</SelectItem>
                {PIPELINE_STAGES.concat(["lost"]).map(s => (<SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>))}
              </SelectContent>
            </Select>
            {Object.keys(filters).length > 0 && (
              <Button variant="ghost" size="sm" className="h-8 text-[11px]" onClick={() => setFilters({})}>
                <FilterIcon className="w-3 h-3 mr-1" />Clear filters
              </Button>
            )}
            {selected.length > 0 && (
              <div className="ml-auto flex items-center gap-1.5" data-testid="leads-bulk-bar">
                <span className="text-[11px] text-violet-200">{selected.length} selected</span>
                <Select onValueChange={(v) => bulkAction("change_stage", { stage: v })}>
                  <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Change stage…" /></SelectTrigger>
                  <SelectContent>
                    {PIPELINE_STAGES.concat(["lost"]).map(s => (<SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="h-8 text-[11px] text-red-300 border-red-500/40 hover:bg-red-500/10" onClick={() => bulkAction("delete")} data-testid="bulk-delete-btn">Delete</Button>
                <Button variant="ghost" size="sm" className="h-8 text-[11px]" onClick={() => setSelected([])}>Clear</Button>
              </div>
            )}
          </div>

          <Card className="border-zinc-800/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"><input type="checkbox" checked={selected.length > 0 && selected.length === filteredLeads.length} onChange={e => setSelected(e.target.checked ? filteredLeads.map(l => l.id) : [])} /></TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Last touch</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={10} className="py-12 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading leads…</TableCell></TableRow>
                ) : filteredLeads.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="py-12 text-center text-muted-foreground">No leads match. Click New Lead or Quick Add to start.</TableCell></TableRow>
                ) : filteredLeads.map(l => {
                  const cfg = STATUS_CONFIG[l.status] || STATUS_CONFIG.new;
                  const sc = scores[l.id];
                  return (
                    <TableRow
                      key={l.id}
                      onClick={() => setDrawerLeadId(l.id)}
                      data-testid={`lead-row-${l.id}`}
                      className="cursor-pointer hover:bg-violet-500/[0.06] hover:shadow-[inset_2px_0_0_rgb(139,92,246)] transition-all"
                    >
                      <TableCell onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.includes(l.id)} onChange={() => toggleSel(l.id)} data-testid={`lead-select-${l.id}`} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <InitialsAvatar name={l.company_name} size={28} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{l.company_name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{l.website || l.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><span className="text-xs">{l.contact_name || "—"}</span></TableCell>
                      <TableCell><div className="min-w-0"><span className="text-xs capitalize">{l.source || "—"}</span>{l.source_mailbox && <p className="max-w-[150px] truncate text-[10px] text-violet-300" title={l.source_mailbox}>{l.source_mailbox}</p>}</div></TableCell>
                      <TableCell><span className={`text-[10px] px-1.5 py-0.5 rounded border ${cfg.pill}`}>{cfg.label}</span></TableCell>
                      <TableCell className="text-right text-xs font-mono">{money(l.estimated_value)}</TableCell>
                      <TableCell className="text-center">{sc ? <LeadScoreBadge score={sc.overall} sub={sc} compact /> : <span className="text-[10px] text-zinc-600">—</span>}</TableCell>
                      <TableCell><span className="text-xs">{l.assigned_to_name || "—"}</span></TableCell>
                      <TableCell><span className="text-xs text-zinc-400">{timeAgo(l.last_activity_at || l.updated_at)}</span></TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`lead-row-menu-${l.id}`}><MoreVertical className="w-3.5 h-3.5" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setDrawerLeadId(l.id)}>Open</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setCreateTicketFor(l)} data-testid={`row-create-ticket-${l.id}`}><Ticket className="w-3 h-3 mr-1" />Create ticket</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setMergeFor(l)} data-testid={`row-merge-ticket-${l.id}`}><GitMerge className="w-3 h-3 mr-1" />Merge into ticket…</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setEditingLead(l); setForm({ ...EMPTY_FORM, ...l }); setShowCreate(true); }}>Edit</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Drawer */}
      {drawerLeadId && (
        <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} onUpdated={load} />
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showCreate} onOpenChange={(v) => { if (!v) { setShowCreate(false); setEditingLead(null); } }}>
        <DialogContent className="max-w-5xl max-h-[92vh] gap-0 overflow-hidden border-violet-500/25 p-0">
          <DialogHeader className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.18),transparent_42%),linear-gradient(135deg,rgba(23,27,38,0.98),rgba(10,12,17,0.98))] px-6 py-5 pr-14">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-500/10 shadow-[0_0_28px_rgba(139,92,246,0.15)]">
                <Sparkles className="h-5 w-5 text-violet-300" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle>{editingLead ? "Edit lead record" : "Create a new lead"}</DialogTitle>
                  <Badge variant="outline" className="border-violet-400/30 bg-violet-500/10 text-[10px] uppercase tracking-[0.16em] text-violet-200">
                    Revenue workflow
                  </Badge>
                </div>
                <DialogDescription>
                  Capture the account, contact, qualification, and ownership details used across pipeline, forecasting, ticket hand-off, and audit history.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[calc(92vh-176px)] overflow-y-auto px-6 py-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <WorkflowSection
                icon={Building2}
                eyebrow="Account"
                title="Company and contact"
                description="The core identity technicians and account managers will see."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Company *"><Input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Business or organisation" data-testid="form-company" /></Field>
                  <Field label="Contact"><Input value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} placeholder="Primary contact" data-testid="form-contact" /></Field>
                  <Field label="Email"><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="name@company.com.au" data-testid="form-email" /></Field>
                  <Field label="Phone"><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+61…" data-testid="form-phone" /></Field>
                  <Field label="Website"><Input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="company.com.au" /></Field>
                  <Field label="Contact title"><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Operations Manager" /></Field>
                </div>
              </WorkflowSection>

              <WorkflowSection
                icon={BadgeDollarSign}
                eyebrow="Qualification"
                title="Pipeline and ownership"
                description="Route the opportunity and keep forecasts attributable."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Source">
                    <Select value={form.source} onValueChange={v => setForm(f => ({ ...f, source: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="website">Website</SelectItem>
                        <SelectItem value="referral">Referral</SelectItem>
                        <SelectItem value="cold_call">Cold Call</SelectItem>
                        <SelectItem value="marketing">Marketing</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Stage">
                    <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PIPELINE_STAGES.concat(["lost"]).map(s => (<SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Estimated value ($)">
                    <Input min="0" step="0.01" type="number" value={form.estimated_value} onChange={e => setForm(f => ({ ...f, estimated_value: Number(e.target.value) }))} />
                  </Field>
                  <Field label="Owner">
                    <OwnerPicker users={users} value={form.assigned_to} onChange={v => setForm(f => ({ ...f, assigned_to: v }))} />
                  </Field>
                </div>
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  <p className="text-[11px] leading-relaxed text-zinc-400">
                    Changes are retained in the lead timeline so conversion, ownership, and ticket hand-off remain auditable.
                  </p>
                </div>
              </WorkflowSection>

              <WorkflowSection
                icon={NotebookPen}
                eyebrow="Context"
                title="Qualification notes"
                description="Record requirements, timing, stakeholders, and the next useful action."
                className="lg:col-span-2"
              >
                <Field label="Notes">
                  <Textarea
                    rows={5}
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="What is the client trying to achieve? Include scope, urgency, current provider, budget signals, and next steps."
                    className="min-h-32 resize-y"
                  />
                </Field>
              </WorkflowSection>
            </div>
          </div>

          <DialogFooter className="items-center gap-3 border-t border-white/[0.08] bg-black/20 px-6 py-4 sm:justify-between sm:space-x-0">
            <div className="flex items-center gap-2 text-left text-[11px] text-zinc-500">
              <UserRound className="h-3.5 w-3.5 text-violet-300" />
              {form.company_name.trim() ? "Ready to save to the shared revenue timeline." : "Add a company name to make this lead ready."}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowCreate(false); setEditingLead(null); }}>Cancel</Button>
              <Button onClick={submit} disabled={!form.company_name.trim()} className="min-w-32 bg-violet-600 hover:bg-violet-500" data-testid="form-submit">
                {editingLead ? "Save changes" : "Create lead"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Add by paste */}
      <QuickAddPasteDialog open={pasteOpen} onClose={() => setPasteOpen(false)} onParsed={onPasteParsed} />

      {/* Row-level create/merge dialogs */}
      <MergeLeadIntoTicketDialog open={!!mergeFor} onClose={() => setMergeFor(null)} lead={mergeFor} onMerged={load} />
      <CreateTicketFromLeadDialog open={!!createTicketFor} onClose={() => setCreateTicketFor(null)} lead={createTicketFor} onCreated={load} />
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <Label className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function WorkflowSection({ icon: Icon, eyebrow, title, description, className = "", children }) {
  return (
    <section className={`rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${className}`}>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/[0.08]">
          <Icon className="h-4 w-4 text-violet-300" />
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-violet-300">{eyebrow}</p>
          <h3 className="mt-0.5 text-sm font-semibold text-zinc-100">{title}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function OwnerPicker({ users, value, onChange }) {
  const [open, setOpen] = useState(false);
  const uniqueUsers = useMemo(() => {
    const seen = new Set();
    return users.filter(user => {
      const identity = user.id || user.email;
      if (!identity || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }, [users]);
  const selectedUser = uniqueUsers.find(u => (u.id || u.email) === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-between font-normal"
          data-testid="form-owner"
        >
          <span className={selectedUser ? "truncate text-zinc-100" : "truncate text-zinc-500"}>
            {selectedUser ? (selectedUser.name || selectedUser.email) : "Search team members…"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search name or email…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No team member found.</CommandEmpty>
            <CommandGroup heading="Lead owner">
              <CommandItem value="Unassigned" onSelect={() => { onChange(""); setOpen(false); }}>
                <Check className={`mr-2 h-4 w-4 ${value ? "opacity-0" : "opacity-100"}`} />
                <span>Unassigned</span>
              </CommandItem>
              {uniqueUsers.map(u => {
                const userValue = u.id || u.email;
                return (
                  <CommandItem
                    key={userValue}
                    value={`${u.name || ""} ${u.email || ""}`}
                    onSelect={() => { onChange(userValue); setOpen(false); }}
                  >
                    <Check className={`mr-2 h-4 w-4 ${value === userValue ? "opacity-100" : "opacity-0"}`} />
                    <div className="min-w-0">
                      <p className="truncate text-sm">{u.name || u.email}</p>
                      {u.name && u.email && <p className="truncate text-[10px] text-zinc-500">{u.email}</p>}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
