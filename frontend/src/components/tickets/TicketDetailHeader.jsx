import axios from "axios";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft, ChevronDown, Brain, Sparkles, GitBranch, Wifi, WifiOff, ExternalLink,
  Mail, Download, Play, Square, Timer, Loader2, Merge, ShoppingCart, Receipt,
  Boxes, Lightbulb, Users, Wand2, UserCheck, MessageSquare, BookPlus, Activity, Pin, PinOff, Siren,
} from "lucide-react";
import { TicketAIBundle } from "@/components/ai/TicketAIBundle";
import { WhyOnFireButton } from "@/components/ai/WhyOnFireButton";
import { TicketCopilotButton, ExplainErrorButton } from "@/components/ai/CopilotWidgets";
import { VoiceJournalButton } from "@/components/ai/VoiceJournalButton";
import { priorityConfig } from "@/config/ticketConfig";
import { toast } from "sonner";
import { API } from "@/App";
import { useState, useEffect } from "react";

/**
 * Compact, menu-driven detail header (Syncro-style).
 * Groups buttons into 3 dropdowns: C.R.A.I.G (AI insights), Ticket Actions, Billing.
 * Keeps Copilot/Explain/VoiceJournal as compact icon buttons (they have their own dropdowns).
 */
export function TicketDetailHeader({
  viewingTicket,
  parent,
  deviceStatus,
  token,
  handleAiAnalysis,
  aiAnalyzing,
  isTimerRunning,
  timerElapsed,
  toggleTimer,
  fmtTime,
  setIsTimeOpen,
  setIsEmailOpen,
  setIsAddItemOpen,
  setIsKitPickerOpen,
  setIsPushInvoiceOpen,
  setIsChildOpen,
  setIsMergeOpen,
  setInvoicesList,
  ticketProducts,
  handleDownloadPdf,
  onBack,
  fetchTimeEntries,
}) {
  const headers = { Authorization: `Bearer ${token}` };
  const [pinned, setPinned] = useState(false);
  const [teamPin, setTeamPin] = useState({ team_pinned: false, can_unpin: false, pinned_by_name: null });

  useEffect(() => {
    if (!viewingTicket?.id) return;
    axios.get(`${API}/workspace/pin/ticket/${viewingTicket.id}/status`, { headers })
      .then(r => setPinned(!!r.data?.pinned))
      .catch(() => setPinned(false));
    axios.get(`${API}/team-pins/ticket/${viewingTicket.id}/status`, { headers })
      .then(r => setTeamPin(r.data || { team_pinned: false }))
      .catch(() => setTeamPin({ team_pinned: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingTicket?.id]);

  const togglePin = async () => {
    try {
      if (pinned) {
        await axios.delete(`${API}/workspace/pin/ticket/${viewingTicket.id}`, { headers });
        setPinned(false);
        toast.success("Removed from your workspace");
      } else {
        await axios.post(`${API}/workspace/pin/ticket/${viewingTicket.id}`, {}, { headers });
        setPinned(true);
        toast.success("Pinned to your workspace 📌");
      }
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to toggle pin"); }
  };

  const toggleTeamPin = async () => {
    try {
      if (teamPin.team_pinned) {
        await axios.delete(`${API}/team-pins/ticket/${viewingTicket.id}`, { headers });
        setTeamPin({ team_pinned: false });
        toast.success("Unpinned from team");
      } else {
        const note = window.prompt("Quick note for the team (optional):", "");
        await axios.post(
          `${API}/team-pins/ticket/${viewingTicket.id}`,
          { note: note || "", reason: "outage" },
          { headers }
        );
        setTeamPin({ team_pinned: true, can_unpin: true });
        toast.success("Pinned for the team 🚨");
      }
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to toggle team pin"); }
  };

  const handleAutoQuote = async () => {
    try {
      const r = await axios.post(`${API}/tickets/${viewingTicket.id}/auto-quote`, {}, { headers });
      toast.success(`Quote drafted: ${r.data?.line_items?.length || 0} items @ $${r.data?.total || 0}`);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="ticket-detail-header">
      {/* Identity row */}
      <Button variant="ghost" size="sm" onClick={onBack} data-testid="back-to-list">
        <ArrowLeft className="w-4 h-4 mr-1" />Back
      </Button>
      <Badge className={priorityConfig[viewingTicket.priority]?.class}>{priorityConfig[viewingTicket.priority]?.label}</Badge>
      <span className="text-sm text-muted-foreground font-mono">{viewingTicket.ticket_number}</span>
      {pinned && (
        <Badge variant="outline" className="text-violet-400 border-violet-500/40 bg-violet-500/10 gap-1" title="Pinned to your workspace">
          <Pin className="w-3 h-3" />Pinned
        </Badge>
      )}
      {teamPin.team_pinned && (
        <Badge
          variant="outline"
          className="text-red-300 border-red-500/50 bg-red-500/15 gap-1 animate-pulse"
          title={`Pinned for team by ${teamPin.pinned_by_name || "?"}`}
          data-testid="team-pinned-badge"
        >
          <Siren className="w-3 h-3" />TEAM
        </Badge>
      )}
      {viewingTicket.merged_into && <Badge variant="outline" className="text-red-400">Merged</Badge>}
      {parent && <Badge variant="outline" className="text-indigo-400"><GitBranch className="w-3 h-3 mr-1" />Child of {parent.ticket_number}</Badge>}
      {viewingTicket.blueprint_id && (
        <Badge variant="outline" className="text-sky-400 border-sky-500/30 bg-sky-500/10 gap-1">
          <Lightbulb className="w-3 h-3" />{viewingTicket.blueprint_name || "Blueprint"}
        </Badge>
      )}

      <div className="ml-auto flex items-center gap-1.5 flex-wrap">
        {/* Device status pill */}
        {viewingTicket.device_id && deviceStatus && (
          <div
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${
              deviceStatus.status === "online"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-red-500/10 text-red-400 border-red-500/30"
            }`}
            data-testid="device-status-indicator"
          >
            {deviceStatus.status === "online" ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {deviceStatus.name}
          </div>
        )}

        {/* Remote (always visible if device linked) */}
        {viewingTicket.device_id && (
          <Button
            variant="outline" size="sm"
            className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10 h-8"
            onClick={() => window.open(`/remote-access?device=${viewingTicket.device_id}`, "_blank")}
            data-testid="remote-connect-btn"
          >
            <ExternalLink className="w-3 h-3 mr-1" />Remote
          </Button>
        )}

        {/* C.R.A.I.G — AI menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline" size="sm"
              className="text-purple-400 border-purple-500/40 hover:bg-purple-500/10 font-semibold tracking-wide h-8"
              data-testid="craig-menu-btn"
            >
              <Sparkles className="w-3.5 h-3.5 mr-1" />C.R.A.I.G
              <ChevronDown className="w-3 h-3 ml-1 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-purple-400">Diagnostics</DropdownMenuLabel>
            <DropdownMenuItem onClick={handleAiAnalysis} disabled={aiAnalyzing} data-testid="craig-diagnose">
              {aiAnalyzing ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Brain className="w-3.5 h-3.5 mr-2 text-purple-400" />}
              AI Diagnose
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-purple-400">Insights</DropdownMenuLabel>
            <TicketAIBundle
              ticket={viewingTicket}
              variant="menu"
              renderMenuItems={({ open, isResolved }) => (
                <>
                  <DropdownMenuItem onClick={() => open("doppel")} data-testid="craig-doppelganger">
                    <Users className="w-3.5 h-3.5 mr-2 text-violet-400" />Doppelgänger
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => open("resolution")} data-testid="craig-suggest-resolution">
                    <Wand2 className="w-3.5 h-3.5 mr-2 text-indigo-400" />Suggest Resolution
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => open("assign")} data-testid="craig-smart-assign">
                    <UserCheck className="w-3.5 h-3.5 mr-2 text-cyan-400" />Smart Assign
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => open("apology")} data-testid="craig-apology">
                    <MessageSquare className="w-3.5 h-3.5 mr-2 text-rose-400" />Apology Draft
                  </DropdownMenuItem>
                  {isResolved && (
                    <DropdownMenuItem onClick={() => open("runbook")} data-testid="craig-runbook">
                      <BookPlus className="w-3.5 h-3.5 mr-2 text-sky-400" />Promote to Runbook
                    </DropdownMenuItem>
                  )}
                </>
              )}
            />
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Inline AI helpers (have their own popups) — kept compact */}
        <TicketCopilotButton ticketId={viewingTicket.id} />
        <ExplainErrorButton contextHint="app trace" />
        <VoiceJournalButton ticketId={viewingTicket.id} onLogged={() => fetchTimeEntries?.(viewingTicket.id)} />

        {/* Ticket Actions menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8" data-testid="ticket-actions-menu-btn">
              <Activity className="w-3.5 h-3.5 mr-1" />Actions
              <ChevronDown className="w-3 h-3 ml-1 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest">Time</DropdownMenuLabel>
            <DropdownMenuItem onClick={toggleTimer} data-testid="actions-timer">
              {isTimerRunning
                ? <><Square className="w-3.5 h-3.5 mr-2 text-red-400" />Stop Timer ({fmtTime(timerElapsed)})</>
                : <><Play className="w-3.5 h-3.5 mr-2 text-emerald-400" />Start Timer</>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsTimeOpen(true)} data-testid="actions-log-time">
              <Timer className="w-3.5 h-3.5 mr-2" />Log Time
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest">Linking</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setIsChildOpen(true)} data-testid="actions-child">
              <GitBranch className="w-3.5 h-3.5 mr-2" />Create Child Ticket
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsMergeOpen(true)} data-testid="actions-merge">
              <Merge className="w-3.5 h-3.5 mr-2" />Merge Tickets
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest">Workspace</DropdownMenuLabel>
            <DropdownMenuItem onClick={togglePin} data-testid="actions-pin">
              {pinned
                ? <><PinOff className="w-3.5 h-3.5 mr-2 text-violet-400" />Unpin from Workspace</>
                : <><Pin className="w-3.5 h-3.5 mr-2 text-violet-400" />Pin to My Workspace</>}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={toggleTeamPin}
              disabled={teamPin.team_pinned && !teamPin.can_unpin}
              data-testid="actions-team-pin"
            >
              {teamPin.team_pinned
                ? <><Siren className="w-3.5 h-3.5 mr-2 text-red-400" />
                    {teamPin.can_unpin ? "Unpin from Team" : `Pinned by ${teamPin.pinned_by_name}`}
                  </>
                : <><Siren className="w-3.5 h-3.5 mr-2 text-red-400" />Pin for Team (NOC strip)</>}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Billing menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline" size="sm"
              className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 h-8"
              data-testid="billing-menu-btn"
            >
              <Receipt className="w-3.5 h-3.5 mr-1" />Billing
              {ticketProducts.length > 0 && <Badge variant="secondary" className="ml-1.5 h-4 text-[9px] px-1.5">{ticketProducts.length}</Badge>}
              <ChevronDown className="w-3 h-3 ml-1 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-emerald-400">Items & Invoicing</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setIsAddItemOpen(true)} data-testid="billing-add-items">
              <ShoppingCart className="w-3.5 h-3.5 mr-2 text-cyan-400" />Add Billable Items
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsKitPickerOpen(true)} data-testid="billing-kit-picker">
              <Boxes className="w-3.5 h-3.5 mr-2 text-amber-400" />Apply Kit
            </DropdownMenuItem>
            {ticketProducts.length > 0 && (
              <DropdownMenuItem
                onClick={() => {
                  setInvoicesList([]);
                  axios.get(`${API}/invoices`, { headers }).then(r => setInvoicesList(r.data)).catch(() => {});
                  setIsPushInvoiceOpen(true);
                }}
                data-testid="billing-push-invoice"
              >
                <Receipt className="w-3.5 h-3.5 mr-2 text-green-400" />Push to Invoice ({ticketProducts.length})
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleAutoQuote} data-testid="billing-auto-quote">
              <Sparkles className="w-3.5 h-3.5 mr-2 text-emerald-400" />Auto-Generate Quote
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Hot buttons */}
        <Button variant="outline" size="sm" className="h-8" onClick={() => setIsEmailOpen(true)} data-testid="send-email-btn">
          <Mail className="w-3.5 h-3.5 mr-1" />Email
        </Button>
        <Button variant="outline" size="sm" className="h-8" onClick={handleDownloadPdf} data-testid="download-pdf-btn">
          <Download className="w-3.5 h-3.5 mr-1" />PDF
        </Button>
        <WhyOnFireButton entityType="ticket" entityId={viewingTicket.id} />
      </div>
    </div>
  );
}
