import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import HeroTile from "@/components/HeroTile";
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Clock, Copy,
  FileText, Loader2, RefreshCw, ShieldCheck, Sparkles, Trash2, TriangleAlert, Zap,
} from "lucide-react";
import { toast } from "sonner";

const severityConfig = {
  critical: { badge: "border-rose-500/30 bg-rose-500/10 text-rose-300", tile: "rose", label: "Critical" },
  high: { badge: "border-orange-500/30 bg-orange-500/10 text-orange-300", tile: "amber", label: "High" },
  medium: { badge: "border-amber-500/30 bg-amber-500/10 text-amber-300", tile: "amber", label: "Medium" },
  low: { badge: "border-sky-500/30 bg-sky-500/10 text-sky-300", tile: "sky", label: "Low" },
};

const getSeverity = (severity) => severityConfig[String(severity || "medium").toLowerCase()] || severityConfig.medium;
const friendlyDate = (value) => value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";

export default function PostmortemPage({ embedded = false }) {
  const { token } = useAuth();
  const [postmortems, setPostmortems] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState("");
  const [generating, setGenerating] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async (showToast = false) => {
    setLoading(true);
    try {
      const [pm, ticketResponse] = await Promise.all([
        axios.get(`${API}/postmortem`, { headers }),
        axios.get(`${API}/tickets`, { headers }),
      ]);
      setPostmortems(pm.data || []);
      setTickets((ticketResponse.data || []).filter((ticket) => ["resolved", "closed"].includes(String(ticket.status).toLowerCase())));
      if (showToast) toast.success("Incident reports refreshed");
    } catch {
      toast.error("Could not load incident reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    if (!selectedTicket) { toast.error("Select a resolved ticket first"); return; }
    setGenerating(true);
    try {
      const { data } = await axios.post(`${API}/postmortem/generate/${selectedTicket}`, {}, { headers });
      if (data?.error) throw new Error(data.error);
      setViewing(data);
      setPostmortems((previous) => [data, ...previous.filter((item) => item.id !== data.id)]);
      toast.success("Incident post-mortem generated");
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const deletePm = async (id) => {
    try {
      await axios.delete(`${API}/postmortem/${id}`, { headers });
      setPostmortems((previous) => previous.filter((report) => report.id !== id));
      if (viewing?.id === id) setViewing(null);
      toast.success("Post-mortem removed");
    } catch {
      toast.error("Could not remove this post-mortem");
    }
  };

  const copyReport = async () => {
    if (!viewing) return;
    const report = [
      viewing.title, "", `Client: ${viewing.client_name || "Not assigned"}`, `Severity: ${getSeverity(viewing.severity).label}`,
      `Generated: ${friendlyDate(viewing.generated_at)}`, "", "SUMMARY", viewing.summary || "No summary recorded.", "",
      "ROOT CAUSE", viewing.root_cause || "Requires analysis.", "", "IMPACT", viewing.impact || "Not recorded.", "",
      "RESOLUTION", viewing.resolution || "Not recorded.", "", "TIMELINE",
      ...(viewing.timeline || []), "", "PREVENTION ACTIONS", ...(viewing.prevention || []),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(report);
      toast.success("Post-mortem copied to clipboard");
    } catch {
      toast.error("Could not copy the report");
    }
  };

  const metrics = useMemo(() => {
    const critical = postmortems.filter((report) => ["critical", "high"].includes(String(report.severity).toLowerCase())).length;
    const clients = new Set(postmortems.map((report) => report.client_name).filter(Boolean)).size;
    const latest = postmortems[0]?.generated_at;
    return { critical, clients, latest };
  }, [postmortems]);

  if (loading) return <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-5" data-testid="postmortem-page">
      <section className={`flex flex-col gap-4 ${embedded ? "rounded-xl border border-border/70 bg-card/50 p-4" : "border-b border-border/60 pb-5"} lg:flex-row lg:items-end lg:justify-between`}>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-rose-500/25 bg-rose-500/10 shadow-[0_0_28px_rgba(244,63,94,0.16)]">
            <TriangleAlert className="h-5 w-5 text-rose-300" />
          </div>
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2"><h2 className={embedded ? "text-lg font-semibold tracking-tight" : "text-2xl font-bold tracking-tight"}>Incident Post-Mortems</h2><Badge variant="outline" className="border-primary/30 bg-primary/5 text-[10px] text-primary">AI-assisted review</Badge></div>
            <p className="max-w-2xl text-sm text-muted-foreground">Build an evidence-led incident record from resolved tickets, then share a clear review and prevention plan with the team.</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={selectedTicket} onValueChange={setSelectedTicket}>
            <SelectTrigger className="w-full sm:w-[290px]" data-testid="postmortem-ticket-select"><SelectValue placeholder="Select resolved ticket..." /></SelectTrigger>
            <SelectContent>{tickets.map((ticket) => <SelectItem key={ticket.id} value={ticket.id}>{ticket.title}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={generate} disabled={generating} data-testid="generate-postmortem">
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{generating ? "Generating..." : "Generate report"}
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <HeroTile label="POST-MORTEMS" value={postmortems.length} icon={FileText} glow="violet" subtitle="Incident reviews saved" />
        <HeroTile label="HIGH PRIORITY" value={metrics.critical} icon={AlertTriangle} glow="rose" subtitle="Critical or high severity" />
        <HeroTile label="CLIENTS COVERED" value={metrics.clients} icon={ShieldCheck} glow="emerald" subtitle="With a formal review" />
        <HeroTile label="LAST GENERATED" value={metrics.latest ? new Date(metrics.latest).toLocaleDateString([], { month: "short", day: "numeric" }) : "—"} animated={false} icon={CalendarClock} glow="sky" subtitle={metrics.latest ? "Latest report" : "No reports yet"} />
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-semibold">Incident review workspace</p><p className="text-xs text-muted-foreground">Reports stay tied to their resolved ticket so the response, impact, and prevention actions are easy to review.</p></div>
        <Button variant="outline" size="sm" onClick={() => fetchData(true)}><RefreshCw className="mr-2 h-4 w-4" />Refresh reports</Button>
      </section>

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="border-border/60 bg-card/70">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3"><div><p className="text-sm font-semibold">Report library</p><p className="text-xs text-muted-foreground">{postmortems.length} generated {postmortems.length === 1 ? "report" : "reports"}</p></div><FileText className="h-4 w-4 text-muted-foreground" /></div>
            <ScrollArea className="h-[610px]">
              <div className="space-y-2 p-3">
                {postmortems.length === 0 ? <div className="px-4 py-16 text-center"><FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" /><p className="text-sm font-medium">No post-mortems yet</p><p className="mt-1 text-xs text-muted-foreground">Select a resolved ticket to create the first report.</p></div> : postmortems.map((report) => {
                  const severity = getSeverity(report.severity);
                  const isActive = viewing?.id === report.id;
                  return <button key={report.id} type="button" onClick={() => setViewing(report)} data-testid={`pm-card-${report.id}`} className={`w-full rounded-xl border p-3 text-left transition-all ${isActive ? "border-primary/55 bg-primary/8 shadow-sm" : "border-border/60 bg-background/30 hover:border-primary/35 hover:bg-muted/40"}`}>
                    <div className="flex items-start gap-2"><div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${report.severity === "critical" ? "bg-rose-400" : report.severity === "high" ? "bg-orange-400" : report.severity === "medium" ? "bg-amber-400" : "bg-sky-400"}`} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{report.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{report.client_name || "Unassigned client"}</p></div><ChevronRight className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isActive ? "translate-x-0.5 text-primary" : ""}`} /></div>
                    <div className="mt-3 flex items-center justify-between gap-2"><Badge variant="outline" className={`border text-[10px] ${severity.badge}`}>{severity.label}</Badge><span className="text-[10px] text-muted-foreground">{friendlyDate(report.generated_at)}</span></div>
                  </button>;
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {viewing ? <article className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_18px_45px_rgba(0,0,0,0.16)]">
          <div className="border-b border-border/60 bg-gradient-to-r from-rose-500/[0.09] via-card to-card px-5 py-5 sm:px-7">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div className="min-w-0"><div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant="outline" className={`border ${getSeverity(viewing.severity).badge}`}>{getSeverity(viewing.severity).label} incident</Badge>{viewing.duration_estimate && <Badge variant="outline" className="text-[10px]"><Clock className="mr-1 h-3 w-3" />{viewing.duration_estimate}</Badge>}</div><h2 className="text-xl font-bold tracking-tight sm:text-2xl">{viewing.title}</h2><p className="mt-1 text-sm text-muted-foreground">{viewing.client_name || "Unassigned client"} <span className="px-1">•</span> Generated {friendlyDate(viewing.generated_at)}</p></div><div className="flex shrink-0 gap-2"><Button variant="outline" size="sm" onClick={copyReport} data-testid="copy-postmortem"><Copy className="mr-2 h-4 w-4" />Copy</Button><Button variant="ghost" size="icon" aria-label="Delete post-mortem" onClick={() => deletePm(viewing.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div></div>
          </div>
          <div className="space-y-7 p-5 sm:p-7">
            <section><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Executive summary</p><p className="rounded-xl border border-border/60 bg-muted/25 p-4 text-sm leading-6 text-foreground/90">{viewing.summary || "No summary was captured for this incident."}</p></section>
            <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-xl border border-border/60 bg-background/30 p-4"><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Root cause</p><p className="text-sm leading-6 text-foreground/85">{viewing.root_cause || "Requires a manual root-cause review."}</p></section><section className="rounded-xl border border-border/60 bg-background/30 p-4"><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Customer impact</p><p className="text-sm leading-6 text-foreground/85">{viewing.impact || "Impact was not recorded."}</p></section></div>
            <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.045] p-4"><p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Resolution record</p><p className="text-sm leading-6 text-foreground/90">{viewing.resolution || "Resolution details were not recorded."}</p></section>
            <div className="grid gap-6 lg:grid-cols-2"><section><p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Incident timeline</p>{viewing.timeline?.length ? <div className="space-y-3 border-l border-primary/30 pl-4">{viewing.timeline.map((event, index) => <div key={`${event}-${index}`} className="relative text-sm leading-5 text-foreground/85"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border-2 border-card bg-primary" />{event}</div>)}</div> : <p className="rounded-lg border border-dashed border-border/70 p-3 text-sm text-muted-foreground">No timeline entries were available from the ticket.</p>}</section><section><p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />Prevention actions</p>{viewing.prevention?.length ? <div className="space-y-2">{viewing.prevention.map((action, index) => <div key={`${action}-${index}`} className="flex gap-3 rounded-lg border border-border/60 bg-background/30 p-3 text-sm text-foreground/85"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>{action}</div>)}</div> : <p className="rounded-lg border border-dashed border-border/70 p-3 text-sm text-muted-foreground">No prevention actions were created yet.</p>}</section></div>
          </div>
          <footer className="border-t border-border/60 bg-muted/20 px-5 py-3 text-xs text-muted-foreground sm:px-7">Generated by {viewing.generated_by || "NexusMSP"} <span className="px-1">•</span> Linked ticket: {viewing.ticket_title || "Not recorded"}</footer>
        </article> : <Card className="flex min-h-[610px] items-center justify-center border-dashed border-border/70 bg-card/50"><CardContent className="max-w-sm text-center"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10"><Zap className="h-7 w-7 text-primary" /></div><h2 className="text-lg font-semibold">Select an incident review</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Choose a saved post-mortem from the library or generate a new report from a resolved ticket.</p></CardContent></Card>}
      </div>
    </div>
  );
}
