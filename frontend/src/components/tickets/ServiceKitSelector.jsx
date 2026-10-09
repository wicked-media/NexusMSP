import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wrench, Radio, Ticket, CheckCircle2, Layers3, CalendarClock } from "lucide-react";
import {
  SERVICE_KITS,
  STANDARD_SERVICE_KIT,
  serviceKitContextFor,
} from "@/lib/serviceKits";

const KIT_ICONS = {
  workshop_repair: Wrench,
  cabling_field: Radio,
};

const toneClasses = {
  standard: "border-white/[0.09] bg-white/[0.018] hover:border-white/[0.18]",
  workshop_repair: "border-cyan-400/20 bg-cyan-400/[0.035] hover:border-cyan-300/40",
  cabling_field: "border-violet-400/20 bg-violet-400/[0.035] hover:border-violet-300/40",
};

const activeClasses = {
  standard: "ring-1 ring-emerald-400/45 border-emerald-400/35 bg-emerald-400/[0.07]",
  workshop_repair: "ring-1 ring-cyan-300/55 border-cyan-300/50 bg-cyan-400/[0.09]",
  cabling_field: "ring-1 ring-violet-300/55 border-violet-300/50 bg-violet-400/[0.09]",
};

export default function ServiceKitSelector({ value = STANDARD_SERVICE_KIT, context = {}, onChange, clientAddress = "" }) {
  const selectedKit = SERVICE_KITS.find((kit) => kit.id === value);
  const updateContext = (patch) => onChange?.(value, { ...serviceKitContextFor(value, context), ...patch });
  const selectKit = (kitId) => {
    const next = serviceKitContextFor(kitId, kitId === "cabling_field" ? { service_address: clientAddress || "" } : {});
    onChange?.(kitId, next);
  };

  return (
    <section className="rounded-xl border border-violet-400/20 bg-[linear-gradient(135deg,rgba(124,58,237,0.075),rgba(34,211,238,0.025))] p-4" data-testid="service-kit-selector">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-violet-200" />
          <div><h3 className="text-sm font-semibold">Delivery kit</h3><p className="mt-0.5 text-[11px] text-muted-foreground">Keep one customer request in the queue, then add specialist workflow only where it helps.</p></div>
        </div>
        <Badge variant="outline" className="border-violet-400/25 bg-violet-400/[0.08] text-[9px] text-violet-100">Parent ticket stays authoritative</Badge>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <button type="button" onClick={() => onChange?.(STANDARD_SERVICE_KIT, {})} className={`rounded-xl border p-3 text-left transition ${toneClasses.standard} ${value === STANDARD_SERVICE_KIT ? activeClasses.standard : ""}`} data-testid="service-kit-standard">
          <div className="flex items-start gap-2"><span className="mt-0.5 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] p-1.5"><Ticket className="h-3.5 w-3.5 text-emerald-200" /></span><div className="min-w-0"><p className="text-xs font-semibold">Standard ticket</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">SLA, customer updates and normal technician workflow.</p></div>{value === STANDARD_SERVICE_KIT && <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-emerald-300" />}</div>
        </button>
        {SERVICE_KITS.map((kit) => {
          const Icon = KIT_ICONS[kit.id];
          const isSelected = value === kit.id;
          return <button key={kit.id} type="button" onClick={() => selectKit(kit.id)} className={`rounded-xl border p-3 text-left transition ${toneClasses[kit.id]} ${isSelected ? activeClasses[kit.id] : ""}`} data-testid={`service-kit-${kit.id}`}>
            <div className="flex items-start gap-2"><span className={`mt-0.5 rounded-lg border p-1.5 ${kit.id === "workshop_repair" ? "border-cyan-400/20 bg-cyan-400/[0.08]" : "border-violet-400/20 bg-violet-400/[0.08]"}`}><Icon className={`h-3.5 w-3.5 ${kit.id === "workshop_repair" ? "text-cyan-200" : "text-violet-200"}`} /></span><div className="min-w-0"><p className="text-xs font-semibold">{kit.name}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{kit.description}</p></div>{isSelected && <CheckCircle2 className={`ml-auto h-3.5 w-3.5 ${kit.id === "workshop_repair" ? "text-cyan-200" : "text-violet-200"}`} />}</div>
          </button>;
        })}
      </div>

      {selectedKit?.id === "workshop_repair" && (
        <div className="mt-3 rounded-xl border border-cyan-400/16 bg-cyan-400/[0.03] p-3" data-testid="service-kit-workshop-context">
          <div className="mb-2 flex items-center gap-2"><Wrench className="h-3.5 w-3.5 text-cyan-200" /><p className="text-xs font-semibold text-cyan-100">Workshop intake essentials</p><span className="text-[10px] text-muted-foreground">Complete the detailed intake after the ticket opens.</span></div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div><Label className="text-[10px]">Device type</Label><Input value={context.device_type || ""} onChange={(event) => updateContext({ device_type: event.target.value })} placeholder="Laptop" /></div>
            <div><Label className="text-[10px]">Brand</Label><Input value={context.device_brand || ""} onChange={(event) => updateContext({ device_brand: event.target.value })} placeholder="Dell" /></div>
            <div><Label className="text-[10px]">Model</Label><Input value={context.device_model || ""} onChange={(event) => updateContext({ device_model: event.target.value })} placeholder="Latitude" /></div>
            <div><Label className="text-[10px]">Serial</Label><Input value={context.serial_number || ""} onChange={(event) => updateContext({ serial_number: event.target.value })} placeholder="Optional" /></div>
          </div>
        </div>
      )}

      {selectedKit?.id === "cabling_field" && (
        <div className="mt-3 rounded-xl border border-violet-400/16 bg-violet-400/[0.03] p-3" data-testid="service-kit-field-context">
          <div className="mb-2 flex items-center gap-2"><Radio className="h-3.5 w-3.5 text-violet-200" /><p className="text-xs font-semibold text-violet-100">Dispatch essentials</p><span className="text-[10px] text-muted-foreground">The field workflow holds photos, materials and sign-off.</span></div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2"><Label className="text-[10px]">Service address</Label><Input value={context.service_address || ""} onChange={(event) => updateContext({ service_address: event.target.value })} placeholder="Site address" /></div>
            <div><Label className="text-[10px]">Zone</Label><Input value={context.zone || ""} onChange={(event) => updateContext({ zone: event.target.value })} placeholder="CBD, North…" /></div>
            <div><Label className="text-[10px]">Job category</Label><Select value={context.job_category || "installation"} onValueChange={(job_category) => updateContext({ job_category })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="installation">Installation</SelectItem><SelectItem value="maintenance">Maintenance</SelectItem><SelectItem value="troubleshooting">Troubleshooting</SelectItem><SelectItem value="decommission">Decommission</SelectItem><SelectItem value="survey">Site survey</SelectItem></SelectContent></Select></div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3"><div><Label className="text-[10px]">Planned date</Label><Input type="date" value={context.scheduled_date || ""} onChange={(event) => updateContext({ scheduled_date: event.target.value })} /></div><div><Label className="text-[10px]">Arrival time</Label><Input type="time" value={context.scheduled_time || ""} onChange={(event) => updateContext({ scheduled_time: event.target.value })} /></div><div><Label className="text-[10px]">Estimate (minutes)</Label><Input type="number" min="15" max="1440" value={context.estimated_duration ?? 60} onChange={(event) => updateContext({ estimated_duration: event.target.value })} /></div></div>
        </div>
      )}

      {selectedKit && <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground"><CalendarClock className="h-3.5 w-3.5 text-violet-200" />{selectedKit.outcome} Open it from this ticket; it will not become a duplicate queue item.</p>}
    </section>
  );
}
