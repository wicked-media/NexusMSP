import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ breaks: true, html: false, linkify: true });
const defaultLinkOpen = markdown.renderer.rules.link_open
  || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, index, options, env, self);
};

export function renderSafeChatMarkdown(value) {
  return DOMPurify.sanitize(markdown.render(String(value || "")), {
    ADD_ATTR: ["target", "rel"],
  });
}

export function applyChatFormat(value, start, end, format) {
  const source = String(value || "");
  const selectionStart = Math.max(0, Math.min(Number(start) || 0, source.length));
  const selectionEnd = Math.max(selectionStart, Math.min(Number(end) || 0, source.length));
  const selected = source.slice(selectionStart, selectionEnd);
  const before = source.slice(0, selectionStart);
  const after = source.slice(selectionEnd);
  const wrappers = {
    bold: ["**", "**", "bold text"],
    code: ["`", "`", "code"],
    quote: ["> ", "", "quoted note"],
    list: ["- ", "", "list item"],
  };
  const [prefix, suffix, placeholder] = wrappers[format] || [];
  if (prefix === undefined) return { value: source, selectionStart, selectionEnd };
  const content = selected || placeholder;
  const nextValue = `${before}${prefix}${content}${suffix}${after}`;
  const nextStart = selectionStart + prefix.length;
  return { value: nextValue, selectionStart: nextStart, selectionEnd: nextStart + content.length };
}
