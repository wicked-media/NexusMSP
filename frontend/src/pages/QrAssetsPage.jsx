import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { QrCode, Printer, Loader2, RefreshCw } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";

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
          <OperationalPageHeader
            eyebrow="Inventory controls"
            title="QR Asset Tags"
            description={`${labels.length} inventory label${labels.length === 1 ? "" : "s"}. Scan a tag to open its tracked asset record.`}
            icon={QrCode}
            tone="sky"
            actions={<><Button variant="outline" size="sm" onClick={fetchLabels}><RefreshCw className="w-4 h-4 mr-1" />Refresh labels</Button><Button size="sm" onClick={printSheet} data-testid="print-qr-btn"><Printer className="w-4 h-4 mr-1" />Print labels</Button></>}
          />

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {labels.map(l => (
              <Card key={l.id} className="text-center hover:border-sky-500/30 transition-all">
                <CardContent className="pt-4 space-y-2">
                  <img src={l.qr_image} alt={l.asset_tag} className="w-24 h-24 mx-auto" />
                  <div>
                    <p className="text-sm font-bold truncate">{l.asset_tag}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{l.name}</p>
                    <p className="text-[10px] text-muted-foreground capitalize truncate">{l.asset_type} | {l.client_name}</p>
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
              <img src={l.qr_image} alt={l.asset_tag} style={{ width: 100, height: 100, margin: "0 auto" }} />
              <p style={{ fontSize: 10, fontWeight: "bold", marginTop: 4 }}>{l.asset_tag}</p>
              <p style={{ fontSize: 8, color: "#666" }}>{l.name}</p>
              <p style={{ fontSize: 8, color: "#666" }}>{l.asset_type} | {l.client_name}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
