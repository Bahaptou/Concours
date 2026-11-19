// Toolbar of the editors (notes and corpus entries): text tools, math tools (shown only in
// math mode) and extra menus such as the corpus picker. Every tool inserts plain Markdown and
// LaTeX, as Obsidian reads them, so the source stays readable.
import { EditorSelection } from "../../vendor/codemirror/codemirror.js";

// ---------------------------------------------------------------- editing primitives

/** Surrounds each selection with before/after; an empty selection gets `placeholder`, selected. */
export function wrap(view, before, after, placeholder = "") {
  view.dispatch(
    view.state.changeByRange((range) => {
      const inner = range.empty ? placeholder : view.state.sliceDoc(range.from, range.to);
      const start = range.from + before.length;
      return {
        changes: { from: range.from, to: range.to, insert: before + inner + after },
        range: EditorSelection.range(start, start + inner.length),
      };
    })
  );
  view.focus();
}

/** Inserts text at each cursor, replacing the selection. */
export function insert(view, text) {
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
}

/** Adds `prefix` at the start of every selected line (headings, list items). */
export function prefixLines(view, prefix) {
  const changes = [];
  for (const range of view.state.selection.ranges) {
    for (let pos = range.from; pos <= range.to; ) {
      const line = view.state.doc.lineAt(pos);
      if (!line.text.startsWith(prefix)) changes.push({ from: line.from, insert: prefix });
      pos = line.to + 1;
    }
  }
  view.dispatch({ changes });
  view.focus();
}

/** Inserts a snippet at each cursor. `select`, a part of the snippet: left selected so that typing
 *  replaces it, or replaced by the text selected before (like wrap). */
export function insertSnippet(view, snippet, select = null) {
  const at = select ? snippet.indexOf(select) : -1;
  view.dispatch(
    view.state.changeByRange((range) => {
      if (at < 0) {
        return { changes: { from: range.from, to: range.to, insert: snippet }, range: EditorSelection.cursor(range.from + snippet.length) };
      }
      const inner = range.empty ? select : view.state.sliceDoc(range.from, range.to);
      const text = snippet.slice(0, at) + inner + snippet.slice(at + select.length);
      const start = range.from + at;
      return { changes: { from: range.from, to: range.to, insert: text }, range: EditorSelection.range(start, start + inner.length) };
    })
  );
  view.focus();
}

/** Inserts a block (equation, formula) on its own lines. */
export function insertBlock(view, text) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const before = line.text.trim() ? "\n" : "";
  insert(view, `${before}${text}\n`);
}

// ---------------------------------------------------------------- tools

/** Keyboard shortcuts of the formatting tools, for the editors' keymaps. */
export const formattingKeys = [
  { key: "Mod-m", preventDefault: true, run: (v) => (wrap(v, "$", "$", "x"), true) },
  { key: "Mod-b", preventDefault: true, run: (v) => (wrap(v, "**", "**", "texte"), true) },
  { key: "Mod-i", preventDefault: true, run: (v) => (wrap(v, "*", "*", "texte"), true) },
];

/** A callout, as Obsidian writes it: "> [!kind] Title" then the content, each line quoted. */
function callout(view, kind, title) {
  view.dispatch(
    view.state.changeByRange((range) => {
      const inner = range.empty ? "…" : view.state.sliceDoc(range.from, range.to);
      const line = view.state.doc.lineAt(range.from);
      const before = `${line.text.trim() && range.from === line.from ? "" : line.text.trim() ? "\n\n" : ""}> [!${kind}] ${title}\n> `;
      const body = inner.split("\n").join("\n> ");
      const start = range.from + before.length;
      return {
        changes: { from: range.from, to: range.to, insert: `${before}${body}\n` },
        range: EditorSelection.range(start, start + body.length),
      };
    })
  );
  view.focus();
}

export const TEXT_TOOLS = [
  { label: "Titre", title: "Titre de section (##)", run: (v) => prefixLines(v, "## ") },
  { label: "Gras", title: "Gras : **…** (Ctrl+B)", run: (v) => wrap(v, "**", "**", "texte") },
  { label: "Italique", title: "Italique : *…* (Ctrl+I)", run: (v) => wrap(v, "*", "*", "texte") },
  { label: "Liste", title: "Élément de liste (-)", run: (v) => prefixLines(v, "- ") },
  { label: "∑ Maths", title: "Maths dans le texte : $…$ (Ctrl+M)", primary: true, run: (v) => wrap(v, "$", "$", "x") },
  { label: "Équation", title: "Équation centrée : $$…$$ sur sa ligne", run: (v) => wrap(v, "\n$$", "$$\n", "x") },
  // Callouts, as in Obsidian ("> [!tip] …"); notes only (an entry is already in its own box).
  { label: "À retenir", title: "Encadré vert : > [!tip]", notesOnly: true, run: (v) => callout(v, "tip", "À retenir") },
  { label: "Piège", title: "Encadré orange : > [!warning]", notesOnly: true, run: (v) => callout(v, "warning", "Piège") },
  { label: "Définition", title: "Encadré bleu, avec un terme : > [!info]", notesOnly: true, run: (v) => callout(v, "info", "Terme") },
];

