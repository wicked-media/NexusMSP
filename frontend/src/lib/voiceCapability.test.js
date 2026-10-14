import {
  ARTIFACT_KIND_BY_OPERATION,
  VOICE_COLUMN_LIMIT,
  artifactFor,
  cellValue,
  resultRows,
} from "./voiceCapability";

describe("Voice capability result handling", () => {
  test("reads the record list out of each provider envelope", () => {
    const row = { id: "1", number: "101" };

    expect(resultRows([row])).toEqual([row]);
    expect(resultRows({ data: [row] })).toEqual([row]);
    expect(resultRows({ items: [row] })).toEqual([row]);
    expect(resultRows({ list: [row] })).toEqual([row]);
    expect(resultRows({ instances: [row] })).toEqual([row]);
    expect(resultRows({ records: [row] })).toEqual([row]);
  });

  test("treats a single object as one row and discards everything else", () => {
    expect(resultRows({ device_name: "PBX", sn: "SN1" })).toEqual([{ device_name: "PBX", sn: "SN1" }]);
    expect(resultRows({})).toEqual([]);
    expect(resultRows(null)).toEqual([]);
    expect(resultRows(undefined)).toEqual([]);
    expect(resultRows("ok")).toEqual([]);
    expect(resultRows(42)).toEqual([]);
    // A list of primitives has nothing to tabulate.
    expect(resultRows({ data: ["101", null, "102"] })).toEqual([]);
  });

  test("renders provider values without inventing a label", () => {
    expect(cellValue(null)).toBe("—");
    expect(cellValue(undefined)).toBe("—");
    expect(cellValue("")).toBe("");
    expect(cellValue(0)).toBe("0");
    expect(cellValue(true)).toBe("Yes");
    expect(cellValue(false)).toBe("No");
    expect(cellValue("101")).toBe("101");
    expect(cellValue({ ip: "10.0.0.4" })).toBe('{"ip":"10.0.0.4"}');
  });

  test("only offers playback for interfaces that return audio", () => {
    expect(resultRows({ data: [{ id: "7" }] }).length).toBe(1);
    expect(artifactFor("extension.list", { id: "7" })).toBeNull();
    expect(artifactFor("recording.list", { id: "7" })).toEqual({ kind: "recording", id: "7", extensionId: "" });
    expect(artifactFor("recording.search", { recording_id: "r-9" })).toEqual({ kind: "recording", id: "r-9", extensionId: "" });
    expect(artifactFor("voicemail.query", { msg_id: "m-3", ext_id: "101" })).toEqual({ kind: "voicemail", id: "m-3", extensionId: "101" });
    expect(artifactFor("voicemail.query", { message_id: "m-4", extension: "202" })).toEqual({ kind: "voicemail", id: "m-4", extensionId: "202" });
  });

  test("refuses to offer playback without an artifact identity", () => {
    expect(artifactFor("recording.list", { caller: "0412 345 678" })).toBeNull();
    expect(artifactFor("voicemail.query", { ext_id: "101" })).toBeNull();
    expect(artifactFor("recording.list", null)).toBeNull();
    expect(artifactFor("recording.list", ["7"])).toBeNull();
  });

  test("keeps the documented artifact interfaces and column limit", () => {
    expect(Object.keys(ARTIFACT_KIND_BY_OPERATION).sort()).toEqual(["recording.list", "recording.search", "voicemail.query"]);
    expect(VOICE_COLUMN_LIMIT).toBeGreaterThan(0);
  });
});
