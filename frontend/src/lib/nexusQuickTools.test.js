import { calculateQuickExpression, formatQuickTimer } from "./nexusQuickTools";

describe("Nexus quick tools", () => {
  test("calculates arithmetic with operator precedence and brackets", () => {
    expect(calculateQuickExpression("12 + 4 * 3")).toBe(24);
    expect(calculateQuickExpression("(12 + 4) * 3")).toBe(48);
    expect(calculateQuickExpression("10% * 250")).toBe(25);
  });

  test("rejects invalid and unsafe expressions", () => {
    expect(() => calculateQuickExpression("window.location")).toThrow();
    expect(() => calculateQuickExpression("10 / 0")).toThrow("Cannot divide by zero");
  });

  test("formats a persistent timer duration", () => {
    expect(formatQuickTimer(0)).toBe("00:00:00");
    expect(formatQuickTimer(3661)).toBe("01:01:01");
  });
});
