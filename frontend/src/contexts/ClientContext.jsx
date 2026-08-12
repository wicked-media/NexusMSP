import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import axios from "axios";

const ClientContext = createContext(null);
const STORAGE_KEY = "nexusops_active_client_context";

export const useClientContext = () => useContext(ClientContext);

export function ClientContextProvider({ api, token, children }) {
  const [clients, setClients] = useState([]);
  const [activeClientId, setActiveClientId] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setClients([]);
      return;
    }
    let active = true;
    setLoading(true);
    axios.get(`${api}/clients`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (!active) return;
        const next = Array.isArray(response.data) ? response.data : [];
        setClients(next);
        setActiveClientId((current) => current && !next.some((client) => client.id === current) ? "" : current);
      })
      .catch(() => { if (active) setClients([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, token]);

  const setActiveClient = useCallback((clientId) => {
    const next = String(clientId || "");
    setActiveClientId(next);
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("nexus:client-context-change", { detail: { clientId: next } }));
  }, []);

  const value = useMemo(() => ({
    clients,
    activeClientId,
    activeClient: clients.find((client) => client.id === activeClientId) || null,
    setActiveClient,
    loading,
  }), [activeClientId, clients, loading, setActiveClient]);

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}
