import { Bookmark, Building2, Monitor, Ticket, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const STORAGE_KEY = "nexus-object-dock";
const icons = { ticket: Ticket, client: Building2, device: Monitor };

function readDock() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(item => item?.id && item?.path).slice(0, 8) : [];
  } catch { return []; }
}

/** Explicit, browser-local work context. Objects are only added by a user action. */
export default function NexusObjectDock() {
  const navigate = useNavigate();
  const [items, setItems] = useState(readDock);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* storage unavailable */ } }, [items]);
  useEffect(() => {
    const pin = (event) => {
      const item = event.detail;
      if (!item?.id || !item?.path || !item?.label) return;
      setItems(current => [item, ...current.filter(existing => `${existing.type}:${existing.id}` !== `${item.type}:${item.id}`)].slice(0, 8));
    };
    window.addEventListener("nexus:pin-object", pin);
    return () => window.removeEventListener("nexus:pin-object", pin);
  }, []);
  const ordered = useMemo(() => items.slice(0, 6), [items]);
  if (!ordered.length) return null;
  return <aside className="nexus-object-dock" aria-label="Nexus Object Dock" data-testid="nexus-object-dock"><span className="nexus-object-dock__label"><Bookmark />Pinned</span><div className="nexus-object-dock__items">{ordered.map(item => { const Icon = icons[item.type] || Bookmark; return <div key={`${item.type}:${item.id}`} className="nexus-object-dock__item"><button type="button" onClick={() => navigate(item.path)} className="nexus-object-dock__open" title={`Open ${item.label}`}><Icon /><span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span></button><button type="button" className="nexus-object-dock__remove" onClick={() => setItems(current => current.filter(existing => `${existing.type}:${existing.id}` !== `${item.type}:${item.id}`))} aria-label={`Remove ${item.label} from object dock`}><X /></button></div>; })}</div></aside>;
}
