import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Kanban, GripVertical } from "lucide-react";
import { toast } from "sonner";

export default function KanbanTicketsPage() {
  const { token } = useAuth();
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try { const res = await axios.get(`${API}/kanban-tickets/board`, { headers }); setBoard(res.data); } catch (e) { toast.error("Failed"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  const handleMove = async (ticketId, newStatus) => {
    try { await axios.put(`${API}/kanban-tickets/move`, { ticket_id: ticketId, new_status: newStatus }, { headers }); toast.success("Ticket moved"); } catch (e) { toast.error("Failed"); }
  };

  if (loading || !board) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const colColor = { open: "border-t-blue-500", in_progress: "border-t-amber-500", waiting: "border-t-purple-500", resolved: "border-t-emerald-500", closed: "border-t-gray-500" };
  const prioColor = { critical: "destructive", high: "warning", medium: "secondary", low: "outline" };

  return (
    <div className="space-y-6" data-testid="kanban-tickets-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Kanban Board</h1><p className="text-muted-foreground text-sm mt-1">Visual ticket management — {board.total_tickets} tickets</p></div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 min-h-[60vh]">
        {board.columns.map(col => (
          <div key={col.id} className={`rounded-lg border border-t-4 ${colColor[col.id] || "border-t-primary"} bg-muted/20`}>
            <div className="p-3 border-b flex items-center justify-between">
              <h3 className="font-semibold text-sm">{col.title}</h3>
              <Badge variant="outline">{col.tickets.length}</Badge>
            </div>
            <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
              {col.tickets.slice(0, 20).map(t => (
                <div key={t.id} className="p-3 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-grab" data-testid={`kanban-ticket-${t.id}`}>
                  <div className="flex items-center gap-1 mb-1"><Badge variant={prioColor[t.priority]} className="text-[9px]">{t.priority}</Badge>{t.ticket_number && <span className="text-[10px] font-mono text-muted-foreground">{t.ticket_number}</span>}</div>
                  <p className="text-xs font-medium line-clamp-2">{t.title}</p>
                  <div className="flex items-center justify-between mt-2"><span className="text-[10px] text-muted-foreground truncate max-w-[80%]">{t.client_name}</span>{t.assigned_to && <span className="text-[10px] text-primary">{t.assigned_to.split(" ")[0]}</span>}</div>
                </div>
              ))}
              {col.tickets.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No tickets</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
