import {
  buildLegacyDocumentPdfUrl,
  buildPdfCapabilityUrl,
  resolveDocumentPdfUrl,
} from "./documentPdfCapabilities";

const API = "http://localhost:8000/api";
const token = "session-token";

describe("document PDF capabilities", () => {
  test("uses only the opaque capability returned by the API", async () => {
    const post = jest.fn().mockResolvedValue({
      data: { pdf_path: "/api/invoices/inv-1/pdf?capability=pdfc_example" },
    });

    await expect(resolveDocumentPdfUrl({
      api: API,
      headers: { Authorization: "Bearer session-token" },
      documentType: "invoice",
      documentId: "inv-1",
      token,
      httpClient: { post },
    })).resolves.toBe("http://localhost:8000/api/invoices/inv-1/pdf?capability=pdfc_example");

    expect(post).toHaveBeenCalledWith(
      "http://localhost:8000/api/document-pdf-capabilities",
      { document_type: "invoice", document_id: "inv-1", download: false },
      { headers: { Authorization: "Bearer session-token" } },
    );
  });

  test("keeps a legacy query URL only when the capability route cannot support the document", async () => {
    const post = jest.fn().mockRejectedValue({ response: { status: 404 } });

    await expect(resolveDocumentPdfUrl({
      api: API,
      headers: { Authorization: "Bearer session-token" },
      documentType: "purchase_order",
      documentId: "po-1",
      token,
      download: true,
      httpClient: { post },
    })).resolves.toBe("http://localhost:8000/api/purchase-orders/po-1/pdf/preview?token=session-token&download=true");
  });

  test("does not downgrade an authorisation failure to a legacy session URL", async () => {
    const post = jest.fn().mockRejectedValue({ response: { status: 403 } });

    await expect(resolveDocumentPdfUrl({
      api: API,
      headers: { Authorization: "Bearer session-token" },
      documentType: "contract",
      documentId: "contract-1",
      token,
      httpClient: { post },
    })).rejects.toEqual({ response: { status: 403 } });
  });

  test("rejects an unexpected capability path before it reaches the browser", () => {
    expect(() => buildPdfCapabilityUrl(API, "https://other.example/pdf?capability=pdfc_example")).toThrow("PDF capability path is invalid");
    expect(() => buildPdfCapabilityUrl(API, "/api/invoices/inv-1/pdf?capability=pdfc_example&token=session-token")).toThrow("PDF capability path is invalid");
    expect(buildLegacyDocumentPdfUrl({ api: API, documentType: "estimate", documentId: "est 1", token })).toBe(
      "http://localhost:8000/api/estimates/est%201/pdf?token=session-token",
    );
  });
});
