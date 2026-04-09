import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Kanban, GripVertical, Search, RefreshCw, Loader2, Clock, AlertTriangle,
  User as UserIcon, Filter, ChevronDown, ArrowUpRight, Eye, MoreHorizontal
} from "lucide-react";

const COLUMNS = [
  { id: "open", title: "Open", color: "border-t-blue-500", bg: "bg-blue-500", dotColor: "bg-blue-400" },
  { id: "in_progress", title: "In Progress", color: "border-t-amber-500", bg: "bg-amber-500", dotColor: "bg-amber-400" },
  { id: "waiting", title: "Waiting", color: "border-t-purple-500", bg: "bg-purple-500", dotColor: "bg-purple-400" },
  { id: "resolved", title: "Resolved", color: "border-t-emerald-500", bg: "bg-emerald-500", dotColor: "bg-emerald-400" },
  { id: "closed", title: "Closed", color: "border-t-zinc-500", bg: "bg-zinc-500", dotColor: "bg-zinc-400" },
];

const prioStyle = {
  critical: { badge: "bg-red-500/20 text-red-400 border-red-500/30", dot: "bg-red-500" },
  high: { badge: "bg-orange-500/20 text-orange-400 border-orange-500/30", dot: "bg-orange-500" },
  medium: { badge: "bg-blue-500/20 text-blue-400 border-blue-500/30", dot: "bg-blue-500" },
  low: { badge: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30", dot: "bg-zinc-500" },
};

function SlaIndicator({ ticket }) {
  const slaDue = ticket.sla_due || ticket.due_date;
  if (!slaDue) return null;
  const now = new Date();
  const due = new Date(slaDue);
  const hoursLeft = (due - now) / 3600000;
  if (hoursLeft < 0) return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[9px] px-1 py-0"><AlertTriangle className="w-2.5 h-2.5 mr-0.5" />Breached</Badge>;
  if (hoursLeft < 4) return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px] px-1 py-0"><Clock className="w-2.5 h-2.5 mr-0.5" />{Math.ceil(hoursLeft)}h</Badge>;
  return null;
}

function TicketCard({ ticket, onDragStart }) {
  const prio = prioStyle[ticket.priority] || prioStyle.medium;
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, ticket)}
      className="p-3 rounded-lg border bg-card hover:bg-card/80 hover:shadow-md transition-all cursor-grab active:cursor-grabbing active:shadow-lg active:scale-[1.02] group"
      data-testid={`kanban-card-${ticket.id}`}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <GripVertical className="w-3 h-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
        <Badge className={`${prio.badge} text-[9px] px-1.5 py-0`}>{ticket.priority}</Badge>
        <SlaIndicator ticket={ticket} />
        {ticket.ticket_number && <span className="text-[10px] font-mono text-muted-foreground ml-auto">{ticket.ticket_number}</span>}
      </div>
      <p className="text-xs font-medium line-clamp-2 mb-2">{ticket.title}</p>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground truncate max-w-[60%]">{ticket.client_name}</span>
        {ticket.assigned_to_name && (
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-[8px] font-medium text-primary">{ticket.assigned_to_name?.charAt(0)}</span>
            </div>
            <span className="text-[10px] text-primary">{ticket.assigned_to_name?.split(" ")[0]}</span>
          </div>
        )}
      </div>
      {ticket.tags?.length > 0 && (
        <div className="flex gap-1 mt-1.5 flex-wrap">
          {ticket.tags.slice(0, 3).map(tag => <span key={tag} className="text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground">{tag}</span>)}
        </div>
      )}
    </div>
  );
}

