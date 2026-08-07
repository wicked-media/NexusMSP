import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import HeroTile from "@/components/HeroTile";
import DOMPurify from "dompurify";
import {
  FileText, Network, HardDrive, Shield, Plus, RefreshCw, Loader2,
  Play, CheckCircle, Clock, Zap, FolderOpen, BarChart3
} from "lucide-react";

const DOC_TYPES = {
  network_diagram: { icon: Network, color: "text-blue-400", bg: "bg-blue-500/10", label: "Network Diagram", desc: "Auto-generate network topology from device discovery" },
  asset_inventory: { icon: HardDrive, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Asset Inventory", desc: "Complete asset register with specs & warranty" },
  disaster_recovery: { icon: Shield, color: "text-amber-400", bg: "bg-amber-500/10", label: "DR Plan", desc: "AI-generated disaster recovery plan" },
  security_baseline: { icon: Shield, color: "text-rose-400", bg: "bg-rose-500/10", label: "Security Baseline", desc: "Endpoint and operational security review" },
  backup_recovery: { icon: RefreshCw, color: "text-cyan-400", bg: "bg-cyan-500/10", label: "Backup & Recovery", desc: "Recovery readiness and validation runbook" },
  operational_handover: { icon: FileText, color: "text-violet-400", bg: "bg-violet-500/10", label: "Operational Handover", desc: "Service transition and escalation baseline" },
  software_licensing: { icon: HardDrive, color: "text-lime-400", bg: "bg-lime-500/10", label: "Software & Licensing", desc: "Managed endpoint software review" },
};
const STATUS_CONFIG = {
  completed: { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", icon: CheckCircle },
  generating: { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", icon: Clock },
  failed: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/30", icon: Shield },
};

export default function AutoDocumentationPage() {
  const { token } = useAuth();
  const [docs, setDocs] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("documents");
  const [showGenerate, setShowGenerate] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [regeneratingId, setRegeneratingId] = useState(null);
  const [upgradingAll, setUpgradingAll] = useState(false);
  const [form, setForm] = useState({ client_name: "", doc_type: "network_diagram", title: "" });
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const requestHeaders = { Authorization: `Bearer ${token}` };
      const [docsRes, clientsRes] = await Promise.all([
        axios.get(`${API}/auto-documentation/documents`, { headers: requestHeaders }),
        axios.get(`${API}/clients`, { headers: requestHeaders }),
      ]);
      setDocs(docsRes.data);
      setClients(clientsRes.data);
    } catch { toast.error("Failed to load documents"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const generateDoc = async (e) => {
    e.preventDefault();
    setGenerating(true);
    try {
      const response = await axios.post(`${API}/auto-documentation/generate`, form, { headers });
      if (response.data?.error) throw new Error(response.data.error);
      toast.success("Document generated from the current inventory");
      setShowGenerate(false);
      setForm({ client_name: "", doc_type: "network_diagram", title: "" });
      fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || error.message || "Failed to generate document"); }
    finally { setGenerating(false); }
  };

  const regenerateDoc = async (documentId) => {
    setRegeneratingId(documentId);
    try {
      const response = await axios.post(`${API}/auto-documentation/documents/${documentId}/regenerate`, {}, { headers });
      if (response.data?.error) throw new Error(response.data.error);
      setSelectedDoc(response.data);
      toast.success("Document refreshed from the current inventory");
      fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || error.message || "Could not refresh this document"); }
    finally { setRegeneratingId(null); }
  };

  const upgradeAllDocuments = async () => {
    setUpgradingAll(true);
    try {
      const response = await axios.post(`${API}/auto-documentation/upgrade-baselines`, {}, { headers });
      toast.success(response.data.message);
      fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not upgrade documents"); }
    finally { setUpgradingAll(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const completedDocs = docs.filter(d => d.status === "completed");
  const byType = Object.keys(DOC_TYPES).map(t => ({ type: t, ...DOC_TYPES[t], count: docs.filter(d => d.doc_type === t).length }));

  return (
    <div className="space-y-5" data-testid="auto-documentation-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center"><FileText className="w-5 h-5 text-white" /></div>
            Auto-Documentation Generator
          </h1>
          <p className="text-muted-foreground mt-1">AI-generated IT documentation from device scans and infrastructure data</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
          <Button onClick={() => setShowGenerate(true)} data-testid="generate-doc-btn"><Plus className="w-4 h-4 mr-2" />Generate Document</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Total Documents", value: docs.length, icon: FileText, color: "text-blue-400" },
          { label: "Completed", value: completedDocs.length, icon: CheckCircle, color: "text-emerald-400" },
          { label: "Clients Covered", value: new Set(docs.map(d => d.client_name)).size, icon: FolderOpen, color: "text-purple-400" },
          { label: "Doc Types", value: new Set(docs.map(d => d.doc_type)).size, icon: BarChart3, color: "text-amber-400" },
        ].map((st, index) => <HeroTile key={st.label} label={st.label} value={st.value} icon={st.icon} glow={["sky", "emerald", "violet", "amber"][index]} />)}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-semibold">Inventory documentation</p><p className="text-xs text-muted-foreground">Generate a baseline now, then validate it against the client’s approved records.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={upgradeAllDocuments} disabled={upgradingAll} data-testid="upgrade-auto-docs">{upgradingAll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Upgrade all</Button><Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button><Button size="sm" onClick={() => setShowGenerate(true)} data-testid="generate-doc-toolbar"><Plus className="w-4 h-4 mr-2" />Generate document</Button></div>
      </div>

      {/* Quick Generate Templates */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {byType.map(t => {
          const Icon = t.icon;
          return (
            <Card key={t.type} className="border-border/40 hover:border-primary/40 transition-colors cursor-pointer group" onClick={() => { setForm({ ...form, doc_type: t.type }); setShowGenerate(true); }} data-testid={`gen-${t.type}`}>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-start gap-3">
                  <div className={`w-12 h-12 rounded-lg ${t.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <Icon className={`w-6 h-6 ${t.color}`} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-sm">{t.label}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
                    <Badge variant="outline" className="text-[10px] mt-2">{t.count} generated</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="documents">All Documents ({docs.length})</TabsTrigger>
          <TabsTrigger value="byClient">By Client</TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="mt-4 space-y-3">
          {docs.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><FileText className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" /><p className="text-muted-foreground">No documents generated yet</p><Button variant="outline" className="mt-3" onClick={() => setShowGenerate(true)}>Generate Your First</Button></CardContent></Card>
          ) : docs.map(d => {
            const dt = DOC_TYPES[d.doc_type] || { icon: FileText, color: "text-blue-400", bg: "bg-blue-500/10", label: d.doc_type };
            const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.completed;
            const Icon = dt.icon;
            const StatusIcon = sc.icon;
            return (
              <Card key={d.id} className={`border-border/40 hover:shadow-md transition-all cursor-pointer`} onClick={() => setSelectedDoc(d)} data-testid={`doc-${d.id}`}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-lg ${dt.bg} flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${dt.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-sm truncate">{d.title}</h3>
                        <Badge className={`${sc.color} bg-transparent border text-[10px] capitalize`}><StatusIcon className="w-3 h-3 mr-1" />{d.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{d.client_name} — {d.description}</p>
                      {d.sections && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {d.sections.map(s => <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>)}
                        </div>
                      )}
                    </div>
                    <div className="text-right text-xs text-muted-foreground flex-shrink-0">
                      {d.generated_at && <p>{new Date(d.generated_at).toLocaleDateString()}</p>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="byClient" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            {[...new Set(docs.map(d => d.client_name))].map(client => {
              const clientDocs = docs.filter(d => d.client_name === client);
              return (
                <Card key={client} className="border-border/40">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{client}</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {clientDocs.map(d => {
                        const dt = DOC_TYPES[d.doc_type] || { icon: FileText, color: "text-blue-400" };
                        const Icon = dt.icon;
                        return (
                          <div key={d.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50" onClick={() => setSelectedDoc(d)}>
                            <Icon className={`w-4 h-4 ${dt.color}`} />
                            <span className="text-sm flex-1 truncate">{d.title}</span>
                            <Badge variant="outline" className="text-[10px] capitalize">{d.status}</Badge>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Generate Dialog */}
      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent className="max-w-md" aria-describedby="generate-doc-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Zap className="w-5 h-5 text-purple-400" />Generate Document</DialogTitle>
            <DialogDescription id="generate-doc-desc">NexusMSP builds a baseline immediately from the client’s enrolled devices. Review and enrich it before treating it as an approved document.</DialogDescription>
          </DialogHeader>
          <form onSubmit={generateDoc} className="space-y-4">
            <div className="space-y-2">
              <Label>Client *</Label>
              <Select value={form.client_name} onValueChange={v => setForm({ ...form, client_name: v })}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Document Type</Label>
              <Select value={form.doc_type} onValueChange={v => setForm({ ...form, doc_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DOC_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Title (optional)</Label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Auto-generated if left blank" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={generating || !form.client_name} data-testid="submit-generate">
                {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                Generate
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Document Detail Dialog */}
      <Dialog open={!!selectedDoc} onOpenChange={() => setSelectedDoc(null)}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto" aria-describedby="doc-detail-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-blue-400" />{selectedDoc?.title}</DialogTitle>
            <DialogDescription id="doc-detail-desc">Document details and sections</DialogDescription>
          </DialogHeader>
          {selectedDoc && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground text-xs">Client</span><p className="font-medium">{selectedDoc.client_name}</p></div>
                <div><span className="text-muted-foreground text-xs">Type</span><p className="font-medium capitalize">{selectedDoc.doc_type?.replace(/_/g, " ")}</p></div>
                <div><span className="text-muted-foreground text-xs">Status</span><Badge variant={selectedDoc.status === "completed" ? "default" : "secondary"} className="capitalize">{selectedDoc.status}</Badge></div>
                <div><span className="text-muted-foreground text-xs">Generated</span><p className="font-medium">{selectedDoc.generated_at ? new Date(selectedDoc.generated_at).toLocaleString() : "N/A"}</p></div>
              </div>
              <Separator />
              {selectedDoc.description && <p className="text-sm text-muted-foreground">{selectedDoc.description}</p>}
              {selectedDoc.completion_note && <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">{selectedDoc.completion_note}</p>}
              {selectedDoc.source_snapshot && <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-sm"><div><span className="text-xs text-muted-foreground">Source</span><p className="font-medium">{selectedDoc.source_snapshot.generated_from?.replace(/_/g, " ") || "NexusMSP inventory"}</p></div><div><span className="text-xs text-muted-foreground">Devices included</span><p className="font-medium">{selectedDoc.source_snapshot.device_count ?? 0}</p></div></div>}
              {selectedDoc.sections && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Document Sections</p>
                  <div className="space-y-1">
                    {selectedDoc.sections.map((s, i) => (
                      <div key={s} className="flex items-center gap-2 p-2 rounded bg-muted/30">
                        <span className="text-xs font-mono text-muted-foreground w-5">{i + 1}</span>
                        <span className="text-sm">{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {selectedDoc.content_html && <div className="rounded-lg border border-border/60 bg-background p-4"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Generated document preview</p><div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedDoc.content_html) }} /></div>}
              <DialogFooter><Button variant="outline" onClick={() => regenerateDoc(selectedDoc.id)} disabled={regeneratingId === selectedDoc.id} data-testid="regenerate-auto-doc">{regeneratingId === selectedDoc.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Refresh from inventory</Button></DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
