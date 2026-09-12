import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Ticket, Monitor, Mail, Calendar, Activity, FileText, ExternalLink, Phone, MapPin, ChevronDown, MoreHorizontal,
} from "lucide-react";

/**
 * Horizontal strip of one-click actions on the client detail page.
 * Keeps client actions visually consistent with the wider NexusMSP workflow surface.
 */
export default function ClientQuickActionsStrip({ client, onCreateTicket, onOpenWarRoom }) {
  const navigate = useNavigate();

  const primaryAction = {
    label: "Create ticket",
    icon: Ticket,
    onClick: onCreateTicket || (() => navigate(`/tickets?client=${client.id}&new=1`)),
    testId: "qa-create-ticket",
  };

  // The actions that technicians use most often stay visible. Less frequent
  // operational actions remain one keyboard-accessible menu away, rather than
  // competing with the next best action for the client.
  const commonActions = [
    { label: "Add asset", icon: Monitor, onClick: () => navigate(`/devices?client=${client.id}&new=1`), testId: "qa-add-device" },
    { label: "Send email", icon: Mail, onClick: () => navigate(`/email?client=${encodeURIComponent(client.id)}&compose=1`), disabled: !client.email, testId: "qa-send-email" },
    { label: "Schedule", icon: Calendar, onClick: () => navigate(`/scheduling?client=${client.id}`), testId: "qa-schedule" },
  ];

  const moreActions = [
    { label: "Call", icon: Phone, onClick: () => client.phone && (window.location.href = `tel:${client.phone}`), disabled: !client.phone, testId: "qa-call" },
    { label: "Health check", icon: Activity, onClick: () => navigate(`/client-health/${client.id}`), testId: "qa-health" },
    { label: "War room", icon: Activity, onClick: onOpenWarRoom || (() => navigate(`/clients?client=${client.id}&tab=warroom`)), testId: "qa-warroom" },
    { label: "Invoice", icon: FileText, onClick: () => navigate(`/invoices?client=${client.id}&new=1`), testId: "qa-invoice" },
    client.website && { label: "Website", icon: ExternalLink, onClick: () => window.open(client.website?.startsWith("http") ? client.website : `https://${client.website}`, "_blank"), testId: "qa-website" },
    client.address && { label: "Directions", icon: MapPin, onClick: () => window.open(`https://maps.google.com/?q=${encodeURIComponent(client.address)}`, "_blank"), testId: "qa-directions" },
  ].filter(Boolean);
  const PrimaryIcon = primaryAction.icon;

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={`Actions for ${client.name}`} data-testid="client-quick-actions">
      <Button
        size="sm"
        className="h-9 gap-1.5 px-3 text-xs shadow-sm shadow-primary/20"
        onClick={primaryAction.onClick}
        data-testid={primaryAction.testId}
        title={primaryAction.label}
      >
        <PrimaryIcon className="h-3.5 w-3.5" />
        {primaryAction.label}
      </Button>

      <span className="hidden h-5 w-px bg-border/70 sm:block" aria-hidden="true" />

      {commonActions.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            key={action.label}
            size="sm"
            variant="outline"
            className="h-9 gap-1.5 border-border/70 bg-background/45 px-3 text-xs text-foreground hover:border-primary/35 hover:bg-muted/50"
            onClick={action.onClick}
            disabled={action.disabled}
            data-testid={action.testId}
            title={action.disabled ? `${action.label} (unavailable)` : action.label}
          >
            <Icon className="h-3.5 w-3.5" />
            {action.label}
          </Button>
        );
      })}

      {moreActions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              data-testid="qa-more-actions"
              aria-label={`More actions for ${client.name}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              More
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 p-1.5" data-testid="qa-more-actions-menu">
            <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Client operations
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {moreActions.map((action) => {
              const Icon = action.icon;
              return (
                <DropdownMenuItem
                  key={action.label}
                  onSelect={action.onClick}
                  disabled={action.disabled}
                  className="gap-2.5 px-2.5 py-2 text-xs"
                  data-testid={action.testId}
                  title={action.disabled ? `${action.label} (unavailable)` : action.label}
                >
                  <Icon className="h-3.5 w-3.5 text-primary" />
                  {action.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
