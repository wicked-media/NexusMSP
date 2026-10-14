import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { CalendarClock, ChevronDown, MoreHorizontal, RotateCcw, Shield, Terminal } from "lucide-react";
import { LEARNING_ACTION, learningHint, rankByUse } from "@/lib/workspaceLearning";

const NO_EVIDENCE = new Map();

// `id` is the bounded slug Nexus records when the tool is opened; `path` is where
// it goes. Two separate things, because a path is not an identifier.
const MANAGED_ASSET_TOOLS = [
  { id: "nexus_agent", path: "/nexus-agent", label: "NexusOps Agent", icon: Terminal },
  { id: "maintenance", path: "/maintenance-scheduler", label: "Maintenance", icon: CalendarClock },
  { id: "patch_tuesday", path: "/patch-tuesday", label: "Patch Tuesday", icon: Shield },
];

/**
 * Managed-asset desk tools.
 *
 * Nexus remembers which of these a technician actually opens, and orders the menu
 * around it — the tool they live in stops being the third thing they scan for.
 * No tool is ever removed, and with no evidence the menu is exactly the order
 * this file declares.
 */
export default function ManagedAssetToolsMenu({
  personal = NO_EVIDENCE,
  team = NO_EVIDENCE,
  onRecordAction,
  onForgetLearning,
}) {
  const navigate = useNavigate();
  const ranked = rankByUse(MANAGED_ASSET_TOOLS, {
    surface: LEARNING_ACTION,
    personal,
    team,
    idOf: (tool) => tool.id,
  });
  const hint = learningHint({ surface: LEARNING_ACTION, personal, team });

  const forgetLearning = async () => {
    try {
      const removed = await onForgetLearning?.();
      toast.success(`${removed || 0} learned signal${removed === 1 ? "" : "s"} forgotten`, {
        description: "The fleet tabs and tools are back to the Nexus default order and will learn again from your next visit.",
      });
    } catch {
      toast.error("Nexus could not forget the learned ordering. Nothing has been changed.");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="nx-fleet-workspace-tabs__more" data-testid="managed-assets-more">
          <MoreHorizontal className="h-3.5 w-3.5" /><span>Tools</span><ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {ranked.map((tool) => {
          const Icon = tool.icon;
          return (
            <DropdownMenuItem
              key={tool.path}
              onSelect={() => { onRecordAction?.(LEARNING_ACTION, tool.id); navigate(tool.path); }}
            >
              <Icon className="mr-2 h-3.5 w-3.5" />{tool.label}
            </DropdownMenuItem>
          );
        })}
        {hint && onForgetLearning && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={forgetLearning}
              className="gap-2 text-muted-foreground"
              data-testid="devices-forget-learning"
              title="Return the fleet tabs and tools to the Nexus default order and clear what Nexus learned"
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" />Forget learned ordering
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
