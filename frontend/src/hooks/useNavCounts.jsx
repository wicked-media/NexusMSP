/**
 * Global hook providing nav-bar notification counts.
 * Polls /api/nav-counts every 60s.
 */
import { useEffect, useState, useCallback, createContext, useContext } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";

const NavCountsContext = createContext({ counts: {}, refresh: () => {} });

export function NavCountsProvider({ children }) {
  const { token } = useAuth();
  const [counts, setCounts] = useState({});

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const r = await axios.get(`${API}/nav-counts`, { headers: { Authorization: `Bearer ${token}` } });
      setCounts(r.data || {});
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, [refresh]);

  return <NavCountsContext.Provider value={{ counts, refresh }}>{children}</NavCountsContext.Provider>;
}

export function useNavCounts() {
  return useContext(NavCountsContext);
}

/**
 * Apple-style notification badge (red pill, max "99+").
 * Use: <NavBadge count={5} />
 */
export function NavBadge({ count, dim = false, className = "" }) {
  if (!count) return null;
  const display = count > 99 ? "99+" : String(count);
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold leading-none ring-2 ring-zinc-950 ${
        dim ? "bg-zinc-600 text-zinc-200" : "bg-rose-500 text-white shadow-[0_0_8px_rgba(244,63,94,0.6)]"
      } ${className}`}
      data-testid="nav-badge"
    >
      {display}
    </span>
  );
}
