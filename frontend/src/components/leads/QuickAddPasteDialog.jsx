/* QuickAddPasteDialog.jsx — paste an email signature/about page → AI parses into lead fields. */
import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, ClipboardPaste, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function QuickAddPasteDialog({ open, onClose, onParsed }) {
  const { token } = useAuth();
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);

  const parse = async () => {
    if (!text.trim()) return;
    setParsing(true);
    try {
      const r = await axios.post(`${API}/lead-studio/quick-parse`, { text }, { headers: { Authorization: `Bearer ${token}` } });
      onParsed && onParsed(r.data);
      toast.success("Parsed — review and save the new lead");
      onClose && onClose();
      setText("");
    } catch {
      toast.error("Failed to parse");
    } finally { setParsing(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose && onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] gap-0 overflow-hidden border-violet-500/25 p-0">
        <DialogHeader className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.18),transparent_42%),linear-gradient(135deg,rgba(23,27,38,0.98),rgba(10,12,17,0.98))] px-6 py-5 pr-14">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-500/10">
              <ClipboardPaste className="h-5 w-5 text-violet-300" />
            </div>
            <div className="space-y-1">
              <DialogTitle>Quick add by paste</DialogTitle>
              <DialogDescription>
                Turn an email signature, referral note, LinkedIn snippet, or company profile into a structured lead ready for review.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-4 overflow-y-auto px-6 py-5 md:grid-cols-[1fr_230px]">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
            <div className="mb-3">
              <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-violet-300">Source material</p>
              <p className="mt-1 text-[11px] text-zinc-500">Paste the original text exactly as received. You will review every extracted field before saving.</p>
            </div>
            <Textarea
              rows={12}
              autoFocus
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={`Sarah Reynolds\nCTO, Brightleaf\nsarah@brightleaf.com.au\n+61 411 234 567\nbrightleaf.com.au`}
              className="min-h-72 resize-y text-xs font-mono leading-relaxed"
              data-testid="quick-add-text"
            />
          </div>

          <aside className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] p-4">
            <Sparkles className="h-5 w-5 text-violet-300" />
            <h3 className="mt-3 text-sm font-semibold text-zinc-100">What Nexus extracts</h3>
            <div className="mt-3 space-y-2">
              {["Company and contact", "Email and phone", "Website and role", "Useful context notes"].map(item => (
                <div key={item} className="flex items-center gap-2 text-[11px] text-zinc-400">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 rounded-xl border border-amber-500/15 bg-amber-500/[0.05] p-3 text-[10px] leading-relaxed text-amber-100/70">
              Nothing is created automatically. Parsed details open in the full lead workflow for technician confirmation.
            </p>
          </aside>
        </div>

        <DialogFooter className="items-center gap-3 border-t border-white/[0.08] bg-black/20 px-6 py-4 sm:justify-between sm:space-x-0">
          <p className="text-left text-[11px] text-zinc-500">{text.trim() ? `${text.trim().length} characters ready to parse` : "Paste source text to continue."}</p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={parsing}>Cancel</Button>
            <Button onClick={parse} disabled={!text.trim() || parsing} className="min-w-36 bg-violet-600 hover:bg-violet-500" data-testid="quick-add-parse-btn">
              {parsing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
              Parse and review
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
