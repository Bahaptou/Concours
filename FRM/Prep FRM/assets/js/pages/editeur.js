// Notes editor (editeur.html?reading=N): CodeMirror on the left, live Markdown preview on the
// right, autosave to notes/fiches/r<N>.md through the local server. The note is shared (and
// Obsidian edits the same file): whoever opens it writes into it; git says who did.
// Loaded as an ES module after the classic scripts, which provide window.FRM.
import { EditorState, EditorView } from "../../vendor/codemirror/codemirror.js";
import { isInMath } from "../editor/markdown-language.js";
import { baseExtensions } from "../editor/setup.js";
import { renderToolbar, formattingKeys, insert, insertBlock } from "../editor/toolbar.js";
import { corpusPicker, keepCursorBelowHeader } from "../editor/corpus-picker.js";
import { imageMenu, attachImageInput } from "../editor/images.js";
import { customMathTools } from "../editor/math-tools.js";
import { noteTemplate } from "../editor/template.js";
import * as api from "../editor/api.js";

const { FRM } = window;
const { ui } = FRM;
const { esc } = ui;

const PREVIEW_DELAY = 150;
const SAVE_DELAY = 1500;

const reading = FRM.findReading(new URLSearchParams(location.search).get("reading"));

// ---------------------------------------------------------------- page skeleton

function mountPage(body) {
  const book = FRM.bookOf(reading);
  ui.mount({
    active: `book:${book.id}`,
    title: `Fiche · ${reading.tag}`,
    trail: [
      { label: "Accueil", href: "index.html" },
      { label: `Livre ${book.id}`, href: ui.bookHref(book) },
      { label: `Chapitre ${reading.chapter}`, href: ui.readingHref(reading) },
      { label: "Fiche" },
    ],
    body,
  });
}

const notice = (title, text) => `<div class="card"><h2>${title}</h2><p>${text}</p></div>`;

// ---------------------------------------------------------------- editor

async function start() {
  if (!reading) return ui.mountNotFound("Ce reading");
  if (location.protocol === "file:") {
    return mountPage(notice("L'éditeur a besoin du serveur", "Lance <code>Lancer Prep FRM.bat</code> (double-clic), puis rouvre cette page depuis le navigateur qui s'ouvre."));
  }

  mountPage(`
<div class="editor-head">
  <div><div class="kicker">${esc(reading.tag)} · fiche commune</div><h2>${esc(reading.title)}</h2></div>
  <div class="editor-actions">
    <span class="save-status" data-save-status>Chargement…</span>
    <a class="btn ghost" href="${ui.readingHref(reading)}">Voir la page du reading</a>
  </div>
</div>
<div class="toolbar" data-text-tools></div>
<div class="toolbar math" data-math-tools hidden></div>
<div class="editor-grid">
  <div class="cm-host" data-editor></div>
  <div class="preview-pane">
    <div class="editor-error" data-error hidden></div>
    <div class="preview-md md" data-preview></div>
  </div>
</div>
<p class="src"><span data-journal></span>Fichier : <code>notes/fiches/r${reading.id}.md</code> (aussi ouvrable dans Obsidian) · enregistrement automatique · Ctrl+S pour enregistrer tout de suite.</p>`);
  document.body.classList.add("wide");

  const $ = (selector) => document.querySelector(selector);
  let note;
  try {
    note = await api.getNote(reading.id);
  } catch (error) {
    $("[data-save-status]").textContent = `⚠ ${error.message}`;
    return;
  }
  const links = note.links;
  const initial = note.data.exists ? note.data.source : noteTemplate(reading);
  const showJournal = (data) => {
    const line = ui.historyLine(data);
    $("[data-journal]").innerHTML = line ? `${line} · ` : "";
  };
  showJournal(note.data);

  // ---------------------------------------------------------- preview

  let previewTimer = null;

  /** Rendered in the browser, like the reading page shows it: nothing goes to the server. */
  function refreshPreview() {
    $("[data-preview]").innerHTML = FRM.renderMarkdown(view.state.doc.toString());
  }

  // ---------------------------------------------------------- save

  let saveTimer = null;
  let dirty = false;
  const status = (text, kind = "") => {
    const el = $("[data-save-status]");
    el.textContent = text;
    el.dataset.kind = kind;
  };

  async function saveNow() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    dirty = false;
    status("Enregistrement…");
    try {
      const result = await api.save(links.save, view.state.doc.toString());
      showJournal(result.data);
      status(`✓ Enregistré à ${new Date(result.data.savedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`, "ok");
    } catch (error) {
      dirty = true; // retry on the next change or Ctrl+S
      status(`⚠ Non enregistré : ${error.message}`, "error");
    }
  }

  // ---------------------------------------------------------- CodeMirror

  let toggleMath = () => {};
  const view = new EditorView({
    parent: $("[data-editor]"),
    state: EditorState.create({
      doc: initial,
      extensions: baseExtensions({
        keys: [{ key: "Mod-s", preventDefault: true, run: () => (saveNow(), true) }, ...formattingKeys],
        onUpdate(update) {
          if (update.docChanged) {
            dirty = true;
            status("Modifications non enregistrées…");
            clearTimeout(previewTimer);
            previewTimer = setTimeout(refreshPreview, PREVIEW_DELAY);
            clearTimeout(saveTimer);
            saveTimer = setTimeout(saveNow, SAVE_DELAY);
          }
          if (update.docChanged || update.selectionSet) {
            toggleMath(isInMath(update.state.doc.toString(), update.state.selection.main.head));
          }
        },
      }),
    }),
  });

  // A note may cite an entry (its title) or insert it whole, as Obsidian does.
  const loadCorpus = async () => {
    const entries = (await api.listCorpus()).data.entries;
    FRM.mergeCorpusEntries(entries); // the preview shows their titles and texts
    return entries;
  };
  const picker = corpusPicker(view, {
    load: loadCorpus,
    actions: [
      { label: "Citer", title: "Le titre de l'entrée, en couleur : [[id]]", run: (v, entry) => (keepCursorBelowHeader(v), insert(v, `[[${entry.id}]]`)) },
      { label: "Insérer", title: "L'entrée entière : ![[id]]", run: (v, entry) => (keepCursorBelowHeader(v), insertBlock(v, `![[${entry.id}]]`)) },
    ],
  });
  const images = imageMenu(view);
  attachImageInput(view, images.open);
  toggleMath = renderToolbar({ textRow: $("[data-text-tools]"), mathRow: $("[data-math-tools]") }, view, { extras: [picker, images.element], mathExtras: [customMathTools(view)] });
  status(note.data.exists ? "✓ À jour" : "Nouvelle fiche : elle sera enregistrée dès ta première modification", note.data.exists ? "ok" : "");
  loadCorpus()
    .catch(() => {})
    .then(refreshPreview);
  view.focus();

  // Nothing typed is lost when the tab closes or the page changes: keepalive outlives the page.
  window.addEventListener("pagehide", () => {
    if (dirty) api.saveOnExit(links.save, view.state.doc.toString());
  });
}

start();
