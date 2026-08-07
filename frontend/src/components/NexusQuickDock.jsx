import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bot,
  Calculator,
  Check,
  Clock3,
  Code2,
  Copy,
  MessageCircle,
  NotebookPen,
  Pause,
  Play,
  Search,
  Focus,
  Sparkles,
  TimerReset,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { calculateQuickExpression, formatQuickTimer } from "@/lib/nexusQuickTools";

const SCRATCHPAD_KEY = "nexus-quick-scratchpad";
const TIMER_KEY = "nexus-quick-timer-start";

const readLocal = (key, fallback = "") => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

const readTimerState = () => {
  const raw = readLocal(TIMER_KEY, "");
  if (!raw) return { startedAt: null, accumulated: 0 };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        startedAt: Number(parsed.startedAt) > 0 ? Number(parsed.startedAt) : null,
        accumulated: Math.max(0, Number(parsed.accumulated) || 0),
      };
    }
    if (Number.isFinite(Number(parsed)) && Number(parsed) > 0) {
      return { startedAt: Number(parsed), accumulated: 0 };
    }
  } catch {
    const legacyStart = Number(raw);
    if (Number.isFinite(legacyStart) && legacyStart > 0) return { startedAt: legacyStart, accumulated: 0 };
  }
  return { startedAt: null, accumulated: 0 };
};

