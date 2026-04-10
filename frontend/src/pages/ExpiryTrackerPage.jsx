import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { 
  ShieldCheck, Plus, RefreshCw, Loader2, AlertTriangle, CheckCircle, Clock,
  Globe, Lock, Key, Building, Package
} from "lucide-react";

export default function ExpiryTrackerPage() {
  const { token } = useAuth();
  const [warranties, setWarranties] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [domains, setDomains] = useState([]);
  const [sslCerts, setSslCerts] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("warranties");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState("warranty");
  const [formData, setFormData] = useState({});

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [warRes, licRes, domRes, sslRes, dashRes, cliRes] = await Promise.all([
        axios.get(`${API}/warranties`, { headers }),
        axios.get(`${API}/licenses`, { headers }),
        axios.get(`${API}/domains`, { headers }),
        axios.get(`${API}/ssl-certificates`, { headers }),
        axios.get(`${API}/expiry-dashboard`, { headers }),
        axios.get(`${API}/clients`, { headers })
      ]);
      setWarranties(warRes.data);
      setLicenses(licRes.data);
      setDomains(domRes.data);
      setSslCerts(sslRes.data);
      setDashboard(dashRes.data);
      setClients(cliRes.data);
    } catch (error) {
      toast.error("Failed to fetch data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openAddDialog = (type) => {
    setDialogType(type);
    setFormData({ client_id: "" });
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const endpoints = { warranty: "/warranties", license: "/licenses", domain: "/domains", ssl: "/ssl-certificates" };
      await axios.post(`${API}${endpoints[dialogType]}`, formData, { headers });
      toast.success("Entry added");
      setIsDialogOpen(false);
      fetchData();
    } catch (error) {
      toast.error("Failed to add entry");
    }
  };

  const handleDelete = async (type, id) => {
    if (!confirm("Delete this entry?")) return;
    try {
      const endpoints = { warranty: `/warranties/${id}`, license: `/licenses/${id}`, domain: `/domains/${id}`, ssl: `/ssl-certificates/${id}` };
      await axios.delete(`${API}${endpoints[type]}`, { headers });
      toast.success("Entry deleted");
      fetchData();
    } catch (error) {
      toast.error("Failed to delete");
    }
  };

  const getStatusBadge = (status) => {
    if (status === 'active' || status === 'valid') return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />{status}</Badge>;
    if (status === 'expiring_soon') return <Badge className="bg-yellow-500"><AlertTriangle className="w-3 h-3 mr-1" />Expiring Soon</Badge>;
    return <Badge variant="destructive"><Clock className="w-3 h-3 mr-1" />{status}</Badge>;
  };

  return (
    <div className="space-y-6" data-testid="expiry-tracker-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Expiry Tracker</h1>
          <p className="text-muted-foreground">Warranties, licenses, domains & SSL certificates</p>
        </div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>

      {/* Dashboard Stats */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className={dashboard.total_expiring > 0 ? 'border-yellow-500/50' : ''}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${dashboard.total_expiring > 0 ? 'bg-yellow-500/10' : 'bg-green-500/10'}`}>
                <AlertTriangle className={`w-5 h-5 ${dashboard.total_expiring > 0 ? 'text-yellow-500' : 'text-green-500'}`} />
              </div>
              <div><p className="text-2xl font-bold">{dashboard.total_expiring}</p><p className="text-xs text-muted-foreground">Expiring (30 days)</p></div>
            </CardContent>
          </Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><ShieldCheck className="w-5 h-5 text-blue-500" /></div>
            <div><p className="text-2xl font-bold">{dashboard.warranties.expiring_soon}</p><p className="text-xs text-muted-foreground">Warranties</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center"><Key className="w-5 h-5 text-purple-500" /></div>
            <div><p className="text-2xl font-bold">{dashboard.licenses.expiring_soon}</p><p className="text-xs text-muted-foreground">Licenses</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><Globe className="w-5 h-5 text-green-500" /></div>
            <div><p className="text-2xl font-bold">{dashboard.domains.expiring_soon}</p><p className="text-xs text-muted-foreground">Domains</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center"><Lock className="w-5 h-5 text-orange-500" /></div>
            <div><p className="text-2xl font-bold">{dashboard.ssl_certificates.expiring_soon}</p><p className="text-xs text-muted-foreground">SSL Certs</p></div>
          </CardContent></Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="warranties"><ShieldCheck className="w-4 h-4 mr-2" />Warranties ({warranties.length})</TabsTrigger>
            <TabsTrigger value="licenses"><Key className="w-4 h-4 mr-2" />Licenses ({licenses.length})</TabsTrigger>
            <TabsTrigger value="domains"><Globe className="w-4 h-4 mr-2" />Domains ({domains.length})</TabsTrigger>
            <TabsTrigger value="ssl"><Lock className="w-4 h-4 mr-2" />SSL ({sslCerts.length})</TabsTrigger>
          </TabsList>
          <Button size="sm" onClick={() => openAddDialog(activeTab === 'ssl' ? 'ssl' : activeTab.slice(0, -1) === 'ie' ? activeTab.slice(0,-1) : activeTab.slice(0,-1))}>
            <Plus className="w-4 h-4 mr-2" />Add
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48"><Loader2 className="w-8 h-8 animate-spin" /></div>
        ) : (
          <>
            <TabsContent value="warranties">
              <Card><CardContent className="p-0">
                {warranties.length > 0 ? (
                  <ScrollArea className="h-[400px]">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Product</TableHead><TableHead>Client</TableHead><TableHead>Vendor</TableHead>
                        <TableHead>Warranty End</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {warranties.map(w => (
                          <TableRow key={w.id}>
                            <TableCell className="font-medium">{w.product_name}</TableCell>
                            <TableCell>{w.client_name}</TableCell>
                            <TableCell>{w.vendor}</TableCell>
                            <TableCell>{w.warranty_end}</TableCell>
                            <TableCell>{getStatusBadge(w.status)}</TableCell>
                            <TableCell><Button variant="ghost" size="sm" onClick={() => handleDelete('warranty', w.id)}>Delete</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                ) : <div className="p-8 text-center text-muted-foreground">No warranties tracked</div>}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="licenses">
              <Card><CardContent className="p-0">
                {licenses.length > 0 ? (
                  <ScrollArea className="h-[400px]">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Software</TableHead><TableHead>Client</TableHead><TableHead>Type</TableHead>
                        <TableHead>Seats</TableHead><TableHead>Expiry</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {licenses.map(l => (
                          <TableRow key={l.id}>
                            <TableCell className="font-medium">{l.software_name}</TableCell>
                            <TableCell>{l.client_name}</TableCell>
                            <TableCell>{l.license_type}</TableCell>
                            <TableCell>{l.seats_used}/{l.seats}</TableCell>
                            <TableCell>{l.expiry_date || 'Perpetual'}</TableCell>
                            <TableCell>{getStatusBadge(l.status)}</TableCell>
                            <TableCell><Button variant="ghost" size="sm" onClick={() => handleDelete('license', l.id)}>Delete</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                ) : <div className="p-8 text-center text-muted-foreground">No licenses tracked</div>}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="domains">
              <Card><CardContent className="p-0">
                {domains.length > 0 ? (
                  <ScrollArea className="h-[400px]">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Domain</TableHead><TableHead>Client</TableHead><TableHead>Registrar</TableHead>
                        <TableHead>Expiry</TableHead><TableHead>Auto Renew</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {domains.map(d => (
                          <TableRow key={d.id}>
                            <TableCell className="font-medium">{d.domain_name}</TableCell>
                            <TableCell>{d.client_name}</TableCell>
                            <TableCell>{d.registrar || '-'}</TableCell>
                            <TableCell>{d.expiry_date}</TableCell>
                            <TableCell>{d.auto_renew ? <CheckCircle className="w-4 h-4 text-green-500" /> : '-'}</TableCell>
                            <TableCell>{getStatusBadge(d.status)}</TableCell>
                            <TableCell><Button variant="ghost" size="sm" onClick={() => handleDelete('domain', d.id)}>Delete</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                ) : <div className="p-8 text-center text-muted-foreground">No domains tracked</div>}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="ssl">
              <Card><CardContent className="p-0">
                {sslCerts.length > 0 ? (
                  <ScrollArea className="h-[400px]">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Domain</TableHead><TableHead>Client</TableHead><TableHead>Type</TableHead>
                        <TableHead>Issuer</TableHead><TableHead>Expiry</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {sslCerts.map(c => (
                          <TableRow key={c.id}>
                            <TableCell className="font-medium">{c.domain}</TableCell>
                            <TableCell>{c.client_name}</TableCell>
                            <TableCell>{c.certificate_type}</TableCell>
                            <TableCell>{c.issuer || '-'}</TableCell>
                            <TableCell>{c.expiry_date}</TableCell>
                            <TableCell>{getStatusBadge(c.status)}</TableCell>
                            <TableCell><Button variant="ghost" size="sm" onClick={() => handleDelete('ssl', c.id)}>Delete</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                ) : <div className="p-8 text-center text-muted-foreground">No SSL certificates tracked</div>}
              </CardContent></Card>
            </TabsContent>
          </>
        )}
      </Tabs>

      {/* Add Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add {dialogType.charAt(0).toUpperCase() + dialogType.slice(1)}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Client</Label>
              <Select value={formData.client_id} onValueChange={(v) => setFormData({...formData, client_id: v})}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {dialogType === 'warranty' && (<>
              <div className="space-y-2"><Label>Product Name *</Label><Input value={formData.product_name || ''} onChange={(e) => setFormData({...formData, product_name: e.target.value})} required /></div>
              <div className="space-y-2"><Label>Vendor *</Label><Input value={formData.vendor || ''} onChange={(e) => setFormData({...formData, vendor: e.target.value})} required /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Warranty Start</Label><Input type="date" value={formData.warranty_start || ''} onChange={(e) => setFormData({...formData, warranty_start: e.target.value})} /></div>
                <div className="space-y-2"><Label>Warranty End *</Label><Input type="date" value={formData.warranty_end || ''} onChange={(e) => setFormData({...formData, warranty_end: e.target.value})} required /></div>
              </div>
            </>)}
            {dialogType === 'license' && (<>
              <div className="space-y-2"><Label>Software Name *</Label><Input value={formData.software_name || ''} onChange={(e) => setFormData({...formData, software_name: e.target.value})} required /></div>
              <div className="space-y-2"><Label>Vendor *</Label><Input value={formData.vendor || ''} onChange={(e) => setFormData({...formData, vendor: e.target.value})} required /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Seats</Label><Input type="number" value={formData.seats || 1} onChange={(e) => setFormData({...formData, seats: parseInt(e.target.value)})} /></div>
                <div className="space-y-2"><Label>Expiry Date</Label><Input type="date" value={formData.expiry_date || ''} onChange={(e) => setFormData({...formData, expiry_date: e.target.value})} /></div>
              </div>
            </>)}
            {dialogType === 'domain' && (<>
              <div className="space-y-2"><Label>Domain Name *</Label><Input value={formData.domain_name || ''} onChange={(e) => setFormData({...formData, domain_name: e.target.value})} placeholder="example.com" required /></div>
              <div className="space-y-2"><Label>Registrar</Label><Input value={formData.registrar || ''} onChange={(e) => setFormData({...formData, registrar: e.target.value})} /></div>
              <div className="space-y-2"><Label>Expiry Date *</Label><Input type="date" value={formData.expiry_date || ''} onChange={(e) => setFormData({...formData, expiry_date: e.target.value})} required /></div>
            </>)}
            {dialogType === 'ssl' && (<>
              <div className="space-y-2"><Label>Domain *</Label><Input value={formData.domain || ''} onChange={(e) => setFormData({...formData, domain: e.target.value})} placeholder="*.example.com" required /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Issuer</Label><Input value={formData.issuer || ''} onChange={(e) => setFormData({...formData, issuer: e.target.value})} placeholder="Let's Encrypt" /></div>
                <div className="space-y-2"><Label>Type</Label>
                  <Select value={formData.certificate_type || 'DV'} onValueChange={(v) => setFormData({...formData, certificate_type: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="DV">DV</SelectItem><SelectItem value="OV">OV</SelectItem><SelectItem value="EV">EV</SelectItem><SelectItem value="Wildcard">Wildcard</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2"><Label>Expiry Date *</Label><Input type="date" value={formData.expiry_date || ''} onChange={(e) => setFormData({...formData, expiry_date: e.target.value})} required /></div>
            </>)}
            <DialogFooter><Button type="submit">Add</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
