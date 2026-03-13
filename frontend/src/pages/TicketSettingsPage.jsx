import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Plus, Search, Loader2, Edit, Trash2, Tag, ChevronDown, ChevronRight,
  Settings, AlertCircle, RefreshCw, GripVertical, Folder, ListTree, ArrowLeft
} from "lucide-react";

const PRIORITY_COLORS = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

const ICONS = ["monitor", "code", "wifi", "shield", "mail", "cloud", "user-plus", "clipboard", "server", "phone", "printer", "database", "lock", "settings", "zap", "folder"];

export default function TicketSettingsPage() {
  const { token } = useAuth();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedCat, setExpandedCat] = useState(null);
  const [catDialog, setCatDialog] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const [issueDialog, setIssueDialog] = useState(false);
  const [issueCatId, setIssueCatId] = useState(null);
  const [catForm, setCatForm] = useState({ name: "", description: "", icon: "folder", color: "#3b82f6", sort_order: 99 });
  const [issueForm, setIssueForm] = useState({ name: "", description: "", priority: "medium" });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/ticket-categories/all`, { headers });
      setCategories(res.data);
    } catch { toast.error("Failed to load ticket categories"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchCategories(); }, []);

  const openAddCategory = () => {
    setEditingCat(null);
    setCatForm({ name: "", description: "", icon: "folder", color: "#3b82f6", sort_order: categories.length + 1 });
    setCatDialog(true);
  };

  const openEditCategory = (cat) => {
    setEditingCat(cat);
    setCatForm({ name: cat.name, description: cat.description || "", icon: cat.icon || "folder", color: cat.color || "#3b82f6", sort_order: cat.sort_order || 0 });
    setCatDialog(true);
  };

  const handleSaveCategory = async () => {
    if (!catForm.name) { toast.error("Category name is required"); return; }
    try {
      if (editingCat) {
        await axios.put(`${API}/ticket-categories/${editingCat.id}`, catForm, { headers });
        toast.success("Category updated");
      } else {
        await axios.post(`${API}/ticket-categories`, { ...catForm, issue_types: [] }, { headers });
        toast.success("Category created");
      }
      setCatDialog(false); fetchCategories();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save category"); }
  };

  const handleDeleteCategory = async (catId) => {
    try {
      await axios.delete(`${API}/ticket-categories/${catId}`, { headers });
      toast.success("Category deactivated");
      fetchCategories();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to delete"); }
  };

  const openAddIssue = (catId) => {
    setIssueCatId(catId);
    setIssueForm({ name: "", description: "", priority: "medium" });
    setIssueDialog(true);
  };

  const handleAddIssue = async () => {
    if (!issueForm.name) { toast.error("Issue name is required"); return; }
    try {
      await axios.post(`${API}/ticket-categories/${issueCatId}/issue-types`, issueForm, { headers });
      toast.success("Issue type added");
      setIssueDialog(false); fetchCategories();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to add issue type"); }
  };

  const handleDeleteIssue = async (catId, issueId) => {
    try {
      await axios.delete(`${API}/ticket-categories/${catId}/issue-types/${issueId}`, { headers });
      toast.success("Issue type removed");
      fetchCategories();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to remove issue type"); }
  };

  const toggleExpand = (catId) => setExpandedCat(expandedCat === catId ? null : catId);

  const activeCats = categories.filter(c => c.is_active);
  const inactiveCats = categories.filter(c => !c.is_active);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="ticket-settings-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ticket Categories & Issues</h1>
          <p className="text-muted-foreground">Configure ticket categories and their associated issue types for dropdown selection</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchCategories}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={openAddCategory} data-testid="add-category-btn"><Plus className="w-4 h-4 mr-1" />Add Category</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Folder className="w-5 h-5 text-blue-500" /><div><p className="text-xs text-muted-foreground">Categories</p><p className="text-xl font-bold">{activeCats.length}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><ListTree className="w-5 h-5 text-emerald-500" /><div><p className="text-xs text-muted-foreground">Total Issue Types</p><p className="text-xl font-bold">{activeCats.reduce((acc, c) => acc + (c.issue_types?.length || 0), 0)}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><AlertCircle className="w-5 h-5 text-amber-500" /><div><p className="text-xs text-muted-foreground">Inactive Categories</p><p className="text-xl font-bold">{inactiveCats.length}</p></div></div></CardContent></Card>
      </div>

      {/* Categories List */}
      <div className="space-y-2">
        {activeCats.map(cat => {
          const isExpanded = expandedCat === cat.id;
          const issueCount = cat.issue_types?.length || 0;
          return (
            <Card key={cat.id} className={`transition-all ${isExpanded ? "border-primary/40" : ""}`} data-testid={`category-card-${cat.id}`}>
              <CardContent className="py-0">
                {/* Category Header */}
                <div className="flex items-center justify-between py-4 cursor-pointer" onClick={() => toggleExpand(cat.id)}>
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: cat.color + "20" }}>
                      <Tag className="w-4 h-4" style={{ color: cat.color }} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{cat.name}</p>
                        <Badge variant="secondary" className="text-[10px]">{issueCount} issue{issueCount !== 1 ? "s" : ""}</Badge>
                      </div>
                      {cat.description && <p className="text-xs text-muted-foreground">{cat.description}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" className="h-7" onClick={() => openAddIssue(cat.id)} data-testid={`add-issue-${cat.id}`}><Plus className="w-3 h-3 mr-1" />Issue</Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditCategory(cat)} data-testid={`edit-cat-${cat.id}`}><Edit className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteCategory(cat.id)} data-testid={`delete-cat-${cat.id}`}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>

                {/* Issue Types List */}
                {isExpanded && (
                  <div className="pb-4 pl-12 space-y-1">
                    {(cat.issue_types || []).map(issue => {
                      const pc = PRIORITY_COLORS[issue.priority] || PRIORITY_COLORS.medium;
                      return (
                        <div key={issue.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors" data-testid={`issue-${issue.id}`}>
                          <div className="flex items-center gap-3">
                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cat.color }} />
                            <span className="text-sm">{issue.name}</span>
                            <Badge className={`text-[10px] ${pc}`}>{issue.priority}</Badge>
                          </div>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive opacity-0 group-hover:opacity-100 hover:opacity-100" onClick={() => handleDeleteIssue(cat.id, issue.id)} data-testid={`delete-issue-${issue.id}`}><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      );
                    })}
                    {issueCount === 0 && <p className="text-sm text-muted-foreground py-2">No issue types defined. Click "+ Issue" to add one.</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {activeCats.length === 0 && (
          <Card className="border-dashed"><CardContent className="py-12 text-center">
            <Tag className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-30" />
            <p className="text-muted-foreground mb-3">No ticket categories configured</p>
            <Button onClick={openAddCategory}><Plus className="w-4 h-4 mr-1" />Create First Category</Button>
          </CardContent></Card>
        )}
      </div>

      {/* Inactive Categories */}
      {inactiveCats.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">Inactive Categories</h3>
          <div className="space-y-2">
            {inactiveCats.map(cat => (
              <Card key={cat.id} className="opacity-60">
                <CardContent className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Tag className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm line-through">{cat.name}</span>
                    <Badge variant="outline" className="text-[10px]">{cat.issue_types?.length || 0} issues</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ===== CATEGORY DIALOG ===== */}
      <Dialog open={catDialog} onOpenChange={v => { setCatDialog(v); if (!v) setEditingCat(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingCat ? "Edit Category" : "New Ticket Category"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Category Name *</Label><Input value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} placeholder="e.g. Hardware, Network, Security" data-testid="cat-name-input" /></div>
            <div><Label>Description</Label><Textarea value={catForm.description} onChange={e => setCatForm({ ...catForm, description: e.target.value })} rows={2} placeholder="Brief description of this category" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Icon</Label>
                <Select value={catForm.icon} onValueChange={v => setCatForm({ ...catForm, icon: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ICONS.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Color</Label><Input type="color" value={catForm.color} onChange={e => setCatForm({ ...catForm, color: e.target.value })} className="h-10 cursor-pointer" data-testid="cat-color-input" /></div>
              <div><Label>Sort Order</Label><Input type="number" value={catForm.sort_order} onChange={e => setCatForm({ ...catForm, sort_order: parseInt(e.target.value) || 0 })} /></div>
            </div>
          </div>
          <DialogFooter><Button onClick={handleSaveCategory} data-testid="save-category-btn">{editingCat ? "Update" : "Create"} Category</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== ISSUE TYPE DIALOG ===== */}
      <Dialog open={issueDialog} onOpenChange={setIssueDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Issue Type</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Issue Name *</Label><Input value={issueForm.name} onChange={e => setIssueForm({ ...issueForm, name: e.target.value })} placeholder="e.g. Broken Equipment, Password Reset" data-testid="issue-name-input" /></div>
            <div><Label>Description</Label><Textarea value={issueForm.description} onChange={e => setIssueForm({ ...issueForm, description: e.target.value })} rows={2} placeholder="Optional description" /></div>
            <div><Label>Default Priority</Label>
              <Select value={issueForm.priority} onValueChange={v => setIssueForm({ ...issueForm, priority: v })}>
                <SelectTrigger data-testid="issue-priority-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={handleAddIssue} data-testid="save-issue-btn">Add Issue Type</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
