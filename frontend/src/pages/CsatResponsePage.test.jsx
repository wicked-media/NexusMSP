/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";

import CsatResponsePage from "./CsatResponsePage";

jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/App", () => ({ __esModule: true, API: "http://api.test/api" }), { virtual: true });
jest.mock(
  "react-router-dom",
  () => ({ __esModule: true, useParams: () => ({ surveyId: "survey-1" }) }),
  { virtual: true },
);

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<CsatResponsePage />);
  });
  await settle();
  return root;
}

describe("CsatResponsePage", () => {
  afterEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("submits the selected rating for the ticket survey", async () => {
    axios.get.mockResolvedValue({
      data: { id: "survey-1", ticket_number: "TKT-0042", client_name: "Acme", status: "open" },
    });
    axios.post.mockResolvedValue({ data: { success: true } });

    await renderPage();

    expect(document.body.textContent).toContain("TKT-0042");
    expect(document.body.textContent).toContain("Acme");

    await act(async () => {
      document.querySelector('[data-testid="csat-star-5"]').click();
    });
    await act(async () => {
      document.querySelector('[data-testid="csat-submit"]').click();
    });
    await settle();

    expect(axios.post).toHaveBeenCalledWith("http://api.test/api/csat/survey-1/respond", {
      score: 5,
      feedback: "",
    });
    expect(document.body.textContent).toContain("Thank you for your feedback");
  });

  it("explains that a finished or unknown link is unavailable", async () => {
    axios.get.mockRejectedValue({ response: { status: 404, data: { detail: "Survey not found or already answered" } } });

    await renderPage();

    expect(document.body.textContent).toContain("Survey unavailable");
    expect(document.body.textContent).toContain("Survey not found or already answered");
    expect(axios.post).not.toHaveBeenCalled();
  });
});
