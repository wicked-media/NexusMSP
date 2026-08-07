import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  BookOpenCheck,
  Boxes,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  CircleDollarSign,
  ClipboardList,
  FileText,
  History,
  Laptop,
  Link2,
  Loader2,
  MapPin,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  Route,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Ticket,
  User,
  Wrench,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Progress } from "../ui/progress";
import { Textarea } from "../ui/textarea";
import ConfidenceLens from "../confidence/ConfidenceLens";


const MONEY = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const STAGE_TONE = {
  procurement: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  deployment: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  active: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  maintenance: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  decommission: "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  disposed: "border-zinc-500/25 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  unconnected: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};
const REPLACEMENT_TONE = {
  replace: "border-rose-500/25 bg-rose-500/8 text-rose-700 dark:text-rose-300",
  plan: "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-300",
  monitor: "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300",
  not_assessed: "border-zinc-500/25 bg-zinc-500/8 text-zinc-700 dark:text-zinc-300",
};
const TIMELINE_ICON = {
  procurement: ShoppingCart,
  quote: FileText,
  billing: ReceiptText,
  service: Wrench,
  warranty: ShieldCheck,
  lifecycle: Route,
  identity: Laptop,
  technical: History,
};

const dateLabel = (value) => {
  if (!value) return "Not recorded";
  try { return format(new Date(value), "d MMM yyyy"); } catch { return value; }
};
const relativeLabel = (value) => {
  if (!value) return "";
  try { return formatDistanceToNow(new Date(value), { addSuffix: true }); } catch { return ""; }
};
const cleanStoryText = (value) => String(value || "")
  .replace(/Ã‚Â·|Â·/g, "·")
  .replace(/â€”/g, "—")
  .replace(/â†’/g, "→")
  .replace(/Â/g, "");


