import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus, CheckCircle, Circle, Loader2, Paperclip, FileText, Download, Trash2,
  ShoppingCart, Receipt, History, Boxes,
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

  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          placeholder="Add a checklist item..."
          value={newWorksheetItem}
          onChange={e => setNewWorksheetItem(e.target.value)}
          onKeyDown={e => e.key === "Enter" && add()}
          data-testid="worksheet-input"
        />
        <Button size="sm" onClick={add} data-testid="add-worksheet-btn"><Plus className="w-3 h-3 mr-1" />Add</Button>
      </div>
      {worksheetItems.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-20" />
          <p>No worksheet items yet. Add checklist items to track work.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {worksheetItems.map(wi => (
            <div
              key={wi.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ${wi.checked ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted/20 border-border/50 hover:bg-muted/30"}`}
              onClick={() => toggle(wi)}
              data-testid={`worksheet-item-${wi.id}`}
            >
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${wi.checked ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/40"}`}>
                {wi.checked && <CheckCircle className="w-3 h-3 text-white" />}
              </div>
              <div className="flex-1">
                <span className={`text-sm ${wi.checked ? "line-through text-muted-foreground" : ""}`}>{wi.item}</span>
                {wi.checked_by_name && <span className="text-[10px] text-muted-foreground ml-2">by {wi.checked_by_name} {wi.checked_at?.slice(0, 16)}</span>}
              </div>
            </div>
          ))}
          <div className="text-xs text-muted-foreground pt-2">
            {worksheetItems.filter(w => w.checked).length} / {worksheetItems.length} completed
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
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{ticketAttachments.length} file{ticketAttachments.length !== 1 ? "s" : ""} attached</span>
        <div className="relative">
          <input type="file" id="attachment-upload" className="hidden" onChange={handleAttachmentUpload} />
          <Button size="sm" onClick={() => document.getElementById("attachment-upload").click()} disabled={attachmentUploading} data-testid="upload-attachment-btn">
            {attachmentUploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Paperclip className="w-3 h-3 mr-1" />}Upload File
          </Button>
        </div>
      </div>
      <ScrollArea className="h-[300px]">
        {ticketAttachments.length > 0 ? ticketAttachments.map(att => (
          <div key={att.id} className="flex items-center justify-between p-3 rounded-lg border mb-2 hover:bg-muted/50 transition-colors" data-testid={`attachment-${att.id}`}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center"><FileText className="w-4 h-4 text-blue-500" /></div>
              <div>
                <p className="text-sm font-medium">{att.filename}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{(att.size / 1024).toFixed(1)} KB</span>
                  <span>by {att.uploaded_by_name}</span>
                  <span>{att.created_at?.substring(0, 16).replace("T", " ")}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => window.open(`${API}${att.url}`, "_blank")}><Download className="w-3 h-3" /></Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteAttachment(att.id)}><Trash2 className="w-3 h-3" /></Button>
            </div>
          </div>
        )) : (
          <div className="text-center py-8">
            <Paperclip className="w-8 h-8 mx-auto text-muted-foreground opacity-30 mb-2" />
            <p className="text-sm text-muted-foreground">No attachments yet</p>
          </div>
        )}
      </ScrollArea>
    </>
  );
}

