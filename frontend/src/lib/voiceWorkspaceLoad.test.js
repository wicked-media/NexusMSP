import {
  loadVoiceWorkspaceSupplementalData,
  VOICE_WORKSPACE_SUPPLEMENTAL_TIMEOUT_MS,
} from "./voiceWorkspaceLoad";

describe("Voice workspace supplemental loading", () => {
  test("uses bounded requests and degrades YCM 403 and product timeout to safe defaults", async () => {
    const headers = { Authorization: "Bearer session-token" };
    const get = jest.fn()
      .mockResolvedValueOnce({ data: [{ id: "client-a", name: "Client A" }] })
      .mockRejectedValueOnce({ code: "ECONNABORTED" })
      .mockRejectedValueOnce({ response: { status: 403 } });

    await expect(loadVoiceWorkspaceSupplementalData({
      api: "http://localhost:8000/api",
      headers,
      httpClient: { get },
    })).resolves.toEqual({
      clients: [{ id: "client-a", name: "Client A" }],
      products: [],
      ycm: { connection: {}, discoveries: [] },
    });

    expect(get).toHaveBeenNthCalledWith(1, "http://localhost:8000/api/clients", {
      headers,
      timeout: VOICE_WORKSPACE_SUPPLEMENTAL_TIMEOUT_MS,
    });
    expect(get).toHaveBeenNthCalledWith(2, "http://localhost:8000/api/products", {
      headers,
      timeout: VOICE_WORKSPACE_SUPPLEMENTAL_TIMEOUT_MS,
    });
    expect(get).toHaveBeenNthCalledWith(3, "http://localhost:8000/api/yeastar/ycm/overview", {
      headers,
      timeout: VOICE_WORKSPACE_SUPPLEMENTAL_TIMEOUT_MS,
    });
  });
});