function Column({ col, tickets, onDrop, onDragStart, dragOverCol, setDragOverCol }) {
  return (
    <div
      className={`rounded-lg border border-t-4 ${col.color} bg-muted/10 flex flex-col min-h-[60vh] transition-all ${dragOverCol === col.id ? "ring-2 ring-primary/30 bg-primary/5" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id); }}
      onDragLeave={() => setDragOverCol(null)}
      onDrop={(e) => { e.preventDefault(); setDragOverCol(null); onDrop(col.id); }}
      data-testid={`kanban-col-${col.id}`}
    >
      <div className="p-3 border-b flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${col.dotColor}`} />
          <h3 className="font-semibold text-sm">{col.title}</h3>
        </div>
        <Badge variant="outline" className="text-xs">{tickets.length}</Badge>
      </div>
      <div className="p-2 space-y-2 flex-1 overflow-y-auto max-h-[65vh]">
        {tickets.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-xs text-muted-foreground/50 border border-dashed rounded-lg">
            Drop here
          </div>
        ) : (
          tickets.map(t => <TicketCard key={t.id} ticket={t} onDragStart={onDragStart} />)
        )}
      </div>
    </div>
  );
}

export default function KanbanTicketsPage() {
  const { token } = useAuth();
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [prioFilter, setPrioFilter] = useState("all");
  const [dragOverCol, setDragOverCol] = useState(null);
  const [draggingTicket, setDraggingTicket] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchBoard = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/kanban-tickets/board`, { headers });
      setBoard(res.data);
    } catch { toast.error("Failed to load board"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchBoard(); }, []);

  const handleDragStart = (e, ticket) => {
    setDraggingTicket(ticket);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ticket.id);
  };

  const handleDrop = async (newStatus) => {
    if (!draggingTicket) return;
    const oldStatus = draggingTicket.status;
    if (oldStatus === newStatus) { setDraggingTicket(null); return; }

    // Optimistic update
    setBoard(prev => {
      if (!prev) return prev;
      const updated = { ...prev, columns: prev.columns.map(col => {
        if (col.id === oldStatus) return { ...col, tickets: col.tickets.filter(t => t.id !== draggingTicket.id) };
        if (col.id === newStatus) return { ...col, tickets: [{ ...draggingTicket, status: newStatus }, ...col.tickets] };
        return col;
      })};
      return updated;
    });

    try {
      await axios.put(`${API}/kanban-tickets/move`, { ticket_id: draggingTicket.id, new_status: newStatus }, { headers });
      toast.success(`Moved to ${newStatus.replace("_", " ")}`);
    } catch {
      toast.error("Failed to move ticket");
      fetchBoard(); // Revert
    }
    setDraggingTicket(null);
  };

  if (loading || !board) return (
    <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  );

  // Filter tickets in each column
  const filterTickets = (tickets) => {
    return tickets.filter(t => {
      if (prioFilter !== "all" && t.priority !== prioFilter) return false;
      if (search && !t.title?.toLowerCase().includes(search.toLowerCase()) && !t.ticket_number?.toLowerCase().includes(search.toLowerCase()) && !t.client_name?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  };

  const totalFiltered = board.columns.reduce((sum, col) => sum + filterTickets(col.tickets).length, 0);

  return (
    <div className="space-y-4" data-testid="kanban-tickets-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Kanban className="w-6 h-6 text-primary" />Ticket Board
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">{totalFiltered} tickets &middot; Drag cards between columns to update status</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchBoard} disabled={loading} data-testid="refresh-board">
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search tickets..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" data-testid="kanban-search" />
        </div>
        <Select value={prioFilter} onValueChange={setPrioFilter}>
          <SelectTrigger className="w-[140px] h-9" data-testid="kanban-prio-filter"><Filter className="w-3 h-3 mr-1" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Board */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {board.columns.map(col => (
          <Column
            key={col.id}
            col={COLUMNS.find(c => c.id === col.id) || { ...col, color: "border-t-primary", dotColor: "bg-primary" }}
            tickets={filterTickets(col.tickets)}
            onDrop={handleDrop}
            onDragStart={handleDragStart}
            dragOverCol={dragOverCol}
            setDragOverCol={setDragOverCol}
          />
        ))}
      </div>
    </div>
  );
}
