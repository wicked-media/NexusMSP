import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus, CheckCircle, Loader2, Paperclip, FileText, Download, Trash2,
  ShoppingCart, Receipt, History, Boxes, Clock,
  BellRing, Building2, CalendarClock, GitPullRequest, MonitorCog, Tags, UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { API } from "@/App";

/* ============== Worksheets Tab ============== */
export function TicketWorksheetTab({ viewingTicket, headers, newWorksheetItem, setNewWorksheetItem, worksheetItems, setWorksheetItems }) {
  const reload = async () => {
    try {
      const r = await axios.get(`${API}/tickets/${viewingTicket.id}/worksheet`, { headers });
      setWorksheetItems(r.data || []);
    } catch { /* ignore */ }
  };
  const add = async () => {
    if (!newWorksheetItem.trim()) return;
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/worksheet`, { item: newWorksheetItem.trim() }, { headers });
      setNewWorksheetItem("");
      await reload();
      toast.success("Worksheet item added");
    } catch { toast.error("Failed to add item"); }
  };
  const toggle = async (wi) => {
    try {
      await axios.post(`${API}/tickets/${viewingTicket.id}/worksheet/check`, { item_id: wi.id, checked: !wi.checked }, { headers });
      await reload();
    } catch { toast.error("Failed"); }
  };
  const completed = worksheetItems.filter(item => item.checked).length;
  const progress = worksheetItems.length ? Math.round((completed / worksheetItems.length) * 100) : 0;

  return (
    <>
      <Card className="overflow-hidden border border-white/[0.08] bg-[linear-gradient(120deg,rgba(16,185,129,0.08),transparent_48%)]">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-sm font-semibold text-zinc-100">Work checklist</p><p className="mt-0.5 text-[11px] text-zinc-500">Keep the next technician step visible and accountable.</p></div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.08] px-2.5 py-1.5 text-right"><p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-300">Progress</p><p className="mt-0.5 text-xs font-semibold text-emerald-100">{completed}/{worksheetItems.length} complete</p></div>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500" style={{ width: `${progress}%` }} /></div>
          <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/[0.12] p-1.5">
            <Input className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0" placeholder="Add the next work item..." value={newWorksheetItem} onChange={e => setNewWorksheetItem(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} data-testid="worksheet-input" />
            <Button size="sm" className="h-8 bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={add} data-testid="add-worksheet-btn"><Plus className="w-3.5 h-3.5 mr-1" />Add task</Button>
          </div>
        </CardContent>
      </Card>
      {worksheetItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[0.10] bg-black/[0.08] text-center py-12 text-muted-foreground">
          <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-20" />
          <p className="text-sm">No tasks yet. Add the first technician step above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {worksheetItems.map(wi => (
            <div
              key={wi.id}
              className={`group flex items-center gap-3 rounded-xl border p-3 transition-all cursor-pointer ${wi.checked ? "border-emerald-500/20 bg-emerald-500/[0.05]" : "border-white/[0.08] bg-black/[0.08] hover:border-emerald-500/25 hover:bg-emerald-500/[0.035]"}`}
              onClick={() => toggle(wi)}
              data-testid={`worksheet-item-${wi.id}`}
            >
              <div className={`flex h-5 w-5 rounded-full border-2 items-center justify-center transition-colors ${wi.checked ? "bg-emerald-500 border-emerald-500" : "border-zinc-600 group-hover:border-emerald-400"}`}>
                {wi.checked && <CheckCircle className="w-3 h-3 text-white" />}
              </div>
              <div className="flex-1">
                <span className={`text-sm ${wi.checked ? "line-through text-zinc-500" : "text-zinc-200"}`}>{wi.item}</span>
                {wi.checked_by_name && <span className="text-[10px] text-muted-foreground ml-2">by {wi.checked_by_name} {wi.checked_at?.slice(0, 16)}</span>}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between px-1 pt-2 text-[11px] text-zinc-500">
            <span>{completed} of {worksheetItems.length} tasks complete</span><span>{progress}% complete</span>
          </div>
        </div>
      )}
    </>
  );
}

/* ============== Attachments Tab ============== */
export function TicketAttachmentsTab({ ticketAttachments, attachmentUploading, handleAttachmentUpload, handleDeleteAttachment }) {
  return (
    <>
      <Card className="overflow-hidden border border-white/[0.08] bg-[linear-gradient(120deg,rgba(59,130,246,0.08),transparent_48%)]">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div><p className="text-sm font-semibold text-zinc-100">Evidence & files</p><p className="mt-0.5 text-[11px] text-zinc-500">Screenshots, exports, diagnostics and customer documents.</p></div>
          <div className="relative">
          <input type="file" id="attachment-upload" className="hidden" onChange={handleAttachmentUpload} />
          <Button size="sm" className="bg-sky-500 text-sky-950 hover:bg-sky-400" onClick={() => document.getElementById("attachment-upload").click()} disabled={attachmentUploading} data-testid="upload-attachment-btn">
            {attachmentUploading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5 mr-1.5" />}Upload file
          </Button>
          </div>
        </CardContent>
      </Card>
      <ScrollArea className="h-[340px] rounded-xl border border-white/[0.08] bg-black/[0.08] p-2">
        {ticketAttachments.length > 0 ? ticketAttachments.map(att => (
          <div key={att.id} className="group flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 mb-2 transition-colors hover:border-sky-500/25 hover:bg-sky-500/[0.035]" data-testid={`attachment-${att.id}`}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 rounded-xl bg-sky-500/[0.12] ring-1 ring-sky-500/20 items-center justify-center"><FileText className="w-4 h-4 text-sky-300" /></div>
              <div>
                <p className="text-sm font-medium text-zinc-200">{att.filename}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
                  <span>{(att.size / 1024).toFixed(1)} KB</span><span className="text-zinc-700">•</span>
                  <span>{att.uploaded_by_name || "Unknown uploader"}</span><span className="text-zinc-700">•</span>
                  <span>{att.created_at?.substring(0, 16).replace("T", " ")}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-sky-300 hover:bg-sky-500/[0.10] hover:text-sky-100" onClick={() => window.open(`${API}${att.url}`, "_blank")}><Download className="w-3.5 h-3.5" /></Button>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-zinc-500 hover:bg-rose-500/[0.10] hover:text-rose-300" onClick={() => handleDeleteAttachment(att.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
        )) : (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.10] text-center">
            <Paperclip className="mb-3 h-9 w-9 text-sky-300/40" />
            <p className="text-sm text-zinc-300">No evidence attached yet</p>
            <p className="mt-1 text-[11px] text-zinc-500">Upload a screenshot, log export, or document for the ticket record.</p>
            <Button variant="outline" size="sm" className="mt-4 border-sky-500/25 text-sky-300 hover:bg-sky-500/[0.10]" onClick={() => document.getElementById("attachment-upload").click()}><Paperclip className="mr-1.5 h-3.5 w-3.5" />Attach file</Button>
          </div>
        )}
      </ScrollArea>
    </>
  );
}

/* ============== Items Tab ============== */
export function TicketItemsTab({ ticketProducts, setIsKitPickerOpen, setIsAddItemOpen, handleRemoveItemFromTicket, headers, setInvoicesList, setIsPushInvoiceOpen }) {
  const total = ticketProducts.reduce((s, p) => s + (p.total || 0), 0);
  const unbilledItems = ticketProducts.filter(item => !item.invoice_id);
  const unbilledTotal = unbilledItems.reduce((s, p) => s + (p.total || 0), 0);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[linear-gradient(120deg,rgba(16,185,129,0.08),transparent_52%)] p-4">
        <div><p className="text-sm font-semibold text-zinc-100">Products & billing</p><p className="mt-0.5 text-[11px] text-zinc-500">Track hardware, licensing and billable work attached to this ticket.</p></div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => setIsKitPickerOpen(true)} data-testid="apply-kit-btn"><Boxes className="w-3 h-3 mr-1" />Apply Kit</Button>
          <Button size="sm" className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={() => setIsAddItemOpen(true)} data-testid="tab-add-item-btn"><Plus className="w-3.5 h-3.5 mr-1.5" />Add item</Button>
        </div>
      </div>
      {ticketProducts.length > 0 ? (
        <Card className="overflow-hidden border border-white/[0.08] bg-black/[0.08]">
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead><TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead><TableHead className="text-right">Total</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {ticketProducts.map(p => (
                  <TableRow key={p.id} data-testid={`ticket-item-${p.id}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{p.product_name}</span>
                        {p.pricing_source === "quantity_tier" && <Badge variant="outline" className="border-violet-500/30 bg-violet-500/[0.08] text-[9px] text-violet-200">Tier {p.tier_min_qty}+</Badge>}
                        {p.invoice_id && <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/[0.08] text-[9px] text-emerald-200">Invoiced{p.invoice_number ? ` · ${p.invoice_number}` : ""}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{p.quantity}</TableCell>
                    <TableCell className="text-right font-mono">${(p.unit_price || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">${(p.total || 0).toFixed(2)}</TableCell>
                    <TableCell><Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => handleRemoveItemFromTicket(p.id)} disabled={Boolean(p.invoice_id)} title={p.invoice_id ? "Invoiced items cannot be removed" : "Remove item"}><Trash2 className="w-3 h-3" /></Button></TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-emerald-500/15 bg-emerald-500/[0.07]">
                  <TableCell colSpan={3} className="text-right text-xs font-semibold uppercase tracking-[0.1em] text-emerald-200">Ticket total</TableCell>
                  <TableCell className="text-right font-mono text-base font-bold text-emerald-200">${total.toFixed(2)}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed border-white/[0.10] bg-black/[0.08]"><CardContent className="py-12 text-center">
          <ShoppingCart className="w-9 h-9 mx-auto text-emerald-300/35 mb-3" />
          <p className="text-zinc-300 text-sm">No billable items on this ticket</p><p className="mt-1 text-[11px] text-zinc-500">Add an item or apply a service kit when work or hardware should be billed.</p>
        </CardContent></Card>
      )}
      {unbilledItems.length > 0 && (
        <Button
          className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
          onClick={() => {
            axios.get(`${API}/invoices`, { headers }).then(r => setInvoicesList(r.data)).catch(() => {});
            setIsPushInvoiceOpen(true);
          }}
          data-testid="items-to-invoice-btn"
        >
          <Receipt className="w-4 h-4 mr-1.5" />Create or update invoice · ${unbilledTotal.toFixed(2)}
        </Button>
      )}
    </>
  );
}

