import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { RichTextEditor } from "@/components/RichTextEditor";
import {
  Plus, Search, Clock, AlertCircle, CheckCircle, Circle, Loader2,
  Ticket, MessageSquare, Mail, Send, User, ArrowLeft, Tag, Link2,
  Timer, GitBranch, Merge, FileText, Eye, History, X, Play, Square
} from "lucide-react";
import { format, formatDistanceToNow, differenceInHours } from "date-fns";

const priorityConfig = {
  critical: { label: "Critical", class: "bg-red-500 text-white" },
  high: { label: "High", class: "bg-orange-500 text-white" },
  medium: { label: "Medium", class: "bg-yellow-500 text-white" },
  low: { label: "Low", class: "bg-green-600 text-white" }
};
const statusConfig = {
  open: { label: "Open", class: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  in_progress: { label: "In Progress", class: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
  resolved: { label: "Resolved", class: "bg-green-500/10 text-green-500 border-green-500/20" },
  closed: { label: "Closed", class: "bg-gray-500/10 text-gray-500 border-gray-500/20" }
};

export default function TicketsPage() {
  const { token, user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // Detail view state
  const [viewingTicket, setViewingTicket] = useState(null);
  const [ticketNotes, setTicketNotes] = useState([]);
  const [ticketEmails, setTicketEmails] = useState([]);
  const [childTickets, setChildTickets] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [cannedResponses, setCannedResponses] = useState([]);
  const [newNote, setNewNote] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isEmailOpen, setIsEmailOpen] = useState(false);
  const [emailSignature, setEmailSignature] = useState("");
  const [emailForm, setEmailForm] = useState({ to: "", cc: "", bcc: "", subject: "", body: "" });
  const [isChildOpen, setIsChildOpen] = useState(false);
  const [isMergeOpen, setIsMergeOpen] = useState(false);
  const [isTimeOpen, setIsTimeOpen] = useState(false);
  const [isCannedOpen, setIsCannedOpen] = useState(false);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [tagInput, setTagInput] = useState("");
  const [formData, setFormData] = useState({
    title: "", description: "", client_id: "", priority: "medium", category: "support",
    assigned_to: "", parent_id: "", tags: [], ticket_type: "incident", impact: "medium",
    source: "portal", due_date: "", estimated_hours: "", contact_id: "", asset_id: "",
    device_id: "",
    cc: [], watchers: []
  });
  const [childForm, setChildForm] = useState({ title: "", description: "", priority: "medium" });
  const [mergeIds, setMergeIds] = useState([]);
  const [timeForm, setTimeForm] = useState({ minutes: 15, description: "", billable: true });
  const [cannedForm, setCannedForm] = useState({ title: "", content: "", category: "general" });
  const [noteCounts, setNoteCounts] = useState({});

  const headers = { Authorization: `Bearer ${token}` };

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, cRes, uRes, crRes, ncRes, dRes] = await Promise.all([
        axios.get(`${API}/tickets`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/users`, { headers }),
        axios.get(`${API}/canned-responses`, { headers }),
        axios.get(`${API}/tickets/note-counts`, { headers }),
        axios.get(`${API}/devices`, { headers }),
      ]);
      setTickets(tRes.data);
      setClients(cRes.data);
      setUsers(uRes.data);
      setCannedResponses(crRes.data);
      setNoteCounts(ncRes.data);
      setDevices(dRes.data);
    } catch { toast.error("Failed to fetch tickets"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // Timer effect
  useEffect(() => {
    let interval;
    if (isTimerRunning && timerStart) {
      interval = setInterval(() => setTimerElapsed(Math.floor((Date.now() - timerStart) / 1000)), 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timerStart]);

  const fetchTicketDetail = async (ticket) => {
    setViewingTicket(ticket);
    try {
      const [nRes, eRes, cRes, tRes, aRes] = await Promise.all([
        axios.get(`${API}/tickets/${ticket.id}/comments`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/emails`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/children`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/time-entries`, { headers }),
        axios.get(`${API}/tickets/${ticket.id}/audit-log`, { headers }),
      ]);
      setTicketNotes(nRes.data);
      setTicketEmails(eRes.data);
      setChildTickets(cRes.data);
      setTimeEntries(tRes.data);
      setAuditLog(aRes.data);
      const sig = user?.email_signature || "";
      setEmailSignature(sig);
      setEmailForm({ to: "", cc: "", bcc: "", subject: `Re: ${ticket.ticket_number} - ${ticket.title}`, body: "" });
    } catch { toast.error("Failed to load ticket details"); }
  };

  const handleCreateTicket = async () => {
    if (!formData.title || !formData.client_id) { toast.error("Title and client are required"); return; }
    const payload = {
      ...formData,
      estimated_hours: formData.estimated_hours ? parseFloat(formData.estimated_hours) : null,
      due_date: formData.due_date || null,
    };
    try {
      await axios.post(`${API}/tickets`, payload, { headers });
      toast.success("Ticket created");
      setIsCreateOpen(false);
      setFormData({
        title: "", description: "", client_id: "", priority: "medium", category: "support",
        assigned_to: "", parent_id: "", tags: [], ticket_type: "incident", impact: "medium",
        source: "portal", due_date: "", estimated_hours: "", contact_id: "", asset_id: "",
        device_id: "",
        cc: [], watchers: []
      });
      fetchTickets();
    } catch { toast.error("Failed to create ticket"); }
  };

  const handleUpdateTicket = async (field, value) => {
    try {
      await axios.put(`${API}/tickets/${viewingTicket.id}`, { [field]: value }, { headers });
      setViewingTicket(prev => ({ ...prev, [field]: value }));
      fetchTickets();
    } catch { toast.error("Failed to update ticket"); }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/comments`, { content: newNote, is_internal: isInternalNote }, { headers });
      setNewNote("");
      const res = await axios.get(`${API}/tickets/${viewingTicket.id}/comments`, { headers });
      setTicketNotes(res.data);
      toast.success("Note added");
    } catch { toast.error("Failed to add note"); }
  };

  const handleSendEmail = async () => {
    try {
      const bodyWithSig = emailForm.body + (emailSignature ? `\n\n${emailSignature}` : "");
      await axios.post(`${API}/tickets/${viewingTicket.id}/emails`, {
        ticket_id: viewingTicket.id,
        to_addresses: emailForm.to.split(",").map(e => e.trim()).filter(Boolean),
        cc: emailForm.cc ? emailForm.cc.split(",").map(e => e.trim()).filter(Boolean) : [],
        bcc: emailForm.bcc ? emailForm.bcc.split(",").map(e => e.trim()).filter(Boolean) : [],
        subject: emailForm.subject,
        body: bodyWithSig
      }, { headers });
      setIsEmailOpen(false);
      const res = await axios.get(`${API}/tickets/${viewingTicket.id}/emails`, { headers });
      setTicketEmails(res.data);
      toast.success("Email sent");
    } catch { toast.error("Failed to send email"); }
  };

  const handleCreateChild = async () => {
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/children`, childForm, { headers });
      setIsChildOpen(false);
      setChildForm({ title: "", description: "", priority: "medium" });
      const res = await axios.get(`${API}/tickets/${viewingTicket.id}/children`, { headers });
      setChildTickets(res.data);
      fetchTickets();
      toast.success("Child ticket created");
    } catch { toast.error("Failed to create child ticket"); }
  };

  const handleMerge = async () => {
    if (!mergeIds.length) return;
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/merge`, { merge_ids: mergeIds }, { headers });
      setIsMergeOpen(false);
      setMergeIds([]);
      fetchTickets();
      toast.success("Tickets merged");
    } catch { toast.error("Failed to merge"); }
  };

  const handleAddTime = async () => {
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/time-entries`, timeForm, { headers });
      setIsTimeOpen(false);
      setTimeForm({ minutes: 15, description: "", billable: true });
      const res = await axios.get(`${API}/tickets/${viewingTicket.id}/time-entries`, { headers });
      setTimeEntries(res.data);
      toast.success("Time logged");
    } catch { toast.error("Failed to log time"); }
  };

  const toggleTimer = () => {
    if (isTimerRunning) {
      const mins = Math.max(1, Math.round(timerElapsed / 60));
      setTimeForm({ minutes: mins, description: "Timer entry", billable: true });
      setIsTimeOpen(true);
      setIsTimerRunning(false);
      setTimerStart(null);
      setTimerElapsed(0);
    } else {
      setIsTimerRunning(true);
      setTimerStart(Date.now());
    }
  };

  const handleAddTag = () => {
    if (tagInput.trim() && viewingTicket) {
      const newTags = [...(viewingTicket.tags || []), tagInput.trim()];
      handleUpdateTicket("tags", newTags);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag) => {
    if (viewingTicket) {
      handleUpdateTicket("tags", (viewingTicket.tags || []).filter(t => t !== tag));
    }
  };

  const handleSaveCanned = async () => {
    try {
      await axios.post(`${API}/canned-responses`, cannedForm, { headers });
      setCannedForm({ title: "", content: "", category: "general" });
      const res = await axios.get(`${API}/canned-responses`, { headers });
      setCannedResponses(res.data);
      toast.success("Canned response saved");
    } catch { toast.error("Failed to save"); }
  };

  const handleSaveSignature = async () => {
    try {
      await axios.put(`${API}/users/${user.id}`, { email_signature: emailSignature }, { headers });
      toast.success("Signature saved");
    } catch { toast.error("Failed to save signature"); }
  };

  const fmtTime = (s) => { const m = Math.floor(s / 60); const sec = s % 60; return `${m}:${sec.toString().padStart(2, '0')}`; };

  const filteredTickets = tickets.filter(t => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (t.title?.toLowerCase().includes(q) || t.ticket_number?.toLowerCase().includes(q) || t.client_name?.toLowerCase().includes(q));
    }
    return true;
  });

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ============ DETAIL VIEW ============
  if (viewingTicket) {
    const parent = viewingTicket.parent_id ? tickets.find(t => t.id === viewingTicket.parent_id) : null;
    const slaHours = viewingTicket.sla_due ? differenceInHours(new Date(viewingTicket.sla_due), new Date()) : null;
    return (
      <div className="space-y-4" data-testid="ticket-detail-view">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setViewingTicket(null)} data-testid="back-to-list"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <Badge className={priorityConfig[viewingTicket.priority]?.class}>{priorityConfig[viewingTicket.priority]?.label}</Badge>
          <span className="text-sm text-muted-foreground font-mono">{viewingTicket.ticket_number}</span>
          {viewingTicket.merged_into && <Badge variant="outline" className="text-red-400">Merged</Badge>}
          {parent && <Badge variant="outline" className="text-indigo-400"><GitBranch className="w-3 h-3 mr-1" />Child of {parent.ticket_number}</Badge>}
          <div className="ml-auto flex items-center gap-2">
            {/* Timer */}
            <Button variant={isTimerRunning ? "destructive" : "outline"} size="sm" onClick={toggleTimer} data-testid="timer-btn">
              {isTimerRunning ? <><Square className="w-3 h-3 mr-1" />{fmtTime(timerElapsed)}</> : <><Play className="w-3 h-3 mr-1" />Timer</>}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsTimeOpen(true)} data-testid="log-time-btn"><Timer className="w-4 h-4 mr-1" />Log Time</Button>
            <Button variant="outline" size="sm" onClick={() => setIsEmailOpen(true)} data-testid="send-email-btn"><Mail className="w-4 h-4 mr-1" />Email</Button>
            <Button variant="outline" size="sm" onClick={() => setIsChildOpen(true)} data-testid="add-child-btn"><GitBranch className="w-4 h-4 mr-1" />Child</Button>
            <Button variant="outline" size="sm" onClick={() => setIsMergeOpen(true)} data-testid="merge-btn"><Merge className="w-4 h-4 mr-1" />Merge</Button>
          </div>
        </div>

        {/* Color-Coded Progress Tracker */}
        {(() => {
          const stages = [
            { key: "open", label: "Open", color: "bg-blue-500" },
            { key: "in_progress", label: "In Progress", color: "bg-yellow-500" },
            { key: "on_hold", label: "On Hold", color: "bg-orange-500" },
            { key: "resolved", label: "Resolved", color: "bg-green-500" },
            { key: "closed", label: "Closed", color: "bg-gray-500" },
          ];
          const currentStatus = viewingTicket.status;
          const currentIdx = stages.findIndex(s => s.key === currentStatus);
          const activeIdx = currentIdx >= 0 ? currentIdx : 0;
          return (
            <div className="flex items-center gap-0 w-full" data-testid="ticket-progress-bar">
              {stages.map((stage, i) => {
                const isActive = i === activeIdx;
                const isPast = i < activeIdx;
                const dotColor = isActive ? stage.color : isPast ? "bg-green-500" : "bg-muted-foreground/20";
                const lineColor = i < activeIdx ? "bg-green-500" : "bg-muted-foreground/15";
                return (
                  <div key={stage.key} className="flex items-center flex-1">
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <div className={`w-5 h-5 rounded-full ${dotColor} flex items-center justify-center transition-all ${isActive ? "ring-2 ring-offset-2 ring-offset-background ring-current scale-110" : ""}`}>
                        {isPast && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                        {isActive && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                      <span className={`text-[10px] font-medium whitespace-nowrap ${isActive ? "text-foreground" : isPast ? "text-green-500" : "text-muted-foreground/50"}`}>{stage.label}</span>
                    </div>
                    {i < stages.length - 1 && <div className={`h-0.5 flex-1 mx-1 rounded-full ${lineColor} transition-all`} />}
                  </div>
                );
              })}
            </div>
          );
        })()}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xl">{viewingTicket.title}</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{viewingTicket.description}</p>
                {/* Tags */}
                <div className="flex items-center gap-2 mt-4 flex-wrap">
                  <Tag className="w-4 h-4 text-muted-foreground" />
                  {(viewingTicket.tags || []).map(tag => (
                    <Badge key={tag} variant="secondary" className="gap-1 cursor-pointer" onClick={() => handleRemoveTag(tag)}>
                      {tag}<X className="w-3 h-3" />
                    </Badge>
                  ))}
                  <Input className="w-24 h-6 text-xs" placeholder="Add tag" value={tagInput} onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleAddTag()} data-testid="tag-input" />
                </div>
                {/* SLA indicator */}
                {slaHours !== null && (
                  <div className={`mt-3 flex items-center gap-2 text-sm ${slaHours < 2 ? 'text-red-500' : slaHours < 8 ? 'text-yellow-500' : 'text-green-500'}`}>
                    <Clock className="w-4 h-4" />
                    <span>SLA: {slaHours > 0 ? `${slaHours}h remaining` : `Overdue by ${Math.abs(slaHours)}h`}</span>
                    <div className={`h-2 rounded-full flex-1 max-w-[200px] ${slaHours < 2 ? 'bg-red-500/20' : slaHours < 8 ? 'bg-yellow-500/20' : 'bg-green-500/20'}`}>
                      <div className={`h-2 rounded-full transition-all ${slaHours < 2 ? 'bg-red-500' : slaHours < 8 ? 'bg-yellow-500' : 'bg-green-500'}`}
                        style={{ width: `${Math.max(5, Math.min(100, (1 - slaHours / 24) * 100))}%` }} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Tabs: Notes, Emails, Children, Time, Audit */}
            <Tabs defaultValue="notes">
              <TabsList className="w-full grid grid-cols-5">
                <TabsTrigger value="notes"><MessageSquare className="w-3 h-3 mr-1" />Notes ({ticketNotes.length})</TabsTrigger>
                <TabsTrigger value="emails"><Mail className="w-3 h-3 mr-1" />Emails ({ticketEmails.length})</TabsTrigger>
                <TabsTrigger value="children"><GitBranch className="w-3 h-3 mr-1" />Children ({childTickets.length})</TabsTrigger>
                <TabsTrigger value="time"><Timer className="w-3 h-3 mr-1" />Time ({timeEntries.length})</TabsTrigger>
                <TabsTrigger value="audit"><History className="w-3 h-3 mr-1" />Audit</TabsTrigger>
              </TabsList>

              {/* NOTES TAB */}
              <TabsContent value="notes" className="space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Textarea className="flex-1" placeholder="Add a note..." value={newNote} onChange={e => setNewNote(e.target.value)} rows={2} data-testid="note-input" />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={isInternalNote} onCheckedChange={setIsInternalNote} id="internal" data-testid="internal-note-check" />
                      <Label htmlFor="internal" className="text-sm">Internal note</Label>
                    </div>
                    {/* Canned responses dropdown */}
                    {cannedResponses.length > 0 && (
                      <Select onValueChange={v => setNewNote(v)}>
                        <SelectTrigger className="w-[180px] h-8"><SelectValue placeholder="Canned response" /></SelectTrigger>
                        <SelectContent>
                          {cannedResponses.map(cr => <SelectItem key={cr.id} value={cr.content}>{cr.title}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    <Button size="sm" onClick={handleAddNote} data-testid="add-note-btn"><Send className="w-3 h-3 mr-1" />Add</Button>
                  </div>
                </div>
                <ScrollArea className="h-[300px]">
                  {ticketNotes.map(note => (
                    <div key={note.id} className={`p-3 rounded-lg mb-2 border ${note.is_internal ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-muted/30 border-border'}`} data-testid={`note-${note.id}`}>
                      <div className="flex justify-between items-start mb-1">
                        <div className="flex items-center gap-2">
                          <User className="w-3 h-3" /><span className="text-sm font-medium">{note.user_name}</span>
                          {note.is_internal && <Badge variant="outline" className="text-yellow-500 text-[10px] h-4">Internal</Badge>}
                        </div>
                        <span className="text-xs text-muted-foreground">{note.created_at && formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                    </div>
                  ))}
                </ScrollArea>
              </TabsContent>

              {/* EMAILS TAB */}
              <TabsContent value="emails">
                <ScrollArea className="h-[350px]">
                  {ticketEmails.length > 0 ? ticketEmails.map(email => (
                    <div key={email.id} className="p-3 rounded-lg mb-2 border bg-muted/30" data-testid={`email-${email.id}`}>
                      <div className="flex justify-between mb-1">
                        <span className="text-sm font-medium">{email.subject}</span>
                        <span className="text-xs text-muted-foreground">{email.created_at && formatDistanceToNow(new Date(email.created_at), { addSuffix: true })}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">To: {email.to_addresses?.join(", ")}</p>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{email.body?.substring(0, 200)}</p>
                    </div>
                  )) : <p className="text-center py-8 text-muted-foreground">No emails</p>}
                </ScrollArea>
              </TabsContent>

              {/* CHILDREN TAB */}
              <TabsContent value="children">
                {childTickets.length > 0 ? (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Number</TableHead><TableHead>Title</TableHead><TableHead>Status</TableHead><TableHead>Priority</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {childTickets.map(child => (
                        <TableRow key={child.id} className="cursor-pointer hover:bg-muted/50" onClick={() => fetchTicketDetail(child)}>
                          <TableCell className="font-mono text-sm">{child.ticket_number}</TableCell>
                          <TableCell>{child.title}</TableCell>
                          <TableCell><Badge variant="outline" className={statusConfig[child.status]?.class}>{statusConfig[child.status]?.label}</Badge></TableCell>
                          <TableCell><Badge className={priorityConfig[child.priority]?.class + " text-xs"}>{priorityConfig[child.priority]?.label}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : <p className="text-center py-8 text-muted-foreground">No child tickets</p>}
              </TabsContent>

              {/* TIME TAB */}
              <TabsContent value="time">
                {timeEntries.length > 0 ? (
                  <Table>
                    <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Minutes</TableHead><TableHead>Description</TableHead><TableHead>Billable</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {timeEntries.map(te => (
                        <TableRow key={te.id}>
                          <TableCell>{te.user_name}</TableCell>
                          <TableCell className="font-mono">{te.minutes}m</TableCell>
                          <TableCell>{te.description}</TableCell>
                          <TableCell>{te.billable ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Circle className="w-4 h-4 text-gray-500" />}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{te.created_at && formatDistanceToNow(new Date(te.created_at), { addSuffix: true })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : <p className="text-center py-8 text-muted-foreground">No time entries</p>}
              </TabsContent>

              {/* AUDIT TAB */}
              <TabsContent value="audit">
                <ScrollArea className="h-[350px]">
                  {auditLog.map(entry => (
                    <div key={entry.id} className="flex items-start gap-3 p-2 border-b border-border/50" data-testid={`audit-${entry.id}`}>
                      <History className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm"><span className="font-medium">{entry.user_name}</span> <span className="text-muted-foreground">{entry.action}</span></p>
                        <p className="text-xs text-muted-foreground">{entry.details}</p>
                        <p className="text-[11px] text-muted-foreground/60">{entry.created_at && formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</p>
                      </div>
                    </div>
                  ))}
                  {!auditLog.length && <p className="text-center py-8 text-muted-foreground">No audit entries</p>}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-4 space-y-4">
                <div><Label className="text-xs text-muted-foreground">Status</Label>
                  <Select value={viewingTicket.status} onValueChange={v => handleUpdateTicket("status", v)}>
                    <SelectTrigger data-testid="status-select"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(statusConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs text-muted-foreground">Priority</Label>
                  <Select value={viewingTicket.priority} onValueChange={v => handleUpdateTicket("priority", v)}>
                    <SelectTrigger data-testid="priority-select"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(priorityConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs text-muted-foreground">Assigned To</Label>
                  <Select value={viewingTicket.assigned_to || ""} onValueChange={v => handleUpdateTicket("assigned_to", v)}>
                    <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs text-muted-foreground">Category</Label>
                  <Select value={viewingTicket.category || "support"} onValueChange={v => handleUpdateTicket("category", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="support">Support</SelectItem><SelectItem value="incident">Incident</SelectItem>
                      <SelectItem value="request">Request</SelectItem><SelectItem value="problem">Problem</SelectItem>
                      <SelectItem value="change">Change</SelectItem><SelectItem value="project">Project</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div className="space-y-1">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Client</span><span>{viewingTicket.client_name}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Created</span><span>{viewingTicket.created_at && format(new Date(viewingTicket.created_at), "MMM d, HH:mm")}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total Time</span><span className="font-mono">{viewingTicket.total_time_minutes || 0}m</span></div>
                  {viewingTicket.watchers?.length > 0 && (
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Watchers</span><span>{viewingTicket.watchers.length}</span></div>
                  )}
                </div>
                <Separator />
                <div><Label className="text-xs text-muted-foreground">Linked Device</Label>
                  <Select value={viewingTicket.device_id || "none"} onValueChange={v => handleUpdateTicket("device_id", v === "none" ? "" : v)}>
                    <SelectTrigger data-testid="device-select"><SelectValue placeholder="No device linked" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- No device --</SelectItem>
                      {devices.filter(d => !viewingTicket.client_id || d.client_id === viewingTicket.client_id).map(d => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {viewingTicket.device_id && viewingTicket.device_name && (
                    <Button variant="link" size="sm" className="px-0 h-6 text-xs" onClick={() => window.location.href = `/devices/${viewingTicket.device_id}`} data-testid="view-device-link">
                      View {viewingTicket.device_name} details
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Email Signature */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Email Signature</CardTitle></CardHeader>
              <CardContent>
                <RichTextEditor content={emailSignature} onChange={setEmailSignature} minHeight="80px" />
                <Button size="sm" className="mt-2 w-full" onClick={handleSaveSignature} data-testid="save-signature-btn">Save Signature</Button>
              </CardContent>
            </Card>

            {/* Canned Responses Manager */}
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Canned Responses</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setIsCannedOpen(true)} data-testid="manage-canned-btn"><Plus className="w-3 h-3" /></Button>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[100px]">
                  {cannedResponses.map(cr => (
                    <div key={cr.id} className="text-sm py-1 px-2 rounded hover:bg-muted/50 cursor-pointer" onClick={() => setNewNote(cr.content)}>{cr.title}</div>
                  ))}
                  {!cannedResponses.length && <p className="text-xs text-muted-foreground text-center py-2">No canned responses</p>}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* EMAIL DIALOG */}
        <Dialog open={isEmailOpen} onOpenChange={setIsEmailOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Send Email from Ticket</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div><Label>To</Label><Input value={emailForm.to} onChange={e => setEmailForm({ ...emailForm, to: e.target.value })} placeholder="recipient@email.com" data-testid="email-to" /></div>
                <div><Label>CC</Label><Input value={emailForm.cc} onChange={e => setEmailForm({ ...emailForm, cc: e.target.value })} placeholder="cc@email.com" data-testid="email-cc" /></div>
                <div><Label>BCC</Label><Input value={emailForm.bcc} onChange={e => setEmailForm({ ...emailForm, bcc: e.target.value })} placeholder="bcc@email.com" data-testid="email-bcc" /></div>
              </div>
              <div><Label>Subject</Label><Input value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} data-testid="email-subject" /></div>
              <div><Label>Body</Label><Textarea value={emailForm.body} onChange={e => setEmailForm({ ...emailForm, body: e.target.value })} rows={6} data-testid="email-body" /></div>
              {emailSignature && <div className="border rounded p-2 bg-muted/30"><p className="text-xs text-muted-foreground mb-1">Signature:</p><div className="text-sm" dangerouslySetInnerHTML={{ __html: emailSignature }} /></div>}
            </div>
            <DialogFooter><Button onClick={handleSendEmail} data-testid="send-email-submit"><Send className="w-4 h-4 mr-1" />Send</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* CHILD TICKET DIALOG */}
        <Dialog open={isChildOpen} onOpenChange={setIsChildOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Child Ticket</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Title</Label><Input value={childForm.title} onChange={e => setChildForm({ ...childForm, title: e.target.value })} data-testid="child-title" /></div>
              <div><Label>Description</Label><Textarea value={childForm.description} onChange={e => setChildForm({ ...childForm, description: e.target.value })} data-testid="child-desc" /></div>
              <div><Label>Priority</Label>
                <Select value={childForm.priority} onValueChange={v => setChildForm({ ...childForm, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(priorityConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter><Button onClick={handleCreateChild} data-testid="create-child-submit"><GitBranch className="w-4 h-4 mr-1" />Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MERGE DIALOG */}
        <Dialog open={isMergeOpen} onOpenChange={setIsMergeOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Merge Tickets Into This One</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Select tickets to merge into {viewingTicket.ticket_number}. Their notes and emails will be combined.</p>
            <ScrollArea className="h-[250px]">
              {tickets.filter(t => t.id !== viewingTicket.id && t.status !== "closed").map(t => (
                <div key={t.id} className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded">
                  <Checkbox checked={mergeIds.includes(t.id)} onCheckedChange={c => setMergeIds(c ? [...mergeIds, t.id] : mergeIds.filter(x => x !== t.id))} />
                  <span className="font-mono text-sm">{t.ticket_number}</span>
                  <span className="text-sm truncate">{t.title}</span>
                </div>
              ))}
            </ScrollArea>
            <DialogFooter><Button onClick={handleMerge} disabled={!mergeIds.length} data-testid="merge-submit"><Merge className="w-4 h-4 mr-1" />Merge {mergeIds.length} tickets</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* LOG TIME DIALOG */}
        <Dialog open={isTimeOpen} onOpenChange={setIsTimeOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Log Time</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Minutes</Label><Input type="number" value={timeForm.minutes} onChange={e => setTimeForm({ ...timeForm, minutes: parseInt(e.target.value) || 0 })} data-testid="time-minutes" /></div>
              <div><Label>Description</Label><Input value={timeForm.description} onChange={e => setTimeForm({ ...timeForm, description: e.target.value })} data-testid="time-desc" /></div>
              <div className="flex items-center gap-2"><Checkbox checked={timeForm.billable} onCheckedChange={v => setTimeForm({ ...timeForm, billable: v })} id="billable" /><Label htmlFor="billable">Billable</Label></div>
            </div>
            <DialogFooter><Button onClick={handleAddTime} data-testid="log-time-submit"><Timer className="w-4 h-4 mr-1" />Log Time</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* CANNED RESPONSE DIALOG */}
        <Dialog open={isCannedOpen} onOpenChange={setIsCannedOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Manage Canned Responses</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Title</Label><Input value={cannedForm.title} onChange={e => setCannedForm({ ...cannedForm, title: e.target.value })} /></div>
              <div><Label>Content</Label><Textarea value={cannedForm.content} onChange={e => setCannedForm({ ...cannedForm, content: e.target.value })} rows={3} /></div>
              <Button onClick={handleSaveCanned} size="sm"><Plus className="w-3 h-3 mr-1" />Save</Button>
            </div>
            <Separator className="my-3" />
            <ScrollArea className="h-[200px]">
              {cannedResponses.map(cr => (
                <div key={cr.id} className="flex justify-between items-center p-2 border-b">
                  <div><p className="text-sm font-medium">{cr.title}</p><p className="text-xs text-muted-foreground truncate max-w-[300px]">{cr.content}</p></div>
                  <Button variant="ghost" size="sm" onClick={async () => { await axios.delete(`${API}/canned-responses/${cr.id}`, { headers }); const r = await axios.get(`${API}/canned-responses`, { headers }); setCannedResponses(r.data); }}><X className="w-3 h-3" /></Button>
                </div>
              ))}
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ============ LIST VIEW ============
  const openCount = tickets.filter(t => t.status === "open").length;
  const inProgressCount = tickets.filter(t => t.status === "in_progress").length;
  const resolvedCount = tickets.filter(t => t.status === "resolved").length;
  const criticalCount = tickets.filter(t => t.priority === "critical" && t.status !== "closed" && t.status !== "resolved").length;
  const noNotesCount = tickets.filter(t => noteCounts[t.id] === 0 && t.status !== "closed" && t.status !== "resolved").length;
  const avgResTime = tickets.length > 0 ? Math.round(tickets.reduce((a, t) => a + (t.total_time_minutes || 0), 0) / Math.max(1, tickets.filter(t => t.total_time_minutes > 0).length)) : 0;

  return (
    <div className="space-y-5" data-testid="tickets-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Service Desk</h1>
          <p className="text-muted-foreground">{tickets.length} total tickets across {new Set(tickets.map(t => t.client_id)).size} clients</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchTickets}><Search className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={() => setIsCreateOpen(true)} data-testid="create-ticket-btn"><Plus className="w-4 h-4 mr-1" />New Ticket</Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-6 gap-3">
        <Card className="cursor-pointer hover:border-blue-500/40 transition-colors" onClick={() => setStatusFilter("open")} data-testid="stat-open">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className="text-2xl font-black text-blue-400">{openCount}</p><p className="text-[11px] text-muted-foreground">Open</p></div><div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><Circle className="w-5 h-5 text-blue-400" /></div></div></CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-yellow-500/40 transition-colors" onClick={() => setStatusFilter("in_progress")} data-testid="stat-progress">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className="text-2xl font-black text-yellow-400">{inProgressCount}</p><p className="text-[11px] text-muted-foreground">In Progress</p></div><div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center"><Clock className="w-5 h-5 text-yellow-400" /></div></div></CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-green-500/40 transition-colors" onClick={() => setStatusFilter("resolved")} data-testid="stat-resolved">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className="text-2xl font-black text-green-400">{resolvedCount}</p><p className="text-[11px] text-muted-foreground">Resolved</p></div><div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center"><CheckCircle className="w-5 h-5 text-green-400" /></div></div></CardContent>
        </Card>
        <Card className={`${criticalCount > 0 ? "border-red-500/40" : ""}`} data-testid="stat-critical">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className={`text-2xl font-black ${criticalCount > 0 ? "text-red-400" : "text-muted-foreground"}`}>{criticalCount}</p><p className="text-[11px] text-muted-foreground">Critical</p></div><div className={`w-10 h-10 rounded-xl ${criticalCount > 0 ? "bg-red-500/10" : "bg-muted/30"} flex items-center justify-center`}><AlertCircle className={`w-5 h-5 ${criticalCount > 0 ? "text-red-400" : "text-muted-foreground"}`} /></div></div></CardContent>
        </Card>
        <Card className={`${noNotesCount > 0 ? "border-amber-500/40" : ""}`} data-testid="stat-no-notes">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className={`text-2xl font-black ${noNotesCount > 0 ? "text-amber-400" : "text-muted-foreground"}`}>{noNotesCount}</p><p className="text-[11px] text-muted-foreground">No Response</p></div><div className={`w-10 h-10 rounded-xl ${noNotesCount > 0 ? "bg-amber-500/10" : "bg-muted/30"} flex items-center justify-center`}><MessageSquare className={`w-5 h-5 ${noNotesCount > 0 ? "text-amber-400" : "text-muted-foreground"}`} /></div></div></CardContent>
        </Card>
        <Card data-testid="stat-avg-time">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className="text-2xl font-black">{avgResTime}m</p><p className="text-[11px] text-muted-foreground">Avg Time</p></div><div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center"><Timer className="w-5 h-5 text-cyan-400" /></div></div></CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search tickets, clients, numbers..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} data-testid="search-input" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]" data-testid="status-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Status</SelectItem>{Object.entries(statusConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[140px]" data-testid="priority-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Priority</SelectItem>{Object.entries(priorityConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
        </Select>
        {(statusFilter !== "all" || priorityFilter !== "all") && (
          <Button variant="ghost" size="sm" onClick={() => { setStatusFilter("all"); setPriorityFilter("all"); }} className="text-xs text-muted-foreground"><X className="w-3 h-3 mr-1" />Clear Filters</Button>
        )}
        <p className="text-sm text-muted-foreground ml-auto">{filteredTickets.length} of {tickets.length} tickets</p>
      </div>

      {/* Ticket Cards */}
      <div className="space-y-2">
        {filteredTickets.map(ticket => {
          const pc = priorityConfig[ticket.priority] || priorityConfig.medium;
          const sc = statusConfig[ticket.status] || statusConfig.open;
          const hasNoNotes = noteCounts[ticket.id] === 0 && ticket.status !== "closed" && ticket.status !== "resolved";
          const isOverdue = ticket.sla_due && new Date(ticket.sla_due) < new Date() && ticket.status !== "closed" && ticket.status !== "resolved";
          const priorityBorder = ticket.priority === "critical" ? "border-l-red-500" : ticket.priority === "high" ? "border-l-orange-500" : ticket.priority === "medium" ? "border-l-yellow-500" : "border-l-green-500";

          return (
            <Card
              key={ticket.id}
              className={`cursor-pointer hover:bg-muted/30 transition-all border-l-4 ${priorityBorder} ${hasNoNotes ? "bg-red-500/3" : ""} ${isOverdue ? "ring-1 ring-red-500/30" : ""}`}
              onClick={() => fetchTicketDetail(ticket)}
              data-testid={`ticket-row-${ticket.id}`}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-4">
                  {/* Priority Dot + Ticket Number */}
                  <div className="flex flex-col items-center gap-1 w-16 flex-shrink-0">
                    <span className="font-mono text-xs text-muted-foreground">{ticket.ticket_number}</span>
                    {ticket.parent_id && <GitBranch className="w-3 h-3 text-indigo-400" />}
                    {ticket.merged_into && <Merge className="w-3 h-3 text-red-400" />}
                  </div>

                  {/* Main Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-medium text-sm truncate">{ticket.title}</p>
                      {isOverdue && <Badge className="bg-red-500/20 text-red-400 text-[9px] border-red-500/30">SLA BREACH</Badge>}
                      {hasNoNotes && <Badge className="bg-amber-500/20 text-amber-400 text-[9px] border-amber-500/30">AWAITING RESPONSE</Badge>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{ticket.client_name}</span>
                      {ticket.device_name && <><span className="text-muted-foreground/30">|</span><span className="font-mono">{ticket.device_name}</span></>}
                      {ticket.category && <><span className="text-muted-foreground/30">|</span><span className="capitalize">{ticket.category}</span></>}
                      {(ticket.tags || []).length > 0 && <><span className="text-muted-foreground/30">|</span>{ticket.tags.slice(0, 2).map(t => <Badge key={t} variant="outline" className="text-[9px] h-4 px-1">{t}</Badge>)}</>}
                    </div>
                  </div>

                  {/* Right Side Info */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <Badge className={pc.class + " text-[10px] mb-0.5"}>{pc.label}</Badge>
                      <div><Badge variant="outline" className={sc.class + " text-[10px]"}>{sc.label}</Badge></div>
                    </div>
                    <div className="text-right w-20">
                      <p className="text-xs text-muted-foreground">{ticket.assigned_name || <span className="text-red-400">Unassigned</span>}</p>
                      <p className="text-[10px] text-muted-foreground/60">{ticket.created_at && formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}</p>
                    </div>
                    {ticket.total_time_minutes > 0 && (
                      <div className="text-right w-12"><p className="font-mono text-xs">{ticket.total_time_minutes}m</p><p className="text-[9px] text-muted-foreground">time</p></div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filteredTickets.length === 0 && (
          <Card className="border-dashed"><CardContent className="py-12 text-center">
            <Ticket className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-30" />
            <p className="text-muted-foreground mb-3">No tickets match your filters</p>
            <Button onClick={() => { setStatusFilter("all"); setPriorityFilter("all"); setSearchQuery(""); }}>Clear Filters</Button>
          </CardContent></Card>
        )}
      </div>

      {/* CREATE TICKET DIALOG - Syncro/SuperOps Style */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader><DialogTitle>Create New Ticket</DialogTitle></DialogHeader>
          <div className="space-y-4 overflow-y-auto max-h-[70vh] pr-1">
            {/* Core Info */}
            <div><Label>Title *</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="Brief description of the issue" data-testid="create-title" /></div>
            <div><Label>Description</Label><Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={3} placeholder="Detailed description, steps to reproduce, etc." data-testid="create-desc" /></div>

            {/* Row 1: Client, Contact, Device */}
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Client *</Label>
                <Select value={formData.client_id} onValueChange={v => setFormData({ ...formData, client_id: v, contact_id: "", device_id: "" })}>
                  <SelectTrigger data-testid="create-client"><SelectValue placeholder="Select client" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Contact</Label>
                <Select value={formData.contact_id || "none"} onValueChange={v => setFormData({ ...formData, contact_id: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="create-contact"><SelectValue placeholder="Select contact" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-- No specific contact --</SelectItem>
                    {formData.client_id && clients.find(c => c.id === formData.client_id)?.contacts?.map((ct, i) => (
                      <SelectItem key={i} value={ct.name}>{ct.name} ({ct.role || "General"})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Linked Device</Label>
                <Select value={formData.device_id || "none"} onValueChange={v => setFormData({ ...formData, device_id: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="create-device"><SelectValue placeholder="Select device" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-- No device --</SelectItem>
                    {devices.filter(d => !formData.client_id || d.client_id === formData.client_id).map(d => (
                      <SelectItem key={d.id} value={d.id}>{d.name} ({d.os} - {d.ip_address || "No IP"})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Row 2: Type, Category, Source */}
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Ticket Type</Label>
                <Select value={formData.ticket_type} onValueChange={v => setFormData({ ...formData, ticket_type: v })}>
                  <SelectTrigger data-testid="create-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="incident">Incident</SelectItem>
                    <SelectItem value="service_request">Service Request</SelectItem>
                    <SelectItem value="problem">Problem</SelectItem>
                    <SelectItem value="change_request">Change Request</SelectItem>
                    <SelectItem value="alert">Alert / Monitoring</SelectItem>
                    <SelectItem value="task">Task</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Category</Label>
                <Select value={formData.category} onValueChange={v => setFormData({ ...formData, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="support">General Support</SelectItem>
                    <SelectItem value="hardware">Hardware</SelectItem>
                    <SelectItem value="software">Software</SelectItem>
                    <SelectItem value="network">Network</SelectItem>
                    <SelectItem value="security">Security</SelectItem>
                    <SelectItem value="email">Email / O365</SelectItem>
                    <SelectItem value="backup">Backup / DR</SelectItem>
                    <SelectItem value="onboarding">Onboarding / Offboarding</SelectItem>
                    <SelectItem value="project">Project Work</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Source</Label>
                <Select value={formData.source} onValueChange={v => setFormData({ ...formData, source: v })}>
                  <SelectTrigger data-testid="create-source"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portal">Client Portal</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="phone">Phone Call</SelectItem>
                    <SelectItem value="chat">Live Chat</SelectItem>
                    <SelectItem value="monitoring">Monitoring Alert</SelectItem>
                    <SelectItem value="walk_in">Walk-in</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 3: Priority, Impact, Assigned To */}
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Priority</Label>
                <Select value={formData.priority} onValueChange={v => setFormData({ ...formData, priority: v })}>
                  <SelectTrigger data-testid="create-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(priorityConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Impact</Label>
                <Select value={formData.impact} onValueChange={v => setFormData({ ...formData, impact: v })}>
                  <SelectTrigger data-testid="create-impact"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low - Single user</SelectItem>
                    <SelectItem value="medium">Medium - Department</SelectItem>
                    <SelectItem value="high">High - Organization-wide</SelectItem>
                    <SelectItem value="critical">Critical - Business down</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Assign To</Label>
                <Select value={formData.assigned_to || "none"} onValueChange={v => setFormData({ ...formData, assigned_to: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="create-assigned"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-- Unassigned --</SelectItem>
                    {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 4: Due Date, Estimated Hours */}
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Due Date</Label>
                <Input type="date" value={formData.due_date || ""} onChange={e => setFormData({ ...formData, due_date: e.target.value })} data-testid="create-due-date" />
              </div>
              <div><Label>Estimated Hours</Label>
                <Input type="number" step="0.5" value={formData.estimated_hours || ""} onChange={e => setFormData({ ...formData, estimated_hours: e.target.value })} placeholder="e.g. 2.5" data-testid="create-est-hours" />
              </div>
              <div><Label>Parent Ticket</Label>
                <Select value={formData.parent_id || "none"} onValueChange={v => setFormData({ ...formData, parent_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="None (standalone)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (standalone ticket)</SelectItem>
                    {tickets.filter(t => !t.parent_id).slice(0, 30).map(t => <SelectItem key={t.id} value={t.id}>{t.ticket_number} - {t.title?.slice(0, 30)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Tags */}
            <div><Label>Tags</Label>
              <div className="flex gap-2 flex-wrap mb-2">{(formData.tags || []).map(t => (
                <Badge key={t} variant="secondary" className="gap-1">{t}
                  <button className="ml-1 text-xs hover:text-destructive" onClick={() => setFormData({ ...formData, tags: formData.tags.filter(tag => tag !== t) })}>x</button>
                </Badge>
              ))}</div>
              <Input placeholder="Type a tag and press Enter" data-testid="create-tags"
                onKeyDown={e => { if (e.key === "Enter" && e.target.value.trim()) { e.preventDefault(); setFormData({ ...formData, tags: [...(formData.tags || []), e.target.value.trim()] }); e.target.value = ""; } }} />
            </div>
          </div>
          <DialogFooter><Button onClick={handleCreateTicket} data-testid="create-ticket-submit"><Plus className="w-4 h-4 mr-1" />Create Ticket</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
