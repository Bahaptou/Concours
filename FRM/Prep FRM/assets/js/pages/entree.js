// Corpus entry editor: entree.html creates an entry (optionally ?type=… to prefill),
// entree.html?id=bayes edits one. An entry belongs to everyone: on top its metadata (identifier,
// type, title) and who created and changed it; below, its one shared text in CodeMirror with a
// live preview in its box, the assumptions and limits of a formula, and the Python code of a
// simulation. The profile only says who writes, for the entry's journal. Readings are not chosen
// here: they come from the notes citing or inserting the entry and the questions linked to it.
// Saved on demand (button or Ctrl+S), not while typing: a saved text replaces everyone's at once
// and recompiles the notes that insert it, so it should be a deliberate act.
// Loaded as an ES module after the classic scripts, which provide window.FRM.
import { EditorState, EditorView } from "../../vendor/codemirror/codemirror.js";
import { isInMath } from "../editor/typst-language.js";
import { baseExtensions, showProblem, setErrorLine } from "../editor/setup.js";
import { renderToolbar, formattingKeys, insert, ENTRY_TOOLS } from "../editor/toolbar.js";
import { corpusPicker, ensureImport } from "../editor/corpus-picker.js";
import { imageMenu, attachImageInput } from "../editor/images.js";
import { customMathTools } from "../editor/math-tools.js";
import * as api from "../editor/api.js";

const { FRM } = window;
const { ui, store } = FRM;
const { esc } = ui;

const PREVIEW_DELAY = 400;
const params = new URLSearchParams(location.search);
const NEW_TEXT = "// Texte de l'entrée, commun à tous. Pour citer une autre entrée : menu « 📚 Corpus », puis Citer.\n";
// Starting code of a new entry, by type. A brick's demo runs with ▶ Exécuter on the brick
// itself, never when a simulation imports it.
const CODE_TEMPLATES = {
  simulation: "# Simulation : importe des briques (menu « 🧱 Briques »), puis ▶ Exécuter.\n",
  brique: [
    "# Brique de code : des fonctions que les simulations importent.",
    "",
    "def ma_fonction(x):",
    '    """Ce que fait la fonction."""',
    "    return x",
    "",
    "",
    'if __name__ == "__main__":',
    "    # Démonstration : lancée par ▶ Exécuter sur cette brique, pas quand une simulation l'importe.",
    "    print(ma_fonction(1))",
    "",
  ].join("\n"),
};
const CODE_TYPES = Object.keys(CODE_TEMPLATES);
const codeTemplate = (type) => CODE_TEMPLATES[type] || CODE_TEMPLATES.simulation;
// Texts a formula carries under its formula: small blocks in its box, on the corpus page and in
// the notes inserting it. Typst like the rest (formulas allowed), written in their own fields.
// Keep the types in step with SECTION_TYPES in backend/corpus.py.
const SECTIONS = [
  { id: "hypotheses", label: "Hypothèses", hint: "Conditions pour que la formule soit valable. Une puce par hypothèse (bouton Liste)." },
  { id: "limites", label: "Limites", hint: "Quand la formule trompe ou ne s'applique plus. Une puce par limite." },
];
const SECTION_TYPES = ["formule"];
// A financial product declares the variables it needs (a name, an optional note): no values here,
// the code fills them (produit("id") gives an object whose attributes are these names, all None).
// Keep in step with VARIABLE_TYPES in backend/corpus.py.
const VARIABLE_TYPES = ["produit"];
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const moduleName = (entryId) => entryId.replace(/-/g, "_");

function variableRow(v = { nom: "", note: "" }) {
  const input = (field, current, placeholder, extra = "") =>
    `<input data-var="${field}" value="${esc(current ?? "")}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"${extra}>`;
  return `<tr data-variable-row>
  <td>${input("nom", v.nom, "nom, ex. fixed_rate", ' spellcheck="false" autocomplete="off"')}</td>
  <td>${input("note", v.note, "note (facultative), ex. taux fixe annuel")}</td>
  <td><button type="button" class="pick-remove" data-remove-variable title="Retirer cette variable" aria-label="Retirer cette variable">×</button></td>
</tr>`;
}

