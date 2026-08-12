import DOMPurify from "dompurify";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Send, GitBranch, Merge, Timer, BellRing, ShoppingCart, Plus, Trash2, Receipt, SpellCheck,
} from "lucide-react";
import { priorityConfig } from "@/config/ticketConfig";

export function EmailDialog({
  open, onOpenChange, emailForm, setEmailForm, emailSignature, handleSendEmail,
  handleProofread, proofreadResult, setProofreadResult, proofreadLoading, clientContacts = [],
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NexusWorkflowDialog
        className="max-w-3xl"
        eyebrow="Ticket communication"
        title="Send customer update"
        description="Compose a customer-facing update with the linked ticket context and signature retained on send."
        icon={Send}
        footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={handleSendEmail} disabled={!emailForm.to?.trim()} data-testid="send-email-submit"><Send className="w-4 h-4 mr-1" />Send update</Button></>}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div><Label>To</Label><Input value={emailForm.to} onChange={e => setEmailForm({ ...emailForm, to: e.target.value })} placeholder="recipient@email.com" data-testid="email-to" list="ticket-contact-emails" /><datalist id="ticket-contact-emails">{clientContacts.map(contact => contact.email && <option key={contact.id} value={contact.email}>{contact.name} ({contact.email})</option>)}</datalist></div>
            <div><Label>CC</Label><Input value={emailForm.cc} onChange={e => setEmailForm({ ...emailForm, cc: e.target.value })} placeholder="cc@email.com" data-testid="email-cc" /></div>
            <div><Label>BCC</Label><Input value={emailForm.bcc} onChange={e => setEmailForm({ ...emailForm, bcc: e.target.value })} placeholder="bcc@email.com" data-testid="email-bcc" /></div>
          </div>
          <div><Label>Subject</Label><Input value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} data-testid="email-subject" /></div>
          <div><Label>Body</Label><RichTextEditor content={emailForm.body} onChange={body => setEmailForm({ ...emailForm, body })} placeholder="Write your email..." minHeight="220px" data-testid="email-body" />
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
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.035] p-2.5">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-300">Sender signature</p>
              <span className="text-[10px] text-sky-300/75">Applied securely when sent</span>
            </div>
            {emailSignature ? (
              <div className="text-sm" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailSignature) }} />
            ) : (
              <p className="text-xs text-muted-foreground">No default signature is set. Add one in My Settings to apply it to outgoing email.</p>
            )}
          </div>
        </div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}

export function ChildTicketDialog({ open, onOpenChange, childForm, setChildForm, handleCreateChild }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NexusWorkflowDialog eyebrow="Service escalation" title="Create linked child ticket" description="Split related work into an independently owned ticket while preserving the parent relationship and audit trail." icon={GitBranch} tone="cyan" footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={handleCreateChild} data-testid="create-child-submit"><GitBranch className="mr-2 h-4 w-4" />Create child ticket</Button></>}>
        <div className="space-y-4">
          <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Child ticket title</Label><Input autoFocus value={childForm.title} onChange={e => setChildForm({ ...childForm, title: e.target.value })} data-testid="child-title" /></div>
          <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Work brief</Label><Textarea rows={4} value={childForm.description} onChange={e => setChildForm({ ...childForm, description: e.target.value })} data-testid="child-desc" /></div>
          <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Initial priority</Label>
            <Select value={childForm.priority} onValueChange={v => setChildForm({ ...childForm, priority: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(priorityConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}

export function MergeDialog({ open, onOpenChange, viewingTicket, tickets, mergeIds, setMergeIds, handleMerge }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NexusWorkflowDialog
        eyebrow="Ticket consolidation"
        title="Merge related tickets"
        description={`Combine duplicate service records into ${viewingTicket.ticket_number} while retaining notes, mail and audit history.`}
        icon={Merge}
        tone="violet"
        footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={handleMerge} disabled={!mergeIds.length} data-testid="merge-submit"><Merge className="w-4 h-4 mr-1" />Merge {mergeIds.length} tickets</Button></>}
      >
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
      </NexusWorkflowDialog>
    </Dialog>
  );
}

export function LogTimeDialog({ open, onOpenChange, timeForm, setTimeForm, handleAddTime }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NexusWorkflowDialog
        eyebrow="Service delivery"
        title="Log technician time"
        description="Keep the service record, commercial status and billing context accurate without leaving the ticket."
        icon={Timer}
        tone="emerald"
        footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={handleAddTime} data-testid="log-time-submit"><Timer className="w-4 h-4 mr-1" />Log time</Button></>}
      >
        <div className="space-y-3">
          <div><Label>Minutes</Label><Input type="number" value={timeForm.minutes} onChange={e => setTimeForm({ ...timeForm, minutes: parseInt(e.target.value) || 0 })} data-testid="time-minutes" /></div>
          <div><Label>Description</Label><Input value={timeForm.description} onChange={e => setTimeForm({ ...timeForm, description: e.target.value })} data-testid="time-desc" /></div>
          <div className="flex items-center gap-2"><Checkbox checked={timeForm.billable} onCheckedChange={v => setTimeForm({ ...timeForm, billable: v })} id="billable" /><Label htmlFor="billable">Billable</Label></div>
        </div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}

