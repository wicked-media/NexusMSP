import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, Hammer, Search, ShieldCheck } from "lucide-react";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  blockingChecks,
  checkCounts,
  checkStatus,
  emptySpecForm,
  FORGE_TOOL_KINDS,
  kindPresentation,
  lifecycleCopy,
  publishFormErrors,
  publishPayload,
  reviewFormErrors,
  reviewPayload,
  specFormErrors,
  specPayload,
  stagePresentation,
  verdictCopy,
  versionHistory,
} from "@/lib/nexusForge";

/**
 * Nexus Forge — request a tool Nexus does not have, composed from capabilities it does.
 *
 * A Forge request produces a specification and a checklist, never generated code
 * and never a deployment. The catalogue is the route table this API actually
 * serves, so a design can only compose what Nexus can defend.
 */
export default function ForgeDesignCard({ headers, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [form, setForm] = useState(emptySpecForm());
  const [formErrors, setFormErrors] = useState([]);
  const [openRequest, setOpenRequest] = useState("");
  const [review, setReview] = useState({ decision: "approved", evidence_note: "" });
  const [publish, setPublish] = useState({ version: "1.0", evidence_note: "" });
  const [actionErrors, setActionErrors] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: payload } = await axios.get(`${API}/nexus-forge/requests`, { headers });
      setData(payload);
    } catch {
      toast.error("Nexus could not read the Forge design record.");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const search = async () => {
    try {
      const { data: payload } = await axios.get(`${API}/nexus-forge/capabilities`, {
        headers,
        params: { q: query.trim() || undefined, limit: 20 },
      });
      setResults(payload.capabilities || []);
      if (!payload.capabilities?.length) toast.info("No served capability matches that search.");
    } catch {
      toast.error("Nexus could not read the capability catalogue.");
    }
  };

  const submit = async () => {
    const errors = specFormErrors(form);
    setFormErrors(errors);
    if (errors.length) return;
    setBusy(true);
    try {
      const { data: payload } = await axios.post(`${API}/nexus-forge/requests`, specPayload(form), { headers });
      const { verdict } = payload.request;
      setForm(emptySpecForm());
      setFormErrors([]);
      await load();
      onChanged?.();
      if (verdict === "fail") {
        toast.error("Specified, but the checks blocked it", { description: payload.request.verdict_reason });
      } else if (verdict === "needs_review") {
        toast.warning("Specified — a person has to decide", { description: payload.request.verdict_reason });
      } else {
        toast.success("Specified and grounded in served capabilities", { description: payload.request.verdict_reason });
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The design request could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (request) => {
    const errors = reviewFormErrors(request, review);
    setActionErrors(errors);
    if (errors.length) return;
    setBusy(true);
    try {
      await axios.post(`${API}/nexus-forge/requests/${request.id}/review`, reviewPayload(review), { headers });
      setReview({ decision: "approved", evidence_note: "" });
      setActionErrors([]);
      await load();
      onChanged?.();
      toast.success(`Design ${review.decision.replaceAll("_", " ")}`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The review could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const recordVersion = async (request) => {
    const errors = publishFormErrors(request, publish);
    setActionErrors(errors);
    if (errors.length) return;
    setBusy(true);
    try {
      const { data: payload } = await axios.post(
        `${API}/nexus-forge/requests/${request.id}/publish`,
        publishPayload(publish),
        { headers },
      );
      setPublish({ version: "1.0", evidence_note: "" });
      setActionErrors([]);
      await load();
      onChanged?.();
      const latest = payload.request.versions[payload.request.versions.length - 1];
      toast.success(`Version ${latest.version} recorded`, { description: "Recorded means governed, not deployed." });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The version could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const requests = data?.requests || [];
  const tools = data?.tools || [];

  return (
    <section
      className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.05] via-card to-amber-500/[0.02] p-4"
      data-testid="forge-card"
    >
      <header className="mb-3 flex flex-wrap items-start gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-500/25 bg-violet-500/[0.09]">
          <Hammer className="h-4 w-4 text-violet-200" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100">Nexus Forge — request a tool</h3>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            Describe a capability Nexus is missing. Forge composes capabilities this API already serves into a reviewed
            specification — it does not generate or deploy executable code.
          </p>
        </div>
        <Badge variant="outline" className="ml-auto border-violet-500/25 text-[10px] text-violet-100" data-testid="forge-counts">
          {data?.summary?.total || 0} designed · {data?.summary?.published || 0} versioned · {data?.summary?.failed || 0} blocked
        </Badge>
      </header>

      <div className="rounded-xl border border-white/[0.07] bg-black/10 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">1 · Compose served capabilities</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") search(); }}
            placeholder="Search the served API: devices, invoices, wish-engine…"
            aria-label="Search served capabilities"
            data-testid="forge-capability-search"
            className="min-w-0 flex-1"
          />
          <Button variant="outline" size="sm" onClick={search} className="gap-1.5" data-testid="forge-capability-search-submit">
            <Search className="h-3.5 w-3.5" />Find
          </Button>
        </div>
        {results.length > 0 && (
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto" data-testid="forge-capability-results">
            {results.map((capability) => {
              const composed = (form.capability_refs || []).includes(capability.id);
              return (
                <li key={capability.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.07] bg-black/20 px-2.5 py-1.5">
                  <span className="font-mono text-[11px] text-zinc-200">{capability.id}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {capability.methods.join(", ")}{capability.mutating ? " · changes state" : " · read only"}
                  </span>
                  <Button
                    size="sm"
                    variant={composed ? "ghost" : "outline"}
                    className="ml-auto text-[10px]"
                    disabled={composed}
                    onClick={() => setForm((current) => ({
                      ...current,
                      capability_refs: [...(current.capability_refs || []), capability.id].slice(0, 60),
                    }))}
                    data-testid={`forge-add-${capability.id}`}
                  >
                    {composed ? "Composed" : "Add"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="forge-composition">
          {(form.capability_refs || []).length === 0 && (
            <span className="text-[10px] text-muted-foreground">Nothing composed yet. A design must ground itself in capabilities Nexus serves.</span>
          )}
          {(form.capability_refs || []).map((ref) => (
            <button
              key={ref}
              type="button"
              className="rounded-md border border-cyan-500/25 bg-cyan-500/[0.06] px-2 py-1 font-mono text-[10px] text-cyan-100"
              onClick={() => setForm((current) => ({
                ...current,
                capability_refs: (current.capability_refs || []).filter((item) => item !== ref),
              }))}
              data-testid={`forge-remove-${ref}`}
            >
              {ref} ×
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/10 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">2 · Specify the tool</p>
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          <Input value={form.title} onChange={(event) => setForm((c) => ({ ...c, title: event.target.value }))} placeholder="Tool title" aria-label="Tool title" data-testid="forge-title" />
          <select
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-400/40"
            value={form.kind}
            onChange={(event) => setForm((c) => ({ ...c, kind: event.target.value }))}
            aria-label="Form the tool takes"
            data-testid="forge-kind"
          >
            {FORGE_TOOL_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
          </select>
          <Textarea className="lg:col-span-2" rows={2} value={form.intent} onChange={(event) => setForm((c) => ({ ...c, intent: event.target.value }))} placeholder="What should the tool do?" aria-label="What the tool does" data-testid="forge-intent" />
          <Textarea className="lg:col-span-2" rows={2} value={form.expected_outcome} onChange={(event) => setForm((c) => ({ ...c, expected_outcome: event.target.value }))} placeholder="What outcome does it produce for a technician?" aria-label="Expected outcome" data-testid="forge-outcome" />
          <Input value={form.permissions} onChange={(event) => setForm((c) => ({ ...c, permissions: event.target.value }))} placeholder="Permissions, comma separated (never a wildcard)" aria-label="Permissions" data-testid="forge-permissions" />
          <Input value={form.data_classes} onChange={(event) => setForm((c) => ({ ...c, data_classes: event.target.value }))} placeholder="Data classes read, comma separated" aria-label="Data classes" data-testid="forge-data-classes" />
          <Textarea rows={2} value={form.sandbox_plan} onChange={(event) => setForm((c) => ({ ...c, sandbox_plan: event.target.value }))} placeholder="Where is it proven before anyone depends on it?" aria-label="Sandbox plan" data-testid="forge-sandbox" />
          <Textarea rows={2} value={form.tests} onChange={(event) => setForm((c) => ({ ...c, tests: event.target.value }))} placeholder="Verification tests, one per line" aria-label="Verification tests" data-testid="forge-tests" />
          <Textarea rows={2} value={form.verification} onChange={(event) => setForm((c) => ({ ...c, verification: event.target.value }))} placeholder="How is the outcome verified for anything that changes state?" aria-label="Verification" data-testid="forge-verification" />
          <Textarea rows={2} value={form.rollback} onChange={(event) => setForm((c) => ({ ...c, rollback: event.target.value }))} placeholder="How is a published version withdrawn?" aria-label="Rollback" data-testid="forge-rollback" />
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="number"
              value={form.review_interval_days}
              onChange={(event) => setForm((c) => ({ ...c, review_interval_days: event.target.value }))}
              aria-label="Re-review interval in days"
              data-testid="forge-interval"
              className="w-32"
            />
            <span className="text-[10px] text-muted-foreground">days before this tool is re-reviewed</span>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={form.tenant_enforced}
              onChange={(event) => setForm((c) => ({ ...c, tenant_enforced: event.target.checked }))}
              className="h-3.5 w-3.5 accent-violet-500"
              data-testid="forge-tenant-enforced"
            />
            Every read and write is scoped server-side
          </label>
        </div>

        {formErrors.length > 0 && (
          <ul className="mt-2 space-y-1" data-testid="forge-form-errors">
            {formErrors.map((error) => <li key={error} className="text-[10px] text-rose-300">{error}</li>)}
          </ul>
        )}

        <Button className="mt-3 gap-1.5" onClick={submit} disabled={busy} data-testid="forge-submit">
          <ShieldCheck className="h-3.5 w-3.5" />Run the checks and specify
        </Button>
        <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
          The checks are the policy, not a score: a request that asks for privilege or credential material is refused here.
        </p>
      </div>

      {loading && !data && <p className="mt-3 text-[11px] text-muted-foreground">Reading the design record…</p>}

      {data && requests.length === 0 && (
        <p className="mt-3 rounded-lg border border-white/[0.07] bg-black/10 p-3 text-[11px] text-muted-foreground" data-testid="forge-empty">
          No Forge design has been requested yet. Nothing is published without a passing checklist, a recorded approval and
          a version with rollback retained.
        </p>
      )}

      <ul className="mt-3 space-y-2" data-testid="forge-requests">
        {requests.map((request) => {
          const stage = stagePresentation(request.stage);
          const verdict = verdictCopy(request);
          const counts = checkCounts(request.checks);
          const history = versionHistory(request);
          const open = openRequest === request.id;
          const blocked = blockingChecks(request.checks);
          return (
            <li key={request.id} className="rounded-xl border border-white/[0.07] bg-black/10 p-3" data-testid={`forge-request-${request.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={`text-[10px] ${stage.className}`} data-testid="forge-stage">{stage.label}</Badge>
                <Badge variant="outline" className={`text-[10px] ${verdict.className}`} data-testid="forge-verdict">{verdict.label}</Badge>
                <span className="text-[10px] text-muted-foreground">{kindPresentation(request.kind).label}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {counts.pass} pass · {counts.needs_review} to decide · {counts.fail} blocked
                </span>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-zinc-100">{request.title}</p>
              <p className="mt-1 text-[11px] leading-4 text-zinc-300">{request.verdict_reason}</p>
              <p className="mt-1 text-[10px] text-muted-foreground" data-testid="forge-lifecycle">{lifecycleCopy(request).detail}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(request.capabilities || []).map((capability) => (
                  <span key={capability.id} className="rounded-md border border-cyan-500/20 bg-cyan-500/[0.05] px-2 py-1 font-mono text-[10px] text-cyan-100">
                    {capability.id}
                  </span>
                ))}
                {(request.unresolved_capabilities || []).map((ref) => (
                  <span key={ref} className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-2 py-1 font-mono text-[10px] text-amber-100">
                    {ref} (not served)
                  </span>
                ))}
              </div>

              {open ? (
                <div className="mt-2 space-y-2">
                  <ul className="space-y-1.5" data-testid="forge-checks">
                    {(request.checks || []).map((check) => {
                      const status = checkStatus(check.status);
                      return (
                        <li key={check.id} className="rounded-lg border border-white/[0.07] bg-black/20 p-2.5" data-testid={`forge-check-${check.id}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className={`text-[10px] ${status.className}`}>{status.label}</Badge>
                            <span className="text-[11px] font-medium text-zinc-200">{check.label}</span>
                          </div>
                          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{check.detail}</p>
                        </li>
                      );
                    })}
                  </ul>

                  {request.stage !== "published" && (
                    <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-violet-400/40"
                          value={review.decision}
                          onChange={(event) => setReview((current) => ({ ...current, decision: event.target.value }))}
                          aria-label="Review decision"
                          data-testid="forge-review-decision"
                        >
                          <option value="approved">Approve</option>
                          <option value="changes_requested">Request changes</option>
                          <option value="rejected">Reject</option>
                        </select>
                        <Input
                          value={review.evidence_note}
                          onChange={(event) => setReview((current) => ({ ...current, evidence_note: event.target.value }))}
                          placeholder="Why this decision?"
                          aria-label="Review note"
                          data-testid="forge-review-note"
                          className="min-w-0 flex-1"
                        />
                        <Button size="sm" onClick={() => decide(request)} disabled={busy} data-testid="forge-review-submit">Record decision</Button>
                      </div>
                      {blocked.some((check) => check.status === "fail") && (
                        <p className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-4 text-rose-200" data-testid="forge-approval-blocked">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          A design whose checks failed cannot be approved. Fix the specification and submit a new one.
                        </p>
                      )}
                    </div>
                  )}

                  {["approved", "published"].includes(request.stage) && (
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={publish.version}
                          onChange={(event) => setPublish((current) => ({ ...current, version: event.target.value }))}
                          aria-label="Version"
                          data-testid="forge-publish-version"
                          className="w-24"
                        />
                        <Input
                          value={publish.evidence_note}
                          onChange={(event) => setPublish((current) => ({ ...current, evidence_note: event.target.value }))}
                          placeholder="What does this version change?"
                          aria-label="Publish note"
                          data-testid="forge-publish-note"
                          className="min-w-0 flex-1"
                        />
                        <Button size="sm" onClick={() => recordVersion(request)} disabled={busy} data-testid="forge-publish-submit">
                          Record version
                        </Button>
                      </div>
                      <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                        A version record is governance, not a deployment. {request.rollback}
                      </p>
                    </div>
                  )}

                  {history.length > 0 && (
                    <ul className="space-y-1" data-testid="forge-versions">
                      {history.map((version) => (
                        <li key={version.version} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.07] bg-black/20 px-2.5 py-1.5">
                          <span className="font-mono text-[11px] text-emerald-200">v{version.version}</span>
                          <span className="text-[10px] text-zinc-300">{version.note}</span>
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {version.supersedes ? `supersedes v${version.supersedes} · ` : ""}
                            {String(version.publishedAt).slice(0, 10)} · re-review every {version.reviewIntervalDays} day(s)
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {actionErrors.length > 0 && (
                    <ul className="space-y-1" data-testid="forge-action-errors">
                      {actionErrors.map((error) => <li key={error} className="text-[10px] text-rose-300">{error}</li>)}
                    </ul>
                  )}
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 border-violet-500/25 text-violet-100 hover:bg-violet-500/[0.08]"
                  onClick={() => {
                    setOpenRequest(request.id);
                    setReview({ decision: request.verdict === "pass" ? "approved" : "changes_requested", evidence_note: "" });
                    setPublish({ version: history[0] ? `${history[0].version}.1` : "1.0", evidence_note: "" });
                    setActionErrors([]);
                  }}
                  data-testid={`forge-open-${request.id}`}
                >
                  Open the checks and decisions
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {tools.length > 0 && (
        <div className="mt-3" data-testid="forge-tools">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recorded tool versions</p>
          <ul className="space-y-1.5">
            {tools.map((tool) => (
              <li key={tool.request_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.07] bg-black/10 p-2.5" data-testid={`forge-tool-${tool.request_id}`}>
                <span className="text-[11px] font-medium text-zinc-200">{tool.name}</span>
                <span className="font-mono text-[10px] text-emerald-200">v{tool.latest_version}</span>
                <span className="text-[10px] text-muted-foreground">{tool.version_count} version(s) · re-review every {tool.review_interval_days} day(s)</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {tool.review_due ? `Re-review due (${String(tool.next_review_at).slice(0, 10)})` : `Next review ${String(tool.next_review_at).slice(0, 10)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data?.boundary && <p className="mt-3 text-[10px] leading-4 text-muted-foreground" data-testid="forge-boundary">{data.boundary}</p>}
    </section>
  );
}
