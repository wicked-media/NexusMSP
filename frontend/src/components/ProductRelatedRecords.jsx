import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";

const sections = [
  ["tickets", "Ticket usage", "/tickets?ticket="],
  ["purchase_orders", "Purchase order history", "/purchase-orders?po="],
  ["invoices", "Invoice history", "/invoices?invoice="],
];

export default function ProductRelatedRecords({ productId }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(false);
    axios.get(`${API}/products/${encodeURIComponent(productId)}/related-records`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    }).then(response => setData(response.data)).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [productId, token, retry]);
  if (error) return <div role="alert" className="rounded-xl border p-5">Related history is unavailable—not necessarily empty. <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Retry</Button></div>;
  if (!data) return <p role="status" className="p-5 text-muted-foreground">Loading related records…</p>;
  return <div className="space-y-4 py-4">
    <p className="text-xs text-muted-foreground">Recorded product-ID matches only. Historical quantities and prices are preserved; deleted or unlinked records are not inferred.</p>
    {sections.map(([key, title, path]) => <section key={key} className="overflow-hidden rounded-xl border border-border/70 bg-card/40">
      <h3 className="border-b px-4 py-3 text-sm font-semibold">{title} · {data[key]?.records.length || 0}</h3>
      {!data[key]?.records.length && <p className="p-4 text-sm text-muted-foreground">No linked records in your permitted scope.</p>}
      {data[key]?.records.map(record => <div key={record.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 px-4 py-3 last:border-0">
        <div><Link className="text-sm font-medium text-cyan-300 hover:underline" to={`${path}${encodeURIComponent(record.id)}`}>{record.number}</Link><p className="text-xs text-muted-foreground">{record.status || "Status unavailable"} · {record.created_at?.slice(0, 10) || "Date unavailable"}</p></div>
        <div className="text-right text-xs">{record.lines.map((line, index) => <p key={index}>Qty {line.quantity ?? "—"}{line.received_qty != null ? ` · Received ${line.received_qty}` : ""}{line.unit_price != null ? ` · Unit price ${Number(line.unit_price).toFixed(2)}` : ""}</p>)}</div>
      </div>)}
      {data[key]?.has_more && <p className="p-3 text-xs text-amber-300">Showing the latest 100 records. Open the source workspace for older history.</p>}
    </section>)}
  </div>;
}
