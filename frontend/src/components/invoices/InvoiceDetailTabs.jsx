import { Badge } from "@/components/ui/badge";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { RotateCcw, Sparkles } from "lucide-react";
import { LEARNING_VIEW, learningHint, rankByUse } from "@/lib/workspaceLearning";

const NO_EVIDENCE = new Map();

const CYAN_ACTIVE = "data-[state=active]:bg-cyan-500/[0.14] data-[state=active]:text-cyan-100";
const VIOLET_ACTIVE = "data-[state=active]:bg-violet-500/[0.14] data-[state=active]:text-violet-100";

/**
 * The invoice detail views, in the order Nexus believes is most useful.
 *
 * Learning reorders this list; it never removes a view, and a view that is not
 * the technician's habit keeps its declared tab. `countKey` names the number the
 * tab shows, and `splitOnly` marks the payer-invoice tab, which only exists for a
 * split parent.
 */
const DETAIL_TABS = [
  { value: "items", label: "Line Items", testId: "tab-inv-items", active: CYAN_ACTIVE },
  { value: "payments", label: "Payments", testId: "tab-inv-payments", countKey: "payments", active: CYAN_ACTIVE },
  { value: "split", label: "Payer invoices", testId: "tab-inv-split-billing", countKey: "split", splitOnly: true, active: VIOLET_ACTIVE },
  { value: "emails", label: "Emails", testId: "tab-inv-emails", countKey: "emails", active: CYAN_ACTIVE },
  { value: "audit", label: "Audit", testId: "tab-inv-audit", countKey: "audit", active: CYAN_ACTIVE },
];

/**
 * Invoice detail tab bar.
 *
 * Nexus remembers which detail view a technician opens and which ones the team
 * opens, and orders the tabs around that evidence: the view they actually use
 * leads, and the declared order decides every tie. With no evidence the bar is
 * exactly the order this file declares, and the tab bar never hides a view or
 * changes a count.
 */
export default function InvoiceDetailTabs({
  counts = {},
  personal = NO_EVIDENCE,
  team = NO_EVIDENCE,
  isSplitParent = false,
  onRecordAction,
  onForgetLearning,
}) {
  const catalogue = DETAIL_TABS.filter((tab) => !tab.splitOnly || isSplitParent);
  const ranked = rankByUse(catalogue, {
    surface: LEARNING_VIEW,
    personal,
    team,
    idOf: (tab) => tab.value,
  });
  const hint = learningHint({ surface: LEARNING_VIEW, personal, team });

  const forgetLearning = async () => {
    try {
      const removed = await onForgetLearning?.();
      toast.success(`${removed || 0} learned tab signal${removed === 1 ? "" : "s"} forgotten`, {
        description: "The tabs are back to the Nexus default order and will learn again from your next visit.",
      });
    } catch {
      toast.error("Nexus could not forget the learned ordering. Nothing has been changed.");
    }
  };

  return (
    <div className="flex items-center gap-2" data-testid="invoice-detail-tabs">
      <TabsList className="h-auto min-w-0 flex-1 justify-start gap-0 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/[0.14] p-1">
        {ranked.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            onClick={() => onRecordAction?.(LEARNING_VIEW, tab.value)}
            className={`h-9 shrink-0 rounded-lg px-3 text-xs ${tab.active}`}
            data-testid={tab.testId}
          >
            {tab.label}{tab.countKey && ` (${counts[tab.countKey] || 0})`}
          </TabsTrigger>
        ))}
      </TabsList>

      {hint && (
        <span className="flex shrink-0 items-center gap-1">
          <Badge
            variant="outline"
            data-testid="invoice-detail-tabs-learning"
            data-learning-tone={hint.tone}
            title={hint.detail}
            className="h-7 gap-1 border-cyan-500/25 bg-cyan-500/[0.07] px-2 text-[10px] font-medium text-cyan-200"
          >
            <Sparkles className="h-3 w-3" />
            {hint.label}
          </Badge>
          {onForgetLearning && (
            <button
              type="button"
              onClick={forgetLearning}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
              data-testid="invoice-forget-learning"
              aria-label="Forget learned invoice tab ordering"
              title="Return the tabs to the Nexus default order and clear what Nexus learned about your views"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      )}
    </div>
  );
}
