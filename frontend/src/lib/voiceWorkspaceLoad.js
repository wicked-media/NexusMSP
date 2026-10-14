import axios from "axios";

// The core workspace is valuable even when an optional admin/provider feed is
// unavailable. Keep supplementary requests short so they cannot strand the
// Voice landing page on its loading state.
export const VOICE_WORKSPACE_CORE_TIMEOUT_MS = 8_000;
export const VOICE_WORKSPACE_SUPPLEMENTAL_TIMEOUT_MS = 5_000;

function emptyYcmOverview() {
  return { connection: {}, discoveries: [] };
}

async function optionalGet(httpClient, url, headers, fallback) {
  try {
    const response = await httpClient.get(url, {
      headers,
      timeout: VOICE_WORKSPACE_SUPPLEMENTAL_TIMEOUT_MS,
    });
    return response?.data ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Fetch non-essential Voice workspace data without making it an availability
 * dependency for the core PBX, extension, and billing workspace.
 */
export async function loadVoiceWorkspaceSupplementalData({
  api,
  headers,
  httpClient = axios,
}) {
  const [clients, products, ycm] = await Promise.all([
    optionalGet(httpClient, `${api}/clients`, headers, []),
    optionalGet(httpClient, `${api}/products`, headers, []),
    optionalGet(httpClient, `${api}/yeastar/ycm/overview`, headers, emptyYcmOverview()),
  ]);

  return {
    clients: Array.isArray(clients) ? clients : [],
    products: Array.isArray(products) ? products : [],
    ycm: ycm && typeof ycm === "object" ? ycm : emptyYcmOverview(),
  };
}
