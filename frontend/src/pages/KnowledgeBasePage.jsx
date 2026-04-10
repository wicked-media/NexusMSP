import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus, Search, BookOpen, Eye, ThumbsUp, Loader2, FileText, Tag,
  RefreshCw, Pin, Globe, Lock, Edit, Trash2, Clock, User, Star,
  ArrowLeft, Link2, CheckCircle, ChevronRight
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

const categories = [
  { value: "general", label: "General", color: "bg-slate-500/20 text-slate-400" },
  { value: "windows", label: "Windows", color: "bg-blue-500/20 text-blue-400" },
  { value: "mac", label: "macOS", color: "bg-gray-500/20 text-gray-400" },
  { value: "network", label: "Network", color: "bg-emerald-500/20 text-emerald-400" },
  { value: "email", label: "Email", color: "bg-purple-500/20 text-purple-400" },
  { value: "security", label: "Security", color: "bg-red-500/20 text-red-400" },
  { value: "hardware", label: "Hardware", color: "bg-orange-500/20 text-orange-400" },
  { value: "software", label: "Software", color: "bg-cyan-500/20 text-cyan-400" },
  { value: "onboarding", label: "Onboarding", color: "bg-yellow-500/20 text-yellow-400" },
  { value: "procedures", label: "Procedures", color: "bg-pink-500/20 text-pink-400" }
];

