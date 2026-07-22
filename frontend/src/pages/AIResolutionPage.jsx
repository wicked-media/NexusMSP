import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import HeroTile from "@/components/HeroTile";
import {
  Bot, CheckCircle, Clock, XCircle, Zap, ThumbsUp, ThumbsDown, Filter,
  Search, Shield, HardDrive, Network, Cpu, RefreshCw, Eye, Play,
  AlertTriangle, Settings, Activity, BarChart3, Loader2, Terminal
} from "lucide-react";

const CATEGORY_ICONS = { disk: HardDrive, service: RefreshCw, certificate: Shield, network: Network, performance: Cpu, backup: HardDrive, security: Shield };
const CATEGORY_COLORS = { disk: "text-blue-400", service: "text-amber-400", certificate: "text-purple-400", network: "text-cyan-400", performance: "text-red-400", backup: "text-green-400", security: "text-rose-400" };
const STATUS_STYLES = {
  auto_resolved: { bg: "bg-emerald-500/10 border-emerald-500/30", text: "text-emerald-400", icon: CheckCircle },
  pending_approval: { bg: "bg-amber-500/10 border-amber-500/30", text: "text-amber-400", icon: Clock },
  manual_required: { bg: "bg-red-500/10 border-red-500/30", text: "text-red-400", icon: XCircle },
};

