import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Zap, Clock, AlertTriangle, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";

const severityColors = { critical: "destructive", high: "destructive", medium: "secondary", low: "outline" };

export default function PostmortemPage() {
  const { token } = useAuth();
  const [postmortems, setPostmortems] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState("");
  const [generating, setGenerating] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = () => {
    Promise.all([
      axios.get(`${API}/postmortem`, { headers }),
      axios.get(`${API}/tickets`, { headers }),
    ]).then(([pm, t]) => {
      setPostmortems(pm.data);
      setTickets(t.data.filter(tk => tk.status === "resolved" || tk.status === "closed"));
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const generate = async () => {
    if (!selectedTicket) { toast.error("Select a ticket first"); return; }
    setGenerating(true);
    try {
      const { data } = await axios.post(`${API}/postmortem/generate/${selectedTicket}`, {}, { headers });
      setViewing(data);
      setPostmortems(prev => [data, ...prev]);
      toast.success("Post-mortem generated");
    } catch { toast.error("Generation failed"); }
    setGenerating(false);
  };

  const deletePm = async (id) => {
    await axios.delete(`${API}/postmortem/${id}`, { headers });
    setPostmortems(prev => prev.filter(p => p.id !== id));
    if (viewing?.id === id) setViewing(null);
    toast.success("Deleted");
  };

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="postmortem-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Incident Post-Mortem Generator</h1>
          <p className="text-muted-foreground text-sm mt-1">AI-generated post-mortem reports from resolved incidents</p>
        </div>
        <div className="flex gap-3 items-center">
          <Select value={selectedTicket} onValueChange={setSelectedTicket}>
            <SelectTrigger className="w-[280px]" data-testid="postmortem-ticket-select">
              <SelectValue placeholder="Select resolved ticket..." />
            </SelectTrigger>
            <SelectContent>
              {tickets.map(t => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={generate} disabled={generating} data-testid="generate-postmortem">
            <Zap className={`w-4 h-4 mr-2 ${generating ? "animate-spin" : ""}`} />
            {generating ? "Generating..." : "Generate"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" />Reports ({postmortems.length})</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                {postmortems.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No post-mortems yet</p>
                ) : (
                  <div className="space-y-2">
                    {postmortems.map(pm => (
                      <div key={pm.id} className={`p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors ${viewing?.id === pm.id ? "border-primary bg-primary/5" : ""}`}
                        onClick={() => setViewing(pm)} data-testid={`pm-card-${pm.id}`}>
                        <div className="flex items-start justify-between">
                          <p className="text-sm font-medium line-clamp-1">{pm.title}</p>
                          <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1" onClick={e => { e.stopPropagation(); deletePm(pm.id); }}>
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant={severityColors[pm.severity]} className="text-[10px] capitalize">{pm.severity}</Badge>
                          <span className="text-[10px] text-muted-foreground">{pm.client_name}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">{new Date(pm.generated_at).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {viewing ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{viewing.title}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant={severityColors[viewing.severity]} className="capitalize">{viewing.severity}</Badge>
                    {viewing.duration_estimate && <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />{viewing.duration_estimate}</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div><h3 className="text-sm font-semibold mb-1">Summary</h3><p className="text-sm text-muted-foreground">{viewing.summary}</p></div>
                <div><h3 className="text-sm font-semibold mb-1">Root Cause</h3><p className="text-sm text-muted-foreground">{viewing.root_cause}</p></div>
                <div><h3 className="text-sm font-semibold mb-1">Impact</h3><p className="text-sm text-muted-foreground">{viewing.impact}</p></div>
                <div><h3 className="text-sm font-semibold mb-1">Resolution</h3><p className="text-sm text-muted-foreground">{viewing.resolution}</p></div>
                {viewing.timeline && viewing.timeline.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Timeline</h3>
                    <div className="space-y-1 pl-4 border-l-2 border-border">
                      {viewing.timeline.map((t, i) => <p key={i} className="text-xs text-muted-foreground">{t}</p>)}
                    </div>
                  </div>
                )}
                {viewing.prevention && viewing.prevention.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-1"><Shield className="w-3 h-3" />Prevention Actions</h3>
                    <ul className="space-y-1">
                      {viewing.prevention.map((p, i) => <li key={i} className="text-sm text-muted-foreground flex items-start gap-2"><span className="text-green-500 mt-0.5">*</span>{p}</li>)}
                    </ul>
                  </div>
                )}
                <div className="text-xs text-muted-foreground pt-2 border-t">
                  Generated by {viewing.generated_by} on {new Date(viewing.generated_at).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card><CardContent className="py-20 text-center text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>Select or generate a post-mortem to view</p>
            </CardContent></Card>
          )}
        </div>
      </div>
    </div>
  );
}
