import { useRef, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
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

  const headers = { Authorization: `Bearer ${token}` };
  const src = resolveUrl(client.profile_picture_url);

  const upload = async (file) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await axios.post(`${API}/clients/${client.id}/profile-picture`, fd, {
        headers: { ...headers, "Content-Type": "multipart/form-data" },
      });
      toast.success("Profile picture updated");
      onUpdated?.({ profile_picture_url: res.data.profile_picture_url });
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

  const handleRemove = async () => {
    if (!window.confirm("Remove profile picture?")) return;
    try {
      await axios.delete(`${API}/clients/${client.id}/profile-picture`, { headers });
      toast.success("Profile picture removed");
      onUpdated?.({ profile_picture_url: "" });
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
          alt={client.name}
          className="w-full h-full rounded-md object-cover border border-zinc-700"
          data-testid="client-pp-img"
        />
      ) : (
        <div
          className="w-full h-full rounded-md flex items-center justify-center text-2xl font-bold text-white"
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
        className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
        data-testid="client-pp-upload-btn"
        title={src ? "Change picture" : "Upload picture"}
      >
        {uploading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
      </button>
      {src && (
        <button
          type="button"
          onClick={handleRemove}
          className="absolute -top-1 -right-1 p-1 rounded-full bg-rose-500/90 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-500"
          data-testid="client-pp-remove-btn"
          title="Remove"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

/** Cover banner — wide hero image at the top of the client header. */
export function ClientCoverImage({ client, onUpdated }) {
  const { token } = useAuth();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
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

  const handleRemove = async () => {
    if (!window.confirm("Remove cover image?")) return;
    try {
      await axios.delete(`${API}/clients/${client.id}/cover-image`, { headers });
      toast.success("Cover image removed");
      onUpdated?.({ cover_image_url: "" });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to remove");
    }
  };

  return (
    <div
      className="relative h-32 -mx-6 -mt-4 mb-4 overflow-hidden group"
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
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button size="sm" variant="outline" className="h-7 text-[10px] bg-black/60 border-white/20 text-white" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="client-cover-upload-btn">
          {uploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ImagePlus className="w-3 h-3 mr-1" />}
          {src ? "Change cover" : "Add cover"}
        </Button>
        {src && (
          <Button size="sm" variant="outline" className="h-7 text-[10px] bg-rose-500/40 border-rose-400/40 text-white" onClick={handleRemove} data-testid="client-cover-remove-btn">
            <Trash2 className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
