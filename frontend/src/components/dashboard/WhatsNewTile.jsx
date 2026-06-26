import { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ChevronRight, Loader2 } from "lucide-react";

const SEEN_KEY = "nx-whats-new-seen-v1";

const CATEGORY_COLOR = {
  feature: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  merge: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  fix: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  polish: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

export default function WhatsNewTile() {
  const { token } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const lastSeen = localStorage.getItem(SEEN_KEY) || "";
    const headers = { Authorization: `Bearer ${token}` };
    axios.get(`${API}/changelog/entries?limit=6`, { headers })
      .then(r => {
        if (cancelled) return;
        const rows = r.data?.entries || [];
        setEntries(rows);
        if (lastSeen) {
          setNewCount(rows.filter(e => (e.date || "") > lastSeen).length);
        } else {
          setNewCount(rows.length);
        }
      })
      .catch(() => { if (!cancelled) setEntries([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const markSeen = () => {
    const newest = entries[0]?.date;
    if (newest) localStorage.setItem(SEEN_KEY, newest);
    setNewCount(0);
  };

  return (
    <Card className="h-full p-4 flex flex-col gap-3 bg-gradient-to-br from-violet-500/5 via-transparent to-emerald-500/5 border-violet-500/20" data-testid="whats-new-tile">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-violet-300" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">What's New</p>
            <p className="text-[10px] text-muted-foreground">Recent platform updates</p>
          </div>
        </div>
        {newCount > 0 && (
          <Badge
            className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px]"
            data-testid="whats-new-counter"
          >
            {newCount} new
          </Badge>
        )}
      </div>

      <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="w-3 h-3 animate-spin" />Loading…
          </div>
        )}
        {!loading && entries.length === 0 && (
          <p className="text-xs text-muted-foreground py-4">No updates yet.</p>
        )}
        {!loading && entries.slice(0, 4).map(e => {
          const isNew = (() => {
            const seen = localStorage.getItem(SEEN_KEY) || "";
            return !seen || (e.date || "") > seen;
          })();
          const primary = (e.links || [])[0];
          return (
            <div
              key={e.id}
              data-testid={`whats-new-entry-${e.id}`}
              className="group rounded-lg border border-border/40 bg-background/40 px-3 py-2 hover:border-violet-500/40 hover:bg-violet-500/5 transition-colors"
            >
              <div className="flex items-start gap-2">
                {isNew && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-medium truncate">{e.title}</p>
                    {e.category && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border ${CATEGORY_COLOR[e.category] || "bg-muted/40 text-muted-foreground border-border/40"}`}>
                        {e.category}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{e.summary}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[9px] text-muted-foreground/70">{e.date}</span>
                    {primary && (
                      <Link
                        to={primary.to}
                        onClick={markSeen}
                        className="text-[9px] text-violet-300 hover:text-violet-200 inline-flex items-center"
                        data-testid={`whats-new-link-${e.id}`}
                      >
                        {primary.label}<ChevronRight className="w-2.5 h-2.5" />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border/30">
        <Link
          to="/help/whats-new"
          onClick={markSeen}
          className="text-[11px] text-violet-300 hover:text-violet-200 inline-flex items-center gap-1"
          data-testid="whats-new-view-all"
        >
          View full changelog<ChevronRight className="w-3 h-3" />
        </Link>
        {newCount > 0 && (
          <button
            onClick={markSeen}
            className="text-[10px] text-muted-foreground hover:text-foreground"
            data-testid="whats-new-mark-seen"
          >
            Mark all as seen
          </button>
        )}
      </div>
    </Card>
  );
}
