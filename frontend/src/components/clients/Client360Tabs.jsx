import { useEffect, useState } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import ClientPaymentMethodsPanel from "@/components/clients/ClientPaymentMethodsPanel";
import { toast } from "sonner";
import { Loader2, Package, Boxes, Server, Cloud, ShieldCheck, ShieldAlert, DollarSign, TrendingUp, AlertCircle, CheckCircle2, Users, KeyRound, ListChecks, ReceiptText, Activity, ArrowRight, CalendarClock, CircleDollarSign, CreditCard, MailCheck, RefreshCw, Settings2, Repeat2 } from "lucide-react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "@/styles/dashboard-grid.css";
import { useWidgetGrid } from "@/hooks/useWidgetGrid";

const Client360Grid = WidthProvider(Responsive);

const fmt$ = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function useApiGet(url, token) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!url || !token) { setLoading(false); setError(false); return; }
    setLoading(true);
    setError(false);
    axios.get(`${API}${url}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setData(r.data))
      .catch(() => { setData(null); setError(true); })
      .finally(() => setLoading(false));
  }, [url, token, revision]);
  return { data, loading, error, reload: () => setRevision((current) => current + 1) };
}

/* ──────────────── SUBSCRIPTIONS ──────────────── */
const SUBS_META = {
  "stats":   { label: "Subscription Stats", icon: Boxes },
  "sources": { label: "Sources Breakdown",  icon: ListChecks },
  "table":   { label: "Subscription Table", icon: Package },
};
const SUBS_LAYOUT = [
  { i: "stats",   x: 0, y: 0, w: 12, h: 2, minH: 2, minW: 6 },
  { i: "sources", x: 0, y: 2, w: 12, h: 2, minH: 1, minW: 6 },
  { i: "table",   x: 0, y: 4, w: 12, h: 7, minH: 4, minW: 6 },
];

export function Client360Subscriptions({ clientId, token }) {
  const { data, loading } = useApiGet(`/clients/${clientId}/subscriptions`, token);
  const navigate = useNavigate();
  const grid = useWidgetGrid({
    storageKey: "nx-c360-subs-layout-v1",
    hiddenKey:  "nx-c360-subs-hidden-v1",
    defaultLayout: SUBS_LAYOUT,
    widgetMeta: SUBS_META,
    label: "Subscriptions",
  });
  if (loading) return <Loader label="Loading subscriptions…" />;
  if (!data?.items?.length) return <EmptyState icon={Package} msg="No subscriptions linked. Connect this client to Pax8 / Acronis in Integrations tab, or add a recurring invoice." />;

  const byLabel = {};
  (data.items || []).forEach((s) => { byLabel[s.source_label] = (byLabel[s.source_label] || 0) + 1; });

  return (
    <div className="space-y-3" data-testid="client360-subscriptions">
      <grid.EditBar testIdPrefix="c360-subs-" />
      <Client360Grid
        className={`layout ${grid.editMode ? "nx-edit-mode" : ""}`}
        layouts={grid.visibleLayouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 8, xs: 4, xxs: 2 }}
        rowHeight={48}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        isDraggable={grid.editMode}
        isResizable={grid.editMode}
        onLayoutChange={grid.onLayoutChange}
        draggableCancel=".nx-widget-hide,button,a,input,kbd,select"
        useCSSTransforms
        compactType="vertical"
      >
        {!grid.hiddenWidgets.has("stats") && (
          <div key="stats" className="nx-widget-card">
            <grid.HideBtn id="stats" />
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 h-full">
              <Stat label="Active subs" value={data.count} color="sky" icon={Boxes} />
              <Stat label="Total seats" value={data.total_seats} color="violet" icon={Users} />
              <Stat label="Monthly" value={fmt$(data.total_monthly_aud)} color="emerald" icon={DollarSign} />
              <Stat label="Annual" value={fmt$(data.total_monthly_aud * 12)} color="amber" icon={TrendingUp} />
            </div>
          </div>
        )}
        {!grid.hiddenWidgets.has("sources") && (
          <div key="sources" className="nx-widget-card">
            <grid.HideBtn id="sources" />
            <div className="border border-zinc-800 rounded-md p-3 bg-zinc-950 h-full">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Sources</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(byLabel).map(([k, v]) => (
                  <Badge key={k} variant="outline" className="text-sky-400 border-sky-500/30">{k} · {v}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}
        {!grid.hiddenWidgets.has("table") && (
          <div key="table" className="nx-widget-card">
            <grid.HideBtn id="table" />
            <div className="border border-zinc-800 rounded-md bg-zinc-950 overflow-hidden h-full">
              <div className="overflow-auto h-full">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800 sticky top-0 bg-zinc-950">
                    <tr>
                      <th className="p-2 text-left">Source</th>
                      <th className="p-2 text-left">Product</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">Unit</th>
                      <th className="p-2 text-right">Monthly</th>
                      <th className="p-2 text-left">Cycle</th>
                      <th className="p-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.items || []).map((s, i) => (
                      <tr key={i} className="border-b border-zinc-900 hover:bg-zinc-900/50" data-testid={`sub-row-${i}`}>
                        <td className="p-2">{s.linked_contract_id ? <button type="button" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35" onClick={() => navigate(`/contracts?contract=${encodeURIComponent(s.linked_contract_id)}`)} title={`Open ${s.linked_contract_name || "linked contract"}`} data-testid={`open-subscription-contract-${i}`}><Badge variant="outline" className="cursor-pointer border-violet-500/35 bg-violet-500/[0.08] text-[10px] text-violet-200 hover:bg-violet-500/[0.16]">{s.source_label}</Badge></button> : <Badge variant="outline" className="text-[10px]">{s.source_label}</Badge>}</td>
                        <td className="p-2"><div>{s.product}</div>{s.linked_contract_name && <button type="button" className="mt-0.5 text-[10px] text-violet-300 hover:underline" onClick={() => navigate(`/contracts?contract=${encodeURIComponent(s.linked_contract_id)}`)}>Contract: {s.linked_contract_name}</button>}</td>
                        <td className="p-2 text-right">{s.quantity}</td>
                        <td className="p-2 text-right text-zinc-400">{s.unit_price != null ? fmt$(s.unit_price) : "—"}</td>
                        <td className="p-2 text-right text-emerald-400 font-semibold">{fmt$(s.monthly_cost)}</td>
                        <td className="p-2 text-zinc-400">{s.billing_cycle || "monthly"}</td>
                        <td className="p-2"><Badge variant="outline" className={`text-[10px] ${s.status === "active" ? "text-emerald-400 border-emerald-500/30" : "text-zinc-500"}`}>{s.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Client360Grid>
    </div>
  );
}

/* ──────────────── SECURITY ──────────────── */
const SEC_META = {
  "stats":  { label: "Security Stats",      icon: ShieldCheck },
  "cipp":   { label: "Microsoft posture",   icon: Cloud },
  "users":  { label: "Users & Passwords",   icon: KeyRound },
  "links":  { label: "Quick Links",         icon: ListChecks },
};
const SEC_LAYOUT = [
  { i: "stats", x: 0, y: 0, w: 12, h: 2, minH: 2, minW: 6 },
  { i: "cipp",  x: 0, y: 2, w: 12, h: 4, minH: 3, minW: 6 },
  { i: "users", x: 0, y: 6, w: 12, h: 2, minH: 1, minW: 6 },
  { i: "links", x: 0, y: 8, w: 12, h: 1, minH: 1, minW: 4 },
];

export function Client360Security({ clientId, token }) {
  const { data, loading } = useApiGet(`/clients/${clientId}/security`, token);
  const grid = useWidgetGrid({
    storageKey: "nx-c360-security-layout-v1",
    hiddenKey:  "nx-c360-security-hidden-v1",
    defaultLayout: SEC_LAYOUT,
    widgetMeta: SEC_META,
    label: "Security",
  });
  if (loading) return <Loader label="Scanning security posture…" />;
  const s = data || {};

  const mfaColor = s.mfa_pct == null ? "zinc" : s.mfa_pct >= 95 ? "emerald" : s.mfa_pct >= 80 ? "amber" : "rose";
  const hygColor = s.cipp_hygiene == null ? "zinc" : s.cipp_hygiene >= 80 ? "emerald" : s.cipp_hygiene >= 60 ? "amber" : "rose";

  return (
    <div className="space-y-3" data-testid="client360-security">
      <grid.EditBar testIdPrefix="c360-security-" />
      <Client360Grid
        className={`layout ${grid.editMode ? "nx-edit-mode" : ""}`}
        layouts={grid.visibleLayouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 8, xs: 4, xxs: 2 }}
        rowHeight={48}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        isDraggable={grid.editMode}
        isResizable={grid.editMode}
        onLayoutChange={grid.onLayoutChange}
        draggableCancel=".nx-widget-hide,button,a,input,kbd,select"
        useCSSTransforms
        compactType="vertical"
      >
        {!grid.hiddenWidgets.has("stats") && (
          <div key="stats" className="nx-widget-card">
            <grid.HideBtn id="stats" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 h-full">
              <Stat label="MFA coverage" value={s.mfa_pct != null ? `${s.mfa_pct}%` : "—"} color={mfaColor} icon={KeyRound} />
              <Stat label="Microsoft posture" value={s.cipp_hygiene != null ? `${s.cipp_hygiene}/100` : "—"} color={hygColor} icon={ShieldCheck} />
              <Stat label="Assessed endpoints" value={`${s.assessed_endpoints || 0}/${s.managed_endpoints || 0}`} color={s.assessed_endpoints ? "violet" : "zinc"} icon={ShieldCheck} />
              <Stat label="Defender active" value={`${s.defender_active || 0}/${s.assessed_endpoints || 0}`} color={s.assessed_endpoints && s.defender_active === s.assessed_endpoints ? "emerald" : "zinc"} icon={ShieldCheck} />
              <Stat label="Firewall on" value={`${s.firewall_enabled || 0}/${s.assessed_endpoints || 0}`} color={s.assessed_endpoints && s.firewall_enabled === s.assessed_endpoints ? "emerald" : "zinc"} icon={ShieldCheck} />
              <Stat label="Encrypted" value={`${s.encrypted_endpoints || 0}/${s.assessed_endpoints || 0}`} color={s.assessed_endpoints && s.encrypted_endpoints === s.assessed_endpoints ? "emerald" : "zinc"} icon={KeyRound} />
              <Stat label="Pending updates" value={s.pending_updates || 0} color={s.pending_updates ? "amber" : "emerald"} icon={AlertCircle} />
              <Stat label="Huntress alerts" value={s.huntress_critical || 0} color={s.huntress_critical > 0 ? "rose" : "zinc"} icon={ShieldAlert} />
            </div>
          </div>
        )}
        {!grid.hiddenWidgets.has("cipp") && s.cipp_dimensions && (
          <div key="cipp" className="nx-widget-card">
            <grid.HideBtn id="cipp" />
            <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950 h-full overflow-auto">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">Nexus Control Plane · Microsoft posture</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(s.cipp_dimensions).map(([k, v]) => {
                  const pct = typeof v === "number" ? v : (v?.score || 0);
                  const max = 100;
                  const color = pct >= 80 ? "emerald" : pct >= 60 ? "amber" : "rose";
                  return (
                    <div key={k} className="text-xs">
                      <div className="flex justify-between">
                        <span className="text-zinc-500 uppercase tracking-wider text-[10px]">{k.replace(/_/g, " ")}</span>
                        <span className="font-mono text-zinc-400 text-[10px]">{Math.round(pct)}</span>
                      </div>
                      <div className="h-1 bg-zinc-800 rounded overflow-hidden mt-1">
                        <div className={`h-full bg-${color}-500`} style={{ width: `${Math.min(100, (pct / max) * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {!grid.hiddenWidgets.has("users") && (
          <div key="users" className="nx-widget-card">
            <grid.HideBtn id="users" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 h-full">
              <InfoTile icon={Users} label="Active users" value={s.user_count || "—"} />
              <InfoTile icon={AlertCircle} label="Stale users" value={s.stale_users || 0} warnIf={(v) => v > 2} />
              <InfoTile icon={KeyRound} label="Weak passwords" value={s.weak_passwords || 0} warnIf={(v) => v > 0} />
            </div>
          </div>
        )}
        {!grid.hiddenWidgets.has("links") && (
          <div key="links" className="nx-widget-card">
            <grid.HideBtn id="links" />
            <div className="border border-zinc-800 rounded-md p-3 bg-zinc-950 h-full flex items-center gap-2 flex-wrap">
              <Link to="/control-plane?module=microsoft365" className="text-xs text-indigo-400 hover:underline">Open Nexus Control Plane →</Link>
              <span className="text-zinc-700">·</span>
              <Link to="/huntress-dashboard" className="text-xs text-indigo-400 hover:underline">Huntress console →</Link>
            </div>
          </div>
        )}
      </Client360Grid>
    </div>
  );
}

/* ──────────────── BILLING ──────────────── */
const billingProfileDefaults = {
  billing_email: "",
  payment_terms_days: 30,
  purchase_order_required: false,
  default_payment_method: "bank_transfer",
  xero_contact_id: "",
};

function formatBillingDate(value) {
  if (!value) return "Not scheduled";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function BillingMetric({ label, value, description, icon: Icon, tone = "cyan" }) {
  const tones = {
    cyan: "border-cyan-400/20 bg-cyan-400/[0.045] text-cyan-200",
    emerald: "border-emerald-400/20 bg-emerald-400/[0.045] text-emerald-200",
    amber: "border-amber-400/20 bg-amber-400/[0.045] text-amber-100",
    rose: "border-rose-400/20 bg-rose-400/[0.045] text-rose-100",
  };
  return (
    <article className={`rounded-xl border p-4 transition-transform duration-200 hover:-translate-y-0.5 ${tones[tone] || tones.cyan}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
        </div>
        {Icon && <span className="rounded-lg border border-current/20 bg-background/20 p-2"><Icon className="h-4 w-4" /></span>}
      </div>
      {description && <p className="mt-2 text-xs leading-5 opacity-70">{description}</p>}
    </article>
  );
}

function ClientBillingProfileDialog({ clientId, token, open, onOpenChange, onSaved }) {
  const [profile, setProfile] = useState(billingProfileDefaults);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !token) return;
    let active = true;
    setLoading(true);
    axios.get(`${API}/clients/${clientId}/billing-profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (active) setProfile({ ...billingProfileDefaults, ...response.data });
      })
      .catch(() => {
        if (active) toast.error("Billing defaults could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [clientId, open, token]);

  const save = async () => {
    if (profile.billing_email && !/^\S+@\S+\.\S+$/.test(profile.billing_email)) {
      toast.error("Enter a valid billing recipient email.");
      return;
    }
    setSaving(true);
    try {
      await axios.put(`${API}/clients/${clientId}/billing-profile`, {
        billing_email: profile.billing_email.trim(),
        payment_terms_days: Number(profile.payment_terms_days) || 0,
        purchase_order_required: Boolean(profile.purchase_order_required),
        default_payment_method: profile.default_payment_method,
        // Retain integration linkage even though it is not a routine staff-editable field.
        xero_contact_id: profile.xero_contact_id || "",
      }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success("Billing defaults saved");
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Billing defaults could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NexusWorkflowDialog
        eyebrow="Client commercial controls"
        title="Edit billing defaults"
        description="Set the customer-specific defaults that guide recurring and one-off invoice work. This does not create or send an invoice."
        icon={Settings2}
        tone="cyan"
        className="max-w-2xl"
        contentClassName="space-y-5"
        footer={<><p className="hidden text-xs text-muted-foreground sm:block">Changes are retained against this client and audited by the billing API.</p><div className="flex gap-2"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={save} disabled={loading || saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save billing defaults</Button></div></>}
      >
        {loading ? <Loader label="Loading billing defaults…" /> : <>
          <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
            <p className="text-sm font-medium">Invoice recipient</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Use the accounts contact approved to receive invoices. The address is only shown in this authorised billing workflow.</p>
            <div className="mt-3 grid gap-2"><Label htmlFor="client-billing-email">Billing email</Label><Input id="client-billing-email" type="email" value={profile.billing_email} onChange={(event) => setProfile((current) => ({ ...current, billing_email: event.target.value }))} placeholder="accounts@customer.example" /></div>
          </section>
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2"><Label htmlFor="client-payment-terms">Payment terms (days)</Label><Input id="client-payment-terms" type="number" min="0" max="365" value={profile.payment_terms_days} onChange={(event) => setProfile((current) => ({ ...current, payment_terms_days: event.target.value }))} /><p className="text-[11px] text-muted-foreground">Use 0 for due on receipt.</p></div>
            <div className="grid gap-2"><Label>Default payment method</Label><Select value={profile.default_payment_method} onValueChange={(value) => setProfile((current) => ({ ...current, default_payment_method: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bank_transfer">Bank transfer</SelectItem><SelectItem value="card">Card</SelectItem><SelectItem value="direct_debit">Direct debit</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
          </section>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-muted/[0.12] p-4"><Switch checked={Boolean(profile.purchase_order_required)} onCheckedChange={(checked) => setProfile((current) => ({ ...current, purchase_order_required: checked }))} /><span><span className="text-sm font-medium">Purchase order required</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Make the commercial requirement visible before staff create customer billing commitments.</span></span></label>
        </>}
      </NexusWorkflowDialog>
    </Dialog>
  );
}

export function Client360Billing({ clientId, token }) {
  const { data, loading, error, reload } = useApiGet(`/clients/${clientId}/billing-detail`, token);
  const [editingDefaults, setEditingDefaults] = useState(false);
  if (loading) return <Loader label="Reading billing…" />;
  if (error && !data) {
    return <div className="rounded-2xl border border-rose-400/25 bg-rose-400/[0.04] p-6 text-center" data-testid="client360-billing-error"><AlertCircle className="mx-auto h-6 w-6 text-rose-300" /><p className="mt-3 font-medium">Billing data could not be loaded</p><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">No financial totals are shown until Nexus can read the authorised client record.</p><Button className="mt-4" variant="outline" onClick={reload}><RefreshCw className="mr-1.5 h-4 w-4" />Try again</Button></div>;
  }

  const billing = data || {};
  const recurring = billing.recurring_summary || {};
  const profile = billing.billing_profile || {};
  const subscriptionSummary = billing.subscription_summary || {};
  const streams = billing.recurring_streams || [];
  const activeStreams = streams.filter((stream) => stream.status === "active");
  const hasPromises = (billing.payment_promises?.kept || 0) + (billing.payment_promises?.broken || 0) > 0;
  const agingTones = {
    current: "border-emerald-400/20 bg-emerald-400/[0.04] text-emerald-100",
    30: "border-cyan-400/20 bg-cyan-400/[0.04] text-cyan-100",
    60: "border-amber-400/20 bg-amber-400/[0.04] text-amber-100",
    90: "border-orange-400/20 bg-orange-400/[0.04] text-orange-100",
    "90+": "border-rose-400/20 bg-rose-400/[0.04] text-rose-100",
  };

  return (
    <div className="space-y-5" data-testid="client360-billing">
      <section className="relative overflow-hidden rounded-2xl border border-cyan-400/25 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.15),transparent_40%),linear-gradient(135deg,rgba(8,47,73,0.54),rgba(15,23,42,0.74))] p-5 shadow-[0_16px_44px_rgba(8,47,73,0.2)] md:p-6">
        <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full border border-cyan-300/15 bg-cyan-300/[0.035]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200"><ReceiptText className="h-3.5 w-3.5" />Commercial workspace</div><h3 className="mt-2 text-xl font-semibold tracking-tight text-foreground md:text-2xl">Revenue, renewals & collection clarity.</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Recorded receivables, recurring customer commitments and provider subscription evidence stay deliberately separate—so staff can act without confusing cost, revenue or delivery status.</p></div>
          <div className="flex flex-wrap gap-2"><Button asChild><Link to={`/recurring-invoices?clientId=${encodeURIComponent(clientId)}&create=1`} data-testid="client-billing-create-recurring"><Repeat2 className="mr-1.5 h-4 w-4" />Set up recurring billing</Link></Button><Button asChild variant="outline"><Link to={`/recurring-invoices?clientId=${encodeURIComponent(clientId)}`}><CalendarClock className="mr-1.5 h-4 w-4" />Recurring workspace</Link></Button></div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Client billing metrics">
        <BillingMetric label="Open receivables" value={fmt$(billing.open_balance)} description="Outstanding invoice balance" icon={DollarSign} tone={billing.open_balance > 0 ? "amber" : "emerald"} />
        <BillingMetric label="Overdue receivables" value={fmt$(billing.overdue_balance)} description={billing.critical_overdue_balance > 0 ? `${fmt$(billing.critical_overdue_balance)} is more than 90 days overdue` : "Invoices past their due date"} icon={AlertCircle} tone={billing.overdue_balance > 0 ? "rose" : "emerald"} />
        <BillingMetric label="Recurring MRR" value={fmt$(billing.mrr_aud)} description="Active customer billing streams, normalised monthly" icon={TrendingUp} tone="cyan" />
        <BillingMetric label="Active streams" value={recurring.active || 0} description={recurring.next_generation ? `Next generation ${formatBillingDate(recurring.next_generation)}` : "No generation currently scheduled"} icon={CircleDollarSign} tone="emerald" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.85fr)]">
        <article className="rounded-2xl border border-border/70 bg-card/80 p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] p-2 text-emerald-200"><Repeat2 className="h-4 w-4" /></span><div><p className="text-sm font-semibold">Recurring billing commitments</p><p className="mt-0.5 text-xs text-muted-foreground">Customer-facing recurring revenue—not provider cost estimates.</p></div></div></div><div className="flex flex-wrap gap-2"><Badge variant="outline" className="border-emerald-400/25 text-emerald-200">{recurring.active || 0} active</Badge>{recurring.paused > 0 && <Badge variant="outline" className="border-amber-400/25 text-amber-100">{recurring.paused} paused</Badge>}</div></div>
          {activeStreams.length ? <div className="mt-4 space-y-2">{streams.slice(0, 5).map((stream) => <div key={stream.id} className="group rounded-xl border border-border/65 bg-muted/[0.1] p-3 transition-colors hover:border-cyan-400/30 hover:bg-cyan-400/[0.035]" data-testid={`client-recurring-stream-${stream.id}`}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{stream.description}</p><Badge variant="outline" className={stream.status === "active" ? "border-emerald-400/25 text-emerald-200" : "border-amber-400/25 text-amber-100"}>{stream.status}</Badge>{stream.linked_contract && <Badge variant="outline" className="border-violet-400/25 text-violet-200">Contract linked</Badge>}</div><div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground"><span>{fmt$(stream.amount)} · {stream.frequency}</span><span>Next: {formatBillingDate(stream.next_generation)}</span><span>{stream.line_item_count} line {stream.line_item_count === 1 ? "item" : "items"}</span>{stream.usage_sources?.length > 0 && <span>{stream.usage_sources.join(" + ")} usage included</span>}</div></div><div className="flex items-center gap-2 sm:text-right"><div><p className="font-mono text-sm font-semibold">{fmt$(stream.monthly_equivalent)}<span className="ml-1 text-[10px] font-normal text-muted-foreground">MRR</span></p><p className={stream.delivery_state === "ready" ? "text-[10px] text-emerald-300" : stream.delivery_state === "needs_recipient" ? "text-[10px] text-amber-200" : "text-[10px] text-muted-foreground"}>{stream.delivery_state === "ready" ? "Invoice delivery ready" : stream.delivery_state === "needs_recipient" ? "Recipient required" : "Manual delivery"}</p></div><ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div></div></div>)}</div> : <div className="mt-4 rounded-xl border border-dashed border-cyan-400/25 bg-cyan-400/[0.035] p-5"><p className="font-medium">No active recurring billing is set up yet.</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Create a customer-specific stream for managed services, backup, security, device rental or any other repeatable commitment. Templates remain available in the recurring workspace.</p><Button className="mt-4" asChild><Link to={`/recurring-invoices?clientId=${encodeURIComponent(clientId)}&create=1`}><Repeat2 className="mr-1.5 h-4 w-4" />Create the first stream</Link></Button></div>}
          {streams.length > 5 && <Link to={`/recurring-invoices?clientId=${encodeURIComponent(clientId)}`} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-cyan-200 transition-colors hover:text-cyan-100">View all {streams.length} billing streams <ArrowRight className="h-3.5 w-3.5" /></Link>}
        </article>

        <div className="space-y-5">
          <article className="rounded-2xl border border-border/70 bg-card/80 p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.06] p-2 text-cyan-200"><Settings2 className="h-4 w-4" /></span><div><p className="text-sm font-semibold">Billing controls</p><p className="mt-0.5 text-xs text-muted-foreground">Defaults applied by staff workflows.</p></div></div></div><Button size="sm" variant="outline" onClick={() => setEditingDefaults(true)}><Settings2 className="mr-1.5 h-3.5 w-3.5" />Edit</Button></div><div className="mt-4 grid gap-2"><div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/[0.1] px-3 py-2 text-xs"><span className="flex items-center gap-2 text-muted-foreground"><MailCheck className="h-3.5 w-3.5" />Invoice recipient</span><span className={profile.billing_recipient_state === "configured" ? "font-medium text-emerald-200" : "font-medium text-amber-100"}>{profile.billing_recipient_state === "configured" ? "Configured" : profile.billing_recipient_state === "fallback" ? "Primary contact fallback" : "Needs attention"}</span></div><div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/[0.1] px-3 py-2 text-xs"><span className="text-muted-foreground">Payment terms</span><span className="font-medium">{Number(profile.payment_terms_days || 0) === 0 ? "Due on receipt" : `Net ${profile.payment_terms_days || 30}`}</span></div><div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/[0.1] px-3 py-2 text-xs"><span className="flex items-center gap-2 text-muted-foreground"><CreditCard className="h-3.5 w-3.5" />Payment method</span><span className="font-medium capitalize">{String(profile.default_payment_method || "bank transfer").replace(/_/g, " ")}</span></div><div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/[0.1] px-3 py-2 text-xs"><span className="text-muted-foreground">Purchase order</span><span className="font-medium">{profile.purchase_order_required ? "Required" : "Not required"}</span></div></div></article>

          <article className="rounded-2xl border border-violet-400/20 bg-[radial-gradient(circle_at_top_right,rgba(167,139,250,0.11),transparent_55%),rgba(15,23,42,0.7)] p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">Subscription evidence</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Observed provider records are not assumed to be sold, billed or profitable.</p></div><Package className="h-4 w-4 text-violet-200" /></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg border border-violet-400/15 bg-violet-400/[0.035] p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-violet-200/70">Provider records</p><p className="mt-1 text-lg font-semibold">{subscriptionSummary.provider_records || 0}</p></div><div className="rounded-lg border border-violet-400/15 bg-violet-400/[0.035] p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-violet-200/70">Reported monthly cost</p><p className="mt-1 text-lg font-semibold">{fmt$(subscriptionSummary.provider_monthly_cost)}</p></div></div><p className="mt-3 text-[11px] text-muted-foreground">{subscriptionSummary.provider_sources?.length ? subscriptionSummary.provider_sources.join(" · ") : "No provider subscription source is linked yet."}</p><Button className="mt-4 w-full" variant="outline" asChild><Link to={`/clients?client=${encodeURIComponent(clientId)}&view=subscriptions`}>Open subscription register <ArrowRight className="ml-1.5 h-4 w-4" /></Link></Button></article>
        </div>
      </section>

      <ClientPaymentMethodsPanel clientId={clientId} token={token} invoices={billing.recent_invoices || []} />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.75fr)]">
        <article className="overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4"><div><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-200" /><p className="text-sm font-semibold">Receivables aging</p></div><p className="mt-1 text-xs text-muted-foreground">Outstanding invoices grouped by due-date age.</p></div><Link to={`/invoices?clientId=${encodeURIComponent(clientId)}`} className="inline-flex items-center gap-1 text-xs font-medium text-cyan-200 hover:text-cyan-100">Open invoice list <ArrowRight className="h-3.5 w-3.5" /></Link></div><div className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-5">{["current", "30", "60", "90", "90+"].map((bucket) => <div key={bucket} className={`rounded-xl border p-3 ${agingTones[bucket]}`}><p className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-70">{bucket === "current" ? "Current" : `${bucket} days`}</p><p className="mt-2 text-sm font-semibold">{fmt$(billing.aging?.[bucket])}</p></div>)}</div></article>
        <article className="rounded-2xl border border-border/70 bg-card/80 p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Collection context</p><p className="mt-1 text-xs text-muted-foreground">Promises are operational evidence, not a payment settlement.</p></div><CheckCircle2 className="h-4 w-4 text-emerald-200" /></div>{hasPromises ? <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-emerald-200/70">Promises kept</p><p className="mt-1 text-xl font-semibold text-emerald-100">{billing.payment_promises?.kept || 0}</p></div><div className="rounded-lg border border-rose-400/20 bg-rose-400/[0.04] p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-rose-200/70">Promises broken</p><p className="mt-1 text-xl font-semibold text-rose-100">{billing.payment_promises?.broken || 0}</p></div></div> : <div className="mt-4 rounded-xl border border-dashed border-border/70 bg-muted/[0.08] p-4 text-sm text-muted-foreground">No payment promises are recorded for this client.</div>}{recurring.auto_send_attention > 0 && <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-3 text-xs leading-5 text-amber-100"><AlertCircle className="mr-1 inline h-3.5 w-3.5" />{recurring.auto_send_attention} active recurring {recurring.auto_send_attention === 1 ? "stream is" : "streams are"} set to auto-send without an invoice recipient. Review the billing defaults before the next generation.</div>}</article>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4"><div><p className="text-sm font-semibold">Recent invoices</p><p className="mt-1 text-xs text-muted-foreground">The latest customer billing records for this client.</p></div><Badge variant="outline">{(billing.recent_invoices || []).length} shown</Badge></div>{(billing.recent_invoices || []).length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="border-b border-border/60 bg-muted/[0.08] text-left text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground"><tr><th className="px-5 py-3">Invoice</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Outstanding</th><th className="px-4 py-3">Due</th><th className="px-5 py-3">Status</th></tr></thead><tbody>{billing.recent_invoices.map((invoice) => { const outstanding = Math.max(Number(invoice.total || 0) - Number(invoice.amount_paid || 0), 0); const paid = invoice.payment_status === "paid" || outstanding === 0; return <tr key={invoice.id} className="border-b border-border/50 transition-colors hover:bg-cyan-400/[0.025]" data-testid={`inv-row-${invoice.id}`}><td className="px-5 py-3"><Link to={`/invoices?invoice=${encodeURIComponent(invoice.id)}`} className="font-mono text-xs font-medium text-cyan-200 hover:text-cyan-100">{invoice.invoice_number || invoice.id}</Link></td><td className="px-4 py-3 text-right font-mono text-xs">{fmt$(invoice.total)}</td><td className="px-4 py-3 text-right font-mono text-xs">{fmt$(outstanding)}</td><td className="px-4 py-3 text-xs text-muted-foreground">{formatBillingDate(invoice.due_date)}</td><td className="px-5 py-3"><Badge variant="outline" className={paid ? "border-emerald-400/25 text-emerald-200" : "border-amber-400/25 text-amber-100"}>{paid ? "Paid" : invoice.payment_status || invoice.status || "Outstanding"}</Badge></td></tr>; })}</tbody></table></div> : <div className="p-8 text-center"><ReceiptText className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-3 font-medium">No invoice history is recorded yet.</p><p className="mt-1 text-sm text-muted-foreground">Create a recurring stream or use the invoice workspace when there is a customer-approved billing event.</p></div>}</section>

      <ClientBillingProfileDialog clientId={clientId} token={token} open={editingDefaults} onOpenChange={setEditingDefaults} onSaved={reload} />
    </div>
  );
}

/* ──────────────── ASSETS ──────────────── */
export function Client360Assets({ clientId, token }) {
  const { data, loading } = useApiGet(`/clients/${clientId}/assets-detail`, token);
  if (loading) return <Loader label="Loading assets…" />;
  if (!data?.total) return <EmptyState icon={Server} msg="No devices linked to this client." />;

  return (
    <div className="space-y-4" data-testid="client360-assets">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Total devices" value={data.total} color="sky" icon={Server} />
          <Stat label="Online" value={data.online} color="emerald" icon={CheckCircle2} />
          <Stat label="Offline" value={data.offline} color="rose" icon={AlertCircle} />
          <Stat label="Assessed" value={`${data.assessed || 0}/${data.total || 0}`} color={data.assessed ? "violet" : "zinc"} icon={ShieldCheck} />
          <Stat label="Pending updates" value={data.pending_updates || 0} color={data.pending_updates ? "amber" : "emerald"} icon={AlertCircle} />
      </div>

      <div className="text-[10px] uppercase tracking-widest text-zinc-500 mt-4">Device Families (by model)</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(data.groups || []).slice(0, 10).map((g, idx) => (
          <div key={idx} className="border border-zinc-800 rounded-md p-3 bg-zinc-950" data-testid={`asset-group-${idx}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium truncate">{g.model}</div>
              <Badge variant="outline" className="text-[10px]">×{g.count}</Badge>
            </div>
            <div className="text-xs flex items-center gap-3 text-zinc-400">
              <span className="text-emerald-400">● {g.online}</span>
              <span className="text-rose-400">● {g.offline}</span>
              {g.avg_age_years != null && <span>· ~{g.avg_age_years}y avg</span>}
            </div>
            <div className="mt-2 space-y-1">
              {(g.devices_preview || []).slice(0, 4).map((d) => (
                <div key={d.id} className="text-[11px] flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${d.status === "online" ? "bg-emerald-400" : d.status === "offline" ? "bg-rose-400" : "bg-amber-400"}`} />
                    <span className="text-zinc-300 flex-1 truncate">{d.name}</span>
                    {d.assessed && d.pending_patches > 0 && <span className="text-amber-400 font-mono text-[9px]">{d.pending_patches} upd</span>}
                  <span className="text-zinc-500 font-mono text-[9px]">{d.ip_address || "—"}</span>
                </div>
              ))}
              {g.count > 4 && <div className="text-[10px] text-zinc-500">+ {g.count - 4} more</div>}
            </div>
          </div>
        ))}
      </div>

      <Link to={`/devices?clientId=${clientId}`} className="text-xs text-indigo-400 hover:underline">Open full device list →</Link>
    </div>
  );
}

/* ──────────────── Helpers ──────────────── */
function Loader({ label }) { return <div className="py-10 flex items-center justify-center gap-2 text-sm text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" />{label}</div>; }

function EmptyState({ icon: Icon, msg }) {
  return <div className="border border-zinc-800 rounded-md p-8 text-center text-sm text-zinc-500"><Icon className="w-8 h-8 mx-auto mb-2 opacity-40" />{msg}</div>;
}

function Stat({ label, value, color = "sky", icon: Icon }) {
  return (
    <div className="border border-zinc-800 rounded-md p-3 bg-zinc-950 flex items-center gap-3">
      {Icon && <Icon className={`w-4 h-4 text-${color}-400`} />}
      <div>
        <div className={`text-[10px] uppercase tracking-widest text-${color}-400`}>{label}</div>
        <div className="text-lg font-semibold">{value}</div>
      </div>
    </div>
  );
}

function InfoTile({ icon: Icon, label, value, warnIf }) {
  const warn = typeof value === "number" && warnIf?.(value);
  const color = warn ? "amber" : "sky";
  return (
    <div className={`border border-zinc-800 rounded-md p-3 bg-zinc-950 flex items-center gap-2`}>
      <Icon className={`w-4 h-4 text-${color}-400`} />
      <div>
        <div className={`text-[10px] uppercase tracking-widest text-zinc-500`}>{label}</div>
        <div className="text-sm">{value}</div>
      </div>
    </div>
  );
}
