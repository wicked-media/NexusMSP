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
import { toast } from "sonner";
import {
  Play, RefreshCw, Settings, XCircle, MonitorUp, Wrench,
} from "lucide-react";
import { API, useAuth } from "@/App";

const PROVIDER_LABEL = {
  nexus: "Nexus Native",
};

const PROVIDER_ICON = {
  nexus: MonitorUp,
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
 * Starts only the Nexus Native workflow for an enrolled endpoint and fails
 * closed when the signed Remote Companion is not ready.
 */
export default function RemoteAccessButton({ device, status, ticketId = null, workSessionId = null, busy = false, testid = "remote-access-btn", compact = false, providersOverride = null }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [providers, setProviders] = useState(providersOverride || []);
  const [remotePolicy, setRemotePolicy] = useState(null);
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
  const workSessionOwnsTime = Boolean(workSessionId);

  // Native transport state is owned by the endpoint agent, not the browser.
  // Refresh the scoped session record while its consent/transport transition is
  // pending so the technician never sees a stale "waiting" prompt after the
  // companion has accepted and connected.
  useEffect(() => {
    const sessionId = session?.session?.id;
    if (!sessionId || !device?.id) return undefined;
    let cancelled = false;
    const refreshSession = async () => {
      try {
        const { data } = await axios.get(`${API}/devices/${device.id}/remote-sessions?limit=20`, { headers });
        const current = (data?.sessions || []).find(item => item?.id === sessionId);
        if (!cancelled && current) {
          setSession(previous => previous?.session?.id === sessionId
            ? { ...previous, session: { ...previous.session, ...current } }
            : previous);
        }
      } catch {
        // The existing modal remains usable; a failed poll must not invent a
        // transport state or close an active operator workflow.
      }
    };
    refreshSession();
    const timer = window.setInterval(refreshSession, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [device?.id, headers, session?.session?.id]);

  useEffect(() => {
    if (providersOverride !== null) {
      setProviders(providersOverride);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (!device?.id) return;
        const res = await axios.get(`${API}/devices/${device.id}/remote-options`, { headers });
        if (!cancelled) {
          setProviders(res.data?.providers || []);
          setRemotePolicy(res.data?.policy || null);
        }
      } catch {
        if (!cancelled) setProviders([]);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [device?.id, headers, providersOverride]);

  const isOffline = status === "offline" || status === "stale";

  // Determine which providers actually apply to THIS device right now.
  const nexusCfg = providers.find(p => p.id === "nexus");
  const standingAuthorisationAvailable = Boolean(
    nexusCfg?.unattended_enabled && nexusCfg?.unattended_ready && remotePolicy?.allow_standing_authorisation,
  );

  const requestProvider = async (provider) => {
    setConsentConfirmed(false);
    setPurpose("");
    setSessionType("remote_desktop");
    setConsentMethod("attended_prompt");
    setCreateTimeEntry(!workSessionOwnsTime);
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
        create_time_entry: workSessionOwnsTime ? false : createTimeEntry,
        ticket_id: ticketId,
        work_session_id: workSessionId,
        idempotency_key: idempotencyKey,
      }, { headers });
      let nextSession = res.data;
      if (res.data.connection_url) {
        launchNative(res.data.connection_url);
        toast.info(`Launch requested for ${PROVIDER_LABEL[pendingProvider] || pendingProvider}. Confirm once the remote desktop opens.`);
      } else {
        toast.info(typeof res.data.message === "string" ? res.data.message : "Nexus Native handoff is ready");
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
        create_time_entry: workSessionOwnsTime ? false : createTimeEntry,
        billable: true,
      }, { headers });
      if (data.time_entry_id) {
        toast.success("Session ended, ticket updated and time recorded");
      } else if (data.time_entry_suppressed_by === "nexus_work_session") {
        toast.success("Session ended; time remains in Nexus Work Session");
      } else if (data.time_entry_suppressed_by === "launch_not_confirmed") {
        toast.info("Remote authorisation cancelled; no time was recorded");
      } else {
        toast.success("Remote session ended and logged");
      }
      setSession(null);
      setEndNotes("");
    } catch { toast.error("Unable to close the remote session record"); }
  };



  // Nexus Native is the only active launch path. Provider records may remain
  // as historical evidence, but must never become a browser launch option.
  let primary = null;
  if (nexusCfg && device?.nexus_agent_id) primary = { id: "nexus", label: compact ? "Remote" : "Nexus Remote", action: () => requestProvider("nexus") };

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
        <Link to="/nexus-agent">
          <Settings className={`${compact ? "w-3 h-3" : "w-4 h-4"} mr-1`} /> {compact ? "Setup" : "Install Nexus Agent"}
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
        <Link to="/nexus-agent">
          <Settings className={`${compact ? "w-3 h-3" : "w-4 h-4"} mr-1`} /> {compact ? "Agent" : "Link Nexus Agent"}
        </Link>
      </Button>
    );
  }

  // Remote sessions are only available when the endpoint is live.
  if (isOffline) {
    return (
      <Button size="sm" variant="outline" disabled className={sizeCls} data-testid={`${testid}-offline`}>
        <XCircle className={`${compact ? "w-3 h-3" : "w-4 h-4"} mr-1`} /> {status === "stale" ? "Agent stale" : "Offline"}
      </Button>
    );
  }

  // Render: primary button + dropdown if multiple options or fallback choices exist
  const hasAlternatives = false;

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
    </div>
    <Dialog open={!!pendingProvider} onOpenChange={v => !v && setPendingProvider(null)}>
      <NexusWorkflowDialog
        eyebrow="Nexus Remote"
        title="Authorise remote support"
        description="One governed session captures the client, endpoint, technician, consent, purpose and service evidence."
        icon={MonitorUp}
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
              <SelectContent><SelectItem value="remote_desktop">Remote desktop</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Consent evidence</label>
            <Select value={consentMethod} onValueChange={setConsentMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="attended_prompt">Local client prompt required</SelectItem>
                {standingAuthorisationAvailable && <SelectItem value="standing_authorisation">Standing authorisation · endpoint notice</SelectItem>}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5"><label className="text-xs font-medium text-foreground">Purpose</label><Input value={purpose} onChange={event => setPurpose(event.target.value)} placeholder="For example: investigate Outlook sign-in failure" maxLength={500} /></div>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm"><Checkbox checked={consentConfirmed} onCheckedChange={v => setConsentConfirmed(v === true)} /><span>{consentMethod === "standing_authorisation" ? "I confirm this endpoint has a current standing authorisation for unattended, view-only support." : "I confirm the client is aware of and has approved this remote session using the method selected above."}</span></label>
        {workSessionOwnsTime ? (
          <div className="rounded-lg border border-violet-400/20 bg-violet-400/[0.05] p-3 text-xs leading-5 text-violet-100" data-testid={`${testid}-work-session-time-owner`}>
            This session is linked to an active Nexus Work Session. Remote evidence is retained here; time is reviewed and recorded once in the Work Session completion pack.
          </div>
        ) : (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={createTimeEntry} onCheckedChange={v => setCreateTimeEntry(v === true)} /><span>Create a billable time entry when this session closes if it is linked to a ticket.</span></label>
        )}
      </NexusWorkflowDialog>
    </Dialog>
    <Dialog open={!!session} onOpenChange={v => {
      // Keep the pending confirmation in view. Closing a connection request
      // should be an explicit cancel action so it cannot leave an untracked,
      // time-eligible authorisation behind.
      if (!v && session?.session?.status === "active") setSession(null);
    }}>
      <NexusWorkflowDialog
        eyebrow="Nexus Remote"
        title={session?.session?.status === "active" ? "Remote session active" : "Waiting for native connection"}
        description={session?.session?.status === "active"
          ? "Connection confirmation, technician identity and linked work evidence are retained."
          : "Authorisation is recorded. Billing cannot start without verified native transport evidence."}
        icon={MonitorUp}
        tone="emerald"
        className="max-w-lg"
        footer={session?.session?.status === "active"
          ? <><Button variant="outline" onClick={() => setSession(null)}>Keep running</Button><Button variant="destructive" onClick={endSession}>End & save evidence</Button></>
          : <Button variant="outline" onClick={endSession} data-testid={`${testid}-cancel-authorisation`}>Cancel authorisation</Button>}
      >
        <div className={`rounded-xl border p-3 ${session?.session?.status === "active" ? "border-emerald-400/15 bg-emerald-400/[0.04]" : "border-amber-400/20 bg-amber-400/[0.05]"}`}>
          <p className={`text-xs font-semibold uppercase tracking-wider ${session?.session?.status === "active" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-200"}`}>{session?.session?.status === "active" ? "Evidence live" : "Launch request recorded"}</p>
          <p className="mt-1 text-sm text-foreground/90">{device?.name} · {session?.session?.session_type?.replaceAll("_", " ")}</p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">{session?.session?.id}</p>
        </div>
        {session?.session?.status !== "active" && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] p-3 text-xs leading-5 text-amber-900 dark:text-amber-100">
            The endpoint must approve locally and establish a verified native connection. Cancelling preserves the authorisation audit without adding ticket time.
            {session?.connection_url && <Button type="button" variant="link" className="ml-1 h-auto p-0 text-amber-800 dark:text-amber-200" onClick={() => launchNative(session.connection_url)}>Launch again</Button>}
          </div>
        )}
        <div className="space-y-1.5"><label className="text-xs font-medium text-foreground">{workSessionOwnsTime ? "Outcome for the linked Work Session" : "Outcome for the ticket and time entry"}</label><Textarea value={endNotes} onChange={event => setEndNotes(event.target.value)} placeholder="Record what was checked, changed and verified…" rows={4} /></div>
      </NexusWorkflowDialog>
    </Dialog>
    </>
  );
}
