import axios from "axios";

const DOCUMENT_TYPES = new Set(["invoice", "estimate", "contract", "purchase_order"]);

function requiredValue(value, label) {
  const normalised = String(value || "").trim();
  if (!normalised) throw new Error(`${label} is required`);
  return normalised;
}

function normaliseDocumentType(value) {
  const documentType = requiredValue(value, "Document type");
  if (!DOCUMENT_TYPES.has(documentType)) throw new Error("Unsupported PDF document type");
  return documentType;
}

function apiOrigin(api) {
  try {
    const parsed = new URL(requiredValue(api, "API URL"));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Unsupported API protocol");
    return parsed.origin;
  } catch (error) {
    if (error instanceof Error && error.message !== "Invalid URL") throw error;
    throw new Error("API URL is invalid");
  }
}

/**
 * Convert the server-issued relative PDF capability path to a same-origin URL.
 * The browser receives the short-lived opaque capability, never the session JWT.
 */
export function buildPdfCapabilityUrl(api, pdfPath) {
  const origin = apiOrigin(api);
  const path = requiredValue(pdfPath, "PDF capability path");
  if (!path.startsWith("/api/")) throw new Error("PDF capability path is invalid");

  const url = new URL(path, origin);
  if (
    url.origin !== origin
    || !url.pathname.startsWith("/api/")
    || url.searchParams.has("token")
    || !url.searchParams.get("capability")?.startsWith("pdfc_")
  ) {
    throw new Error("PDF capability path is invalid");
  }
  return url.toString();
}

/**
 * Retains the existing query-token navigation only for legacy records that the
 * capability endpoint deliberately cannot issue against yet (for example,
 * client-less historical commercial documents).
 */
export function buildLegacyDocumentPdfUrl({ api, documentType, documentId, token, download = false }) {
  const type = normaliseDocumentType(documentType);
  const id = encodeURIComponent(requiredValue(documentId, "Document ID"));
  const sessionToken = requiredValue(token, "Session token");
  const query = new URLSearchParams({ token: sessionToken });

  if (type === "purchase_order") {
    if (download) query.set("download", "true");
    return `${requiredValue(api, "API URL")}/purchase-orders/${id}/pdf/preview?${query.toString()}`;
  }

  const resource = type === "estimate" ? "estimates" : `${type}s`;
  const suffix = download ? "/pdf/download" : "/pdf";
  return `${requiredValue(api, "API URL")}/${resource}/${id}${suffix}?${query.toString()}`;
}

export function isPdfCapabilityCompatibilityError(error) {
  const status = error?.response?.status;
  // 404 represents a client-less historic document or an older API that has
  // not yet received the capability route. Do not silently downgrade normal
  // authorisation, validation, or server failures to a JWT-bearing URL.
  return status === 404 || status === 405 || status === 501;
}

export async function requestDocumentPdfCapability({
  api,
  headers,
  documentType,
  documentId,
  download = false,
  httpClient = axios,
}) {
  const type = normaliseDocumentType(documentType);
  const id = requiredValue(documentId, "Document ID");
  const response = await httpClient.post(
    `${requiredValue(api, "API URL")}/document-pdf-capabilities`,
    { document_type: type, document_id: id, download: Boolean(download) },
    { headers },
  );
  return buildPdfCapabilityUrl(api, response?.data?.pdf_path);
}

/**
 * Prefer an object-bound, short-lived PDF capability. The legacy URL is kept
 * only as a compatibility bridge for content the server cannot bind safely.
 */
export async function resolveDocumentPdfUrl(options) {
  try {
    return await requestDocumentPdfCapability(options);
  } catch (error) {
    if (!isPdfCapabilityCompatibilityError(error)) throw error;
    return buildLegacyDocumentPdfUrl(options);
  }
}
