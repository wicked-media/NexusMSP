/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
/* Render coverage for the three accessibility properties the design system promises.

   `statePanels.test.jsx` proves the panels behave. This suite proves they stay legible,
   keep a focus indicator, and stop moving when the operator asks them to — through the
   same public props a workspace uses, not by inspecting internals. The contrast ratios
   themselves are pinned in `src/lib/accessibilityCoverage.test.js`; what is asserted here
   is that the primitives actually resolve their colours through the tokens those ratios
   belong to, and that the motion setting reaches JavaScript. */
import { act } from "react";
import { createRoot } from "react-dom/client";

import { Command, CommandItem, CommandList } from "@/components/ui/command";

import { EmptyState, ErrorState, IntegrationChip, LoadingState, MetricTile, StatusPill } from "./index.jsx";

// React 19 requires the environment to opt in before `act` may flush a root that was
// created directly, which is how this suite renders at all.
global.IS_REACT_ACT_ENVIRONMENT = true;

// cmdk measures its list with a ResizeObserver; jsdom does not implement one. This is an
// environment shim for the component under test, not a relaxation of any assertion.
global.ResizeObserver = class ResizeObserver {
  observe() {}

  unobserve() {}

  disconnect() {}
};

// cmdk scrolls the highlighted row into view, which jsdom does not implement either.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const mount = (element) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(element);
  });
  return host;
};

const reducibleMotion = (setting) => {
  if (setting === undefined) delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = setting;
};

afterEach(() => {
  document.body.innerHTML = "";
  reducibleMotion(undefined);
  delete window.matchMedia;
});

describe("motion", () => {
  test("a KPI tile counts up when motion is allowed", () => {
    const view = mount(<MetricTile label="Monthly recurring revenue" value={1234} />);

    // The counter starts below its target, which is what makes the next test meaningful:
    // a component that always rendered the final figure would pass the reduced-motion
    // assertion while ignoring the setting entirely.
    expect(view.textContent).toContain("0");
    expect(view.textContent).not.toContain("1234");
  });

  test("the in-app Motion setting reaches JavaScript, not only CSS", () => {
    reducibleMotion("none");
    const view = mount(<MetricTile label="Monthly recurring revenue" value={1234} />);

    // `MetricTile` delegates to `HeroTile`, whose counter drives the figure through
    // requestAnimationFrame — a media query cannot reach that, which is how an operator
    // who chose "None" still watched every number count up.
    expect(view.textContent).toContain("1234");
    // The entrance stagger is motion in its own right, so it is skipped rather than
    // merely shortened: the tile is simply already in place.
    expect(view.querySelector(".nx-hero").className).toContain("nx-hero--entered");
  });

  test("the operating system's preference is honoured on its own", () => {
    reducibleMotion(undefined);
    window.matchMedia = jest.fn(() => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() }));
    const view = mount(<MetricTile label="Open tickets" value={42} />);

    expect(view.textContent).toContain("42");
  });

  test("an already-mounted tile follows a change without a reload", () => {
    reducibleMotion("full");
    const view = mount(<MetricTile label="Open tickets" value={57} />);
    expect(view.textContent).not.toContain("57");

    act(() => {
      document.documentElement.dataset.motion = "none";
      window.dispatchEvent(new CustomEvent("nexus-motion-change", { detail: { motion: "none" } }));
    });

    expect(view.textContent).toContain("57");
  });
});

