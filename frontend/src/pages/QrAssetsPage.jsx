import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { QrCode, Printer, Loader2, RefreshCw, Monitor, Download } from "lucide-react";

export default function QrAssetsPage() {
  const { token } = useAuth();
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [printMode, setPrintMode] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchLabels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/qr-assets/generate-batch`, { headers });
      setLabels(res.data);
    } catch { toast.error("Failed to generate QR codes"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchLabels(); }, [fetchLabels]);

  const printSheet = () => {
    setPrintMode(true);
    setTimeout(() => { window.print(); setPrintMode(false); }, 500);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="qr-assets-page">
      {!printMode && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><QrCode className="w-8 h-8 text-green-400" />QR Asset Tags</h1>
              <p className="text-muted-foreground">{labels.length} devices &middot; Scan to view device details</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={fetchLabels}><RefreshCw className="w-4 h-4 mr-1" />Regenerate</Button>
              <Button onClick={printSheet} data-testid="print-qr-btn"><Printer className="w-4 h-4 mr-1" />Print Sheet</Button>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-3">
            {labels.map(l => (
              <Card key={l.id} className="text-center hover:border-green-500/20 transition-all">
                <CardContent className="pt-4 space-y-2">
                  <img src={l.qr_image} alt={l.hostname} className="w-24 h-24 mx-auto" />
                  <div>
                    <p className="text-sm font-bold truncate">{l.hostname}</p>
                    <p className="text-[10px] text-muted-foreground">{l.type} &middot; {l.client}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Print-friendly layout */}
      {printMode && (
        <div className="print-sheet" style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 16 }}>
          {labels.map(l => (
            <div key={l.id} style={{ width: 160, border: "1px solid #ccc", padding: 8, textAlign: "center", pageBreakInside: "avoid" }}>
              <img src={l.qr_image} alt={l.hostname} style={{ width: 100, height: 100, margin: "0 auto" }} />
              <p style={{ fontSize: 10, fontWeight: "bold", marginTop: 4 }}>{l.hostname}</p>
              <p style={{ fontSize: 8, color: "#666" }}>{l.type}</p>
              <p style={{ fontSize: 8, color: "#666" }}>{l.client}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
