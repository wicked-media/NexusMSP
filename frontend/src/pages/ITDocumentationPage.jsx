import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileText, Folder, Loader2, MoreVertical, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import HeroTile from "@/components/HeroTile";

const docCategories = {
  general: "General",
  network: "Network",
  procedures: "Procedures",
  contacts: "Contacts",
  licenses: "Licences",
  other: "Other",
};

const emptyDocument = {
  client_id: "",
  title: "",
  content: "",
  category: "general",
  tags: "",
};

export default function ITDocumentationPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [docs, setDocs] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [docForm, setDocForm] = useState(emptyDocument);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [docsRes, clientsRes] = await Promise.all([
        axios.get(`${API}/documentation`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setDocs(docsRes.data);
      setClients(clientsRes.data);
    } catch {
      toast.error("Unable to load documentation");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const resetEditor = () => {
    setSelectedDoc(null);
    setDocForm(emptyDocument);
  };

  const openEditor = (doc = null) => {
    setSelectedDoc(doc);
    setDocForm(doc ? {
      client_id: doc.client_id || "",
      title: doc.title || "",
      content: doc.content || "",
      category: doc.category || "general",
      tags: doc.tags?.join(", ") || "",
    } : emptyDocument);
    setIsDialogOpen(true);
  };

  const saveDocument = async (event) => {
    event.preventDefault();
    const payload = {
      ...docForm,
      tags: docForm.tags ? docForm.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [],
    };
    try {
      if (selectedDoc) {
        await axios.put(`${API}/documentation/${selectedDoc.id}`, payload, { headers });
        toast.success("Documentation updated");
      } else {
        await axios.post(`${API}/documentation`, payload, { headers });
        toast.success("Documentation created");
      }
      setIsDialogOpen(false);
      resetEditor();
      fetchData();
    } catch {
      toast.error("Unable to save documentation");
    }
  };

  const deleteDocument = async (doc) => {
    if (!window.confirm(`Delete “${doc.title}”?`)) return;
    try {
      await axios.delete(`${API}/documentation/${doc.id}`, { headers });
      toast.success("Documentation deleted");
      fetchData();
    } catch {
      toast.error("Unable to delete documentation");
    }
  };

  const filteredDocs = docs.filter((doc) => {
    const search = searchQuery.toLowerCase();
    const matchesSearch = !search || [doc.title, doc.content, doc.client_name, ...(doc.tags || [])]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
    return matchesSearch && (clientFilter === "all" || doc.client_id === clientFilter || !doc.client_id);
  });
  const coveredClients = new Set(docs.map((doc) => doc.client_id).filter(Boolean)).size;

  return (
    <div className="space-y-6" data-testid="documentation-page">
      <div className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Client knowledge</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">IT Documentation</h1>
          <p className="mt-1 text-sm text-muted-foreground">Operational notes and client documentation. NexusMSP does not store or reveal passwords.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate("/hudu")} data-testid="open-hudu-from-docs">
            <ShieldCheck className="mr-2 h-4 w-4" />Open Hudu
          </Button>
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="mr-2 h-4 w-4" />Refresh
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) resetEditor();
          }}>
            <DialogTrigger asChild>
              <Button onClick={() => openEditor()}><Plus className="mr-2 h-4 w-4" />New document</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{selectedDoc ? "Edit document" : "Create document"}</DialogTitle>
              </DialogHeader>
              <form className="space-y-4" onSubmit={saveDocument}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Client</Label>
                    <Select value={docForm.client_id || "global"} onValueChange={(value) => setDocForm({ ...docForm, client_id: value === "global" ? "" : value })}>
                      <SelectTrigger><SelectValue placeholder="Global documentation" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="global">Global documentation</SelectItem>
                        {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={docForm.category} onValueChange={(value) => setDocForm({ ...docForm, category: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(docCategories).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input required value={docForm.title} onChange={(event) => setDocForm({ ...docForm, title: event.target.value })} placeholder="Server setup guide" />
                </div>
                <div className="space-y-2">
                  <Label>Content <span className="text-muted-foreground">(Markdown supported)</span></Label>
                  <Textarea rows={12} className="font-mono text-sm" value={docForm.content} onChange={(event) => setDocForm({ ...docForm, content: event.target.value })} placeholder="# Overview\n\nDocument the operational knowledge a technician needs." />
                </div>
                <div className="space-y-2">
                  <Label>Tags <span className="text-muted-foreground">(comma separated)</span></Label>
                  <Input value={docForm.tags} onChange={(event) => setDocForm({ ...docForm, tags: event.target.value })} placeholder="windows, onboarding, network" />
                </div>
                <DialogFooter>
                  <Button type="submit">{selectedDoc ? "Save changes" : "Create document"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="border-primary/20 bg-primary/[0.035]">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary"><ShieldCheck className="h-4 w-4" /></div>
            <div>
              <p className="text-sm font-medium">Credential boundary</p>
              <p className="text-xs text-muted-foreground">Keep passwords and secrets in Keeper. Use Hudu for controlled client documentation. Do not add credentials to NexusMSP notes or documents.</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => navigate("/hudu")}>Open Hudu</Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeroTile label="Documents" value={docs.length} icon={FileText} glow="sky" />
        <HeroTile label="Clients covered" value={coveredClients} icon={Folder} glow="emerald" />
        <HeroTile label="Global docs" value={docs.filter((doc) => !doc.client_id).length} icon={FileText} glow="violet" />
        <HeroTile label="Visible now" value={filteredDocs.length} icon={Search} glow="amber" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search titles, content, tags, or client…" />
        </div>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading documentation…</div>
      ) : filteredDocs.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredDocs.map((doc) => (
            <Card key={doc.id} className="group border-border/80 transition-colors hover:border-primary/35">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => openEditor(doc)}>
                    <div className="flex items-center gap-3">
                      <span className="rounded-lg bg-primary/10 p-2 text-primary"><FileText className="h-4 w-4" /></span>
                      <span className="min-w-0"><span className="block truncate text-sm font-semibold">{doc.title}</span><span className="block truncate text-xs text-muted-foreground">{doc.client_name || "Global documentation"}</span></span>
                    </div>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditor(doc)}>Edit document</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => deleteDocument(doc)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <button className="mt-4 w-full text-left" onClick={() => openEditor(doc)}>
                  <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-muted-foreground">{doc.content || "No content has been added yet."}</p>
                </button>
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                  <Badge variant="outline">{docCategories[doc.category] || "General"}</Badge>
                  <span className="text-xs text-muted-foreground">{doc.view_count || 0} views</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card><CardContent className="flex h-56 flex-col items-center justify-center text-center"><FileText className="mb-3 h-9 w-9 text-muted-foreground/60" /><p className="text-sm font-medium">No documentation found</p><p className="mt-1 text-xs text-muted-foreground">Try another filter or create the first document.</p></CardContent></Card>
      )}
    </div>
  );
}
