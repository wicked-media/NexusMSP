import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Ticket, Monitor, Mail, Calendar, Activity, FileText, ExternalLink, Phone, MapPin,
} from "lucide-react";

/**
 * Horizontal strip of one-click actions on the client detail page.
 * Keeps client actions visually consistent with the wider NexusMSP workflow surface.
 */
export default function ClientQuickActionsStrip({ client, onCreateTicket, onOpenWarRoom }) {
  const navigate = useNavigate();

  const actions = [
    { label: "Create ticket", icon: Ticket, primary: true, onClick: onCreateTicket || (() => navigate(`/tickets?client=${client.id}&new=1`)), testId: "qa-create-ticket" },
    { label: "Add asset", icon: Monitor, onClick: () => navigate(`/devices?client=${client.id}&new=1`), testId: "qa-add-device" },
    { label: "Send email", icon: Mail, onClick: () => navigate(`/email?client=${encodeURIComponent(client.id)}&compose=1`), disabled: !client.email, testId: "qa-send-email" },
    { label: "Call", icon: Phone, onClick: () => client.phone && (window.location.href = `tel:${client.phone}`), disabled: !client.phone, testId: "qa-call" },
    { label: "Schedule", icon: Calendar, onClick: () => navigate(`/scheduling?client=${client.id}`), testId: "qa-schedule" },
    { label: "Health check", icon: Activity, onClick: () => navigate(`/client-health/${client.id}`), testId: "qa-health" },
    { label: "War room", icon: Activity, onClick: onOpenWarRoom || (() => navigate(`/clients?client=${client.id}&tab=warroom`)), testId: "qa-warroom" },
    { label: "Invoice", icon: FileText, onClick: () => navigate(`/invoices?client=${client.id}&new=1`), testId: "qa-invoice" },
    client.website && { label: "Website", icon: ExternalLink, onClick: () => window.open(client.website?.startsWith("http") ? client.website : `https://${client.website}`, "_blank"), testId: "qa-website" },
    client.address && { label: "Directions", icon: MapPin, onClick: () => window.open(`https://maps.google.com/?q=${encodeURIComponent(client.address)}`, "_blank"), testId: "qa-directions" },
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="client-quick-actions">
      {actions.map((a) => (
        <Button
          key={a.label}
          size="sm"
          variant="outline"
          className={a.primary ? "h-9 gap-1.5 px-3 text-xs shadow-sm" : "h-9 gap-1.5 border-border/70 bg-background/45 px-3 text-xs text-foreground hover:border-primary/35 hover:bg-muted/50"}
          onClick={a.onClick}
          disabled={a.disabled}
          data-testid={a.testId}
          title={a.disabled ? `${a.label} (unavailable)` : a.label}
        >
          <a.icon className="h-3.5 w-3.5" />
          {a.label}
        </Button>
      ))}
    </div>
  );
}
