import { useState, useEffect } from "react";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { 
  Plus, Search, MoreVertical, Clock, AlertCircle, CheckCircle, Circle, Loader2, 
  Ticket, MessageSquare, Mail, Send, User, X, ArrowLeft, StickyNote
} from "lucide-react";
import { format, formatDistanceToNow, differenceInHours } from "date-fns";

const priorityConfig = {
  critical: { label: "Critical", class: "bg-red-500 text-white" },
  high: { label: "High", class: "bg-orange-500 text-white" },
  medium: { label: "Medium", class: "bg-yellow-500 text-white" },
  low: { label: "Low", class: "bg-gray-500 text-white" }
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
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [viewingTicket, setViewingTicket] = useState(null);
  const [ticketNotes, setTicketNotes] = useState([]);
  const [ticketEmails, setTicketEmails] = useState([]);
  const [newNote, setNewNote] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [emailSignature, setEmailSignature] = useState("");
  const [emailForm, setEmailForm] = useState({ to: "", subject: "", body: "" });
  const [formData, setFormData] = useState({
    title: "", description: "", client_id: "", priority: "medium", category: "support", assigned_to: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ticketsRes, clientsRes, usersRes] = await Promise.all([
        axios.get(`${API}/tickets`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/users`, { headers })
      ]);
      setTickets(ticketsRes.data);
      setClients(clientsRes.data);
      setUsers(usersRes.data);
      
      // Load user's email signature
      const currentUser = usersRes.data.find(u => u.id === user?.id);
      if (currentUser?.email_signature) {
        setEmailSignature(currentUser.email_signature);
      }
    } catch (error) {
      toast.error("Failed to fetch tickets");
    } finally {
      setLoading(false);
    }
  };

  const fetchTicketDetails = async (ticketId) => {
    try {
      const [notesRes, emailsRes] = await Promise.all([
        axios.get(`${API}/tickets/${ticketId}/comments`, { headers }),
        axios.get(`${API}/tickets/${ticketId}/emails`, { headers })
      ]);
      setTicketNotes(notesRes.data);
      setTicketEmails(emailsRes.data);
    } catch (error) {
      console.error("Failed to fetch ticket details");
    }
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (viewingTicket) {
      fetchTicketDetails(viewingTicket.id);
      // Set default email recipient to client email
      const client = clients.find(c => c.id === viewingTicket.client_id);
      if (client?.email) {
        setEmailForm(prev => ({ ...prev, to: client.email, subject: `Re: [${viewingTicket.ticket_number}] ${viewingTicket.title}` }));
      }
    }
  }, [viewingTicket]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (selectedTicket) {
        await axios.put(`${API}/tickets/${selectedTicket.id}`, formData, { headers });
        toast.success("Ticket updated");
      } else {
        await axios.post(`${API}/tickets`, formData, { headers });
        toast.success("Ticket created");
      }
      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error) {
      toast.error("Failed to save ticket");
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/comments`, {
        content: newNote,
        is_internal: isInternalNote
      }, { headers });
      toast.success("Note added");
      setNewNote("");
      fetchTicketDetails(viewingTicket.id);
    } catch (error) {
      toast.error("Failed to add note");
    }
  };

  const handleSendEmail = async () => {
    if (!emailForm.to || !emailForm.body) {
      toast.error("Please fill in recipient and message");
      return;
    }
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/emails`, {
        to_addresses: [emailForm.to],
        subject: emailForm.subject,
        body: emailForm.body + (emailSignature ? `\n\n${emailSignature}` : "")
      }, { headers });
      toast.success("Email sent");
      setIsEmailDialogOpen(false);
      setEmailForm({ to: emailForm.to, subject: emailForm.subject, body: "" });
      fetchTicketDetails(viewingTicket.id);
    } catch (error) {
      toast.error("Failed to send email");
    }
  };

  const updateTicketStatus = async (ticketId, status) => {
    try {
      await axios.put(`${API}/tickets/${ticketId}`, { status }, { headers });
      toast.success("Status updated");
      fetchData();
      if (viewingTicket?.id === ticketId) {
        setViewingTicket({ ...viewingTicket, status });
      }
    } catch (error) {
      toast.error("Failed to update status");
    }
  };

  const resetForm = () => {
    setFormData({ title: "", description: "", client_id: "", priority: "medium", category: "support", assigned_to: "" });
    setSelectedTicket(null);
  };

  const openTicket = (ticket) => {
    setViewingTicket(ticket);
  };

  const filteredTickets = tickets.filter(t => {
    const matchesSearch = t.title.toLowerCase().includes(searchQuery.toLowerCase()) || t.ticket_number?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || t.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Ticket Detail View
  if (viewingTicket) {
    return (
      <div className="space-y-6" data-testid="ticket-detail-view">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setViewingTicket(null)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="font-mono">{viewingTicket.ticket_number}</Badge>
              <h1 className="text-2xl font-bold">{viewingTicket.title}</h1>
            </div>
            <p className="text-muted-foreground">{viewingTicket.client_name}</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={viewingTicket.status} onValueChange={(v) => updateTicketStatus(viewingTicket.id, v)}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Badge className={priorityConfig[viewingTicket.priority]?.class}>{priorityConfig[viewingTicket.priority]?.label}</Badge>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="col-span-2 space-y-6">
            {/* Description */}
            <Card>
              <CardHeader><CardTitle className="text-lg">Description</CardTitle></CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap">{viewingTicket.description || "No description provided"}</p>
              </CardContent>
            </Card>

            {/* Notes & Activity */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Notes & Activity</CardTitle>
                  <Dialog open={isEmailDialogOpen} onOpenChange={setIsEmailDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm"><Mail className="w-4 h-4 mr-2" />Send Email</Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader><DialogTitle>Send Email from Ticket</DialogTitle></DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>To</Label>
                          <Input value={emailForm.to} onChange={(e) => setEmailForm({...emailForm, to: e.target.value})} placeholder="email@example.com" />
                        </div>
                        <div className="space-y-2">
                          <Label>Subject</Label>
                          <Input value={emailForm.subject} onChange={(e) => setEmailForm({...emailForm, subject: e.target.value})} />
                        </div>
                        <div className="space-y-2">
                          <Label>Message</Label>
                          <Textarea value={emailForm.body} onChange={(e) => setEmailForm({...emailForm, body: e.target.value})} rows={6} placeholder="Type your message..." />
                        </div>
                        {emailSignature && (
                          <div className="p-3 bg-muted/50 rounded-lg">
                            <p className="text-xs text-muted-foreground mb-1">Your signature will be added:</p>
                            <p className="text-sm whitespace-pre-wrap">{emailSignature}</p>
                          </div>
                        )}
                        <DialogFooter>
                          <Button onClick={handleSendEmail}><Send className="w-4 h-4 mr-2" />Send Email</Button>
                        </DialogFooter>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Add Note */}
                <div className="space-y-2">
                  <Textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add a note..." rows={3} />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={isInternalNote} onChange={(e) => setIsInternalNote(e.target.checked)} className="rounded" />
                      Internal note (not visible to client)
                    </label>
                    <Button size="sm" onClick={handleAddNote} disabled={!newNote.trim()}>
                      <StickyNote className="w-4 h-4 mr-2" />Add Note
                    </Button>
                  </div>
                </div>

                <Separator />

                {/* Activity Feed */}
                <ScrollArea className="h-[400px]">
                  <div className="space-y-4">
                    {/* Combine notes and emails, sort by date */}
                    {[...ticketNotes.map(n => ({...n, type: 'note'})), ...ticketEmails.map(e => ({...e, type: 'email'}))]
                      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                      .map((item, idx) => (
                        <div key={idx} className={`p-4 rounded-lg border ${item.type === 'email' ? 'bg-blue-500/5 border-blue-500/20' : item.is_internal ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-muted/30'}`}>
                          <div className="flex items-center gap-2 mb-2">
                            {item.type === 'email' ? <Mail className="w-4 h-4 text-blue-500" /> : <MessageSquare className="w-4 h-4" />}
                            <span className="font-medium text-sm">{item.user_name || item.from_name || 'System'}</span>
                            {item.is_internal && <Badge variant="outline" className="text-xs">Internal</Badge>}
                            {item.type === 'email' && <Badge variant="outline" className="text-xs text-blue-500">Email</Badge>}
                            <span className="text-xs text-muted-foreground ml-auto">
                              {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                            </span>
                          </div>
                          {item.type === 'email' && <p className="text-xs text-muted-foreground mb-1">To: {item.to_addresses?.join(', ')}</p>}
                          <p className="text-sm whitespace-pre-wrap">{item.content || item.body}</p>
                        </div>
                      ))}
                    {ticketNotes.length === 0 && ticketEmails.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">No activity yet</div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Details</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Assigned To</span><span>{viewingTicket.assigned_name || 'Unassigned'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Category</span><span className="capitalize">{viewingTicket.category}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{format(new Date(viewingTicket.created_at), 'MMM d, yyyy')}</span></div>
                {viewingTicket.sla_due && (
                  <div className="flex justify-between"><span className="text-muted-foreground">SLA Due</span><span>{format(new Date(viewingTicket.sla_due), 'MMM d, h:mm a')}</span></div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Email Signature</CardTitle></CardHeader>
              <CardContent>
                <Textarea 
                  value={emailSignature} 
                  onChange={(e) => setEmailSignature(e.target.value)} 
                  placeholder="Set your email signature..."
                  rows={4}
                  className="text-sm"
                />
                <Button size="sm" className="mt-2 w-full" variant="outline" onClick={async () => {
                  try {
                    await axios.put(`${API}/users/${user?.id}`, { email_signature: emailSignature }, { headers });
                    toast.success("Signature saved");
                  } catch (e) { toast.error("Failed to save"); }
                }}>Save Signature</Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Tickets List View
  return (
    <div className="space-y-6" data-testid="tickets-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tickets</h1>
          <p className="text-muted-foreground">Manage support tickets</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Ticket</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{selectedTicket ? "Edit Ticket" : "Create Ticket"}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Title *</Label>
                <Input value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} required />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={4} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Client *</Label>
                  <Select value={formData.client_id} onValueChange={(v) => setFormData({...formData, client_id: v})}>
                    <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                    <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={formData.priority} onValueChange={(v) => setFormData({...formData, priority: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="critical">Critical</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={formData.category} onValueChange={(v) => setFormData({...formData, category: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="support">Support</SelectItem>
                      <SelectItem value="infrastructure">Infrastructure</SelectItem>
                      <SelectItem value="network">Network</SelectItem>
                      <SelectItem value="hardware">Hardware</SelectItem>
                      <SelectItem value="software">Software</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Assign To</Label>
                  <Select value={formData.assigned_to || "unassigned"} onValueChange={(v) => setFormData({...formData, assigned_to: v === "unassigned" ? "" : v})}>
                    <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter><Button type="submit">{selectedTicket ? "Update" : "Create"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search tickets..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tickets Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>
          ) : filteredTickets.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTickets.map(ticket => (
                  <TableRow key={ticket.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openTicket(ticket)}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{ticket.title}</p>
                        <p className="text-xs text-muted-foreground font-mono">{ticket.ticket_number}</p>
                      </div>
                    </TableCell>
                    <TableCell>{ticket.client_name}</TableCell>
                    <TableCell><Badge className={priorityConfig[ticket.priority]?.class}>{priorityConfig[ticket.priority]?.label}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className={statusConfig[ticket.status]?.class}>{statusConfig[ticket.status]?.label}</Badge></TableCell>
                    <TableCell>{ticket.assigned_name || '-'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center h-64">
              <Ticket className="w-12 h-12 text-muted-foreground opacity-50 mb-4" />
              <p className="text-muted-foreground">No tickets found</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
