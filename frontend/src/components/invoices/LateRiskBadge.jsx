import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Badge } from "@/components/ui/badge";

/**
 * Late-payment risk badge — fetches /api/invoices/{id}/late-risk and shows a
 * coloured pill (low/medium/high). Tooltip lists reasons.
 */
export default function LateRiskBadge({ invoiceId, token, compact = false }) {
  const [r, setR] = useState(null);

  useEffect(() => {
    if (!invoiceId || !token) return;
    let cancelled = false;
    axios.get(`${API}/invoices/${invoiceId}/late-risk`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((res) => { if (!cancelled) setR(res.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [invoiceId, token]);

  if (!r) return null;
  const color = r.band === "high" ? "rose" : r.band === "medium" ? "amber" : "emerald";
  const tip = (r.reasons || []).join(" · ");

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-${color}-400 border border-${color}-500/30`} title={tip} data-testid={`late-risk-${invoiceId}`}>
        ⚠ {r.score}
      </span>
    );
  }

  return (
    <Badge
      variant="outline"
      className={`text-${color}-400 border-${color}-500/40 text-[10px]`}
      title={tip}
      data-testid={`late-risk-${invoiceId}`}
    >
      Late risk: {r.score}/100 · {r.band}
    </Badge>
  );
}
