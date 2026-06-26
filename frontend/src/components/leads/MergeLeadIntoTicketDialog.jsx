/* MergeLeadIntoTicketDialog.jsx — picker dialog for merging a lead into an existing ticket. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Loader2, Ticket, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function MergeLeadIntoTicketDialog({ open, onClose, lead, onMerged }) {
  const { token } = useAuth();
  const [q, setQ] = useState("");
  const [tickets, setTickets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [merging, setMerging] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) { setQ(""); setTickets([]); setSelected(null); }
  }, [open]);

  useEffect(() => {
    if (!open || !q.trim()) { setTickets([]); return; }
    setSearching(true);
    const id = setTimeout(() => {
      const isNum = /^#?(\d+)/.exec(q.trim());
      const params = isNum
        ? { ticket_number: isNum[1] }
        : { q: q.trim(), limit: 15 };
      axios.get(`${API}/tickets`, { headers: { Authorization: `Bearer ${token}` }, params })
        .then(r => {
          const items = Array.isArray(r.data) ? r.data : (r.data?.items || r.data?.tickets || []);
          setTickets(items.slice(0, 15));
        })
        .catch(() => setTickets([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(id);
  }, [q, open, token]);

  const merge = async () => {
    if (!lead?.id || !selected?.id) return;
    setMerging(true);
    try {
      const r = await axios.post(
        `${API}/leads/${lead.id}/merge-into-ticket`,
        { ticket_id: selected.id },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success(`Merged into ticket #${r.data?.ticket_number || selected.id.slice(0, 8)}`);
      onMerged && onMerged(r.data);
      onClose && onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Merge failed");
    } finally { setMerging(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose && onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Merge lead into ticket</DialogTitle>
        </DialogHeader>
        {lead && (
          <div className="bg-violet-500/5 border border-violet-500/30 rounded p-2 text-xs">
            <p className="text-violet-300 font-semibold">{lead.company_name}</p>
            <p className="text-zinc-400 text-[11px]">{lead.contact_name} · {lead.email}</p>
          </div>
        )}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-500" />
          <Input
            className="pl-8 text-xs"
            placeholder="Search by ticket # (e.g. 12345) or title/client..."
            value={q}
            onChange={e => setQ(e.target.value)}
            autoFocus
            data-testid="merge-ticket-search"
          />
          {searching && <Loader2 className="w-3 h-3 animate-spin absolute right-3 top-3 text-zinc-500" />}
        </div>
        <div className="max-h-[50vh] overflow-y-auto space-y-1">
          {tickets.length === 0 && q.trim() && !searching && (
            <p className="text-[11px] text-zinc-500 px-1 py-3 text-center">No tickets found.</p>
          )}
          {!q.trim() && (
            <p className="text-[11px] text-zinc-500 px-1 py-3 text-center">Start typing to find a ticket.</p>
          )}
          {tickets.map(t => {
            const isSel = selected?.id === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSelected(t)}
                data-testid={`merge-ticket-result-${t.id}`}
                className={`w-full text-left p-2 rounded border transition-colors ${
                  isSel ? "border-violet-500 bg-violet-500/10" : "border-zinc-800 bg-zinc-900/40 hover:border-violet-500/40"
                }`}
              >
                <div className="flex items-start gap-2">
                  <Ticket className="w-3.5 h-3.5 text-violet-300 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-violet-300">#{t.ticket_number || t.id?.slice(0, 8)}</span>
                      <span className="text-xs text-zinc-100 truncate">{t.title || "(no title)"}</span>
                    </div>
                    <p className="text-[10px] text-zinc-500 truncate">{t.client_name || "—"} · {t.status || ""} · {t.priority || ""}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {selected && (
          <div className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded p-2 flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>Lead context (notes, activities, contact info) will be appended as an internal comment. Lead status will move to <strong>Won</strong>.</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={merging}>Cancel</Button>
          <Button
            onClick={merge}
            disabled={!selected || merging}
            className="bg-violet-600 hover:bg-violet-500"
            data-testid="confirm-merge-into-ticket"
          >
            {merging ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            Merge into ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
