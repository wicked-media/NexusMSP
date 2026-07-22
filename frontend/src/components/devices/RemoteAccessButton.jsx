import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Play, RefreshCw, ChevronDown, Monitor, Settings, ExternalLink,
  XCircle, MonitorSmartphone,
} from "lucide-react";
import { API, useAuth } from "@/App";

const PROVIDER_LABEL = {
  rustdesk: "RustDesk",
  meshcentral: "MeshCentral",
  splashtop: "Splashtop",
  screenconnect: "ScreenConnect",
  teamviewer: "TeamViewer",
  anydesk: "AnyDesk",
  guacamole: "Apache Guacamole",
};

const PROVIDER_ICON = {
  rustdesk: MonitorSmartphone,
  meshcentral: Monitor,
};

/**
 * Unified Remote Access button.
 *
 * Picks a primary action based on what's configured and what's available on
 * this device. When multiple providers are available, opens a dropdown so the
 * tech can choose. Falls back to a "Configure" CTA when nothing is set up.
 */
export default function RemoteAccessButton({ device, status, onLaunchRustDesk, busy = false, testid = "remote-access-btn", compact = false, providersOverride = null }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [providers, setProviders] = useState(providersOverride || []);
  const [loading, setLoading] = useState(providersOverride === null);
  const [pendingProvider, setPendingProvider] = useState(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (providersOverride !== null) {
      setProviders(providersOverride);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${API}/remote-providers/active`, { headers });
        if (!cancelled) setProviders(res.data || []);
      } catch {
        if (!cancelled) setProviders([]);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [headers, providersOverride]);

  const isOffline = status === "offline";

  // Determine which providers actually apply to THIS device right now.
  const rdCfg = providers.find(p => p.id === "rustdesk");
  const splashtopCfg = providers.find(p => p.id === "splashtop");
  const otherCfg = providers.filter(p => !["trmm", "rustdesk", "splashtop"].includes(p.id));

  const rdReady = !!rdCfg && !!device?.rustdesk_id;
  const splashtopId = device?.remote_provider_ids?.splashtop || device?.splashtop_id || device?.splashtop_uuid;
  const splashtopReady = !!splashtopCfg && !!splashtopId;

  const requestProvider = (provider) => {
    setConsentConfirmed(false);
    setPendingProvider(provider);
  };

  const startSession = async () => {
    if (!pendingProvider || !device?.id) return;
    setStarting(true);
    try {
      const res = await axios.post(`${API}/devices/${device.id}/remote-sessions/start`, { provider: pendingProvider, consent_confirmed: consentConfirmed }, { headers });
      setSession(res.data);
      setPendingProvider(null);
      if (pendingProvider === "rustdesk") onLaunchRustDesk?.();
      if (pendingProvider === "splashtop") toast.info(res.data.message);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to start remote session");
    } finally { setStarting(false); }
  };

  const endSession = async () => {
    if (!session?.session?.id) return;
    try {
      await axios.put(`${API}/remote/sessions/${session.session.id}/end`, { lock_action_on_disconnect: "no_change" }, { headers });
      toast.success("Remote session ended and logged");
      setSession(null);
    } catch { toast.error("Unable to close the remote session record"); }
  };

  // Use only configured, supported remote providers. The old TRMM path was
  // retired with the legacy agent and must never appear as a working option.
  let primary = null;
  if (rdReady) primary = { id: "rustdesk", label: compact ? "Remote" : "Remote (RustDesk)", action: () => requestProvider("rustdesk") };
  else if (splashtopReady) primary = { id: "splashtop", label: compact ? "Remote" : "Remote (Splashtop)", action: () => requestProvider("splashtop") };
  else if (otherCfg.length === 1) primary = { id: otherCfg[0].id, label: compact ? "Remote" : `Remote (${otherCfg[0].name})`, action: () => toast.info(`${otherCfg[0].name} provider — open from Settings → Remote Providers`) };

  const sizeCls = compact ? "h-7 text-[11px] px-2" : "";

  // Loading state
  if (loading) {
    return (
      <Button size="sm" variant="outline" disabled className={sizeCls} data-testid={`${testid}-loading`}>
        <RefreshCw className={`${compact ? "w-3 h-3" : "w-4 h-4"} mr-1 animate-spin`} />Remote
      </Button>
    );
  }

  // Nothing configured at all → CTA
  if (!primary && providers.length === 0) {
    return (
      <Button size="sm" variant="outline" asChild className={sizeCls} data-testid={`${testid}-configure`}>
        <Link to="/settings?tab=integrations">
          <Settings className={`${compact ? "w-3 h-3" : "w-4 h-4"} mr-1`} /> {compact ? "Setup" : "Configure Remote"}
        </Link>
      </Button>
    );
  }

  // Providers exist globally but this device isn't linked to any → deep-link to device detail
  if (!primary && providers.length > 0 && device?.id) {
    return (
      <Button
        size="sm"
        variant="outline"
        asChild
        className={`text-amber-400 border-amber-500/30 hover:bg-amber-500/10 ${sizeCls}`}
        data-testid={`${testid}-link`}
      >
        <Link to={`/devices/${device.id}`}>
          <Settings className={`${compact ? "w-3 h-3" : "w-4 h-4"} mr-1`} /> Link
        </Link>
      </Button>
    );
  }

  // Remote sessions are only available when the endpoint is live.
  if (isOffline) {
    return (
      <Button size="sm" variant="outline" disabled className={sizeCls} data-testid={`${testid}-offline`}>
        <XCircle className={`${compact ? "w-3 h-3" : "w-4 h-4"} mr-1`} /> Offline
      </Button>
    );
  }

  // Render: primary button + dropdown if multiple options or fallback choices exist
  const hasAlternatives = (
    (rdReady && (otherCfg.length > 0 || splashtopReady)) ||
    splashtopReady ||
    otherCfg.length > 0
  );

  const PrimaryIcon = PROVIDER_ICON[primary?.id] || Play;

  return (
    <>
    <div className="flex items-stretch">
      <Button
        size="sm"
        variant="outline"
        className={`text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 ${hasAlternatives ? "rounded-r-none border-r-0" : ""} ${sizeCls}`}
        onClick={primary?.action}
        disabled={busy || !primary?.action}
        data-testid={testid}
      >
        {busy ? <RefreshCw className={`${compact ? "w-3 h-3" : "w-4 h-4"} mr-1 animate-spin`} /> : <PrimaryIcon className={`${compact ? "w-3 h-3" : "w-4 h-4"} mr-1`} />}
        {primary?.label || "Remote Access"}
      </Button>
      {hasAlternatives && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className={`text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 rounded-l-none px-2 ${sizeCls}`}
              data-testid={`${testid}-menu-trigger`}
            >
              <ChevronDown className={compact ? "w-3 h-3" : "w-4 h-4"} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">Remote providers</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {rdCfg && (
              <DropdownMenuItem
                onClick={() => requestProvider("rustdesk")}
                disabled={busy}
                data-testid={`${testid}-opt-rustdesk`}
              >
                <MonitorSmartphone className="w-4 h-4 mr-2 text-cyan-500" />
                <div className="flex-1">
                  <div className="text-sm">RustDesk</div>
                  <div className="text-[10px] text-muted-foreground">{device?.rustdesk_id ? `ID ${device.rustdesk_id}` : "No RustDesk ID assigned"}</div>
                </div>
              </DropdownMenuItem>
            )}
            {splashtopCfg && (
              <DropdownMenuItem onClick={() => splashtopReady ? requestProvider("splashtop") : toast.warning("Link this device to its Splashtop Streamer from the device record first")} data-testid={`${testid}-opt-splashtop`}>
                <Monitor className="w-4 h-4 mr-2 text-violet-500" />
                <div className="flex-1"><div className="text-sm">Splashtop</div><div className="text-[10px] text-muted-foreground">{splashtopReady ? `Streamer ${splashtopId}` : "No Streamer assigned"}</div></div>
              </DropdownMenuItem>
            )}
            {otherCfg.filter(p => p.id !== "splashtop").map(p => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => toast.info(`${p.name} launches from Settings → Remote Providers (per-device handoff coming soon)`)}
                data-testid={`${testid}-opt-${p.id}`}
              >
                <Monitor className="w-4 h-4 mr-2 text-violet-500" />
                <div className="flex-1">
                  <div className="text-sm">{PROVIDER_LABEL[p.id] || p.name}</div>
                  <div className="text-[10px] text-muted-foreground capitalize">{p.type}</div>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild data-testid={`${testid}-opt-configure`}>
              <Link to="/settings?tab=integrations">
                <Settings className="w-4 h-4 mr-2" />
                <span className="text-sm">Configure providers…</span>
                <ExternalLink className="w-3 h-3 ml-auto opacity-50" />
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
    <Dialog open={!!pendingProvider} onOpenChange={v => !v && setPendingProvider(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Start {PROVIDER_LABEL[pendingProvider] || pendingProvider} session</DialogTitle><DialogDescription>Connection activity is recorded against this device for the signed-in technician.</DialogDescription></DialogHeader>
        <div className="rounded-lg border bg-muted/30 p-3 text-sm"><p className="font-medium">{device?.name}</p><p className="text-xs text-muted-foreground mt-1">Remote controls stay with the provider; NexusMSP manages consent and the session audit trail.</p></div>
        <label className="flex items-start gap-2 text-sm cursor-pointer"><Checkbox checked={consentConfirmed} onCheckedChange={v => setConsentConfirmed(v === true)} /><span>I have confirmed the end user is aware of and has approved this remote session.</span></label>
        <DialogFooter><Button variant="outline" onClick={() => setPendingProvider(null)}>Cancel</Button><Button onClick={startSession} disabled={!consentConfirmed || starting}>{starting ? "Starting…" : "Start remote session"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!session} onOpenChange={v => !v && setSession(null)}>
      <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{session?.provider === "splashtop" ? "Splashtop handoff ready" : "Remote session active"}</DialogTitle><DialogDescription>{session?.message}</DialogDescription></DialogHeader><div className="text-xs text-muted-foreground">Session ID: {session?.session?.id}</div><DialogFooter><Button variant="outline" onClick={() => setSession(null)}>Keep running</Button><Button variant="destructive" onClick={endSession}>End & log session</Button></DialogFooter></DialogContent>
    </Dialog>
    </>
  );
}
