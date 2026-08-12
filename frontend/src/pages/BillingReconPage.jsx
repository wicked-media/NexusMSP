import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  Loader2,
  Receipt,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import { API, useAuth } from "@/App";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const FOCUS_LABELS = {
  all: "All findings",
  time: "Unbilled time",
  products: "Uninvoiced products",
  overages: "Contract overages",
  overdue: "Overdue invoices",
  suppliers: "Supplier variances",
};

const money = (value) => Number(value || 0).toLocaleString(undefined, {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactMoney = (value) => `$${Number(value || 0).toLocaleString(undefined, {
  maximumFractionDigits: 0,
})}`;

function ReviewSection({ icon: Icon, title, subtitle, tone = "cyan", actionLabel, onAction, children, testId }) {
  const tones = {
    amber: "border-amber-500/20 bg-amber-500/[0.025] text-amber-300",
    cyan: "border-cyan-500/20 bg-cyan-500/[0.025] text-cyan-300",
    violet: "border-violet-500/20 bg-violet-500/[0.025] text-violet-300",
    rose: "border-rose-500/20 bg-rose-500/[0.025] text-rose-300",
    emerald: "border-emerald-500/20 bg-emerald-500/[0.025] text-emerald-300",
  };
  return (
    <Card className={`overflow-hidden ${tones[tone] || tones.cyan}`} data-testid={testId}>
      <CardHeader className="border-b border-white/[0.06] bg-black/10 px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-current/[0.06]">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" onClick={onAction}>
            {actionLabel}<ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="divide-y divide-white/[0.055] p-0">{children}</CardContent>
    </Card>
  );
}

function EmptyReview({ focus, onOpen, sourceLabel }) {
  return (
    <Card className="border-emerald-500/20 bg-emerald-500/[0.025]" data-testid="billing-recon-empty">
      <CardContent className="flex flex-col items-center px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/25 bg-emerald-500/10">
          <CheckCircle2 className="h-6 w-6 text-emerald-300" />
        </span>
        <h2 className="mt-4 text-lg font-semibold">No {FOCUS_LABELS[focus].toLowerCase()} need attention</h2>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Nexus has not found an unresolved billing exception in this view. The source ledger remains available for audit.
        </p>
        {onOpen && (
          <Button variant="outline" size="sm" className="mt-5 gap-1.5" onClick={onOpen}>
            Open {sourceLabel}<ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function BillingReconPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [focus, setFocus] = useState("all");
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await axios.get(`${API}/billing-recon/overview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(res.data);
      if (!initial) toast.success("Billing reconciliation refreshed");
    } catch {
      toast.error("Failed to load billing reconciliation");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { fetchData(true); }, [fetchData]);

  const d = data || {};
  const unbilledTime = d.unbilled_time || {};
  const products = d.uninvoiced_products || {};
  const overages = d.contract_overages || [];
  const overdue = d.overdue_invoices || {};
  const supplierVariances = d.supplier_invoice_variances || {};
  const needle = search.trim().toLowerCase();
  const matches = (...values) => !needle || values.filter(Boolean).join(" ").toLowerCase().includes(needle);

  const timeEntries = useMemo(
    () => (unbilledTime.entries || []).filter((entry) => matches(
      entry.description,
      entry.user_name,
      entry.client_name,
      entry.ticket_number,
      entry.ticket_title,
    )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unbilledTime.entries, needle],
  );
  const productTickets = useMemo(
    () => (products.tickets || []).filter((ticket) => matches(
      ticket.ticket_number,
      ticket.title,
      ticket.client_name,
      ...(ticket.products || []).map((product) => product.name || product.description),
    )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products.tickets, needle],
  );
  const contractOverages = useMemo(
    () => overages.filter((item) => matches(item.contract_name, item.client_name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overages, needle],
  );
  const overdueInvoices = useMemo(
    () => (overdue.invoices || []).filter((invoice) => matches(
      invoice.invoice_number,
      invoice.client_name,
      invoice.due_date,
    )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overdue.invoices, needle],
  );
  const purchaseOrders = useMemo(
    () => (supplierVariances.purchase_orders || []).filter((po) => matches(
      po.po_number,
      po.vendor,
      po.vendor_invoice_match?.invoice_number,
    )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supplierVariances.purchase_orders, needle],
  );

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-amber-300" /></div>;
  }

  const actionCount = d.action_count ?? (
    Number(unbilledTime.total_entries || 0)
    + Number(products.total_tickets || 0)
    + overages.length
    + Number(overdue.total_count || 0)
    + Number(supplierVariances.total_count || 0)
  );
  const visibleSections = {
    time: focus === "all" || focus === "time",
    products: focus === "all" || focus === "products",
    overages: focus === "all" || focus === "overages",
    overdue: focus === "all" || focus === "overdue",
    suppliers: focus === "all" || focus === "suppliers",
  };
  const visibleFindingCount = (
    (visibleSections.time ? timeEntries.length : 0)
    + (visibleSections.products ? productTickets.length : 0)
    + (visibleSections.overages ? contractOverages.length : 0)
    + (visibleSections.overdue ? overdueInvoices.length : 0)
    + (visibleSections.suppliers ? purchaseOrders.length : 0)
  );
  const sourceForFocus = {
    all: ["/billing-dashboard", "billing workspace"],
    time: ["/time-tracking", "time tracking"],
    products: ["/tickets", "ticket billing"],
    overages: ["/contracts", "contracts"],
    overdue: ["/invoices", "invoices"],
    suppliers: ["/purchase-orders", "purchase orders"],
  };
  const generatedAt = d.generated_at ? new Date(d.generated_at) : null;
  const reconciliationSignal = (overdue.total_count || 0) > 0
    ? "critical"
    : actionCount > 0
      ? "attention"
      : "healthy";

  return (
    <div className="nx-page-stage space-y-5" data-testid="billing-recon-page">
      <OperationalPageHeader
        eyebrow="Revenue assurance"
        title="Billing reconciliation"
        description="Find recoverable work, validate source evidence and resolve billing leakage from one auditable queue."
        icon={Receipt}
        tone="amber"
        signal={reconciliationSignal}
        actions={(
          <>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => navigate("/invoices")}>
              <FileText className="h-3.5 w-3.5" />Invoices
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => fetchData(false)} disabled={refreshing} data-testid="billing-recon-refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh
            </Button>
          </>
        )}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <HeroTile label="Recoverable revenue" value={compactMoney(d.total_recoverable)} icon={DollarSign} glow="emerald" animated={false} subtitle={`${actionCount} findings`} onClick={() => setFocus("all")} active={focus === "all"} testId="recon-metric-recoverable" />
        <HeroTile label="Unbilled time" value={compactMoney(unbilledTime.total_amount)} icon={Clock} glow="amber" animated={false} subtitle={`${unbilledTime.total_entries || 0} entries`} onClick={() => setFocus("time")} active={focus === "time"} testId="recon-metric-time" />
        <HeroTile label="Uninvoiced products" value={compactMoney(products.total_amount)} icon={FileText} glow="cyan" animated={false} subtitle={`${products.total_tickets || 0} tickets`} onClick={() => setFocus("products")} active={focus === "products"} testId="recon-metric-products" />
        <HeroTile label="Contract overages" value={overages.length} icon={TrendingUp} glow="violet" subtitle="Clients over hours" onClick={() => setFocus("overages")} active={focus === "overages"} testId="recon-metric-overages" />
        <HeroTile label="Overdue invoices" value={compactMoney(overdue.total_amount)} icon={AlertTriangle} glow={(overdue.total_count || 0) > 0 ? "rose" : "emerald"} animated={false} subtitle={`${overdue.total_count || 0} invoices`} onClick={() => setFocus("overdue")} active={focus === "overdue"} testId="recon-metric-overdue" />
        <HeroTile label="Supplier variances" value={compactMoney(supplierVariances.total_amount)} icon={Receipt} glow={(supplierVariances.total_count || 0) > 0 ? "amber" : "emerald"} animated={false} subtitle={`${supplierVariances.total_count || 0} POs`} onClick={() => setFocus("suppliers")} active={focus === "suppliers"} testId="recon-metric-supplier-variance" />
      </div>

      <Card className="border-white/[0.08] bg-white/[0.018]" data-testid="billing-recon-controls">
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-amber-500/25 bg-amber-500/[0.06] text-amber-200">
              <SlidersHorizontal className="mr-1.5 h-3 w-3" />{FOCUS_LABELS[focus]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {visibleFindingCount} shown
              {generatedAt && <> &middot; checked {generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</>}
            </span>
            {Number(unbilledTime.ready_entries || 0) > 0 && (
              <Badge variant="outline" className="border-emerald-500/25 text-emerald-300">
                {unbilledTime.ready_entries} time entries ready
              </Badge>
            )}
            {Number(unbilledTime.missing_rate_count || 0) > 0 && (
              <Badge variant="outline" className="border-rose-500/25 text-rose-300">
                {unbilledTime.missing_rate_count} missing rates
              </Badge>
            )}
          </div>
          <div className="flex w-full items-center gap-2 lg:w-auto">
            <div className="relative min-w-0 flex-1 lg:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search clients, tickets, invoices or suppliers..."
                className="h-9 pl-9 text-sm"
                data-testid="billing-recon-search"
              />
            </div>
            {(focus !== "all" || search) && (
              <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setFocus("all"); setSearch(""); }}>
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4" data-testid="billing-recon-review-queue">
        {visibleSections.time && timeEntries.length > 0 && (
          <ReviewSection
            icon={Clock}
            title={`Unbilled time entries (${timeEntries.length})`}
            subtitle="Validate duration, billing rate and client/ticket links before creating an invoice."
            tone="amber"
            actionLabel="Open time tracking"
            onAction={() => navigate("/time-tracking")}
            testId="recon-section-time"
          >
            {timeEntries.map((entry, index) => {
              const issues = entry.readiness_issues || [];
              return (
                <div key={entry.id || `time-${index}`} className="grid gap-3 px-5 py-4 transition-colors hover:bg-white/[0.025] md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{entry.description || "Time entry"}</p>
                      <Badge variant="outline" className={`text-[10px] ${entry.billing_ready ? "border-emerald-500/25 text-emerald-300" : "border-amber-500/25 text-amber-300"}`}>
                        {entry.billing_ready ? "Ready to invoice" : `Needs ${issues.map((issue) => issue.replaceAll("_", " ")).join(", ")}`}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {entry.user_name || "Unassigned technician"} &middot; {entry.client_name || "Client not linked"} &middot; {entry.date || "No date"}
                    </p>
                  </div>
                  <div className="text-left md:text-right">
                    <p className="font-mono text-sm font-semibold text-amber-300">{money(entry.total_amount)}</p>
                    <p className="text-[11px] text-muted-foreground">{Number(entry.hours || 0).toFixed(2)}h at {money(entry.rate)}/h</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => navigate(`/time-tracking?entry=${encodeURIComponent(entry.id)}`)}
                    data-testid={`review-time-entry-${entry.id}`}
                  >
                    Review<ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </ReviewSection>
        )}

        {visibleSections.products && productTickets.length > 0 && (
          <ReviewSection
            icon={FileText}
            title={`Ticket products awaiting invoice (${productTickets.length})`}
            subtitle="Review product quantities and convert the linked ticket items into an auditable invoice."
            tone="cyan"
            actionLabel="Open tickets"
            onAction={() => navigate("/tickets")}
            testId="recon-section-products"
          >
            {productTickets.map((ticket, index) => {
              const productTotal = (ticket.products || []).reduce(
                (sum, product) => sum + Number(product.price || 0) * Number(product.quantity || 1),
                0,
              );
              return (
                <div key={ticket.id || `product-${index}`} className="grid gap-3 px-5 py-4 transition-colors hover:bg-white/[0.025] md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{ticket.ticket_number || "Ticket"} &middot; {ticket.title || "Product work"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{ticket.client_name || "Client not linked"} &middot; {(ticket.products || []).length} product line{(ticket.products || []).length === 1 ? "" : "s"}</p>
                  </div>
                  <p className="font-mono text-sm font-semibold text-cyan-300">{money(productTotal)}</p>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => navigate(`/tickets?ticket=${encodeURIComponent(ticket.id)}`)}>
                    Build invoice<ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </ReviewSection>
        )}

        {visibleSections.overages && contractOverages.length > 0 && (
          <ReviewSection
            icon={TrendingUp}
            title={`Contract hour overages (${contractOverages.length})`}
            subtitle="Confirm usage evidence and move approved excess hours into the next billing run."
            tone="violet"
            actionLabel="Open contracts"
            onAction={() => navigate("/contracts")}
            testId="recon-section-overages"
          >
            {contractOverages.map((item, index) => (
              <div key={item.contract_id || `overage-${index}`} className="grid gap-3 px-5 py-4 transition-colors hover:bg-white/[0.025] md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.contract_name || "Contract"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Used {item.hours_used}h of {item.included_hours}h included &middot; {item.overage_hours}h over</p>
                </div>
                <p className="font-mono text-sm font-semibold text-violet-300">{money(item.overage_value)}</p>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => navigate(`/contracts?contract=${encodeURIComponent(item.contract_id)}`)}>
                  Review contract<ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </ReviewSection>
        )}

        {visibleSections.overdue && overdueInvoices.length > 0 && (
          <ReviewSection
            icon={AlertTriangle}
            title={`Overdue invoices (${overdueInvoices.length})`}
            subtitle="Open the source invoice to record payment, resend it or continue the collections workflow."
            tone="rose"
            actionLabel="Open invoices"
            onAction={() => navigate("/invoices")}
            testId="recon-section-overdue"
          >
            {overdueInvoices.map((invoice, index) => (
              <div key={invoice.id || `invoice-${index}`} className="grid gap-3 px-5 py-4 transition-colors hover:bg-white/[0.025] md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{invoice.invoice_number || "Invoice"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{invoice.client_name || "Client not linked"} &middot; due {invoice.due_date || "date missing"}</p>
                </div>
                <p className="font-mono text-sm font-semibold text-rose-300">{money(invoice.total)}</p>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => navigate(`/invoices?invoice=${encodeURIComponent(invoice.id)}`)}>
                  Resolve<ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </ReviewSection>
        )}

        {visibleSections.suppliers && purchaseOrders.length > 0 && (
          <ReviewSection
            icon={Receipt}
            title={`Supplier invoice variances (${purchaseOrders.length})`}
            subtitle="Compare the supplier invoice to the purchase order and retain the approval evidence."
            tone="amber"
            actionLabel="Open purchase orders"
            onAction={() => navigate("/purchase-orders")}
            testId="recon-section-suppliers"
          >
            {purchaseOrders.map((po, index) => {
              const match = po.vendor_invoice_match || {};
              const review = match.review;
              return (
                <div key={po.id || `supplier-${index}`} className="grid gap-3 px-5 py-4 transition-colors hover:bg-white/[0.025] md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{po.po_number || "Purchase order"} &middot; {po.vendor || "Supplier"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Invoice {match.invoice_number || "not recorded"} &middot; {review ? (review.status === "accepted" ? "Accepted variance" : "Supplier follow-up") : "Review required"}</p>
                  </div>
                  <p className="font-mono text-sm font-semibold text-amber-300">{match.variance > 0 ? "+" : "-"}{money(Math.abs(match.variance || 0))}</p>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => navigate(`/purchase-orders?po=${encodeURIComponent(po.id)}`)}>
                    Reconcile<ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </ReviewSection>
        )}

        {visibleFindingCount === 0 && (
          <EmptyReview
            focus={focus}
            sourceLabel={sourceForFocus[focus][1]}
            onOpen={() => navigate(sourceForFocus[focus][0])}
          />
        )}
      </div>
    </div>
  );
}
