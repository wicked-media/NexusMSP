import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Clock, MessageSquare, Plus, Shuffle, Heart, CheckCircle, Activity,
} from "lucide-react";
import { toast } from "sonner";

const ICONS = {
  plus: Plus, message: MessageSquare, shuffle: Shuffle, clock: Clock, heart: Heart, check: CheckCircle,
};
const TONE = {
  created: "text-sky-400 border-sky-500/40 bg-sky-500/5",
  comment: "text-foreground border-border/40",
  internal_note: "text-amber-400 border-amber-500/40 bg-amber-500/5",
  status_change: "text-violet-400 border-violet-500/40 bg-violet-500/5",
  audit: "text-muted-foreground border-border/40",
  time_entry: "text-emerald-400 border-emerald-500/40 bg-emerald-500/5",
  sentiment: "text-rose-400 border-rose-500/40 bg-rose-500/5",
  resolved: "text-emerald-400 border-emerald-500/40 bg-emerald-500/5",
};

/** Time-machine tab — chronological replay of every event on a ticket. */
export function TicketTimelineTab({ ticketId }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let m = true;
    setLoading(true);
    axios.get(`${API}/tickets/${ticketId}/timeline`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { if (m) setData(r.data); })
      .catch((e) => toast.error(e.response?.data?.detail || e.message))
      .finally(() => m && setLoading(false));
    return () => { m = false; };
  }, [ticketId, token]);

  if (loading) return <div className="py-10 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading timeline…</div>;
  if (!data) return null;

  const { events = [], stats = {} } = data;

  return (
    <Card className="mt-2" data-testid="ticket-timeline-tab">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-violet-400" />Time Machine</CardTitle>
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          <Badge variant="outline">{stats.total_events} events</Badge>
          <Badge variant="outline">{stats.comments} comments</Badge>
          <Badge variant="outline" className="text-violet-400 border-violet-500/40">{stats.status_changes} status changes</Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">{stats.time_entries} time logs</Badge>
          {stats.sentiment_lows > 0 && <Badge variant="outline" className="text-rose-400 border-rose-500/40">{stats.sentiment_lows} escalations</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? <div className="text-center py-8 text-sm text-muted-foreground">No events recorded yet.</div> :
          <div className="relative pl-6">
            <div className="absolute left-2 top-2 bottom-2 w-px bg-border/40" />
            {events.map((e, i) => {
              const Icon = ICONS[e.icon] || Activity;
              const tone = TONE[e.type] || TONE.audit;
              return (
                <div key={`k-${i}`} className="relative pb-3" data-testid={`timeline-event-${i}`}>
                  <div className={`absolute -left-[18px] top-1 w-4 h-4 rounded-full border-2 ${tone} flex items-center justify-center bg-background`}>
                    <Icon className="w-2.5 h-2.5" />
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono">{(e.ts || "").slice(0, 19).replace("T", " ")}</div>
                  <div className={`text-xs leading-relaxed border-l-2 pl-3 mt-0.5 ${tone}`}>
                    <div className="font-medium">{e.label}</div>
                    <div className="text-[10px] text-muted-foreground">{e.actor}</div>
                  </div>
                </div>
              );
            })}
          </div>
        }
      </CardContent>
    </Card>
  );
}
