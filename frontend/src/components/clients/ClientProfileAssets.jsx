import { useRef, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Camera, Trash2, Loader2, ImagePlus } from "lucide-react";
import { toast } from "sonner";

const BACKEND = process.env.REACT_APP_BACKEND_URL;

function resolveUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${BACKEND}${url}`;
}

/** Circular profile picture uploader — sits in client hero header. */
export function ClientProfilePictureUploader({ client, onUpdated, size = 80 }) {
  const { token } = useAuth();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };
  const src = resolveUrl(client.logo_url || client.profile_picture_url);

  const upload = async (file) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await axios.post(`${API}/clients/${client.id}/logo`, fd, {
        headers: { ...headers, "Content-Type": "multipart/form-data" },
      });
      toast.success("Business logo updated");
      onUpdated?.({ logo_url: res.data.logo_url });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error("Only image files allowed"); return; }
    upload(f);
    e.target.value = "";
  };

  const handleRemove = async (confirmed = false) => {
    if (!confirmed) { setConfirmRemove(true); return; }
    try {
      await axios.delete(`${API}/clients/${client.id}/logo`, { headers });
      toast.success("Business logo removed");
      setConfirmRemove(false);
      onUpdated?.({ logo_url: "" });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to remove");
    }
  };

  const initials = client.name?.slice(0, 2).toUpperCase() || "?";

  return (
    <div className="relative group shrink-0" style={{ width: size, height: size }}>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} data-testid="client-pp-input" />
      {src ? (
        <img
          src={src}
          alt={`${client.name} business logo`}
          className="h-full w-full rounded-xl border border-white/15 bg-background object-cover"
          data-testid="client-pp-img"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-xl text-2xl font-bold text-white"
          style={{ background: "linear-gradient(135deg, #6366f1, #a78bfa)" }}
          data-testid="client-pp-fallback"
        >
          {initials}
        </div>
      )}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        data-testid="client-pp-upload-btn"
        title={src ? "Change business logo" : "Upload business logo"}
      >
        {uploading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
      </button>
      {src && (
        <button
          type="button"
          onClick={handleRemove}
          className="absolute -top-1 -right-1 p-1 rounded-full bg-rose-500/90 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-500"
          data-testid="client-pp-remove-btn"
          title="Remove business logo"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <NexusWorkflowDialog eyebrow="Client identity" title="Remove business logo?" description="The client will revert to its default identifier across the client workspace and branded ticket surfaces." icon={Trash2} tone="amber" footer={<><Button variant="outline" onClick={() => setConfirmRemove(false)}>Keep logo</Button><Button variant="destructive" onClick={() => handleRemove(true)}>Remove logo</Button></>}>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-sm text-muted-foreground">Keep the logo where client-facing ticket, report, or portal branding still needs it.</div>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}

/** Cover banner — wide hero image at the top of the client header. */
export function ClientCoverImage({ client, onUpdated, children }) {
  const { token } = useAuth();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const src = resolveUrl(client.cover_image_url);

  const upload = async (file) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await axios.post(`${API}/clients/${client.id}/cover-image`, fd, {
        headers: { ...headers, "Content-Type": "multipart/form-data" },
      });
      toast.success("Cover image updated");
      onUpdated?.({ cover_image_url: res.data.cover_image_url });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error("Only image files allowed"); return; }
    upload(f);
    e.target.value = "";
  };

  const handleRemove = async (confirmed = false) => {
    if (!confirmed) { setConfirmRemove(true); return; }
    try {
      await axios.delete(`${API}/clients/${client.id}/cover-image`, { headers });
      toast.success("Cover image removed");
      setConfirmRemove(false);
      onUpdated?.({ cover_image_url: "" });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to remove");
    }
  };

  return (
    <div
      className="group relative h-32 overflow-hidden rounded-t-2xl sm:h-36"
      style={{
        background: src
          ? `url(${src}) center/cover`
          : "linear-gradient(135deg, rgba(99, 102, 241, 0.18) 0%, rgba(167, 139, 250, 0.08) 50%, rgba(34, 211, 238, 0.18) 100%)",
      }}
      data-testid="client-cover-banner"
    >
      {!src && (
        <div className="absolute inset-0 opacity-30 pointer-events-none" style={{
          backgroundImage: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.06) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.04) 0%, transparent 60%)",
        }} />
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} data-testid="client-cover-input" />
      <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Button size="sm" variant="outline" className="h-8 border-white/20 bg-black/60 text-[10px] text-white hover:bg-black/80" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="client-cover-upload-btn">
          {uploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ImagePlus className="w-3 h-3 mr-1" />}
          {src ? "Change cover" : "Add cover"}
        </Button>
        {src && (
          <Button size="sm" variant="outline" className="h-8 border-rose-400/40 bg-rose-500/40 text-white hover:bg-rose-500/60" onClick={handleRemove} data-testid="client-cover-remove-btn">
            <Trash2 className="w-3 h-3" />
          </Button>
        )}
      </div>
      {children && <div className="absolute left-4 right-32 top-4 z-10">{children}</div>}
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <NexusWorkflowDialog eyebrow="Client identity" title="Remove cover image?" description="The client workspace will return to the standard Nexus cover treatment until a new image is uploaded." icon={Trash2} tone="amber" footer={<><Button variant="outline" onClick={() => setConfirmRemove(false)}>Keep cover</Button><Button variant="destructive" onClick={() => handleRemove(true)}>Remove cover</Button></>}>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-sm text-muted-foreground">This changes the client profile’s visual identity but does not remove its business logo or any documents.</div>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}
