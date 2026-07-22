import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus, Search, RefreshCw, Loader2, Sparkles, Flame, Filter as FilterIcon,
  Funnel, KanbanSquare, BarChart3, Table as TableIcon, ChevronRight, Ticket, GitMerge, MoreVertical, Mail, Trophy
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
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingLead ? "Edit Lead" : "New Lead"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company *"><Input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} data-testid="form-company" /></Field>
            <Field label="Contact"><Input value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} data-testid="form-contact" /></Field>
            <Field label="Email"><Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} data-testid="form-email" /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} data-testid="form-phone" /></Field>
            <Field label="Website"><Input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} /></Field>
            <Field label="Title"><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></Field>
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
            <Field label="Estimated Value ($)"><Input type="number" value={form.estimated_value} onChange={e => setForm(f => ({ ...f, estimated_value: Number(e.target.value) }))} /></Field>
            <Field label="Owner">
              <Select value={form.assigned_to} onValueChange={v => setForm(f => ({ ...f, assigned_to: v }))}>
                <SelectTrigger><SelectValue placeholder="Assign…" /></SelectTrigger>
                <SelectContent>
                  {users.map(u => (<SelectItem key={u.id || u.email} value={u.id || u.email}>{u.name || u.email}</SelectItem>))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Notes" full><Textarea rows={4} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowCreate(false); setEditingLead(null); }}>Cancel</Button>
            <Button onClick={submit} disabled={!form.company_name.trim()} className="bg-violet-600 hover:bg-violet-500" data-testid="form-submit">
              {editingLead ? "Save" : "Create"}
            </Button>
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

function Stat({ label, value, hue, testid }) {
  const cmap = {
    violet: "from-violet-500/20 to-violet-500/[0.03] border-violet-500/30 text-violet-200",
    sky: "from-sky-500/20 to-sky-500/[0.03] border-sky-500/30 text-sky-200",
    emerald: "from-emerald-500/20 to-emerald-500/[0.03] border-emerald-500/30 text-emerald-200",
    orange: "from-orange-500/20 to-orange-500/[0.03] border-orange-500/30 text-orange-200",
  };
  return (
    <Card className={`p-3 bg-gradient-to-br border ${cmap[hue]}`} data-testid={testid}>
      <p className="text-[10px] uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-2xl font-mono font-semibold mt-1">{value}</p>
    </Card>
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
