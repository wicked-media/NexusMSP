import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, AlertTriangle, Loader2 } from "lucide-react";

const TIER_TONE = {
  hot: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  warm: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  cold: "text-rose-400 border-rose-500/40 bg-rose-500/10",
};

/** Win-probability + pricing-flags side panel for an estimate. */
export function EstimateAIBundle({ estimateId }) {
  const { token } = useAuth();
  const [win, setWin] = useState(null);
  const [flags, setFlags] = useState(null);

  useEffect(() => {
    let m = true;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      axios.get(`${API}/estimates/${estimateId}/win-probability`, { headers }).then(r => r.data).catch(() => null),
      axios.get(`${API}/estimates/${estimateId}/pricing-flags`, { headers }).then(r => r.data).catch(() => null),
    ]).then(([w, f]) => { if (m) { setWin(w); setFlags(f); } });
    return () => { m = false; };
  }, [estimateId, token]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="estimate-ai-bundle">
      <Card className="border-emerald-500/20 bg-emerald-500/[0.03]">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" />Win Probability</CardTitle></CardHeader>
        <CardContent className="text-xs space-y-2">
          {!win ? <div className="text-muted-foreground"><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Scoring…</div> :
            <>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={`${TIER_TONE[win.tier] || ""} text-base px-3 py-1`} data-testid="winprob-badge">
                  {win.win_probability}% · {win.tier}
                </Badge>
              </div>
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                {(win.drivers || []).map((d, i) => <li key={`k-${i}`}>{d}</li>)}
              </ul>
              <div className="text-[10px] text-muted-foreground">History: {win.history?.approved} won · {win.history?.declined} lost · avg won ${(win.history?.avg_approved_total || 0).toLocaleString()}</div>
            </>}
        </CardContent>
      </Card>

      <Card className="border-amber-500/20 bg-amber-500/[0.03]">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400" />Competitive Pricing</CardTitle></CardHeader>
        <CardContent className="text-xs space-y-1.5">
          {!flags ? <div className="text-muted-foreground"><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Scanning…</div> :
            (flags.flags || []).length === 0 ? <div className="text-emerald-400">No pricing concerns. Margins look healthy.</div> :
              (flags.flags || []).map((f, i) => (
                <div key={`k-${i}`} className={`rounded border p-2 ${f.severity === "error" ? "border-rose-500/40 bg-rose-500/5 text-rose-400" : "border-amber-500/40 bg-amber-500/5 text-amber-400"}`} data-testid={`pricing-flag-${i}`}>
                  <div className="font-medium text-foreground">{f.item} <Badge variant="outline" className="text-[9px] ml-1">{f.code}</Badge></div>
                  <div className="text-[11px] mt-0.5">{f.message}</div>
                </div>
              ))}
          {flags && <div className="text-[10px] text-muted-foreground">Items checked: {flags.items_checked}</div>}
        </CardContent>
      </Card>
    </div>
  );
}
