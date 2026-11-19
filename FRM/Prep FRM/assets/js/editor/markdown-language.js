// Markdown support for CodeMirror (notes and corpus entries are Markdown, shared with Obsidian):
// syntax colouring, and detection of math mode ($…$ or $$…$$) so that the editor can show the
// math toolbar.
import { markdown, markdownLanguage, HighlightStyle, syntaxHighlighting, tags } from "../../vendor/codemirror/codemirror.js";

export const markdownSupport = markdown({ base: markdownLanguage });

export const markdownHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, fontWeight: "700", color: "#1a2744" },
    { tag: tags.comment, color: "#7c8399", fontStyle: "italic" },
    { tag: tags.monospace, color: "#3f7a5c" },
    { tag: tags.link, color: "#6d4bc4" },
    { tag: tags.url, color: "#6d4bc4" },
    { tag: tags.quote, color: "#5a6276" },
    { tag: tags.strong, fontWeight: "700" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.processingInstruction, color: "#7c8399" },
    { tag: tags.meta, color: "#7c8399" },
  ])
);

/** True when position `pos` of `text` is inside math ($…$ or $$…$$), outside code. */
export function isInMath(text, pos) {
  let math = null; // "$" or "$$" while inside
  let fenced = false;
  for (let i = 0; i < pos; i += 1) {
    const atLineStart = i === 0 || text[i - 1] === "\n";
    if (atLineStart && /^(```|~~~)/.test(text.slice(i, i + 3))) {
      fenced = !fenced;
      const end = text.indexOf("\n", i);
      if (end === -1 || end >= pos) return false;
      i = end;
      continue;
    }
    if (fenced) continue;
    const char = text[i];
    if (char === "\\") {
      i += 1;
    } else if (char === "`" && !math) {
      const end = text.indexOf("`", i + 1);
      if (end === -1 || end >= pos) return false;
      i = end;
    } else if (char === "$") {
      const mark = text[i + 1] === "$" ? "$$" : "$";
      if (!math) math = mark;
      else if (math === mark) math = null;
      i += mark.length - 1;
    }
  }
  return Boolean(math) && !fenced;
}
