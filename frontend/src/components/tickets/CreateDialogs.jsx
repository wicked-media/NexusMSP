import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Brain, Loader2, Wrench, Radio, UserRound, Monitor, ClipboardList, AlertTriangle, MapPin, CalendarClock, FileText, Building2, ShieldCheck, Sparkles, Check, ChevronsUpDown, CircleCheck, CircleDashed } from "lucide-react";
import { priorityConfig } from "@/config/ticketConfig";

function TicketSearchPicker({
  items = [],
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyLabel = "No matching records",
  allowNone = false,
  noneLabel = "None",
  testId,
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find(item => String(item.id) === String(value));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="h-10 w-full justify-between bg-background/65 px-3 font-normal" data-testid={testId}>
          <span className={`truncate ${selected ? "text-foreground" : "text-muted-foreground"}`}>{selected?.label || (allowNone && !value ? noneLabel : placeholder)}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-45" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder || placeholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup heading="Available">
              {allowNone && (
                <CommandItem value={`none ${noneLabel}`} onSelect={() => { onChange(""); setOpen(false); }}>
                  <Check className={`mr-2 h-4 w-4 ${!value ? "opacity-100" : "opacity-0"}`} />
                  <span>{noneLabel}</span>
                </CommandItem>
              )}
              {items.map(item => (
                <CommandItem key={item.id} value={`${item.label} ${item.description || ""} ${item.keywords || ""}`} onSelect={() => { onChange(item.id); setOpen(false); }}>
                  <Check className={`mr-2 h-4 w-4 ${String(item.id) === String(value) ? "opacity-100" : "opacity-0"}`} />
                  <span className="min-w-0">
                    <span className="block truncate">{item.label}</span>
                    {item.description && <span className="block truncate text-[10px] text-muted-foreground">{item.description}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function CreateTicketDialog({
  open, onOpenChange, formData, setFormData, clients, clientContacts = [], devices, users, tickets,
  handleAiTriage, triaging, triageResult, applyTriage, handleCreateTicket, services,
}) {
  const selectedClient = clients.find(client => client.id === formData.client_id);
  const availableContacts = clientContacts.length ? clientContacts : (selectedClient?.contacts || []);
  const selectedContact = availableContacts.find(contact => String(contact.id || contact.name) === String(formData.contact_id));
  const selectedAssignee = users.find(user => user.id === formData.assigned_to);
  const selectedService = services?.find(service => service.code === formData.service_code);
  const linkedDeviceCount = new Set([...(formData.device_ids || []), ...(formData.device_id ? [formData.device_id] : [])]).size;
  const canCreate = Boolean(formData.title?.trim() && formData.client_id);
  const readiness = [
    { label: "Service brief", ready: Boolean(formData.title?.trim()) },
    { label: "Client", ready: Boolean(selectedClient) },
    { label: "Requester", ready: Boolean(selectedContact) },
    { label: "Routing", ready: Boolean(formData.priority && formData.category) },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NexusWorkflowDialog
        eyebrow="Service desk intake · audit ready"
        title="Create a service ticket"
        description="Capture the operational brief once. NexusMSP will inherit the client service tier, calculate SLA targets, and preserve the intake context on the ticket."
        icon={FileText}
        tone="cyan"
        className="max-w-6xl"
        contentClassName="scrollbar-thin space-y-4"
        data-testid="create-ticket-workflow"
        headerAccessory={<div className="grid grid-cols-4 gap-1.5">
              {readiness.map((item, index) => (
                <div key={item.label} className={`min-w-[92px] rounded-lg border px-2.5 py-2 ${item.ready ? "border-emerald-400/25 bg-emerald-400/[0.07]" : "border-white/[0.08] bg-white/[0.025]"}`}>
                  <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.11em] text-zinc-500">
                    {item.ready ? <CircleCheck className="h-3 w-3 text-emerald-300" /> : <CircleDashed className="h-3 w-3" />}0{index + 1}
                  </div>
                  <p className={`mt-1 text-[10px] ${item.ready ? "text-emerald-100" : "text-zinc-500"}`}>{item.label}</p>
                </div>
              ))}
            </div>}
        footer={<><p className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />The service desk record opens immediately after creation.</p><div className="flex gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={handleCreateTicket} disabled={!canCreate} className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" data-testid="create-ticket-submit"><Plus className="mr-1.5 w-4 h-4" />Create and open ticket</Button></div></>}
      >
          <section className="grid gap-2 rounded-xl border border-white/[0.08] bg-black/[0.14] p-3 md:grid-cols-4" data-testid="ticket-intake-summary">
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2.5"><span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Client</span><p className="mt-1 truncate text-xs font-medium text-zinc-200">{selectedClient?.name || "Not selected"}</p><p className="truncate text-[10px] text-zinc-600">{selectedContact?.name || "No requester selected"}</p></div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2.5"><span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Service policy</span><p className="mt-1 truncate text-xs font-medium text-zinc-200">{selectedService?.name || "Manual routing"}</p><p className="truncate text-[10px] text-zinc-600">{selectedService ? `${selectedService.sla_resolve_hours || "—"}h resolution target` : "Client SLA inherited"}</p></div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2.5"><span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Ownership</span><p className="mt-1 truncate text-xs font-medium text-zinc-200">{selectedAssignee?.name || "Dispatch queue"}</p><p className="truncate text-[10px] capitalize text-zinc-600">{formData.priority || "medium"} priority · {formData.impact || "medium"} impact</p></div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2.5"><span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Affected assets</span><p className="mt-1 truncate text-xs font-medium text-zinc-200">{linkedDeviceCount ? `${linkedDeviceCount} linked ${linkedDeviceCount === 1 ? "asset" : "assets"}` : "No asset linked"}</p><p className="truncate text-[10px] text-zinc-600">{formData.parent_id ? "Linked to parent ticket" : "Standalone service record"}</p></div>
          </section>
          <section className="space-y-3 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.025] p-4 shadow-sm">
            <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-cyan-300" /><h3 className="text-sm font-semibold">Service brief</h3><span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Required context</span></div>
            <div><Label>Title <span className="text-destructive">*</span></Label><Input className="mt-1.5 bg-background/65" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="Brief, outcome-focused description of the issue" data-testid="create-title" /></div>
            <div><Label>Description</Label><Textarea className="mt-1.5 bg-background/65" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={4} placeholder="Describe the impact, affected people or systems, timing, and any steps already tried." data-testid="create-desc" /></div>
          </section>

          {(services?.length > 0) && (
            <section className="p-4 rounded-xl border border-violet-500/25 bg-violet-500/[0.045]">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><Label className="text-xs uppercase tracking-wider text-violet-200 flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5" />Service policy <span className="normal-case tracking-normal text-muted-foreground">Select a service to apply its SLA and billing rules.</span></Label><Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-cyan-200 hover:bg-cyan-500/[0.08] hover:text-cyan-100" onClick={() => window.location.assign("/service-catalog")} data-testid="manage-service-policies">Manage policies</Button></div>
              <Select
                value={formData.service_code || "__none"}
                onValueChange={v => {
                  if (v === "__none") {
                    setFormData({ ...formData, service_code: "", service_name: "" });
                    return;
                  }
                  const svc = services.find(s => s.code === v);
                  setFormData({
                    ...formData,
                    service_code: v,
                    service_name: svc?.name,
                    priority: svc?.default_priority || formData.priority,
                    category: svc?.category || formData.category,
                  });
                }}
              >
                <SelectTrigger data-testid="create-service-code"><SelectValue placeholder="No service / manual" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— No service / manual —</SelectItem>
                  {services.filter(s => s.is_active !== false).map(s => (
                    <SelectItem key={s.id} value={s.code}>{s.code} · {s.name} (SLA: {s.sla_resolve_hours}h · ${s.billing_unit_price}/{s.billing_unit})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>
          )}

          <section className="rounded-xl border border-border/70 bg-muted/[0.10] p-3.5">
          <div className="flex flex-wrap items-center gap-2">
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
          {!triageResult?.triage && <p className="mt-2 text-[11px] text-muted-foreground">Use AI triage once the brief is complete to recommend a category, urgency, tags, and technician. You remain in control of what is applied.</p>}
          </section>

          <section className="rounded-xl border border-border/70 bg-muted/[0.10] p-4">
          <div className="mb-3 flex items-center gap-2"><Building2 className="h-4 w-4 text-cyan-300" /><h3 className="text-sm font-semibold">Client and affected asset</h3><span className="ml-auto text-[10px] text-muted-foreground">The client tier is applied automatically</span></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label>Client *</Label>
              <TicketSearchPicker
                items={clients.map(client => ({ id: client.id, label: client.name || client.company_name, description: client.email || client.contact_email || client.phone || "Managed client", keywords: `${client.company_name || ""} ${client.email || ""}` }))}
                value={formData.client_id}
                onChange={value => setFormData({ ...formData, client_id: value, contact_id: "", device_id: "", device_ids: [] })}
                placeholder="Search clients…"
                searchPlaceholder="Type a client, contact or email…"
                emptyLabel="No matching client"
                testId="create-client"
              />
            </div>
            <div><Label>Contact</Label>
              <TicketSearchPicker
                items={availableContacts.map((contact, index) => ({ id: contact.id || contact.name || `contact-${index}`, label: contact.name || contact.email || "Unnamed contact", description: contact.email || contact.role || "Client contact", keywords: `${contact.email || ""} ${contact.phone || contact.mobile || ""}` }))}
                value={formData.contact_id}
                onChange={value => setFormData({ ...formData, contact_id: value })}
                placeholder={selectedClient ? "Search contacts…" : "Select a client first"}
                searchPlaceholder="Type a name, email or phone…"
                emptyLabel={selectedClient ? "No matching contacts" : "Select a client first"}
                allowNone
                noneLabel="No specific requester"
                testId="create-contact"
              />
            </div>
            <div><Label>Linked Devices</Label>
              <div className="space-y-1.5">
                <TicketSearchPicker
                  items={devices
                    .filter(device => !formData.client_id || device.client_id === formData.client_id)
                    .filter(device => !(formData.device_ids || []).includes(device.id) && device.id !== formData.device_id)
                    .map(device => ({ id: device.id, label: device.name || device.hostname || "Unnamed asset", description: [device.os, device.serial_number, device.status].filter(Boolean).join(" · "), keywords: `${device.hostname || ""} ${device.serial_number || ""}` }))}
                  value=""
                  onChange={value => {
                    if (!value) return;
                    const ids = formData.device_ids || (formData.device_id ? [formData.device_id] : []);
                    if (!ids.includes(value)) setFormData({ ...formData, device_ids: [...ids, value], device_id: formData.device_id || value });
                  }}
                  placeholder="+ Search and link an asset…"
                  searchPlaceholder="Type an asset, hostname or serial…"
                  emptyLabel={formData.client_id ? "No other client assets" : "No matching assets"}
                  testId="create-device"
                />
                {/* Chip list */}
                {((formData.device_ids?.length || 0) > 0 || formData.device_id) && (
                  <div className="flex flex-wrap gap-1">
                    {(formData.device_ids?.length ? formData.device_ids : (formData.device_id ? [formData.device_id] : [])).map(did => {
                      const d = devices.find(x => x.id === did);
                      const isPrimary = did === formData.device_id || (!formData.device_id && did === formData.device_ids?.[0]);
                      return (
                        <span
                          key={did}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] ${
                            isPrimary
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                              : "border-border bg-muted/30"
                          }`}
                          title={isPrimary ? "Primary device" : "Click ⭐ to make primary"}
                        >
                          {isPrimary && <span className="text-amber-400">⭐</span>}
                          <span className="truncate max-w-[120px]">{d?.name || did}</span>
                          {!isPrimary && (
                            <button
                              type="button"
                              className="text-[9px] hover:text-amber-300 px-0.5"
                              onClick={() => setFormData({ ...formData, device_id: did })}
                            >★</button>
                          )}
                          <button
                            type="button"
                            className="text-[10px] hover:text-rose-400 px-0.5"
                            onClick={() => {
                              const filtered = (formData.device_ids || []).filter(x => x !== did);
                              const newPrimary = formData.device_id === did ? (filtered[0] || "") : formData.device_id;
                              setFormData({ ...formData, device_ids: filtered, device_id: newPrimary });
                            }}
                          >×</button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
          </section>

          <section className="rounded-xl border border-border/70 bg-muted/[0.10] p-4">
          <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" /><h3 className="text-sm font-semibold">Routing and service level</h3><span className="ml-auto text-[10px] text-muted-foreground">Sets dispatch, reporting, and SLA visibility</span></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
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
              <TicketSearchPicker
                items={users.map(user => ({ id: user.id, label: user.name, description: user.role || user.email || "Technician", keywords: `${user.email || ""} ${user.role || ""}` }))}
                value={formData.assigned_to}
                onChange={value => setFormData({ ...formData, assigned_to: value })}
                placeholder="Search technicians…"
                searchPlaceholder="Type a technician, role or email…"
                allowNone
                noneLabel="Unassigned · dispatch queue"
                testId="create-assigned"
              />
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
              <TicketSearchPicker
                items={tickets.filter(ticket => !ticket.parent_id).map(ticket => ({ id: ticket.id, label: `${ticket.ticket_number} · ${ticket.title}`, description: `${ticket.client_name || "Client"} · ${ticket.status || "open"}`, keywords: `${ticket.ticket_number || ""} ${ticket.client_name || ""}` }))}
                value={formData.parent_id}
                onChange={value => setFormData({ ...formData, parent_id: value })}
                placeholder="Search parent tickets…"
                searchPlaceholder="Type ticket number, title or client…"
                allowNone
                noneLabel="Standalone ticket"
                testId="create-parent-ticket"
              />
            </div>
          </div>

          </section>

          <section className="rounded-xl border border-border/70 bg-muted/[0.10] p-4"><div className="mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-300" /><h3 className="text-sm font-semibold">Operational context</h3><span className="text-[10px] text-muted-foreground">Optional tags improve search and reporting</span></div><div><Label>Tags</Label>
            <div className="flex gap-2 flex-wrap mb-2">{(formData.tags || []).map(t => (
              <Badge key={t} variant="secondary" className="gap-1">{t}
                <button className="ml-1 text-xs hover:text-destructive" onClick={() => setFormData({ ...formData, tags: formData.tags.filter(tag => tag !== t) })}>x</button>
              </Badge>
            ))}</div>
            <Input placeholder="Type a tag and press Enter" data-testid="create-tags"
              onKeyDown={e => { if (e.key === "Enter" && e.target.value.trim()) { e.preventDefault(); setFormData({ ...formData, tags: [...(formData.tags || []), e.target.value.trim()] }); e.target.value = ""; } }} />
          </div></section>
      </NexusWorkflowDialog>
    </Dialog>
  );
}

export function CreateWorkshopJobDialog({ open, onOpenChange, wsForm, setWsForm, users, clients = [], handleCreateWsJob }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NexusWorkflowDialog
        eyebrow="Workshop intake · audit ready"
        title="Check in workshop repair"
        description="Create a job card with the essentials. Intake, quote and repair evidence can be captured after check-in."
        icon={Wrench}
        tone="cyan"
        className="max-w-3xl"
        contentClassName="space-y-4"
        data-testid="workshop-job-workflow"
        footer={<><span className="hidden text-xs text-muted-foreground sm:block">A job number and repair timeline will be created immediately.</span><div className="flex gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={handleCreateWsJob} disabled={!wsForm.customer_name.trim() || !wsForm.fault_description.trim()} className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" data-testid="create-ws-submit"><Wrench className="mr-1 w-4 h-4" />Check in and open job</Button></div></>}
      >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4 space-y-3">
              <div className="flex items-center gap-2"><UserRound className="w-4 h-4 text-cyan-300" /><h3 className="text-sm font-semibold">1. Customer</h3></div>
              <div><Label>Linked client</Label><Select value={wsForm.client_id || "none"} onValueChange={value => { const client = clients.find(item => item.id === value); setWsForm({ ...wsForm, client_id: value === "none" ? "" : value, customer_name: client?.company_name || client?.name || wsForm.customer_name, customer_phone: client?.phone || client?.mobile || wsForm.customer_phone, customer_email: client?.email || client?.contact_email || wsForm.customer_email }); }}><SelectTrigger data-testid="ws-client-select"><SelectValue placeholder="Select a managed client" /></SelectTrigger><SelectContent><SelectItem value="none">Unlinked / walk-in customer</SelectItem>{clients.map(client => <SelectItem key={client.id} value={client.id}>{client.company_name || client.name}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-[10px] text-muted-foreground">Links correspondence, billing, history and client reporting.</p></div>
              <div><Label>Customer name <span className="text-destructive">*</span></Label><Input value={wsForm.customer_name} onChange={e => setWsForm({ ...wsForm, customer_name: e.target.value })} placeholder="Name or business" data-testid="ws-customer" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Phone</Label><Input value={wsForm.customer_phone} onChange={e => setWsForm({ ...wsForm, customer_phone: e.target.value })} placeholder="Best contact number" /></div>
                <div><Label>Email</Label><Input value={wsForm.customer_email} onChange={e => setWsForm({ ...wsForm, customer_email: e.target.value })} placeholder="name@example.com" type="email" /></div>
              </div>
            </section>
            <section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4 space-y-3">
              <div className="flex items-center gap-2"><Monitor className="w-4 h-4 text-cyan-300" /><h3 className="text-sm font-semibold">2. Device received</h3></div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Type</Label>
                  <Select value={wsForm.device_type || "laptop"} onValueChange={v => setWsForm({ ...wsForm, device_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="laptop">Laptop</SelectItem><SelectItem value="desktop">Desktop</SelectItem><SelectItem value="phone">Phone</SelectItem><SelectItem value="tablet">Tablet</SelectItem><SelectItem value="printer">Printer</SelectItem><SelectItem value="network">Network device</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>Brand</Label><Input value={wsForm.device_brand} onChange={e => setWsForm({ ...wsForm, device_brand: e.target.value })} placeholder="Dell" /></div>
                <div><Label>Model</Label><Input value={wsForm.device_model} onChange={e => setWsForm({ ...wsForm, device_model: e.target.value })} placeholder="Latitude" /></div>
              </div>
              <div><Label>Serial number</Label><Input value={wsForm.serial_number} onChange={e => setWsForm({ ...wsForm, serial_number: e.target.value })} placeholder="Record if available" className="font-mono" /></div>
            </section>
          </div>
          <section className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.035] p-4 space-y-3">
            <div className="flex items-center gap-2"><ClipboardList className="w-4 h-4 text-cyan-300" /><h3 className="text-sm font-semibold">3. Repair brief</h3><span className="text-xs text-muted-foreground ml-auto">Give the bench technician useful starting context</span></div>
            <div><Label>Reported fault <span className="text-destructive">*</span></Label><Textarea value={wsForm.fault_description} onChange={e => setWsForm({ ...wsForm, fault_description: e.target.value })} rows={4} placeholder="What is the device doing, when did it start, and what has already been tried?" data-testid="ws-fault" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Priority</Label>
                <Select value={wsForm.priority} onValueChange={v => setWsForm({ ...wsForm, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="low">Low — when convenient</SelectItem><SelectItem value="normal">Normal — standard queue</SelectItem><SelectItem value="high">High — expedite</SelectItem><SelectItem value="critical">Critical — urgent repair</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Bench technician</Label>
                <Select value={wsForm.assigned_to || "none"} onValueChange={v => { const u = users.find(x => x.id === v); setWsForm({ ...wsForm, assigned_to: v === "none" ? "" : v, assigned_to_name: u?.name || "" }); }}>
                  <SelectTrigger><SelectValue placeholder="Leave in workshop queue" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Unassigned — workshop queue</SelectItem>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </section>
          <div className="flex gap-2 text-xs text-muted-foreground px-1"><AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />The job starts as checked in. Capture arrival condition, accessories and a signed intake from the job card.</div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}

export function CreateFieldJobDialog({ open, onOpenChange, fjForm, setFjForm, users, clients = [], handleCreateFjJob }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NexusWorkflowDialog
        eyebrow="Field service intake · audit ready"
        title="Dispatch field work"
        description="Create a clear site brief, schedule the visit and give the field technician what they need before departure."
        icon={Radio}
        tone="cyan"
        className="max-w-3xl"
        contentClassName="space-y-4"
        data-testid="field-job-workflow"
        footer={<><span className="hidden text-xs text-muted-foreground sm:block">A field job number and dispatch timeline will be created immediately.</span><div className="flex gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={handleCreateFjJob} disabled={!fjForm.customer_name.trim() || !fjForm.service_address.trim() || !fjForm.description.trim()} className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" data-testid="create-fj-submit"><Radio className="mr-1 w-4 h-4" />Dispatch and open job</Button></div></>}
      >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4 space-y-3"><div className="flex items-center gap-2"><UserRound className="w-4 h-4 text-cyan-300" /><h3 className="text-sm font-semibold">1. Customer & location</h3></div><div><Label>Linked client</Label><Select value={fjForm.client_id || "none"} onValueChange={value => { const client = clients.find(item => item.id === value); setFjForm({ ...fjForm, client_id: value === "none" ? "" : value, customer_name: client?.company_name || client?.name || fjForm.customer_name, customer_phone: client?.phone || client?.mobile || fjForm.customer_phone, customer_email: client?.email || client?.contact_email || fjForm.customer_email, service_address: client?.address || fjForm.service_address }); }}><SelectTrigger data-testid="fj-client-select"><SelectValue placeholder="Select a managed client" /></SelectTrigger><SelectContent><SelectItem value="none">Unlinked / ad hoc site</SelectItem>{clients.map(client => <SelectItem key={client.id} value={client.id}>{client.company_name || client.name}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-[10px] text-muted-foreground">Keeps scheduling, communications and billing under the correct client.</p></div><div className="grid grid-cols-2 gap-3"><div><Label>Customer name <span className="text-destructive">*</span></Label><Input value={fjForm.customer_name} onChange={e => setFjForm({ ...fjForm, customer_name: e.target.value })} placeholder="Customer or site" data-testid="fj-customer" /></div><div><Label>Contact phone</Label><Input value={fjForm.customer_phone} onChange={e => setFjForm({ ...fjForm, customer_phone: e.target.value })} placeholder="On-site contact" /></div></div><div><Label>Service address <span className="text-destructive">*</span></Label><Input value={fjForm.service_address} onChange={e => setFjForm({ ...fjForm, service_address: e.target.value })} placeholder="Full site address" data-testid="fj-address" /></div><div><Label>Zone / area</Label><Input value={fjForm.zone} onChange={e => setFjForm({ ...fjForm, zone: e.target.value })} placeholder="e.g. North, CBD, Rural" /></div></section>
            <section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4 space-y-3"><div className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-cyan-300" /><h3 className="text-sm font-semibold">2. Dispatch plan</h3></div><div><Label>Job category</Label><Select value={fjForm.job_category} onValueChange={v => setFjForm({ ...fjForm, job_category: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="installation">Installation</SelectItem><SelectItem value="maintenance">Maintenance</SelectItem><SelectItem value="troubleshooting">Troubleshooting</SelectItem><SelectItem value="decommission">Decommission</SelectItem><SelectItem value="survey">Site survey</SelectItem></SelectContent></Select></div><div className="grid grid-cols-3 gap-3"><div><Label>Date</Label><Input type="date" value={fjForm.scheduled_date} onChange={e => setFjForm({ ...fjForm, scheduled_date: e.target.value })} /></div><div><Label>Arrival time</Label><Input type="time" value={fjForm.scheduled_time} onChange={e => setFjForm({ ...fjForm, scheduled_time: e.target.value })} /></div><div><Label>Duration</Label><Input type="number" value={fjForm.estimated_duration || 60} onChange={e => setFjForm({ ...fjForm, estimated_duration: e.target.value })} placeholder="Minutes" /></div></div><div><Label>Field technician</Label><Select value={fjForm.assigned_to || "none"} onValueChange={v => { const u = users.find(x => x.id === v); setFjForm({ ...fjForm, assigned_to: v === "none" ? "" : v, assigned_to_name: u?.name || "" }); }}><SelectTrigger><SelectValue placeholder="Leave in dispatch queue" /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned — dispatch queue</SelectItem>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent></Select></div></section>
          </div>
          <section className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.035] p-4 space-y-3"><div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-cyan-300" /><h3 className="text-sm font-semibold">3. Site work brief</h3><span className="text-xs text-muted-foreground ml-auto">Make the first visit count</span></div><div><Label>Scope of work <span className="text-destructive">*</span></Label><Textarea value={fjForm.description} onChange={e => setFjForm({ ...fjForm, description: e.target.value })} rows={4} placeholder="What needs to be installed, investigated or completed? Include site access, risks and any equipment expected on site." data-testid="fj-description" /></div><div><Label>Priority</Label><Select value={fjForm.priority} onValueChange={v => setFjForm({ ...fjForm, priority: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low — schedule when available</SelectItem><SelectItem value="normal">Normal — planned visit</SelectItem><SelectItem value="high">High — expedite dispatch</SelectItem><SelectItem value="critical">Critical — urgent site response</SelectItem></SelectContent></Select></div></section>
          <div className="flex gap-2 text-xs text-muted-foreground px-1"><AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />After dispatch, capture site details, photos, materials and sign-off from the field job card.</div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}
