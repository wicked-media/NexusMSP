import { Badge } from "@/components/ui/badge";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Cloud, Flame, List, Sparkles } from "lucide-react";
import { LEARNING_VIEW, learningHint, rankByUse } from "@/lib/workspaceLearning";

const NO_EVIDENCE = new Map();

/**
 * The managed-asset workspace views, in the order Nexus believes is most useful.
 *
 * Nexus remembers which of these a technician opens and which ones the team
 * opens, and orders the tab bar around that evidence. Learning reorders this
 * list; it never hides a view.
 */
const DEVICE_WORKSPACE_VIEWS = [
  { v: "pulse", l: "Fleet pulse", d: "Health and attention", Icon: Flame },
  { v: "directory", l: "Asset register", d: "Inventory and actions", Icon: List },
  { v: "insights", l: "Evidence", d: "Risk and lifecycle", Icon: BarChart3 },
  { v: "map", l: "Site map", d: "Coverage by location", Icon: Cloud },
];

/**
 * Managed-asset view bar.
 *
 * With no evidence this renders exactly the declared four views, in the declared
 * order, with the same test ids, and claims nothing.
 */
export default function DeviceWorkspaceTabs({
  personal = NO_EVIDENCE,
  team = NO_EVIDENCE,
  onRecordAction,
}) {
  const ranked = rankByUse(DEVICE_WORKSPACE_VIEWS, {
    surface: LEARNING_VIEW,
    personal,
    team,
    idOf: (view) => view.v,
  });
  const hint = learningHint({ surface: LEARNING_VIEW, personal, team });

  return (
    // A plain block wrapper, so the nav grid keeps filling the tab row exactly as
    // it did before learning existed; the chip only takes space when there is
    // something true to say.
    <div className="min-w-0" data-testid="devices-workspace-tabs">
      <TabsList className="nx-fleet-workspace-nav">
        {ranked.map((t) => (
          <TabsTrigger
            key={t.v}
            value={t.v}
            onClick={() => onRecordAction?.(LEARNING_VIEW, t.v)}
            className="nx-fleet-workspace-nav__item"
            data-testid={`devices-tab-${t.v}`}
          >
            <t.Icon />
            <span><strong>{t.l}</strong><small>{t.d}</small></span>
          </TabsTrigger>
        ))}
      </TabsList>
      {hint && (
        <Badge
          variant="outline"
          data-testid="devices-tabs-learning"
          data-learning-tone={hint.tone}
          title={hint.detail}
          className="mt-2 gap-1 text-[10px] font-medium"
        >
          <Sparkles className="h-3 w-3" />
          {hint.label}
        </Badge>
      )}
    </div>
  );
}
