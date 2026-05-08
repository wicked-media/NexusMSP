import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Siren, X, Clock, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { priorityConfig } from "@/config/ticketConfig";

/**
 * NOC strip — prominently shows team-pinned tickets at the top of the Dashboard.
 * Use case: outage/incident-room ticket flagged so everyone in the team sees it.
 */
export default function TeamPinsStrip() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [pins, setPins] = useState([]);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchPins = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/team-pins`, { headers });
      setPins(r.data?.pins || []);
    } catch (e) { /* silent */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    fetchPins();
    const id = setInterval(fetchPins, 30000); // refresh every 30s
    return () => clearInterval(id);
  }, [fetchPins]);

  const handleUnpin = async (ticketId, pinnedBy) => {
    if (pinnedBy !== user?.id && (user?.role || "").toLowerCase() !== "admin") {
      toast.error("Only the original pinner or an admin can unpin");
      return;
    }
    try {
      await axios.delete(`${API}/team-pins/ticket/${ticketId}`, { headers });
      toast.success("Unpinned from team");
      fetchPins();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to unpin"); }
  };

  if (!pins.length) return null;

  return (
    <Card
      className="border-red-500/40 bg-gradient-to-r from-red-500/10 via-rose-500/5 to-red-500/10 relative overflow-hidden"
      data-testid="team-pins-strip"
    >
      {/* Animated alert stripe */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent animate-pulse" />
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-2 mb-2">
          <Siren className="w-4 h-4 text-red-400 animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-widest text-red-300">
            Team Pinned · NOC Strip
          </span>
          <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-300">
            {pins.length} active
          </Badge>
          <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5" />
            All eyes on these
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {pins.map((p) => (
            <div
              key={p.id}
              className="group relative flex items-start gap-2 px-3 py-2 rounded-md border border-red-500/20 bg-background/40 hover:bg-red-500/5 hover:border-red-500/50 transition-all cursor-pointer"
              onClick={() => navigate(`/tickets?ticket=${p.ticket_number}`)}
              data-testid={`team-pin-${p.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                  <span className="font-mono text-[10px] text-red-300">{p.ticket_number}</span>
                  <Badge className={priorityConfig[p.priority]?.class + " text-[9px]"}>
                    {p.priority}
                  </Badge>
                  <Badge variant="outline" className="text-[9px] capitalize">
                    {p.status?.replace("_", " ")}
                  </Badge>
                </div>
                <p className="text-xs font-medium line-clamp-1">{p.title}</p>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                  {p.client_name && <span>{p.client_name}</span>}
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {p.pinned_at ? formatDistanceToNow(new Date(p.pinned_at), { addSuffix: true }) : ""}
                  </span>
                </div>
                {p.note && (
                  <p className="text-[10px] italic text-red-300/80 mt-1 border-l-2 border-red-500/40 pl-2 line-clamp-1">
                    "{p.note}" — {p.pinned_by_name}
                  </p>
                )}
              </div>
              <Button
                variant="ghost" size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                onClick={(e) => { e.stopPropagation(); handleUnpin(p.id, p.pinned_by); }}
                title={p.pinned_by === user?.id ? "Unpin from team" : "Only original pinner or admin can unpin"}
                data-testid={`team-unpin-${p.id}`}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
