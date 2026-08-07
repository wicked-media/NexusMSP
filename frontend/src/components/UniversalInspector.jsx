import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Activity, ArrowUpRight, Database, GitBranch, HeartPulse, Loader2, SearchCheck, ShieldAlert } from "lucide-react";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";

const routeFor = (object) => {
  const id = encodeURIComponent(object?.entity_id || "");
  const client = encodeURIComponent(object?.client_id || "");
  return ({
    client: `/clients?client=${id}`,
    device: `/devices/${id}`,
    ticket: `/tickets?ticket=${id}`,
    invoice: `/invoices?invoice=${id}`,
    contract: `/contracts?contract=${id}`,
    project: `/projects?project=${id}`,
    documentation: `/documentation-hub?tab=library&document=${id}`,
    user: `/control-plane?module=microsoft365&client=${client}`,
    service: `/services-subscriptions?client=${client}`,
    integration: `/integrations?client=${client}`,
  })[object?.entity_type] || `/clients?client=${client}`;
};

export default function UniversalInspector({ token }) {
  const navigate = useNavigate();
  const [objectRef, setObjectRef] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [story, setStory] = useState(null);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    const inspect = (event) => {
      const ref = event.detail?.objectRef || event.detail?.object_ref;
      if (!ref) return;
      setObjectRef(ref);
      setOpen(true);
    };
    window.addEventListener("nexus:inspect-object", inspect);
    return () => window.removeEventListener("nexus:inspect-object", inspect);
  }, []);

  useEffect(() => {
    if (!open || !objectRef) return undefined;
    let active = true;
    setLoading(true);
    axios.get(`${API}/core/objects/profile`, { headers, params: { object_ref: objectRef } })
      .then((response) => { if (active) setStory(response.data); })
      .catch((error) => {
        if (active) setStory(null);
        toast.error(error.response?.data?.detail || "Nexus Inspector could not load this object");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [headers, objectRef, open]);

  const inspectRelated = (ref) => {
    if (!ref) return;
    setObjectRef(ref);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="nx-ambient-surface w-full overflow-y-auto p-0 sm:max-w-xl" data-nx-signal={loading ? "working" : story?.health?.band || "calm"} data-testid="universal-inspector">
        <div className="border-b border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_35%)] p-6 pr-12">
          <SheetHeader>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300"><SearchCheck className="h-3.5 w-3.5" />Nexus universal inspector</div>
            <SheetTitle className="pt-1">{story?.object?.name || "Inspecting object"}</SheetTitle>
            <SheetDescription>One portable view of properties, health, trust, history, relationships, and source evidence.</SheetDescription>
          </SheetHeader>
        </div>

        {loading ? (
          <div className="flex min-h-80 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Assembling verified object context</div>
        ) : story ? (
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="capitalize">{story.object?.entity_type}</Badge>
              <Badge variant="outline" className={story.health?.band === "attention" ? "border-amber-400/30 text-amber-300" : story.health?.band === "healthy" ? "border-emerald-400/30 text-emerald-300" : ""}>{story.health?.label}</Badge>
              <Badge variant="outline" className="border-cyan-400/25 text-cyan-200">{story.confidence?.score}% evidence confidence</Badge>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-border/65 bg-background/35 p-3"><HeartPulse className="h-4 w-4 text-emerald-300" /><p className="mt-2 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Health</p><p className="mt-1 text-xs font-semibold">{story.health?.label}</p><p className="mt-1 text-[9px] leading-4 text-muted-foreground">{story.health?.reason}</p></div>
              <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.04] p-3"><Database className="h-4 w-4 text-cyan-300" /><p className="mt-2 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Trust</p><p className="mt-1 text-xs font-semibold capitalize">{story.confidence?.band}</p><p className="mt-1 text-[9px] leading-4 text-muted-foreground">Evidence coverage, not health.</p></div>
              <div className="rounded-xl border border-violet-400/20 bg-violet-500/[0.04] p-3"><ShieldAlert className="h-4 w-4 text-violet-300" /><p className="mt-2 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Impact</p><p className="mt-1 text-xs font-semibold">{story.business_impact?.known ? "Recorded" : "Unknown"}</p><p className="mt-1 line-clamp-2 text-[9px] leading-4 text-muted-foreground">{story.business_impact?.summary}</p></div>
            </div>

            <Button className="w-full gap-2" onClick={() => { setOpen(false); navigate(routeFor(story.object)); }}><ArrowUpRight className="h-4 w-4" />Open owning workspace</Button>

            <section className="rounded-2xl border border-border/65 bg-card/30 p-4">
              <div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">Object timeline</p><p className="mt-1 text-[10px] text-muted-foreground">This object's attributable history.</p></div><Badge variant="outline">{story.timeline_count || 0}</Badge></div>
              <div className="mt-3 space-y-2">
                {(story.timeline || []).slice(0, 8).map((event) => <button key={event.id} type="button" disabled={!event.route} onClick={() => { if (event.route) { setOpen(false); navigate(event.route); } }} className="w-full rounded-xl border border-border/55 bg-background/30 p-3 text-left disabled:cursor-default"><div className="flex gap-2"><Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" /><div className="min-w-0"><p className="truncate text-xs font-medium">{event.title}</p><p className="mt-1 truncate text-[9px] text-muted-foreground">{event.source} / {event.timestamp ? new Date(event.timestamp).toLocaleString() : "Time not recorded"}</p></div></div></button>)}
                {!story.timeline?.length && <div className="rounded-xl border border-dashed border-border px-4 py-7 text-center text-xs text-muted-foreground">No object-specific timeline evidence is recorded.</div>}
              </div>
            </section>

            <section className="rounded-2xl border border-border/65 bg-card/30 p-4">
              <div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">Relationships</p><p className="mt-1 text-[10px] text-muted-foreground">Select a related object without leaving the inspector.</p></div><Badge variant="outline">{story.relationship_count || 0}</Badge></div>
              <div className="mt-3 space-y-2">
                {(story.relationships || []).slice(0, 12).map((relationship) => <button key={relationship.id} type="button" onClick={() => inspectRelated(relationship.related?.ref)} className="w-full rounded-xl border border-border/55 bg-background/30 p-3 text-left transition hover:border-primary/30"><div className="flex items-start gap-2"><GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" /><div className="min-w-0"><p className="truncate text-xs font-medium">{relationship.related?.name || relationship.related?.ref}</p><p className="mt-1 text-[9px] capitalize text-muted-foreground">{relationship.relation_type?.replaceAll("_", " ")} / {relationship.related?.entity_type || "object"}</p><p className="mt-1 line-clamp-2 text-[9px] leading-4 text-muted-foreground">Evidence: {relationship.evidence || "Persisted Nexus relationship"}</p></div></div></button>)}
                {!story.relationships?.length && <div className="rounded-xl border border-dashed border-border px-4 py-7 text-center text-xs text-muted-foreground">No direct relationships are recorded.</div>}
              </div>
            </section>
          </div>
        ) : <div className="p-8 text-center text-sm text-muted-foreground">Select a canonical Nexus object to inspect it.</div>}
      </SheetContent>
    </Sheet>
  );
}