export default function KnowledgeBasePage() {
  const { token, user } = useAuth();
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [viewArticle, setViewArticle] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const [huduSyncing, setHuduSyncing] = useState(false);
  const [huduArticles, setHuduArticles] = useState([]);
  const [showHuduPanel, setShowHuduPanel] = useState(false);
  const [formData, setFormData] = useState({
    title: "", content: "", category: "general", tags: "",
    is_public: false, is_pinned: false, related_article_ids: []
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchArticles = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/kb-articles`, { headers });
      setArticles(res.data);
    } catch { toast.error("Failed to fetch articles"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchArticles(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchHuduArticles = async () => {
    try {
      const res = await axios.get(`${API}/hudu/articles`, { headers });
      setHuduArticles(res.data.articles || res.data || []);
    } catch { setHuduArticles([]); }
  };

  const syncFromHudu = async () => {
    setHuduSyncing(true);
    try {
      const res = await axios.post(`${API}/hudu/sync`, {}, { headers });
      toast.success(res.data.message || `Synced ${res.data.synced || 0} articles from Hudu`);
      fetchArticles();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Hudu sync failed. Check Hudu settings in Settings page.");
    } finally { setHuduSyncing(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      ...formData,
      tags: formData.tags.split(",").map(t => t.trim()).filter(Boolean),
    };
    try {
      if (selectedArticle) {
        await axios.put(`${API}/kb-articles/${selectedArticle.id}`, payload, { headers });
        toast.success("Article updated");
      } else {
        await axios.post(`${API}/kb-articles`, payload, { headers });
        toast.success("Article created");
      }
      setIsDialogOpen(false);
      resetForm();
      fetchArticles();
    } catch { toast.error("Failed to save article"); }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this article?")) return;
    try {
      await axios.delete(`${API}/kb-articles/${id}`, { headers });
      toast.success("Article deleted");
      if (viewArticle?.id === id) setViewArticle(null);
      fetchArticles();
    } catch { toast.error("Failed to delete"); }
  };

  const handleHelpful = async (id) => {
    try {
      await axios.post(`${API}/kb-articles/${id}/helpful`, {}, { headers });
      toast.success("Marked as helpful");
      fetchArticles();
    } catch { toast.error("Failed"); }
  };

  const togglePin = async (article) => {
    try {
      await axios.put(`${API}/kb-articles/${article.id}`, { is_pinned: !article.is_pinned }, { headers });
      toast.success(article.is_pinned ? "Unpinned" : "Pinned");
      fetchArticles();
    } catch { toast.error("Failed"); }
  };

  const toggleVisibility = async (article) => {
    try {
      await axios.put(`${API}/kb-articles/${article.id}`, { is_public: !article.is_public }, { headers });
      toast.success(article.is_public ? "Made internal" : "Made public");
      fetchArticles();
    } catch { toast.error("Failed"); }
  };

  const openEdit = (article) => {
    setSelectedArticle(article);
    setFormData({
      title: article.title, content: article.content, category: article.category,
      tags: (article.tags || []).join(", "),
      is_public: article.is_public || false,
      is_pinned: article.is_pinned || false,
      related_article_ids: article.related_article_ids || []
    });
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({ title: "", content: "", category: "general", tags: "", is_public: false, is_pinned: false, related_article_ids: [] });
    setSelectedArticle(null);
  };

  const getCategoryStyle = (cat) => categories.find(c => c.value === cat)?.color || "bg-slate-500/20 text-slate-400";

  const filteredArticles = articles.filter(a => {
    const matchSearch = !searchQuery || a.title.toLowerCase().includes(searchQuery.toLowerCase()) || a.content?.toLowerCase().includes(searchQuery.toLowerCase()) || (a.tags || []).some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchCategory = categoryFilter === "all" || a.category === categoryFilter;
    const matchVisibility = visibilityFilter === "all" || (visibilityFilter === "public" && a.is_public) || (visibilityFilter === "internal" && !a.is_public);
    const matchTab = activeTab === "all" || (activeTab === "pinned" && a.is_pinned) || (activeTab === "public" && a.is_public);
    return matchSearch && matchCategory && matchVisibility && matchTab;
  });

  const pinnedArticles = articles.filter(a => a.is_pinned);
  const relatedArticles = viewArticle ? articles.filter(a => a.id !== viewArticle.id && a.category === viewArticle.category).slice(0, 5) : [];

  // View Article Detail
  if (viewArticle) {
    return (
      <div className="space-y-6" data-testid="kb-article-view">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => setViewArticle(null)} data-testid="back-to-kb"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {viewArticle.is_pinned && <Pin className="w-4 h-4 text-amber-500" />}
              <h1 className="text-2xl font-bold">{viewArticle.title}</h1>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <Badge className={getCategoryStyle(viewArticle.category)}>{categories.find(c => c.value === viewArticle.category)?.label || viewArticle.category}</Badge>
              <Badge variant="outline" className="gap-1">{viewArticle.is_public ? <><Globe className="w-3 h-3" />Public</> : <><Lock className="w-3 h-3" />Internal</>}</Badge>
              <span className="text-xs text-muted-foreground flex items-center gap-1"><Eye className="w-3 h-3" />{viewArticle.views || 0} views</span>
              <span className="text-xs text-muted-foreground flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{viewArticle.helpful_count || 0} helpful</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleHelpful(viewArticle.id)} data-testid="helpful-btn"><ThumbsUp className="w-4 h-4 mr-1" />Helpful</Button>
            <Button variant="outline" size="sm" onClick={() => openEdit(viewArticle)}><Edit className="w-4 h-4 mr-1" />Edit</Button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-9">
            <Card>
              <CardContent className="p-6">
                <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap" data-testid="article-content">{viewArticle.content}</div>
              </CardContent>
            </Card>
            {viewArticle.tags?.length > 0 && (
              <div className="flex items-center gap-2 mt-4">
                <Tag className="w-4 h-4 text-muted-foreground" />
                {viewArticle.tags.map((tag, i) => (<Badge key={`k-${i}`} variant="outline" className="text-xs">{tag}</Badge>))}
              </div>
            )}
            <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><User className="w-3 h-3" />{viewArticle.author_name || "Admin"}</span>
              {viewArticle.created_at && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDistanceToNow(new Date(viewArticle.created_at), { addSuffix: true })}</span>}
            </div>
          </div>
          <div className="col-span-3 space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><Link2 className="w-4 h-4" />Related Articles</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {relatedArticles.length > 0 ? relatedArticles.map(a => (
                  <div key={a.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer" onClick={() => setViewArticle(a)} data-testid={`related-${a.id}`}>
                    <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs truncate">{a.title}</span>
                  </div>
                )) : <p className="text-xs text-muted-foreground">No related articles</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="knowledge-base-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Knowledge Base</h1><p className="text-muted-foreground">{articles.length} articles - {pinnedArticles.length} pinned</p></div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={syncFromHudu} disabled={huduSyncing} data-testid="hudu-sync-btn">
            {huduSyncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Sync from Hudu
          </Button>
          <Button variant="outline" onClick={fetchArticles}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <Button onClick={() => setIsDialogOpen(true)} data-testid="create-article-btn"><Plus className="w-4 h-4 mr-2" />New Article</Button>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>{selectedArticle ? "Edit Article" : "Create Article"}</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2"><Label>Title *</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="How to reset a Windows password" required /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Category</Label>
                    <Select value={formData.category} onValueChange={v => setFormData({ ...formData, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{categories.map(c => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>Tags (comma separated)</Label><Input value={formData.tags} onChange={e => setFormData({ ...formData, tags: e.target.value })} placeholder="password, windows, reset" /></div>
                </div>
                <div className="space-y-2"><Label>Content *</Label>
                  <Textarea value={formData.content} onChange={e => setFormData({ ...formData, content: e.target.value })} className="min-h-[200px] font-mono text-sm" placeholder="Step-by-step instructions..." required />
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2"><Switch checked={formData.is_public} onCheckedChange={v => setFormData({ ...formData, is_public: v })} /><Label className="flex items-center gap-1">{formData.is_public ? <Globe className="w-4 h-4" /> : <Lock className="w-4 h-4" />}{formData.is_public ? "Public" : "Internal Only"}</Label></div>
                  <div className="flex items-center gap-2"><Switch checked={formData.is_pinned} onCheckedChange={v => setFormData({ ...formData, is_pinned: v })} /><Label className="flex items-center gap-1"><Pin className="w-4 h-4" />Pin to Top</Label></div>
                </div>
                <DialogFooter><Button type="submit">{selectedArticle ? "Update" : "Create Article"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><BookOpen className="w-5 h-5 text-blue-500" /></div><div><p className="text-2xl font-bold">{articles.length}</p><p className="text-xs text-muted-foreground">Total Articles</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center"><Pin className="w-5 h-5 text-amber-500" /></div><div><p className="text-2xl font-bold">{pinnedArticles.length}</p><p className="text-xs text-muted-foreground">Pinned</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><Globe className="w-5 h-5 text-green-500" /></div><div><p className="text-2xl font-bold">{articles.filter(a => a.is_public).length}</p><p className="text-xs text-muted-foreground">Public</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center"><Eye className="w-5 h-5 text-purple-500" /></div><div><p className="text-2xl font-bold">{articles.reduce((s, a) => s + (a.views || 0), 0)}</p><p className="text-xs text-muted-foreground">Total Views</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center"><ThumbsUp className="w-5 h-5 text-cyan-500" /></div><div><p className="text-2xl font-bold">{articles.reduce((s, a) => s + (a.helpful_count || 0), 0)}</p><p className="text-xs text-muted-foreground">Helpful Votes</p></div></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Search articles, tags..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" /></div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}><SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Categories</SelectItem>{categories.map(c => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}</SelectContent></Select>
        <Select value={visibilityFilter} onValueChange={setVisibilityFilter}><SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Visibility</SelectItem><SelectItem value="public">Public</SelectItem><SelectItem value="internal">Internal</SelectItem></SelectContent></Select>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All Articles</TabsTrigger>
          <TabsTrigger value="pinned" className="gap-1"><Pin className="w-3 h-3" />Pinned ({pinnedArticles.length})</TabsTrigger>
          <TabsTrigger value="public" className="gap-1"><Globe className="w-3 h-3" />Public</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab}>
          {loading ? (
            <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>
          ) : filteredArticles.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
              {filteredArticles.map(article => (
                <Card key={article.id} className={`cursor-pointer hover:border-primary/30 transition-all hover:shadow-md ${article.is_pinned ? "border-amber-500/30" : ""}`}
                  onClick={() => setViewArticle(article)} data-testid={`kb-article-${article.id}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {article.is_pinned && <Pin className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
                        <h3 className="font-semibold text-sm line-clamp-2">{article.title}</h3>
                      </div>
                      <Badge variant="outline" className="text-[9px] flex-shrink-0 ml-2">{article.is_public ? <Globe className="w-2.5 h-2.5 mr-0.5" /> : <Lock className="w-2.5 h-2.5 mr-0.5" />}{article.is_public ? "Public" : "Internal"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3 mb-3">{article.content?.substring(0, 150)}...</p>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className={`text-[9px] ${getCategoryStyle(article.category)}`}>{categories.find(c => c.value === article.category)?.label || article.category}</Badge>
                      {article.tags?.slice(0, 2).map((tag, i) => (<Badge key={`k-${i}`} variant="outline" className="text-[9px]">{tag}</Badge>))}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{article.views || 0}</span>
                        <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{article.helpful_count || 0}</span>
                      </div>
                      {article.created_at && <span>{formatDistanceToNow(new Date(article.created_at), { addSuffix: true })}</span>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 mt-4"><BookOpen className="w-12 h-12 text-muted-foreground opacity-50 mb-4" /><p className="text-muted-foreground">No articles found</p></div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
