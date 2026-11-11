import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import ClientOverviewProjection from "./ClientOverviewProjection";

jest.mock("./ClientActivityFeed", () => ({
  __esModule: true,
  default: () => <div data-testid="client-activity-feed" />,
}));

const client = {
  name: "Admitted Client",
  health_score: 92,
  overdue_count: 0,
  overdue_amount: 0,
  open_tickets: 2,
  contact_count: 4,
  asset_count: 12,
  assets_online: 11,
  active_contracts: 2,
  integrations: { rmm: true, m365: true, acronis: true, yeastar: false },
};

const healthDetail = {
  health_score: 92,
  breakdown: { tickets: 28, sla: 19, devices: 18, payments: 20, contracts: 9 },
};

describe("Client Studio Overview projection", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  test("mounts the admission contract immediately before the Digital Twin projection", async () => {
    flushSync(() => {
      root.render(
        <ClientOverviewProjection
          client={client}
          activity={[]}
          healthDetail={healthDetail}
          onNavigate={() => {}}
        />
      );
    });

    const overview = container.querySelector('[data-testid="client-overview-projection"]');
    const brief = container.querySelector('[data-testid="client-admission-contract-brief"]');
    const projection = container.querySelector('[data-testid="client-digital-twin-overview"]');

    expect(overview).not.toBeNull();
    expect(brief).not.toBeNull();
    expect(projection).not.toBeNull();
    expect(overview.firstElementChild).toBe(brief);
    expect(overview.children[1]).toBe(projection);
  });

  test("keeps the mobile admission brief compact and immediately before the Digital Twin", () => {
    flushSync(() => {
      root.render(
        <ClientOverviewProjection
          client={client}
          activity={[]}
          healthDetail={healthDetail}
          onNavigate={() => {}}
        />
      );
    });

    // JSDOM has no layout engine. This pins the responsive utility contract
    // that produced the 805px mobile brief; the 390px Playwright capture is the
    // pixel-level check.
    const overview = container.querySelector('[data-testid="client-overview-projection"]');
    const brief = container.querySelector('[data-testid="client-admission-contract-brief"]');
    const projection = container.querySelector('[data-testid="client-digital-twin-overview"]');
    const conditions = brief.querySelector("dl");
    const rows = [...conditions.children];
    const classes = (element) => new Set(element.className.split(/\s+/));

    expect(classes(overview).has("space-y-3")).toBe(true);
    expect(classes(brief).has("p-3")).toBe(true);
    expect(classes(brief).has("sm:p-4")).toBe(true);
    expect(classes(conditions).has("mt-3")).toBe(true);
    expect(classes(conditions).has("divide-y")).toBe(true);
    expect(classes(conditions).has("sm:grid")).toBe(true);
    expect(classes(conditions).has("sm:grid-cols-2")).toBe(true);
    expect(classes(conditions).has("xl:grid-cols-3")).toBe(true);
    expect(classes(conditions).has("gap-2")).toBe(false);
    expect(rows).toHaveLength(6);

    rows.forEach((row) => {
      const rowClasses = classes(row);
      expect(rowClasses.has("px-3")).toBe(true);
      expect(rowClasses.has("py-2")).toBe(true);
      expect(rowClasses.has("sm:p-3")).toBe(true);
      expect(rowClasses.has("rounded-xl")).toBe(false);
      expect(rowClasses.has("border")).toBe(false);
    });

    const descriptionClasses = classes(rows[0].querySelector("dd"));
    expect(descriptionClasses.has("mt-1")).toBe(true);
    expect(descriptionClasses.has("text-[10px]")).toBe(true);
    expect(descriptionClasses.has("leading-4")).toBe(true);
    expect(descriptionClasses.has("sm:text-[11px]")).toBe(true);
    expect(descriptionClasses.has("sm:leading-5")).toBe(true);

    expect(overview.firstElementChild).toBe(brief);
    expect(overview.children[1]).toBe(projection);
  });
});
