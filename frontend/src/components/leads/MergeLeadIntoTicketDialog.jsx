/* MergeLeadIntoTicketDialog.jsx — picker dialog for merging a lead into an existing ticket. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Loader2, Ticket, AlertTriangle, GitMerge, Building2, ShieldCheck } from "lucide-react";
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
          const needle = q.trim().replace(/^#/, "").toLowerCase();
          const matching = items.filter(ticket => {
            const haystack = [
              ticket.ticket_number,
              ticket.title,
              ticket.client_name,
              ticket.id,
            ].filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(needle);
          });
          setTickets(matching.slice(0, 15));
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
      <DialogContent className="max-w-4xl max-h-[92vh] gap-0 overflow-hidden border-violet-500/25 p-0">
        <DialogHeader className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.18),transparent_42%),linear-gradient(135deg,rgba(23,27,38,0.98),rgba(10,12,17,0.98))] px-6 py-5 pr-14">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-500/10">
              <GitMerge className="h-5 w-5 text-violet-300" />
            </div>
            <div className="space-y-1">
              <DialogTitle>Merge lead into an existing ticket</DialogTitle>
              <DialogDescription>
                Attach the full lead context to an existing service record and retain a clear, technician-attributed audit trail.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid max-h-[calc(92vh-176px)] gap-4 overflow-y-auto px-6 py-5 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-3">
            {lead && (
              <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10">
                  <Building2 className="h-4 w-4 text-violet-300" />
                </div>
                <p className="mt-3 text-sm font-semibold text-zinc-100">{lead.company_name}</p>
                <p className="mt-1 text-[11px] text-zinc-400">{lead.contact_name || "No contact recorded"}</p>
                <p className="break-all text-[10px] text-zinc-500">{lead.email || "No email recorded"}</p>
              </div>
            )}
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              <p className="mt-2 text-xs font-semibold text-zinc-200">Preserved context</p>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">Contact details, notes, and activity history stay connected to the selected ticket.</p>
            </div>
          </aside>

          <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
            <div className="mb-4">
              <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-violet-300">Destination</p>
              <h3 className="mt-1 text-sm font-semibold text-zinc-100">Find the existing ticket</h3>
              <p className="mt-1 text-[11px] text-zinc-500">Search by ticket number, title, or client and confirm the exact record before merging.</p>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-zinc-500" />
              <Input
                className="h-10 pl-9 pr-9 text-xs"
                placeholder="Search ticket number, title, or client…"
                value={q}
                onChange={e => setQ(e.target.value)}
                autoFocus
                data-testid="merge-ticket-search"
              />
              {searching && <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-zinc-500" />}
            </div>
            <div className="mt-3 min-h-44 max-h-[42vh] space-y-1.5 overflow-y-auto pr-1">
              {tickets.length === 0 && q.trim() && !searching && (
                <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-white/[0.08]">
                  <p className="text-[11px] text-zinc-500">No matching tickets found.</p>
                </div>
              )}
              {!q.trim() && (
                <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] text-center">
                  <Search className="h-5 w-5 text-zinc-600" />
                  <p className="mt-2 text-[11px] text-zinc-500">Start typing to search live ticket records.</p>
                </div>
              )}
              {tickets.map(t => {
                const isSel = selected?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelected(t)}
                    data-testid={`merge-ticket-result-${t.id}`}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      isSel ? "border-violet-500 bg-violet-500/10" : "border-zinc-800 bg-zinc-900/40 hover:border-violet-500/40"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-violet-300">#{t.ticket_number || t.id?.slice(0, 8)}</span>
                          <span className="truncate text-xs text-zinc-100">{t.title || "(no title)"}</span>
                        </div>
                        <p className="truncate text-[10px] text-zinc-500">{t.client_name || "—"} · {t.status || ""} · {t.priority || ""}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {selected && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[10px] text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Lead context will be appended as an internal comment and the lead will move to <strong>Won</strong>.</span>
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="items-center gap-3 border-t border-white/[0.08] bg-black/20 px-6 py-4 sm:justify-between sm:space-x-0">
          <p className="text-left text-[11px] text-zinc-500">
            {selected ? `Selected ticket #${selected.ticket_number || selected.id?.slice(0, 8)}` : "Select a destination ticket to continue."}
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={merging}>Cancel</Button>
            <Button
              onClick={merge}
              disabled={!selected || merging}
              className="min-w-40 bg-violet-600 hover:bg-violet-500"
              data-testid="confirm-merge-into-ticket"
            >
              {merging ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <GitMerge className="mr-1.5 h-3.5 w-3.5" />}
              Merge into ticket
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
