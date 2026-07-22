import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ScanLine, Loader2, Plus, Camera, FileText, CheckCircle } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";

export default function DocScannerPage() {
  const { token } = useAuth();
  const [scanText, setScanText] = useState("");
  const [scanType, setScanType] = useState("general");
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [history, setHistory] = useState([]);
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState("");
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/doc-scanner/history`, { headers }).then(r => setHistory(r.data)).catch(() => {});
    axios.get(`${API}/clients`, { headers }).then(r => {
      const list = Array.isArray(r.data) ? r.data : r.data.clients || [];
      setClients(list);
    }).catch(() => {});
  }, [token]);

  const runScan = async () => {
    if (!scanText.trim()) { toast.error("Enter text to scan"); return; }
    setScanning(true);
    try {
      const res = await axios.post(`${API}/doc-scanner/scan`, { image: scanText, type: scanType }, { headers });
      setResult(res.data.result);
      toast.success("Scan complete!");
    } catch { toast.error("Scan failed"); }
    finally { setScanning(false); }
  };

  const createDevice = async () => {
    if (!result) return;
    try {
      const res = await axios.post(`${API}/doc-scanner/create-device`, { scan_result: result, client_id: selectedClient }, { headers });
      toast.success(`Device "${res.data.hostname}" created!`);
      setResult(null);
      setScanText("");
    } catch { toast.error("Failed to create device"); }
  };

  return (
    <div className="space-y-5" data-testid="doc-scanner-page">
      <OperationalPageHeader eyebrow="Asset intelligence" title="Document Scanner" description="Extract asset details from labels, warranties, and stickers, then create an assigned device record." icon={ScanLine} tone="sky" />

      <div className="grid grid-cols-2 gap-4">
        {/* Input */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Camera className="w-4 h-4 text-teal-400" />Scan Input</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Select value={scanType} onValueChange={setScanType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="general">General Label</SelectItem>
                <SelectItem value="warranty">Warranty Sticker</SelectItem>
                <SelectItem value="serial">Serial Number</SelectItem>
                <SelectItem value="label">Asset Label</SelectItem>
              </SelectContent>
            </Select>
            <Textarea value={scanText} onChange={e => setScanText(e.target.value)} rows={8}
              placeholder="Paste text from a warranty sticker, serial number plate, or asset label. Example:
              
Dell PowerEdge R740
S/N: FGHJ9K2
Service Tag: ABC1234
Model: R740xd
Warranty: 2024-01-01 to 2027-01-01
192.168.1.100" data-testid="scan-input" />
            <Button onClick={runScan} disabled={scanning} className="w-full" data-testid="scan-btn">
              {scanning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ScanLine className="w-4 h-4 mr-1" />}
              Scan & Extract
            </Button>
          </CardContent>
        </Card>

        {/* Result */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4 text-blue-400" />Extracted Data</CardTitle></CardHeader>
          <CardContent>
            {!result ? (
              <div className="text-center py-12"><ScanLine className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-30" /><p className="text-muted-foreground text-sm">Scan results will appear here</p></div>
            ) : (
              <div className="space-y-3">
                {Object.entries(result).filter(([k]) => k !== "confidence").map(([key, value]) => (
                  value && (
                    <div key={key} className="flex justify-between text-sm">
                      <span className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}</span>
                      <span className="font-medium">{String(value)}</span>
                    </div>
                  )
                ))}
                {result.confidence && (
                  <Badge className={result.confidence > 0.7 ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}>
                    Confidence: {Math.round(result.confidence * 100)}%
                  </Badge>
                )}
                <div className="pt-2 space-y-2">
                  <Select value={selectedClient} onValueChange={setSelectedClient}>
                    <SelectTrigger><SelectValue placeholder="Assign to client..." /></SelectTrigger>
                    <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button onClick={createDevice} className="w-full" data-testid="create-device-from-scan">
                    <Plus className="w-4 h-4 mr-1" />Create Device from Scan
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* History */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Scans</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {history.slice(0, 10).map((h, i) => (
              <div key={`k-${i}`} className="flex items-center justify-between p-2 bg-muted/20 rounded text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-emerald-400" />
                  <span>{h.result?.hostname || h.result?.model || "Scan"}</span>
                  <Badge variant="outline" className="text-[10px]">{h.scan_type}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">{h.scanned_at?.slice(0, 16)} by {h.scanned_by}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
