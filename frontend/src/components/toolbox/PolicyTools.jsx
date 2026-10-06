import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Scale, ShieldAlert, MessageSquare, Waypoints, Dna, ArrowRightLeft, Coins,
  AlertTriangle, Sunrise, Sunset, BookOpen, Loader2,
} from "lucide-react";
import { Section } from "./toolboxShared";

function NexusLaws() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [laws, setLaws] = useState(null);
  const [action, setAction] = useState({ action_type: "", target: "", destructive: false, verification_planned: true });
  const [verdict, setVerdict] = useState(null);
  const [custom, setCustom] = useState({ kind: "forbidden_action", text: "", pattern: "", target_pattern: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    axios.get(`${API}/tech-fun/laws`, { headers }).then(({ data }) => setLaws(data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const evaluate = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/laws/evaluate`, action, { headers });
      setVerdict(data);
    } catch {
      toast.error("Could not evaluate the action.");
    } finally {
      setBusy(false);
    }
  };
  const addLaw = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/laws`, custom, { headers });
      toast.success("Law recorded. It now sits above users, scripts and AI.");
      const { data } = await axios.get(`${API}/tech-fun/laws`, { headers });
      setLaws(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Only admins can record laws.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Scale} title="Nexus Laws" hint="Non-negotiable invariants above users, scripts, integrations, AI and automations. Autonomy bounded by deterministic rules.">
      {laws && (
        <ul className="space-y-1 text-xs">
          {laws.builtin.slice(0, 5).map((law) => (
            <li key={law.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-violet-200">⚖ {law.text}</li>
          ))}
          {laws.custom.map((law) => (
            <li key={law.id} className="rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-amber-200">⚖ {law.text} <span className="text-muted-foreground">(custom: {law.kind})</span></li>
          ))}
        </ul>
      )}
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <Input className="h-8 w-32" value={action.action_type} onChange={(e) => setAction({ ...action, action_type: e.target.value })} placeholder="action (e.g. reboot)" data-testid="law-action" />
          <Input className="h-8 w-32" value={action.target} onChange={(e) => setAction({ ...action, target: e.target.value })} placeholder="target" data-testid="law-target" />
          <Button size="sm" variant={action.destructive ? "default" : "outline"} onClick={() => setAction({ ...action, destructive: !action.destructive })} data-testid="law-destructive">
            {action.destructive ? "💥 destructive" : "not destructive"}
          </Button>
          <Button size="sm" onClick={evaluate} disabled={busy || !action.action_type.trim()} data-testid="law-evaluate">Evaluate</Button>
        </div>
        {verdict && (
          <p className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${verdict.overall === "blocked" ? "border-red-500/30 bg-red-500/[0.08] text-red-300" : verdict.overall === "allowed" ? "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300" : "border-amber-500/30 bg-amber-500/[0.08] text-amber-300"}`} data-testid="law-verdict">
            {verdict.verdict}{verdict.decisions.length > 0 && ` — ${verdict.decisions[0].law}`}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Input className="h-8 w-36" value={custom.text} onChange={(e) => setCustom({ ...custom, text: e.target.value })} placeholder="custom law text" data-testid="law-custom-text" />
          <Input className="h-8 w-24" value={custom.pattern} onChange={(e) => setCustom({ ...custom, pattern: e.target.value })} placeholder="action" data-testid="law-custom-pattern" />
          <Input className="h-8 w-24" value={custom.target_pattern} onChange={(e) => setCustom({ ...custom, target_pattern: e.target.value })} placeholder="target" data-testid="law-custom-target" />
          <Button size="sm" variant="outline" onClick={addLaw} disabled={busy || !custom.text.trim()} data-testid="law-custom-add">Add law (admin)</Button>
        </div>
      </div>
    </Section>
  );
}

function CredentialGuard() {
  const { token } = useAuth();
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/credential-scan`, { text }, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not scan the draft.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={ShieldAlert} title="Credential leak guard" hint="Paste a ticket draft here first. If a credential is in it, Nexus removes it — and never echoes the secret back."
    >
      <textarea
        className="h-20 w-full rounded-md border border-violet-500/20 bg-slate-900/60 p-2 text-xs"
        value={text} onChange={(e) => setText(e.target.value)}
        placeholder="paste a ticket draft or note…" data-testid="cred-text"
      />
      <Button size="sm" className="mt-2" onClick={run} disabled={busy || !text.trim()} data-testid="cred-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ShieldAlert className="mr-1 h-3 w-3" />}Scan draft
      </Button>
      {result && (
        <div className={`mt-3 rounded-lg border p-3 text-sm ${result.detected ? "border-red-500/30 bg-red-500/[0.08]" : "border-emerald-500/30 bg-emerald-500/[0.08]"}`} data-testid="cred-result">
          <p className="font-semibold">{result.verdict}</p>
          {result.detected && (
            <>
              <p className="mt-1 text-xs text-muted-foreground">{result.guidance}</p>
              <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-900/60 p-2 text-xs text-muted-foreground">{result.redacted_text}</pre>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

function RealityChecks() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [ticketId, setTicketId] = useState("");
  const [result, setResult] = useState(null);
  const [presence, setPresence] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/ticket-reality-check/${encodeURIComponent(ticketId)}`, { headers });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not reality-check that ticket.");
    } finally {
      setBusy(false);
    }
  };
  const runPresence = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/presence-effect`, { headers });
      setPresence(data);
    } catch {
      toast.error("Could not measure the presence effect.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={MessageSquare} title="Ticket reality checks" hint="Urgency punctuation, the definition of insanity, 'nobody changed anything', 'it never worked' — and the Technician Presence Effect, tracked as a statistic.">
      <div className="flex gap-2">
        <Input value={ticketId} onChange={(e) => setTicketId(e.target.value)} placeholder="ticket ID" data-testid="reality-id" />
        <Button size="sm" onClick={run} disabled={busy || !ticketId.trim()} data-testid="reality-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <MessageSquare className="mr-1 h-3 w-3" />}Reality check
        </Button>
        <Button size="sm" variant="outline" onClick={runPresence} disabled={busy} data-testid="presence-run">Presence effect</Button>
      </div>
      {result && (
        <ul className="mt-3 space-y-1 text-xs" data-testid="reality-result">
          {result.findings.length === 0 && <li className="text-muted-foreground">{result.verdict}</li>}
          {result.findings.map((f, i) => (
            <li key={i} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-violet-200">
              {f.line}
              {f.changes && <p className="mt-0.5 text-muted-foreground">{f.changes.join(" · ")}</p>}
            </li>
          ))}
        </ul>
      )}
      {presence && (
        <p className="mt-2 text-xs text-amber-200" data-testid="presence-result">{presence.verdict}</p>
      )}
    </Section>
  );
}

function IntentOS() {
  const { token } = useAuth();
  const [statement, setStatement] = useState("");
  const [suggested, setSuggested] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const suggest = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/intent-suggest`, { statement }, { headers });
      setSuggested(data.suggested_controls);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not compile that intent.");
    } finally {
      setBusy(false);
    }
  };
  const recordAndEvaluate = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/intents`, { statement }, { headers });
      const { data } = await axios.get(`${API}/tech-fun/intent-evaluation`, { headers });
      setReport(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record that intent.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Waypoints} title="Intent OS" hint="Stop configuring technology — state the business outcome. Nexus compiles plain English into checkable controls and continuously measures drift. Unverifiable controls are never reported as met.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 min-w-56 flex-1" value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="Every employee handling financial data must be MFA'd and encrypted" data-testid="intent-statement" />
        <Button size="sm" variant="outline" onClick={suggest} disabled={busy || !statement.trim()} data-testid="intent-suggest">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Waypoints className="mr-1 h-3 w-3" />}Compile
        </Button>
        <Button size="sm" onClick={recordAndEvaluate} disabled={busy || !statement.trim()} data-testid="intent-record">
          Record &amp; evaluate
        </Button>
      </div>
      {suggested && (
        <div className="mt-2 flex flex-wrap gap-1" data-testid="intent-suggested">
          {suggested.length ? suggested.map((c) => (
            <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
          )) : <span className="text-xs text-muted-foreground">No known controls suggested — add explicit controls.</span>}
        </div>
      )}
      {report && (
        <div className="mt-3 space-y-1 text-xs" data-testid="intent-report">
          <p className="font-semibold text-sm">{report.drifting} drifting / {report.count} intent(s)</p>
          {report.intents.map((intent) => (
            <div key={intent.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <p className="font-medium">{intent.statement}</p>
              {intent.results.map((r) => (
                <p key={r.control} className={r.verdict === "drifting" ? "text-amber-300" : r.verdict === "met" ? "text-emerald-300" : "text-muted-foreground"}>
                  {r.verdict === "met" ? "✓" : r.verdict === "drifting" ? "⚠" : "?"} {r.control}: {r.reason}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function ITGenome() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const scan = async () => {
    setBusy(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [issues, insights, contribution] = await Promise.all([
        axios.get(`${API}/tech-fun/genome/emerging-issues`, { headers }),
        axios.get(`${API}/tech-fun/genome/insights`, { headers }),
        axios.get(`${API}/tech-fun/genome/contribution`, { headers }),
      ]);
      setResult({ issues: issues.data, insights: insights.data, contribution: contribution.data });
    } catch {
      toast.error("Could not read the Genome.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Dna} title="Nexus IT Genome" hint="Privacy-preserving operational intelligence: which stacks fail, what causes which symptoms, and which fixes actually work. Patterns are one-way fingerprinted and only ever surfaced as k-anonymised aggregates — no customer data leaves this page.">
      <Button size="sm" onClick={scan} disabled={busy} data-testid="genome-scan">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Dna className="mr-1 h-3 w-3" />}Scan the Genome
      </Button>
      {result && (
        <div className="mt-3 space-y-2 text-xs" data-testid="genome-result">
          <p className="text-muted-foreground">{result.contribution.patterns_contributed} anonymised pattern(s) contributed · k ≥ {result.contribution.privacy.k_anonymity_min}</p>
          {result.issues.emerging_issues.length === 0 && result.insights.insights.length === 0 && (
            <p className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">Not enough evidence yet — clusters below the anonymity floor are never reported.</p>
          )}
          {result.issues.emerging_issues.map((issue, i) => (
            <div key={i} className="rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-amber-200">
              🧬 {issue.symptom} on {issue.os_family} — {issue.baseline_note} ({issue.recent_failures}/{issue.recent_samples} recent)
            </div>
          ))}
          {result.insights.insights.map((insight, i) => (
            <div key={i} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <p className="font-medium">{insight.symptom} · {insight.samples} sample(s)</p>
              {insight.remedies.slice(0, 2).map((r) => (
                <p key={r.remediation_kind} className="text-muted-foreground">{r.remediation_kind}: {Math.round(r.success_rate * 100)}% success ({r.attempts} attempt(s))</p>
              ))}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function UniversalConnector() {
  const { token } = useAuth();
  const [coverage, setCoverage] = useState(null);
  const [form, setForm] = useState({ verb: "license.assign", from_adapter: "pax8", to_adapter: "microsoft365" });
  const [swap, setSwap] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const load = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/connector/coverage`, { headers });
      setCoverage(data);
    } catch {
      toast.error("Could not load capability coverage.");
    } finally {
      setBusy(false);
    }
  };
  const planSwap = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/connector/swap-plan`, form, { headers });
      setSwap(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "No swap plan for that combination.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={ArrowRightLeft} title="Universal Connector" hint="One operational abstraction over every vendor. Workflows speak capability verbs — identity.user.disable, endpoint.isolate, backup.restore — so vendors become replaceable components. Coverage shows exactly what is portable today; adapters are never claimed as wired when they are not.">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={load} disabled={busy} data-testid="connector-coverage">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ArrowRightLeft className="mr-1 h-3 w-3" />}Capability coverage
        </Button>
        <Input className="h-8 w-40" value={form.verb} onChange={(e) => setForm({ ...form, verb: e.target.value })} data-testid="connector-verb" />
        <Input className="h-8 w-32" value={form.from_adapter} onChange={(e) => setForm({ ...form, from_adapter: e.target.value })} data-testid="connector-from" />
        <Input className="h-8 w-32" value={form.to_adapter} onChange={(e) => setForm({ ...form, to_adapter: e.target.value })} data-testid="connector-to" />
        <Button size="sm" onClick={planSwap} disabled={busy} data-testid="connector-swap">Swap plan</Button>
      </div>
      {coverage && (
        <div className="mt-3 text-xs" data-testid="connector-result">
          <p className="font-semibold text-sm">{coverage.verbs_portable_now}/{coverage.verbs_total} verbs portable now · {coverage.verbs_with_wired_adapter} with a wired adapter</p>
          {coverage.single_vendor_risks.length > 0 && (
            <p className="mt-1 rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-amber-200">
              ⚠ Single-vendor risk: {coverage.single_vendor_risks.join(", ")}
            </p>
          )}
          {swap && (
            <div className="mt-2 rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5" data-testid="connector-swap-result">
              <p className="font-medium">{swap.from.vendor} → {swap.to.vendor} for {swap.verb} (target: {swap.to.status})</p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {swap.checklist.map((step, i) => <li key={i}>• {step}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function LedgerMetering() {
  const { token } = useAuth();
  const [usage, setUsage] = useState({ meter: "endpoints.managed", quantity: 15 });
  const [share, setShare] = useState({ meter: "endpoints.managed", rate_per_unit: 2.5, platform_share_percent: 10 });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const record = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/ledger/usage`, { ...usage, quantity: Number(usage.quantity) }, { headers });
      const { data } = await axios.post(`${API}/tech-fun/ledger/revenue-share`, {
        ...share, rate_per_unit: Number(share.rate_per_unit), platform_share_percent: Number(share.platform_share_percent),
      }, { headers });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record usage.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Coins} title="Metering &amp; Ledger" hint="The financial plumbing for marketplace economics: idempotent usage meter events and an append-only, hash-chained double-entry ledger. Revenue-share previews use only rates you or an agreement supply — Nexus never invents pricing.">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-8 w-44" value={usage.meter} onChange={(e) => setUsage({ ...usage, meter: e.target.value })} data-testid="ledger-meter" />
        <Input className="h-8 w-20" type="number" value={usage.quantity} onChange={(e) => setUsage({ ...usage, quantity: e.target.value })} data-testid="ledger-qty" />
        <Input className="h-8 w-24" type="number" value={share.rate_per_unit} onChange={(e) => setShare({ ...share, rate_per_unit: e.target.value })} data-testid="ledger-rate" title="rate per unit (supplied by you)" />
        <Input className="h-8 w-20" type="number" value={share.platform_share_percent} onChange={(e) => setShare({ ...share, platform_share_percent: e.target.value })} data-testid="ledger-share" title="platform share %" />
        <Button size="sm" onClick={record} disabled={busy} data-testid="ledger-record">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Coins className="mr-1 h-3 w-3" />}Record &amp; preview
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="ledger-result">
          <p className="font-semibold">{result.meter}: {result.quantity} × {result.rate_per_unit} = {result.gross}</p>
          <p className="text-xs text-muted-foreground">Platform fee {result.platform_fee} ({result.platform_share_percent}%) · MSP net {result.msp_net} · {result.note}</p>
        </div>
      )}
    </Section>
  );
}

function ConsequenceEngine() {
  const { token } = useAuth();
  const [form, setForm] = useState({ action_type: "reboot", target_id: "", destructive: false });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/consequence`, form, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not model the consequences.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={AlertTriangle} title="What happens if I…?" hint="The Consequence Engine: before any action, what does clicking this button mean to the business? Incidents, agreements, recovery options and the Nexus Laws gate.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-32" value={form.action_type} onChange={(e) => setForm({ ...form, action_type: e.target.value })} placeholder="reboot · delete · retire" data-testid="con-action" />
        <Input className="h-8 w-32" value={form.target_id} onChange={(e) => setForm({ ...form, target_id: e.target.value })} placeholder="device/client ID" data-testid="con-target" />
        <Button size="sm" variant={form.destructive ? "default" : "outline"} onClick={() => setForm({ ...form, destructive: !form.destructive })} data-testid="con-destructive">
          {form.destructive ? "💥 destructive" : "not destructive"}
        </Button>
        <Button size="sm" onClick={run} disabled={busy || !form.target_id.trim()} data-testid="con-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <AlertTriangle className="mr-1 h-3 w-3" />}Model it
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="con-result">
          <p className="font-semibold">{result.verdict}</p>
          <ul className="mt-2 space-y-1 text-xs">
            <li className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">💰 {result.billing_implications}</li>
            <li className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">👥 {result.users_affected?.note}</li>
            {result.recovery_options?.map((r, i) => (
              <li key={i} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">🛟 {r}</li>
            ))}
            {result.security_implications?.map((s, i) => (
              <li key={i} className="rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-amber-200">🔐 {s}</li>
            ))}
          </ul>
          {result.law_gate && (
            <p className={`mt-2 text-xs font-semibold ${result.law_gate.overall === "blocked" ? "text-red-300" : "text-emerald-300"}`}>
              ⚖ {result.law_gate.verdict}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

function MorningCommander() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/morning-commander`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not brief the commander.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Sunrise} title="Morning Commander" hint="Not another dashboard. Nexus decides what matters today — and what can safely be handled without you.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="commander-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sunrise className="mr-1 h-3 w-3" />}Brief me
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="commander-result">
          <p className="font-semibold">{result.greeting}</p>
          <p className="text-xs text-muted-foreground">{result.estate} Overnight Nexus handled {result.overnight_handled} issue(s) without human intervention.</p>
          <ol className="mt-2 space-y-1 text-xs">
            {result.attention.map((a, i) => (
              <li key={i} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                <span className={a.severity === "high" ? "text-amber-300" : "text-violet-200"}>{i + 1}. {a.line}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs italic text-violet-200/90">{result.verdict}</p>
          <div className="mt-2 rounded border border-emerald-500/25 bg-emerald-500/[0.06] px-2.5 py-1.5 text-xs">
            <p className="text-emerald-200">[Handle My Safe Stuff] — {result.safe_stuff.length} queued</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {result.safe_stuff.map((s) => <li key={s.item}>• {s.item}</li>)}
            </ul>
            <p className="mt-1 text-[10px] italic">{result.safe_note}</p>
          </div>
          {result.name_critic?.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.name_critic.map((q) => (
                <p key={q.device} className="text-xs text-violet-200/80">🏷 {q.quip}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function EndMyDay() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/end-my-day`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not run the end-of-day review.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Sunset} title="End My Day" hint="The opposite of the commander: what must not be left behind. Combine with Can I Go Home? for the full ceremony.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="endday-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sunset className="mr-1 h-3 w-3" />}Before you finish…
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="endday-result">
          <p className="font-semibold">{result.verdict}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {result.checks.map((c) => (
              <li key={c.label} className={c.ok ? "text-emerald-300" : "text-amber-300"}>
                {c.ok ? "✓" : "⚠"} {c.label} — <span className="text-muted-foreground">{c.detail}</span>
              </li>
            ))}
          </ul>
          {result.warnings.map((w, i) => (
            <div key={i} className="mt-2 rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-xs">
              <p className="text-amber-200">{w.line}</p>
              <div className="mt-1 flex gap-1">
                {w.actions?.map((a) => (
                  <span key={a} className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-200">[{a}]</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function DecisionMemory() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [decision, setDecision] = useState({ decision: "", reason: "", review_date: "", customer_accepted_risk: false });
  const [risk, setRisk] = useState({ title: "", risk_owner: "", expires: "", compensating_controls: "" });
  const [memory, setMemory] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const [decisions, risks, told] = await Promise.all([
        axios.get(`${API}/tech-fun/decisions`, { headers }),
        axios.get(`${API}/tech-fun/risk-acceptances`, { headers }),
        axios.get(`${API}/tech-fun/we-told-you`, { headers }),
      ]);
      setMemory({ decisions: decisions.data, risks: risks.data, told: told.data });
    } catch {
      toast.error("Could not load the memory.");
    } finally {
      setBusy(false);
    }
  };
  const saveDecision = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/decisions`, decision, { headers });
      toast.success("Decision recorded. Future-you will know why.");
      setDecision({ decision: "", reason: "", review_date: "", customer_accepted_risk: false });
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the decision.");
      setBusy(false);
    }
  };
  const saveRisk = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/risk-acceptances`, risk, { headers });
      toast.success("Risk acceptance recorded with an expiry. It won't disappear into ticket notes.");
      setRisk({ title: "", risk_owner: "", expires: "", compensating_controls: "" });
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the risk.");
      setBusy(false);
    }
  };
  return (
    <Section icon={BookOpen} title="Nexus remembers" hint="Decision log, risk acceptances and Prior Recommendation Evidence — the commercial and liability context nobody remembers six months later.">
      <div className="space-y-2">
        <Input value={decision.decision} onChange={(e) => setDecision({ ...decision, decision: e.target.value })} placeholder="decision (e.g. don't replace SERVER02 until FY27)" data-testid="mem-decision" />
        <div className="flex flex-wrap gap-2">
          <Input className="h-8 w-40" value={decision.reason} onChange={(e) => setDecision({ ...decision, reason: e.target.value })} placeholder="reason" data-testid="mem-reason" />
          <Input className="h-8 w-28" value={decision.review_date} onChange={(e) => setDecision({ ...decision, review_date: e.target.value })} placeholder="review date" data-testid="mem-review" />
          <Button size="sm" variant={decision.customer_accepted_risk ? "default" : "outline"} onClick={() => setDecision({ ...decision, customer_accepted_risk: !decision.customer_accepted_risk })} data-testid="mem-accepted">
            {decision.customer_accepted_risk ? "✓ customer accepted risk" : "customer accepted risk?"}
          </Button>
          <Button size="sm" onClick={saveDecision} disabled={busy || !decision.decision.trim()} data-testid="mem-save-decision">Record decision</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input className="h-8 w-40" value={risk.title} onChange={(e) => setRisk({ ...risk, title: e.target.value })} placeholder="accepted risk (e.g. Server 2012)" data-testid="mem-risk-title" />
          <Input className="h-8 w-28" value={risk.risk_owner} onChange={(e) => setRisk({ ...risk, risk_owner: e.target.value })} placeholder="risk owner" data-testid="mem-risk-owner" />
          <Input className="h-8 w-28" value={risk.expires} onChange={(e) => setRisk({ ...risk, expires: e.target.value })} placeholder="expires" data-testid="mem-risk-expires" />
          <Button size="sm" variant="outline" onClick={saveRisk} disabled={busy || !risk.title.trim()} data-testid="mem-save-risk">Record risk</Button>
          <Button size="sm" onClick={load} disabled={busy} data-testid="mem-load">Show memory</Button>
        </div>
      </div>
      {memory && (
        <div className="mt-3 space-y-2 text-xs" data-testid="memory-result">
          <p className="font-semibold text-violet-200">{memory.risks.verdict}</p>
          {memory.risks.acceptances?.map((r) => (
            <div key={r.id} className="rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5">
              <span className="text-amber-200">⚠ {r.title} — owner {r.risk_owner || "unknown"}, expires {r.expires || "unspecified"}{r.review_due ? " — REVIEW DUE" : ""}</span>
              {r.compensating_controls && <p className="mt-0.5 text-muted-foreground">Controls: {r.compensating_controls}</p>}
            </div>
          ))}
          {memory.decisions.decisions?.slice(0, 3).map((d) => (
            <div key={d.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <span className="text-violet-200">📌 {d.decision}</span>
              <p className="mt-0.5 text-muted-foreground">Why: {d.reason}{d.customer_accepted_risk ? " · customer accepted risk" : ""}</p>
            </div>
          ))}
          <div className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
            <p className="text-violet-200">{memory.told.verdict}{memory.told.internal_note ? ` ${memory.told.internal_note}` : ""}</p>
            {memory.told.chain?.map((c, i) => (
              <p key={i} className="mt-1 text-muted-foreground">
                {c.recommendation} → {c.accepted_risk} → {c.subsequent_incidents.map((s) => `${s.number}: ${s.title}`).join(", ")}
              </p>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

export {
  NexusLaws,
  CredentialGuard,
  RealityChecks,
  IntentOS,
  ITGenome,
  UniversalConnector,
  LedgerMetering,
  ConsequenceEngine,
  MorningCommander,
  EndMyDay,
  DecisionMemory,
};
