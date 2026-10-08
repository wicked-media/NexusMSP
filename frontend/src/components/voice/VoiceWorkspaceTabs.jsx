import { Badge } from "@/components/ui/badge";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles } from "lucide-react";
import { LEARNING_VIEW, learningHint, rankByUse } from "@/lib/workspaceLearning";

const NO_EVIDENCE = new Map();

/**
 * The voice views, in the order Nexus believes is most useful.
 *
 * Nexus remembers which of these a technician opens and which ones the team
 * opens, and orders the tab bar around that evidence. Learning reorders this
 * list; it never hides a view, and a view nobody uses still keeps its tab.
 */
const VOICE_VIEW_TABS = [
  { value: "dashboard", label: "Dashboard" },
  { value: "calls", label: "Call history" },
  { value: "capabilities", label: "PBX operations" },
  { value: "monitoring", label: "Live monitor" },
  { value: "pbxs", label: "PBXs", countKey: "pbxs" },
  { value: "extensions", label: "Extensions", countKey: "extensions" },
  { value: "billing", label: "Billing" },
  { value: "sync", label: "Sync history" },
  { value: "activity", label: "Activity" },
  { value: "diagnostics", label: "API diagnostics" },
];

/** The view slugs the voice workspace will accept from a deep link. */
export const VOICE_TABS = VOICE_VIEW_TABS.map((view) => view.value);

/**
 * Voice workspace view bar.
 *
 * With no evidence this renders exactly the declared tabs, with exactly the
 * counts the workspace has always shown, and claims nothing.
 */
export default function VoiceWorkspaceTabs({
  counts = {},
  personal = NO_EVIDENCE,
  team = NO_EVIDENCE,
  onRecordAction,
}) {
  const ranked = rankByUse(VOICE_VIEW_TABS, {
    surface: LEARNING_VIEW,
    personal,
    team,
    idOf: (view) => view.value,
  });
  const hint = learningHint({ surface: LEARNING_VIEW, personal, team });

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="voice-workspace-tabs">
      <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-border/50 bg-card/70 p-1.5 sm:w-fit">
        {ranked.map((view) => (
          <TabsTrigger
            key={view.value}
            value={view.value}
            onClick={() => onRecordAction?.(LEARNING_VIEW, view.value)}
          >
            {view.label}{view.countKey ? ` (${counts[view.countKey]})` : ""}
          </TabsTrigger>
        ))}
      </TabsList>
      {hint && (
        <Badge
          variant="outline"
          data-testid="voice-tabs-learning"
          data-learning-tone={hint.tone}
          title={hint.detail}
          className="gap-1 border-cyan-500/25 bg-cyan-500/[0.07] text-[10px] font-medium text-cyan-200"
        >
          <Sparkles className="h-3 w-3" />
          {hint.label}
        </Badge>
      )}
    </div>
  );
}
