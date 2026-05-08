import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, X, Send, DollarSign, CheckCircle } from "lucide-react";

// ============ WORKSHOP DIALOGS ============

export function WsAddPartDialog({ open, onOpenChange, allProducts, wsPartProduct, setWsPartProduct, wsPartQty, setWsPartQty, handleAddWsPart }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Part to Workshop Job</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">Stock will be deducted automatically.</p>
          <Select value={wsPartProduct || "__none"} onValueChange={v => setWsPartProduct(v === "__none" ? "" : v)}>
            <SelectTrigger data-testid="ws-part-select"><SelectValue placeholder="Select product" /></SelectTrigger>
            <SelectContent><SelectItem value="__none">Choose...</SelectItem>{allProducts.filter(p => p.is_active !== false).map(p => <SelectItem key={p.id} value={p.id}>{p.name} - ${p.retail_price?.toFixed(2)} ({p.quantity_in_stock} in stock)</SelectItem>)}</SelectContent>
          </Select>
          <Input type="number" min="1" value={wsPartQty} onChange={e => setWsPartQty(parseInt(e.target.value) || 1)} className="w-24" placeholder="Qty" />
        </div>
        <DialogFooter><Button onClick={handleAddWsPart} disabled={!wsPartProduct} data-testid="confirm-ws-part"><Plus className="w-4 h-4 mr-1" />Add Part</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WsQuoteBuilderDialog({ open, onOpenChange, wsQuoteItems, setWsQuoteItems, wsQuoteNotes, setWsQuoteNotes, handleSaveWsQuote }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Repair Quote Builder</DialogTitle></DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {wsQuoteItems.map((item, i) => (
            <div key={`k-${i}`} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-6"><Label className="text-xs">Description</Label><Input value={item.description} onChange={e => { const n = [...wsQuoteItems]; n[i].description = e.target.value; setWsQuoteItems(n); }} placeholder="Labour / Part / Service" /></div>
              <div className="col-span-2"><Label className="text-xs">Qty</Label><Input type="number" min="1" value={item.qty} onChange={e => { const n = [...wsQuoteItems]; n[i].qty = parseInt(e.target.value) || 1; setWsQuoteItems(n); }} /></div>
              <div className="col-span-3"><Label className="text-xs">Price</Label><Input type="number" step="0.01" value={item.price} onChange={e => { const n = [...wsQuoteItems]; n[i].price = parseFloat(e.target.value) || 0; setWsQuoteItems(n); }} /></div>
              <div className="col-span-1"><Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => setWsQuoteItems(prev => prev.filter((_, j) => j !== i))}><X className="w-4 h-4" /></Button></div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setWsQuoteItems(prev => [...prev, { description: "", qty: 1, price: 0 }])}><Plus className="w-3 h-3 mr-1" />Add Line</Button>
          <div className="flex justify-between font-bold text-lg border-t pt-3">
            <span>Total</span>
            <span className="text-green-400">${wsQuoteItems.reduce((s, i) => s + (Number(i.qty) || 1) * (Number(i.price) || 0), 0).toFixed(2)}</span>
          </div>
          <div><Label className="text-xs">Notes</Label><Textarea value={wsQuoteNotes} onChange={e => setWsQuoteNotes(e.target.value)} rows={2} placeholder="Additional notes for the customer..." /></div>
        </div>
        <DialogFooter><Button onClick={handleSaveWsQuote} data-testid="ws-save-quote"><DollarSign className="w-4 h-4 mr-1" />Save Quote</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WsNotifyCustomerDialog({ open, onOpenChange, viewWsJob, wsNotifyForm, setWsNotifyForm, handleWsNotifyCustomer }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Notify Customer</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Email</Label><Input value={wsNotifyForm.email} onChange={e => setWsNotifyForm({ ...wsNotifyForm, email: e.target.value })} placeholder="customer@example.com" data-testid="ws-notify-email" /></div>
          <div><Label>Subject</Label><Input value={wsNotifyForm.subject} onChange={e => setWsNotifyForm({ ...wsNotifyForm, subject: e.target.value })} /></div>
          <div><Label>Message</Label><Textarea value={wsNotifyForm.message} onChange={e => setWsNotifyForm({ ...wsNotifyForm, message: e.target.value })} rows={4} placeholder="Your device is ready for pickup..." data-testid="ws-notify-message" /></div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setWsNotifyForm(prev => ({ ...prev, message: `Hi ${viewWsJob.customer_name},\n\nYour device (${viewWsJob.device_brand || ""} ${viewWsJob.device_model || ""}) has been checked in for repair.\n\nJob Number: ${viewWsJob.job_number}\nFault: ${viewWsJob.fault_description}\n\nWe will keep you updated on progress.\n\nRegards,\nThe Workshop Team`, subject: `Device Checked In - ${viewWsJob.job_number}` }))}>Checked In</Button>
            <Button variant="outline" size="sm" onClick={() => setWsNotifyForm(prev => ({ ...prev, message: `Hi ${viewWsJob.customer_name},\n\nWe have completed the diagnosis on your ${viewWsJob.device_brand || ""} ${viewWsJob.device_model || ""}.\n\nPlease review the repair quote we have prepared. We will proceed once you approve.\n\nJob Number: ${viewWsJob.job_number}\n\nRegards,\nThe Workshop Team`, subject: `Quote Ready - ${viewWsJob.job_number}` }))}>Quote Ready</Button>
            <Button variant="outline" size="sm" onClick={() => setWsNotifyForm(prev => ({ ...prev, message: `Hi ${viewWsJob.customer_name},\n\nGreat news! Your ${viewWsJob.device_brand || ""} ${viewWsJob.device_model || ""} is ready for collection.\n\nJob Number: ${viewWsJob.job_number}\nTotal: $${(viewWsJob.total_cost || 0).toFixed(2)}\n\nPlease collect at your earliest convenience.\n\nRegards,\nThe Workshop Team`, subject: `Ready for Pickup - ${viewWsJob.job_number}` }))}>Ready for Pickup</Button>
          </div>
        </div>
        <DialogFooter><Button onClick={handleWsNotifyCustomer} data-testid="ws-send-notify"><Send className="w-4 h-4 mr-1" />Send Notification</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WsPushInvoiceDialog({ open, onOpenChange, viewWsJob, wsInvoiceList, handleWsPushToInvoice }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Push Workshop Job to Invoice</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Parts (${(viewWsJob.total_parts_cost || 0).toFixed(2)}) + Labour (${(viewWsJob.total_labour_cost || 0).toFixed(2)}) = <strong className="text-green-400">${(viewWsJob.total_cost || 0).toFixed(2)}</strong></p>
          <Button className="w-full" onClick={() => handleWsPushToInvoice(null)} data-testid="ws-new-invoice"><Plus className="w-4 h-4 mr-1" />Create New Invoice</Button>
          {wsInvoiceList.length > 0 && <>
            <Separator />
            <p className="text-xs text-muted-foreground">Or add to existing invoice:</p>
            <ScrollArea className="h-[200px]">
              {wsInvoiceList.slice(0, 20).map(inv => (
                <Button key={inv.id} variant="outline" className="w-full justify-start mb-1 text-xs" size="sm" onClick={() => handleWsPushToInvoice(inv.id)}>
                  {inv.invoice_number} - {inv.client_name} (${inv.total?.toFixed(2)})
                </Button>
              ))}
            </ScrollArea>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WsDeviceIntakeDialog({ open, onOpenChange, wsIntakeForm, setWsIntakeForm, handleSaveWsIntake }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Device Intake Details</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Customer Email</Label><Input value={wsIntakeForm.customer_email} onChange={e => setWsIntakeForm({ ...wsIntakeForm, customer_email: e.target.value })} placeholder="customer@example.com" data-testid="ws-intake-email" /></div>
          <div><Label>Condition on Arrival</Label>
            <Select value={wsIntakeForm.condition_on_arrival || "not_assessed"} onValueChange={v => setWsIntakeForm({ ...wsIntakeForm, condition_on_arrival: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="not_assessed">Not Assessed</SelectItem>
                <SelectItem value="excellent">Excellent - No visible damage</SelectItem>
                <SelectItem value="good">Good - Minor wear</SelectItem>
                <SelectItem value="fair">Fair - Some scratches/dents</SelectItem>
                <SelectItem value="poor">Poor - Significant damage</SelectItem>
                <SelectItem value="broken">Broken - Major physical damage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Accessories Received</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {["Charger", "Power Cable", "Bag/Case", "Mouse", "Keyboard", "USB Drive", "Manual", "Box"].map(acc => (
                <label key={acc} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <Checkbox checked={wsIntakeForm.accessories_received.includes(acc)} onCheckedChange={c => {
                    setWsIntakeForm(prev => ({ ...prev, accessories_received: c ? [...prev.accessories_received, acc] : prev.accessories_received.filter(a => a !== acc) }));
                  }} />{acc}
                </label>
              ))}
            </div>
          </div>
          <div><Label>Customer Password/PIN (for login)</Label><Input value={wsIntakeForm.customer_password} onChange={e => setWsIntakeForm({ ...wsIntakeForm, customer_password: e.target.value })} placeholder="Optional - stored securely" type="password" data-testid="ws-intake-password" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Warranty Status</Label>
              <Select value={wsIntakeForm.warranty_status} onValueChange={v => setWsIntakeForm({ ...wsIntakeForm, warranty_status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">Unknown</SelectItem>
                  <SelectItem value="in_warranty">In Warranty</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="void">Voided</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Warranty Expiry</Label><Input type="date" value={wsIntakeForm.warranty_expiry} onChange={e => setWsIntakeForm({ ...wsIntakeForm, warranty_expiry: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter><Button onClick={handleSaveWsIntake} data-testid="ws-save-intake"><CheckCircle className="w-4 h-4 mr-1" />Save Intake</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WsTemplatePickerDialog({ open, onOpenChange, wsTemplates, handleLoadWsTemplate }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Load Diagnostic Template</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Select a device-type template to load pre-built diagnostic checklist items.</p>
          {Object.entries(wsTemplates).map(([key, items]) => (
            <Button key={key} variant="outline" className="w-full justify-between" onClick={() => handleLoadWsTemplate(key)} data-testid={`ws-template-${key}`}>
              <span className="capitalize font-medium">{key}</span>
              <Badge variant="secondary" className="text-[10px]">{items.length} items</Badge>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ FIELD JOB DIALOGS ============

export function FjQuoteBuilderDialog({ open, onOpenChange, fjQuoteItems, setFjQuoteItems, fjQuoteNotes, setFjQuoteNotes, handleSaveFjQuote }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Service Quote Builder</DialogTitle></DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {fjQuoteItems.map((item, i) => (
            <div key={`k-${i}`} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-6"><Label className="text-xs">Description</Label><Input value={item.description} onChange={e => { const n = [...fjQuoteItems]; n[i].description = e.target.value; setFjQuoteItems(n); }} placeholder="Installation / Cable / Labour" /></div>
              <div className="col-span-2"><Label className="text-xs">Qty</Label><Input type="number" min="1" value={item.qty} onChange={e => { const n = [...fjQuoteItems]; n[i].qty = parseInt(e.target.value) || 1; setFjQuoteItems(n); }} /></div>
              <div className="col-span-3"><Label className="text-xs">Price</Label><Input type="number" step="0.01" value={item.price} onChange={e => { const n = [...fjQuoteItems]; n[i].price = parseFloat(e.target.value) || 0; setFjQuoteItems(n); }} /></div>
              <div className="col-span-1"><Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => setFjQuoteItems(prev => prev.filter((_, j) => j !== i))}><X className="w-4 h-4" /></Button></div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setFjQuoteItems(prev => [...prev, { description: "", qty: 1, price: 0 }])}><Plus className="w-3 h-3 mr-1" />Add Line</Button>
          <div className="flex justify-between font-bold text-lg border-t pt-3">
            <span>Total</span>
            <span className="text-green-400">${fjQuoteItems.reduce((s, i) => s + (Number(i.qty) || 1) * (Number(i.price) || 0), 0).toFixed(2)}</span>
          </div>
          <div><Label className="text-xs">Notes</Label><Textarea value={fjQuoteNotes} onChange={e => setFjQuoteNotes(e.target.value)} rows={2} placeholder="Additional notes..." /></div>
        </div>
        <DialogFooter><Button onClick={handleSaveFjQuote} data-testid="fj-save-quote"><DollarSign className="w-4 h-4 mr-1" />Save Quote</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FjAddEquipmentDialog({ open, onOpenChange, fjEquipForm, setFjEquipForm, handleAddFjEquipment }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Equipment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Type</Label>
              <Select value={fjEquipForm.equipment_type || "cpe"} onValueChange={v => setFjEquipForm({ ...fjEquipForm, equipment_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cpe">CPE / Radio</SelectItem>
                  <SelectItem value="router">Router</SelectItem>
                  <SelectItem value="switch">Switch</SelectItem>
                  <SelectItem value="antenna">Antenna / Dish</SelectItem>
                  <SelectItem value="ups">UPS / Power</SelectItem>
                  <SelectItem value="cable_box">Cable Box / Enclosure</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Action</Label>
              <Select value={fjEquipForm.action} onValueChange={v => setFjEquipForm({ ...fjEquipForm, action: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="installed">Installed</SelectItem>
                  <SelectItem value="replaced">Replaced</SelectItem>
                  <SelectItem value="removed">Removed</SelectItem>
                  <SelectItem value="inspected">Inspected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Brand</Label><Input value={fjEquipForm.brand} onChange={e => setFjEquipForm({ ...fjEquipForm, brand: e.target.value })} placeholder="Ubiquiti, Mikrotik..." /></div>
            <div><Label>Model</Label><Input value={fjEquipForm.model} onChange={e => setFjEquipForm({ ...fjEquipForm, model: e.target.value })} placeholder="LiteBeam 5AC..." /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Serial #</Label><Input value={fjEquipForm.serial_number} onChange={e => setFjEquipForm({ ...fjEquipForm, serial_number: e.target.value })} className="font-mono text-xs" /></div>
            <div><Label>MAC Address</Label><Input value={fjEquipForm.mac_address} onChange={e => setFjEquipForm({ ...fjEquipForm, mac_address: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" className="font-mono text-xs" /></div>
            <div><Label>IP Address</Label><Input value={fjEquipForm.ip_address} onChange={e => setFjEquipForm({ ...fjEquipForm, ip_address: e.target.value })} placeholder="192.168.1.1" className="font-mono text-xs" /></div>
          </div>
          <div><Label>Config Notes</Label><Textarea value={fjEquipForm.config_notes} onChange={e => setFjEquipForm({ ...fjEquipForm, config_notes: e.target.value })} rows={2} placeholder="SSID, channel, frequency, etc." /></div>
        </div>
        <DialogFooter><Button onClick={handleAddFjEquipment} disabled={!fjEquipForm.equipment_type} data-testid="fj-save-equip"><Plus className="w-4 h-4 mr-1" />Add Equipment</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FjAddMaterialDialog({ open, onOpenChange, fjMatForm, setFjMatForm, handleAddFjMaterial }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Material Used</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Material</Label><Input value={fjMatForm.material} onChange={e => setFjMatForm({ ...fjMatForm, material: e.target.value })} placeholder="Cat6 cable, RJ45 connectors, Cable ties..." data-testid="fj-mat-name" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Quantity</Label><Input type="number" min="1" value={fjMatForm.quantity} onChange={e => setFjMatForm({ ...fjMatForm, quantity: parseInt(e.target.value) || 1 })} /></div>
            <div><Label>Unit</Label>
              <Select value={fjMatForm.unit} onValueChange={v => setFjMatForm({ ...fjMatForm, unit: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="meters">Meters</SelectItem>
                  <SelectItem value="feet">Feet</SelectItem>
                  <SelectItem value="each">Each</SelectItem>
                  <SelectItem value="box">Box</SelectItem>
                  <SelectItem value="roll">Roll</SelectItem>
                  <SelectItem value="pack">Pack</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Unit Cost ($)</Label><Input type="number" step="0.01" value={fjMatForm.unit_cost} onChange={e => setFjMatForm({ ...fjMatForm, unit_cost: parseFloat(e.target.value) || 0 })} /></div>
          </div>
          <div className="text-right font-bold text-green-400">Total: ${((fjMatForm.quantity || 1) * (fjMatForm.unit_cost || 0)).toFixed(2)}</div>
        </div>
        <DialogFooter><Button onClick={handleAddFjMaterial} disabled={!fjMatForm.material} data-testid="fj-save-mat"><Plus className="w-4 h-4 mr-1" />Add Material</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FjSiteInfoDialog({ open, onOpenChange, fjSiteInfo, setFjSiteInfo, handleSaveFjSiteInfo }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Site Survey & Access Info</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          <div><Label>Customer Email</Label><Input value={fjSiteInfo.customer_email || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, customer_email: e.target.value })} placeholder="customer@example.com" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>GPS Latitude</Label><Input value={fjSiteInfo.gps_lat || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, gps_lat: e.target.value })} placeholder="-36.8485" className="font-mono text-xs" /></div>
            <div><Label>GPS Longitude</Label><Input value={fjSiteInfo.gps_lng || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, gps_lng: e.target.value })} placeholder="174.7633" className="font-mono text-xs" /></div>
            <div><Label>Elevation</Label><Input value={fjSiteInfo.elevation || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, elevation: e.target.value })} placeholder="12m" /></div>
          </div>
          <div><Label>Access Notes</Label><Textarea value={fjSiteInfo.access_notes || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, access_notes: e.target.value })} rows={2} placeholder="Gate code, parking instructions, roof access..." /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Mounting Type</Label>
              <Select value={fjSiteInfo.mounting_type || "wall"} onValueChange={v => setFjSiteInfo({ ...fjSiteInfo, mounting_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="wall">Wall Mount</SelectItem>
                  <SelectItem value="roof">Roof Mount</SelectItem>
                  <SelectItem value="pole">Pole Mount</SelectItem>
                  <SelectItem value="tower">Tower</SelectItem>
                  <SelectItem value="indoor">Indoor</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Cable Entry Point</Label><Input value={fjSiteInfo.cable_entry_point || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, cable_entry_point: e.target.value })} placeholder="Through wall, conduit, etc." /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Power Source</Label><Input value={fjSiteInfo.power_source || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, power_source: e.target.value })} placeholder="Mains, PoE, Solar..." /></div>
            <div><Label>Weather Conditions</Label>
              <Select value={fjSiteInfo.weather_conditions || "clear"} onValueChange={v => setFjSiteInfo({ ...fjSiteInfo, weather_conditions: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="clear">Clear</SelectItem>
                  <SelectItem value="cloudy">Cloudy</SelectItem>
                  <SelectItem value="rain">Rain</SelectItem>
                  <SelectItem value="wind">Windy</SelectItem>
                  <SelectItem value="storm">Storm</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Safety Hazards</Label><Textarea value={fjSiteInfo.safety_hazards || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, safety_hazards: e.target.value })} rows={2} placeholder="Working at heights, power lines nearby, aggressive dog..." /></div>
          <div><Label>Existing Infrastructure</Label><Textarea value={fjSiteInfo.existing_infrastructure || ""} onChange={e => setFjSiteInfo({ ...fjSiteInfo, existing_infrastructure: e.target.value })} rows={2} placeholder="Existing cabling, conduits, junction boxes..." /></div>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={fjSiteInfo.ladder_required || false} onCheckedChange={c => setFjSiteInfo({ ...fjSiteInfo, ladder_required: c })} />Ladder Required</label>
            <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={fjSiteInfo.roof_access || false} onCheckedChange={c => setFjSiteInfo({ ...fjSiteInfo, roof_access: c })} />Roof Access</label>
          </div>
        </div>
        <DialogFooter><Button onClick={handleSaveFjSiteInfo} data-testid="fj-save-site"><CheckCircle className="w-4 h-4 mr-1" />Save Site Info</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FjNotifyCustomerDialog({ open, onOpenChange, viewFjJob, fjNotifyForm, setFjNotifyForm, handleFjNotifyCustomer }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Notify Customer</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Email</Label><Input value={fjNotifyForm.email} onChange={e => setFjNotifyForm({ ...fjNotifyForm, email: e.target.value })} placeholder="customer@example.com" data-testid="fj-notify-email" /></div>
          <div><Label>Subject</Label><Input value={fjNotifyForm.subject} onChange={e => setFjNotifyForm({ ...fjNotifyForm, subject: e.target.value })} /></div>
          <div><Label>Message</Label><Textarea value={fjNotifyForm.message} onChange={e => setFjNotifyForm({ ...fjNotifyForm, message: e.target.value })} rows={4} placeholder="Your installation is scheduled..." data-testid="fj-notify-message" /></div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setFjNotifyForm(prev => ({ ...prev, message: `Hi ${viewFjJob.customer_name},\n\nOur technician is on the way to your location at ${viewFjJob.service_address}.\n\nJob: ${viewFjJob.job_number}\nETA: Approximately 30 minutes\n\nRegards,\nNexusOps Field Services`, subject: `Technician En Route - ${viewFjJob.job_number}` }))}>En Route</Button>
            <Button variant="outline" size="sm" onClick={() => setFjNotifyForm(prev => ({ ...prev, message: `Hi ${viewFjJob.customer_name},\n\nOur technician has arrived at ${viewFjJob.service_address} and is beginning work.\n\nJob: ${viewFjJob.job_number}\n\nRegards,\nNexusOps Field Services`, subject: `Technician On Site - ${viewFjJob.job_number}` }))}>On Site</Button>
            <Button variant="outline" size="sm" onClick={() => setFjNotifyForm(prev => ({ ...prev, message: `Hi ${viewFjJob.customer_name},\n\nGreat news! Your ${viewFjJob.job_category} job has been completed at ${viewFjJob.service_address}.\n\nJob: ${viewFjJob.job_number}\nSignal: ${viewFjJob.signal_strength || "N/A"} dBm\nSpeed: ${viewFjJob.speed_test_down || "N/A"} / ${viewFjJob.speed_test_up || "N/A"} Mbps\n\nPlease don't hesitate to contact us if you have any issues.\n\nRegards,\nNexusOps Field Services`, subject: `Job Completed - ${viewFjJob.job_number}` }))}>Completed</Button>
          </div>
        </div>
        <DialogFooter><Button onClick={handleFjNotifyCustomer} data-testid="fj-send-notify"><Send className="w-4 h-4 mr-1" />Send Notification</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FjPushInvoiceDialog({ open, onOpenChange, fjMatTotal, fjInvoiceList, handleFjPushToInvoice }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Push Field Job to Invoice</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Materials (${fjMatTotal.toFixed(2)}) + Labour will be added to the invoice.</p>
          <Button className="w-full" onClick={() => handleFjPushToInvoice(null)} data-testid="fj-new-invoice"><Plus className="w-4 h-4 mr-1" />Create New Invoice</Button>
          {fjInvoiceList.length > 0 && <>
            <Separator />
            <p className="text-xs text-muted-foreground">Or add to existing:</p>
            <ScrollArea className="h-[200px]">
              {fjInvoiceList.slice(0, 20).map(inv => (
                <Button key={inv.id} variant="outline" className="w-full justify-start mb-1 text-xs" size="sm" onClick={() => handleFjPushToInvoice(inv.id)}>
                  {inv.invoice_number} - {inv.client_name} (${inv.total?.toFixed(2)})
                </Button>
              ))}
            </ScrollArea>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FjTemplatePickerDialog({ open, onOpenChange, fjTemplates, handleLoadFjTemplate }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Load Field Checklist Template</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Select a job category template to load pre-built checklist items.</p>
          {Object.entries(fjTemplates).map(([key, items]) => (
            <Button key={key} variant="outline" className="w-full justify-between" onClick={() => handleLoadFjTemplate(key)} data-testid={`fj-template-${key}`}>
              <span className="capitalize font-medium">{key.replace("_", " ")}</span>
              <Badge variant="secondary" className="text-[10px]">{items.length} items</Badge>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
