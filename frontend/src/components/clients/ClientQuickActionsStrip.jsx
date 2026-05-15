import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Ticket, Monitor, Mail, Calendar, Activity, FileText, ExternalLink, Phone, MapPin,
} from "lucide-react";

/**
 * Horizontal strip of one-click actions on the client detail page.
 * Mirrors Syncro's blue action bar but tailored to MSP workflows.
 */
export default function ClientQuickActionsStrip({ client, onCreateTicket }) {
  const navigate = useNavigate();

  const actions = [
    { label: "Create Ticket", icon: Ticket, color: "text-cyan-300 border-cyan-500/30 bg-cyan-500/5 hover:bg-cyan-500/15", onClick: onCreateTicket || (() => navigate(`/tickets?client=${client.id}&new=1`)), testId: "qa-create-ticket" },
    { label: "Add Device", icon: Monitor, color: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15", onClick: () => navigate(`/devices?client=${client.id}&new=1`), testId: "qa-add-device" },
    { label: "Send Email", icon: Mail, color: "text-violet-300 border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/15", onClick: () => client.email && (window.location.href = `mailto:${client.email}`), disabled: !client.email, testId: "qa-send-email" },
    { label: "Call", icon: Phone, color: "text-amber-300 border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/15", onClick: () => client.phone && (window.location.href = `tel:${client.phone}`), disabled: !client.phone, testId: "qa-call" },
    { label: "Schedule", icon: Calendar, color: "text-blue-300 border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/15", onClick: () => navigate(`/scheduling?client=${client.id}`), testId: "qa-schedule" },
    { label: "Health Check", icon: Activity, color: "text-rose-300 border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/15", onClick: () => navigate(`/client-health/${client.id}`), testId: "qa-health" },
    { label: "War Room", icon: Activity, color: "text-purple-300 border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/15", onClick: () => navigate(`/clients/${client.id}/war-room`), testId: "qa-warroom" },
    { label: "Invoice", icon: FileText, color: "text-yellow-300 border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/15", onClick: () => navigate(`/billing?client=${client.id}`), testId: "qa-invoice" },
    client.website && { label: "Website", icon: ExternalLink, color: "text-zinc-300 border-zinc-700 hover:bg-zinc-800", onClick: () => window.open(client.website?.startsWith("http") ? client.website : `https://${client.website}`, "_blank"), testId: "qa-website" },
    client.address && { label: "Directions", icon: MapPin, color: "text-zinc-300 border-zinc-700 hover:bg-zinc-800", onClick: () => window.open(`https://maps.google.com/?q=${encodeURIComponent(client.address)}`, "_blank"), testId: "qa-directions" },
  ].filter(Boolean);

  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="client-quick-actions">
      {actions.map((a) => (
        <Button
          key={a.label}
          size="sm"
          variant="outline"
          className={`h-8 text-[11px] gap-1 ${a.color}`}
          onClick={a.onClick}
          disabled={a.disabled}
          data-testid={a.testId}
          title={a.disabled ? `${a.label} (unavailable)` : a.label}
        >
          <a.icon className="w-3 h-3" />
          {a.label}
        </Button>
      ))}
    </div>
  );
}