export function NotifyClientDialog({ open, onOpenChange, notifyForm, setNotifyForm, handleNotifyClient }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden border-cyan-500/25 bg-[linear-gradient(145deg,rgba(9,22,30,0.98),rgba(13,15,21,0.98))] p-0">
        <DialogHeader className="border-b border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.17),transparent_45%),linear-gradient(135deg,rgba(16,185,129,0.08),transparent)] px-6 py-5 pr-14"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Client communication</p><DialogTitle className="mt-1 flex items-center gap-2 text-xl text-zinc-100"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10"><BellRing className="h-4 w-4 text-cyan-200" /></span>Send service record</DialogTitle><p className="mt-2 text-sm text-zinc-400">Email the client a branded PDF of this ticket’s conversation and service history. Sending is recorded against the ticket.</p></DialogHeader>
        <div className="space-y-4 px-6 py-5">
          <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Recipient</Label><Input value={notifyForm.email} onChange={e => setNotifyForm({ ...notifyForm, email: e.target.value })} placeholder="client@email.com" data-testid="notify-email" /></div>
          <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Email subject</Label><Input value={notifyForm.subject} onChange={e => setNotifyForm({ ...notifyForm, subject: e.target.value })} data-testid="notify-subject" /></div>
          <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Message to client</Label><Textarea value={notifyForm.message} onChange={e => setNotifyForm({ ...notifyForm, message: e.target.value })} rows={4} data-testid="notify-message" /></div>
        </div>
        <DialogFooter className="border-t border-white/[0.07] bg-black/10 px-6 py-4"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={handleNotifyClient} data-testid="send-notify-btn"><BellRing className="mr-2 h-4 w-4" />Send service record</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddItemsDialog({
  open, onOpenChange, allProducts, addItemProduct, setAddItemProduct, addItemQty, setAddItemQty,
  handleAddItemToTicket, ticketProducts, handleRemoveItemFromTicket,
}) {
  const unbilledItems = ticketProducts.filter(item => !item.invoice_id);
  const unbilledTotal = unbilledItems.reduce((sum, item) => sum + (item.total || 0), 0);
  const selectedProduct = allProducts.find(product => product.id === addItemProduct);
  const selectedTracksStock = selectedProduct?.track_inventory ?? ["Hardware", "Accessories", "Networking", "Security"].includes(selectedProduct?.category);
  const selectedStockInsufficient = Boolean(selectedProduct && selectedTracksStock && Number(selectedProduct.quantity_in_stock || 0) < Number(addItemQty || 1));
  const selectedTier = selectedProduct?.pricing_tiers
    ?.filter(tier => Number(tier.min_qty) <= Number(addItemQty || 1))
    ?.sort((a, b) => Number(b.min_qty) - Number(a.min_qty))[0];
  const selectedUnitPrice = selectedTier ? Number(selectedTier.unit_price) : Number(selectedProduct?.retail_price || 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NexusWorkflowDialog
        eyebrow="Ticket billing"
        title="Add billable items"
        description="Attach products and services used on this ticket. Nexus keeps stock, pricing and invoice readiness in sync."
        icon={ShoppingCart}
        tone="emerald"
        className="max-w-lg"
        footer={<Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>}
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">Add products/items used on this ticket. Stock will be deducted automatically.</p>
          <div className="flex items-center gap-2">
            <Select value={addItemProduct || "__none"} onValueChange={v => setAddItemProduct(v === "__none" ? "" : v)}>
              <SelectTrigger className="flex-1" data-testid="add-item-product-select"><SelectValue placeholder="Select product..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Choose product...</SelectItem>
                {allProducts.filter(p => p.is_active !== false).map(p => {
                  const tracksStock = p.track_inventory ?? ["Hardware", "Accessories", "Networking", "Security"].includes(p.category);
                  const unavailable = tracksStock && Number(p.quantity_in_stock || 0) < Number(addItemQty || 1);
                  return (
                    <SelectItem key={p.id} value={p.id} disabled={unavailable}>
                      {p.name} - ${p.retail_price?.toFixed(2)} {tracksStock ? `(${p.quantity_in_stock} in stock${unavailable ? " — insufficient" : ""})` : "(not stock tracked)"}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Input type="number" min="1" className="w-20" value={addItemQty} onChange={e => setAddItemQty(parseInt(e.target.value) || 1)} />
            <Button onClick={handleAddItemToTicket} disabled={!addItemProduct || selectedStockInsufficient} data-testid="confirm-add-item"><Plus className="w-4 h-4 mr-1" />Add</Button>
          </div>
          {selectedProduct && <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.05] px-3 py-2 text-xs text-violet-100">
            <span className="font-semibold">Applied price:</span> ${selectedUnitPrice.toFixed(2)} each · ${((Number(addItemQty || 1)) * selectedUnitPrice).toFixed(2)} total
            {selectedTier && <span className="ml-2 rounded border border-violet-500/30 px-1.5 py-0.5 text-[10px] text-violet-200">Tier {selectedTier.min_qty}+</span>}
          </div>}
          {selectedStockInsufficient && <p className="text-xs text-amber-500">Only {selectedProduct.quantity_in_stock} unit(s) are available for this tracked product.</p>}
          {ticketProducts.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Total</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {ticketProducts.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium text-sm">
                        <div className="flex items-center gap-2">
                          <span>{p.product_name}</span>
                          {p.pricing_source === "quantity_tier" && <Badge variant="outline" className="border-violet-500/30 bg-violet-500/[0.08] text-[9px] text-violet-200">Tier {p.tier_min_qty}+</Badge>}
                          {p.invoice_id && <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/[0.08] text-[9px] text-emerald-200">Invoiced</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">{p.quantity}</TableCell>
                      <TableCell className="text-right font-mono">${(p.unit_price || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono font-bold">${(p.total || 0).toFixed(2)}</TableCell>
                      <TableCell><Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => handleRemoveItemFromTicket(p.id)} disabled={Boolean(p.invoice_id)} title={p.invoice_id ? "Invoiced items cannot be removed" : "Remove item"}><Trash2 className="w-3 h-3" /></Button></TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} className="text-right font-semibold">Total</TableCell>
                    <TableCell className="text-right font-mono font-bold text-green-400">${unbilledTotal.toFixed(2)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}

export function PushInvoiceDialog({
  open, onOpenChange, ticketProducts, invoicesList, pushToExisting, setPushToExisting, handlePushToInvoice, ticket,
}) {
  const unbilledItems = ticketProducts.filter(item => !item.invoice_id);
  const unbilledTotal = unbilledItems.reduce((sum, item) => sum + (item.total || 0), 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden border-cyan-500/25 bg-[linear-gradient(145deg,rgba(9,22,30,0.98),rgba(13,15,21,0.98))] p-0">
        <DialogHeader className="border-b border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.17),transparent_45%),linear-gradient(135deg,rgba(16,185,129,0.08),transparent)] px-6 py-5 pr-14"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Billing hand-off</p><DialogTitle className="mt-1 flex items-center gap-2 text-xl text-zinc-100"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10"><Receipt className="h-4 w-4 text-emerald-300" /></span>Send ticket items to invoice</DialogTitle><p className="mt-2 text-sm text-zinc-400">Review the unbilled work, then create a new invoice or safely append it to an existing draft.</p></DialogHeader>
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] px-3 py-2.5">
            <div className="min-w-0"><p className="truncate text-xs font-semibold text-zinc-200">{ticket?.ticket_number || "Ticket billing"}</p><p className="mt-0.5 truncate text-[10px] text-zinc-500">{ticket?.client_name || "No customer selected"}</p></div>
            <span className="shrink-0 rounded-md border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-200">Ready to bill</span>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/15 bg-emerald-500/[0.05] p-3"><span className="text-xs text-zinc-400">Unbilled ticket items</span><span className="font-mono text-sm font-bold text-emerald-300">{unbilledItems.length} · ${unbilledTotal.toFixed(2)}</span></div>
          <div className="space-y-3">
            <Button className="h-10 w-full bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={() => handlePushToInvoice(null)} disabled={unbilledItems.length === 0} data-testid="create-new-invoice-btn">
              <Plus className="w-4 h-4 mr-1" />Create New Invoice
            </Button>
            {invoicesList.length > 0 && (
              <>
                <Separator />
                <Label className="text-xs text-zinc-300">Or add to an existing draft</Label>
                <Select value={pushToExisting || "__none"} onValueChange={v => setPushToExisting(v === "__none" ? "" : v)}>
                  <SelectTrigger className="border-cyan-400/20 bg-black/20"><SelectValue placeholder="Select invoice..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Choose...</SelectItem>
                    {invoicesList.filter(inv => inv.status !== "paid" && inv.status !== "cancelled").map(inv => (
                      <SelectItem key={inv.id} value={inv.id}>{inv.invoice_number} - {inv.client_name || "No client"} (${inv.total?.toFixed(2)})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {pushToExisting && <Button className="w-full" onClick={() => handlePushToInvoice(pushToExisting)} disabled={unbilledItems.length === 0} data-testid="push-to-existing-btn">Add to {invoicesList.find(i => i.id === pushToExisting)?.invoice_number}</Button>}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