/* ============== Children Tab ============== */
export function TicketChildrenTab({ childTickets, fetchTicketDetail, statusConfig, priorityConfig }) {
  if (!childTickets.length) return <div className="rounded-xl border border-dashed border-white/[0.10] bg-black/[0.08] py-12 text-center"><History className="mx-auto mb-3 h-9 w-9 text-violet-300/30" /><p className="text-sm text-zinc-300">No related tickets yet</p><p className="mt-1 text-[11px] text-zinc-500">Split work or link follow-on issues when this request needs a separate track.</p></div>;
  return (
    <div className="space-y-3"><div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-black/[0.10] px-4 py-3"><div><p className="text-sm font-semibold text-zinc-100">Related work</p><p className="mt-0.5 text-[11px] text-zinc-500">Child tickets and separate workstreams linked to this request.</p></div><Badge variant="outline" className="border-violet-500/25 bg-violet-500/[0.08] text-violet-200">{childTickets.length} linked</Badge></div><div className="space-y-2">{childTickets.map(child => (<button key={child.id} type="button" className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-black/[0.08] p-3 text-left transition hover:border-violet-500/25 hover:bg-violet-500/[0.04]" onClick={() => fetchTicketDetail(child)}><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/[0.12] font-mono text-xs font-semibold text-violet-200">{child.ticket_number?.replace(/[^0-9]/g, "").slice(-3) || "•"}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-zinc-200">{child.title}</p><p className="mt-1 font-mono text-[10px] text-zinc-500">{child.ticket_number}</p></div><Badge variant="outline" className={statusConfig[child.status]?.class}>{statusConfig[child.status]?.label || child.status}</Badge><Badge className={priorityConfig[child.priority]?.class + " text-[10px]"}>{priorityConfig[child.priority]?.label || child.priority}</Badge></button>))}</div></div>
  );
}

