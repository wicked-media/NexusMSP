import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  FileText,
  GitPullRequest,
  Lightbulb,
  Loader2,
  Minimize2,
  Monitor,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Ticket,
  X,
} from "lucide-react";

const EMPTY_BRIEFING = {
  ai: { configured: false, model: "Nexus AI", reasoning_effort: "medium" },
  metrics: {
    open_tickets: 0,
    critical_tickets: 0,
    unassigned_tickets: 0,
    total_devices: 0,
    online_devices: 0,
    offline_devices: 0,
    overdue_invoices: 0,
    pending_changes: 0,
  },
  sources: [],
  generated_at: null,
};

const metricCards = [
  { key: "tickets", label: "Ticket queue", icon: Ticket, route: "/tickets", tone: "amber" },
  { key: "devices", label: "Asset health", icon: Monitor, route: "/devices", tone: "sky" },
  { key: "invoices", label: "Billing follow-up", icon: FileText, route: "/invoices", tone: "violet" },
  { key: "changes", label: "Change control", icon: GitPullRequest, route: "/change-management", tone: "emerald" },
];

const metricIconTones = {
  amber: "bg-amber-500/10 text-amber-300",
  sky: "bg-sky-500/10 text-sky-300",
  violet: "bg-violet-500/10 text-violet-300",
  emerald: "bg-emerald-500/10 text-emerald-300",
};

const THINKING_STEPS = [
  "Reading live workspace context",
  "Comparing recent records and history",
  "Reviewing connected documentation",
  "Building an evidence-backed recommendation",
];

const formatTime = (value) => {
  const timestamp = value ? new Date(value) : null;
  return timestamp && !Number.isNaN(timestamp.valueOf())
    ? timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "Live";
};

const formatModel = (value) => ({
  "gpt-5.6": "GPT-5.6 Sol",
  "gpt-5.6-terra": "GPT-5.6 Terra",
  "gpt-5.6-luna": "GPT-5.6 Luna",
}[String(value || "").toLowerCase()] || String(value || "OpenAI"));

function MetricCard({ card, metrics, onOpen }) {
  const Icon = card.icon;
  const values = {
    tickets: { value: metrics.open_tickets || 0, detail: `${metrics.critical_tickets || 0} critical · ${metrics.unassigned_tickets || 0} unassigned` },
    devices: { value: `${metrics.online_devices || 0}/${metrics.total_devices || 0}`, detail: `${metrics.offline_devices || 0} offline` },
    invoices: { value: metrics.overdue_invoices || 0, detail: "Overdue invoices" },
    changes: { value: metrics.pending_changes || 0, detail: "Awaiting review" },
  }[card.key];

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group rounded-xl border border-border/70 bg-background/55 p-3 text-left transition hover:border-primary/35 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${metricIconTones[card.tone] || metricIconTones.emerald}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-lg font-semibold leading-none">{values.value}</span>
      </div>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{card.label}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{values.detail}</p>
    </button>
  );
}

