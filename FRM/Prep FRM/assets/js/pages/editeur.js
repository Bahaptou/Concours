// Notes editor (editeur.html?reading=N): CodeMirror on the left, live Typst preview on the
// right, autosave to notes/r<N>/fiche.typ through the local server. The note is shared: whoever
// opens it writes into it; the profile only says who did, in the note's journal.
// Loaded as an ES module after the classic scripts, which provide window.FRM.
import { EditorState, EditorView } from "../../vendor/codemirror/codemirror.js";
import { isInMath } from "../editor/typst-language.js";
import { baseExtensions, showProblem } from "../editor/setup.js";
import { renderToolbar, formattingKeys, insert, insertBlock } from "../editor/toolbar.js";
import { corpusPicker, ensureImport } from "../editor/corpus-picker.js";
import { imageMenu, attachImageInput } from "../editor/images.js";
import { customMathTools } from "../editor/math-tools.js";
import { noteTemplate } from "../editor/template.js";
import * as api from "../editor/api.js";

const { FRM } = window;
const { ui, store } = FRM;
const { esc } = ui;

const PREVIEW_DELAY = 400;
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
  if (!store.profile.authorSlug()) {
    mountPage(notice("Qui modifie cette fiche ?", `La fiche est commune : ton profil sert seulement à noter qui la crée et qui la modifie. <button type="button" class="btn" data-profile>Indiquer mon prénom</button>`));
    document.addEventListener("frm:change", () => store.profile.authorSlug() && location.reload(), { once: true });
    return;
  }

  mountPage(`
<div class="editor-head">
  <div><div class="kicker">${esc(reading.tag)} · fiche commune · tu écris en tant que ${esc(store.profile.displayName())}</div><h2>${esc(reading.title)}</h2></div>
  <div class="editor-actions">
    <span class="save-status" data-save-status>Chargement…</span>
    <a class="btn ghost" href="${ui.readingHref(reading)}">Voir la page du reading</a>
    <a class="btn ghost" data-pdf hidden target="_blank" rel="noopener">PDF</a>
  </div>
</div>
<div class="toolbar" data-text-tools></div>
<div class="toolbar math" data-math-tools hidden></div>
<div class="editor-grid">
  <div class="cm-host" data-editor></div>
  <div class="preview-pane">
    <div class="editor-error" data-error hidden></div>
    <div class="preview-pages" data-preview></div>
  </div>
</div>
<p class="src"><span data-journal></span>Fichier : <code>notes/r${reading.id}/fiche.typ</code> · enregistrement automatique · Ctrl+S pour enregistrer tout de suite.</p>`);
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
  const showJournal = (journal) => ($("[data-journal]").innerHTML = journal.length ? `${ui.journalLine(journal)} · ` : "");
  showJournal(note.data.journal);

  // ---------------------------------------------------------- preview

  let previewSeq = 0;
  let previewTimer = null;

  const showError = (problem) => showProblem($("[data-error]"), view, problem);

  async function refreshPreview() {
    const seq = ++previewSeq;
    try {
      const result = await api.compile(links.compile, view.state.doc.toString());
      if (seq !== previewSeq) return; // an older request answered late: ignore it
      $("[data-preview]").innerHTML = result.data.pages.join("");
      showError(null);
    } catch (error) {
      if (seq !== previewSeq) return;
      if (error instanceof api.ApiProblem && error.title === "TYPST_COMPILE_ERROR") showError(error.problem);
      else showError({ detail: error.message, explanation: "Aperçu indisponible" });
    }
  }

  // ---------------------------------------------------------- save

  let saveTimer = null;
  let dirty = false;
  const status = (text, kind = "") => {
    const el = $("[data-save-status]");
    el.textContent = text;
    el.dataset.kind = kind;
  };

  function setPdf(href) {
    const link = $("[data-pdf]");
    link.href = `${href}?v=${Date.now()}`;
    link.hidden = !href;
  }
  if (links.pdf) setPdf(links.pdf.href);

  async function saveNow() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    dirty = false;
    status("Enregistrement…");
    try {
      const result = await api.save(links.save, view.state.doc.toString());
      setPdf(result.data.pdf);
      showJournal(result.data.journal);
      status(`✓ Enregistré à ${new Date(result.data.savedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`, "ok");
    } catch (error) {
      if (error instanceof api.ApiProblem && error.problem.saved) {
        status("✓ Texte enregistré · rendu non mis à jour (erreur dans la fiche)", "warn");
      } else {
        dirty = true; // retry on the next change or Ctrl+S
        status(`⚠ Non enregistré : ${error.message}`, "error");
      }
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

  // A note may cite an entry (its title) or insert it whole; both come from _corpus.typ.
  const useCorpus = (v) => ensureImport(v, "/_corpus.typ", ["voir", "entree"]);
  const picker = corpusPicker(view, {
    load: async () => (await api.listCorpus()).data.entries,
    actions: [
      { label: "Citer", title: "Le titre de l'entrée, en couleur : #voir(\"id\")", run: (v, entry) => (useCorpus(v), insert(v, `#voir("${entry.id}")`)) },
      { label: "Insérer", title: "L'entrée entière : #entree(\"id\")", run: (v, entry) => (useCorpus(v), insertBlock(v, `#entree("${entry.id}")`)) },
    ],
  });
  const images = imageMenu(view);
  attachImageInput(view, images.open);
  toggleMath = renderToolbar({ textRow: $("[data-text-tools]"), mathRow: $("[data-math-tools]") }, view, { extras: [picker, images.element], mathExtras: [customMathTools(view)] });
  status(note.data.exists ? "✓ À jour" : "Nouvelle fiche : elle sera enregistrée dès ta première modification", note.data.exists ? "ok" : "");
  refreshPreview();
  view.focus();

  // Nothing typed is lost when the tab closes or the page changes: keepalive outlives the page.
  window.addEventListener("pagehide", () => {
    if (dirty) api.saveOnExit(links.save, view.state.doc.toString());
  });
}

start();
