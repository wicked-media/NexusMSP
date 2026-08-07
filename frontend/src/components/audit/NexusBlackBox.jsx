import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Clock3,
  Download,
  Fingerprint,
  Link2,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const INTEGRITY_STYLES = {
  verified: {
    label: "Chain verified",
    className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
    icon: CheckCircle2,
  },
  partial: {
    label: "Partial chain",
    className: "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200",
    icon: Link2,
  },
  legacy: {
    label: "Legacy boundary",
    className: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-200",
    icon: AlertTriangle,
  },
  compromised: {
    label: "Integrity warning",
    className: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-200",
    icon: AlertTriangle,
  },
};

function formatSubject(subject) {
  return String(subject || "platform.event")
    .split(".")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" · ");
}

function formatTimestamp(value) {
  if (!value) return "Time not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function shortHash(value) {
  const text = String(value || "");
  return text ? `${text.slice(0, 10)}…${text.slice(-8)}` : "Not sealed";
}

function eventSearchText(event) {
  return [
    event.id,
    event.subject,
    event.source,
    event.client_id,
    event.correlation_id,
    event.partition_key,
    event.actor?.name,
    JSON.stringify(event.payload || {}),
  ].join(" ").toLowerCase();
}

function IntegrityBadge({ status, className = "" }) {
  const style = INTEGRITY_STYLES[status] || INTEGRITY_STYLES.legacy;
  const Icon = style.icon;
  return (
    <Badge variant="outline" className={`${style.className} ${className}`}>
      <Icon className="mr-1 h-3 w-3" />{style.label}
    </Badge>
  );
}