function StoryStat({ label, value, detail, icon: Icon, tone = "emerald" }) {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300",
    cyan: "border-cyan-500/20 bg-cyan-500/[0.06] text-cyan-700 dark:text-cyan-300",
    violet: "border-violet-500/20 bg-violet-500/[0.06] text-violet-700 dark:text-violet-300",
    amber: "border-amber-500/20 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300",
  };
  return (
    <div className={`min-h-[112px] rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] opacity-80">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-current/15 bg-background/40"><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-3 text-xl font-bold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}


function EvidenceRow({ item }) {
  const ready = item.state === "verified";
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/15 p-3">
      {ready
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{item.label}</p>
          <Badge variant="outline" className={`h-5 text-[9px] uppercase ${ready ? "border-emerald-500/25 text-emerald-700 dark:text-emerald-300" : "border-amber-500/25 text-amber-700 dark:text-amber-300"}`}>
            {ready ? "Verified" : "Missing"}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{item.requirement}</p>
      </div>
    </div>
  );
}


export default function AssetStoryPanel({ device, token, API }) {
  const navigate = useNavigate();
  const [story, setStory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    purchase_date: device?.purchase_date || "",
    purchase_cost: device?.purchase_price || "",
    vendor: "",
    purchase_order_number: "",
    warranty_end: device?.warranty_expiry || "",
    expected_lifespan_months: device?.device_type === "server" ? "60" : device?.device_type === "network" ? "84" : device?.device_type === "laptop" ? "36" : "48",
    purchase_reason: "",
  });

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/devices/${device.id}/asset-story`, { headers });
      setStory(response.data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Asset Story could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [API, device.id, headers]);

  useEffect(() => { load(); }, [load]);

  const connectRecord = async (mode = "create") => {
    setSaving(true);
    try {
      const payload = mode === "link"
        ? { mode: "link", asset_id: story?.asset?.id, notes: "Confirmed serial-matched endpoint relationship" }
        : {
            mode: "create",
            ...form,
            purchase_cost: form.purchase_cost === "" ? null : Number(form.purchase_cost),
            expected_lifespan_months: Number(form.expected_lifespan_months),
          };
      const response = await axios.post(`${API}/devices/${device.id}/asset-story/connect`, payload, { headers });
      setStory(response.data.story);
      setDialogOpen(false);
      toast.success(mode === "link" ? "Asset relationship confirmed" : "Connected inventory record created");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The inventory record could not be connected");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-[320px] items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Building the connected asset story…
        </CardContent>
      </Card>
    );
  }
  if (!story) return null;

  const { asset, lifecycle, replacement, evidence, procurement, ownership, operations } = story;
  const serialMatched = story.connection?.matched_by === "serial_number" && asset?.id && asset?.device_id !== device.id;
  const warrantyText = lifecycle.warranty_days_remaining == null
    ? "Not recorded"
    : lifecycle.warranty_days_remaining < 0
      ? `Expired ${Math.abs(lifecycle.warranty_days_remaining)}d ago`
      : `${lifecycle.warranty_days_remaining}d remaining`;
  const ageText = lifecycle.age_months == null ? "Not recorded" : `${Math.floor(lifecycle.age_months / 12)}y ${Math.round(lifecycle.age_months % 12)}m`;

  return (
    <div className="space-y-4" data-testid="asset-story-panel">
      <section className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_42%)] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
              <BookOpenCheck className="h-3.5 w-3.5" /> Connected operational memory
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">Asset Story</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Why this asset exists, who owns it, what it cost, what has happened to it, and when the evidence supports replacement—all joined without inventing missing records.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/help/asset-story")}><CircleHelp className="mr-1.5 h-4 w-4" />Guide</Button>
            {asset?.id && <Button variant="outline" size="sm" onClick={() => navigate(`/assets/${asset.id}`)}><Boxes className="mr-1.5 h-4 w-4" />Open inventory record</Button>}
            <Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh evidence</Button>
            {!asset && <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="create-asset-story"><Link2 className="mr-1.5 h-4 w-4" />Connect lifecycle record</Button>}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className={STAGE_TONE[lifecycle.stage] || STAGE_TONE.unconnected}>{String(lifecycle.stage || "unconnected").replace(/_/g, " ")}</Badge>
          <span className="text-muted-foreground">Canonical register:</span>
          <span className="font-mono text-foreground">Inventory Assets</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{story.connection.connected ? `Matched by ${String(story.connection.matched_by || "record").replace("_", " ")}` : "No inventory record connected"}</span>
        </div>
      </section>

      {serialMatched && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div><p className="text-sm font-semibold">Serial match needs confirmation</p><p className="mt-1 text-xs text-muted-foreground">Nexus found inventory record {asset.asset_tag || asset.name} with the same serial. Confirm the relationship before treating it as canonical.</p></div>
          </div>
          <Button size="sm" onClick={() => connectRecord("link")} disabled={saving} data-testid="confirm-asset-story-link">{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Confirm link</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StoryStat label="Lifecycle stage" value={String(lifecycle.stage || "unconnected").replace(/_/g, " ")} detail={lifecycle.replacement_target ? `Useful-life target ${dateLabel(lifecycle.replacement_target)}` : "Useful-life target not recorded"} icon={Route} tone="emerald" />
        <StoryStat label="Asset age" value={ageText} detail={lifecycle.purchase_date ? `Purchased ${dateLabel(lifecycle.purchase_date)}` : "Add a verified purchase date"} icon={CalendarClock} tone="cyan" />
        <StoryStat label="Warranty" value={warrantyText} detail={lifecycle.warranty_end ? `Ends ${dateLabel(lifecycle.warranty_end)}` : "Add warranty evidence"} icon={ShieldCheck} tone="violet" />
        <StoryStat label="Evidence coverage" value={`${evidence.score}%`} detail={evidence.missing.length ? `Missing: ${evidence.missing.join(", ")}` : "Connected story complete"} icon={ClipboardList} tone="amber" />
      </div>

      <ConfidenceLens entityType="device" entityId={device.id} token={token} API={API} />

      {!asset && (
        <Card className="border-dashed border-emerald-500/25">
          <CardContent className="flex flex-col items-center px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/25 bg-emerald-500/10"><PackageCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-300" /></span>
            <h3 className="mt-4 text-base font-semibold">Connect this endpoint to its commercial history</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">Create the canonical inventory record from the live endpoint, then add the purchase, supplier, warranty and useful-life evidence Nexus cannot collect from the agent.</p>
            <Button className="mt-5" onClick={() => setDialogOpen(true)}><Link2 className="mr-1.5 h-4 w-4" />Create connected record</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <CardHeader className="border-b border-border/70 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">Explain why</p>
                <CardTitle className="mt-1 text-base">Replacement decision</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Lifecycle, warranty and operational evidence—not a black-box score.</p>
              </div>
              <Badge variant="outline" className={`w-fit capitalize ${REPLACEMENT_TONE[replacement.band] || REPLACEMENT_TONE.not_assessed}`}>{replacement.label}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className={`rounded-xl border p-4 ${REPLACEMENT_TONE[replacement.band] || REPLACEMENT_TONE.not_assessed}`}>
              <p className="text-sm font-semibold">{replacement.summary}</p>
              <div className="mt-3 space-y-2">
                {replacement.reasons.length
                  ? replacement.reasons.map((reason, index) => <div key={index} className="flex items-start gap-2 text-xs text-foreground/80"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />{reason}</div>)
                  : <p className="text-xs text-muted-foreground">No current replacement pressure is evidenced.</p>}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/15 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Historical cost</p><p className="mt-1 text-lg font-semibold">{replacement.historical_purchase_cost == null ? "Not recorded" : MONEY.format(replacement.historical_purchase_cost)}</p></div>
              <div className="rounded-lg border bg-muted/15 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current value</p><p className="mt-1 text-lg font-semibold">{replacement.current_value == null ? "Not assessed" : MONEY.format(replacement.current_value)}</p></div>
              <div className="rounded-lg border bg-muted/15 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Replacement quote</p><p className="mt-1 text-lg font-semibold">{replacement.replacement_quote == null ? "Not linked" : MONEY.format(replacement.replacement_quote)}</p></div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.05] p-3 text-xs text-muted-foreground"><CircleDollarSign className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-300" />{replacement.financial_comparison}</div>
            <Button variant="outline" size="sm" onClick={() => navigate("/procurement-planner")}><BadgeDollarSign className="mr-1.5 h-4 w-4" />Open refresh planner</Button>
          </CardContent>
        </Card>

        <Card className="xl:col-span-5">
          <CardHeader className="border-b border-border/70 pb-4">
            <CardTitle className="text-base">Evidence confidence</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Correct missing evidence at its source before using the story for a commercial decision.</p>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <div className="flex items-end justify-between"><div><p className="text-3xl font-bold">{evidence.score}%</p><p className="text-xs text-muted-foreground">connected coverage</p></div><ClipboardList className="h-6 w-6 text-amber-600 dark:text-amber-300" /></div>
            <Progress value={evidence.score} className="h-2" />
            <div className="grid gap-2 pt-1">{evidence.checks.map(item => <EvidenceRow key={item.label} item={item} />)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><ShoppingCart className="h-4 w-4 text-sky-600 dark:text-sky-300" />Why it was purchased</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className={procurement.purchase_reason ? "leading-relaxed" : "text-muted-foreground"}>{cleanStoryText(procurement.purchase_reason || "No purchase rationale is recorded. Add it to the inventory record so future technicians understand the decision.")}</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border bg-muted/15 p-2.5"><p className="text-muted-foreground">Supplier</p><p className="mt-1 font-medium">{procurement.vendor || "Not recorded"}</p></div>
              <div className="rounded-lg border bg-muted/15 p-2.5"><p className="text-muted-foreground">Purchase order</p><p className="mt-1 font-medium">{procurement.purchase_order_number || "Not linked"}</p></div>
            </div>
            <p className="text-xs text-muted-foreground">{procurement.purchase_orders.length} attributable PO · {procurement.estimates.length} attributable quote</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Building2 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />Custody & location</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start gap-3"><Building2 className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><p className="font-medium">{ownership.client_name || "Unassigned client"}</p><p className="text-xs text-muted-foreground">Owning client</p></div></div>
            <div className="flex items-start gap-3"><User className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><p className="font-medium">{ownership.assigned_user || "Unassigned user"}</p><p className="text-xs text-muted-foreground">Current custodian</p></div></div>
            <div className="flex items-start gap-3"><MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><p className="font-medium">{ownership.location || "Location not recorded"}</p><p className="text-xs text-muted-foreground">Physical location</p></div></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Wrench className="h-4 w-4 text-violet-600 dark:text-violet-300" />Service footprint</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border bg-muted/15 p-2.5"><p className="text-lg font-semibold">{operations.ticket_count}</p><p className="text-[10px] text-muted-foreground">Tickets</p></div>
              <div className="rounded-lg border bg-muted/15 p-2.5"><p className="text-lg font-semibold">{operations.remote_session_count}</p><p className="text-[10px] text-muted-foreground">Sessions</p></div>
              <div className="rounded-lg border bg-muted/15 p-2.5"><p className="text-lg font-semibold">{operations.event_count}</p><p className="text-[10px] text-muted-foreground">Events</p></div>
            </div>
            <p className="text-xs text-muted-foreground">{operations.tickets_90d} linked ticket{operations.tickets_90d === 1 ? "" : "s"} in the last 90 days.</p>
            <Button variant="outline" size="sm" onClick={() => navigate(`/tickets?device_id=${encodeURIComponent(device.id)}`)}><Ticket className="mr-1.5 h-4 w-4" />Review tickets</Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader className="flex-row items-start justify-between gap-3 border-b border-border/70 pb-4">
            <div><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />Connected history</CardTitle><p className="mt-1 text-xs text-muted-foreground">Purchase, warranty, service, billing and endpoint evidence in one attributable timeline.</p></div>
            <Badge variant="outline" className="text-[10px]">{story.timeline.length} records</Badge>
          </CardHeader>
          <CardContent className="p-0">
            {story.timeline.length === 0 ? <div className="px-6 py-12 text-center text-sm text-muted-foreground">No attributable history is recorded yet.</div> : (
              <div className="divide-y divide-border/60">
                {story.timeline.map((item) => {
                  const Icon = TIMELINE_ICON[item.category] || History;
                  return (
                    <button key={item.id} type="button" disabled={!item.path} onClick={() => item.path && navigate(item.path)} className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-3 text-left transition-colors enabled:hover:bg-muted/30 sm:grid-cols-[auto_minmax(0,1fr)_auto]" data-testid={`asset-story-event-${item.id}`}>
                      <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border bg-muted/30"><Icon className="h-4 w-4 text-muted-foreground" /></span>
                      <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{cleanStoryText(item.title)}</span><Badge variant="outline" className="h-5 text-[9px] capitalize">{item.state}</Badge></span><span className="mt-1 block text-xs text-muted-foreground">{cleanStoryText(item.detail)}</span></span>
                      <span className="col-start-2 text-[10px] text-muted-foreground sm:col-start-auto sm:text-right"><span className="block">{dateLabel(item.occurred_at)}</span><span className="mt-0.5 block">{relativeLabel(item.occurred_at)}</span></span>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader className="border-b border-border/70 pb-4"><CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />Commercial links</CardTitle><p className="mt-1 text-xs text-muted-foreground">Only directly attributable contract and invoice records are shown.</p></CardHeader>
          <CardContent className="space-y-2 pt-4">
            {story.commercial_links.length === 0 ? <div className="rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">No contract or invoice is directly linked to this asset.</div> : story.commercial_links.map(link => (
              <button key={`${link.type}-${link.id}`} type="button" onClick={() => navigate(link.path)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/15 p-3 text-left transition-colors hover:bg-muted/35">
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{link.label}</span><span className="mt-1 block text-[10px] uppercase tracking-wider text-muted-foreground">{link.type} · {String(link.status).replace(/_/g, " ")}</span></span>
                <span className="flex shrink-0 items-center gap-2">{link.value != null && <span className="text-xs font-semibold">{MONEY.format(link.value)}</span>}<ArrowRight className="h-4 w-4 text-muted-foreground" /></span>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border/70 bg-muted/15 p-3 text-xs text-muted-foreground">
        <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />{story.method}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" aria-describedby="asset-story-create-description">
          <DialogHeader className="border-b border-border/70 pb-4">
            <div className="flex items-start gap-3 pr-8">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10"><PackageCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-300" /></span>
              <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">Canonical lifecycle record</p><DialogTitle className="mt-1">Connect {device.name} to its Asset Story</DialogTitle><DialogDescription id="asset-story-create-description" className="mt-1">Agent data supplies the identity. Add only the commercial and lifecycle evidence a technician has verified.</DialogDescription></div>
            </div>
          </DialogHeader>
          <div className="grid gap-5 py-1 md:grid-cols-2">
            <div className="space-y-4">
              <div><p className="text-sm font-semibold">Purchase evidence</p><p className="mt-1 text-xs text-muted-foreground">Leave unknown values blank; Nexus will label them as missing.</p></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Purchase date</Label><Input type="date" value={form.purchase_date} onChange={event => setForm(prev => ({ ...prev, purchase_date: event.target.value }))} className="mt-1.5" /></div>
                <div><Label>Purchase cost (AUD)</Label><Input type="number" min="0" step="0.01" value={form.purchase_cost} onChange={event => setForm(prev => ({ ...prev, purchase_cost: event.target.value }))} placeholder="Leave blank if unknown" className="mt-1.5" /></div>
              </div>
              <div><Label>Supplier</Label><Input value={form.vendor} onChange={event => setForm(prev => ({ ...prev, vendor: event.target.value }))} placeholder="e.g. Dicker Data" className="mt-1.5" /></div>
              <div><Label>Purchase order number</Label><Input value={form.purchase_order_number} onChange={event => setForm(prev => ({ ...prev, purchase_order_number: event.target.value }))} placeholder="Link an existing Nexus PO where possible" className="mt-1.5" /></div>
            </div>
            <div className="space-y-4">
              <div><p className="text-sm font-semibold">Lifecycle evidence</p><p className="mt-1 text-xs text-muted-foreground">These values drive transparent warranty and replacement guidance.</p></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Warranty ends</Label><Input type="date" value={form.warranty_end} onChange={event => setForm(prev => ({ ...prev, warranty_end: event.target.value }))} className="mt-1.5" /></div>
                <div><Label>Useful life (months)</Label><Input type="number" min="1" max="240" value={form.expected_lifespan_months} onChange={event => setForm(prev => ({ ...prev, expected_lifespan_months: event.target.value }))} className="mt-1.5" /></div>
              </div>
              <div><Label>Why was this asset purchased?</Label><Textarea value={form.purchase_reason} onChange={event => setForm(prev => ({ ...prev, purchase_reason: event.target.value }))} placeholder="Business purpose, originating quote or project, intended user, and any agreed replacement assumptions…" className="mt-1.5 min-h-32" /></div>
              <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/[0.05] p-3 text-xs text-muted-foreground"><Sparkles className="mr-1.5 inline h-3.5 w-3.5 text-cyan-700 dark:text-cyan-300" />This creates one canonical Inventory Asset and records the signed-in technician, time, endpoint and client.</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={() => connectRecord("create")} disabled={saving || !form.expected_lifespan_months} data-testid="save-asset-story">{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 className="mr-1.5 h-4 w-4" />}Create connected record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