/** Tools of a corpus entry: already inside its own box, so no boxes and no section titles. */
export const ENTRY_TOOLS = TEXT_TOOLS.filter((tool) => !tool.notesOnly && tool.label !== "Titre");

const symbol = (label, latex, title) => ({ label, title: title || latex, run: (v) => insert(v, `${latex} `) });

export const MATH_TOOLS = [
  { label: "a⁄b", title: "Fraction : \\frac{a}{b}", run: (v) => wrap(v, "\\frac{", "}{}", "a") },
  { label: "√", title: "Racine : \\sqrt{x}", run: (v) => wrap(v, "\\sqrt{", "}", "x") },
  { label: "xⁿ", title: "Exposant : x^{n}", run: (v) => wrap(v, "^{", "}", "n") },
  { label: "xᵢ", title: "Indice : x_{i}", run: (v) => wrap(v, "_{", "}", "i") },
  { label: "Σ", title: "Somme : \\sum_{i=1}^{n}", run: (v) => insert(v, "\\sum_{i=1}^{n} ") },
  { label: "E[ ]", title: "Espérance : E[X]", run: (v) => wrap(v, "E[", "]", "X") },
  { label: "Var", title: "Variance : \\operatorname{Var}(X)", run: (v) => wrap(v, "\\operatorname{Var}(", ")", "X") },
  { label: "Cov", title: "Covariance : \\operatorname{Cov}(X, Y)", run: (v) => wrap(v, "\\operatorname{Cov}(", ")", "X, Y") },
  { label: "texte", title: "Texte dans une formule : \\text{…}", run: (v) => wrap(v, "\\text{", "}", "texte") },
  symbol("≈", "\\approx"),
  symbol("≤", "\\le"),
  symbol("≥", "\\ge"),
  symbol("σ", "\\sigma"),
  symbol("μ", "\\mu"),
  symbol("ρ", "\\rho"),
  symbol("β", "\\beta"),
  symbol("α", "\\alpha"),
  symbol("Δ", "\\Delta"),
];

// ---------------------------------------------------------------- rendering

/** A tool with `choices` is a drop-down that always shows its label: picking a choice runs
 *  tool.run(view, value) on the editor's selection, then the menu goes back to its label. The
 *  editor keeps its selection while blurred, so no mousedown trick is needed here. */
function dropdown(tool, target) {
  const select = Object.assign(document.createElement("select"), { className: "tool", title: tool.title });
  select.setAttribute("aria-label", tool.title);
  select.append(new Option(tool.label, ""), ...tool.choices.map((choice) => new Option(choice.label, choice.value)));
  select.addEventListener("change", () => {
    const { value } = select;
    select.value = "";
    if (value) tool.run(target(), value);
  });
  return select;
}

/** `view` is an editor, or a function returning the one to act on (editors with several fields). */
function controls(tools, view) {
  const target = typeof view === "function" ? view : () => view;
  return tools.map((tool) => {
    if (tool.choices) return dropdown(tool, target);
    const button = Object.assign(document.createElement("button"), {
      type: "button",
      className: tool.primary ? "tool primary" : "tool",
      textContent: tool.label,
      title: tool.title,
    });
    // mousedown + preventDefault keeps the editor's selection while clicking.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => tool.run(target()));
    return button;
  });
}

/** Fills the two toolbar rows and returns a function that shows the math row or not.
 *  view: the editor, or a function returning the one that has the focus (see controls).
 *  extras: elements appended to the text row (e.g. the corpus picker). */
export function renderToolbar({ textRow, mathRow }, view, { tools = TEXT_TOOLS, extras = [], mathExtras = [] } = {}) {
  textRow.replaceChildren(...controls(tools, view), ...extras);
  const badge = Object.assign(document.createElement("span"), { className: "math-badge", textContent: "Mode maths" });
  mathRow.replaceChildren(badge, ...controls(MATH_TOOLS, view), ...mathExtras);
  return (inMath) => {
    mathRow.hidden = !inMath;
  };
}
