import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Home, Beer, ListChecks, Brain, Gauge, ThumbsDown, FlaskConical, Loader2,
} from "lucide-react";
import { Section } from "./toolboxShared";

// ============== SHIFT INTELLIGENCE & MEMORY ==============

function GoHomeCheck() {
  const { token } = useAuth();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/can-i-go-home`, { headers: { Authorization: `Bearer ${token}` } });
      setState(data);
    } catch {
      toast.error("Could not run the end-of-day checklist.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Home} title="Can I go home?" hint="The end-of-day checklist, answered from live tickets, servers, backups, remote sessions and alerts.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="go-home-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Home className="mr-1 h-3 w-3" />}🏠 Can I Go Home?
      </Button>
      {state && (
        <div className={`mt-3 rounded-lg border p-3 text-sm ${state.go_home ? "border-emerald-500/30 bg-emerald-500/[0.08]" : "border-amber-500/30 bg-amber-500/[0.08]"}`} data-testid="go-home-verdict">
          <p className="font-semibold">{state.verdict}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {state.checks.map((check) => (
              <li key={check.label} className={check.ok ? "text-emerald-300" : "text-amber-300"}>
                {check.ok ? "✓" : "✗"} {check.label} — {check.detail}
              </li>
            ))}
          </ul>
          {state.go_home && <p className="mt-2 text-xs text-muted-foreground">Nexus is watching things.</p>}
        </div>
      )}
    </Section>
  );
}

function WeekendRisk() {
  const { token } = useAuth();
  const [state, setState] = useState(null);

  useEffect(() => {
    axios.get(`${API}/tech-fun/weekend-risk`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setState(data))
      .catch(() => {});
  }, [token]);

  return (
    <Section icon={Beer} title="Weekend risk" hint="What could ruin your weekend — disk headroom, expiring warranties, offline devices and stale backups.">
      {!state ? (
        <p className="text-sm text-muted-foreground">Scanning the estate…</p>
      ) : (
        <div data-testid="weekend-risk">
          <p className="text-sm">{state.verdict}</p>
          {state.items.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {state.items.map((item, index) => (
                <li key={`${item.kind}-${index}`} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
                  <span className={item.severity === "high" ? "text-red-300" : item.severity === "medium" ? "text-amber-300" : "text-slate-300"}>
                    {item.severity === "high" ? "🔴" : item.severity === "medium" ? "🟡" : "⚪"} {item.title}
                  </span>
                  <p className="mt-0.5 text-muted-foreground">{item.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

function CaughtUp() {
  const { token } = useAuth();
  const [hours, setHours] = useState("24");
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/caught-up`, {
        params: { hours: Math.max(1, Math.min(336, Number(hours) || 24)) },
        headers: { Authorization: `Bearer ${token}` },
      });
      setState(data);
    } catch {
      toast.error("Could not build the digest.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={ListChecks} title="What did I miss?" hint="The return-from-absence digest: everything that happened, and the handful of things that actually matter.">
      <div className="flex gap-2">
        <Input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="hours away (e.g. 24)" data-testid="caught-up-hours" />
        <Button size="sm" onClick={run} disabled={busy} data-testid="caught-up-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ListChecks className="mr-1 h-3 w-3" />}Catch me up
        </Button>
      </div>
      {state && (
        <div className="mt-3 space-y-2 text-sm" data-testid="caught-up-digest">
          <p className="text-xs text-muted-foreground">
            In the last {state.window_hours}h: {state.alerts_total} alerts occurred · {state.alerts_resolved} resolved themselves · {state.tickets_updated} of your tickets updated.
          </p>
          {state.need_to_know.length > 0 && (
            <ul className="space-y-1 text-xs">
              {state.need_to_know.map((ticket) => (
                <li key={ticket.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                  <Badge className="mr-1.5" variant={ticket.priority === "critical" ? "destructive" : "secondary"}>{ticket.priority}</Badge>
                  {ticket.title} {ticket.client_name ? <span className="text-muted-foreground">· {ticket.client_name}</span> : null}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs italic text-violet-200/90">{state.verdict}</p>
        </div>
      )}
    </Section>
  );
}

function MemoryPin() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [form, setForm] = useState({ object_type: "device", object_id: "", text: "" });
  const [memories, setMemories] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!form.object_id.trim()) return;
    try {
      const { data } = await axios.get(`${API}/tech-fun/memory`, {
        params: { object_type: form.object_type, object_id: form.object_id }, headers,
      });
      setMemories(data.memories || []);
    } catch {
      /* leave the list as-is */
    }
  };

  const pin = async () => {
    if (!form.object_id.trim() || !form.text.trim()) {
      toast.error("An object and a note are both required.");
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/memory`, form, { headers });
      toast.success("📌 Nexus will remember that.");
      setForm((prev) => ({ ...prev, text: "" }));
      await load();
    } catch {
      toast.error("Could not pin that memory.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={Brain} title="Nexus must remember this" hint="Operational knowledge attached to an object — customer quirks, change hazards, tribal knowledge that survives staff turnover.">
      <div className="space-y-2">
        <div className="flex gap-2">
          <select className="h-9 rounded-md border border-input bg-transparent px-2 text-xs" value={form.object_type}
            onChange={(e) => setForm((prev) => ({ ...prev, object_type: e.target.value }))} data-testid="memory-type">
            <option value="device">Device</option>
            <option value="client">Customer</option>
            <option value="site">Site</option>
            <option value="user">User</option>
            <option value="general">General</option>
          </select>
          <Input value={form.object_id} onChange={(e) => setForm((prev) => ({ ...prev, object_id: e.target.value }))}
            placeholder="object ID" data-testid="memory-object" />
          <Button size="sm" variant="outline" onClick={load} data-testid="memory-load">Recall</Button>
        </div>
        <Input value={form.text} onChange={(e) => setForm((prev) => ({ ...prev, text: e.target.value }))}
          placeholder="e.g. Don't restart APP01 between 2–4 PM — payroll runs." data-testid="memory-text" />
        <Button size="sm" onClick={pin} disabled={busy} data-testid="memory-pin">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Brain className="mr-1 h-3 w-3" />}📌 Pin memory
        </Button>
        {memories.length > 0 && (
          <ul className="space-y-1 text-xs" data-testid="memory-list">
            {memories.map((memory) => (
              <li key={memory.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                {memory.text}
                <p className="mt-0.5 text-[10px] text-muted-foreground">pinned by {memory.pinned_by_name || "a technician"}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function ChangeRisk() {
  const { token } = useAuth();
  const [form, setForm] = useState({ device_id: "", description: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/change-risk`, form, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not score that change.");
    } finally {
      setBusy(false);
    }
  };
  const tone = result?.band === "Low" ? "text-emerald-300" : result?.band === "Moderate" ? "text-amber-300" : "text-red-300";
  return (
    <Section icon={Gauge} title="Change risk score" hint="Enterprise change management without the ITIL bureaucracy — an explainable risk score before you touch anything.">
      <div className="flex gap-2">
        <Input value={form.device_id} onChange={(e) => setForm((prev) => ({ ...prev, device_id: e.target.value }))}
          placeholder="device ID" data-testid="risk-device" />
        <Input value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          placeholder="planned change (e.g. firmware upgrade)" data-testid="risk-description" />
        <Button size="sm" onClick={run} disabled={busy} data-testid="risk-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Gauge className="mr-1 h-3 w-3" />}Score it
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="risk-result">
          <p className="text-base font-semibold">
            Risk: <span className={tone}>{result.score}/100 — {result.band}</span>
          </p>
          {result.reasons.length > 0 && (
            <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
              {result.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          )}
          <p className="mt-2 text-xs italic text-violet-200/90">{result.recommendation}</p>
        </div>
      )}
    </Section>
  );
}

function NopeButton() {
  const { token } = useAuth();
  const [verdict, setVerdict] = useState("wrong_root_cause");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/feedback`, { verdict, note, source_type: "tool", source_id: "toolbox" },
        { headers: { Authorization: `Bearer ${token}` } });
      toast.success("Logged. Nexus learns from the outcome.");
      setNote("");
    } catch {
      toast.error("Could not record that feedback.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={ThumbsDown} title="Nope. Wrong diagnosis." hint="Correct Nexus when it gets something wrong — wrong root cause, wrong remediation, missing information or an unsafe recommendation.">
      <div className="flex gap-2">
        <select className="h-9 rounded-md border border-input bg-transparent px-2 text-xs" value={verdict}
          onChange={(e) => setVerdict(e.target.value)} data-testid="nope-verdict">
          <option value="wrong_root_cause">Wrong root cause</option>
          <option value="wrong_remediation">Wrong remediation</option>
          <option value="missing_information">Missing information</option>
          <option value="unsafe_recommendation">Unsafe recommendation</option>
          <option value="other">Other</option>
        </select>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="what actually happened (optional)" data-testid="nope-note" />
        <Button size="sm" variant="outline" onClick={send} disabled={busy} data-testid="nope-send">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ThumbsDown className="mr-1 h-3 w-3" />}👎 Nope
        </Button>
      </div>
    </Section>
  );
}

const LABS_ITEMS = [
  ["predictive_ticketing", "Predictive ticketing"],
  ["autonomous_diagnosis", "Autonomous diagnosis"],
  ["natural_language_control", "Natural language control"],
  ["failure_prediction", "Failure prediction"],
  ["experimental_remediation", "Experimental remediation"],
];

function LabsFlags() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [flags, setFlags] = useState(null);

  useEffect(() => {
    axios.get(`${API}/tech-fun/labs`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setFlags(data.flags || {}))
      .catch(() => {});
  }, [token]);

  const toggle = async (key) => {
    const next = { ...flags, [key]: !flags?.[key] };
    setFlags(next);
    try {
      await axios.put(`${API}/tech-fun/labs`, { flags: next }, { headers });
    } catch (error) {
      setFlags(flags);
      toast.error(error?.response?.data?.detail || "Only admins can toggle Labs features.");
    }
  };

  return (
    <Section icon={FlaskConical} title="🧪 Nexus Labs" hint="Experimental capabilities, opt-in per tenant — enable internally first, then friendly customers, then production.">
      <div className="flex flex-wrap gap-2">
        {LABS_ITEMS.map(([key, label]) => (
          <Button key={key} size="sm" variant={flags?.[key] ? "default" : "outline"} onClick={() => toggle(key)} data-testid={`labs-${key}`}>
            {label}{flags?.[key] ? " · on" : ""}
          </Button>
        ))}
      </div>
    </Section>
  );
}

export {
  LABS_ITEMS,
  GoHomeCheck,
  WeekendRisk,
  CaughtUp,
  MemoryPin,
  ChangeRisk,
  NopeButton,
  LabsFlags,
};
