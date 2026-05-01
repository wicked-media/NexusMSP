import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  TrendingUp, RefreshCw, Loader2, Sparkles, DollarSign, Target, Search,
  Award, AlertTriangle, CheckCircle2, XCircle, Copy, FileText, Mail,
  ChevronRight, Filter,
} from "lucide-react";

function fmtUSD(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

const STATUS_CLS = {
  new:       "text-sky-400 border-sky-500/30 bg-sky-500/5",
  quoted:    "text-violet-400 border-violet-500/30 bg-violet-500/5",
  won:       "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
  lost:      "text-rose-400 border-rose-500/30 bg-rose-500/5",
  dismissed: "text-zinc-500 border-zinc-500/30 bg-zinc-500/5",
};

const CATEGORY_ICON = {
  Hardware: "📦",
  Security: "🔒",
  "Data Protection": "💾",
  Contracts: "📄",
  Other: "✨",
};

export default function GrowthPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [summary, setSummary] = useState(null);
  const [opps, setOpps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [statusFilter, setStatusFilter] = useState("new,quoted");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, o] = await Promise.all([
        axios.get(`${API}/growth/summary`, { headers }),
        axios.get(`${API}/growth/opportunities?status=${encodeURIComponent(statusFilter)}`, { headers }),
      ]);
      setSummary(s.data);
      setOpps(o.data || []);
    } catch (e) {
      toast.error("Load failed: " + (e.response?.data?.detail || e.message));
    } finally { setLoading(false); }
  }, [headers, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await axios.post(`${API}/growth/scan`, {}, { headers });
      toast.success(`Scan complete · ${res.data.opportunities_created} opportunities · ${fmtUSD(res.data.pipeline_value)} pipeline`);
      load();
    } catch (e) { toast.error("Scan failed: " + (e.response?.data?.detail || e.message)); }
    finally { setScanning(false); }
  };

  const filtered = useMemo(() => {
    let arr = opps;
    if (categoryFilter !== "all") arr = arr.filter(o => o.category === categoryFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter(o => [o.title, o.client_name, o.summary, o.category].some(v => (v || "").toLowerCase().includes(q)));
    }
    return arr;
  }, [opps, categoryFilter, search]);

  const categories = useMemo(() => {
    const set = new Set(opps.map(o => o.category).filter(Boolean));
    return Array.from(set);
  }, [opps]);

  return (
    <div className="p-6 space-y-5" data-testid="growth-page">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-light tracking-tight flex items-center gap-3">
            <TrendingUp className="w-7 h-7 text-emerald-500" />
            Revenue Growth
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-ranked upsell opportunities mined from every client's environment. Pipeline-driven, not gut-driven.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={runScan}
            disabled={scanning}
            variant="outline"
            className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
            data-testid="growth-scan-btn"
          >
            {scanning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {scanning ? "Scanning…" : "Run scan"}
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Open pipeline"
          value={fmtUSD(summary?.pipeline_value)}
          sub={summary ? `${summary.by_status?.new || 0} new · ${summary.by_status?.quoted || 0} quoted` : "—"}
          accent="emerald"
          icon={<DollarSign className="w-4 h-4" />}
          testid="growth-kpi-pipeline"
        />
        <KpiCard
          label="Won (all-time)"
          value={fmtUSD(summary?.won_value)}
          sub={`${summary?.by_status?.won || 0} deals`}
          accent="violet"
          icon={<Award className="w-4 h-4" />}
          testid="growth-kpi-won"
        />
        <KpiCard
          label="Top category"
          value={summary && Object.keys(summary.by_category || {}).length
            ? Object.entries(summary.by_category).sort((a, b) => b[1] - a[1])[0][0]
            : "—"}
          sub={summary ? fmtUSD(Object.values(summary.by_category || {}).sort((a, b) => b - a)[0] || 0) : ""}
          accent="cyan"
          icon={<Target className="w-4 h-4" />}
          testid="growth-kpi-top-cat"
        />
        <KpiCard
          label="Last scan"
          value={summary?.last_scan_at ? new Date(summary.last_scan_at).toLocaleString() : "Never"}
          sub={summary?.last_scan_by ? `by ${summary.last_scan_by}` : ""}
          accent="zinc"
          icon={<RefreshCw className="w-4 h-4" />}
          testid="growth-kpi-scan"
        />
      </div>

      {/* Top clients */}
      {summary?.top_clients?.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Top clients by pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {summary.top_clients.slice(0, 5).map(c => (
                <div key={c.client_id} className="border border-border rounded-md px-3 py-2">
                  <div className="text-sm font-medium truncate">{c.client_name}</div>
                  <div className="text-emerald-400 text-sm font-mono">{fmtUSD(c.value)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8 w-64" placeholder="Search title, client, summary…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="growth-search" />
            </div>
            <Tabs value={statusFilter} onValueChange={setStatusFilter}>
              <TabsList className="bg-muted/40">
                <TabsTrigger value="new,quoted" data-testid="growth-filter-active">Active</TabsTrigger>
                <TabsTrigger value="new" data-testid="growth-filter-new">New</TabsTrigger>
                <TabsTrigger value="quoted" data-testid="growth-filter-quoted">Quoted</TabsTrigger>
                <TabsTrigger value="won" data-testid="growth-filter-won">Won</TabsTrigger>
                <TabsTrigger value="lost,dismissed" data-testid="growth-filter-closed">Lost/Dismissed</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-1 ml-auto">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <Button size="sm" variant={categoryFilter === "all" ? "outline" : "ghost"} className={categoryFilter === "all" ? "text-indigo-400 border-indigo-500/40 bg-indigo-500/10" : ""} onClick={() => setCategoryFilter("all")}>All</Button>
              {categories.map(cat => (
                <Button key={cat} size="sm" variant={categoryFilter === cat ? "outline" : "ghost"} className={categoryFilter === cat ? "text-indigo-400 border-indigo-500/40 bg-indigo-500/10" : ""} onClick={() => setCategoryFilter(cat)}>{CATEGORY_ICON[cat] || "✨"} {cat}</Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-16 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading opportunities…</div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center text-sm text-muted-foreground">
              {opps.length === 0
                ? "No opportunities yet. Click 'Run scan' to detect upsell potential across every client."
                : "No opportunities match your filter."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Opportunity</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Monthly</TableHead>
                  <TableHead className="text-right">One-time</TableHead>
                  <TableHead className="text-right">Annual</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(o => (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelected(o)} data-testid={`growth-opp-row-${o.id}`}>
                    <TableCell>
                      <div className="text-sm font-medium">{o.title}</div>
                      <div className="text-[11px] text-muted-foreground line-clamp-1">{o.summary}</div>
                    </TableCell>
                    <TableCell className="text-sm">{o.client_name}</TableCell>
                    <TableCell className="text-xs">{CATEGORY_ICON[o.category] || "✨"} {o.category}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{o.monthly_value ? fmtUSD(o.monthly_value) + "/mo" : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{o.one_time_value ? fmtUSD(o.one_time_value) : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-emerald-400">{fmtUSD(o.annual_value)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-14 bg-zinc-700 rounded-full overflow-hidden">
                          <div className="h-full bg-violet-500" style={{ width: `${o.priority}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground">{o.priority}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${STATUS_CLS[o.status]} text-[10px]`}>{o.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail drawer */}
      <OpportunityDrawer
        opp={selected}
        onClose={() => setSelected(null)}
        onUpdate={async () => { await load(); /* re-fetch fresh state */ }}
        headers={headers}
      />
    </div>
  );
}

function KpiCard({ label, value, sub, accent = "zinc", icon, testid }) {
  const colour = {
    emerald: "text-emerald-400 border-emerald-500/30",
    violet:  "text-violet-400 border-violet-500/30",
    cyan:    "text-cyan-400 border-cyan-500/30",
    zinc:    "text-zinc-400 border-zinc-500/30",
  }[accent];
  return (
    <Card data-testid={testid}>
      <CardContent className="p-4">
        <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-widest ${colour}`}>
          {icon}{label}
        </div>
        <div className="text-2xl mt-1 font-light">{value}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}

function OpportunityDrawer({ opp, onClose, onUpdate, headers }) {
  const [localOpp, setLocalOpp] = useState(opp);
  const [notes, setNotes] = useState("");
  const [quotedValue, setQuotedValue] = useState("");
  const [pitching, setPitching] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    setLocalOpp(opp);
    setNotes(opp?.notes || "");
    setQuotedValue(opp?.quoted_value || "");
  }, [opp]);

  if (!opp) return null;

  const setStatus = async (status) => {
    setUpdating(true);
    try {
      const body = { status };
      if (notes) body.notes = notes;
      if (quotedValue) body.quoted_value = Number(quotedValue);
      const res = await axios.patch(`${API}/growth/opportunities/${opp.id}`, body, { headers });
      setLocalOpp(res.data.opportunity);
      toast.success(`Marked ${status}`);
      onUpdate();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setUpdating(false); }
  };

  const generatePitch = async () => {
    setPitching(true);
    try {
      const res = await axios.post(`${API}/growth/opportunities/${opp.id}/pitch`, {}, { headers });
      if (res.data?.success) {
        setLocalOpp(prev => ({ ...prev, pitch: res.data.pitch }));
        toast.success("Pitch drafted");
      } else {
        toast.error(res.data?.message || "Pitch failed");
      }
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setPitching(false); }
  };

  const pitch = localOpp?.pitch;

  return (
    <Sheet open={!!opp} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-[640px] overflow-y-auto" data-testid="growth-opp-drawer">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-lg flex items-center gap-2">
            {CATEGORY_ICON[opp.category] || "✨"} {opp.title}
          </SheetTitle>
          <SheetDescription>
            {opp.client_name} · <Badge variant="outline" className={`${STATUS_CLS[localOpp?.status || opp.status]} text-[10px] ml-1`}>{localOpp?.status || opp.status}</Badge>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="border border-border rounded-md p-2">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Monthly</div>
              <div className="text-lg text-emerald-400 font-mono">{opp.monthly_value ? fmtUSD(opp.monthly_value) : "—"}</div>
            </div>
            <div className="border border-border rounded-md p-2">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">One-time</div>
              <div className="text-lg text-emerald-400 font-mono">{opp.one_time_value ? fmtUSD(opp.one_time_value) : "—"}</div>
            </div>
            <div className="border border-border rounded-md p-2">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Annual</div>
              <div className="text-lg text-emerald-400 font-mono">{fmtUSD(opp.annual_value)}</div>
            </div>
          </div>

          <div className="bg-muted/40 border border-border rounded-md p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Summary</div>
            <p className="text-sm">{opp.summary}</p>
          </div>

          <div className="bg-muted/40 border border-border rounded-md p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Evidence</div>
            <pre className="text-[10px] font-mono whitespace-pre-wrap max-h-48 overflow-auto text-muted-foreground">{JSON.stringify(opp.evidence, null, 2)}</pre>
          </div>

          <div className="bg-violet-500/5 border border-violet-500/20 rounded-md p-3">
            <div className="text-[10px] uppercase tracking-widest text-violet-300 mb-1">Suggested action</div>
            <p className="text-sm">{opp.suggested_action}</p>
          </div>

          {/* AI pitch */}
          <div className="border border-border rounded-md">
            <div className="px-3 py-2 border-b border-border flex items-center gap-2 bg-muted/30">
              <Sparkles className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">AI-drafted pitch</span>
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="outline" onClick={generatePitch} disabled={pitching} className="h-7 text-[11px]" data-testid="growth-pitch-btn">
                  {pitching ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Mail className="w-3 h-3 mr-1" />}
                  {pitch ? "Regenerate" : "Draft email"}
                </Button>
                {pitch && (
                  <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(pitch); toast.success("Pitch copied"); }} className="h-7 text-[11px]">
                    <Copy className="w-3 h-3 mr-1" />Copy
                  </Button>
                )}
              </div>
            </div>
            <div className="p-3 text-sm min-h-[80px] whitespace-pre-wrap" data-testid="growth-pitch-body">
              {pitch || <span className="text-muted-foreground">Click "Draft email" to generate a tailored pitch using Claude Sonnet.</span>}
            </div>
          </div>

          {/* Notes + quoted value */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Quoted value ($)</label>
              <Input
                type="number"
                value={quotedValue}
                onChange={(e) => setQuotedValue(e.target.value)}
                placeholder={`Suggested: ${opp.annual_value}`}
                data-testid="growth-quoted-value"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Meeting notes, objections, next-steps…" rows={3} data-testid="growth-notes" />
            </div>
          </div>

          {/* Status actions */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            <Button size="sm" variant="outline" className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10" onClick={() => setStatus("quoted")} disabled={updating} data-testid="growth-mark-quoted">
              <FileText className="w-3.5 h-3.5 mr-1" />Mark quoted
            </Button>
            <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => setStatus("won")} disabled={updating} data-testid="growth-mark-won">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />Won
            </Button>
            <Button size="sm" variant="outline" className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10" onClick={() => setStatus("lost")} disabled={updating} data-testid="growth-mark-lost">
              <XCircle className="w-3.5 h-3.5 mr-1" />Lost
            </Button>
            <Button size="sm" variant="ghost" className="text-zinc-400" onClick={() => setStatus("dismissed")} disabled={updating} data-testid="growth-mark-dismissed">
              Dismiss
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>Close</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
