import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Wifi, RefreshCw, Loader2, Trash2, Pencil, CheckCircle2, XCircle } from "lucide-react";

export default function UnifiControllersManager() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(null);

  const blank = { name: "", controller_url: "", api_key: "", network_site_id: "default", verify_tls: true, notes: "" };

  const load = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/unifi/controllers`, { headers });
      setList(r.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to load controllers"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const save = async () => {
    if (!editing.name || !editing.controller_url) { toast.error("Name + controller URL required"); return; }
    if (!editing.id && !editing.api_key) { toast.error("API key required for new controllers"); return; }
    setBusy(true);
    try {
      if (editing.id) {
        const body = { ...editing };
        if (!body.api_key) delete body.api_key;
        await axios.put(`${API}/unifi/controllers/${editing.id}`, body, { headers });
        toast.success("Controller updated");
      } else {
        await axios.post(`${API}/unifi/controllers`, editing, { headers });
        toast.success("Controller added");
      }
      setEditing(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!window.confirm("Remove this controller? Linked Network API access will stop working.")) return;
    try {
      await axios.delete(`${API}/unifi/controllers/${id}`, { headers });
      toast.success("Removed");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const test = async (id) => {
    setTesting(id);
    try {
      const r = await axios.get(`${API}/unifi/controllers/${id}/test`, { headers });
      if (r.data.success) toast.success(r.data.message);
      else toast.error(r.data.message || "Test failed");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setTesting(null); }
  };

  return (
    <div className="space-y-3" data-testid="unifi-controllers-manager">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium flex items-center gap-2"><Wifi className="w-4 h-4 text-sky-500" />Direct Site Controllers (Network API)</div>
          <p className="text-[11px] text-muted-foreground">Add each UniFi Network controller (cloud or local) to pull real device/client data and enable restart actions. Generated at: UniFi Network → Settings → Control Plane → Integrations.</p>
        </div>
        <Button size="sm" onClick={() => setEditing({ ...blank })} data-testid="unifi-controller-add"><Plus className="w-3 h-3 mr-1" />Add controller</Button>
      </div>

      {loading ? (
        <div className="text-center py-6 text-xs text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading…</div>
      ) : list.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-border rounded text-xs text-muted-foreground">No controllers added yet. Add one to enable real-time device control.</div>
      ) : (
        <div className="space-y-2">
          {list.map((c) => (
            <div key={c.id} className="border border-border rounded p-3 bg-muted/20" data-testid={`unifi-controller-${c.id}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2">
                    {c.name}
                    {c.last_test_status === "ok" ? (
                      <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 text-[10px]"><CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />OK</Badge>
                    ) : c.last_test_status?.startsWith("fail") ? (
                      <Badge variant="outline" className="text-rose-400 border-rose-500/30 text-[10px]"><XCircle className="w-2.5 h-2.5 mr-0.5" />{c.last_test_status}</Badge>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">{c.controller_url}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">site: {c.network_site_id || "default"}{c.api_key_preview ? ` · key: ${c.api_key_preview}` : ""}</div>
                  {c.notes && <div className="text-[11px] text-muted-foreground italic mt-1">{c.notes}</div>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => test(c.id)} disabled={testing === c.id} data-testid={`unifi-controller-test-${c.id}`}>
                    {testing === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    <span className="ml-1">Test</span>
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setEditing({ ...c, api_key: "" })} data-testid={`unifi-controller-edit-${c.id}`}><Pencil className="w-3 h-3" /></Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[10px] text-rose-400" onClick={() => remove(c.id)} data-testid={`unifi-controller-remove-${c.id}`}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent className="max-w-lg" data-testid="unifi-controller-dialog">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit controller" : "Add UniFi controller"}</DialogTitle>
            <DialogDescription>
              Each controller exposes the Network Integration API at <code>/proxy/network/integration/v1</code>. Requires UniFi Network 9.0+.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>Site name *</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. AusRock HQ" data-testid="unifi-controller-name" />
              </div>
              <div>
                <Label>Controller URL *</Label>
                <Input value={editing.controller_url} onChange={(e) => setEditing({ ...editing, controller_url: e.target.value })} placeholder="https://1234abcd.unifi.ui.com  OR  https://192.168.1.1" data-testid="unifi-controller-url" />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Cloud-hosted: <code>https://&lt;hostname&gt;.unifi.ui.com</code>. Local: <code>https://&lt;ip&gt;</code> or <code>:8443</code>.
                </p>
              </div>
              <div>
                <Label>API key {editing.id ? "(leave blank to keep)" : "*"}</Label>
                <Input type="password" value={editing.api_key || ""} onChange={(e) => setEditing({ ...editing, api_key: e.target.value })} placeholder={editing.id ? "•••••• (enter to replace)" : "Network Integration API token"} data-testid="unifi-controller-key" />
                <p className="text-[10px] text-muted-foreground mt-1">UniFi Network → Settings → Control Plane → Integrations → Generate API token.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Network Site ID</Label>
                  <Input value={editing.network_site_id} onChange={(e) => setEditing({ ...editing, network_site_id: e.target.value })} placeholder="default" data-testid="unifi-controller-site-id" />
                  <p className="text-[10px] text-muted-foreground mt-1">Usually <code>default</code>. Get from UniFi → Settings → Site.</p>
                </div>
                <div className="flex items-center gap-2 mt-6">
                  <Checkbox id="verify-tls" checked={editing.verify_tls} onCheckedChange={(v) => setEditing({ ...editing, verify_tls: !!v })} data-testid="unifi-controller-verify-tls" />
                  <Label htmlFor="verify-tls" className="text-xs cursor-pointer">Verify TLS certificate</Label>
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} placeholder="optional" data-testid="unifi-controller-notes" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={busy} data-testid="unifi-controller-save">
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}{editing?.id ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
