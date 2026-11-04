import { apiErrorMessage } from "./apiErrorMessage";

const axiosError = (detail) => ({ response: { status: 422, data: { detail } } });

describe("apiErrorMessage", () => {
  test("returns a plain HTTPException detail unchanged", () => {
    expect(apiErrorMessage(axiosError("Ticket is locked"), "fallback")).toBe("Ticket is locked");
    expect(apiErrorMessage({ response: { data: { detail: "  Trim me  " } } }, "fallback")).toBe("  Trim me  ");
  });

  test("reduces a validation array to one sentence naming the field", () => {
    const message = apiErrorMessage(axiosError([
      { type: "value_error", loc: ["body", "email"], msg: "value is not a valid email address: An email address must have an @-sign.", input: "" },
    ]), "fallback");

    expect(message).toBe("email: value is not a valid email address: An email address must have an @-sign.");
    expect(typeof message).toBe("string");
  });

  test("joins several validation failures without leaking the raw payload", () => {
    const message = apiErrorMessage(axiosError([
      { loc: ["body", "name"], msg: "field required" },
      { loc: ["body", "email"], msg: "value is not a valid email address" },
    ]), "fallback");

    expect(message).toBe("name: field required email: value is not a valid email address");
    expect(message).not.toContain("[object");
  });

  test("never returns a value that cannot be rendered", () => {
    const shapes = [
      axiosError([]),
      axiosError([{ loc: ["body", "email"] }]),
      axiosError([{ msg: "" }]),
      axiosError([null, 7, {}]),
      axiosError({ message: "Server refused the change" }),
      axiosError(undefined),
      { response: { data: {} } },
      new Error("offline"),
      null,
      undefined,
    ];

    shapes.forEach((shape) => {
      const message = apiErrorMessage(shape, "fallback");
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
    });
    expect(apiErrorMessage(axiosError({ message: "Server refused the change" }), "fallback")).toBe("Server refused the change");
    expect(apiErrorMessage(axiosError([]), "fallback")).toBe("fallback");
    expect(apiErrorMessage(null, "fallback")).toBe("fallback");
  });
});