/* ============== Time Tab ============== */
export function TicketTimeTab({ timeEntries }) {
  const totalMinutes = timeEntries.reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);
  const billableMinutes = timeEntries.filter(entry => entry.billable).reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);
  const formatDuration = (minutes) => minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ""}` : `${minutes}m`;
  if (!timeEntries.length) return <div className="rounded-xl border border-dashed border-white/[0.10] bg-black/[0.08] py-12 text-center"><Clock className="mx-auto mb-3 h-9 w-9 text-violet-300/35" /><p className="text-sm text-zinc-300">No time entries recorded</p><p className="mt-1 text-[11px] text-zinc-500">Log technician effort to keep billing and service reporting accurate.</p></div>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Card className="border border-violet-500/20 bg-violet-500/[0.07]"><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-300">Total effort</p><p className="mt-1 text-lg font-semibold text-violet-100">{formatDuration(totalMinutes)}</p></CardContent></Card>
        <Card className="border border-emerald-500/20 bg-emerald-500/[0.07]"><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">Billable</p><p className="mt-1 text-lg font-semibold text-emerald-100">{formatDuration(billableMinutes)}</p></CardContent></Card>
      </div>
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/[0.08]">
        <Table>
          <TableHeader><TableRow className="border-white/[0.06]"><TableHead>Technician</TableHead><TableHead>Duration</TableHead><TableHead>Work performed</TableHead><TableHead>Billing</TableHead><TableHead>Logged</TableHead></TableRow></TableHeader>
          <TableBody>
            {timeEntries.map(te => (
              <TableRow key={te.id} className="border-white/[0.06] hover:bg-white/[0.025]"><TableCell className="font-medium text-zinc-200">{te.user_name || "Technician"}</TableCell><TableCell className="font-mono text-violet-200">{formatDuration(Number(te.minutes || 0))}</TableCell><TableCell className="max-w-[360px] truncate text-zinc-300">{te.description || "No description"}</TableCell><TableCell>{te.billable ? <Badge className="border-emerald-500/25 bg-emerald-500/[0.10] text-emerald-300">Billable</Badge> : <Badge variant="outline" className="border-zinc-700 text-zinc-500">Internal</Badge>}</TableCell><TableCell className="text-xs text-zinc-500">{te.created_at && formatDistanceToNow(new Date(te.created_at), { addSuffix: true })}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ============== Audit Tab ============== */
export function TicketAuditTab({ auditLog }) {
  const actionMeta = {
    created: { label: "Created ticket", Icon: CheckCircle, tone: "border-emerald-500/25 bg-emerald-500/[0.10] text-emerald-300" },
    updated: { label: "Updated ticket", Icon: History, tone: "border-sky-500/25 bg-sky-500/[0.10] text-sky-300" },
    time_logged: { label: "Logged time", Icon: Clock, tone: "border-violet-500/25 bg-violet-500/[0.10] text-violet-300" },
    customer_changed: { label: "Changed client", Icon: Building2, tone: "border-amber-500/25 bg-amber-500/[0.10] text-amber-300" },
    categorisation_updated: { label: "Updated classification", Icon: Tags, tone: "border-sky-500/25 bg-sky-500/[0.10] text-sky-300" },
    picked_up: { label: "Picked up ticket", Icon: UserCheck, tone: "border-blue-500/25 bg-blue-500/[0.10] text-blue-300" },
    team_pinged: { label: "Pinged team", Icon: BellRing, tone: "border-amber-500/25 bg-amber-500/[0.10] text-amber-300" },
    maintenance_scheduled: { label: "Scheduled maintenance", Icon: CalendarClock, tone: "border-cyan-500/25 bg-cyan-500/[0.10] text-cyan-300" },
    converted_to_change: { label: "Converted to change", Icon: GitPullRequest, tone: "border-violet-500/25 bg-violet-500/[0.10] text-violet-300" },
    device_action: { label: "Device action", Icon: MonitorCog, tone: "border-emerald-500/25 bg-emerald-500/[0.10] text-emerald-300" },
    blocked_on: { label: "Marked blocked", Icon: History, tone: "border-rose-500/25 bg-rose-500/[0.10] text-rose-300" },
    unblocked: { label: "Removed blocker", Icon: CheckCircle, tone: "border-emerald-500/25 bg-emerald-500/[0.10] text-emerald-300" },
    csat_sent: { label: "Sent satisfaction survey", Icon: BellRing, tone: "border-amber-500/25 bg-amber-500/[0.10] text-amber-300" },
  };
  const describe = (entry) => entry.details || Object.entries(entry.changes || {})
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`).join(" · ");
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/[0.08]">
      <div className="flex items-center justify-between border-b border-white/[0.07] bg-white/[0.02] px-4 py-3"><div><p className="text-sm font-semibold text-zinc-100">Ticket activity</p><p className="mt-0.5 text-[11px] text-zinc-500">A chronological record of ticket changes and technician actions.</p></div><Badge variant="outline" className="border-white/[0.10] text-zinc-400">{auditLog.length} event{auditLog.length === 1 ? "" : "s"}</Badge></div>
      <ScrollArea className="h-[390px]">
        <div className="relative p-3">
          <div className="absolute bottom-5 left-[25px] top-5 w-px bg-white/[0.08]" />
          {auditLog.map(entry => {
            const meta = actionMeta[entry.action] || { label: entry.action?.replace(/_/g, " ") || "Recorded activity", Icon: History, tone: "border-violet-500/25 bg-violet-500/[0.10] text-violet-300" };
            const detail = describe(entry);
            return <div key={entry.id} className="relative flex items-start gap-3 px-1 py-2.5" data-testid={`audit-${entry.id}`}>
              <div className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border shadow-[0_0_0_4px_rgba(17,19,24,0.8)] ${meta.tone}`}><meta.Icon className="h-3.5 w-3.5" /></div>
              <div className="min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"><div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-zinc-200">{meta.label}</p><Badge variant="outline" className={`h-5 px-1.5 text-[9px] ${meta.tone}`}>{entry.user_name || entry.actor_name || "System"}</Badge></div><p className="text-[10px] text-zinc-600">{entry.created_at && formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</p></div>{detail && <p className="mt-1 text-xs leading-5 text-zinc-500">{detail}</p>}</div>
            </div>
          })}
          {!auditLog.length && <div className="py-14 text-center"><History className="mx-auto mb-3 h-9 w-9 text-violet-300/30" /><p className="text-sm text-zinc-300">No activity recorded yet</p><p className="mt-1 text-[11px] text-zinc-500">Ticket changes and technician actions will appear here.</p></div>}
        </div>
      </ScrollArea>
    </div>
  );
}

/* Optional default re-export for convenience */
const TicketSecondaryTabs = {
  TicketWorksheetTab,
  TicketAttachmentsTab,
  TicketItemsTab,
  TicketChildrenTab,
  TicketTimeTab,
  TicketAuditTab,
};

export default TicketSecondaryTabs;
