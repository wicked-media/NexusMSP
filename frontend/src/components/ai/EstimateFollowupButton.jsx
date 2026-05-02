import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { MailPlus, Loader2, Copy, Sparkles } from "lucide-react";
import { toast } from "sonner";

/**
 * Button on estimate detail header → generates an AI-drafted follow-up email
 * tailored to the most likely client objection (price / scope / timing).
 */
export function EstimateFollowupButton({ estimateId, estimateNumber }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(null);

  const generate = async () => {
    setLoading(true);
    setDraft(null);
    try {
      const r = await axios.post(
        `${API}/estimates/${estimateId}/followup-draft`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setDraft(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const copyEmail = () => {
    if (!draft) return;
    const text = `Subject: ${draft.subject || ""}\n\n${draft.body || ""}`;
    navigator.clipboard.writeText(text).then(() => toast.success("Copied to clipboard"));
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
        onClick={() => { setOpen(true); if (!draft) generate(); }}
        data-testid={`estimate-followup-btn-${estimateId}`}
      >
        <MailPlus className="w-3.5 h-3.5 mr-1" />Follow-up AI
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" data-testid="estimate-followup-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />AI Follow-up Draft
              {estimateNumber && <span className="text-xs text-muted-foreground font-mono ml-2">{estimateNumber}</span>}
            </DialogTitle>
          </DialogHeader>

          {loading && (
            <div className="py-10 flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
              Analysing conversation & drafting email…
            </div>
          )}

          {!loading && draft && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                {draft.likely_objection && (
                  <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/5">
                    Likely objection: {draft.likely_objection}
                  </Badge>
                )}
                {typeof draft.days_since_sent === "number" && (
                  <Badge variant="outline" className="text-muted-foreground">
                    {draft.days_since_sent} days since sent
                  </Badge>
                )}
                {draft.tone && (
                  <Badge variant="outline" className="text-violet-400 border-violet-500/30">
                    Tone: {draft.tone}
                  </Badge>
                )}
              </div>

              <div className="border border-border/60 rounded-md p-3 bg-muted/20">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Subject</div>
                <div className="text-sm font-medium" data-testid="followup-subject">{draft.subject}</div>
              </div>

              <div className="border border-border/60 rounded-md p-3 bg-muted/20 whitespace-pre-wrap text-sm leading-relaxed" data-testid="followup-body">
                {draft.body}
              </div>

              {draft.cta && (
                <div className="text-xs text-muted-foreground">
                  <span className="text-violet-400 font-semibold">Suggested CTA:</span> {draft.cta}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            {draft && !loading && (
              <>
                <Button variant="outline" onClick={generate} data-testid="followup-regen">
                  <Sparkles className="w-3.5 h-3.5 mr-1" />Regenerate
                </Button>
                <Button
                  variant="outline"
                  className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
                  onClick={copyEmail}
                  data-testid="followup-copy"
                >
                  <Copy className="w-3.5 h-3.5 mr-1" />Copy Email
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
