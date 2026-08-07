import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Cloud, Link2, Activity, CheckCircle, RefreshCw, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { API } from "@/App";

/**
 * Acronis backup plans currently applied to this device,
 * plus recent backup activities. Includes a manual link/unlink editor.
 */
export default function DeviceBackupPlansPanel({ deviceId, token }) {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [linkingResourceId, setLinkingResourceId] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/devices/${deviceId}/acronis`, { headers });
      setData(r.data);
      setLinkingResourceId(r.data?.acronis_resource_id || "");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to load Acronis info"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  useEffect(() => { if (deviceId) fetchData(); }, [deviceId, fetchData]);

  const handleSaveLink = async () => {
    setSaving(true);
    try {
      await axios.put(
        `${API}/devices/${deviceId}/acronis-link`,
        { acronis_resource_id: linkingResourceId.trim() || null },
        { headers },
      );
      toast.success(linkingResourceId ? "Acronis resource linked" : "Unlinked");
      fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-cyan-400" /></div>;
  }

  const apps = data?.applications || [];
  const recent = data?.recent_activities || [];
  const linkedExplicit = data?.matched_by === "explicit";

  return (
    <div className="space-y-4" data-testid="device-backup-plans">
      {/* Link card */}
      <Card className={`border ${data?.acronis_resource_id ? "border-cyan-500/30 bg-cyan-500/[0.03]" : "border-amber-500/20 bg-amber-500/[0.03]"}`}>
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${data?.acronis_resource_id ? "bg-cyan-500/15 text-cyan-300" : "bg-amber-500/15 text-amber-300"}`}>
              {data?.acronis_resource_id ? <Cloud className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold flex items-center gap-2">
                Acronis Resource
                {data?.acronis_resource_id && (
                  <Badge variant="outline" className="text-[9px] capitalize">
                    {data.matched_by === "explicit" ? "linked" : "name match"}
                  </Badge>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {data?.acronis_resource_id || data?.message || "Not linked"}
              </p>
            </div>
            <div className="flex gap-1.5 items-center">
              <Input
                value={linkingResourceId}
                onChange={e => setLinkingResourceId(e.target.value)}
                placeholder="Acronis resource ID"
                className="h-8 text-xs w-[280px] font-mono"
                data-testid="device-acronis-link-input"
              />
              <Button
                size="sm" variant="outline"
                onClick={handleSaveLink}
                disabled={saving || (linkingResourceId === (data?.acronis_resource_id || "") && linkedExplicit)}
                data-testid="device-acronis-link-save"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
              </Button>
              <Button size="sm" variant="ghost" onClick={fetchData} title="Refresh">
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Applied plans */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Cloud className="w-4 h-4 text-cyan-400" />Applied Backup Plans</span>
            <Badge variant="outline" className="text-[10px]">{apps.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {apps.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {data?.acronis_resource_id
                ? "No backup plans currently assigned in Acronis."
                : "Link an Acronis resource above to see applied plans."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apps.map(a => (
                  <TableRow key={a.application_id} data-testid={`device-plan-${a.application_id}`}>
                    <TableCell className="text-sm font-medium">{a.policy_name || "(unnamed)"}</TableCell>
                    <TableCell><span className="font-mono text-[10px] text-muted-foreground">{a.policy_type}</span></TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] capitalize">{a.state || "—"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {a.enabled
                        ? <Badge className="text-[10px] bg-emerald-500/15 text-emerald-300">Enabled</Badge>
                        : <Badge variant="outline" className="text-[10px] text-muted-foreground">Disabled</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent backup activities */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Activity className="w-4 h-4 text-violet-400" />Recent Backup Activities</span>
            <Badge variant="outline" className="text-[10px]">{recent.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No recent backup activities.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>State</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map(a => {
                  const ok = (a.state || "").toLowerCase().includes("complet") || a.state === "ok";
                  const fail = (a.state || "").toLowerCase().includes("fail");
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Badge className={`text-[10px] capitalize ${ok ? "bg-emerald-500/15 text-emerald-300" : fail ? "bg-rose-500/15 text-rose-300" : "bg-muted/30"}`}>
                          {ok && <CheckCircle className="w-2.5 h-2.5 mr-1 inline" />}
                          {a.state || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs capitalize">{(a.activity_type || "").replace("_", " ")}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.policy_name || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.started_at ? formatDistanceToNow(new Date(a.started_at), { addSuffix: true }) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
