import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Power, RefreshCw, Wifi, Terminal, FolderOpen, Monitor,
  Play, Square, RotateCcw, Cpu, HardDrive, MemoryStick, Activity, AlertTriangle, Loader2, MessageSquareWarning,
  Skull, Download, Search,
} from "lucide-react";
import { API } from "@/App";

const fmtBytes = (n) => {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
};

/** Mini gauge */
function Gauge({ label, value, unit = "%", color = "violet", icon: Icon }) {
  const v = Math.min(100, Math.max(0, Number(value) || 0));
  const colorMap = {
    violet: "from-violet-500 to-cyan-500",
    emerald: "from-emerald-500 to-teal-500",
    amber: "from-amber-500 to-orange-500",
    rose: "from-rose-500 to-pink-500",
  };
  const tone = v > 90 ? colorMap.rose : v > 75 ? colorMap.amber : colorMap[color];
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">{Icon && <Icon className="w-3 h-3" />}{label}</span>
        <span className="font-mono font-semibold text-foreground">{v.toFixed(0)}{unit}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
        <div className={`h-full rounded-full bg-gradient-to-r ${tone} transition-all`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export default function TicketDeviceCockpit({ ticketId, deviceStatus, headers, hasAgent, refreshTicketDetails }) {
  const [agent, setAgent] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: "reboot"|"shutdown"|"send-message", title }
  const [msgBody, setMsgBody] = useState("");
  const [services, setServices] = useState([]);
  const [serviceQuery, setServiceQuery] = useState("");
  const [processes, setProcesses] = useState([]);
  const [winupdates, setWinUpdates] = useState([]);
  const [activeTab, setActiveTab] = useState("services");
  const [loadingTab, setLoadingTab] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalUrl, setTerminalUrl] = useState(null);

  // Live agent details poll
  const fetchAgent = useCallback(async () => {
    if (!ticketId || !hasAgent) return;
    try {
      const r = await axios.get(`${API}/tickets/${ticketId}/device/agent`, { headers });
      setAgent(r.data);
    } catch { /* graceful */ }
  }, [ticketId, hasAgent, headers]);

  useEffect(() => {
    if (!hasAgent) return;
    fetchAgent();
    const t = setInterval(fetchAgent, 30000);
    return () => clearInterval(t);
  }, [fetchAgent, hasAgent]);

  // Lazy-load tab data
  useEffect(() => {
    if (!hasAgent) return;
    let alive = true;
    const load = async () => {
      setLoadingTab(true);
      try {
        if (activeTab === "services") {
          const r = await axios.get(`${API}/tickets/${ticketId}/device/services`, { headers });
          if (alive) setServices(Array.isArray(r.data) ? r.data : (r.data?.services || []));
        } else if (activeTab === "processes") {
          const r = await axios.get(`${API}/tickets/${ticketId}/device/processes`, { headers });
          if (alive) setProcesses(Array.isArray(r.data) ? r.data : []);
        } else if (activeTab === "patches") {
          const r = await axios.get(`${API}/tickets/${ticketId}/device/winupdates`, { headers });
          if (alive) setWinUpdates(Array.isArray(r.data) ? r.data : []);
        }
      } catch { /* TRMM may not be configured — show empty */ }
      if (alive) setLoadingTab(false);
    };
    load();
    return () => { alive = false; };
  }, [activeTab, ticketId, headers, hasAgent]);

  const runAction = async (path, label, opts = {}) => {
    setBusyAction(label);
    try {
      const r = await axios.post(`${API}/tickets/${ticketId}/device/${path}`, opts.body || {}, { headers });
      const ok = r.data?.success !== false;
      if (ok) toast.success(`${label} — done`);
      else toast.warning(r.data?.message || `${label} — backend returned a warning`);
      refreshTicketDetails?.();
      if (path === "services") setActiveTab("services");
    } catch (e) {
      toast.error(e.response?.data?.detail || `${label} failed`);
    } finally {
      setBusyAction(null);
    }
  };

  const openRemote = async (kind /* control | terminal | file */) => {
    setBusyAction("remote");
    try {
      const r = await axios.get(`${API}/tickets/${ticketId}/device/remote-url`, { headers });
      if (!r.data?.success) {
        toast.error(r.data?.message || "Could not get remote URL");
        return;
      }
      const urls = r.data?.urls || {};
      const url = urls[kind] || urls.control || urls.terminal || urls.file;
      if (!url) {
        toast.error("TRMM did not return a URL for that view");
        return;
      }
      if (kind === "terminal") {
        setTerminalUrl(url);
        setTerminalOpen(true);
      } else {
        window.open(url, "_blank", "noopener");
      }
      refreshTicketDetails?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Remote open failed");
    } finally {
      setBusyAction(null);
    }
  };

  const sendMessage = async () => {
    const body = msgBody.trim();
    if (!body) return;
    await runAction("send-message", "Send message", { body: { title: "Message from IT", body } });
    setMsgBody("");
    setConfirm(null);
  };

  const serviceAction = async (svc, action) => {
    setBusyAction(`svc-${svc.name}-${action}`);
    try {
      await axios.post(`${API}/tickets/${ticketId}/device/services/${encodeURIComponent(svc.name)}/${action}`, {}, { headers });
      toast.success(`${svc.name}: ${action}`);
      const r = await axios.get(`${API}/tickets/${ticketId}/device/services`, { headers });
      setServices(Array.isArray(r.data) ? r.data : (r.data?.services || []));
    } catch (e) {
      toast.error(e.response?.data?.detail || `${svc.name} ${action} failed`);
    } finally { setBusyAction(null); }
  };

  const killProcess = async (p) => {
    if (!window.confirm(`Kill process ${p.name} (PID ${p.pid})?`)) return;
    setBusyAction(`kill-${p.pid}`);
    try {
      await axios.post(`${API}/tickets/${ticketId}/device/processes/${p.pid}/kill`, {}, { headers });
      toast.success(`Killed PID ${p.pid}`);
      const r = await axios.get(`${API}/tickets/${ticketId}/device/processes`, { headers });
      setProcesses(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Kill failed");
    } finally { setBusyAction(null); }
  };

  const filteredServices = useMemo(() => {
    if (!serviceQuery.trim()) return services.slice(0, 50);
    const q = serviceQuery.toLowerCase();
    return services.filter(s => (s.display_name || s.name || "").toLowerCase().includes(q)).slice(0, 100);
  }, [services, serviceQuery]);

  const topProcesses = useMemo(() => {
    const arr = [...processes].sort((a, b) => (b.cpu_percent || 0) - (a.cpu_percent || 0));
    return arr.slice(0, 25);
  }, [processes]);

  if (!hasAgent) {
    return (
      <Card data-testid="device-cockpit-noagent" className="border-amber-500/20 bg-amber-500/[0.03]">
        <CardContent className="py-4 text-center space-y-2">
          <Monitor className="w-7 h-7 mx-auto text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">Link a device with a TRMM agent to enable the live cockpit.</p>
        </CardContent>
      </Card>
    );
  }

  const cpu = agent?.cpu_load ?? deviceStatus?.cpu_percent ?? 0;
  const ram = agent?.used_ram ?? 0;
  const isOnline = (agent?.status || deviceStatus?.status) === "online";
  const needsReboot = agent?.needs_reboot;
  const checksFailing = agent?.checks_failing || 0;
  const patchesPending = agent?.patches_pending || 0;

  return (
    <>
      <Card data-testid="device-cockpit" className="border-violet-500/20 bg-gradient-to-br from-card via-card to-violet-500/[0.02]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <Monitor className="w-4 h-4 text-violet-400" />
              Live Device Cockpit
            </span>
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`} />
              <span className={`text-[10px] uppercase tracking-wider ${isOnline ? "text-emerald-400" : "text-rose-400"}`}>{isOnline ? "Online" : "Offline"}</span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Status pills */}
          <div className="flex flex-wrap gap-1.5">
            {needsReboot && <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[10px]"><AlertTriangle className="w-2.5 h-2.5 mr-0.5" />Reboot needed</Badge>}
            {checksFailing > 0 && <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/30 text-[10px]">{checksFailing} check{checksFailing === 1 ? "" : "s"} failing</Badge>}
            {patchesPending > 0 && <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30 text-[10px]">{patchesPending} patch{patchesPending === 1 ? "" : "es"} pending</Badge>}
            {agent?.logged_in_username && <Badge variant="outline" className="text-[10px]">User: {agent.logged_in_username}</Badge>}
          </div>

          {/* Take Control row */}
          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Take Control</Label>
            <div className="grid grid-cols-3 gap-1.5">
              <Button size="sm" variant="outline" className="h-8 text-[11px] border-violet-500/30 hover:bg-violet-500/10" onClick={() => openRemote("control")} disabled={!!busyAction || !isOnline} data-testid="cockpit-remote-desktop">
                {busyAction === "remote" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Monitor className="w-3 h-3 mr-1 text-violet-400" />}Desktop
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-[11px] border-cyan-500/30 hover:bg-cyan-500/10" onClick={() => openRemote("terminal")} disabled={!!busyAction || !isOnline} data-testid="cockpit-remote-terminal">
                <Terminal className="w-3 h-3 mr-1 text-cyan-400" />Terminal
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-[11px] border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => openRemote("file")} disabled={!!busyAction || !isOnline} data-testid="cockpit-remote-files">
                <FolderOpen className="w-3 h-3 mr-1 text-emerald-400" />Files
              </Button>
            </div>
          </div>

          {/* Power + maintenance row */}
          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Quick Actions</Label>
            <div className="grid grid-cols-2 gap-1.5">
              <Button size="sm" variant="outline" className="h-8 text-[11px] justify-start" onClick={() => setConfirm({ kind: "reboot" })} disabled={!!busyAction || !isOnline} data-testid="cockpit-reboot">
                <Power className="w-3 h-3 mr-1 text-amber-400" />Reboot
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-[11px] justify-start" onClick={() => setConfirm({ kind: "shutdown" })} disabled={!!busyAction || !isOnline} data-testid="cockpit-shutdown">
                <Power className="w-3 h-3 mr-1 text-rose-400" />Shutdown
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-[11px] justify-start" onClick={() => runAction("wol", "Wake-on-LAN")} disabled={!!busyAction || isOnline} data-testid="cockpit-wol">
                <Wifi className="w-3 h-3 mr-1 text-blue-400" />Wake-on-LAN
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-[11px] justify-start" onClick={() => setConfirm({ kind: "send-message" })} disabled={!!busyAction || !isOnline} data-testid="cockpit-message">
                <MessageSquareWarning className="w-3 h-3 mr-1 text-cyan-400" />Message User
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-[11px] justify-start" onClick={() => runAction("run-checks", "Run checks")} disabled={!!busyAction} data-testid="cockpit-runchecks">
                <RefreshCw className="w-3 h-3 mr-1 text-violet-400" />Run Checks
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-[11px] justify-start" onClick={() => runAction("install-patches", "Install patches")} disabled={!!busyAction} data-testid="cockpit-patch">
                <Download className="w-3 h-3 mr-1 text-emerald-400" />Install Patches
              </Button>
            </div>
          </div>

          {/* Live gauges */}
          {(agent || deviceStatus) && (
            <div className="space-y-2 pt-2 border-t border-border/40">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Activity className="w-3 h-3" />Telemetry</Label>
              <Gauge label="CPU" value={cpu} icon={Cpu} color="violet" />
              <Gauge label="Memory used" value={ram} icon={MemoryStick} color="emerald" />
              {agent?.disks?.[0]?.percent != null && <Gauge label={`Disk ${agent.disks[0].device || ""}`} value={agent.disks[0].percent} icon={HardDrive} color="amber" />}
              {agent?.boot_time && <p className="text-[10px] text-muted-foreground">Booted: {new Date(agent.boot_time).toLocaleString()}</p>}
            </div>
          )}

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid grid-cols-3 h-7">
              <TabsTrigger value="services" className="text-[10px] h-5" data-testid="cockpit-tab-services">Services</TabsTrigger>
              <TabsTrigger value="processes" className="text-[10px] h-5" data-testid="cockpit-tab-processes">Processes</TabsTrigger>
              <TabsTrigger value="patches" className="text-[10px] h-5" data-testid="cockpit-tab-patches">Patches</TabsTrigger>
            </TabsList>

            <TabsContent value="services" className="mt-2">
              <div className="relative mb-2">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input value={serviceQuery} onChange={e => setServiceQuery(e.target.value)} placeholder="Filter services…" className="pl-7 h-7 text-xs" data-testid="cockpit-service-filter" />
              </div>
              {loadingTab ? <Loader2 className="w-4 h-4 mx-auto animate-spin text-muted-foreground" /> : (
                <ScrollArea className="h-[180px]">
                  {filteredServices.length === 0 ? <p className="text-[11px] text-muted-foreground text-center py-4">No services</p> : filteredServices.map(svc => {
                    const running = (svc.status || "").toLowerCase().includes("run");
                    return (
                      <div key={svc.name} className="flex items-center justify-between gap-2 py-1 px-1.5 rounded hover:bg-muted/40" data-testid={`cockpit-svc-${svc.name}`}>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium truncate">{svc.display_name || svc.name}</p>
                          <p className="text-[9px] text-muted-foreground truncate">{svc.name} · {svc.start_type || "—"}</p>
                        </div>
                        <Badge variant="outline" className={`text-[9px] h-4 ${running ? "text-emerald-400 border-emerald-500/40" : "text-muted-foreground"}`}>{svc.status || "?"}</Badge>
                        <div className="flex items-center gap-0.5">
                          {!running && <Button size="sm" variant="ghost" className="h-5 w-5 p-0" title="Start" onClick={() => serviceAction(svc, "start")} disabled={!!busyAction}><Play className="w-2.5 h-2.5 text-emerald-400" /></Button>}
                          {running && <Button size="sm" variant="ghost" className="h-5 w-5 p-0" title="Stop" onClick={() => serviceAction(svc, "stop")} disabled={!!busyAction}><Square className="w-2.5 h-2.5 text-rose-400" /></Button>}
                          <Button size="sm" variant="ghost" className="h-5 w-5 p-0" title="Restart" onClick={() => serviceAction(svc, "restart")} disabled={!!busyAction}><RotateCcw className="w-2.5 h-2.5 text-amber-400" /></Button>
                        </div>
                      </div>
                    );
                  })}
                </ScrollArea>
              )}
            </TabsContent>

            <TabsContent value="processes" className="mt-2">
              {loadingTab ? <Loader2 className="w-4 h-4 mx-auto animate-spin text-muted-foreground" /> : (
                <ScrollArea className="h-[200px]">
                  <div className="text-[10px] text-muted-foreground px-1.5 mb-1">Top {topProcesses.length} by CPU</div>
                  {topProcesses.length === 0 ? <p className="text-[11px] text-muted-foreground text-center py-4">No processes</p> : topProcesses.map(p => (
                    <div key={p.pid} className="flex items-center justify-between gap-2 py-1 px-1.5 rounded hover:bg-muted/40" data-testid={`cockpit-proc-${p.pid}`}>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium truncate">{p.name}</p>
                        <p className="text-[9px] text-muted-foreground">PID {p.pid} · {fmtBytes(p.memory)} · {(p.cpu_percent || 0).toFixed(1)}% CPU</p>
                      </div>
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0" title="Kill" onClick={() => killProcess(p)} disabled={!!busyAction}>
                        <Skull className="w-3 h-3 text-rose-400" />
                      </Button>
                    </div>
                  ))}
                </ScrollArea>
              )}
            </TabsContent>

            <TabsContent value="patches" className="mt-2">
              {loadingTab ? <Loader2 className="w-4 h-4 mx-auto animate-spin text-muted-foreground" /> : (
                <ScrollArea className="h-[200px]">
                  {(!winupdates || winupdates.length === 0) ? <p className="text-[11px] text-muted-foreground text-center py-4">All up to date 🎉</p> : winupdates.map(p => (
                    <div key={p.id || p.kb || p.guid} className="py-1 px-1.5 rounded hover:bg-muted/40 border-l-2 border-l-cyan-500/40 mb-1" data-testid={`cockpit-patch-${p.kb || p.id}`}>
                      <p className="text-[11px] font-medium truncate">{p.title || p.kb || "Update"}</p>
                      <p className="text-[9px] text-muted-foreground">{p.kb || "—"} · {p.severity || "normal"}</p>
                    </div>
                  ))}
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Confirm dialog (reboot/shutdown/message) */}
      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent className="max-w-sm" data-testid="cockpit-confirm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirm?.kind === "reboot" && <><Power className="w-4 h-4 text-amber-400" />Reboot device</>}
              {confirm?.kind === "shutdown" && <><Power className="w-4 h-4 text-rose-400" />Shutdown device</>}
              {confirm?.kind === "send-message" && <><MessageSquareWarning className="w-4 h-4 text-cyan-400" />Message the user</>}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {confirm?.kind === "reboot" && "The device will reboot immediately. The action will be logged on this ticket."}
              {confirm?.kind === "shutdown" && "The device will shutdown after a 60s grace period. The action will be logged on this ticket."}
              {confirm?.kind === "send-message" && "A notification popup will appear on the user's screen."}
            </DialogDescription>
          </DialogHeader>
          {confirm?.kind === "send-message" && (
            <Textarea value={msgBody} onChange={e => setMsgBody(e.target.value)} placeholder="Hi! Just a heads up — I'll be working on your machine for a few minutes…" rows={4} data-testid="cockpit-message-body" />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            {confirm?.kind === "reboot" && <Button onClick={() => { runAction("reboot", "Reboot"); setConfirm(null); }} disabled={!!busyAction} data-testid="cockpit-confirm-reboot">Reboot now</Button>}
            {confirm?.kind === "shutdown" && <Button variant="destructive" onClick={() => { runAction("shutdown", "Shutdown"); setConfirm(null); }} disabled={!!busyAction} data-testid="cockpit-confirm-shutdown">Shutdown</Button>}
            {confirm?.kind === "send-message" && <Button onClick={sendMessage} disabled={!msgBody.trim() || !!busyAction} data-testid="cockpit-confirm-message">Send</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Terminal modal */}
      <Dialog open={terminalOpen} onOpenChange={setTerminalOpen}>
        <DialogContent className="max-w-5xl h-[80vh] p-0 gap-0" data-testid="cockpit-terminal-modal">
          <DialogHeader className="px-4 py-2 border-b border-border/50">
            <DialogTitle className="text-sm flex items-center gap-2"><Terminal className="w-4 h-4 text-cyan-400" />Live Terminal</DialogTitle>
          </DialogHeader>
          {terminalUrl ? (
            <iframe src={terminalUrl} title="terminal" className="w-full h-full border-0 bg-black" data-testid="cockpit-terminal-iframe" />
          ) : <div className="flex-1 flex items-center justify-center text-muted-foreground">Loading…</div>}
        </DialogContent>
      </Dialog>
    </>
  );
}
