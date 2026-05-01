import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

/** Button on invoice detail → modal to record a spoken payment promise. */
export function PaymentPromiseButton({ invoiceId }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [by, setBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const save = async () => {
    if (!text.trim()) { toast.error("Describe the promise"); return; }
    setSaving(true);
    try {
      const r = await axios.post(`${API}/invoices/${invoiceId}/promises`, { text, promised_by: by }, { headers: { Authorization: `Bearer ${token}` } });
      setResult(r.data);
      toast.success(r.data.promised_date ? `Promise recorded for ${r.data.promised_date}` : "Promise recorded");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  return (
    <>
      <Button
        variant="outline" size="sm"
        className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
        onClick={() => { setOpen(true); setResult(null); setText(""); setBy(""); }}
        data-testid={`promise-btn-${invoiceId}`}
      >
        <Plus className="w-3.5 h-3.5 mr-1" />Payment Promise
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="promise-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Calendar className="w-4 h-4 text-violet-400" />Record Payment Promise</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">What did the client say?</Label>
              <Textarea
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. 'They said they'll pay by Friday via bank transfer'"
                data-testid="promise-text"
              />
            </div>
            <div>
              <Label className="text-xs">Promised by (optional)</Label>
              <Input value={by} onChange={(e) => setBy(e.target.value)} placeholder="John from accounts" data-testid="promise-by" />
            </div>
            {result && (
              <div className="bg-violet-500/5 border border-violet-500/20 rounded-md p-3 text-xs space-y-1">
                <div>Extracted date: <Badge variant="outline" className="text-violet-400 border-violet-500/30 ml-1">{result.promised_date || "not specified"}</Badge></div>
                <div>Confidence: {result.confidence} · Method: {result.method}</div>
                <div className="text-muted-foreground italic">"{result.raw_text}"</div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            {!result && (
              <Button onClick={save} disabled={saving || !text.trim()} variant="outline" className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10" data-testid="promise-save">
                {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}Extract & Save
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
