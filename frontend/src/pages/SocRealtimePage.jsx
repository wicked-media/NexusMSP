import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Loader2, Settings, Zap, MessageSquare, Clock, DollarSign, CheckCircle,
  AlertTriangle, RefreshCw
} from "lucide-react";

export default function SocRealtimePage() {
  const { token } = useAuth();
  const [settings, setSettings] = useState(null);
  const [recon, setRecon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [thankYouResult, setThankYouResult] = useState(null);
  const [staleResult, setStaleResult] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, reconRes] = await Promise.all([
        axios.get(`${API}/automation/settings`, { headers }),
        axios.get(`${API}/automation/billing-recon`, { headers }),
      ]);
      setSettings(settingsRes.data);
      setRecon(reconRes.data);
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const saveSettings = async () => {
    try {
      await axios.put(`${API}/automation/settings`, settings, { headers });
      toast.success("Settings saved");
    } catch { toast.error("Failed to save"); }
  };

  const runThankYou = async () => {
    setActionLoading("thank_you");
    try {
      const res = await axios.post(`${API}/automation/check-thank-you`, {}, { headers });
      setThankYouResult(res.data);
      toast.success(res.data.message);
    } catch { toast.error("Failed"); }
    finally { setActionLoading(null); }
  };

  const runStaleCheck = async () => {
    setActionLoading("stale");
    try {
      const res = await axios.post(`${API}/automation/check-stale-tickets`, {}, { headers });
      setStaleResult(res.data);
      toast.success(res.data.message);
    } catch { toast.error("Failed"); }
    finally { setActionLoading(null); }
  };

  if (loading || !settings) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const reconSummary = recon?.summary || {};

  return (
    <div className="space-y-6" data-testid="smart-automation">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Smart Automation</h1><p className="text-muted-foreground">Intelligent ticket management & billing reconciliation</p></div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Automation Settings */}
        <div className="col-span-5 space-y-4">
          <Card data-testid="automation-settings">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Settings className="w-4 h-4" />Automation Settings</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              {/* Thank You Detection */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div><Label className="text-sm font-semibold flex items-center gap-2"><MessageSquare className="w-4 h-4 text-green-400" />Thank You Detection</Label><p className="text-xs text-muted-foreground mt-0.5">Auto-close tickets with thank-you replies</p></div>
                  <Switch checked={settings.thank_you_detection} onCheckedChange={v => setSettings({ ...settings, thank_you_detection: v })} data-testid="toggle-thank-you" />
                </div>
                <div><Label className="text-xs">Keywords (comma-separated)</Label><Input value={(settings.thank_you_keywords || []).join(", ")} onChange={e => setSettings({ ...settings, thank_you_keywords: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} className="text-sm" data-testid="thank-you-keywords" /></div>
                <Button size="sm" onClick={runThankYou} disabled={actionLoading === "thank_you"} data-testid="run-thank-you">
                  {actionLoading === "thank_you" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}Run Now
                </Button>
                {thankYouResult && <div className="p-2 rounded bg-green-500/10 border border-green-500/20 text-xs text-green-400">Scanned {thankYouResult.scanned} tickets, auto-closed {thankYouResult.closed}</div>}
              </div>
              <Separator />
              {/* Stale Ticket Reminders */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div><Label className="text-sm font-semibold flex items-center gap-2"><Clock className="w-4 h-4 text-amber-400" />Stale Ticket Reminders</Label><p className="text-xs text-muted-foreground mt-0.5">Auto-ping clients on inactive tickets</p></div>
                  <Switch checked={settings.stale_ticket_enabled} onCheckedChange={v => setSettings({ ...settings, stale_ticket_enabled: v })} data-testid="toggle-stale" />
                </div>
                <div className="flex items-center gap-2"><Label className="text-xs whitespace-nowrap">Stale after</Label><Input type="number" min="1" max="30" value={settings.stale_ticket_days} onChange={e => setSettings({ ...settings, stale_ticket_days: parseInt(e.target.value) || 3 })} className="w-16 text-sm" /><span className="text-xs text-muted-foreground">days</span></div>
                <Button size="sm" onClick={runStaleCheck} disabled={actionLoading === "stale"} data-testid="run-stale-check">
                  {actionLoading === "stale" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Check Now
                </Button>
                {staleResult && <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">Found {staleResult.stale_count} stale tickets, pinged {staleResult.pinged}</div>}
              </div>
              <Separator />
              <Button onClick={saveSettings} className="w-full" data-testid="save-automation-settings">Save Settings</Button>
            </CardContent>
          </Card>
        </div>

        {/* Billing Reconciliation */}
        <div className="col-span-7 space-y-4">
          <Card data-testid="billing-recon">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-green-400" />Billing Reconciliation</CardTitle>
                <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <div className="p-2 rounded-lg bg-muted/20 text-center"><p className="text-[10px] text-muted-foreground">Clients</p><p className="text-lg font-bold">{reconSummary.total_clients || 0}</p></div>
                <div className="p-2 rounded-lg bg-green-500/10 text-center"><p className="text-[10px] text-muted-foreground">Matched</p><p className="text-lg font-bold text-green-400">{reconSummary.matched || 0}</p></div>
                <div className="p-2 rounded-lg bg-amber-500/10 text-center"><p className="text-[10px] text-muted-foreground">Over</p><p className="text-lg font-bold text-amber-400">{reconSummary.over_provisioned || 0}</p></div>
                <div className="p-2 rounded-lg bg-red-500/10 text-center"><p className="text-[10px] text-muted-foreground">Under</p><p className="text-lg font-bold text-red-400">{reconSummary.under_provisioned || 0}</p></div>
              </div>
              {(reconSummary.potential_revenue_loss || 0) > 0 && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <div><p className="text-sm font-medium text-red-400">Potential Revenue Loss</p><p className="text-xs text-muted-foreground">${reconSummary.potential_revenue_loss} from {reconSummary.total_over_agents} unbilled agents</p></div>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">Contracted</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Diff</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Impact</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(recon?.reconciliation || []).length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground text-sm">No reconciliation data</TableCell></TableRow> :
                  (recon?.reconciliation || []).map((r, i) => (
                    <TableRow key={`k-${i}`} className={r.status === "over" ? "bg-amber-500/5" : r.status === "under" ? "bg-red-500/5" : ""} data-testid={`recon-${i}`}>
                      <TableCell className="font-medium text-sm">{r.client_name}</TableCell>
                      <TableCell className="text-right font-mono">{r.contracted_seats}</TableCell>
                      <TableCell className="text-right font-mono">{r.actual_agents}</TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        <span className={r.difference > 0 ? "text-amber-400" : r.difference < 0 ? "text-red-400" : "text-green-400"}>
                          {r.difference > 0 ? "+" : ""}{r.difference}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${r.status === "match" ? "bg-green-500/20 text-green-400" : r.status === "over" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>
                          {r.status === "match" ? <CheckCircle className="w-3 h-3 mr-1" /> : <AlertTriangle className="w-3 h-3 mr-1" />}
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs ${r.revenue_impact > 0 ? "text-amber-400" : r.revenue_impact < 0 ? "text-green-400" : ""}`}>${r.revenue_impact.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
