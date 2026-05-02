import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, Copy, Sparkles } from "lucide-react";
import { toast } from "sonner";

/**
 * Button on invoice detail header → generates a plain-English, non-technical
 * explainer of what the invoice covers (useful to paste into a client email).
 */
export function InvoiceExplainerButton({ invoiceId, invoiceNumber }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  const generate = async () => {
    setLoading(true);
    setData(null);
    try {
      const r = await axios.get(
        `${API}/invoices/${invoiceId}/explainer`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setData(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const copyExplainer = () => {
    if (!data?.summary) return;
    navigator.clipboard.writeText(data.summary).then(() => toast.success("Copied to clipboard"));
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
        onClick={() => { setOpen(true); if (!data) generate(); }}
        data-testid={`invoice-explainer-btn-${invoiceId}`}
      >
        <FileText className="w-3.5 h-3.5 mr-1" />Explain It
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl" data-testid="invoice-explainer-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-sky-400" />Invoice Explainer
              {invoiceNumber && <span className="text-xs text-muted-foreground font-mono ml-2">{invoiceNumber}</span>}
            </DialogTitle>
          </DialogHeader>

          {loading && (
            <div className="py-10 flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
              Summarising the work covered on this invoice…
            </div>
          )}

          {!loading && data && (
            <div className="space-y-3">
              {data.stats && (
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <Badge variant="outline" className="text-sky-400 border-sky-500/30">
                    {data.stats.tickets} tickets
                  </Badge>
                  {data.stats.critical > 0 && (
                    <Badge variant="outline" className="text-rose-400 border-rose-500/30">
                      {data.stats.critical} critical
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-muted-foreground">
                    {data.stats.devices} devices managed
                  </Badge>
                  <Badge variant="outline" className="text-muted-foreground">
                    {data.stats.period_start} → {data.stats.period_end}
                  </Badge>
                </div>
              )}
              <div className="border border-border/60 rounded-md p-4 bg-muted/20 text-sm leading-relaxed whitespace-pre-wrap" data-testid="invoice-explainer-body">
                {data.summary}
              </div>
              <p className="text-[11px] text-muted-foreground italic">
                Written in plain English — safe to paste directly into a client-facing email.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            {data && !loading && (
              <>
                <Button variant="outline" onClick={generate} data-testid="explainer-regen">
                  <Sparkles className="w-3.5 h-3.5 mr-1" />Regenerate
                </Button>
                <Button
                  variant="outline"
                  className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
                  onClick={copyExplainer}
                  data-testid="explainer-copy"
                >
                  <Copy className="w-3.5 h-3.5 mr-1" />Copy
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