export default function NexusBlackBox({ headers }) {
  const [data, setData] = useState({ events: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState("24");
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState("1000");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/events/black-box`, {
        headers,
        params: { hours: Number(hours), limit: 500 },
      });
      setData(response.data || { events: [], summary: {} });
      setActiveIndex(0);
      setPlaying(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus Black Box evidence could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [headers, hours]);

  useEffect(() => { load(); }, [load]);

  const events = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle
      ? (data.events || []).filter(event => eventSearchText(event).includes(needle))
      : (data.events || []);
  }, [data.events, search]);

  useEffect(() => {
    setActiveIndex(current => Math.min(current, Math.max(0, events.length - 1)));
  }, [events.length]);

  useEffect(() => {
    if (!playing || events.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex(current => {
        if (current >= events.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, Number(playbackSpeed));
    return () => window.clearInterval(timer);
  }, [events.length, playbackSpeed, playing]);

  const summary = data.summary || {};
  const active = events[activeIndex] || null;
  const recent = (data.events || []).slice(-4).reverse();
  const status = summary.integrity_status || "legacy";
  const statusStyle = INTEGRITY_STYLES[status] || INTEGRITY_STYLES.legacy;
  const StatusIcon = statusStyle.icon;

  const togglePlayback = () => {
    if (!events.length) return;
    if (!playing && activeIndex >= events.length - 1) setActiveIndex(0);
    setPlaying(current => !current);
  };

  const exportReplay = () => {
    const payload = JSON.stringify({
      exported_at: new Date().toISOString(),
      read_only: true,
      summary,
      events,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `nexus-black-box-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Black Box evidence exported");
  };

  return (
    <>
      <section className="relative overflow-hidden rounded-2xl border border-slate-500/20 bg-gradient-to-br from-slate-950 via-slate-950 to-cyan-950 text-white shadow-[0_22px_70px_rgba(2,6,23,0.24)]" data-testid="nexus-black-box">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(34,211,238,0.13),transparent_33%),radial-gradient(circle_at_90%_0%,rgba(99,102,241,0.11),transparent_30%)]" />
        <div className="relative grid gap-5 p-5 md:p-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-cyan-300/20 bg-cyan-400/[0.08] text-cyan-100">
                <Fingerprint className="mr-1 h-3 w-3" />Nexus Black Box
              </Badge>
              <IntegrityBadge status={status} />
              <Badge variant="outline" className="border-white/10 bg-white/[0.04] text-zinc-300">Read only</Badge>
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">Replay what happened—not what people remember.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Every retained platform event is ordered by client partition, cryptographically sealed and presented as one incident timeline for troubleshooting, RCA, compliance and training.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Events", summary.event_count || 0],
                ["Correlations", summary.correlation_count || 0],
                ["Actors", summary.actor_count || 0],
                ["Clients", summary.client_count || 0],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5">
                  <p className="text-lg font-semibold text-white">{value}</p>
                  <p className="text-[9px] uppercase tracking-[0.16em] text-zinc-500">{label}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button type="button" className="bg-cyan-400 text-slate-950 hover:bg-cyan-300" onClick={() => setOpen(true)} disabled={loading} data-testid="open-black-box">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Replay evidence
              </Button>
              <Select value={hours} onValueChange={setHours}>
                <SelectTrigger className="h-9 w-36 border-white/10 bg-white/[0.04] text-xs text-zinc-200"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">Last 24 hours</SelectItem>
                  <SelectItem value="168">Last 7 days</SelectItem>
                  <SelectItem value="720">Last 30 days</SelectItem>
                  <SelectItem value="8760">Last year</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" className="h-9 border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08] hover:text-white" onClick={load} disabled={loading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-black/25 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-300/80">Latest evidence</p>
                <p className="mt-1 text-xs text-zinc-500">Newest retained events in this access scope</p>
              </div>
              <StatusIcon className={`h-5 w-5 ${status === "compromised" ? "text-rose-300" : status === "legacy" ? "text-amber-300" : "text-emerald-300"}`} />
            </div>
            <div className="mt-3 space-y-2">
              {recent.map(event => (
                <button key={event.id} type="button" onClick={() => { setSearch(event.correlation_id || event.id); setOpen(true); }} className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 text-left transition hover:border-cyan-300/20 hover:bg-cyan-400/[0.04]">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-300/15 bg-cyan-400/[0.06]"><Activity className="h-3.5 w-3.5 text-cyan-200" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-zinc-200">{formatSubject(event.subject)}</span>
                    <span className="block truncate text-[9px] text-zinc-600">{event.actor?.name || "Nexus System"} · {formatTimestamp(event.occurred_at)}</span>
                  </span>
                  <IntegrityBadge status={event.verification?.status} className="hidden text-[8px] sm:inline-flex" />
                </button>
              ))}
              {!recent.length && !loading && (
                <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 text-center">
                  <CircleStop className="h-6 w-6 text-zinc-700" />
                  <p className="mt-2 text-xs font-medium text-zinc-400">No platform events in this window</p>
                  <p className="mt-1 text-[10px] text-zinc-600">Choose a longer evidence window to continue.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setPlaying(false); }}>
        <DialogContent className="flex h-[90vh] max-w-7xl flex-col overflow-hidden p-0" data-testid="black-box-replay-dialog">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-600 dark:text-cyan-300">Nexus Black Box · Incident replay</p>
                <DialogTitle className="mt-1 flex items-center gap-2 text-xl"><Fingerprint className="h-5 w-5 text-cyan-500" />Chronological evidence player</DialogTitle>
                <p className="mt-1 text-xs text-muted-foreground">Viewing the record never re-runs scripts, automations or API calls.</p>
              </div>
              <IntegrityBadge status={status} />
            </div>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-b border-border/70 bg-muted/15 lg:border-b-0 lg:border-r">
              <div className="space-y-2 border-b border-border/70 p-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search subject, actor, client or correlation…" className="pl-9" data-testid="black-box-search" />
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{events.length} matching events</span>
                  {search && <button type="button" className="text-primary hover:underline" onClick={() => setSearch("")}>Clear search</button>}
                </div>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-1 p-2">
                  {events.map((event, index) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => { setActiveIndex(index); setPlaying(false); }}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${index === activeIndex ? "border-cyan-500/30 bg-cyan-500/[0.08]" : "border-transparent hover:border-border/70 hover:bg-muted/35"}`}
                      data-testid={`black-box-event-${event.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] font-semibold">{formatSubject(event.subject)}</span>
                        <span className="shrink-0 text-[9px] text-muted-foreground">#{event.sequence || index + 1}</span>
                      </div>
                      <p className="mt-1 truncate text-[9px] text-muted-foreground">{event.actor?.name || "Nexus System"} · {event.source || "Nexus Platform"}</p>
                      <p className="mt-1 text-[9px] text-muted-foreground/70">{formatTimestamp(event.occurred_at)}</p>
                    </button>
                  ))}
                  {!events.length && <p className="px-3 py-10 text-center text-xs text-muted-foreground">No evidence matches this search.</p>}
                </div>
              </ScrollArea>
            </aside>

            <main className="flex min-h-0 flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3">
                <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setActiveIndex(index => Math.max(0, index - 1))} disabled={!activeIndex || !events.length} aria-label="Previous event"><ChevronLeft className="h-4 w-4" /></Button>
                <Button type="button" size="sm" className="h-8 min-w-24" onClick={togglePlayback} disabled={!events.length}>
                  {playing ? <><Pause className="mr-2 h-4 w-4" />Pause</> : <><Play className="mr-2 h-4 w-4" />Play</>}
                </Button>
                <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setActiveIndex(index => Math.min(events.length - 1, index + 1))} disabled={!events.length || activeIndex >= events.length - 1} aria-label="Next event"><ChevronRight className="h-4 w-4" /></Button>
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, events.length - 1)}
                  value={activeIndex}
                  onChange={event => { setActiveIndex(Number(event.target.value)); setPlaying(false); }}
                  className="h-1.5 min-w-32 flex-1 cursor-pointer accent-cyan-500"
                  aria-label="Incident replay position"
                />
                <span className="min-w-16 text-right text-[10px] text-muted-foreground">{events.length ? `${activeIndex + 1} / ${events.length}` : "0 / 0"}</span>
                <Select value={playbackSpeed} onValueChange={setPlaybackSpeed}>
                  <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="1800">0.5×</SelectItem><SelectItem value="1000">1×</SelectItem><SelectItem value="500">2×</SelectItem></SelectContent>
                </Select>
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={exportReplay} disabled={!events.length}><Download className="mr-2 h-3.5 w-3.5" />Export</Button>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                {active ? (
                  <div className="space-y-4 p-4 md:p-5">
                    <section className="rounded-2xl border border-border/70 bg-gradient-to-br from-card to-muted/20 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-cyan-600 dark:text-cyan-300">Event {activeIndex + 1} · Partition sequence {active.sequence || "not recorded"}</p>
                          <h3 className="mt-1 text-xl font-semibold">{formatSubject(active.subject)}</h3>
                          <p className="mt-1 text-xs text-muted-foreground">{formatTimestamp(active.occurred_at)}</p>
                        </div>
                        <IntegrityBadge status={active.verification?.status} />
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {[
                          ["Actor", active.actor?.name || "Nexus System"],
                          ["Source", active.source || "Nexus Platform"],
                          ["Client", active.client_id || "Platform-wide"],
                          ["Correlation", active.correlation_id || "Not linked"],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-xl border border-border/70 bg-background/55 p-3">
                            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
                            <p className="mt-1 truncate text-xs font-medium" title={value}>{value}</p>
                          </div>
                        ))}
                      </div>
                      {active.correlation_id && (
                        <Button type="button" variant="ghost" size="sm" className="mt-3 h-7 px-2 text-[10px] text-primary" onClick={() => { setSearch(active.correlation_id); setActiveIndex(0); setPlaying(false); }}>
                          <Link2 className="mr-1.5 h-3.5 w-3.5" />Follow this correlation
                        </Button>
                      )}
                    </section>

                    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
                      <section className="rounded-2xl border border-border/70 bg-card p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div><p className="text-sm font-semibold">Recorded payload</p><p className="text-[10px] text-muted-foreground">The bounded event evidence retained by its owning Nexus module.</p></div>
                          <Sparkles className="h-4 w-4 text-cyan-500" />
                        </div>
                        <pre className="mt-3 max-h-80 overflow-auto rounded-xl border border-border/70 bg-slate-950 p-4 text-[11px] leading-relaxed text-cyan-100">{JSON.stringify(active.payload || {}, null, 2)}</pre>
                      </section>
                      <section className="rounded-2xl border border-border/70 bg-card p-4">
                        <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-500" /><p className="text-sm font-semibold">Integrity seal</p></div>
                        <div className="mt-3 space-y-3">
                          {[
                            ["Content", active.integrity?.content_hash],
                            ["Previous", active.integrity?.previous_hash],
                            ["Chain", active.integrity?.chain_hash],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label} hash</p>
                              <p className="mt-1 break-all rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2 font-mono text-[10px]" title={value}>{shortHash(value)}</p>
                            </div>
                          ))}
                          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3 text-[10px] leading-relaxed text-muted-foreground">
                            SHA-256 protects the event content and its link to the previous event in this client partition. Backfilled seals identify their migration origin.
                          </div>
                        </div>
                      </section>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-80 flex-col items-center justify-center text-center">
                    <Clock3 className="h-8 w-8 text-muted-foreground/40" />
                    <p className="mt-3 text-sm font-medium">No replay evidence selected</p>
                    <p className="mt-1 text-xs text-muted-foreground">Choose a longer window or clear the search.</p>
                  </div>
                )}
              </ScrollArea>
            </main>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
