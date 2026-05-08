import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Siren, Loader2 } from "lucide-react";

const REASONS = [
  { value: "outage", label: "🚨 Outage / War Room" },
  { value: "p1", label: "🔥 P1 Incident" },
  { value: "audit", label: "📋 Compliance / Audit" },
  { value: "vip", label: "⭐ VIP Client" },
  { value: "training", label: "🎓 Training / Demo" },
  { value: "other", label: "📌 Other" },
];

/**
 * Better UX than window.prompt. Captures reason + note when team-pinning a ticket.
 */
export default function TeamPinDialog({ open, onOpenChange, ticketTitle, onConfirm }) {
  const [reason, setReason] = useState("outage");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setReason("outage");
      setNote("");
      setBusy(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm({ reason, note });
      onOpenChange(false);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Siren className="w-5 h-5 text-rose-400 animate-pulse" />
            Pin for Team — NOC Strip
          </DialogTitle>
          <DialogDescription>
            Pinning <span className="font-mono">{ticketTitle}</span> will surface it on every team member's Dashboard until you (or an admin) unpin it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger data-testid="team-pin-reason"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Note (optional, shown to team)</Label>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. 'War room — DNS failure across NZ region'"
              data-testid="team-pin-note"
              maxLength={300}
            />
            <p className="text-[10px] text-muted-foreground mt-0.5 text-right">{note.length}/300</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            className="bg-rose-600 hover:bg-rose-700"
            onClick={handleConfirm}
            disabled={busy}
            data-testid="team-pin-confirm"
          >
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Siren className="w-4 h-4 mr-2" />}
            Pin for Team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
