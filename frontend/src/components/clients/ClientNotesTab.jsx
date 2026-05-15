import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StickyNote, Trash2, Loader2, Pin, Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export default function ClientNotesTab({ client }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchNotes = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/clients/${client.id}/notes`, { headers });
      const data = res.data || [];
      // Pinned first, then newest
      data.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.created_at) - new Date(a.created_at));
      setNotes(data);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (client?.id) fetchNotes(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [client?.id]);

  const addNote = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      await axios.post(`${API}/clients/${client.id}/notes`, { body: body.trim(), pinned }, { headers });
      toast.success("Note added");
      setBody("");
      setPinned(false);
      await fetchNotes();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to add note");
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = async (id) => {
    if (!window.confirm("Delete this note?")) return;
    try {
      await axios.delete(`${API}/clients/${client.id}/notes/${id}`, { headers });
      toast.success("Note deleted");
      await fetchNotes();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <div className="space-y-4" data-testid="client-notes-tab">
      {/* Composer */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <Textarea
            rows={3}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Internal note — visible only to your team"
            data-testid="note-body-input"
          />
          <div className="flex items-center gap-2 justify-end">
            <Button
              variant={pinned ? "default" : "outline"}
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => setPinned(p => !p)}
              data-testid="note-pin-toggle"
            >
              <Pin className={`w-3 h-3 mr-1 ${pinned ? "text-amber-400" : ""}`} />{pinned ? "Will pin" : "Pin"}
            </Button>
            <Button size="sm" className="h-7 text-[11px]" onClick={addNote} disabled={saving || !body.trim()} data-testid="note-save-btn">
              {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Plus className="w-3 h-3 mr-1" />}
              Add Note
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-center py-12 text-zinc-500"><Loader2 className="w-5 h-5 mx-auto animate-spin" /></div>
      ) : notes.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-zinc-500 space-y-2">
          <StickyNote className="w-8 h-8 mx-auto opacity-30" />
          <p className="text-sm">No notes yet.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {notes.map(n => (
            <Card key={n.id} className={`group ${n.pinned ? "border-amber-500/40 bg-amber-500/5" : ""}`} data-testid={`note-${n.id}`}>
              <CardContent className="p-3 flex items-start gap-3">
                {n.pinned && <Pin className="w-3 h-3 text-amber-400 mt-1 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 whitespace-pre-wrap leading-snug">{n.body}</p>
                  <div className="text-[10px] text-zinc-500 font-mono mt-1.5 flex items-center gap-2">
                    <span>{n.author_name || "Unknown"}</span>
                    <span>·</span>
                    <span>{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-400 opacity-0 group-hover:opacity-100" onClick={() => deleteNote(n.id)} data-testid={`note-delete-${n.id}`}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
