import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Crown, Calendar, Coffee, AlertTriangle, Clock, DollarSign, User, Loader2 } from "lucide-react";

/** VIP whisper rail — a small right-column card showing rich context on a contact. */
export function WhisperRail({ email }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!email) return;
    setLoading(true); setErr(null);
    axios.get(`${API}/whisper/contact?email=${encodeURIComponent(email)}`, { headers })
      .then((r) => setData(r.data?.contact && r.data?.client ? r.data : null))
      .catch((e) => setErr(e.response?.status === 404 ? "not-found" : "error"))
      .finally(() => setLoading(false));
  }, [email, headers]);

  if (!email) return null;
  if (loading) return <div className="rounded-xl border border-zinc-800 p-3 text-xs text-muted-foreground" data-testid="whisper-rail-loading"><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Reading relationship…</div>;
  if (err === "not-found" || !data) return null;

  const { contact, client, recent_tickets = [], finance = {}, churn, escalations_ever = 0, preferred_tech } = data;
  const isVip = contact.is_vip;

  return (
    <div className={`rounded-xl border ${isVip ? "border-amber-500/40 bg-amber-500/5" : "border-zinc-800 bg-zinc-900/40"} p-3 space-y-3`} data-testid="whisper-rail">
      {isVip && (
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-amber-400">
          <Crown className="w-3.5 h-3.5" /> VIP Contact · handle with care
        </div>
      )}
      <div>
        <div className="text-sm font-medium">{contact.name}</div>
        <div className="text-[10px] text-muted-foreground">{contact.role || "—"} · {client.name}</div>
        {client.tier && <Badge variant="outline" className="text-[9px] mt-1">{client.tier}</Badge>}
      </div>

      {churn?.score !== null && churn?.score !== undefined && (
        <div className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1.5">
          <span className="flex items-center gap-1 text-muted-foreground"><AlertTriangle className="w-3 h-3" /> Churn risk</span>
          <Badge variant="outline" className={`text-[9px] ${churn.band === "critical" ? "text-rose-400 border-rose-500/30" : churn.band === "high" ? "text-amber-400 border-amber-500/30" : "text-emerald-400 border-emerald-500/30"}`}>
            {churn.score} · {churn.band}
          </Badge>
        </div>
      )}

      {(finance.overdue > 0 || finance.unpaid > 0) && (
        <div className="flex items-center justify-between text-xs bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1.5">
          <span className="flex items-center gap-1 text-rose-300"><DollarSign className="w-3 h-3" /> Finance</span>
          <span className="text-rose-300 text-[10px]">
            {finance.overdue > 0 && `${finance.overdue} overdue · $${finance.total_overdue.toLocaleString()}`}
            {finance.overdue === 0 && finance.unpaid > 0 && `${finance.unpaid} unpaid`}
          </span>
        </div>
      )}

      {preferred_tech && (
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-muted-foreground"><User className="w-3 h-3" />Preferred tech</span>
          <span>{preferred_tech}</span>
        </div>
      )}

      {escalations_ever > 0 && (
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-muted-foreground"><Clock className="w-3 h-3" />Past escalations</span>
          <span>{escalations_ever}</span>
        </div>
      )}

      {recent_tickets?.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Recent tickets</div>
          <div className="space-y-0.5">
            {recent_tickets.slice(0, 3).map((t) => (
              <div key={t.id} className="text-[11px] flex items-center gap-1 truncate">
                <span className="font-mono text-muted-foreground">#{t.ticket_number}</span>
                <span className="truncate">{t.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(contact.birthday || contact.preferred_drink) && (
        <div className="pt-2 border-t border-zinc-800 space-y-1">
          {contact.birthday && <div className="text-[10px] flex items-center gap-1 text-muted-foreground"><Calendar className="w-3 h-3" />Birthday: {contact.birthday}</div>}
          {contact.preferred_drink && <div className="text-[10px] flex items-center gap-1 text-muted-foreground"><Coffee className="w-3 h-3" />{contact.preferred_drink}</div>}
        </div>
      )}

      {contact.notes && (
        <div className="text-[11px] text-muted-foreground italic pt-2 border-t border-zinc-800">"{contact.notes}"</div>
      )}
    </div>
  );
}
