import { buildTechCardSvg, techCardFilename } from "./techCard";

describe("buildTechCardSvg", () => {
  it("renders a valid svg with the tech name and title", () => {
    const svg = buildTechCardSvg({
      name: "Ada Admin",
      level: 5,
      closed_tickets: 42,
      points: { balance: 1200 },
      equipped_title: { emoji: "⚡", name: "Packet Wrangler" },
      equipped_pet: { emoji: "🐕", name: "Byte" },
    });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Ada Admin");
    expect(svg).toContain("Packet Wrangler");
    expect(svg).toContain("Byte");
    expect(svg).toContain("42");
    expect(svg).toContain("1,200");
  });

  it("escapes markup in profile fields", () => {
    const svg = buildTechCardSvg({ name: "<script>alert(1)</script>" });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("falls back to safe defaults for missing fields", () => {
    const svg = buildTechCardSvg({});
    expect(svg).toContain("Unknown Tech");
    expect(svg).toContain("No companion");
    expect(svg).toContain("0");
  });

  it("names the download file after the tech", () => {
    expect(techCardFilename({ name: "Ada Admin" })).toBe("nexus-tech-card-ada-admin.svg");
    expect(techCardFilename({})).toBe("nexus-tech-card-tech.svg");
  });
});
