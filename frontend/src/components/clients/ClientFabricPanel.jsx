import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import {
  Activity, Boxes, BrainCircuit, Building2, CheckCircle2, CircleDot, Cloud, Database, FileText,
  FolderKanban, Gem, GitBranch, HardDrive, Link2, Loader2, MapPin, Network, Radar,
  Receipt, RefreshCw, Search, ShieldAlert, Sparkles, Ticket, UserRound, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const ENTITY_VISUALS = {
  client: { icon: Building2, tone: "text-violet-300 border-violet-400/25 bg-violet-500/10" },
  site: { icon: MapPin, tone: "text-sky-300 border-sky-400/25 bg-sky-500/10" },
  contact: { icon: Users, tone: "text-cyan-300 border-cyan-400/25 bg-cyan-500/10" },
  user: { icon: UserRound, tone: "text-blue-300 border-blue-400/25 bg-blue-500/10" },
  device: { icon: HardDrive, tone: "text-emerald-300 border-emerald-400/25 bg-emerald-500/10" },
  service: { icon: Boxes, tone: "text-teal-300 border-teal-400/25 bg-teal-500/10" },
  contract: { icon: FileText, tone: "text-amber-300 border-amber-400/25 bg-amber-500/10" },
  ticket: { icon: Ticket, tone: "text-orange-300 border-orange-400/25 bg-orange-500/10" },
  project: { icon: FolderKanban, tone: "text-fuchsia-300 border-fuchsia-400/25 bg-fuchsia-500/10" },
  invoice: { icon: Receipt, tone: "text-rose-300 border-rose-400/25 bg-rose-500/10" },
  documentation: { icon: FileText, tone: "text-indigo-300 border-indigo-400/25 bg-indigo-500/10" },
  integration: { icon: Cloud, tone: "text-lime-300 border-lime-400/25 bg-lime-500/10" },
};

function visualFor(type) {
  return ENTITY_VISUALS[type] || { icon: CircleDot, tone: "text-muted-foreground border-border bg-muted/20" };
}

function statusLabel(status) {
  return String(status || "Recorded").replaceAll("_", " ");
}

function FabricMetric({ label, value, detail, tone = "text-foreground" }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/35 px-4 py-3">
      <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-xl font-semibold ${tone}`}>{value}</p>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function SourceBadge({ source }) {
  if (!source?.collection) return null;
  return (
    <Badge variant="outline" className="max-w-full border-border/60 bg-background/30 text-[9px] font-normal text-muted-foreground">
      <span className="truncate">{source.collection}</span>
    </Badge>
  );
}

export default function ClientFabricPanel({ clientId, clientName, token, API, isAdmin = false }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [memoryQuery, setMemoryQuery] = useState("");
  const [radiusRef, setRadiusRef] = useState(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextSaving, setContextSaving] = useState(false);
  const [contextForm, setContextForm] = useState({ from_ref: "", to_ref: "", purpose: "", business_process: "", requested_by: "", approval_evidence: "", decision_record: "" });
  const [activeType, setActiveType] = useState("all");
  const [selectedRef, setSelectedRef] = useState(null);
  const [objectStory, setObjectStory] = useState(null);
  const [objectStoryLoading, setObjectStoryLoading] = useState(false);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await axios.get(`${API}/core/clients/${encodeURIComponent(clientId)}/fabric`, { headers });
      setData(response.data);
      setSelectedRef((current) => current && response.data?.nodes?.some((node) => node.id === current) ? current : null);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus Fabric could not load");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [API, clientId, headers]);

  useEffect(() => { load(); }, [load]);

  const refreshFabric = async () => {
    setRefreshing(true);
    try {
      const response = await axios.post(`${API}/core/relationships/rebuild`, {}, { headers });
      await load({ quiet: true });
      toast.success(`Nexus Fabric refreshed: ${response.data?.entities || 0} objects and ${response.data?.relationships || 0} relationships indexed`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus Fabric refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const recordContext = async () => {
    if (!contextForm.from_ref || !contextForm.to_ref || contextForm.from_ref === contextForm.to_ref) return toast.info("Choose two different Nexus objects");
    if (contextForm.purpose.trim().length < 10 || contextForm.requested_by.trim().length < 2 || contextForm.approval_evidence.trim().length < 5) return toast.info("Record the purpose, requester, and approval evidence");
    setContextSaving(true);
    try {
      await axios.post(`${API}/core/context-relationships`, { client_id: clientId, ...contextForm }, { headers });
      await load({ quiet: true });
      setContextForm({ from_ref: "", to_ref: "", purpose: "", business_process: "", requested_by: "", approval_evidence: "", decision_record: "" });
      setContextOpen(false);
      toast.success("Approved context recorded and Nexus Fabric refreshed");
    } catch (error) {
      toast.error(error.response?.data?.detail || "The context relationship could not be recorded");
    } finally {
      setContextSaving(false);
    }
  };

  const filteredNodes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.nodes || []).filter((node) => {
      if (activeType !== "all" && node.entity_type !== activeType) return false;
      if (!needle) return true;
      const source = `${node.source?.collection || ""} ${node.source?.id || ""}`;
      const external = Object.values(node.external_refs || {}).join(" ");
      return `${node.name} ${node.entity_type} ${node.status || ""} ${source} ${external}`.toLowerCase().includes(needle);
    });
  }, [activeType, data?.nodes, query]);

  const selected = useMemo(
    () => (data?.nodes || []).find((node) => node.id === selectedRef) || null,
    [data?.nodes, selectedRef],
  );

  useEffect(() => {
    if (!selectedRef) {
      setObjectStory(null);
      return undefined;
    }
    let active = true;
    setObjectStoryLoading(true);
    axios.get(`${API}/core/objects/profile`, { headers, params: { object_ref: selectedRef } })
      .then((response) => { if (active) setObjectStory(response.data); })
      .catch((error) => {
        if (active) {
          setObjectStory(null);
          toast.error(error.response?.data?.detail || "Object story could not load");
        }
      })
      .finally(() => { if (active) setObjectStoryLoading(false); });
    return () => { active = false; };
  }, [API, headers, selectedRef]);

  const recalledMemories = useMemo(() => {
    const needle = memoryQuery.trim().toLowerCase();
    const items = data?.memory?.items || [];
    if (!needle) return items;
    const terms = needle.split(/\s+/).filter(Boolean);
    return items.filter((item) => terms.every((term) => item.search_text?.includes(term)));
  }, [data?.memory?.items, memoryQuery]);

  const activeRadius = useMemo(() => {
    const radii = data?.decision_lens?.radii || [];
    return radii.find((radius) => radius.id === radiusRef) || radii[0] || null;
  }, [data?.decision_lens?.radii, radiusRef]);

  if (loading) {
    return (
      <div className="flex min-h-80 items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card/30 text-sm text-muted-foreground" data-testid="client-fabric-loading">
        <Loader2 className="h-4 w-4 animate-spin" />Assembling verified client relationships
      </div>
    );
  }

  if (!data?.indexed) {
    return (
      <section className="overflow-hidden rounded-2xl border border-violet-400/20 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.12),transparent_38%),linear-gradient(135deg,rgba(9,9,11,0.96),rgba(24,24,27,0.72))]" data-testid="client-fabric-empty">
        <div className="flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-400/25 bg-violet-500/10 text-violet-300">
            <Network className="h-6 w-6" />
          </span>
          <h3 className="mt-5 text-lg font-semibold">Nexus Fabric has not been indexed</h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            The source records remain available, but Nexus will not draw relationship lines until the canonical index has been built.
          </p>
          {isAdmin ? (
            <Button className="mt-5 gap-2" onClick={refreshFabric} disabled={refreshing} data-testid="client-fabric-build">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Build verified fabric
            </Button>
          ) : (
            <p className="mt-5 text-xs text-amber-300">An administrator must build the Nexus Core relationship index.</p>
          )}
        </div>
      </section>
    );
  }

  const summary = data.summary || {};
  const clientNode = (data.nodes || []).find((node) => node.entity_type === "client");

  return (
    <div className="space-y-4" data-testid="client-fabric-panel">
      <section className="overflow-hidden rounded-2xl border border-violet-400/20 bg-[radial-gradient(circle_at_88%_4%,rgba(139,92,246,0.17),transparent_35%),radial-gradient(circle_at_8%_94%,rgba(34,211,238,0.08),transparent_34%),linear-gradient(135deg,rgba(9,9,11,0.98),rgba(24,24,27,0.78))] shadow-[0_24px_70px_rgba(0,0,0,0.18)]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-500/10 text-violet-300">
              <Network className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Nexus Fabric</p>
              <h3 className="mt-1 truncate text-lg font-semibold">{clientName || data.client?.name}</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                One evidence-backed map of the people, technology, service, commercial, and knowledge records connected to this client.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-emerald-400/25 bg-emerald-500/10 text-emerald-300">
              <CheckCircle2 className="mr-1 h-3 w-3" />Schema v{data.schema_version}
            </Badge>
            {isAdmin && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={refreshFabric} disabled={refreshing} data-testid="client-fabric-refresh">
                {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh fabric
              </Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 p-4 lg:grid-cols-5">
          <FabricMetric label="Objects" value={summary.objects || 0} detail="canonical records" />
          <FabricMetric label="Relationships" value={summary.relationships || 0} detail="source-backed links" tone="text-violet-300" />
          <FabricMetric label="Operational paths" value={summary.operational_threads || 0} detail="cross-object threads" tone="text-cyan-300" />
          <FabricMetric label="Relationship depth" value={`${summary.relationship_coverage_pct ?? 0}%`} detail="objects with cross-links" tone={summary.relationship_coverage_pct >= 70 ? "text-emerald-300" : "text-amber-300"} />
          <FabricMetric label="Needs attention" value={summary.attention_objects || 0} detail={`across ${summary.source_count || 0} sources`} tone={summary.attention_objects ? "text-amber-300" : "text-emerald-300"} />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[radial-gradient(circle_at_92%_8%,rgba(34,211,238,0.11),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.9),hsl(var(--background)/0.64))] shadow-sm" data-testid="client-operational-memory">
        <div className="grid gap-5 border-b border-border/60 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)] lg:items-end">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-300"><BrainCircuit className="h-5 w-5" /></span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Nexus operational memory</p>
                <Badge variant="outline" className="border-cyan-400/20 bg-cyan-500/[0.07] text-[9px] text-cyan-200">Evidence first</Badge>
              </div>
              <h3 className="mt-1 text-base font-semibold">What Nexus remembers about this client</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Retrieve prior service work, risks, documentation, and commercial context from the same verified relationship graph. Nexus explains why every memory appears.</p>
            </div>
          </div>
          <div>
            <label htmlFor="client-memory-search" className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Describe what you remember</label>
            <div className="relative">
              <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyan-300" />
              <Input id="client-memory-search" value={memoryQuery} onChange={(event) => setMemoryQuery(event.target.value)} className="h-10 border-cyan-400/20 bg-background/45 pl-9 pr-9 text-xs" placeholder="Try: VPN Fortinet, printer, closed ticket…" data-testid="client-memory-search" />
              {memoryQuery && <button type="button" onClick={() => setMemoryQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div className="grid gap-2 lg:grid-cols-2" data-testid="client-memory-results">
            {recalledMemories.slice(0, 8).map((memory) => (
              <article key={memory.id} className={`rounded-xl border p-4 ${memory.attention ? "border-amber-400/25 bg-amber-500/[0.05]" : "border-border/65 bg-background/30"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5"><Badge variant="outline" className="border-cyan-400/20 bg-cyan-500/[0.06] text-[9px] text-cyan-200">{memory.kind_label}</Badge><span className="text-[9px] uppercase tracking-[0.12em] text-emerald-300">{memory.confidence}</span></div>
                    <h4 className="mt-2 truncate text-sm font-semibold">{memory.headline}</h4>
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-[10px]" onClick={() => navigate(memory.route)}>Open <Link2 className="h-3 w-3" /></Button>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{memory.narrative}</p>
                {memory.facts?.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{memory.facts.slice(0, 4).map((fact) => <Badge key={`${memory.id}-${fact.label}`} variant="outline" className="border-border/60 bg-muted/15 text-[9px] font-normal"><span className="text-muted-foreground">{fact.label}:</span>&nbsp;{fact.value}</Badge>)}</div>}
                <div className="mt-3 rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-[9px] font-medium text-cyan-200"><Database className="h-3 w-3" />Why Nexus recalled this</p>
                  <p className="mt-1 text-[9px] leading-4 text-muted-foreground">{memory.why_recalled} {memory.evidence?.length || 0} evidence records available.</p>
                </div>
              </article>
            ))}
            {!recalledMemories.length && <div className="col-span-full rounded-xl border border-dashed border-border px-5 py-10 text-center"><BrainCircuit className="mx-auto h-7 w-7 text-muted-foreground/45" /><p className="mt-3 text-sm font-medium">No verified memory matches that description</p><p className="mt-1 text-xs text-muted-foreground">Try fewer words. Nexus will not invent a match without source evidence.</p></div>}
          </div>
          <aside className="rounded-xl border border-border/60 bg-background/25 p-4">
            <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">Memory ledger</p><Badge variant="outline">{data.memory?.items?.length || 0}</Badge></div>
            <div className="mt-3 space-y-2 text-[10px]">
              {Object.entries(data.memory?.counts || {}).map(([kind, count]) => <div key={kind} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/10 px-3 py-2"><span className="capitalize text-muted-foreground">{kind.replaceAll("_", " ")}</span><span className="font-mono font-semibold">{count}</span></div>)}
              <div className="flex items-center justify-between gap-3 rounded-lg border border-cyan-400/15 bg-cyan-500/[0.04] px-3 py-2"><span className="text-cyan-200">Evidence records</span><span className="font-mono font-semibold text-cyan-200">{data.memory?.evidence_count || 0}</span></div>
            </div>
            <div className="mt-4 space-y-2">{(data.memory?.principles || []).map((principle) => <p key={principle} className="flex gap-2 text-[9px] leading-4 text-muted-foreground"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-300" />{principle}</p>)}</div>
          </aside>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]" data-testid="client-decision-lens">
        <div className="overflow-hidden rounded-2xl border border-amber-400/20 bg-card/30 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-500/10 text-amber-300"><Radar className="h-5 w-5" /></span>
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">AI problem radius</p><h3 className="mt-1 text-base font-semibold">What else deserves checking?</h3><p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">Trace two relationship hops from an attention item without pretending that relationship equals causation.</p></div>
            </div>
            <Badge variant="outline" className="border-amber-400/20 bg-amber-500/[0.06] text-amber-200">{data.decision_lens?.attention_count || 0} attention roots</Badge>
          </div>
          {activeRadius ? (
            <div className="grid gap-4 p-4 lg:grid-cols-[230px_minmax(0,1fr)]">
              <div className="space-y-2">
                {(data.decision_lens?.radii || []).slice(0, 8).map((radius) => (
                  <button key={radius.id} type="button" onClick={() => setRadiusRef(radius.id)} className={`w-full rounded-xl border p-3 text-left transition ${activeRadius.id === radius.id ? "border-amber-400/30 bg-amber-500/[0.08]" : "border-border/60 bg-background/25 hover:border-amber-400/20"}`}>
                    <div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-medium">{radius.root.name}</span><span className="font-mono text-[10px] text-amber-300">{radius.direct_count + radius.extended_count}</span></div>
                    <p className="mt-1 truncate text-[9px] capitalize text-muted-foreground">{statusLabel(radius.root.status)} · {radius.root.entity_type}</p>
                  </button>
                ))}
              </div>
              <div className="rounded-xl border border-border/60 bg-background/25 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-300">Observed attention item</p><h4 className="mt-1 text-sm font-semibold">{activeRadius.root.name}</h4></div><Button size="sm" variant="outline" className="h-8 gap-1.5 text-[10px]" onClick={() => navigate(activeRadius.root.route)}>Validate source <Link2 className="h-3 w-3" /></Button></div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {activeRadius.related_objects.slice(0, 8).map((path) => {
                    const visual = visualFor(path.object.entity_type); const Icon = visual.icon;
                    return <button key={`${activeRadius.id}-${path.object.id}`} type="button" onClick={() => setSelectedRef(path.object.id)} className="rounded-xl border border-border/55 bg-muted/10 p-3 text-left hover:border-primary/25"><span className={`flex h-7 w-7 items-center justify-center rounded-lg border ${visual.tone}`}><Icon className="h-3 w-3" /></span><p className="mt-2 truncate text-[10px] font-medium">{path.object.name}</p><p className="mt-0.5 text-[8px] text-muted-foreground">{path.depth === 1 ? "Direct" : "Extended"} · {path.object.entity_type}</p></button>;
                  })}
                  {!activeRadius.related_objects.length && <p className="col-span-full rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">No cross-object relationships are recorded for this attention item.</p>}
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {[["What is happening?", activeRadius.questions.what], ["Why?", activeRadius.questions.why], ["What happens next?", activeRadius.questions.next], ["What should I do?", activeRadius.questions.should], ["Can Nexus do it?", activeRadius.questions.can]].map(([label, answer]) => <div key={label} className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2"><p className="text-[9px] font-medium text-foreground">{label}</p><p className="mt-1 text-[9px] leading-4 text-muted-foreground">{answer}</p></div>)}
                </div>
                <p className="mt-3 text-[9px] leading-4 text-amber-200/80">{activeRadius.disclaimer}</p>
              </div>
            </div>
          ) : <div className="p-8 text-center text-xs text-muted-foreground">No attention objects currently have a relationship radius to inspect.</div>}
        </div>

        <aside className="overflow-hidden rounded-2xl border border-violet-400/20 bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,246,0.16),transparent_42%),linear-gradient(180deg,hsl(var(--card)/0.9),hsl(var(--background)/0.55))] p-5 shadow-sm" data-testid="client-memory-crystal">
          <div className="flex items-start justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-500/10 text-violet-300"><Gem className="h-5 w-5" /></span><Badge variant="outline" className="capitalize">{data.knowledge_readiness?.band || "dim"}</Badge></div>
          <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Memory Crystal</p>
          <div className="mt-1 flex items-end gap-2"><span className="font-mono text-4xl font-semibold text-violet-200">{data.knowledge_readiness?.score ?? 0}</span><span className="pb-1 text-xs text-muted-foreground">/ 100 knowledge readiness</span></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted/30"><div className="h-full rounded-full bg-gradient-to-r from-violet-600 via-cyan-400 to-emerald-300 transition-all" style={{ width: `${data.knowledge_readiness?.score || 0}%` }} /></div>
          <p className="mt-3 text-[10px] leading-5 text-muted-foreground">{data.knowledge_readiness?.description}</p>
          <div className="mt-4 space-y-2">{(data.knowledge_readiness?.components || []).map((component) => <div key={component.label} className="rounded-lg border border-border/50 bg-background/25 px-3 py-2"><div className="flex items-center justify-between gap-2 text-[9px]"><span className="text-muted-foreground">{component.label}</span><span className="font-mono">{component.points}/{component.maximum}</span></div><div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted/30"><div className="h-full rounded-full bg-violet-400" style={{ width: `${Math.round(component.points / component.maximum * 100)}%` }} /></div></div>)}</div>
        </aside>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/30 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Relationship constellation</p>
            <p className="mt-1 text-xs text-muted-foreground">Choose a domain to narrow the fabric. Empty domains remain visible as honest coverage gaps.</p>
          </div>
          <button
            type="button"
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${activeType === "all" ? "border-violet-400/30 bg-violet-500/10 text-violet-200" : "border-border/70 bg-background/35 hover:border-violet-400/25"}`}
            onClick={() => setActiveType("all")}
            data-testid="client-fabric-all"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-400/25 bg-violet-500/10"><Building2 className="h-3.5 w-3.5" /></span>
            <span><span className="block text-xs font-semibold">{clientNode?.name || clientName}</span><span className="block text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Entire fabric</span></span>
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {(data.groups || []).filter((group) => group.entity_type !== "client").map((group) => {
            const visual = visualFor(group.entity_type);
            const Icon = visual.icon;
            const active = activeType === group.entity_type;
            return (
              <button
                key={group.entity_type}
                type="button"
                onClick={() => setActiveType(active ? "all" : group.entity_type)}
                className={`group rounded-xl border p-3 text-left transition ${active ? visual.tone : "border-border/65 bg-background/30 hover:border-primary/25 hover:bg-muted/25"}`}
                data-testid={`client-fabric-group-${group.entity_type}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${visual.tone}`}><Icon className="h-3.5 w-3.5" /></span>
                  <span className="font-mono text-lg font-semibold">{group.count}</span>
                </div>
                <p className="mt-2 truncate text-xs font-medium">{group.label}</p>
                <p className={`mt-0.5 text-[9px] ${group.attention_count ? "text-amber-300" : "text-muted-foreground"}`}>
                  {group.attention_count ? `${group.attention_count} need attention` : group.count ? `${group.relationship_count} link views` : "Not linked"}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid min-h-[560px] overflow-hidden rounded-2xl border border-border/70 bg-card/25 shadow-sm xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <div className="min-w-0 border-b border-border/70 xl:border-b-0 xl:border-r">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/10 px-4 py-3">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 pl-9 pr-9 text-xs" placeholder="Search objects, sources, IDs, status…" data-testid="client-fabric-search" />
              {query && <button type="button" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
            </div>
            <span className="text-[10px] text-muted-foreground">{filteredNodes.length} of {data.nodes?.length || 0} objects</span>
          </div>
          <div className="max-h-[650px] divide-y divide-border/55 overflow-y-auto" data-testid="client-fabric-node-list">
            {filteredNodes.length ? filteredNodes.map((node) => {
              const visual = visualFor(node.entity_type);
              const Icon = visual.icon;
              const active = selectedRef === node.id;
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelectedRef(active ? null : node.id)}
                  className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition ${active ? "bg-violet-500/[0.09]" : "hover:bg-muted/20"}`}
                  data-testid={`client-fabric-node-${node.entity_type}-${node.entity_id}`}
                >
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl border ${visual.tone}`}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2"><span className="truncate text-sm font-medium">{node.name}</span>{node.attention && <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-300" />}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="capitalize">{node.entity_type}</span><span>•</span><span className="capitalize">{statusLabel(node.status)}</span><span>•</span><span>{node.relationship_count} relationships</span>
                    </span>
                  </span>
                  <SourceBadge source={node.source} />
                </button>
              );
            }) : (
              <div className="px-6 py-16 text-center">
                <Search className="mx-auto h-7 w-7 text-muted-foreground/45" />
                <p className="mt-3 text-sm font-medium">No matching objects</p>
                <p className="mt-1 text-xs text-muted-foreground">Clear the search or choose the entire fabric.</p>
              </div>
            )}
          </div>
        </div>

        <aside className="min-w-0 bg-background/18">
          {selected ? (
            <div data-testid="client-fabric-inspector">
              <div className="border-b border-border/70 p-5">
                <div className="flex items-start gap-3">
                  {(() => { const visual = visualFor(selected.entity_type); const Icon = visual.icon; return <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${visual.tone}`}><Icon className="h-5 w-5" /></span>; })()}
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-primary">{selected.entity_type} relationship</p>
                    <h4 className="mt-1 truncate text-base font-semibold">{selected.name}</h4>
                    <div className="mt-2 flex flex-wrap gap-1.5"><Badge variant="outline" className={selected.attention ? "border-amber-400/30 text-amber-300" : "border-emerald-400/25 text-emerald-300"}>{statusLabel(selected.status)}</Badge><SourceBadge source={selected.source} /></div>
                  </div>
                </div>
                <Button size="sm" className="mt-4 w-full gap-2" onClick={() => navigate(selected.route)} data-testid="client-fabric-open-source">
                  <Link2 className="h-3.5 w-3.5" />Open in owning workspace
                </Button>
                <Button size="sm" variant="outline" className="mt-2 w-full gap-2" onClick={() => window.dispatchEvent(new CustomEvent("nexus:inspect-object", { detail: { objectRef: selected.id } }))} data-testid="client-fabric-open-universal-inspector">
                  <Search className="h-3.5 w-3.5" />Open universal inspector
                </Button>
              </div>
              <div className="border-b border-border/70 p-5" data-testid="client-fabric-object-story">
                <div className="flex items-center justify-between gap-2">
                  <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">Object story</p><p className="mt-1 text-xs text-muted-foreground">Health, trust, impact, and history from the same evidence contract.</p></div>
                  {objectStoryLoading && <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />}
                </div>
                {objectStory && (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className={`rounded-xl border p-3 ${objectStory.health?.band === "attention" ? "border-amber-400/25 bg-amber-500/[0.05]" : objectStory.health?.band === "healthy" ? "border-emerald-400/25 bg-emerald-500/[0.05]" : "border-border/60 bg-background/25"}`}>
                        <p className="text-[8px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Health</p>
                        <p className="mt-1 text-xs font-semibold">{objectStory.health?.label}</p>
                        <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-muted-foreground">{objectStory.health?.reason}</p>
                      </div>
                      <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.04] p-3">
                        <p className="text-[8px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Evidence confidence</p>
                        <p className="mt-1 text-xs font-semibold capitalize text-cyan-200">{objectStory.confidence?.band} / {objectStory.confidence?.score}%</p>
                        <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-muted-foreground">Confidence is coverage, not health.</p>
                      </div>
                    </div>
                    <div className={`mt-2 rounded-xl border p-3 ${objectStory.business_impact?.known ? "border-violet-400/20 bg-violet-500/[0.04]" : "border-border/60 bg-background/25"}`}>
                      <div className="flex items-center justify-between gap-2"><p className="text-[8px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Business impact</p><Badge variant="outline" className="text-[8px]">{objectStory.business_impact?.known ? "Recorded" : "Unknown"}</Badge></div>
                      <p className="mt-1 text-[9px] leading-4 text-muted-foreground">{objectStory.business_impact?.summary}</p>
                    </div>
                    <div className="mt-4">
                      <div className="flex items-center justify-between gap-2"><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">Recent object timeline</p><Badge variant="outline" className="text-[8px]">{objectStory.timeline_count || 0}</Badge></div>
                      <div className="mt-2 space-y-2">
                        {(objectStory.timeline || []).slice(0, 5).map((event) => (
                          <button key={event.id} type="button" onClick={() => event.route && navigate(event.route)} disabled={!event.route} className="w-full rounded-lg border border-border/55 bg-muted/10 px-3 py-2 text-left disabled:cursor-default">
                            <div className="flex items-start gap-2"><Activity className="mt-0.5 h-3 w-3 shrink-0 text-cyan-300" /><div className="min-w-0"><p className="truncate text-[10px] font-medium">{event.title}</p><p className="mt-0.5 truncate text-[8px] text-muted-foreground">{event.source} / {event.timestamp ? new Date(event.timestamp).toLocaleString() : "Time not recorded"}</p></div></div>
                          </button>
                        ))}
                        {!objectStory.timeline?.length && <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[9px] text-muted-foreground">No object-specific timeline evidence is recorded yet.</div>}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Direct relationships</p><p className="mt-1 text-xs text-muted-foreground">Each link includes its source evidence.</p></div>
                  <Badge variant="outline">{selected.relationships.length}</Badge>
                </div>
                <div className="mt-4 max-h-[470px] space-y-2 overflow-y-auto pr-1">
                  {selected.relationships.length ? selected.relationships.map((relationship) => {
                    const visual = visualFor(relationship.related.entity_type);
                    const Icon = visual.icon;
                    return (
                      <button
                        key={`${relationship.id}-${relationship.direction}`}
                        type="button"
                        onClick={() => setSelectedRef(relationship.related.id)}
                        className="w-full rounded-xl border border-border/65 bg-background/30 p-3 text-left transition hover:border-primary/25 hover:bg-primary/[0.04]"
                      >
                        <div className="flex items-start gap-2.5">
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${visual.tone}`}><Icon className="h-3.5 w-3.5" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{relationship.related.name}</span>
                            <span className="mt-0.5 block text-[9px] capitalize text-muted-foreground">{relationship.direction} • {relationship.label} • {relationship.related.entity_type}</span>
                          </span>
                          {relationship.related.attention && <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-300" />}
                        </div>
                        <div className="mt-2 rounded-lg border border-border/50 bg-muted/10 px-2.5 py-2 text-[9px] leading-4 text-muted-foreground">
                          Evidence: {relationship.evidence}
                        </div>
                        {relationship.context?.purpose && <div className="mt-2 rounded-lg border border-violet-400/20 bg-violet-500/[0.05] px-2.5 py-2 text-[9px] leading-4"><p className="font-medium text-violet-200">Why this relationship exists</p><p className="mt-1 text-muted-foreground">{relationship.context.purpose}</p>{relationship.context.business_process && <p className="mt-1 text-muted-foreground">Business process: {relationship.context.business_process}</p>}<p className="mt-1 text-muted-foreground">Requested by {relationship.context.requested_by || "not recorded"} · approved by {relationship.context.approved_by || "not recorded"}</p><p className="mt-1 text-muted-foreground">Approval evidence: {relationship.context.approval_evidence}</p></div>}
                      </button>
                    );
                  }) : (
                    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">No persisted direct relationships are recorded for this object.</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[560px] flex-col justify-between p-5" data-testid="client-fabric-principles">
              <div>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-300"><GitBranch className="h-5 w-5" /></span>
                <h4 className="mt-4 text-base font-semibold">Select an object to trace it</h4>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">Inspect everything directly connected to the object, why Nexus linked it, and which workspace owns the source record.</p>
                <div className="mt-5 space-y-2">
                  {(data.principles || []).map((principle) => (
                    <div key={principle} className="flex gap-2 rounded-xl border border-border/60 bg-background/25 p-3 text-xs leading-5 text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />{principle}
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-6 rounded-xl border border-violet-400/20 bg-violet-500/[0.06] p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-violet-200"><Activity className="h-3.5 w-3.5" />Why this matters</div>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">A ticket can lead to its device, a service to its contract, an invoice to its work, and documentation to the object it describes—without the technician guessing.</p>
              </div>
            </div>
          )}
        </aside>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/25 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Verified operational threads</p><p className="mt-1 text-xs text-muted-foreground">Cross-object links beyond simple client ownership.</p></div>
          <div className="flex items-center gap-2"><Badge variant="outline">{data.threads?.length || 0}</Badge>{isAdmin && <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[10px]" onClick={() => setContextOpen((value) => !value)}><GitBranch className="h-3.5 w-3.5" />Record context</Button>}</div>
        </div>
        {contextOpen && <div className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-500/[0.035] p-4" data-testid="context-relationship-form">
          <div><p className="text-sm font-semibold">Explain why two records belong together</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">This creates an approved, auditable source record. It does not overwrite either object or invent a technical dependency.</p></div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div><label className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">From object</label><select value={contextForm.from_ref} onChange={(event) => setContextForm((current) => ({ ...current, from_ref: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs" data-testid="context-from"><option value="">Select canonical object</option>{(data.nodes || []).map((node) => <option key={`from-${node.id}`} value={node.id}>{node.entity_type} · {node.name}</option>)}</select></div>
            <div><label className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">To object</label><select value={contextForm.to_ref} onChange={(event) => setContextForm((current) => ({ ...current, to_ref: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs" data-testid="context-to"><option value="">Select canonical object</option>{(data.nodes || []).map((node) => <option key={`to-${node.id}`} value={node.id}>{node.entity_type} · {node.name}</option>)}</select></div>
            <div className="md:col-span-2"><label className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Operational purpose</label><Textarea value={contextForm.purpose} onChange={(event) => setContextForm((current) => ({ ...current, purpose: event.target.value }))} rows={3} placeholder="Why does this relationship exist, and what decision does it preserve?" data-testid="context-purpose" /></div>
            <div><label className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Business process</label><Input value={contextForm.business_process} onChange={(event) => setContextForm((current) => ({ ...current, business_process: event.target.value }))} placeholder="Payroll, remote work, customer communications…" /></div>
            <div><label className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Requested by</label><Input value={contextForm.requested_by} onChange={(event) => setContextForm((current) => ({ ...current, requested_by: event.target.value }))} placeholder="Person, client contact, meeting, or project" /></div>
            <div><label className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Approval evidence</label><Input value={contextForm.approval_evidence} onChange={(event) => setContextForm((current) => ({ ...current, approval_evidence: event.target.value }))} placeholder="Change CHG-123, meeting 2 Aug, ticket approval…" data-testid="context-evidence" /></div>
            <div><label className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Decision record</label><Input value={contextForm.decision_record} onChange={(event) => setContextForm((current) => ({ ...current, decision_record: event.target.value }))} placeholder="Optional ticket, change, document, or meeting reference" /></div>
          </div>
          <div className="mt-4 flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setContextOpen(false)}>Cancel</Button><Button size="sm" onClick={recordContext} disabled={contextSaving}>{contextSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}Record approved context</Button></div>
        </div>}
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {(data.threads || []).slice(0, 12).map((thread) => (
            <button key={thread.id} type="button" onClick={() => setSelectedRef(thread.from.id)} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl border border-border/65 bg-background/25 p-3 text-left transition hover:border-primary/25">
              <span className="min-w-0"><span className="block truncate text-xs font-medium">{thread.from.name}</span><span className="text-[9px] capitalize text-muted-foreground">{thread.from.entity_type}</span></span>
              <span className="flex flex-col items-center gap-1 text-[9px] text-primary"><GitBranch className="h-3.5 w-3.5" />{thread.label}</span>
              <span className="min-w-0 text-right"><span className="block truncate text-xs font-medium">{thread.to.name}</span><span className="text-[9px] capitalize text-muted-foreground">{thread.to.entity_type}</span></span>
            </button>
          ))}
          {!data.threads?.length && <div className="col-span-full rounded-xl border border-dashed border-border px-5 py-8 text-center text-xs text-muted-foreground">No cross-object relationship threads are indexed for this client yet.</div>}
        </div>
      </section>
    </div>
  );
}
