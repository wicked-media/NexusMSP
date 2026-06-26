/* QuickAddPasteDialog.jsx — paste an email signature/about page → AI parses into lead fields. */
import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-300" />Quick Add by Paste</DialogTitle>
        </DialogHeader>
        <p className="text-[11px] text-zinc-400">Paste an email signature, LinkedIn snippet, or about page &mdash; we&apos;ll extract name, email, phone, website, title.</p>
        <Textarea
          rows={10}
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={`Sarah Reynolds\nCTO, Brightleaf\nsarah@brightleaf.com.au\n+61 411 234 567\nbrightleaf.com.au`}
          className="text-xs font-mono"
          data-testid="quick-add-text"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={parsing}>Cancel</Button>
          <Button onClick={parse} disabled={!text.trim() || parsing} className="bg-violet-600 hover:bg-violet-500" data-testid="quick-add-parse-btn">
            {parsing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
            Parse & open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
