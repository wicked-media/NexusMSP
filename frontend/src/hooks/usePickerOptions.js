import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";

const toItem = (row) => ({
  id: row.id,
  label: row.hostname || row.name || row.id,
  description: [row.client_name || row.client_id, row.os].filter(Boolean).join(" · "),
  keywords: `${row.id} ${row.hostname || ""} ${row.name || ""} ${row.client_name || ""} ${row.ip_address || ""}`,
});

const toClientItem = (row) => ({
  id: row.id,
  label: row.name || row.id,
  description: row.domain || row.email || "",
  keywords: `${row.id} ${row.name || ""} ${row.domain || ""}`,
});

/** Devices as SearchableSelect items, fetched once per signed-in user. */
export function useDeviceOptions() {
  const { token } = useAuth();
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    axios
      .get(`${API}/devices`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => {
        if (!alive) return;
        const rows = Array.isArray(data) ? data : data?.devices || [];
        setItems(rows.map(toItem));
      })
      .catch(() => alive && setItems([]));
    return () => { alive = false; };
  }, [token]);
  return items;
}

/** Clients as SearchableSelect items, fetched once per signed-in user. */
export function useClientOptions() {
  const { token } = useAuth();
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    axios
      .get(`${API}/clients`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => {
        if (!alive) return;
        const rows = Array.isArray(data) ? data : data?.clients || [];
        setItems(rows.map(toClientItem));
      })
      .catch(() => alive && setItems([]));
    return () => { alive = false; };
  }, [token]);
  return items;
}

/**
 * Devices and clients in one list for dual-target pickers. Item ids are
 * namespaced (`device:…` / `client:…`) so the two stable-ID spaces can never
 * collide and the caller learns which kind was chosen.
 */
export function useDeviceOrClientOptions() {
  const devices = useDeviceOptions();
  const clients = useClientOptions();
  return useMemo(() => [
    ...devices.map((item) => ({
      ...item,
      id: `device:${item.id}`,
      description: `Device · ${item.description || item.label}`,
      keywords: `device ${item.keywords || ""}`,
    })),
    ...clients.map((item) => ({
      ...item,
      id: `client:${item.id}`,
      description: `Client · ${item.description || item.label}`,
      keywords: `client ${item.keywords || ""}`,
    })),
  ], [devices, clients]);
}
