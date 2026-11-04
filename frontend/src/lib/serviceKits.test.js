import {
  SERVICE_KIT_DEFAULT_CONTEXT,
  STANDARD_SERVICE_KIT,
  serviceKitById,
  serviceKitContextFor,
  serviceKitCreateLabel,
} from "./serviceKits";

describe("service kit helpers", () => {
  test("keeps the standard ticket path explicit", () => {
    expect(STANDARD_SERVICE_KIT).toBe("standard");
    expect(serviceKitById(STANDARD_SERVICE_KIT)).toBeNull();
    expect(serviceKitCreateLabel(STANDARD_SERVICE_KIT)).toBe("Create and open ticket");
  });

  test("hydrates a kit context without mutating defaults", () => {
    const context = serviceKitContextFor("cabling_field", { zone: "CBD" });
    expect(context.zone).toBe("CBD");
    expect(context.estimated_duration).toBe(60);
    expect(SERVICE_KIT_DEFAULT_CONTEXT.cabling_field.zone).toBe("");
  });

  test("names the linked delivery workflow clearly", () => {
    expect(serviceKitById("workshop_repair")?.workflow).toBe("workshop");
    expect(serviceKitCreateLabel("cabling_field")).toContain("Field service");
  });
});
