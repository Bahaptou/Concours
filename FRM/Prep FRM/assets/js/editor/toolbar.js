// Toolbar of the editors (notes and corpus entries): text tools, math tools (shown only in
// math mode) and extra menus such as the corpus picker. Every tool inserts plain Typst, so the
// source stays readable.
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
  { key: "Mod-b", preventDefault: true, run: (v) => (wrap(v, "*", "*", "texte"), true) },
  { key: "Mod-i", preventDefault: true, run: (v) => (wrap(v, "_", "_", "texte"), true) },
];

export const TEXT_TOOLS = [
  { label: "Titre", title: "Titre de section (=)", run: (v) => prefixLines(v, "= ") },
  { label: "Gras", title: "Gras (Ctrl+B)", run: (v) => wrap(v, "*", "*", "texte") },
  { label: "Italique", title: "Italique (Ctrl+I)", run: (v) => wrap(v, "_", "_", "texte") },
  { label: "Liste", title: "Élément de liste (-)", run: (v) => prefixLines(v, "- ") },
  { label: "∑ Maths", title: "Maths dans le texte : $…$ (Ctrl+M)", primary: true, run: (v) => wrap(v, "$", "$", "x") },
  { label: "Équation", title: "Équation centrée : $ … $ sur sa ligne", run: (v) => wrap(v, "\n$ ", " $\n", "x") },
  // The boxes come from _gabarit.typ, imported by notes only.
  { label: "À retenir", title: "Encadré vert", notesOnly: true, run: (v) => wrap(v, "#retenir[", "]", "…") },
  { label: "Piège", title: "Encadré orange", notesOnly: true, run: (v) => wrap(v, "#piege[", "]", "…") },
  { label: "Définition", title: "Encadré bleu, avec un terme", notesOnly: true, run: (v) => wrap(v, '#definition("Terme")[', "]", "…") },
];

/** Tools of a corpus entry: already inside its own box, so no boxes and no section titles. */
export const ENTRY_TOOLS = TEXT_TOOLS.filter((tool) => !tool.notesOnly && tool.label !== "Titre");

const symbol = (label, typst, title) => ({ label, title: title || typst, run: (v) => insert(v, ` ${typst} `) });

export const MATH_TOOLS = [
  { label: "a⁄b", title: "Fraction : (a)/(b)", run: (v) => wrap(v, "(", ")/()", "a") },
  { label: "√", title: "Racine : sqrt(x)", run: (v) => wrap(v, "sqrt(", ")", "x") },
  { label: "xⁿ", title: "Exposant : x^(n)", run: (v) => wrap(v, "^(", ")", "n") },
  { label: "xᵢ", title: "Indice : x_(i)", run: (v) => wrap(v, "_(", ")", "i") },
  { label: "Σ", title: "Somme : sum_(i=1)^n", run: (v) => insert(v, " sum_(i=1)^n ") },
  { label: "E[ ]", title: "Espérance : E[X]", run: (v) => wrap(v, "E[", "]", "X") },
  { label: "Var", title: 'Variance : "Var"(X)', run: (v) => wrap(v, '"Var"(', ")", "X") },
  { label: "texte", title: 'Texte dans une formule : "…"', run: (v) => wrap(v, '"', '"', "texte") },
  symbol("≈", "approx"),
  symbol("≤", "<="),
  symbol("≥", ">="),
  symbol("σ", "sigma"),
  symbol("μ", "mu"),
  symbol("ρ", "rho"),
  symbol("β", "beta"),
  symbol("α", "alpha"),
  symbol("Δ", "Delta"),
];

// ---------------------------------------------------------------- rendering

function buttons(tools, view) {
  return tools.map((tool) => {
    const button = Object.assign(document.createElement("button"), {
      type: "button",
      className: tool.primary ? "tool primary" : "tool",
      textContent: tool.label,
      title: tool.title,
    });
    // mousedown + preventDefault keeps the editor's selection while clicking.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => tool.run(view));
    return button;
  });
}

/** Fills the two toolbar rows and returns a function that shows the math row or not.
 *  extras: elements appended to the text row (e.g. the corpus picker). */
export function renderToolbar({ textRow, mathRow }, view, { tools = TEXT_TOOLS, extras = [] } = {}) {
  textRow.replaceChildren(...buttons(tools, view), ...extras);
  const badge = Object.assign(document.createElement("span"), { className: "math-badge", textContent: "Mode maths" });
  mathRow.replaceChildren(badge, ...buttons(MATH_TOOLS, view));
  return (inMath) => {
    mathRow.hidden = !inMath;
  };
}
