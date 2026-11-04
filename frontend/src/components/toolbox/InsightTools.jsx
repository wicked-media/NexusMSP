import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import DevicePicker, { ClientPicker } from "@/components/DevicePicker";
import { CompareBars } from "@/components/design-system";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Activity, Eye, History, Search, MapPin, CalendarClock, TrendingDown, Hammer, PanelRight,
  HelpCircle, BadgeCheck, Sparkles, BellOff, GitMerge, ClipboardCheck, Gauge, Loader2,
} from "lucide-react";
import { Section } from "./toolboxShared";

// ============== INSIGHT LAYER ==============

function BehaviourBaseline() {
  const { token } = useAuth();
  const [deviceId, setDeviceId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/baseline/${encodeURIComponent(deviceId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not baseline that device.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Activity} title="Understand normal" hint="What is normal for THIS device? Peer-derived behaviour bands — so 85% RAM is only interesting when 85% isn't this server's normal.">
      <div className="flex gap-2">
        <DevicePicker value={deviceId} onChange={setDeviceId} testId="baseline-device" />
        <Button size="sm" onClick={run} disabled={busy || !deviceId.trim()} data-testid="baseline-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Activity className="mr-1 h-3 w-3" />}Baseline
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="baseline-result">
          <p className="font-semibold">{result.verdict}</p>
          <div className="mt-2 space-y-1.5">
            {Object.entries(result.bands || {}).map(([stat, band]) => (
              <div key={stat} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
                <span className={band.unusual ? "text-amber-300" : "text-slate-300"}>
                  {stat.replace(/_/g, " ")}: {band.current}%
                  {band.normal_band ? ` — normal ${band.normal_band[0]}–${band.normal_band[1]}%` : ""}
                  {band.unusual ? " ⚠ unusual" : ""}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs italic text-violet-200/90">{result.baseline_note}</p>
        </div>
      )}
    </Section>
  );
}

const ANOMALY_KINDS = {
  odd_hours: "🌙", auth_burst: "🔐", backup_drift: "💾", new_device: "🆕", stat_outlier: "📈",
};

function SomethingFeelsWrong() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/anomaly-scan`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not run the anomaly scan.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Eye} title="👀 Something feels wrong" hint="No obvious alert yet? Broad anomaly analysis across the estate — statistically unusual, not necessarily broken. Professionally: the Anomaly Explorer.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="anomaly-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Eye className="mr-1 h-3 w-3" />}Something Feels Wrong
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="anomaly-result">
          <p className="font-semibold">{result.verdict}</p>
          {result.findings.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {result.findings.map((finding, index) => (
                <li key={`${finding.kind}-${index}`} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
                  <span className="text-violet-200">{ANOMALY_KINDS[finding.kind] || "❓"} {finding.title}</span>
                  <p className="mt-0.5 text-muted-foreground">{finding.detail}</p>
                </li>
              ))}
            </ul>
          )}
          {result.clusters.map((cluster, index) => (
            <p key={index} className="mt-2 rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-xs text-amber-200">
              {cluster.findings.length} behaviours began together — probable common dependency: {cluster.probable_common_dependency}
            </p>
          ))}
        </div>
      )}
    </Section>
  );
}

function UniversalTimeline() {
  const { token } = useAuth();
  const [filters, setFilters] = useState({ person: "", device: "", customer: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/timeline`, {
        params: { hours: 24, user_filter: filters.person, device_filter: filters.device, client_filter: filters.customer },
        headers: { Authorization: `Bearer ${token}` },
      });
      setResult(data);
    } catch {
      toast.error("Could not build the timeline.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={History} title="Nexus Timeline" hint="One universal timeline: logins, alerts, tickets, sessions, automation and billing — then filter by person, device or customer.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-28" value={filters.person} onChange={(e) => setFilters({ ...filters, person: e.target.value })} placeholder="person" data-testid="timeline-person" />
        <Input className="h-8 w-28" value={filters.device} onChange={(e) => setFilters({ ...filters, device: e.target.value })} placeholder="device" data-testid="timeline-device" />
        <Input className="h-8 w-28" value={filters.customer} onChange={(e) => setFilters({ ...filters, customer: e.target.value })} placeholder="customer" data-testid="timeline-customer" />
        <Button size="sm" onClick={run} disabled={busy} data-testid="timeline-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <History className="mr-1 h-3 w-3" />}Build
        </Button>
      </div>
      {result && (
        <div className="mt-3" data-testid="timeline-result">
          <p className="text-xs text-muted-foreground">{result.count} event(s) in the last {result.scanned_hours}h</p>
          <ul className="mt-2 space-y-1">
            {result.events.map((event, index) => (
              <li key={`${event.kind}-${index}`} className="flex items-start gap-2 text-xs">
                <span className="w-11 shrink-0 font-mono text-muted-foreground">
                  {new Date(event.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="w-16 shrink-0 rounded bg-violet-500/15 px-1.5 py-0.5 text-center text-[10px] uppercase tracking-wide text-violet-200">{event.kind}</span>
                <span className="flex-1">{event.title}{event.user_name ? ` — ${event.user_name}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function UniversalSearch() {
  const { token } = useAuth();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/universal-search`, {
        params: { q: query },
        headers: { Authorization: `Bearer ${token}` },
      });
      setResult(data);
    } catch {
      toast.error("Search failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Search} title="One search box for everything" hint="Phone number, serial, IP, email, invoice number — one query finds every object that mentions it, across the whole MSP.">
      <div className="flex gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && query.trim() && run()}
          placeholder="0412 345 678 · SN-4455 · INC-0001" data-testid="search-query" />
        <Button size="sm" onClick={run} disabled={busy || !query.trim()} data-testid="search-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Search className="mr-1 h-3 w-3" />}Search
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="search-result">
          <p className="text-xs text-muted-foreground">{result.total} match(es) for "{result.query}"</p>
          {Object.entries(result.groups).map(([kind, rows]) => (
            <div key={kind} className="mt-2">
              <p className="text-[10px] uppercase tracking-widest text-violet-400">{kind}</p>
              <ul className="mt-1 space-y-1">
                {rows.map((row, index) => (
                  <li key={index} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
                    {Object.values(row).filter(Boolean).join(" · ")}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function SessionSidecar() {
  const { token } = useAuth();
  const [deviceId, setDeviceId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/session-sidecar/${encodeURIComponent(deviceId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not build the sidecar.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={PanelRight} title="Remote session sidecar" hint="Everything beside the session: device health, open tickets, recent changes, warranty — without leaving the screen.">
      <div className="flex gap-2">
        <DevicePicker value={deviceId} onChange={setDeviceId} testId="sidecar-device" />
        <Button size="sm" onClick={run} disabled={busy || !deviceId.trim()} data-testid="sidecar-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <PanelRight className="mr-1 h-3 w-3" />}Open sidecar
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="sidecar-result">
          <p className="font-semibold">
            {result.device?.hostname || result.device?.name} — health {result.device_health}/100
            {result.warranty_days_remaining != null && ` · warranty ${result.warranty_days_remaining >= 0 ? `${result.warranty_days_remaining} days left` : "expired"}`}
          </p>
          {result.health_penalties.length > 0 && (
            <p className="mt-1 text-xs text-amber-300">{result.health_penalties.join(" · ")}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{result.recent_changes} recent change(s) on record</p>
          {result.open_tickets.length > 0 && (
            <ul className="mt-1 space-y-1 text-xs">
              {result.open_tickets.map((ticket) => (
                <li key={ticket.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                  {ticket.ticket_number || ticket.id}: {ticket.title} <span className="text-muted-foreground">({ticket.priority})</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {result.actions.map((action) => (
              <span key={action} className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-200">{action}</span>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function WhileYoureThere() {
  const { token } = useAuth();
  const [clientId, setClientId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/while-youre-there/${encodeURIComponent(clientId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not list on-site work.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={MapPin} title="Since you're here…" hint="If you're already paying for the truck roll, everything worth physically doing at this customer while you're on site.">
      <div className="flex gap-2">
        <ClientPicker value={clientId} onChange={setClientId} testId="wyd-client" />
        <Button size="sm" onClick={run} disabled={busy || !clientId.trim()} data-testid="wyd-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <MapPin className="mr-1 h-3 w-3" />}What's worth doing
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="wyd-result">
          <p className="font-semibold">{result.verdict}</p>
          {result.tasks.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {result.tasks.map((task, index) => (
                <li key={index} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">{task.task}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

function DependencyHorizon() {
  const { token } = useAuth();
  const [days, setDays] = useState("90");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/dependency-horizon`, {
        params: { days: Math.max(7, Math.min(365, Number(days) || 90)) },
        headers: { Authorization: `Bearer ${token}` },
      });
      setResult(data);
    } catch {
      toast.error("Could not scan the horizon.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={CalendarClock} title="Dependency calendar" hint="Warranties, patching debt, contract ends and renewals — what becomes somebody else's emergency if we ignore it?">
      <div className="flex gap-2">
        <Input className="h-8 w-20" value={days} onChange={(e) => setDays(e.target.value)} data-testid="horizon-days" />
        <Button size="sm" onClick={run} disabled={busy} data-testid="horizon-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CalendarClock className="mr-1 h-3 w-3" />}Scan horizon
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="horizon-result">
          <p className="font-semibold">{result.verdict}</p>
          {result.items.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {result.items.map((item, index) => (
                <li key={`${item.kind}-${index}`} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                  <span className="text-violet-200">{item.date} · {item.title}</span>
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

function AgreementMargin() {
  const { token } = useAuth();
  const [clientId, setClientId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/agreement-margin/${encodeURIComponent(clientId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not price that agreement.");
    } finally {
      setBusy(false);
    }
  };
  const alerting = result?.verdict?.startsWith("⚠");
  return (
    <Section icon={TrendingDown} title="You're giving this customer away" hint="Agreement value versus estimated delivery cost from recorded ticket time — margin alerts before the renewal conversation.">
      <div className="flex gap-2">
        <ClientPicker value={clientId} onChange={setClientId} testId="margin-client" />
        <Button size="sm" onClick={run} disabled={busy || !clientId.trim()} data-testid="margin-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <TrendingDown className="mr-1 h-3 w-3" />}Check margin
        </Button>
      </div>
      {result && (
        <div className={`mt-3 rounded-lg border p-3 text-sm ${alerting ? "border-red-500/30 bg-red-500/[0.08]" : "border-emerald-500/30 bg-emerald-500/[0.08]"}`} data-testid="margin-result">
          <p className="font-semibold">{result.verdict}</p>
          {result.monthly_value != null && (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                ${result.monthly_value?.toLocaleString()}/month vs ${result.estimated_monthly_delivery_cost?.toLocaleString()} estimated delivery
                {result.recommended_monthly_range && ` · healthy range $${result.recommended_monthly_range[0].toLocaleString()}–$${result.recommended_monthly_range[1].toLocaleString()}`}
              </p>
              <div className="mt-2 max-w-xl">
                <CompareBars
                  testid="margin-chart"
                  height={160}
                  format={(value) => `$${Number(value).toLocaleString()}/mo`}
                  data={[
                    { label: "Agreement", value: result.monthly_value, fill: "#34d399" },
                    { label: "Delivery cost", value: result.estimated_monthly_delivery_cost, fill: "#fb7185" },
                    ...(result.recommended_monthly_range ? [
                      { label: "Healthy low", value: result.recommended_monthly_range[0], fill: "#38bdf8" },
                      { label: "Healthy high", value: result.recommended_monthly_range[1], fill: "#38bdf8" },
                    ] : []),
                  ]}
                />
              </div>
            </>
          )}
          <p className="mt-2 text-xs italic text-violet-200/90">{result.trend_note}</p>
        </div>
      )}
    </Section>
  );
}

function TechnicalDebt() {
  const { token } = useAuth();
  const [form, setForm] = useState({ title: "", why: "", proper_fix: "", review_due: "" });
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const load = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/technical-debt`, { headers });
      setReport(data);
    } catch {
      toast.error("Could not load the debt report.");
    } finally {
      setBusy(false);
    }
  };
  const record = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/technical-debt`, form, { headers });
      toast.success("Temporary fix recorded. Future you has been warned.");
      setForm({ title: "", why: "", proper_fix: "", review_due: "" });
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the debt.");
      setBusy(false);
    }
  };
  return (
    <Section icon={Hammer} title="Future Me Will Hate Me" hint="Record the temporary workaround with its why, review date and proper fix — Nexus resurfaces it before it turns seven years old.">
      <div className="space-y-2">
        <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="temporary fix (required)" data-testid="debt-title" />
        <Input value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} placeholder="why?" data-testid="debt-why" />
        <Input value={form.proper_fix} onChange={(e) => setForm({ ...form, proper_fix: e.target.value })} placeholder="what is the proper fix?" data-testid="debt-proper" />
        <div className="flex gap-2">
          <Input value={form.review_due} onChange={(e) => setForm({ ...form, review_due: e.target.value })} placeholder="review by (YYYY-MM-DD)" data-testid="debt-review" />
          <Button size="sm" onClick={record} disabled={busy || !form.title.trim()} data-testid="debt-record">
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Hammer className="mr-1 h-3 w-3" />}Record
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={busy} data-testid="debt-report-run">Show debt</Button>
        </div>
      </div>
      {report && (
        <div className="mt-3 text-sm" data-testid="debt-report">
          <p className="font-semibold">{report.open_items} open debt item(s) · ${report.recorded_estimated_remediation_cost?.toLocaleString()} recorded remediation estimate</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Estate: {report.estate?.devices} devices · {report.estate?.legacy_os} legacy OS · {report.estate?.out_of_warranty} out of warranty · {report.overdue_reviews?.length} overdue review(s)
          </p>
          {report.items?.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {report.items.map((item) => (
                <li key={item.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                  <span className="text-violet-200">{item.title}</span>
                  {item.review_due && <span className="text-muted-foreground"> · review {item.review_due}</span>}
                  {item.why && <p className="mt-0.5 text-muted-foreground">Why: {item.why}</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs italic text-violet-200/90">{report.cost_note}</p>
        </div>
      )}
    </Section>
  );
}

function KnowledgeCoverage() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/knowledge-coverage`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not measure knowledge coverage.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={HelpCircle} title="What don't we know?" hint="Unknown infrastructure is itself a risk. Nexus measures its own ignorance — then hands you a mission: Reduce Unknowns → 100%.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="coverage-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <HelpCircle className="mr-1 h-3 w-3" />}Measure the unknowns
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="coverage-result">
          <p className="font-semibold">{result.verdict}</p>
          <p className="mt-1 text-xs text-violet-200">{result.mission}</p>
          {result.unknowns.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {result.unknowns.map((u, i) => (
                <li key={i} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                  <span className={u.severity === "high" ? "text-amber-300" : "text-slate-300"}>
                    ⚠ {u.count}× {u.unknown} ({u.domain})
                  </span>
                  <p className="mt-0.5 text-muted-foreground">{u.detail}</p>
                </li>
              ))}
            </ul>
          )}
          {result.stale_facts.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-widest text-violet-400">Freshness — facts decay</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {result.stale_facts.slice(0, 4).map((f, i) => (
                  <li key={i}>{f.fact} — {f.days_old == null ? "never verified" : `verified ${f.days_old} days ago`}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function ProveIt() {
  const { token } = useAuth();
  const [claim, setClaim] = useState("backup");
  const [subject, setSubject] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/prove-it`, {
        params: { claim, subject_id: subject },
        headers: { Authorization: `Bearer ${token}` },
      });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not gather evidence.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={BadgeCheck} title="Prove It" hint="Next to every important claim. Not 'agent says enabled' — Nexus gathers evidence: claim → evidence → verdict. Backup says yes, Nexus says no.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-36" value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="backup · warranty · patching" data-testid="prove-claim" />
        <Input className="h-8 w-32" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="device/client ID" data-testid="prove-subject" />
        <Button size="sm" onClick={run} disabled={busy || !subject.trim()} data-testid="prove-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <BadgeCheck className="mr-1 h-3 w-3" />}Prove It
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm" data-testid="prove-result">
          <p className={`font-semibold ${result.verdict === "verified" ? "text-emerald-300" : result.verdict === "contradicted" ? "text-red-300" : "text-amber-300"}`}>
            {String(result.verdict || "").toUpperCase()} — {result.claim}
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {(result.evidence || []).map((e, i) => (
              <li key={i} className="flex items-start gap-2">
                <span>{e.status === "ok" ? "✓" : e.status === "stale" ? "⏳" : "✗"}</span>
                <span><span className="text-violet-200">{e.item}</span> — {e.detail}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs italic text-violet-200/90">{result.nexus_position}</p>
        </div>
      )}
    </Section>
  );
}

function ConfidenceReport() {
  const { token } = useAuth();
  const [objectType, setObjectType] = useState("device");
  const [objectId, setObjectId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/confidence/${encodeURIComponent(objectType)}/${encodeURIComponent(objectId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "No confidence to report.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Gauge} title="Confidence everywhere" hint="Not all information is equally trustworthy. Every attribute gets a confidence score — click it to see why Nexus believes it.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-24" value={objectType} onChange={(e) => setObjectType(e.target.value)} placeholder="device · ticket" data-testid="confidence-type" />
        <Input className="h-8 w-32" value={objectId} onChange={(e) => setObjectId(e.target.value)} placeholder="object ID" data-testid="confidence-id" />
        <Button size="sm" onClick={run} disabled={busy || !objectId.trim()} data-testid="confidence-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Gauge className="mr-1 h-3 w-3" />}Why?
        </Button>
      </div>
      {result && (
        <div className="mt-3 space-y-1.5" data-testid="confidence-result">
          {result.attributes.map((a) => (
            <div key={a.attribute} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-36 truncate text-violet-200">{a.attribute}: {a.value}</span>
                <span className={`font-mono ${a.confidence >= 80 ? "text-emerald-300" : a.confidence >= 50 ? "text-amber-300" : "text-red-300"}`}>{a.confidence}%</span>
              </div>
              <p className="mt-0.5 text-muted-foreground">{a.reason}</p>
            </div>
          ))}
          <p className="text-xs italic text-violet-200/90">{result.note}</p>
        </div>
      )}
    </Section>
  );
}

function TicketIntelligence() {
  const { token } = useAuth();
  const [ticketId, setTicketId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const id = encodeURIComponent(ticketId);
      const [difficulty, gravity, preflight] = await Promise.all([
        axios.get(`${API}/tech-fun/ticket-difficulty/${id}`, { headers }),
        axios.get(`${API}/tech-fun/ticket-gravity/${id}`, { headers }),
        axios.get(`${API}/tech-fun/escalation-preflight/${id}`, { headers }),
      ]);
      setResult({ difficulty: difficulty.data, gravity: gravity.data, preflight: preflight.data });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not analyse that ticket.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Sparkles} title="Ticket intelligence" hint="Difficulty before assignment, gravity before it eats the week, and the pre-escalation checklist Nexus runs itself.">
      <div className="flex gap-2">
        <Input value={ticketId} onChange={(e) => setTicketId(e.target.value)} placeholder="ticket ID" data-testid="tix-id" />
        <Button size="sm" onClick={run} disabled={busy || !ticketId.trim()} data-testid="tix-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}Analyse
        </Button>
      </div>
      {result && (
        <div className="mt-3 space-y-2 text-sm" data-testid="tix-result">
          <div className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
            <p className="text-violet-200">{result.difficulty.verdict}</p>
            <p className="mt-0.5 text-muted-foreground">
              Skill: {result.difficulty.likely_skill} · {result.difficulty.similar_incidents} similar incidents ·
              escalation probability {result.difficulty.escalation_probability_pct}%
            </p>
          </div>
          <div className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
            <p className={result.gravity.gravity_score >= 60 ? "text-amber-300" : "text-violet-200"}>{result.gravity.verdict}</p>
          </div>
          <div className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
            <p className="text-violet-200">{result.preflight.verdict}</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {result.preflight.checks.map((c) => (
                <li key={c.check}>{c.ok ? "✓" : "✗"} {c.check} — {c.detail}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Section>
  );
}

function NoiseBudget() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/noise-budget`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not measure the noise.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={BellOff} title="Noise budget" hint="Every alert source measured by what technicians actually did about it. Systematically destroy alert fatigue.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="noise-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <BellOff className="mr-1 h-3 w-3" />}Measure the noise
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="noise-result">
          <p className="font-semibold">{result.verdict}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {result.total_alerts} alerts · {result.actionable} actionable · {result.required_human_action} needed a human · {result.already_suppressed} already suppressed
          </p>
          {result.by_type.length > 0 && (
            <div className="mt-3 max-w-2xl">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Noise rate by alert type</p>
              <CompareBars
                testid="noise-chart"
                height={170}
                unit="%"
                data={result.by_type.map((row) => ({
                  label: row.alert_type,
                  value: row.noise_rate_pct,
                  fill: row.noise_rate_pct >= 80 ? "#fbbf24" : "#a78bfa",
                }))}
              />
            </div>
          )}
          {result.by_type.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {result.by_type.map((row) => (
                <li key={row.alert_type} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                  <span className={row.noise_rate_pct >= 80 ? "text-amber-300" : "text-violet-200"}>
                    {row.alert_type}: {row.noise_rate_pct}% noise ({row.actionable}/{row.total} acted on)
                  </span>
                  <p className="mt-0.5 text-muted-foreground">{row.recommendation}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

function TicketCorrelation() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/correlate-tickets`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not correlate tickets.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={GitMerge} title="One problem, many symptoms" hint="Seven unrelated tickets are often one incident. Nexus correlates them — and finds work batches worth doing once.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="correlate-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <GitMerge className="mr-1 h-3 w-3" />}Correlate open tickets
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="correlate-result">
          <p className="font-semibold">{result.verdict}</p>
          {result.clusters.map((c, i) => (
            <div key={i} className="mt-2 rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-xs">
              <p className="text-amber-200">{c.symptom_count} symptoms at {c.client_name} — probable common cause: {c.probable_common_cause}</p>
              <p className="mt-0.5 text-muted-foreground">{c.tickets.join(" · ")}</p>
            </div>
          ))}
          {result.batches.map((b, i) => (
            <div key={i} className="mt-2 rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5 text-xs">
              <p className="text-violet-200">Work batch: {b.ticket_count}× '{b.shared_token}' ({b.category})</p>
              <p className="mt-0.5 text-muted-foreground">{b.suggested_flow}</p>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function AuditReadiness() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/audit-readiness`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(data);
    } catch {
      toast.error("Could not assemble the evidence.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={ClipboardCheck} title="😱 Auditor Tomorrow" hint="The Audit Readiness Pack: every control, its evidence and its gaps — assembled before the auditor arrives, not during.">
      <Button size="sm" onClick={run} disabled={busy} data-testid="audit-run">
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ClipboardCheck className="mr-1 h-3 w-3" />}Assemble evidence
      </Button>
      {result && (
        <div className="mt-3 text-sm" data-testid="audit-result">
          <p className="font-semibold">{result.verdict}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {result.controls.map((c) => (
              <li key={c.control} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
                <span className={c.status === "verified" ? "text-emerald-300" : c.status === "failed" ? "text-red-300" : "text-amber-300"}>
                  {c.status === "verified" ? "✓" : c.status === "failed" ? "✗" : "⚠"} {c.control} — {c.status}
                </span>
                <p className="mt-0.5 text-muted-foreground">{c.evidence}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs italic text-violet-200/90">Pack: {result.pack_manifest.join(" · ")}</p>
        </div>
      )}
    </Section>
  );
}

export {
  ANOMALY_KINDS,
  BehaviourBaseline,
  SomethingFeelsWrong,
  UniversalTimeline,
  UniversalSearch,
  SessionSidecar,
  WhileYoureThere,
  DependencyHorizon,
  AgreementMargin,
  TechnicalDebt,
  KnowledgeCoverage,
  ProveIt,
  ConfidenceReport,
  TicketIntelligence,
  NoiseBudget,
  TicketCorrelation,
  AuditReadiness,
};
