import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Link2, Loader2, Mail, RefreshCw, ShieldCheck, Sparkles, UserPlus, XCircle } from "lucide-react";
import { toast } from "sonner";

function relativeTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Unknown time";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function LeadIntakeWorkspace({ canManage = false, onOpenLead }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/lead-studio/intake`, { headers });
      setItems(response.data?.items || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Lead Intake could not load");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const decide = async (item, action, extra = {}) => {
    if (!canManage) return;
    setProcessing(item.id);
    try {
      const response = await axios.post(`${API}/lead-studio/intake/${item.id}/process`, { action, ...extra }, { headers });
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      const leadId = response.data?.decision?.lead_id;
      toast.success(action === "dismiss" ? "Intake dismissed and retained in the audit trail" : "Lead Intake decision recorded");
      if (leadId && onOpenLead) onOpenLead(leadId);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Lead Intake decision failed");
    } finally {
      setProcessing(null);
    }
  };

  const matchedCount = items.filter((item) => (item.match_candidates || []).length > 0).length;
  return (
    <section className="space-y-4" data-testid="lead-intake-workspace">
      <Card className="overflow-hidden border-cyan-400/20 bg-[radial-gradient(circle_at_92%_0%,rgba(34,211,238,0.13),transparent_34%),linear-gradient(145deg,rgba(13,27,33,0.94),rgba(9,11,15,0.98))] p-0">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/[0.08]"><Mail className="h-5 w-5 text-cyan-200" /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200">Verified opportunity intake</p><Badge variant="outline" className="border-cyan-400/25 bg-cyan-400/[0.06] text-[9px] uppercase tracking-[0.15em] text-cyan-100">Human decision required</Badge></div>
              <h2 className="mt-1 text-lg font-semibold text-zinc-50">Lead Intake</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400">New enquiries wait here until a technician creates a prospect, links the correct record, or dismisses the message. Nothing silently becomes a client or service ticket.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 border-cyan-400/20 bg-cyan-400/[0.05]" onClick={load} disabled={loading}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        </div>
        <div className="grid border-t border-white/[0.08] sm:grid-cols-3">
          <IntakeMetric label="Needs review" value={items.length} icon={Sparkles} />
          <IntakeMetric label="Possible matches" value={matchedCount} icon={Link2} />
          <IntakeMetric label="Auto-conversion" value="Off" icon={ShieldCheck} />
        </div>
      </Card>

      {!canManage && <Card className="border-amber-400/20 bg-amber-400/[0.04] p-4 text-xs text-amber-100">You can review incoming opportunities, but a technician with lead-management permission must record an intake decision.</Card>}
      {loading ? <Card className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading lead intake…</Card> : items.length === 0 ? <EmptyIntake /> : <div className="space-y-3">{items.map((item) => <IntakeRow key={item.id} item={item} canManage={canManage} busy={processing === item.id} onDecide={decide} />)}</div>}
    </section>
  );
}

function IntakeMetric({ label, value, icon: Icon }) {
  return <div className="flex items-center gap-3 border-b border-white/[0.08] px-5 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><Icon className="h-4 w-4 text-cyan-200" /><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p><p className="mt-0.5 text-sm font-semibold text-zinc-100">{value}</p></div></div>;
}

function IntakeRow({ item, canManage, busy, onDecide }) {
  const candidate = (item.match_candidates || [])[0];
  const defaultCompany = item.sender_name && item.sender_name !== "Unknown" ? item.sender_name : item.sender_email?.split("@")[1]?.split(".")[0]?.replace(/[-_]/g, " ") || "New prospect";
  return <Card className="overflow-hidden border-white/[0.09] bg-zinc-950/55 p-0" data-testid={`lead-intake-row-${item.id}`}>
    <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-cyan-400/20 bg-cyan-400/[0.06] text-[9px] uppercase tracking-[0.13em] text-cyan-100">{item.source || "email"}</Badge><span className="text-[10px] text-zinc-500">{relativeTime(item.received_at)}</span>{item.mailbox && <span className="truncate text-[10px] text-zinc-500">via {item.mailbox}</span>}</div>
        <p className="mt-2 truncate text-sm font-semibold text-zinc-100">{item.subject || "No subject"}</p>
        <p className="mt-1 text-xs text-zinc-400">{item.sender_name || "Unknown sender"} <span className="text-zinc-600">·</span> {item.sender_email}</p>
        {item.body_preview && <p className="mt-3 line-clamp-2 max-w-3xl text-xs leading-5 text-zinc-500">{item.body_preview}</p>}
      </div>
      <div className="w-full shrink-0 lg:w-[300px]">
        {candidate ? <div className="rounded-lg border border-violet-400/20 bg-violet-400/[0.055] p-3"><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-violet-200">Likely existing record</p><p className="mt-1 truncate text-xs font-semibold text-zinc-100">{candidate.label}</p><p className="mt-0.5 text-[10px] text-zinc-400">{candidate.detail} · {candidate.confidence} confidence</p>{candidate.kind === "client" && <p className="mt-2 text-[10px] leading-4 text-amber-200/80">Client matches stay protected: review the client separately before creating any service work.</p>}</div> : <div className="rounded-lg border border-dashed border-white/[0.12] bg-white/[0.02] p-3 text-xs text-zinc-500">No existing lead match. Create a new prospect only after checking the enquiry is genuine.</div>}
      </div>
    </div>
    <div className="flex flex-wrap gap-2 border-t border-white/[0.07] bg-black/15 px-4 py-3">
      <Button size="sm" className="h-8 bg-emerald-600 text-[11px] hover:bg-emerald-500" disabled={!canManage || busy} onClick={() => onDecide(item, "create_lead", { company_name: defaultCompany })}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <UserPlus className="mr-1.5 h-3.5 w-3.5" />}Create lead</Button>
      {candidate?.kind === "lead" && <Button size="sm" variant="outline" className="h-8 border-violet-400/25 text-[11px] text-violet-100" disabled={!canManage || busy} onClick={() => onDecide(item, "link_existing", { lead_id: candidate.id })}><Link2 className="mr-1.5 h-3.5 w-3.5" />Link existing lead</Button>}
      <Button size="sm" variant="ghost" className="ml-auto h-8 text-[11px] text-zinc-400 hover:bg-rose-400/[0.08] hover:text-rose-200" disabled={!canManage || busy} onClick={() => onDecide(item, "dismiss", { reason: "Not a sales opportunity" })}><XCircle className="mr-1.5 h-3.5 w-3.5" />Dismiss</Button>
    </div>
  </Card>;
}

function EmptyIntake() {
  return <Card className="border-dashed border-white/[0.13] bg-zinc-950/35 p-10 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-emerald-300" /><p className="mt-3 text-sm font-semibold text-zinc-100">Intake is clear</p><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-zinc-500">When a connected mailbox receives an unmapped enquiry, Nexus will put it here for an accountable decision instead of creating a record in the background.</p></Card>;
}
