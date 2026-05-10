import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Workflow, Link2, GitBranch, CalendarClock, Star, X, Loader2, Search, ShieldAlert,
} from "lucide-react";
import { API } from "@/App";

/** Workflow polish: Block-on chain · Convert to change · Maintenance window · Send CSAT */
export default function TicketWorkflowPanel({ ticket, allTickets, headers, refresh }) {
  const [confirm, setConfirm] = useState(null); // "block" | "change" | "maint" | "csat"
  const [busy, setBusy] = useState(false);

  // Block-on state
  const [blockSearch, setBlockSearch] = useState("");
  const blockOptions = useMemo(() => {
    if (!blockSearch.trim()) return (allTickets || []).filter(t => t.id !== ticket.id).slice(0, 8);
    const q = blockSearch.toLowerCase();
    return (allTickets || []).filter(t => t.id !== ticket.id && (
      (t.ticket_number || "").toLowerCase().includes(q) ||
      (t.title || "").toLowerCase().includes(q)
    )).slice(0, 8);
  }, [allTickets, blockSearch, ticket.id]);

  // Convert-to-change state
  const [changeRisk, setChangeRisk] = useState("medium");
  const [changeStart, setChangeStart] = useState("");
  const [changeDuration, setChangeDuration] = useState(60);

  // Maintenance state
  const [maintStart, setMaintStart] = useState("");
  const [maintDuration, setMaintDuration] = useState(60);
  const [maintNotes, setMaintNotes] = useState("");
  const [maintWindow, setMaintWindow] = useState(null);

  useEffect(() => {
    if (!ticket?.id) return;
    let alive = true;
    axios.get(`${API}/tickets/${ticket.id}/maintenance-window`, { headers })
      .then(r => alive && setMaintWindow(r.data || null))
      .catch(() => {});
    return () => { alive = false; };
  }, [ticket?.id, headers]);

  const close = () => { setConfirm(null); setBlockSearch(""); };

  const blockOn = async (blockingTicket) => {
    setBusy(true);
    try {
      await axios.post(`${API}/tickets/${ticket.id}/block-on`, { blocking_ticket_id: blockingTicket.id }, { headers });
      toast.success(`Blocked by ${blockingTicket.ticket_number}`);
      refresh?.();
      close();
    } catch (e) { toast.error(e.response?.data?.detail || "Block failed"); }
    finally { setBusy(false); }
  };

  const unblock = async () => {
    setBusy(true);
    try {
      await axios.delete(`${API}/tickets/${ticket.id}/block-on`, { headers });
      toast.success("Unblocked");
      refresh?.();
    } catch (e) { toast.error("Unblock failed"); }
    finally { setBusy(false); }
  };

  const convertToChange = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tickets/${ticket.id}/convert-to-change`, {
        risk: changeRisk,
        planned_start: changeStart || null,
        planned_duration_min: Number(changeDuration) || 60,
      }, { headers });
      toast.success("Converted to change request");
      refresh?.();
      close();
    } catch (e) { toast.error(e.response?.data?.detail || "Convert failed"); }
    finally { setBusy(false); }
  };

  const scheduleMaint = async () => {
    if (!maintStart) { toast.error("Pick a start time"); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API}/tickets/${ticket.id}/schedule-maintenance`, {
        start: new Date(maintStart).toISOString(),
        duration_min: Number(maintDuration) || 60,
        notes: maintNotes,
      }, { headers });
      toast.success("Maintenance window scheduled");
      setMaintWindow(r.data?.window || null);
      refresh?.();
      close();
    } catch (e) { toast.error(e.response?.data?.detail || "Schedule failed"); }
    finally { setBusy(false); }
  };

  const sendCsat = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/tickets/${ticket.id}/send-csat`, {}, { headers });
      toast.success("CSAT survey logged");
      refresh?.();
      close();
    } catch (e) { toast.error(e.response?.data?.detail || "Send failed"); }
    finally { setBusy(false); }
  };

  const isChange = ticket.category === "change";
  const blockedBy = ticket.blocked_by_ticket_number;

  return (
    <>
      <Card data-testid="ticket-workflow-panel" className="border-amber-500/15">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Workflow className="w-4 h-4 text-amber-400" />Workflow
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {/* Block-on status */}
          {blockedBy ? (
            <div className="flex items-center justify-between p-2 rounded-lg border border-rose-500/30 bg-rose-500/[0.05]">
              <div className="flex items-center gap-1.5 min-w-0">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span className="text-[11px] truncate">Blocked by <code className="font-mono">{blockedBy}</code></span>
              </div>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={unblock} disabled={busy} data-testid="workflow-unblock"><X className="w-3 h-3" /></Button>
            </div>
          ) : null}

          {/* Active maintenance window */}
          {maintWindow && (
            <div className="p-2 rounded-lg border border-cyan-500/30 bg-cyan-500/[0.05]">
              <div className="flex items-center gap-1.5 mb-1">
                <CalendarClock className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[11px] font-medium">Maintenance scheduled</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {new Date(maintWindow.start).toLocaleString()} for {maintWindow.duration_min}m
              </p>
            </div>
          )}

          {/* Change indicator */}
          {isChange && (
            <Badge className="bg-purple-500/15 text-purple-300 border-purple-500/30 text-[10px]">
              <GitBranch className="w-2.5 h-2.5 mr-0.5" />Change · {ticket.change_risk || "medium"} risk · {ticket.change_state || "draft"}
            </Badge>
          )}

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-1.5">
            <Button variant="outline" size="sm" className="h-8 text-[11px] justify-start" onClick={() => setConfirm("block")} data-testid="workflow-block-btn">
              <Link2 className="w-3 h-3 mr-1 text-rose-400" />Block on…
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-[11px] justify-start" onClick={() => setConfirm("change")} disabled={isChange} data-testid="workflow-change-btn">
              <GitBranch className="w-3 h-3 mr-1 text-purple-400" />Convert to Change
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-[11px] justify-start" onClick={() => setConfirm("maint")} data-testid="workflow-maint-btn">
              <CalendarClock className="w-3 h-3 mr-1 text-cyan-400" />Maintenance
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-[11px] justify-start" onClick={() => setConfirm("csat")} disabled={ticket.csat_sent} data-testid="workflow-csat-btn">
              <Star className="w-3 h-3 mr-1 text-amber-400" />{ticket.csat_sent ? "CSAT Sent" : "Send CSAT"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Block-on dialog */}
      <Dialog open={confirm === "block"} onOpenChange={v => !v && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 className="w-4 h-4 text-rose-400" />Block this ticket on another</DialogTitle>
            <DialogDescription className="text-xs">Pick a ticket that must be resolved first.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={blockSearch} onChange={e => setBlockSearch(e.target.value)} placeholder="Search ticket number or title…" className="pl-9" autoFocus data-testid="workflow-block-search" />
          </div>
          <div className="max-h-[280px] overflow-auto space-y-1">
            {blockOptions.length === 0 ? <p className="text-xs text-muted-foreground py-4 text-center">No matches</p> : blockOptions.map(t => (
              <button key={t.id} onClick={() => blockOn(t)} className="w-full text-left p-2 rounded hover:bg-muted/40 border border-transparent hover:border-violet-500/30" disabled={busy} data-testid={`workflow-block-pick-${t.id}`}>
                <div className="flex items-center gap-2">
                  <code className="text-[10px] font-mono text-violet-300">{t.ticket_number}</code>
                  <Badge variant="outline" className="text-[9px] capitalize">{t.status}</Badge>
                </div>
                <p className="text-xs truncate mt-0.5">{t.title}</p>
              </button>
            ))}
          </div>
          <DialogFooter><Button variant="ghost" onClick={close}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert-to-change dialog */}
      <Dialog open={confirm === "change"} onOpenChange={v => !v && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-purple-400" />Convert to Change Request</DialogTitle>
            <DialogDescription className="text-xs">This becomes an ITIL-style change with risk + planned window.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Risk</Label>
              <Select value={changeRisk} onValueChange={setChangeRisk}>
                <SelectTrigger data-testid="workflow-change-risk"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Planned start</Label><Input type="datetime-local" value={changeStart} onChange={e => setChangeStart(e.target.value)} data-testid="workflow-change-start" /></div>
              <div><Label className="text-xs">Duration (min)</Label><Input type="number" min={5} value={changeDuration} onChange={e => setChangeDuration(e.target.value)} data-testid="workflow-change-duration" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={convertToChange} disabled={busy} data-testid="workflow-change-confirm">{busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}Convert</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Maintenance window dialog */}
      <Dialog open={confirm === "maint"} onOpenChange={v => !v && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-cyan-400" />Schedule maintenance window</DialogTitle>
            <DialogDescription className="text-xs">Logs a window on the ticket and the linked device.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Start</Label><Input type="datetime-local" value={maintStart} onChange={e => setMaintStart(e.target.value)} data-testid="workflow-maint-start" /></div>
              <div><Label className="text-xs">Duration (min)</Label><Input type="number" min={5} value={maintDuration} onChange={e => setMaintDuration(e.target.value)} data-testid="workflow-maint-duration" /></div>
            </div>
            <div><Label className="text-xs">Notes</Label><Textarea value={maintNotes} onChange={e => setMaintNotes(e.target.value)} rows={3} placeholder="Patching, reboot expected…" data-testid="workflow-maint-notes" /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={scheduleMaint} disabled={busy} data-testid="workflow-maint-confirm">{busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSAT confirm */}
      <Dialog open={confirm === "csat"} onOpenChange={v => !v && close()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Star className="w-4 h-4 text-amber-400" />Send CSAT survey</DialogTitle>
            <DialogDescription className="text-xs">A 1–5 satisfaction survey will be logged for {ticket.contact_email || ticket.requester_email || "the contact"}.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={sendCsat} disabled={busy} data-testid="workflow-csat-confirm">{busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
