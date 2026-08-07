/* CreateTicketFromLeadDialog.jsx — wraps existing /api/leads/{id}/create-ticket endpoint with a richer UI. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Ticket, Building2, ArrowRight, ShieldCheck } from "lucide-react";
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
      <DialogContent className="max-w-4xl max-h-[92vh] gap-0 overflow-hidden border-violet-500/25 p-0">
        <DialogHeader className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.18),transparent_42%),linear-gradient(135deg,rgba(23,27,38,0.98),rgba(10,12,17,0.98))] px-6 py-5 pr-14">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-500/10">
              <Ticket className="h-5 w-5 text-violet-300" />
            </div>
            <div className="space-y-1">
              <DialogTitle>Create ticket from lead</DialogTitle>
              <DialogDescription>
                Hand this opportunity to service delivery without losing its source, contact, qualification notes, or audit trail.
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
                <div className="mt-4 flex items-center gap-2 border-t border-white/[0.08] pt-3 text-[10px] uppercase tracking-[0.14em] text-violet-200">
                  Lead
                  <ArrowRight className="h-3 w-3" />
                  Service ticket
                </div>
              </div>
            )}
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              <p className="mt-2 text-xs font-semibold text-zinc-200">Auditable hand-off</p>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                Nexus links the resulting ticket back to this lead and retains the original context for reporting and review.
              </p>
            </div>
          </aside>

          <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
            <div className="mb-4">
              <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-violet-300">Ticket brief</p>
              <h3 className="mt-1 text-sm font-semibold text-zinc-100">Review the service record</h3>
              <p className="mt-1 text-[11px] text-zinc-500">Adjust the generated details before creating the linked ticket.</p>
            </div>
            <div className="space-y-3">
              <div>
                <label htmlFor="lead-ticket-title" className="text-[10px] uppercase tracking-wider text-zinc-400">Title *</label>
                <Input id="lead-ticket-title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="mt-1 text-xs" data-testid="create-ticket-title" />
              </div>
              <div>
                <label htmlFor="lead-ticket-description" className="text-[10px] uppercase tracking-wider text-zinc-400">Description</label>
                <Textarea
                  id="lead-ticket-description"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={9}
                  className="mt-1 min-h-52 resize-y text-xs leading-relaxed"
                  data-testid="create-ticket-description"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-400">Priority</label>
                  <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                    <SelectTrigger className="mt-1 h-10 text-xs"><SelectValue /></SelectTrigger>
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
                    <SelectTrigger className="mt-1 h-10 text-xs"><SelectValue /></SelectTrigger>
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
          </section>
        </div>

        <DialogFooter className="items-center gap-3 border-t border-white/[0.08] bg-black/20 px-6 py-4 sm:justify-between sm:space-x-0">
          <p className="text-left text-[11px] text-zinc-500">{form.title.trim() ? "Ticket title is ready." : "Add a title to continue."}</p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={!form.title.trim() || busy} className="min-w-36 bg-violet-600 hover:bg-violet-500" data-testid="confirm-create-ticket">
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Ticket className="mr-1.5 h-3.5 w-3.5" />}
              Create linked ticket
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
