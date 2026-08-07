import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { MetricStrip, MetricTile } from "@/components/design-system";
import {
  Building2, Users, Monitor, FileText, Shield, Activity, BookOpen, Rocket,
  ArrowRight, ArrowLeft, CheckCircle2, Circle, Loader2, Plus, Trash2,
  Pause, Play, Clock, AlertTriangle, ChevronRight,
  Search, Upload, Globe,
  Cpu, Bell, Wrench,
  ClipboardCheck, MessageSquare, Target,
  LayoutGrid, List, GripVertical, Ticket
} from "lucide-react";

const STEP_ICONS = {
  company_profile: Building2,
  contacts_access: Users,
  asset_discovery: Monitor,
  contracts_billing: FileText,
  security_compliance: Shield,
  monitoring_automation: Activity,
  documentation: BookOpen,
  go_live: Rocket,
};

const STEP_KEYS = [
  "company_profile", "contacts_access", "asset_discovery", "contracts_billing",
  "security_compliance", "monitoring_automation", "documentation", "go_live"
];

const STEP_LABELS = {
  company_profile: "Company Profile",
  contacts_access: "Contacts & Access",
  asset_discovery: "Asset Discovery",
  contracts_billing: "Contracts & Billing",
  security_compliance: "Security & Compliance",
  monitoring_automation: "Monitoring & Automation",
  documentation: "Documentation",
  go_live: "Go Live",
};

const STEP_DESCRIPTIONS = {
  company_profile: "Create the client record and establish the service baseline.",
  contacts_access: "Record accountable contacts, access expectations, and notification ownership.",
  asset_discovery: "Capture the initial managed estate ready for RMM and service delivery.",
  contracts_billing: "Set commercial commitments, service coverage, and billing controls.",
  security_compliance: "Evidence the minimum security baseline and any accepted exceptions.",
  monitoring_automation: "Apply alerting, remediation, and maintenance policies.",
  documentation: "Prepare the operational record required for a clean team handover.",
  go_live: "Verify readiness, record the final checks, and launch managed service.",
};

const CRITICAL_PREFLIGHT_IDS = ["pf-01", "pf-02", "pf-03", "pf-04", "pf-05", "pf-06", "pf-11"];

const INDUSTRIES = ["Technology", "Healthcare", "Finance", "Education", "Manufacturing", "Retail", "Legal", "Accounting", "Construction", "Hospitality", "Non-Profit", "Government", "Real Estate", "Media", "Other"];
const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney"];

