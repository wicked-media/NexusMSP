import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import KnowledgeBasePage from "./KnowledgeBasePage";
import ITDocumentationPage from "./ITDocumentationPage";
import AutoDocumentationPage from "./AutoDocumentationPage";
import HelpCenterPage from "./HelpCenterPage";
import CapacityPlannerPage from "./CapacityPlannerPage";
import { BookOpen, FileText, Sparkles, CircleHelp, ChartNoAxesCombined } from "lucide-react";

const DOC_TABS = [
  { value: "library", label: "Knowledge Base", icon: BookOpen, component: KnowledgeBasePage },
  { value: "it-docs", label: "IT Docs", icon: FileText, component: ITDocumentationPage },
  { value: "automation", label: "Auto-Docs", icon: Sparkles, component: AutoDocumentationPage },
  { value: "help", label: "Help Centre", icon: CircleHelp, component: HelpCenterPage },
  { value: "capacity", label: "Capacity", icon: ChartNoAxesCombined, component: CapacityPlannerPage },
];

function EmbeddedWorkspace({ children }) {
  return <div className="[&>[data-testid]>:first-child]:hidden">{children}</div>;
}

export default function DocumentationHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get("tab") || "library");

  useEffect(() => {
    const requested = searchParams.get("tab");
    if (DOC_TABS.some(item => item.value === requested) && requested !== tab) setTab(requested);
  }, [searchParams, tab]);

  const selectTab = (value) => {
    setTab(value);
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-5" data-testid="documentation-hub-page">
      <OperationalPageHeader
        eyebrow="Knowledge operations"
        title="Knowledge & Docs"
        description="One workspace for technician documentation, client knowledge, automation output, product guidance, and capacity planning."
        icon={BookOpen}
        tone="sky"
      />
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-border/70 bg-muted/30 p-1.5">
          {DOC_TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="shrink-0 gap-1.5 px-3 py-2 text-xs">
              <Icon className="h-3.5 w-3.5" />{label}
            </TabsTrigger>
          ))}
        </TabsList>
        {DOC_TABS.map(({ value, component: Component }) => (
          <TabsContent key={value} value={value} className="mt-5">
            <EmbeddedWorkspace><Component /></EmbeddedWorkspace>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
