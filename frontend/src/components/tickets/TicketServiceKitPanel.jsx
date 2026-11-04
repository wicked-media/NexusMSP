import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wrench, Radio, ArrowUpRight, Link2, CheckCircle2 } from "lucide-react";
import { serviceKitById } from "@/lib/serviceKits";

export default function TicketServiceKitPanel({ ticket, onOpenWorkflow }) {
  const kit = serviceKitById(ticket?.service_kit?.id || ticket?.service_kit_id);
  const workRecord = ticket?.service_kit?.work_record;
  if (!kit || !workRecord?.id) return null;
  const Icon = kit.workflow === "workshop" ? Wrench : Radio;
  const tone = kit.workflow === "workshop"
    ? "border-cyan-400/25 bg-[linear-gradient(120deg,rgba(34,211,238,0.105),rgba(14,116,144,0.04))] text-cyan-100"
    : "border-violet-400/25 bg-[linear-gradient(120deg,rgba(167,139,250,0.11),rgba(91,33,182,0.04))] text-violet-100";
  const iconTone = kit.workflow === "workshop" ? "border-cyan-300/25 bg-cyan-400/[0.11] text-cyan-100" : "border-violet-300/25 bg-violet-400/[0.11] text-violet-100";
  return (
    <section className={`flex flex-col gap-3 rounded-xl border px-4 py-3 shadow-[0_10px_25px_rgba(0,0,0,0.12)] sm:flex-row sm:items-center sm:justify-between ${tone}`} data-testid="ticket-service-kit-panel">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${iconTone}`}><Icon className="h-4 w-4" /></span>
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{kit.name}</p><Badge variant="outline" className="border-current/25 bg-black/10 text-[9px] text-current"><CheckCircle2 className="mr-1 h-3 w-3" />Active</Badge></div><p className="mt-0.5 text-xs text-muted-foreground">This is the parent service record. Specialist delivery evidence is linked below, not duplicated in the queue.</p><p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground"><Link2 className="h-3 w-3" />{workRecord.reference || workRecord.id}</p></div>
      </div>
      <Button variant="outline" size="sm" className="shrink-0 border-current/25 bg-black/[0.08] text-current hover:bg-black/[0.16]" onClick={() => onOpenWorkflow?.(ticket.service_kit)} data-testid="open-ticket-service-kit-workflow"><Icon className="mr-1.5 h-3.5 w-3.5" />Open {kit.workflow === "workshop" ? "workshop" : "field"} workflow<ArrowUpRight className="ml-1.5 h-3.5 w-3.5" /></Button>
    </section>
  );
}
