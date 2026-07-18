import { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, Boxes, Server, Cloud, ShieldCheck, ShieldAlert, DollarSign, TrendingUp, AlertCircle, CheckCircle2, Users, KeyRound, Percent, ListChecks, ReceiptText, Activity } from "lucide-react";
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
  useEffect(() => {
    if (!url || !token) { setLoading(false); return; }
    setLoading(true);
    axios.get(`${API}${url}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [url, token]);
  return { data, loading };
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
                        <td className="p-2"><Badge variant="outline" className="text-[10px]">{s.source_label}</Badge></td>
                        <td className="p-2">{s.product}</td>
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
  "cipp":   { label: "CIPP 7-Dimension",    icon: Cloud },
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
              <Stat label="CIPP hygiene" value={s.cipp_hygiene != null ? `${s.cipp_hygiene}/100` : "—"} color={hygColor} icon={ShieldCheck} />
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
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">CIPP 7-dimension scoring</div>
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
              <Link to="/cipp" className="text-xs text-indigo-400 hover:underline">Manage in CIPP →</Link>
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
const BILL_META = {
  "stats":    { label: "Billing Stats",     icon: DollarSign },
  "aging":    { label: "AR Aging",          icon: Activity },
  "promises": { label: "Payment Promises",  icon: CheckCircle2 },
  "invoices": { label: "Recent Invoices",   icon: ReceiptText },
};
const BILL_LAYOUT = [
  { i: "stats",    x: 0, y: 0, w: 12, h: 2, minH: 2, minW: 6 },
  { i: "aging",    x: 0, y: 2, w: 8,  h: 3, minH: 2, minW: 4 },
  { i: "promises", x: 8, y: 2, w: 4,  h: 3, minH: 2, minW: 3 },
  { i: "invoices", x: 0, y: 5, w: 12, h: 7, minH: 4, minW: 6 },
];

export function Client360Billing({ clientId, token }) {
  const { data, loading } = useApiGet(`/clients/${clientId}/billing-detail`, token);
  const grid = useWidgetGrid({
    storageKey: "nx-c360-billing-layout-v1",
    hiddenKey:  "nx-c360-billing-hidden-v1",
    defaultLayout: BILL_LAYOUT,
    widgetMeta: BILL_META,
    label: "Billing",
  });
  if (loading) return <Loader label="Reading billing…" />;
  const b = data || {};
  const hasPromises = b.payment_promises && (b.payment_promises.kept + b.payment_promises.broken > 0);

  return (
    <div className="space-y-3" data-testid="client360-billing">
      <grid.EditBar testIdPrefix="c360-billing-" />
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
              <Stat label="Open balance" value={fmt$(b.open_balance)} color={b.open_balance > 0 ? "amber" : "emerald"} icon={DollarSign} />
              <Stat label="Overdue 90+" value={fmt$(b.overdue_balance)} color={b.overdue_balance > 0 ? "rose" : "emerald"} icon={AlertCircle} />
              <Stat label="MRR" value={fmt$(b.mrr_aud)} color="emerald" icon={TrendingUp} />
              <Stat label="LTV" value={fmt$(b.ltv_aud)} color="violet" icon={CheckCircle2} />
            </div>
          </div>
        )}
        {!grid.hiddenWidgets.has("aging") && (
          <div key="aging" className="nx-widget-card">
            <grid.HideBtn id="aging" />
            <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950 h-full">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3">AR Aging</div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                {["current", "30", "60", "90+"].map((k) => {
                  const v = b.aging?.[k] || 0;
                  const color = k === "current" ? "emerald" : k === "30" ? "sky" : k === "60" ? "amber" : "rose";
                  return (
                    <div key={k} className={`border border-${color}-500/30 rounded p-2 text-center`}>
                      <div className={`text-[10px] uppercase tracking-widest text-${color}-400`}>{k === "current" ? "Current" : `${k} days`}</div>
                      <div className="text-sm font-semibold mt-1">{fmt$(v)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {!grid.hiddenWidgets.has("promises") && hasPromises && (
          <div key="promises" className="nx-widget-card">
            <grid.HideBtn id="promises" />
            <div className="border border-zinc-800 rounded-md p-3 bg-zinc-950 h-full flex flex-col gap-2 justify-center">
              <span className="text-zinc-500 uppercase tracking-widest text-[10px]">Payment promises</span>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">Kept {b.payment_promises.kept}</Badge>
                <Badge variant="outline" className="text-rose-400 border-rose-500/30">Broken {b.payment_promises.broken}</Badge>
              </div>
            </div>
          </div>
        )}
        {!grid.hiddenWidgets.has("invoices") && (
          <div key="invoices" className="nx-widget-card">
            <grid.HideBtn id="invoices" />
            <div className="border border-zinc-800 rounded-md bg-zinc-950 overflow-hidden h-full">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
                <span>Recent invoices ({(b.recent_invoices || []).length})</span>
                <Link to={`/invoices?clientId=${clientId}`} className="text-indigo-400 hover:underline normal-case tracking-normal">Open full list →</Link>
              </div>
              <div className="overflow-auto" style={{ maxHeight: "calc(100% - 40px)" }}>
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800 sticky top-0 bg-zinc-950">
                    <tr>
                      <th className="p-2 text-left">Invoice</th>
                      <th className="p-2 text-right">Total</th>
                      <th className="p-2 text-right">Paid</th>
                      <th className="p-2 text-left">Due</th>
                      <th className="p-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(b.recent_invoices || []).map((i) => (
                      <tr key={i.id} className="border-b border-zinc-900 hover:bg-zinc-900/50" data-testid={`inv-row-${i.id}`}>
                        <td className="p-2 font-mono text-[10px]">{i.invoice_number}</td>
                        <td className="p-2 text-right">{fmt$(i.total)}</td>
                        <td className="p-2 text-right text-emerald-400">{fmt$(i.amount_paid || 0)}</td>
                        <td className="p-2 text-zinc-400 text-[10px]">{i.due_date ? new Date(i.due_date).toLocaleDateString() : "—"}</td>
                        <td className="p-2"><Badge variant="outline" className={`text-[10px] ${i.payment_status === "paid" ? "text-emerald-400 border-emerald-500/30" : "text-amber-400 border-amber-500/30"}`}>{i.payment_status}</Badge></td>
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
