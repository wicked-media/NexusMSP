import { applyChatFormat, renderSafeChatMarkdown } from "./richChatMessage";

describe("rich chat message helpers", () => {
  test("wraps a selected range with the requested markdown format", () => {
    expect(applyChatFormat("Check this", 6, 10, "bold")).toEqual({ value: "Check **this**", selectionStart: 8, selectionEnd: 12 });
  });

  test("inserts a selectable placeholder when no text is selected", () => {
    expect(applyChatFormat("", 0, 0, "code")).toEqual({ value: "`code`", selectionStart: 1, selectionEnd: 5 });
  });

  test("renders markdown without allowing supplied HTML", () => {
    const view = renderSafeChatMarkdown("**Ready** <img src=x onerror=alert(1)>");
    expect(view).toContain("<strong>Ready</strong>");
    expect(view).not.toContain("<img");
    expect(view).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
