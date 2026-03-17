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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { 
  Plus, 
  Search, 
  BookOpen,
  Eye,
  ThumbsUp,
  Loader2,
  FileText,
  Tag,
  RefreshCw,
  Download,
  ExternalLink
} from "lucide-react";

const categories = [
  { value: "general", label: "General" },
  { value: "windows", label: "Windows" },
  { value: "mac", label: "macOS" },
  { value: "network", label: "Network" },
  { value: "email", label: "Email" },
  { value: "security", label: "Security" },
  { value: "hardware", label: "Hardware" },
  { value: "software", label: "Software" }
];

export default function KnowledgeBasePage() {
  const { token, user } = useAuth();
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [viewArticle, setViewArticle] = useState(null);
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    category: "general",
    tags: "",
    is_public: false
  });
  const [syncing, setSyncing] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchArticles = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/kb-articles`, { headers });
      setArticles(response.data);
    } catch (error) {
      toast.error("Failed to fetch articles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArticles();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const submitData = {
        ...formData,
        tags: formData.tags.split(',').map(t => t.trim()).filter(t => t)
      };
      
      if (selectedArticle) {
        await axios.put(`${API}/kb-articles/${selectedArticle.id}`, submitData, { headers });
        toast.success("Article updated");
      } else {
        await axios.post(`${API}/kb-articles`, submitData, { headers });
        toast.success("Article created");
      }
      setIsDialogOpen(false);
      resetForm();
      fetchArticles();
    } catch (error) {
      toast.error("Failed to save article");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this article?")) return;
    try {
      await axios.delete(`${API}/kb-articles/${id}`, { headers });
      toast.success("Article deleted");
      fetchArticles();
    } catch (error) {
      toast.error("Failed to delete article");
    }
  };

  const handleHelpful = async (id) => {
    try {
      await axios.post(`${API}/kb-articles/${id}/helpful`, {}, { headers });
      toast.success("Thanks for the feedback!");
      fetchArticles();
    } catch (error) {
      toast.error("Failed to submit feedback");
    }
  };

  const viewFullArticle = async (article) => {
    try {
      const response = await axios.get(`${API}/kb-articles/${article.id}`, { headers });
      setViewArticle(response.data);
    } catch (error) {
      toast.error("Failed to load article");
    }
  };

  const resetForm = () => {
    setFormData({
      title: "",
      content: "",
      category: "general",
      tags: "",
      is_public: false
    });
    setSelectedArticle(null);
  };

  const openEditDialog = (article) => {
    setSelectedArticle(article);
    setFormData({
      title: article.title,
      content: article.content,
      category: article.category,
      tags: article.tags?.join(', ') || "",
      is_public: article.is_public
    });
    setIsDialogOpen(true);
  };

  const handleHuduSync = async () => {
    setSyncing(true);
    try {
      const res = await axios.post(`${API}/hudu/sync`, { max_pages: 10 }, { headers });
      toast.success(`Hudu Sync: ${res.data.imported} imported, ${res.data.updated} updated`);
      fetchArticles();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Hudu sync failed. Check Settings.");
    } finally {
      setSyncing(false);
    }
  };

  const filteredArticles = articles.filter(article => {
    const matchesSearch = article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          article.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === "all" || article.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6" data-testid="knowledge-base-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Knowledge Base</h1>
          <p className="text-muted-foreground">Documentation and troubleshooting guides</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleHuduSync} disabled={syncing} data-testid="hudu-sync-button">
            {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            {syncing ? "Syncing..." : "Sync from Hudu"}
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="create-article-button">
                <Plus className="w-4 h-4 mr-2" />
                New Article
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selectedArticle ? "Edit Article" : "Create New Article"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="How to troubleshoot..."
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) => setFormData({ ...formData, category: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map(cat => (
                        <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Tags (comma-separated)</Label>
                  <Input
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                    placeholder="windows, password, reset"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Content (Markdown supported)</Label>
                <Textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="# Getting Started&#10;&#10;Write your article content here..."
                  rows={12}
                  className="font-mono text-sm"
                  required
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Public Article</Label>
                  <p className="text-xs text-muted-foreground">Visible to clients</p>
                </div>
                <Switch
                  checked={formData.is_public}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_public: checked })}
                />
              </div>
              <DialogFooter>
                <Button type="submit">
                  {selectedArticle ? "Update" : "Create Article"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{articles.length}</p>
              <p className="text-xs text-muted-foreground">Total Articles</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Eye className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{articles.reduce((sum, a) => sum + (a.views || 0), 0)}</p>
              <p className="text-xs text-muted-foreground">Total Views</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <ThumbsUp className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{articles.reduce((sum, a) => sum + (a.helpful_count || 0), 0)}</p>
              <p className="text-xs text-muted-foreground">Helpful Votes</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search articles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* View Article Dialog */}
      <Dialog open={!!viewArticle} onOpenChange={(open) => !open && setViewArticle(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{viewArticle?.title}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[60vh] pr-4">
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{categories.find(c => c.value === viewArticle?.category)?.label}</Badge>
                {viewArticle?.tags?.map(tag => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    <Tag className="w-3 h-3 mr-1" />
                    {tag}
                  </Badge>
                ))}
              </div>
              <div className="prose prose-invert max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                  {viewArticle?.content}
                </pre>
              </div>
              <div className="flex items-center justify-between pt-4 border-t">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Eye className="w-4 h-4" />
                    {viewArticle?.views} views
                  </span>
                  <span>By {viewArticle?.author_name}</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleHelpful(viewArticle?.id)}>
                  <ThumbsUp className="w-4 h-4 mr-2" />
                  Helpful ({viewArticle?.helpful_count || 0})
                </Button>
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Articles Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredArticles.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredArticles.map(article => (
            <Card key={article.id} className="card-hover cursor-pointer" onClick={() => viewFullArticle(article)}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <Badge variant="outline" className="mb-2">
                    {categories.find(c => c.value === article.category)?.label}
                  </Badge>
                  {article.is_public && (
                    <Badge variant="secondary" className="text-xs">Public</Badge>
                  )}
                </div>
                <CardTitle className="text-lg line-clamp-2">{article.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                  {article.content.substring(0, 150)}...
                </p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Eye className="w-3 h-3" />
                      {article.views}
                    </span>
                    <span className="flex items-center gap-1">
                      <ThumbsUp className="w-3 h-3" />
                      {article.helpful_count || 0}
                    </span>
                  </div>
                  <span>{article.author_name}</span>
                </div>
                {article.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {article.tags.slice(0, 3).map(tag => (
                      <Badge key={tag} variant="outline" className="text-xs px-1.5 py-0">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64">
            <BookOpen className="w-12 h-12 text-muted-foreground opacity-50 mb-4" />
            <p className="text-muted-foreground">No articles found</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
