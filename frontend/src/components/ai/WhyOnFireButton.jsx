import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Flame, Loader2, AlertTriangle, ChevronRight } from "lucide-react";

const SEV_TONE = {
  critical: "text-rose-400 border-rose-500/30 bg-rose-500/10",
  high: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  medium: "text-sky-400 border-sky-500/30 bg-sky-500/10",
  low: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
};

/** Small button that opens an AI-powered "Why is this on fire?" diagnosis modal. */
export function WhyOnFireButton({ entityType, entityId, label = "Why on fire?" }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  const fire = async () => {
    setOpen(true); setLoading(true); setData(null);
    try {
      const r = await axios.post(`${API}/ai/why-on-fire/${entityType}/${entityId}`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setData(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); setOpen(false); }
    finally { setLoading(false); }
  };

  return (
    <>
      <Button
        variant="outline" size="sm"
        className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
        onClick={fire}
        data-testid={`why-on-fire-${entityType}-${entityId}`}
      >
        <Flame className="w-3.5 h-3.5 mr-1" />{label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl" data-testid="why-on-fire-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-rose-400" />
              Why is this on fire?
              {data?.severity && (
                <Badge variant="outline" className={SEV_TONE[data.severity] || ""}>
                  {data.severity.toUpperCase()}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {loading || !data ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
              Reading the last 24h of telemetry…
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Diagnosis</div>
                <div className="text-sm text-foreground/90">{data.diagnosis}</div>
              </div>
              {data.likely_root_cause && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Likely root cause</div>
                  <div className="text-sm text-amber-300">{data.likely_root_cause}</div>
                </div>
              )}
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Next steps</div>
                <div className="space-y-1">
                  {(data.next_steps || []).map((step, i) => (
                    <div key={i} className="flex gap-2 items-start bg-muted/30 rounded p-2 text-sm">
                      <ChevronRight className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-zinc-800 pt-2">
                <span><AlertTriangle className="w-3 h-3 inline mr-1" />Confidence: {data.confidence}</span>
                <span>{new Date(data.generated_at).toLocaleTimeString()}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
