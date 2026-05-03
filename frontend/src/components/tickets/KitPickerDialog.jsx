import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Boxes, Zap } from "lucide-react";

/**
 * Kit Picker — Apply a product bundle (New Hire Setup, etc) to a ticket in 1 click.
 * Calls POST /api/tickets/{id}/apply-kit/{kit_id} — attaches all kit products as ticket items.
 */
export default function KitPickerDialog({ open, onClose, ticketId, token, onApplied }) {
  const [kits, setKits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    axios.get(`${API}/product-kits`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setKits(r.data?.kits || []))
      .catch(() => setKits([]))
      .finally(() => setLoading(false));
  }, [open, token]);

  const apply = async (kit) => {
    setApplying(kit.id);
    try {
      const r = await axios.post(`${API}/tickets/${ticketId}/apply-kit/${kit.id}`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      onApplied?.(r.data, kit);
      onClose();
    } finally {
      setApplying(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" data-testid="kit-picker-dialog">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Boxes className="w-4 h-4 text-emerald-400" />Apply a kit
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {loading && <div className="py-10 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>}
          {!loading && kits.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No kits yet. Create them at <a href="/finance-intel" className="text-emerald-400 hover:underline">Finance Intel → Kits</a>.
            </div>
          )}
          {kits.map((k) => (
            <Card key={k.id} data-testid={`kit-option-${k.id}`}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{k.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{k.description}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                    <span>{(k.items || []).length} items</span>
                    {k.labor_hours > 0 && <span>· {k.labor_hours}h labor</span>}
                    <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 text-[10px]">{k.margin_pct}% margin</Badge>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">${Number(k.total_retail || 0).toLocaleString()}</div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                    onClick={() => apply(k)}
                    disabled={applying === k.id}
                    data-testid={`apply-kit-${k.id}`}
                  >
                    {applying === k.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Zap className="w-3 h-3 mr-1" />Apply</>}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
