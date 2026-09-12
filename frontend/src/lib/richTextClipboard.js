const BULLET_MARKER = /^\s*(?:[-*•‣◦▪])\s+(.+)\s*$/;
const ORDERED_MARKER = /^\s*\d+[.)]\s+(.+)\s*$/;

/**
 * Recognise a complete plain-text list copied from another tool.
 *
 * Browsers only provide rich clipboard HTML in some applications. When that
 * is unavailable, a pasted list used to become plain paragraphs in Tiptap and
 * Tailwind's reset then made the original structure impossible to recover.
 * We deliberately recognise only an unambiguous, all-list selection so normal
 * prose and mixed notes continue through the editor's native paste behaviour.
 */
export function parsePlainTextClipboardList(value) {
  if (typeof value !== "string") return null;
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const nonEmptyLines = lines.filter((line) => line.trim());

  if (nonEmptyLines.length < 2) return null;

  const bulletItems = nonEmptyLines.map((line) => line.match(BULLET_MARKER));
  if (bulletItems.every(Boolean)) {
    return { type: "bullet", items: bulletItems.map((match) => match[1].trim()) };
  }

  const orderedItems = nonEmptyLines.map((line) => line.match(ORDERED_MARKER));
  if (orderedItems.every(Boolean)) {
    return { type: "ordered", items: orderedItems.map((match) => match[1].trim()) };
  }

  return null;
}
