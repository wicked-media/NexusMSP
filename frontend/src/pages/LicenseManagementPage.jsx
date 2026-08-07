import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowRight, BadgeDollarSign, Boxes, CheckCircle2, CircleDollarSign,
  CloudCog, Database, ExternalLink, Layers3, Loader2, PackageCheck, Pencil, Plus,
  Receipt, RefreshCw, Search, ShieldCheck, Trash2,
} from "lucide-react";

const VALID_VIEWS = new Set(["overview", "provider", "billing", "licences", "attention"]);
const EMPTY_FORM = {
  product_name: "",
  vendor: "",
  client_name: "",
  client_id: "",
  purchased: 1,
  used: 0,
  unit_cost: 0,
  renewal_date: "",
  auto_renew: true,
  billing_cycle: "monthly",
  license_type: "per_user",
};

const CATEGORY_LABELS = {
  licence: "Licences",
  backup: "Backup",
  voice: "Voice",
  security: "Security",
  telecom: "Telecom",
  managed_service: "Managed service",
  subscription: "Subscription",
};

const RECORD_LABELS = {
  provider_usage: "Provider usage",
  billing_stream: "Billing stream",
  manual_evidence: "Confirmed licence",
};

function money(value) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function number(value) {
  return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function compactDate(value) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

function statusStyle(status) {
  if (status === "active") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (status === "disabled" || status === "cancelled") return "border-zinc-500/30 bg-zinc-500/10 text-zinc-300";
  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

export default function LicenseManagementPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get("view") || "overview";
  const activeView = VALID_VIEWS.has(requestedView) ? requestedView : "overview";
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [clientId, setClientId] = useState("all");
  const [source, setSource] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [overview, clientResponse] = await Promise.all([
        axios.get(`${API}/service-subscriptions/overview`, { headers }),
        axios.get(`${API}/clients`, { headers }).catch(() => ({ data: [] })),
      ]);
      setData(overview.data);
      setClients(Array.isArray(clientResponse.data) ? clientResponse.data : []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to load services and subscriptions");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      ...EMPTY_FORM,
      product_name: item.name || "",
      vendor: item.provider || "",
      client_name: item.client_name || "",
      client_id: item.client_id || "",
      purchased: Number(item.quantity) || 0,
      used: Number(item.used_quantity) || 0,
      unit_cost: Number(item.unit_cost) || 0,
      renewal_date: item.renewal_date ? String(item.renewal_date).slice(0, 10) : "",
      billing_cycle: item.billing_cycle || "monthly",
      auto_renew: item.auto_renew ?? true,
      license_type: item.license_type || "per_user",
    });
    setDialogOpen(true);
  };

  const saveLicence = async () => {
    if (!form.product_name.trim() || !form.client_name.trim()) {
      toast.error("Product and client are required");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await axios.put(`${API}/license-management/licenses/${editing.source_record_id}`, form, { headers });
        toast.success("Confirmed licence updated");
      } else {
        await axios.post(`${API}/license-management/licenses`, form, { headers });
        toast.success("Confirmed licence added");
      }
      setDialogOpen(false);
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to save the licence");
    } finally {
      setSaving(false);
    }
  };

  const deleteLicence = async (item) => {
    if (!window.confirm(`Remove the confirmed licence record for ${item.name}?`)) return;
    try {
      await axios.delete(`${API}/license-management/licenses/${item.source_record_id}`, { headers });
      toast.success("Confirmed licence removed");
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to remove the licence");
    }
  };

  const setView = (view) => {
    const next = new URLSearchParams(searchParams);
    if (view === "overview") next.delete("view");
    else next.set("view", view);
    setSearchParams(next, { replace: true });
  };

  const sourceOptions = useMemo(
    () => [...new Map((data?.items || []).map(item => [item.source, item.source_label])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1])),
    [data],
  );

  const clientOptions = useMemo(
    () => [...new Map((data?.items || []).filter(item => item.client_id).map(item => [item.client_id, item.client_name])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1])),
    [data],
  );

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.items || []).filter(item => {
      if (activeView === "provider" && item.record_kind !== "provider_usage") return false;
      if (activeView === "billing" && item.record_kind !== "billing_stream") return false;
      if (activeView === "licences" && item.category !== "licence") return false;
      if (activeView === "attention" && !item.attention_reasons?.length) return false;
      if (category !== "all" && item.category !== category) return false;
      if (clientId !== "all" && item.client_id !== clientId) return false;
      if (source !== "all" && item.source !== source) return false;
      if (query && ![
        item.name, item.client_name, item.provider, item.source_label,
        CATEGORY_LABELS[item.category], RECORD_LABELS[item.record_kind],
      ].some(value => String(value || "").toLowerCase().includes(query))) return false;
      return true;
    });
  }, [activeView, category, clientId, data, search, source]);

  if (loading && !data) {
    return <div className="flex min-h-[420px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-cyan-300" /></div>;
  }

  const summary = data?.summary || {};

  return (
    <div className="space-y-5" data-testid="services-subscriptions-page">
      <OperationalPageHeader
        eyebrow="Billing and finance"
        title="Services & subscriptions"
        description="One evidence-backed register for provider quantities, customer billing commitments, renewals, and confirmed licences across every client."
        icon={Layers3}
        tone="cyan"
        actions={(
          <>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} data-testid="refresh-services">
              <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/recurring-invoices")}>
              <Receipt className="mr-1.5 h-4 w-4" />Recurring billing
            </Button>
            <Button size="sm" onClick={openCreate} data-testid="add-confirmed-licence">
              <Plus className="mr-1.5 h-4 w-4" />Add confirmed licence
            </Button>
          </>
        )}
      />

      <MetricStrip columns={6}>
        <MetricTile label="Active records" value={summary.active_services ?? 0} accent="cyan" icon={<PackageCheck />} testid="services-active-tile" />
        <MetricTile label="Recurring revenue" value={money(summary.monthly_recurring_revenue)} trend="Monthly billing commitment" accent="emerald" icon={<CircleDollarSign />} testid="services-mrr-tile" />
        <MetricTile label="Provider cost" value={money(summary.monthly_provider_cost)} trend="Recorded monthly cost" accent="violet" icon={<BadgeDollarSign />} testid="services-cost-tile" />
        <MetricTile label="Managed quantity" value={number(summary.managed_quantity)} trend={`${summary.provider_sources ?? 0} live or confirmed sources`} accent="sky" icon={<Boxes />} testid="services-quantity-tile" />
        <MetricTile label="Billing coverage" value={`${summary.billing_coverage_pct ?? 100}%`} trend={`${summary.billing_linked ?? 0} of ${summary.provider_records ?? 0} provider records`} accent="indigo" icon={<ShieldCheck />} testid="services-coverage-tile" />
        <MetricTile label="Needs attention" value={summary.attention_count ?? 0} trend={`${summary.renewals_due ?? 0} renewals within 45 days`} accent={summary.attention_count ? "amber" : "emerald"} icon={<AlertTriangle />} testid="services-attention-tile" />
      </MetricStrip>

      <Card className="overflow-hidden border-cyan-500/20 bg-gradient-to-r from-cyan-500/[0.07] via-background to-emerald-500/[0.06]">
        <CardContent className="grid gap-0 p-0 lg:grid-cols-3">
          {[
            { icon: CloudCog, title: "Provider quantity", body: data?.architecture?.provider_usage, tone: "text-cyan-300" },
            { icon: Receipt, title: "Billing commitment", body: data?.architecture?.billing_stream, tone: "text-emerald-300" },
            { icon: Database, title: "Confirmed fallback", body: data?.architecture?.manual_evidence, tone: "text-violet-300" },
          ].map((item, index) => (
            <div key={item.title} className={`flex gap-3 p-4 ${index ? "border-t border-border/50 lg:border-l lg:border-t-0" : ""}`}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-background/60">
                <item.icon className={`h-4 w-4 ${item.tone}`} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em]">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.body}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2" aria-label="Service register views">
        {[
          ["overview", "All services", summary.all_records ?? 0],
          ["provider", "Provider usage", (data?.items || []).filter(item => item.record_kind === "provider_usage").length],
          ["billing", "Billing streams", (data?.items || []).filter(item => item.record_kind === "billing_stream").length],
          ["licences", "Licences", (data?.items || []).filter(item => item.category === "licence").length],
          ["attention", "Needs attention", summary.attention_count ?? 0],
        ].map(([value, label, count]) => (
          <Button
            key={value}
            variant={activeView === value ? "default" : "outline"}
            size="sm"
            onClick={() => setView(value)}
            data-testid={`services-view-${value}`}
            className="min-w-[132px] justify-between gap-3"
          >
            {label}<Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5">{count}</Badge>
          </Button>
        ))}
      </div>

      <Card className="border-border/60">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex flex-col gap-4">
            <div>
              <CardTitle className="text-base">Unified service register</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Provider cost and customer revenue remain separate so reconciliation is accurate and auditable.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-[260px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search client, service, provider…" className="pl-9" data-testid="services-search" />
              </div>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full sm:w-[170px]" data-testid="services-category-filter"><SelectValue placeholder="All categories" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {(data?.categories || []).map(value => <SelectItem key={value} value={value}>{CATEGORY_LABELS[value] || value}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="w-full sm:w-[180px]" data-testid="services-client-filter"><SelectValue placeholder="All clients" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clients</SelectItem>
                  {clientOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="w-full sm:w-[180px]" data-testid="services-source-filter"><SelectValue placeholder="All sources" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  {sourceOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {visibleItems.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center" data-testid="services-empty-state">
              <Layers3 className="mb-3 h-10 w-10 text-muted-foreground/30" />
              <p className="font-semibold">No services match this view</p>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">Change the filters, connect a provider, configure recurring billing, or add a confirmed licence from a verified source.</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => { setSearch(""); setCategory("all"); setClientId("all"); setSource("all"); setView("overview"); }}>Clear filters</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[260px]">Service</TableHead>
                    <TableHead className="min-w-[180px]">Client</TableHead>
                    <TableHead>Evidence source</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Provider cost</TableHead>
                    <TableHead className="text-right">Recurring revenue</TableHead>
                    <TableHead>Billing</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[110px] text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleItems.map(item => (
                    <TableRow key={item.id} data-testid={`service-record-${item.id}`} className={item.attention_reasons?.length ? "bg-amber-500/[0.035]" : ""}>
                      <TableCell>
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06]">
                            {item.record_kind === "billing_stream" ? <Receipt className="h-4 w-4 text-emerald-300" /> : <PackageCheck className="h-4 w-4 text-cyan-300" />}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{item.name}</p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <Badge variant="outline" className="text-[10px]">{CATEGORY_LABELS[item.category] || item.category}</Badge>
                              <Badge variant="outline" className="text-[10px]">{RECORD_LABELS[item.record_kind] || item.record_kind}</Badge>
                            </div>
                            {item.attention_reasons?.length > 0 && <p className="mt-1.5 text-[11px] text-amber-300">{item.attention_reasons.join(" · ")}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm font-medium">{item.client_name}</p>
                        {item.client_id && <Button variant="link" className="h-auto p-0 text-[11px] text-muted-foreground" onClick={() => navigate(`/clients?client=${item.client_id}`)}>Open client profile</Button>}
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-medium">{item.source_label}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{item.provider}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">Updated {compactDate(item.last_synced)}</p>
                      </TableCell>
                      <TableCell className="text-right">
                        <p className="font-mono text-sm font-semibold">{number(item.quantity)}</p>
                        {item.used_quantity !== null && item.used_quantity !== undefined && <p className="text-[10px] text-muted-foreground">{number(item.used_quantity)} used</p>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{money(item.monthly_cost)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{money(item.monthly_revenue)}</TableCell>
                      <TableCell>
                        {item.billing_linked ? (
                          <Badge className="border border-emerald-500/25 bg-emerald-500/10 text-emerald-300"><CheckCircle2 className="mr-1 h-3 w-3" />{item.billing_state === "billing_stream" ? "Source" : "Linked"}</Badge>
                        ) : (
                          <Badge className="border border-amber-500/25 bg-amber-500/10 text-amber-300"><AlertTriangle className="mr-1 h-3 w-3" />Unmapped</Badge>
                        )}
                      </TableCell>
                      <TableCell><Badge variant="outline" className={statusStyle(item.status)}>{String(item.status || "unknown").replaceAll("_", " ")}</Badge></TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {item.editable && (
                            <>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(item)} aria-label={`Edit ${item.name}`}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-300" onClick={() => deleteLicence(item)} aria-label={`Remove ${item.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </>
                          )}
                          {!item.editable && item.source_route && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(item.source_route)} aria-label={`Open source for ${item.name}`}><ExternalLink className="h-3.5 w-3.5" /></Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {(data?.source_breakdown || []).length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {data.source_breakdown.map(item => (
            <Card key={item.source} className="border-border/60">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em]">{item.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.records} records · {number(item.quantity)} quantity</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-cyan-300" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div><p className="text-muted-foreground">Provider cost</p><p className="mt-1 font-mono font-semibold">{money(item.monthly_cost)}</p></div>
                  <div><p className="text-muted-foreground">Revenue</p><p className="mt-1 font-mono font-semibold">{money(item.monthly_revenue)}</p></div>
                </div>
                {item.attention > 0 && <div className="mt-3"><Progress value={Math.min(100, item.attention / item.records * 100)} className="h-1.5 [&>div]:bg-amber-400" /><p className="mt-1.5 text-[10px] text-amber-300">{item.attention} require attention</p></div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl overflow-hidden p-0" aria-describedby="confirmed-licence-description">
          <DialogHeader className="border-b border-border/60 bg-gradient-to-r from-cyan-500/[0.09] via-background to-violet-500/[0.08] px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-500/25 bg-cyan-500/10"><Layers3 className="h-5 w-5 text-cyan-300" /></div>
              <div>
                <DialogTitle>{editing ? "Update confirmed licence" : "Add confirmed licence"}</DialogTitle>
                <DialogDescription id="confirmed-licence-description" className="mt-1">Use a verified supplier invoice or provider portal. Nexus records the technician and time for audit.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="grid gap-5 px-6 py-5 md:grid-cols-2">
            <div className="space-y-2"><Label>Product name</Label><Input value={form.product_name} onChange={event => setForm({ ...form, product_name: event.target.value })} placeholder="Microsoft 365 Business Premium" data-testid="licence-product-name" /></div>
            <div className="space-y-2"><Label>Vendor</Label><Input value={form.vendor} onChange={event => setForm({ ...form, vendor: event.target.value })} placeholder="Microsoft" /></div>
            <div className="space-y-2 md:col-span-2">
              <Label>Client</Label>
              <Input
                list="confirmed-licence-clients"
                value={form.client_name}
                onChange={event => {
                  const client = clients.find(option => option.name === event.target.value);
                  setForm({ ...form, client_name: event.target.value, client_id: client?.id || "" });
                }}
                placeholder="Start typing a client name"
                data-testid="licence-client-name"
              />
              <datalist id="confirmed-licence-clients">{clients.map(client => <option key={client.id} value={client.name} />)}</datalist>
            </div>
            <div className="grid grid-cols-3 gap-3 md:col-span-2">
              <div className="space-y-2"><Label>Purchased</Label><Input type="number" min="0" value={form.purchased} onChange={event => setForm({ ...form, purchased: Number(event.target.value) || 0 })} /></div>
              <div className="space-y-2"><Label>Used</Label><Input type="number" min="0" value={form.used} onChange={event => setForm({ ...form, used: Number(event.target.value) || 0 })} /></div>
              <div className="space-y-2"><Label>Unit cost</Label><Input type="number" min="0" step="0.01" value={form.unit_cost} onChange={event => setForm({ ...form, unit_cost: Number(event.target.value) || 0 })} /></div>
            </div>
            <div className="space-y-2"><Label>Renewal date</Label><Input type="date" value={form.renewal_date} onChange={event => setForm({ ...form, renewal_date: event.target.value })} /></div>
            <div className="space-y-2">
              <Label>Billing cycle</Label>
              <Select value={form.billing_cycle} onValueChange={value => setForm({ ...form, billing_cycle: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="annual">Annual</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Licence basis</Label>
              <Select value={form.license_type} onValueChange={value => setForm({ ...form, license_type: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="per_user">Per user</SelectItem><SelectItem value="per_device">Per device</SelectItem><SelectItem value="site">Per site</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/60 px-4 py-3">
              <div><p className="text-sm font-medium">Auto renew</p><p className="text-xs text-muted-foreground">Record the provider renewal setting.</p></div>
              <Switch checked={form.auto_renew} onCheckedChange={value => setForm({ ...form, auto_renew: value })} />
            </div>
          </div>
          <DialogFooter className="border-t border-border/60 bg-muted/20 px-6 py-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveLicence} disabled={saving} data-testid="save-confirmed-licence">
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{editing ? "Save confirmed changes" : "Add to register"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
