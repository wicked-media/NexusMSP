import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Globe, Plus, Loader2, Shield, Settings, Users, Copy, Trash2, ExternalLink,
  Eye, Key, Link2, Ticket, Monitor, FileText, CheckCircle, XCircle
} from "lucide-react";

export default function ClientPortalPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [clients, setClients] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const [config, setConfig] = useState(null);
  const [showGenToken, setShowGenToken] = useState(false);
  const [tokenForm, setTokenForm] = useState({ contact_name: "", contact_email: "", expiry_days: 90 });
  const [newTokenUrl, setNewTokenUrl] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [cRes, pRes] = await Promise.all([
          axios.get(`${API}/clients`, { headers }),
          axios.get(`${API}/client-portal/all`, { headers }),
        ]);
        setClients(cRes.data);
        setConfigs(pRes.data);
      } catch { toast.error("Failed to load"); }
      finally { setLoading(false); }
    })();
  }, []);

  const selectClient = async (clientId) => {
    setSelectedClient(clientId);
    try {
      const res = await axios.get(`${API}/client-portal/config/${clientId}`, { headers });
      setConfig(res.data);
    } catch { toast.error("Failed to load config"); }
  };

  const saveConfig = async () => {
    try {
      await axios.put(`${API}/client-portal/config/${selectedClient}`, config, { headers });
      toast.success("Portal config saved");
    } catch { toast.error("Failed"); }
  };

  const generateToken = async () => {
    try {
      const res = await axios.post(`${API}/client-portal/generate-token/${selectedClient}`, tokenForm, { headers });
      setNewTokenUrl(res.data.portal_url);
      toast.success("Portal token generated");
      setShowGenToken(false);
      selectClient(selectedClient);
    } catch { toast.error("Failed"); }
  };

  const revokeToken = async (tokenId) => {
    try {
      await axios.delete(`${API}/client-portal/tokens/${selectedClient}/${tokenId}`, { headers });
      toast.success("Token revoked");
      selectClient(selectedClient);
    } catch { toast.error("Failed"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="client-portal-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Client Self-Service Portal</h1>
        <p className="text-sm text-muted-foreground">Configure branded portals for clients to log tickets, view devices, and check status</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Client List */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wider">Select Client</h2>
          <div className="space-y-1">
            {clients.map(c => {
              const hasPortal = configs.some(p => p.client_id === c.id && p.enabled);
              return (
                <div
                  key={c.id}
                  onClick={() => selectClient(c.id)}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${selectedClient === c.id ? "bg-primary/10 border-primary/30" : "hover:bg-muted/30"}`}
                  data-testid={`portal-client-${c.id}`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">{c.name?.charAt(0)}</div>
                    <span className="text-sm font-medium">{c.name}</span>
                  </div>
                  {hasPortal && <Badge className="bg-emerald-500/10 text-emerald-500 text-[9px]">ACTIVE</Badge>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Config Panel */}
        <div className="lg:col-span-2 space-y-4">
          {config ? (
            <>
              <Card data-testid="portal-config-panel">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2"><Settings className="w-5 h-5" />Portal Settings - {config.client_name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Label className="text-sm">Enabled</Label>
                      <Switch checked={config.enabled} onCheckedChange={v => setConfig({ ...config, enabled: v })} data-testid="portal-enabled-toggle" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Globe className="w-4 h-4" />Branding</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Company Name</Label><Input value={config.branding?.company_name || ""} onChange={e => setConfig({ ...config, branding: { ...config.branding, company_name: e.target.value } })} /></div>
                      <div><Label>Primary Color</Label><Input type="color" value={config.branding?.primary_color || "#3b82f6"} onChange={e => setConfig({ ...config, branding: { ...config.branding, primary_color: e.target.value } })} className="h-10" /></div>
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Shield className="w-4 h-4" />Portal Features</h4>
                    <div className="space-y-2">
                      {[
                        { key: "can_create_tickets", label: "Create Tickets", desc: "Clients can submit new support tickets", icon: Ticket },
                        { key: "can_view_devices", label: "View Devices", desc: "Clients can see their device status", icon: Monitor },
                        { key: "can_view_invoices", label: "View Invoices", desc: "Clients can view billing invoices", icon: FileText },
                        { key: "can_view_contracts", label: "View Contracts", desc: "Clients can see active contracts", icon: FileText },
                        { key: "can_view_kb", label: "Knowledge Base", desc: "Access to self-help articles", icon: Globe },
                      ].map(f => (
                        <div key={f.key} className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/30" data-testid={`feature-${f.key}`}>
                          <div className="flex items-center gap-2">
                            <f.icon className="w-4 h-4 text-muted-foreground" />
                            <div><p className="text-sm">{f.label}</p><p className="text-[10px] text-muted-foreground">{f.desc}</p></div>
                          </div>
                          <Switch checked={!!config.features?.[f.key]} onCheckedChange={v => setConfig({ ...config, features: { ...config.features, [f.key]: v } })} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <Button onClick={saveConfig} data-testid="save-portal-config-btn">Save Configuration</Button>
                </CardContent>
              </Card>

              {/* Access Tokens */}
              <Card data-testid="portal-tokens-panel">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2"><Key className="w-5 h-5" />Access Tokens</CardTitle>
                    <Button size="sm" onClick={() => { setTokenForm({ contact_name: "", contact_email: "", expiry_days: 90 }); setShowGenToken(true); }} data-testid="generate-token-btn"><Plus className="w-3 h-3 mr-1" />Generate Token</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {newTokenUrl && (
                    <div className="p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 mb-4" data-testid="new-portal-url">
                      <p className="text-sm font-medium text-emerald-400 mb-1">New Portal Link (share with client):</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-muted px-3 py-2 rounded font-mono text-sm">{window.location.origin}{newTokenUrl}</code>
                        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${newTokenUrl}`); toast.success("Copied"); }}><Copy className="w-3 h-3" /></Button>
                      </div>
                      <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setNewTokenUrl(null)}>Dismiss</Button>
                    </div>
                  )}
                  {(config.access_tokens || []).length > 0 ? (
                    <div className="space-y-2">
                      {config.access_tokens.map(t => (
                        <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30" data-testid={`token-${t.id}`}>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><Key className="w-5 h-5 text-blue-500" /></div>
                            <div>
                              <p className="text-sm font-medium">{t.contact_name || "Anonymous"}</p>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                {t.contact_email && <span>{t.contact_email}</span>}
                                <span>Created: {t.created_at?.split("T")[0]}</span>
                                <span>Expires: {t.expires_at?.split("T")[0]}</span>
                                {t.last_used && <span>Last used: {t.last_used.split("T")[0]}</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => window.open(`/portal/${t.token}`, "_blank")}><ExternalLink className="w-3 h-3 mr-1" />Open</Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => revokeToken(t.id)}><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Key className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-30" />
                      <p className="text-sm text-muted-foreground">No access tokens generated</p>
                      <p className="text-xs text-muted-foreground mt-1">Generate a token to create a shareable portal link for this client</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center">
                <Globe className="w-16 h-16 mx-auto text-muted-foreground mb-4 opacity-30" />
                <p className="text-lg font-medium text-muted-foreground">Select a client to configure their portal</p>
                <p className="text-sm text-muted-foreground mt-1">Each client can have a branded self-service portal with customizable features</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Generate Token Dialog */}
      <Dialog open={showGenToken} onOpenChange={setShowGenToken}>
        <DialogContent>
          <DialogHeader><DialogTitle>Generate Portal Access Token</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Create a unique access link for a client contact. They'll use this to access the self-service portal.</p>
            <div><Label>Contact Name</Label><Input value={tokenForm.contact_name} onChange={e => setTokenForm({ ...tokenForm, contact_name: e.target.value })} placeholder="e.g., John Smith" data-testid="token-contact-name" /></div>
            <div><Label>Contact Email</Label><Input value={tokenForm.contact_email} onChange={e => setTokenForm({ ...tokenForm, contact_email: e.target.value })} placeholder="e.g., john@acme.com" data-testid="token-contact-email" /></div>
            <div><Label>Expires In (days)</Label>
              <Select value={String(tokenForm.expiry_days)} onValueChange={v => setTokenForm({ ...tokenForm, expiry_days: parseInt(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="30">30 days</SelectItem><SelectItem value="90">90 days</SelectItem><SelectItem value="180">180 days</SelectItem><SelectItem value="365">1 year</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={generateToken} data-testid="confirm-generate-token"><Key className="w-4 h-4 mr-1" />Generate</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