describe("contrast tokens", () => {
  test("every status hue resolves through the design system's chip scale", () => {
    const chipStatuses = ["open", "in_progress", "pending", "resolved", "urgent", "critical", "overdue", "paid", "sent"];

    for (const status of chipStatuses) {
      const view = mount(<StatusPill status={status} />);
      const { className } = view.querySelector("span");

      expect(`${status}: ${className}`).toMatch(new RegExp(`${status}: .*text-chip-[a-z]+`));
      // The literals these replaced measured 2.15-4.47:1 as text on the light theme's white
      // card, so a palette literal reappearing here would silently undo the fix.
      expect(`${status}: ${className}`).not.toMatch(/text-(?:sky|blue|indigo|amber|emerald|rose)-\d{3}/);
    }
  });

  test("a status with no colour claim stays muted rather than borrowing a signal", () => {
    const view = mount(<StatusPill status="something-new" />);
    const { className } = view.querySelector("span");

    expect(className).toContain("text-muted-foreground");
    expect(className).not.toMatch(/text-chip-/);
  });

  test("provider chips keep one hue each, through the same scale", () => {
    const tones = ["acronis", "pax8", "m365", "rmm"].map((type) => {
      const view = mount(<IntegrationChip type={type} active />);
      const { className } = view.querySelector("span");
      expect(className).toMatch(/text-chip-[a-z]+/);
      return className.match(/text-chip-([a-z]+)/)[1];
    });

    // Four providers, four hues: a shared token would make the chips unreadable at a glance.
    expect(new Set(tones).size).toBe(4);
  });

  test("an inactive provider chip is muted, not coloured", () => {
    const view = mount(<IntegrationChip type="acronis" />);
    const { className } = view.querySelector("span");

    expect(className).toContain("text-muted-foreground");
  });

  test("a loading panel announces itself and keeps its placeholders out of the reading order", () => {
    const view = mount(<LoadingState label="Reading retained evidence…" rows={2} />);
    const panel = view.querySelector('[role="status"]');

    expect(panel.getAttribute("aria-busy")).toBe("true");
    expect(panel.querySelector('[aria-hidden="true"]').querySelectorAll(".animate-pulse")).toHaveLength(2);
  });
});

describe("focus visibility", () => {
  test("the panels' decorative glyphs are hidden from assistive technology", () => {
    const empty = mount(<EmptyState icon={<span data-testid="empty-glyph" />} title="No certificate has been issued" />);
    const error = mount(
      <ErrorState icon={<span data-testid="error-glyph" />} error="Request failed with status code 503" />,
    );

    for (const [view, testid] of [[empty, "empty-glyph"], [error, "error-glyph"]]) {
      const glyph = view.querySelector(`[data-testid="${testid}"]`);
      expect(glyph.parentElement.getAttribute("aria-hidden")).toBe("true");
    }
  });

  test("the command palette marks the current row with a ring, not only a selection fill", () => {
    const view = mount(
      <Command>
        <CommandList>
          <CommandItem value="rotate-credentials">Rotate credentials</CommandItem>
        </CommandList>
      </Command>,
    );
    const { className } = view.querySelector("[cmdk-item]");

    // cmdk keeps the caret in the search field and marks the row with `data-selected`, so the
    // ring has to hang off that same attribute — the one that paints the accent fill, which on
    // its own measures 1.10:1 (light) / 1.21:1 (dark) against the popover it fills.
    expect(className).toContain("data-[selected=true]:bg-accent");
    expect(className).toContain("data-[selected=true]:ring-1");
    expect(className).toContain("data-[selected=true]:ring-ring");
    expect(className).not.toMatch(/ring-(?!offset)[a-z-]+\/\d+/);
  });

  test("the error panel's only control declares a focus indicator at full opacity", () => {
    const view = mount(<ErrorState error="Read failed" onRetry={jest.fn()} />);
    const retry = view.querySelector("button");
    const { className } = retry;

    expect(className).toContain("focus-visible:ring-2");
    expect(className).toContain("focus-visible:ring-ring");
    expect(className).toContain("focus-visible:ring-offset-background");
    // A translucent ring (`ring-primary/35`) composites to under 2:1 and is invisible on
    // screen; `ring-offset-*` carries no alpha and is not what this guards against.
    expect(className).not.toMatch(/ring-(?!offset)[a-z-]+\/\d+/);
  });
});
