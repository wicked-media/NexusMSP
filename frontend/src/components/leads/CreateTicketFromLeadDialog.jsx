/* CreateTicketFromLeadDialog.jsx — wraps existing /api/leads/{id}/create-ticket endpoint with a richer UI. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_FORM = { title: "", description: "", priority: "medium", category: "sales" };

export default function CreateTicketFromLeadDialog({ open, onClose, lead, onCreated }) {
  const { token } = useAuth();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !lead) return;
    const lines = [
      `Lead: ${lead.company_name || "—"}`,
      `Contact: ${lead.contact_name || "—"}${lead.title ? ` (${lead.title})` : ""}`,
      `Email: ${lead.email || "—"}`,
      `Phone: ${lead.phone || "—"}`,
      lead.website ? `Website: ${lead.website}` : null,
      lead.estimated_value ? `Estimated value: $${Number(lead.estimated_value).toLocaleString()}` : null,
      lead.source ? `Source: ${lead.source}` : null,
      "",
      lead.notes ? `Notes:\n${lead.notes}` : "",
    ].filter(Boolean).join("\n");
    setForm({
      title: `${lead.company_name || "Lead"} — initial engagement`,
      description: lines,
      priority: "medium",
      category: "sales",
    });
  }, [open, lead]);

  const submit = async () => {
    if (!lead?.id || !form.title.trim()) return;
    setBusy(true);
    try {
      const r = await axios.post(
        `${API}/leads/${lead.id}/create-ticket`,
        form,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success(`Ticket created${r.data?.ticket_number ? ` #${r.data.ticket_number}` : ""}`);
      onCreated && onCreated(r.data);
      onClose && onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to create ticket");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose && onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Ticket className="w-4 h-4 text-violet-300" />Create ticket from lead</DialogTitle>
        </DialogHeader>
        {lead && (
          <div className="bg-violet-500/5 border border-violet-500/30 rounded p-2 text-xs">
            <p className="text-violet-300 font-semibold">{lead.company_name}</p>
            <p className="text-zinc-400 text-[11px]">{lead.contact_name} · {lead.email}</p>
          </div>
        )}
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400">Title</label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="text-xs" data-testid="create-ticket-title" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400">Description</label>
            <Textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={8}
              className="text-xs font-mono"
              data-testid="create-ticket-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-400">Priority</label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger className="text-xs h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-400">Category</label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger className="text-xs h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales">Sales</SelectItem>
                  <SelectItem value="support">Support</SelectItem>
                  <SelectItem value="onboarding">Onboarding</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={!form.title.trim() || busy} className="bg-violet-600 hover:bg-violet-500" data-testid="confirm-create-ticket">
            {busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Ticket className="w-3 h-3 mr-1" />}
            Create ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