// ─── Kanban Board View ─────────────────────────────────────────────────────────
function KanbanBoardView({ sessions, onSelect }) {
  const COLUMNS = [
    { key: "in_progress", label: "In Progress", color: "border-blue-500/40", bg: "bg-blue-500/5", text: "text-blue-400", icon: Play },
    { key: "paused", label: "Paused", color: "border-amber-500/40", bg: "bg-amber-500/5", text: "text-amber-400", icon: Pause },
    { key: "completed", label: "Completed", color: "border-emerald-500/40", bg: "bg-emerald-500/5", text: "text-emerald-400", icon: CheckCircle2 },
  ];

  const grouped = {};
  COLUMNS.forEach(c => { grouped[c.key] = []; });
  sessions.forEach(s => {
    const status = s.status || "in_progress";
    if (grouped[status]) grouped[status].push(s);
    else grouped.in_progress.push(s);
  });

  return (
    <div className="grid grid-cols-3 gap-4" data-testid="kanban-board">
      {COLUMNS.map(col => {
        const Icon = col.icon;
        const items = grouped[col.key] || [];
        return (
          <div key={col.key} className={`rounded-xl border-2 ${col.color} ${col.bg} min-h-[400px]`}>
            <div className="p-3 border-b border-border/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${col.text}`} />
                  <span className={`text-sm font-bold ${col.text}`}>{col.label}</span>
                </div>
                <Badge variant="outline" className={`text-xs ${col.text} border-current`}>{items.length}</Badge>
              </div>
            </div>
            <div className="p-2 space-y-2">
              {items.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground/50">
                  <Circle className="w-6 h-6 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No sessions</p>
                </div>
              ) : items.map(s => {
                const completedSteps = Object.values(s.steps || {}).filter(v => v.status === "completed").length;
                const totalSteps = Object.keys(s.steps || {}).length || 8;
                const pct = Math.round((completedSteps / totalSteps) * 100);
                return (
                  <Card
                    key={s.id}
                    className="cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all border-border/40 bg-background/80"
                    onClick={() => onSelect(s.id)}
                    data-testid={`kanban-card-${s.id}`}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <GripVertical className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm truncate">{s.client_name || "Unnamed"}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{s.id}</p>
                        </div>
                      </div>
                      <Progress value={pct} className="h-1 mb-2" />
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{completedSteps}/{totalSteps} steps</span>
                        <span className="flex items-center gap-1"><Target className="w-2.5 h-2.5" />{s.health_score || 0}%</span>
                      </div>
                      <div className="flex gap-0.5 mt-2">
                        {STEP_KEYS.map(key => {
                          const st = s.steps?.[key]?.status;
                          return <div key={key} className={`h-1 flex-1 rounded-full ${st === "completed" ? "bg-emerald-500" : st === "skipped" ? "bg-amber-500/50" : "bg-border/40"}`} />;
                        })}
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <Badge variant="outline" className="text-[9px]">{s.template_name?.split(" ")[0]}</Badge>
                        {s.priority && s.priority !== "normal" && (
                          <Badge className={`text-[9px] ${s.priority === "urgent" ? "bg-red-500/20 text-red-400" : s.priority === "high" ? "bg-orange-500/20 text-orange-400" : "bg-blue-500/20 text-blue-400"}`}>
                            {s.priority}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Session List View ─────────────────────────────────────────────────────────
function SessionListView({ sessions, stats, onSelect, onNew, loading }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState("kanban"); // kanban | list

  const filtered = sessions.filter(s => {
    if (filter !== "all" && s.status !== filter) return false;
    if (search && !s.client_name?.toLowerCase().includes(search.toLowerCase()) && !s.id?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-5" data-testid="onboarding-sessions-list">
      <OperationalPageHeader
        eyebrow="Client success"
        title="Client Onboarding"
        description="Move every new customer from discovery to a fully auditable, service-ready handover."
        icon={Rocket}
        tone="sky"
        actions={<Button onClick={onNew} data-testid="new-onboarding-btn"><Plus className="mr-2 h-4 w-4" />New onboarding</Button>}
      />

      {/* Stats Row */}
      <MetricStrip columns={4}>
        <MetricTile label="Total sessions" value={stats.total_sessions || 0} icon={<Building2 className="h-2.5 w-2.5 text-sky-300" />} accent="sky" />
        <MetricTile label="In progress" value={stats.in_progress || 0} icon={<Play className="h-2.5 w-2.5 text-cyan-300" />} accent="cyan" />
        <MetricTile label="Completed" value={stats.completed || 0} icon={<CheckCircle2 className="h-2.5 w-2.5 text-emerald-300" />} accent="emerald" />
        <MetricTile label="Average readiness" value={`${stats.avg_health || 0}%`} icon={<Activity className="h-2.5 w-2.5 text-amber-300" />} accent="amber" />
      </MetricStrip>

      {/* Filters + View Toggle */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search sessions..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="session-search" />
        </div>
        <div className="flex gap-1">
          {["all", "in_progress", "completed", "paused"].map(f => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "ghost"} onClick={() => setFilter(f)} className="text-xs capitalize">
              {f.replace("_", " ")}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex rounded-lg border overflow-hidden">
          <button onClick={() => setViewMode("kanban")} className={`px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1 ${viewMode === "kanban" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} data-testid="view-kanban">
            <LayoutGrid className="w-3.5 h-3.5" />Board
          </button>
          <button onClick={() => setViewMode("list")} className={`px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1 ${viewMode === "list" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} data-testid="view-list">
            <List className="w-3.5 h-3.5" />List
          </button>
        </div>
      </div>

      {/* Content - Kanban or List */}
      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : viewMode === "kanban" ? (
        filtered.length === 0 ? (
          <Card className="border-dashed border-border/40">
            <CardContent className="py-16 text-center">
              <Rocket className="w-14 h-14 mx-auto text-muted-foreground/20 mb-4" />
              <p className="text-lg font-semibold mb-1">No Onboarding Sessions</p>
              <p className="text-sm text-muted-foreground mb-5">Start your first client onboarding to get going.</p>
              <Button onClick={onNew}><Plus className="w-4 h-4 mr-2" />Start Onboarding</Button>
            </CardContent>
          </Card>
        ) : (
          <KanbanBoardView sessions={filtered} onSelect={onSelect} />
        )
      ) : filtered.length === 0 ? (
        <Card className="border-dashed border-border/40">
          <CardContent className="py-16 text-center">
            <Rocket className="w-14 h-14 mx-auto text-muted-foreground/20 mb-4" />
            <p className="text-lg font-semibold mb-1">No Onboarding Sessions</p>
            <p className="text-sm text-muted-foreground mb-5">Start your first client onboarding to get going.</p>
            <Button onClick={onNew}><Plus className="w-4 h-4 mr-2" />Start Onboarding</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(s => {
            const completedSteps = Object.values(s.steps || {}).filter(v => v.status === "completed").length;
            const totalSteps = Object.keys(s.steps || {}).length || 8;
            const pct = Math.round((completedSteps / totalSteps) * 100);
            const statusColors = {
              in_progress: "bg-blue-500/15 text-blue-400 border-blue-500/20",
              completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
              paused: "bg-amber-500/15 text-amber-400 border-amber-500/20",
            };
            return (
              <Card
                key={s.id}
                className="cursor-pointer hover:border-primary/40 transition-all group border-border/40"
                onClick={() => onSelect(s.id)}
                data-testid={`session-card-${s.id}`}
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{s.client_name || "Unnamed Client"}</p>
                      <p className="text-xs text-muted-foreground font-mono">{s.id}</p>
                    </div>
                    <Badge className={`text-[10px] ${statusColors[s.status] || ""}`}>
                      {s.status?.replace("_", " ")}
                    </Badge>
                  </div>
                  <Progress value={pct} className="h-1.5 mb-2" />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{completedSteps}/{totalSteps} steps</span>
                    <span className="flex items-center gap-1">
                      <Target className="w-3 h-3" />{s.health_score || 0}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
                    <span>{s.template_name}</span>
                    <span>{s.created_at?.slice(0, 10)}</span>
                  </div>
                  <div className="flex gap-1 mt-3">
                    {STEP_KEYS.map((key) => {
                      const st = s.steps?.[key]?.status;
                      return (
                        <div key={key} className={`h-1.5 flex-1 rounded-full ${st === "completed" ? "bg-emerald-500" : st === "skipped" ? "bg-amber-500/50" : "bg-border/40"}`} />
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Template Selection Dialog ─────────────────────────────────────────────────
function TemplateDialog({ open, onClose, onCreate }) {
  const [selected, setSelected] = useState("mid_market");
  const [clientName, setClientName] = useState("");
  const [priority, setPriority] = useState("normal");

  const templates = {
    small_office: { name: "Small Office (1-20 users)", desc: "Quick setup for small businesses", days: 3, icon: Building2, color: "from-green-500 to-emerald-600" },
    mid_market: { name: "Mid-Market (21-100 users)", desc: "Standard onboarding with security baseline", days: 7, icon: Users, color: "from-blue-500 to-cyan-600" },
    enterprise: { name: "Enterprise (100+ users)", desc: "White-glove onboarding with PM", days: 14, icon: Globe, color: "from-purple-500 to-indigo-600" },
    break_fix: { name: "Break/Fix Client", desc: "Minimal onboarding for ad-hoc support", days: 1, icon: Wrench, color: "from-amber-500 to-orange-600" },
  };

  const handleCreate = () => {
    onCreate({ template: selected, client_name: clientName, priority });
    setClientName("");
    setSelected("mid_market");
    setPriority("normal");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col overflow-hidden border-cyan-400/25 bg-[linear-gradient(145deg,rgba(9,22,30,0.98),rgba(13,15,21,0.98))] p-0" aria-describedby="template-dialog-desc">
        <DialogHeader className="shrink-0 border-b border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.17),transparent_45%),linear-gradient(135deg,rgba(16,185,129,0.10),transparent)] px-6 py-5 text-left">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Client success workspace</p>
          <div className="mt-1 flex flex-wrap items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10"><Rocket className="h-4 w-4 text-emerald-300" /></span><DialogTitle className="text-2xl tracking-tight text-zinc-100">Start client onboarding</DialogTitle><Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/[0.06] text-[10px] text-cyan-100">Audit-ready workflow</Badge></div>
          <DialogDescription id="template-dialog-desc" className="mt-2 max-w-2xl">Create the controlled service record first. The selected delivery template shapes the workflow, readiness checks, and expected handover timing.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
            <div className="mb-3"><Label className="text-sm font-semibold text-zinc-100">Client identity</Label><p className="mt-1 text-xs text-muted-foreground">Use the legal or trading name that should appear in the service record and future audit history.</p></div>
            <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Acme Corp" data-testid="template-client-name" className="border-white/10 bg-black/15" />
          </section>
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><Label className="text-sm font-semibold text-zinc-100">Delivery blueprint</Label><p className="mt-1 text-xs text-muted-foreground">Choose the service motion that best matches this client. It can be reviewed later from the record.</p></div><Badge variant="outline" className="border-white/10 text-[10px] text-muted-foreground">One template required</Badge></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(templates).map(([key, t]) => {
                const Icon = t.icon;
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setSelected(key)}
                    className={`rounded-xl border p-3.5 text-left transition-all ${selected === key ? "border-cyan-400/35 bg-cyan-400/[0.08] shadow-[0_0_0_1px_rgba(34,211,238,0.08)]" : "border-white/[0.09] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.045]"}`}
                    data-testid={`template-${key}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-md bg-gradient-to-br ${t.color} flex items-center justify-center`}>
                        <Icon className="w-3.5 h-3.5 text-white" />
                      </div>
                      <span className="font-semibold text-sm">{t.name}</span>
                      </div>
                      {selected === key && <CheckCircle2 className="h-4 w-4 text-cyan-200" />}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{t.desc}</p>
                    <p className="mt-2 flex items-center gap-1 text-[10px] text-cyan-100/80"><Clock className="h-3 w-3" />Estimated delivery: ~{t.days} days</p>
                  </button>
                );
              })}
            </div>
          </section>
          <section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
            <Label className="text-sm font-semibold text-zinc-100">Service priority</Label>
            <p className="mt-1 text-xs text-muted-foreground">Priority is retained in the delivery record for workload and audit reporting.</p>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="mt-3 border-white/10 bg-black/15"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </section>
        </div>
        <DialogFooter className="shrink-0 border-t border-white/[0.07] bg-black/10 px-6 py-4"><p className="mr-auto text-xs text-zinc-500">The first save opens the controlled client onboarding record; it does not create a billable agreement.</p>
          <Button variant="outline" className="border-white/10 bg-white/[0.035]" onClick={onClose}>Cancel</Button>
          <Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={handleCreate} disabled={!clientName.trim()} data-testid="create-session-btn">
            <Rocket className="mr-2 h-4 w-4" />Open service record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Step Forms ────────────────────────────────────────────────────────────────
function CompanyProfileForm({ data, onChange }) {
  const u = (field, val) => onChange({ ...data, [field]: val });
  return (
    <div className="space-y-4" data-testid="step-company-profile">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Company Name *</Label>
          <Input value={data.company_name || ""} onChange={e => u("company_name", e.target.value)} placeholder="Acme Corp" data-testid="company-name-input" />
        </div>
        <div>
          <Label>Email *</Label>
          <Input type="email" value={data.email || ""} onChange={e => u("email", e.target.value)} placeholder="info@acme.com" data-testid="company-email-input" />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={data.phone || ""} onChange={e => u("phone", e.target.value)} placeholder="+1 555-0100" />
        </div>
        <div>
          <Label>Website</Label>
          <Input value={data.website || ""} onChange={e => u("website", e.target.value)} placeholder="https://acme.com" />
        </div>
      </div>
      <Separator />
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label>Street Address</Label>
          <Input value={data.address || ""} onChange={e => u("address", e.target.value)} placeholder="123 Business Rd, Suite 100" />
        </div>
        <div>
          <Label>City</Label>
          <Input value={data.city || ""} onChange={e => u("city", e.target.value)} placeholder="New York" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>State</Label>
            <Input value={data.state || ""} onChange={e => u("state", e.target.value)} placeholder="NY" />
          </div>
          <div>
            <Label>ZIP</Label>
            <Input value={data.zip_code || ""} onChange={e => u("zip_code", e.target.value)} placeholder="10001" />
          </div>
        </div>
      </div>
      <Separator />
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Industry</Label>
          <Select value={data.industry || "__none"} onValueChange={v => u("industry", v === "__none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>{INDUSTRIES.map(i => <SelectItem key={`k-${i}`} value={i.toLowerCase()}>{i}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Employee Count</Label>
          <Input type="number" value={data.employee_count || ""} onChange={e => u("employee_count", parseInt(e.target.value) || 0)} placeholder="50" />
        </div>
        <div>
          <Label>Service Tier</Label>
          <Select value={data.tier || "standard"} onValueChange={v => u("tier", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="basic">Basic</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="premium">Premium</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Timezone</Label>
          <Select value={data.timezone || "America/New_York"} onValueChange={v => u("timezone", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TIMEZONES.map(tz => <SelectItem key={tz} value={tz}>{tz.replace("_", " ")}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Business Hours</Label>
          <Input value={data.business_hours || ""} onChange={e => u("business_hours", e.target.value)} placeholder="9:00 AM - 5:00 PM" />
        </div>
      </div>
    </div>
  );
}

function ContactsAccessForm({ data, onChange }) {
  const contacts = data.contacts || [{ name: "", email: "", phone: "", role: "primary", title: "", portal_access: true, receives_alerts: true }];
  const updateContact = (i, field, val) => {
    const updated = [...contacts];
    updated[i] = { ...updated[i], [field]: val };
    onChange({ ...data, contacts: updated });
  };
  const addContact = () => onChange({ ...data, contacts: [...contacts, { name: "", email: "", phone: "", role: "technical", title: "", portal_access: false, receives_alerts: false }] });
  const removeContact = (i) => onChange({ ...data, contacts: contacts.filter((_, j) => j !== i) });

  return (
    <div className="space-y-4" data-testid="step-contacts-access">
      <p className="text-sm text-muted-foreground">Add key contacts for this client. At minimum, add a primary contact.</p>
      {contacts.map((c, i) => (
        <Card key={`k-${i}`} className="border-border/40">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contact {i + 1}</span>
              {i > 0 && <Button variant="ghost" size="sm" className="h-7 text-red-400 hover:text-red-300" onClick={() => removeContact(i)}><Trash2 className="w-3 h-3 mr-1" />Remove</Button>}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Full Name *</Label><Input value={c.name} onChange={e => updateContact(i, "name", e.target.value)} placeholder="John Smith" className="mt-1" data-testid={`contact-name-${i}`} /></div>
              <div><Label className="text-xs">Email *</Label><Input value={c.email} onChange={e => updateContact(i, "email", e.target.value)} placeholder="john@acme.com" className="mt-1" /></div>
              <div><Label className="text-xs">Phone</Label><Input value={c.phone} onChange={e => updateContact(i, "phone", e.target.value)} placeholder="+1 555-0100" className="mt-1" /></div>
              <div><Label className="text-xs">Job Title</Label><Input value={c.title} onChange={e => updateContact(i, "title", e.target.value)} placeholder="IT Manager" className="mt-1" /></div>
              <div>
                <Label className="text-xs">Role</Label>
                <Select value={c.role} onValueChange={v => updateContact(i, "role", v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primary">Primary Contact</SelectItem>
                    <SelectItem value="billing">Billing Contact</SelectItem>
                    <SelectItem value="technical">Technical Contact</SelectItem>
                    <SelectItem value="executive">Executive Sponsor</SelectItem>
                    <SelectItem value="emergency">Emergency Contact</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-4 pb-1">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox checked={c.portal_access} onCheckedChange={v => updateContact(i, "portal_access", v)} />
                  Portal Access
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox checked={c.receives_alerts} onCheckedChange={v => updateContact(i, "receives_alerts", v)} />
                  Alert Emails
                </label>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      <Button variant="outline" size="sm" onClick={addContact}><Plus className="w-3 h-3 mr-1" />Add Contact</Button>
    </div>
  );
}

function AssetDiscoveryForm({ data, onChange }) {
  const devices = data.devices || [{ hostname: "", type: "workstation", os: "", ip: "", mac: "", serial: "", manufacturer: "", model: "", location: "" }];
  const updateDevice = (i, field, val) => {
    const updated = [...devices];
    updated[i] = { ...updated[i], [field]: val };
    onChange({ ...data, devices: updated });
  };
  const addDevice = () => onChange({ ...data, devices: [...devices, { hostname: "", type: "workstation", os: "", ip: "", mac: "", serial: "", manufacturer: "", model: "", location: "" }] });
  const removeDevice = (i) => onChange({ ...data, devices: devices.filter((_, j) => j !== i) });

  return (
    <div className="space-y-4" data-testid="step-asset-discovery">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Register devices for RMM monitoring. Add manually or use bulk import.</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled><Upload className="w-3 h-3 mr-1" />CSV Import</Button>
          <Button variant="outline" size="sm" disabled><Search className="w-3 h-3 mr-1" />Network Scan</Button>
        </div>
      </div>
      {devices.map((d, i) => (
        <Card key={`k-${i}`} className="border-border/40">
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Monitor className="w-3 h-3" />Device {i + 1}
              </span>
              {i > 0 && <Button variant="ghost" size="sm" className="h-6 text-red-400 hover:text-red-300 text-xs" onClick={() => removeDevice(i)}><Trash2 className="w-3 h-3" /></Button>}
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div><Label className="text-xs">Hostname *</Label><Input value={d.hostname} onChange={e => updateDevice(i, "hostname", e.target.value)} placeholder="WS-ACME-01" className="mt-1 text-sm" data-testid={`device-hostname-${i}`} /></div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={d.type} onValueChange={v => updateDevice(i, "type", v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="workstation">Workstation</SelectItem>
                    <SelectItem value="server">Server</SelectItem>
                    <SelectItem value="laptop">Laptop</SelectItem>
                    <SelectItem value="router">Router/Firewall</SelectItem>
                    <SelectItem value="switch">Switch</SelectItem>
                    <SelectItem value="printer">Printer</SelectItem>
                    <SelectItem value="nas">NAS/SAN</SelectItem>
                    <SelectItem value="access_point">Access Point</SelectItem>
                    <SelectItem value="voip">VoIP Phone</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">OS</Label><Input value={d.os} onChange={e => updateDevice(i, "os", e.target.value)} placeholder="Windows 11 Pro" className="mt-1 text-sm" /></div>
              <div><Label className="text-xs">IP Address</Label><Input value={d.ip} onChange={e => updateDevice(i, "ip", e.target.value)} placeholder="192.168.1.100" className="mt-1 text-sm" /></div>
              <div><Label className="text-xs">MAC Address</Label><Input value={d.mac} onChange={e => updateDevice(i, "mac", e.target.value)} placeholder="AA:BB:CC:DD:EE:FF" className="mt-1 text-sm" /></div>
              <div><Label className="text-xs">Serial Number</Label><Input value={d.serial} onChange={e => updateDevice(i, "serial", e.target.value)} placeholder="SN-12345" className="mt-1 text-sm" /></div>
              <div><Label className="text-xs">Manufacturer</Label><Input value={d.manufacturer} onChange={e => updateDevice(i, "manufacturer", e.target.value)} placeholder="Dell" className="mt-1 text-sm" /></div>
              <div><Label className="text-xs">Location</Label><Input value={d.location} onChange={e => updateDevice(i, "location", e.target.value)} placeholder="Main Office - Rm 101" className="mt-1 text-sm" /></div>
            </div>
          </CardContent>
        </Card>
      ))}
      <Button variant="outline" size="sm" onClick={addDevice}><Plus className="w-3 h-3 mr-1" />Add Device</Button>
      <p className="text-xs text-muted-foreground">{devices.length} device(s) registered</p>
    </div>
  );
}

function ContractsBillingForm({ data, onChange }) {
  const u = (field, val) => onChange({ ...data, [field]: val });
  return (
    <div className="space-y-4" data-testid="step-contracts-billing">
      <label className="flex items-center gap-3 p-3 rounded-lg border border-border/40 cursor-pointer hover:bg-muted/30">
        <Checkbox checked={data.create_contract || false} onCheckedChange={v => u("create_contract", v)} />
        <div>
          <p className="font-semibold text-sm">Create Service Contract</p>
          <p className="text-xs text-muted-foreground">Set up a managed services agreement for this client</p>
        </div>
      </label>
      {data.create_contract && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Contract Name</Label>
              <Input value={data.contract_name || ""} onChange={e => u("contract_name", e.target.value)} placeholder="Managed IT Services Agreement" />
            </div>
            <div>
              <Label>Contract Type</Label>
              <Select value={data.contract_type || "managed"} onValueChange={v => u("contract_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="managed">Managed Services</SelectItem>
                  <SelectItem value="break_fix">Break/Fix</SelectItem>
                  <SelectItem value="project">Project-Based</SelectItem>
                  <SelectItem value="co_managed">Co-Managed IT</SelectItem>
                  <SelectItem value="vcio">vCIO/vCISO</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Monthly Value ($)</Label>
              <Input type="number" value={data.monthly_value || ""} onChange={e => u("monthly_value", parseFloat(e.target.value) || 0)} placeholder="2500" />
            </div>
            <div>
              <Label>Billing Cycle</Label>
              <Select value={data.billing_cycle || "monthly"} onValueChange={v => u("billing_cycle", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Separator />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">SLA Configuration</p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>SLA Tier</Label>
              <Select value={data.sla_tier || "standard"} onValueChange={v => u("sla_tier", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="best_effort">Best Effort</SelectItem>
                  <SelectItem value="business_hours">Business Hours</SelectItem>
                  <SelectItem value="standard">Standard (8x5)</SelectItem>
                  <SelectItem value="priority">Priority (12x6)</SelectItem>
                  <SelectItem value="critical_24x7">Critical (24x7)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Response Time (hours)</Label>
              <Input type="number" value={data.sla_response_hours || ""} onChange={e => u("sla_response_hours", parseInt(e.target.value) || 0)} placeholder="4" />
            </div>
            <div>
              <Label>Resolution Time (hours)</Label>
              <Input type="number" value={data.sla_resolution_hours || ""} onChange={e => u("sla_resolution_hours", parseInt(e.target.value) || 0)} placeholder="24" />
            </div>
            <div>
              <Label>Payment Terms</Label>
              <Select value={data.payment_terms || "net_30"} onValueChange={v => u("payment_terms", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="net_15">Net 15</SelectItem>
                  <SelectItem value="net_30">Net 30</SelectItem>
                  <SelectItem value="net_45">Net 45</SelectItem>
                  <SelectItem value="net_60">Net 60</SelectItem>
                  <SelectItem value="due_on_receipt">Due on Receipt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={data.start_date || ""} onChange={e => u("start_date", e.target.value)} />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={data.auto_renew !== false} onCheckedChange={v => u("auto_renew", v)} />
                Auto-Renew Contract
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SecurityComplianceForm({ data, onChange }) {
  const u = (field, val) => onChange({ ...data, [field]: val });
  const securityChecks = [
    { key: "mfa_enforced", label: "MFA enforced on all admin accounts", critical: true },
    { key: "password_policy", label: "Password complexity policy configured", critical: true },
    { key: "firewall_reviewed", label: "Firewall rules reviewed and documented", critical: true },
    { key: "antivirus_deployed", label: "Antivirus/EDR deployed to all endpoints", critical: true },
    { key: "backup_configured", label: "Backup solution configured and tested", critical: true },
    { key: "email_filtering", label: "Email filtering/spam protection active", critical: false },
    { key: "dns_filtering", label: "DNS filtering enabled (e.g. DNSFilter)", critical: false },
    { key: "encryption_enabled", label: "Full disk encryption enabled (BitLocker/FileVault)", critical: false },
    { key: "admin_audit", label: "Local admin accounts audited and secured", critical: false },
    { key: "remote_access_secured", label: "Remote access tools secured and documented", critical: false },
    { key: "security_training", label: "Security awareness training scheduled", critical: false },
  ];
  return (
    <div className="space-y-4" data-testid="step-security-compliance">
      <p className="text-sm text-muted-foreground">Complete the security baseline assessment for this client.</p>
      <div className="grid grid-cols-1 gap-2">
        {securityChecks.map(check => (
          <label key={check.key} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${data[check.key] ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/40 hover:bg-muted/30"}`}>
            <Checkbox checked={data[check.key] || false} onCheckedChange={v => u(check.key, v)} />
            <div className="flex items-center gap-2 flex-1">
              <span className="text-sm">{check.label}</span>
              {check.critical && <Badge variant="outline" className="text-[9px] border-red-500/30 text-red-400">Required</Badge>}
            </div>
            {data[check.key] && <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
          </label>
        ))}
      </div>
      <Separator />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Compliance Framework</Label>
          <Select value={data.compliance_framework || "__none"} onValueChange={v => u("compliance_framework", v === "__none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Select if applicable..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">None</SelectItem>
              <SelectItem value="hipaa">HIPAA</SelectItem>
              <SelectItem value="pci_dss">PCI-DSS</SelectItem>
              <SelectItem value="soc2">SOC 2</SelectItem>
              <SelectItem value="nist">NIST CSF</SelectItem>
              <SelectItem value="cmmc">CMMC</SelectItem>
              <SelectItem value="gdpr">GDPR</SelectItem>
              <SelectItem value="iso27001">ISO 27001</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Notes</Label>
          <Input value={data.security_notes || ""} onChange={e => u("security_notes", e.target.value)} placeholder="Any security concerns or notes..." />
        </div>
      </div>
    </div>
  );
}

function MonitoringAutomationForm({ data, onChange }) {
  const u = (field, val) => onChange({ ...data, [field]: val });
  return (
    <div className="space-y-4" data-testid="step-monitoring-automation">
      <p className="text-sm text-muted-foreground">Configure monitoring thresholds and automation rules for this client.</p>
      <Card className="border-border/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Cpu className="w-4 h-4 text-cyan-400" />Alert Thresholds</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            <div><Label className="text-xs">CPU Alert (%)</Label><Input type="number" value={data.cpu_threshold || 85} onChange={e => u("cpu_threshold", parseInt(e.target.value) || 85)} className="mt-1" /></div>
            <div><Label className="text-xs">Memory Alert (%)</Label><Input type="number" value={data.memory_threshold || 90} onChange={e => u("memory_threshold", parseInt(e.target.value) || 90)} className="mt-1" /></div>
            <div><Label className="text-xs">Disk Alert (%)</Label><Input type="number" value={data.disk_threshold || 80} onChange={e => u("disk_threshold", parseInt(e.target.value) || 80)} className="mt-1" /></div>
            <div><Label className="text-xs">Uptime Check (min)</Label><Input type="number" value={data.uptime_check_interval || 5} onChange={e => u("uptime_check_interval", parseInt(e.target.value) || 5)} className="mt-1" /></div>
          </div>
        </CardContent>
      </Card>
      <Card className="border-border/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Wrench className="w-4 h-4 text-amber-400" />Automation Rules</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {[
            { key: "auto_ticket_critical", label: "Auto-create tickets for critical alerts" },
            { key: "auto_restart_services", label: "Auto-restart failed Windows services" },
            { key: "auto_clear_temp", label: "Auto-clear temp files when disk > 90%" },
            { key: "predictive_maintenance", label: "Enable predictive maintenance alerts" },
            { key: "patch_auto_approve", label: "Auto-approve critical security patches" },
          ].map(rule => (
            <label key={rule.key} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 cursor-pointer">
              <Checkbox checked={data[rule.key] !== false} onCheckedChange={v => u(rule.key, v)} />
              <span className="text-sm">{rule.label}</span>
            </label>
          ))}
        </CardContent>
      </Card>
      <Card className="border-border/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Bell className="w-4 h-4 text-purple-400" />Notification Channels</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {[
            { key: "notify_email", label: "Email notifications" },
            { key: "notify_sms", label: "SMS for critical alerts" },
            { key: "notify_slack", label: "Slack channel integration" },
            { key: "notify_teams", label: "Microsoft Teams webhook" },
          ].map(ch => (
            <label key={ch.key} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 cursor-pointer">
              <Checkbox checked={data[ch.key] || false} onCheckedChange={v => u(ch.key, v)} />
              <span className="text-sm">{ch.label}</span>
            </label>
          ))}
        </CardContent>
      </Card>
      <div>
        <Label>Maintenance Window</Label>
        <div className="grid grid-cols-3 gap-3 mt-1">
          <div>
            <Label className="text-xs">Day</Label>
            <Select value={data.maintenance_day || "sunday"} onValueChange={v => u("maintenance_day", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(d => <SelectItem key={d} value={d.toLowerCase()}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Start Time</Label><Input value={data.maintenance_start || "02:00"} onChange={e => u("maintenance_start", e.target.value)} placeholder="02:00" className="mt-1" /></div>
          <div><Label className="text-xs">Duration (hours)</Label><Input type="number" value={data.maintenance_duration || 4} onChange={e => u("maintenance_duration", parseInt(e.target.value) || 4)} className="mt-1" /></div>
        </div>
      </div>
    </div>
  );
}

function DocumentationForm({ data, onChange }) {
  const u = (field, val) => onChange({ ...data, [field]: val });
  const docs = [
    { key: "network_diagram", label: "Network diagram created", category: "Infrastructure" },
    { key: "password_vault", label: "Credentials documented in Keeper or Hudu", category: "Security" },
    { key: "dns_records", label: "DNS records documented", category: "Infrastructure" },
    { key: "vendor_contacts", label: "Vendor/ISP contacts documented", category: "Vendors" },
    { key: "disaster_recovery", label: "Disaster recovery plan drafted", category: "DR/BC" },
    { key: "escalation_matrix", label: "Escalation matrix defined", category: "Process" },
    { key: "runbooks_assigned", label: "Standard runbooks assigned", category: "Process" },
    { key: "kb_articles", label: "Client-specific KB articles created", category: "Knowledge" },
    { key: "license_inventory", label: "Software license inventory completed", category: "Licensing" },
    { key: "asset_register", label: "Hardware asset register compiled", category: "Assets" },
  ];
  return (
    <div className="space-y-4" data-testid="step-documentation">
      <p className="text-sm text-muted-foreground">Track documentation tasks for a thorough handover.</p>
      <div className="grid grid-cols-1 gap-2">
        {docs.map(doc => (
          <label key={doc.key} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${data[doc.key] ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/40 hover:bg-muted/30"}`}>
            <Checkbox checked={data[doc.key] || false} onCheckedChange={v => u(doc.key, v)} />
            <div className="flex items-center gap-2 flex-1">
              <span className="text-sm">{doc.label}</span>
              <Badge variant="outline" className="text-[9px] ml-auto">{doc.category}</Badge>
            </div>
            {data[doc.key] && <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
          </label>
        ))}
      </div>
      <Separator />
      <div>
        <Label>Additional Documentation Notes</Label>
        <Textarea value={data.doc_notes || ""} onChange={e => u("doc_notes", e.target.value)} placeholder="Any additional documentation tasks or notes..." rows={3} className="mt-1" />
      </div>
    </div>
  );
}

// ─── Go Live (Preflight) ───────────────────────────────────────────────────────
function OnboardingTicketPlanForm({ session, onPlanCreated }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = { Authorization: "Bearer " + token };
  const [blueprints, setBlueprints] = useState([]);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState("");
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    let current = true;
    axios.get(API + "/blueprints?active_only=true", { headers })
      .then((res) => { if (current) setBlueprints(res.data || []); })
      .catch(() => { if (current) toast.error("Could not load delivery blueprints"); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [token]);

  const selectedBlueprint = blueprints.find((blueprint) => blueprint.id === selectedBlueprintId);
  const childTemplates = selectedBlueprint?.child_templates || [];
  const discoveredDevices = session?.steps?.asset_discovery?.data?.devices?.filter((device) => device.hostname) || [];
  const projectedChildCount = childTemplates.reduce((total, child) => total + (child.per_device ? Math.max(discoveredDevices.length, 1) : 1), 0);
  const plans = session?.ticket_plans || [];

  const launchPlan = async () => {
    if (!selectedBlueprintId) { toast.error("Select a delivery blueprint first"); return; }
    setLaunching(true);
    try {
      const response = await axios.post(API + "/onboarding-enhanced/sessions/" + session.id + "/ticket-plan", { blueprint_id: selectedBlueprintId }, { headers });
      const plan = response.data?.plan;
      onPlanCreated?.(response.data?.session || session);
      toast.success(response.data?.idempotent
        ? ((plan?.parent_ticket_number || "This plan") + " is already linked to this onboarding")
        : ("Created " + (plan?.parent_ticket_number || "parent ticket") + " with " + (plan?.child_ticket_count || 0) + " linked child ticket(s)"));
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not create the ticket plan");
    } finally { setLaunching(false); }
  };

  return (
    <section className="rounded-xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.10),transparent_45%),rgba(8,20,28,0.45)] p-4" data-testid="onboarding-ticket-plan">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/[0.10]"><Ticket className="h-4 w-4 text-cyan-200" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Service delivery plan</p><h3 className="mt-1 text-base font-semibold">Create the parent ticket and linked work</h3><p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">Use a delivery blueprint to open one accountable parent record and create child tickets for client setup, per-device enrolment, monitoring, and handover. Every relationship is retained on the client and ticket audit trail.</p></div></div>
        <Button type="button" variant="outline" size="sm" className="border-cyan-400/25 text-cyan-100 hover:bg-cyan-400/10" onClick={() => navigate("/blueprints")}>Manage blueprints</Button>
      </div>

      {plans.length > 0 && <div className="mt-4 space-y-2">{plans.map((plan) => <div key={plan.id} className="flex flex-col gap-2 rounded-xl border border-emerald-400/18 bg-emerald-400/[0.045] p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold text-emerald-100">{plan.blueprint_name}</p><p className="mt-1 text-[11px] text-muted-foreground"><span className="font-mono text-emerald-200">{plan.parent_ticket_number}</span> · {plan.child_ticket_count || 0} linked child ticket{plan.child_ticket_count === 1 ? "" : "s"} · Created {plan.created_at?.slice(0, 10)}</p></div><Button type="button" variant="outline" size="sm" className="border-emerald-400/25 text-emerald-100 hover:bg-emerald-400/10" onClick={() => navigate("/tickets?ticket=" + encodeURIComponent(plan.parent_ticket_id))}>Open parent ticket</Button></div>)}</div>}

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div><Label className="text-sm font-semibold text-zinc-100">Delivery blueprint</Label><p className="mt-1 text-xs text-muted-foreground">Blueprints with child work create a full parent-and-child delivery plan. A normal blueprint remains available for a single parent ticket.</p><Select value={selectedBlueprintId || "__none"} onValueChange={(value) => setSelectedBlueprintId(value === "__none" ? "" : value)} disabled={loading || !session?.client_id}><SelectTrigger className="mt-2 border-white/10 bg-black/15"><SelectValue placeholder={loading ? "Loading blueprints…" : "Select a delivery blueprint…"} /></SelectTrigger><SelectContent><SelectItem value="__none">Select a blueprint…</SelectItem>{blueprints.map((blueprint) => <SelectItem key={blueprint.id} value={blueprint.id}>{blueprint.name}{blueprint.child_templates?.length ? (" · " + blueprint.child_templates.length + " child task" + (blueprint.child_templates.length === 1 ? "" : "s")) : ""}</SelectItem>)}</SelectContent></Select></div>
        <Button type="button" className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={launchPlan} disabled={launching || !selectedBlueprintId || !session?.client_id} data-testid="launch-onboarding-ticket-plan">{launching ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Rocket className="mr-1.5 h-4 w-4" />}{selectedBlueprint?.child_templates?.length ? ("Create parent + " + projectedChildCount + " child ticket" + (projectedChildCount === 1 ? "" : "s")) : "Create parent ticket"}</Button>
      </div>

      {selectedBlueprint && <div className="mt-3 rounded-lg border border-white/[0.08] bg-black/[0.12] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold text-zinc-100">{selectedBlueprint.name}</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{selectedBlueprint.description || "No delivery brief has been recorded."}</p></div><Badge variant="outline" className="border-cyan-400/25 bg-cyan-400/[0.06] text-cyan-100">{childTemplates.length ? (projectedChildCount + " child ticket" + (projectedChildCount === 1 ? "" : "s")) : "Parent only"}</Badge></div>{childTemplates.length > 0 && <div className="mt-3 grid gap-1.5">{childTemplates.map((child) => <div key={child.id || child.title} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-xs"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-cyan-200" /><span className="min-w-0 flex-1 truncate">{child.title}</span>{child.per_device && <Badge variant="outline" className="border-violet-400/25 text-[9px] text-violet-200">per device</Badge>}{child.blueprint_id && <Badge variant="outline" className="border-amber-400/25 text-[9px] text-amber-200">worksheet</Badge>}</div>)}</div>}</div>}
      {!session?.client_id && <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-2.5 text-xs text-amber-100">Complete and save the Company Profile first so the plan has a client account to attach to.</p>}
    </section>
  );
}

function GoLiveForm({ session, preflight, onPreflightChange, firstTicket, onFirstTicketChange, onPlanCreated }) {
  const steps = session?.steps || {};
  const completedSteps = Object.values(steps).filter(s => s.status === "completed").length;
  const totalSteps = Object.keys(steps).length;

  const PREFLIGHT_ITEMS = [
    { id: "pf-01", task: "Primary contact verified and has portal access", category: "access", critical: true },
    { id: "pf-02", task: "All devices enrolled and reporting to RMM agent", category: "devices", critical: true },
    { id: "pf-03", task: "Backup solution configured and first backup completed", category: "backup", critical: true },
    { id: "pf-04", task: "Security baseline assessment passed", category: "security", critical: true },
    { id: "pf-05", task: "Monitoring alerts tested (CPU/RAM/Disk thresholds)", category: "monitoring", critical: true },
    { id: "pf-06", task: "Contract signed and billing configured", category: "billing", critical: true },
    { id: "pf-07", task: "Network documentation completed", category: "documentation", critical: false },
    { id: "pf-08", task: "Emergency contact list distributed", category: "access", critical: false },
    { id: "pf-09", task: "End-user training session scheduled", category: "training", critical: false },
    { id: "pf-10", task: "Welcome packet sent to client", category: "communication", critical: false },
    { id: "pf-11", task: "MFA enforced on all admin accounts", category: "security", critical: true },
    { id: "pf-12", task: "Patch management policy applied", category: "patching", critical: false },
    { id: "pf-13", task: "DNS/domain credentials documented", category: "documentation", critical: false },
    { id: "pf-14", task: "Vendor access credentials documented in Keeper or Hudu", category: "security", critical: false },
  ];

  const criticalDone = PREFLIGHT_ITEMS.filter(i => i.critical).every(i => preflight[i.id]);
  const pfDoneCount = PREFLIGHT_ITEMS.filter(i => preflight[i.id]).length;
  const workflowReady = STEP_KEYS.slice(0, -1).every(key => ["completed", "skipped"].includes(steps[key]?.status)) && Boolean(session?.client_id);
  const readyToLaunch = criticalDone && workflowReady;

  return (
    <div className="space-y-5" data-testid="step-go-live">
      {/* Summary Banner */}
      <div className={`p-4 rounded-xl border ${readyToLaunch ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
        <div className="flex items-center gap-3">
          {readyToLaunch ? <CheckCircle2 className="w-6 h-6 text-emerald-400" /> : <AlertTriangle className="w-6 h-6 text-amber-400" />}
          <div>
            <p className="font-semibold">{readyToLaunch ? "Ready to Launch" : "Go-live checks incomplete"}</p>
            <p className="text-xs text-muted-foreground">
              {completedSteps}/{totalSteps} wizard steps complete | {pfDoneCount}/{PREFLIGHT_ITEMS.length} preflight items checked
              {!workflowReady && " | Complete or explicitly skip each prior step"}
              {!criticalDone && " | Complete all critical items to launch"}
            </p>
          </div>
        </div>
      </div>

      {/* Step Summary */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Wizard Steps Summary</p>
        <div className="grid grid-cols-4 gap-2">
          {STEP_KEYS.slice(0, -1).map(key => {
            const st = steps[key]?.status;
            const Icon = STEP_ICONS[key] || Circle;
            return (
              <div key={key} className={`p-2.5 rounded-lg border text-center transition-all ${st === "completed" ? "border-emerald-500/30 bg-emerald-500/5" : st === "skipped" ? "border-amber-500/30 bg-amber-500/5" : "border-border/30 opacity-60"}`}>
                <Icon className={`w-4 h-4 mx-auto mb-1 ${st === "completed" ? "text-emerald-400" : st === "skipped" ? "text-amber-400" : "text-muted-foreground"}`} />
                <p className="text-[10px] font-bold">{STEP_LABELS[key]}</p>
                <Badge className={`text-[9px] mt-1 ${st === "completed" ? "bg-emerald-500/20 text-emerald-400" : st === "skipped" ? "bg-amber-500/20 text-amber-400" : "bg-muted text-muted-foreground"}`}>
                  {st || "pending"}
                </Badge>
              </div>
            );
          })}
        </div>
      </div>

      {/* Preflight Checklist */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Preflight Checklist</p>
        <div className="grid grid-cols-1 gap-1.5">
          {PREFLIGHT_ITEMS.map(item => (
            <label key={item.id} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${preflight[item.id] ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/40 hover:bg-muted/30"}`}>
              <Checkbox checked={preflight[item.id] || false} onCheckedChange={v => onPreflightChange({ ...preflight, [item.id]: v })} />
              <span className="text-sm flex-1">{item.task}</span>
              {item.critical && <Badge variant="outline" className="text-[9px] border-red-500/30 text-red-400">Critical</Badge>}
              <Badge variant="outline" className="text-[9px]">{item.category}</Badge>
            </label>
          ))}
        </div>
      </div>

      <Separator />

      <OnboardingTicketPlanForm session={session} onPlanCreated={onPlanCreated} />

      <Separator />

      {/* First Ticket */}
      <div>
        <label className="flex items-center gap-3 mb-3 cursor-pointer">
          <Checkbox checked={firstTicket.create || false} onCheckedChange={v => onFirstTicketChange({ ...firstTicket, create: v })} />
          <div>
            <p className="font-semibold text-sm">Create a one-off follow-up</p>
            <p className="text-xs text-muted-foreground">Use this only for an extra single task. For setup work with child tickets, use the delivery plan above.</p>
          </div>
        </label>
        {firstTicket.create && (
          <div className="grid grid-cols-2 gap-3 pl-8">
            <div>
              <Label className="text-xs">Subject</Label>
              <Input value={firstTicket.subject || ""} onChange={e => onFirstTicketChange({ ...firstTicket, subject: e.target.value })} placeholder="Welcome - Initial Setup & Configuration" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select value={firstTicket.priority || "low"} onValueChange={v => onFirstTicketChange({ ...firstTicket, priority: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Description</Label>
              <Textarea value={firstTicket.description || ""} onChange={e => onFirstTicketChange({ ...firstTicket, description: e.target.value })} placeholder="Describe initial setup tasks..." rows={3} className="mt-1" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Wizard View ───────────────────────────────────────────────────────────────
function WizardView({ session: initialSession, onBack, onRefresh }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = { Authorization: `Bearer ${token}` };
  const [session, setSession] = useState(initialSession);
  const [stepData, setStepData] = useState({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [preflight, setPreflight] = useState(initialSession?.preflight || {});
  const [firstTicket, setFirstTicket] = useState({ create: false, subject: "", description: "", priority: "low" });
  const [showAudit, setShowAudit] = useState(false);
  const [activeTab, setActiveTab] = useState("form");

  const currentStepIdx = Math.max(0, (session?.current_step || 1) - 1);
  const currentKey = STEP_KEYS[currentStepIdx];
  const totalSteps = STEP_KEYS.length;

  // Load step data when switching steps
  useEffect(() => {
    if (session?.steps?.[currentKey]) {
      const existing = session.steps[currentKey].data || {};
      setStepData(existing);
      setNotes(session.steps[currentKey].notes || "");
    }
  }, [currentStepIdx, session?.id]);

  const refreshSession = async () => {
    try {
      const res = await axios.get(`${API}/onboarding-enhanced/sessions/${session.id}`, { headers });
      setSession(res.data);
      setPreflight(res.data.preflight || {});
    } catch { /* ignore */ }
  };

  const navigateStep = (stepNum) => {
    setSession(prev => ({ ...prev, current_step: stepNum }));
    const key = STEP_KEYS[stepNum - 1];
    if (session?.steps?.[key]) {
      setStepData(session.steps[key].data || {});
      setNotes(session.steps[key].notes || "");
    } else {
      setStepData({});
      setNotes("");
    }
    setActiveTab("form");
  };

  const saveStep = async (action = "save") => {
    setSaving(true);
    try {
      const res = await axios.put(`${API}/onboarding-enhanced/sessions/${session.id}/step/${currentKey}`, {
        step_data: stepData,
        notes,
        action,
      }, { headers });
      setSession(res.data);
      setPreflight(res.data.preflight || {});
      if (action === "complete") {
        toast.success(`${STEP_LABELS[currentKey]} completed!`);
        // Auto-navigate to next step
        if (currentStepIdx + 1 < totalSteps) {
          const nextKey = STEP_KEYS[currentStepIdx + 1];
          setStepData(res.data.steps?.[nextKey]?.data || {});
          setNotes(res.data.steps?.[nextKey]?.notes || "");
        }
      } else if (action === "skip") {
        toast.info(`${STEP_LABELS[currentKey]} skipped`);
        if (currentStepIdx + 1 < totalSteps) {
          const nextKey = STEP_KEYS[currentStepIdx + 1];
          setStepData(res.data.steps?.[nextKey]?.data || {});
          setNotes(res.data.steps?.[nextKey]?.notes || "");
        }
      } else {
        toast.success("Progress saved");
      }
      onRefresh();
    } catch (err) {
      toast.error("Failed to save step");
    }
    setSaving(false);
  };

  const savePreflight = async (pf) => {
    setPreflight(pf);
    try {
      await axios.put(`${API}/onboarding-enhanced/sessions/${session.id}/preflight`, { preflight: pf }, { headers });
    } catch { /* ignore */ }
  };

  const completeOnboarding = async () => {
    setSaving(true);
    try {
      const payload = {};
      if (firstTicket.create && firstTicket.subject) {
        payload.first_ticket = firstTicket;
      }
      const res = await axios.put(`${API}/onboarding-enhanced/sessions/${session.id}/complete`, payload, { headers });
      setSession(res.data);
      toast.success("Client onboarding completed successfully!");
      onRefresh();
    } catch (error) {
      const blockers = error?.response?.data?.detail?.blockers || [];
      const message = blockers[0]?.message || error?.response?.data?.detail?.message || error?.response?.data?.detail || "Failed to complete onboarding";
      toast.error(message);
    }
    setSaving(false);
  };

  const togglePause = async () => {
    try {
      const res = await axios.put(`${API}/onboarding-enhanced/sessions/${session.id}/pause`, {}, { headers });
      setSession(res.data);
      toast.success(res.data.status === "paused" ? "Session paused" : "Session resumed");
      onRefresh();
    } catch { toast.error("Failed to toggle pause"); }
  };

  if (session?.status === "completed") {
    return (
      <div className="max-w-3xl mx-auto space-y-6" data-testid="onboarding-completed">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="wizard-back-btn"><ArrowLeft className="w-4 h-4 mr-2" />All Sessions</Button>
        <div className="text-center py-10">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Onboarding Complete!</h2>
          <p className="text-muted-foreground mb-1">{session.client_name} has been successfully onboarded.</p>
          <p className="text-xs text-muted-foreground">Session {session.id} | Completed {session.completed_at?.slice(0, 10)} by {session.completed_by}</p>
          {session.first_ticket_id && (
            <Button variant="outline" size="sm" className="mt-3 border-blue-500/30 text-blue-300 hover:bg-blue-500/10" onClick={() => navigate(`/tickets?ticket=${encodeURIComponent(session.first_ticket_id)}`)} data-testid="open-first-onboarding-ticket">
              <Ticket className="mr-1.5 h-3.5 w-3.5" />Open first ticket: {session.first_ticket_id}
            </Button>
          )}
          {session.ticket_plans?.length > 0 && (
            <div className="mx-auto mt-4 max-w-xl space-y-2 text-left">
              {session.ticket_plans.map((plan) => (
                <button key={plan.id} type="button" onClick={() => navigate("/tickets?ticket=" + encodeURIComponent(plan.parent_ticket_id))} className="flex w-full items-center justify-between rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2.5 text-left transition hover:bg-emerald-500/[0.10]">
                  <span><span className="block text-xs font-semibold text-emerald-100">{plan.blueprint_name}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{plan.parent_ticket_number} · {plan.child_ticket_count || 0} linked child ticket{plan.child_ticket_count === 1 ? "" : "s"}</span></span>
                  <ArrowRight className="h-4 w-4 text-emerald-200" />
                </button>
              ))}
            </div>
          )}
        </div>
        <Card className="border-border/40">
          <CardHeader><CardTitle className="text-sm">Onboarding Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2">
              {STEP_KEYS.map(key => {
                const st = session.steps?.[key]?.status;
                const Icon = STEP_ICONS[key] || Circle;
                return (
                  <div key={key} className={`p-2 rounded-lg border text-center ${st === "completed" ? "border-emerald-500/30" : "border-amber-500/30"}`}>
                    <Icon className={`w-4 h-4 mx-auto mb-1 ${st === "completed" ? "text-emerald-400" : "text-amber-400"}`} />
                    <p className="text-[10px] font-bold">{STEP_LABELS[key]}</p>
                    <Badge className={`text-[9px] ${st === "completed" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>{st}</Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stepStatus = session?.steps?.[currentKey]?.status;
  const isLastStep = currentStepIdx === totalSteps - 1;
  const progress = Math.round((Object.values(session?.steps || {}).filter(s => s.status === "completed").length / totalSteps) * 100);
  const incompleteWorkflowSteps = STEP_KEYS.slice(0, -1).filter((key) => !["completed", "skipped"].includes(session?.steps?.[key]?.status));
  const missingCriticalPreflight = CRITICAL_PREFLIGHT_IDS.filter((id) => !preflight[id]);
  const canCompleteOnboarding = Boolean(session?.client_id) && incompleteWorkflowSteps.length === 0 && missingCriticalPreflight.length === 0;
  const completionBlocker = !session?.client_id
    ? "Complete the Company Profile to create the client account."
    : incompleteWorkflowSteps.length
      ? `${incompleteWorkflowSteps.length} earlier step${incompleteWorkflowSteps.length === 1 ? "" : "s"} still need completion or a recorded skip.`
      : missingCriticalPreflight.length
        ? `${missingCriticalPreflight.length} critical preflight check${missingCriticalPreflight.length === 1 ? "" : "s"} remain.`
        : "";

  const renderStepForm = () => {
    switch (currentKey) {
      case "company_profile": return <CompanyProfileForm data={stepData} onChange={setStepData} />;
      case "contacts_access": return <ContactsAccessForm data={stepData} onChange={setStepData} />;
      case "asset_discovery": return <AssetDiscoveryForm data={stepData} onChange={setStepData} />;
      case "contracts_billing": return <ContractsBillingForm data={stepData} onChange={setStepData} />;
      case "security_compliance": return <SecurityComplianceForm data={stepData} onChange={setStepData} />;
      case "monitoring_automation": return <MonitoringAutomationForm data={stepData} onChange={setStepData} />;
      case "documentation": return <DocumentationForm data={stepData} onChange={setStepData} />;
      case "go_live": return <GoLiveForm session={session} preflight={preflight} onPreflightChange={savePreflight} firstTicket={firstTicket} onFirstTicketChange={setFirstTicket} onPlanCreated={setSession} />;
      default: return <p className="text-muted-foreground">Unknown step</p>;
    }
  };

  const CurrentStepIcon = STEP_ICONS[currentKey] || Circle;
  const currentStepState = stepStatus === "completed" ? "Completed" : stepStatus === "skipped" ? "Skipped" : "In progress";
  const readinessLabel = canCompleteOnboarding ? "Ready to launch" : `${Math.max(0, totalSteps - Math.round((progress / 100) * totalSteps))} workflow items remaining`;

  return (
    <div className="mx-auto max-w-[1440px] space-y-5" data-testid="onboarding-wizard">
      <section className="relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-[radial-gradient(circle_at_100%_0%,rgba(34,211,238,0.17),transparent_34%),radial-gradient(circle_at_0%_100%,rgba(16,185,129,0.13),transparent_42%),linear-gradient(135deg,rgba(8,25,35,0.98),rgba(12,17,25,0.98))] px-5 py-5 sm:px-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" className="-ml-2 h-7 px-2 text-cyan-100 hover:bg-cyan-400/10" onClick={onBack} data-testid="wizard-back-btn"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />All onboardings</Button>
              <span className="hidden h-4 w-px bg-cyan-100/15 sm:block" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Client onboarding service record</p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10"><Rocket className="h-5 w-5 text-emerald-300" /></span><h1 className="text-2xl font-bold tracking-tight text-zinc-50">{session?.client_name || "New Client"}</h1><Badge variant="outline" className="border-cyan-400/25 bg-cyan-400/[0.07] text-[10px] text-cyan-100">{session?.template_name || "Standard onboarding"}</Badge></div>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">A controlled, audit-ready handover from client setup through go-live. Each saved step is retained with its notes, owner, and completion state.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="border-white/10 bg-white/[0.035] text-zinc-100 hover:bg-white/[0.08]" onClick={togglePause} data-testid="pause-btn">
              {session?.status === "paused" ? <Play className="mr-1.5 h-3.5 w-3.5" /> : <Pause className="mr-1.5 h-3.5 w-3.5" />}
              {session?.status === "paused" ? "Resume record" : "Pause record"}
            </Button>
            <Button variant="outline" size="sm" className="border-white/10 bg-white/[0.035] text-zinc-100 hover:bg-white/[0.08]" onClick={() => setShowAudit(true)}>
              <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />View audit trail
            </Button>
          </div>
        </div>
        <div className="relative mt-5 grid gap-3 border-t border-cyan-100/10 pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div><div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-300"><span>Workflow progress · Step {currentStepIdx + 1} of {totalSteps}</span><span className="font-semibold text-cyan-200">{progress}% complete</span></div><Progress value={progress} className="h-2 bg-white/10" /></div>
          <div className={`rounded-lg border px-3 py-2 text-xs ${canCompleteOnboarding ? "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-100" : "border-amber-400/20 bg-amber-400/[0.07] text-amber-100"}`}><span className="font-semibold">{readinessLabel}</span><p className="mt-0.5 text-[10px] opacity-80">Health score {session?.health_score || 0}%</p></div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[250px_minmax(0,1fr)_268px]">
        <aside className="rounded-2xl border border-border/55 bg-card/60 p-3 shadow-sm xl:sticky xl:top-4 xl:h-fit">
          <div className="mb-3 border-b border-border/50 px-2 pb-3"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Workflow</p><p className="mt-1 text-sm font-semibold">Onboarding sections</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose a section to continue the controlled handover.</p></div>
          <nav className="space-y-1" aria-label="Onboarding workflow">
            {STEP_KEYS.map((key, i) => {
              const st = session?.steps?.[key]?.status;
              const Icon = STEP_ICONS[key] || Circle;
              const isActive = i === currentStepIdx;
              const stateClass = isActive ? "border-cyan-400/30 bg-cyan-400/[0.09] shadow-[0_0_0_1px_rgba(34,211,238,0.07)]" : st === "completed" ? "border-emerald-400/15 bg-emerald-400/[0.035] hover:bg-emerald-400/[0.07]" : st === "skipped" ? "border-amber-400/15 bg-amber-400/[0.035] hover:bg-amber-400/[0.07]" : "border-transparent hover:border-border/55 hover:bg-muted/35";
              const iconClass = isActive ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200" : st === "completed" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : st === "skipped" ? "border-amber-400/25 bg-amber-400/10 text-amber-300" : "border-border/50 bg-muted/45 text-muted-foreground";
              return <button key={key} type="button" onClick={() => navigateStep(i + 1)} className={`flex w-full items-center gap-3 rounded-xl border px-2.5 py-2.5 text-left transition-all ${stateClass}`} data-testid={`step-nav-${key}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${iconClass}`}>{st === "completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{STEP_LABELS[key]}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{st === "completed" ? "Completed" : st === "skipped" ? "Recorded skip" : isActive ? "Currently editing" : `Step ${i + 1}`}</span></span>{isActive && <ChevronRight className="h-3.5 w-3.5 text-cyan-200" />}</button>;
            })}
          </nav>
        </aside>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-cyan-400/18 bg-[linear-gradient(145deg,rgba(10,23,31,0.96),rgba(15,18,25,0.98))] shadow-xl shadow-black/10">
          <header className="border-b border-cyan-100/10 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.13),transparent_46%),linear-gradient(135deg,rgba(16,185,129,0.07),transparent)] px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/[0.08]"><CurrentStepIcon className="h-5 w-5 text-cyan-200" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Service record · {String(currentStepIdx + 1).padStart(2, "0")} / {String(totalSteps).padStart(2, "0")}</p><h2 className="mt-1 text-xl font-bold tracking-tight text-zinc-50">{STEP_LABELS[currentKey]}</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-300">{STEP_DESCRIPTIONS[currentKey]}</p></div></div><Badge variant="outline" className={stepStatus === "completed" ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200" : stepStatus === "skipped" ? "border-amber-400/25 bg-amber-400/[0.08] text-amber-200" : "border-cyan-400/25 bg-cyan-400/[0.08] text-cyan-100"}>{currentStepState}</Badge></div>
          </header>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-[520px] flex-col">
            <div className="border-b border-white/[0.07] bg-black/10 px-5 pt-3 sm:px-6"><TabsList className="h-auto rounded-lg border border-white/[0.08] bg-white/[0.035] p-1"><TabsTrigger value="form" className="gap-1.5 data-[state=active]:bg-cyan-400/10 data-[state=active]:text-cyan-100"><FileText className="h-3.5 w-3.5" />Service details</TabsTrigger><TabsTrigger value="notes" className="gap-1.5 data-[state=active]:bg-cyan-400/10 data-[state=active]:text-cyan-100"><MessageSquare className="h-3.5 w-3.5" />Internal handover notes</TabsTrigger></TabsList></div>
            <TabsContent value="form" className="m-0 flex-1 px-5 py-5 sm:px-6 sm:py-6"><div className="mx-auto max-w-4xl">{renderStepForm()}</div></TabsContent>
            <TabsContent value="notes" className="m-0 flex-1 px-5 py-5 sm:px-6 sm:py-6"><div className="mx-auto max-w-4xl space-y-3"><div className="rounded-xl border border-amber-400/18 bg-amber-400/[0.045] px-3 py-2.5 text-xs leading-relaxed text-amber-100"><span className="font-semibold">Internal record only.</span> These notes are retained in the onboarding audit history and are not sent to the client.</div><div><Label className="text-sm font-semibold text-zinc-100">Handover notes for {STEP_LABELS[currentKey]}</Label><p className="mt-1 text-xs text-muted-foreground">Capture decisions, exceptions, approvals, access constraints, and work still owned by the team.</p><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Record the outcome, approvals, dependencies, or follow-up owner for this step…" rows={12} className="mt-3 border-white/10 bg-white/[0.035] leading-relaxed" /></div></div></TabsContent>
          </Tabs>
          <footer className="flex flex-col gap-3 border-t border-white/[0.07] bg-black/15 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="text-xs text-muted-foreground">{session?.status === "paused" ? "This record is paused. Resume it before recording a change." : "Every save records the current step data and internal notes in the onboarding history."}</div><div className="flex flex-wrap gap-2">{!isLastStep ? <><Button variant="ghost" size="sm" onClick={() => saveStep("skip")} disabled={saving || session?.status === "paused"}>Record skip</Button><Button variant="outline" size="sm" className="border-white/10 bg-white/[0.035]" onClick={() => saveStep("save")} disabled={saving || session?.status === "paused"}>{saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Save draft</Button><Button size="sm" className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={() => saveStep("complete")} disabled={saving || session?.status === "paused"} data-testid="complete-step-btn">{saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}Complete & continue</Button></> : <><Button variant="outline" size="sm" className="border-white/10 bg-white/[0.035]" onClick={() => saveStep("save")} disabled={saving || session?.status === "paused"}>Save final checks</Button><Button size="sm" className="bg-gradient-to-r from-emerald-500 to-cyan-400 text-emerald-950 hover:from-emerald-400 hover:to-cyan-300" onClick={completeOnboarding} disabled={saving || session?.status === "paused" || !canCompleteOnboarding} data-testid="complete-onboarding-btn">{saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1.5 h-3.5 w-3.5" />}Complete onboarding</Button></>}</div></footer>
        </section>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:h-fit">
          <section className={`rounded-2xl border p-4 shadow-sm ${canCompleteOnboarding ? "border-emerald-400/20 bg-emerald-400/[0.045]" : "border-amber-400/20 bg-amber-400/[0.045]"}`}><div className="flex items-start gap-2.5"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${canCompleteOnboarding ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-400/15 text-amber-200"}`}>{canCompleteOnboarding ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}</span><div><p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">Readiness control</p><p className="mt-1 text-sm font-semibold">{canCompleteOnboarding ? "Launch controls satisfied" : "Go-live evidence pending"}</p></div></div><p className="mt-3 text-xs leading-relaxed text-muted-foreground">{canCompleteOnboarding ? "The controlled workflow, client record, and mandatory preflight checks are ready for final approval." : completionBlocker || "Continue recording the remaining controls before final approval."}</p>{!canCompleteOnboarding && isLastStep && <p className="mt-3 rounded-lg border border-amber-400/15 bg-black/10 p-2 text-[11px] leading-relaxed text-amber-100">The final approval button remains unavailable until these conditions are recorded.</p>}</section>
          <section className="rounded-2xl border border-border/55 bg-card/60 p-4 shadow-sm"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Record details</p><dl className="mt-3 space-y-2.5 text-xs"><div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Session</dt><dd className="max-w-[145px] truncate font-mono text-[10px]">{session?.id}</dd></div><div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Priority</dt><dd><Badge variant="outline" className="text-[9px] capitalize">{session?.priority || "normal"}</Badge></dd></div><div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Opened</dt><dd>{session?.created_at?.slice(0, 10) || "—"}</dd></div><div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Owner</dt><dd className="max-w-[145px] truncate">{session?.created_by || "—"}</dd></div><Separator /><div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Estimated delivery</dt><dd>{session?.estimated_days || "—"} days</dd></div></dl></section>
          <section className="rounded-2xl border border-border/55 bg-card/60 p-3 shadow-sm"><Button variant="outline" size="sm" className="w-full justify-start" onClick={() => navigateStep(Math.max(1, currentStepIdx))} disabled={currentStepIdx === 0}><ArrowLeft className="mr-2 h-3.5 w-3.5" />Previous section</Button><Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={() => navigateStep(Math.min(totalSteps, currentStepIdx + 2))} disabled={currentStepIdx >= totalSteps - 1}>Next section<ArrowRight className="ml-auto h-3.5 w-3.5" /></Button></section>
        </aside>
      </div>

      {/* Audit Log Dialog */}
      <Dialog open={showAudit} onOpenChange={setShowAudit}>
        <DialogContent className="max-w-lg" aria-describedby="audit-log-desc">
          <DialogHeader>
            <DialogTitle>Audit Log</DialogTitle>
            <DialogDescription id="audit-log-desc">Activity history for this onboarding session</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-auto space-y-2">
            {(session?.audit_log || []).slice().reverse().map((entry, i) => (
              <div key={`k-${i}`} className="flex items-start gap-3 p-2 rounded-lg bg-muted/30 text-sm">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">{entry.action?.replace(/_/g, " ")}</p>
                  <p className="text-xs text-muted-foreground">{entry.by} | {entry.at?.slice(0, 16).replace("T", " ")}</p>
                  {entry.detail && <p className="text-xs text-muted-foreground">{entry.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function OnboardingWizardPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [sessions, setSessions] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeSession, setActiveSession] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/onboarding-enhanced/sessions`, { headers });
      setSessions(res.data.sessions || []);
      setStats(res.data.stats || {});
    } catch { toast.error("Failed to fetch sessions"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const loadSession = async (id) => {
    try {
      const res = await axios.get(`${API}/onboarding-enhanced/sessions/${id}`, { headers });
      setActiveSession(res.data);
    } catch { toast.error("Failed to load session"); }
  };

  const createSession = async (data) => {
    try {
      const res = await axios.post(`${API}/onboarding-enhanced/sessions`, data, { headers });
      setActiveSession(res.data);
      setShowNew(false);
      fetchSessions();
      toast.success("Onboarding session created!");
    } catch { toast.error("Failed to create session"); }
  };

  if (activeSession) {
    return (
      <WizardView
        session={activeSession}
        onBack={() => { setActiveSession(null); fetchSessions(); }}
        onRefresh={fetchSessions}
      />
    );
  }

  return (
    <>
      <SessionListView
        sessions={sessions}
        stats={stats}
        loading={loading}
        onSelect={loadSession}
        onNew={() => setShowNew(true)}
      />
      <TemplateDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreate={createSession}
      />
    </>
  );
}