export function AICopilotPanel({ isOpen, onClose }) {
  const { token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID?.() || Math.random().toString(36).slice(2, 10));
  const [suggestions, setSuggestions] = useState([]);
  const [briefing, setBriefing] = useState(EMPTY_BRIEFING);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState("");
  const [thinkingStep, setThinkingStep] = useState(0);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const aiConnected = Boolean(briefing.ai?.configured);

  const loadBriefing = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setBriefingLoading(true);
    const [briefingResult, suggestionsResult] = await Promise.allSettled([
      axios.get(`${API}/copilot/briefing`, { headers }),
      axios.get(`${API}/copilot/suggestions`, { headers }),
    ]);
    if (briefingResult.status === "fulfilled") setBriefing({ ...EMPTY_BRIEFING, ...briefingResult.value.data });
    if (suggestionsResult.status === "fulfilled") setSuggestions(Array.isArray(suggestionsResult.value.data) ? suggestionsResult.value.data : []);
    if (briefingResult.status === "rejected" && suggestionsResult.status === "rejected") {
      toast.error("Nexus AI could not load the operational brief");
    }
    if (!quiet) setBriefingLoading(false);
  }, [headers]);

  useEffect(() => {
    if (!isOpen) return;
    loadBriefing();
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 100);
    return () => window.clearTimeout(timeout);
  }, [isOpen, loadBriefing]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  useEffect(() => {
    if (!loading) {
      setThinkingStep(0);
      return undefined;
    }
    const interval = window.setInterval(() => {
      setThinkingStep((current) => Math.min(current + 1, THINKING_STEPS.length - 1));
    }, 850);
    return () => window.clearInterval(interval);
  }, [loading]);

  const startNewConversation = () => {
    setMessages([]);
    setInput("");
    setSessionId(crypto.randomUUID?.() || Math.random().toString(36).slice(2, 10));
    setCopiedMessage("");
    inputRef.current?.focus();
  };

  const copyResponse = async (message) => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedMessage(message.id);
      window.setTimeout(() => setCopiedMessage(""), 1600);
    } catch {
      toast.error("Could not copy the response");
    }
  };

  const sendMessage = async (text) => {
    const message = (text || input).trim();
    if (!message || loading) return;
    if (!aiConnected) {
      toast.info("Connect OpenAI in Settings before starting an AI conversation");
      return;
    }
    const userMessage = { id: `user-${Date.now()}`, role: "user", text: message, at: new Date().toISOString() };
    setInput("");
    setMessages((previous) => [...previous, userMessage]);
    setLoading(true);
    try {
      const response = await axios.post(`${API}/copilot/chat`, {
        message,
        session_id: sessionId,
        workspace: location.pathname,
      }, { headers });
      setMessages((previous) => [...previous, {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        text: response.data?.reply || "Nexus AI did not return a response.",
        at: new Date().toISOString(),
      }]);
    } catch (error) {
      setMessages((previous) => [...previous, {
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        text: error.response?.data?.detail || "Nexus AI is unavailable right now. Check the AI connection in Settings and try again.",
        at: new Date().toISOString(),
        error: true,
      }]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;
  if (minimized) {
    return (
      <div className="fixed bottom-5 right-5 z-50">
        <Button onClick={() => setMinimized(false)} className="h-14 w-14 rounded-2xl border border-primary/35 bg-primary shadow-[0_18px_55px_rgba(16,185,129,0.28)]" data-testid="copilot-expand" aria-label="Open Nexus AI">
          <Bot className="h-6 w-6" />
        </Button>
      </div>
    );
  }

  return (
    <aside className="nx-assistant-drawer nx-ambient-surface fixed right-0 top-0 z-50 flex h-dvh w-full max-w-[456px] flex-col border-l border-border/80 bg-background shadow-[-22px_0_65px_rgba(0,0,0,0.38)]" data-nx-signal={loading ? "working" : suggestions.length ? "recommendation" : "calm"} data-testid="copilot-panel" aria-label="Nexus AI copilot">
      <div className="border-b border-emerald-400/15 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.15),transparent_42%),linear-gradient(135deg,rgba(15,23,42,0.42),rgba(15,23,42,0.08))] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 shadow-[0_0_28px_rgba(16,185,129,0.14)]">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold tracking-tight">Nexus AI</p>
                <Badge variant="outline" className={aiConnected ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-100"}>
                  <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${aiConnected ? "bg-emerald-300 animate-pulse" : "bg-amber-300"}`} />
                  {aiConnected ? "Connected" : "Needs connection"}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">Operational copilot · {formatModel(briefing.ai?.model)}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={startNewConversation} aria-label="Start a new AI conversation" title="New conversation"><Plus className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMinimized(true)} aria-label="Minimise Nexus AI"><Minimize2 className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} data-testid="copilot-close" aria-label="Close Nexus AI"><X className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-5 px-5 py-4">
          <section className="rounded-2xl border border-border/75 bg-muted/[0.14] p-3.5" aria-label="Live operational context">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-emerald-300" />Live operational brief</p>
                <p className="mt-1 text-xs text-muted-foreground">Read-only workspace context · refreshed {formatTime(briefing.generated_at)}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => loadBriefing()} disabled={briefingLoading} aria-label="Refresh operational brief"><RefreshCw className={`h-3.5 w-3.5 ${briefingLoading ? "animate-spin" : ""}`} /></Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {metricCards.map((card) => <MetricCard key={card.key} card={card} metrics={briefing.metrics || EMPTY_BRIEFING.metrics} onOpen={() => navigate(card.route)} />)}
            </div>
          </section>

          {!aiConnected && (
            <section className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-3.5">
              <div className="flex gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <div>
                  <p className="text-sm font-semibold text-amber-100">Connect OpenAI to start reasoning</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-100/75">The live operational brief remains available. Configure the server-side OpenAI key to enable grounded answers, drafts, and troubleshooting guidance.</p>
                  <Button variant="outline" size="sm" className="mt-3 border-amber-300/30 bg-transparent text-amber-100 hover:bg-amber-300/10" onClick={() => navigate("/settings?tab=ai&anchor=ai-config-card")}><Settings2 className="mr-1.5 h-3.5 w-3.5" />Open AI settings</Button>
                </div>
              </div>
            </section>
          )}

          {messages.length === 0 ? (
            <section aria-label="Suggested copilot prompts">
              <div className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-300" /><p className="text-sm font-semibold">Suggested next steps</p></div>
              <p className="mt-1 text-xs text-muted-foreground">Grounded in the current NexusMSP workspace. AI never alters a record without an explicit workflow.</p>
              <div className="mt-3 space-y-2">
                {suggestions.map((suggestion, index) => (
                  <button key={suggestion.id || suggestion.text || index} type="button" onClick={() => sendMessage(suggestion.text)} disabled={!aiConnected}
                    className="group flex w-full items-start gap-3 rounded-xl border border-border/65 bg-background/60 p-3 text-left transition hover:border-emerald-400/30 hover:bg-emerald-400/[0.035] disabled:cursor-not-allowed disabled:opacity-55"
                    data-testid={`copilot-suggestion-${index}`}>
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300"><Lightbulb className="h-3.5 w-3.5" /></span>
                    <span><span className="block text-sm font-medium leading-snug">{suggestion.text}</span>{suggestion.description && <span className="mt-0.5 block text-xs text-muted-foreground">{suggestion.description}</span>}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="space-y-4" aria-label="Nexus AI conversation">
              {messages.map((message) => (
                <div key={message.id} className={`flex gap-2.5 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  {message.role === "assistant" && <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300"><Bot className="h-3.5 w-3.5" /></span>}
                  <div className={`group max-w-[84%] rounded-2xl px-3.5 py-3 text-sm leading-relaxed ${message.role === "user" ? "bg-primary text-primary-foreground" : message.error ? "border border-rose-400/25 bg-rose-400/[0.06]" : "border border-border/70 bg-muted/35"}`}>
                    <p className="whitespace-pre-wrap">{message.text}</p>
                    <div className={`mt-2 flex items-center justify-between gap-3 text-[10px] ${message.role === "user" ? "text-primary-foreground/65" : "text-muted-foreground"}`}>
                      <span>{message.role === "assistant" ? "Nexus AI" : "You"} · {formatTime(message.at)}</span>
                      {message.role === "assistant" && !message.error && <button type="button" onClick={() => copyResponse(message)} className="inline-flex items-center gap-1 transition hover:text-foreground" aria-label="Copy AI response">{copiedMessage === message.id ? <><Check className="h-3 w-3" />Copied</> : <><Copy className="h-3 w-3" />Copy</>}</button>}
                    </div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex gap-2.5" data-testid="copilot-thinking-progress" role="status" aria-live="polite">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-600 dark:text-emerald-300">
                    <Bot className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1 rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.07] to-muted/35 px-3.5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-foreground">Nexus AI is working</p>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                        Step {thinkingStep + 1} of {THINKING_STEPS.length}
                      </span>
                    </div>
                    <p className="mt-1 flex items-center text-xs text-muted-foreground">
                      <Loader2 className="mr-2 h-3.5 w-3.5 shrink-0 animate-spin text-emerald-600 dark:text-emerald-300" />
                      {THINKING_STEPS[thinkingStep]}
                    </p>
                    <div className="mt-3 grid grid-cols-4 gap-1" aria-hidden="true">
                      {THINKING_STEPS.map((step, index) => (
                        <span
                          key={step}
                          className={`h-1 rounded-full transition-colors duration-300 ${
                            index <= thinkingStep ? "bg-emerald-500" : "bg-border"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <div className="border-t border-border/80 bg-background/95 p-4">
        <form onSubmit={(event) => { event.preventDefault(); sendMessage(); }} className="rounded-2xl border border-border/75 bg-muted/[0.16] p-2 focus-within:border-emerald-400/35 focus-within:ring-2 focus-within:ring-emerald-400/10">
          <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }}
            placeholder={aiConnected ? "Ask about work, draft a response, or investigate a pattern…" : "Connect OpenAI in Settings to start a conversation"}
            className="min-h-[46px] max-h-28 w-full resize-none bg-transparent px-2 pt-1.5 text-sm outline-none placeholder:text-muted-foreground/75 disabled:cursor-not-allowed"
            disabled={loading || !aiConnected} data-testid="copilot-input" maxLength={4000} />
          <div className="flex items-center justify-between gap-3 px-1 pb-0.5">
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><ShieldCheck className="h-3 w-3 text-emerald-300" />Read-only context · {input.length}/4000</span>
            <Button type="submit" size="sm" disabled={loading || !aiConnected || !input.trim()} className="h-8 px-3" data-testid="copilot-send"><Send className="mr-1.5 h-3.5 w-3.5" />Ask Nexus AI</Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
