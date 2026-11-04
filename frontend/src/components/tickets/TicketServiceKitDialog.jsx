import { useEffect, useState } from "react";
import axios from "axios";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Loader2, Layers3 } from "lucide-react";
import ServiceKitSelector from "@/components/tickets/ServiceKitSelector";
import { API } from "@/App";
import { STANDARD_SERVICE_KIT, serviceKitContextFor, serviceKitCreateLabel } from "@/lib/serviceKits";
import { toast } from "sonner";

export default function TicketServiceKitDialog({ open, onOpenChange, ticket, headers, onApplied }) {
  const [kitId, setKitId] = useState(STANDARD_SERVICE_KIT);
  const [context, setContext] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKitId(ticket?.service_kit?.id || STANDARD_SERVICE_KIT);
    setContext(ticket?.service_kit_context || {});
  }, [open, ticket]);

  const apply = async () => {
    if (!ticket?.id || kitId === STANDARD_SERVICE_KIT) return;
    setBusy(true);
    try {
      const response = await axios.post(`${API}/tickets/${ticket.id}/service-kit`, { kit_id: kitId, context: serviceKitContextFor(kitId, context) }, { headers });
      onApplied?.(response.data?.ticket || ticket);
      toast.success(response.data?.idempotent ? "Delivery kit is already linked" : "Delivery kit linked to this ticket");
      onOpenChange(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not apply the delivery kit");
    } finally {
      setBusy(false);
    }
  };

  const hasKit = Boolean(ticket?.service_kit?.work_record?.id);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <NexusWorkflowDialog eyebrow="Service desk delivery" title="Attach a delivery kit" description="Use a normal Nexus ticket as the customer record, then link the specialist workflow only when the work needs it." icon={Layers3} tone="violet" className="max-w-5xl" contentClassName="space-y-4" footer={<><p className="hidden text-xs text-muted-foreground sm:block">A ticket can carry one specialist delivery kit. Split genuinely independent work into child tickets.</p><div className="flex gap-2"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button><Button onClick={apply} disabled={busy || kitId === STANDARD_SERVICE_KIT || hasKit} data-testid="apply-ticket-service-kit">{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Layers3 className="mr-1.5 h-4 w-4" />}{hasKit ? "Delivery kit already linked" : serviceKitCreateLabel(kitId).replace("Create ticket and start", "Attach")}</Button></div></>}>
      <ServiceKitSelector value={kitId} context={context} clientAddress={ticket?.client_address || ""} onChange={(nextKitId, nextContext) => { setKitId(nextKitId); setContext(nextContext); }} />
    </NexusWorkflowDialog>
  </Dialog>;
}
