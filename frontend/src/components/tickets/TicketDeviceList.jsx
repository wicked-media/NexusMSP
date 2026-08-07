/**
 * TicketDeviceList — compact per-device rows with a 3-dot CRAIG-style action menu.
 *
 * Each device shows: name · status pill · mini telemetry · 3-dot dropdown
 * The dropdown has labelled action groups: Take Control · Power · Maintenance · Data
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  MoreVertical, Monitor, Terminal, FolderOpen, Power, Wifi, RefreshCw,
  Download, MessageSquareWarning, Wrench, Cpu, MemoryStick, HardDrive,
  Loader2, Activity, Zap, Search, Play, Square, RotateCcw, Skull, ChevronRight, Sparkles, Gauge, Camera, BrainCircuit,
} from "lucide-react";
import { API } from "@/App";

const fmtBytes = (n) => {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
};

function MiniGauge({ value, label, icon: Icon }) {
  const v = Math.min(100, Math.max(0, Number(value) || 0));
  const tone = v > 90 ? "bg-rose-500" : v > 75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-1 min-w-0" aria-label={`${label}: ${v.toFixed(0)} percent`}>
      {Icon && <Icon className="w-3 h-3 text-zinc-500 shrink-0" />}
      <div className="flex-1 min-w-[40px] max-w-[80px] h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-[10px] font-mono text-zinc-400 w-8 text-right">{v.toFixed(0)}%</span>
    </div>
  );
}

function DeviceRow({ device, ticketId, headers, onMutate }) {
  const [agent, setAgent] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null); // {kind}
  const [msgBody, setMsgBody] = useState("");
  const [dataPaneOpen, setDataPaneOpen] = useState(null); // services | processes | patches
  const [services, setServices] = useState([]);
  const [serviceQuery, setServiceQuery] = useState("");
  const [processes, setProcesses] = useState([]);
  const [winupdates, setWinupdates] = useState([]);
  const [paneLoading, setPaneLoading] = useState(false);
  const [terminalUrl, setTerminalUrl] = useState(null);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [metricsData, setMetricsData] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagData, setDiagData] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const qs = `?device_id=${encodeURIComponent(device.id)}`;

  // Live telemetry poll (only if has TRMM agent and online)
  const fetchAgent = useCallback(async () => {
    if (!device.has_agent) return;
    try {
      const r = await axios.get(`${API}/tickets/${ticketId}/device/agent${qs}`, { headers });
      setAgent(r.data);
    } catch { /* ignore */ }
    // eslint-disable-next-line
  }, [device.id, ticketId, headers]);

  useEffect(() => {
    fetchAgent();
    if (!device.has_agent) return;
    const t = setInterval(fetchAgent, 30000);
    return () => clearInterval(t);
  }, [fetchAgent, device.has_agent]);

  const isOnline = (agent?.status || device.status) === "online";
  const cpu = agent?.cpu_load ?? 0;
  const ram = agent?.used_ram ?? 0;
  const disk = agent?.disks?.[0]?.percent;

  const runAction = async (path, label, opts = {}) => {
    if (!device.has_agent) { toast.error("Device has no TRMM agent"); return; }
    setBusy(label);
    try {
      const url = `${API}/tickets/${ticketId}/device/${path}${qs}`;
      const r = await axios.post(url, opts.body || {}, { headers });
      const ok = r.data?.success !== false;
      ok ? toast.success(`${device.name} — ${label}`) : toast.warning(r.data?.message || `${label} returned a warning`);
      onMutate?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || `${label} failed`);
    } finally { setBusy(null); }
  };

  const openRemote = async (kind) => {
    if (!device.has_agent) return;
    setBusy("remote");
    try {
      const r = await axios.get(`${API}/tickets/${ticketId}/device/remote-url${qs}`, { headers });
      if (!r.data?.success) { toast.error(r.data?.message || "Failed"); return; }
      const urls = r.data?.urls || {};
      const url = urls[kind] || urls.control || urls.terminal || urls.file;
      if (!url) { toast.error("No URL returned"); return; }
      if (kind === "terminal") setTerminalUrl(url);
      else window.open(url, "_blank", "noopener");
      onMutate?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Remote failed"); }
    finally { setBusy(null); }
  };

  const sendMessage = async () => {
    if (!msgBody.trim()) return;
    await runAction("send-message", "Send message", { body: { title: "Message from IT", body: msgBody } });
    setMsgBody(""); setConfirm(null);
  };

  const loadDataPane = useCallback(async (kind) => {
    setPaneLoading(true);
    try {
      if (kind === "services") {
        const r = await axios.get(`${API}/tickets/${ticketId}/device/services${qs}`, { headers });
        setServices(Array.isArray(r.data) ? r.data : r.data?.services || []);
      } else if (kind === "processes") {
        const r = await axios.get(`${API}/tickets/${ticketId}/device/processes${qs}`, { headers });
        setProcesses(Array.isArray(r.data) ? r.data : []);
      } else if (kind === "patches") {
        const r = await axios.get(`${API}/tickets/${ticketId}/device/winupdates${qs}`, { headers });
        setWinupdates(Array.isArray(r.data) ? r.data : []);
      }
    } catch { /* ignore */ }
    finally { setPaneLoading(false); }
    // eslint-disable-next-line
  }, [device.id, ticketId, headers]);

  useEffect(() => {
    if (dataPaneOpen) loadDataPane(dataPaneOpen);
  }, [dataPaneOpen, loadDataPane]);

  const serviceAction = async (svc, action) => {
    setBusy(`svc-${svc.name}`);
    try {
      await axios.post(`${API}/tickets/${ticketId}/device/services/${encodeURIComponent(svc.name)}/${action}${qs}`, {}, { headers });
      toast.success(`${svc.name}: ${action}`);
      loadDataPane("services");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setBusy(null); }
  };

  const killProcess = async (p) => {
    if (!window.confirm(`Kill ${p.name} (PID ${p.pid})?`)) return;
    setBusy(`kill-${p.pid}`);
    try {
      await axios.post(`${API}/tickets/${ticketId}/device/processes/${p.pid}/kill${qs}`, {}, { headers });
      toast.success(`Killed PID ${p.pid}`);
      loadDataPane("processes");
    } catch (e) { toast.error(e.response?.data?.detail || "Kill failed"); }
    finally { setBusy(null); }
  };

  const filteredServices = useMemo(() => {
    if (!serviceQuery.trim()) return services.slice(0, 80);
    const q = serviceQuery.toLowerCase();
    return services.filter(s => (s.display_name || s.name || "").toLowerCase().includes(q)).slice(0, 100);
  }, [services, serviceQuery]);

  const topProcesses = useMemo(() => {
    const arr = [...processes].sort((a, b) => (b.cpu_percent || 0) - (a.cpu_percent || 0));
    return arr.slice(0, 30);
  }, [processes]);

  const disabled = !device.has_agent;

  // ─────────────────── Smart actions: Live Metrics, AI Diagnose, Snapshot ───────────────────
  const openMetrics = async () => {
    setMetricsOpen(true);
    setMetricsLoading(true);
    try {
      const r = await axios.get(`${API}/devices/${device.id}/live-metrics?minutes=30`, { headers });
      setMetricsData(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Metrics failed"); }
    finally { setMetricsLoading(false); }
  };

  const runDiagnose = async () => {
    setDiagOpen(true);
    setDiagLoading(true);
    setDiagData(null);
    try {
      const r = await axios.post(`${API}/devices/${device.id}/ai-diagnose`, { ticket_id: ticketId }, { headers });
      setDiagData(r.data);
      if (r.data?.posted_to_ticket) toast.success("AI Diagnose posted to ticket");
      onMutate?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Diagnose failed"); }
    finally { setDiagLoading(false); }
  };

  const snapToTicket = async () => {
    setBusy("snapshot");
    try {
      const r = await axios.post(`${API}/devices/${device.id}/screenshot-to-ticket`, { ticket_id: ticketId }, { headers });
      toast.success(r.data?.pending ? "Screenshot requested — agent will respond shortly." : "Screenshot captured & posted to ticket");
      onMutate?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Screenshot failed"); }
    finally { setBusy(null); }
  };

  return (
    <>
      <div
        className={`flex items-center gap-3 px-3 py-2.5 rounded-md border ${isOnline ? "border-emerald-500/20 bg-emerald-500/[0.02]" : "border-zinc-800 bg-zinc-900/30"} hover:bg-zinc-900/50 transition-colors`}
        data-testid={`device-row-${device.id}`}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`} />
        <Monitor className="w-4 h-4 text-zinc-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{device.name}</span>
            {device.is_primary && <Badge variant="outline" className="text-[9px] uppercase text-violet-300 border-violet-500/40">Primary</Badge>}
            {!device.has_agent && <Badge variant="outline" className="text-[9px] uppercase text-amber-300 border-amber-500/40">No Agent</Badge>}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono truncate">
            {device.os_name || "—"} · {device.ip_address || "—"} · {device.device_type || "endpoint"}
            {agent?.logged_in_username && <> · user: {agent.logged_in_username}</>}
          </div>
        </div>

        {/* Mini telemetry */}
        {device.has_agent && (
          <div className="hidden md:flex flex-col gap-0.5 w-[260px]">
            <MiniGauge value={cpu} label="CPU" icon={Cpu} />
            <div className="flex items-center gap-2">
              <MiniGauge value={ram} label="RAM" icon={MemoryStick} />
              {disk != null && <MiniGauge value={disk} label="Disk" icon={HardDrive} />}
            </div>
          </div>
        )}

        {/* INLINE QUICK ACTIONS — Syncro-killer: always-visible icon buttons */}
        <div className="flex items-center gap-0.5 shrink-0" data-testid={`inline-actions-${device.id}`}>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-violet-500/15"
            disabled={disabled || !isOnline} title="Remote Desktop" onClick={() => openRemote("control")}
            data-testid={`inline-remote-${device.id}`}>
            <Monitor className="w-3.5 h-3.5 text-violet-400" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-cyan-500/15"
            disabled={disabled || !isOnline} title="Live Terminal" onClick={() => openRemote("terminal")}
            data-testid={`inline-terminal-${device.id}`}>
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-emerald-500/15"
            disabled={disabled || !isOnline} title="File Browser" onClick={() => openRemote("file")}
            data-testid={`inline-files-${device.id}`}>
            <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-sky-500/15"
            title="Live Metrics" onClick={openMetrics} data-testid={`inline-metrics-${device.id}`}>
            <Gauge className="w-3.5 h-3.5 text-sky-400" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-amber-500/15"
            disabled={disabled || !isOnline} title="Reboot"
            onClick={() => setConfirm({ kind: "reboot" })}
            data-testid={`inline-reboot-${device.id}`}>
            <Power className="w-3.5 h-3.5 text-amber-400" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-fuchsia-500/15"
            title="AI Diagnose" onClick={runDiagnose} data-testid={`inline-diagnose-${device.id}`}>
            <BrainCircuit className="w-3.5 h-3.5 text-fuchsia-400" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-rose-500/15"
            disabled={disabled || !isOnline} title="Snapshot screen → Ticket"
            onClick={snapToTicket} data-testid={`inline-snapshot-${device.id}`}>
            {busy === "snapshot" ? <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" /> : <Camera className="w-3.5 h-3.5 text-rose-400" />}
          </Button>
        </div>

        {/* 3-dot CRAIG-style menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={disabled} data-testid={`device-menu-${device.id}`}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60" data-testid={`device-menu-content-${device.id}`}>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest font-mono text-zinc-500">Take Control</DropdownMenuLabel>
            <DropdownMenuItem disabled={!isOnline} onClick={() => openRemote("control")} data-testid={`act-${device.id}-desktop`}>
              <Monitor className="w-3.5 h-3.5 mr-2 text-violet-400" />Remote Desktop
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!isOnline} onClick={() => openRemote("terminal")} data-testid={`act-${device.id}-terminal`}>
              <Terminal className="w-3.5 h-3.5 mr-2 text-cyan-400" />Live Terminal
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!isOnline} onClick={() => openRemote("file")} data-testid={`act-${device.id}-files`}>
              <FolderOpen className="w-3.5 h-3.5 mr-2 text-emerald-400" />File Browser
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest font-mono text-zinc-500">Power</DropdownMenuLabel>
            <DropdownMenuItem disabled={!isOnline} onClick={() => setConfirm({ kind: "reboot" })} data-testid={`act-${device.id}-reboot`}>
              <Power className="w-3.5 h-3.5 mr-2 text-amber-400" />Reboot
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!isOnline} onClick={() => setConfirm({ kind: "shutdown" })} data-testid={`act-${device.id}-shutdown`}>
              <Power className="w-3.5 h-3.5 mr-2 text-rose-400" />Shutdown
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isOnline} onClick={() => runAction("wol", "Wake-on-LAN")} data-testid={`act-${device.id}-wol`}>
              <Wifi className="w-3.5 h-3.5 mr-2 text-blue-400" />Wake-on-LAN
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest font-mono text-zinc-500">Maintenance</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => runAction("run-checks", "Run checks")} data-testid={`act-${device.id}-checks`}>
              <RefreshCw className="w-3.5 h-3.5 mr-2 text-violet-400" />Run All Checks
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => runAction("install-patches", "Install patches")} data-testid={`act-${device.id}-patches`}>
              <Download className="w-3.5 h-3.5 mr-2 text-emerald-400" />Install Patches
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!isOnline} onClick={() => setConfirm({ kind: "send-message" })} data-testid={`act-${device.id}-message`}>
              <MessageSquareWarning className="w-3.5 h-3.5 mr-2 text-cyan-400" />Message User…
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest font-mono text-zinc-500">Inspect</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setDataPaneOpen("services")} data-testid={`act-${device.id}-services`}>
              <Wrench className="w-3.5 h-3.5 mr-2 text-zinc-400" />Services
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDataPaneOpen("processes")} data-testid={`act-${device.id}-processes`}>
              <Activity className="w-3.5 h-3.5 mr-2 text-zinc-400" />Processes
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDataPaneOpen("patches")} data-testid={`act-${device.id}-winupdates`}>
              <Zap className="w-3.5 h-3.5 mr-2 text-zinc-400" />Pending Patches
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Confirm dialog */}
      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent className="max-w-sm" data-testid={`confirm-${device.id}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirm?.kind === "reboot" && <><Power className="w-4 h-4 text-amber-400" />Reboot {device.name}?</>}
              {confirm?.kind === "shutdown" && <><Power className="w-4 h-4 text-rose-400" />Shutdown {device.name}?</>}
              {confirm?.kind === "send-message" && <><MessageSquareWarning className="w-4 h-4 text-cyan-400" />Message user on {device.name}</>}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {confirm?.kind === "reboot" && "The device will reboot immediately. Action audited on the ticket."}
              {confirm?.kind === "shutdown" && "The device shuts down after a 60-second grace. Action audited on the ticket."}
              {confirm?.kind === "send-message" && "A notification popup will appear on the user's screen."}
            </DialogDescription>
          </DialogHeader>
          {confirm?.kind === "send-message" && (
            <Textarea value={msgBody} onChange={e => setMsgBody(e.target.value)} placeholder="Hi! I'll be working on your machine for a few minutes…" rows={4} data-testid={`msg-body-${device.id}`} />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            {confirm?.kind === "reboot" && <Button onClick={() => { runAction("reboot", "Reboot"); setConfirm(null); }} data-testid={`confirm-reboot-${device.id}`}>Reboot now</Button>}
            {confirm?.kind === "shutdown" && <Button variant="destructive" onClick={() => { runAction("shutdown", "Shutdown"); setConfirm(null); }} data-testid={`confirm-shutdown-${device.id}`}>Shutdown</Button>}
            {confirm?.kind === "send-message" && <Button onClick={sendMessage} disabled={!msgBody.trim()} data-testid={`confirm-message-${device.id}`}>Send</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Data inspection pane (services / processes / patches) */}
      <Dialog open={!!dataPaneOpen} onOpenChange={(v) => !v && setDataPaneOpen(null)}>
        <DialogContent className="max-w-3xl" data-testid={`pane-${device.id}`}>
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Monitor className="w-4 h-4 text-violet-400" />{device.name}
              <Badge variant="outline" className="text-[10px] uppercase">{dataPaneOpen}</Badge>
            </DialogTitle>
          </DialogHeader>

          {dataPaneOpen === "services" && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
                <Input value={serviceQuery} onChange={e => setServiceQuery(e.target.value)} placeholder="Filter services…" className="pl-7 h-8 text-xs" />
              </div>
              {paneLoading ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin text-zinc-500" /></div> :
                <ScrollArea className="h-[400px]">
                  {filteredServices.length === 0 ? <p className="text-xs text-zinc-500 text-center py-4">No services</p> : filteredServices.map(svc => {
                    const running = (svc.status || "").toLowerCase().includes("run");
                    return (
                      <div key={svc.name} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-zinc-900/50">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{svc.display_name || svc.name}</p>
                          <p className="text-[9px] text-zinc-500 font-mono truncate">{svc.name} · {svc.start_type || "—"}</p>
                        </div>
                        <Badge variant="outline" className={`text-[9px] ${running ? "text-emerald-400 border-emerald-500/40" : "text-zinc-500"}`}>{svc.status || "?"}</Badge>
                        <div className="flex items-center gap-0.5">
                          {!running && <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Start" onClick={() => serviceAction(svc, "start")}><Play className="w-3 h-3 text-emerald-400" /></Button>}
                          {running && <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Stop" onClick={() => serviceAction(svc, "stop")}><Square className="w-3 h-3 text-rose-400" /></Button>}
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Restart" onClick={() => serviceAction(svc, "restart")}><RotateCcw className="w-3 h-3 text-amber-400" /></Button>
                        </div>
                      </div>
                    );
                  })}
                </ScrollArea>
              }
            </div>
          )}

          {dataPaneOpen === "processes" && (
            paneLoading ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin text-zinc-500" /></div> :
            <ScrollArea className="h-[400px]">
              <div className="text-[10px] text-zinc-500 px-2 mb-1">Top {topProcesses.length} by CPU</div>
              {topProcesses.length === 0 ? <p className="text-xs text-zinc-500 text-center py-4">No processes</p> : topProcesses.map(p => (
                <div key={p.pid} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-zinc-900/50">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{p.name}</p>
                    <p className="text-[9px] text-zinc-500 font-mono">PID {p.pid} · {fmtBytes(p.memory)} · {(p.cpu_percent || 0).toFixed(1)}% CPU</p>
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Kill" onClick={() => killProcess(p)}><Skull className="w-3 h-3 text-rose-400" /></Button>
                </div>
              ))}
            </ScrollArea>
          )}

          {dataPaneOpen === "patches" && (
            paneLoading ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin text-zinc-500" /></div> :
            <ScrollArea className="h-[400px]">
              {(!winupdates || winupdates.length === 0) ? <p className="text-xs text-zinc-500 text-center py-4">All up to date 🎉</p> : winupdates.map(p => (
                <div key={p.id || p.kb || p.guid} className="py-1.5 px-2 rounded hover:bg-zinc-900/50 border-l-2 border-l-cyan-500/40 mb-1">
                  <p className="text-xs font-medium truncate">{p.title || p.kb || "Update"}</p>
                  <p className="text-[9px] text-zinc-500 font-mono">{p.kb || "—"} · {p.severity || "normal"}</p>
                </div>
              ))}
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Live Metrics Drawer */}
      <Dialog open={metricsOpen} onOpenChange={(v) => !v && setMetricsOpen(false)}>
        <DialogContent className="max-w-3xl" data-testid={`metrics-drawer-${device.id}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Gauge className="w-4 h-4 text-sky-400" />Live Metrics — {device.name}</DialogTitle>
            <DialogDescription className="text-xs">Last {metricsData?.minutes || 30} minutes · auto-refreshing every 30s</DialogDescription>
          </DialogHeader>
          {metricsLoading && !metricsData ? <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div> :
            metricsData && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "CPU", value: metricsData.current.cpu, color: "violet", icon: Cpu },
                    { label: "Memory", value: metricsData.current.memory, color: "cyan", icon: MemoryStick },
                    { label: "Disk", value: metricsData.current.disk, color: "emerald", icon: HardDrive },
                  ].map(({ label, value, color, icon: Icon }) => (
                    <Card key={label} className={`bg-gradient-to-br from-${color}-500/10 to-transparent border-${color}-500/30`}>
                      <CardContent className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400">
                          <Icon className="w-3 h-3" />{label}
                        </div>
                        <div className={`text-3xl font-light mt-1 text-${color}-300`}>{Math.round(value || 0)}<span className="text-base text-zinc-500">%</span></div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Compact SVG sparkline */}
                <Card>
                  <CardContent className="p-3">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">CPU / Memory trend</div>
                    {(() => {
                      const s = metricsData.series || [];
                      if (s.length < 2) return <p className="text-xs text-zinc-500">Not enough data points yet.</p>;
                      const w = 600, h = 120, pad = 6;
                      const xStep = (w - pad * 2) / Math.max(1, s.length - 1);
                      const toY = (v) => h - pad - (Math.max(0, Math.min(100, v)) / 100) * (h - pad * 2);
                      const cpuPath = s.map((p, i) => `${i === 0 ? "M" : "L"}${pad + i * xStep},${toY(p.cpu)}`).join(" ");
                      const memPath = s.map((p, i) => `${i === 0 ? "M" : "L"}${pad + i * xStep},${toY(p.memory)}`).join(" ");
                      return (
                        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-28">
                          <rect width={w} height={h} fill="rgba(15,23,42,0.4)" rx="6" />
                          <path d={cpuPath} fill="none" stroke="#a78bfa" strokeWidth="1.5" />
                          <path d={memPath} fill="none" stroke="#22d3ee" strokeWidth="1.5" />
                          {[25, 50, 75].map(g => <line key={g} x1={pad} x2={w - pad} y1={toY(g)} y2={toY(g)} stroke="rgba(255,255,255,0.04)" />)}
                        </svg>
                      );
                    })()}
                    <div className="flex items-center gap-4 mt-1 text-[10px]">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-400" />CPU</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400" />Memory</span>
                      {metricsData.series?.some(s => s.synthetic) && <Badge variant="outline" className="text-[9px] ml-auto">synthesised (no agent data)</Badge>}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          <DialogFooter>
            <Button variant="outline" onClick={openMetrics}><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
            <Button onClick={() => setMetricsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Diagnose Dialog */}
      <Dialog open={diagOpen} onOpenChange={(v) => !v && setDiagOpen(false)}>
        <DialogContent className="max-w-2xl" data-testid={`diagnose-${device.id}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BrainCircuit className="w-4 h-4 text-fuchsia-400" />AI Diagnose — {device.name}</DialogTitle>
            <DialogDescription className="text-xs">Nexus AI analyses telemetry, events, services, and patches, then posts the result to the ticket.</DialogDescription>
          </DialogHeader>
          {diagLoading ? <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div> :
            diagData && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge className={`text-sm px-3 py-1 ${diagData.severity === "critical" ? "bg-rose-500/20 text-rose-300 border-rose-500/40" : diagData.severity === "high" ? "bg-rose-500/15 text-rose-300 border-rose-500/30" : diagData.severity === "medium" ? "bg-amber-500/20 text-amber-300 border-amber-500/30" : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"}`}>
                    {String(diagData.severity || "").toUpperCase()}
                  </Badge>
                  {diagData.posted_to_ticket && <Badge variant="outline" className="text-[10px] text-emerald-300 border-emerald-500/40">Posted to ticket</Badge>}
                </div>
                <Card className="bg-fuchsia-500/5 border-fuchsia-500/30">
                  <CardContent className="p-3">
                    <pre className="text-xs whitespace-pre-wrap font-sans text-zinc-200">{diagData.diagnosis}</pre>
                  </CardContent>
                </Card>
                {(diagData.actions || []).length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Recommended actions</div>
                    <ul className="space-y-1">
                      {diagData.actions.map((a, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <ChevronRight className="w-3 h-3 text-fuchsia-400" />{a}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {diagData.signals && (
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(diagData.signals).map(([k, v]) => (
                      <div key={k} className="text-[10px] text-zinc-500 p-2 rounded bg-zinc-900/60">
                        <div className="uppercase tracking-wider">{k.replace(/_/g, " ")}</div>
                        <div className="text-zinc-200 font-mono">{String(v)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          <DialogFooter>
            <Button variant="outline" onClick={runDiagnose} disabled={diagLoading}><RefreshCw className="w-3 h-3 mr-1" />Re-run</Button>
            <Button onClick={() => setDiagOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Terminal modal */}
      <Dialog open={!!terminalUrl} onOpenChange={(v) => !v && setTerminalUrl(null)}>
        <DialogContent className="max-w-5xl h-[80vh] p-0 gap-0">
          <DialogHeader className="px-4 py-2 border-b border-zinc-800">
            <DialogTitle className="text-sm flex items-center gap-2"><Terminal className="w-4 h-4 text-cyan-400" />Live Terminal — {device.name}</DialogTitle>
          </DialogHeader>
          {terminalUrl && <iframe src={terminalUrl} title="terminal" className="w-full h-full border-0 bg-black" />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function TicketDeviceList({ ticketId, headers, refreshTicketDetails }) {
  const [data, setData] = useState({ devices: [], primary_id: null });
  const [loading, setLoading] = useState(true);
  const [fanoutResults, setFanoutResults] = useState(null); // { action, results: [...] }
  const [fanoutBusy, setFanoutBusy] = useState(null);
  const [fanoutConfirm, setFanoutConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/tickets/${ticketId}/devices`, { headers });
      setData(r.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [ticketId, headers]);

  useEffect(() => { load(); }, [load]);

  const runFanout = async (action, label, payload = {}) => {
    setFanoutBusy(action);
    // Seed initial in-progress strip so the UI shows immediate feedback
    const targets = (data.devices || []).filter(d => d.has_agent);
    setFanoutResults({
      action: label,
      results: targets.map(d => ({ device_id: d.id, device_name: d.name, status: "running" })),
    });
    try {
      const r = await axios.post(`${API}/tickets/${ticketId}/device/fanout/${action}`, payload, { headers });
      setFanoutResults({ action: label, results: r.data.results, summary: r.data.summary });
      const s = r.data.summary;
      toast.success(`${label} → ${s.ok} OK · ${s.failed} failed · ${s.skipped} skipped`);
      refreshTicketDetails?.();
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || `${label} failed`);
      setFanoutResults(null);
    } finally {
      setFanoutBusy(null);
      setFanoutConfirm(null);
    }
  };

  if (loading) {
    return <Card><CardContent className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></CardContent></Card>;
  }

  const devices = data.devices || [];
  const agentCount = devices.filter(d => d.has_agent).length;

  return (
    <Card data-testid="ticket-device-list" className="border-violet-500/20 bg-gradient-to-br from-card via-card to-violet-500/[0.02]">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Monitor className="w-4 h-4 text-violet-400" />Linked Devices
          <Badge variant="outline" className="text-[9px] uppercase">{devices.length}</Badge>
        </CardTitle>
        <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={load} data-testid="device-list-refresh">
          <RefreshCw className="w-3 h-3 mr-1" />Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {devices.length === 0 ? (
          <p className="text-xs text-zinc-500 text-center py-4">No devices linked. Link a device to enable remote actions.</p>
        ) : (
          <>
            {/* Fan-out master row — only when 2+ devices have agents */}
            {agentCount >= 2 && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-md border border-fuchsia-500/30 bg-gradient-to-r from-fuchsia-500/10 via-violet-500/10 to-cyan-500/5"
                data-testid="device-fanout-row"
              >
                <Sparkles className="w-4 h-4 text-fuchsia-400 shrink-0" />
                <span className="text-xs font-medium text-fuchsia-200">Run on all {agentCount} devices</span>
                <span className="text-[10px] text-zinc-500 font-mono ml-1 hidden md:inline">in parallel · audited</span>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    size="sm" variant="outline"
                    className="h-7 text-[10px] border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
                    disabled={!!fanoutBusy}
                    onClick={() => runFanout("run-checks", "Run Checks (all)")}
                    data-testid="fanout-checks"
                  >
                    {fanoutBusy === "run-checks" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Checks
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    className="h-7 text-[10px] border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                    disabled={!!fanoutBusy}
                    onClick={() => runFanout("install-patches", "Install Patches (all)")}
                    data-testid="fanout-patches"
                  >
                    {fanoutBusy === "install-patches" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}Patches
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    className="h-7 text-[10px] border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                    disabled={!!fanoutBusy}
                    onClick={() => setFanoutConfirm("reboot")}
                    data-testid="fanout-reboot"
                  >
                    <Power className="w-3 h-3 mr-1" />Reboot
                  </Button>
                </div>
              </div>
            )}

            {/* Progress strip — appears during/after fan-out */}
            {fanoutResults && (
              <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 space-y-1" data-testid="fanout-progress">
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 uppercase tracking-widest">
                  <span>{fanoutResults.action}</span>
                  {fanoutResults.summary && (
                    <span>
                      <span className="text-emerald-400">{fanoutResults.summary.ok} ok</span>
                      {" · "}<span className="text-rose-400">{fanoutResults.summary.failed} failed</span>
                      {" · "}<span className="text-zinc-500">{fanoutResults.summary.skipped} skipped</span>
                    </span>
                  )}
                  <button className="text-zinc-500 hover:text-zinc-300" onClick={() => setFanoutResults(null)} data-testid="fanout-progress-clear">clear</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                  {fanoutResults.results.map(r => {
                    const tone = r.status === "ok" ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/5" :
                                 r.status === "failed" ? "text-rose-300 border-rose-500/30 bg-rose-500/5" :
                                 r.status === "skipped" ? "text-zinc-500 border-zinc-700 bg-zinc-900/50" :
                                 "text-cyan-300 border-cyan-500/30 bg-cyan-500/5";
                    const icon = r.status === "ok" ? "✓" : r.status === "failed" ? "✗" : r.status === "skipped" ? "—" : "⟳";
                    return (
                      <div
                        key={r.device_id}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] ${tone} ${r.status === "running" ? "animate-pulse" : ""}`}
                        title={r.message || r.status}
                        data-testid={`fanout-result-${r.device_id}`}
                      >
                        <span className="font-mono">{icon}</span>
                        <span className="truncate flex-1">{r.device_name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {devices.map(d => (
              <DeviceRow
                key={d.id}
                device={d}
                ticketId={ticketId}
                headers={headers}
                onMutate={() => { load(); refreshTicketDetails?.(); }}
              />
            ))}
            <p className="text-[10px] text-zinc-600 font-mono text-center pt-1">All actions audited on this ticket · 3-dot menu per device</p>
          </>
        )}
      </CardContent>

      {/* Fan-out reboot confirmation */}
      <Dialog open={fanoutConfirm === "reboot"} onOpenChange={(v) => !v && setFanoutConfirm(null)}>
        <DialogContent className="max-w-sm" data-testid="fanout-reboot-confirm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Power className="w-4 h-4 text-amber-400" />Reboot all {agentCount} devices?</DialogTitle>
            <DialogDescription className="text-xs">
              Each linked device will reboot immediately in parallel. Offline devices and devices without an agent will be skipped. The action is audited on this ticket.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFanoutConfirm(null)}>Cancel</Button>
            <Button onClick={() => runFanout("reboot", "Reboot (all)")} disabled={!!fanoutBusy} data-testid="fanout-reboot-go">Reboot all</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
