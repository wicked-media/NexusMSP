import { useEffect, useState } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { API } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Siren, CheckCircle2, Clock, Loader2, AlertTriangle } from "lucide-react";

const STATUS_INFO = {
  investigating: { cls: "text-rose-400 border-rose-500/40 bg-rose-500/10", label: "Investigating", icon: AlertTriangle },
  identified: { cls: "text-amber-400 border-amber-500/40 bg-amber-500/10", label: "Cause identified", icon: Clock },
  monitoring: { cls: "text-sky-400 border-sky-500/40 bg-sky-500/10", label: "Monitoring fix", icon: Clock },
  resolved: { cls: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10", label: "Resolved", icon: CheckCircle2 },
};

export default function WarRoomPublicPage() {
  const { slug } = useParams();
  const [wr, setWr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`${API}/warroom/public/${slug}`);
        setWr(res.data);
      } catch (e) {
        setError(e.response?.status === 404 ? "Status page not found" : "Unable to load status");
      } finally { setLoading(false); }
    };
    load();
    const iv = setInterval(load, 15000); // poll every 15s
    return () => clearInterval(iv);
  }, [slug]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-300"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading status…</div>;
  }
  if (error) {
    return <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-400"><div className="text-center"><Siren className="w-10 h-10 mx-auto mb-3 text-rose-500" /><p>{error}</p></div></div>;
  }

  const info = STATUS_INFO[wr.status] || STATUS_INFO.investigating;
  const Icon = info.icon;

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100 flex flex-col" data-testid="warroom-public-page">
      <div className="max-w-3xl mx-auto w-full px-6 py-10 flex-1">
        <div className="flex items-center gap-2 text-xs text-zinc-500 mb-4">
          <Siren className="w-3 h-3 text-rose-500" /> Incident Status · {wr.client_name || "Service"}
        </div>

        <Card className="bg-zinc-900/60 border-zinc-800">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Icon className={`w-7 h-7 ${info.cls.split(" ")[0]}`} />
              <h1 className="text-2xl font-light tracking-tight flex-1">{wr.title}</h1>
              <Badge variant="outline" className={info.cls}>{info.label}</Badge>
            </div>

            {wr.eta && wr.status !== "resolved" && (
              <div className="bg-zinc-800/60 border border-zinc-700 rounded-md px-4 py-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-400" />
                <span className="text-sm">Estimated resolution: <strong>{wr.eta}</strong></span>
              </div>
            )}

            {wr.summary && <p className="text-sm text-zinc-300 whitespace-pre-wrap">{wr.summary}</p>}

            {wr.resolved_notes && (
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-md p-4">
                <div className="text-[10px] uppercase tracking-widest text-emerald-400 mb-1">Resolution</div>
                <p className="text-sm whitespace-pre-wrap">{wr.resolved_notes}</p>
              </div>
            )}

            <div className="text-[10px] text-zinc-500">
              Opened {new Date(wr.created_at).toLocaleString()}
              {wr.resolved_at && <> · Resolved {new Date(wr.resolved_at).toLocaleString()}</>}
            </div>
          </CardContent>
        </Card>

        {/* Timeline */}
        <h2 className="text-xs uppercase tracking-widest text-zinc-500 mt-8 mb-3">Timeline</h2>
        <div className="space-y-3">
          {(wr.timeline || []).length === 0 ? (
            <p className="text-xs text-zinc-500">No updates yet — we'll post progress here as techs work.</p>
          ) : wr.timeline.slice().reverse().map(m => (
            <div key={m.id} className="bg-zinc-900/40 border border-zinc-800 rounded-md p-3">
              <div className="text-[10px] text-zinc-500">{new Date(m.ts).toLocaleString()}</div>
              <p className="text-sm mt-1 whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="text-center text-[10px] text-zinc-600 py-4">
        Auto-refreshes every 15 seconds · Powered by NexusOps
      </div>
    </div>
  );
}
