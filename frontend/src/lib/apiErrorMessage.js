/**
 * One readable sentence for a failed Nexus API call.
 *
 * FastAPI answers a rejected request in two different shapes:
 *
 *   raise HTTPException(400, detail="Ticket is locked")   →  detail is a string
 *   request body validation failure                       →  detail is an array
 *                                                             of {loc, msg, ...}
 *
 * Passing the array to `toast.error` (or any render slot) throws during render
 * — "Objects are not valid as a React child" — which replaces the screen the
 * technician was working on with a blank tree, and shows them nothing about
 * what they got wrong. Reducing the payload to a string first is what keeps a
 * rejected form an error message instead of a crash.
 */
export function apiErrorMessage(error, fallback = "Something went wrong. Nothing has been changed.") {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;

  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") return item.trim() || null;
        const message = typeof item?.msg === "string" ? item.msg.trim() : "";
        if (!message) return null;
        // `loc` looks like ["body", "email"]; the field is what the operator
        // needs to recognise in the form they just submitted.
        const field = (Array.isArray(item.loc) ? item.loc : [])
          .filter((part) => part !== "body" && part !== "query" && part !== "path")
          .join(".");
        return field ? `${field}: ${message}` : message;
      })
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }

  if (detail && typeof detail === "object" && typeof detail.message === "string" && detail.message.trim()) {
    return detail.message;
  }

  return fallback;
}
