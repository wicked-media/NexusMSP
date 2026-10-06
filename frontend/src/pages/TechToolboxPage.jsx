import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { PageShell } from "@/components/design-system";
import { Button } from "@/components/ui/button";
import {
  Gamepad2, Volume2, VolumeX, Radar, ListChecks,
} from "lucide-react";
import { playSound, isSoundEnabled, setSoundEnabled } from "@/lib/sounds";

import {
  WheelOfTickets, FocusMode, PingArcade, LabelPrinter, ProtocolRegistry, NexusNativeCertification, TechCardPanel,
  WinWall, NetworkWeather, SeasonStandings, Speedruns, NoteTranslator, IsItDns, RealityCheck, BossBattles,
  DevicePersonality, Celebrations,
} from "@/components/toolbox/DelightTools";
import {
  GoHomeCheck, WeekendRisk, CaughtUp, MemoryPin, ChangeRisk, NopeButton, LabsFlags,
} from "@/components/toolbox/ShiftTools";
import {
  AlertTriage, BlastRadius, WorkLocks, HandoverDigest, CustomerCost,
} from "@/components/toolbox/ContextTools";
import {
  BehaviourBaseline, SomethingFeelsWrong, UniversalTimeline, UniversalSearch, SessionSidecar, WhileYoureThere,
  DependencyHorizon, AgreementMargin, TechnicalDebt, KnowledgeCoverage, ProveIt, ConfidenceReport,
  TicketIntelligence, NoiseBudget, TicketCorrelation, AuditReadiness,
} from "@/components/toolbox/InsightTools";
import {
  NexusLaws, CredentialGuard, RealityChecks, IntentOS, ITGenome, UniversalConnector, LedgerMetering,
  ConsequenceEngine, MorningCommander, EndMyDay, DecisionMemory,
} from "@/components/toolbox/PolicyTools";
import {
  WritingGuard, FourEyesSignOff, DecisionFamily,
} from "@/components/toolbox/SafetyTools";
import {
  DiagnosticWorkbench, FindEverywhere, CommandRecorder, SyntheticEmployee, NexusRescue,
} from "@/components/toolbox/TechnicianOsTools";
import {
  MissionControlInvestigate, StateEngineDrift, FleetShell, EvidenceEngine, OperationalMode,
} from "@/components/toolbox/OrchestrationTools";

// ============== PAGE ==============

export default function TechToolboxPage() {
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  const location = useLocation();

  // Deep-link support: /toolbox?tool=mission-control scrolls to and highlights
  // the matching tool so the sidebar can bring a technician straight to it.
  useEffect(() => {
    const target = new URLSearchParams(location.search).get("tool");
    if (!target || typeof document === "undefined") return;
    const el = document.getElementById(`tool-${target}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-violet-500/70", "rounded-xl");
    const timer = setTimeout(() => el.classList.remove("ring-2", "ring-violet-500/70", "rounded-xl"), 2600);
    return () => clearTimeout(timer);
  }, [location.search]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    if (next) playSound("coin");
  };

  return (
    <PageShell>
      <div className="space-y-4" data-testid="tech-toolbox-page">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-violet-400 mb-1 flex items-center gap-2">
              <Gamepad2 className="w-3 h-3" />Tech Toolbox
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Toys, tools & tiny triumphs</h1>
            <p className="text-sm text-muted-foreground">
              Everything here runs on real Nexus data — the wheel picks real tickets, the arcade measures real latency,
              and every point lands in the real ledger.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={toggleSound} data-testid="sound-toggle" title={soundOn ? "Mute delight sounds" : "Enable delight sounds (off by default)"}>
            {soundOn ? <Volume2 className="mr-1 h-3 w-3" /> : <VolumeX className="mr-1 h-3 w-3" />}
            {soundOn ? "Sounds on" : "Sounds off"}
          </Button>
        </div>
        {/* Featured: the orchestration layer and the primitives underneath it */}
        <section aria-labelledby="toolbox-featured-heading" data-testid="toolbox-featured">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-violet-500/25 bg-violet-500/[0.07] p-3">
            <Radar className="h-4 w-4 shrink-0 text-violet-300" />
            <h2 id="toolbox-featured-heading" className="text-sm font-semibold tracking-tight text-violet-200">Mission Control &amp; Trusted State</h2>
            <p className="text-xs text-muted-foreground">Tell Nexus what appears wrong and it assembles the scope, tools and evidence — backed by device state, fleet sets and operation proof.</p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2 nx-tool-grid">
            <MissionControlInvestigate />
            <DiagnosticWorkbench />
            <FindEverywhere />
            <StateEngineDrift />
            <FleetShell />
            <EvidenceEngine />
            <OperationalMode />
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Every other tool</h2>
          <p className="text-xs text-muted-foreground">The rest of the toolbox, running on real Nexus data.</p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2 nx-tool-grid">
          <AlertTriage />
          <BlastRadius />
          <WorkLocks />
          <HandoverDigest />
          <CustomerCost />
          <BehaviourBaseline />
          <SomethingFeelsWrong />
          <UniversalTimeline />
          <UniversalSearch />
          <SessionSidecar />
          <WhileYoureThere />
          <DependencyHorizon />
          <AgreementMargin />
          <TechnicalDebt />
          <KnowledgeCoverage />
          <ProveIt />
          <ConfidenceReport />
          <TicketIntelligence />
          <NoiseBudget />
          <TicketCorrelation />
          <AuditReadiness />
          <NexusLaws />
          <CredentialGuard />
          <RealityChecks />
          <ConsequenceEngine />
          <MorningCommander />
          <EndMyDay />
          <DecisionMemory />
          <WritingGuard />
          <FourEyesSignOff />
          <DecisionFamily />
          <CommandRecorder />
          <SyntheticEmployee />
          <NexusRescue />
          <IntentOS />
          <ITGenome />
          <UniversalConnector />
          <LedgerMetering />
          <ProtocolRegistry />
          <NexusNativeCertification />
          <GoHomeCheck />
          <WeekendRisk />
          <CaughtUp />
          <MemoryPin />
          <ChangeRisk />
          <NopeButton />
          <LabsFlags />
          <NoteTranslator />
          <IsItDns />
          <RealityCheck />
          <BossBattles />
          <DevicePersonality />
          <Celebrations />
          <WheelOfTickets />
          <FocusMode />
          <PingArcade />
          <LabelPrinter />
          <TechCardPanel />
          <WinWall />
          <NetworkWeather />
          <SeasonStandings />
          <Speedruns />
        </div>
      </div>
    </PageShell>
  );
}
