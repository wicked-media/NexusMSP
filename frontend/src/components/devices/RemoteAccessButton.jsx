import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Play, RefreshCw, ChevronDown, Monitor, Settings, ExternalLink,
  XCircle, MonitorSmartphone, Wrench,
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

function remoteErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => typeof item === "string" ? item : item?.msg || item?.message).filter(Boolean);
    if (messages.length) return messages.join("; ");
  }
  if (detail && typeof detail === "object") return detail.message || detail.msg || fallback;
  return error?.message || fallback;
}

/**
 * Unified Remote Access button.
 *
 * Picks a primary action based on what's configured and what's available on
 * this device. When multiple providers are available, opens a dropdown so the
 * tech can choose. Falls back to a "Configure" CTA when nothing is set up.
 */
export default function RemoteAccessButton({ device, status, ticketId = null, busy = false, testid = "remote-access-btn", compact = false, providersOverride = null }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [providers, setProviders] = useState(providersOverride || []);
  const [loading, setLoading] = useState(providersOverride === null);
  const [pendingProvider, setPendingProvider] = useState(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [sessionType, setSessionType] = useState("remote_desktop");
  const [consentMethod, setConsentMethod] = useState("attended_prompt");
  const [createTimeEntry, setCreateTimeEntry] = useState(true);
  const [endNotes, setEndNotes] = useState("");
  const [remoteHealth, setRemoteHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);

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

  const requestProvider = async (provider) => {
    setConsentConfirmed(false);
    setPurpose("");
    setSessionType("remote_desktop");
    setConsentMethod("attended_prompt");
    setCreateTimeEntry(true);
    setEndNotes("");
    setRemoteHealth(null);
    setPendingProvider(provider);
    if (!device?.id) return;
    setHealthLoading(true);
    try {
      const { data } = await axios.get(`${API}/devices/${device.id}/remote-health`, { headers });
      setRemoteHealth(data);
    } catch {
      setRemoteHealth(null);
    } finally {
      setHealthLoading(false);
    }
  };

  const launchNative = (connectionUrl) => {
    if (!connectionUrl) return;
    const anchor = document.createElement("a");
    anchor.href = connectionUrl;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => document.body.removeChild(anchor), 100);
  };

  const repairRemote = async () => {
    if (!device?.id || repairing) return;
    setRepairing(true);
    try {
      const { data } = await axios.post(`${API}/devices/${device.id}/remote-repair`, {
        reason: purpose.trim() || "Remote support preflight requires remediation",
      }, { headers });
      toast.success(data.reused ? "A remote repair is already queued" : "Remote repair queued through Nexus Agent");
      const health = await axios.get(`${API}/devices/${device.id}/remote-health`, { headers });
      setRemoteHealth(health.data);
    } catch (error) {
      toast.error(remoteErrorMessage(error, "Remote repair could not be queued"));
    } finally {
      setRepairing(false);
    }
  };

  const startSession = async () => {
    if (!pendingProvider || !device?.id) return;
    setStarting(true);
    try {
      const idempotencyKey = window.crypto?.randomUUID?.() || `${device.id}-${Date.now()}`;
      const res = await axios.post(`${API}/devices/${device.id}/remote-sessions/start`, {
        provider: pendingProvider,
        consent_confirmed: consentConfirmed,
        consent_method: consentMethod,
        purpose: purpose.trim() || "Technician support session",
        session_type: sessionType,
        create_time_entry: createTimeEntry,
        ticket_id: ticketId,
        idempotency_key: idempotencyKey,
      }, { headers });
      let nextSession = res.data;
      if (res.data.connection_url) {
        launchNative(res.data.connection_url);
        const opened = await axios.post(`${API}/remote/sessions/${res.data.session.id}/opened`, {}, { headers });
        nextSession = { ...res.data, session: opened.data };
        toast.success(`Launching ${PROVIDER_LABEL[pendingProvider] || pendingProvider} for ${device?.name}`);
      } else {
        toast.info(typeof res.data.message === "string" ? res.data.message : "Remote provider handoff is ready");
      }
      setSession(nextSession);
      setPendingProvider(null);
    } catch (error) {
      toast.error(remoteErrorMessage(error, "Unable to start remote session"));
    } finally { setStarting(false); }
  };

  const endSession = async () => {
    if (!session?.session?.id) return;
    try {
      const { data } = await axios.put(`${API}/remote/sessions/${session.session.id}/end`, {
        lock_action_on_disconnect: "no_change",
        notes: endNotes.trim(),
        create_time_entry: createTimeEntry,
        billable: true,
      }, { headers });
      toast.success(data.time_entry_id ? "Session ended, ticket updated and time recorded" : "Remote session ended and logged");
      setSession(null);
      setEndNotes("");
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

  // Providers exist globally but this device is not linked yet. Send the
  // technician directly to the assignment workflow instead of looping back to
  // the device page they are already viewing.
  if (!primary && providers.length > 0 && device?.id) {
    return (
      <Button
        size="sm"
        variant="outline"
        asChild
        className={`border-amber-500/30 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400 ${sizeCls}`}
        data-testid={`${testid}-link`}
      >
        <Link to={`/remote-access?assignDevice=${encodeURIComponent(device.id)}`}>
          <Settings className={`${compact ? "w-3 h-3" : "w-4 h-4"} mr-1`} /> {compact ? "Link" : "Link remote"}
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
        className={`border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400 ${hasAlternatives ? "rounded-r-none border-r-0" : ""} ${sizeCls}`}
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
              className={`rounded-l-none border-emerald-500/30 px-2 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400 ${sizeCls}`}
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
      <NexusWorkflowDialog
        eyebrow="Nexus Remote"
        title="Authorise remote support"
        description="One governed session captures the client, endpoint, technician, consent, purpose and service evidence."
        icon={MonitorSmartphone}
        tone="cyan"
        className="max-w-xl"
        footer={<><Button variant="outline" onClick={() => setPendingProvider(null)}>Cancel</Button><Button onClick={startSession} disabled={!consentConfirmed || starting}>{starting ? "Starting…" : "Start remote session"}</Button></>}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-3 text-sm">
            <p className="font-semibold text-foreground">{device?.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{PROVIDER_LABEL[pendingProvider] || pendingProvider} · {device?.client_name || "Managed client"}</p>
          </div>
          <div className={`min-w-32 rounded-xl border p-3 text-xs ${remoteHealth?.status === "healthy" ? "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-700 dark:text-emerald-200" : "border-amber-400/25 bg-amber-400/[0.06] text-amber-700 dark:text-amber-200"}`}>
            <p className="font-semibold uppercase tracking-wider">Preflight</p>
            <p className="mt-1 capitalize">{healthLoading ? "Checking…" : (remoteHealth?.status || "Unavailable")}</p>
          </div>
        </div>
        {remoteHealth?.checks?.length > 0 && (
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-3">
              {remoteHealth.checks.map(check => (
                <div key={check.id} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{check.label}</p>
                  <p className="mt-1 text-xs text-foreground/85">{check.detail}</p>
                </div>
              ))}
            </div>
            {remoteHealth.status !== "healthy" && remoteHealth.repair_available && (
              <Button type="button" size="sm" variant="outline" className="h-8 border-amber-400/25 text-amber-700 dark:text-amber-200" onClick={repairRemote} disabled={repairing}>
                {repairing ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wrench className="mr-1.5 h-3.5 w-3.5" />}
                {repairing ? "Queueing repair…" : "Repair through Nexus Agent"}
              </Button>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Session mode</label>
            <Select value={sessionType} onValueChange={setSessionType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="remote_desktop">Remote desktop</SelectItem><SelectItem value="terminal">Terminal</SelectItem><SelectItem value="file_transfer">File transfer</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Consent evidence</label>
            <Select value={consentMethod} onValueChange={setConsentMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="attended_prompt">Client prompt</SelectItem><SelectItem value="verbal">Verbal approval</SelectItem><SelectItem value="standing_authorisation">Standing authorisation</SelectItem><SelectItem value="emergency_override">Emergency override</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5"><label className="text-xs font-medium text-foreground">Purpose</label><Input value={purpose} onChange={event => setPurpose(event.target.value)} placeholder="For example: investigate Outlook sign-in failure" maxLength={500} /></div>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm"><Checkbox checked={consentConfirmed} onCheckedChange={v => setConsentConfirmed(v === true)} /><span>I confirm the client is aware of and has approved this remote session using the method selected above.</span></label>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={createTimeEntry} onCheckedChange={v => setCreateTimeEntry(v === true)} /><span>Create a billable time entry when this session closes if it is linked to a ticket.</span></label>
      </NexusWorkflowDialog>
    </Dialog>
    <Dialog open={!!session} onOpenChange={v => !v && setSession(null)}>
      <NexusWorkflowDialog
        eyebrow="Nexus Remote"
        title={session?.provider === "splashtop" ? "Provider handoff ready" : "Remote session active"}
        description={session?.message}
        icon={MonitorSmartphone}
        tone="emerald"
        className="max-w-lg"
        footer={<><Button variant="outline" onClick={() => setSession(null)}>Keep running</Button><Button variant="destructive" onClick={endSession}>End & save evidence</Button></>}
      >
        <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-3"><p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Evidence live</p><p className="mt-1 text-sm text-foreground/90">{device?.name} · {session?.session?.session_type?.replaceAll("_", " ")}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{session?.session?.id}</p></div>
        <div className="space-y-1.5"><label className="text-xs font-medium text-foreground">Outcome for the ticket and time entry</label><Textarea value={endNotes} onChange={event => setEndNotes(event.target.value)} placeholder="Record what was checked, changed and verified…" rows={4} /></div>
      </NexusWorkflowDialog>
    </Dialog>
    </>
  );
}
