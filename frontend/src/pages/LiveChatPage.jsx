import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MessageSquare, Send, X, Ticket, Search, Zap, ArrowRightLeft, Users, Inbox,
  UserCheck, Clock, AlertTriangle, Plus, Trash2, Building2, HardDrive, ChevronRight
} from "lucide-react";
import { toast } from "sonner";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";

export default function LiveChatPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [context, setContext] = useState({});
  const [newMsg, setNewMsg] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stats, setStats] = useState({});
  const [canned, setCanned] = useState([]);
  const [agents, setAgents] = useState([]);
  const [transferDialog, setTransferDialog] = useState(false);
  const [transferAgent, setTransferAgent] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [showCanned, setShowCanned] = useState(false);
  const [manageCanned, setManageCanned] = useState(false);
  const [newCanned, setNewCanned] = useState({ shortcut: "", title: "", content: "" });
  const [typingUsers, setTypingUsers] = useState([]);
  const [creatingTicket, setCreatingTicket] = useState(false);
  const messagesEndRef = useRef(null);
  const typingAtRef = useRef(0);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchSessions = async () => {
    const params = {};
    if (search) params.search = search;
    if (statusFilter !== "all") params.status = statusFilter;
    try {
      const r = await axios.get(`${API}/live-chat/sessions`, { headers, params });
      setSessions(r.data || []);
    } catch {}
  };
  const fetchStats = async () => {
    try { const r = await axios.get(`${API}/live-chat/stats`, { headers }); setStats(r.data); } catch {}
  };
  const fetchCanned = async () => {
    try { const r = await axios.get(`${API}/live-chat/canned-responses`, { headers }); setCanned(r.data || []); } catch {}
  };
  const fetchAgents = async () => {
    try { const r = await axios.get(`${API}/live-chat/agents`, { headers }); setAgents(r.data || []); } catch {}
  };

  useEffect(() => { fetchSessions(); fetchStats(); fetchCanned(); fetchAgents(); }, []); // eslint-disable-line
  useEffect(() => { fetchSessions(); }, [search, statusFilter]); // eslint-disable-line
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    const sessionId = searchParams.get("session");
    if (sessionId) loadSession(sessionId);
  }, [searchParams]); // eslint-disable-line

  // Periodic poll for active session
  useEffect(() => {
    if (!activeSession) return;
    const t = setInterval(async () => {
      try {
        const { data } = await axios.get(`${API}/live-chat/sessions/${activeSession.id}`, { headers });
        if (data.messages?.length !== messages.length) setMessages(data.messages);
        const typing = await axios.get(`${API}/live-chat/sessions/${activeSession.id}/typing`, { headers });
        setTypingUsers(typing.data?.typing_users || []);
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, [activeSession, messages.length]); // eslint-disable-line

  const loadSession = async (sessionId) => {
    try {
      const { data } = await axios.get(`${API}/live-chat/sessions/${sessionId}`, { headers });
      setActiveSession(data.session);
      setMessages(data.messages || []);
      setContext(data.context || {});
      fetchSessions();
      fetchStats();
    } catch { toast.error("Failed to load session"); }
  };

  const sendMessage = async () => {
    if (!newMsg.trim() || !activeSession) return;
    const shortcut = canned.find(response => response.shortcut?.toLowerCase() === newMsg.trim().toLowerCase());
    const content = shortcut ? resolveCanned(shortcut) : newMsg.trim();
    try {
      const { data } = await axios.post(
        `${API}/live-chat/sessions/${activeSession.id}/messages`,
        { content },
        { headers }
      );
      setMessages(prev => [...prev, data]);
      setNewMsg("");
      setTypingUsers([]);
    } catch { toast.error("Failed to send"); }
  };

  const refreshTyping = async (typing = true) => {
    if (!activeSession || activeSession.status === "closed") return;
    try {
      const { data } = await axios.post(`${API}/live-chat/sessions/${activeSession.id}/typing`, { typing }, { headers });
      setTypingUsers(data.typing_users || []);
    } catch {}
  };

  const onComposerChange = (value) => {
    setNewMsg(value.slice(0, 5000));
    if (value.trim() && Date.now() - typingAtRef.current > 2000) {
      typingAtRef.current = Date.now();
      refreshTyping(true);
    }
    if (!value.trim()) refreshTyping(false);
  };

  const closeSession = async () => {
    if (!activeSession) return;
    if (!window.confirm("Close this chat session?")) return;
    try {
      await axios.post(`${API}/live-chat/sessions/${activeSession.id}/close`, {}, { headers });
      toast.success("Session closed");
      setActiveSession(null);
      setMessages([]);
      fetchSessions(); fetchStats();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to close session");
    }
  };

  const createTicket = async () => {
    if (!activeSession || creatingTicket) return;
    setCreatingTicket(true);
    try {
      const { data } = await axios.post(
        `${API}/live-chat/sessions/${activeSession.id}/create-ticket`,
        {},
        { headers }
      );
      toast.success("Ticket created and linked to this chat");
      // Update active session to show ticket
      setActiveSession(prev => ({ ...prev, ticket_id: data.ticket_id }));
    } catch { toast.error("Failed to create ticket"); }
    finally { setCreatingTicket(false); }
  };

  const transferSession = async () => {
    if (!activeSession || !transferAgent) return;
    try {
      await axios.post(
        `${API}/live-chat/sessions/${activeSession.id}/transfer`,
        { agent_id: transferAgent, note: transferNote },
        { headers }
      );
      toast.success("Session transferred");
      setTransferDialog(false);
      setTransferAgent(""); setTransferNote("");
      loadSession(activeSession.id);
    } catch (e) { toast.error(e.response?.data?.detail || "Transfer failed"); }
  };

  const insertCanned = (response) => {
    const content = resolveCanned(response);
    setNewMsg(prev => prev + (prev ? " " : "") + content);
    setShowCanned(false);
  };

  const resolveCanned = (response) => String(response?.content || "")
    .replace("{visitor}", activeSession?.visitor_name || "there")
    .replace("{eta}", "2 business hours");

  const cannedSuggestions = newMsg.trim().startsWith("/")
    ? canned.filter(response => response.shortcut?.toLowerCase().startsWith(newMsg.trim().toLowerCase())).slice(0, 4)
    : [];

  const saveCanned = async () => {
    if (!newCanned.shortcut || !newCanned.content) return toast.error("Shortcut and content required");
    try {
      await axios.post(`${API}/live-chat/canned-responses`, newCanned, { headers });
      setNewCanned({ shortcut: "", title: "", content: "" });
      fetchCanned();
      toast.success("Canned response saved");
    } catch { toast.error("Failed to save"); }
  };

  const deleteCanned = async (id) => {
    if (!window.confirm("Delete this canned response?")) return;
    await axios.delete(`${API}/live-chat/canned-responses/${id}`, { headers });
    fetchCanned();
  };

  const priorityColor = (p) => ({
    urgent: "bg-red-500/15 text-red-400 border-red-500/30",
    high: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    normal: "bg-muted text-muted-foreground",
    low: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  }[p] || "bg-muted");

  return (
    <PageShell data-testid="live-chat-page">
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-950/35 via-[#171c24] to-emerald-950/25 px-5 py-5 shadow-lg shadow-black/10 flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-500/10"><MessageSquare className="h-5 w-5 text-cyan-200" /></span><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Client communication</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Live Chat</h1></div></div>
          <p className="text-xs text-zinc-500 mt-0.5">Real-time chat with clients · queue · transfer · canned responses</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setManageCanned(true)} data-testid="manage-canned-btn">
            <Zap className="w-3 h-3 mr-1" />Canned Responses ({canned.length})
          </Button>
        </div>
      </div>

      <MetricStrip columns={5}>
        <MetricTile label="Active" value={stats.active || 0} accent="sky" icon={<Inbox className="w-2.5 h-2.5 text-sky-400" />} testid="livechat-metric-active" />
        <MetricTile label="Assigned to Me" value={stats.mine || 0} accent="emerald" icon={<UserCheck className="w-2.5 h-2.5 text-emerald-400" />} testid="livechat-metric-mine" />
        <MetricTile label="Unassigned" value={stats.unassigned || 0} accent="amber" icon={<AlertTriangle className="w-2.5 h-2.5 text-amber-400" />} testid="livechat-metric-unassigned" />
        <MetricTile label="Messages Today" value={stats.messages_today || 0} accent="cyan" icon={<MessageSquare className="w-2.5 h-2.5 text-cyan-400" />} testid="livechat-metric-today" />
        <MetricTile label="Closed (total)" value={stats.closed || 0} accent="slate" icon={<Clock className="w-2.5 h-2.5 text-zinc-400" />} testid="livechat-metric-closed" />
      </MetricStrip>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[640px]">
        {/* Queue */}
        <Card className="lg:col-span-3 flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" />Queue</CardTitle>
            <div className="space-y-2 mt-2">
              <div className="relative">
                <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search sessions…" className="pl-7 h-8 text-xs" data-testid="chat-search" />
              </div>
              <Tabs value={statusFilter} onValueChange={setStatusFilter}>
                <TabsList className="w-full h-7">
                  <TabsTrigger value="all" className="text-[11px]">All</TabsTrigger>
                  <TabsTrigger value="active" className="text-[11px]">Active</TabsTrigger>
                  <TabsTrigger value="closed" className="text-[11px]">Closed</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-2">
            <ScrollArea className="h-full">
              {sessions.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">No sessions found</p>
              ) : (
                <div className="space-y-1.5">
                  {sessions.map(s => (
                    <div
                      key={s.id}
                      onClick={() => loadSession(s.id)}
                      className={`p-2.5 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors ${activeSession?.id === s.id ? "border-primary bg-primary/5" : ""} ${s.unread_count > 0 ? "border-l-2 border-l-emerald-400" : ""}`}
                      data-testid={`chat-session-${s.id}`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-semibold truncate">{s.visitor_name}</span>
                        <div className="flex items-center gap-1">
                          {s.unread_count > 0 && <Badge className="h-4 px-1 text-[9px] bg-emerald-500 text-white border-0">{s.unread_count}</Badge>}
                          <Badge variant="outline" className={`text-[9px] capitalize ${s.status === "closed" ? "opacity-60" : ""}`}>{s.status}</Badge>
                        </div>
                      </div>
                      {s.client_name && <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1"><Building2 className="w-2.5 h-2.5" />{s.client_name}</p>}
                      {s.last_message && <p className="text-[10px] text-muted-foreground truncate italic mt-0.5">{s.last_message}</p>}
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[9px] text-muted-foreground">{s.last_message_at ? new Date(s.last_message_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ""}</span>
                        {s.priority && s.priority !== "normal" && <Badge className={`text-[9px] ${priorityColor(s.priority)}`}>{s.priority}</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Chat panel */}
        <Card className="lg:col-span-6 flex flex-col">
          {activeSession ? (
            <>
              <CardHeader className="pb-2 border-b">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base flex items-center gap-2">
                      {activeSession.visitor_name}
                      {activeSession.priority && activeSession.priority !== "normal" && <Badge className={`text-[10px] ${priorityColor(activeSession.priority)}`}>{activeSession.priority}</Badge>}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground truncate">
                      {activeSession.client_name || "Walk-in"} · {activeSession.subject || "No subject"} · Assigned: {activeSession.assigned_name || "—"}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => setTransferDialog(true)} disabled={activeSession.status === "closed"} data-testid="transfer-btn">
                      <ArrowRightLeft className="w-3 h-3 mr-1" />Transfer
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => activeSession.ticket_id ? navigate(`/tickets?ticket=${activeSession.ticket_id}`) : createTicket()} disabled={creatingTicket} data-testid="create-ticket-from-chat">
                      <Ticket className="w-3 h-3 mr-1" />{activeSession.ticket_id ? "Open ticket" : creatingTicket ? "Creating…" : "Create ticket"}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={closeSession} disabled={activeSession.status === "closed"} data-testid="close-chat">
                      <X className="w-3 h-3 mr-1" />Close
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col p-0">
                <ScrollArea className="flex-1 px-4 py-3">
                  <div className="space-y-3">
                    {messages.map(m => (
                      m.sender_type === "system" ? (
                        <div key={m.id} className="text-center text-[10px] text-muted-foreground italic py-1" data-testid={`msg-${m.id}`}>— {m.content} —</div>
                      ) : (
                        <div key={m.id} className={`flex ${m.sender_type === "agent" ? "justify-end" : "justify-start"}`} data-testid={`msg-${m.id}`}>
                          <div className={`max-w-[75%] p-2.5 rounded-lg ${m.sender_type === "agent" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                            <p className="text-[10px] font-medium mb-0.5 opacity-80">{m.sender_name}</p>
                            <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                            <p className="text-[9px] opacity-60 mt-1">{new Date(m.sent_at).toLocaleTimeString()}</p>
                          </div>
                        </div>
                      )
                    ))}
                    {messages.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No messages yet. Start the conversation.</p>}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>
                <div className="border-t p-3 space-y-2">
                  <div className="flex items-end gap-2">
                    <Popover open={showCanned} onOpenChange={setShowCanned}>
                      <PopoverTrigger asChild>
                        <Button size="sm" variant="outline" className="h-9" data-testid="canned-trigger">
                          <Zap className="w-3.5 h-3.5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-2" align="start">
                        <p className="text-xs font-semibold mb-2 px-2">Canned responses</p>
                        <ScrollArea className="h-64">
                          <div className="space-y-1">
                            {canned.map(c => (
                              <button
                                key={c.id}
                                onClick={() => insertCanned(c)}
                                className="w-full text-left p-2 rounded hover:bg-muted text-xs"
                                data-testid={`canned-${c.id}`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-mono text-emerald-400">{c.shortcut}</span>
                                  <span className="text-[10px] text-muted-foreground">{c.title}</span>
                                </div>
                                <p className="text-muted-foreground mt-0.5 line-clamp-2">{c.content}</p>
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      </PopoverContent>
                    </Popover>
                    <Textarea
                      value={newMsg}
                      onChange={e => onComposerChange(e.target.value)}
                      placeholder={activeSession.status === "closed" ? "Session closed" : "Type a message… (Enter to send, Shift+Enter for newline)"}
                      disabled={activeSession.status === "closed"}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                      className="min-h-[60px] max-h-[160px] resize-none focus-visible:ring-emerald-500/50"
                      data-testid="chat-input"
                    />
                    <Button onClick={sendMessage} disabled={!newMsg.trim() || activeSession.status === "closed"} className="h-9 bg-emerald-600 hover:bg-emerald-500" data-testid="send-message">
                      <Send className="w-4 h-4" /><span className="ml-1.5 hidden sm:inline">Send</span>
                    </Button>
                  </div>
                  {typingUsers.length > 0 && <div className="flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] px-2.5 py-1.5 text-[10px] text-cyan-100"><span className="flex gap-0.5"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300 [animation-delay:120ms]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300 [animation-delay:240ms]" /></span>{typingUsers.map(person => person.name).join(", ")} typing...</div>}
                  {cannedSuggestions.length > 0 && <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.045] p-2" aria-label="Canned response suggestions">
                    <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">Reply library</span>
                    {cannedSuggestions.map(response => <button key={response.id} type="button" onClick={() => insertCanned(response)} className="rounded-md border border-emerald-500/15 bg-black/15 px-2 py-1 text-[10px] text-emerald-100 transition hover:border-emerald-400/40 hover:bg-emerald-500/10"><span className="font-mono text-emerald-300">{response.shortcut}</span>{response.title && <span className="ml-1 text-zinc-400">{response.title}</span>}</button>)}
                  </div>}
                  <p className="text-[10px] text-muted-foreground">Type <span className="font-mono text-emerald-400">/</span> shortcuts like <span className="font-mono">/hello</span>, <span className="font-mono">/eta</span>, <span className="font-mono">/remote</span></p>
                </div>
              </CardContent>
            </>
          ) : (
            <CardContent className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Select a chat session to start</p>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Context sidebar */}
        <Card className="lg:col-span-3 flex flex-col">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Building2 className="w-4 h-4" />Context</CardTitle></CardHeader>
          <CardContent className="flex-1 overflow-auto space-y-3">
            {activeSession ? (
              <>
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground font-semibold">Visitor</p>
                  <p className="text-sm font-medium">{activeSession.visitor_name}</p>
                  {activeSession.visitor_email && <p className="text-xs text-muted-foreground">{activeSession.visitor_email}</p>}
                </div>
                {activeSession.client_name && (
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground font-semibold">Client</p>
                    <p className="text-sm font-medium">{activeSession.client_name}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded bg-muted/30 border text-center">
                    <Ticket className="w-3 h-3 mx-auto text-orange-400" />
                    <p className="text-lg font-bold">{context.open_tickets || 0}</p>
                    <p className="text-[9px] text-muted-foreground">Open Tickets</p>
                  </div>
                  <div className="p-2 rounded bg-muted/30 border text-center">
                    <HardDrive className="w-3 h-3 mx-auto text-blue-400" />
                    <p className="text-lg font-bold">{context.devices || 0}</p>
                    <p className="text-[9px] text-muted-foreground">Devices</p>
                  </div>
                </div>
                {context.last_ticket && (
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">Last Ticket</p>
                    <div className="p-2 rounded border bg-muted/20 text-xs">
                      <p className="font-medium truncate">{context.last_ticket.title}</p>
                      <div className="flex items-center justify-between mt-1">
                        <Badge variant="outline" className="text-[9px] capitalize">{context.last_ticket.status}</Badge>
                        <span className="text-[9px] text-muted-foreground">{(context.last_ticket.created_at || "").slice(0, 10)}</span>
                      </div>
                    </div>
                  </div>
                )}
                {activeSession.transfer_history?.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">Transfer History</p>
                    <div className="space-y-1">
                      {activeSession.transfer_history.map((t, i) => (
                        <div key={i} className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <ChevronRight className="w-2.5 h-2.5" />
                          {t.from_name} → {t.to_name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Select a session to see context</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Transfer dialog */}
      <Dialog open={transferDialog} onOpenChange={setTransferDialog}>
        <DialogContent aria-describedby="transfer-desc">
          <DialogHeader>
            <DialogTitle>Transfer chat session</DialogTitle>
            <p id="transfer-desc" className="text-xs text-muted-foreground">Hand this session over to another agent. A system message will be posted.</p>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Transfer to agent</Label>
              <Select value={transferAgent} onValueChange={setTransferAgent}>
                <SelectTrigger data-testid="transfer-agent-select"><SelectValue placeholder="Select agent…" /></SelectTrigger>
                <SelectContent>
                  {agents.filter(a => a.id !== user?.id).map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name} · {a.role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Note (optional)</Label>
              <Textarea
                value={transferNote}
                onChange={e => setTransferNote(e.target.value)}
                placeholder="Brief context for the next agent…"
                className="min-h-[60px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTransferDialog(false)}>Cancel</Button>
            <Button onClick={transferSession} disabled={!transferAgent} data-testid="confirm-transfer-btn">
              <ArrowRightLeft className="w-4 h-4 mr-1" />Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage canned responses dialog */}
      <Dialog open={manageCanned} onOpenChange={setManageCanned}>
        <DialogContent className="max-w-[600px]" aria-describedby="canned-desc">
          <DialogHeader>
            <DialogTitle>Canned responses</DialogTitle>
            <p id="canned-desc" className="text-xs text-muted-foreground">Use shortcuts to paste quick replies. Placeholders <span className="font-mono">{"{visitor}"}</span> and <span className="font-mono">{"{eta}"}</span> auto-substitute.</p>
          </DialogHeader>
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2">
              {canned.map(c => (
                <div key={c.id} className="flex items-start gap-2 p-2 border rounded text-xs">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-emerald-400 font-semibold">{c.shortcut}</span>
                      <span className="text-muted-foreground">{c.title}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{c.content}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => deleteCanned(c.id)} data-testid={`delete-canned-${c.id}`}>
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-semibold">Add new</p>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="/shortcut" value={newCanned.shortcut} onChange={e => setNewCanned({...newCanned, shortcut: e.target.value})} data-testid="new-canned-shortcut" />
              <Input placeholder="Title" value={newCanned.title} onChange={e => setNewCanned({...newCanned, title: e.target.value})} />
            </div>
            <Textarea placeholder="Response content…" value={newCanned.content} onChange={e => setNewCanned({...newCanned, content: e.target.value})} className="min-h-[60px]" />
            <Button size="sm" onClick={saveCanned} className="w-full" data-testid="save-new-canned">
              <Plus className="w-3 h-3 mr-1" />Add canned response
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </PageShell>
  );
}
