import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Plus, Brain, Loader2, Wrench, Radio } from "lucide-react";
import { priorityConfig } from "@/config/ticketConfig";

export function CreateTicketDialog({
  open, onOpenChange, formData, setFormData, clients, devices, users, tickets,
  handleAiTriage, triaging, triageResult, applyTriage, handleCreateTicket,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader><DialogTitle>Create New Ticket</DialogTitle></DialogHeader>
        <div className="space-y-4 overflow-y-auto max-h-[70vh] pr-1">
          <div><Label>Title *</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="Brief description of the issue" data-testid="create-title" /></div>
          <div><Label>Description</Label><Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={3} placeholder="Detailed description, steps to reproduce, etc." data-testid="create-desc" /></div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleAiTriage} disabled={triaging} className="text-cyan-400 border-cyan-500/30" data-testid="ai-triage-btn">
              {triaging ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Brain className="w-3 h-3 mr-1" />}
              AI Triage
            </Button>
            {triageResult?.triage && (
              <>
                <Badge className="bg-cyan-500/20 text-cyan-400">{triageResult.triage.category_confidence}% match</Badge>
                <Badge className={triageResult.triage.priority === "critical" ? "bg-red-500/20 text-red-400" : triageResult.triage.priority === "high" ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"}>{triageResult.triage.priority}</Badge>
                <Badge variant="outline">{triageResult.triage.category}</Badge>
                {triageResult.triage.recommended_assignee && <Badge variant="outline">{triageResult.triage.recommended_assignee.tech_name}</Badge>}
                {triageResult.triage.tags?.length > 0 && triageResult.triage.tags.map(t => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                <Button type="button" size="sm" onClick={applyTriage} className="bg-cyan-600 hover:bg-cyan-700 text-xs h-7" data-testid="apply-triage-btn">Apply</Button>
              </>
            )}
          </div>
          {triageResult?.triage?.priority_reason && (
            <div className="p-2 rounded-lg bg-cyan-500/5 border border-cyan-500/20 text-xs">
              <span className="font-bold text-cyan-400">AI Analysis: </span>
              <span className="text-muted-foreground">{triageResult.triage.priority_reason}</span>
              {triageResult.analysis?.infrastructure_impact && <Badge className="ml-2 bg-orange-500/20 text-orange-400 text-[9px]">Infrastructure Impact</Badge>}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div><Label>Client *</Label>
              <Select value={formData.client_id} onValueChange={v => setFormData({ ...formData, client_id: v, contact_id: "", device_id: "" })}>
                <SelectTrigger data-testid="create-client"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Contact</Label>
              <Select value={formData.contact_id || "none"} onValueChange={v => setFormData({ ...formData, contact_id: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="create-contact"><SelectValue placeholder="Select contact" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-- No specific contact --</SelectItem>
                  {formData.client_id && (clients.find(c => c.id === formData.client_id)?.contacts || []).map((ct, i) => (
                    <SelectItem key={ct.id || i} value={ct.id || ct.name}>{ct.name} - {ct.email || ct.role || "General"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Linked Device</Label>
              <Select value={formData.device_id || "none"} onValueChange={v => setFormData({ ...formData, device_id: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="create-device"><SelectValue placeholder="Select device" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-- No device --</SelectItem>
                  {devices.filter(d => !formData.client_id || d.client_id === formData.client_id).map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name} ({d.os} - {d.ip_address || "No IP"})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-3 gap-3">
            <div><Label>Ticket Type</Label>
              <Select value={formData.ticket_type} onValueChange={v => setFormData({ ...formData, ticket_type: v })}>
                <SelectTrigger data-testid="create-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="incident">Incident</SelectItem>
                  <SelectItem value="service_request">Service Request</SelectItem>
                  <SelectItem value="problem">Problem</SelectItem>
                  <SelectItem value="change_request">Change Request</SelectItem>
                  <SelectItem value="alert">Alert / Monitoring</SelectItem>
                  <SelectItem value="task">Task</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Category</Label>
              <Select value={formData.category} onValueChange={v => setFormData({ ...formData, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="support">General Support</SelectItem>
                  <SelectItem value="hardware">Hardware</SelectItem>
                  <SelectItem value="software">Software</SelectItem>
                  <SelectItem value="network">Network</SelectItem>
                  <SelectItem value="security">Security</SelectItem>
                  <SelectItem value="email">Email / O365</SelectItem>
                  <SelectItem value="backup">Backup / DR</SelectItem>
                  <SelectItem value="onboarding">Onboarding / Offboarding</SelectItem>
                  <SelectItem value="project">Project Work</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Source</Label>
              <Select value={formData.source} onValueChange={v => setFormData({ ...formData, source: v })}>
                <SelectTrigger data-testid="create-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="portal">Client Portal</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="phone">Phone Call</SelectItem>
                  <SelectItem value="chat">Live Chat</SelectItem>
                  <SelectItem value="monitoring">Monitoring Alert</SelectItem>
                  <SelectItem value="walk_in">Walk-in</SelectItem>
                  <SelectItem value="internal">Internal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div><Label>Priority</Label>
              <Select value={formData.priority} onValueChange={v => setFormData({ ...formData, priority: v })}>
                <SelectTrigger data-testid="create-priority"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(priorityConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Impact</Label>
              <Select value={formData.impact} onValueChange={v => setFormData({ ...formData, impact: v })}>
                <SelectTrigger data-testid="create-impact"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low - Single user</SelectItem>
                  <SelectItem value="medium">Medium - Department</SelectItem>
                  <SelectItem value="high">High - Organization-wide</SelectItem>
                  <SelectItem value="critical">Critical - Business down</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Assign To</Label>
              <Select value={formData.assigned_to || "none"} onValueChange={v => setFormData({ ...formData, assigned_to: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="create-assigned"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-- Unassigned --</SelectItem>
                  {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div><Label>Due Date</Label>
              <Input type="date" value={formData.due_date || ""} onChange={e => setFormData({ ...formData, due_date: e.target.value })} data-testid="create-due-date" />
            </div>
            <div><Label>Estimated Hours</Label>
              <Input type="number" step="0.5" value={formData.estimated_hours || ""} onChange={e => setFormData({ ...formData, estimated_hours: e.target.value })} placeholder="e.g. 2.5" data-testid="create-est-hours" />
            </div>
            <div><Label>Parent Ticket</Label>
              <Select value={formData.parent_id || "none"} onValueChange={v => setFormData({ ...formData, parent_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="None (standalone)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (standalone ticket)</SelectItem>
                  {tickets.filter(t => !t.parent_id).slice(0, 30).map(t => <SelectItem key={t.id} value={t.id}>{t.ticket_number} - {t.title?.slice(0, 30)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div><Label>Tags</Label>
            <div className="flex gap-2 flex-wrap mb-2">{(formData.tags || []).map(t => (
              <Badge key={t} variant="secondary" className="gap-1">{t}
                <button className="ml-1 text-xs hover:text-destructive" onClick={() => setFormData({ ...formData, tags: formData.tags.filter(tag => tag !== t) })}>x</button>
              </Badge>
            ))}</div>
            <Input placeholder="Type a tag and press Enter" data-testid="create-tags"
              onKeyDown={e => { if (e.key === "Enter" && e.target.value.trim()) { e.preventDefault(); setFormData({ ...formData, tags: [...(formData.tags || []), e.target.value.trim()] }); e.target.value = ""; } }} />
          </div>
        </div>
        <DialogFooter><Button onClick={handleCreateTicket} data-testid="create-ticket-submit"><Plus className="w-4 h-4 mr-1" />Create Ticket</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreateWorkshopJobDialog({ open, onOpenChange, wsForm, setWsForm, users, handleCreateWsJob }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Wrench className="w-5 h-5 text-purple-400" />New Workshop Job</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Customer Name</Label><Input value={wsForm.customer_name} onChange={e => setWsForm({ ...wsForm, customer_name: e.target.value })} data-testid="ws-customer" /></div>
            <div><Label>Phone</Label><Input value={wsForm.customer_phone} onChange={e => setWsForm({ ...wsForm, customer_phone: e.target.value })} /></div>
          </div>
          <div><Label>Customer Email</Label><Input value={wsForm.customer_email} onChange={e => setWsForm({ ...wsForm, customer_email: e.target.value })} placeholder="customer@example.com" type="email" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Device Type</Label>
              <Select value={wsForm.device_type || "laptop"} onValueChange={v => setWsForm({ ...wsForm, device_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="laptop">Laptop</SelectItem><SelectItem value="desktop">Desktop</SelectItem><SelectItem value="phone">Phone</SelectItem><SelectItem value="tablet">Tablet</SelectItem><SelectItem value="printer">Printer</SelectItem><SelectItem value="network">Network Device</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Brand</Label><Input value={wsForm.device_brand} onChange={e => setWsForm({ ...wsForm, device_brand: e.target.value })} placeholder="Dell, HP..." /></div>
            <div><Label>Model</Label><Input value={wsForm.device_model} onChange={e => setWsForm({ ...wsForm, device_model: e.target.value })} /></div>
          </div>
          <div><Label>Serial Number</Label><Input value={wsForm.serial_number} onChange={e => setWsForm({ ...wsForm, serial_number: e.target.value })} className="font-mono" /></div>
          <div><Label>Fault Description</Label><Textarea value={wsForm.fault_description} onChange={e => setWsForm({ ...wsForm, fault_description: e.target.value })} rows={3} data-testid="ws-fault" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Priority</Label>
              <Select value={wsForm.priority} onValueChange={v => setWsForm({ ...wsForm, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Assign Tech</Label>
              <Select value={wsForm.assigned_to || "none"} onValueChange={v => { const u = users.find(x => x.id === v); setWsForm({ ...wsForm, assigned_to: v === "none" ? "" : v, assigned_to_name: u?.name || "" }); }}>
                <SelectTrigger><SelectValue placeholder="Assign" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Unassigned</SelectItem>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter><Button onClick={handleCreateWsJob} data-testid="create-ws-submit"><Wrench className="w-4 h-4 mr-1" />Create Job</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreateFieldJobDialog({ open, onOpenChange, fjForm, setFjForm, users, handleCreateFjJob }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Radio className="w-5 h-5 text-cyan-400" />New Cabling / WISP Job</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Customer Name</Label><Input value={fjForm.customer_name} onChange={e => setFjForm({ ...fjForm, customer_name: e.target.value })} data-testid="fj-customer" /></div>
            <div><Label>Phone</Label><Input value={fjForm.customer_phone} onChange={e => setFjForm({ ...fjForm, customer_phone: e.target.value })} /></div>
          </div>
          <div><Label>Service Address</Label><Input value={fjForm.service_address} onChange={e => setFjForm({ ...fjForm, service_address: e.target.value })} data-testid="fj-address" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Zone / Area</Label><Input value={fjForm.zone} onChange={e => setFjForm({ ...fjForm, zone: e.target.value })} placeholder="e.g. North, CBD, Rural" /></div>
            <div><Label>Job Category</Label>
              <Select value={fjForm.job_category} onValueChange={v => setFjForm({ ...fjForm, job_category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="installation">Installation</SelectItem><SelectItem value="maintenance">Maintenance</SelectItem><SelectItem value="troubleshooting">Troubleshooting</SelectItem><SelectItem value="decommission">Decommission</SelectItem><SelectItem value="survey">Site Survey</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Description</Label><Textarea value={fjForm.description} onChange={e => setFjForm({ ...fjForm, description: e.target.value })} rows={2} data-testid="fj-description" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Date</Label><Input type="date" value={fjForm.scheduled_date} onChange={e => setFjForm({ ...fjForm, scheduled_date: e.target.value })} /></div>
            <div><Label>Time</Label><Input type="time" value={fjForm.scheduled_time} onChange={e => setFjForm({ ...fjForm, scheduled_time: e.target.value })} /></div>
            <div><Label>Duration (min)</Label><Input type="number" value={fjForm.estimated_duration || 60} onChange={e => setFjForm({ ...fjForm, estimated_duration: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Priority</Label>
              <Select value={fjForm.priority} onValueChange={v => setFjForm({ ...fjForm, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Assign Tech</Label>
              <Select value={fjForm.assigned_to || "none"} onValueChange={v => { const u = users.find(x => x.id === v); setFjForm({ ...fjForm, assigned_to: v === "none" ? "" : v, assigned_to_name: u?.name || "" }); }}>
                <SelectTrigger><SelectValue placeholder="Assign" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Unassigned</SelectItem>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter><Button onClick={handleCreateFjJob} data-testid="create-fj-submit"><Radio className="w-4 h-4 mr-1" />Create Cabling / WISP Job</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
