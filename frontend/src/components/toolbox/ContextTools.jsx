import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import DevicePicker, { ClientPicker } from "@/components/DevicePicker";
import { CompareBars } from "@/components/design-system";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Siren, Radar, Lock, ArrowRightLeft, PiggyBank, Loader2,
} from "lucide-react";
import { Section } from "./toolboxShared";

// ============== CONTEXT-AWARENESS ==============

const TRIAGE_TONE = { Ignore: "text-emerald-300", Investigate: "text-red-300", Watch: "text-amber-300" };

function AlertTriage() {
  const { token } = useAuth();
  const [alertId, setAlertId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/alert-triage/${encodeURIComponent(alertId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not triage that alert.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Siren} title="Should I care?" hint="Why am I looking at this? Every alert gets a verdict with evidence — Ignore, Investigate or Watch.">
      <div className="flex gap-2">
        <Input value={alertId} onChange={(e) => setAlertId(e.target.value)} placeholder="alert ID" data-testid="triage-alert" />
        <Button size="sm" onClick={run} disabled={busy || !alertId.trim()} data-testid="triage-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Siren className="mr-1 h-3 w-3" />}Triage
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="triage-result">
          <p className="text-base font-semibold">
            {result.alert?.message || result.alert?.alert_type} — <span className={TRIAGE_TONE[result.verdict]}>{result.verdict}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{result.why_now}</p>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-violet-200/90">
            {result.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      )}
    </Section>
  );
}

function BlastRadius() {
  const { token } = useAuth();
  const [deviceId, setDeviceId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/blast-radius/${encodeURIComponent(deviceId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not map that device.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Radar} title="Blast radius" hint="Click any device: if this fails, what is affected? Derived from live relationships only.">
      <div className="flex gap-2">
        <DevicePicker value={deviceId} onChange={setDeviceId} testId="blast-device" />
        <Button size="sm" onClick={run} disabled={busy || !deviceId.trim()} data-testid="blast-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Radar className="mr-1 h-3 w-3" />}Map it
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="blast-result">
          <p className="font-semibold">{result.headline}</p>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
            {result.impacts.map((impact) => <li key={impact}>{impact}</li>)}
          </ul>
        </div>
      )}
    </Section>
  );
}

function WorkLocks() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [deviceId, setDeviceId] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/work-lock/${encodeURIComponent(deviceId)}`, { headers });
      setStatus(data);
    } catch {
      toast.error("Could not check that device.");
    } finally {
      setBusy(false);
    }
  };
  const claim = async (force = false) => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/work-lock`, { device_id: deviceId, force }, { headers });
      if (data.acquired) {
        toast.success(data.taken_from ? `Ownership taken from ${data.taken_from}.` : "You're on it — others will see you're working here.");
      } else {
        toast.warning(`${data.held_by} is currently working on this device.`);
      }
      await check();
    } catch {
      toast.error("Could not claim that device.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={Lock} title="Before you touch it…" hint="Soft object locks: see who else is on the device, what's already open, then claim or deliberately take ownership.">
      <div className="flex gap-2">
        <DevicePicker value={deviceId} onChange={setDeviceId} testId="lock-device" />
        <Button size="sm" variant="outline" onClick={check} disabled={busy || !deviceId.trim()} data-testid="lock-check">Check</Button>
        <Button size="sm" onClick={() => claim(false)} disabled={busy || !deviceId.trim()} data-testid="lock-claim">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Lock className="mr-1 h-3 w-3" />}Work on this
        </Button>
      </div>
      {status && (
        <div className="mt-3 text-sm" data-testid="lock-status">
          <p className={status.safe_to_proceed ? "text-emerald-300" : "text-amber-300"}>
            {status.safe_to_proceed ? "✓ Nobody else is on this device." : "⚠ Check before you touch it:"}
          </p>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {status.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
          {status.held_by && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => claim(true)} data-testid="lock-takeover">
              Take Ownership
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}

function HandoverDigest() {
  const { token } = useAuth();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/handover`, { headers: { Authorization: `Bearer ${token}` } });
      setState(data);
    } catch {
      toast.error("Could not build the handover.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={ArrowRightLeft} title="Shift handover" hint="The 5 PM digest: active issues, customers waiting, vendor escalations, running work — and who should take what.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="handover-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ArrowRightLeft className="mr-1 h-3 w-3" />}Build my handover
      </Button>
      {state && (
        <div className="mt-3 space-y-1.5 text-sm" data-testid="handover-result">
          <p className="text-xs text-muted-foreground">
            {state.active_issues.length} active issue(s) · {state.customer_waiting.length} customer(s) waiting ·
            {" "}{state.vendor_escalations.length} vendor escalation(s) · {state.running.length} running · {state.follow_ups.length} follow-up(s)
          </p>
          {state.active_issues.slice(0, 5).map((ticket) => (
            <p key={ticket.id} className="text-xs">
              <Badge className="mr-1.5" variant={ticket.priority === "critical" ? "destructive" : "secondary"}>{ticket.priority}</Badge>
              {ticket.ticket_number || ticket.id} — {ticket.title} {ticket.client_name ? <span className="text-muted-foreground">· {ticket.client_name}</span> : null}
            </p>
          ))}
          {state.recommendation && <p className="text-xs italic text-violet-200/90">{state.recommendation}</p>}
        </div>
      )}
    </Section>
  );
}

function CustomerCost() {
  const { token } = useAuth();
  const [clientId, setClientId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/customer-cost/${encodeURIComponent(clientId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not analyse that customer.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={PiggyBank} title="Why is this customer expensive?" hint="Support demand versus comparable customers, cost drivers, and an honest avoidable-cost estimate.">
      <div className="flex gap-2">
        <ClientPicker value={clientId} onChange={setClientId} testId="cost-client" />
        <Button size="sm" onClick={run} disabled={busy || !clientId.trim()} data-testid="cost-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <PiggyBank className="mr-1 h-3 w-3" />}Analyse
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="cost-result">
          <p className="font-semibold">{result.verdict}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {result.total_tickets} tickets vs peer median {result.peer_median_tickets} · {result.support_hours}h recorded ·
            {" "}est. delivery cost ${result.estimated_delivery_cost?.toLocaleString()} · avoidable ${result.estimated_avoidable_cost?.toLocaleString()}
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            <div className="min-w-[220px] flex-1">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tickets vs peers</p>
              <CompareBars testid="cost-tickets-chart" height={140} color="#a78bfa" data={[
                { label: "This customer", value: result.total_tickets },
                { label: "Peer median", value: result.peer_median_tickets },
              ]} />
            </div>
            {result.drivers?.length > 0 && (
              <div className="min-w-[220px] flex-1">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cost drivers (share)</p>
                <CompareBars testid="cost-drivers-chart" height={140} unit="%" data={result.drivers.map((driver) => ({ label: driver.category, value: driver.share_pct }))} />
              </div>
            )}
          </div>
          <p className="mt-2 text-xs italic text-violet-200/90">{result.recommendation}</p>
        </div>
      )}
    </Section>
  );
}

export {
  TRIAGE_TONE,
  AlertTriage,
  BlastRadius,
  WorkLocks,
  HandoverDigest,
  CustomerCost,
};