/* ============== Items Tab ============== */
export function TicketItemsTab({ ticketProducts, setIsKitPickerOpen, setIsAddItemOpen, handleRemoveItemFromTicket, headers, setInvoicesList, setIsPushInvoiceOpen }) {
  const total = ticketProducts.reduce((s, p) => s + (p.total || 0), 0);
  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Billable products & items used on this ticket</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => setIsKitPickerOpen(true)} data-testid="apply-kit-btn"><Boxes className="w-3 h-3 mr-1" />Apply Kit</Button>
          <Button size="sm" onClick={() => setIsAddItemOpen(true)} data-testid="tab-add-item-btn"><Plus className="w-3 h-3 mr-1" />Add Item</Button>
        </div>
      </div>
      {ticketProducts.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead><TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead><TableHead className="text-right">Total</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {ticketProducts.map(p => (
                  <TableRow key={p.id} data-testid={`ticket-item-${p.id}`}>
                    <TableCell className="font-medium">{p.product_name}</TableCell>
                    <TableCell className="text-right font-mono">{p.quantity}</TableCell>
                    <TableCell className="text-right font-mono">${(p.unit_price || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">${(p.total || 0).toFixed(2)}</TableCell>
                    <TableCell><Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => handleRemoveItemFromTicket(p.id)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/30">
                  <TableCell colSpan={3} className="text-right font-semibold">Total</TableCell>
                  <TableCell className="text-right font-mono font-bold text-green-400">${total.toFixed(2)}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed"><CardContent className="py-8 text-center">
          <ShoppingCart className="w-8 h-8 mx-auto text-muted-foreground mb-2 opacity-30" />
          <p className="text-muted-foreground text-sm">No items added yet</p>
        </CardContent></Card>
      )}
      {ticketProducts.length > 0 && (
        <Button
          variant="outline"
          className="text-green-400 border-green-500/30 hover:bg-green-500/10"
          onClick={() => {
            axios.get(`${API}/invoices`, { headers }).then(r => setInvoicesList(r.data)).catch(() => {});
            setIsPushInvoiceOpen(true);
          }}
          data-testid="items-to-invoice-btn"
        >
          <Receipt className="w-4 h-4 mr-1" />Push All Items to Invoice
        </Button>
      )}
    </>
  );
}

/* ============== Children Tab ============== */
export function TicketChildrenTab({ childTickets, fetchTicketDetail, statusConfig, priorityConfig }) {
  if (!childTickets.length) return <p className="text-center py-8 text-muted-foreground">No child tickets</p>;
  return (
    <Table>
      <TableHeader><TableRow>
        <TableHead>Number</TableHead><TableHead>Title</TableHead><TableHead>Status</TableHead><TableHead>Priority</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {childTickets.map(child => (
          <TableRow key={child.id} className="cursor-pointer hover:bg-muted/50" onClick={() => fetchTicketDetail(child)}>
            <TableCell className="font-mono text-sm">{child.ticket_number}</TableCell>
            <TableCell>{child.title}</TableCell>
            <TableCell><Badge variant="outline" className={statusConfig[child.status]?.class}>{statusConfig[child.status]?.label}</Badge></TableCell>
            <TableCell><Badge className={priorityConfig[child.priority]?.class + " text-xs"}>{priorityConfig[child.priority]?.label}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/* ============== Time Tab ============== */
export function TicketTimeTab({ timeEntries }) {
  if (!timeEntries.length) return <p className="text-center py-8 text-muted-foreground">No time entries</p>;
  return (
    <Table>
      <TableHeader><TableRow>
        <TableHead>User</TableHead><TableHead>Minutes</TableHead><TableHead>Description</TableHead><TableHead>Billable</TableHead><TableHead>Date</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {timeEntries.map(te => (
          <TableRow key={te.id}>
            <TableCell>{te.user_name}</TableCell>
            <TableCell className="font-mono">{te.minutes}m</TableCell>
            <TableCell>{te.description}</TableCell>
            <TableCell>{te.billable ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Circle className="w-4 h-4 text-gray-500" />}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{te.created_at && formatDistanceToNow(new Date(te.created_at), { addSuffix: true })}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/* ============== Audit Tab ============== */
export function TicketAuditTab({ auditLog }) {
  return (
    <ScrollArea className="h-[350px]">
      {auditLog.map(entry => (
        <div key={entry.id} className="flex items-start gap-3 p-2 border-b border-border/50" data-testid={`audit-${entry.id}`}>
          <History className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm"><span className="font-medium">{entry.user_name}</span> <span className="text-muted-foreground">{entry.action}</span></p>
            <p className="text-xs text-muted-foreground">{entry.details}</p>
            <p className="text-[11px] text-muted-foreground/60">{entry.created_at && formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</p>
          </div>
        </div>
      ))}
      {!auditLog.length && <p className="text-center py-8 text-muted-foreground">No audit entries</p>}
    </ScrollArea>
  );
}

/* Optional default re-export for convenience */
export default {
  TicketWorksheetTab,
  TicketAttachmentsTab,
  TicketItemsTab,
  TicketChildrenTab,
  TicketTimeTab,
  TicketAuditTab,
};
