import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, X, DollarSign } from "lucide-react";

/**
 * Finance Intel — auto-surfaces a nudge when a ticket scores >=50 on quote-worthiness.
 * Signals: comment count, time logged, project-keywords in title/description.
 * Pulls `/api/tickets/{id}/quote-nudge` on mount.
 */
export default function QuoteNudgeBanner({ ticketId, token, onQuoteCreated }) {
  const [data, setData] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!ticketId || !token) return;
    axios.post(`${API}/tickets/${ticketId}/quote-nudge`, {}, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => setData(r.data)).catch(() => {});
    setDismissed(false);
  }, [ticketId, token]);

  if (dismissed || !data || !data.should_quote) return null;

  const sendQuote = async () => {
    setCreating(true);
    try {
      const r = await axios.post(`${API}/tickets/${ticketId}/auto-quote`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setDismissed(true);
      onQuoteCreated?.(r.data);
    } catch (e) {
      // fall through silently
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card className="border-emerald-500/40 bg-emerald-500/5" data-testid="quote-nudge-banner">
      <CardContent className="p-3 flex items-center gap-3 flex-wrap">
        <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-emerald-200">Scope is expanding — time to quote</div>
          <div className="text-xs text-muted-foreground">
            Score <span className="text-emerald-300 font-mono">{data.score}/100</span>
            {data.signals?.length > 0 && (
              <> · {data.signals.join(" · ")}</>
            )}
          </div>
          {data.suggestion && <div className="text-xs text-muted-foreground italic mt-0.5">{data.suggestion}</div>}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
            disabled={creating}
            onClick={sendQuote}
            data-testid="nudge-quote-btn"
          >
            <DollarSign className="w-3 h-3 mr-1" />{creating ? "Drafting…" : "Draft quote now"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)} data-testid="nudge-dismiss"><X className="w-3 h-3" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}
