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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus, Search, Loader2, Edit, Trash2, Tag, ChevronDown, ChevronRight,
  Settings, AlertCircle, RefreshCw, Folder, ListTree, Hash, Save
} from "lucide-react";

const PRIORITY_COLORS = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

const ICONS = ["monitor", "code", "wifi", "shield", "mail", "cloud", "user-plus", "clipboard", "server", "phone", "printer", "database", "lock", "settings", "zap", "folder"];

const DEFAULT_SCHEME = {
  incident: { prefix: "INC", description: "Incidents" },
  service_request: { prefix: "SR", description: "Service Requests" },
  problem: { prefix: "PRB", description: "Problems" },
  change_request: { prefix: "CHG", description: "Change Requests" },
  alert: { prefix: "ALR", description: "Alerts/Monitoring" },
  task: { prefix: "TSK", description: "Tasks" },
  default: { prefix: "TKT", description: "Default/Other" },
};

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

  // Ticket numbering state
  const [numberingScheme, setNumberingScheme] = useState(DEFAULT_SCHEME);
  const [padDigits, setPadDigits] = useState(4);
  const [separator, setSeparator] = useState("-");
  const [numberingSaving, setNumberingSaving] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const [catRes, numRes] = await Promise.all([
        axios.get(`${API}/ticket-categories/all`, { headers }),
        axios.get(`${API}/ticket-numbering`, { headers }),
      ]);
      setCategories(catRes.data);
      if (numRes.data.scheme) setNumberingScheme(numRes.data.scheme);
      if (numRes.data.pad_digits) setPadDigits(numRes.data.pad_digits);
      if (numRes.data.separator) setSeparator(numRes.data.separator);
    } catch { toast.error("Failed to load settings"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchCategories(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const displaySeparator = separator === "none" ? "" : separator;
  const activeCats = categories.filter(c => c.is_active);
  const inactiveCats = categories.filter(c => !c.is_active);

  const handleSaveNumbering = async () => {
    setNumberingSaving(true);
    try {
      await axios.put(`${API}/ticket-numbering`, { scheme: numberingScheme, pad_digits: padDigits, separator: displaySeparator }, { headers });
      toast.success("Ticket numbering scheme saved");
    } catch { toast.error("Failed to save numbering scheme"); }
    finally { setNumberingSaving(false); }
  };

  const updatePrefix = (typeKey, prefix) => {
    setNumberingScheme(prev => ({
      ...prev,
      [typeKey]: { ...prev[typeKey], prefix: prefix.toUpperCase().replace(/[^A-Z0-9]/g, "") }
    }));
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="ticket-settings-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ticket Configuration</h1>
          <p className="text-muted-foreground">Manage ticket numbering, categories, and issue types</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchCategories}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      <Tabs defaultValue="numbering" className="w-full">
        <TabsList>
          <TabsTrigger value="numbering"><Hash className="w-3 h-3 mr-1" />Ticket Numbering</TabsTrigger>
          <TabsTrigger value="categories"><Tag className="w-3 h-3 mr-1" />Categories & Issues</TabsTrigger>
        </TabsList>

        {/* ===== NUMBERING SCHEME TAB ===== */}
        <TabsContent value="numbering" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Hash className="w-5 h-5 text-primary" />Ticket Number Scheme</CardTitle>
              <p className="text-sm text-muted-foreground">Configure how ticket numbers are generated based on ticket type. Inspired by Halo PSA, Syncro, and Flamingo MSP.</p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Global settings */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Separator Character</Label>
                  <Select value={separator} onValueChange={setSeparator}>
                    <SelectTrigger data-testid="separator-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="-">Hyphen ( - )</SelectItem>
                      <SelectItem value="#">Hash ( # )</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Number Padding (digits)</Label>
                  <Select value={String(padDigits)} onValueChange={v => setPadDigits(parseInt(v))}>
                    <SelectTrigger data-testid="padding-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">3 digits (001)</SelectItem>
                      <SelectItem value="4">4 digits (0001)</SelectItem>
                      <SelectItem value="5">5 digits (00001)</SelectItem>
                      <SelectItem value="6">6 digits (000001)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {/* Per-type prefix config */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Prefix by Ticket Type</Label>
                <div className="grid grid-cols-1 gap-2">
                  {Object.entries(numberingScheme).map(([typeKey, config]) => {
                    const exampleNum = `${config.prefix}${displaySeparator}${"1".padStart(padDigits, "0")}`;
                    return (
                      <div key={typeKey} className="flex items-center gap-4 py-2 px-3 rounded-lg bg-muted/30 border border-border/50" data-testid={`numbering-${typeKey}`}>
                        <div className="w-40">
                          <p className="text-sm font-medium capitalize">{typeKey.replace(/_/g, " ")}</p>
                          <p className="text-[10px] text-muted-foreground">{config.description}</p>
                        </div>
                        <div className="flex-1">
                          <Input
                            value={config.prefix}
                            onChange={e => updatePrefix(typeKey, e.target.value)}
                            className="h-8 w-28 font-mono text-sm uppercase"
                            maxLength={6}
                            data-testid={`prefix-${typeKey}`}
                          />
                        </div>
                        <div className="w-40 text-right">
                          <Badge variant="outline" className="font-mono text-xs">{exampleNum}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveNumbering} disabled={numberingSaving} data-testid="save-numbering-btn">
                  <Save className="w-4 h-4 mr-1" />{numberingSaving ? "Saving..." : "Save Numbering Scheme"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Preview Card */}
          <Card className="border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Preview Examples</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {Object.entries(numberingScheme).map(([typeKey, config]) => (
                  <div key={typeKey} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-muted/50 border">
                    <span className="text-xs text-muted-foreground capitalize">{typeKey.replace(/_/g, " ")}:</span>
                    <Badge className="font-mono bg-primary/10 text-primary border-primary/20">{config.prefix}{displaySeparator}{"42".padStart(padDigits, "0")}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== CATEGORIES TAB ===== */}
        <TabsContent value="categories" className="space-y-4">
          <div className="flex items-center justify-between">
            <div />
            <Button onClick={openAddCategory} data-testid="add-category-btn"><Plus className="w-4 h-4 mr-1" />Add Category</Button>
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
        </TabsContent>
      </Tabs>

      {/* CATEGORY DIALOG */}
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
                  <SelectContent>{ICONS.map(i => <SelectItem key={`k-${i}`} value={i}>{i}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Color</Label><Input type="color" value={catForm.color} onChange={e => setCatForm({ ...catForm, color: e.target.value })} className="h-10 cursor-pointer" data-testid="cat-color-input" /></div>
              <div><Label>Sort Order</Label><Input type="number" value={catForm.sort_order} onChange={e => setCatForm({ ...catForm, sort_order: parseInt(e.target.value) || 0 })} /></div>
            </div>
          </div>
          <DialogFooter><Button onClick={handleSaveCategory} data-testid="save-category-btn">{editingCat ? "Update" : "Create"} Category</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ISSUE TYPE DIALOG */}
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
