/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";

import { EmptyState, ErrorState, LoadingState } from "./index.jsx";

// One implementation, three states, and a contract every workspace depends on:
// loading / empty / error must be *distinguishable*. These tests render the real
// primitives, because the failure this standard exists to prevent — a failed read
// that looks like an empty result — is only prevented if the panels behave.

const mount = (element) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(element);
  });
  return host;
};

const click = (element) => {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("shared workspace state primitives", () => {
  test("an empty state names what is missing and offers the next real action", () => {
    const view = mount(
      <EmptyState
        icon={<span data-testid="state-icon" />}
        title="No certificate has been issued"
        description="Complete an assigned course and pass its knowledge check."
        action={<button type="button">Create the first course</button>}
        testid="academy-empty"
      />,
    );

    const panel = view.querySelector('[data-testid="academy-empty"]');
    expect(panel).not.toBeNull();
    expect(view.textContent).toContain("No certificate has been issued");
    expect(view.textContent).toContain("Complete an assigned course and pass its knowledge check.");
    expect(view.querySelector('[data-testid="state-icon"]')).not.toBeNull();
    expect(view.querySelector("button").textContent).toBe("Create the first course");
  });

  test("a loading state keeps the panel's shape and announces itself", () => {
    const view = mount(<LoadingState label="Reading retained evidence…" rows={4} testid="reading" />);
    const panel = view.querySelector('[data-testid="reading"]');

    expect(panel.getAttribute("role")).toBe("status");
    expect(panel.getAttribute("aria-live")).toBe("polite");
    expect(panel.getAttribute("aria-busy")).toBe("true");
    expect(panel.querySelectorAll(".animate-pulse")).toHaveLength(4);
    expect(panel.textContent).toContain("Reading retained evidence…");
  });

  test("a loading state always renders at least one placeholder row", () => {
    const view = mount(<LoadingState rows={0} testid="degenerate" />);
    expect(view.querySelectorAll('[data-testid="degenerate"] .animate-pulse')).toHaveLength(1);
  });

  test("an error state is an alert that shows the reason and a working way out", () => {
    const onRetry = jest.fn();
    const view = mount(
      <ErrorState
        error="Request failed with status code 503"
        title="NPS evidence could not be read"
        description="Recorded responses are unchanged."
        icon={<span />}
        onRetry={onRetry}
        retryLabel="Retry evidence read"
        testid="nps-error"
      />,
    );

    const panel = view.querySelector('[data-testid="nps-error"]');
    expect(panel.getAttribute("role")).toBe("alert");
    expect(panel.textContent).toContain("NPS evidence could not be read");
    expect(panel.textContent).toContain("Recorded responses are unchanged.");
    // The raw reason stays visible: "it broke" is not an explanation.
    expect(panel.textContent).toContain("Request failed with status code 503");

    const retry = panel.querySelector("button");
    expect(retry.textContent).toContain("Retry evidence read");
    click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("an error state without a retry path still reports the failure", () => {
    const view = mount(<ErrorState error="Read-only surface" title="Could not be loaded" testid="read-only" />);
    const panel = view.querySelector('[data-testid="read-only"]');

    expect(panel.getAttribute("role")).toBe("alert");
    expect(panel.querySelector("button")).toBeNull();
  });

  test("className framing merges instead of duplicating, so migrated panels keep their look", () => {
    // Every file migrated onto these primitives passes a className to preserve the
    // framing it had before: the panel's own padding must lose to the caller's, and
    // nothing may end up declared twice on the element.
    const view = mount(
      <EmptyState
        title="No diagnostic plan is ready"
        className="rounded-xl border border-dashed border-border/80 px-3 py-5"
        testid="framed"
      />,
    );
    const { className } = view.querySelector('[data-testid="framed"]');

    expect(className).toContain("rounded-xl");
    expect(className).toContain("border-dashed");
    expect(className).toContain("px-3");
    expect(className).toContain("py-5");
    expect(className).not.toContain("px-6");
    expect(className).not.toContain("py-16");
  });
});
