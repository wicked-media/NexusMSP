import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Ticket, Monitor, Mail, Calendar, Activity, FileText, ExternalLink, Phone, MapPin, ChevronDown, MoreHorizontal,
  Sparkles, RotateCcw,
} from "lucide-react";
import {
  LEARNING_ACTION,
  learningHint,
  splitQuickActions,
} from "@/lib/workspaceLearning";

const NO_EVIDENCE = new Map();

const idOf = (action) => action.id;

/**
 * Horizontal strip of one-click actions on the client detail page.
 *
 * Nexus remembers which of these a technician actually runs. The three that fit
 * in the strip are the three that are really used — an action the team relies on
 * is promoted out of the overflow menu once there is evidence, and an action
 * nobody uses stops competing with it. Until there is evidence the strip is
 * exactly the order this component declares, and the chip naming the reason is
 * only rendered when the workspace has something true to say.
 */
export default function ClientQuickActionsStrip({
  client,
  onCreateTicket,
  onOpenWarRoom,
  personal = NO_EVIDENCE,
  team = NO_EVIDENCE,
  onRecordAction,
  onForgetLearning,
}) {
  const navigate = useNavigate();

  const primaryAction = {
    id: "ticket",
    label: "Create ticket",
    icon: Ticket,
    onClick: onCreateTicket || (() => navigate(`/tickets?client=${client.id}&new=1`)),
    testId: "qa-create-ticket",
  };

  // Declared in the order Nexus believes is most useful. Learning reorders this
  // list, it never removes an action: everything stays one menu away.
  const catalogue = [
    { id: "device", label: "Add asset", icon: Monitor, onClick: () => navigate(`/devices?client=${client.id}&new=1`), testId: "qa-add-device" },
    { id: "email", label: "Send email", icon: Mail, onClick: () => navigate(`/email?client=${encodeURIComponent(client.id)}&compose=1`), disabled: !client.email, testId: "qa-send-email" },
    { id: "schedule", label: "Schedule", icon: Calendar, onClick: () => navigate(`/scheduling?client=${client.id}`), testId: "qa-schedule" },
    { id: "call", label: "Call", icon: Phone, onClick: () => client.phone && (window.location.href = `tel:${client.phone}`), disabled: !client.phone, testId: "qa-call" },
    { id: "health", label: "Health check", icon: Activity, onClick: () => navigate(`/client-health/${client.id}`), testId: "qa-health" },
    { id: "warroom", label: "War room", icon: Activity, onClick: onOpenWarRoom || (() => navigate(`/clients?client=${client.id}&tab=warroom`)), testId: "qa-warroom" },
    { id: "invoice", label: "Invoice", icon: FileText, onClick: () => navigate(`/invoices?client=${client.id}&new=1`), testId: "qa-invoice" },
    client.website && { id: "website", label: "Website", icon: ExternalLink, onClick: () => window.open(client.website?.startsWith("http") ? client.website : `https://${client.website}`, "_blank"), testId: "qa-website" },
    client.address && { id: "directions", label: "Directions", icon: MapPin, onClick: () => window.open(`https://maps.google.com/?q=${encodeURIComponent(client.address)}`, "_blank"), testId: "qa-directions" },
  ].filter(Boolean);

  const { visible, overflow } = splitQuickActions(catalogue, {
    surface: LEARNING_ACTION,
    personal,
    team,
    idOf,
  });
  const hint = learningHint({ surface: LEARNING_ACTION, personal, team });

  const run = (action) => {
    onRecordAction?.(LEARNING_ACTION, action.id);
    action.onClick();
  };

  const forgetLearning = async () => {
    try {
      const removed = await onForgetLearning?.();
      toast.success(`${removed || 0} learned shortcut signal${removed === 1 ? "" : "s"} forgotten`, {
        description: "The strip is back to the Nexus default order and will learn again from your next visit.",
      });
    } catch {
      toast.error("Nexus could not forget the learned ordering. Nothing has been changed.");
    }
  };

  const PrimaryIcon = primaryAction.icon;

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={`Actions for ${client.name}`} data-testid="client-quick-actions">
      <Button
        size="sm"
        className="h-9 gap-1.5 px-3 text-xs shadow-sm shadow-primary/20"
        onClick={() => run(primaryAction)}
        data-testid={primaryAction.testId}
        title={primaryAction.label}
      >
        <PrimaryIcon className="h-3.5 w-3.5" />
        {primaryAction.label}
      </Button>

      <span className="hidden h-5 w-px bg-border/70 sm:block" aria-hidden="true" />

      {visible.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            key={action.label}
            size="sm"
            variant="outline"
            className="h-9 gap-1.5 border-border/70 bg-background/45 px-3 text-xs text-foreground hover:border-primary/35 hover:bg-muted/50"
            onClick={() => run(action)}
            disabled={action.disabled}
            data-testid={action.testId}
            title={action.disabled ? `${action.label} (unavailable)` : action.label}
          >
            <Icon className="h-3.5 w-3.5" />
            {action.label}
          </Button>
        );
      })}

      {(overflow.length > 0 || (hint && onForgetLearning)) && (
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
            {overflow.map((action) => {
              const Icon = action.icon;
              return (
                <DropdownMenuItem
                  key={action.label}
                  onSelect={() => run(action)}
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
            {hint && onForgetLearning && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => forgetLearning()}
                  className="gap-2.5 px-2.5 py-2 text-xs text-muted-foreground"
                  data-testid="qa-forget-learning"
                  title="Return the strip to the Nexus default order and clear what Nexus learned about your shortcuts"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Forget learned ordering
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {hint && (
        <Badge
          variant="outline"
          data-testid="client-quick-actions-learning"
          data-learning-tone={hint.tone}
          title={hint.detail}
          className="h-7 gap-1 border-primary/25 bg-primary/[0.07] px-2 text-[10px] font-medium text-primary"
        >
          <Sparkles className="h-3 w-3" />
          {hint.label}
        </Badge>
      )}
    </div>
  );
}
