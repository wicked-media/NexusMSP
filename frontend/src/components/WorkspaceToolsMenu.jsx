import { useNavigate } from "react-router-dom";
import WorkspaceActionMenu, { WorkspaceActionMenuItem } from "@/components/WorkspaceActionMenu";
import { getWorkspaceTools } from "@/config/workspaceTools";

const toneClasses = {
  sky: "text-sky-300",
  violet: "text-violet-300",
  emerald: "text-emerald-300",
  cyan: "text-cyan-300",
  amber: "text-amber-300",
  indigo: "text-indigo-300",
  rose: "text-rose-300",
};

/**
 * Shared secondary navigation for operational workspace headers.
 * Keep primary actions beside the header; routes that broaden the workspace
 * belong in the canonical, keyboard-accessible More menu.
 */
export default function WorkspaceToolsMenu({ workspace, testId, label = "More" }) {
  const navigate = useNavigate();
  const items = getWorkspaceTools(workspace);

  if (!items.length) return null;

  return (
    <WorkspaceActionMenu label={label} testId={testId}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <WorkspaceActionMenuItem key={item.path} onSelect={() => navigate(item.path)}>
            <Icon className={`h-4 w-4 ${toneClasses[item.tone] || "text-primary"}`} aria-hidden="true" />
            {item.label}
          </WorkspaceActionMenuItem>
        );
      })}
    </WorkspaceActionMenu>
  );
}
