import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Activity, ArrowUpRight, Building2, Check, ChevronRight, CircleDollarSign, CloudCog, HeartPulse, Monitor, Plus, Search, ShieldCheck, Users, UserRoundPlus } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const TIER_COLORS = { enterprise: "bg-violet-500/15 text-violet-700 dark:text-violet-300", professional: "bg-sky-500/15 text-sky-700 dark:text-sky-300", standard: "bg-muted text-muted-foreground" };
const CORE_STATUS = {
  online: { label: "Core verified", className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  activated: { label: "Awaiting heartbeat", className: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  prepared: { label: "Ready to install", className: "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" },
};

const formatMoney = (value) => `$${Number(value || 0).toLocaleString()}`;
const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "Not recorded";

function PartnerAvatar({ partner, size = "h-10 w-10" }) {
  return <div className={`${size} grid shrink-0 place-items-center rounded-xl text-sm font-bold text-white shadow-sm`} style={{ background: partner.branding?.primary_color || "#2563eb" }}>{partner.name?.charAt(0)?.toUpperCase() || "M"}</div>;
}

export default function ChannelModePage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", admin_email: "", tier: "standard" });

  const load = async () => {
    try {
      const tenantResponse = await axios.get(`${API}/channel-mode/tenants`, { headers });
      const next = tenantResponse.data || { tenants: [], summary: {} };
      setData(next);
      setSelectedId((current) => current || next.tenants?.[0]?.tenant_id || "");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not load Channel Mode");
      setData({ tenants: [], summary: { total_tenants: 0, active: 0, total_endpoints: 0, total_mrr: 0, avg_margin: 0 } });
    }
  };

  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const partners = data?.tenants || [];
  const filteredPartners = partners.filter((partner) => `${partner.name} ${partner.domain} ${partner.admin_email}`.toLowerCase().includes(query.toLowerCase()));
  const selected = filteredPartners.find((partner) => partner.tenant_id === selectedId) || partners.find((partner) => partner.tenant_id === selectedId) || filteredPartners[0] || partners[0];
  const core = CORE_STATUS[selected?.platform?.core_status];
  const coreOnline = selected?.platform?.core_status === "online";
  const endpointCount = Number(selected?.endpoint_count || 0);
  const featureCount = (selected?.features_enabled || []).length;
  const lifecycle = selected ? [
    { label: "Partner registered", detail: formatDate(selected.created_at), done: true },
    { label: "Core prepared", detail: selected.platform?.core_deployment_id ? "Deployment recorded" : "Prepare deployment", done: Boolean(selected.platform?.core_deployment_id) },
    { label: "Core verified", detail: coreOnline ? "Heartbeat confirmed" : "Heartbeat pending", done: coreOnline },
    { label: "Metering connected", detail: endpointCount ? `${endpointCount.toLocaleString()} endpoints reported` : "Awaiting endpoint data", done: endpointCount > 0 },
    { label: "Billing active", detail: selected.mrr ? `${formatMoney(selected.mrr)}/month` : "Pricing not connected", done: Number(selected.mrr || 0) > 0 },
  ] : [];

  const createTenant = async () => {
    if (!form.name.trim() || !form.admin_email.trim()) return toast.error("Enter the MSP name and primary administrator email");
    try {
      const response = await axios.post(`${API}/channel-mode/tenant`, form, { headers });
      setShowCreate(false);
      setForm({ name: "", admin_email: "", tier: "standard" });
      setSelectedId(response.data?.tenant?.tenant_id || "");
      toast.success("MSP partner created. Prepare its Core estate next.");
      await load();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not create the MSP partner"); }
  };

  if (!data) return <div className="p-6 text-sm text-muted-foreground animate-pulse">Loading Channel Mode…</div>;

  return <div className="space-y-5 p-6" data-testid="channel-mode-page">
    <OperationalPageHeader eyebrow="Nexus Channel · partner operations" title="Nexus Channel" description="Run partner onboarding, Core estate health, metering and commercial governance from one accountable workspace." icon={Building2} tone="violet" actions={<><Button size="sm" variant="outline" asChild><Link to="/deployment-hub">Deployment Hub</Link></Button><Button size="sm" onClick={() => setShowCreate(true)} data-testid="create-tenant-btn"><Plus className="mr-1.5 h-4 w-4" />Add MSP partner</Button></>} />

    <Card className="border-border/70 bg-card/60"><CardContent className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center"><div className="flex min-w-0 flex-1 items-center gap-3"><div className="rounded-xl border border-border/80 bg-background/60 px-3 py-2 text-sm font-medium">All partners <span className="ml-1 text-muted-foreground">{partners.length}</span></div><div className="relative w-full max-w-xl"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Search partners, domains or administrators…" aria-label="Search MSP partners" /></div></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />Live estate signals</div></CardContent></Card>

    {selected && <div className="xl:hidden"><Label className="mb-2 block text-xs text-muted-foreground" htmlFor="channel-partner-switcher">Selected partner</Label><select id="channel-partner-switcher" value={selectedId || ""} onChange={(event) => setSelectedId(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><option value="">Select an MSP partner</option>{filteredPartners.map((partner) => <option key={partner.tenant_id} value={partner.tenant_id}>{partner.name}</option>)}</select></div>}

    {!selected && <Card className="border-dashed"><CardContent className="flex flex-col items-start justify-between gap-4 p-7 sm:flex-row sm:items-center"><div><p className="font-semibold">Start your Channel portfolio</p><p className="mt-1 text-sm text-muted-foreground">Create an MSP partner, then prepare its Core estate and wait for a verified heartbeat.</p></div><Button onClick={() => setShowCreate(true)}><Plus className="mr-1.5 h-4 w-4" />Add MSP partner</Button></CardContent></Card>}

    {selected && <div className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)_250px]">
      <Card className="order-2 h-fit overflow-hidden xl:order-1"><CardHeader className="border-b border-border/60 pb-3"><CardTitle className="text-sm">Partner portfolio</CardTitle><CardDescription className="text-xs">Select an MSP to operate its estate.</CardDescription></CardHeader><CardContent className="max-h-[680px] space-y-1 overflow-y-auto p-2">{filteredPartners.map((partner) => <button type="button" key={partner.tenant_id} onClick={() => setSelectedId(partner.tenant_id)} className={`flex w-full items-center gap-2 rounded-lg p-2.5 text-left transition-colors ${partner.tenant_id === selected.tenant_id ? "bg-violet-500/10 ring-1 ring-violet-500/25" : "hover:bg-muted/60"}`}><PartnerAvatar partner={partner} size="h-8 w-8" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{partner.name}</span><span className="block truncate text-[11px] text-muted-foreground">{partner.platform?.core_status === "online" ? "Core verified" : partner.platform?.core_status === "prepared" ? "Core setup pending" : "Core not prepared"}</span></span><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></button>)}{filteredPartners.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No partner matches this search.</p>}</CardContent></Card>

      <div className="order-1 space-y-5 xl:order-2">
        <Card className="overflow-hidden border-violet-500/20 bg-gradient-to-br from-violet-500/[0.07] via-card to-cyan-500/[0.04]"><CardContent className="p-5"><div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between"><div className="flex min-w-0 items-start gap-3"><PartnerAvatar partner={selected} size="h-14 w-14" /><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">Partner cockpit</p><div className="mt-1 flex flex-wrap items-center gap-2"><h2 className="truncate text-2xl font-semibold">{selected.name}</h2>{core && <Badge variant="outline" className={core.className}><span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />{core.label}</Badge>}</div><p className="mt-1 text-sm text-muted-foreground">{selected.domain || "Domain not recorded"} · Primary administrator {selected.admin_email || "not recorded"}</p><div className="mt-3 flex flex-wrap gap-2"><Badge className={TIER_COLORS[selected.tier] || TIER_COLORS.standard}>{selected.tier || "standard"}</Badge><Badge variant="outline">{selected.status || "provisioning"}</Badge></div></div></div><div className="flex flex-wrap items-center gap-2"><div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2 text-right"><p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Core status</p><p className={`mt-1 text-sm font-semibold ${coreOnline ? "text-emerald-500" : "text-amber-500"}`}>{core?.label || "Not prepared"}</p></div><Button size="sm" asChild><Link to="/deployment-hub">Open in Deployment Hub <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button></div></div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{lifecycle.map((step, index) => <div key={step.label} className="relative min-w-0"><div className="flex items-center gap-2"><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${step.done ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : "border-border bg-muted text-muted-foreground"}`}>{step.done ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>{index < lifecycle.length - 1 && <span className={`hidden h-px flex-1 lg:block ${step.done ? "bg-emerald-500/40" : "bg-border"}`} />}</div><p className="mt-2 text-xs font-medium">{step.label}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{step.detail}</p></div>)}</div>
          </CardContent></Card>

        <div className="grid gap-5 lg:grid-cols-2"><Card><CardHeader className="border-b border-border/60 pb-3"><div className="flex items-center justify-between"><div><CardTitle className="text-sm">Operational timeline</CardTitle><CardDescription className="mt-1 text-xs">Accountable partner estate events.</CardDescription></div><Activity className="h-4 w-4 text-cyan-500" /></div></CardHeader><CardContent className="space-y-4 p-5"><div className="flex gap-3"><div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-500/10 text-violet-500"><Building2 className="h-3.5 w-3.5" /></div><div><p className="text-sm font-medium">Partner governance record created</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(selected.created_at)} · {selected.admin_email || "Administrator pending"}</p></div></div><div className="flex gap-3"><div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${coreOnline ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}><CloudCog className="h-3.5 w-3.5" /></div><div><p className="text-sm font-medium">{coreOnline ? "Nexus Core heartbeat verified" : selected.platform?.core_deployment_id ? "Nexus Core awaiting verification" : "Nexus Core not prepared"}</p><p className="mt-1 text-xs text-muted-foreground">{selected.platform?.core_last_seen_at ? `Last seen ${formatDate(selected.platform.core_last_seen_at)}` : "Use Deployment Hub to prepare the platform estate."}</p></div></div><div className="flex gap-3"><div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cyan-500/10 text-cyan-500"><Monitor className="h-3.5 w-3.5" /></div><div><p className="text-sm font-medium">Metering snapshot</p><p className="mt-1 text-xs text-muted-foreground">{endpointCount ? `${endpointCount.toLocaleString()} endpoints currently reported.` : "No endpoint quantity has been reported yet."}</p></div></div></CardContent></Card>

          <Card><CardHeader className="border-b border-border/60 pb-3"><div className="flex items-center justify-between"><div><CardTitle className="text-sm">Service & metering</CardTitle><CardDescription className="mt-1 text-xs">Commercial quantities derived from the partner record.</CardDescription></div><CircleDollarSign className="h-4 w-4 text-amber-500" /></div></CardHeader><CardContent className="divide-y divide-border/60 p-5">{[[Users, "Managed clients", selected.clients_count ?? "Not reported", "Customer estates"], [Monitor, "Endpoints", endpointCount.toLocaleString(), "Reported quantity"], [ShieldCheck, "Enabled services", featureCount, "Partner feature scope"], [CircleDollarSign, "Monthly recurring revenue", `${formatMoney(selected.mrr)}/mo`, "Current partner record"]].map(([Icon, label, value, subtitle]) => <div key={label} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><div className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="h-3.5 w-3.5" /></div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{label}</p><p className="text-[11px] text-muted-foreground">{subtitle}</p></div><p className="text-right text-sm font-semibold">{value}</p></div>)}</CardContent></Card></div>

        <Card><CardHeader className="border-b border-border/60 pb-3"><CardTitle className="text-sm">Partner actions</CardTitle><CardDescription className="text-xs">Use the verified lifecycle above to choose the next safe action.</CardDescription></CardHeader><CardContent className="grid gap-2 p-4 sm:grid-cols-3"><Button variant="outline" className="justify-between" asChild><Link to="/deployment-hub">Prepare or review Core <CloudCog className="h-4 w-4" /></Link></Button><Button variant="outline" className="justify-between" asChild><Link to="/team-hub">Invite technicians <UserRoundPlus className="h-4 w-4" /></Link></Button><Button variant="outline" className="justify-between" asChild><Link to="/services-subscriptions?view=billing">Review metering <CircleDollarSign className="h-4 w-4" /></Link></Button></CardContent></Card>
      </div>

      <div className="order-3 space-y-5"><Card><CardHeader className="pb-3"><CardTitle className="text-sm">Support access</CardTitle><CardDescription className="text-xs">Control-plane access is never assumed.</CardDescription></CardHeader><CardContent className="space-y-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Core access</p><p className={`mt-1 text-sm font-semibold ${coreOnline ? "text-emerald-500" : "text-amber-500"}`}>{coreOnline ? "Verified heartbeat" : "Not verified"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{coreOnline ? "The Core has recently authenticated with Nexus." : "Prepare and activate the Core before support access can be trusted."}</p></div><Button className="w-full" variant="outline" asChild><Link to="/deployment-hub">Review deployment</Link></Button></CardContent></Card>
        <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Commercial plan</CardTitle><CardDescription className="text-xs">Current channel record.</CardDescription></CardHeader><CardContent className="space-y-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tier</p><p className="mt-1 text-sm font-semibold capitalize">{selected.tier || "Standard"}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Monthly recurring revenue</p><p className="mt-1 text-xl font-semibold">{formatMoney(selected.mrr)}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Operating margin</p><p className="mt-1 text-sm font-semibold">{selected.margin_pct ?? 0}%</p></div></CardContent></Card>
        <Card className="border-cyan-500/20 bg-cyan-500/[0.04]"><CardContent className="p-4"><HeartPulse className="h-4 w-4 text-cyan-500" /><p className="mt-3 text-sm font-medium">Portfolio health</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{data.summary?.active || 0} of {data.summary?.total_tenants || 0} partner records are active. Revenue history appears only after live metering and billing sources are connected.</p></CardContent></Card>
      </div>
    </div>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><HeroTile label="Partners" value={data.summary?.total_tenants || 0} icon={Building2} glow="violet" subtitle="Managed MSP workspaces" /><HeroTile label="Active" value={data.summary?.active || 0} icon={Users} glow="emerald" subtitle="Partner records enabled" /><HeroTile label="Endpoints" value={Number(data.summary?.total_endpoints || 0).toLocaleString()} icon={Monitor} glow="cyan" subtitle="Reported portfolio quantity" /><HeroTile label="Platform MRR" value={formatMoney(data.summary?.total_mrr)} icon={CircleDollarSign} glow="amber" subtitle="Current channel records" /><HeroTile label="Average margin" value={`${data.summary?.avg_margin || 0}%`} icon={Activity} glow="violet" subtitle="Operating margin" /></div>

    <Dialog open={showCreate} onOpenChange={setShowCreate}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Create MSP partner</DialogTitle><DialogDescription>Create the governance record first, then prepare its Nexus Core estate from Deployment Hub.</DialogDescription></DialogHeader><div className="grid gap-4 py-1"><div className="grid gap-2"><Label htmlFor="channel-tenant-name">MSP name</Label><Input id="channel-tenant-name" data-testid="tenant-name-input" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Acme IT Services" autoComplete="organization" /></div><div className="grid gap-2"><Label htmlFor="channel-tenant-email">Primary administrator email</Label><Input id="channel-tenant-email" data-testid="tenant-email-input" type="email" value={form.admin_email} onChange={event => setForm({ ...form, admin_email: event.target.value })} placeholder="admin@acmeit.com" autoComplete="email" /></div><div className="grid gap-2"><Label htmlFor="channel-tenant-tier">Platform tier</Label><select id="channel-tenant-tier" data-testid="tenant-tier-select" value={form.tier} onChange={event => setForm({ ...form, tier: event.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"><option value="standard">Standard</option><option value="professional">Professional</option><option value="enterprise">Enterprise</option></select></div></div><DialogFooter><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button data-testid="submit-tenant-btn" onClick={createTenant}>Create partner</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
