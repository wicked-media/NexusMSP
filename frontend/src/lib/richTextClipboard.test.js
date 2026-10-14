import { parsePlainTextClipboardList } from "./richTextClipboard";

test("turns a copied bullet list into semantic list items", () => {
  expect(parsePlainTextClipboardList("• Confirm scope\n• Capture approval\n• Record outcome")).toEqual({
    type: "bullet",
    items: ["Confirm scope", "Capture approval", "Record outcome"],
  });
});

test("turns numbered clipboard lines into an ordered list", () => {
  expect(parsePlainTextClipboardList("1. Diagnose\n2) Repair\n3. Verify")).toEqual({
    type: "ordered",
    items: ["Diagnose", "Repair", "Verify"],
  });
});

test("leaves regular or mixed note text to the native paste path", () => {
  expect(parsePlainTextClipboardList("Diagnosis completed\nNext update at 2pm")).toBeNull();
  expect(parsePlainTextClipboardList("• Captured notes\nPlain follow-up")).toBeNull();
});
