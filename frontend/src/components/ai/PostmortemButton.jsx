import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { FileText, Loader2, CheckCircle2, XCircle, User } from "lucide-react";

/** Button that generates and displays an auto-postmortem for a resolved war room. */
export function PostmortemButton({ warRoomId }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pm, setPm] = useState(null);

  const generate = async () => {
    setOpen(true); setLoading(true); setPm(null);
    try {
      const r = await axios.post(`${API}/warroom/${warRoomId}/postmortem`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setPm(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); setOpen(false); }
    finally { setLoading(false); }
  };

  return (
    <>
      <Button
        variant="outline" size="sm"
        className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
        onClick={generate}
        data-testid="postmortem-btn"
      >
        <FileText className="w-3.5 h-3.5 mr-1" />Generate Postmortem
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="postmortem-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-sky-400" /> Incident Postmortem
              {pm?.severity && <Badge variant="outline" className="text-[9px]">{pm.severity}</Badge>}
            </DialogTitle>
          </DialogHeader>
          {loading || !pm ? (
            <div className="py-12 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Reading timeline…</div>
          ) : (
            <div className="space-y-4">
              <Section title="Summary">{pm.summary}</Section>
              <Section title="Timeline">
                <div className="space-y-1">
                  {(pm.timeline || []).map((t, i) => (
                    <div key={i} className="flex gap-2 text-xs bg-muted/30 rounded px-2 py-1">
                      <span className="font-mono text-muted-foreground flex-shrink-0">{String(t.ts || "").slice(11, 19)}</span>
                      <span>{t.event}</span>
                    </div>
                  ))}
                </div>
              </Section>
              <Section title="Root Cause" tone="amber">{pm.root_cause}</Section>
              <Section title="Impact">{pm.impact}</Section>
              <div className="grid grid-cols-2 gap-3">
                <Section title="What went well" tone="emerald">
                  <ul className="space-y-1">{(pm.what_went_well || []).map((w, i) => <li key={i} className="flex items-start gap-1 text-xs"><CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0 mt-0.5" />{w}</li>)}</ul>
                </Section>
                <Section title="What went poorly" tone="rose">
                  <ul className="space-y-1">{(pm.what_went_poorly || []).map((w, i) => <li key={i} className="flex items-start gap-1 text-xs"><XCircle className="w-3 h-3 text-rose-400 flex-shrink-0 mt-0.5" />{w}</li>)}</ul>
                </Section>
              </div>
              <Section title="Action Items">
                <div className="space-y-1">
                  {(pm.action_items || []).map((a, i) => (
                    <div key={i} className="flex items-center gap-2 bg-muted/30 rounded px-2 py-1.5 text-xs">
                      <Badge variant="outline" className="text-[9px]">{a.priority || "—"}</Badge>
                      <User className="w-3 h-3 text-muted-foreground" />
                      <span className="font-medium">{a.owner || "unassigned"}:</span>
                      <span className="flex-1">{a.task}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Section({ title, children, tone }) {
  const col = tone ? { amber: "text-amber-400", emerald: "text-emerald-400", rose: "text-rose-400" }[tone] : "text-muted-foreground";
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-widest mb-1 ${col}`}>{title}</div>
      <div className="text-sm text-foreground/90">{children}</div>
    </div>
  );
}
