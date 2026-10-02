// Minimal Typst support for CodeMirror: syntax colouring, and detection of math mode
// (between unescaped $) so that the editor can show the math toolbar.
import { StreamLanguage, HighlightStyle, syntaxHighlighting, tags } from "../../vendor/codemirror/codemirror.js";

const typst = {
  name: "typst",
  startState: () => ({ math: false, blockComment: 0, heading: false }),
  copyState: (state) => ({ ...state }),

  token(stream, state) {
    if (stream.sol()) state.heading = false;

    if (state.blockComment) {
      while (!stream.eol()) {
        if (stream.match("*/")) {
          state.blockComment -= 1;
          if (!state.blockComment) break;
        } else if (stream.match("/*")) state.blockComment += 1;
        else stream.next();
      }
      return "comment";
    }
    if (stream.match("/*")) {
      state.blockComment = 1;
      return "comment";
    }
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/^\\./)) return null; // escaped character, e.g. \$
    if (stream.eat("$")) {
      state.math = !state.math;
      return "meta";
    }
    if (state.math) {
      if (stream.match(/^"[^"]*"/)) return "string";
      if (stream.match(/^\d+(\.\d+)?/)) return "number";
      if (stream.match(/^[A-Za-z][A-Za-z.]*/)) return "atom";
      stream.next();
      return "operator";
    }
    if (stream.sol() && stream.match(/^=+\s/)) {
      state.heading = true;
      return "heading";
    }
    if (stream.match(/^#[A-Za-z_][\w-]*/)) return "keyword";
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return "string";
    if (stream.match(/^<[\w-]+>/) || stream.match(/^@[\w-]+/)) return "link";
    if (stream.match(/^`[^`]*`/)) return "string";
    if (stream.match(/^\*[^*\n$]+\*/)) return state.heading ? "heading" : "strong";
    if (stream.match(/^_[^_\n$]+_/)) return "emphasis";
    stream.next();
    return state.heading ? "heading" : null;
  },
};

export const typstLanguage = StreamLanguage.define(typst);

export const typstHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, fontWeight: "700", color: "#1a2744" },
    { tag: tags.comment, color: "#7c8399", fontStyle: "italic" },
    { tag: tags.keyword, color: "#b4532a" },
    { tag: tags.string, color: "#3f7a5c" },
    { tag: tags.meta, color: "#1c5cab", fontWeight: "700" },
    { tag: tags.atom, color: "#1c5cab" },
    { tag: tags.number, color: "#1c5cab" },
    { tag: tags.operator, color: "#2a78d6" },
    { tag: tags.link, color: "#6d4bc4" },
    { tag: tags.strong, fontWeight: "700" },
    { tag: tags.emphasis, fontStyle: "italic" },
  ])
);

/** True when position `pos` of `text` is inside math ($…$), with the same rules as the tokenizer. */
export function isInMath(text, pos) {
  let math = false;
  for (let i = 0; i < pos; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      if (end === -1 || end >= pos) return math;
      i = end;
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1 || end >= pos) return math;
      i = end + 1;
    } else if (char === "\\") {
      i += 1;
    } else if (char === "$") {
      math = !math;
    }
  }
  return math;
}
