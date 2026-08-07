import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";
import {
  Bookmark, Eye, Activity, Save, Loader2, Pin, X, Wifi, WifiOff,
  Ticket as TicketIcon, Monitor, Flame, Clock, History, RefreshCw,
  AlertTriangle, Search,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { priorityConfig } from "@/config/ticketConfig";
import SavedViewsBar from "@/components/SavedViewsBar";
import { taskShortcuts } from "@/config/navigation";

const taskAccentClasses = {
  emerald: "border-emerald-500/20 bg-emerald-500/[0.045] text-emerald-300 hover:border-emerald-400/40 hover:bg-emerald-500/[0.075]",
  amber: "border-amber-500/20 bg-amber-500/[0.045] text-amber-300 hover:border-amber-400/40 hover:bg-amber-500/[0.075]",
  cyan: "border-cyan-500/20 bg-cyan-500/[0.045] text-cyan-300 hover:border-cyan-400/40 hover:bg-cyan-500/[0.075]",
  rose: "border-rose-500/20 bg-rose-500/[0.045] text-rose-300 hover:border-rose-400/40 hover:bg-rose-500/[0.075]",
  violet: "border-violet-500/20 bg-violet-500/[0.045] text-violet-300 hover:border-violet-400/40 hover:bg-violet-500/[0.075]",
  blue: "border-blue-500/20 bg-blue-500/[0.045] text-blue-300 hover:border-blue-400/40 hover:bg-blue-500/[0.075]",
};

export default function WorkspacePage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [scratchDraft, setScratchDraft] = useState("");
  const [taskQuery, setTaskQuery] = useState("");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchWorkspace = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await axios.get(`${API}/workspace`, { headers });
      setData(res.data);
      setScratchDraft(res.data.scratch_notes || "");
    } catch (e) {
      setLoadError("NexusMSP could not load your personal workspace. Your saved pins, watched devices, and notes have not been changed.");
      toast.error("Failed to load workspace");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { fetchWorkspace(); }, [fetchWorkspace]);

  const handleRefresh = () => {
    setLoading(true);
    fetchWorkspace();
  };

  const handleUnpin = async (ticketId) => {
    try {
      await axios.delete(`${API}/workspace/pin/ticket/${ticketId}`, { headers });
      toast.success("Unpinned");
      fetchWorkspace();
    } catch { toast.error("Failed to unpin"); }
  };

  const handleUnwatch = async (deviceId) => {
    try {
      await axios.delete(`${API}/workspace/watch/device/${deviceId}`, { headers });
      toast.success("Unwatched");
      fetchWorkspace();
    } catch { toast.error("Failed to unwatch"); }
  };

  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/workspace/scratch-notes`, { notes: scratchDraft }, { headers });
      toast.success("Notes saved");
      setData(prev => prev ? { ...prev, scratch_notes: scratchDraft } : prev);
    } catch { toast.error("Failed to save notes"); }
    finally { setSaving(false); }
  };

  if (loading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-64 text-zinc-500">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      </PageShell>
    );
  }

  if (loadError || !data) {
    return (
      <PageShell data-testid="workspace-load-error">
        <Card className="mx-auto mt-10 max-w-2xl border-rose-500/30 bg-rose-500/[0.045]">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
            <AlertTriangle className="h-10 w-10 text-rose-300" />
            <div><h1 className="text-lg font-semibold">My Workspace is unavailable</h1><p className="mt-1 max-w-lg text-sm text-muted-foreground">{loadError || "The personal workspace did not return the data needed to render."}</p></div>
            <Button onClick={handleRefresh} data-testid="retry-workspace-load"><RefreshCw className="mr-2 h-4 w-4" />Retry workspace</Button>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const stats = data.stats || {};
  const matchingTasks = taskShortcuts.filter(task => {
    const query = taskQuery.trim().toLowerCase();
    return !query || [task.label, task.description, ...task.keywords].join(" ").toLowerCase().includes(query);
  });

  const openCommandPalette = () => window.dispatchEvent(new CustomEvent("nexus:open-command-palette"));

  return (
    <PageShell data-testid="workspace-page">
      <div className="p-6 space-y-6">
        {/* Hero */}
        <section className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.10] via-background to-background p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">Personal operations</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight flex items-center gap-3">
              <Bookmark className="w-7 h-7 text-violet-400" />
              My Workspace
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your personal cockpit — find the right action, then keep important work close.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading} data-testid="workspace-refresh">
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        </section>

        {/* Metric strip */}
        <MetricStrip columns={4}>
          <MetricTile
            label="Pinned"
            value={stats.pinned_count || 0}
            icon={<Pin className="w-3 h-3" />}
            accent="violet"
            testid="ws-stat-pinned"
          />
          <MetricTile
            label="Watching"
            value={stats.watched_count || 0}
            icon={<Eye className="w-3 h-3" />}
            accent="cyan"
            testid="ws-stat-watched"
          />
          <MetricTile
            label="My Open Tickets"
            value={stats.open_assigned || 0}
            icon={<TicketIcon className="w-3 h-3" />}
            accent="amber"
            testid="ws-stat-open"
          />
          <MetricTile
            label="My Critical"
            value={stats.critical_assigned || 0}
            icon={<Flame className="w-3 h-3" />}
            accent="rose"
            testid="ws-stat-critical"
          />
        </MetricStrip>

        <section className="overflow-hidden rounded-2xl border border-primary/20 bg-card/70 shadow-[0_18px_55px_-38px_hsl(var(--primary)/0.7)]" aria-labelledby="nexus-navigator-title" data-testid="nexus-navigator">
          <div className="flex flex-col gap-4 border-b border-border/70 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.13),transparent_42%)] p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Nexus Navigator</p>
              <h2 id="nexus-navigator-title" className="mt-1 text-lg font-semibold">What do you need to get done?</h2>
              <p className="mt-1 text-xs text-muted-foreground">Use plain language. Nexus will take you to the right workspace without making you learn the menu.</p>
            </div>
            <div className="flex w-full max-w-xl flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <label className="relative flex-1">
                <span className="sr-only">Find a task</span>
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={taskQuery} onChange={event => setTaskQuery(event.target.value)} placeholder="Try ‘remote into a device’ or ‘bill a client’" className="h-10 w-full rounded-lg border border-border bg-background/75 pl-9 pr-3 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/15" data-testid="workspace-task-search" />
              </label>
              <Button variant="outline" className="h-10 shrink-0" onClick={openCommandPalette} title="Search all Nexus records and actions">
                <Search className="mr-2 h-4 w-4" />Everything <span className="ml-2 rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">Ctrl K</span>
              </Button>
            </div>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {matchingTasks.map(task => {
              const TaskIcon = task.icon;
              return (
                <button key={task.id} type="button" onClick={() => navigate(task.path)} className={`group flex min-h-[92px] items-start gap-3 rounded-xl border p-3.5 text-left transition duration-200 hover:-translate-y-0.5 ${taskAccentClasses[task.accent]}`} data-testid={`workspace-task-${task.id}`}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-current/20 bg-background/55"><TaskIcon className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">{task.label}<span aria-hidden="true" className="translate-x-0 text-current opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100">→</span></span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{task.description}</span>
                  </span>
                </button>
              );
            })}
            {matchingTasks.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-5 py-7 text-center">
                <p className="text-sm font-medium">No quick task matched “{taskQuery}”</p>
                <p className="mt-1 text-xs text-muted-foreground">Search everything to find clients, users, assets, invoices, knowledge and actions.</p>
                <Button className="mt-3" size="sm" onClick={openCommandPalette}><Search className="mr-2 h-3.5 w-3.5" />Search everything</Button>
              </div>
            )}
          </div>
        </section>

        <Tabs defaultValue="pinned" className="w-full">
          <TabsList className="grid w-full grid-cols-5 max-w-2xl">
            <TabsTrigger value="pinned" data-testid="ws-tab-pinned">
              <Pin className="w-3.5 h-3.5 mr-1" />Pinned
            </TabsTrigger>
            <TabsTrigger value="my-tickets" data-testid="ws-tab-my-tickets">
              <TicketIcon className="w-3.5 h-3.5 mr-1" />My Tickets
            </TabsTrigger>
            <TabsTrigger value="watched" data-testid="ws-tab-watched">
              <Monitor className="w-3.5 h-3.5 mr-1" />Watched
            </TabsTrigger>
            <TabsTrigger value="notes" data-testid="ws-tab-notes">
              <Save className="w-3.5 h-3.5 mr-1" />Scratchpad
            </TabsTrigger>
            <TabsTrigger value="recent" data-testid="ws-tab-recent">
              <History className="w-3.5 h-3.5 mr-1" />Recent
            </TabsTrigger>
          </TabsList>

          {/* Pinned Tickets */}
          <TabsContent value="pinned" className="space-y-3">
            {(!data?.pinned_tickets || data.pinned_tickets.length === 0) ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Pin className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Nothing pinned yet</p>
                  <p className="text-xs mt-1">From any ticket, click <span className="font-mono px-1.5 py-0.5 rounded bg-muted">Actions → Pin to Workspace</span></p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.pinned_tickets.map((t) => (
                  <Card key={t.id} className="border-violet-500/20 hover:border-violet-500/40 transition-colors group" data-testid={`ws-pinned-${t.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 cursor-pointer" onClick={() => navigate(`/tickets?ticket=${t.ticket_number}`)}>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                            <span className="font-mono">{t.ticket_number}</span>
                            <Badge className={priorityConfig[t.priority]?.class + " text-[9px]"}>{t.priority}</Badge>
                            <Badge variant="outline" className="text-[9px] capitalize">{t.status?.replace("_", " ")}</Badge>
                          </div>
                          <p className="font-medium text-sm line-clamp-2">{t.title}</p>
                          {t.client_name && <p className="text-xs text-muted-foreground mt-1">{t.client_name}</p>}
                          {t.note && <p className="text-[11px] italic text-violet-400 mt-2 border-l-2 border-violet-500/40 pl-2">"{t.note}"</p>}
                        </div>
                        <Button
                          variant="ghost" size="sm"
                          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleUnpin(t.id)}
                          data-testid={`ws-unpin-${t.id}`}
                          title="Unpin"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      {t.pinned_at && (
                        <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
                          <Pin className="w-2.5 h-2.5" />
                          Pinned {formatDistanceToNow(new Date(t.pinned_at), { addSuffix: true })}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* My Open Tickets */}
          <TabsContent value="my-tickets" className="space-y-2">
            <SavedViewsBar
              scope="tickets" headers={headers}
              onApply={(v) => {
                try { localStorage.setItem("nexus.tickets.applyView", JSON.stringify(v)); } catch {}
                navigate("/tickets");
              }}
            />
            {(!data?.my_open_tickets || data.my_open_tickets.length === 0) ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <TicketIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No open tickets assigned to you 🎉</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {data.my_open_tickets.map((t) => (
                  <Card
                    key={t.id}
                    className="hover:border-amber-500/40 transition-colors cursor-pointer"
                    onClick={() => navigate(`/tickets?ticket=${t.ticket_number}`)}
                    data-testid={`ws-mine-${t.id}`}
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      <Badge className={priorityConfig[t.priority]?.class + " text-[9px]"}>{t.priority}</Badge>
                      <span className="font-mono text-xs text-muted-foreground">{t.ticket_number}</span>
                      <span className="text-sm flex-1 truncate">{t.title}</span>
                      {t.client_name && <span className="text-xs text-muted-foreground">{t.client_name}</span>}
                      <Badge variant="outline" className="text-[9px] capitalize">{t.status?.replace("_", " ")}</Badge>
                      {t.sla_due && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {formatDistanceToNow(new Date(t.sla_due), { addSuffix: true })}
                        </span>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Watched Devices */}
          <TabsContent value="watched" className="space-y-3">
            {(!data?.watched_devices || data.watched_devices.length === 0) ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Eye className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No devices being watched</p>
                  <p className="text-xs mt-1">From a device detail page, click the watch icon to start watching.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.watched_devices.map((d) => (
                  <Card key={d.id} className="border-cyan-500/20 hover:border-cyan-500/40 transition-colors group" data-testid={`ws-watched-${d.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          {d.status === "online"
                            ? <Wifi className="w-4 h-4 text-emerald-400" />
                            : <WifiOff className="w-4 h-4 text-red-400" />}
                          <span className="font-semibold text-sm">{d.name}</span>
                        </div>
                        <Button
                          variant="ghost" size="sm"
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleUnwatch(d.id)}
                          data-testid={`ws-unwatch-${d.id}`}
                          title="Unwatch"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {d.client_name && <p>{d.client_name}</p>}
                        {d.os && <p>{d.os} · <span className="capitalize">{d.device_type}</span></p>}
                        {d.ip_address && <p className="font-mono">{d.ip_address}</p>}
                      </div>
                      <Button
                        variant="outline" size="sm"
                        className="mt-3 w-full text-xs h-7"
                        onClick={() => navigate(`/devices/${d.id}`)}
                      >
                        Open Device
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Scratchpad Notes */}
          <TabsContent value="notes" className="space-y-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Save className="w-4 h-4 text-emerald-400" />
                  Scratchpad
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={scratchDraft}
                  onChange={e => setScratchDraft(e.target.value)}
                  rows={14}
                  placeholder="Personal notes, half-done thoughts, command snippets, things-to-remember…"
                  className="font-mono text-sm"
                  data-testid="ws-scratch-textarea"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{scratchDraft.length} chars · only visible to you</span>
                  <Button
                    onClick={handleSaveNotes}
                    disabled={saving || scratchDraft === (data?.scratch_notes || "")}
                    size="sm"
                    data-testid="ws-save-notes"
                  >
                    {saving
                      ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Saving</>
                      : <><Save className="w-3.5 h-3.5 mr-1" />Save</>}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Recent activity */}
          <TabsContent value="recent" className="space-y-2">
            {(!data?.recent_activity || data.recent_activity.length === 0) ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No recent activity</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-3">
                  <ScrollArea className="h-[400px] pr-4">
                    <div className="space-y-2">
                      {data.recent_activity.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-start gap-3 px-3 py-2 rounded hover:bg-muted/40 transition-colors"
                          data-testid={`ws-activity-${a.id}`}
                        >
                          <Activity className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs">
                              <span className="font-semibold capitalize">{a.action}</span>
                              {" "}
                              <span className="text-muted-foreground">{a.entity_type}</span>
                              {" "}
                              <span className="font-mono text-[10px]">{a.entity_id}</span>
                            </div>
                            {a.entity_name && <p className="text-xs text-muted-foreground truncate">{a.entity_name}</p>}
                            {a.details && <p className="text-[10px] text-muted-foreground/80 mt-0.5">{a.details}</p>}
                          </div>
                          <span className="text-[10px] text-muted-foreground flex-shrink-0">
                            {a.created_at ? formatDistanceToNow(new Date(a.created_at), { addSuffix: true }) : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
