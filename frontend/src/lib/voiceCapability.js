// Yeastar answers each list interface with a different envelope: some reply
// with a bare array and others wrap the records in "data", "items", "list",
// "rows", "instances" or "records". The capability console renders whatever the
// response actually holds rather than assuming one shape, and these helpers are
// the whole of that tolerance, so it is testable without a PBX.

export const VOICE_RESULT_ROW_KEYS = ["data", "items", "list", "rows", "instances", "records"];
export const VOICE_COLUMN_LIMIT = 8;
export const VOICE_ROW_LIMIT = 50;

// Only these interfaces answer with a provider download URL, which means the
// audio has to be fetched through the Nexus relay rather than straight from the
// PBX. Everything else is rendered as data.
export const ARTIFACT_KIND_BY_OPERATION = {
  "recording.list": "recording",
  "recording.search": "recording",
  "voicemail.query": "voicemail",
};

const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);

/** Return the record list inside any of the provider's list envelopes. */
export function resultRows(data) {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (!isRecord(data)) return [];
  for (const key of VOICE_RESULT_ROW_KEYS) {
    if (Array.isArray(data[key])) return data[key].filter(isRecord);
  }
  // A single-object answer (for example system/information) is one row.
  return Object.keys(data).length ? [data] : [];
}

/** Render one provider value in a table cell without inventing a label. */
export function cellValue(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Describe the playable audio behind a result row, or null when the interface
 * returns no artifact. The extension id is only meaningful for voicemail,
 * where the provider scopes a message to its mailbox.
 */
export function artifactFor(operationId, row) {
  const kind = ARTIFACT_KIND_BY_OPERATION[operationId];
  if (!kind || !isRecord(row)) return null;
  const id = String(row.id ?? row.uid ?? row.recording_id ?? row.msg_id ?? row.message_id ?? "").trim();
  if (!id) return null;
  const extensionId = kind === "voicemail"
    ? String(row.ext_id ?? row.extension ?? row.extension_number ?? "").trim()
    : "";
  return { kind, id, extensionId };
}
