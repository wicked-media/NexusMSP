import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { formatDistanceToNow } from "date-fns";
import { API, useAuth } from "@/App";
import HeroTile from "@/components/HeroTile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, Clock3, Loader2, ShieldCheck, Sparkles, Users } from "lucide-react";

const CATEGORY_STYLE = {
  service: "border-indigo-400/25 bg-indigo-400/10 text-indigo-200",
  communication: "border-sky-400/25 bg-sky-400/10 text-sky-200",
  asset: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200",
  remote: "border-violet-400/25 bg-violet-400/10 text-violet-200",
  automation: "border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-200",
  backup: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  finance: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  documentation: "border-teal-400/25 bg-teal-400/10 text-teal-200",
  governance: "border-orange-400/25 bg-orange-400/10 text-orange-200",
  platform: "border-zinc-400/25 bg-zinc-400/10 text-zinc-200",
};

const label = (value) => String(value || "platform").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const relativeTime = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? formatDistanceToNow(date, { addSuffix: true }) : "Time not recorded";
};

export default function ClientWhatChangedPage({ embedded = false }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [days, setDays] = useState("30");
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    axios.get(`${API}/clients`, { headers }).then((response) => setClients(response.data || [])).catch(() => setError("Clients could not be loaded."));
  }, [headers]);

  useEffect(() => {
    if (!clientId) { setBrief(null); return; }
    setLoading(true);
    setError("");
    axios.get(`${API}/clients/${clientId}/what-changed?days=${days}`, { headers })
      .then((response) => setBrief(response.data))
      .catch((requestError) => setError(requestError.response?.data?.detail || "Change evidence could not be loaded."))
      .finally(() => setLoading(false));
  }, [clientId, days, headers]);

  return (
    <div className="space-y-5" data-testid="client-what-changed-page">
      <section className="rounded-2xl border border-violet-500/20 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.18),transparent_40%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(11,16,29,0.96))] p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          {!embedded && <div><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">Client change intelligence</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight"><Sparkles className="h-6 w-6 text-violet-300" />What Changed</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">A comparison of recorded client activity across the latest and preceding time windows, with every change linked back to its originating evidence.</p></div>}
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={clientId} onValueChange={setClientId}><SelectTrigger className="min-w-[240px]" data-testid="what-changed-client"><SelectValue placeholder="Select a client" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select>
            <Select value={days} onValueChange={setDays}><SelectTrigger data-testid="what-changed-window"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="60">Last 60 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem></SelectContent></Select>
          </div>
        </div>
      </section>

      {!clientId && <Card className="border-dashed"><CardContent className="py-16 text-center"><Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" /><p className="text-sm font-medium">Choose a client to compare recent change evidence.</p><p className="mt-1 text-xs text-muted-foreground">Nexus only describes activity that has been retained by an authorised source.</p></CardContent></Card>}
      {loading && <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Comparing retained evidence…</div>}
      {error && <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.05] px-4 py-3 text-sm text-rose-100" role="alert">{error}</div>}

      {brief && !loading && <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <HeroTile label="Recorded changes" value={brief.summary?.recorded_changes || 0} icon={Activity} glow="violet" subtitle={`Last ${brief.window?.days || days} days`} animated={false} />
          <HeroTile label="Change volume" value={`${brief.summary?.difference > 0 ? "+" : ""}${brief.summary?.difference || 0}`} icon={Activity} glow={brief.summary?.difference > 0 ? "amber" : "emerald"} subtitle="Versus the prior window" animated={false} />
          <HeroTile label="Priority review" value={brief.summary?.high_priority_changes || 0} icon={AlertTriangle} glow={(brief.summary?.high_priority_changes || 0) ? "rose" : "emerald"} subtitle="High or critical evidence" animated={false} />
          <HeroTile label="Surfaces affected" value={brief.summary?.affected_categories || 0} icon={ShieldCheck} glow="sky" subtitle="Operational categories" animated={false} />
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.045] px-4 py-3 text-xs leading-5 text-amber-100"><span className="font-semibold">Evidence boundary:</span> {brief.evidence_note}</div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="overflow-hidden border-border/70"><CardHeader className="border-b border-border/60 pb-4"><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-violet-300" />Recorded changes requiring context</CardTitle><p className="text-xs text-muted-foreground">Higher-priority evidence is shown first; open any record to investigate the original source.</p></CardHeader><CardContent className="space-y-2 p-3">
            {brief.changes?.length ? brief.changes.map((change) => <article key={change.id} className="rounded-xl border border-border/65 bg-background/25 p-3"><div className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10"><Activity className="h-4 w-4 text-violet-300" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={`text-[9px] ${CATEGORY_STYLE[change.category] || CATEGORY_STYLE.platform}`}>{label(change.category)}</Badge>{change.severity && <Badge variant="outline" className="text-[9px]">{label(change.severity)}</Badge>}<span className="text-[10px] text-muted-foreground">{change.source} · {relativeTime(change.timestamp)}</span></div>{change.route ? <Link to={change.route} className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium hover:text-primary">{change.title}<ArrowRight className="h-3.5 w-3.5" /></Link> : <p className="mt-1.5 text-sm font-medium">{change.title}</p>}<p className="mt-1 text-xs text-muted-foreground">{change.impact}</p>{change.detail && <p className="mt-1 text-xs text-muted-foreground/80">{change.detail}</p>}</div></div></article>) : <div className="py-14 text-center text-sm text-muted-foreground"><CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-300/60" />No retained changes were recorded in this window.</div>}
          </CardContent></Card>

          <Card className="h-fit border-border/70"><CardHeader className="border-b border-border/60 pb-4"><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-cyan-300" />By operating surface</CardTitle><p className="text-xs text-muted-foreground">Activity count compared with the prior {brief.window?.days || days}-day window.</p></CardHeader><CardContent className="space-y-2 p-3">{brief.category_changes?.filter((item) => item.current_count || item.previous_count).map((item) => <div key={item.category} className="rounded-lg border border-border/60 bg-muted/[0.08] p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{label(item.category)}</span><span className={`text-xs font-semibold ${item.difference > 0 ? "text-amber-300" : item.difference < 0 ? "text-emerald-300" : "text-muted-foreground"}`}>{item.difference > 0 ? "+" : ""}{item.difference}</span></div><p className="mt-1 text-[11px] text-muted-foreground">{item.current_count} now · {item.previous_count} previously</p></div>)}{!brief.category_changes?.length && <div className="py-10 text-center text-xs text-muted-foreground"><CircleAlert className="mx-auto mb-2 h-5 w-5" />No comparable evidence is available yet.</div>}</CardContent></Card>
        </div>
      </>}
    </div>
  );
}
