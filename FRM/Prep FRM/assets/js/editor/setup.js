// CodeMirror setup shared by the editors (notes and corpus entries): editing extensions,
// highlight of the line holding a compile error, and the error box above the preview.
import {
  EditorView, StateEffect, StateField, Decoration, keymap, lineNumbers, highlightActiveLine,
  highlightActiveLineGutter, drawSelection, history, historyKeymap, defaultKeymap, indentWithTab,
  bracketMatching, closeBrackets, closeBracketsKeymap, searchKeymap, highlightSelectionMatches,
} from "../../vendor/codemirror/codemirror.js";
import { typstLanguage, typstHighlight } from "./typst-language.js";

const { esc } = window.FRM.ui;

// ---------------------------------------------------------------- error line highlight

export const setErrorLine = StateEffect.define();

const errorLine = StateField.define({
  create: () => Decoration.none,
  update(lines, transaction) {
    lines = lines.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setErrorLine)) continue;
      const number = effect.value;
      lines = number && number <= transaction.state.doc.lines
        ? Decoration.set([Decoration.line({ class: "cm-error-line" }).range(transaction.state.doc.line(number).from)])
        : Decoration.none;
    }
    return lines;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ---------------------------------------------------------------- extensions

/**
 * Editing extensions. `keys` come before the default keymaps so that they win (Ctrl+S…);
 * `typst: false` for the Python code of a simulation (no Typst colouring, no line wrapping).
 */
export function baseExtensions({ keys = [], onUpdate = null, typst = true } = {}) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    history(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    ...(typst ? [typstLanguage, typstHighlight, errorLine, EditorView.lineWrapping] : []),
    keymap.of([...keys, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    ...(onUpdate ? [EditorView.updateListener.of(onUpdate)] : []),
  ];
}

// ---------------------------------------------------------------- error box

/**
 * Shows a problem (RFC 9457 body from the server) in `box` and highlights its line in `view`;
 * `null` clears both. `note` is the last line of the box. `label` names the text that holds the
 * error when the editor has several ("Hypothèses, ligne 3 · …").
 */
export function showProblem(box, view, problem, note = "L'aperçu garde la dernière version valide.", label = "") {
  if (!problem) {
    box.hidden = true;
    view.dispatch({ effects: setErrorLine.of(null) });
    return;
  }
  const place = [label, problem.line ? `${label ? "ligne" : "Ligne"} ${problem.line}` : ""].filter(Boolean).join(", ");
  const where = place ? `${place} · ` : "";
  const hints = (problem.hints || []).map((hint) => `<li>${esc(hint)}</li>`).join("");
  box.innerHTML = `
<strong>${where}${esc(problem.explanation || "Erreur de compilation")}</strong>
<div class="small">Message du compilateur : <code>${esc(problem.detail)}</code></div>
${hints ? `<ul class="small">${hints}</ul>` : ""}
${note ? `<div class="small muted">${esc(note)}</div>` : ""}`;
  box.hidden = false;
  view.dispatch({ effects: setErrorLine.of(problem.line || null) });
}