export default function AIResolutionPage({ embedded = false }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [tab, setTab] = useState("queue");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/ai-resolution/suggestions`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to fetch AI resolution data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAction = async (id, action) => {
    try {
      const result = await axios.post(`${API}/ai-resolution/${id}/${action}`, {}, { headers });
      toast.success(action === "approve" ? "Resolution approved & executed" : result.data.ticket_number ? `Escalated to ${result.data.ticket_number}` : "Escalated to manual queue");
      fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || "Resolution action failed"); }
  };

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const s = data.summary;
  const issues = data.issues.filter(i => {
    if (filter !== "all" && i.status !== filter) return false;
    if (catFilter !== "all" && i.category !== catFilter) return false;
    if (search && !i.issue.toLowerCase().includes(search.toLowerCase()) && !i.device.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const categories = [...new Set(data.issues.map(i => i.category))];
  const resolved = data.issues.filter(i => i.status === "auto_resolved");
  const avgConfidence = Math.round(data.issues.reduce((sum, i) => sum + (i.confidence || 0), 0) / Math.max(data.issues.length, 1));
  const catBreakdown = categories.map(c => ({ name: c, count: data.issues.filter(i => i.category === c).length, resolved: data.issues.filter(i => i.category === c && i.status === "auto_resolved").length }));

  return (
    <div className="space-y-5" data-testid="ai-resolution-page">
      {!embedded && <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center"><Bot className="w-5 h-5 text-white" /></div>
            AI Auto-Resolution Engine
          </h1>
          <p className="text-muted-foreground mt-1">Autonomous issue detection, matching, and resolution — Atera Autopilot-style</p>
        </div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/60 px-3 py-2">
        <p className="text-xs text-muted-foreground">AI recommendations remain reviewable. Approval records the decision and preserves the matched runbook context.</p>
        <Button variant="ghost" size="sm" onClick={fetchData}><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh</Button>
      </div>

      {/* Resolution signal tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <HeroTile label="Resolved" value={s.auto_resolved} icon={CheckCircle} glow="emerald" subtitle={`${s.resolution_rate_pct}% resolution rate`} testId="resolution-resolved" />
        <HeroTile label="Review" value={s.pending_approval} icon={Clock} glow="amber" subtitle="Awaiting approval" testId="resolution-pending" />
        <HeroTile label="Manual" value={s.manual_required} icon={XCircle} glow="rose" subtitle="Technician required" testId="resolution-manual" />
        <HeroTile label="Time saved" value={s.time_saved_hours} suffix="h" icon={Zap} glow="cyan" subtitle="This period" testId="resolution-time-saved" />
        <HeroTile label="Confidence" value={avgConfidence} suffix="%" icon={Activity} glow="violet" subtitle="Recommendation quality" testId="resolution-confidence" />
        <HeroTile label="Processed" value={s.total} icon={Bot} glow="zinc" subtitle="All detections" testId="resolution-total" />
      </div>

      {/* Resolution Rate Gauge */}
      <Card className="border-border/40">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Resolution Effectiveness</span>
            <span className="text-sm font-bold text-emerald-400">{s.resolution_rate_pct}%</span>
          </div>
          <Progress value={s.resolution_rate_pct} className="h-3" />
          <div className="flex justify-between mt-2">
            {catBreakdown.map(c => {
              const Icon = CATEGORY_ICONS[c.name] || Bot;
              return (
                <div key={c.name} className="text-center">
                  <Icon className={`w-3.5 h-3.5 mx-auto mb-0.5 ${CATEGORY_COLORS[c.name] || "text-muted-foreground"}`} />
                  <p className="text-[10px] font-bold capitalize">{c.name}</p>
                  <p className="text-[9px] text-muted-foreground">{c.resolved}/{c.count}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="queue">Resolution Queue</TabsTrigger>
          <TabsTrigger value="history">Resolved History</TabsTrigger>
          <TabsTrigger value="runbooks">Runbook Coverage</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="space-y-3 mt-4">
          {/* Filters */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search issues or devices..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="ai-search" />
            </div>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="auto_resolved">Auto-Resolved</SelectItem>
                <SelectItem value="pending_approval">Pending Approval</SelectItem>
                <SelectItem value="manual_required">Manual Required</SelectItem>
              </SelectContent>
            </Select>
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Issue Cards */}
          {issues.length === 0 ? (
            <Card className="border-dashed border-border/40"><CardContent className="py-12 text-center"><Bot className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" /><p className="text-muted-foreground">No matching issues</p></CardContent></Card>
          ) : issues.map(issue => {
            const st = STATUS_STYLES[issue.status] || STATUS_STYLES.manual_required;
            const CatIcon = CATEGORY_ICONS[issue.category] || Bot;
            const StatusIcon = st.icon;
            return (
              <Card key={issue.id} className={`${st.bg} border transition-all hover:shadow-md cursor-pointer`} onClick={() => setSelectedIssue(issue)} data-testid={`issue-${issue.id}`}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-background/50 border border-border/30`}>
                      <CatIcon className={`w-5 h-5 ${CATEGORY_COLORS[issue.category] || "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm">{issue.issue}</span>
                        <Badge variant="outline" className="text-[10px] capitalize">{issue.category}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{issue.device} — {issue.client}</p>
                      <div className="mt-2 p-2.5 rounded-lg bg-background/30 border border-border/20">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1"><Terminal className="w-3 h-3" />Matched Runbook</div>
                        <p className="text-sm font-medium">{issue.runbook}</p>
                        <p className="text-xs text-muted-foreground mt-1">{issue.action}</p>
                      </div>
                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex items-center gap-1.5"><span className="text-[10px] text-muted-foreground">Confidence:</span><Progress value={issue.confidence} className="w-16 h-1.5" /><span className="text-xs font-bold">{issue.confidence}%</span></div>
                        {issue.detected_at && <span className="text-[10px] text-muted-foreground">Detected: {new Date(issue.detected_at).toLocaleString()}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge className={`${st.text} bg-transparent border`}><StatusIcon className="w-3 h-3 mr-1" />{issue.status.replace(/_/g, " ")}</Badge>
                      {issue.status === "pending_approval" && (
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" className="h-8 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" onClick={e => { e.stopPropagation(); handleAction(issue.id, "approve"); }} data-testid={`approve-${issue.id}`}><ThumbsUp className="w-3.5 h-3.5 mr-1" />Approve</Button>
                          <Button size="sm" variant="outline" className="h-8 border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={e => { e.stopPropagation(); handleAction(issue.id, "reject"); }} data-testid={`reject-${issue.id}`}><ThumbsDown className="w-3.5 h-3.5 mr-1" />Reject</Button>
                        </div>
                      )}
                      {issue.status === "auto_resolved" && issue.resolved_at && (
                        <span className="text-[10px] text-emerald-400">Resolved {new Date(issue.resolved_at).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card className="border-border/40">
            <CardHeader><CardTitle className="text-sm">Recently Auto-Resolved ({resolved.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {resolved.map(r => (
                  <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-emerald-500/10 bg-emerald-500/5">
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.issue}</p>
                      <p className="text-xs text-muted-foreground">{r.device} — {r.runbook}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] capitalize">{r.category}</Badge>
                    <span className="text-xs text-muted-foreground">{r.confidence}%</span>
                  </div>
                ))}
                {resolved.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No auto-resolved issues yet</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runbooks" className="mt-4">
          <Card className="border-border/40">
            <CardHeader><CardTitle className="text-sm">Runbook Resolution Coverage</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {catBreakdown.map(c => {
                  const Icon = CATEGORY_ICONS[c.name] || Bot;
                  const pct = c.count > 0 ? Math.round(c.resolved / c.count * 100) : 0;
                  return (
                    <div key={c.name} className="p-3 rounded-lg border border-border/40">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon className={`w-4 h-4 ${CATEGORY_COLORS[c.name]}`} />
                        <span className="font-semibold text-sm capitalize">{c.name}</span>
                        <Badge variant="outline" className="text-[10px] ml-auto">{c.count} issues</Badge>
                      </div>
                      <Progress value={pct} className="h-2 mb-1" />
                      <p className="text-xs text-muted-foreground">{c.resolved} resolved automatically ({pct}%)</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Issue Detail Dialog */}
      <Dialog open={!!selectedIssue} onOpenChange={() => setSelectedIssue(null)}>
        <DialogContent className="max-w-lg" aria-describedby="issue-detail-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bot className="w-5 h-5 text-purple-400" />Resolution Detail</DialogTitle>
            <DialogDescription id="issue-detail-desc">Full details for this AI-detected issue</DialogDescription>
          </DialogHeader>
          {selectedIssue && (
            <div className="space-y-3">
              <div><p className="text-sm font-semibold">{selectedIssue.issue}</p><p className="text-xs text-muted-foreground">{selectedIssue.device} — {selectedIssue.client}</p></div>
              <Separator />
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground text-xs">Category</span><p className="capitalize font-medium">{selectedIssue.category}</p></div>
                <div><span className="text-muted-foreground text-xs">Status</span><p className="capitalize font-medium">{selectedIssue.status?.replace(/_/g, " ")}</p></div>
                <div><span className="text-muted-foreground text-xs">Confidence</span><p className="font-medium">{selectedIssue.confidence}%</p></div>
                <div><span className="text-muted-foreground text-xs">Detected</span><p className="font-medium">{selectedIssue.detected_at ? new Date(selectedIssue.detected_at).toLocaleString() : "N/A"}</p></div>
              </div>
              <Separator />
              <div className="p-3 rounded-lg bg-muted/30 border">
                <p className="text-xs font-semibold text-muted-foreground mb-1">Matched Runbook</p>
                <p className="text-sm font-medium">{selectedIssue.runbook}</p>
                <p className="text-xs text-muted-foreground mt-1">{selectedIssue.action}</p>
              </div>
              {selectedIssue.status === "pending_approval" && (
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => { handleAction(selectedIssue.id, "approve"); setSelectedIssue(null); }}><ThumbsUp className="w-4 h-4 mr-2" />Approve & Execute</Button>
                  <Button variant="outline" className="flex-1" onClick={() => { handleAction(selectedIssue.id, "reject"); setSelectedIssue(null); }}><ThumbsDown className="w-4 h-4 mr-2" />Reject & Escalate</Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
