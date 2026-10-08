import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { signalIndex } from "@/lib/clientWorkspaceLearning";

const EMPTY_MEMORY = { personal: [], team: [], memory: null };

/**
 * Ignore a repeat of the same signal inside this window, so one visit to a view
 * counts once instead of once per render, and the recorded evidence keeps
 * meaning "how often this technician opens it".
 */
const SIGNAL_DEDUPE_MS = 5000;

/**
 * What Nexus has learned about this technician's client workspace habits.
 *
 * Reading and recording are both best effort by design: the workspace has a
 * designed order and always works without memory, so a failed read leaves that
 * order in place and a failed write is not worth interrupting anybody's work
 * over. Forgetting is the exception — it changes what the workspace shows, so it
 * reports its own failure to the caller.
 */
export function useClientWorkspaceLearning(token) {
  const [memory, setMemory] = useState(EMPTY_MEMORY);
  const recentSignals = useRef(new Map());
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    axios.get(`${API}/client-workspace/learning`, { headers })
      .then(({ data }) => {
        if (!active) return;
        setMemory({
          personal: Array.isArray(data?.personal) ? data.personal : [],
          team: Array.isArray(data?.team) ? data.team : [],
          memory: data?.memory || null,
        });
      })
      .catch(() => { /* No memory yet: the workspace keeps its designed order. */ });
    return () => { active = false; };
  }, [token, headers]);

  const record = useCallback((surface, target) => {
    if (!token || !surface || !target) return;
    const key = `${surface}:${String(target).trim().toLowerCase()}`;
    const now = Date.now();
    const last = recentSignals.current.get(key) || 0;
    if (now - last < SIGNAL_DEDUPE_MS) return;
    recentSignals.current.set(key, now);
    axios
      .post(`${API}/client-workspace/learning/signals`, { surface, target: key.slice(surface.length + 1) }, { headers })
      .catch(() => { /* Learning is an enhancement; it never blocks the workspace. */ });
  }, [token, headers]);

  const forget = useCallback(async () => {
    const response = await axios.delete(`${API}/client-workspace/learning`, { headers });
    recentSignals.current.clear();
    setMemory(EMPTY_MEMORY);
    return Number(response.data?.removed || 0);
  }, [headers]);

  const personal = useMemo(() => signalIndex(memory.personal), [memory.personal]);
  const team = useMemo(() => signalIndex(memory.team), [memory.team]);

  return useMemo(
    () => ({ personal, team, memory: memory.memory, record, forget }),
    [personal, team, memory.memory, record, forget],
  );
}

export default useClientWorkspaceLearning;
