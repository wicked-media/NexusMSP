import DOMPurify from "dompurify";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Send, GitBranch, Merge, Timer, BellRing, ShoppingCart, Plus, Trash2, Receipt, SpellCheck,
} from "lucide-react";
import { priorityConfig } from "@/config/ticketConfig";

export function EmailDialog({
  open, onOpenChange, emailForm, setEmailForm, emailSignature, handleSendEmail,
  handleProofread, proofreadResult, setProofreadResult, proofreadLoading,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Send Email from Ticket</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div><Label>To</Label><Input value={emailForm.to} onChange={e => setEmailForm({ ...emailForm, to: e.target.value })} placeholder="recipient@email.com" data-testid="email-to" /></div>
            <div><Label>CC</Label><Input value={emailForm.cc} onChange={e => setEmailForm({ ...emailForm, cc: e.target.value })} placeholder="cc@email.com" data-testid="email-cc" /></div>
            <div><Label>BCC</Label><Input value={emailForm.bcc} onChange={e => setEmailForm({ ...emailForm, bcc: e.target.value })} placeholder="bcc@email.com" data-testid="email-bcc" /></div>
          </div>
          <div><Label>Subject</Label><Input value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} data-testid="email-subject" /></div>
          <div><Label>Body</Label><Textarea value={emailForm.body} onChange={e => setEmailForm({ ...emailForm, body: e.target.value })} rows={6} data-testid="email-body" />
            <div className="flex items-center gap-2 mt-1">
              <Button variant="outline" size="sm" className="h-7 text-[11px] text-cyan-400 border-cyan-500/30"
                onClick={() => handleProofread(emailForm.body, "email")} disabled={proofreadLoading || !emailForm.body} data-testid="proofread-email-btn">
                <SpellCheck className="w-3 h-3 mr-1" />Proofread Email
              </Button>
              {proofreadResult && proofreadResult.target === "email" && (
                <Button variant="outline" size="sm" className="h-7 text-[11px] text-green-400"
                  onClick={() => { setEmailForm({ ...emailForm, body: proofreadResult.corrected }); setProofreadResult(null); }}>
                  Apply Corrections
                </Button>
              )}
            </div>
          </div>
          {emailSignature && <div className="border rounded p-2 bg-muted/30"><p className="text-xs text-muted-foreground mb-1">Signature:</p><div className="text-sm" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailSignature) }} /></div>}
        </div>
        <DialogFooter><Button onClick={handleSendEmail} data-testid="send-email-submit"><Send className="w-4 h-4 mr-1" />Send</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChildTicketDialog({ open, onOpenChange, childForm, setChildForm, handleCreateChild }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Child Ticket</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={childForm.title} onChange={e => setChildForm({ ...childForm, title: e.target.value })} data-testid="child-title" /></div>
          <div><Label>Description</Label><Textarea value={childForm.description} onChange={e => setChildForm({ ...childForm, description: e.target.value })} data-testid="child-desc" /></div>
          <div><Label>Priority</Label>
            <Select value={childForm.priority} onValueChange={v => setChildForm({ ...childForm, priority: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(priorityConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter><Button onClick={handleCreateChild} data-testid="create-child-submit"><GitBranch className="w-4 h-4 mr-1" />Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MergeDialog({ open, onOpenChange, viewingTicket, tickets, mergeIds, setMergeIds, handleMerge }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Merge Tickets Into This One</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Select tickets to merge into {viewingTicket.ticket_number}. Their notes and emails will be combined.</p>
        <ScrollArea className="h-[250px]">
          {tickets.filter(t => t.id !== viewingTicket.id && t.status !== "closed").map(t => (
            <div key={t.id} className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded">
              <Checkbox checked={mergeIds.includes(t.id)} onCheckedChange={c => setMergeIds(c ? [...mergeIds, t.id] : mergeIds.filter(x => x !== t.id))} />
              <span className="font-mono text-sm">{t.ticket_number}</span>
              <span className="text-sm truncate">{t.title}</span>
            </div>
          ))}
        </ScrollArea>
        <DialogFooter><Button onClick={handleMerge} disabled={!mergeIds.length} data-testid="merge-submit"><Merge className="w-4 h-4 mr-1" />Merge {mergeIds.length} tickets</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LogTimeDialog({ open, onOpenChange, timeForm, setTimeForm, handleAddTime }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Log Time</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Minutes</Label><Input type="number" value={timeForm.minutes} onChange={e => setTimeForm({ ...timeForm, minutes: parseInt(e.target.value) || 0 })} data-testid="time-minutes" /></div>
          <div><Label>Description</Label><Input value={timeForm.description} onChange={e => setTimeForm({ ...timeForm, description: e.target.value })} data-testid="time-desc" /></div>
          <div className="flex items-center gap-2"><Checkbox checked={timeForm.billable} onCheckedChange={v => setTimeForm({ ...timeForm, billable: v })} id="billable" /><Label htmlFor="billable">Billable</Label></div>
        </div>
        <DialogFooter><Button onClick={handleAddTime} data-testid="log-time-submit"><Timer className="w-4 h-4 mr-1" />Log Time</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NotifyClientDialog({ open, onOpenChange, notifyForm, setNotifyForm, handleNotifyClient }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Notify Client with PDF</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Send an email notification to the client with a branded PDF of the conversation history attached.</p>
        <div className="space-y-3">
          <div><Label>Client Email</Label><Input value={notifyForm.email} onChange={e => setNotifyForm({ ...notifyForm, email: e.target.value })} placeholder="client@email.com" data-testid="notify-email" /></div>
          <div><Label>Subject</Label><Input value={notifyForm.subject} onChange={e => setNotifyForm({ ...notifyForm, subject: e.target.value })} data-testid="notify-subject" /></div>
          <div><Label>Message</Label><Textarea value={notifyForm.message} onChange={e => setNotifyForm({ ...notifyForm, message: e.target.value })} rows={3} data-testid="notify-message" /></div>
        </div>
        <DialogFooter><Button onClick={handleNotifyClient} data-testid="send-notify-btn"><BellRing className="w-4 h-4 mr-1" />Send Notification</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddItemsDialog({
  open, onOpenChange, allProducts, addItemProduct, setAddItemProduct, addItemQty, setAddItemQty,
  handleAddItemToTicket, ticketProducts, handleRemoveItemFromTicket,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><ShoppingCart className="w-5 h-5 text-cyan-400" />Add Billable Items</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">Add products/items used on this ticket. Stock will be deducted automatically.</p>
          <div className="flex items-center gap-2">
            <Select value={addItemProduct || "__none"} onValueChange={v => setAddItemProduct(v === "__none" ? "" : v)}>
              <SelectTrigger className="flex-1" data-testid="add-item-product-select"><SelectValue placeholder="Select product..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Choose product...</SelectItem>
                {allProducts.filter(p => p.is_active !== false).map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} - ${p.retail_price?.toFixed(2)} ({p.quantity_in_stock} in stock)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="number" min="1" className="w-20" value={addItemQty} onChange={e => setAddItemQty(parseInt(e.target.value) || 1)} />
            <Button onClick={handleAddItemToTicket} disabled={!addItemProduct} data-testid="confirm-add-item"><Plus className="w-4 h-4 mr-1" />Add</Button>
          </div>
          {ticketProducts.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Total</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {ticketProducts.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium text-sm">{p.product_name}</TableCell>
                      <TableCell className="text-right font-mono">{p.quantity}</TableCell>
                      <TableCell className="text-right font-mono">${(p.unit_price || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono font-bold">${(p.total || 0).toFixed(2)}</TableCell>
                      <TableCell><Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => handleRemoveItemFromTicket(p.id)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} className="text-right font-semibold">Total</TableCell>
                    <TableCell className="text-right font-mono font-bold text-green-400">${ticketProducts.reduce((s, p) => s + (p.total || 0), 0).toFixed(2)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PushInvoiceDialog({
  open, onOpenChange, ticketProducts, invoicesList, pushToExisting, setPushToExisting, handlePushToInvoice,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Receipt className="w-5 h-5 text-green-400" />Push Items to Invoice</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Push {ticketProducts.length} item(s) totalling <span className="font-bold text-green-400">${ticketProducts.reduce((s, p) => s + (p.total || 0), 0).toFixed(2)}</span> to an invoice.
          </p>
          <div className="space-y-3">
            <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => handlePushToInvoice(null)} data-testid="create-new-invoice-btn">
              <Plus className="w-4 h-4 mr-1" />Create New Invoice
            </Button>
            {invoicesList.length > 0 && (
              <>
                <Separator />
                <Label>Or add to existing invoice:</Label>
                <Select value={pushToExisting || "__none"} onValueChange={v => setPushToExisting(v === "__none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Select invoice..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Choose...</SelectItem>
                    {invoicesList.filter(inv => inv.status !== "paid" && inv.status !== "cancelled").map(inv => (
                      <SelectItem key={inv.id} value={inv.id}>{inv.invoice_number} - {inv.client_name || "No client"} (${inv.total?.toFixed(2)})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {pushToExisting && <Button className="w-full" onClick={() => handlePushToInvoice(pushToExisting)} data-testid="push-to-existing-btn">Add to {invoicesList.find(i => i.id === pushToExisting)?.invoice_number}</Button>}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
