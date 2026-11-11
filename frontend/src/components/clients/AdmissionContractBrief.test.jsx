import { renderToStaticMarkup } from "react-dom/server";
import AdmissionContractBrief from "./AdmissionContractBrief";

const ADMISSION_LABELS = [
  "Problem & outcome",
  "Canonical objects & contracts",
  "Scope, audit & retention",
  "Verification & failure",
  "Commercial truth",
  "Release gate & owner",
];

function renderBrief() {
  return renderToStaticMarkup(<AdmissionContractBrief />);
}

describe("Client Studio Overview admission contract", () => {
  test("keeps the adopted contract visible with its status and retention rule", () => {
    const view = renderBrief();

    expect(view).toContain('data-testid="client-admission-contract-brief"');
    expect(view).toContain("Client Overview projection");
    expect(view).toContain("Adopted");
    expect(view).toContain("Read-only projection");
    expect(view).toContain("not dismissible while the projection remains adopted");
  });

  test("renders exactly the six capability-admission conditions", () => {
    const view = renderBrief();
    const conditions = view.match(/data-testid="admission-condition-/g) || [];
    const text = view.replaceAll("&amp;", "&");

    expect(conditions).toHaveLength(6);
    ADMISSION_LABELS.forEach((label) => expect(text).toContain(label));
  });
});
