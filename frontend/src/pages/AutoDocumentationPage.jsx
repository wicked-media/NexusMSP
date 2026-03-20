import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Network, HardDrive, Shield } from "lucide-react";
import { toast } from "sonner";

export default function AutoDocumentationPage() {
  const { token } = useAuth();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try { const res = await axios.get(`${API}/auto-documentation/documents`, { headers }); setDocs(res.data); } catch (e) { toast.error("Failed"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const typeIcon = { network_diagram: <Network className="w-5 h-5" />, asset_inventory: <HardDrive className="w-5 h-5" />, disaster_recovery: <Shield className="w-5 h-5" /> };

  return (
    <div className="space-y-6" data-testid="auto-documentation-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Auto-Documentation Generator</h1><p className="text-muted-foreground text-sm mt-1">AI-generated IT documentation from device scans</p></div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { type: "network_diagram", icon: <Network className="w-8 h-8 text-blue-500" />, title: "Network Diagram", desc: "Auto-generate from device discovery" },
          { type: "asset_inventory", icon: <HardDrive className="w-8 h-8 text-emerald-500" />, title: "Asset Inventory", desc: "Complete asset register with specs" },
          { type: "disaster_recovery", icon: <Shield className="w-8 h-8 text-amber-500" />, title: "DR Plan", desc: "AI-generated disaster recovery plan" },
        ].map(t => (
          <Card key={t.type} className="hover:border-primary/50 transition-colors cursor-pointer" data-testid={`gen-${t.type}`}>
            <CardContent className="pt-5 text-center">{t.icon}<h3 className="font-bold mt-2">{t.title}</h3><p className="text-xs text-muted-foreground mt-1">{t.desc}</p></CardContent>
          </Card>
        ))}
      </div>

      <Card><CardHeader><CardTitle className="text-lg">Generated Documents</CardTitle></CardHeader>
        <CardContent><div className="space-y-3">{docs.map(d => (
          <div key={d.id} className="p-4 rounded-lg border" data-testid={`doc-${d.id}`}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">{typeIcon[d.doc_type] || <FileText className="w-5 h-5" />}
                <div><h3 className="font-semibold text-sm">{d.title}</h3><p className="text-xs text-muted-foreground">{d.client_name} | {d.description}</p><p className="text-xs text-muted-foreground mt-1">Generated: {new Date(d.generated_at).toLocaleDateString()}</p></div>
              </div>
              <Badge variant={d.status === "completed" ? "default" : "secondary"}>{d.status}</Badge>
            </div>
            {d.sections && <div className="flex flex-wrap gap-1 mt-2">{d.sections.map(s => <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>)}</div>}
          </div>
        ))}</div></CardContent>
      </Card>
    </div>
  );
}
