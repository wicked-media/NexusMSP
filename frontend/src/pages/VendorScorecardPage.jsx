import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Building2, DollarSign, Star, Package, Truck, Search, RefreshCw,
  Loader2, TrendingUp, TrendingDown, AlertTriangle, Eye, BarChart3,
  ShieldCheck, Clock, ArrowUpDown, ChevronRight
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, PieChart, Pie, Cell, CartesianGrid } from "recharts";

const RATING_CONFIG = {
  excellent: { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", label: "Excellent" },
  good: { color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/30", label: "Good" },
  average: { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", label: "Average" },
  poor: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/30", label: "Poor" },
};
const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

export default function VendorScorecardPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [sortBy, setSortBy] = useState("score");
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [tab, setTab] = useState("overview");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/vendor-scorecard/overview`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to load vendor data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const { summary, vendors } = data;
  const filtered = vendors.filter(v => {
    if (search && !v.vendor_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (ratingFilter !== "all" && v.rating !== ratingFilter) return false;
    return true;
  }).sort((a, b) => sortBy === "score" ? b.score - a.score : sortBy === "spend" ? b.total_spend - a.total_spend : b.fulfillment_rate - a.fulfillment_rate);

  const ratingBreakdown = ["excellent", "good", "average", "poor"].map(r => ({ name: r, value: vendors.filter(v => v.rating === r).length })).filter(r => r.value > 0);
  const categorySpend = {};
  vendors.forEach(v => { categorySpend[v.category] = (categorySpend[v.category] || 0) + v.total_spend; });
  const spendByCategory = Object.entries(categorySpend).map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value);
  const topSpenders = [...vendors].sort((a, b) => b.total_spend - a.total_spend).slice(0, 8);

  return (
    <div className="space-y-5" data-testid="vendor-scorecard-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center"><Building2 className="w-5 h-5 text-white" /></div>
            Vendor Scorecard & Spend Analytics
          </h1>
          <p className="text-muted-foreground mt-1">Track vendor performance, fulfillment rates, and spend optimization</p>
        </div>
        <Button variant="outline" onClick={fetchData} data-testid="refresh-vendors"><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Total Vendors", value: summary.total_vendors, icon: Building2, color: "text-blue-400" },
          { label: "Total Spend", value: `$${summary.total_spend.toLocaleString()}`, icon: DollarSign, color: "text-emerald-400" },
          { label: "Avg Score", value: summary.avg_score, icon: Star, color: "text-amber-400" },
          { label: "Top Vendor", value: summary.top_vendor, icon: Package, color: "text-purple-400", small: true },
          { label: "Avg Fulfillment", value: `${vendors.length > 0 ? Math.round(vendors.reduce((s, v) => s + v.fulfillment_rate, 0) / vendors.length) : 0}%`, icon: Truck, color: "text-cyan-400" },
        ].map(st => (
          <Card key={st.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`${st.small ? "text-lg" : "text-2xl"} font-bold ${st.color}`}>{st.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Performance Table</TabsTrigger>
          <TabsTrigger value="analytics">Spend Analytics</TabsTrigger>
          <TabsTrigger value="risk">Risk & Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3 mt-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search vendors..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="vendor-search" />
            </div>
            <Select value={ratingFilter} onValueChange={setRatingFilter}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Ratings</SelectItem>
                <SelectItem value="excellent">Excellent</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="average">Average</SelectItem>
                <SelectItem value="poor">Poor</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="score">Sort by Score</SelectItem>
                <SelectItem value="spend">Sort by Spend</SelectItem>
                <SelectItem value="fulfillment">Sort by Fulfillment</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="border-border/40">
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-8">#</TableHead><TableHead>Vendor</TableHead><TableHead>Category</TableHead><TableHead className="text-right">POs</TableHead>
                  <TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Fulfillment</TableHead>
                  <TableHead className="text-right">Avg Delivery</TableHead><TableHead>Score</TableHead><TableHead>Rating</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">No vendors match your filters</TableCell></TableRow>
                  ) : filtered.map((v, i) => {
                    const rc = RATING_CONFIG[v.rating] || RATING_CONFIG.average;
                    return (
                      <TableRow key={v.vendor_id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelectedVendor(v)} data-testid={`vendor-row-${v.vendor_id}`}>
                        <TableCell className="font-mono text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-semibold">{v.vendor_name}</TableCell>
                        <TableCell><Badge variant="outline" className="capitalize text-xs">{v.category}</Badge></TableCell>
                        <TableCell className="text-right font-mono">{v.total_pos}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">${v.total_spend.toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Progress value={v.fulfillment_rate} className="h-2 w-16" />
                            <span className="text-xs font-bold">{v.fulfillment_rate}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{v.avg_delivery_days > 0 ? `${v.avg_delivery_days}d` : "-"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={v.score} className="h-2 w-12" />
                            <span className="text-xs font-bold">{v.score}</span>
                          </div>
                        </TableCell>
                        <TableCell><span className={`text-xs font-semibold capitalize ${rc.color}`}>{v.rating}</span></TableCell>
                        <TableCell><ChevronRight className="w-4 h-4 text-muted-foreground" /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-border/40">
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4 text-blue-400" />Top Spenders</CardTitle></CardHeader>
              <CardContent>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topSpenders} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                      <YAxis dataKey="vendor_name" type="category" tick={{ fontSize: 10 }} width={100} />
                      <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={v => `$${v.toLocaleString()}`} />
                      <Bar dataKey="total_spend" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/40">
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-emerald-400" />Spend by Category</CardTitle></CardHeader>
              <CardContent>
                <div className="h-52 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={spendByCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {spendByCategory.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={v => `$${v.toLocaleString()}`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card className="border-border/40">
            <CardHeader><CardTitle className="text-sm">Vendor Rating Distribution</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-3">
                {ratingBreakdown.map(r => {
                  const rc = RATING_CONFIG[r.name] || RATING_CONFIG.average;
                  return (
                    <div key={r.name} className={`p-4 rounded-lg border ${rc.bg} text-center`}>
                      <p className={`text-3xl font-black ${rc.color}`}>{r.value}</p>
                      <p className="text-xs text-muted-foreground capitalize mt-1">{r.name}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risk" className="mt-4 space-y-3">
          <div className="space-y-3">
            {vendors.filter(v => v.rating === "poor" || v.rating === "average").length === 0 ? (
              <Card className="border-emerald-500/30"><CardContent className="py-12 text-center"><ShieldCheck className="w-12 h-12 mx-auto text-emerald-400/30 mb-3" /><p className="text-emerald-400 font-semibold">All vendors are performing well</p><p className="text-xs text-muted-foreground">No at-risk vendors detected</p></CardContent></Card>
            ) : vendors.filter(v => v.rating === "poor" || v.rating === "average").map(v => {
              const rc = RATING_CONFIG[v.rating];
              return (
                <Card key={v.vendor_id} className={`${rc.bg} border cursor-pointer hover:shadow-md transition-all`} onClick={() => setSelectedVendor(v)} data-testid={`risk-vendor-${v.vendor_id}`}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-background/50 flex items-center justify-center"><AlertTriangle className={`w-5 h-5 ${rc.color}`} /></div>
                      <div className="flex-1">
                        <p className="font-semibold">{v.vendor_name}</p>
                        <p className="text-xs text-muted-foreground">Score: {v.score}/100 | Fulfillment: {v.fulfillment_rate}% | Delivery: {v.avg_delivery_days}d avg</p>
                      </div>
                      <Badge className={`${rc.color} bg-transparent border capitalize`}>{v.rating}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Vendor Detail Dialog */}
      <Dialog open={!!selectedVendor} onOpenChange={() => setSelectedVendor(null)}>
        <DialogContent className="max-w-lg" aria-describedby="vendor-detail-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Building2 className="w-5 h-5 text-blue-400" />{selectedVendor?.vendor_name}</DialogTitle>
            <DialogDescription id="vendor-detail-desc">Vendor performance details</DialogDescription>
          </DialogHeader>
          {selectedVendor && (() => {
            const rc = RATING_CONFIG[selectedVendor.rating] || RATING_CONFIG.average;
            return (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Badge className={`${rc.color} bg-transparent border text-sm capitalize px-3 py-1`}>{selectedVendor.rating}</Badge>
                  <span className="text-2xl font-black">{selectedVendor.score}/100</span>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground text-xs">Category</span><p className="font-medium capitalize">{selectedVendor.category}</p></div>
                  <div><span className="text-muted-foreground text-xs">Contact</span><p className="font-medium">{selectedVendor.contact || "N/A"}</p></div>
                  <div><span className="text-muted-foreground text-xs">Total POs</span><p className="font-medium">{selectedVendor.total_pos}</p></div>
                  <div><span className="text-muted-foreground text-xs">Fulfilled</span><p className="font-medium">{selectedVendor.fulfilled}/{selectedVendor.total_pos}</p></div>
                  <div><span className="text-muted-foreground text-xs">Total Spend</span><p className="font-bold text-emerald-400">${selectedVendor.total_spend.toLocaleString()}</p></div>
                  <div><span className="text-muted-foreground text-xs">Avg Delivery</span><p className="font-medium">{selectedVendor.avg_delivery_days > 0 ? `${selectedVendor.avg_delivery_days} days` : "N/A"}</p></div>
                </div>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Fulfillment Rate</p>
                  <Progress value={selectedVendor.fulfillment_rate} className="h-3" />
                  <p className="text-right text-xs mt-1 font-bold">{selectedVendor.fulfillment_rate}%</p>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
