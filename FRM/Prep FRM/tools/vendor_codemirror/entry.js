// Public surface of the vendored CodeMirror bundle: only what the notes editor uses.
export { EditorState, EditorSelection, StateEffect, StateField } from "@codemirror/state";
export {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, Decoration, placeholder,
} from "@codemirror/view";
export { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
export { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput } from "@codemirror/language";
export { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
export { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
export { tags } from "@lezer/highlight";