function QuickAction({ icon: Icon, label, detail, onClick, badge, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-[78px] flex-col items-start justify-between rounded-xl border border-border/70 bg-background/55 p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
      data-testid={testId}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary transition group-hover:scale-105">
        <Icon className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-xs font-semibold text-foreground">{label}</span>
        <span className="mt-0.5 block text-[10px] text-muted-foreground">{detail}</span>
      </span>
      {badge > 0 && (
        <span className="absolute right-2.5 top-2.5 min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-[9px] font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

export default function NexusQuickDock() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState("home");
  const [scratchpad, setScratchpad] = useState(() => readLocal(SCRATCHPAD_KEY));
  const [copied, setCopied] = useState(false);
  const [timerState, setTimerState] = useState(readTimerState);
  const [elapsed, setElapsed] = useState(() => timerState.accumulated + (timerState.startedAt ? Math.floor((Date.now() - timerState.startedAt) / 1000) : 0));
  const [calculation, setCalculation] = useState("");
  const [calculationResult, setCalculationResult] = useState("");
  const [chatUnread, setChatUnread] = useState(0);

  useEffect(() => {
    const onKey = (event) => {
      const tag = String(event.target?.tagName || "").toUpperCase();
      const inField = ["INPUT", "TEXTAREA", "SELECT"].includes(tag) || event.target?.isContentEditable;
      if (!inField && (event.metaKey || event.ctrlKey) && event.key === ".") {
        event.preventDefault();
        setOpen((current) => !current);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    const onUnread = (event) => setChatUnread(Math.max(0, Number(event.detail?.count) || 0));
    window.addEventListener("keydown", onKey);
    window.addEventListener("nexus:open-quick-dock", onOpen);
    window.addEventListener("nexus:chat-unread", onUnread);
    window.dispatchEvent(new CustomEvent("nexus:request-chat-unread"));
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("nexus:open-quick-dock", onOpen);
      window.removeEventListener("nexus:chat-unread", onUnread);
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(SCRATCHPAD_KEY, scratchpad); } catch { /* local storage unavailable */ }
  }, [scratchpad]);

  useEffect(() => {
    if (!timerState.startedAt) return undefined;
    const update = () => setElapsed(Math.max(0, timerState.accumulated + Math.floor((Date.now() - timerState.startedAt) / 1000)));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [timerState]);

  useEffect(() => {
    setOpen(false);
    setTool("home");
  }, [location.pathname]);

  const timerDisplay = useMemo(() => formatQuickTimer(elapsed), [elapsed]);

  const startTimer = () => {
    const start = Date.now();
    const next = { startedAt: start, accumulated: elapsed };
    setTimerState(next);
    try { localStorage.setItem(TIMER_KEY, JSON.stringify(next)); } catch { /* local storage unavailable */ }
    toast.success(elapsed ? "Quick timer resumed" : "Quick timer started", { description: "The timer will continue while you move through Nexus." });
  };

  const pauseTimer = () => {
    const next = { startedAt: null, accumulated: elapsed };
    setTimerState(next);
    try { localStorage.setItem(TIMER_KEY, JSON.stringify(next)); } catch { /* local storage unavailable */ }
    toast.info(`Timer paused at ${timerDisplay}`, {
      description: "Open Time Tracking when you are ready to create the audited entry.",
      action: { label: "Log time", onClick: () => navigate("/time-tracking") },
    });
  };

  const resetTimer = () => {
    setTimerState({ startedAt: null, accumulated: 0 });
    setElapsed(0);
    try { localStorage.removeItem(TIMER_KEY); } catch { /* local storage unavailable */ }
  };

  const copyScratchpad = async () => {
    try {
      await navigator.clipboard.writeText(scratchpad);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Clipboard access is unavailable");
    }
  };

  const calculate = () => {
    try {
      setCalculationResult(String(calculateQuickExpression(calculation)));
    } catch (error) {
      setCalculationResult(error.message || "Invalid calculation");
    }
  };

  const openCommand = () => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("nexus:open-command-palette"));
  };

  const openCopilot = () => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("nexus:open-copilot"));
  };

  const openChat = () => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("nexus:open-quick-chat"));
  };

  const enterFocusMode = () => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("nexus:focus-mode", { detail: { enabled: true } }));
  };

  const go = (path) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group fixed bottom-4 right-4 z-40 flex h-11 w-11 items-center overflow-hidden rounded-full border border-primary/25 bg-card/95 text-primary shadow-[-12px_10px_38px_-20px_hsl(var(--primary)/0.8)] backdrop-blur-xl transition-[width,transform] duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:bottom-auto sm:right-0 sm:top-[46%] sm:h-24 sm:-translate-y-1/2 sm:rounded-l-2xl sm:rounded-r-none sm:border-r-0 sm:hover:w-[116px] sm:hover:translate-x-0 sm:hover:scale-100 sm:focus-visible:w-[116px]"
          aria-label="Open Nexus Quick Dock"
          data-testid="quick-dock-toggle"
        >
          <span className="relative flex w-11 shrink-0 items-center justify-center">
            <Sparkles className="h-4 w-4" />
            {chatUnread > 0 && <span className="absolute -right-0.5 -top-2 h-2 w-2 rounded-full bg-rose-500" />}
          </span>
          <span className="hidden whitespace-nowrap pr-3 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground sm:block">
            Quick Dock
          </span>
        </button>
      )}

      {open && (
        <aside
          className="nx-assistant-drawer fixed bottom-2 right-2 z-40 flex max-h-[calc(100dvh-1rem)] w-[380px] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border border-primary/20 bg-card/95 text-foreground shadow-[-22px_24px_70px_-34px_hsl(var(--primary)/0.85)] backdrop-blur-2xl sm:bottom-auto sm:right-4 sm:top-1/2 sm:max-h-[82vh] sm:max-w-[calc(100vw-2rem)] sm:-translate-y-1/2"
          aria-label="Nexus Quick Dock"
          data-testid="quick-dock-panel"
        >
          <div className="border-b border-border/80 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.15),transparent_44%)] px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Nexus Quick Dock</p>
                  <p className="text-[10px] text-muted-foreground">Work without leaving this page · Ctrl + .</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)} aria-label="Close Nexus Quick Dock">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="overflow-y-auto p-4">
            {tool !== "home" && (
              <button type="button" onClick={() => setTool("home")} className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary hover:underline">
                ← All quick tools
              </button>
            )}

            {tool === "home" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <QuickAction icon={Search} label="Search everything" detail="Ctrl + K" onClick={openCommand} testId="quick-dock-search" />
                  <QuickAction icon={Bot} label="Nexus AI" detail="Ask with live context" onClick={openCopilot} testId="quick-dock-ai" />
                  <QuickAction icon={MessageCircle} label="Team chat" detail="Live collaboration" onClick={openChat} badge={chatUnread} testId="quick-dock-chat" />
                  <QuickAction icon={Clock3} label="Quick timer" detail={timerState.startedAt ? timerDisplay : elapsed ? `${timerDisplay} paused` : "Track work anywhere"} onClick={() => setTool("timer")} testId="quick-dock-timer" />
                  <QuickAction icon={NotebookPen} label="Scratchpad" detail={scratchpad ? "Local note saved" : "Keep working context"} onClick={() => setTool("notes")} testId="quick-dock-notes" />
                  <QuickAction icon={Calculator} label="Calculator" detail="Fast commercial maths" onClick={() => setTool("calculator")} testId="quick-dock-calculator" />
                  <QuickAction icon={Code2} label="Scripts" detail="Open technician library" onClick={() => go("/scripting")} testId="quick-dock-scripts" />
                  <QuickAction icon={TimerReset} label="Time tracking" detail="Create audited entry" onClick={() => go("/time-tracking")} testId="quick-dock-time-tracking" />
                  <QuickAction icon={Focus} label="Focus mode" detail="Hide navigation noise" onClick={enterFocusMode} testId="quick-dock-focus-mode" />
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                  Quick tools never silently alter a client record. Actions that require scope, approval or audit open their full Nexus workflow.
                </p>
              </>
            )}

            {tool === "timer" && (
              <section aria-label="Quick timer" className="rounded-xl border border-border/70 bg-background/55 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Persistent quick timer</p>
                <p className="mt-3 font-mono text-4xl font-semibold tracking-tight" data-testid="quick-timer-value">{timerDisplay}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {timerState.startedAt ? "Timing continues across Nexus workspaces." : elapsed ? "Paused locally. Log it when the work is ready." : "Start timing without leaving the current record."}
                </p>
                <div className="mt-4 flex gap-2">
                  {timerState.startedAt ? (
                    <Button className="flex-1" onClick={pauseTimer} data-testid="quick-timer-pause"><Pause className="mr-1.5 h-4 w-4" />Pause</Button>
                  ) : (
                    <Button className="flex-1" onClick={startTimer} data-testid="quick-timer-start"><Play className="mr-1.5 h-4 w-4" />{elapsed ? "Resume timer" : "Start timer"}</Button>
                  )}
                  <Button variant="outline" onClick={resetTimer} disabled={!elapsed && !timerState.startedAt}><TimerReset className="mr-1.5 h-4 w-4" />Reset</Button>
                </div>
                <Button variant="ghost" className="mt-2 w-full" onClick={() => go("/time-tracking")}>Open audited time tracking</Button>
              </section>
            )}

            {tool === "notes" && (
              <section aria-label="Quick scratchpad" className="space-y-3">
                <div>
                  <p className="text-sm font-semibold">Local scratchpad</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Saved in this browser only. It is not added to a client or audit trail.</p>
                </div>
                <Textarea
                  value={scratchpad}
                  onChange={(event) => setScratchpad(event.target.value)}
                  placeholder="Paste an IP, jot down troubleshooting context, or prepare a handover…"
                  className="min-h-52 resize-none bg-background/55"
                  maxLength={6000}
                  data-testid="quick-scratchpad"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">{scratchpad.length}/6000</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setScratchpad("")} disabled={!scratchpad}>Clear</Button>
                    <Button size="sm" onClick={copyScratchpad} disabled={!scratchpad}>
                      {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>
              </section>
            )}

            {tool === "calculator" && (
              <section aria-label="Quick calculator" className="rounded-xl border border-border/70 bg-background/55 p-4">
                <p className="text-sm font-semibold">Quick calculator</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">Supports brackets, percentages and standard arithmetic.</p>
                <form onSubmit={(event) => { event.preventDefault(); calculate(); }} className="mt-4 space-y-3">
                  <Input
                    value={calculation}
                    onChange={(event) => setCalculation(event.target.value)}
                    placeholder="(149.95 + 89) * 1.1"
                    className="font-mono"
                    data-testid="quick-calculator-input"
                  />
                  <div className="flex items-center gap-2">
                    <Button type="submit" className="shrink-0">Calculate</Button>
                    <div className="min-h-10 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-right font-mono text-sm" data-testid="quick-calculator-result">
                      {calculationResult || "—"}
                    </div>
                  </div>
                </form>
              </section>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
