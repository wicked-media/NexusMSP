import { BarChart3, BellRing, Building2, RotateCcw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import WorkspaceActionMenu, { WorkspaceActionMenuItem } from "@/components/WorkspaceActionMenu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { LEARNING_ACTION, learningHint, rankByUse } from "@/lib/workspaceLearning";

const NO_EVIDENCE = new Map();

/**
 * The procurement desk tools, in the order Nexus believes is most useful.
 *
 * Each tool carries the id Nexus records when it is used; the handler stays on
 * the caller, so this file owns the catalogue and the workspace owns the work.
 */
const PROCUREMENT_TOOLS = [
  { id: "analytics", label: "Analytics", icon: BarChart3, testId: "po-analytics-btn" },
  { id: "vendors", label: "Vendors", icon: Building2, testId: "po-tools-vendors" },
  { id: "vendor_scorecard", label: "Vendor scorecard", icon: BarChart3, testId: "po-tools-vendor-scorecard" },
  { id: "approval_policy", label: "Approval policy", icon: Settings2, testId: "po-tools-approval-policy" },
  { id: "check_escalations", label: "Check escalations", icon: BellRing, testId: "check-escalations-btn" },
];

/**
 * Purchase order procurement tools.
 *
 * Nexus remembers which of these a technician actually opens and orders the menu
 * around it, so the tool they live in stops being the fourth thing they scan
 * for. No tool is ever removed, the menu claims nothing until the ranking really
 * changed it, and with no evidence it is exactly the order this file declares.
 */
export default function PurchaseOrderToolsMenu({
  onOpenAnalytics,
  onOpenVendors,
  onOpenVendorScorecard,
  onOpenApprovalPolicy,
  onCheckEscalations,
  personal = NO_EVIDENCE,
  team = NO_EVIDENCE,
  onRecordAction,
  onForgetLearning,
}) {
  const handlers = {
    analytics: onOpenAnalytics,
    vendors: onOpenVendors,
    vendor_scorecard: onOpenVendorScorecard,
    approval_policy: onOpenApprovalPolicy,
    check_escalations: onCheckEscalations,
  };
  const rankOptions = { surface: LEARNING_ACTION, personal, team, idOf: (tool) => tool.id };
  const ranked = rankByUse(PROCUREMENT_TOOLS, rankOptions);
  // Evidence that leaves the menu exactly as declared is not a change, and Nexus
  // must not report it as one.
  const adapted = ranked.some((tool, index) => tool !== PROCUREMENT_TOOLS[index]);
  const hint = learningHint({ surface: LEARNING_ACTION, personal, team });

  const forgetLearning = async () => {
    try {
      const removed = await onForgetLearning?.();
      toast.success(`${removed || 0} learned tool signal${removed === 1 ? "" : "s"} forgotten`, {
        description: "The procurement tools are back to the Nexus default order and will learn again from your next visit.",
      });
    } catch {
      toast.error("Nexus could not forget the learned ordering. Nothing has been changed.");
    }
  };

  return (
    <WorkspaceActionMenu testId="po-workspace-tools">
      {ranked.map((tool) => (
        <WorkspaceActionMenuItem
          key={tool.id}
          icon={tool.icon}
          testId={tool.testId}
          onSelect={() => {
            onRecordAction?.(LEARNING_ACTION, tool.id);
            handlers[tool.id]?.();
          }}
        >
          {tool.label}
        </WorkspaceActionMenuItem>
      ))}
      {hint && adapted && onForgetLearning && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => forgetLearning()}
            className="gap-2 text-muted-foreground"
            data-testid="po-forget-learning"
            title="Return the procurement tools to the Nexus default order and clear what Nexus learned"
          >
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />Forget learned ordering
          </DropdownMenuItem>
        </>
      )}
    </WorkspaceActionMenu>
  );
}
