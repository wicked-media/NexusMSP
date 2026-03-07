import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { 
  Key,
  Plus,
  Search,
  Eye,
  EyeOff,
  Copy,
  RefreshCw,
  Loader2,
  Lock,
  FileText,
  Folder,
  MoreVertical,
  Trash2,
  ExternalLink
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const passwordCategories = {
  general: { label: "General", icon: Key },
  server: { label: "Server", icon: Lock },
  network: { label: "Network", icon: Lock },
  cloud: { label: "Cloud", icon: Lock },
  application: { label: "Application", icon: Lock },
  other: { label: "Other", icon: Key }
};

const docCategories = {
  general: "General",
  network: "Network",
  procedures: "Procedures",
  contacts: "Contacts",
  licenses: "Licenses",
  other: "Other"
};

export default function DocumentationPage() {
  const { token } = useAuth();
  const [passwords, setPasswords] = useState([]);
  const [docs, setDocs] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("passwords");
  const [searchQuery, setSearchQuery] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [isDocDialogOpen, setIsDocDialogOpen] = useState(false);
  const [revealedPasswords, setRevealedPasswords] = useState({});
  const [passwordForm, setPasswordForm] = useState({
    client_id: "",
    name: "",
    category: "general",
    username: "",
    password: "",
    url: "",
    notes: "",
    tags: ""
  });
  const [docForm, setDocForm] = useState({
    client_id: "",
    title: "",
    content: "",
    category: "general",
    tags: ""
  });
  const [selectedDoc, setSelectedDoc] = useState(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [passwordsRes, docsRes, clientsRes] = await Promise.all([
        axios.get(`${API}/passwords`, { headers }),
        axios.get(`${API}/documentation`, { headers }),
        axios.get(`${API}/clients`, { headers })
      ]);
      setPasswords(passwordsRes.data);
      setDocs(docsRes.data);
      setClients(clientsRes.data);
    } catch (error) {
      toast.error("Failed to fetch data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...passwordForm,
        tags: passwordForm.tags ? passwordForm.tags.split(',').map(t => t.trim()) : []
      };
      await axios.post(`${API}/passwords`, payload, { headers });
      toast.success("Password saved");
      setIsPasswordDialogOpen(false);
      setPasswordForm({
        client_id: "",
        name: "",
        category: "general",
        username: "",
        password: "",
        url: "",
        notes: "",
        tags: ""
      });
      fetchData();
    } catch (error) {
      toast.error("Failed to save password");
    }
  };

  const handleDocSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...docForm,
        tags: docForm.tags ? docForm.tags.split(',').map(t => t.trim()) : []
      };
      if (selectedDoc) {
        await axios.put(`${API}/documentation/${selectedDoc.id}`, payload, { headers });
        toast.success("Documentation updated");
      } else {
        await axios.post(`${API}/documentation`, payload, { headers });
        toast.success("Documentation created");
      }
      setIsDocDialogOpen(false);
      setDocForm({ client_id: "", title: "", content: "", category: "general", tags: "" });
      setSelectedDoc(null);
      fetchData();
    } catch (error) {
      toast.error("Failed to save documentation");
    }
  };

  const revealPassword = async (id) => {
    try {
      const res = await axios.get(`${API}/passwords/${id}`, { headers });
      setRevealedPasswords({ ...revealedPasswords, [id]: res.data.password });
    } catch (error) {
      toast.error("Failed to reveal password");
    }
  };

  const copyPassword = async (id) => {
    try {
      const res = await axios.get(`${API}/passwords/${id}`, { headers });
      await navigator.clipboard.writeText(res.data.password);
      toast.success("Password copied to clipboard");
    } catch (error) {
      toast.error("Failed to copy password");
    }
  };

  const handleDeletePassword = async (id) => {
    if (!confirm("Delete this password entry?")) return;
    try {
      await axios.delete(`${API}/passwords/${id}`, { headers });
      toast.success("Password deleted");
      fetchData();
    } catch (error) {
      toast.error("Failed to delete password");
    }
  };

  const handleDeleteDoc = async (id) => {
    if (!confirm("Delete this documentation?")) return;
    try {
      await axios.delete(`${API}/documentation/${id}`, { headers });
      toast.success("Documentation deleted");
      fetchData();
    } catch (error) {
      toast.error("Failed to delete documentation");
    }
  };

  const openEditDoc = (doc) => {
    setSelectedDoc(doc);
    setDocForm({
      client_id: doc.client_id || "",
      title: doc.title,
      content: doc.content,
      category: doc.category,
      tags: doc.tags?.join(', ') || ""
    });
    setIsDocDialogOpen(true);
  };

  const filteredPasswords = passwords.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.username?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesClient = clientFilter === "all" || p.client_id === clientFilter;
    return matchesSearch && matchesClient;
  });

  const filteredDocs = docs.filter(d => {
    const matchesSearch = d.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesClient = clientFilter === "all" || d.client_id === clientFilter || !d.client_id;
    return matchesSearch && matchesClient;
  });

  return (
    <div className="space-y-6" data-testid="documentation-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">IT Documentation</h1>
          <p className="text-muted-foreground">Password vault & documentation</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Key className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{passwords.length}</p>
              <p className="text-xs text-muted-foreground">Passwords</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{docs.length}</p>
              <p className="text-xs text-muted-foreground">Documents</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Folder className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{new Set(passwords.map(p => p.client_id)).size}</p>
              <p className="text-xs text-muted-foreground">Clients with Passwords</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-yellow-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{docs.filter(d => !d.client_id).length}</p>
              <p className="text-xs text-muted-foreground">Global Docs</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clients</SelectItem>
            {clients.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="passwords" className="gap-2">
              <Key className="w-4 h-4" />
              Passwords
            </TabsTrigger>
            <TabsTrigger value="docs" className="gap-2">
              <FileText className="w-4 h-4" />
              Documentation
            </TabsTrigger>
          </TabsList>
          {activeTab === "passwords" ? (
            <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4 mr-2" />Add Password</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Password Entry</DialogTitle>
                </DialogHeader>
                <form onSubmit={handlePasswordSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Client *</Label>
                      <Select value={passwordForm.client_id} onValueChange={(v) => setPasswordForm({ ...passwordForm, client_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                        <SelectContent>
                          {clients.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select value={passwordForm.category} onValueChange={(v) => setPasswordForm({ ...passwordForm, category: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(passwordCategories).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input
                      value={passwordForm.name}
                      onChange={(e) => setPasswordForm({ ...passwordForm, name: e.target.value })}
                      placeholder="Domain Admin"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Username</Label>
                      <Input
                        value={passwordForm.username}
                        onChange={(e) => setPasswordForm({ ...passwordForm, username: e.target.value })}
                        placeholder="administrator"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Password *</Label>
                      <Input
                        type="password"
                        value={passwordForm.password}
                        onChange={(e) => setPasswordForm({ ...passwordForm, password: e.target.value })}
                        placeholder="••••••••"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>URL</Label>
                    <Input
                      value={passwordForm.url}
                      onChange={(e) => setPasswordForm({ ...passwordForm, url: e.target.value })}
                      placeholder="https://server.example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={passwordForm.notes}
                      onChange={(e) => setPasswordForm({ ...passwordForm, notes: e.target.value })}
                      placeholder="Additional notes..."
                      rows={2}
                    />
                  </div>
                  <DialogFooter>
                    <Button type="submit">Save Password</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : (
            <Dialog open={isDocDialogOpen} onOpenChange={(open) => { setIsDocDialogOpen(open); if (!open) { setSelectedDoc(null); setDocForm({ client_id: "", title: "", content: "", category: "general", tags: "" }); }}}>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4 mr-2" />Add Document</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{selectedDoc ? "Edit Document" : "Add Document"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleDocSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Client (Optional)</Label>
                      <Select value={docForm.client_id} onValueChange={(v) => setDocForm({ ...docForm, client_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Global (no client)" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Global</SelectItem>
                          {clients.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select value={docForm.category} onValueChange={(v) => setDocForm({ ...docForm, category: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(docCategories).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Title *</Label>
                    <Input
                      value={docForm.title}
                      onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
                      placeholder="Server Setup Guide"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Content (Markdown supported)</Label>
                    <Textarea
                      value={docForm.content}
                      onChange={(e) => setDocForm({ ...docForm, content: e.target.value })}
                      placeholder="# Overview&#10;&#10;Document content here..."
                      rows={12}
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Tags (comma separated)</Label>
                    <Input
                      value={docForm.tags}
                      onChange={(e) => setDocForm({ ...docForm, tags: e.target.value })}
                      placeholder="setup, server, windows"
                    />
                  </div>
                  <DialogFooter>
                    <Button type="submit">{selectedDoc ? "Update" : "Create"}</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <TabsContent value="passwords" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredPasswords.length > 0 ? (
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Username</TableHead>
                        <TableHead>Password</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="w-[60px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPasswords.map(p => (
                        <TableRow key={p.id} className="table-row-hover">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{p.name}</span>
                              {p.url && (
                                <a href={p.url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="w-3 h-3 text-muted-foreground" />
                                </a>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{p.client_name}</TableCell>
                          <TableCell className="font-mono text-sm">{p.username || '-'}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm">
                                {revealedPasswords[p.id] || '••••••••'}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => revealedPasswords[p.id] ? setRevealedPasswords({...revealedPasswords, [p.id]: null}) : revealPassword(p.id)}
                              >
                                {revealedPasswords[p.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => copyPassword(p.id)}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{passwordCategories[p.category]?.label}</Badge>
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDeletePassword(p.id)}>
                              <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              ) : (
                <div className="flex flex-col items-center justify-center h-64">
                  <Key className="w-12 h-12 text-muted-foreground opacity-50 mb-4" />
                  <p className="text-muted-foreground">No passwords found</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="docs" className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredDocs.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocs.map(doc => (
                <Card key={doc.id} className="card-hover cursor-pointer" onClick={() => openEditDoc(doc)}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                          <FileText className="w-5 h-5 text-blue-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold line-clamp-1">{doc.title}</h3>
                          <p className="text-xs text-muted-foreground">{doc.client_name || 'Global'}</p>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditDoc(doc); }}>Edit</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id); }}>Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                      {doc.content?.substring(0, 150) || 'No content'}
                    </p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <Badge variant="outline">{docCategories[doc.category]}</Badge>
                      <span>Views: {doc.view_count || 0}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64">
              <FileText className="w-12 h-12 text-muted-foreground opacity-50 mb-4" />
              <p className="text-muted-foreground">No documentation found</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