/** The lines to start from in the code: the product and its variables to fill. */
function variablesSnippet(entryId, names) {
  const lines = ["from produits import produit", `p = produit("${entryId || "identifiant"}")`, ...names.map((name) => `p.${name} = ...`)];
  return lines.join("\n");
}

/** Line importing a brick into Python code: its public functions. */
function brickImportLine(brick) {
  const names = brick.code ? [...brick.code.matchAll(/^def ([A-Za-z]\w*)\(/gm)].map((m) => m[1]) : [];
  const module = `briques.${moduleName(brick.id)}`;
  return names.length ? `from ${module} import ${names.join(", ")}` : `import ${module}`;
}

/** Adds the import line after the last import at the top of the code (or first), unless present. */
function addBrickImport(view, brick) {
  const { doc } = view.state;
  const module = `briques.${moduleName(brick.id)}`;
  if (new RegExp(`^\\s*(from|import)\\s+${module.replace(".", "\\.")}\\b`, "m").test(doc.toString())) return view.focus();
  let after = null;
  for (let number = 1; number <= doc.lines; number += 1) {
    if (/^(import|from)\s/.test(doc.line(number).text)) after = doc.line(number);
  }
  const line = brickImportLine(brick);
  view.dispatch({ changes: after ? { from: after.to, insert: `\n${line}` } : { from: 0, insert: `${line}\n` } });
  view.focus();
}

/** Readable identifier from a title: "Règle de Bayes" -> "regle-de-bayes". */
const slugify = (text) => ui.fold(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 50).replace(/-+$/, "");

/** "notes/r12/fiche" -> "Fiche QA-1"; "corpus/bayes" -> "Entrée « bayes »". */
function targetLabel(target) {
  const note = /^notes\/r(\d+)\/fiche$/.exec(target);
  if (note) {
    const reading = FRM.findReading(note[1]);
    return `Fiche ${reading ? reading.tag : `R${note[1]}`}`;
  }
  return `Entrée « ${target.split("/")[1]} »`;
}

// ---------------------------------------------------------------- page skeleton

function mountPage(title, body) {
  ui.mount({
    active: "corpus",
    title,
    trail: [
      { label: "Accueil", href: "index.html" },
      { label: "Corpus", href: "corpus.html" },
      { label: title },
    ],
    body,
  });
}

const notice = (title, text) => `<div class="card"><h2>${title}</h2><p>${text}</p></div>`;

function typeOptions(selected) {
  return FRM.ENTRY_TYPES.map((t) => `<option value="${t.id}"${t.id === selected ? " selected" : ""}>${esc(t.label)}</option>`).join("");
}

/** Readings of an entry, read-only: those of the notes using it and of the questions linked to it. */
function readingsLine(entry) {
  const uses = entry ? entry.data.usedBy : [];
  const questionReadings = entry ? entry.data.questionReadings || [] : [];
  if (!uses.length && !questionReadings.length) {
    return "Readings : aucun pour l'instant. Cite ou insère l'entrée dans une fiche (menu « 📚 Corpus »), ou lie-la à une question (page Questions), pour la rattacher à un reading.";
  }
  const tag = (id) => FRM.findReading(id)?.tag || `R${id}`;
  const fromNotes = uses.map((use) => `${tag(use.reading)} (fiche)`);
  const fromQuestions = questionReadings.map((id) => `${tag(id)} (questions)`);
  return `Readings, d'après les fiches et les questions liées : ${[...fromNotes, ...fromQuestions].join(", ")}`;
}

function layout({ creating, meta }) {
  return `
<div class="editor-head">
  <div><div class="kicker">Corpus · <span data-kicker>${creating ? "Nouvelle entrée" : esc(FRM.entryType(meta.type).label)}</span> · entrée commune · tu écris en tant que ${esc(store.profile.displayName())}</div><h2 data-heading>${esc(meta.titre || "Nouvelle entrée")}</h2></div>
  <div class="editor-actions">
    <span class="save-status" data-save-status></span>
    <button type="button" class="btn ghost danger" data-delete${creating ? " hidden" : ""} title="Supprime l'entrée (texte, code, historique) et retire ses références des fiches et des autres entrées">Supprimer l'entrée</button>
    <a class="btn ghost" data-entry-link href="corpus.html"${creating ? " hidden" : ""}>Voir dans le corpus</a>
    <button type="button" class="btn" data-save title="Ctrl+S">${creating ? "Créer l'entrée" : "Enregistrer"}</button>
  </div>
</div>
<div class="card">
  <form class="meta-form" data-meta novalidate>
    <label class="field" data-field="titre">Titre<input name="titre" maxlength="120" placeholder="ex. Règle de Bayes" value="${esc(meta.titre)}"></label>
    <label class="field" data-field="type">Type<select name="type">${typeOptions(meta.type)}</select></label>
    <label class="field" data-field="id">Identifiant <span class="hint">pour citer : #voir("…") · fixé à la création</span><input name="id" maxlength="50" value="${esc(meta.id)}"${creating ? "" : " readonly"}></label>
  </form>
  <div class="variables-pane" data-variables-pane hidden>
    <h3>Variables</h3>
    <p class="small muted">Les variables dont le produit a besoin, sans valeur : on les remplit dans le code. Un même produit peut en déclarer plusieurs sortes (<code>fixed_rate</code>, <code>variable_rate</code>…), la fonction choisit celle qu'elle utilise.</p>
    <table class="variables-table">
      <thead><tr><th>Nom (pour le code)</th><th>Note</th><th></th></tr></thead>
      <tbody data-variables></tbody>
    </table>
    <button type="button" class="btn ghost" data-add-variable>＋ Ajouter une variable</button>
    <div class="variables-code"><span class="small muted">Dans le code :</span><div data-variables-code></div></div>
  </div>
  <p class="small" data-readings></p>
  <p class="small muted"><span data-journal></span> Le texte est commun : ce que tu enregistres remplace celui de tout le monde (git garde les anciens textes).</p>
  <div class="form-error" data-form-error hidden></div>
  <div class="rebuild-report" data-report hidden></div>
</div>
<div class="toolbar" data-text-tools></div>
<div class="toolbar math" data-math-tools hidden></div>
<div class="editor-grid">
  <div>
    <div class="cm-host" data-editor></div>
${SECTIONS.map(
  (section) => `    <div class="section-pane" data-section-pane="${section.id}" hidden>
      <h3>${section.label}</h3>
      <p class="small muted">${section.hint}</p>
      <div class="cm-host section" data-section="${section.id}"></div>
    </div>`
).join("\n")}
    <div class="code-pane" data-code-pane hidden>
      <h3 data-code-title>Code Python</h3>
      <div class="toolbar" data-code-tools></div>
      <div class="cm-host code" data-code></div>
      <div data-run></div>
    </div>
  </div>
  <div class="preview-pane">
    <div class="editor-error" data-error hidden></div>
    <div class="preview-pages" data-preview></div>
  </div>
</div>
<p class="src">Fichier : <code data-file>notes/corpus/${esc(meta.id || "…")}/texte.typ</code> · Ctrl+S pour enregistrer.</p>`;
}

// ---------------------------------------------------------------- editor

async function start() {
  const title = params.has("id") ? "Entrée du corpus" : "Nouvelle entrée";
  if (location.protocol === "file:") {
    return mountPage(title, notice("L'éditeur a besoin du serveur", "Lance <code>Lancer Prep FRM.bat</code> (double-clic), puis rouvre cette page depuis le navigateur qui s'ouvre."));
  }
  if (!store.profile.authorSlug()) {
    mountPage(title, notice("Qui modifie cette entrée ?", `L'entrée est commune : ton profil sert seulement à noter qui la crée et qui la modifie. <button type="button" class="btn" data-profile>Indiquer mon prénom et mon nom</button>`));
    document.addEventListener("frm:change", () => store.profile.authorSlug() && location.reload(), { once: true });
    return;
  }

  // ---------------------------------------------------------- loading

  let corpus;
  let entry = null; // the entry resource ({data, links}) once it exists on the server
  let text = null; // the entry's shared text ({data, links})
  try {
    corpus = await api.listCorpus();
    if (params.has("id")) {
      entry = await api.getEntry(params.get("id"));
      text = await api.getText(entry.data.id);
    }
  } catch (error) {
    if (error instanceof api.ApiProblem && error.title === "ENTRY_NOT_FOUND") return ui.mountNotFound(`L'entrée « ${params.get("id")} » du corpus`);
    return mountPage(title, notice("Chargement impossible", esc(error.message)));
  }

  const prefillType = FRM.entryType(params.get("type")) ? params.get("type") : "formule";
  const initialMeta = entry
    ? { id: entry.data.id, type: entry.data.type, titre: entry.data.titre }
    : { id: "", type: prefillType, titre: "" };
  mountPage(entry ? entry.data.titre : title, layout({ creating: !entry, meta: initialMeta }));
  document.body.classList.add("wide");

  const $ = (selector) => document.querySelector(selector);
  const form = $("[data-meta]");

  // What the server has: to know what to send on save, and to warn before leaving.
  let savedMeta = entry ? JSON.stringify(metaOf()) : null;
  let savedSource = text && text.data.exists ? text.data.source : null;
  let savedCode = text ? text.data.code : null;
  const savedSections = Object.fromEntries(SECTIONS.map((section) => [section.id, (text && text.data[section.id]) || ""]));
  let savedVariables = (text && text.data.variables) || [];

  // ---------------------------------------------------------- metadata form

  function metaOf() {
    return { type: form.type.value, titre: form.titre.value.trim() };
  }

  const hasCode = () => CODE_TYPES.includes(form.type.value);
  const hasSections = () => SECTION_TYPES.includes(form.type.value);
  const hasVariables = () => VARIABLE_TYPES.includes(form.type.value);

  // ---------------------------------------------------------- variables of a financial product

  const variablesBody = $("[data-variables]");
  variablesBody.innerHTML = savedVariables.map(variableRow).join("");

  /** The table as the server takes it: [{ nom, note }], blank rows skipped. */
  function readVariables() {
    return [...variablesBody.querySelectorAll("[data-variable-row]")]
      .map((row) => Object.fromEntries([...row.querySelectorAll("[data-var]")].map((input) => [input.dataset.var, input.value.trim()])))
      .filter((v) => v.nom || v.note)
      .map((v) => ({ nom: v.nom, note: v.note }));
  }

  /** The example to copy into the code, following the table and the identifier. */
  function showVariablesCode() {
    const names = readVariables().map((v) => v.nom).filter((name) => VARIABLE_NAME.test(name));
    $("[data-variables-code]").innerHTML = ui.codeBlock(variablesSnippet(form.id.value, names));
  }

  function markVariableNames() {
    variablesBody.querySelectorAll('[data-var="nom"]').forEach((input) => {
      input.classList.toggle("is-invalid", Boolean(input.value.trim()) && !VARIABLE_NAME.test(input.value.trim()));
      input.title = input.classList.contains("is-invalid") ? "Lettres sans accent, chiffres et _, sans commencer par un chiffre (le code l'utilise tel quel)" : "";
    });
  }

  $("[data-add-variable]").addEventListener("click", () => {
    variablesBody.insertAdjacentHTML("beforeend", variableRow());
    variablesBody.querySelector("[data-variable-row]:last-child [data-var='nom']").focus();
  });
  variablesBody.addEventListener("click", (event) => {
    if (!event.target.closest("[data-remove-variable]")) return;
    event.target.closest("[data-variable-row]").remove();
    showVariablesCode();
    markDirty();
    schedulePreview();
  });
  variablesBody.addEventListener("input", () => {
    markVariableNames();
    showVariablesCode();
    markDirty();
    schedulePreview();
  });

  function refreshMetaDisplay() {
    const meta = metaOf();
    $("[data-heading]").textContent = meta.titre || "Nouvelle entrée";
    if (entry) $("[data-kicker]").textContent = FRM.entryType(meta.type).label;
    $("[data-readings]").textContent = readingsLine(entry);
    $("[data-code-pane]").hidden = !hasCode();
    for (const section of SECTIONS) $(`[data-section-pane="${section.id}"]`).hidden = !hasSections();
    $("[data-variables-pane]").hidden = !hasVariables();
    showVariablesCode();
    $("[data-editor]").classList.toggle("compact", hasSections());
    $("[data-code-title]").textContent = form.type.value === "brique"
      ? `Code de la brique · une simulation l'importe avec : from briques.${moduleName(form.id.value || "identifiant")} import …`
      : "Code Python de la simulation";
    const extraFiles = hasCode() ? " + code.py" : hasSections() ? ` + ${SECTIONS.map((section) => `${section.id}.typ`).join(" + ")}` : hasVariables() ? " + variables.json" : "";
    $("[data-file]").textContent = `notes/corpus/${form.id.value || "…"}/texte.typ${extraFiles}`;
  }

  // While creating, the identifier follows the title until it is edited by hand.
  let idTouched = Boolean(entry);
  form.id.addEventListener("input", () => (idTouched = true));
  form.addEventListener("input", (event) => {
    if (event.target.name === "titre" && !idTouched) form.id.value = slugify(form.titre.value);
    clearFieldErrors();
    refreshMetaDisplay();
    markDirty();
    if (event.target.name === "titre") schedulePreview();
  });
  form.addEventListener("change", (event) => {
    if (event.target.name !== "type") return;
    schedulePreview();
    // A starting code still untouched follows the type (simulation <-> brick).
    const current = codeView.state.doc.toString();
    if (savedCode === null && Object.values(CODE_TEMPLATES).includes(current) && hasCode()) {
      codeView.dispatch({ changes: { from: 0, to: current.length, insert: codeTemplate(form.type.value) } });
    }
  });

  /** Who created and changed the entry, from its journal. */
  function showJournal() {
    const line = entry ? ui.journalLine(entry.data.journal) : "";
    $("[data-journal]").textContent = "";
    $("[data-journal]").insertAdjacentHTML("beforeend", line ? `${line}.` : "");
  }

  // ---------------------------------------------------------- errors and reports

  function clearFieldErrors() {
    form.querySelectorAll(".is-invalid").forEach((field) => field.classList.remove("is-invalid"));
    $("[data-form-error]").hidden = true;
  }

  function formError(html, field = null) {
    if (field) {
      const target = form.querySelector(`[data-field="${field}"]`);
      if (target) target.classList.add("is-invalid");
    }
    const box = $("[data-form-error]");
    box.innerHTML = html;
    box.hidden = false;
  }

  function showReport(rebuild) {
    const box = $("[data-report]");
    if (!rebuild || (!rebuild.failed.length && !rebuild.skipped.length)) {
      box.hidden = true;
      return;
    }
    const failed = rebuild.failed.map((f) => `<li>${esc(targetLabel(f.target))} : <code>${esc(f.message)}</code></li>`).join("");
    const skipped = rebuild.skipped.map((t) => `<li>${esc(targetLabel(t))}</li>`).join("");
    box.innerHTML = `
${failed ? `<strong>Ne compilent plus après ce changement</strong> (leur dernier rendu reste affiché) :<ul>${failed}</ul>` : ""}
${skipped ? `<strong>Pas recompilées tout de suite</strong> (trop nombreuses) : elles le seront à leur prochain enregistrement.<ul>${skipped}</ul>` : ""}`;
    box.hidden = false;
  }

  /** Turns a failed save into a message next to what caused it. */
  function explainFailure(error) {
    if (!(error instanceof api.ApiProblem)) return formError(esc(error.message));
    const { problem } = error;
    const reason = problem.field ? String(problem.detail).replace(`${problem.field} : `, "") : problem.detail;
    switch (error.title) {
      case "ENTRY_CONFLICT":
        return formError(`L'identifiant « ${esc(problem.entryId)} » est déjà pris (${esc(FRM.entryType(problem.existingType).label.toLowerCase())}) : <a href="corpus.html?id=${encodeURIComponent(problem.entryId)}">voir cette entrée</a>, ou choisis-en un autre.`, "id");
      case "CORPUS_IMPORT_FORBIDDEN":
        return showCompileError({ explanation: "Import interdit dans une entrée", detail: reason }, "Une entrée cite les autres avec #voir, jamais en les insérant : ça évite les boucles.");
      case "INVALID_REQUEST_PAYLOAD":
        if (["author", "name", "initials"].includes(problem.field)) return formError(`Profil incomplet pour noter qui modifie l'entrée (${esc(reason)}). <button type="button" class="link-btn" data-profile>Modifier le profil</button>`);
        return formError(`${esc(reason)}`, problem.field);
      default:
        return formError(esc(problem.detail || error.message));
    }
  }

  // ---------------------------------------------------------- compile errors

  /** Texts of the sections, as the server takes them: only formulas have them. */
  const sectionTexts = () => (hasSections() ? Object.fromEntries(SECTIONS.map((section) => [section.id, sectionViews[section.id].state.doc.toString()])) : {});

  /** Shows a compile error next to the text that holds it (the server says which: `part`), or
   *  clears the marks of every field when `problem` is null. */
  function showCompileError(problem, note) {
    for (const field of [view, ...Object.values(sectionViews)]) field.dispatch({ effects: setErrorLine.of(null) });
    const box = $("[data-error]");
    if (!problem) return showProblem(box, view, null);
    const section = SECTIONS.find((candidate) => candidate.id === problem.part);
    showProblem(box, section ? sectionViews[section.id] : view, problem, note, section ? section.label : "");
  }

  // ---------------------------------------------------------- preview

  let previewSeq = 0;
  let previewTimer = null;

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, PREVIEW_DELAY);
  }

  async function refreshPreview() {
    const seq = ++previewSeq;
    const meta = metaOf();
    try {
      const result = await api.previewEntry(corpus.links.preview, {
        type: meta.type,
        titre: meta.titre || "Sans titre",
        source: view.state.doc.toString(),
        ...sectionTexts(),
        // Only the valid names, once each: a name being typed must not stop the preview (saving reports it).
        ...(hasVariables() ? { variables: readVariables().filter((v, i, all) => VARIABLE_NAME.test(v.nom) && all.findIndex((w) => w.nom === v.nom) === i) } : {}),
      });
      if (seq !== previewSeq) return; // an older request answered late: ignore it
      $("[data-preview]").innerHTML = result.data.pages.join("");
      showCompileError(null);
    } catch (error) {
      if (seq !== previewSeq) return;
      if (error instanceof api.ApiProblem && error.title === "TYPST_COMPILE_ERROR") showCompileError(error.problem);
      else if (error instanceof api.ApiProblem) explainFailure(error);
      else showCompileError({ detail: error.message, explanation: "Aperçu indisponible" });
    }
  }

  // ---------------------------------------------------------- save

  let saving = false;
  const status = (text, kind = "") => {
    const el = $("[data-save-status]");
    el.textContent = text;
    el.dataset.kind = kind;
  };

  // Without a text yet, the starting text counts as "nothing written": no empty text is created.
  const sourceChanged = () => view.state.doc.toString() !== (savedSource ?? NEW_TEXT);
  const codeChanged = () => hasCode() && codeView.state.doc.toString() !== (savedCode ?? codeTemplate(form.type.value));
  const sectionsChanged = () => hasSections() && SECTIONS.some((section) => sectionViews[section.id].state.doc.toString() !== savedSections[section.id]);
  const variablesChanged = () => hasVariables() && JSON.stringify(readVariables()) !== JSON.stringify(savedVariables);
  const metaChanged = () => JSON.stringify(metaOf()) !== savedMeta;
  const isDirty = () => (entry ? metaChanged() : Boolean(form.titre.value.trim())) || sourceChanged() || codeChanged() || sectionsChanged() || variablesChanged();

  function markDirty() {
    if (!saving) status(isDirty() ? "Modifications non enregistrées" : "✓ À jour", isDirty() ? "warn" : "ok");
  }

  /** Takes the server's answer as the new reference: entry, links, saved metadata. */
  function adopt(resource) {
    const created = !entry;
    entry = resource;
    savedMeta = JSON.stringify({ type: entry.data.type, titre: entry.data.titre });
    if (created) {
      history.replaceState(null, "", `entree.html?id=${encodeURIComponent(entry.data.id)}`);
      document.querySelector(".crumb .here").textContent = entry.data.titre;
      form.id.readOnly = true;
      $("[data-save]").textContent = "Enregistrer";
    }
    $("[data-delete]").hidden = false;
    const link = $("[data-entry-link]");
    link.href = ui.entryHref(entry.data);
    link.hidden = false;
    showJournal();
    refreshMetaDisplay();
  }

  /** Recompiled notes and other entries; the entry itself re-rendered does not count. */
  const dependentsIn = (rebuild) => rebuild.rebuilt.filter((target) => target !== `corpus/${entry.data.id}`).length;

  const savedAt = () => new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  async function saveNow() {
    if (saving) return;
    saving = true;
    clearFieldErrors();
    status("Enregistrement…");
    let rebuilt = 0;
    try {
      if (!entry) {
        const created = await api.createEntry(corpus.links.create, { id: form.id.value.trim(), ...metaOf() });
        adopt(created);
      } else if (metaChanged()) {
        const updated = await api.updateEntry(entry.links.update, metaOf());
        adopt(updated);
        showReport(updated.data.rebuild);
        rebuilt += dependentsIn(updated.data.rebuild);
      }
      if (sourceChanged() || codeChanged() || sectionsChanged() || variablesChanged()) {
        const source = view.state.doc.toString();
        const code = hasCode() ? codeView.state.doc.toString() : undefined;
        const sections = sectionTexts();
        const variables = hasVariables() ? readVariables() : undefined;
        const written = () => {
          savedSource = source;
          if (code !== undefined) savedCode = code;
          Object.assign(savedSections, sections);
          if (variables !== undefined) savedVariables = variables;
        };
        try {
          const saved = await api.saveText({ method: "PUT", href: api.textUrl(entry.data.id) }, { source, code, ...sections, ...(variables !== undefined ? { variables } : {}) });
          written();
          adopt(saved);
          showReport(saved.data.rebuild);
          rebuilt += dependentsIn(saved.data.rebuild);
        } catch (error) {
          // Written even when it does not compile (the server says so): nothing typed is lost.
          if (error instanceof api.ApiProblem && error.problem.saved) written();
          throw error;
        }
      }
      showCompileError(null);
      saving = false;
      const s = rebuilt > 1 ? "s" : "";
      status(`✓ Enregistré à ${savedAt()}${rebuilt ? ` · ${rebuilt} fiche${s} ou entrée${s} liée${s} recompilée${s}` : ""}`, "ok");
    } catch (error) {
      saving = false;
      if (error instanceof api.ApiProblem && error.title === "TYPST_COMPILE_ERROR" && error.problem.saved) {
        status(`✓ Texte enregistré à ${savedAt()} · ne compile pas : les fiches gardent le dernier texte qui compilait`, "warn");
        showCompileError(error.problem, "Corrige puis enregistre : les fiches reprendront ce texte.");
        showReport(error.problem.rebuild);
        api.getEntry(entry.data.id).then(adopt, () => {});
        return;
      }
      if (error instanceof api.ApiProblem && error.title === "TYPST_COMPILE_ERROR") {
        // Not saved: only the entry's text can fail to compile before being written.
        showCompileError(error.problem);
      } else {
        explainFailure(error);
      }
      status("⚠ Non enregistré", "error");
    }
  }

  // ---------------------------------------------------------- CodeMirror

  const saveKey = { key: "Mod-s", preventDefault: true, run: () => (saveNow(), true) };
  let toggleMath = () => {};
  // The Typst fields (text, assumptions, limits) share one toolbar: it acts on the one last focused.
  let active = null;

  function onFieldUpdate(update) {
    if (update.docChanged) {
      markDirty();
      schedulePreview();
    }
    if (update.view === active && (update.docChanged || update.selectionSet)) {
      toggleMath(isInMath(update.state.doc.toString(), update.state.selection.main.head));
    }
  }

  const typstField = (parent, doc) =>
    new EditorView({
      parent,
      state: EditorState.create({ doc, extensions: baseExtensions({ keys: [saveKey, ...formattingKeys], onUpdate: onFieldUpdate }) }),
    });

  const view = typstField($("[data-editor]"), savedSource ?? NEW_TEXT);
  active = view;
  const sectionViews = Object.fromEntries(SECTIONS.map((section) => [section.id, typstField($(`[data-section="${section.id}"]`), savedSections[section.id])]));
  for (const field of [view, ...Object.values(sectionViews)]) {
    field.dom.addEventListener("focusin", () => {
      active = field;
      toggleMath(isInMath(field.state.doc.toString(), field.state.selection.main.head));
    });
  }

  const codeView = new EditorView({
    parent: $("[data-code]"),
    state: EditorState.create({
      doc: savedCode ?? codeTemplate(initialMeta.type),
      extensions: baseExtensions({ typst: false, keys: [saveKey], onUpdate: (update) => update.docChanged && markDirty() }),
    }),
  });

  // An entry cites others by title only (#voir from _corpus-titres.typ): no cycle possible.
  const picker = corpusPicker(() => active, {
    load: async () => (await api.listCorpus()).data.entries,
    actions: [
      {
        label: "Citer",
        title: "Le titre de l'entrée, en couleur : #voir(\"id\")",
        run: (v, other) => (ensureImport(v, "/_corpus-titres.typ", ["voir"]), insert(v, `#voir("${other.id}")`)),
      },
    ],
    exclude: () => (entry ? entry.data.id : null),
  });
  const images = imageMenu(() => active);
  for (const field of [view, ...Object.values(sectionViews)]) attachImageInput(field, images.open);
  toggleMath = renderToolbar({ textRow: $("[data-text-tools]"), mathRow: $("[data-math-tools]") }, () => active, { tools: ENTRY_TOOLS, extras: [picker, images.element], mathExtras: [customMathTools(() => active)] });

  // Python pane: import a brick, run the code being written.
  const brickPicker = corpusPicker(codeView, {
    load: async () => (await api.listCorpus()).data.entries.filter((e) => e.type === "brique"),
    actions: [{ label: "Importer", title: "Ajoute la ligne from briques.… import … en tête du code", run: (v, brick) => addBrickImport(v, brick) }],
    exclude: () => (entry ? entry.data.id : null),
    label: "🧱 Briques",
    title: "Importer une brique de code du corpus",
  });
  $("[data-code-tools]").replaceChildren(brickPicker);
  $("[data-run]").replaceChildren(
    FRM.runner.panel({ code: () => codeView.state.doc.toString(), readings: () => (entry ? entry.data.readings : []) })
  );

  // ---------------------------------------------------------- delete

  let deleted = false;

  /** Confirmation text: what goes, and where references are removed (the server does it). */
  function deletionSummary() {
    const { titre, usedBy, citedBy } = entry.data;
    const lines = [`Supprimer « ${titre} » pour tout le monde (texte, code, historique) ? C'est définitif (sauf retour par git).`];
    const places = [
      ...usedBy.map((use) => targetLabel(`notes/r${use.reading}/fiche`)),
      ...citedBy.map((id) => `Entrée « ${corpus.data.entries.find((e) => e.id === id)?.titre || id} »`),
    ];
    if (places.length) {
      lines.push("", "Ses références seront retirées (#voir devient le titre en texte simple, #entree disparaît) :", ...places.map((place) => `• ${place}`));
    }
    return lines.join("\n");
  }

  async function deleteNow() {
    const users = entry.data.importedBy;
    if (users.length) return formError(`Cette brique est importée par : ${users.map(esc).join(", ")}. Retire l'import de leur code d'abord.`);
    if (!confirm(deletionSummary())) return;
    status("Suppression…");
    try {
      const result = await api.deleteEntry(entry.data.id);
      deleted = true;
      const failed = result.data.rebuild.failed;
      if (failed.length) {
        alert(`Entrée supprimée. Ces textes ont été réécrits mais ne compilent pas (une erreur à eux) :\n${failed.map((f) => `• ${targetLabel(f.target)} : ${f.message}`).join("\n")}`);
      }
      location.href = "corpus.html";
    } catch (error) {
      status("⚠ Non supprimée", "error");
      if (error instanceof api.ApiProblem && error.title === "BRICK_IN_USE") {
        formError(`Cette brique est importée par : ${error.problem.importedBy.map(esc).join(", ")}. Retire l'import de leur code d'abord.`);
      } else {
        formError(esc(error.message));
      }
    }
  }

  $("[data-delete]").addEventListener("click", deleteNow);
  $("[data-save]").addEventListener("click", saveNow);
  window.addEventListener("beforeunload", (event) => {
    if (deleted || !isDirty()) return;
    event.preventDefault();
    event.returnValue = ""; // the browser asks before leaving: nothing is saved behind your back here
  });

  refreshMetaDisplay();
  showJournal();
  status(entry ? (savedSource === null ? "Pas encore de texte : écris-le puis enregistre" : "✓ À jour") : "Nouvelle entrée : titre, type, puis son texte", entry && savedSource !== null ? "ok" : "");
  refreshPreview();
  (entry ? view : form.titre).focus();
}

start();
