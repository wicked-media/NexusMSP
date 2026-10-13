/**
 * Value formatting for the report document surfaces.
 *
 * The same discipline the PDF renderer applies: a unit is read from the field
 * name, never inferred from magnitude. A count called `tickets_total` must not
 * be printed as currency, and a balance must keep its cents. These helpers are
 * shared so the on-screen report and the downloaded PDF describe the same
 * recorded number the same way.
 */

const MONEY_UNITS = [
  "amount", "balance", "outstanding", "subtotal", "tax", "price", "rate", "cost",
  "mrr", "arr", "revenue", "invoiced", "paid", "spend", "discount", "fee", "budget", "margin",
];

const MONEY_TOKENS = new Set([...MONEY_UNITS, "total", "value", "net", "gross"]);

const COUNT_SUBJECTS = [
  "tickets", "devices", "jobs", "assets", "sessions", "patches", "alerts", "invoices",
  "items", "clients", "users", "lines", "records", "checks", "subscriptions", "contracts",
];

export function isNumericValue(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** True when a field name states a currency amount. */
export function isMoneyField(label) {
  const name = String(label || "").trim().toLowerCase();
  if (!name) return false;
  const tokens = name.split("_");
  const last = tokens[tokens.length - 1];
  if (MONEY_TOKENS.has(last)) return !tokens.slice(0, -1).some((token) => COUNT_SUBJECTS.includes(token));
  return MONEY_UNITS.some((unit) => name.includes(unit));
}

/** True when a field name states a percentage. */
export function isPercentField(label) {
  const name = String(label || "").toLowerCase();
  return ["pct", "percent", "_share"].some((marker) => name.includes(marker));
}

const countFormatter = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });
// A measured value never prints float padding on screen either: 96.4% stays
// 96.4%, while currency keeps its cents through moneyFormatter below.
const decimalFormatter = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 });
const moneyFormatter = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatCount(value) {
  if (!isNumericValue(value)) return String(value ?? "Not recorded");
  return Number.isInteger(value) ? countFormatter.format(value) : decimalFormatter.format(value);
}

export function formatMoneyText(value) {
  return isNumericValue(value) ? `$${moneyFormatter.format(value)}` : String(value ?? "Not recorded");
}

/** Field-aware evidence text for one recorded value. */
export function documentValueText(key, value) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (isNumericValue(value)) {
    if (isPercentField(key)) return `${formatCount(value)}%`;
    if (isMoneyField(key)) return formatMoneyText(value);
    return formatCount(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => documentValueText(key, item)).join(", ") || "None";
  }
  if (typeof value === "object") {
    const parts = Object.entries(value).map(([nestedKey, item]) => `${labelFor(nestedKey)}: ${documentValueText(nestedKey, item)}`);
    return parts.join(" · ") || "Not recorded";
  }
  return String(value);
}

/**
 * Field names arrive snake_cased from the API. A client-facing document must
 * read as professional prose, so the tokens that are acronyms are translated
 * rather than title-cased into "Sla" and "Pct". Kept in step with the PDF
 * renderer's glossary so both surfaces name a field identically.
 */
const LABEL_ACRONYMS = {
  sla: "SLA", csat: "CSAT", nps: "NPS", kpi: "KPI", roi: "ROI",
  rpo: "RPO", rto: "RTO", mrr: "MRR", arr: "ARR", api: "API",
  os: "OS", ip: "IP", url: "URL", id: "ID", ids: "IDs",
  qbr: "QBR", sql: "SQL", cpu: "CPU", ram: "RAM", ssd: "SSD",
  gpu: "GPU", vpn: "VPN", mfa: "MFA", eol: "EOL", eos: "EOS",
  m365: "M365", voip: "VoIP", sip: "SIP", it: "IT", ad: "AD",
  av: "AV", msp: "MSP", epp: "EPP", edr: "EDR", tls: "TLS",
  db: "DB", vm: "VM", vms: "VMs", csv: "CSV", pdf: "PDF",
  btu: "BTU", pat: "PAT", pki: "PKI", ups: "UPS", nas: "NAS",
};

// The unit is printed with the value, not with the label.
const LABEL_UNIT_TOKENS = new Set(["pct", "percent", "percentage"]);

/** Human label for a stored field name, in the document's own voice. */
export function labelFor(key) {
  const raw = String(key ?? "").replace(/[-_]/g, " ").trim();
  if (!raw) return "";
  const words = raw
    .split(/\s+/)
    .filter((token) => !LABEL_UNIT_TOKENS.has(token.toLowerCase()))
    .map((token) => {
      const lowered = token.toLowerCase();
      if (LABEL_ACRONYMS[lowered]) return LABEL_ACRONYMS[lowered];
      return lowered.charAt(0).toUpperCase() + lowered.slice(1);
    });
  return words.join(" ") || String(key ?? "");
}

/**
 * A breakdown renders as ranked evidence with a share of total; a set of
 * different metrics stays a plain table. Mirrors the PDF rule so a reader sees
 * the same shape on both surfaces.
 */
export function looksLikeDistribution(key, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return false;
  const entries = Object.entries(values);
  if (entries.length < 2) return false;
  if (!entries.every(([, value]) => isNumericValue(value))) return false;
  const name = String(key || "").toLowerCase();
  if (name.startsWith("by_") || ["breakdown", "distribution", "mix", "split"].some((suffix) => name.endsWith(suffix))) {
    return true;
  }
  const metricMarkers = [
    "total", "count", "rate", "pct", "percent", "score", "average", "_sum",
    "assets", "devices", "tickets", "sessions", "patches", "invoices",
  ];
  return !entries.some(([label]) => metricMarkers.some((marker) => label.toLowerCase().includes(marker)));
}

/** Ranked rows with share of total, for a distribution table. */
export function distributionRows(values) {
  const entries = Object.entries(values || {}).filter(([, value]) => isNumericValue(value));
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  return {
    total,
    rows: entries.map(([key, value]) => ({
      key,
      label: labelFor(key),
      value,
      share: total > 0 ? (value / total) * 100 : 0,
    })),
  };
}

/** Column keys for a list of records, capped so a table stays readable. */
export function recordColumns(rows, limit = 6) {
  const keys = [];
  for (const row of rows || []) {
    for (const key of Object.keys(row || {})) {
      if (!keys.includes(key)) keys.push(key);
    }
    if (keys.length >= limit) break;
  }
  return keys.slice(0, limit);
}
