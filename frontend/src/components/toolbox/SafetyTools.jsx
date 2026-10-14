import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { ClientPicker } from "@/components/DevicePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ShieldAlert, Scale, History, Loader2,
} from "lucide-react";
import { Section } from "./toolboxShared";

// ============== SAFETY UX & DECISION FAMILY ==============

function WritingGuard() {
  const { token } = useAuth();
  const [draft, setDraft] = useState({ content: "", client_id: "client-001" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const scan = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/safety/writing-guard`, draft, { headers });
      setResult(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not scan the draft.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={ShieldAlert} title="Writing Guard" hint="Wrong-Customer Protection: scan a draft against the customers you actually have before a human sends it. Flags cross-customer leaks — 'this content references Contoso, you are replying to ACME'. Nexus flags the mismatch, humans decide; it never claims to judge intent.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-64" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder="draft text — try another customer's name" data-testid="guard-content" />
        <ClientPicker value={draft.client_id} onChange={(v) => setDraft({ ...draft, client_id: v })} testId="guard-client" className="w-44" />
        <Button size="sm" onClick={scan} disabled={busy || !draft.content.trim()} data-testid="guard-run">
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ShieldAlert className="mr-1 h-3 w-3" />}Scan draft
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-xs" data-testid="guard-result">
          <p className={result.verdict === "clean" ? "font-semibold text-emerald-300" : "font-semibold text-amber-200"}>
            {result.verdict === "clean" ? "✓ No cross-customer references detected." : "⚠ Review required before sending"}
          </p>
          {result.warnings?.map((w, i) => (
            <p key={i} className="mt-1 rounded border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5 text-amber-200">{w.message}</p>
          ))}
          <p className="mt-1 text-muted-foreground">{result.note}</p>
        </div>
      )}
    </Section>
  );
}

function FourEyesSignOff() {
  const { token } = useAuth();
  const [form, setForm] = useState({ title: "Raise RMM alert threshold", before: "80", after: "95" });
  const [lastId, setLastId] = useState("");
  const [listing, setListing] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const request = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/safety/four-eyes`, {
        title: form.title, before: { value: form.before }, after: { value: form.after },
      }, { headers });
      setLastId(data.review_id);
      toast.success("Sign-off requested — the real diff is attached.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not request sign-off.");
    } finally {
      setBusy(false);
    }
  };
  const review = async (decision) => {
    if (!lastId) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/tech-fun/safety/four-eyes/${lastId}/review`, { decision }, { headers });
      toast.success(`Signed off as ${data.decision} by an independent reviewer.`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Review refused.");
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/safety/four-eyes`, { headers });
      setListing(data);
    } catch {
      toast.error("Could not load sign-offs.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={Scale} title="Four-Eyes Sign-Off" hint="Independent approval with the real diff — every change shows exactly what moves, at real paths. The requester can never approve their own work; try it and the API will refuse you.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-52" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="eyes-title" />
        <Input className="h-8 w-24" value={form.before} onChange={(e) => setForm({ ...form, before: e.target.value })} title="before value" data-testid="eyes-before" />
        <Input className="h-8 w-24" value={form.after} onChange={(e) => setForm({ ...form, after: e.target.value })} title="after value" data-testid="eyes-after" />
        <Button size="sm" onClick={request} disabled={busy || !form.title.trim()} data-testid="eyes-request">Request sign-off</Button>
        <Button size="sm" variant="outline" onClick={() => review("approved")} disabled={busy || !lastId} data-testid="eyes-approve">Approve</Button>
        <Button size="sm" variant="outline" onClick={() => review("rejected")} disabled={busy || !lastId} data-testid="eyes-reject">Reject</Button>
        <Button size="sm" variant="outline" onClick={load} disabled={busy} data-testid="eyes-load">Show sign-offs</Button>
      </div>
      {listing && (
        <div className="mt-3 space-y-1.5 text-xs" data-testid="eyes-result">
          <p className="font-semibold text-violet-200">{listing.pending} pending · {listing.count} on record</p>
          {listing.sign_offs?.slice(0, 4).map((s) => (
            <div key={s.id} className="rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <span className="text-violet-200">{s.subject} — {s.state}</span>
              <p className="mt-0.5 text-muted-foreground">
                diff: {s.diff_summary.changed} changed, {s.diff_summary.added} added, {s.diff_summary.removed} removed
                {s.decided_by ? ` · ${s.decision} by ${s.decided_by}` : ` · requested by ${s.requester}`}
              </p>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function DecisionFamily() {
  const { token } = useAuth();
  const [form, setForm] = useState({ kind: "consent_receipt", subject: "" });
  const [index, setIndex] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const record = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tech-fun/decision-family`, form, { headers });
      toast.success("Recorded in the human-decision family — one lifecycle for every decision.");
      setForm({ ...form, subject: "" });
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record the object.");
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/tech-fun/decision-family`, { headers });
      setIndex(data);
    } catch {
      toast.error("Could not load the decision family.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={History} title="Decision Family" hint="Approvals, consent receipts, risk acceptances and the decision log share one lifecycle: proposed → reviewed → decided → review-due → expired. review-due and expired derive from real dates, so nothing quietly decays into a ticket note.">
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-36" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} title="decision_log · risk_acceptance · approval · consent_receipt" data-testid="family-kind" />
        <Input className="h-8 w-64" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="subject (e.g. customer consented to after-hours patching)" data-testid="family-subject" />
        <Button size="sm" onClick={record} disabled={busy || !form.subject.trim()} data-testid="family-record">Record</Button>
        <Button size="sm" variant="outline" onClick={load} disabled={busy} data-testid="family-load">Show family</Button>
      </div>
      {index && (
        <div className="mt-3 text-xs" data-testid="family-result">
          <p className="font-semibold text-violet-200">
            {index.count} object(s) · {Object.entries(index.by_state).map(([state, count]) => `${count} ${state}`).join(" · ")}
          </p>
          {index.objects?.slice(0, 4).map((o) => (
            <div key={`${o.source}-${o.id}`} className="mt-1 rounded border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-1.5">
              <span className="text-violet-200">[{o.kind}] {o.subject} — {o.state}</span>
              <p className="mt-0.5 text-muted-foreground">
                {o.owner ? `owner ${o.owner}` : "no owner recorded"}
                {o.days_to_expiry != null ? ` · expires in ${o.days_to_expiry} day(s)` : ""}
              </p>
            </div>
          ))}
          <p className="mt-1 text-muted-foreground">{index.question_answered}</p>
        </div>
      )}
    </Section>
  );
}

export {
  WritingGuard,
  FourEyesSignOff,
  DecisionFamily,
};
