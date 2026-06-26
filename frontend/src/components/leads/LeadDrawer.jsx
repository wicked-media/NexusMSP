/* LeadDrawer.jsx — slide-in detail panel with tabs. Replaces the old dialog approach. */
import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  X, Mail, Phone, Globe, Building2, DollarSign, Sparkles, Ticket, GitMerge,
  Activity, Loader2, ChevronRight, AlertTriangle, CheckCircle2, FileText, Wand2, Trash2, ListTodo
} from "lucide-react";
import InitialsAvatar from "./InitialsAvatar";
import LeadScoreBadge from "./LeadScoreBadge";
import MergeLeadIntoTicketDialog from "./MergeLeadIntoTicketDialog";
import CreateTicketFromLeadDialog from "./CreateTicketFromLeadDialog";
import { STATUS_CONFIG, money, timeAgo } from "./leadHelpers";
import { toast } from "sonner";

export default function LeadDrawer({ leadId, onClose, onUpdated }) {
  const { token } = useAuth();
  const [lead, setLead] = useState(null);
  const [tab, setTab] = useState("overview");
  const [activities, setActivities] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [score, setScore] = useState(null);
  const [nba, setNba] = useState(null);
  const [draftEmail, setDraftEmail] = useState(null);
  const [draftingIntent, setDraftingIntent] = useState(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const loadAll = useCallback(async () => {
    if (!leadId) return;
    try {
      const [l, acts, ts, scores, action] = await Promise.all([
        axios.get(`${API}/leads/${leadId}`, { headers }),
        axios.get(`${API}/leads/${leadId}/activities`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/leads/${leadId}/tasks`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/lead-studio/score`, { headers }).catch(() => ({ data: { scores: [] } })),
        axios.get(`${API}/leads/${leadId}/next-best-action`, { headers }).catch(() => ({ data: null })),
      ]);
      setLead(l.data);
      setActivities(Array.isArray(acts.data) ? acts.data : (acts.data?.activities || []));
      setTasks(Array.isArray(ts.data) ? ts.data : (ts.data?.tasks || []));
      const sc = (scores.data?.scores || []).find(x => x.id === leadId);
      setScore(sc || null);
      setNba(action.data);
      // Touch
      axios.post(`${API}/lead-studio/${leadId}/touch`.replace("/lead-studio/", `/lead-studio/${leadId}/touch`).replace(`/lead-studio/${leadId}/touch/${leadId}/touch`, `/lead-studio/${leadId}/touch`), null, { headers }).catch(() => {});
      // Fetch linked tickets (if any)
      const linked = l.data?.linked_tickets || [];
      if (linked.length) {
        const fetched = await Promise.all(linked.map(tid => axios.get(`${API}/tickets/${tid}`, { headers }).then(r => r.data).catch(() => null)));
        setTickets(fetched.filter(Boolean));
      } else { setTickets([]); }
    } catch { toast.error("Failed to load lead"); }
    // eslint-disable-next-line
  }, [leadId, token]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // simpler touch
  useEffect(() => {
    if (leadId) axios.post(`${API}/lead-studio/${leadId}/touch`, null, { headers }).catch(() => {});
    // eslint-disable-next-line
  }, [leadId]);

  const draft = async (intent) => {
    setDraftingIntent(intent);
    try {
      const r = await axios.post(`${API}/leads/${leadId}/ai-draft-email`, { intent }, { headers });
      setDraftEmail(r.data);
      setTab("emails");
    } catch { toast.error("Failed to draft"); }
    finally { setDraftingIntent(null); }
  };

  const addTask = async (title) => {
    if (!title.trim()) return;
    try {
      const r = await axios.post(`${API}/leads/${leadId}/tasks`, { title, due_at: null }, { headers });
      setTasks(t => [...t, r.data]);
    } catch { toast.error("Failed"); }
  };

  const toggleTask = async (t) => {
    try {
      await axios.put(`${API}/lead-studio/tasks/${t.id}`, { completed: !t.completed }, { headers });
      setTasks(prev => prev.map(x => x.id === t.id ? { ...x, completed: !x.completed } : x));
    } catch { toast.error("Failed"); }
  };

  if (!leadId) return null;
  const cfg = STATUS_CONFIG[lead?.status] || STATUS_CONFIG.new;

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm" onClick={onClose} data-testid="lead-drawer-overlay" />
      <aside className="fixed right-0 top-0 bottom-0 z-[81] w-full sm:w-[640px] bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col" data-testid="lead-drawer">
        {!lead ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading lead…</div>
        ) : (
          <>
            <header className="px-4 py-3 border-b border-zinc-800 flex items-start gap-3">
              <InitialsAvatar name={lead.company_name} size={44} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-semibold text-zinc-100 truncate">{lead.company_name}</h2>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cfg.pill}`}>{cfg.label}</span>
                  {score && <LeadScoreBadge score={score.overall} sub={score} />}
                </div>
                <p className="text-xs text-zinc-400 truncate">
                  {lead.contact_name || "—"}{lead.title ? ` · ${lead.title}` : ""}
                </p>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-zinc-500">
                  {lead.estimated_value > 0 && <span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" />{money(lead.estimated_value)}</span>}
                  <span>{timeAgo(lead.last_activity_at || lead.updated_at)}</span>
                </div>
              </div>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200" data-testid="lead-drawer-close">
                <X className="w-5 h-5" />
              </button>
            </header>

            {nba && (
              <div className="px-4 py-2 bg-violet-500/5 border-b border-violet-500/20 flex items-start gap-2" data-testid="lead-drawer-nba">
                <Sparkles className="w-3.5 h-3.5 text-violet-300 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-violet-200">Next: {nba.label}</p>
                  <p className="text-[10px] text-zinc-400">{nba.reason}</p>
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider ${nba.urgency === "high" ? "bg-red-500/20 text-red-300" : nba.urgency === "medium" ? "bg-amber-500/20 text-amber-300" : "bg-zinc-500/20 text-zinc-400"}`}>{nba.urgency}</span>
              </div>
            )}

            <div className="px-4 py-2 flex flex-wrap gap-2 border-b border-zinc-800">
              <Button size="sm" className="h-7 text-[11px] bg-violet-600 hover:bg-violet-500" onClick={() => setCreateTicketOpen(true)} data-testid="drawer-create-ticket-btn">
                <Ticket className="w-3 h-3 mr-1" />Create ticket
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px] border-violet-500/40 text-violet-200 hover:bg-violet-500/10" onClick={() => setMergeOpen(true)} data-testid="drawer-merge-into-ticket-btn">
                <GitMerge className="w-3 h-3 mr-1" />Merge into ticket…
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => draft("follow_up")} disabled={draftingIntent != null} data-testid="drawer-ai-draft-followup">
                {draftingIntent === "follow_up" ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Wand2 className="w-3 h-3 mr-1" />}
                AI follow-up
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => draft("proposal_followup")} disabled={draftingIntent != null}>
                <Wand2 className="w-3 h-3 mr-1" />Nudge proposal
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => draft("winback")} disabled={draftingIntent != null}>
                <Wand2 className="w-3 h-3 mr-1" />Winback
              </Button>
            </div>

            <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
              <TabsList className="bg-transparent border-b border-zinc-800 rounded-none w-full justify-start gap-1 p-0 h-auto px-2">
                {[
                  { v: "overview", l: "Overview" },
                  { v: "activities", l: `Activity (${activities.length})` },
                  { v: "tasks", l: `Tasks (${tasks.length})` },
                  { v: "emails", l: "Emails" },
                  { v: "tickets", l: `Tickets (${tickets.length})` },
                ].map(t => (
                  <TabsTrigger key={t.v} value={t.v}
                    className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-violet-500 data-[state=active]:text-zinc-100 text-zinc-500 rounded-none py-2 px-2 text-[11px] uppercase tracking-wider"
                    data-testid={`drawer-tab-${t.v}`}>
                    {t.l}
                  </TabsTrigger>
                ))}
              </TabsList>
              <div className="flex-1 overflow-y-auto p-4">
                <TabsContent value="overview" className="m-0 space-y-3">
                  <Info icon={Mail} label="Email" value={lead.email} />
                  <Info icon={Phone} label="Phone" value={lead.phone} />
                  <Info icon={Globe} label="Website" value={lead.website} link />
                  <Info icon={Building2} label="Source" value={lead.source || "—"} />
                  {lead.notes && (
                    <Card className="p-2.5 bg-zinc-900/40 border-zinc-800/60">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Notes</p>
                      <p className="text-xs whitespace-pre-wrap text-zinc-200">{lead.notes}</p>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="activities" className="m-0 space-y-2">
                  {activities.length === 0 && <p className="text-xs text-zinc-500">No activities yet.</p>}
                  {activities.map(a => (
                    <Card key={a.id} className="p-2 bg-zinc-900/40 border-zinc-800/60" data-testid={`activity-${a.id}`}>
                      <div className="flex items-start gap-2">
                        <Activity className="w-3.5 h-3.5 text-violet-300 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-zinc-100 truncate">{a.title || a.description}</p>
                          <p className="text-[10px] text-zinc-500">{a.type} · {timeAgo(a.created_at)}{a.created_by_name ? ` · ${a.created_by_name}` : ""}</p>
                        </div>
                      </div>
                    </Card>
                  ))}
                </TabsContent>

                <TabsContent value="tasks" className="m-0 space-y-2">
                  <TaskForm onAdd={addTask} />
                  {tasks.length === 0 && <p className="text-xs text-zinc-500">No tasks yet.</p>}
                  {tasks.map(t => (
                    <div key={t.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-zinc-900/40" data-testid={`task-${t.id}`}>
                      <button onClick={() => toggleTask(t)} className={`w-4 h-4 rounded border flex items-center justify-center ${t.completed ? "bg-emerald-500/20 border-emerald-500/50" : "border-zinc-700"}`}>
                        {t.completed && <CheckCircle2 className="w-3 h-3 text-emerald-300" />}
                      </button>
                      <span className={`text-xs flex-1 ${t.completed ? "line-through text-zinc-500" : "text-zinc-200"}`}>{t.title}</span>
                      {t.due_at && <span className="text-[10px] text-zinc-500">{timeAgo(t.due_at)}</span>}
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="emails" className="m-0 space-y-2">
                  {!draftEmail && <p className="text-xs text-zinc-500">Use the AI buttons above to draft an email — follow-up, proposal nudge, or winback.</p>}
                  {draftEmail && (
                    <Card className="p-3 bg-zinc-900/40 border-violet-500/30" data-testid="drawer-draft-email">
                      <p className="text-[10px] uppercase tracking-wider text-violet-300 mb-1">Drafted · {draftEmail.intent}</p>
                      <p className="text-xs font-semibold text-zinc-100 mb-2">Subject: {draftEmail.subject}</p>
                      <pre className="text-xs whitespace-pre-wrap font-sans text-zinc-200 leading-relaxed">{draftEmail.body}</pre>
                      <div className="flex items-center gap-2 mt-3">
                        <Button size="sm" className="h-7 text-[11px] bg-emerald-600 hover:bg-emerald-500" onClick={() => { navigator.clipboard.writeText(`Subject: ${draftEmail.subject}\n\n${draftEmail.body}`); toast.success("Copied to clipboard"); }} data-testid="drawer-copy-email">
                          Copy to clipboard
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setDraftEmail(null)}>Discard</Button>
                      </div>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="tickets" className="m-0 space-y-2">
                  {tickets.length === 0 && <p className="text-xs text-zinc-500">No tickets linked to this lead yet. Use the buttons above to create or merge.</p>}
                  {tickets.map(t => (
                    <Card key={t.id} className="p-2 bg-zinc-900/40 border-zinc-800/60 hover:border-violet-500/40 cursor-pointer" onClick={() => window.open(`/tickets/${t.id}`, "_blank")} data-testid={`drawer-linked-ticket-${t.id}`}>
                      <div className="flex items-center gap-2">
                        <Ticket className="w-3.5 h-3.5 text-violet-300" />
                        <span className="text-[11px] font-mono text-violet-300">#{t.ticket_number || t.id?.slice(0, 8)}</span>
                        <span className="text-xs text-zinc-200 truncate">{t.title}</span>
                        <ChevronRight className="w-3 h-3 text-zinc-500 ml-auto" />
                      </div>
                    </Card>
                  ))}
                </TabsContent>
              </div>
            </Tabs>
          </>
        )}
      </aside>
      <MergeLeadIntoTicketDialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        lead={lead}
        onMerged={() => { loadAll(); onUpdated && onUpdated(); }}
      />
      <CreateTicketFromLeadDialog
        open={createTicketOpen}
        onClose={() => setCreateTicketOpen(false)}
        lead={lead}
        onCreated={() => { loadAll(); onUpdated && onUpdated(); }}
      />
    </>
  );
}

function Info({ icon: Icon, label, value, link }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
      <span className="text-zinc-500 w-20 flex-shrink-0">{label}</span>
      {link ? <a href={value.startsWith("http") ? value : `https://${value}`} target="_blank" rel="noreferrer" className="text-violet-300 hover:underline truncate">{value}</a>
            : <span className="text-zinc-200 truncate">{value}</span>}
    </div>
  );
}

function TaskForm({ onAdd }) {
  const [title, setTitle] = useState("");
  const submit = (e) => {
    e.preventDefault();
    if (title.trim()) { onAdd(title); setTitle(""); }
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-2 mb-2">
      <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Add task…" className="text-xs" data-testid="drawer-task-input" />
      <Button type="submit" size="sm" className="h-8 text-[11px]" data-testid="drawer-task-add"><ListTodo className="w-3 h-3" /></Button>
    </form>
  );
}
