/* eslint-disable testing-library/no-unnecessary-act -- Native React roots require act. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import TicketHeaderAction from "../components/tickets/TicketHeaderAction";
jest.mock("@/components/ui/button", () => ({ Button: ({ variant: _variant, size: _size, ...props }) => require("react").createElement("button", props) }), { virtual: true });
test("compact actions retain an accessible name and hover label", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<TicketHeaderAction tone="compact">Tools</TicketHeaderAction>));
  const button = container.querySelector("button");
  expect(button.getAttribute("aria-label")).toBe("Tools");
  expect(button.title).toBe("Tools");
  await act(async () => root.unmount());
});
